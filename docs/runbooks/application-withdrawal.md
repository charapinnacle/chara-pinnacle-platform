# Runbook: application withdrawal

FR-D4, design point D55 (OPEN_QUESTIONS.md). The SOP is "Application Withdrawal E2E" (owner Candidate, reviewed annually). Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them and no staff role can read an application through the application.

## 1. What is stored

- `public.job_applications.status` becomes `withdrawn` (final). Only `public.withdraw_application(p_application_id)` makes the move for the candidate; the guard `applications_guard_transition` of FR-D2 lists it as the one function that may move a non-final application to Withdrawn.
- `public.application_events`: one row `from_status` (the stage before) `-> withdrawn`, `actor_id` the candidate, no note.
- `public.passport_shares.revoked_at`: set in the same transaction, so the employer's access to the documents ends with the withdrawal. `document_access_grant` refuses a revoked share, and refuses to write an access-log row for the refusal (D16).
- `public.consents`: one `withdrawn` row with the purpose and the version of the share's granted row. The purpose is `share_passport:<organisation id>:<application id>`, so the ledger of one application is its own and withdrawing it leaves the candidate's other shares to the same organisation open (AC11).
- `audit.log`: `application.withdrawn` (entity = the application, metadata `organization_id`, `from`, `to`; never the cover note) and `share.revoked` (written by the trigger of the share). A withdrawal writes no `application.status_changed` row.
- The pgmq queue `notifications`: one `status_changed` message for the candidate (`status: withdrawn`, ids only). Nothing is queued for the employer: Phase 1 has no employer email for a withdrawal, the employer sees the stage Withdrawn on the applicant page and its history. `notify` (FR-I2, U37) sends the email.
- Nothing is deleted. The application, its events, the share and the ledger stay until the candidate's account is erased (no retention period is defined, `docs/runbooks/applications.md` section 5).

## 2. Rules

- Only the candidate who owns the application can withdraw it. Any other caller (another candidate, an owner, admin or member of the organisation, platform staff) gets `CHARA_NOT_FOUND`; an anonymous caller has no EXECUTE on the function.
- Withdrawal is never blocked by the vacancy (Paused, Closed, Filled, hidden, deleted), the organisation (suspended) or the plan (`free_employer`, lapsed, `entitlements_enforced`): the function does not call `private.assert_org_writable`.
- Hired, Not selected and Withdrawn cannot be withdrawn, and a second call raises `CHARA_INVALID_TRANSITION` and writes nothing. The Server Action treats a second press on an application that is already withdrawn as a success.
- After a withdrawal the candidate can apply again to the vacancy while it is Open: a new application, a new share and a new consent are created, the old share keeps its `revoked_at` (AC10).

## 3. KPI

**Withdrawal rate** (SOP KPI): the share of the applications created in a month that are withdrawn now. Read monthly; a rising rate in one organisation is a signal worth a look (long answer times show in `docs/runbooks/application-status.md`).

```sql
select date_trunc('month', a.created_at)::date as month, count(*) as applications,
       count(*) filter (where a.status = 'withdrawn') as withdrawn,
       round(100.0 * count(*) filter (where a.status = 'withdrawn') / count(*), 1) as rate
from public.job_applications a group by 1 order by 1;
```

The stage the candidate withdrew from is `from_status` of the event (`select from_status, count(*) from public.application_events where to_status = 'withdrawn' group by 1`), and the day of the withdrawal is `created_at` of the same event. pgTAP `063_withdraw_application_shares.test.sql` runs the first query, limited to one month, on four applications of known stages.

## 4. Risk and controls

Risk: lingering access after withdrawal. Controls: the revocation inside the same transaction as the status, and the access tests below. Monthly check (both must return 0):

```sql
-- A withdrawn application whose share is not revoked
select count(*) from public.job_applications a join public.passport_shares s on s.application_id = a.id
where a.status = 'withdrawn' and s.revoked_at is null;
-- A withdrawn application without a withdrawn consent after its granted one (applications withdrawn by the function)
select count(*) from public.job_applications a
join public.passport_shares s on s.application_id = a.id
join public.consents g on g.id = s.consent_id
where a.status = 'withdrawn'
  and not exists (select 1 from public.consents w
                  where w.user_id = g.user_id and w.purpose = g.purpose and w.action = 'withdrawn' and w.id > g.id);
```

The quarterly privacy review of `docs/runbooks/platform-staff.md` lists every opening that fell outside its share at the time, a withdrawal included.

- Transitions, atomicity, actors, never blocked, notification, audit, retention, re-apply, one of two applications: pgTAP `062_withdraw_application.test.sql` and `063_withdraw_application_shares.test.sql`.
- The click-through (dialog, focus, Escape, pending state, double click, the toast, the employer's view, the document link after a withdrawal): browser tests `withdraw-application.spec.ts`, and `apply-failure.spec.ts` for a failing call.
- The decisions of the Server Action and the data layer: Vitest `applications-action.test.ts` and `applications-dal.test.ts`.

## 5. Annual review

1. Run `npm run db:test` and `npm run e2e -w @chara-pinnacle/web -- withdraw-application` (and the project `apply-failure`, which runs last in a full `npm run e2e`) and read the result.
2. Read the withdrawal rate of section 3 for the year and the stages candidates withdraw from.
3. Run the two checks of section 4; both must return 0.
4. Read the open points: the retention period of applications (L6) and the email text for `status_changed` with the state Withdrawn (FR-D6, U38).
