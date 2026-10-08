import assert from "node:assert/strict";
import { BillingProviderError } from "../_shared/billing/provider.ts";
import { nullProvider } from "../_shared/billing/providers/null.ts";
import { stripeProvider } from "../_shared/billing/providers/stripe.ts";
import checkoutSession from "./fixtures/stripe/checkout-session-created.json" with { type: "json" };
import noSuchPrice from "./fixtures/stripe/error-no-such-price.json" with { type: "json" };
import rateLimit from "./fixtures/stripe/error-rate-limit.json" with { type: "json" };
import portalSession from "./fixtures/stripe/portal-session-created.json" with { type: "json" };

// The fixtures are the response shapes in Stripe's API reference, not recordings of a live account (none exists yet):
// what they prove is how the adapter reads them, not that Stripe still sends them.
const SITE = "https://app.chara.example";
const BILLING = `${SITE}/en/org/acme/billing`;
const ORG = "7b0f6a53-2d2c-4a43-9b3b-0f5a3f4a1e11";

interface Seen {
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
}

function fetching(response: Response | Error): { fetchFn: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    seen.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      params: Object.fromEntries(new URLSearchParams(init?.body as string)),
    });
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response.clone());
  };
  return { fetchFn, seen };
}

const input = {
  orgId: ORG,
  planCode: "employer_starter",
  priceRef: "price_basic",
  trialDays: 30,
  successUrl: BILLING,
  cancelUrl: BILLING,
};

const failureOf = async (run: () => Promise<unknown>) =>
  await run().then(() => null, (e: unknown) => e as BillingProviderError);

Deno.test("FR-G2 AC8: a checkout session is a subscription with the plan's price, a trial, card required, tax and the organisation", async () => {
  const { fetchFn, seen } = fetching(Response.json(checkoutSession));
  const result = await stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn).createCheckout(input);
  assert.deepEqual(result, { url: checkoutSession.url });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(seen[0].headers.authorization, "Bearer sk_test_x");
  assert.equal(seen[0].headers["content-type"], "application/x-www-form-urlencoded");
  assert.deepEqual(seen[0].params, {
    mode: "subscription",
    "line_items[0][price]": "price_basic",
    "line_items[0][quantity]": "1",
    payment_method_collection: "always",
    client_reference_id: ORG,
    "subscription_data[metadata][org_id]": ORG,
    "subscription_data[trial_period_days]": "30",
    "automatic_tax[enabled]": "true",
    billing_address_collection: "required",
    "tax_id_collection[enabled]": "true",
    success_url: BILLING,
    cancel_url: BILLING,
  });
});

Deno.test("FR-G2 AC8: without a trial the trial field is absent, and nothing asks for card data directly", async () => {
  const { fetchFn, seen } = fetching(Response.json(checkoutSession));
  await stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn).createCheckout({ ...input, trialDays: 0 });
  assert.equal("subscription_data[trial_period_days]" in seen[0].params, false);
  assert.equal(seen[0].params.payment_method_collection, "always");
  assert.equal(Object.keys(seen[0].params).some((key) => /card|payment_method_data/.test(key)), false);
});

Deno.test("FR-G2 AC8: with a customer reference the session belongs to that customer and no customer is created", async () => {
  const { fetchFn, seen } = fetching(Response.json(checkoutSession));
  await stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn).createCheckout({
    ...input,
    customerRef: "cus_1",
  });
  assert.equal(seen.length, 1, "one call, to the session endpoint");
  assert.equal(seen[0].url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(seen[0].params.customer, "cus_1");
  assert.equal(seen[0].params["customer_update[address]"], "auto");
  assert.equal(seen[0].params["customer_update[name]"], "auto");
  assert.equal("customer_creation" in seen[0].params, false);
});

Deno.test("FR-G2 AC8: a return address on another origin throws and no session is created", async () => {
  const { fetchFn, seen } = fetching(Response.json(checkoutSession));
  const provider = stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn);
  for (
    const bad of [{ successUrl: "https://evil.example/en/org/acme/billing" }, {
      cancelUrl: "http://app.chara.example/x",
    }]
  ) {
    const error = await failureOf(() => provider.createCheckout({ ...input, ...bad }));
    assert.equal(error?.code, "foreign_origin");
  }
  const portal = await failureOf(() =>
    provider.createPortal({ customerRef: "cus_1", returnUrl: "https://evil.example/" })
  );
  assert.equal(portal?.code, "foreign_origin");
  assert.equal(seen.length, 0);
});

Deno.test("a checkout sent twice in the same five minutes carries one idempotency key, and another attempt or other parameters another", async () => {
  const { fetchFn, seen } = fetching(Response.json(checkoutSession));
  let clock = Date.UTC(2026, 10, 2, 10, 0, 30);
  const provider = stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn, () => clock);
  await provider.createCheckout(input);
  clock += 60_000;
  await provider.createCheckout(input);
  await provider.createCheckout({ ...input, trialDays: 0 });
  clock += 5 * 60_000;
  await provider.createCheckout(input);
  const keys = seen.map((request) => request.headers["idempotency-key"]);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
  assert.notEqual(keys[0], keys[3], "an identical request after the window is a new attempt, not the earlier session");
  assert.match(keys[0], /^[0-9a-f]{64}$/);
});

Deno.test("a portal request carries no idempotency key, so every click opens a fresh session", async () => {
  const { fetchFn, seen } = fetching(Response.json(portalSession));
  const provider = stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn);
  await provider.createPortal({ customerRef: "cus_1", returnUrl: BILLING });
  await provider.createPortal({ customerRef: "cus_1", returnUrl: BILLING });
  assert.equal(seen.length, 2);
  assert.equal("idempotency-key" in seen[0].headers, false);
  assert.equal("idempotency-key" in seen[1].headers, false);
});

Deno.test("a checkout without a price reference at the provider is refused before any call", async () => {
  const { fetchFn, seen } = fetching(Response.json(checkoutSession));
  const error = await failureOf(() =>
    stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn).createCheckout({ ...input, priceRef: null })
  );
  assert.equal(error?.code, "stripe_price_missing");
  assert.equal(seen.length, 0);
});

Deno.test("the portal session is created for the customer with the billing page as the return address", async () => {
  const { fetchFn, seen } = fetching(Response.json(portalSession));
  const result = await stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn).createPortal({
    customerRef: "cus_Qa1B2c3D4e5F6g",
    returnUrl: BILLING,
  });
  assert.deepEqual(result, { url: portalSession.url });
  assert.equal(seen[0].url, "https://api.stripe.com/v1/billing_portal/sessions");
  assert.deepEqual(seen[0].params, { customer: "cus_Qa1B2c3D4e5F6g", return_url: BILLING });
});

Deno.test("Stripe failures become short codes that hold none of Stripe's text", async () => {
  const cases: [Response, string][] = [
    [Response.json(noSuchPrice, { status: 400 }), "stripe_http_400"],
    [Response.json(rateLimit, { status: 429 }), "stripe_http_429"],
    [new Response("bad gateway", { status: 502 }), "stripe_http_502"],
    [Response.json({ id: "cs_1", url: "http://checkout.stripe.example/x" }), "stripe_bad_response"],
    [Response.json({ id: "cs_1" }), "stripe_bad_response"],
    [new Response("not json"), "stripe_bad_response"],
  ];
  for (const [response, code] of cases) {
    const { fetchFn } = fetching(response);
    const error = await failureOf(() =>
      stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn).createCheckout(input)
    );
    assert.equal(error?.code, code);
    assert.equal(error?.message, code, "the message is the code and nothing else");
  }
  const { fetchFn } = fetching(new TypeError("connection reset by peer"));
  const error = await failureOf(() =>
    stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn).createCheckout(input)
  );
  assert.equal(error?.code, "stripe_network");
});

Deno.test("the null provider answers with hosted addresses that cannot exist, and refuses another origin", async () => {
  const provider = nullProvider(SITE);
  const first = await provider.createCheckout(input);
  const second = await provider.createCheckout(input);
  const url = new URL(first.url);
  assert.equal(url.origin, "https://null-provider.invalid");
  assert.match(url.pathname, /^\/checkout\/null_cs_[0-9a-f-]{36}$/);
  assert.equal(url.searchParams.get("cancel_url"), BILLING);
  assert.equal(url.searchParams.get("success_url"), BILLING);
  assert.notEqual(first.url, second.url);

  const portal = new URL((await provider.createPortal({ customerRef: "cus_1", returnUrl: BILLING })).url);
  assert.equal(portal.pathname, "/portal/cus_1");
  assert.equal(portal.searchParams.get("return_url"), BILLING);
  const error = await failureOf(() => provider.createCheckout({ ...input, successUrl: "https://evil.example/" }));
  assert.equal(error?.code, "foreign_origin");
});
