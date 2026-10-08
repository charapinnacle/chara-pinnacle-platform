import type { SupabaseClient } from "@supabase/supabase-js";
import { isNotificationKind, renderEmail } from "../../../apps/web/emails/index.tsx";
import { hasSharedSecret } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";
import { type Provider, ProviderError } from "./providers.ts";
import { deliveryEvent, verifySignature } from "./webhook.ts";

const BATCH_SIZE = 25;
const CONCURRENCY = 5;
const TIME_BUDGET_MS = 90_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NotifyDeps {
  client: SupabaseClient;
  provider: Provider;
  from: string;
  siteUrl: string;
  sharedSecret: string;
  webhookSecret: string;
  sleep: (ms: number) => Promise<void>;
  alert: (alert: string, detail: Record<string, unknown>) => void;
}

interface Message {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  recipient: string;
  attempt: number;
}

interface Batch {
  depth: number;
  threshold: number;
  delays: number[];
  messages: Message[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBatch(data: unknown): Batch | null {
  if (!isObject(data) || !Array.isArray(data.messages) || !Array.isArray(data.retry_delays)) {
    return null;
  }
  const { queue_depth: depth, backlog_threshold: threshold } = data;
  if (typeof depth !== "number" || typeof threshold !== "number") {
    return null;
  }
  const delays = data.retry_delays.filter((n): n is number => typeof n === "number" && n >= 0);
  const messages: Message[] = [];
  for (const row of data.messages) {
    if (
      isObject(row) && typeof row.notification_id === "string" && UUID.test(row.notification_id) &&
      typeof row.kind === "string" && isObject(row.payload) && typeof row.recipient === "string" &&
      typeof row.attempt === "number"
    ) {
      messages.push({
        id: row.notification_id,
        kind: row.kind,
        payload: row.payload,
        recipient: row.recipient,
        attempt: row.attempt,
      });
    } else {
      console.error("notify skipped a malformed message");
    }
  }
  return { depth, threshold, delays, messages };
}

async function ack(client: SupabaseClient, args: Record<string, unknown>): Promise<boolean> {
  const { error } = await client.rpc("notify_ack", args);
  if (error) {
    console.error("notify_ack failed", { code: error.code });
    return false;
  }
  return true;
}

// The first attempt and one more for each delay, the delay growing; the notification id is the idempotency key on every
// call, so a message read again after a crash is not sent twice. A refusal that would repeat ends the loop at once.
async function sendWithRetries(
  deps: NotifyDeps,
  message: Message,
  delays: number[],
  email: { subject: string; html: string; text: string },
): Promise<{ id: string; attempts: number } | { code: string; attempts: number }> {
  let code = "unknown";
  for (let attempts = 1; attempts <= delays.length + 1; attempts++) {
    try {
      const { id } = await deps.provider.send({
        idempotencyKey: message.id,
        from: deps.from,
        to: message.recipient,
        ...email,
      });
      return { id, attempts };
    } catch (e) {
      const error = e instanceof ProviderError ? e : new ProviderError("send_failed", true);
      code = error.code;
      if (!error.retryable || attempts > delays.length) {
        return { code, attempts };
      }
      await deps.sleep(delays[attempts - 1] * 1000);
    }
  }
  return { code, attempts: delays.length + 1 };
}

async function deliver(deps: NotifyDeps, delays: number[], message: Message): Promise<boolean> {
  if (!isNotificationKind(message.kind)) {
    await ack(deps.client, {
      p_outcome: "failed",
      p_notification_id: message.id,
      p_attempts: 0,
      p_error: "unknown_kind",
    });
    deps.alert("notify_delivery_failed", { notification_id: message.id, kind: message.kind, error: "unknown_kind" });
    return false;
  }
  let email;
  try {
    email = await renderEmail(message.kind, message.payload, deps.siteUrl);
  } catch {
    await ack(deps.client, {
      p_outcome: "failed",
      p_notification_id: message.id,
      p_attempts: 0,
      p_error: "render_failed",
    });
    deps.alert("notify_delivery_failed", { notification_id: message.id, kind: message.kind, error: "render_failed" });
    return false;
  }
  const result = await sendWithRetries(deps, message, delays, email);
  if ("id" in result) {
    return await ack(deps.client, {
      p_outcome: "sent",
      p_notification_id: message.id,
      p_provider_message_id: result.id,
      p_attempts: result.attempts,
    });
  }
  await ack(deps.client, {
    p_outcome: "failed",
    p_notification_id: message.id,
    p_attempts: result.attempts,
    p_error: result.code,
  });
  deps.alert("notify_delivery_failed", {
    notification_id: message.id,
    kind: message.kind,
    attempts: result.attempts,
    error: result.code,
  });
  return false;
}

async function runBatch(deps: NotifyDeps, batch: Batch): Promise<{ sent: number; failed: number }> {
  let next = 0;
  let sent = 0;
  const worker = async () => {
    while (next < batch.messages.length) {
      if (await deliver(deps, batch.delays, batch.messages[next++])) {
        sent++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.messages.length) }, worker));
  return { sent, failed: batch.messages.length - sent };
}

// One call drains the queue in batches until it is empty or the time budget (under the platform's wall clock) is spent.
// A message that is not acknowledged (a crash, a failing acknowledgement) stays invisible and is read again after the
// visibility timeout of the database.
async function runQueue(deps: NotifyDeps): Promise<Response> {
  const deadline = Date.now() + TIME_BUDGET_MS;
  let sent = 0;
  let failed = 0;
  let first = true;
  do {
    const { data, error } = await deps.client.rpc("notify_dequeue", { p_limit: BATCH_SIZE });
    const batch = error ? null : parseBatch(data);
    if (!batch) {
      console.error("notify_dequeue failed", { code: error?.code });
      if (first) {
        return json(502, { error: "unavailable" });
      }
      break;
    }
    if (first && batch.depth > batch.threshold) {
      deps.alert("notify_backlog", { depth: batch.depth, threshold: batch.threshold });
    }
    first = false;
    if (batch.messages.length === 0) {
      break;
    }
    const result = await runBatch(deps, batch);
    sent += result.sent;
    failed += result.failed;
  } while (Date.now() < deadline);
  return json(200, { sent, failed });
}

// Resend calls this with a signed delivery event. The body is read as text because the signature covers its bytes.
async function recordDeliveryEvent(req: Request, deps: NotifyDeps): Promise<Response> {
  const body = await req.text();
  if (!deps.webhookSecret || !await verifySignature(req.headers, body, deps.webhookSecret, Date.now() / 1000)) {
    console.warn("notify refused a delivery event", { reason: "signature" });
    return json(401, { error: "unauthorized" });
  }
  let event;
  try {
    event = deliveryEvent(JSON.parse(body));
  } catch {
    event = null;
  }
  if (event === null) {
    return json(400, { error: "bad_request" });
  }
  if (event === "ignored") {
    return json(200, { recorded: false });
  }
  const { data, error } = await deps.client.rpc("notify_ack", {
    p_outcome: event.outcome,
    p_provider_message_id: event.providerMessageId,
  });
  if (error) {
    // The event can arrive before the send was recorded: 404 makes Resend deliver it again.
    console.error("notify_ack failed for a delivery event", { code: error.code });
    return error.code === "P0002" ? json(404, { error: "not_found" }) : json(502, { error: "unavailable" });
  }
  return json(200, { recorded: data === true });
}

export async function handleNotify(req: Request, deps: NotifyDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  if (req.headers.has("svix-id") || req.headers.has("svix-signature")) {
    return await recordDeliveryEvent(req, deps);
  }
  if (!hasSharedSecret(req, deps.sharedSecret)) {
    console.warn("notify refused a call", { reason: "secret" });
    return json(401, { error: "unauthorized" });
  }
  return await runQueue(deps);
}
