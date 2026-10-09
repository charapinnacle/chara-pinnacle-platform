import assert from "node:assert/strict";
import { handleBillingWebhook } from "../billing-webhook/handler.ts";
import { nullProvider } from "../_shared/billing/providers/null.ts";
import { stripeProvider } from "../_shared/billing/providers/stripe.ts";
import charge from "./fixtures/stripe/events/charge-succeeded.json" with { type: "json" };
import invoicePaid from "./fixtures/stripe/events/invoice-paid.json" with { type: "json" };
import created from "./fixtures/stripe/events/subscription-created.json" with { type: "json" };
import updated from "./fixtures/stripe/events/subscription-updated.json" with { type: "json" };
import { type Call, harness, hmacHex, reply, type Route } from "./harness.ts";

const SITE = "https://app.chara.example";
const SECRET = "whsec_test_secret";
const NULL_SECRET = "null-secret";
const NOW = Date.parse("2026-11-01T10:00:00Z");
const T = Math.floor(NOW / 1000);
const EVENT_ID = "11111111-2222-4333-8444-555555555555";

const rpcPath = (name: string) => `POST /rest/v1/rpc/${name}`;
const names = (calls: Call[]) => calls.map((call) => call.path.split("/").pop());

async function stripeDelivery(body: string, header?: string): Promise<Request> {
  const signature = header ?? `t=${T},v1=${await hmacHex(SECRET, `${T}.${body}`)}`;
  return new Request("http://stack.test/functions/v1/billing-webhook", {
    method: "POST",
    headers: signature ? { "stripe-signature": signature } : {},
    body,
  });
}

function setup(routes: Record<string, Route | Response>, fetchFn: typeof fetch = fetch, now = NOW) {
  const logs: Record<string, unknown>[] = [];
  const { calls, client } = harness({
    [rpcPath("billing_ingest_event")]: reply(200, EVENT_ID),
    [rpcPath("billing_apply_event")]: reply(200, "applied"),
    [rpcPath("billing_webhook_rejected")]: reply(200, true),
    ...routes,
  });
  const deps = {
    client,
    provider: stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE, webhookSecret: SECRET }, fetchFn, () => now),
    now: () => now,
    log: (entry: Record<string, unknown>) => logs.push(entry),
  };
  return { calls, deps, logs };
}

const body = JSON.stringify(created, null, 2);

Deno.test("FR-G3 AC1: a delivery with a valid signature is stored, applied and answered with 200", async () => {
  const { calls, deps } = setup({});
  const response = await handleBillingWebhook(await stripeDelivery(body), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(names(calls), ["billing_ingest_event", "billing_apply_event"]);
  const ingest = calls[0].body as Record<string, unknown>;
  assert.equal(ingest.p_provider, "stripe");
  assert.equal(ingest.p_provider_event_id, "evt_sub_created");
  assert.equal(ingest.p_kind, "subscription.activated");
  assert.equal(ingest.p_signature_valid, true);
  assert.equal(ingest.p_provider_created_at, "2026-11-01T10:00:00.000Z");
  assert.equal((ingest.p_payload as Record<string, unknown>).planCode, "employer_starter");
  assert.deepEqual(calls[1].body, { p_event_id: EVENT_ID });
});

Deno.test("FR-G3 AC1: a delivery 299 seconds old is accepted", async () => {
  const { calls, deps } = setup({});
  const header = `t=${T - 299},v1=${await hmacHex(SECRET, `${T - 299}.${body}`)}`;
  assert.equal((await handleBillingWebhook(await stripeDelivery(body, header), deps)).status, 200);
  assert.equal(names(calls).includes("billing_ingest_event"), true);
});

Deno.test("FR-G3 AC1: every request that does not verify is answered with 401, stores nothing and is logged once without its content", async () => {
  const goodHeader = `t=${T},v1=${await hmacHex(SECRET, `${T}.${body}`)}`;
  const cases: [string, Promise<Request>, string][] = [
    [
      "a body changed by one byte",
      stripeDelivery(body.replace("trialing", "trialinG"), goodHeader),
      "signature_mismatch",
    ],
    ["re-serialised JSON", stripeDelivery(JSON.stringify(created), goodHeader), "signature_mismatch"],
    [
      "another secret",
      stripeDelivery(body, `t=${T},v1=${await hmacHex("whsec_other", `${T}.${body}`)}`),
      "signature_mismatch",
    ],
    ["no header", stripeDelivery(body, ""), "missing_signature"],
    ["no v1 value", stripeDelivery(body, `t=${T}`), "malformed_signature"],
    [
      "301 seconds old",
      stripeDelivery(body, `t=${T - 301},v1=${await hmacHex(SECRET, `${T - 301}.${body}`)}`),
      "timestamp_outside_tolerance",
    ],
    [
      "only the header of the null provider, correctly signed",
      Promise.resolve(
        new Request("http://stack.test/", {
          method: "POST",
          headers: { "x-chara-signature": await hmacHex(NULL_SECRET, body) },
          body,
        }),
      ),
      "missing_signature",
    ],
  ];
  for (const [name, request, reason] of cases) {
    const { calls, deps, logs } = setup({});
    const response = await handleBillingWebhook(await request, deps);
    assert.equal(response.status, 401, name);
    assert.deepEqual(await response.json(), { error: "unauthorized" }, `${name}: the answer gives no detail`);
    assert.equal(names(calls).includes("billing_ingest_event"), false, `${name}: nothing is stored`);
    assert.equal(names(calls).includes("billing_apply_event"), false, `${name}: nothing is applied`);
    const audits = calls.filter((call) => call.path.endsWith("/billing_webhook_rejected"));
    assert.equal(audits.length, 1, `${name}: one audit call`);
    assert.deepEqual(audits[0].body, { p_provider: "stripe", p_reason: reason }, name);
    assert.doesNotMatch(
      JSON.stringify(audits[0].body),
      /evt_|sub_1Nx|cus_|trialing/,
      `${name}: no payload and no event id`,
    );
    assert.doesNotMatch(JSON.stringify(logs), /evt_|sub_1Nx|cus_/, `${name}: the log holds none either`);
  }
});

Deno.test("FR-G3 AC1: a body that is not JSON is judged by its signature first", async () => {
  const { calls, deps } = setup({});
  const response = await handleBillingWebhook(await stripeDelivery("not json", `t=${T},v1=00`), deps);
  assert.equal(response.status, 401);
  assert.equal(calls.length, 1);
});

Deno.test("FR-G3 AC1: with the null provider a valid x-chara-signature is accepted and a missing or wrong one is refused", async () => {
  const eventBody = JSON.stringify({
    id: "evt_null_1",
    event: {
      kind: "payment.failed",
      providerCreatedAt: "2026-11-01T10:00:00.000Z",
      providerSubscriptionRef: "sub_1",
      providerPaymentRef: "in_1",
    },
  });
  const request = (headers: Record<string, string>) =>
    new Request("http://stack.test/", { method: "POST", headers, body: eventBody });
  const run = async (headers: Record<string, string>) => {
    const { calls, deps } = setup({});
    const response = await handleBillingWebhook(request(headers), {
      ...deps,
      provider: nullProvider(SITE, NULL_SECRET),
    });
    return { status: response.status, calls };
  };

  const accepted = await run({ "x-chara-signature": await hmacHex(NULL_SECRET, eventBody) });
  assert.equal(accepted.status, 200);
  assert.deepEqual((accepted.calls[0].body as Record<string, unknown>).p_provider_event_id, "evt_null_1");
  assert.equal((accepted.calls[0].body as Record<string, unknown>).p_provider, "null");
  for (const headers of [{} as Record<string, string>, { "x-chara-signature": await hmacHex("wrong", eventBody) }]) {
    const refused = await run(headers);
    assert.equal(refused.status, 401);
    assert.equal(names(refused.calls).includes("billing_ingest_event"), false);
    assert.equal(names(refused.calls).filter((name) => name === "billing_webhook_rejected").length, 1);
  }
});

Deno.test("types that CHARA does not use are acknowledged with 200 and not stored", async () => {
  const { calls, deps } = setup({});
  const response = await handleBillingWebhook(await stripeDelivery(JSON.stringify(charge)), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, []);
});

Deno.test("only POST is served, and a body above 1 MB is refused before it is read", async () => {
  const { calls, deps } = setup({});
  assert.equal((await handleBillingWebhook(new Request("http://stack.test/", { method: "GET" }), deps)).status, 405);
  const big = new Request("http://stack.test/", {
    method: "POST",
    headers: { "content-length": "1000001" },
    body: "x",
  });
  assert.equal((await handleBillingWebhook(big, deps)).status, 413);
  assert.deepEqual(calls, []);
});

Deno.test("FR-G3 AC6: an event the database reports as stale is replaced by the subscription as Stripe holds it now", async () => {
  const applied: string[] = [];
  const fetched: string[] = [];
  const fetchFn: typeof fetch = (input) => {
    fetched.push(String(input));
    return Promise.resolve(Response.json({ ...created.data.object, id: "sub_1", status: "active" }));
  };
  const { calls, deps, logs } = setup({
    [rpcPath("billing_apply_event")]: () => {
      applied.push("apply");
      return reply(200, applied.length === 1 ? "stale" : "applied");
    },
    [rpcPath("billing_ingest_event")]: () =>
      reply(200, applied.length === 0 ? EVENT_ID : "99999999-2222-4333-8444-555555555555"),
  }, fetchFn);
  const staleBody = JSON.stringify({ ...updated, data: { object: { ...updated.data.object, id: "sub_1" } } });

  const response = await handleBillingWebhook(await stripeDelivery(staleBody), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(fetched, ["https://api.stripe.com/v1/subscriptions/sub_1"]);
  assert.deepEqual(names(calls), [
    "billing_ingest_event",
    "billing_apply_event",
    "billing_ingest_event",
    "billing_apply_event",
  ]);
  const refetched = calls[2].body as Record<string, unknown>;
  assert.equal(refetched.p_provider_event_id, "refetch:sub_1:2026-11-01T10:00:00.000Z");
  assert.equal(refetched.p_provider_created_at, "2026-11-01T10:00:00.000Z");
  assert.equal(refetched.p_kind, "subscription.updated");
  assert.equal((refetched.p_payload as Record<string, unknown>).status, "active");
  assert.equal((refetched.p_payload as Record<string, unknown>).planCode, "employer_starter");
  assert.deepEqual(calls[3].body, { p_event_id: "99999999-2222-4333-8444-555555555555" });
  assert.doesNotMatch(JSON.stringify(logs), /employer_|cus_1Nx|org_id/);
});

Deno.test("FR-G3 AC6: a stale refetched event is not fetched again, and a failed fetch is logged and answered with 200", async () => {
  const { calls, deps } = setup(
    { [rpcPath("billing_apply_event")]: reply(200, "stale") },
    () => Promise.resolve(Response.json(created.data.object)),
  );
  assert.equal((await handleBillingWebhook(await stripeDelivery(body), deps)).status, 200);
  assert.deepEqual(names(calls), [
    "billing_ingest_event",
    "billing_apply_event",
    "billing_ingest_event",
    "billing_apply_event",
  ]);

  const failing = setup(
    { [rpcPath("billing_apply_event")]: reply(200, "stale") },
    () => Promise.resolve(new Response("{}", { status: 500 })),
  );
  assert.equal((await handleBillingWebhook(await stripeDelivery(body), failing.deps)).status, 200);
  assert.deepEqual(names(failing.calls), ["billing_ingest_event", "billing_apply_event"]);
  assert.deepEqual(failing.logs.map((entry) => entry.event), ["billing_webhook_refetch_failed"]);
  assert.doesNotMatch(JSON.stringify(failing.logs), /sk_test|Bearer/);
});

Deno.test("an invoice event that is stale has no subscription to fetch when it names none, and one that does is fetched", async () => {
  const fetched: string[] = [];
  const fetchFn: typeof fetch = (input) => {
    fetched.push(String(input));
    return Promise.resolve(Response.json(created.data.object));
  };
  const { deps } = setup({ [rpcPath("billing_apply_event")]: reply(200, "stale") }, fetchFn);
  await handleBillingWebhook(await stripeDelivery(JSON.stringify(invoicePaid)), deps);
  assert.deepEqual(fetched, ["https://api.stripe.com/v1/subscriptions/sub_1Nx"]);
});

Deno.test("FR-G3 AC6: when the application fails the event is owned by the retry job and the answer is 200", async () => {
  const { calls, deps, logs } = setup({
    [rpcPath("billing_apply_event")]: reply(400, {
      code: "40001",
      message: "could not serialize access",
      details: null,
      hint: null,
    }),
  });
  const response = await handleBillingWebhook(await stripeDelivery(body), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(names(calls), ["billing_ingest_event", "billing_apply_event"]);
  assert.deepEqual(logs, [{ event: "billing_webhook_apply_failed", event_id: "evt_sub_created", code: "40001" }]);
});

Deno.test("FR-G3 AC6: when the event cannot be stored the answer is 500 so that Stripe sends it again, and the log has an alert", async () => {
  const { calls, deps, logs } = setup({
    [rpcPath("billing_ingest_event")]: reply(503, {
      code: "PGRST000",
      message: "no connection",
      details: "password=secret",
      hint: null,
    }),
  });
  const response = await handleBillingWebhook(await stripeDelivery(body), deps);
  assert.equal(response.status, 500);
  assert.deepEqual(names(calls), ["billing_ingest_event"]);
  assert.deepEqual(logs, [{ alert: "billing_webhook_ingest_failed", event_id: "evt_sub_created", code: "PGRST000" }]);
  assert.doesNotMatch(JSON.stringify(logs), /secret/);
});

Deno.test("FR-G3 AC6: the database layer makes no outbound call: only the three RPCs are reached through the client", async () => {
  const { calls, deps } = setup({});
  await handleBillingWebhook(await stripeDelivery(body), deps);
  await handleBillingWebhook(await stripeDelivery(body, ""), deps);
  assert.deepEqual([...new Set(names(calls))].sort(), [
    "billing_apply_event",
    "billing_ingest_event",
    "billing_webhook_rejected",
  ]);
});
