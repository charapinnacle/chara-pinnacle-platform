import { execute, literal, query } from "./db";

export function profileState(userId: string) {
  const [row] = query<{ status: string; deleted_at: string | null; legal_hold: boolean }>(
    `select status::text, deleted_at::text, legal_hold from public.profiles where id = ${literal(userId)}`,
  );
  return row;
}

// The messages the notify function of a later unit will send, which is where the emails of FR-B6 wait until it exists.
export function queuedNotifications(kind: string, userId?: string) {
  return query<{ message: Record<string, unknown> }>(
    `select message from pgmq.q_notifications
     where message ->> 'kind' = ${literal(kind)} ${userId ? `and message ->> 'user_id' = ${literal(userId)}` : ""} order by msg_id`,
  ).map((row) => row.message);
}

export function closureAudit(userId: string, action: string): number {
  const [row] = query<{ n: number }>(
    `select count(*)::int as n from audit.log where action = ${literal(action)} and entity_id = ${literal(userId)}`,
  );
  return row.n;
}

// The request is made through the page; the 30 days are moved by SQL so that the test does not wait for them.
export function backdateRequest(userId: string, interval: string): void {
  execute(`update public.profiles set deleted_at = now() - interval ${literal(interval)} where id = ${literal(userId)}`);
}

// What the daily pg_cron job does.
export function runErasureJob(): number {
  return Number(execute("select private.queue_account_erasures()").trim());
}

export function erasureJobs(userId: string): number {
  const [row] = query<{ n: number }>(
    `select count(*)::int as n from pgmq.q_account_ops
     where message ->> 'action' = 'erase_user' and message ->> 'user_id' = ${literal(userId)}`,
  );
  return row.n;
}

// Every place of the audit log where the user id could still stand.
export function auditRowsNaming(userId: string): number {
  const [row] = query<{ n: number }>(
    `select count(*)::int as n from audit.log
     where actor_id = ${literal(userId)} or entity_id = ${literal(userId)} or metadata::text like ${literal(`%${userId}%`)}`,
  );
  return row.n;
}
