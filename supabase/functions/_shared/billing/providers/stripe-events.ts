import { isObject } from "../../http.ts";
import type { NormalizedEvent, SubscriptionState, SubscriptionStatus } from "../provider.ts";

// Stripe's event and object shapes, read defensively: the body is signed by Stripe, but its API version is chosen in the
// account, so a field may sit in the older place (subscription.current_period_end, invoice.subscription) or the newer
// one (the first subscription item, invoice.parent.subscription_details). Nothing here keeps a name, an address or a
// card: only ids, the plan code, the status, dates and amounts.
type Obj = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// An expandable field is the id, or the object that has it.
function ref(value: unknown): string | undefined {
  return str(value) ?? (isObject(value) ? str(value.id) : undefined);
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
    return isObject(value) ? value[key] : undefined;
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
  return isObject(item) ? item : undefined;
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

const SKU = /^[a-z0-9_]{1,64}$/;

// A paid Checkout session of a boost (billing_boost_checkout_start, createPaymentCheckout): our own session in payment
// mode, paid, whose metadata names the purpose boost, the product and the same organisation as client_reference_id. A
// session that names two organisations is not ours to trust and gives no event. The payment intent is the reference that
// makes the boost unique, so the completed event and a later async_payment_succeeded event give one boost.
function boostEvent(session: Obj, providerCreatedAt: string): NormalizedEvent | null {
  const id = orgId(session.client_reference_id);
  const sku = str(at(session, "metadata", "sku"));
  const amountMinor = num(session.amount_total);
  const currency = str(session.currency)?.toUpperCase();
  const providerPaymentRef = ref(session.payment_intent) ?? str(session.id);
  if (
    session.mode !== "payment" || session.payment_link || session.payment_status !== "paid" ||
    at(session, "metadata", "purpose") !== "boost" || !id || at(session, "metadata", "org_id") !== id ||
    !sku || !SKU.test(sku) || amountMinor === undefined || amountMinor < 0 || !currency || !providerPaymentRef
  ) {
    return null;
  }
  return {
    kind: "boost.paid",
    providerCreatedAt,
    orgId: id,
    sku,
    providerPaymentRef,
    amountMinor,
    taxMinor: num(at(session, "total_details", "amount_tax")) ?? 0,
    currency,
  };
}

// The seven Stripe events of the subscription lifecycle and the two of a paid boost session; anything else
// (charge.succeeded, customer.updated, ...) is acknowledged by the caller without being stored.
export function normalizeStripeEvent(payload: unknown): NormalizedEvent[] {
  const type = isObject(payload) ? str(payload.type) : undefined;
  const object = at(payload, "data", "object");
  const providerCreatedAt = isObject(payload) ? iso(payload.created) : undefined;
  if (!type || !providerCreatedAt || !isObject(object)) {
    return [];
  }
  let event: NormalizedEvent | null = null;
  switch (type) {
    case "checkout.session.completed": {
      const id = orgId(object.client_reference_id);
      const providerCustomerRef = ref(object.customer);
      // A Payment Link takes client_reference_id from the payer; only our own checkout sessions name an organisation we trust.
      if (object.mode === "subscription" && !object.payment_link && id && providerCustomerRef) {
        event = {
          kind: "checkout.completed",
          providerCreatedAt,
          orgId: id,
          providerCustomerRef,
          providerSubscriptionRef: ref(object.subscription),
        };
      } else {
        event = boostEvent(object, providerCreatedAt);
      }
      break;
    }
    // A payment method that settles later (a bank debit) completes the session unpaid and pays it with this event.
    case "checkout.session.async_payment_succeeded":
      event = boostEvent(object, providerCreatedAt);
      break;
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
