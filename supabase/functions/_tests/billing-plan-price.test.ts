import assert from "node:assert/strict";
import { handleBillingPlanPrice } from "../billing-plan-price/handler.ts";
import { type BillingProvider, BillingProviderError, type PriceInput } from "../_shared/billing/provider.ts";
import { createClient } from "@supabase/supabase-js";
import { harness, reply, type Route } from "./harness.ts";

const READ = "POST /rest/v1/rpc/admin_get_plan_price";
const RECORD = "POST /rest/v1/rpc/admin_record_plan_price";
const REASON = "Price review after the first quarter";

function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${part({ alg: "HS256" })}.${part(claims)}.c2ln`;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const bearer = (value: string) => ({ authorization: `Bearer ${value}` });
const ADMIN = bearer(token({ sub: "admin-1", role: "authenticated", aal: "aal2", exp: future }));

const plan = {
  code: "recruitment_partner",
  org_type: "recruitment_company",
  name: "Basic",
  price_minor: 4900,
  currency: "EUR",
  interval: "month",
  product_ref: "prod_rp",
  price_ref: "price_rp_4900",
};
const read = reply(200, [plan]);
const recorded = reply(200, true);
const database = (message: string, code: string, details: string | null = null) =>
  reply(400, { code, message, details, hint: null });
const body = { plan_code: "recruitment_partner", price_minor: 5400, reason: REASON };

function providerSpy(options: { fail?: boolean; name?: "null" | "stripe" } = {}) {
  const prices: PriceInput[] = [];
  const provider: Pick<BillingProvider, "name" | "createPrice"> = {
    name: options.name ?? "stripe",
    createPrice(input) {
      prices.push(input);
      return options.fail
        ? Promise.reject(new BillingProviderError("stripe_http_500"))
        : Promise.resolve({ priceRef: options.name === "null" ? null : "price_rp_5400" });
    },
  };
  return { provider, prices };
}

function run(
  payload: unknown,
  routes: Record<string, Route | Response>,
  headers: Record<string, string> = ADMIN,
  spy = providerSpy(),
  method = "POST",
) {
  const db = harness(routes);
  const seen: string[] = [];
  const requestIds: (string | undefined)[] = [];
  const request = new Request("http://stack.test/functions/v1/billing-plan-price", {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(payload) : undefined,
  });
  const response = handleBillingPlanPrice(request, {
    // As index.ts builds it: the request id travels as a header on every call of the caller's client.
    userClient: (authorization, requestId) => {
      seen.push(authorization);
      requestIds.push(requestId);
      return createClient("http://stack.test", "anon-key", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: db.fetch, headers: requestId ? { "x-request-id": requestId } : {} },
      });
    },
    provider: spy.provider,
  });
  return { db, spy, seen, requestIds, response };
}

const paths = (calls: { path: string }[]) => calls.map((call) => call.path);

Deno.test("FR-R2 AC8: without a signed-in person's token neither the database nor the provider is called: 401", async () => {
  for (
    const headers of [
      {},
      bearer("sb_publishable_abc"),
      bearer(token({ role: "anon", exp: future })),
      bearer(token({ sub: "u1", role: "authenticated", exp: Math.floor(Date.now() / 1000) - 60 })),
    ]
  ) {
    const { db, spy, seen, response } = run(body, { [READ]: read, [RECORD]: recorded }, headers);
    const result = await response;
    assert.equal(result.status, 401);
    assert.deepEqual(await result.json(), { error: "unauthorized" });
    assert.deepEqual([db.calls.length, spy.prices.length, seen.length], [0, 0, 0]);
  }
});

Deno.test("FR-R2 AC8: an organisation owner and an administrator at aal1 get 403 from the read; no price is created or recorded", async () => {
  const cases: [Response, unknown][] = [
    [database("CHARA_FORBIDDEN", "P0001"), { error: "forbidden", reason: null }],
    [database("CHARA_FORBIDDEN", "P0001", "aal2_required"), { error: "forbidden", reason: "aal2_required" }],
  ];
  for (const [answer, expected] of cases) {
    const owner = bearer(token({ sub: "owner-1", role: "authenticated", exp: future }));
    const { db, spy, seen, response } = run(body, { [READ]: answer, [RECORD]: recorded }, owner);
    const result = await response;
    assert.equal(result.status, 403);
    assert.deepEqual(await result.json(), expected);
    assert.deepEqual(paths(db.calls), ["/rest/v1/rpc/admin_get_plan_price"]);
    assert.equal(spy.prices.length, 0);
    assert.deepEqual(seen, [owner.authorization], "the read runs with the caller's token");
  }
});

Deno.test("FR-R2 AC8: a valid change creates one monthly EUR price on the plan's product, then records it with the caller's token", async () => {
  const { db, spy, seen, response } = run(body, { [READ]: read, [RECORD]: recorded });
  const result = await response;
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { plan_code: "recruitment_partner", price_minor: 5400 });
  assert.deepEqual(spy.prices, [{
    productRef: "prod_rp",
    amountMinor: 5400,
    currency: "EUR",
    interval: "month",
    metadata: { plan_code: "recruitment_partner" },
  }]);
  assert.deepEqual(paths(db.calls), ["/rest/v1/rpc/admin_get_plan_price", "/rest/v1/rpc/admin_record_plan_price"]);
  assert.deepEqual(db.calls[0].body, { p_code: "recruitment_partner" });
  assert.deepEqual(db.calls[1].body, {
    p_code: "recruitment_partner",
    p_price_ref: "price_rp_5400",
    p_price_minor: 5400,
    p_reason: REASON,
  });
  assert.deepEqual(seen, [ADMIN.authorization], "one client acting as the caller makes both calls");
  assert.equal(
    db.calls.some((call) => /subscription/.test(call.path)),
    false,
    "no existing subscription is read, updated or archived",
  );
});

Deno.test("FR-R2 AC8: when the provider throws the answer is 502 with a generic message and the price is not recorded", async () => {
  const { db, response } = run(body, { [READ]: read, [RECORD]: recorded }, ADMIN, providerSpy({ fail: true }));
  const result = await response;
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { error: "unavailable" });
  assert.deepEqual(paths(db.calls), ["/rest/v1/rpc/admin_get_plan_price"]);
});

Deno.test("an invalid amount, plan code or reason is refused before the database and the provider are called", async () => {
  const cases: [unknown, string][] = [
    [null, "body"],
    [{ ...body, plan_code: "Recruitment Partner" }, "plan_code"],
    [{ ...body, price_minor: 99 }, "price_minor"],
    [{ ...body, price_minor: 10_000_001 }, "price_minor"],
    [{ ...body, price_minor: 54.5 }, "price_minor"],
    [{ ...body, price_minor: "5400" }, "price_minor"],
    [{ ...body, reason: "  too short  " }, "reason"],
    [{ ...body, reason: "r".repeat(501) }, "reason"],
    [{ ...body, reason: undefined }, "reason"],
  ];
  for (const [payload, field] of cases) {
    const { db, spy, response } = run(payload, { [READ]: read, [RECORD]: recorded });
    const result = await response;
    assert.equal(result.status, 400, JSON.stringify(payload));
    assert.deepEqual(await result.json(), { error: "bad_request", field });
    assert.deepEqual([db.calls.length, spy.prices.length], [0, 0]);
  }
});

Deno.test("the bounds are accepted: 100 and 10,000,000 minor units and a reason of 10 or 500 characters after trimming", async () => {
  for (
    const payload of [
      { ...body, price_minor: 100, reason: "  ten chars!  " },
      { ...body, price_minor: 10_000_000, reason: "r".repeat(500) },
    ]
  ) {
    const { db, response } = run(payload, { [READ]: read, [RECORD]: recorded });
    assert.equal((await response).status, 200);
    assert.equal((db.calls[1].body as { p_reason: string }).p_reason, payload.reason.trim());
  }
});

Deno.test("the current price, a free plan and a plan without a product at the provider create no price", async () => {
  const cases: [Record<string, unknown>, number, unknown][] = [
    [{ ...plan, price_minor: 5400 }, 400, { error: "bad_request", field: "price_unchanged" }],
    [{ ...plan, price_minor: 0 }, 400, { error: "bad_request", field: "free_plan" }],
    [{ ...plan, product_ref: null }, 409, { error: "conflict", reason: "plan_not_synced" }],
  ];
  for (const [row, status, expected] of cases) {
    const { db, spy, response } = run(body, { [READ]: reply(200, [row]), [RECORD]: recorded });
    const result = await response;
    assert.equal(result.status, status);
    assert.deepEqual(await result.json(), expected);
    assert.deepEqual([db.calls.length, spy.prices.length], [1, 0]);
  }
});

Deno.test("the null provider records the amount without a provider price", async () => {
  const spy = providerSpy({ name: "null" });
  const { db, response } = run(
    body,
    { [READ]: reply(200, [{ ...plan, product_ref: null, price_ref: null }]), [RECORD]: recorded },
    ADMIN,
    spy,
  );
  assert.equal((await response).status, 200);
  assert.equal(spy.prices[0].productRef, null);
  assert.deepEqual(db.calls[1].body, {
    p_code: "recruitment_partner",
    p_price_ref: null,
    p_price_minor: 5400,
    p_reason: REASON,
  });
});

Deno.test("refusals of the database become fixed answers; an unknown failure is 502", async () => {
  const cases: [string, Response, number, unknown][] = [
    [READ, database("CHARA_INVALID_INPUT", "P0001", "plan_code"), 400, { error: "bad_request", field: "plan_code" }],
    [READ, database("permission denied for function admin_get_plan_price", "42501"), 401, { error: "unauthorized" }],
    [READ, database("boom", "XX000"), 502, { error: "unavailable" }],
    [READ, reply(200, []), 502, { error: "unavailable" }],
    [RECORD, database("CHARA_UNAVAILABLE", "P0001", "plan_not_synced"), 409, {
      error: "conflict",
      reason: "plan_not_synced",
    }],
    [RECORD, database("CHARA_INVALID_INPUT", "P0001", "secret detail"), 400, { error: "bad_request", field: null }],
    [RECORD, database("CHARA_FORBIDDEN", "P0001", "aal2_required"), 403, {
      error: "forbidden",
      reason: "aal2_required",
    }],
  ];
  for (const [route, answer, status, expected] of cases) {
    const { response } = run(body, { [READ]: read, [RECORD]: recorded, [route]: answer });
    const result = await response;
    assert.equal(result.status, status, `${route} ${status}`);
    assert.deepEqual(await result.json(), expected);
  }
});

Deno.test("only POST is accepted", async () => {
  const { db, response } = run(body, { [READ]: read }, ADMIN, providerSpy(), "GET");
  assert.equal((await response).status, 405);
  assert.equal(db.calls.length, 0);
});

Deno.test("the web request's id reaches the read and the record of the price, so the audit row names the request", async () => {
  const id = "0B9F4C1E-6A8D-4B7E-9C2F-1D3E5A7B9C0D";
  const { db, requestIds, response } = run(body, { [READ]: read, [RECORD]: recorded }, {
    ...ADMIN,
    "x-request-id": id,
  });
  assert.equal((await response).status, 200);
  assert.deepEqual(requestIds, [id.toLowerCase()]);
  assert.deepEqual(db.calls.map((call) => [call.path, call.headers["x-request-id"]]), [
    ["/rest/v1/rpc/admin_get_plan_price", id.toLowerCase()],
    ["/rest/v1/rpc/admin_record_plan_price", id.toLowerCase()],
  ]);
});

Deno.test("a request id that is not a UUID is not forwarded", async () => {
  for (const id of ["not-a-uuid", "0b9f4c1e-6a8d-4b7e-9c2f-1d3e5a7b9c0d,0b9f4c1e-6a8d-4b7e-9c2f-1d3e5a7b9c0e", ""]) {
    const { db, requestIds, response } = run(body, { [READ]: read, [RECORD]: recorded }, {
      ...ADMIN,
      "x-request-id": id,
    });
    assert.equal((await response).status, 200);
    assert.deepEqual(requestIds, [undefined]);
    assert.equal(db.calls.some((call) => "x-request-id" in call.headers), false);
  }
});
