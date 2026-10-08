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

export interface BillingProvider {
  readonly name: "null" | "stripe";
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
  createPortal(input: { customerRef: string; returnUrl: string }): Promise<{ url: string }>;
}

export class BillingProviderError extends Error {
  // A short code that is safe to log: it never holds the provider's text.
  constructor(readonly code: string) {
    super(code);
  }
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
