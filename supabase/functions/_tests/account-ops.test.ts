import assert from "node:assert/strict";
import { handleAccountOps } from "../account-ops/handler.ts";
import { type Call, harness, reply, type Route } from "./harness.ts";

const SECRET = "scheduler-secret";
const USER = "00000000-0000-0000-0000-00000000a001";
const OTHER = "00000000-0000-0000-0000-00000000a002";
const FACTOR_A = "00000000-0000-0000-0000-00000000f001";
const FACTOR_B = "00000000-0000-0000-0000-00000000f002";

function request(headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request("http://stack.test/functions/v1/account-ops", {
    method,
    headers: { authorization: "Bearer project-jwt", "x-edge-secret": SECRET, ...headers },
  });
}

type Row = { msg_id: number; message: Record<string, unknown> };

// The queue hands out each row once: later reads are empty, as the visibility timeout makes them for the database.
function queue(rows: Row[], limit = rows.length): Route {
  let rest = rows;
  return () => {
    const batch = rest.slice(0, limit);
    rest = rest.slice(limit);
    return reply(200, batch);
  };
}

function jobs(...rows: Row[]): Route {
  return queue(rows);
}

const factorRow = (id: string) => ({ id, status: "verified", factor_type: "totp", friendly_name: "Authenticator" });
const rpcCalls = (calls: Call[]) => calls.filter((c) => c.path.startsWith("/rest/v1/rpc/"));
const acks = (calls: Call[]) => calls.filter((c) => c.path.endsWith("account_ops_ack")).map((c) => c.body);

Deno.test("only POST is served", async () => {
  const { calls, client } = harness({});
  const response = await handleAccountOps(request({}, "GET"), { client, sharedSecret: SECRET });
  assert.equal(response.status, 405);
  assert.equal(calls.length, 0);
});

Deno.test("a request without the secret or with a wrong secret is refused before the database is reached", async () => {
  const refused: Record<string, string>[] = [
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
  assert.deepEqual(calls[0].body, { p_limit: 100 });
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
    ["account_ops_dequeue", { p_limit: 100 }],
    ["account_ops_end_sessions", { p_user_id: USER }],
    ["account_ops_ack", { p_msg_id: 7, p_result: { sessions_ended: 2 } }],
    ["account_ops_dequeue", { p_limit: 100 }],
  ]);
  assert.equal(calls.filter((c) => c.path.startsWith("/auth/")).length, 0);
});

Deno.test("a reset_mfa job ends the sessions, then deletes every factor of the user, then acknowledges", async () => {
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
    "POST rpc/account_ops_end_sessions",
    `GET admin/users/${USER}/factors`,
    `DELETE admin/users/${USER}/factors/${FACTOR_A}`,
    `DELETE admin/users/${USER}/factors/${FACTOR_B}`,
    "POST rpc/account_ops_ack",
    "POST rpc/account_ops_dequeue",
  ]);
  assert.deepEqual(acks(calls), [{ p_msg_id: 9, p_result: { factors_deleted: 2, sessions_ended: 2 } }]);
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
  assert.deepEqual(acks(calls)[0], { p_msg_id: 10, p_result: { factors_deleted: 0, sessions_ended: 0 } });
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
  assert.deepEqual(acks(calls)[0], { p_msg_id: 11, p_result: { factors_deleted: 1, sessions_ended: 1 } });
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
  assert.deepEqual(acks(calls).map((body) => (body as { p_msg_id: number }).p_msg_id), [21]);
  assert.equal(calls.filter((c) => c.path.endsWith("end_sessions")).length, 2);
});

Deno.test("a failing deletion of a factor leaves the job queued, with the sessions already ended so no factor can be enrolled meanwhile", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 30, message: { action: "reset_mfa", user_id: USER } }),
    "GET /auth/v1/admin/users/{id}/factors": reply(200, [factorRow(FACTOR_A)]),
    "DELETE /auth/v1/admin/users/{id}/factors/{id}": reply(500, {
      code: 500,
      error_code: "unexpected_failure",
      msg: "boom",
    }),
    "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 1),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 0, failed: 1 });
  assert.equal(calls.filter((c) => c.path.endsWith("end_sessions")).length, 1);
  assert.ok(
    calls.findIndex((c) => c.path.endsWith("end_sessions")) < calls.findIndex((c) => c.method === "DELETE"),
    "the sessions end before the first factor is deleted",
  );
  assert.deepEqual(acks(calls), []);
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
      { msg_id: 50, message: { action: "purge", user_id: USER } },
      { msg_id: 51, message: { action: "sign_out", user_id: "not-a-uuid" } },
      { msg_id: 52, message: { action: "sign_out" } },
      { msg_id: 53, message: { action: "sign_out", user_id: `${USER}/../x` } },
    ),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 0, failed: 4 });
  assert.deepEqual(calls.map((c) => c.path), Array(2).fill("/rest/v1/rpc/account_ops_dequeue"));
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

Deno.test("a long queue is drained in one call: batches of 100, at most 5 jobs at a time, every job acknowledged", async () => {
  const rows: Row[] = Array.from({ length: 230 }, (_, i) => ({
    msg_id: i + 1,
    message: { action: "sign_out", user_id: i % 2 ? USER : OTHER },
  }));
  let running = 0;
  let peak = 0;
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": queue(rows, 100),
    "POST /rest/v1/rpc/account_ops_end_sessions": async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      return reply(200, 1);
    },
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 230, failed: 0 });
  assert.deepEqual(
    acks(calls).map((body) => (body as { p_msg_id: number }).p_msg_id).sort((a, b) => a - b),
    rows.map((row) => row.msg_id),
  );
  assert.equal(calls.filter((c) => c.path.endsWith("account_ops_dequeue")).length, 4);
  assert.ok(peak > 1 && peak <= 5, `${peak} jobs ran at the same time`);
});

Deno.test("a queue that fails after some work keeps the result of that work", async () => {
  let reads = 0;
  const { client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": () =>
      ++reads === 1
        ? reply(200, [{ msg_id: 1, message: { action: "sign_out", user_id: USER } }])
        : reply(500, { code: "XX000", message: "down", details: null, hint: null }),
    "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 1),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
});

Deno.test("a failure is logged with a status and a code only, never a message or a user id", async () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    const { client } = harness({
      "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 60, message: { action: "reset_mfa", user_id: USER } }),
      "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 1),
      "GET /auth/v1/admin/users/{id}/factors": reply(429, {
        code: 429,
        error_code: "over_request_rate_limit",
        msg: `mail ${USER}@example.test`,
      }),
    });
    await handleAccountOps(request(), { client, sharedSecret: SECRET });
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [[
    "account-ops job failed",
    { msgId: 60, action: "reset_mfa", status: 429, code: "over_request_rate_limit" },
  ]]);
});

const OBJECT = `${USER}/00000000-0000-0000-0000-00000000d001/My_CV__final_.pdf`;
const removal = (path: string) => ({ action: "delete_object", user_id: USER, bucket_id: "passport-documents", path });

Deno.test("a delete_object job removes the object through the Storage API, ends no session and is acknowledged", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 70, message: removal(OBJECT) }),
    "DELETE /storage/v1/object/passport-documents": reply(200, [{ name: OBJECT }]),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.deepEqual(calls.filter((c) => c.method === "DELETE").map((c) => c.body), [{ prefixes: [OBJECT] }]);
  assert.equal(calls.filter((c) => c.path.endsWith("end_sessions") || c.path.startsWith("/auth/")).length, 0);
  assert.deepEqual(acks(calls), [{ p_msg_id: 70, p_result: { objects_removed: 1 } }]);
});

Deno.test("an object that is already gone is a success with nothing removed", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 71, message: removal(OBJECT) }),
    "DELETE /storage/v1/object/passport-documents": reply(200, []),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.deepEqual(acks(calls), [{ p_msg_id: 71, p_result: { objects_removed: 0 } }]);
});

Deno.test("a failing removal leaves the job queued to be retried", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 72, message: removal(OBJECT) }),
    "DELETE /storage/v1/object/passport-documents": reply(500, {
      statusCode: "500",
      error: "Internal",
      message: "boom",
    }),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 0, failed: 1 });
  assert.deepEqual(acks(calls), []);
});

Deno.test("a delete_object job outside the folder of its user, or with a bad bucket or path, is never executed", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(
      { msg_id: 80, message: removal(`${OTHER}/00000000-0000-0000-0000-00000000d001/cv.pdf`) },
      { msg_id: 81, message: { ...removal(OBJECT), bucket_id: "passport-documents/../x" } },
      { msg_id: 82, message: { ...removal(OBJECT), path: undefined } },
      { msg_id: 83, message: removal(`${USER}/a b/cv.pdf`) },
      { msg_id: 84, message: { action: "delete_object", user_id: USER, bucket_id: "passport-documents" } },
    ),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 0, failed: 5 });
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 0);
});

const FOLDER_A = "00000000-0000-0000-0000-00000000d001";
const FOLDER_B = "00000000-0000-0000-0000-00000000d002";
const erasure = (msgId: number) => ({ msg_id: msgId, message: { action: "erase_user", user_id: USER } });
const folder = (name: string) => ({ name, id: null });
const file = (name: string) => ({ name, id: "00000000-0000-0000-0000-0000000000f1" });

// What the Storage API answers for a listing: the folders and files directly under the prefix of the request.
function tree(entries: Record<string, { name: string; id: string | null }[]>): Route {
  return (call) => reply(200, entries[(call.body as { prefix: string }).prefix] ?? []);
}

Deno.test("an erase_user job erases the database rows, purges the nested storage prefix, deletes the auth user and acknowledges", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(erasure(90)),
    "POST /rest/v1/rpc/erase_user": reply(200, true),
    "POST /storage/v1/object/list/passport-documents": tree({
      [USER]: [folder(FOLDER_A), folder(FOLDER_B)],
      [`${USER}/${FOLDER_A}`]: [file("cv.pdf"), file("cert.pdf")],
      [`${USER}/${FOLDER_B}`]: [file("other.png")],
    }),
    "DELETE /storage/v1/object/passport-documents": (call) =>
      reply(200, (call.body as { prefixes: string[] }).prefixes.map((name) => ({ name }))),
    "DELETE /auth/v1/admin/users/{id}": reply(200, {}),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.deepEqual(calls.filter((c) => c.path.startsWith("/rest/v1/rpc/erase_user")).map((c) => c.body), [{
    p_user_id: USER,
  }]);
  assert.deepEqual(calls.filter((c) => c.method === "DELETE" && c.path.startsWith("/storage/")).map((c) => c.body), [
    { prefixes: [`${USER}/${FOLDER_A}/cv.pdf`, `${USER}/${FOLDER_A}/cert.pdf`, `${USER}/${FOLDER_B}/other.png`] },
  ]);
  assert.deepEqual(calls.filter((c) => c.path === `/auth/v1/admin/users/${USER}`).map((c) => c.method), ["DELETE"]);
  const order = calls.map((c) => c.path.split("/").slice(3, 5).join("/"));
  assert.ok(order.indexOf("rpc/erase_user") < order.indexOf("object/list"), "the database part comes first");
  assert.ok(
    calls.findIndex((c) => c.path.startsWith("/storage/") && c.method === "DELETE") <
      calls.findIndex((c) => c.path === `/auth/v1/admin/users/${USER}`),
    "the files go before the auth user",
  );
  assert.deepEqual(acks(calls), [{
    p_msg_id: 90,
    p_result: { profile_erased: 1, objects_removed: 3, auth_user_deleted: 1 },
  }]);
});

Deno.test("a repeated erase_user job finishes the files and the auth user and reports that nothing was left in the database", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(erasure(91)),
    "POST /rest/v1/rpc/erase_user": reply(200, false),
    "POST /storage/v1/object/list/passport-documents": tree({}),
    "DELETE /auth/v1/admin/users/{id}": reply(404, { code: 404, error_code: "user_not_found", msg: "gone" }),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.equal(calls.filter((c) => c.method === "DELETE" && c.path.startsWith("/storage/")).length, 0);
  assert.deepEqual(acks(calls), [{
    p_msg_id: 91,
    p_result: { profile_erased: 0, objects_removed: 0, auth_user_deleted: 0 },
  }]);
});

Deno.test("a folder with more than one page of files is listed page by page", async () => {
  const pages = [Array.from({ length: 100 }, (_, i) => file(`f${i}.pdf`)), [file("last.pdf")]];
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(erasure(92)),
    "POST /rest/v1/rpc/erase_user": reply(200, true),
    "POST /storage/v1/object/list/passport-documents": (call) => {
      const { prefix, limit, offset } = call.body as { prefix: string; limit: number; offset: number };
      if (prefix === USER) {
        return reply(200, offset === 0 ? [folder(FOLDER_A)] : []);
      }
      assert.equal(limit, 100);
      return reply(200, pages[offset / 100] ?? []);
    },
    "DELETE /storage/v1/object/passport-documents": (call) =>
      reply(200, (call.body as { prefixes: string[] }).prefixes.map((name) => ({ name }))),
    "DELETE /auth/v1/admin/users/{id}": reply(200, {}),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  await handleAccountOps(request(), { client, sharedSecret: SECRET });
  const removals = calls.filter((c) => c.method === "DELETE" && c.path.startsWith("/storage/")).map((c) =>
    (c.body as { prefixes: string[] }).prefixes.length
  );
  assert.deepEqual(removals, [100, 1]);
  assert.equal((acks(calls)[0] as { p_result: { objects_removed: number } }).p_result.objects_removed, 101);
});

Deno.test("when erase_user refuses (cooling-off, legal hold) nothing else is touched and the job stays queued", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(erasure(93)),
    "POST /rest/v1/rpc/erase_user": reply(400, {
      code: "P0001",
      message: "CHARA_FORBIDDEN",
      details: "legal_hold",
      hint: null,
    }),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 0, failed: 1 });
  assert.equal(calls.filter((c) => c.path.startsWith("/storage/") || c.path.startsWith("/auth/")).length, 0);
  assert.deepEqual(acks(calls), []);
});

Deno.test("a failing purge or user deletion leaves the job queued, with the database part already done", async () => {
  for (const failing of ["storage", "auth"]) {
    const { calls, client } = harness({
      "POST /rest/v1/rpc/account_ops_dequeue": jobs(erasure(94)),
      "POST /rest/v1/rpc/erase_user": reply(200, true),
      "POST /storage/v1/object/list/passport-documents": failing === "storage"
        ? reply(500, { statusCode: "500", error: "Internal", message: "boom" })
        : tree({}),
      "DELETE /auth/v1/admin/users/{id}": reply(500, { code: 500, error_code: "unexpected_failure", msg: "boom" }),
    });
    const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
    assert.deepEqual(await response.json(), { processed: 0, failed: 1 }, failing);
    assert.deepEqual(acks(calls), [], failing);
    assert.equal(calls.filter((c) => c.path.startsWith("/auth/")).length, failing === "auth" ? 1 : 0, failing);
  }
});

const ORG = "00000000-0000-0000-0000-00000000c001";
const banBodies = (calls: Call[]) => calls.filter((c) => c.method === "PUT").map((c) => c.body);

Deno.test("a suspend_user job on a suspended profile ends the sessions, sets the ban and is acknowledged", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 80, message: { action: "suspend_user", user_id: USER } }),
    "POST /rest/v1/rpc/account_ops_user_status": reply(200, "suspended"),
    "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 2),
    "PUT /auth/v1/admin/users/{id}": reply(200, { id: USER }),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.deepEqual(banBodies(calls), [{ ban_duration: "876000h" }]);
  assert.deepEqual(acks(calls), [{ p_msg_id: 80, p_result: { banned: 1, sessions_ended: 2 } }]);
});

Deno.test("a reinstate_user job lifts the ban and ends no session", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 81, message: { action: "reinstate_user", user_id: USER } }),
    "POST /rest/v1/rpc/account_ops_user_status": reply(200, "active"),
    "PUT /auth/v1/admin/users/{id}": reply(200, { id: USER }),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.deepEqual(banBodies(calls), [{ ban_duration: "none" }]);
  assert.equal(calls.filter((c) => c.path.endsWith("end_sessions")).length, 0);
  assert.deepEqual(acks(calls), [{ p_msg_id: 81, p_result: { banned: 0, sessions_ended: 0 } }]);
});

Deno.test("a suspension that is taken after the reinstatement queued behind it leaves the user as the profile says", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(
      { msg_id: 82, message: { action: "reinstate_user", user_id: USER } },
      { msg_id: 83, message: { action: "suspend_user", user_id: USER } },
    ),
    "POST /rest/v1/rpc/account_ops_user_status": reply(200, "active"),
    "PUT /auth/v1/admin/users/{id}": reply(200, { id: USER }),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 2, failed: 0 });
  assert.deepEqual(banBodies(calls), [{ ban_duration: "none" }, { ban_duration: "none" }]);
});

Deno.test("a ban job for an account that is gone is a success that touches nothing", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 84, message: { action: "suspend_user", user_id: USER } }),
    "POST /rest/v1/rpc/account_ops_user_status": reply(200, null),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.equal(calls.filter((c) => c.path.startsWith("/auth/")).length, 0);
  assert.deepEqual(acks(calls), [{ p_msg_id: 84, p_result: {} }]);
});

Deno.test("a failing ban leaves the job queued", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({ msg_id: 85, message: { action: "suspend_user", user_id: USER } }),
    "POST /rest/v1/rpc/account_ops_user_status": reply(200, "suspended"),
    "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 1),
    "PUT /auth/v1/admin/users/{id}": reply(500, { code: 500, error_code: "unexpected_failure", msg: "boom" }),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 0, failed: 1 });
  assert.deepEqual(acks(calls), []);
});

Deno.test("a sign_out_organization job ends the sessions of every member and totals them", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs({
      msg_id: 86,
      message: { action: "sign_out_organization", organization_id: ORG },
    }),
    "POST /rest/v1/rpc/account_ops_organization_members": reply(200, [USER, OTHER]),
    "POST /rest/v1/rpc/account_ops_end_sessions": reply(200, 2),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.deepEqual(calls.filter((c) => c.path.endsWith("end_sessions")).map((c) => c.body), [{ p_user_id: USER }, {
    p_user_id: OTHER,
  }]);
  assert.equal(calls.filter((c) => c.path.startsWith("/auth/")).length, 0);
  assert.deepEqual(acks(calls), [{ p_msg_id: 86, p_result: { sessions_ended: 4 } }]);
});

Deno.test("an organisation job without a valid organisation id is never executed or acknowledged", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(
      { msg_id: 87, message: { action: "sign_out_organization", organization_id: "not-a-uuid" } },
      { msg_id: 88, message: { action: "sign_out_organization", user_id: USER } },
    ),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 0, failed: 2 });
  assert.deepEqual(calls.map((c) => c.path), Array(2).fill("/rest/v1/rpc/account_ops_dequeue"));
});
