export interface CheckoutInput {
  orgId: string;
  planCode: string;
  // The price at the provider (billing.plan_provider_refs); the null provider has none.
  priceRef: string | null;
  // 0 starts the subscription without a trial.
  trialDays: number;
  successUrl: string;
  cancelUrl: string;
  customerRef?: string;
}

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "paused";

// Every event carries providerCreatedAt, the time the provider created it, which the database compares with the state it
// holds to find an event that arrived late. An event names its organisation (orgId, taken from the metadata that
// billing_checkout_start put on the Checkout session and the subscription); an event without one is resolved by the
// database through the customer or the subscription reference.
export type NormalizedEvent =
  & { providerCreatedAt: string }
  & (
    | { kind: "checkout.completed"; orgId: string; providerCustomerRef: string; providerSubscriptionRef?: string }
    | {
      kind: "subscription.activated" | "subscription.updated" | "subscription.canceled";
      orgId?: string;
      providerCustomerRef?: string;
      // The plan code of the Stripe price metadata; absent when the price has none.
      planCode?: string;
      status: SubscriptionStatus;
      providerSubscriptionRef: string;
      currentPeriodStart?: string;
      currentPeriodEnd?: string;
      trialEndsAt?: string;
      cancelAt?: string;
    }
    | {
      kind: "subscription.trial_will_end";
      orgId?: string;
      providerCustomerRef?: string;
      providerSubscriptionRef: string;
      trialEndsAt: string;
    }
    | {
      kind: "payment.succeeded";
      purpose: "subscription";
      orgId?: string;
      providerCustomerRef?: string;
      providerSubscriptionRef: string;
      // An invoice carries no subscription status: a paid amount means the subscription is paying, a zero amount is the
      // invoice of a trial, which leaves Trialing as it is.
      subscriptionStatus: "active" | "trialing";
      amountMinor: number;
      taxMinor: number;
      currency: string;
      invoiceRef: string;
      providerPaymentRef: string;
    }
    | {
      kind: "payment.failed";
      orgId?: string;
      providerCustomerRef?: string;
      providerSubscriptionRef: string;
      providerPaymentRef: string;
    }
  );

export const EVENT_KINDS: readonly NormalizedEvent["kind"][] = [
  "checkout.completed",
  "subscription.activated",
  "subscription.updated",
  "subscription.canceled",
  "subscription.trial_will_end",
  "payment.succeeded",
  "payment.failed",
];

// A subscription as the provider holds it now, for the weekly comparison with the records.
export interface SubscriptionState {
  providerSubscriptionRef: string;
  planCode?: string;
  status: SubscriptionStatus;
}

// The reasons are fixed words: they are written to the audit log and never contain anything the caller sent.
export type RejectReason =
  | "not_configured"
  | "missing_signature"
  | "malformed_signature"
  | "timestamp_outside_tolerance"
  | "signature_mismatch"
  | "invalid_payload";

export type WebhookVerification =
  | { ok: true; eventId: string; type: string; payload: unknown }
  | { ok: false; reason: RejectReason };

export interface BillingProvider {
  readonly name: "null" | "stripe";
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
  createPortal(input: { customerRef: string; returnUrl: string }): Promise<{ url: string }>;
  // Checks the signature against the raw body, before anything in the body is read.
  verifyWebhook(req: Request, rawBody: string): Promise<WebhookVerification>;
  // Empty for a type CHARA does not use; one event for the types it does.
  normalize(payload: unknown): NormalizedEvent[];
  // The current state of a subscription, as an event created now, for an event that arrived out of order. Null when
  // the provider has nothing to fetch.
  fetchSubscription(providerSubscriptionRef: string, fetchedAt: Date): Promise<NormalizedEvent | null>;
  // One page of the subscriptions that are not canceled, for the weekly comparison.
  listSubscriptions(startingAfter?: string): Promise<{ subscriptions: SubscriptionState[]; next: string | null }>;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class BillingProviderError extends Error {
  // A short code that is safe to log: it never holds the provider's text.
  constructor(readonly code: string) {
    super(code);
  }
}

// The code of a failure, for a log line or an alert: a short word of letters, digits and underscores, or "unknown". The
// message of an error can hold the provider's text, which can name a person, so it is never used.
export function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : "unknown";
}

// The return addresses are built by the function from its own site address; an adapter still refuses any other
// origin, so that a caller of the adapter cannot make the provider send a customer elsewhere.
export function assertAppOrigin(siteUrl: string, ...urls: string[]): void {
  const origin = new URL(siteUrl).origin;
  for (const url of urls) {
    if (new URL(url).origin !== origin) {
      throw new BillingProviderError("foreign_origin");
    }
  }
}
