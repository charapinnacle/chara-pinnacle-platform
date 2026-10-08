# Runbook: employer dashboard

FR-E5, design point D61 (OPEN_QUESTIONS.md). The SOP is "Employer Dashboard E2E SOP" (owner Employer member, reviewed twice a year). Queries are run by CHARA staff as the database owner or on the web logs; no screen shows them.

## 1. What is stored

Nothing. Every number is read again on each load of `/[lang]/dashboard/employer?org=<slug>`; there is no table, counter or cache, and the page is served `Cache-Control: private, no-store` (browser test `dashboard-figures.spec.ts`, AC3). The reads (migration `20261029100000_employer_dashboard.sql`):

- Open vacancies: `public.jobs` with `status = 'open'` and `deleted_at is null` for the organisation, under the member row policy (the partial index `jobs_organization_open_idx`). The empty state asks the same table whether the organisation has any vacancy that is not deleted (`jobs_organization_status_idx`).
- Applications by stage and the number made in the last 7 x 24 hours: `public.get_dashboard_applications(org)`, a `security invoker` function, one grouped read of `job_applications` (a bitmap scan on the organisation indexes of FR-E1 together with the candidate index of the other arm of the policy); the row policy of FR-D5 decides what is counted, so a member of another organisation, a candidate, a platform administrator who is no member and a suspended organisation get no row, and `anon` has no EXECUTE.
- Plan card and alerts: `public.get_dashboard_plan(org)`, a `security definer` function that returns the plan name of `private.org_plan_code(org)`, the status (`trialing`, `active`, `past_due` or `free`), `trial_ends_at`, `current_period_end`, `past_due_since` and whether the organisation has subscription rows that are all cancelled. `billing.subscriptions` is readable by owners and admins at aal2 only, and a plain member sees the status as well, so the function reads it for them; it refuses an owner or admin below aal2 (`CHARA_FORBIDDEN`, detail `aal2_required`) and returns neither the provider nor a reference.
- The rules of the alerts are pure functions in `apps/web/lib/dashboard/plan-status.ts`: the trial alert shows when `0 < remaining <= 72 hours`, days are whole and rounded up and never negative, the grace period is `past_due_since` plus 7 days (ARCHITECTURE section 10.1).

## 2. The screen

- `?org=<slug>` must be a slug of an accepted membership of the user, otherwise the page does not exist (`requireOrgRole` with `hideFromOutsiders`; status 200 with the not-found page, as D45). Without it the first organisation of the user is shown. A visitor goes to log in, a candidate to the candidate dashboard.
- An owner or admin below aal2 sees the guided steps and a notice (a link to enter the code when a device exists), not the figures; a plain member sees the figures without two-step verification (D8).
- Each part (the plan alerts, the three cards, the table of stages, the first steps of an empty organisation) waits for its own read behind its own `Suspense`: a skeleton while loading, and on a failed read an error with a toast and Try again (`router.refresh()`) in its place while the other parts show their numbers.
- Links: Open vacancies to `/[lang]/org/[slug]/jobs?status=open` (the vacancy list now filters by status), New applications to `/applicants` (newest first), each stage to `/applicants?stage=<stage>`, the billing page `/[lang]/org/[slug]/billing` (FR-G2, U45; until then it is the not-found page) for owners and admins only.

## 3. KPI: dashboard load time

Each load writes one line to the web server log (`apps/web/lib/dashboard/load-log.ts`): `{"event":"dashboard_load","durationMs":123,"outcome":"ok"}`. The duration runs from the start of the first read to the end of the last, so it is the server time of the data (NFR-P1 target: 95 % within 500 ms); a load in which a read failed is logged as `error` so that it is not missing from the percentile. The line names no organisation, user or number. The 95th percentile of a period is computed from these lines in the log store, for example `jq -s '[.[] | select(.event=="dashboard_load") | .durationMs] | sort | .[(length*0.95|floor)]'` over the lines of the period.

Measured at 10,000 vacancies and 50,000 applications, all applications of one organisation (the worst case, local stack, `EXPLAIN (ANALYZE)` as a member): applications by stage 6 ms for an organisation of 250 applications among the 50,000 (bitmap scan) and 21 ms for one that holds all 50,000 (sequential scan), open vacancies 0.1 ms (bitmap scan on `jobs_organization_open_idx`), any vacancy 0.04 ms, plan 1.8 ms. AC12 (the load test before launch) stays a manual check.

## 4. Controls and how to check them

- Stale or wrong numbers (SOP risk), direct queries (control): the reads above are the only source; pgTAP `075_employer_dashboard.test.sql` pins the counts (open vacancies without paused, draft, closed, filled and deleted; the 7 x 24 hour window at 1 hour, 3 days, 6 days 23 hours, 7 days 1 hour and 30 days; the eight stages; a move shown by the next read), the Vitest tests pin the rules (`plan-status.test.ts`, `dashboard-dal.test.ts`, `dashboard-components.test.tsx`) and the browser tests show the numbers, the cache header and a number that changes after a move.
- No other organisation's data: pgTAP `075` (member of A, of B, of B asking for A, candidate, platform administrator, pending invitation, suspended organisation, anonymous).
- Plan and payment states: pgTAP `075` (trial, active, past due, cancelled, new, paused, aal2, roles) and the browser tests (trial 10 days and 2 days, active, past due, lapsed, new; owner and member).
- Loading and error states: `dashboard-failure.spec.ts` runs in its own project because it locks `job_applications` and withdraws the function from the API role.

## 5. Half-yearly review

1. Run `npm run db:test` and `npm run e2e -w @chara-pinnacle/web -- dashboard` and read the result.
2. Compute the 95th percentile of section 3 for the half-year and compare it with 500 ms; look at the share of `error` lines.
3. Read the open points C11 (what a lapsed organisation may do), C13 (the name of the lowest paid plan, shown from `billing.plans`) and C14/C15 (the free trial offer) and whether CHARA has answered them.
