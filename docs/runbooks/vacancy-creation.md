# Runbook: vacancy creation review

FR-C1, design point D45 (OPEN_QUESTIONS.md). The SOP (Vacancy Creation, semi-annual review) measures two KPIs, "vacancies published within 1 day of creation" and "validation error rate". Both are read from the audit log and the vacancies table by CHARA staff as the database owner (SQL editor of the project); no screen shows them.

## 1. Vacancies published within 1 day of creation

`jobs.created_at` is the creation time. The publication time is the first `audit.log` row `job.updated` whose metadata has `status_to = 'open'`: the audit trigger of `public.jobs` writes it for every status change, whatever changed the status (the lifecycle of FR-C2 writes the status, the trigger records it). A vacancy that was never opened has no such row and counts as not published.

```sql
with first_open as (
  select entity_id::uuid as job_id, min(created_at) as published_at
  from audit.log
  where action = 'job.updated' and metadata ->> 'status_to' = 'open'
  group by 1
)
select
  date_trunc('month', j.created_at)::date as month,
  count(*) as created,
  count(f.published_at) as published,
  round(100.0 * count(*) filter (where f.published_at - j.created_at <= interval '1 day') / nullif(count(*), 0), 1)
    as published_within_1_day_pct
from public.jobs j
left join first_open f on f.job_id = j.id
group by 1
order by 1 desc;
```

A deleted vacancy (owner only, no screen in Phase 1) leaves the table, so it leaves both counts; its `job.created` and `job.deleted` rows stay in the audit log.

## 2. Validation error rate

The web tier reports every submission of the new-vacancy form that was refused, with the names of the fields at fault and nothing they held (`public.record_job_form_invalid`, action `job.form_invalid`); every accepted submission is a `job.created` row. The rate is the share of refused submissions. One person who corrects a form three times counts three refused submissions and one accepted. The call stops writing after `job_form_invalid_per_hour_max` (120) reports per user and hour, a setting in `private.settings`, so the rate reads low only for someone who submits an invalid form more than twice a minute.

```sql
select
  date_trunc('month', created_at)::date as month,
  count(*) filter (where action = 'job.form_invalid') as refused_submissions,
  count(*) filter (where action = 'job.created') as accepted_submissions,
  round(100.0 * count(*) filter (where action = 'job.form_invalid') / nullif(count(*), 0), 1) as validation_error_rate_pct
from audit.log
where action in ('job.form_invalid', 'job.created')
group by 1
order by 1 desc;
```

Which fields fail most often (the same rows, one row per field):

```sql
select f as field, count(*) as refusals
from audit.log, jsonb_array_elements_text(metadata -> 'fields') as f
where action = 'job.form_invalid'
group by 1
order by 2 desc;
```

The field names are those of the form (`title`, `salaryMin`, `occupation`, and so on).

## 3. Cost

Both queries read `audit.log` by `action`; the table is indexed by time and, for `job.form_invalid`, by `(actor_id, created_at)` (the throttle). They are monthly, offline queries over a table that grows by a few rows per vacancy; run them outside peak hours when the log has millions of rows.

Record the month, the two KPI values and any decision (for example a field label that is often refused) in the ticket for the review.
