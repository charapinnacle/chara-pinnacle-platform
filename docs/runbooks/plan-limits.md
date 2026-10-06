# Runbook: plan limits on open vacancies

FR-C6, design point D48 (OPEN_QUESTIONS.md). Platform Administrators own the limit records; CHARA staff read the queries below as the database owner (SQL editor of the project). The SOP (Vacancy Plan Limit Enforcement, quarterly review) has one KPI, upgrade conversions from limit prompts, and one release control, the go-live gate.

## 1. Changing a limit

Limits are rows of `billing.plan_limits` (`limit_key = 'active_jobs'`; null is unlimited, 0 is none) and, for one organisation, rows of `billing.organization_limit_overrides`. There is no editing screen in Phase 1: a limit is changed by a reviewed migration that updates the row, and in the same pull request the seed `supabase/seeds/ref/plans.sql` (so that a rebuilt database matches). The change takes effect with the next publish or reopen, with no code change; every change writes a `billing.plan_changed` audit row. A lower limit never pauses or deletes an open vacancy (keep, not delete): it only blocks the next publish or reopen until the organisation is under the new limit.

## 2. KPI: upgrade conversions from limit prompts

The web tier reports each upgrade prompt it shows (`public.record_job_limit_prompt`); the database records it as one `audit.log` row `limit.prompt_shown` for the organisation, only when the organisation really is at its limit, with the plan, the limit and the open count at that time (at most 30 per user and hour, setting `limit_prompt_per_hour_max`). An organisation has converted when it is on a plan with a higher `active_jobs` limit (or none) than the one it was prompted at, at the time of the review.

```sql
with prompted as (
  select entity_id::uuid as organization_id,
         date_trunc('quarter', min(created_at))::date as first_prompted_in,
         max((metadata ->> 'limit')::integer) as limit_at_prompt
  from audit.log
  where action = 'limit.prompt_shown'
  group by entity_id
)
select
  first_prompted_in,
  count(*) as organisations_prompted,
  count(*) filter (
    where private.org_limit(organization_id, 'active_jobs') is null
       or private.org_limit(organization_id, 'active_jobs') > limit_at_prompt
  ) as converted
from prompted
group by first_prompted_in
order by first_prompted_in desc;
```

A lapsed organisation has a limit of 0 and does not count as converted. The prompt rows grow by at most a few per organisation and day; the query reads them all, so run it quarterly. Record the quarter, the two numbers and any decision (for example a change of limits, section 1) in the ticket for the review.

## 3. Go-live gate

Limit enforcement (`private.settings.entitlements_enforced`) is `false` until the billing work package switches it on, and it must be true in production before go-live (OPEN_QUESTIONS.md, C11). Export the production settings and run the check; it exits non-zero and names the setting when the value is false or missing, and accepts the stored jsonb `true` and the jsonb string `"true"`.

```sh
psql "$PRODUCTION_DATABASE_URL" -Atc "select jsonb_object_agg(key, value) from private.settings" > settings.json
npm run go-live:check -- settings.json
```

Run it in the release checklist, with the checks of later units that join this script (the Stripe mirror of FR-G1, U45). Delete `settings.json` afterwards: the export holds no secret, but it is configuration of the production database.

Switching enforcement on is one reviewed migration: `update private.settings set value = 'true' where key = 'entitlements_enforced'`. Before it, every organisation on `free_employer` can publish; after it, one without a subscription cannot (limit 0), which is the intended restriction and the reason the plans must be sellable (FR-G2) first.
