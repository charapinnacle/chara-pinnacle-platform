import { assertAppOrigin, type BillingProvider, BillingProviderError, type CheckoutInput } from "../provider.ts";

const API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 15_000;

function checkoutParams(input: CheckoutInput & { priceRef: string }): URLSearchParams {
  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": input.priceRef,
    "line_items[0][quantity]": "1",
    payment_method_collection: "always",
    client_reference_id: input.orgId,
    "subscription_data[metadata][org_id]": input.orgId,
    "automatic_tax[enabled]": "true",
    billing_address_collection: "required",
    "tax_id_collection[enabled]": "true",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  if (input.trialDays > 0) {
    params.set("subscription_data[trial_period_days]", String(input.trialDays));
  }
  if (input.customerRef) {
    params.set("customer", input.customerRef);
    // Stripe refuses automatic tax and tax ID collection for an existing customer unless the address and the name may
    // be updated from the checkout.
    params.set("customer_update[address]", "auto");
    params.set("customer_update[name]", "auto");
  }
  return params;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function stripeProvider(
  config: { secretKey: string; siteUrl: string },
  fetchFn: typeof fetch = fetch,
): BillingProvider {
  // The same parameters give the same idempotency key, so a request sent twice creates one session.
  async function post(path: string, params: URLSearchParams): Promise<{ id: string; url: string }> {
    const body = params.toString();
    let response: Response;
    try {
      response = await fetchFn(`${API}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.secretKey}`,
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": await sha256Hex(`${path}?${body}`),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BillingProviderError("stripe_network");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new BillingProviderError(`stripe_http_${response.status}`);
    }
    const { id, url } = (await response.json().catch(() => ({}))) as { id?: unknown; url?: unknown };
    if (typeof id !== "string" || typeof url !== "string" || !url.startsWith("https://")) {
      throw new BillingProviderError("stripe_bad_response");
    }
    return { id, url };
  }

  return {
    name: "stripe",
    async createCheckout(input) {
      if (!input.priceRef) {
        throw new BillingProviderError("stripe_price_missing");
      }
      assertAppOrigin(config.siteUrl, input.successUrl, input.cancelUrl);
      const session = await post("/checkout/sessions", checkoutParams({ ...input, priceRef: input.priceRef }));
      return { url: session.url, providerRef: session.id };
    },
    async createPortal(input) {
      assertAppOrigin(config.siteUrl, input.returnUrl);
      const session = await post(
        "/billing_portal/sessions",
        new URLSearchParams({ customer: input.customerRef, return_url: input.returnUrl }),
      );
      return { url: session.url };
    },
  };
}
