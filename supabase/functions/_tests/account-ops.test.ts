import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { handleAccountOps } from "../account-ops/handler.ts";

const SECRET = "scheduler-secret";
const USER = "00000000-0000-0000-0000-00000000a001";
const OTHER = "00000000-0000-0000-0000-00000000a002";
const FACTOR_A = "00000000-0000-0000-0000-00000000f001";
const FACTOR_B = "00000000-0000-0000-0000-00000000f002";

interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Route = (call: Call) => Response | undefined;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// A real supabase-js client over a fake network: the paths, methods and bodies are what the platform would receive.
function harness(routes: Record<string, Route | Response>) {
  const calls: Call[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const text = typeof init?.body === "string" ? init.body : "";
    const call: Call = { method, path: url.pathname, body: text ? JSON.parse(text) : null };
    calls.push(call);
    const route = routes[`${method} ${url.pathname.replace(/[0-9a-f-]{36}/g, "{id}")}`];
    const response = typeof route === "function" ? route(call) : route?.clone();
    return await Promise.resolve(response ?? reply(404, { code: 404, error_code: "not_found", msg: "no route" }));
  };
  const client = createClient("http://stack.test", "service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fakeFetch },
  });
  return { calls, client };
}

function request(headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request("http://stack.test/functions/v1/account-ops", {
    method,
    headers: { authorization: "Bearer project-jwt", "x-edge-secret": SECRET, ...headers },
  });
}

function jobs(...rows: { msg_id: number; message: Record<string, unknown> }[]): Response {
  return reply(200, rows);
}

const factorRow = (id: string) => ({ id, status: "verified", factor_type: "totp", friendly_name: "Authenticator" });
const rpcCalls = (calls: Call[]) => calls.filter((c) => c.path.startsWith("/rest/v1/rpc/"));

Deno.test("only POST is served", async () => {
  const { calls, client } = harness({});
  const response = await handleAccountOps(request({}, "GET"), { client, sharedSecret: SECRET });
  assert.equal(response.status, 405);
  assert.equal(calls.length, 0);
});

Deno.test("a request without the bearer token, the secret or with a wrong secret is refused before the database is reached", async () => {
  const refused: Record<string, string>[] = [
    { authorization: "" },
    { authorization: "Basic abc" },
    { "x-edge-secret": "" },
    { "x-edge-secret": "scheduler-secreT" },
    { "x-edge-secret": `${SECRET}x` },
    { "x-edge-secret": SECRET.slice(0, -1) },
  ];
  for (const headers of refused) {
    const { calls, client } = harness({});
    const response = await handleAccountOps(request(headers), { client, sharedSecret: SECRET });
    assert.equal(response.status, 401, JSON.stringify(headers));
    assert.deepEqual(await response.json(), { error: "unauthorized" });
    assert.equal(calls.length, 0, JSON.stringify(headers));
  }
});

Deno.test("a function without a configured secret refuses every request", async () => {
  const { calls, client } = harness({});
  const response = await handleAccountOps(request({ "x-edge-secret": "" }), { client, sharedSecret: "" });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

Deno.test("an empty queue is a successful run that does nothing", async () => {
  const { calls, client } = harness({ "POST /rest/v1/rpc/account_ops_dequeue": jobs() });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 0, failed: 0 });
  assert.deepEqual(calls.map((c) => c.path), ["/rest/v1/rpc/account_ops_dequeue"]);
});

Deno.test("a sign_out job ends the sessions of the user, touches no factor and is acknowledged with the result", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({
      msg_id: 7,
      message: { action: "sign_out", user_id: USER, reason: "platform_role_granted" },
    }),
    "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 2),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.deepEqual(rpcCalls(calls).map((c) => [c.path.split("/").pop(), c.body]), [
    ["account_ops_dequeue", { p_limit: 25 }],
    ["account_ops_end_sessions", { p_user_id: USER }],
    ["account_ops_ack", { p_msg_id: 7, p_result: { sessions_ended: 2 } }],
  ]);
  assert.equal(calls.filter((c) => c.path.startsWith("/auth/")).length, 0);
});

Deno.test("a reset_mfa job deletes every factor of the user, then ends the sessions, then acknowledges", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 9, message: { action: "reset_mfa", user_id: USER } }),
    "GET /auth/v1/admin/users/{id}/factors": reply(200, [factorRow(FACTOR_A), factorRow(FACTOR_B)]),
    "DELETE /auth/v1/admin/users/{id}/factors/{id}": reply(200, {}),
    "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 2),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path.split("/").slice(3).join("/")}`), [
    "POST rpc/account_ops_dequeue",
    `GET admin/users/${USER}/factors`,
    `DELETE admin/users/${USER}/factors/${FACTOR_A}`,
    `DELETE admin/users/${USER}/factors/${FACTOR_B}`,
    "POST rpc/account_ops_end_sessions",
    "POST rpc/account_ops_ack",
  ]);
  assert.deepEqual(calls.at(-1)?.body, { p_msg_id: 9, p_result: { factors_deleted: 2, sessions_ended: 2 } });
});

Deno.test("a second run of a reset finds nothing to delete and still succeeds", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 10, message: { action: "reset_mfa", user_id: USER } }),
    "GET /auth/v1/admin/users/{id}/factors": reply(200, []),
    "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 0),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 0);
  assert.deepEqual(calls.at(-1)?.body, { p_msg_id: 10, p_result: { factors_deleted: 0, sessions_ended: 0 } });
});

Deno.test("a factor removed in the meantime (404) is skipped and the reset completes", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 11, message: { action: "reset_mfa", user_id: USER } }),
    "GET /auth/v1/admin/users/{id}/factors": reply(200, [factorRow(FACTOR_A), factorRow(FACTOR_B)]),
    "DELETE /auth/v1/admin/users/{id}/factors/{id}": (call) =>
      call.path.endsWith(FACTOR_A)
        ? reply(404, { code: 404, error_code: "mfa_factor_not_found", msg: "gone" })
        : reply(200, {}),
    "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 1),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.deepEqual(calls.at(-1)?.body, { p_msg_id: 11, p_result: { factors_deleted: 1, sessions_ended: 1 } });
});

Deno.test("a failing Auth call leaves its job unacknowledged, does not stop the others and leaks nothing", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(
      { msg_id: 20, message: { action: "reset_mfa", user_id: USER } },
      { msg_id: 21, message: { action: "sign_out", user_id: OTHER } },
    ),
    "GET /auth/v1/admin/users/{id}/factors": reply(500, {
      code: 500,
      error_code: "unexpected_failure",
      msg: `db password for ${USER}`,
    }),
    "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 1),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(text), { processed: 1, failed: 1 });
  assert.ok(!text.includes(USER) && !text.includes("password"));
  const acked = rpcCalls(calls).filter((c) => c.path.endsWith("account_ops_ack")).map((c) =>
    (c.body as { p_msg_id: number }).p_msg_id
  );
  assert.deepEqual(acked, [21]);
  assert.equal(calls.filter((c) => c.path.endsWith("end_sessions")).length, 1);
});

Deno.test("a failing deletion of a factor keeps the sessions alive and the job queued", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 30, message: { action: "reset_mfa", user_id: USER } }),
    "GET /auth/v1/admin/users/{id}/factors": reply(200, [factorRow(FACTOR_A)]),
    "DELETE /auth/v1/admin/users/{id}/factors/{id}": reply(500, {
      code: 500,
      error_code: "unexpected_failure",
      msg: "boom",
    }),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 0, failed: 1 });
  assert.equal(calls.filter((c) => c.path.endsWith("end_sessions") || c.path.endsWith("account_ops_ack")).length, 0);
});

Deno.test("a failing acknowledgement counts as a failure so the idempotent job runs again", async () => {
  const { client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 40, message: { action: "sign_out", user_id: USER } }),
    "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 1),
    "POST /rest/v1/rpc/account_ops_ack": reply(500, { code: "XX000", message: "down", details: null, hint: null }),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 0, failed: 1 });
});

Deno.test("malformed and unknown jobs are never executed or acknowledged", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(
      { msg_id: 50, message: { action: "erase_user", user_id: USER } },
      { msg_id: 51, message: { action: "sign_out", user_id: "not-a-uuid" } },
      { msg_id: 52, message: { action: "sign_out" } },
      { msg_id: 53, message: { action: "sign_out", user_id: `${USER}/../x` } },
    ),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 0, failed: 4 });
  assert.equal(calls.length, 1);
});

Deno.test("an unreachable queue gives a generic 502", async () => {
  const { client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": reply(500, {
      code: "XX000",
      message: "secret internals",
      details: null,
      hint: null,
    }),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "unavailable" });
});
