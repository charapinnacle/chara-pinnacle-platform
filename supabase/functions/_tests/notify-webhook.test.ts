import assert from "node:assert/strict";
import { handleNotify, type NotifyDeps } from "../notify/handler.ts";
import { nullProvider } from "../notify/providers.ts";
import { type Call, harness, reply, type Route } from "./harness.ts";

const KEY = new Uint8Array(24).map((_, i) => i + 7);
const WEBHOOK_SECRET = `whsec_${btoa(String.fromCharCode(...KEY))}`;

async function sign(id: string, timestamp: number, body: string, key = KEY): Promise<string> {
  const hmac = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

const event = (type: string, data: Record<string, unknown> = { email_id: "re_1" }) => JSON.stringify({ type, data });

async function webhook(body: string, over: Record<string, string | null> = {}): Promise<Request> {
  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string | null> = {
    "svix-id": "msg_1",
    "svix-timestamp": String(timestamp),
    "svix-signature": await sign("msg_1", timestamp, body),
    ...over,
  };
  return new Request("http://stack.test/functions/v1/notify", {
    method: "POST",
    headers: Object.fromEntries(
      Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== null),
    ),
    body,
  });
}

function setup(routes: Record<string, Route | Response> = {}, webhookSecret = WEBHOOK_SECRET) {
  const { calls, client } = harness({ "POST /rest/v1/rpc/notify_ack": reply(200, true), ...routes });
  const deps: NotifyDeps = {
    client,
    provider: nullProvider(),
    from: "CHARA <noreply@chara.example>",
    siteUrl: "https://chara.example",
    sharedSecret: "scheduler-secret",
    webhookSecret,
    sleep: () => Promise.resolve(),
    now: Date.now,
    alert: () => {},
  };
  return { calls, deps };
}

const acks = (calls: Call[]) => calls.filter((c) => c.path.endsWith("notify_ack")).map((c) => c.body);

function logged<T>(run: () => Promise<T>): Promise<{ result: T; lines: unknown[][] }> {
  const lines: unknown[][] = [];
  const { warn, error } = console;
  console.warn = (...args) => lines.push(args);
  console.error = (...args) => lines.push(args);
  return run().then((result) => ({ result, lines })).finally(() => {
    console.warn = warn;
    console.error = error;
  });
}

Deno.test("an event with an invalid or missing signature is refused, changes nothing and is logged without its payload", async () => {
  const body = event("email.delivered", { email_id: "re_secret_payload" });
  const timestamp = Math.floor(Date.now() / 1000);
  const wrongKey = await sign("msg_1", timestamp, body, new Uint8Array(24).fill(1));
  const cases: Record<string, Record<string, string | null>> = {
    "wrong key": { "svix-signature": wrongKey },
    "no signature": { "svix-signature": null },
    "garbage signature": { "svix-signature": "v1,!!!" },
    "other version": { "svix-signature": (await sign("msg_1", timestamp, body)).replace("v1,", "v2,") },
    "no id": { "svix-id": null },
    "no timestamp": { "svix-timestamp": null },
    "stale timestamp": {
      "svix-timestamp": String(timestamp - 310),
      "svix-signature": await sign("msg_1", timestamp - 310, body),
    },
    "future timestamp": {
      "svix-timestamp": String(timestamp + 310),
      "svix-signature": await sign("msg_1", timestamp + 310, body),
    },
    "signature of another id": { "svix-id": "msg_2" },
  };
  for (const [name, over] of Object.entries(cases)) {
    const { calls, deps } = setup();
    const { result, lines } = await logged(async () => handleNotify(await webhook(body, over), deps));
    assert.equal(result.status, 401, name);
    assert.deepEqual(await result.json(), { error: "unauthorized" }, name);
    assert.equal(calls.length, 0, name);
    assert.ok(!JSON.stringify(lines).includes("re_secret_payload"), name);
    assert.deepEqual(lines, [["notify refused a delivery event", { reason: "signature" }]], name);
  }
});

Deno.test("an event with a body changed after signing is refused", async () => {
  const signed = await webhook(event("email.delivered"));
  const tampered = new Request(signed.url, {
    method: "POST",
    headers: signed.headers,
    body: event("email.delivered", { email_id: "re_2" }),
  });
  const { calls, deps } = setup();
  assert.equal((await logged(() => handleNotify(tampered, deps))).result.status, 401);
  assert.equal(calls.length, 0);
});

Deno.test("a function without a webhook secret refuses every event", async () => {
  const { calls, deps } = setup({}, "");
  assert.equal(
    (await logged(async () => handleNotify(await webhook(event("email.delivered")), deps))).result.status,
    401,
  );
  assert.equal(calls.length, 0);
});

Deno.test("a valid signature carried by the scheduler path is not an authentication of the scheduler", async () => {
  const { calls, deps } = setup();
  const request = new Request("http://stack.test/functions/v1/notify", {
    method: "POST",
    body: event("email.delivered"),
  });
  assert.equal((await logged(() => handleNotify(request, deps))).result.status, 401);
  assert.equal(calls.length, 0);
});

Deno.test("a signed delivery event is recorded by the provider message id, and a second delivery changes nothing more", async () => {
  const answers = [true, false];
  const { calls, deps } = setup({ "POST /rest/v1/rpc/notify_ack": () => reply(200, answers.shift()) });
  const first = await handleNotify(await webhook(event("email.delivered")), deps);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { recorded: true });
  const second = await handleNotify(await webhook(event("email.delivered")), deps);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { recorded: false });
  assert.deepEqual(acks(calls), [
    { p_outcome: "delivered", p_provider_message_id: "re_1" },
    { p_outcome: "delivered", p_provider_message_id: "re_1" },
  ]);
});

Deno.test("bounces and complaints map to the outcomes of the database", async () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["email.bounced", { email_id: "re_1", bounce: { type: "Permanent" } }, "bounced_permanent"],
    ["email.bounced", { email_id: "re_1", bounce: { type: "Transient" } }, "bounced_transient"],
    ["email.bounced", { email_id: "re_1", bounce: { type: "Undetermined" } }, "bounced_transient"],
    ["email.bounced", { email_id: "re_1" }, "bounced_transient"],
    ["email.complained", { email_id: "re_1" }, "complained"],
  ];
  for (const [type, data, outcome] of cases) {
    const { calls, deps } = setup();
    const response = await handleNotify(await webhook(event(type, data)), deps);
    assert.equal(response.status, 200, outcome);
    assert.deepEqual(acks(calls), [{ p_outcome: outcome, p_provider_message_id: "re_1" }], outcome);
  }
});

Deno.test("events that change nothing recorded are acknowledged and ignored", async () => {
  for (const type of ["email.sent", "email.delivery_delayed", "email.opened", "email.clicked", "domain.updated"]) {
    const { calls, deps } = setup();
    const response = await handleNotify(await webhook(event(type)), deps);
    assert.equal(response.status, 200, type);
    assert.equal(calls.length, 0, type);
  }
});

Deno.test("a signed event that is not an event, or has no message id, is a 400", async () => {
  for (
    const body of ["not json", "[]", "{}", event("email.delivered", {}), event("email.delivered", { email_id: 7 })]
  ) {
    const { calls, deps } = setup();
    const response = await handleNotify(await webhook(body), deps);
    assert.equal(response.status, 400, body);
    assert.equal(calls.length, 0, body);
  }
});

Deno.test("an event for a notification not recorded yet is a 404 so the provider sends it again; other failures are 502", async () => {
  const notFound = setup({
    "POST /rest/v1/rpc/notify_ack": reply(404, {
      code: "P0002",
      message: "CHARA_NOT_FOUND",
      details: null,
      hint: null,
    }),
  });
  assert.equal(
    (await logged(async () => handleNotify(await webhook(event("email.delivered")), notFound.deps))).result.status,
    404,
  );
  const down = setup({
    "POST /rest/v1/rpc/notify_ack": reply(500, { code: "XX000", message: "db down", details: null, hint: null }),
  });
  const { result, lines } = await logged(async () => handleNotify(await webhook(event("email.delivered")), down.deps));
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { error: "unavailable" });
  assert.ok(!JSON.stringify(lines).includes("db down"));
});
