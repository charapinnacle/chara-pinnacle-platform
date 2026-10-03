# Group F: Platform administration

## FR-F1 · Administration console

> Platform staff with two-step verification use the console; each role sees only its own functions. A Platform Administrator can search users and organisations, view application statistics (counts only), publish legal document versions, search the audit log, manage platform staff roles, and owns changes to the plan records (FR-G1) and to the legal-entity, privacy-contact, data-protection-contact and retention settings; until the editing screens exist such a change is made by a reviewed migration. A Trust & Safety Administrator can search users and organisations, suspend or reinstate them and hide or unhide vacancies (to be confirmed by CHARA: whether a Platform Administrator may also suspend accounts; whether the screens for editing plans and settings are delivered in Phase 1 or in a later phase).

### Acceptance criteria

**AC1 · Console access and navigation by principal** (browser test (Playwright))

- Given the console at /en/admin and these principals: an anonymous visitor; a signed-in candidate; a signed-in employer owner; a staff member whose platform_staff row has revoked_at set directly in the database while the session is still open; a Platform Administrator (admin) at aal1 with a TOTP factor enrolled; a Platform Administrator at aal2; a Trust & Safety Administrator (trust_safety) at aal2; a Verification Reviewer (verification_reviewer) at aal2
- When each principal requests /en/admin and then one page outside its role's list (/en/admin/audit for the Trust & Safety Administrator, /en/admin/moderation for the Platform Administrator, /en/admin/users for the Verification Reviewer)
- Then anonymous visitor: redirected to /en/login with next=/en/admin (validated next parameter). Candidate, employer owner and revoked staff: the not-found page with HTTP 404 and no console markup; for revoked staff this applies from the first request after revoked_at is set, because the role is looked up on every request. Administrator at aal1: redirected to /en/mfa (enrolment when no factor exists, code entry otherwise) and reaches /en/admin only after the code is verified. Administrator at aal2: navigation has exactly 7 entries: Users, Organisations, Statistics, Legal documents, Audit log, Staff, MFA reset. Trust & Safety Administrator at aal2: exactly 4 entries: Users, Organisations, Vacancy moderation, Suspensions and reinstatements. Verification Reviewer at aal2: one page stating that no functions are available to the role in Phase 1, and no navigation entries. No role has a Plans, Limits or Settings entry. A request for a page outside the role's list returns the not-found page (HTTP 404).

**AC2 · Role and assurance matrix for every Phase 1 administrative function** (database test (pgTAP))

- Given the 15 Phase 1 administrative functions. Administrator only: grant_platform_role, revoke_platform_role, reset_mfa, publish_legal_document, admin_application_counts, admin_search_audit. Trust & Safety only: moderate_job, suspend_user, suspend_organization, reinstate_user, reinstate_organization. Both roles: admin_search_users, admin_search_organizations, admin_get_user, admin_get_organization. Callers: an administrator, a Trust & Safety Administrator and a Verification Reviewer, each at aal2 and at aal1; a staff member whose row has revoked_at set (formerly holding the role the function requires); an authenticated user with no staff row; the anon role
- When each caller calls each function with valid arguments; separately the privileges on billing.plans, billing.plan_limits, billing.plan_features, private.settings and retention_policies are listed for anon, authenticated and service_role and the source of the 15 functions is scanned
- Then only the role named for the function, at aal2 and not revoked, succeeds. Every other authenticated caller gets CHARA_FORBIDDEN (SQLSTATE 42501). The anon role is refused at the privilege check (permission denied for function). A refused call changes no row, writes no audit.log row, queues no account-ops job and creates no notification. No function lets the Verification Reviewer do anything, and none lets the Platform Administrator suspend, reinstate, hide or unhide (default for the open point in note 1). None of the three API roles has INSERT, UPDATE or DELETE on the five configuration tables and none of the 15 functions writes to them; their rows are changed only by a migration file under supabase/migrations.

**AC3 · Console read functions return only whitelisted columns** (database test (pgTAP))

- Given Candidate K with a passport, 2 uploaded documents and 3 applications (each with a cover note, a profile snapshot and a document share); employer organisation O with 1 owner, 1 admin, 1 member, 4 vacancies created by the owner and 5 received applications (statuses applied, applied, viewed, shortlisted, rejected; 3 of them are K's)
- When the administrator calls admin_search_users, admin_get_user and admin_application_counts, and the administrator and the Trust & Safety Administrator call admin_search_organizations and admin_get_organization, for K and O
- Then the returned columns equal this list and nothing else. User search and detail: id, display_name, email, account_kind, status, created_at, memberships (organisation id, name, role) and activity counts (applications_submitted = 3 for K; vacancies_created = 4 for the owner of O). Organisation view: id, display_name, legal_name, slug, status, members (user id, display_name, role, accepted_at) and vacancies (id, title, status, moderation_state); no application counts, so the Trust & Safety Administrator sees none. Application counts: 8 rows (applied, viewed, shortlisted, interview, offer, hired, rejected, withdrawn), zero filled, each with an integer count, for applications created from 00:00:00 UTC of the from day to 23:59:59.999 UTC of the to day: for O's range the counts are applied 2, viewed 1, shortlisted 1, rejected 1, others 0, and the sum is 5. No result contains cover notes, profile snapshots, candidate names or headlines, document titles, file names, storage paths, document counts, application notes or applicant identities; asserted by comparing the result columns with the list. A range with from later than to, or longer than 366 days, raises CHARA_INVALID_INPUT and returns nothing.

**AC4 · Search forms for users, organisations and the audit log** (browser test (Playwright))

- Given the administrator at aal2 with 60 users whose display name starts with 'Test User', 60 organisations whose display name starts with 'Test Org' and 60 audit rows, on /en/admin/users, /en/admin/organizations and /en/admin/audit
- When the administrator types search terms and filters, submits with the Enter key, pages through the results, and the search request fails once (network offline)
- Then a term of 2 characters shows the inline error 'Enter at least 3 characters' and sends no request; the input accepts at most 100 characters. A term of 3 to 100 characters shows a loading skeleton (aria-busy) and then 25 rows ordered by display name then id; Next shows rows 26 to 50 and then 51 to 60, Previous returns. A term with no match ('zzzzqq') shows the empty state 'No users found' (organisations: 'No organisations found'; audit: 'No audit entries match'). A failed request shows an error toast and a Retry button and does not show the earlier rows as results. Users match case-insensitively on display name, email or user id; organisations on display name, legal name or slug. The audit page filters on actor id (uuid; otherwise the error 'Enter a valid user id'), action, entity type, entity id and a from and to date in UTC (a from date after the to date shows 'The start date must not be after the end date'); it has no minimum length, shows 25 rows per page, newest first. Tab order is label, input, Search button, then each row link, and Enter on a row opens its detail; every field has a visible label; error text is linked with aria-describedby; axe reports no violation on the three pages.

**AC5 · Suspend and reinstate a user (database rule)** (database test (pgTAP))

- Given a Trust & Safety Administrator at aal2; active employer user E who owns organisation O with 2 visible vacancies V1 and V2; active candidate C
- When the Trust & Safety Administrator calls suspend_user for E and for C, each with a reason of 25 characters, then reinstate_user for E with a reason of 25 characters
- Then after suspend_user(E), in one transaction: profiles.status = 'suspended'; one moderation_actions row (target_type profile, target_id E, statement_of_reasons = the trimmed reason, actor_id = caller); one audit.log row user.suspend with the reason and the request id; exactly one message in the account-ops queue (sign out globally and set the sign-in ban for E); one mandatory account_suspended notification for E carrying the reason. O stays 'active' and V1 and V2 stay 'visible'. Before the job runs, with an unexpired token of E, create_organization, invite_member for O and a vacancy insert for O raise CHARA_FORBIDDEN, and with an unexpired token of C apply_to_job raises CHARA_FORBIDDEN. After reinstate_user(E): status 'active'; one moderation_actions row and one audit row user.reinstate with the reason; one queue message that lifts the ban; one account_reinstated notification carrying the reinstatement reason.

**AC6 · Suspend and reinstate an organisation (database rule)** (database test (pgTAP))

- Given a Trust & Safety Administrator at aal2; employer organisation O with owner, admin A and member M; vacancies V1 and V2 (open, visible), V3 (open, moderation_state hidden by moderate_job) and V4 (draft, visible); an active subscription row S
- When the Trust & Safety Administrator calls suspend_organization(O, reason of 40 characters), then reinstate_organization(O, reason of 40 characters)
- Then after suspend_organization: organizations.status = 'suspended'; V1, V2 and V4 have moderation_state 'org_suspended' and V3 stays 'hidden'; jobs.status values are unchanged; subscription S is identical (status, plan_code, period fields) and no billing row or queue message is created; one moderation_actions row (target_type organization); one audit row organization.suspend plus one job.org_suspend row per changed vacancy (4 rows, same request id); exactly one account-ops queue message that signs out the owner, A and M globally and sets no sign-in ban; two account_suspended notifications (owner and A, carrying the reason) and none for M. Afterwards set_application_status (as M), invite_member (as A) and a vacancy insert (as the owner) for O raise CHARA_FORBIDDEN, while the same people can still use their own profile and any other organisation. After reinstate_organization: status 'active'; V1, V2 and V4 are 'visible' again and V3 stays 'hidden'; 4 audit rows (organization.reinstate and 3 job.org_reinstate); one queue message that lifts nothing for members (no ban exists); two account_reinstated notifications (owner and A, carrying the reason); S is still identical; access to O works again after a new sign-in.

**AC7 · Reason, target and state validation for moderation functions** (database test (pgTAP))

- Given a Trust & Safety Administrator at aal2 and targets in each state: active and suspended users, active and suspended organisations, visible, hidden and org_suspended vacancies
- When suspend_user, reinstate_user, suspend_organization, reinstate_organization and moderate_job (hide and unhide) are called with a reason that is null, empty, only spaces, 9 characters after trimming, or 2001 characters; with an unknown target id; and with a target already in the requested state
- Then an invalid reason raises CHARA_INVALID_INPUT; exactly 10 and exactly 2000 characters (after trimming) are accepted. An unknown id raises CHARA_NOT_FOUND. Suspending a suspended target, reinstating an active target, hiding a hidden or org_suspended vacancy and unhiding a visible or org_suspended vacancy raise CHARA_INVALID_STATE. In every refused case no status or moderation_state changes and there is no moderation_actions row, audit row, queue message or notification.

**AC8 · User suspension and reinstatement: concurrent submit and what the user experiences** (browser test (Playwright))

- Given Active candidate U signed in in browser 1 with a pending application; Trust & Safety Administrator sessions at aal2 in two tabs on /en/admin/users/<U>, both with the suspend form filled in with the reason 'Repeated fake profile reports'
- When both tabs submit at the same moment (Promise.all in the test) and, separately, the submit button is double-clicked; later one tab reinstates U with the reason 'Identity confirmed after complaint'
- Then exactly one submission succeeds; the other shows 'This account is already suspended' (CHARA_INVALID_STATE); the button is disabled after the first click so a double click sends one request. There is one moderation_actions row, one audit row, one queued job and, within 2 minutes, one account_suspended email in the mail catcher containing the exact reason and no document or application content. U's next request in the open session is refused by the DAL and U is sent to /en/login even though the access token has not expired; when the test deletes the access-token cookie, the refresh fails and U is sent to /en/login; a login with the correct password is refused with 'This account is suspended'. After reinstatement U can sign in with a new session and reach the dashboard; the mail catcher holds one account_reinstated email with the reinstatement reason; the pending application is unchanged.

**AC9 · Organisation suspension and vacancy hiding as employers and candidates experience them** (browser test (Playwright))

- Given Employer organisation O (owner, admin A, member M) with open vacancy V1 and open vacancy V2 that is already hidden by moderation, both published and searchable on /en/jobs before the hiding; a Trust & Safety Administrator at aal2
- When the Trust & Safety Administrator hides V1 with a reason, unhides it, suspends O with a reason, and reinstates O with a reason
- Then Hiding V1: it disappears from /en/jobs search, its public page returns 404, applying is refused, the owner and A each get one vacancy_hidden email with the reason, and M gets none. Unhiding V1: it is searchable again and no email is sent. Suspending O: V1 leaves search and its public page returns 404; V2 stays hidden; owner and A each get one account_suspended email with the reason, M none; M's refresh token is rejected (the test deletes the access-token cookie), M can sign in again and own-account pages work, but /en/org/<slug> shows an 'organisation suspended' page with no applicant, vacancy or billing data. Reinstating O: V1 is searchable again, V2 stays hidden, owner and A each get one account_reinstated email with the reason.

**AC10 · Two-step verification reset by a Platform Administrator** (browser test (Playwright))

- Given a Platform Administrator at aal2 on the MFA reset page; employer administrator U with one verified TOTP factor and active sessions in two browsers
- When the administrator ticks 'I have verified this person's identity', enters a reason of 30 characters and submits; and separately submits with the box unticked, with a 9-character reason, and with the administrator's own user id
- Then within 2 minutes U's TOTP factors are deleted (U's MFA page shows none enrolled) and U's refresh tokens are revoked: when the test deletes the access-token cookie in both browsers, the refresh fails and U is sent to /en/login. U signs in at aal1 and is sent to /en/mfa to enrol again on the first billing, team or applicant page. U receives one mfa_reset email that contains no code and no secret. One audit row mfa.reset records the actor, U, the reason and the request id. The box unticked and the 9-character reason are rejected with field errors and change nothing. The own user id is refused with CHARA_FORBIDDEN and the administrator's factors are untouched.

**AC11 · Publish a legal document version** (database test (pgTAP))

- Given a Platform Administrator at aal2; slug 'privacy-policy' with versions 1 and 2; 40 candidate users, 10 employer users and 1 user whose account_kind is not yet committed; slugs 'terms-of-service', 'worker-terms', 'employer-terms' and 'cookie-policy'
- When the administrator calls publish_legal_document for 'privacy-policy' with a title, a body of 3000 characters and the change summary 'Adds retention periods for application data.'; and the same for the other four slugs
- Then a new legal_documents row 'privacy-policy' version 3 exists with published_at = now(); versions 1 and 2 are unchanged; anon, authenticated and service_role have no INSERT, UPDATE or DELETE on legal_documents; a second row with the same slug and version is refused by the unique constraint. A new slug starts at version 1. One audit row legal_document.publish records slug, version and the change summary as the reason. One mandatory legal_version notification per user who must accept that document is queued with slug, version and change summary: 50 for privacy-policy, 50 for terms-of-service, 40 for worker-terms, 10 for employer-terms, none for cookie-policy; none for the user without a committed account kind (acceptance per account kind as in note 5). A slug not matching ^[a-z0-9-]{3,60}$, a title empty or over 200 characters, an empty body, or a change summary under 10 or over 1000 characters raises CHARA_INVALID_INPUT and creates no row, audit row or notification.

**AC12 · Staff page: grant and revoke a role** (browser test (Playwright))

- Given a Platform Administrator at aal2 on /en/admin/staff; user N (a named account, not staff) with an active session; an existing Trust & Safety Administrator T
- When the administrator grants N the role trust_safety with a reason of 30 characters, N signs in again, and the administrator then revokes the role with a reason; the administrator also tries to grant themselves a role, and to grant N the role again while it is active
- Then the staff list shows user, role, granted_by, granted_at, revoked_at and whether a TOTP factor is enrolled. After the grant N's refresh tokens are revoked (the test deletes the access-token cookie), N sees the Trust & Safety navigation only after enrolling TOTP and reaching aal2, and one audit row platform_role.grant records grantor, grantee, role and reason. After the revoke revoked_at is set, N's console requests return 404 at once, N's refresh tokens are revoked, and one audit row platform_role.revoke exists. Self-grant is refused with CHARA_FORBIDDEN and a repeated active grant with CHARA_INVALID_STATE; neither changes a row. T requesting /en/admin/staff gets 404. The full rules are tested under FR-A7.

### Data and validation

- reason (statement of reasons, all administrative actions): required, trimmed, 10 to 2000 characters (team default)
- user_id / organization_id / job_id: existing uuid; unknown id raises CHARA_NOT_FOUND
- search term (users and organisations): trimmed, 3 to 100 characters; 25 rows per page; at most 100 rows per request
- audit filters: actor id uuid, action text, entity_type text, entity_id text, from and to dates in UTC (inclusive, from not after to), all optional, combined with AND
- application statistics range: from and to dates, from not later than to, at most 366 days (team default)
- platform role: one of admin, verification_reviewer, trust_safety; grantee is an existing user other than the caller
- identity_checked (MFA reset form): boolean, must be true
- legal document slug: ^[a-z0-9-]{3,60}$; title 1 to 200 characters; body 1 to 200000 characters; change_summary 10 to 1000 characters (it is the reason of the audit row); version assigned by the system (highest existing + 1, 1 for a new slug); published_at set by the database
- moderation_actions: target_type (profile, organization, job), target_id, action (proposed: account_suspended, account_reinstated, organization_suspended, organization_reinstated, job_hidden, job_unhidden), statement_of_reasons not null, actor_id = caller

### States and transitions

- profiles.status: active -> suspended (trust_safety at aal2, reason required, target active)
- profiles.status: suspended -> active (trust_safety at aal2, reason required, target suspended)
- organizations.status: active -> suspended (trust_safety at aal2, reason required, target active)
- organizations.status: suspended -> active (trust_safety at aal2, reason required, target suspended)
- jobs.moderation_state: visible -> hidden (trust_safety at aal2 through moderate_job, reason required)
- jobs.moderation_state: hidden -> visible (trust_safety at aal2 through moderate_job, reason required)
- jobs.moderation_state: visible -> org_suspended (system effect of suspend_organization; hidden vacancies are not changed)
- jobs.moderation_state: org_suspended -> visible (system effect of reinstate_organization; hidden vacancies are not changed)
- platform_staff: no active row -> active row (admin at aal2, reason required, not for self, not when the same role is already active)
- platform_staff: active row -> revoked_at set (admin at aal2, reason required)
- legal_documents: version n -> new row version n+1 (admin at aal2); existing versions never change
- TOTP factors: enrolled -> none (admin at aal2 through reset_mfa, not for self, reason required)

### Roles and permissions

- Platform Administrator (admin) at aal2: allowed to search users and organisations, view user activity counts and organisation members and vacancies, view application counts, publish legal document versions, search the audit log, grant and revoke platform staff roles, reset two-step verification of another user; denied to suspend or reinstate users and organisations, hide or unhide vacancies (default, note 1), edit plans or settings in the console, open candidate documents
- Trust & Safety Administrator (trust_safety) at aal2: allowed to search users and organisations, view user activity counts and organisation members and vacancies, suspend and reinstate users and organisations, hide and unhide vacancies; denied application counts, legal publication, audit log, staff roles, MFA reset, plans and settings, candidate documents
- Verification Reviewer (verification_reviewer): denied every console function in Phase 1 (no screens)
- Any staff role at aal1, staff with revoked_at set, candidates, employer owners, admins and members, other authenticated users: denied the console and every administrative function (CHARA_FORBIDDEN in the database, 404 in the console)
- Anonymous (anon): denied; redirected to login
- Edge Function account-ops (service_role): runs the queued sign-out, ban and factor deletion jobs only; no direct table access

### Objects

- pages: app/[lang]/(admin)/admin/ with the pages named in ARCHITECTURE section 3 (job moderation, suspensions and reinstatements, legal documents, staff, MFA reset, audit search); proposed: admin/users, admin/users/[id], admin/organizations, admin/organizations/[id], admin/statistics and the route names used in the criteria (moderation, audit, staff); pages /[lang]/login, /[lang]/mfa, /[lang]/jobs, /[lang]/org/[slug]
- tables: public.platform_staff, public.profiles (status), public.organizations (status), public.organization_members, public.jobs (status, moderation_state), public.moderation_actions, public.legal_documents, public.notifications, audit.log, billing.subscriptions (read only, left as is)
- enum: platform_role (admin, verification_reviewer, trust_safety)
- RPCs: moderate_job, suspend_user, suspend_organization, reinstate_user, reinstate_organization, reset_mfa, grant_platform_role, publish_legal_document; proposed: revoke_platform_role, admin_search_users, admin_search_organizations, admin_get_user, admin_get_organization, admin_application_counts, admin_search_audit
- helpers: private.has_platform_role(), private.is_aal2(); DAL requirePlatformRole(), requireAal2()
- Edge Functions: account-ops (global sign-out, sign-in ban and lift, TOTP factor deletion), notify (account_suspended, account_reinstated, vacancy_hidden, mfa_reset, legal_version)
- queue: pgmq account-ops jobs (proposed queue name account_ops)
- error codes: CHARA_FORBIDDEN, CHARA_NOT_FOUND; proposed: CHARA_INVALID_INPUT, CHARA_INVALID_STATE
- configuration records changed only by migration: billing.plans, billing.plan_limits, billing.plan_features, private.settings, retention_policies

### Open points and assumed defaults

- 1. Who may suspend (OPEN_QUESTIONS P12, to be confirmed by CHARA): default Trust & Safety Administrator only; the Platform Administrator searches and views. The organisation's subscription is left as is (no pause, cancellation or refund).
- 2. Plan and settings editing screens (FR text; OPEN_QUESTIONS P9): default is later phase. Until then the Platform Administrator owns the change and it is made by a reviewed migration (CODEOWNERS on supabase/**; enforcing the review needs branch protection, OPEN_QUESTIONS W3).
- 3. Length bounds of 10 to 2000 characters for a reason, the 25-row page size, the 366-day range and the legal document field limits are team defaults, not owner decisions.
- 4. Read-only console actions (search, detail views, counts, audit search) are not written to the audit log by default; only state-changing administrative actions are (team default, not an OPEN_QUESTIONS item; see FR-F2).
- 5. Recipients of legal_version follow OPEN_QUESTIONS L9 default: Terms of Service and Privacy Policy for everyone, Worker Terms for candidates, Employer Terms for employers, Subscription and Billing Terms at checkout; which documents need acceptance is still open (L7, L9).
- 6. Initial staff names are open (OPEN_QUESTIONS O6); the first administrator is created by a one-off audited SQL insert. The two-step verification reset follows D17 and grant_platform_role follows D11.
- 7. Global sign-out revokes refresh tokens; an unexpired access token (jwt_expiry 1800, up to 30 minutes) stays valid until it expires, so immediate effect comes from the lookups of profiles.status, organizations.status and platform_staff in the DAL and RPCs (ARCHITECTURE sections 5.3 and 16). The 404 for out-of-role pages and an aal1 refusal with CHARA_FORBIDDEN are team defaults; ARCHITECTURE defines no separate MFA error code.

## FR-F2 · Audited actions

> Every administrative action writes an audit record with actor, target, reason and time.

### Acceptance criteria

**AC1 · Each state-changing administrative function writes one complete audit row** (database test (pgTAP))

- Given Callers of the right role at aal2, a request header x-request-id = '7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11' and x-forwarded-for = '203.0.113.7, 10.0.0.1'; the 10 audited calls: grant_platform_role, revoke_platform_role, reset_mfa, publish_legal_document, suspend_user, reinstate_user, suspend_organization, reinstate_organization, moderate_job (hide) and moderate_job (unhide)
- When each call succeeds once with a reason of 25 characters (for publish_legal_document the change summary of 25 characters is the reason)
- Then exactly one audit.log row per call exists (suspend_organization and reinstate_organization add one more row per vacancy whose moderation_state changed, action job.org_suspend or job.org_reinstate). Each row has actor_id = auth.uid() of the caller; action (user.suspend, user.reinstate, organization.suspend, organization.reinstate, job.hide, job.unhide, mfa.reset, platform_role.grant, platform_role.revoke, legal_document.publish); entity_type (profile, organization, job, platform_staff, legal_document); entity_id = the target (legal documents: slug:version, for example privacy-policy:3); metadata.reason = the reason; metadata.request_id = the header value; ip = '203.0.113.7'; created_at within 5 seconds of now() in UTC. The row is written in the same transaction as the change.

**AC2 · Request id is never empty** (database test (pgTAP))

- Given an administrator at aal2 calling suspend_user three times: with x-request-id set to a uuid, without the header, and with the header 'not-a-uuid'; and one suspend_organization call that changes 3 vacancies
- When all calls complete
- Then the first audit row holds the header value in metadata.request_id; the second and third hold a generated uuid. No admin audit row has a null or empty metadata.request_id. The 4 rows written by the suspend_organization call (organisation plus 3 vacancies) share one request id.

**AC3 · A reason is required and bounded in the audit row** (database test (pgTAP))

- Given the 10 audited calls of AC1 and reasons that are null, empty, only spaces, 9 characters, exactly 10, exactly 2000 and 2001 characters
- When each call is made with each reason (for publish_legal_document the change summary, whose upper bound is 1000 characters, so 1001 characters is the refused case and 2000 is not tried)
- Then Null, empty, spaces-only, 9 and over-limit reasons raise CHARA_INVALID_INPUT and write no row; 10 characters and the upper bound succeed. After the successful calls, the query 'admin audit rows where metadata.reason is null or shorter than 10 characters' returns 0 rows (KPI: actions with reason recorded 100 %).

**AC4 · Refused or failed actions leave no audit row, and an audit failure rolls the action back** (database test (pgTAP))

- Given an administrator at aal2 and a Trust & Safety Administrator at aal2; a temporary BEFORE INSERT trigger on audit.log that raises an exception, created inside the test transaction
- When (a) A call is refused (wrong role, aal1, invalid reason, invalid state); (b) with the trigger in place, a valid suspend_user is called
- Then (a) No audit.log row, status change, queue message or notification results. (b) The call raises, profiles.status stays 'active', and there is no moderation_actions row, no queue message and no notification: an administrative change cannot succeed without its audit row.

**AC5 · Audit log is append-only for every role** (database test (pgTAP))

- Given Existing audit.log rows and the roles anon, authenticated, service_role, postgres (the migration owner) and a session with session_replication_role = replica
- When each role runs UPDATE, DELETE and TRUNCATE on audit.log
- Then every statement fails (permission denied for the API roles; the ENABLE ALWAYS trigger audit.refuse_change() raises for postgres and under replica mode) and the row count and contents are unchanged afterwards.

**AC6 · Rows can only be added through the audit functions** (database test (pgTAP))

- Given the roles anon, authenticated and service_role
- When each role runs a direct INSERT and SELECT on audit.log, tries to execute audit.record(), and calls audit_record_external
- Then Direct INSERT and SELECT are refused for all three roles and none of them can execute audit.record(). audit_record_external is executable by service_role only; anon and authenticated are refused; a service_role call appends exactly one row whose created_at is set by the database. No function granted to authenticated can write an actor_id other than the caller's auth.uid().

**AC7 · Work done outside the database is recorded against the same request** (browser test (Playwright))

- Given a suspension of user U made in the console (request id R) that queued an account-ops job, the local stack running account-ops, and a test that lets the queue message be delivered a second time (visibility timeout expires before the first acknowledgement)
- When account-ops completes the sign-out and the sign-in ban and the message is redelivered
- Then the audit search page filtered on entity id U lists, besides user.suspend, one row account_ops.sign_out_global and one row account_ops.ban_user, written through audit_record_external, both with metadata.request_id = R, the job id in metadata.job_id and actor_id = the administrator who made the call (carried in the job payload); the redelivery adds no second row of either action. The same holds for the factor deletion of reset_mfa (account_ops.delete_factors).

**AC8 · Coverage guard: no administrative function without an audit call** (database test (pgTAP))

- Given the set of public functions whose source calls private.has_platform_role, and an explicit allowlist of read-only functions (admin_search_users, admin_search_organizations, admin_get_user, admin_get_organization, admin_application_counts, admin_search_audit)
- When the pgTAP test lists the functions that are in the first set and not in the allowlist
- Then every one of them also calls audit.record; a new staff-gated function that does not, and is not on the allowlist, fails the test (KPI: administrative actions without an audit row = 0).

**AC9 · Only the Platform Administrator can read the audit log, with filters** (database test (pgTAP))

- Given 60 audit rows from 3 actors, 4 actions and 2 entity types over 10 days; roles administrator, Trust & Safety Administrator, Verification Reviewer (each at aal2), administrator at aal1, authenticated user, anon
- When each calls admin_search_audit; and a direct SELECT on audit.log is tried by anon, authenticated and service_role
- Then only the administrator at aal2 gets rows (columns id, actor_id, action, entity_type, entity_id, metadata, ip, created_at); all others get CHARA_FORBIDDEN or a privilege error; direct SELECT is refused for the three API roles. Filters on actor, action, entity_type, entity_id and a date range (from 00:00:00 UTC of the start day to 23:59:59.999 UTC of the end day, inclusive) combine with AND and return only matching rows; the page holds 25 rows ordered by created_at descending then id descending. A from date after the to date raises CHARA_INVALID_INPUT.

**AC10 · Retention is a configuration value and deletion is narrow** (database test (pgTAP))

- Given retention_policies has entity 'audit_log' with days = 2191 (six years) by default; audit rows aged 1 day, 2190 days, 2192 days and 3000 days inserted by the test as the migration owner
- When private.apply_retention() runs with the default; in a second test with the same four rows it runs with days set to 3650; an update of days to 0 is tried
- Then with 2191, the rows aged 2192 and 3000 days are deleted, the rows aged 1 and 2190 days stay, and the run writes one audit row retention.run (actor_id null) with the number of rows removed (2). With 3650, all four rows stay and one retention.run row records 0 removed. The deletion exception is transaction-local: right after the run a direct DELETE by authenticated and by postgres still fails. days = 0 is refused by a check constraint (days >= 1). The seeded default is 2191; no API role can write retention_policies and the value is changed only by migration.

**AC11 · Monthly export to an immutable archive** (manual check)

- Given the first day of a month at 03:00 UTC, an archive location outside the platform with object lock set and a retention of at least 6 years, and a service RPC (proposed: audit_export_month, executable by service_role only) that returns the audit rows of one month
- When the export job runs
- Then one file holds every audit.log row of the previous calendar month (UTC), with a manifest giving month, row count and SHA-256; the manifest count equals select count(*) for that month; the object cannot be overwritten or deleted during the lock period; a failed export raises an alert to operations and is re-run the same day; a restore test compares count and checksum.

**AC12 · Quarterly sample review by the privacy contact** (manual check)

- Given the end of a quarter and the designated privacy contact named in private.settings
- When the privacy contact reviews a random sample of at least 25 administrative audit rows of the quarter (all rows if fewer than 25), using a Platform Administrator's search or export
- Then for each row the reason is present and plausible, the target state change exists (moderation_actions row, status or role change), and the actor held the right role on that date (platform_staff granted_at and revoked_at); the result and any finding are recorded in the review record and gaps are raised as incidents.

### Data and validation

- audit.log.id: generated identity, never reused
- actor_id: uuid of auth.uid(); not null for administrative actions and for account-ops completion rows (the administrator who made the call); null only for system-originated rows (scheduler, webhook, retention run)
- action: text, not null, lower case '<entity>.<verb>' (for example user.suspend); action names are proposed
- entity_type: text, not null (proposed values: profile, organization, job, platform_staff, legal_document); entity_id: text, not null (uuid, or slug:version for legal documents)
- metadata: jsonb object; administrative actions must contain reason (10 to 2000 characters after trimming) and request_id (uuid, generated when the request header is missing or not a uuid); account-ops rows also hold job_id
- ip: inet, nullable; leftmost x-forwarded-for entry; context, not evidence
- created_at: timestamptz, not null, set by the database (now(), UTC), never supplied by a client
- retention_policies: entity 'audit_log', days integer >= 1, default 2191
- export manifest: month (YYYY-MM), row count, SHA-256 of the file

### Roles and permissions

- Platform Administrator at aal2: allowed to read the audit log through admin_search_audit; denied any write, update or delete
- Trust & Safety Administrator, Verification Reviewer: denied to read the audit log
- anon, authenticated: denied any direct SELECT, INSERT, UPDATE, DELETE, TRUNCATE on audit.log
- service_role (Edge Functions): allowed to append only, through audit_record_external, and to read one month for the export through the proposed service RPC; denied everything else on audit.log
- postgres (migration owner): denied UPDATE and DELETE (triggers fire always); only private.apply_retention() deletes under the narrow transaction-local exception
- Designated privacy contact: reviews a quarterly sample (manual procedure, through a Platform Administrator search or export)

### Objects

- tables: audit.log (id, actor_id, action, entity_type, entity_id, metadata, ip, created_at), retention_policies, private.settings (privacy contact), public.platform_staff (role dates for the review)
- functions: audit.record(), audit.refuse_change() (ENABLE ALWAYS triggers on UPDATE, DELETE, TRUNCATE), service RPC audit_record_external, private.apply_retention(), proposed: admin_search_audit, proposed: audit_export_month
- administrative RPCs that call audit.record: grant_platform_role, proposed: revoke_platform_role, reset_mfa, publish_legal_document, suspend_user, reinstate_user, suspend_organization, reinstate_organization, moderate_job
- Edge Function account-ops (writes completion rows through audit_record_external); pg_cron job for the monthly export; proposed: Edge Function audit-export (builds the file and manifest, writes to the archive)
- proposed: external archive location with object lock for the monthly export
- page: app/[lang]/(admin)/admin audit search (proposed route admin/audit)

### Open points and assumed defaults

- 1. Reads (search, detail views, counts, audit search) are not audited by default; the SOP says every administrative RPC writes a row, read here as every state-changing one (team default, not an OPEN_QUESTIONS item). Change it if the privacy contact wants lookups of personal data logged.
- 2. Retention of 6 years is the default (OPEN_QUESTIONS L6, not addressed by the owner reply); it is a configuration value.
- 3. The target and budget of the off-platform archive are not decided (compare OPEN_QUESTIONS O5); default is an object-lock location in a second EU region.
- 4. The designated privacy contact is not named yet (OPEN_QUESTIONS L1). The sample size of 25 and the form of the review record are team defaults.
- 5. erase_user pseudonymises audit rows through its own narrow audited exception (ARCHITECTURE section 12); that exception is tested under FR-B6 and must not weaken AC5.
- 6. Account-ops completion rows carry the originating administrator as actor and the job id for idempotency (team default; ARCHITECTURE only says the service RPC appends rows for actions outside the database).

## FR-F3 · No document access

> No platform staff role (Platform Administrator, Verification Reviewer, Trust & Safety Administrator) has a function to open or download candidate documents in Phase 1; reports are handled without document access (to be confirmed by CHARA: whether Trust & Safety must inspect reported documents at launch).

### Acceptance criteria

**AC1 · Staff cannot read or change document metadata or shares** (database test (pgTAP))

- Given Candidate W with 3 worker_documents rows (types identity, certificate, cv; one expired) and an active passport_shares row naming the cv document; one user for each role admin, verification_reviewer and trust_safety, each tested at aal2 and at aal1 and none a member of the sharing organisation
- When each staff user runs select * from public.worker_documents and from public.passport_shares, select count(*) where worker_user_id = W, and tries an INSERT with worker_user_id = W, an UPDATE and a DELETE on W's rows; anon and service_role run the same SELECT
- Then every SELECT by a staff user returns zero rows (is_empty) at both assurance levels; UPDATE and DELETE affect 0 rows and the rows are unchanged; INSERT raises a row-level security violation (SQLSTATE 42501). anon and service_role get permission denied (no table grant).

**AC2 · Staff cannot see document objects in storage** (database test (pgTAP))

- Given an object at passport-documents/{W}/{document_id}/cv.pdf and the same three staff users at aal2 and aal1
- When each runs select from storage.objects where bucket_id = 'passport-documents' and tries to insert an object under the path of W, and to update and delete the existing object
- Then the SELECT returns zero rows for all three roles at both levels; the INSERT raises a row-level security violation; UPDATE and DELETE affect 0 rows and the object still exists.

**AC3 · The access function refuses every staff role and logs nothing** (database test (pgTAP))

- Given W's cv document with an active share to organisation O and scan_status clean, W's identity document that is shared with nobody, and the three staff users at aal2 and aal1 who are not members of O
- When each calls document_access_grant(document id, 'review') for the cv document and for the identity document
- Then each of the 12 calls raises CHARA_FORBIDDEN (SQLSTATE 42501), returns no bucket or path, and writes zero rows to audit.document_access_log (row count before and after identical).

**AC4 · Staff cannot read the document access log** (database test (pgTAP))

- Given Existing audit.document_access_log rows for W and the three staff roles
- When each staff user selects from audit.document_access_log and from public.v_my_document_access_log
- Then the first is refused (no grant) and the view returns zero rows because it is filtered on worker_user_id = auth.uid().

**AC5 · No policy gives a staff role a document path** (database test (pgTAP))

- Given all policies in pg_policies on public.worker_documents, public.passport_shares, audit.document_access_log and, in Phase 1, on storage.objects
- When the test searches each policy's using and with check expressions
- Then no policy expression calls private.has_platform_role or reads public.platform_staff. The select and delete policies on passport-documents objects test only that the first path folder equals auth.uid(); the insert policy additionally requires the uploader's own worker_documents row (ARCHITECTURE section 7.2).

**AC6 · No administrative function touches documents** (database test (pgTAP))

- Given the set of public functions whose source calls private.has_platform_role
- When the test scans their source and their result columns
- Then None references worker_documents, passport_shares, storage.objects, document_access_grant or audit.document_access_log, and none returns a column named bucket_id, object_path, storage_path, file_name, mime, size_bytes, scan_status, document_id or expires_on.

**AC7 · Edge Function and Storage API refuse staff tokens** (browser test (Playwright))

- Given the three staff users signed in at aal2 (and at aal1) and the same cv document as AC3
- When each sends POST document-url with { documentId, purpose: 'review' } and a GET of the object through the Storage API with its own token; a further POST is sent without a token (HTTP-level test against the local stack)
- Then document-url answers 403 with code CHARA_FORBIDDEN and no signed URL for each staff token, and 401 without a token; the Storage API answers a non-2xx status and no bytes; audit.document_access_log has no new row.

**AC8 · Console shows no document function** (browser test (Playwright))

- Given an administrator, a Trust & Safety Administrator and a Verification Reviewer at aal2; candidate W with documents named 'passport-scan.pdf' and 'diploma.pdf', an organisation with applicants who shared documents, and a vacancy with a hide history
- When each opens every page of their console, including the detail pages of W, the organisation and the vacancy, and requests /en/admin/documents and /en/admin/users/<W>/documents
- Then no page contains a document list, link, download button, file name or document count; the file names do not appear in page text; browser network traffic holds no request to document-url or to a storage object URL; the two direct URLs return 404.

**AC9 · Console source contains no document access code** (unit test (Vitest))

- Given the source of apps/web/app/[lang]/(admin) and the DAL modules that console pages import
- When the unit test scans the files
- Then no file contains document-url, worker_documents, passport_shares, passport-documents, createSignedUrl, document_access_grant or v_my_document_access_log; a match fails the test.

**AC10 · The denial tests run on every build and fail on regression** (manual check)

- Given two scratch branches: A adds a policy 'select for trust_safety using (private.has_platform_role('trust_safety'))' on public.worker_documents; B adds a staff-gated function (it calls private.has_platform_role) that reads worker_documents
- When the CI db job runs npm run db:test on each branch and on main
- Then on A the job fails on the AC1 and AC5 tests; on B it fails on the AC6 test; on main it passes. The job is listed in the checks of every pull request (making it required needs branch protection, OPEN_QUESTIONS W3).

**AC11 · Exception process for any future staff access** (manual check)

- Given a proposal to give a staff role a read path to candidate documents
- When the change is reviewed
- Then it is merged only with a documented change (decision record), a named legal basis, and candidate-visible logging (every access writes audit.document_access_log with the accessor, visible to W in v_my_document_access_log); the review checklist in the pull request template (proposed: .github/pull_request_template.md) lists the three items; .github/CODEOWNERS has an entry for supabase/**.

### Roles and permissions

- Platform Administrator: denied any read or write of worker_documents, passport_shares, passport-documents objects, document_access_grant, audit.document_access_log and the document-url function; allowed application counts only
- Verification Reviewer: denied the same in Phase 1 (the reviewer path with aal2 belongs to the verification phase)
- Trust & Safety Administrator: denied the same; reports are handled without document access, using the statement of reasons
- Candidate (owner): allowed to read and manage own documents and the access log of own documents
- Organisation member: allowed only through document_access_grant for documents selected for a specific application (not a staff function; a staff user who is also a member is treated as a member, never as staff)
- anon: denied; service_role: no table grants, only the service RPCs

### Objects

- tables: public.worker_documents, public.passport_shares, audit.document_access_log, public.platform_staff
- storage: bucket passport-documents; policies on storage.objects (owner-only)
- functions: public.document_access_grant, private.has_platform_role, view public.v_my_document_access_log
- Edge Function: document-url
- console: app/[lang]/(admin)/admin pages and the DAL modules they use
- tests: proposed: supabase/tests/database staff document denial test file (AC1 to AC6); apps/web unit test for the console source scan; proposed: .github/pull_request_template.md

### Open points and assumed defaults

- 1. Whether Trust & Safety must inspect reported documents at launch is open (OPEN_QUESTIONS P10, to be confirmed by CHARA). Default: no staff role opens candidate documents in Phase 1; revisit with the verification phase.
- 2. Verification Reviewer access to documents with aal2 is later phase and not built now (ARCHITECTURE section 5.6 and the comment in document_access_grant).
