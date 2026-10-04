import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSharedSecret } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";

const BATCH_SIZE = 100;
const CONCURRENCY = 5;
const TIME_BUDGET_MS = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Job {
  msgId: number;
  action: "sign_out" | "reset_mfa";
  userId: string;
}

interface AccountOpsDeps {
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
  const sessionsEnded = await endSessions(client, job.userId);
  if (job.action === "reset_mfa") {
    return { factors_deleted: await deleteFactors(client, job.userId), sessions_ended: sessionsEnded };
  }
  return { sessions_ended: sessionsEnded };
}

async function finish(client: SupabaseClient, job: Job, result: Record<string, number>): Promise<void> {
  const { error } = await client.rpc("account_ops_ack", { p_msg_id: job.msgId, p_result: result });
  if (error) {
    throw error;
  }
}

function failure(msgId: unknown, action: string, error: unknown): void {
  const { status, code, error_code: errorCode } = (typeof error === "object" && error !== null ? error : {}) as {
    status?: unknown;
    code?: unknown;
    error_code?: unknown;
  };
  const bounded = (value: unknown) => (typeof value === "string" || typeof value === "number" ? value : undefined);
  console.error("account-ops job failed", { msgId, action, status: bounded(status), code: bounded(code ?? errorCode) });
}

async function runJob(deps: AccountOpsDeps, row: unknown): Promise<boolean> {
  const job = parseJob(row);
  if (!job) {
    failure((row as { msg_id?: unknown } | null)?.msg_id, "malformed", null);
    return false;
  }
  try {
    await finish(deps.client, job, await run(deps.client, job));
    return true;
  } catch (e) {
    failure(job.msgId, job.action, e);
    return false;
  }
}

async function runBatch(deps: AccountOpsDeps, rows: unknown[]): Promise<{ processed: number; failed: number }> {
  let next = 0;
  let processed = 0;
  const worker = async () => {
    while (next < rows.length) {
      if (await runJob(deps, rows[next++])) {
        processed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return { processed, failed: rows.length - processed };
}

// Every job is idempotent, so a message that is not acknowledged (a failure here, a crash) is simply read again once
// its visibility timeout passes, until the database removes it after account_ops_max_attempts reads. One call drains
// the queue in batches until the time budget (under the platform's wall clock) is spent; a message that failed stays
// invisible, so the loop never reads it twice.
export async function handleAccountOps(req: Request, deps: AccountOpsDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  if (!hasSharedSecret(req, deps.sharedSecret)) {
    return json(401, { error: "unauthorized" });
  }

  const deadline = Date.now() + TIME_BUDGET_MS;
  let processed = 0;
  let failed = 0;
  do {
    const { data, error } = await deps.client.rpc("account_ops_dequeue", { p_limit: BATCH_SIZE });
    if (error || !Array.isArray(data)) {
      failure(null, "dequeue", error);
      if (processed + failed === 0) {
        return json(502, { error: "unavailable" });
      }
      break;
    }
    if (data.length === 0) {
      break;
    }
    const batch = await runBatch(deps, data);
    processed += batch.processed;
    failed += batch.failed;
  } while (Date.now() < deadline);
  return json(200, { processed, failed });
}
