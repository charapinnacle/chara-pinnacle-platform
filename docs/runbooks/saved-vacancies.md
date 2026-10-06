# Runbook: saved vacancies

FR-C5, design point D51 (OPEN_QUESTIONS.md). The SOP (Saved Vacancies E2E, annual review) names one KPI, "saved-to-applied conversion", one risk (clutter) and two controls (status flags, a clean-up job). Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them and no staff role can read a candidate's saved rows through the application.

## 1. What is stored

- `public.saved_jobs(worker_user_id, job_id, created_at)`: one row per candidate and vacancy while the candidate keeps it. Unsaving deletes the row.
- `audit.log` rows `saved_job.created` (actor = the candidate, entity = the vacancy id): one for every save that added a row. A repeated save adds none. They outlive the saved row, and the erasure of an account (FR-B6) replaces the actor by its pseudonym like every other audit row.
- `audit.log` rows `saved_jobs.cleanup`: one per run of the clean-up, with `days` and `removed` in the metadata.

## 2. KPI: saved-to-applied conversion

The share of saved vacancies that the candidate applied to after saving. A saved row disappears when it is unsaved or cleaned up, so the saves are counted from the audit rows and the applications from `job_applications` (FR-D1, U27: it does not exist before that unit, so the query below runs from U27). A withdrawn application counts as an application: the candidate did act on the save.

```sql
-- Per month of saving: saves, saves followed by an application, and the rate
with saves as (
  select actor_id as worker_user_id, entity_id::uuid as job_id, min(created_at) as saved_at
  from audit.log
  where action = 'saved_job.created' and actor_id is not null
  group by actor_id, entity_id
)
select
  date_trunc('month', s.saved_at)::date as month_saved,
  count(*) as saves,
  count(*) filter (
    where exists (
      select 1 from public.job_applications a
      where a.worker_user_id = s.worker_user_id and a.job_id = s.job_id and a.created_at >= s.saved_at
    )
  ) as applied_after_saving,
  round(100.0 * count(*) filter (
    where exists (
      select 1 from public.job_applications a
      where a.worker_user_id = s.worker_user_id and a.job_id = s.job_id and a.created_at >= s.saved_at
    )
  ) / count(*), 1) as conversion_percent
from saves s
group by 1
order by 1;
```

An account that was erased has its saves under a pseudonym and no applications under that pseudonym, so those saves count as not converted; the share of erased accounts is small and the rate is read as a trend. The queries read the whole of `audit.log`: run them monthly, outside peak hours, and from a replica or after a period filter (`and created_at >= ...`) once the log is large.

The press of Save is also a line `vacancy_action` with `action: "save"` in the log of the web server (the Apply click-through log of `docs/runbooks/vacancy-page.md`), for the share of page views that end in a save.

## 3. Control: status flags

The saved page shows each vacancy as Open, or as "No longer open" (paused, closed or filled), or as "This vacancy is no longer available" (hidden by moderation, suspended with its organisation, deleted). `list_saved_jobs` decides it from the vacancy at the time of each read, so a flag is never older than the page. The browser test `saved-vacancies.spec.ts` (AC7) covers every state; the database test `048_saved_jobs_list.test.sql` (AC6) covers what the function returns for each state, and that nothing moderated is disclosed.

## 4. Control: the clean-up job

`private.cleanup_saved_jobs()` runs daily at 03:47 UTC (pg_cron job `cleanup-saved-jobs`). It deletes the rows of vacancies that are Closed or Filled and whose status last changed more than `saved_job_cleanup_days` days ago (setting in `private.settings`, 90). A vacancy that is reopened starts again from its new `status_changed_at`; Paused and hidden vacancies are flagged but kept. Check it:

```sql
-- The last runs and the rows each removed
select created_at, metadata from audit.log where action = 'saved_jobs.cleanup' order by id desc limit 10;
-- Did the job itself run and succeed
select start_time, status, return_message from cron.job_run_details
where command = 'select private.cleanup_saved_jobs()' order by start_time desc limit 10;
-- Clutter that the job should have removed: must be 0 an hour after a run
select count(*) from public.saved_jobs s join public.jobs j on j.id = s.job_id
where j.status in ('closed', 'filled')
  and j.status_changed_at < now() - make_interval(days => (select (value #>> '{}')::integer from private.settings where key = 'saved_job_cleanup_days'));
```

To change the period, update the setting with a ticketed statement (`update private.settings set value = '60' where key = 'saved_job_cleanup_days'`); the page text does not name the number. A shorter period takes effect at the next run and removes the rows that are older than it at once, without warning to the candidates.

## 5. Annual review

1. Run `npm run e2e -w @chara-pinnacle/web -- saved-vacancies` (and the project `saved-failure`, which runs last in a full `npm run e2e`) and `npm run db:test`, and read the result.
2. Read the KPI of section 2 for the year and the monthly trend.
3. Read the clutter signals: the average number of saved rows per candidate (`select avg(c) from (select count(*) c from public.saved_jobs group by worker_user_id) t`), the share of saved rows whose vacancy is not Open, and the `removed` counts of section 4. A high share of dead rows means the period is too long for CHARA's candidates.
4. Decide with CHARA whether Paused vacancies should also be removed after some period (today they are kept because an employer can reopen them).
