import type { NormalizedEvent, SubscriptionState, SubscriptionStatus } from "../provider.ts";

// Stripe's event and object shapes, read defensively: the body is signed by Stripe, but its API version is chosen in the
// account, so a field may sit in the older place (subscription.current_period_end, invoice.subscription) or the newer
// one (the first subscription item, invoice.parent.subscription_details). Nothing here keeps a name, an address or a
// card: only ids, the plan code, the status, dates and amounts.
type Obj = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// An expandable field is the id, or the object that has it.
function ref(value: unknown): string | undefined {
  return str(value) ?? (isObj(value) ? str(value.id) : undefined);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function iso(seconds: unknown): string | undefined {
  const value = num(seconds);
  return value === undefined ? undefined : new Date(value * 1000).toISOString();
}

function orgId(value: unknown): string | undefined {
  const id = str(value);
  return id !== undefined && UUID.test(id) ? id : undefined;
}

function at(object: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>((value, key) => {
    if (Array.isArray(value)) {
      return typeof key === "number" ? value[key] : undefined;
    }
    return isObj(value) ? value[key] : undefined;
  }, object);
}

const STATUSES: Record<string, SubscriptionStatus> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  paused: "paused",
};

export function subscriptionStatus(status: unknown): SubscriptionStatus | undefined {
  return typeof status === "string" ? STATUSES[status] : undefined;
}

function firstItem(subscription: Obj): Obj | undefined {
  const item = at(subscription, "items", "data", 0);
  return isObj(item) ? item : undefined;
}

export function subscriptionState(subscription: Obj): SubscriptionState | null {
  const providerSubscriptionRef = str(subscription.id);
  const status = subscriptionStatus(subscription.status);
  if (!providerSubscriptionRef || !status) {
    return null;
  }
  const planCode = str(at(firstItem(subscription), "price", "metadata", "plan_code"));
  return { providerSubscriptionRef, status, ...(planCode ? { planCode } : {}) };
}

// JSON drops a field that is undefined; the event is built without it so that it equals what the database stores.
function compact(event: NormalizedEvent): NormalizedEvent {
  return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)) as NormalizedEvent;
}

function subscriptionEvent(
  subscription: Obj,
  kind: "subscription.activated" | "subscription.updated" | "subscription.canceled",
  providerCreatedAt: string,
): NormalizedEvent | null {
  const state = subscriptionState(subscription);
  const providerSubscriptionRef = str(subscription.id);
  const status = kind === "subscription.canceled" ? "canceled" : state?.status;
  if (!providerSubscriptionRef || !status) {
    return null;
  }
  const item = firstItem(subscription);
  const periodEnd = iso(subscription.current_period_end ?? item?.current_period_end);
  const cancelAt = iso(subscription.cancel_at) ?? (subscription.cancel_at_period_end === true ? periodEnd : undefined);
  return {
    kind,
    providerCreatedAt,
    status,
    providerSubscriptionRef,
    orgId: orgId(at(subscription, "metadata", "org_id")),
    providerCustomerRef: ref(subscription.customer),
    planCode: state?.planCode ?? str(at(item, "price", "metadata", "plan_code")),
    currentPeriodStart: iso(subscription.current_period_start ?? item?.current_period_start),
    currentPeriodEnd: periodEnd,
    trialEndsAt: iso(subscription.trial_end),
    cancelAt,
  };
}

// The state of a subscription fetched now (a late event is replaced by it): the status the provider holds, created now.
export function fetchedSubscriptionEvent(subscription: Obj, fetchedAt: Date): NormalizedEvent | null {
  const event = subscriptionEvent(
    subscription,
    subscription.status === "canceled" ? "subscription.canceled" : "subscription.updated",
    fetchedAt.toISOString(),
  );
  return event ? compact(event) : null;
}

function invoiceParty(invoice: Obj) {
  const details = at(invoice, "parent", "subscription_details");
  return {
    providerSubscriptionRef: ref(invoice.subscription) ?? ref(at(details, "subscription")),
    orgId: orgId(at(invoice, "subscription_details", "metadata", "org_id") ?? at(details, "metadata", "org_id")),
    providerCustomerRef: ref(invoice.customer),
  };
}

function taxMinor(invoice: Obj): number {
  const taxes = invoice.total_taxes;
  if (Array.isArray(taxes)) {
    return taxes.reduce<number>((sum, tax) => sum + (num(at(tax, "amount")) ?? 0), 0);
  }
  return num(invoice.tax) ?? 0;
}

function invoiceEvent(type: string, invoice: Obj, providerCreatedAt: string): NormalizedEvent | null {
  const party = invoiceParty(invoice);
  const invoiceRef = str(invoice.id);
  if (!party.providerSubscriptionRef || !invoiceRef) {
    return null;
  }
  const providerPaymentRef = ref(invoice.payment_intent) ?? invoiceRef;
  if (type === "invoice.payment_failed") {
    return {
      kind: "payment.failed",
      providerCreatedAt,
      ...party,
      providerSubscriptionRef: party.providerSubscriptionRef,
      providerPaymentRef,
    };
  }
  const amountMinor = num(invoice.amount_paid);
  const currency = str(invoice.currency)?.toUpperCase();
  if (amountMinor === undefined || amountMinor < 0 || !currency) {
    return null;
  }
  return {
    kind: "payment.succeeded",
    providerCreatedAt,
    purpose: "subscription",
    ...party,
    providerSubscriptionRef: party.providerSubscriptionRef,
    subscriptionStatus: amountMinor > 0 ? "active" : "trialing",
    amountMinor,
    taxMinor: taxMinor(invoice),
    currency,
    invoiceRef,
    providerPaymentRef,
  };
}

// The seven Stripe events of the subscription lifecycle; anything else (charge.succeeded, customer.updated, ...) is
// acknowledged by the caller without being stored.
export function normalizeStripeEvent(payload: unknown): NormalizedEvent[] {
  const type = isObj(payload) ? str(payload.type) : undefined;
  const object = at(payload, "data", "object");
  const providerCreatedAt = isObj(payload) ? iso(payload.created) : undefined;
  if (!type || !providerCreatedAt || !isObj(object)) {
    return [];
  }
  let event: NormalizedEvent | null = null;
  switch (type) {
    case "checkout.session.completed": {
      const id = orgId(object.client_reference_id);
      const providerCustomerRef = ref(object.customer);
      if (object.mode === "subscription" && id && providerCustomerRef) {
        event = {
          kind: "checkout.completed",
          providerCreatedAt,
          orgId: id,
          providerCustomerRef,
          providerSubscriptionRef: ref(object.subscription),
        };
      }
      break;
    }
    case "customer.subscription.created":
      event = subscriptionEvent(object, "subscription.activated", providerCreatedAt);
      break;
    case "customer.subscription.updated":
      event = subscriptionEvent(object, "subscription.updated", providerCreatedAt);
      break;
    case "customer.subscription.deleted":
      event = subscriptionEvent(object, "subscription.canceled", providerCreatedAt);
      break;
    case "customer.subscription.trial_will_end": {
      const providerSubscriptionRef = str(object.id);
      const trialEndsAt = iso(object.trial_end);
      if (providerSubscriptionRef && trialEndsAt) {
        event = {
          kind: "subscription.trial_will_end",
          providerCreatedAt,
          providerSubscriptionRef,
          trialEndsAt,
          orgId: orgId(at(object, "metadata", "org_id")),
          providerCustomerRef: ref(object.customer),
        };
      }
      break;
    }
    case "invoice.paid":
    case "invoice.payment_failed":
      event = invoiceEvent(type, object, providerCreatedAt);
      break;
  }
  return event ? [compact(event)] : [];
}
