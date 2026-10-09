# Runbook: administration console

FR-F1, design point D66 (OPEN_QUESTIONS.md), ARCHITECTURE.md sections 3 and 11. The console is `/[lang]/admin`; the staff roles and the account-ops function it relies on are in `platform-staff.md`.

## 1. Who sees what

| Role | Functions |
|---|---|
| Platform Administrator (`admin`) | Users, Organisations (search and view), Statistics, Legal documents, Audit log, Staff, MFA reset |
| Trust & Safety Administrator (`trust_safety`) | Users, Organisations (search, view, suspend, reinstate), Vacancy moderation (`vacancy-moderation.md`), Suspensions and reinstatements |
| Verification Reviewer | None in Phase 1 |

Every page asks for its role on every request (`requirePlatformRole`): a visitor goes to log in, a user without an active role or a page outside the role is not found (HTTP 404), staff at aal1 go to the MFA page. Every function in the database repeats the check (`private.assert_staff`), so a changed token or a crafted request gains nothing. Plans, limits and settings have no screen in Phase 1: they change by a reviewed migration under `supabase/migrations` (CODEOWNERS), as FR-F1 allows.

## 2. Suspending and reinstating

- A suspension needs a statement of reasons of 10 to 2000 characters. One transaction writes the status, one `moderation_actions` row, one `audit.log` row (`user.suspend`, `user.reinstate`, `organization.suspend`, `organization.reinstate`, and one `job.org_suspend` or `job.org_reinstate` row per vacancy changed), the `account-ops` job and the mandatory email with the reasons.
- A suspended user is signed out and banned by `account-ops` within two minutes; until then the database refuses the user's organisation actions and applications, and the pages send the user to the suspended page.
- A suspended organisation: its visible vacancies become `org_suspended` (hidden ones stay hidden), its members are signed out but not banned, every organisation page shows the suspended notice instead of its vacancies, team and applicants, the members' management actions are refused, and the subscription is not touched. A reinstatement restores exactly the vacancies the suspension hid. No job is queued for it: there is no ban to lift.
- A user who holds a platform role is not suspended from the console; an administrator revokes the role first.

## 3. Publishing a legal document

The form names the current version it showed; a second submit of the same form (another tab, a retry after a timeout) finds a newer version and is refused with `CHARA_CONFLICT`, so one text is never published twice. The publication writes the version and its audit row and queues one `account_ops` job `fan_out_legal_version`. The next run of `account-ops` (the minute job) queues the mandatory email to every active user whose account kind has to accept the document, 1,000 users a page, and `notify` sends them. The job is safe to run again (users who already have the email are skipped); if it fails it stays queued and is read again, and after `account_ops_max_attempts` reads it is abandoned with the audit row `account_ops_abandoned` (entity `legal_document`, `slug:version`), which is the signal to run `select * from public.account_ops_fan_out_legal_version('<slug>', <version>)` pages by hand or to queue the job again with `pgmq.send('account_ops', ...)`. Done jobs leave the audit row `account_ops_done` with `emails_queued`.

## 4. KPIs and the quarterly review

- Actions with a reason recorded (100 %): the query in `audit-log.md` section 3 returns 0.
- Time to resolve reports: Phase 1 has no reports (the report and appeal flow is a later phase), so this KPI starts with it. Until then the time between a suspension and its reinstatement is `moderation_actions` (`account_suspended` against `account_reinstated`, same `target_id`).
- Quarterly access review (operational, not built): the Platform Administrator opens Staff, which lists every active and revoked role with who granted it, the two-step status and the last sign-in, and signs off the list with CHARA; roles of accounts that have not signed in for 90 days are revoked or kept with a reason.

## 5. What the hosted project needs

- The same Vault secrets and the same cron job as for `account-ops` and `notify` (`platform-staff.md`, `transactional-emails.md`); the console adds no secret and no job.
- The console needs the migrations `20261101110000` to `20261101110200`. Not verified against the hosted project: the trigram indexes on `public.profiles` and `public.organizations`.

## 6. Measured

EXPLAIN ANALYZE in a rolled-back transaction with 100,000 users, 20,000 organisations and 500,000 audit rows: part of a display name 13 ms through the trigram index (a page of 25 sorts the hits), an email address 0.05 ms through the unique index of Auth, the first page of the audit log 0.13 ms, a filter on the action 0.3 ms and on the entity 0.07 ms through `log_entity_created_idx`. The organisation search scanned the table (8 ms at 20,000 rows) because the planner prefers it at that size. First-load script of the console pages (uncompressed): 516 KB for the landing, statistics and suspensions pages, 966 to 971 KB for the pages with a form (the forms library and its schema checks). The fan-out of a legal version, measured in a rolled-back transaction with 50,000 candidates: a page of 1,000 users takes 80 to 90 ms, the 50 pages 4.5 s, and a second run over the same users 1.4 s (28 ms a page) because it only finds that the emails exist. The publication itself now writes two rows and a job and does not depend on the number of users (the earlier single call took 9.9 s for 100,000 messages, over the 8 s statement timeout of the API role). One million users take about 1,000 pages and 90 s of database time; a run cut off by the wall clock of the function is read again after its visibility timeout and finds the first pages done in 28 ms each.
