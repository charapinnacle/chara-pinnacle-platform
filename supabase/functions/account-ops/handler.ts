import type { SupabaseClient } from "@supabase/supabase-js";
import { hasBearer, hasSharedSecret } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";

const BATCH_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Job {
  msgId: number;
  action: "sign_out" | "reset_mfa";
  userId: string;
}

export interface AccountOpsDeps {
  client: SupabaseClient;
  sharedSecret: string;
}

function parseJob(row: unknown): Job | null {
  if (typeof row !== "object" || row === null) {
    return null;
  }
  const { msg_id: msgId, message } = row as { msg_id?: unknown; message?: unknown };
  if (typeof msgId !== "number" || typeof message !== "object" || message === null) {
    return null;
  }
  const { action, user_id: userId } = message as { action?: unknown; user_id?: unknown };
  if ((action !== "sign_out" && action !== "reset_mfa") || typeof userId !== "string" || !UUID.test(userId)) {
    return null;
  }
  return { msgId, action, userId };
}

async function endSessions(client: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await client.rpc("account_ops_end_sessions", { p_user_id: userId });
  if (error) {
    throw error;
  }
  return Number(data);
}

// A factor that is already gone (a second run, or a user who removed it) is not an error.
async function deleteFactors(client: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await client.auth.admin.mfa.listFactors({ userId });
  if (error) {
    throw error;
  }
  let deleted = 0;
  for (const factor of data.factors) {
    const result = await client.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (!result.error) {
      deleted++;
    } else if (result.error.status !== 404) {
      throw result.error;
    }
  }
  return deleted;
}

async function run(client: SupabaseClient, job: Job): Promise<Record<string, number>> {
  if (job.action === "reset_mfa") {
    const factorsDeleted = await deleteFactors(client, job.userId);
    return { factors_deleted: factorsDeleted, sessions_ended: await endSessions(client, job.userId) };
  }
  return { sessions_ended: await endSessions(client, job.userId) };
}

async function finish(client: SupabaseClient, job: Job, result: Record<string, number>): Promise<void> {
  const { error } = await client.rpc("account_ops_ack", { p_msg_id: job.msgId, p_result: result });
  if (error) {
    throw error;
  }
}

function failure(msgId: unknown, action: string, error: unknown): void {
  console.error("account-ops job failed", { msgId, action, error: error instanceof Error ? error.name : "error" });
}

// Every job is idempotent, so a message that is not acknowledged (a failure here, a crash) is simply read again once
// its visibility timeout passes, until the database archives it after account_ops_max_attempts reads.
export async function handleAccountOps(req: Request, deps: AccountOpsDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  if (!hasBearer(req) || !hasSharedSecret(req, deps.sharedSecret)) {
    return json(401, { error: "unauthorized" });
  }

  const { data, error } = await deps.client.rpc("account_ops_dequeue", { p_limit: BATCH_SIZE });
  if (error || !Array.isArray(data)) {
    failure(null, "dequeue", error);
    return json(502, { error: "unavailable" });
  }

  let processed = 0;
  let failed = 0;
  for (const row of data) {
    const job = parseJob(row);
    if (!job) {
      failed++;
      failure((row as { msg_id?: unknown } | null)?.msg_id, "malformed", null);
      continue;
    }
    try {
      await finish(deps.client, job, await run(deps.client, job));
      processed++;
    } catch (e) {
      failed++;
      failure(job.msgId, job.action, e);
    }
  }
  return json(200, { processed, failed });
}
