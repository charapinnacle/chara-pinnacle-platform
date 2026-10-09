import type { SupabaseClient } from "@supabase/supabase-js";
import { json } from "../_shared/http.ts";
import { type BillingProvider, errorCode, type NormalizedEvent } from "../_shared/billing/provider.ts";

const MAX_BODY_BYTES = 1_000_000;

interface BillingWebhookDeps {
  client: SupabaseClient;
  provider: BillingProvider;
  now: () => number;
  // One line per entry. Operations watch the function logs for the key "alert"; the lines hold event ids and codes,
  // never a payload.
  log: (entry: Record<string, unknown>) => void;
}

async function reject(deps: BillingWebhookDeps, reason: string): Promise<void> {
  const provider = deps.provider.name;
  const { error } = await deps.client.rpc("audit_record_external", {
    p_action: "billing.webhook_rejected",
    p_entity_type: "billing_webhook",
    p_entity_id: provider,
    p_metadata: { reason, provider },
  });
  deps.log({ event: "billing_webhook_rejected", provider, reason, ...(error ? { audit: "failed" } : {}) });
}

// Stores one event; its id when stored, null when the database refused or could not be reached.
async function ingest(deps: BillingWebhookDeps, eventId: string, event: NormalizedEvent): Promise<string | null> {
  const { data, error } = await deps.client.rpc("billing_ingest_event", {
    p_provider: deps.provider.name,
    p_provider_event_id: eventId,
    p_kind: event.kind,
    p_payload: event,
    p_signature_valid: true,
    p_provider_created_at: event.providerCreatedAt,
  });
  if (error || typeof data !== "string") {
    deps.log({ alert: "billing_webhook_ingest_failed", event_id: eventId, code: errorCode(error) });
    return null;
  }
  return data;
}

// The status of the stored event after the attempt, or null when the attempt failed: the event stays 'received' and the
// retry job owns it (the database layer applies in one transaction, so nothing was half done).
async function apply(deps: BillingWebhookDeps, id: string, eventId: string): Promise<string | null> {
  const { data, error } = await deps.client.rpc("billing_apply_event", { p_event_id: id });
  if (error || typeof data !== "string") {
    deps.log({ event: "billing_webhook_apply_failed", event_id: eventId, code: errorCode(error) });
    return null;
  }
  return data;
}

// An event older than the stored state is replaced by the state the provider holds now, ingested under an id of its own.
async function applyCurrentState(deps: BillingWebhookDeps, event: NormalizedEvent): Promise<void> {
  const reference = "providerSubscriptionRef" in event ? event.providerSubscriptionRef : undefined;
  if (!reference) {
    return;
  }
  try {
    const fetchedAt = new Date(deps.now());
    const current = await deps.provider.fetchSubscription(reference, fetchedAt);
    if (!current) {
      return;
    }
    const eventId = `refetch:${reference}:${fetchedAt.toISOString()}`;
    const id = await ingest(deps, eventId, current);
    if (id) {
      await apply(deps, id, eventId);
    }
  } catch (e) {
    deps.log({ event: "billing_webhook_refetch_failed", subscription: reference, code: errorCode(e) });
  }
}

export async function handleBillingWebhook(req: Request, deps: BillingWebhookDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) {
    return json(413, { error: "too_large" });
  }
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return json(413, { error: "too_large" });
  }

  const verified = await deps.provider.verifyWebhook(req, rawBody);
  if (!verified.ok) {
    await reject(deps, verified.reason);
    return json(401, { error: "unauthorized" });
  }

  const events = deps.provider.normalize(verified.payload);
  for (const [index, event] of events.entries()) {
    const eventId = index === 0 ? verified.eventId : `${verified.eventId}#${index}`;
    const id = await ingest(deps, eventId, event);
    if (!id) {
      return json(500, { error: "unavailable" });
    }
    if (await apply(deps, id, eventId) === "stale") {
      await applyCurrentState(deps, event);
    }
  }
  return json(200, { received: true });
}
