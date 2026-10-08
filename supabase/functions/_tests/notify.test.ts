import assert from "node:assert/strict";
import { handleNotify, type NotifyDeps } from "../notify/handler.ts";
import { nullProvider, type Provider, ProviderError } from "../notify/providers.ts";
import { type Call, harness, reply, type Route } from "./harness.ts";

const SECRET = "scheduler-secret";
const ID_1 = "00000000-0000-4000-8000-0000000000a1";
const ID_2 = "00000000-0000-4000-8000-0000000000a2";
const ID_3 = "00000000-0000-4000-8000-0000000000a3";
const APP = "00000000-0000-4000-8000-0000000000b1";
const DELAYS = [2, 6, 18];

function request(headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request("http://stack.test/functions/v1/notify", {
    method,
    headers: { authorization: "Bearer project-jwt", "x-edge-secret": SECRET, ...headers },
    body: method === "POST" ? "{}" : undefined,
  });
}

interface Row {
  notification_id: string;
  kind: string;
  payload: Record<string, unknown>;
  recipient: string;
  attempt: number;
}

const statusRow = (id: string, over: Partial<Row> = {}): Row => ({
  notification_id: id,
  kind: "status_changed",
  payload: { application_id: APP, job_title: "Welder MIG/MAG", status: "interview" },
  recipient: "amina@example.test",
  attempt: 1,
  ...over,
});

function batch(messages: Row[], over: Record<string, unknown> = {}) {
  return { queue_depth: 0, backlog_threshold: 500, retry_delays: DELAYS, messages, failed_closed: [], ...over };
}

// The queue hands out each batch once: later reads are empty, as the visibility timeout makes them for the database.
function dequeues(...batches: unknown[]): Route {
  let next = 0;
  return () => reply(200, batches[next++] ?? batch([]));
}

const acks = (calls: Call[]) => calls.filter((c) => c.path.endsWith("notify_ack")).map((c) => c.body);

function setup(routes: Record<string, Route | Response>, provider: Provider = nullProvider()) {
  const { calls, client } = harness({ "POST /rest/v1/rpc/notify_ack": reply(200, true), ...routes });
  const sleeps: number[] = [];
  let clock = 0;
  const alerts: [string, Record<string, unknown>][] = [];
  const deps: NotifyDeps = {
    client,
    provider,
    from: "CHARA <noreply@chara.example>",
    siteUrl: "https://chara.example",
    sharedSecret: SECRET,
    webhookSecret: "",
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
    alert: (alert, detail) => alerts.push([alert, detail]),
  };
  return { calls, deps, sleeps, alerts };
}

function failing(
  code: string,
  retryable: boolean,
  times = Infinity,
): Provider & { sent: { idempotencyKey: string }[] } {
  const sent: { idempotencyKey: string }[] = [];
  return {
    sent,
    send(email) {
      sent.push(email);
      return Promise.reject(sent.length <= times ? new ProviderError(code, retryable) : undefined);
    },
  };
}

function silenced<T>(run: () => Promise<T>): Promise<T> {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  return run().finally(() => {
    console.warn = warn;
    console.error = error;
  });
}

Deno.test("only POST is served", async () => {
  const { calls, deps } = setup({});
  const response = await handleNotify(request({}, "GET"), deps);
  assert.equal(response.status, 405);
  assert.equal(calls.length, 0);
});

Deno.test("a scheduler call without the secret or with a wrong one is refused before the database is reached", async () => {
  for (
    const headers of [{ "x-edge-secret": "" }, { "x-edge-secret": `${SECRET}x` }, {
      "x-edge-secret": "scheduler-secreT",
    }]
  ) {
    const { calls, deps } = setup({});
    const response = await silenced(() => handleNotify(request(headers), deps));
    assert.equal(response.status, 401, JSON.stringify(headers));
    assert.deepEqual(await response.json(), { error: "unauthorized" });
    assert.equal(calls.length, 0);
  }
  const { calls, deps } = setup({});
  const noHeader = new Request("http://stack.test/functions/v1/notify", { method: "POST", body: "{}" });
  assert.equal((await silenced(() => handleNotify(noHeader, deps))).status, 401);
  assert.equal(calls.length, 0);
});

Deno.test("a refused call is logged without its payload", async () => {
  const { deps } = setup({});
  const lines: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args) => lines.push(args);
  try {
    await handleNotify(request({ "x-edge-secret": "nope" }), deps);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(lines, [["notify refused a call", { reason: "secret" }]]);
});

Deno.test("an empty queue is a successful run that does nothing", async () => {
  const { calls, deps, alerts } = setup({ "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([])) });
  const response = await handleNotify(request(), deps);
  assert.deepEqual(await response.json(), { sent: 0, failed: 0 });
  assert.deepEqual(calls.map((c) => c.path), ["/rest/v1/rpc/notify_dequeue"]);
  assert.deepEqual(calls[0].body, { p_limit: 10 });
  assert.deepEqual(alerts, []);
});

Deno.test("a message is rendered, sent with the notification id as idempotency key and acknowledged", async () => {
  const provider = nullProvider();
  const { calls, deps, sleeps } = setup(
    { "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([statusRow(ID_1)])) },
    provider,
  );
  const response = await handleNotify(request(), deps);
  assert.deepEqual(await response.json(), { sent: 1, failed: 0 });
  assert.equal(provider.outbox.length, 1);
  const [email] = provider.outbox;
  assert.equal(email.idempotencyKey, ID_1);
  assert.equal(email.to, "amina@example.test");
  assert.equal(email.from, "CHARA <noreply@chara.example>");
  assert.equal(email.subject, "Update on your application for Welder MIG/MAG");
  assert.match(email.html, /Your application for Welder MIG\/MAG is now: Interview\./);
  assert.match(email.text, new RegExp(`https://chara.example/en/applications/${APP}`));
  assert.deepEqual(acks(calls), [{
    p_outcome: "sent",
    p_notification_id: ID_1,
    p_provider_message_id: `null-${ID_1}`,
    p_attempts: 1,
  }]);
  assert.deepEqual(sleeps, []);
});

Deno.test("a provider that keeps failing for a reason that can pass is called 4 times with growing delays, then the message is left in the queue", async () => {
  for (const code of ["resend_http_429", "resend_http_503", "resend_network"]) {
    const provider = failing(code, true);
    const { calls, deps, sleeps, alerts } = setup(
      { "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([statusRow(ID_1)])) },
      provider,
    );
    const response = await silenced(() => handleNotify(request(), deps));
    assert.deepEqual(await response.json(), { sent: 0, failed: 1 });
    assert.equal(provider.sent.length, 4);
    assert.deepEqual(provider.sent.map((e) => e.idempotencyKey), [ID_1, ID_1, ID_1, ID_1]);
    assert.deepEqual(sleeps, [2000, 6000, 18000]);
    assert.ok(sleeps.every((ms, i) => i === 0 || ms > sleeps[i - 1]), "the delays strictly grow");
    assert.deepEqual(acks(calls), [], `${code}: nothing is closed, the message returns after the visibility timeout`);
    assert.deepEqual(
      alerts,
      [["notify_retries_exhausted", { notification_id: ID_1, kind: "status_changed", attempts: 4, error: code }]],
      `${code}: operations are alerted once, after the third retry of the first read`,
    );
  }
});

Deno.test("the read again of a message that keeps failing raises no second retry alert", async () => {
  const provider = failing("resend_http_503", true);
  const { deps, alerts } = setup(
    { "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([statusRow(ID_1, { attempt: 2 })])) },
    provider,
  );
  await silenced(() => handleNotify(request(), deps));
  assert.equal(provider.sent.length, 4);
  assert.deepEqual(alerts, []);
});

Deno.test("a message that the database ended as failed raises the alert with its id, kind and error and nothing else", async () => {
  const { deps, alerts } = setup({
    "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([], {
      failed_closed: [
        { notification_id: ID_1, kind: "status_changed", error: "abandoned" },
        { notification_id: ID_2, kind: "mfa_reset", error: "no_recipient" },
      ],
    })),
  });
  await handleNotify(request(), deps);
  assert.deepEqual(alerts, [
    ["notify_delivery_failed", { notification_id: ID_1, kind: "status_changed", error: "abandoned" }],
    ["notify_delivery_failed", { notification_id: ID_2, kind: "mfa_reset", error: "no_recipient" }],
  ]);
});

Deno.test("no message is started after the time budget; the others stay in the queue", async () => {
  const sent: string[] = [];
  let clock = 0;
  const provider: Provider = {
    send(email) {
      sent.push(email.idempotencyKey);
      clock += 40_000;
      return Promise.resolve({ id: `re_${sent.length}` });
    },
  };
  const ids = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-0000000000c${n}`);
  const { deps } = setup(
    { "POST /rest/v1/rpc/notify_dequeue": dequeues(batch(ids.map((id) => statusRow(id)))) },
    provider,
  );
  deps.now = () => clock;
  const response = await handleNotify(request(), deps);
  assert.equal(sent.length, 2, "two sends of 40 s use the 60 s budget; a worker takes no third message");
  assert.deepEqual(await response.json(), { sent: 2, failed: 3 });
});

Deno.test("a send that works on a retry is recorded with the number of attempts", async () => {
  const sent: string[] = [];
  const provider: Provider = {
    send(email) {
      sent.push(email.idempotencyKey);
      return sent.length < 3
        ? Promise.reject(new ProviderError("resend_network", true))
        : Promise.resolve({ id: "re_1" });
    },
  };
  const { calls, deps, sleeps, alerts } = setup(
    { "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([statusRow(ID_1)])) },
    provider,
  );
  const response = await handleNotify(request(), deps);
  assert.deepEqual(await response.json(), { sent: 1, failed: 0 });
  assert.deepEqual(sleeps, [2000, 6000]);
  assert.deepEqual(acks(calls), [{
    p_outcome: "sent",
    p_notification_id: ID_1,
    p_provider_message_id: "re_1",
    p_attempts: 3,
  }]);
  assert.deepEqual(alerts, []);
});

Deno.test("a refusal that would repeat is not retried", async () => {
  const provider = failing("resend_http_422", false);
  const { calls, deps, sleeps, alerts } = setup(
    { "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([statusRow(ID_1)])) },
    provider,
  );
  await handleNotify(request(), deps);
  assert.equal(provider.sent.length, 1);
  assert.deepEqual(sleeps, []);
  assert.deepEqual(acks(calls), [{
    p_outcome: "failed",
    p_notification_id: ID_1,
    p_attempts: 1,
    p_error: "resend_http_422",
  }]);
  assert.equal(alerts.length, 1);
});

Deno.test("a message read again after a crash is sent with the same key", async () => {
  const provider = nullProvider();
  const { deps } = setup(
    {
      "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([statusRow(ID_1)]), batch([statusRow(ID_1, { attempt: 2 })])),
    },
    provider,
  );
  await handleNotify(request(), deps);
  await handleNotify(request(), deps);
  assert.deepEqual(provider.outbox.map((e) => e.idempotencyKey), [ID_1, ID_1]);
});

Deno.test("an unknown kind is recorded as failed and never sent", async () => {
  const provider = nullProvider();
  const { calls, deps, alerts } = setup(
    { "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([statusRow(ID_1, { kind: "newsletter" })])) },
    provider,
  );
  const response = await handleNotify(request(), deps);
  assert.deepEqual(await response.json(), { sent: 0, failed: 1 });
  assert.equal(provider.outbox.length, 0);
  assert.deepEqual(acks(calls), [{
    p_outcome: "failed",
    p_notification_id: ID_1,
    p_attempts: 0,
    p_error: "unknown_kind",
  }]);
  assert.equal(alerts[0][0], "notify_delivery_failed");
});

Deno.test("a backlog above the threshold raises one alert per run, whatever the number of batches", async () => {
  const { deps, alerts } = setup({
    "POST /rest/v1/rpc/notify_dequeue": dequeues(
      batch([statusRow(ID_1)], { queue_depth: 501 }),
      batch([statusRow(ID_2)], { queue_depth: 476 }),
    ),
  });
  await handleNotify(request(), deps);
  assert.deepEqual(alerts, [["notify_backlog", { depth: 501, threshold: 500 }]]);
});

Deno.test("a depth at the threshold raises no alert", async () => {
  const { deps, alerts } = setup({ "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([], { queue_depth: 500 })) });
  await handleNotify(request(), deps);
  assert.deepEqual(alerts, []);
});

Deno.test("a batch is drained batch by batch until the queue is empty", async () => {
  const provider = nullProvider();
  const { calls, deps } = setup(
    { "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([statusRow(ID_1)]), batch([statusRow(ID_2)]), batch([])) },
    provider,
  );
  const response = await handleNotify(request(), deps);
  assert.deepEqual(await response.json(), { sent: 2, failed: 0 });
  assert.equal(calls.filter((c) => c.path.endsWith("notify_dequeue")).length, 3);
});

Deno.test("a failing acknowledgement counts as a failure and the message is not sent again in the run", async () => {
  const provider = nullProvider();
  const { calls, deps } = setup({
    "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([statusRow(ID_1)])),
    "POST /rest/v1/rpc/notify_ack": reply(500, { code: "XX000", message: "down", details: null, hint: null }),
  }, provider);
  const response = await silenced(() => handleNotify(request(), deps));
  assert.deepEqual(await response.json(), { sent: 0, failed: 1 });
  assert.equal(provider.outbox.length, 1);
  assert.equal(acks(calls).length, 1);
});

Deno.test("a failing dequeue is a 502 that leaks nothing; a malformed answer too", async () => {
  for (
    const route of [
      reply(500, { code: "XX000", message: "password for db", details: null, hint: null }),
      reply(200, { messages: "x" }),
    ]
  ) {
    const { deps } = setup({ "POST /rest/v1/rpc/notify_dequeue": route });
    const response = await silenced(() => handleNotify(request(), deps));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "unavailable" });
  }
});

Deno.test("a malformed message is skipped and the others are sent", async () => {
  const provider = nullProvider();
  const bad = {
    notification_id: "not-a-uuid",
    kind: "status_changed",
    payload: {},
    recipient: "x@example.test",
    attempt: 1,
  };
  const { deps } = setup(
    { "POST /rest/v1/rpc/notify_dequeue": dequeues(batch([bad as Row, statusRow(ID_2)])) },
    provider,
  );
  const response = await silenced(() => handleNotify(request(), deps));
  assert.deepEqual(await response.json(), { sent: 1, failed: 0 });
  assert.deepEqual(provider.outbox.map((e) => e.idempotencyKey), [ID_2]);
});

Deno.test("every kind renders in the runtime of the function", async () => {
  const provider = nullProvider();
  const rows = [
    statusRow(ID_1, {
      kind: "application_received",
      payload: { application_id: APP, job_title: "Welder", org_slug: "acme" },
    }),
    statusRow(ID_2, {
      kind: "trial_ending",
      payload: { trial_ends_at: "2026-11-01", amount_minor: 3900, currency: "EUR" },
    }),
    statusRow(ID_3, {
      kind: "application_received",
      payload: { total: 2, vacancies: [{ job_id: APP, job_title: "Welder", org_name: "Acme", org_slug: "acme", count: 2 }] },
    }),
  ];
  const { deps } = setup({ "POST /rest/v1/rpc/notify_dequeue": dequeues(batch(rows)) }, provider);
  const response = await handleNotify(request(), deps);
  assert.deepEqual(await response.json(), { sent: 3, failed: 0 });
  assert.match(provider.outbox[0].text, new RegExp(`https://chara.example/en/org/acme/applicants/${APP}`));
  assert.match(provider.outbox[1].text, /€39\.00/);
  assert.equal(provider.outbox[2].subject, "Your daily summary of new applications");
  assert.match(provider.outbox[2].text, new RegExp(`https://chara.example/en/org/acme/applicants\\?job=${APP}`));
});
