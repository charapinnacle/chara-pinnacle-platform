import assert from "node:assert/strict";
import { handleBillingCheckout } from "../billing-checkout/handler.ts";
import { type BillingProvider, BillingProviderError, type CheckoutInput } from "../_shared/billing/provider.ts";
import { harness, reply, type Route } from "./harness.ts";

const ORG = "7b0f6a53-2d2c-4a43-9b3b-0f5a3f4a1e11";
const SITE = "https://app.chara.example";
const START = "POST /rest/v1/rpc/billing_checkout_start";
const PORTAL = "POST /rest/v1/rpc/billing_portal_start";

function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${part({ alg: "HS256" })}.${part(claims)}.c2ln`;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const SIGNED_IN = token({ sub: "u1", role: "authenticated", exp: future });
const bearer = (value: string) => ({ authorization: `Bearer ${value}` });

const row = { price_ref: "price_basic", customer_ref: "cus_linked", trial_days: 30, slug: "acme" };
const started = reply(200, [row]);
const database = (message: string, code: string, details: string | null = null) =>
  reply(400, { code, message, details, hint: null });

function providerSpy(options: { fail?: boolean } = {}) {
  const checkouts: CheckoutInput[] = [];
  const portals: { customerRef: string; returnUrl: string }[] = [];
  const provider: BillingProvider = {
    name: "stripe",
    createCheckout(input) {
      checkouts.push(input);
      return options.fail
        ? Promise.reject(new BillingProviderError("stripe_http_400"))
        : Promise.resolve({ url: "https://checkout.stripe.com/c/pay/cs_1", providerRef: "cs_1" });
    },
    createPortal(input) {
      portals.push(input);
      return options.fail
        ? Promise.reject(new BillingProviderError("stripe_http_400"))
        : Promise.resolve({ url: "https://billing.stripe.com/p/session/s_1" });
    },
  };
  return { provider, checkouts, portals };
}

const checkoutBody = {
  action: "checkout",
  orgId: ORG,
  planCode: "employer_starter",
  billingCountry: "DE",
  vatId: "DE123456789",
  registrationNumber: "HRB 12345",
  termsVersion: 2,
  disclosedTrialDays: 30,
};

function run(
  body: unknown,
  routes: Record<string, Route | Response>,
  headers: Record<string, string> = bearer(SIGNED_IN),
  spy = providerSpy(),
  method = "POST",
) {
  const database = harness(routes);
  const seen: string[] = [];
  const request = new Request("http://stack.test/functions/v1/billing-checkout", {
    method,
    headers,
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const response = handleBillingCheckout(request, {
    userClient: (authorization) => {
      seen.push(authorization);
      return database.client;
    },
    provider: spy.provider,
    siteUrl: SITE,
  });
  return { database, spy, seen, response };
}

Deno.test("FR-G2 AC9: a request without a signed-in person's token calls neither the database nor the provider: 401", async () => {
  const tokens: Record<string, string>[] = [
    {},
    { authorization: "" },
    { authorization: "Bearer sb_publishable_abc" },
    bearer(token({ sub: "u1", role: "authenticated", exp: Math.floor(Date.now() / 1000) - 60 })),
    bearer(token({ role: "anon", exp: future })),
    bearer(token({ sub: "u1", role: "authenticated" })),
    { authorization: `Basic ${SIGNED_IN}` },
    bearer("not.a-json.token"),
  ];
  for (const headers of tokens) {
    const { database, spy, seen, response } = run(checkoutBody, { [START]: started }, headers);
    const result = await response;
    assert.equal(result.status, 401, JSON.stringify(headers));
    assert.deepEqual(await result.json(), { error: "unauthorized" });
    assert.deepEqual([database.calls.length, spy.checkouts.length, seen.length], [0, 0, 0]);
  }
});

Deno.test("FR-G2 AC9: a valid request runs the start with the caller's token, ignores references in the body and answers with the address only", async () => {
  const body = {
    ...checkoutBody,
    customerRef: "cus_attacker",
    successUrl: "https://evil.example/ok",
    cancelUrl: "https://evil.example/no",
    priceRef: "price_cheap",
    trialDays: 365,
  };
  const { database, spy, seen, response } = run(body, { [START]: started });
  const result = await response;
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), { url: "https://checkout.stripe.com/c/pay/cs_1" });
  assert.deepEqual(seen, [`Bearer ${SIGNED_IN}`], "the start runs with the caller's own token");
  assert.deepEqual(database.calls.map((c) => [c.method, c.path]), [["POST", "/rest/v1/rpc/billing_checkout_start"]]);
  assert.deepEqual(database.calls[0].body, {
    p_org: ORG,
    p_plan_code: "employer_starter",
    p_billing_country: "DE",
    p_vat_id: "DE123456789",
    p_registration_number: "HRB 12345",
    p_terms_version: 2,
    p_provider: "stripe",
    p_disclosed_trial_days: 30,
  });
  assert.deepEqual(spy.checkouts, [{
    orgId: ORG,
    planCode: "employer_starter",
    priceRef: "price_basic",
    trialDays: 30,
    successUrl: `${SITE}/en/org/acme/billing`,
    cancelUrl: `${SITE}/en/org/acme/billing`,
    customerRef: "cus_linked",
  }]);
});

Deno.test("an organisation without a linked customer starts a checkout with no customer reference", async () => {
  const { spy, response } = run(checkoutBody, { [START]: reply(200, [{ ...row, customer_ref: null, trial_days: 0 }]) });
  assert.equal((await response).status, 200);
  assert.equal(spy.checkouts[0].customerRef, undefined);
  assert.equal(spy.checkouts[0].trialDays, 0);
});

Deno.test("FR-G2 AC9: when the provider fails the answer is 502 with a generic message", async () => {
  const { spy, response } = run(checkoutBody, { [START]: started }, bearer(SIGNED_IN), providerSpy({ fail: true }));
  const result = await response;
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { error: "unavailable" });
  assert.equal(spy.checkouts.length, 1);
});

Deno.test("refusals of the database are told apart, with a reason only from the known list", async () => {
  const cases: [Response, number, Record<string, unknown>][] = [
    [database("CHARA_FORBIDDEN", "P0001", "aal2_required"), 403, { error: "forbidden", reason: "aal2_required" }],
    [database("CHARA_FORBIDDEN", "P0001", "terms_version_mismatch"), 403, {
      error: "forbidden",
      reason: "terms_version_mismatch",
    }],
    [database("CHARA_FORBIDDEN", "P0001", "trial_changed"), 403, { error: "forbidden", reason: "trial_changed" }],
    [database("CHARA_FORBIDDEN", "P0001", "something internal"), 403, { error: "forbidden", reason: null }],
    [database("CHARA_FORBIDDEN", "P0001"), 403, { error: "forbidden", reason: null }],
    [database("CHARA_INVALID_INPUT", "22023", "vat_id"), 400, { error: "bad_request", field: "vat_id" }],
    [database("CHARA_INVALID_INPUT", "22023", "billing_country"), 400, {
      error: "bad_request",
      field: "billing_country",
    }],
    [database("CHARA_INVALID_INPUT", "22023", "a table name"), 400, { error: "bad_request", field: null }],
    [database("permission denied for function billing_checkout_start", "42501"), 401, { error: "unauthorized" }],
    [database("JWT expired", "PGRST303"), 401, { error: "unauthorized" }],
    [database("CHARA_UNAVAILABLE", "P0001", "plan_not_synced"), 502, { error: "unavailable" }],
    [database("deadlock detected", "40P01"), 502, { error: "unavailable" }],
  ];
  for (const [failure, status, expected] of cases) {
    const { spy, response } = run(checkoutBody, { [START]: failure });
    const result = await response;
    assert.equal(result.status, status);
    assert.deepEqual(await result.json(), expected);
    assert.equal(spy.checkouts.length, 0, "no session is created after a refusal");
  }
});

Deno.test("a malformed request is refused before the database is asked", async () => {
  const malformed: unknown[] = [
    "not json{",
    { ...checkoutBody, orgId: "not-a-uuid" },
    { ...checkoutBody, action: "refund" },
    { ...checkoutBody, planCode: 7 },
    { ...checkoutBody, billingCountry: undefined },
    { ...checkoutBody, vatId: "D".repeat(65) },
    { ...checkoutBody, termsVersion: "2" },
    { ...checkoutBody, termsVersion: -1 },
    { ...checkoutBody, disclosedTrialDays: 1.5 },
    [checkoutBody],
  ];
  for (const body of malformed) {
    const { database, spy, response } = run(body, { [START]: started });
    const result = await response;
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.deepEqual(await result.json(), { error: "bad_request", field: null });
    assert.deepEqual([database.calls.length, spy.checkouts.length], [0, 0]);
  }
  const wrongMethod = await run(null, { [START]: started }, bearer(SIGNED_IN), providerSpy(), "GET").response;
  assert.equal(wrongMethod.status, 405);
});

Deno.test("optional fields may be absent: the identifiers and the disclosed trial length", async () => {
  const { database, response } = run(
    { ...checkoutBody, vatId: undefined, registrationNumber: null, disclosedTrialDays: undefined },
    { [START]: started },
  );
  assert.equal((await response).status, 200);
  const args = database.calls[0].body as Record<string, unknown>;
  assert.equal(args.p_vat_id, null);
  assert.equal(args.p_registration_number, null);
  assert.equal(args.p_disclosed_trial_days, null);
});

Deno.test("FR-G2 AC10: the portal runs with the caller's token and goes to the customer the database names", async () => {
  const body = { action: "portal", orgId: ORG, customerRef: "cus_attacker", returnUrl: "https://evil.example/" };
  const { database, spy, seen, response } = run(body, {
    [PORTAL]: reply(200, [{ customer_ref: "cus_linked", slug: "acme" }]),
  });
  const result = await response;
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { url: "https://billing.stripe.com/p/session/s_1" });
  assert.deepEqual(seen, [`Bearer ${SIGNED_IN}`]);
  assert.deepEqual(database.calls.map((c) => [c.path, c.body]), [["/rest/v1/rpc/billing_portal_start", {
    p_org: ORG,
  }]]);
  assert.deepEqual(spy.portals, [{ customerRef: "cus_linked", returnUrl: `${SITE}/en/org/acme/billing` }]);
});

Deno.test("a portal without a customer is refused with its reason, and a provider failure is generic", async () => {
  const none = run({ action: "portal", orgId: ORG }, { [PORTAL]: database("CHARA_FORBIDDEN", "P0001", "no_customer") });
  const refused = await none.response;
  assert.equal(refused.status, 403);
  assert.deepEqual(await refused.json(), { error: "forbidden", reason: "no_customer" });
  assert.equal(none.spy.portals.length, 0);

  const failing = run(
    { action: "portal", orgId: ORG },
    { [PORTAL]: reply(200, [{ customer_ref: "cus_linked", slug: "acme" }]) },
    bearer(SIGNED_IN),
    providerSpy({ fail: true }),
  );
  const failed = await failing.response;
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: "unavailable" });
});
