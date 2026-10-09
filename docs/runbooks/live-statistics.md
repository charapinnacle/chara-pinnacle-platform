# Runbook: live statistics

FR-H4, design point D72 (OPEN_QUESTIONS.md). The SOP is "Public Statistics E2E SOP" (owner Platform, reviewed twice a year). It names one KPI, the refresh success rate, and two controls, the threshold and real data only. Nothing is stored about a visitor.

## 1. What is stored and how it reaches the home page

- `stats.platform_counts_mv` (migration `20261105100000_live_statistics.sql`): one row of exact counts, `active_jobs` (vacancies that are open, visible and not deleted), `employers` (organisations of type employer and status active), `workers` (profiles of account kind worker, status active, not deleted), `countries` (distinct countries of the counted vacancies). No API role has a privilege on it or on the schema `stats`.
- pg_cron job `refresh-platform-counts`, `*/10 * * * *`, runs `refresh materialized view concurrently stats.platform_counts_mv` as `postgres`. The view is populated when the migration runs, so a read works before the first run.
- `public.v_platform_counts` (granted to `anon` and `authenticated`) reads `private.platform_counts()`, a function that runs with the rights of its owner, hides every value below `k` (null) and rounds the candidate count to the nearest 10 after that test. `k` is the setting `stats_min_count` (`private.stats_min_count()`: 5 when the row is missing or is not a whole number from 1 to 999,999,999). The page (`app/[lang]/(public)/page.tsx`, `lib/dal/statistics.ts`) reads the view on each request, shows a tile for each value that is not null, and shows no block at all when there is none.
- The threshold is changed by a reviewed migration (`update private.settings set value = '10' where key = 'stats_min_count'`), never by hand in production. With `k` below 5 a candidate count of 1 to 4 rounds to 0 and is shown as 0; keep `k` at 5 or more.

## 2. KPI: refresh success rate

The runs of the job are in `cron.job_run_details`. The rate of a period:

```sql
select count(*) filter (where d.status = 'succeeded')::numeric / nullif(count(*), 0) as success_rate,
       count(*) filter (where d.status = 'failed') as failed
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname = 'refresh-platform-counts' and d.start_time >= now() - interval '30 days';
```

A failed run keeps the previous snapshot: the page keeps showing the last values and nothing is shown to the visitor (a refresh that fails changes nothing). `cron.job_run_details` is not purged by pg_cron; the audit retention job of the project does not touch it, so trim it by hand once a year if it grows.

## 3. Semi-annual review (SOP frequency)

1. The success rate of the last six months from section 2 (target 100 %; investigate every failed run in `return_message`).
2. The counted sets still match the lifecycle: a new vacancy status, moderation state, account status or organisation type must be added to the definition of the view, with a test in `092_platform_counts_snapshot.test.sql`.
3. `k` (5) and the rounding (10) are still what CHARA wants to publish. A later phase adds the recruitment, staffing and requirement counts of ARCHITECTURE section 9.4 as new columns.
4. The meaning of "countries" is the open question of D72; confirm it with CHARA.

## 4. Manual check (FR-H4 AC11)

In a deployed test environment with a successful snapshot: revoke the privilege of the job owner on a source table (`revoke select on public.jobs from postgres`; every function of the platform that reads vacancies stops too, so do it only where no one works), run the command of the job by hand or wait for the next run, check that the home page still shows the previous values and that `cron.job_run_details` has the run as `failed`, then restore the privilege (`grant select on public.jobs to postgres`) and check that the next run succeeds. Not run against the hosted project in this unit.

## 5. Load

The refresh reads the three counted sets. At 500,000 profiles, 50,000 organisations and 150,000 vacancies (30,000 public) on the local stack the whole query takes about 85 ms: the public vacancies are read through `jobs_public_country_idx`, the profiles and organisations by a (parallel) scan because they are most of their tables. The page reads one row of a one-row view per request; there is no cache, because the data is cheap to read and the page is rendered per request anyway (the content security policy has a nonce).
