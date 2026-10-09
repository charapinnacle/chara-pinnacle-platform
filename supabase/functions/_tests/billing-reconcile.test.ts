import assert from "node:assert/strict";
import { handleBillingReconcile } from "../billing-reconcile/handler.ts";
import type { BillingProvider, SubscriptionState } from "../_shared/billing/provider.ts";
import { compareSubscriptions, type SubscriptionRecord } from "../_shared/billing/reconcile.ts";
import { nullProvider } from "../_shared/billing/providers/null.ts";
import { harness, reply } from "./harness.ts";

const SECRET = "scheduler-secret";

const held = (ref: string, status: SubscriptionState["status"], planCode = "employer_starter"): SubscriptionState => ({
  providerSubscriptionRef: ref,
  status,
  planCode,
});
const record = (ref: string, status: string, plan = "employer_starter"): SubscriptionRecord => ({
  provider_subscription_ref: ref,
  plan_code: plan,
  status,
});

Deno.test("FR-G3 AC12: one missing record, one extra record, one status mismatch and one plan mismatch are four differences", () => {
  const differences = compareSubscriptions(
    [
      held("sub_ok", "active"),
      held("sub_missing", "active"),
      held("sub_status", "active"),
      held("sub_plan", "active", "employer_professional"),
    ],
    [
      record("sub_ok", "active"),
      record("sub_extra", "active"),
      record("sub_status", "past_due"),
      record("sub_plan", "active"),
    ],
  );
  assert.deepEqual(differences, [
    { kind: "missing_record", subscription_ref: "sub_missing" },
    { kind: "status_mismatch", subscription_ref: "sub_status" },
    { kind: "plan_mismatch", subscription_ref: "sub_plan" },
    { kind: "extra_record", subscription_ref: "sub_extra" },
  ]);
});

Deno.test("FR-G3 AC12: two identical lists have no difference, and a canceled record the provider no longer lists agrees", () => {
  const states = [held("sub_a", "active"), held("sub_b", "trialing")];
  assert.deepEqual(compareSubscriptions(states, [record("sub_a", "active"), record("sub_b", "trialing")]), []);
  assert.deepEqual(
    compareSubscriptions(states, [
      record("sub_a", "active"),
      record("sub_b", "trialing"),
      record("sub_old", "canceled"),
    ]),
    [],
  );
  assert.deepEqual(compareSubscriptions([], []), []);
});

Deno.test("a record that is canceled while the provider still lists the subscription is a status mismatch", () => {
  assert.deepEqual(compareSubscriptions([held("sub_a", "active")], [record("sub_a", "canceled")]), [
    { kind: "status_mismatch", subscription_ref: "sub_a" },
  ]);
});

function providerOf(pages: SubscriptionState[][]): BillingProvider {
  return {
    ...nullProvider("https://app.chara.example"),
    name: "stripe",
    listSubscriptions: (after) => {
      const index = after ? Number(after) : 0;
      return Promise.resolve({
        subscriptions: pages[index],
        next: index + 1 < pages.length ? String(index + 1) : null,
      });
    },
  };
}

function setup(
  pages: SubscriptionState[][],
  pagesOfRecords: unknown[][],
  report = reply(200, 0),
  provider = providerOf(pages),
) {
  const alerts: [string, Record<string, unknown>][] = [];
  let read = 0;
  const { calls, client } = harness({
    "POST /rest/v1/rpc/billing_reconcile_records": () => reply(200, pagesOfRecords[read++] ?? []),
    "POST /rest/v1/rpc/billing_reconcile_report": report,
  });
  const deps = {
    client,
    provider,
    sharedSecret: SECRET,
    alert: (name: string, detail: Record<string, unknown>) => alerts.push([name, detail]),
  };
  return { calls, deps, alerts };
}

const request = (headers: Record<string, string> = { "x-edge-secret": SECRET }, method = "POST") =>
  new Request("http://stack.test/functions/v1/billing-reconcile", {
    method,
    headers,
    body: method === "POST" ? "{}" : undefined,
  });

Deno.test("FR-G3 AC12: the function reports the four differences in one call and the identical lists none", async () => {
  const rows = [
    { id: "00000000-0000-0000-0000-000000000001", ...record("sub_ok", "active") },
    { id: "00000000-0000-0000-0000-000000000002", ...record("sub_extra", "active") },
  ];
  const first = setup([[held("sub_ok", "active"), held("sub_new", "active")]], [rows]);
  const response = await handleBillingReconcile(request(), first.deps);
  assert.deepEqual(await response.json(), { status: "compared", checked: 2, differences: 2 });
  const report = first.calls.find((call) => call.path.endsWith("/billing_reconcile_report"))?.body;
  assert.deepEqual(report, {
    p_provider: "stripe",
    p_checked: 2,
    p_difference_count: 2,
    p_differences: [{ kind: "missing_record", subscription_ref: "sub_new" }, {
      kind: "extra_record",
      subscription_ref: "sub_extra",
    }],
  });

  const same = setup([[held("sub_ok", "active")]], [[rows[0]]]);
  assert.deepEqual(await (await handleBillingReconcile(request(), same.deps)).json(), {
    status: "compared",
    checked: 1,
    differences: 0,
  });
  assert.deepEqual(
    (same.calls.find((call) => call.path.endsWith("/billing_reconcile_report"))?.body as Record<string, unknown>)
      .p_differences,
    [],
  );
  assert.deepEqual(same.alerts, []);
});

Deno.test("a run with thousands of differences is reported with its total and a sample, not refused", async () => {
  const stored = Array.from({ length: 250 }, (_, n) => ({
    id: `00000000-0000-0000-0000-${String(n + 1).padStart(12, "0")}`,
    ...record(`sub_${n}`, "active"),
  }));
  const wrong = Array.from({ length: 250 }, (_, n) => held(`sub_${n}`, "past_due"));
  const { calls, deps } = setup([wrong], [stored]);
  const response = await handleBillingReconcile(request(), deps);
  assert.deepEqual(await response.json(), { status: "compared", checked: 250, differences: 250 });
  const report = calls.find((call) => call.path.endsWith("/billing_reconcile_report"))?.body as Record<string, unknown>;
  assert.equal(report.p_difference_count, 250);
  assert.equal((report.p_differences as unknown[]).length, 100);
});

Deno.test("the lists are read page by page", async () => {
  const page = Array.from({ length: 1000 }, (_, n) => ({
    id: `00000000-0000-0000-0000-${String(n + 1).padStart(12, "0")}`,
    ...record(`sub_${n}`, "active"),
  }));
  const { calls, deps } = setup(
    [[held("sub_0", "active")], [held("sub_1", "active")]],
    [page, [{ id: "00000000-0000-0000-0000-999999999999", ...record("sub_last", "active") }]],
  );
  const response = await handleBillingReconcile(request(), deps);
  assert.equal((await response.json()).checked, 2);
  const reads = calls.filter((call) => call.path.endsWith("/billing_reconcile_records")).map((call) => call.body);
  assert.deepEqual(reads, [
    { p_provider: "stripe", p_limit: 1000 },
    { p_provider: "stripe", p_after: "00000000-0000-0000-0000-000000001000", p_limit: 1000 },
  ]);
});

Deno.test("only the scheduler may start a comparison, and only POST", async () => {
  const { calls, deps } = setup([[]], [[]]);
  assert.equal((await handleBillingReconcile(request({}), deps)).status, 401);
  assert.equal((await handleBillingReconcile(request({ "x-edge-secret": "wrong" }), deps)).status, 401);
  assert.equal((await handleBillingReconcile(request({ "x-edge-secret": SECRET }, "GET"), deps)).status, 405);
  assert.deepEqual(calls, []);
});

Deno.test("with the null provider there is nothing to compare", async () => {
  const { calls, deps } = setup([[]], [[]], reply(200, 0), nullProvider("https://app.chara.example"));
  assert.deepEqual(await (await handleBillingReconcile(request(), deps)).json(), { status: "skipped" });
  assert.deepEqual(calls, []);
});

Deno.test("a failure of the provider or of the report raises the alert and answers 500 without detail", async () => {
  const broken = providerOf([[]]);
  broken.listSubscriptions = () => Promise.reject(new Error("secret sk_live_123"));
  const first = setup([[]], [[]], reply(200, 0), broken);
  const response = await handleBillingReconcile(request(), first.deps);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "reconcile_failed" });
  assert.deepEqual(first.alerts, [["billing_reconcile_failed", { code: "unknown" }]]);
  assert.doesNotMatch(JSON.stringify(first.alerts), /sk_live/);

  const second = setup(
    [[]],
    [[]],
    reply(400, { code: "P0001", message: "CHARA_INVALID_INPUT", details: null, hint: null }),
  );
  assert.equal((await handleBillingReconcile(request(), second.deps)).status, 500);
  assert.deepEqual(second.alerts, [["billing_reconcile_failed", { code: "P0001" }]]);
});

Deno.test("a provider that never ends its list is a fault", async () => {
  const endless: BillingProvider = {
    ...providerOf([[]]),
    listSubscriptions: () => Promise.resolve({ subscriptions: [], next: "sub_x" }),
  };
  const { deps, alerts } = setup([[]], [[]], reply(200, 0), endless);
  assert.equal((await handleBillingReconcile(request(), deps)).status, 500);
  assert.deepEqual(alerts.map(([name]) => name), ["billing_reconcile_failed"]);
});
