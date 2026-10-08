import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSharedSecret } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";

const BATCH_SIZE = 100;
const CONCURRENCY = 5;
// Members whose sessions are ended at the same time.
const MEMBER_CHUNK = 10;
const TIME_BUDGET_MS = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCUMENT_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BUCKET_ID = /^[a-z0-9-]{1,63}$/;
const OBJECT_PATH = /^[A-Za-z0-9._/-]{1,300}$/;
const PASSPORT_BUCKET = "passport-documents";
const LIST_PAGE = 100;
// Objects sit at {user}/{document}/{file}; the walk goes a level deeper than that and no further.
const MAX_DEPTH = 3;
// A suspension bans the account for a hundred years; a reinstatement lifts the ban.
const BAN_DURATION = "876000h";

type Job =
  | { msgId: number; action: "sign_out_organization"; organizationId: string }
  | { msgId: number; action: "fan_out_legal_version"; documentSlug: string; version: number }
  | (
    & { msgId: number; userId: string }
    & (
      | { action: "sign_out" | "reset_mfa" | "erase_user" | "suspend_user" | "reinstate_user" }
      | { action: "delete_object"; bucketId: string; path: string }
    )
  );

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
  const {
    action,
    user_id: userId,
    organization_id: organizationId,
    document_slug: documentSlug,
    version,
    bucket_id: bucketId,
    path,
  } = message as {
    action?: unknown;
    user_id?: unknown;
    organization_id?: unknown;
    document_slug?: unknown;
    version?: unknown;
    bucket_id?: unknown;
    path?: unknown;
  };
  if (action === "sign_out_organization") {
    return typeof organizationId === "string" && UUID.test(organizationId) ? { msgId, action, organizationId } : null;
  }
  if (action === "fan_out_legal_version") {
    return typeof documentSlug === "string" && DOCUMENT_SLUG.test(documentSlug) && documentSlug.length <= 60 &&
        typeof version === "number" && Number.isInteger(version) && version > 0
      ? { msgId, action, documentSlug, version }
      : null;
  }
  if (typeof userId !== "string" || !UUID.test(userId)) {
    return null;
  }
  if (
    action === "sign_out" || action === "reset_mfa" || action === "erase_user" || action === "suspend_user" ||
    action === "reinstate_user"
  ) {
    return { msgId, action, userId };
  }
  // An object is only ever removed from the folder of the user the job names.
  if (
    action === "delete_object" && typeof bucketId === "string" && BUCKET_ID.test(bucketId) &&
    typeof path === "string" &&
    OBJECT_PATH.test(path) && path.startsWith(`${userId}/`)
  ) {
    return { msgId, action, userId, bucketId, path };
  }
  return null;
}

async function endSessions(client: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await client.rpc("account_ops_end_sessions", { p_user_id: userId });
  if (error) {
    throw error;
  }
  return Number(data);
}

// The ban follows the status the profile has when the job runs, so a suspension and a reinstatement that were queued
// together end as the profile says in whatever order they are taken. A banned user cannot refresh a session, and the
// sessions that exist are ended with the ban.
async function syncBan(client: SupabaseClient, userId: string): Promise<Record<string, number>> {
  const { data, error } = await client.rpc("account_ops_user_status", { p_user_id: userId });
  if (error) {
    throw error;
  }
  if (data === null) {
    return {};
  }
  const suspended = data === "suspended";
  const sessionsEnded = suspended ? await endSessions(client, userId) : 0;
  const result = await client.auth.admin.updateUserById(userId, { ban_duration: suspended ? BAN_DURATION : "none" });
  if (result.error && result.error.status !== 404) {
    throw result.error;
  }
  return { banned: suspended ? 1 : 0, sessions_ended: sessionsEnded };
}

async function endOrganizationSessions(client: SupabaseClient, organizationId: string): Promise<number> {
  const { data, error } = await client.rpc("account_ops_organization_members", { p_org: organizationId });
  if (error) {
    throw error;
  }
  const members = data as string[];
  let ended = 0;
  for (let i = 0; i < members.length; i += MEMBER_CHUNK) {
    const counts = await Promise.all(members.slice(i, i + MEMBER_CHUNK).map((userId) => endSessions(client, userId)));
    ended += counts.reduce((sum, count) => sum + count, 0);
  }
  return ended;
}

// The emails of a new legal version, one page of users at a time, each page its own transaction. The database skips a
// user who already has the email, so a job that is read again after a failure or a timeout queues nothing twice.
async function fanOutLegalVersion(client: SupabaseClient, slug: string, version: number): Promise<number> {
  let queued = 0;
  let after: string | null = null;
  for (;;) {
    const { data, error } = await client.rpc("account_ops_fan_out_legal_version", {
      p_slug: slug,
      p_version: version,
      p_after: after,
    });
    if (error) {
      throw error;
    }
    const [page] = data as { last_id: string; queued: number }[];
    if (!page) {
      return queued;
    }
    queued += page.queued;
    after = page.last_id;
  }
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

// Removing an object that is already gone succeeds, so a second run changes nothing.
async function removeObjects(client: SupabaseClient, bucketId: string, paths: string[]): Promise<number> {
  const { data, error } = await client.storage.from(bucketId).remove(paths);
  if (error) {
    throw error;
  }
  return data.length;
}

// The Storage API lists one folder at a time; a folder has no id.
async function listObjects(client: SupabaseClient, bucketId: string, prefix: string, depth = 0): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0;; offset += LIST_PAGE) {
    const { data, error } = await client.storage.from(bucketId).list(prefix, { limit: LIST_PAGE, offset });
    if (error) {
      throw error;
    }
    for (const entry of data) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id !== null) {
        paths.push(path);
      } else if (depth < MAX_DEPTH) {
        paths.push(...await listObjects(client, bucketId, path, depth + 1));
      }
    }
    if (data.length < LIST_PAGE) {
      return paths;
    }
  }
}

async function purgePrefix(client: SupabaseClient, bucketId: string, userId: string): Promise<number> {
  const paths = await listObjects(client, bucketId, userId);
  let removed = 0;
  for (let i = 0; i < paths.length; i += LIST_PAGE) {
    removed += await removeObjects(client, bucketId, paths.slice(i, i + LIST_PAGE));
  }
  return removed;
}

// The database part first (it refuses before the cooling-off period has passed or under a legal hold, and a retry after
// it finished returns false), then the files, then the auth user. Each step is safe to repeat, so a crash in between is
// finished by the next read of the job. A user that is already gone (404) is a success.
async function eraseUser(client: SupabaseClient, userId: string): Promise<Record<string, number>> {
  const { data, error } = await client.rpc("erase_user", { p_user_id: userId });
  if (error) {
    throw error;
  }
  const objectsRemoved = await purgePrefix(client, PASSPORT_BUCKET, userId);
  const result = await client.auth.admin.deleteUser(userId);
  if (result.error && result.error.status !== 404) {
    throw result.error;
  }
  return {
    profile_erased: data === true ? 1 : 0,
    objects_removed: objectsRemoved,
    auth_user_deleted: result.error ? 0 : 1,
  };
}

async function run(client: SupabaseClient, job: Job): Promise<Record<string, number>> {
  if (job.action === "sign_out_organization") {
    return { sessions_ended: await endOrganizationSessions(client, job.organizationId) };
  }
  if (job.action === "fan_out_legal_version") {
    return { emails_queued: await fanOutLegalVersion(client, job.documentSlug, job.version) };
  }
  if (job.action === "suspend_user" || job.action === "reinstate_user") {
    return await syncBan(client, job.userId);
  }
  if (job.action === "delete_object") {
    return { objects_removed: await removeObjects(client, job.bucketId, [job.path]) };
  }
  if (job.action === "erase_user") {
    return await eraseUser(client, job.userId);
  }
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
