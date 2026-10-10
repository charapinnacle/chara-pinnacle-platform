# Runbook: passport completeness review

FR-B4, design point D41 (OPEN_QUESTIONS.md). The completeness percentage is computed when a page is read and is not stored, so the review of its distribution (SOP FR-B4, step Measure, monthly) is a query over the profile and document data, run by CHARA staff as the database owner (SQL editor of the project). No screen shows it and no staff role can read candidate rows through the application.

## 1. Weights

The weights and their rules are one list in `apps/web/lib/passport/completeness.ts`, shown to the candidate under 'How is this calculated?'. They add up to 100: name and country 10, headline 5, occupation 15, skills 15 (at least 3), languages 10 (at least 1), years of experience 10 (0 counts), availability 10 (any choice), work authorisation 10 (one entry without expiry or expiring today or later), CV 15 (a CV that is not deleted and whose scan status is `clean` or `skipped`). The nudge shows below 60. The TypeScript list is the source. If CHARA changes a weight, change the list, the query below and the copy of the query in `031_completeness.test.sql` together: that pgTAP test (and the Vitest test of the list) check the numbers 10, 55, 85 and 100 for their reference profiles, but neither reads this file, so a query edited here alone is not caught.

## 2. Monthly review

KPIs: median completeness, and the share of profiles at 80 or more. The distribution shows where candidates stop.

```sql
with scores as (
  select
    p.user_id,
    10
    + (btrim(coalesce(p.headline, '')) <> '')::int * 5
    + (p.occupation_id is not null)::int * 15
    + ((select count(*) from public.worker_skills s where s.worker_user_id = p.user_id) >= 3)::int * 15
    + exists (select 1 from public.worker_languages l where l.worker_user_id = p.user_id)::int * 10
    + (p.years_experience is not null)::int * 10
    + (p.availability is not null)::int * 10
    + exists (
      select 1 from public.worker_work_authorizations a
      where a.worker_user_id = p.user_id and (a.expires_on is null or a.expires_on >= (now() at time zone 'utc')::date)
    )::int * 10
    + exists (
      select 1 from public.worker_documents d
      where d.worker_user_id = p.user_id and d.type = 'cv' and d.deleted_at is null
        and d.scan_status in ('clean', 'skipped')
    )::int * 15 as score
  from public.worker_profiles p
)
select
  count(*) as profiles,
  percentile_cont(0.5) within group (order by score) as median,
  round(100.0 * count(*) filter (where score >= 80) / nullif(count(*), 0), 1) as share_at_least_80
from scores;
```

Distribution in bands of ten points (replace the final select of the query above):

```sql
select (score / 10) * 10 as band, count(*) as profiles from scores group by 1 order by 1;
```

To compare cohorts, add `p.created_at` to the `scores` select and group by `date_trunc('month', created_at)`. Indicative local measurement (EXPLAIN ANALYZE as the database owner in a rolled-back transaction on the local stack, 5,000 candidates, 50,000 documents of which a seventh were deleted, 4 skills for 80 percent of the candidates): the whole query ran in about 165 ms, and every lookup used the primary or owner index of its table. It scans every profile, so run it outside peak hours once the table is much larger.

Record the month, the two KPI values and any decision (for example a changed weight) in the ticket for the review.

## Candidate dashboard (U59)

The dashboard of a candidate shows the same meter as the passport (`CompletenessCard`): the percentage, the bar, the next item as the one primary button (it opens the section of the passport), the nine items in two columns when there is room, and the rules. Beside it: the counts of the candidate's applications by stage (`public.my_application_stage_counts()`, all eight stages, zero filled), the three with the latest change (`my_applications` with a limit of 3) linking to the journey tracker, the number of saved vacancies (a count of `saved_jobs` under its row policy), and quick actions. A candidate without an application gets an empty state that names the first step: the occupation when it is missing (an application needs it), otherwise the search. Nothing is stored; no "unread" mark exists, so the dashboard shows when each application last changed instead.
