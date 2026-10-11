# Runbook: vacancy creation review

FR-C1, design points D45 and D47 (OPEN_QUESTIONS.md). The SOP (Vacancy Creation, semi-annual review) measures two KPIs, "vacancies published within 1 day of creation" and "validation error rate". Both are read from the audit log and the vacancies table by CHARA staff as the database owner (SQL editor of the project); no screen shows them.

## 1. Vacancies published within 1 day of creation

`jobs.created_at` is the creation time and `jobs.published_at` the time the vacancy first became Open: the guard trigger of FR-C2 sets it once, at the first change to Open, whatever made the change, and a later pause or reopening does not move it (D47). A vacancy that was never opened has no `published_at` and counts as not published.

```sql
select
  date_trunc('month', j.created_at)::date as month,
  count(*) as created,
  count(j.published_at) as published,
  round(100.0 * count(*) filter (where j.published_at - j.created_at <= interval '1 day') / nullif(count(*), 0), 1)
    as published_within_1_day_pct
from public.jobs j
group by 1
order by 1 desc;
```

A deleted vacancy (owner only, no screen in Phase 1) leaves the table, so it leaves both counts; its `job.created` and `job.deleted` rows stay in the audit log.

## 2. Validation error rate

The web tier reports every submission of the new-vacancy form that was refused, whether the browser refused it before sending or the server refused it (`createJob`: schema failure, or a constraint mapped to a field), with the names of the fields at fault and nothing they held (`public.record_job_form_invalid`, action `job.form_invalid`); every accepted submission is a `job.created` row. A refusal that maps to no field (not allowed, generic failure) is not a form error and is not counted. The rate is the share of refused submissions. One person who corrects a form three times counts three refused submissions and one accepted. The call stops writing after `job_form_invalid_per_hour_max` (30) reports per user and hour, a setting in `private.settings`, so the rate reads low only for someone who submits an invalid form more than once every two minutes.

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

## 3. Editing a vacancy

Owners and admins correct a vacancy at `/[lang]/org/[slug]/jobs/[id]/edit` (links: "Edit" on each row of the vacancy list, "Edit vacancy" on the vacancy page; D78). The page uses the new-vacancy form with the same schema, controlled lists and messages, filled with the stored values. Saving sends the content columns only (`toJobUpdate`): the status, the moderation state, the organisation and the author are not in the update grant and are never sent, so an edit keeps the status and a vacancy hidden by moderation stays hidden (the page says so and links the appeal route). A member gets the forbidden page and sees no edit link; another organisation gets the not-found page; a suspended organisation gets the suspension notice and the policy refuses the update. Each accepted edit writes one `job.updated` row with the names of the changed columns, and the trigger stamps `jobs.updated_at`, so the public page (rendered per request) shows the change at once and the sitemap entry of an open vacancy gets the new `lastmod`.

A refused edit is not reported to `record_job_form_invalid`: the validation error rate of section 2 is the rate of the new-vacancy form, whose accepted submissions are the `job.created` rows. The number of edits per vacancy can be read from the same log:

```sql
select entity_id as job_id, count(*) as edits
from audit.log
where action = 'job.updated'
group by 1
order by 2 desc
limit 100;
```

## 4. Cost

Both queries read `audit.log` by `action`; the table is indexed by time and, for `job.form_invalid`, by `(actor_id, created_at)` (the throttle). They are monthly, offline queries over a table that grows by a few rows per vacancy; run them outside peak hours when the log has millions of rows.

Record the month, the two KPI values and any decision (for example a field label that is often refused) in the ticket for the review.
