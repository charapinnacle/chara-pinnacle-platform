import assert from "node:assert/strict";
import { BillingProviderError, type PriceInput } from "../_shared/billing/provider.ts";
import { nullProvider } from "../_shared/billing/providers/null.ts";
import { stripeProvider } from "../_shared/billing/providers/stripe.ts";
import priceCreated from "./fixtures/stripe/price-created.json" with { type: "json" };
import rateLimit from "./fixtures/stripe/error-rate-limit.json" with { type: "json" };

// The fixture is the response shape of Stripe's API reference, not a recording of a live account (none exists yet).
const SITE = "https://app.chara.example";

const input: PriceInput = {
  productRef: "prod_RecruitmentPartner",
  amountMinor: 5400,
  currency: "EUR",
  interval: "month",
  metadata: { plan_code: "recruitment_partner" },
};

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  params: Record<string, string>;
}

function fetching(response: Response | Error): { fetchFn: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFn: typeof fetch = (url, init) => {
    seen.push({
      url: String(url),
      method: String(init?.method),
      headers: init?.headers as Record<string, string>,
      params: Object.fromEntries(new URLSearchParams(init?.body as string)),
    });
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response.clone());
  };
  return { fetchFn, seen };
}

const failureOf = async (run: () => Promise<unknown>) =>
  await run().then(() => null, (e: unknown) => e as BillingProviderError);

Deno.test("FR-R2 AC8: Stripe creates one new monthly EUR price, exclusive of VAT, on the plan's product with the plan code", async () => {
  const { fetchFn, seen } = fetching(Response.json(priceCreated));
  const result = await stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn).createPrice(input);
  assert.deepEqual(result, { priceRef: "price_1QaBcDeFgHiJkLmN" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.stripe.com/v1/prices");
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].headers.authorization, "Bearer sk_test_x");
  assert.deepEqual(seen[0].params, {
    product: "prod_RecruitmentPartner",
    unit_amount: "5400",
    currency: "eur",
    "recurring[interval]": "month",
    tax_behavior: "exclusive",
    "metadata[plan_code]": "recruitment_partner",
  });
});

Deno.test("FR-R2 AC8: the price call touches no subscription and archives no price", async () => {
  const { fetchFn, seen } = fetching(Response.json(priceCreated));
  await stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn).createPrice(input);
  assert.equal(seen.every((call) => call.url === "https://api.stripe.com/v1/prices"), true);
  assert.equal(Object.keys(seen[0].params).some((key) => /active|subscription|archive/.test(key)), false);
});

Deno.test("a price sent twice in the same five minutes carries one idempotency key; another amount carries another", async () => {
  const { fetchFn, seen } = fetching(Response.json(priceCreated));
  const clock = Date.UTC(2026, 10, 28, 10, 0, 30);
  const provider = stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn, () => clock);
  await provider.createPrice(input);
  await provider.createPrice(input);
  await provider.createPrice({ ...input, amountMinor: 5500 });
  const keys = seen.map((call) => call.headers["idempotency-key"]);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
  assert.match(keys[0], /^[0-9a-f]{64}$/);
});

Deno.test("a price without a product, with a malformed product, amount or metadata key is refused before any call", async () => {
  const cases: [PriceInput, string][] = [
    [{ ...input, productRef: null }, "stripe_product_missing"],
    [{ ...input, productRef: "prod_x&unit_amount=1" }, "stripe_bad_price_input"],
    [{ ...input, productRef: "price_123" }, "stripe_bad_price_input"],
    [{ ...input, amountMinor: 0 }, "stripe_bad_price_input"],
    [{ ...input, amountMinor: 54.5 }, "stripe_bad_price_input"],
    [{ ...input, metadata: { "plan_code][x": "y" } }, "stripe_bad_price_input"],
  ];
  for (const [price, code] of cases) {
    const { fetchFn, seen } = fetching(Response.json(priceCreated));
    const error = await failureOf(() =>
      stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn).createPrice(price)
    );
    assert.equal(error?.code, code, JSON.stringify(price));
    assert.equal(seen.length, 0);
  }
});

Deno.test("Stripe price failures become short codes without Stripe's text", async () => {
  const cases: [Response | Error, string][] = [
    [Response.json(rateLimit, { status: 429 }), "stripe_http_429"],
    [Response.json({ id: "prod_1" }), "stripe_bad_response"],
    [Response.json({ object: "price" }), "stripe_bad_response"],
    [new TypeError("connection reset by peer"), "stripe_network"],
  ];
  for (const [response, code] of cases) {
    const { fetchFn } = fetching(response);
    const error = await failureOf(() =>
      stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn).createPrice(input)
    );
    assert.equal(error?.code, code);
    assert.equal(error?.message, code);
  }
});

Deno.test("the null provider holds no prices: it answers without a reference and calls nothing", async () => {
  assert.deepEqual(await nullProvider(SITE).createPrice(input), { priceRef: null });
  assert.deepEqual(await nullProvider(SITE).createPrice({ ...input, productRef: null }), { priceRef: null });
});
