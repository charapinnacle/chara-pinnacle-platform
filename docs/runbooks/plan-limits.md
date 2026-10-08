# Runbook: plan limits on open vacancies

FR-C6, design point D48 (OPEN_QUESTIONS.md). Platform Administrators own the limit records; CHARA staff read the queries below as the database owner (SQL editor of the project). The SOP (Vacancy Plan Limit Enforcement, quarterly review) has one KPI, upgrade conversions from limit prompts, and one release control, the go-live gate.

## 1. Changing a limit

Limits are rows of `billing.plan_limits` (`limit_key = 'active_jobs'`; null is unlimited, 0 is none) and, for one organisation, rows of `billing.organization_limit_overrides`. There is no editing screen in Phase 1: a limit is changed by a reviewed migration that updates the row, and in the same pull request the seed `supabase/seeds/ref/plans.sql` (so that a rebuilt database matches). The change takes effect with the next publish or reopen, with no code change; every change writes a `billing.plan_changed` audit row. A lower limit never pauses or deletes an open vacancy (keep, not delete): it only blocks the next publish or reopen until the organisation is under the new limit.

## 2. KPI: upgrade conversions from limit prompts

The web tier reports each upgrade prompt it shows (`public.record_job_limit_prompt`); the database records it as one `audit.log` row `limit.prompt_shown` for the organisation, only when the organisation really is at its limit, with the plan, the limit and the open count at that time (at most 30 per user and hour, setting `limit_prompt_per_hour_max`). An organisation has converted when it is on a plan with a higher `active_jobs` limit (or none) than the one it was prompted at, at the time of the review. The database cannot tell that a publish was refused, so an admin who calls the function directly can add up to 30 rows an hour for their own organisation; they inflate the prompted count, so check the actors in `audit.log` when the number looks too high.

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

Limit enforcement (`private.settings.entitlements_enforced`) is `false` until the billing work package switches it on, and it must be true in production before go-live (OPEN_QUESTIONS.md, C11). Export the production settings and run the check; it exits non-zero and names the setting when the value is false or missing, and accepts the stored jsonb `true` and every text the database casts to true (`true`, `t`, `yes`, `y`, `on`, `1`, in any case).

```sh
psql "$PRODUCTION_DATABASE_URL" -Atc "select jsonb_object_agg(key, value) from private.settings" > settings.json
DATABASE_URL="$PRODUCTION_DATABASE_URL" STRIPE_SECRET_KEY=... node scripts/sync-stripe-plans.mjs --export > plans.json
npm run go-live:check -- settings.json plans.json
```

The second file is the export of the sold plans with their limits, stored price and the amount Stripe holds (docs/runbooks/checkout.md, section 3); the same check fails when a sold plan is not mirrored. Run it in the release checklist. Delete both files afterwards: they hold no secret, but they are configuration of the production database.

Switching enforcement on is one reviewed migration: `update private.settings set value = 'true' where key = 'entitlements_enforced'`. Before it, every organisation on `free_employer` can publish; after it, one without a subscription cannot (limit 0), which is the intended restriction and the reason the plans must be sellable (FR-G2) first.
