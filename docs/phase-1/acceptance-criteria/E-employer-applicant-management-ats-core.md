# Group E: Employer applicant management (ATS core)

## FR-E1 · Applicant list and pipeline

> An employer views applicants per vacancy as a list (stage, applied date, completeness, document count) and as a pipeline board by stage.

### Acceptance criteria

**AC1 · Applicant list shows the required columns** (browser test (Playwright))

- Given Organisation A (employer_starter, active subscription) has an Open vacancy J with 4 applications: Ana (Applied, applied 2026-09-04, completeness 80 %, share scope with 2 document ids), Ben (Shortlisted, applied 2026-09-03, 55 %, 0 ids), Chi (Withdrawn, applied 2026-09-02, 70 %, 2 ids, share revoked) and Dev (Hired, applied 2026-09-01, 90 %, 1 id, share not revoked); M1 is a member of A signed in at aal1
- When M1 opens the applicants page of J in list view
- Then the list has one row per application with the columns Candidate, Stage, Applied (date), Completeness (%) and Documents (count); rows are ordered by applied date, newest first (Ana, Ben, Chi, Dev); stage labels are Applied, Shortlisted, Withdrawn and Hired; Completeness shows 80 %, 55 %, 70 % and 90 %; Documents shows 2, 0, 0 and 1 (Chi shows 0 because the share is revoked); only Ana's row (stage Applied) carries a New badge; the Withdrawn application stays listed; no row shows a document name

**AC2 · Sorting, stage filter, pagination, scope and invalid query values** (browser test (Playwright))

- Given Vacancy J of organisation A has 51 applications with different dates, completeness values and document counts; A has a second vacancy K with 2 applications
- When M1 clicks each of the headers Applied, Stage, Completeness and Documents twice and selects the stage filter Shortlisted on J; then opens J with ?page=0&sort=password&stage=hacked; then opens J with ?page=9; then opens the applicants page without a job parameter
- Then each header toggles ascending then descending and sets aria-sort; Stage sorts in pipeline order Applied, Viewed, Shortlisted, Interview, Offer, Hired, Not selected, Withdrawn; the filter shows only Shortlisted rows; sort and filter are kept in the URL so a reload keeps them; the unfiltered list of J shows 50 rows on page 1 and 1 row on page 2; the invalid values fall back to page 1, the default sort (applied, newest first) and no filter, with no error page; page 9 shows the last page (page 2); without a job parameter the list spans J and K (53 rows, 50 on page 1 and 3 on page 2), has an extra Vacancy column, accepts ?stage= and ?sort=applied (the links used by the dashboard, FR-E5) and offers neither the board nor Export CSV

**AC3 · Board has one column per stage with live counts** (browser test (Playwright))

- Given Vacancy J has 11 applications: Applied 2, Viewed 1, Shortlisted 3, Interview 1, Offer 1, Hired 1, Not selected 1, Withdrawn 1; M1 and M2 are members of A in two browser sessions, both on the board of J
- When M2 moves one Applied application to Interview through the Move to menu
- Then the board shows eight columns in the order Applied, Viewed, Shortlisted, Interview, Offer, Hired, Not selected, Withdrawn (Shortlisted has its own column); each column header shows its count, equal to the number of cards in the column and to the number of list rows when the list is filtered by that stage; within 10 seconds and without a page reload M1's board shows Applied 1 and Interview 2; the update arrives through the Broadcast channel or the 10-second polling fallback

**AC4 · Allowed move from the board records an event and emails the candidate** (browser test (Playwright))

- Given Organisation A is on employer_starter with an active subscription; vacancy J is Paused; Ana's application is Applied and carries the New badge; M1 is a member of A
- When M1 opens the Move to menu on Ana's card and chooses Interview (the same happens when the card is dragged onto the Interview column)
- Then the menu lists exactly Shortlisted, Interview and Not selected; the card appears in the Interview column and the counts change at once (Applied minus 1, Interview plus 1); the New badge is gone; exactly one application_events row applied to interview with actor M1 exists; within 2 minutes the candidate receives one status_changed email in the mail catcher; no email goes to employer users; the move works although J is Paused; choosing Not selected or dropping a card on the Not selected column instead opens the decline dialog of FR-E2 and applies nothing until it is confirmed

**AC5 · Invalid, stale and final-state moves are rejected and change nothing** (browser test (Playwright))

- Given M1 has the board open showing Ben as Applied; M2 has meanwhile moved Ben to Interview; the board also holds a Hired card and a Withdrawn card
- When M1 drags Ben's stale card onto Shortlisted; then M1 tries to drag the Hired card, drops an Applied card onto the Viewed column and onto the Withdrawn column
- Then the server refuses the stale move with CHARA_INVALID_TRANSITION (Interview to Shortlisted is not allowed) and the UI shows an error toast and reloads the board with Ben in Interview; Hired, Not selected and Withdrawn cards are not draggable; the Viewed and Withdrawn columns do not accept drops; no event row and no email is created by any of these attempts

**AC6 · Keyboard use, labels and 360 px layout** (browser test (Playwright))

- Given M1 uses only the keyboard on list and board of vacancy J, viewport 360 px wide
- When M1 tabs through the page and operates a card's Move button with Enter, the arrow keys and Esc
- Then every card has a focusable button named Move <candidate name>; Enter opens the menu, the arrow keys select a target, Enter applies it, Esc closes it, and focus returns to the moved card; a polite live region announces <candidate name> moved to <stage>; the list/board switch, the sort buttons (Sort by Applied date, and so on) and the Stage filter have accessible names; the list becomes stacked cards without horizontal page scrolling and the board scrolls inside its own container; axe-core reports no violation of impact serious or critical

**AC7 · Loading, empty, filtered-empty and error states** (browser test (Playwright))

- Given M1 opens the applicants page of a vacancy
- When the applicant query is delayed by 2 seconds; then the vacancy has 0 applications; then a filter matches 0 rows; then the query fails
- Then a skeleton of table rows is shown while loading; the empty state says there are no applications yet and links to the vacancy, and the export button is hidden; a filter with no match shows No applicants match this filter with a Clear filter button; a failed query shows an error message with a Retry button and an error toast, and no partial data

**AC8 · CSV export of the filtered list without documents** (browser test (Playwright))

- Given Organisation A has an active employer_professional subscription; vacancy J has 60 applications; one candidate is named =HYPERLINK('http://x'), one is named Smith, Jo and one has a double quote in the name; the stage filter Shortlisted matches 12 of them
- When M1 clicks Export CSV with the Shortlisted filter active
- Then a UTF-8 CSV downloads with the header Candidate,Stage,Applied,Completeness (%),Documents and 12 rows (all pages of the filter, not only the visible page); Applied is the UTC date as YYYY-MM-DD; Stage uses the UI labels; any cell that starts with =, +, -, @, a tab or a carriage return is prefixed with a single quote; cells with commas, double quotes or line breaks are quoted as in RFC 4180 (a double quote is doubled); the file contains no document name, storage path or link; one audit.log row exists with the actor, the vacancy id, the stage filter and row count 12, and no candidate data

**AC9 · CSV export is refused to lapsed organisations and, once limits are enforced, to organisations on the free plan** (database test (pgTAP))

- Given entitlements_enforced is false: organisation F has a cancelled subscription (free_employer), organisation P is on employer_starter with an active subscription, organisation N has never had a subscription; then entitlements_enforced is set to true
- When a member of each organisation calls export_applicants for a vacancy of their own organisation, first with the setting false and then with it true
- Then with the setting false: F is refused with CHARA_FEATURE_NOT_IN_PLAN (detail read_only_free_plan) and no audit row is written, P and N receive their rows and one audit row each; with the setting true: P still receives its rows, F and N are refused with CHARA_FEATURE_NOT_IN_PLAN and no audit row is written; deleting the csv_export row of employer_starter makes P refuse with detail csv_export

**AC10 · Applicants of other organisations are invisible and cannot be changed or exported by outsiders** (database test (pgTAP))

- Given Applications exist for jobs of organisation A and organisation B; Ana applied to a job of A; platform administrator PA is not a member of any organisation
- When a member of B, a candidate who is not the applicant, PA and an anonymous request each select from job_applications and application_events for the applications of A, call set_application_status on an application of A with target interview, and call export_applicants for a vacancy of A; Ana and a member of A select the same rows
- Then B's member, the other candidate and PA see 0 rows; the anonymous select fails with permission denied (no grant); set_application_status and export_applicants raise CHARA_NOT_FOUND for B's member, the other candidate and PA, and CHARA_UNAUTHENTICATED for the anonymous caller; Ana's own call to set_application_status raises CHARA_FORBIDDEN; no event and no audit row is created; Ana sees only her own rows; A's member sees A's applications and none of B's

**AC11 · Page access guards by sign-in state, role and organisation** (browser test (Playwright))

- Given Applicants page /en/org/a/applicants; accounts: anonymous, candidate Ana, member of organisation B, platform administrator who is not a member, owner of A at aal1 without enrolment, member of A at aal1
- When each requests the page
- Then anonymous is redirected to the login page with a safe next parameter; Ana is redirected away from the employer area; the member of B and the platform administrator receive a 404 for slug a; the owner of A at aal1 is redirected to the two-step verification page; the member of A at aal1 sees the list

**AC12 · Lapsed organisation keeps a read-only view** (browser test (Playwright))

- Given Organisation A's subscription was cancelled, so A is on free_employer; it has 5 past applicants in different stages, one of them Applied
- When M1 opens list and board and tries a move through a forced request
- Then the 5 rows, the stage counts and the New badge are shown; cards are not draggable, the Move menu and the Export CSV button are disabled and a banner says applicant changes are disabled until a plan is chosen; the forced move is refused with CHARA_FEATURE_NOT_IN_PLAN, shows an error toast and creates no event

### Data and validation

- view: list or board; any other value falls back to list; board only for a single vacancy
- job: vacancy id of the organisation; when absent the list spans all vacancies of the organisation and has a Vacancy column
- sort: one of applied, stage, completeness, documents; direction asc or desc; default applied, desc; an invalid value falls back to the default
- stage filter: one of applied, viewed, shortlisted, interview, offer, hired, rejected, withdrawn (UI label of rejected is Not selected); an invalid value is ignored
- page: integer >= 1; page size 50; a non-numeric or zero value falls back to 1; a value past the last page shows the last page
- Candidate: first_name and last_name read from job_applications.profile_snapshot (the live profile is not read for the list)
- Applied: job_applications.created_at, shown as a date; UTC ISO date YYYY-MM-DD in the CSV
- Completeness: integer 0 to 100, the completeness percentage (FR-B4) as stored in profile_snapshot at application time
- Documents: integer, the number of document ids in passport_shares.scope of the application's share; 0 when the share is revoked
- New badge: shown when the stage is Applied (not yet opened by a member); removed by any later stage
- Stage move: target must be one of the transitions allowed for the current stage (see states); note optional for moves other than Not selected, at most 1000 characters, visible to the candidate; Not selected needs the decline reason of FR-E2
- CSV: columns Candidate, Stage, Applied, Completeness (%), Documents; UTF-8; cells starting with =, +, -, @, tab or carriage return get a leading single quote; no document data

### States and transitions

- Applied -> Shortlisted (employer member, plan includes shortlisting)
- Applied -> Interview (employer member)
- Applied -> Not selected (employer member)
- Viewed -> Shortlisted (employer member, plan includes shortlisting)
- Viewed -> Interview (employer member)
- Viewed -> Not selected (employer member)
- Shortlisted -> Interview (employer member)
- Shortlisted -> Offer (employer member)
- Shortlisted -> Not selected (employer member)
- Interview -> Offer (employer member)
- Interview -> Not selected (employer member)
- Offer -> Hired (employer member)
- Offer -> Not selected (employer member)
- Applied -> Viewed (system only, on the first open of the applicant detail by a member; never from the list or board)
- Applied, Viewed, Shortlisted, Interview or Offer -> Withdrawn (candidate only, never from the employer board)
- Hired, Not selected and Withdrawn are final; no transition leaves them

### Roles and permissions

- Organisation member (role member): may view list and board of the organisation's vacancies, move stages, export CSV (plan permitting); may not see other organisations' applicants
- Organisation admin and owner: same as member; reach applicant pages only at aal2 (FR-A4)
- Organisation on free_employer when restricted (lapsed, or limits enforced): may read the list and board; denied stage moves and CSV export
- Candidate (account kind worker): denied the employer applicant pages; sees only their own application in the journey tracker
- Anonymous: denied; redirected to login
- Member of another organisation: denied; 404 for the slug and no rows through RLS
- Platform staff (admin, verification_reviewer, trust_safety) who are not members of the organisation: denied; no read path to applicant data

### Objects

- tables: public.job_applications (status, profile_snapshot, passport_share_id, created_at), public.application_events, public.passport_shares (scope, revoked_at), public.jobs, audit.log
- RPC: set_application_status (stage moves; the transition guard is owned by FR-D2)
- proposed: view public.v_job_applicants (security_invoker; application id, job id, snapshot name, status, created_at, completeness, document count)
- proposed: RPC export_applicants(p_job_id, p_stage) (returns the CSV rows and writes audit.record)
- proposed: audit action applicants_exported
- proposed: billing.plan_features feature_key csv_export (seeded for employer_starter, employer_professional, employer_enterprise)
- functions: private.member_org_ids, private.has_feature, private.assert_org_writable, private.free_plan_restricted
- proposed: Realtime Broadcast on a private topic per organisation, sent by a realtime.broadcast_changes trigger on public.job_applications with a realtime.messages policy for members; the payload holds ids and statuses only; lib/supabase/browser.ts; polling fallback every 10 seconds
- error codes: CHARA_FEATURE_NOT_IN_PLAN, CHARA_FORBIDDEN, CHARA_NOT_FOUND, CHARA_UNAUTHENTICATED, proposed CHARA_INVALID_TRANSITION
- notifications kind status_changed; Edge Function notify; template status_changed
- pages: app/[lang]/(app)/org/[slug]/applicants (list and board); lib/dal/applications.ts; app/[lang]/(auth)/mfa for the aal2 redirect

### Open points and assumed defaults

- CSV export plans: to be confirmed by CHARA (OPEN_QUESTIONS C16); default assumed: every paid plan, not free_employer; modelled as the proposed feature key csv_export
- Shortlisting in all plans: to be confirmed by CHARA (C16); default assumed: every paid plan (see FR-E4)
- Moving back from Shortlisted: to be confirmed by CHARA (P17); default assumed: not possible
- Contents of free_employer and the lapse rules: to be confirmed by CHARA (C11); default assumed: read-only past applicants, no moves, no export
- Not stated by the requirement; assumed here and open to the owner: page size 50, 10-second target for live counts (Broadcast with a polling fallback, because ARCHITECTURE section 2 allows Realtime Broadcast only, no postgres_changes), completeness taken from the snapshot, Documents column counting the ids in the share scope and 0 after revocation, New meaning stage Applied, organisation-wide list when no job is given
- Owners and admins need aal2 for applicant pages; members are not required to enrol (D8, P7)

## FR-E2 · Applicant detail

> The applicant view shows the profile snapshot taken at application time, an indicator when the live profile has changed, the shared documents via access-logged time-limited links, internal notes visible only to the organisation, and the stage history.

### Acceptance criteria

**AC1 · Applicant detail shows the profile snapshot taken at application time** (browser test (Playwright))

- Given Ana applied on 2026-09-01 with the snapshot headline Welder, country PT, occupation Welders and flame cutters, 4 skills, 2 languages with CEFR level, 6 years of experience, availability from 2026-11-01, 1 preferred country, 1 work authorisation with an expiry date, and a cover note; she has since changed her live headline to Senior welder
- When member M1 opens Ana's applicant detail
- Then the page shows the snapshot values (headline Welder, not Senior welder) with the caption Submitted 2026-09-01, the cover note and the stage; no date of birth, nationality, gender, religion or marital status is shown; profile_snapshot is unchanged after the page load

**AC2 · Indicator when the live profile changed since the application** (browser test (Playwright))

- Given Application A1 whose candidate changed the headline after applying; A2 whose candidate saved the profile without changing a value; A3 whose candidate changed the profile and then withdrew (share revoked); A4 whose candidate changed the profile after the application was Hired and its share expired
- When M1 opens the detail of A1, A2, A3 and A4
- Then a1 shows the indicator Profile changed since this application was submitted and still shows the snapshot values; the indicator does not show what changed; A2, A3 and A4 show no indicator, because the comparison is by content and the live profile is not read when the share is revoked or expired

**AC3 · open_application sets Viewed once, only for a member of a writable organisation** (database test (pgTAP))

- Given Organisation A (employer_starter, active) has Applied application Ap; N has never had a subscription (entitlements_enforced false) and has Applied application Apn; lapsed organisation L (cancelled subscription) has applications in Applied, Shortlisted, Interview and Withdrawn; organisation B has Applied application Apb; M1 and M2 are members of A; Ana is a candidate; another Applied application of A is Aq
- When M1 calls open_application for Ap, M1 calls it again, M2 calls it; a member of N calls it for Apn; a member of L calls it for each of L's four applications; M1 calls it for Apb; Ana and an anonymous caller call it for Ap; M1 calls set_application_status for Aq with target viewed
- Then Ap and Apn become Viewed, Ap with exactly one application_events row (applied to viewed, actor M1); the repeated call and M2's call add no row and change nothing; L's four applications keep their stage with no event; the call on Apb raises CHARA_NOT_FOUND, Ana's call CHARA_FORBIDDEN, the anonymous call CHARA_UNAUTHENTICATED; the direct set_application_status call with target viewed raises CHARA_INVALID_TRANSITION and Aq stays Applied; no notifications row is created for any move to Viewed

**AC4 · Documents open through a 60-second access-logged link** (browser test (Playwright))

- Given Ana's share scope holds CV.pdf (d1, scan_status clean) and Certificate.png (d2, scan_status skipped); Ana also uploaded d3 after applying, which is not in the scope
- When M1 opens the detail and clicks Open on CV.pdf, then clicks it again
- Then the page lists exactly d1 and d2 with title, type, file name, size and the document's own expiry date when set, and not d3; the initial HTML contains no storage path or signed URL; each click calls document-url with documentId and purpose application_review and returns a new signed URL with 60-second validity and attachment disposition; each click adds exactly one audit.document_access_log row (share_id, document_id d1, worker_user_id Ana, organization_id A, accessed_by M1, purpose); the URL downloads the file within 60 seconds and fails with a non-2xx status 61 seconds after creation

**AC5 · Document access is refused unless every share condition holds; rate limit** (database test (pgTAP))

- Given M1 is a member of A; cases: document not in the share scope (same type uploaded after the application), revoked share (candidate withdrew), share with expires_at in the past, consent later withdrawn, document of a candidate who applied only to organisation B, soft-deleted document, document with scan_status pending, a platform admin who is not a member, an anonymous caller; positive controls: documents with scan_status clean and skipped in the scope; and M1 making 31 requests within 60 seconds
- When each case calls document_access_grant
- Then Scope, revoked, expired, withdrawn-consent, other-organisation and non-member cases raise CHARA_FORBIDDEN; the anonymous call raises CHARA_UNAUTHENTICATED; the soft-deleted document raises CHARA_NOT_FOUND; the pending document raises CHARA_DOCUMENT_NOT_SCANNED; the clean and skipped documents are granted with one log row each; the 31st request in the window is refused with the proposed code CHARA_RATE_LIMITED; no audit.document_access_log row is written for any refused call

**AC6 · Shared-document list and profile-changed check expose nothing beyond the valid share** (database test (pgTAP))

- Given Application X of A with share scope d1 and d2 (d3 uploaded later, d4 soft-deleted but in scope); the candidate later changed the profile; M1 is a member of A, M_B a member of B, Ana the applicant
- When M1 calls application_documents(X) and application_profile_changed(X); the share is then revoked, and later (separately) expired, and M1 calls both again; M_B, Ana and an anonymous caller call both
- Then for a valid share application_documents returns d1 and d2 only, with id, title, type, file name, size and expires_on and no bucket or storage path, and application_profile_changed returns true and no live data; for a revoked or expired share application_documents returns 0 rows and application_profile_changed returns null; M_B gets CHARA_NOT_FOUND, Ana CHARA_FORBIDDEN, the anonymous caller CHARA_UNAUTHENTICATED; no access-log row is written by either function

**AC7 · Internal notes can be added and are labelled and listed** (browser test (Playwright))

- Given Application X of A; M1 has role member, M2 has role admin at aal2
- When M1 submits the note Call on Monday, then a whitespace-only note, then a note of 2000 characters, then one of 2001 characters, then the text <b>x</b>
- Then the first note appears at the top with author name and time under the label Internal note, visible to your organisation only; M2 sees it; the whitespace-only note is blocked with an inline error and the 2001-character note is blocked with a character counter; the 2000-character note is saved; <b>x</b> is shown as plain text; application_notes rows carry organization_id of the job's organisation and author_id M1

**AC8 · Notes are never visible to the candidate or to other organisations and cannot be altered** (database test (pgTAP))

- Given Application X of A has 2 notes; Ana is the applicant; B is another organisation; PA is a platform administrator who is not a member of A
- When Ana, a member of B, PA and an anonymous caller select from application_notes; Ana and a member of B insert a note for X; a member of A inserts a note with organization_id set to B; the author tries to update and to delete a note
- Then Ana, B's member and PA see 0 rows and the anonymous select fails with permission denied; all three inserts are refused; update and delete are refused for every role, so a note is append-only

**AC9 · Notes are refused for a restricted free plan** (database test (pgTAP))

- Given entitlements_enforced is false: organisation L is lapsed (cancelled subscription, free_employer) and organisation N has never had a subscription; then entitlements_enforced is set to true and organisation E is on free_employer without ever having had a subscription; each has notes already
- When a member of each inserts a note, first with the setting false and then with it true
- Then with the setting false: L is refused with CHARA_FEATURE_NOT_IN_PLAN (detail read_only_free_plan) and no row is added, N succeeds; with the setting true: L and E are refused the same way and N is refused too; existing notes of L and E remain readable

**AC10 · Stage history lists every event with actor and note** (browser test (Playwright))

- Given Ana's application has events: applied (candidate), viewed (M1), shortlisted (M2, note Strong welding record), interview (M1, no note)
- When M1 opens the detail
- Then the timeline shows the 4 events oldest first with the stage labels (from, to), the actor (employer member name, or Candidate), the date and time, and the note under the label Visible to the candidate; a Withdrawn event added later appears in the same way; the timeline has no edit or delete control

**AC11 · Stage change and decline from the detail page** (browser test (Playwright))

- Given Ana's application is Viewed; the plan includes shortlisting; M1 is a member; a second application Bo is Viewed
- When M1 chooses Interview for Ana with the note Interviews in week 41; later chooses Offer; then chooses Not selected for Bo with the template Position filled and presses Review, and then confirms
- Then only the stages allowed for the current stage are offered (Viewed offers Shortlisted, Interview, Not selected; Interview offers Offer, Not selected); the note field is labelled Note (visible to the candidate); each change adds one history entry and the candidate receives one status_changed email within 2 minutes that names the stage and links to the journey tracker but does not contain the note or reason text; the decline first shows a confirmation with the applicant, the target Not selected, the reason and the warning that it is final and the candidate is emailed, and applies nothing until confirmed; a decline without a reason is blocked in the form; after the decline Bo is Not selected, no stage action is offered and a notice says the decision is final

**AC12 · Detail page access guards** (browser test (Playwright))

- Given Application X of organisation A
- When an anonymous visitor, a member of B, the applicant Ana, a platform admin who is not a member, and the owner of A at aal1 open the detail URL of X
- Then the anonymous visitor is sent to login; the member of B and the platform admin receive a 404; Ana is redirected away from the employer area; the owner at aal1 is redirected to the two-step verification page; none of them causes a Viewed event

### Data and validation

- application_notes.body: required, trimmed, 1 to 2000 characters, stored and rendered as plain text
- application_notes.application_id: must belong to a job of organization_id
- application_notes.organization_id: must equal the organisation of the application's job; not settable to another organisation
- application_notes.author_id: defaults to auth.uid(); not client-settable
- application_notes: no update or delete in Phase 1
- stage-change note (application_events.note): optional, at most 1000 characters, visible to the candidate
- decline reason (move to Not selected): a template text or free text, 1 to 1000 non-blank characters, required by the decline form, visible to the candidate, stored in application_events.note
- documentId: uuid contained in passport_shares.scope of the application
- purpose: fixed server-side value application_review (assumed name), not user input
- indicator: true only when the live profile content differs from the snapshot content and the share is neither revoked nor expired; otherwise false or null
- job_applications.profile_snapshot: written once at application time, never updated

### States and transitions

- Applied -> Viewed (system, via open_application, on the first open by a member of the job's organisation; organisation writable)
- Applied -> Shortlisted (employer member, plan includes shortlisting)
- Applied -> Interview (employer member)
- Applied -> Not selected (employer member)
- Viewed -> Shortlisted (employer member, plan includes shortlisting)
- Viewed -> Interview (employer member)
- Viewed -> Not selected (employer member)
- Shortlisted -> Interview (employer member)
- Shortlisted -> Offer (employer member)
- Shortlisted -> Not selected (employer member)
- Interview -> Offer (employer member)
- Interview -> Not selected (employer member)
- Offer -> Hired (employer member)
- Offer -> Not selected (employer member)
- Applied, Viewed, Shortlisted, Interview or Offer -> Withdrawn (candidate only)
- Hired, Not selected and Withdrawn are final

### Roles and permissions

- Organisation member, admin and owner of the job's organisation: may open the detail, open shared documents, add and read internal notes, change stage or decline (subject to plan); owners and admins only at aal2
- Organisation on free_employer when restricted: may read detail, notes and history and open documents of a valid share; denied stage changes, notes and the Viewed update
- Candidate: denied the employer detail page and application_notes; sees stage-change notes and decline reasons in the journey tracker
- Member of another organisation: denied; 404
- Platform staff (admin, verification_reviewer, trust_safety): no function to open candidate documents (FR-F3) and no read path to applicant detail or notes unless also a member
- Anonymous: denied

### Objects

- tables: public.job_applications (profile_snapshot, status, passport_share_id), public.application_events, public.application_notes (application_id, organization_id, author_id, body, proposed: created_at), public.passport_shares (scope, revoked_at, expires_at), public.worker_documents (scan_status, deleted_at, expires_on), public.consents, audit.document_access_log, audit.log
- RPC: set_application_status, document_access_grant(p_document_id, p_purpose)
- Edge Function: document-url (createSignedUrl with 60 seconds)
- proposed: RPC open_application(p_application_id), the only caller that sets chara.actor_fn = 'open_application' and moves Applied to Viewed through the same guard
- proposed: RPC application_documents(p_application_id), returns id, title, type, file name, size and expires_on of the documents in a valid share scope, never a bucket or storage path (worker_documents has owner-only policies)
- proposed: RPC application_profile_changed(p_application_id), returns a boolean or null and exposes no live data
- functions: private.assert_org_writable, private.free_plan_restricted, private.check_rate_limit, private.member_org_ids
- bucket: passport-documents (private; no organisation read policy)
- error codes: CHARA_FORBIDDEN, CHARA_NOT_FOUND, CHARA_UNAUTHENTICATED, CHARA_DOCUMENT_NOT_SCANNED, CHARA_FEATURE_NOT_IN_PLAN, proposed CHARA_INVALID_TRANSITION, proposed CHARA_RATE_LIMITED
- notifications kind status_changed; Edge Function notify
- pages: proposed app/[lang]/(app)/org/[slug]/applicants/[applicationId]; lib/dal/applications.ts

### Open points and assumed defaults

- Contents of free_employer: to be confirmed by CHARA (C11); default assumed: notes and status changes refused, Viewed not set, past applicants and valid document shares stay readable
- Share expiry after Hired or Not selected: to be confirmed by CHARA (P13); default assumed: 30 days (setting share_expiry_days_after_final)
- Moving back from Shortlisted: to be confirmed by CHARA (P17); default assumed: not possible
- Not specified by the sources and assumed here: the system transition to Viewed runs through the proposed RPC open_application (a browser client cannot set chara.actor_fn itself), actor_id of the Viewed event is the opening member, comparison of the live profile with the snapshot is by content, note length limits (2000 and 1000), document-url rate limit of 30 requests per user per 60 seconds, purpose value application_review, no edit or delete of notes
- A decline reason is required by the decline form and by bulk_set_application_status (FR-E3); set_application_status keeps the note optional as in FR-D2; to be confirmed by CHARA
- Owners and admins need aal2 for applicant pages; members are not required to enrol (D8, P7)

## FR-E3 · Bulk actions

> An employer can change stage or decline several applicants at once, with a reason template.

### Acceptance criteria

**AC1 · Selection and confirmation step list every applicant** (browser test (Playwright))

- Given Organisation A is on employer_starter with an active subscription; vacancy J has 6 applications: Applied 3 (Ana, Ben, Chi), Interview 1, Hired 1, Withdrawn 1; M1 is a member
- When M1 ticks the checkboxes of Ana, Ben and Chi (each labelled Select <name>), chooses Decline (Not selected) with the template Position filled and presses Review
- Then the toolbar shows 3 selected; a modal dialog (focus trapped, Esc closes) lists Ana, Ben and Chi with their current stage, the target Not selected, and the reason text under the label Visible to the candidate, with the warning that a decline is final, the candidate is emailed and it cannot be undone; at this point no application, event or email has changed; the action buttons are disabled when 0 are selected; the selection also works from the board cards

**AC2 · Cancelling the confirmation applies nothing** (browser test (Playwright))

- Given the confirmation dialog of AC1 is open
- When M1 presses Cancel, presses Esc, or clicks the backdrop
- Then the dialog closes, the 3 applications keep their stage, no event and no email is created, the selection is kept and focus returns to the Review button

**AC3 · Bulk stage move with note** (browser test (Playwright))

- Given Ana, Ben and Chi are Applied; M1 chose Move to Interview with the note Interviews in week 41
- When M1 confirms and double-clicks the Confirm button
- Then the Confirm button is disabled while the request runs and only one request is sent; the summary says 3 updated, 0 refused; the three rows show Interview and the board counts move; exactly 3 events (applied to interview, actor M1, the note) exist; within 2 minutes the mail catcher holds one status_changed email per candidate, 3 in total

**AC4 · Bulk decline with a reason template is final** (browser test (Playwright))

- Given Dev and Eli are Interview applicants; M1 chose Decline with the template Qualifications do not match the requirements of this role
- When M1 confirms
- Then both applications are Not selected; no undo control is offered anywhere and a later move of either is refused; each candidate's journey tracker shows the reason as the employer's reason; each candidate receives one status_changed email that links to the tracker and does not contain the reason text

**AC5 · Result summary reports refused items** (browser test (Playwright))

- Given Ana is Applied and Ben is Interview, both selected; M1 chose Move to Offer and confirms
- When the request returns
- Then the summary says 1 updated, 1 refused and lists Ana with the message Not allowed from Applied; Ben shows Offer; Ana stays selected and Ben's selection is cleared; exactly 1 event and 1 email exist; no error page appears

**AC6 · Decline and Hired set the share expiry per item** (database test (pgTAP))

- Given Organisation A is on employer_starter with an active subscription; five applications with active document shares: three Interview and two Offer
- When a member calls bulk_set_application_status with the three Interview ids and target rejected and note Position filled, and then with the two Offer ids and target hired
- Then each application has the new status and one event (from, to, actor, note); each of the five shares has expires_at = now() + 30 days (setting share_expiry_days_after_final, tolerance 1 minute) and is not revoked; 5 status_changed notifications exist, one per application

**AC7 · Mixed selection: each item is guarded, refusals are reported and the call is audited** (database test (pgTAP))

- Given a1 is Applied, a2 is Interview, a3 is Hired, all of organisation A
- When a member of A calls bulk_set_application_status with [a1, a2, a3], target offer
- Then a2 becomes Offer with one event and one notification; a1 and a3 are refused with CHARA_INVALID_TRANSITION and stay unchanged; the result lists 3 items (1 ok, 2 refused, each with its error code); exactly one audit.log row exists with the actor, the target offer, requested 3, applied 1 and the ids, and no note text

**AC8 · Lapsed or restricted organisation is refused as a whole** (database test (pgTAP))

- Given entitlements_enforced is false: organisation L is lapsed (cancelled subscription, free_employer) and organisation N has never had a subscription; then entitlements_enforced is set to true and organisation E is on free_employer without a subscription
- When a member of each calls bulk_set_application_status with 3 valid Applied ids and target interview, first with the setting false and then with it true
- Then with the setting false: L is refused with CHARA_FEATURE_NOT_IN_PLAN (detail read_only_free_plan) before any item is processed, with no status change, event, notification or audit row, and N succeeds for all 3; with the setting true: L, E and N are all refused the same way

**AC9 · Unauthorised callers and other organisations' ids** (database test (pgTAP))

- Given Applications of organisation A and one of organisation B; Ana is the candidate of a1; M_B is a member of organisation B; PA is a platform administrator who is not a member; M_A is a member of A
- When an anonymous caller, Ana, M_B and PA (using ids of A) call bulk_set_application_status; M_A calls it with one id of A and one id of B
- Then the anonymous call raises CHARA_UNAUTHENTICATED; Ana's call raises CHARA_FORBIDDEN; the items of M_B and PA are each refused with CHARA_NOT_FOUND, the same result as for ids that do not exist; M_A's item of A is applied and the item of B is refused with CHARA_NOT_FOUND; no other status, event or notification changes

**AC10 · Input limits, duplicates and invalid targets** (database test (pgTAP))

- Given a member of A with valid Applied applications
- When the function is called with 0 ids; with 101 ids; with 100 ids; with [a1, a1]; with target viewed, applied or withdrawn; with a note of 1001 characters; with target rejected and an empty note
- Then 0 ids, 101 ids (counted as sent), the three invalid targets, the 1001-character note and the empty decline reason are each refused with CHARA_INVALID_INPUT and change nothing; 100 ids are processed; [a1, a1] is processed once (one event, one notification)

**AC11 · Stale selections are refused per item and nothing is duplicated** (database test (pgTAP))

- Given a1 and a2 were declined by a bulk call; a3 and a4 are Applied and selected; after the selection a4's candidate withdraws, which revokes the share
- When the identical decline call for a1 and a2 is sent again (a network retry); then the member's bulk move of a3 and a4 to Interview is applied
- Then the retry refuses both items with CHARA_INVALID_TRANSITION because Not selected is final, and the event count stays 2 and the notification count stays 2 for a1 and a2; a3 becomes Interview; a4 is refused with CHARA_INVALID_TRANSITION, stays Withdrawn, keeps its revoked share and receives no further status email

**AC12 · Reason and selection validation in the form** (unit test (Vitest))

- Given the bulk action form schema
- When it is given a decline with no template; the template Other with an empty or blank text; the template Other with 1000 and with 1001 characters; a stage move with no note; a stage move with a 1001-character note; a selection of 0, 100 and 101 applicants
- Then the decline with no template and Other with blank text are invalid; 1000 characters are valid and 1001 are invalid; a stage move with no note is valid and with 1001 characters is invalid; 0 and 101 selected applicants are invalid and 100 is valid

### Data and validation

- application_ids: array of uuid, 1 to 100 items as sent; duplicates are processed once
- to_status: one of shortlisted, interview, offer, hired, rejected; viewed, applied and withdrawn are refused with CHARA_INVALID_INPUT
- note for a stage move: optional, at most 1000 characters, visible to the candidate
- decline reason (to_status rejected): required; a template (proposed keys position_filled, qualifications_not_matching) or the template other with free text of 1 to 1000 non-blank characters; stored in application_events.note
- result: one entry per requested id with application_id, ok and error code
- reason template texts are fixed constants of the application, not user data

### States and transitions

- Applied -> Shortlisted (employer member, plan includes shortlisting)
- Applied -> Interview (employer member)
- Applied -> Not selected (employer member)
- Viewed -> Shortlisted (employer member, plan includes shortlisting)
- Viewed -> Interview (employer member)
- Viewed -> Not selected (employer member)
- Shortlisted -> Interview (employer member)
- Shortlisted -> Offer (employer member)
- Shortlisted -> Not selected (employer member)
- Interview -> Offer (employer member)
- Interview -> Not selected (employer member)
- Offer -> Hired (employer member)
- Offer -> Not selected (employer member)
- Hired, Not selected and Withdrawn are final; an item in a final state is refused

### Roles and permissions

- Organisation member, admin and owner: may run bulk actions on applications of their own organisation (owners and admins at aal2)
- Organisation on free_employer when restricted: denied (whole call)
- Candidate: denied (CHARA_FORBIDDEN)
- Anonymous: denied (CHARA_UNAUTHENTICATED)
- Member of another organisation: denied; ids of other organisations are refused as not found
- Platform staff who are not organisation members: denied; ids are refused as not found

### Objects

- RPC: bulk_set_application_status (applies the set_application_status guard per item), set_application_status
- tables: public.job_applications, public.application_events, public.passport_shares (expires_at, revoked_at), public.notifications, audit.log
- proposed: audit action bulk_status_changed (actor, target, requested, applied, ids; no note text)
- setting: private.settings share_expiry_days_after_final (default 30), entitlements_enforced
- functions: private.assert_org_writable, private.has_feature, private.member_org_ids
- Edge Function: notify; template status_changed
- error codes: CHARA_FEATURE_NOT_IN_PLAN, CHARA_FORBIDDEN, CHARA_UNAUTHENTICATED, CHARA_NOT_FOUND, proposed CHARA_INVALID_TRANSITION, proposed CHARA_INVALID_INPUT
- proposed: constants for the decline reason templates
- pages: app/[lang]/(app)/org/[slug]/applicants (selection, confirmation dialog, result summary); lib/actions; lib/dal/applications.ts

### Open points and assumed defaults

- Undo window for declines: to be confirmed by CHARA (P14); default assumed: no undo, a decline is final and its email is sent
- Contents of free_employer: to be confirmed by CHARA (C11); default assumed: bulk actions refused for a lapsed organisation and, once limits are enforced, for any organisation on free_employer
- Share expiry after Hired or Not selected: to be confirmed by CHARA (P13); default assumed: 30 days
- Not specified by the sources and assumed here: maximum 100 applicants per call, partial success per item (the SOP reports refused items), one audit row per bulk call, template keys and wording (the wording is reviewed with legal, as for all email text), a decline must carry a reason in the form and in this RPC (set_application_status keeps the note optional as in FR-D2)

## FR-E4 · Shortlist

> An employer can move applicants to the Shortlisted state; shortlisting is a plan feature record and is included in every paid plan (to be confirmed by CHARA: whether shortlisting is included in all plans).

### Acceptance criteria

**AC1 · Shortlisting from Applied and Viewed on a plan with the feature** (database test (pgTAP))

- Given Organisation A is on employer_starter with an active subscription and entitlements_enforced is true; a1 is Applied and a2 is Viewed; M1 has role member and O1 has role owner
- When M1 calls set_application_status for a1 and for a2 with target shortlisted and the note Strong profile; O1 shortlists a third Applied application
- Then all three are Shortlisted; each has one application_events row (from applied or viewed, to shortlisted, actor, note); one status_changed notification exists per candidate; the passport_shares rows are unchanged (expires_at null, revoked_at null); the same results hold for employer_professional and employer_enterprise

**AC2 · Shortlisting is refused when the plan lacks the feature** (database test (pgTAP))

- Given entitlements_enforced is true; the plan_features row (employer_starter, shortlisting) is deleted inside the test; a1 is Applied for an organisation on employer_starter; a second organisation has a plan code that does not exist in plans
- When a member shortlists a1; the member of the second organisation shortlists one of its applications; the first member then moves a1 to Interview
- Then both shortlist attempts raise CHARA_FEATURE_NOT_IN_PLAN with detail shortlisting, the status stays unchanged and no event or notification is created; the move to Interview succeeds

**AC3 · Seeded plans carry the shortlisting feature** (database test (pgTAP))

- Given the seeded billing.plan_features
- When the rows for feature_key shortlisting are read
- Then Rows exist for employer_starter, employer_professional and employer_enterprise and none exists for free_employer

**AC4 · Behaviour while limits are not enforced and for a lapsed organisation** (database test (pgTAP))

- Given entitlements_enforced is false; organisation N has never had a subscription; organisation L has a cancelled subscription (free_employer)
- When a member of N and a member of L each shortlist an Applied application
- Then N succeeds because has_feature returns true while enforcement is off; L is refused with CHARA_FEATURE_NOT_IN_PLAN (detail read_only_free_plan) because the lapse rule applies first and does not depend on the setting

**AC5 · Only Applied and Viewed applications can be shortlisted** (database test (pgTAP))

- Given applications in Interview, Offer, Hired, Not selected and Withdrawn, and one already Shortlisted; the plan includes shortlisting
- When a member calls set_application_status with target shortlisted on each
- Then every call is refused with CHARA_INVALID_TRANSITION and the status is unchanged; no event or notification is created

**AC6 · Leaving the shortlist follows the transition table** (database test (pgTAP))

- Given five Shortlisted applications s1 to s5 of a writable organisation; the candidate of s5 withdraws
- When a member moves s1 to Interview, s2 to Offer and s3 to Not selected, and tries to move s4 to Applied, to Viewed and to Hired
- Then the three moves succeed with one event each; the three moves of s4 are refused with CHARA_INVALID_TRANSITION and s4 stays Shortlisted; the candidate's withdrawal of s5 succeeds

**AC7 · No separate shortlist flag exists** (database test (pgTAP))

- Given the schema after the applications migration
- When the columns of public.job_applications and public.application_events are listed and a vacancy has 2 Shortlisted applications
- Then no column named shortlisted exists; the number of shortlisted applicants is the count of applications with status shortlisted, which is 2

**AC8 · Bulk shortlisting without the feature is refused as a whole** (database test (pgTAP))

- Given entitlements_enforced is true; the organisation's plan has no shortlisting row; 3 Applied applications
- When a member calls bulk_set_application_status with the 3 ids and target shortlisted; the plan_features row is then added and the call is repeated
- Then the first call raises CHARA_FEATURE_NOT_IN_PLAN with detail shortlisting and changes nothing; after the row is added without any deployment the second call shortlists all 3

**AC9 · A plan change does not disturb existing shortlisted applicants** (database test (pgTAP))

- Given an application is Shortlisted; the organisation moves to a plan without the shortlisting feature
- When a member reads the applicant and moves it to Interview, and tries to shortlist another Applied application
- Then the application stays Shortlisted and readable, the move to Interview succeeds, and the new shortlist attempt is refused with CHARA_FEATURE_NOT_IN_PLAN

**AC10 · Shortlisted is a filter and a board column** (browser test (Playwright))

- Given Vacancy J on a plan with shortlisting has 1 Shortlisted and 2 Applied applications
- When M1 opens list and board, applies the stage filter Shortlisted, and shortlists an Applied card from the board menu
- Then the filter lists the Shortlisted applications; the board shows a Shortlisted column whose count goes from 1 to 2 and holds the moved card; Shortlist is offered only on Applied and Viewed cards

**AC11 · Upgrade prompt when the plan does not include shortlisting** (browser test (Playwright))

- Given entitlements_enforced is true and the organisation's plan has no shortlisting row; one viewer is an owner at aal2 and one is a member
- When each opens the board and an applicant detail and tries to drop an Applied card on the Shortlisted column
- Then Shortlist actions are replaced by Upgrade to shortlist applicants; the Shortlisted column does not accept drops; the owner's prompt links to the organisation's billing page; the member's prompt asks to contact an owner or admin and has no link; no shortlist request is sent to the server; other moves still work

**AC12 · Outsiders cannot shortlist** (database test (pgTAP))

- Given an Applied application of organisation A on a plan with shortlisting; Ana is its candidate; M_B is a member of organisation B; PA is a platform administrator who is not a member
- When an anonymous caller, Ana, M_B and PA call set_application_status with target shortlisted
- Then the anonymous call raises CHARA_UNAUTHENTICATED; Ana's call raises CHARA_FORBIDDEN; the calls of M_B and PA raise CHARA_NOT_FOUND; the application stays Applied and no event or notification is created

### Data and validation

- to_status: shortlisted; allowed only from applied or viewed
- note: optional, at most 1000 characters, visible to the candidate and labelled so
- feature key: shortlisting, a row in billing.plan_features (plan_code, feature_key)
- has_feature(org, 'shortlisting'): true while entitlements_enforced is false; otherwise true only when the organisation's plan has the row; an unknown plan code denies
- no shortlisted flag column; the state is job_applications.status = 'shortlisted'

### States and transitions

- Applied -> Shortlisted (employer member, plan includes shortlisting)
- Viewed -> Shortlisted (employer member, plan includes shortlisting)
- Shortlisted -> Interview (employer member)
- Shortlisted -> Offer (employer member)
- Shortlisted -> Not selected (employer member)
- Shortlisted -> Withdrawn (candidate)

### Roles and permissions

- Organisation member, admin and owner: may shortlist when the plan includes shortlisting (owners and admins at aal2)
- Organisation without the feature: denied with CHARA_FEATURE_NOT_IN_PLAN; sees an upgrade prompt
- Organisation on free_employer when restricted: denied (read-only)
- Candidate: denied; sees the resulting stage in the journey tracker
- Member of another organisation, anonymous, platform staff who are not members: denied

### Objects

- RPC: set_application_status, bulk_set_application_status
- functions: private.has_feature, private.assert_org_writable, private.org_plan_code
- tables: billing.plan_features, billing.plans, public.job_applications, public.application_events, public.notifications
- setting: private.settings entitlements_enforced
- error codes: CHARA_FEATURE_NOT_IN_PLAN, CHARA_FORBIDDEN, CHARA_NOT_FOUND, CHARA_UNAUTHENTICATED, proposed CHARA_INVALID_TRANSITION
- notifications kind status_changed
- pages: app/[lang]/(app)/org/[slug]/applicants (stage filter, Shortlisted column, upgrade prompt), app/[lang]/(app)/org/[slug]/billing

### Open points and assumed defaults

- Whether shortlisting is included in all plans: to be confirmed by CHARA (FR-E4, C16); default assumed: every paid plan from employer_starter, seeded as plan_features rows
- Moving back from Shortlisted to Applied or Viewed: to be confirmed by CHARA (P17); default assumed: not possible
- Contents of free_employer and when limits are enforced: to be confirmed by CHARA (C11); default assumed as in ARCHITECTURE section 10.4

## FR-E5 · Dashboard

> The organisation dashboard shows open vacancies, new applications in the last 7 days, applicants by stage, and plan and trial status.

### Acceptance criteria

**AC1 · Open vacancies card** (browser test (Playwright))

- Given Organisation A has 2 Open, 1 Paused, 1 Draft, 1 Closed and 1 Filled vacancy and 1 soft-deleted Open vacancy; M1 is a member
- When M1 opens the dashboard of A
- Then the Open vacancies card shows 2 and links to the vacancy list filtered to Open

**AC2 · New applications in the last 7 days** (browser test (Playwright))

- Given Organisation A has applications created 1 hour ago (Applied), 3 days ago (Withdrawn), 6 days 23 hours ago (Interview), 7 days 1 hour ago (Applied) and 30 days ago (Hired); organisation B has 4 applications created today
- When M1 opens the dashboard of A
- Then the New applications card shows 3 (a rolling 7 x 24 hour window, any current stage, only organisation A) and links to the organisation-wide applicant list sorted by applied date (FR-E1)

**AC3 · Applicants by stage, computed fresh on each load** (browser test (Playwright))

- Given Organisation A has 10 applications over an Open, a Paused and a Closed vacancy: Applied 3, Viewed 2, Shortlisted 1, Interview 1, Offer 0, Hired 1, Not selected 1, Withdrawn 1
- When M1 opens the dashboard, then moves one Applied application to Interview and reloads it
- Then Eight stage rows show 3, 2, 1, 1, 0, 1, 1, 1 (total 10, Not selected labelled as such, Offer shown as 0) and each links to the organisation-wide applicant list filtered by that stage; after the move and a reload they show Applied 2 and Interview 2; the response is not cached (Cache-Control private, no-store) and no stale number appears

**AC4 · Numbers never include another organisation's data** (database test (pgTAP))

- Given Organisation A has 3 applications and 2 Open vacancies; organisation B has 5 applications and 1 Open vacancy; a candidate with no application to A or B; PA is a platform administrator who is not a member
- When the dashboard queries for applications (last 7 days and by status) run as a member of A for A, as a member of B for B, as a member of B with A's organisation id, as the candidate, as PA and as the anonymous role; the Open vacancy query runs as a member of A for A and a member of B for B
- Then A's member gets 3 applications and 2 Open vacancies, B's member gets 5 and 1; B's member asking for A, the candidate and PA get 0 applications; the anonymous role is refused with permission denied

**AC5 · Plan and trial status card and trial-ending alert** (browser test (Playwright))

- Given Organisation T has a trialing subscription on employer_starter with trial_ends_at 10 days 5 hours from now; organisation T2 has one with trial_ends_at 48 hours from now; organisation P has an active subscription with current_period_end 2026-11-03; each viewed by an owner at aal2 and a member
- When they open their dashboards
- Then T's card shows the plan name from billing.plans, the status Trial, the trial end date and 11 days left (whole days, rounded up) and no alert; T2 shows an alert (role alert) with the trial end date and 2 days left, with a link to the billing page for the owner and no link for the member; P's card shows the plan name, the status Active and the next billing date 2026-11-03; no provider reference is shown

**AC6 · Trial-ending alert rule** (unit test (Vitest))

- Given the pure function that derives the trial alert and the days left from status, trial_ends_at and now
- When it is called with trialing and 72 hours left, 72 hours plus 1 minute left, 1 minute left, 0 or fewer minutes left; with 10 days 5 hours left; and with status active or canceled
- Then the alert is shown at 72 hours and at 1 minute, and not at 72 hours plus 1 minute, at 0 or fewer minutes, or for active and canceled; days left is 3, 1 and 11 for 72 hours, 1 minute and 10 days 5 hours; it is 0 for 0 or fewer minutes and never negative

**AC7 · Payment issue alert** (browser test (Playwright))

- Given Organisation Q has a past_due subscription with past_due_since 2 days ago; viewers are an owner at aal2 and a member
- When each opens the dashboard
- Then a prominent warning above the cards (role alert) says the payment failed and shows the grace end date, past_due_since plus 7 days, with 5 days left (whole days, rounded up); the plan card shows the status Past due and still shows the paid plan name; the owner's warning links to the billing page; the member's warning has no link

**AC8 · Organisations without an active paid plan** (browser test (Playwright))

- Given Organisation L has a cancelled subscription, 2 Paused vacancies and 7 past applicants; organisation N is new with no subscription row, no vacancy and no application; each viewed by an owner at aal2 and a member
- When they open the dashboard
- Then L shows Free plan, no trial date, a banner that the subscription has ended, vacancies are paused and applicant changes are disabled, Open vacancies 0, and the 7 past applicants by stage; N shows Free plan, all counts 0, no banner, and an empty state with a Create your first vacancy link; for both, the owner sees a Choose a plan link to the billing page and the member sees text asking to contact an owner or admin and no billing link

**AC9 · Dashboard access guards** (browser test (Playwright))

- Given the dashboard of organisation A
- When an anonymous visitor, a candidate, a member of organisation B, a platform administrator who is not a member, the owner of A at aal1 without enrolment and a member of A at aal1 request it
- Then the anonymous visitor is sent to login; the candidate is redirected to the candidate dashboard; the member of B and the platform administrator receive a 404 for slug a; the owner at aal1 is redirected to the two-step verification page; the member of A sees the dashboard

**AC10 · Loading and error states** (browser test (Playwright))

- Given M1 opens the dashboard
- When the queries are delayed by 2 seconds; one card's query fails while the others succeed
- Then each card shows a skeleton while loading; the failing card shows an error message with a Retry button and an error toast while the other cards render their numbers

**AC11 · Keyboard, labels and 360 px layout** (browser test (Playwright))

- Given the dashboard with data, viewport 360 px wide, keyboard only
- When the user tabs through the page
- Then each card is a link in a logical order with an accessible name such as Open vacancies: 2; the stage counts are a table with column headers; no meaning depends on colour alone; at 360 px the cards stack in one column with no horizontal scrolling; axe-core reports no violation of impact serious or critical

**AC12 · Dashboard render time** (manual check)

- Given a database with 10,000 vacancies and 50,000 candidates and organisations of several sizes
- When a load test renders the dashboard for a mix of organisations
- Then 95 % of renders complete within 500 ms server time (NFR-P1) and the query plans use the indexes on jobs (organization_id, status) and job_applications (job_id, status) and (job_id, created_at)

### Data and validation

- openVacancies: integer, count of jobs of the organisation with status open and deleted_at null
- newApplications7d: integer, count of job_applications of the organisation's jobs with created_at at or after now() minus 7 days, any current status
- byStage: eight integers (applied, viewed, shortlisted, interview, offer, hired, rejected shown as Not selected, withdrawn) over all applications of the organisation's non-deleted jobs; zero counts are shown
- plan: name from billing.plans of the resolved plan code (private.org_plan_code), status (trialing, active, past_due, or free fallback; a paused subscription is not produced in Phase 1 and would resolve to the free plan), trial_ends_at, current_period_end, past_due_since
- daysLeft: whole days, rounded up, never negative; trial alert when 0 < remaining <= 72 hours and status is trialing
- grace end: past_due_since plus 7 days, days left rounded up
- no fields are stored by this requirement; all values are computed on each load

### Roles and permissions

- Organisation member, admin and owner: may view the dashboard of their organisation; owners and admins at aal2
- Owner and admin: see the links to the billing page; members see plan and payment status without a billing link
- Candidate: denied; redirected to the candidate dashboard
- Member of another organisation: denied; 404
- Anonymous: denied; redirected to login
- Platform staff who are not members: denied; 404

### Objects

- tables: public.jobs (status, organization_id, deleted_at), public.job_applications (status, created_at), public.v_my_subscription, public.v_plans
- functions: private.member_org_ids, private.org_plan_code
- proposed: indexes on public.jobs (organization_id, status) and public.job_applications (job_id, status) and (job_id, created_at)
- pages: app/[lang]/(app)/dashboard/employer (the active organisation is passed as its slug and validated against membership by the DAL; proposed shape dashboard/employer?org=<slug>), links to org/[slug]/jobs, org/[slug]/applicants (organisation-wide list of FR-E1), org/[slug]/billing; lib/dal/applications.ts
- billing subscription statuses trialing, active, past_due, canceled; notification kinds trial_ending and payment_failed (emails are owned by FR-I2)

### Open points and assumed defaults

- Contents of free_employer and the lapse rules: to be confirmed by CHARA (C11); default assumed: past applicants readable, vacancies paused, application changes refused
- Display name of the lowest paid plan: open (C13); the card shows the name stored in billing.plans
- Whether a new organisation is offered a free trial depends on the legal-entity check (C14, C15), so the dashboard offers Choose a plan, not Start free trial
- Not specified by the sources and assumed here: owners and admins at aal1 are sent to the MFA page for the dashboard because it aggregates applicant data (members are not required to enrol, D8); members read plan status through the minimal view v_my_subscription, and if the aal2 gate on billing reads also covers that view the plan card shows only the plan name to members
- Not specified and assumed here: the 7-day window is rolling and counts every current stage including Withdrawn; Open vacancies counts status open and deleted_at null (the active_jobs limit trigger in ARCHITECTURE section 10.4 does not filter deleted_at, so the two counts can differ for a soft-deleted open vacancy)
