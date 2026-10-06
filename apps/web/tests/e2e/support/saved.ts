import { execute, executeAsync, literal, query } from "./db";

export const SAVED_URL = "/en/saved";

// A saved row as the candidate would have made it, written by the database owner so that a test can date it.
export function seedSaved(userId: string, jobId: string, createdAt = "now()"): void {
  execute(
    `insert into public.saved_jobs (worker_user_id, job_id, created_at) values (${literal(userId)}, ${literal(jobId)}, ${createdAt})`,
  );
}

// The vacancies a candidate has saved, most recently saved first.
export function savedJobIds(userId: string): string[] {
  return query<{ job_id: string }>(
    `select job_id from public.saved_jobs where worker_user_id = ${literal(userId)} order by created_at desc, job_id desc`,
  ).map(({ job_id }) => job_id);
}

export function savedAuditCount(userId: string, jobId: string): number {
  const [row] = query<{ count: number }>(
    `select count(*)::int as count from audit.log
     where action = 'saved_job.created' and actor_id = ${literal(userId)} and entity_id = ${literal(jobId)}`,
  );
  return row.count;
}

// One save as the Data API makes it: a session of the candidate that holds its transaction open for half a second after
// the insert, so that a second session saving the same vacancy meets the uncommitted row.
export function saveInSession(userId: string, jobId: string): Promise<string> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated", aal: "aal1" });
  return executeAsync(
    `begin;
     select set_config('request.jwt.claims', ${literal(claims)}, true);
     set local role authenticated;
     insert into public.saved_jobs (worker_user_id, job_id) values (${literal(userId)}, ${literal(jobId)})
       on conflict (worker_user_id, job_id) do nothing;
     select pg_sleep(0.5);
     commit;`,
  );
}
