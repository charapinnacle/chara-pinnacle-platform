import { execute, query } from "./db";

interface SnapshotCounts {
  jobs: number;
  employers: number;
  workers: number;
  countries: number;
}

const REAL = "platform_counts_mv_real";

function realIsAside(): boolean {
  return query<{ aside: boolean }>(`select to_regclass('stats.${REAL}') is not null as aside`)[0].aside;
}

// Replaces the snapshot of the home page statistics by one with these exact counts, so that a test does not depend on
// the other data of the database. restoreSnapshot puts the real one back; a run that stopped before it is repaired by the
// next call of either.
export function showSnapshot(counts: SnapshotCounts): void {
  if (realIsAside()) execute("drop materialized view stats.platform_counts_mv");
  else execute(`alter materialized view stats.platform_counts_mv rename to ${REAL}`);
  execute(
    `create materialized view stats.platform_counts_mv as
       select ${counts.countries}::integer as countries, ${counts.workers}::integer as workers,
              ${counts.employers}::integer as employers, ${counts.jobs}::integer as active_jobs;
     create unique index platform_counts_stub_key on stats.platform_counts_mv (countries, workers, employers, active_jobs)`,
  );
}

export function restoreSnapshot(): void {
  if (!realIsAside()) return;
  execute(`drop materialized view stats.platform_counts_mv; alter materialized view stats.${REAL} rename to platform_counts_mv`);
}

// The four values of the view: null for a value that is held back.
export function visitorCounts(): { active_jobs: number | null; employers: number | null; workers: number | null; countries: number | null } {
  return query<ReturnType<typeof visitorCounts>>(
    "select active_jobs, employers, workers, countries from public.v_platform_counts",
  )[0];
}
