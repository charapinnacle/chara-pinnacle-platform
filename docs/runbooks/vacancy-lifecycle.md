# Runbook: vacancy lifecycle review

FR-C2, design point D47 (OPEN_QUESTIONS.md). The SOP (Vacancy Lifecycle Management, semi-annual review) measures two KPIs, "average time Open" and "stale Open vacancies (more than 90 days)". Both are read by CHARA staff as the database owner (SQL editor of the project); no screen shows the first, and the second is shown to each organisation as a flag on its own list and vacancy pages.

## 1. Average time Open

Every status change writes one `audit.log` row `job.status_changed` with `from` and `to` in the metadata (the system pause on lapse also carries `actor_fn = 'pause_jobs_on_lapse'` and no actor). A spell of being Open starts at a row whose `to` is `open` and ends at the next row of the same vacancy, whatever it moves the vacancy to; a vacancy still Open counts up to now.

```sql
with changes as (
  select entity_id::uuid as job_id, created_at, metadata ->> 'to' as to_status,
         lead(created_at) over (partition by entity_id order by id) as next_at
  from audit.log
  where action = 'job.status_changed'
)
select
  date_trunc('month', created_at)::date as month_opened,
  count(*) as spells,
  count(next_at) as ended,
  avg(next_at - created_at) as average_time_open_ended,
  avg(coalesce(next_at, now()) - created_at) as average_time_open_including_current
from changes
where to_status = 'open'
group by 1
order by 1 desc;
```

A reopened vacancy has one spell per opening. Spells caused by the system pause end at the pause.

## 2. Stale Open vacancies

`jobs.status_changed_at` is the time of the last change of status, set by the guard trigger. A vacancy is stale when it is Open and the change is more than 90 days old; a Paused, Closed, Filled or Draft vacancy is never stale. The employer sees the flag ("Open for more than 90 days") on the vacancy list and the vacancy page; nothing is sent, because the email catalogue has no reminder kind (the criteria's default).

```sql
select organization_id, id, title, status_changed_at, now() - status_changed_at as open_for
from public.jobs
where status = 'open' and deleted_at is null and status_changed_at < now() - interval '90 days'
order by status_changed_at;
```

The KPI value for the review is the number of stale vacancies against the number of Open ones:

```sql
select
  count(*) filter (where status = 'open' and status_changed_at < now() - interval '90 days') as stale,
  count(*) filter (where status = 'open') as open
from public.jobs
where deleted_at is null;
```

## 3. Close or fill with applications in progress

The Close and Mark as filled dialogs of the vacancy page count the applications of the vacancy that still wait for a decision (stage applied, viewed, shortlisted, interview or offer; `countApplicationsInProgress`, a head-only count answered by the indexes on `job_applications.job_id` and `organization_id`, about 0.2 ms for a vacancy among 200,000 applications) when the page is drawn. When there is at least one, the dialog says "N applications are still in progress" and links to the applicant list filtered to the vacancy (`/org/[slug]/applicants?job=<id>`) before the change is confirmed (FR-C2 AC9, D78). Confirming changes the status only: no application changes stage and no email is queued. Without applications in progress the dialog has no prompt.

## 4. Cost

Both queries are monthly, offline and read the whole of `public.jobs` or the `job.status_changed` rows of `audit.log`, which grow by a few rows per vacancy; run them outside peak hours when either has millions of rows. The employer-facing flag is computed from the rows the list and the page already read, so it adds no query.

Record the month, the two KPI values and any decision (for example a reminder email, which needs an email kind first) in the ticket for the review.
