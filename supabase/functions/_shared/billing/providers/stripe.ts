import { isObject } from "../../http.ts";
import {
  assertAppOrigin,
  type BillingProvider,
  BillingProviderError,
  type CheckoutInput,
  type PaymentCheckoutInput,
  type PriceInput,
  type SubscriptionState,
  type WebhookVerification,
} from "../provider.ts";
import { hmacMatches } from "../signature.ts";
import { fetchedSubscriptionEvent, normalizeStripeEvent, subscriptionState } from "./stripe-events.ts";

const API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 15_000;
const IDEMPOTENCY_WINDOW_MS = 5 * 60_000;
// Stripe's own tolerance for the age of a signed delivery, which also bounds a replay.
const SIGNATURE_TOLERANCE_SECONDS = 300;
// Stripe signs with the current and, while a secret is rotated, the previous secret; more values are an attempt to make us hash the body again and again.
const MAX_SIGNATURES = 3;
const PAGE_SIZE = 100;
const SUBSCRIPTION_REF = /^sub_[A-Za-z0-9]+$/;
const PORTAL_CONFIGURATION = /^bpc_[A-Za-z0-9]+$/;
const PRODUCT_REF = /^prod_[A-Za-z0-9]+$/;
const PRICE_REF = /^price_[A-Za-z0-9]+$/;
const METADATA_KEY = /^[a-z_]{1,40}$/;
const SKU = /^[a-z0-9_]{1,64}$/;
const CURRENCY = /^[A-Z]{3}$/;

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

// A boost is a one-time payment of an amount the product row holds, so the session carries an inline price (no Stripe
// product to sync). The purpose, the organisation and the product are put on the session and on the payment intent, which
// is how normalizeStripeEvent recognises a paid boost; a customer is created when the organisation has none, so the tax
// IDs collected and the invoice belong to one.
function paymentCheckoutParams(input: PaymentCheckoutInput): URLSearchParams {
  const params = new URLSearchParams({
    mode: "payment",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(input.amountMinor),
    "line_items[0][price_data][tax_behavior]": "exclusive",
    "line_items[0][price_data][product_data][name]": input.productName,
    "line_items[0][quantity]": "1",
    client_reference_id: input.orgId,
    "metadata[purpose]": "boost",
    "metadata[org_id]": input.orgId,
    "metadata[sku]": input.sku,
    "payment_intent_data[metadata][purpose]": "boost",
    "payment_intent_data[metadata][org_id]": input.orgId,
    "payment_intent_data[metadata][sku]": input.sku,
    "automatic_tax[enabled]": "true",
    billing_address_collection: "required",
    "tax_id_collection[enabled]": "true",
    "invoice_creation[enabled]": "true",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  if (input.customerRef) {
    params.set("customer", input.customerRef);
    params.set("customer_update[address]", "auto");
    params.set("customer_update[name]", "auto");
  } else {
    params.set("customer_creation", "always");
  }
  return params;
}

// Prices are exclusive of VAT, as the prices of scripts/sync-stripe-plans.mjs, so Stripe Tax adds the VAT at checkout.
function priceParams(input: PriceInput & { productRef: string }): URLSearchParams {
  const params = new URLSearchParams({
    product: input.productRef,
    unit_amount: String(input.amountMinor),
    currency: input.currency.toLowerCase(),
    "recurring[interval]": input.interval,
    tax_behavior: "exclusive",
  });
  for (const [key, value] of Object.entries(input.metadata)) {
    params.set(`metadata[${key}]`, value);
  }
  return params;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Stripe-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body">,... (several v1 while a secret is rotated).
async function verifyStripeSignature(
  req: Request,
  rawBody: string,
  secret: string | undefined,
  nowSeconds: number,
): Promise<WebhookVerification> {
  if (!secret) {
    return { ok: false, reason: "not_configured" };
  }
  const header = req.headers.get("stripe-signature");
  if (!header) {
    return { ok: false, reason: "missing_signature" };
  }
  const entries = header.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = entries.find(([key]) => key === "t")?.[1] ?? "";
  const signatures = entries.filter(([key, value]) => key === "v1" && value).map(([, value]) => value);
  if (!/^[0-9]{1,12}$/.test(timestamp) || signatures.length === 0 || signatures.length > MAX_SIGNATURES) {
    return { ok: false, reason: "malformed_signature" };
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp_outside_tolerance" };
  }
  const signed = `${timestamp}.${rawBody}`;
  let valid = false;
  for (const signature of signatures) {
    valid = await hmacMatches(secret, signed, signature) || valid;
  }
  if (!valid) {
    return { ok: false, reason: "signature_mismatch" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
  const eventId = isObject(payload) ? payload.id : undefined;
  const type = isObject(payload) ? payload.type : undefined;
  if (typeof eventId !== "string" || eventId === "" || eventId.length > 255 || typeof type !== "string") {
    return { ok: false, reason: "invalid_payload" };
  }
  return { ok: true, eventId, type, payload };
}

export function stripeProvider(
  config: { secretKey: string; siteUrl: string; webhookSecret?: string },
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): BillingProvider {
  // A checkout carries a key made of its parameters and the current five minutes, so a double submit creates one
  // session while a later attempt is never answered with an earlier session that has since been completed or has
  // expired (Stripe keeps a key for 24 hours). A portal session is short-lived and has no side effect worth
  // deduplicating, so it carries no key.
  async function call(init: RequestInit, path: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetchFn(`${API}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${config.secretKey}`, ...init.headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BillingProviderError("stripe_network");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new BillingProviderError(`stripe_http_${response.status}`);
    }
    const body: unknown = await response.json().catch(() => null);
    if (!isObject(body)) {
      throw new BillingProviderError("stripe_bad_response");
    }
    return body;
  }

  async function postForm(
    path: string,
    params: URLSearchParams,
    idempotent: boolean,
  ): Promise<Record<string, unknown>> {
    const body = params.toString();
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    if (idempotent) {
      headers["idempotency-key"] = await sha256Hex(`${path}?${body}#${Math.floor(now() / IDEMPOTENCY_WINDOW_MS)}`);
    }
    return await call({ method: "POST", headers, body }, path);
  }

  async function post(path: string, params: URLSearchParams, idempotent: boolean): Promise<{ url: string }> {
    const { url } = await postForm(path, params, idempotent);
    if (typeof url !== "string" || !url.startsWith("https://")) {
      throw new BillingProviderError("stripe_bad_response");
    }
    return { url };
  }

  return {
    name: "stripe",
    async createCheckout(input) {
      if (!input.priceRef) {
        throw new BillingProviderError("stripe_price_missing");
      }
      assertAppOrigin(config.siteUrl, input.successUrl, input.cancelUrl);
      return await post("/checkout/sessions", checkoutParams({ ...input, priceRef: input.priceRef }), true);
    },
    async createPaymentCheckout(input) {
      if (
        !SKU.test(input.sku) || !CURRENCY.test(input.currency) || !Number.isInteger(input.amountMinor) ||
        input.amountMinor <= 0 || input.productName === "" || input.productName.length > 120
      ) {
        throw new BillingProviderError("stripe_bad_payment_input");
      }
      assertAppOrigin(config.siteUrl, input.successUrl, input.cancelUrl);
      return await post("/checkout/sessions", paymentCheckoutParams(input), true);
    },
    async createPortal(input) {
      assertAppOrigin(config.siteUrl, input.returnUrl);
      const params = new URLSearchParams({ customer: input.customerRef, return_url: input.returnUrl });
      if (input.configuration !== undefined) {
        if (!PORTAL_CONFIGURATION.test(input.configuration)) {
          throw new BillingProviderError("stripe_bad_configuration");
        }
        params.set("configuration", input.configuration);
      }
      return await post("/billing_portal/sessions", params, false);
    },
    // Carries the idempotency key of a checkout, so a double submit within five minutes creates one price.
    async createPrice(input) {
      if (!input.productRef) {
        throw new BillingProviderError("stripe_product_missing");
      }
      if (
        !PRODUCT_REF.test(input.productRef) || !Number.isInteger(input.amountMinor) || input.amountMinor <= 0 ||
        !Object.keys(input.metadata).every((key) => METADATA_KEY.test(key))
      ) {
        throw new BillingProviderError("stripe_bad_price_input");
      }
      const { id } = await postForm("/prices", priceParams({ ...input, productRef: input.productRef }), true);
      if (typeof id !== "string" || !PRICE_REF.test(id)) {
        throw new BillingProviderError("stripe_bad_response");
      }
      return { priceRef: id };
    },
    verifyWebhook(req, rawBody) {
      return verifyStripeSignature(req, rawBody, config.webhookSecret, Math.floor(now() / 1000));
    },
    normalize: normalizeStripeEvent,
    async fetchSubscription(providerSubscriptionRef, fetchedAt) {
      if (!SUBSCRIPTION_REF.test(providerSubscriptionRef)) {
        throw new BillingProviderError("stripe_bad_reference");
      }
      return fetchedSubscriptionEvent(
        await call({ method: "GET" }, `/subscriptions/${providerSubscriptionRef}`),
        fetchedAt,
      );
    },
    async listSubscriptions(startingAfter) {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (startingAfter) {
        query.set("starting_after", startingAfter);
      }
      const page = await call({ method: "GET" }, `/subscriptions?${query}`);
      const data = Array.isArray(page.data) ? page.data.filter(isObject) : [];
      const subscriptions = data.map(subscriptionState).filter((state): state is SubscriptionState => state !== null);
      const last = data.at(-1)?.id;
      return { subscriptions, next: page.has_more === true && typeof last === "string" ? last : null };
    },
  };
}
