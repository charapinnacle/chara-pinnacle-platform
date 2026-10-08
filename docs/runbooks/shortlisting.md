# Runbook: shortlisting

FR-E4, design point D60 (OPEN_QUESTIONS.md). The SOP is "Shortlisting E2E" (owner Employer member, reviewed annually). Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them.

## 1. What is stored

- Nothing of its own. Shortlisting is the state `shortlisted` of `public.job_applications.status`, reached by `set_application_status` or `bulk_set_application_status` (FR-D2, migrations `20261023100000` and `20261023100100`); there is no flag. The number of shortlisted applicants of a vacancy is `count(*) ... where status = 'shortlisted'`.
- The feature is the row `(plan_code, 'shortlisting')` of `billing.plan_features`, seeded for `employer_starter`, `employer_professional` and `employer_enterprise` (`supabase/seeds/ref/plans.sql`) and for no other plan. Removing the row from a plan, or giving a plan no row, ends shortlisting for the organisations on it at once; no code changes.
- The check is `private.has_feature(organization, 'shortlisting')` in the trigger `applications_guard_transition`, so every path to the state meets it, the database owner's included. It is true while `entitlements_enforced` is false for an organisation that is not lapsed. A lapsed organisation (cancelled subscription) and, with the setting true, an organisation on `free_employer` are read-only and refused earlier with `CHARA_FEATURE_NOT_IN_PLAN`, detail `read_only_free_plan`; a plan without the row is refused with detail `shortlisting`.
- From Shortlisted an applicant moves to Interview, Offer or Not selected only (`private.application_transition_allowed`; open point P17 in OPEN_QUESTIONS.md, default: no way back to Applied or Viewed). Moving back would be one line there, one in `apps/web/lib/applications/stage-machine.ts` and their tests.

## 2. The screens

- `/[lang]/org/[slug]/applicants`: Shortlisted is an option of the stage filter of the list and a column of the board. `get_applicant_access` gives `shortlisting_available`; when it is false and the organisation is not frozen, the page shows the notice "Your plan does not include shortlisting" with a link to the plan page (`/[lang]/org/[slug]/billing`, built with FR-G2), the Shortlisted target is not offered by the move menu, the drag target or the bulk toolbar, and the board column stays visible.
- `/[lang]/org/[slug]/applicants/[applicationId]`: the same notice appears while Shortlisted would otherwise be offered (Applied or Viewed). A move that the database refuses because the plan changed while the dialog was open ends in the message "Your plan does not include shortlisting."

## 3. KPI: shortlist usage by plan

Shortlisting moves and the organisations that made them, by the plan the organisation is on when the query is run (a plan change in the year moves its earlier shortlists to the new plan; no plan is stored with the event):

```sql
select private.org_plan_code(a.organization_id) as plan, count(*) as moves, count(distinct a.organization_id) as organizations
from public.application_events e
join public.job_applications a on a.id = e.application_id
where e.to_status = 'shortlisted' and e.created_at >= now() - interval '1 year'
group by 1 order by 1;
```

Divide `organizations` by the organisations on the plan (`select plan_code, count(*) from billing.subscriptions where status in ('trialing', 'active', 'past_due') group by 1`) for the share of a plan that uses the feature. The query reads a year of events and is run annually by staff, not on a page. pgTAP `074_shortlisting.test.sql` runs it as written.

## 4. Controls and how to check them

- Feature check in the database (SOP control, risk "feature leakage across plans"): pgTAP `074_shortlisting.test.sql` (a plan without the row, a plan code that is in no plan, the trigger against the database owner, the bulk path, the anonymous and the direct update); `055_application_status_access.test.sql` for the lapsed and unenforced cases. The browser test `shortlisting.spec.ts` shows that the refusal reaches the person.
- Seeded plans: pgTAP `023_plans_as_data.test.sql` and `074` (AC3).
- Transitions out of Shortlisted: pgTAP `054_application_status_transitions.test.sql` (all 64 pairs) and `074` (AC5, AC6).

## 5. Annual review

1. Run `npm run db:test` and `npm run e2e -w @chara-pinnacle/web -- shortlisting` and read the result.
2. Run the KPI of section 3. A plan with many organisations and no shortlisting moves points at a plan the feature is missing from, or at employers who do not use the pipeline.
3. Read the open points C16 (shortlisting in all plans) and P17 (moving back) and whether CHARA has answered them.
