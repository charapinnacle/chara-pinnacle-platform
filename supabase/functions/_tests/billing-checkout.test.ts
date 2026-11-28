import assert from "node:assert/strict";
import { handleBillingCheckout, type PortalConfigurations } from "../billing-checkout/handler.ts";
import {
  type BillingProvider,
  BillingProviderError,
  type CheckoutInput,
  type PaymentCheckoutInput,
} from "../_shared/billing/provider.ts";
import { harness, reply, type Route } from "./harness.ts";

const ORG = "7b0f6a53-2d2c-4a43-9b3b-0f5a3f4a1e11";
const SITE = "https://app.chara.example";
const START = "POST /rest/v1/rpc/billing_checkout_start";
const PORTAL = "POST /rest/v1/rpc/billing_portal_start";
const BOOST = "POST /rest/v1/rpc/billing_boost_checkout_start";
const AUDIT = "POST /rest/v1/rpc/billing_record_worker_attempt";
const USER = "3f1c2a54-8d7e-4c1b-9a60-2b5d6e7f8a90";

function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${part({ alg: "HS256" })}.${part(claims)}.c2ln`;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const SIGNED_IN = token({ sub: "u1", role: "authenticated", exp: future });
const bearer = (value: string) => ({ authorization: `Bearer ${value}` });
const AS_USER = bearer(token({ sub: USER, role: "authenticated", exp: future }));

const row = { price_ref: "price_basic", customer_ref: "cus_linked", trial_days: 30, slug: "acme" };
const started = reply(200, [row]);
const database = (message: string, code: string, details: string | null = null) =>
  reply(400, { code, message, details, hint: null });

function providerSpy(options: { fail?: boolean; name?: "null" | "stripe" } = {}) {
  const checkouts: CheckoutInput[] = [];
  const payments: PaymentCheckoutInput[] = [];
  const portals: { customerRef: string; returnUrl: string; configuration?: string }[] = [];
  const provider: Pick<BillingProvider, "name" | "createCheckout" | "createPaymentCheckout" | "createPortal"> = {
    name: options.name ?? "stripe",
    createCheckout(input) {
      checkouts.push(input);
      return options.fail
        ? Promise.reject(new BillingProviderError("stripe_http_400"))
        : Promise.resolve({ url: "https://checkout.stripe.com/c/pay/cs_1" });
    },
    createPaymentCheckout(input) {
      payments.push(input);
      return options.fail
        ? Promise.reject(new BillingProviderError("stripe_http_400"))
        : Promise.resolve({ url: "https://checkout.stripe.com/c/pay/cs_boost" });
    },
    createPortal(input) {
      portals.push(input);
      return options.fail
        ? Promise.reject(new BillingProviderError("stripe_http_400"))
        : Promise.resolve({ url: "https://billing.stripe.com/p/session/s_1" });
    },
  };
  return { provider, checkouts, payments, portals };
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
  auditReply: Response = reply(200, true),
  portalConfigurations: PortalConfigurations = {},
) {
  const database = harness(routes);
  const audit = harness({ [AUDIT]: auditReply });
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
    serviceClient: audit.client,
    provider: spy.provider,
    siteUrl: SITE,
    portalConfigurations,
  });
  return { database, audit, spy, seen, response };
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
  const { spy, response } = run({ ...checkoutBody, disclosedTrialDays: 0 }, {
    [START]: reply(200, [{ ...row, customer_ref: null, trial_days: 0 }]),
  });
  assert.equal((await response).status, 200);
  assert.equal(spy.checkouts[0].customerRef, undefined);
  assert.equal(spy.checkouts[0].trialDays, 0);
});

Deno.test("FR-G2 AC9: when the provider fails the answer is 502 with a generic message", async () => {
  const { database, spy, response } = run(
    checkoutBody,
    { [START]: started },
    bearer(SIGNED_IN),
    providerSpy({ fail: true }),
  );
  const result = await response;
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { error: "unavailable" });
  assert.equal(spy.checkouts.length, 1);
  // Departure D67: the start (customer, consent, audit row) is committed before the provider is called, so a failed
  // session leaves them; the customer row holds no reference and does not lock the identifier (pgTAP 082).
  assert.equal(database.calls.length, 1);
});

Deno.test("FR-G2 AC2: when the trial that applies differs from the one shown, the answer is 409 and no session is created", async () => {
  for (const [disclosed, applies] of [[30, 0], [0, 30], [14, 30]]) {
    const { spy, response } = run(
      { ...checkoutBody, disclosedTrialDays: disclosed },
      { [START]: reply(200, [{ ...row, trial_days: applies }]) },
    );
    const result = await response;
    assert.equal(result.status, 409);
    assert.deepEqual(await result.json(), { error: "trial_changed", reason: "trial_changed" });
    assert.equal(spy.checkouts.length, 0);
  }
  const { spy, response } = run(
    { ...checkoutBody, disclosedTrialDays: 0 },
    { [START]: reply(200, [{ ...row, trial_days: 0 }]) },
  );
  assert.equal((await response).status, 200);
  assert.equal(spy.checkouts[0].trialDays, 0);
});

Deno.test("refusals of the database are told apart, with a reason only from the known list", async () => {
  const cases: [Response, number, Record<string, unknown>][] = [
    [database("CHARA_FORBIDDEN", "P0001", "aal2_required"), 403, { error: "forbidden", reason: "aal2_required" }],
    [database("CHARA_FORBIDDEN", "P0001", "terms_version_mismatch"), 403, {
      error: "forbidden",
      reason: "terms_version_mismatch",
    }],
    [database("CHARA_FORBIDDEN", "42501", "plan_not_for_org_type"), 403, {
      error: "forbidden",
      reason: "plan_not_for_org_type",
    }],
    [database("CHARA_FORBIDDEN", "42501", "release_off"), 403, { error: "forbidden", reason: null }],
    [database("CHARA_FORBIDDEN", "P0001", "provider_mismatch"), 403, { error: "forbidden", reason: null }],
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
    const { audit, spy, response } = run(checkoutBody, { [START]: failure });
    const result = await response;
    assert.equal(result.status, status);
    assert.deepEqual(await result.json(), expected);
    assert.equal(spy.checkouts.length, 0, "no session is created after a refusal");
    assert.equal(audit.calls.length, 0, "only a worker's attempt is recorded");
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
    { ...checkoutBody, termsVersion: 1_000_001 },
    { ...checkoutBody, termsVersion: 2_147_483_648 },
    { ...checkoutBody, disclosedTrialDays: 366 },
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
    [PORTAL]: reply(200, [{ customer_ref: "cus_linked", slug: "acme", organization_type: "employer" }]),
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

const CONFIGURATIONS: PortalConfigurations = {
  employer: "bpc_employer",
  recruitment_company: "bpc_recruitment",
  staffing_company: "bpc_staffing",
};
const portalRow = (type: string) => reply(200, [{ customer_ref: "cus_linked", slug: "acme", organization_type: type }]);
const openPortal = (type: string, configurations: PortalConfigurations, spy = providerSpy()) =>
  run(
    { action: "portal", orgId: ORG },
    { [PORTAL]: portalRow(type) },
    bearer(SIGNED_IN),
    spy,
    "POST",
    reply(200, true),
    configurations,
  );

Deno.test("FR-R1: the portal opens the configuration of the organisation's type, so it lists only that type's plans", async () => {
  for (const [type, configuration] of Object.entries(CONFIGURATIONS)) {
    const { spy, response } = openPortal(type, CONFIGURATIONS);
    assert.equal((await response).status, 200);
    assert.deepEqual(spy.portals, [{
      customerRef: "cus_linked",
      returnUrl: `${SITE}/en/org/acme/billing`,
      configuration,
    }]);
  }
});

Deno.test("FR-R1: a partner type without its configuration gets no portal at Stripe, never the default one", async () => {
  for (const type of ["recruitment_company", "staffing_company", "unknown_type"]) {
    const { spy, response } = openPortal(type, { employer: "bpc_employer" });
    const result = await response;
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: "unavailable", reason: "portal_not_configured" });
    assert.equal(spy.portals.length, 0);
  }

  const employer = openPortal("employer", {});
  assert.equal((await employer.response).status, 200);
  assert.deepEqual(employer.spy.portals, [{ customerRef: "cus_linked", returnUrl: `${SITE}/en/org/acme/billing` }]);

  const local = openPortal("staffing_company", {}, providerSpy({ name: "null" }));
  assert.equal((await local.response).status, 200);
  assert.equal(local.spy.portals[0].configuration, undefined);
});

Deno.test("a portal without a customer is refused with its reason, and a provider failure is generic", async () => {
  const none = run({ action: "portal", orgId: ORG }, { [PORTAL]: database("CHARA_FORBIDDEN", "P0001", "no_customer") });
  const refused = await none.response;
  assert.equal(refused.status, 403);
  assert.deepEqual(await refused.json(), { error: "forbidden", reason: "no_customer" });
  assert.equal(none.spy.portals.length, 0);

  const failing = run(
    { action: "portal", orgId: ORG },
    { [PORTAL]: reply(200, [{ customer_ref: "cus_linked", slug: "acme", organization_type: "employer" }]) },
    bearer(SIGNED_IN),
    providerSpy({ fail: true }),
  );
  const failed = await failing.response;
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: "unavailable" });
});

Deno.test("FR-G6 AC7: a worker's checkout is refused with a generic answer, creates no session and is recorded once, without a payload", async () => {
  const refused = database("CHARA_FORBIDDEN", "P0001", "worker_account");
  const { database: db, audit, spy, seen, response } = run(
    { ...checkoutBody, userId: "00000000-0000-0000-0000-000000000000" },
    { [START]: refused },
    AS_USER,
  );
  const result = await response;
  assert.equal(result.status, 403);
  assert.deepEqual(await result.json(), { error: "forbidden", reason: null });
  assert.deepEqual([spy.checkouts.length, spy.portals.length], [0, 0], "no provider session is created");
  assert.deepEqual(seen, [AS_USER.authorization], "the start ran with the worker's own token");
  assert.deepEqual(db.calls.map((c) => c.path), ["/rest/v1/rpc/billing_checkout_start"]);
  assert.deepEqual(audit.calls.map((c) => [c.method, c.path, c.body]), [[
    "POST",
    "/rest/v1/rpc/billing_record_worker_attempt",
    { p_user: USER },
  ]], "one record, for the person in the token and not for a user id in the body");
});

Deno.test("FR-G6 AC7: a worker's portal request is refused and recorded the same way", async () => {
  const { database: db, audit, spy, response } = run(
    { action: "portal", orgId: ORG },
    { [PORTAL]: database("CHARA_FORBIDDEN", "P0001", "worker_account") },
    AS_USER,
  );
  const result = await response;
  assert.equal(result.status, 403);
  assert.deepEqual(await result.json(), { error: "forbidden", reason: null });
  assert.deepEqual([spy.checkouts.length, spy.portals.length], [0, 0]);
  assert.deepEqual(db.calls.map((c) => c.path), ["/rest/v1/rpc/billing_portal_start"]);
  assert.deepEqual(audit.calls.map((c) => c.body), [{ p_user: USER }]);
});

Deno.test("FR-G6: every attempt of a worker is recorded, so the refusals can be counted", async () => {
  let recorded = 0;
  for (const attempt of [checkoutBody, { action: "portal", orgId: ORG }, checkoutBody]) {
    const { audit, response } = run(attempt, {
      [START]: database("CHARA_FORBIDDEN", "P0001", "worker_account"),
      [PORTAL]: database("CHARA_FORBIDDEN", "P0001", "worker_account"),
    }, AS_USER);
    assert.equal((await response).status, 403);
    recorded += audit.calls.length;
  }
  assert.equal(recorded, 3);
});

Deno.test("FR-G6: a failure to record the attempt does not change the refusal", async () => {
  const { audit, spy, response } = run(
    checkoutBody,
    { [START]: database("CHARA_FORBIDDEN", "P0001", "worker_account") },
    AS_USER,
    providerSpy(),
    "POST",
    database("audit unavailable", "XX000"),
  );
  const result = await response;
  assert.equal(result.status, 403);
  assert.deepEqual(await result.json(), { error: "forbidden", reason: null });
  assert.equal(audit.calls.length, 1);
  assert.equal(spy.checkouts.length, 0);
});

Deno.test("FR-G6: an account whose kind is not set is refused with the generic answer and is not recorded as a worker", async () => {
  const { audit, spy, response } = run(
    checkoutBody,
    { [START]: database("CHARA_FORBIDDEN", "P0001", "account_kind_unset") },
    AS_USER,
  );
  const result = await response;
  assert.equal(result.status, 403);
  assert.deepEqual(await result.json(), { error: "forbidden", reason: null });
  assert.equal(spy.checkouts.length, 0);
  assert.equal(audit.calls.length, 0);
});

Deno.test("FR-G6: a refusal that merely carries the detail text on another error is not recorded as a worker attempt", async () => {
  const { audit, response } = run(
    checkoutBody,
    { [START]: database("CHARA_INVALID_INPUT", "22023", "worker_account") },
    AS_USER,
  );
  assert.equal((await response).status, 400);
  assert.equal(audit.calls.length, 0);
});

const boostRow = { slug: "manila-skills", customer_ref: null, amount_minor: 10900, currency: "EUR", days: 14 };

Deno.test("boost: the start runs with the caller's token and the payment takes the product's amount, never the body's", async () => {
  const body = {
    action: "boost",
    orgId: ORG,
    sku: "boost_recruitment_14d",
    amountMinor: 1,
    currency: "USD",
    successUrl: "https://evil.example/ok",
  };
  const { database, spy, seen, response } = run(body, { [BOOST]: reply(200, [boostRow]) });
  const result = await response;
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { url: "https://checkout.stripe.com/c/pay/cs_boost" });
  assert.deepEqual(seen, [`Bearer ${SIGNED_IN}`]);
  assert.deepEqual(database.calls.map((c) => [c.path, c.body]), [["/rest/v1/rpc/billing_boost_checkout_start", {
    p_org: ORG,
    p_sku: "boost_recruitment_14d",
    p_provider: "stripe",
  }]]);
  assert.deepEqual(spy.payments, [{
    orgId: ORG,
    sku: "boost_recruitment_14d",
    productName: "Profile boost, 14 days",
    amountMinor: 10900,
    currency: "EUR",
    successUrl: `${SITE}/en/org/manila-skills/boost`,
    cancelUrl: `${SITE}/en/org/manila-skills/boost`,
    customerRef: undefined,
  }]);
  assert.deepEqual([spy.checkouts.length, spy.portals.length], [0, 0]);
});

Deno.test("boost: a linked customer pays as that customer", async () => {
  const { spy, response } = run({ action: "boost", orgId: ORG, sku: "boost_staffing_7d" }, {
    [BOOST]: reply(200, [{ ...boostRow, customer_ref: "cus_linked", days: 7, amount_minor: 4900 }]),
  });
  assert.equal((await response).status, 200);
  assert.equal(spy.payments[0].customerRef, "cus_linked");
  assert.equal(spy.payments[0].productName, "Profile boost, 7 days");
});

Deno.test("boost: the refusals of the database keep their reason, and no payment is started", async () => {
  for (
    const reason of [
      "boosts_off",
      "unknown_product",
      "product_not_for_org_type",
      "product_not_sold",
      "not_listed",
      "aal2_required",
    ]
  ) {
    const { spy, response } = run({ action: "boost", orgId: ORG, sku: "boost_recruitment_7d" }, {
      [BOOST]: database("CHARA_FORBIDDEN", "42501", reason),
    });
    const result = await response;
    assert.equal(result.status, 403);
    assert.deepEqual(await result.json(), { error: "forbidden", reason });
    assert.equal(spy.payments.length, 0);
  }
  const { spy, response } = run({ action: "boost", orgId: ORG, sku: "boost_recruitment_7d" }, {
    [BOOST]: database("CHARA_FORBIDDEN", "42501"),
  });
  assert.deepEqual(await (await response).json(), { error: "forbidden", reason: null });
  assert.equal(spy.payments.length, 0);
});

Deno.test("boost: a malformed request is refused before the database, and a provider failure is generic", async () => {
  for (
    const body of [{ action: "boost", orgId: ORG }, { action: "boost", orgId: ORG, sku: 7 }, {
      action: "boost",
      orgId: ORG,
      sku: "b".repeat(65),
    }]
  ) {
    const { database, response } = run(body, { [BOOST]: reply(200, [boostRow]) });
    assert.equal((await response).status, 400, JSON.stringify(body));
    assert.equal(database.calls.length, 0);
  }
  const failing = run(
    { action: "boost", orgId: ORG, sku: "boost_recruitment_14d" },
    { [BOOST]: reply(200, [boostRow]) },
    bearer(SIGNED_IN),
    providerSpy({ fail: true }),
  );
  const failed = await failing.response;
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: "unavailable" });
});
