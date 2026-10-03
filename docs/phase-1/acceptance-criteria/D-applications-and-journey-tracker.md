# Group D: Applications and journey tracker

## FR-D1 · Apply

> A candidate applies to an Open vacancy once, with an optional cover note and a selection of documents to share; applying records consent and creates a share scoped to that employer. In Phase 1 direct applications have no monthly limit and are open for every country pair, with a general notice that cross-border hiring can be subject to legal requirements (to be confirmed by CHARA: whether the monthly candidate-submissions limit applies to direct applications; whether direct applications may go live for all country pairs before country-specific rules exist, subject to legal review).

### Acceptance criteria

**AC1 · Apply with cover note, selected document and consent** (browser test (Playwright))

- Given a signed-in candidate (account_kind worker, active) with a complete profile (first name, last name, current country, occupation) and two uploaded documents, CV.pdf and Certificate.pdf; an Open, visible vacancy 'Welder' of the employer 'Nordic Build GmbH'
- When the candidate opens the vacancy page, clicks Apply, types a 200-character cover note, ticks only CV.pdf, ticks the consent checkbox 'I agree to share the selected documents with Nordic Build GmbH for this application' and clicks 'Submit application'
- Then the candidate is taken to the application page showing stage 'Applied' and a timeline with one event 'Applied' dated today, and the application is listed in My applications with stage 'Applied'

**AC2 · One transaction writes consent, share, application, event, audit and notification queue entries** (database test (pgTAP))

- Given the same candidate and vacancy as AC1, where the organisation has three accepted members (owner, admin, member) with default notification preferences
- When apply_to_job(job_id, note, [cv_id]) runs as the candidate
- Then exactly these rows are added and no others: 1 job_applications row (status applied, cover_note stored, passport_share_id set, profile_snapshot set); 1 passport_shares row (worker_user_id = candidate, organization_id = the job's organisation, application_id = the new application, scope = a jsonb array holding exactly the CV id, consent_id set, expires_at null, revoked_at null); 1 consents row (purpose 'share_passport:<organisation id>', action granted, version = the sharing-notice version); 1 application_events row (from_status null, to_status applied, actor_id = candidate, note null); 1 audit.log row (action application.submitted (proposed name), entity_type job_application, entity_id = the application id, metadata without the cover note); 3 notifications rows (kind application_received, channel email, status queued, one per member) each with one message in the pgmq notification queue, and none for the candidate

**AC3 · A failure leaves nothing behind** (database test (pgTAP))

- Given a valid Open vacancy and a candidate with a complete profile, in three variants: (a) document_ids holds one own document and one document owned by another candidate, (b) document_ids holds an own document whose deleted_at is set, (c) a test trigger makes the insert into notifications raise an error
- When apply_to_job runs in each variant
- Then Variants (a) and (b) are refused with CHARA_NOT_FOUND (the same code for a foreign and for a deleted document) and variant (c) fails with the trigger error; in all three the row counts of job_applications, passport_shares, consents, application_events, audit.log, notifications and the pgmq notification queue are identical to before the call

**AC4 · Share scope holds the selected document ids only** (database test (pgTAP))

- Given a candidate with two documents of type cv (cv_old and cv_new, scan_status 'skipped') who applies to vacancy V1 selecting only cv_old, then uploads a third cv (cv_later), then applies to a second vacancy V2 of the same organisation selecting no document; a member of the organisation
- When the member calls document_access_grant for cv_old, cv_new and cv_later (purpose 'review'), and for cv_old again with only the V2 share active
- Then passport_shares.scope of V1 is ['<cv_old id>'] and of V2 is [] (empty array, never document types); the grant for cv_old via V1 succeeds and writes one audit.document_access_log row (share_id = the V1 share); the grants for cv_new and cv_later raise CHARA_FORBIDDEN and write no log row; with V1 withdrawn, every grant (including cv_old) is refused with CHARA_FORBIDDEN because the V2 share lists no document

**AC5 · Applications are refused for a closed vacancy, an incomplete profile or invalid input** (database test (pgTAP))

- Given a candidate with a complete profile and vacancies with status draft, paused, closed or filled; with moderation_state hidden or org_suspended; with deleted_at set; a non-existent job id; separately a candidate whose worker_profiles row lacks occupation_id and current_country (or does not exist); separately an Open vacancy with inputs: a 2001-character note, 11 document ids, a note of 2000 characters padded with spaces to 2010, a note of only spaces
- When apply_to_job is called for each case
- Then every vacancy case raises CHARA_JOB_NOT_OPEN (one code for hidden, deleted, closed and unknown ids, so the reason is not leaked); the profile case raises CHARA_PROFILE_INCOMPLETE with detail 'current_country, occupation_id' (a missing worker_profiles row lists all four required fields); the 2001-character note and the 11 ids raise CHARA_INVALID_INPUT; the padded note is stored trimmed and the spaces-only note is stored as null; in every refused case no row is written to job_applications, passport_shares, consents, application_events, audit.log, notifications or the queue

**AC6 · Only an active candidate account may apply** (database test (pgTAP))

- Given an anonymous session, a company user who is a member of an organisation, a user whose profiles.account_kind is still null, a candidate with profiles.status 'suspended', a candidate with profiles.deleted_at set (account closure requested), and an Open vacancy
- When each calls apply_to_job for the vacancy
- Then the anonymous call fails with permission denied for function apply_to_job (no EXECUTE for anon); the company user, the user without account kind, the suspended candidate and the candidate in closure get CHARA_FORBIDDEN; no rows are written; direct INSERT into job_applications, application_events, passport_shares and consents by a candidate fails with SQLSTATE 42501

**AC7 · Anonymous visitor is sent to login and returned to the apply form** (browser test (Playwright))

- Given a visitor who is not signed in on the page of an Open vacancy
- When the visitor clicks Apply and then signs in with valid candidate credentials
- Then the browser goes to /login with a next parameter pointing to the apply page of that vacancy and, after login, shows the apply form for the same vacancy; a next value pointing to another origin (for example https://evil.example) is ignored and the candidate lands on the worker dashboard instead

**AC8 · Form schema validates note, documents and consent** (unit test (Vitest))

- Given the apply form zod schema shared by the form and the Server Action
- When it parses: a cover note of 2000 characters; of 2001 characters; only spaces; '<script>alert(1)</script>'; 10 document ids; 11 document ids; the same document id twice; consent not ticked
- Then 2000 characters is accepted; 2001 is rejected with 'Cover note must be at most 2000 characters'; only spaces becomes null after trimming; the script text is accepted unchanged as plain text (it is never sanitised or interpreted; escaped rendering is tested in FR-E2); 10 ids are accepted; 11 are rejected; the duplicate id collapses to one entry; an unticked consent is rejected with 'Confirm that you agree to share the selected documents' and the RPC is not called

**AC9 · Profile snapshot is stored at apply time and does not change later** (database test (pgTAP))

- Given a candidate with headline 'Welder', skills, two languages with CEFR levels, 6 years of experience, availability now, two preferred countries and one work-authorisation country with an expiry date
- When the candidate applies and afterwards changes the headline to 'Senior welder' and removes one skill
- Then job_applications.profile_snapshot (proposed content) contains first name, last name, headline 'Welder', current country, occupation, skills, languages with CEFR level, years of experience, availability, preferred countries and work-authorisation countries with expiry; it contains no email address, date of birth, storage path or document file name; the stored snapshot still shows 'Welder' and the removed skill after the edit; an UPDATE of profile_snapshot by the candidate or a member is denied

**AC10 · No monthly limit and no country-pair block for direct applications** (database test (pgTAP))

- Given a candidate with current_country 'PH' and 30 different Open, visible vacancies located in DE, AE, PH and SA, created within the same calendar month
- When the candidate applies to all 30 within that month
- Then all 30 applications are created and none is refused for country reasons; no row of private.usage_counters is created or changed by apply_to_job

**AC11 · Apply form: notice, field order, labels and empty documents** (browser test (Playwright))

- Given the apply form for an Open vacancy, opened by a candidate with two documents and by a candidate with no documents
- When the page is rendered and used with the keyboard
- Then the notice that cross-border hiring can be subject to legal requirements is visible above the Submit button in both cases; Tab order is cover note (label 'Cover note (optional)', counter 0/2000), one checkbox per document labelled with its title, the consent checkbox, Submit; for the candidate with no documents the form says 'You have no documents yet. You can still apply, or add documents first' with a link to the passport documents page and Submit stays enabled

**AC12 · Apply form: pending, failure, paused vacancy and incomplete profile** (browser test (Playwright))

- Given the apply form with valid input, in four situations: submission in progress; the server fails; the vacancy was paused after the page was opened; the candidate's profile misses current_country
- When the candidate submits (or opens the form, for the incomplete profile)
- Then While submitting the button is disabled and reads 'Submitting'; a server failure shows an error alert and keeps the typed note and ticked boxes; a paused vacancy shows 'This vacancy is no longer accepting applications' with a link to the vacancy search and creates nothing; an incomplete profile lists the missing fields as links to the matching passport sections and the form cannot be submitted

### Data and validation

- job_id: uuid, required; must reference a job with status 'open', moderation_state 'visible' and deleted_at null
- cover_note: optional text; trimmed; at most 2000 characters (proposed limit, enforced in the form and in apply_to_job); empty after trimming is stored as null; plain text, stored as typed after trimming
- document_ids: optional uuid array; at most 10 entries (proposed limit); duplicates collapse; each id must be an own, non-deleted worker_documents row; empty array allowed
- consent: checkbox required in the form; recorded as a consents row with purpose 'share_passport:<organisation id>', action 'granted' and the version of the sharing notice shown
- job_applications.status: set to 'applied' on creation
- job_applications.passport_share_id: set to the share created in the same transaction; passport_shares.application_id points back
- passport_shares.scope: jsonb array of the selected document ids, never document types
- passport_shares.expires_at and revoked_at: null on creation
- job_applications.profile_snapshot: jsonb copy of the profile at apply time (proposed content, see AC9); no email, date of birth, identity numbers or storage paths
- Minimum profile to apply (proposed; the SOP does not list the fields): worker_profiles row with first_name, last_name, current_country and occupation_id not null
- application_events first row: from_status null, to_status 'applied', actor_id = candidate, note null
- apply_to_job result: application id and outcome 'created' or 'existing' (see FR-D7)

### States and transitions

- (none) -> Applied (candidate; vacancy Open and visible, profile complete, no non-withdrawn application for the same vacancy)

### Roles and permissions

- Candidate (account_kind worker, active): may apply to an Open, visible vacancy and select only own non-deleted documents; denied applying to Draft, Paused, Closed, Filled, hidden or deleted vacancies; denied any direct insert into job_applications, application_events, passport_shares or consents
- Anonymous visitor: denied (no EXECUTE); redirected to login with a validated next path
- Suspended candidate, candidate with account closure requested, user without account kind: denied
- Employer owner, admin and member: denied applying (company account); may later read the resulting application only for their own vacancies (FR-D5)
- Platform administrator, verification reviewer, trust and safety administrator: denied applying; no read path to shared documents in Phase 1

### Objects

- public.apply_to_job(job_id, note, document_ids)
- public.job_applications (status, cover_note, passport_share_id, profile_snapshot)
- public.application_events
- public.passport_shares (scope, consent_id, application_id, expires_at, revoked_at)
- public.consents
- audit.log via audit.record()
- public.notifications, public.notification_preferences, pgmq notification queue
- public.jobs (status, moderation_state, deleted_at)
- public.worker_profiles and children, public.worker_documents, public.profiles (account_kind, status, deleted_at)
- public.document_access_grant, audit.document_access_log
- private.usage_counters (not touched)
- private.check_rate_limit (see FR-D7)
- proposed: error codes CHARA_JOB_NOT_OPEN, CHARA_PROFILE_INCOMPLETE, CHARA_INVALID_INPUT
- proposed: audit action application.submitted
- Pages: app/[lang]/(public)/jobs (vacancy page with Apply), proposed: app/[lang]/(app)/jobs/[id]/apply, app/[lang]/(app)/applications
- lib/dal/applications.ts, lib/actions (apply Server Action, zod schema), lib/safe-next.ts, lib/i18n/en.json copy for the cross-border notice

### Open points and assumed defaults

- C17: whether the monthly candidate-submissions limit applies to direct applications; default assumed: it applies to partner submissions only (later phase), direct applications are not capped in Phase 1.
- L8: whether direct applications may go live for every country pair before the corridor rules engine exists; default assumed: yes in Phase 1 with the general cross-border notice; needs owner and legal confirmation before launch.

## FR-D2 · Status pipeline

> An application has the states Applied, Viewed, Shortlisted, Interview, Offer, Hired, Not selected and Withdrawn; every change is recorded as an event with actor, previous state, new state, note and time.

### Acceptance criteria

**AC1 · Transition table accepts exactly the listed moves** (database test (pgTAP))

- Given Applications in each of the 8 states and a member (role member) of the job's organisation on a plan that includes shortlisting
- When set_application_status (and bulk_set_application_status for the same moves, per application) is called for every pair of current state and target state (8 x 8 = 64 pairs, each on a fresh application)
- Then exactly these 13 moves succeed: applied to shortlisted, interview or rejected; viewed to shortlisted, interview or rejected; shortlisted to interview, offer or rejected; interview to offer or rejected; offer to hired or rejected; each writes one application_events row with actor_id, from_status, to_status, note and created_at; the other 51 pairs (same state to same state, any move back to applied or viewed, applied to offer or hired, interview to hired, any move out of hired, rejected or withdrawn, and any target 'withdrawn') are refused with CHARA_INVALID_TRANSITION, leave status, events, notifications and passport_shares unchanged

**AC2 · Viewed is set by the system on the first open only** (database test (pgTAP))

- Given an application in state applied and two members of the job's organisation
- When a member calls set_application_status(id, 'viewed'); the candidate calls mark_application_viewed; then member 1 opens the applicant detail page (which calls mark_application_viewed); then member 2 opens it; then a member opens an application that is in state shortlisted
- Then the direct set_application_status call is refused with CHARA_INVALID_TRANSITION for owner, admin and member alike; the candidate's call is refused with CHARA_FORBIDDEN; the first member open moves applied to viewed and writes one event with actor_id null; the second open writes no event and changes nothing; the open of the shortlisted application changes nothing; no status_changed notification is queued for any viewed move

**AC3 · Only members of the job's organisation may change a status** (database test (pgTAP))

- Given for each caller a fresh application X in state applied to a vacancy of organisation A; callers: owner, admin and member of A (all accepted), a member of organisation B, a member of A with accepted_at null, a member of A after A was set to suspended, the candidate who owns X, an anonymous session, and platform staff with roles admin, trust_safety and verification_reviewer at aal2
- When each calls set_application_status(X, 'interview')
- Then Owner, admin and member of A succeed (minimum role member); the member of B, the member of A with accepted_at null and the three staff roles get CHARA_NOT_FOUND (the same error as for a non-existent id); the member of the suspended organisation and the candidate get CHARA_FORBIDDEN (proposed detail 'organization_suspended' for the first); the anonymous call fails with permission denied for function; X is unchanged after every refused call

**AC4 · Plan gates on shortlisting and on free_employer** (database test (pgTAP))

- Given Organisations: P on employer_starter with entitlements_enforced true; Q on a paid plan with no shortlisting feature row, entitlements_enforced true; R never subscribed with entitlements_enforced false; S with a cancelled subscription (back on free_employer) and entitlements_enforced false; T never subscribed with entitlements_enforced true
- When a member of each organisation moves a fresh applied application to shortlisted and, separately, to interview (set_application_status, and bulk_set_application_status for the same moves), and opens the applicant
- Then P: both succeed; Q: shortlisted raises CHARA_FEATURE_NOT_IN_PLAN with detail 'shortlisting', interview succeeds; R: both succeed; S and T: both raise CHARA_FEATURE_NOT_IN_PLAN with detail 'read_only_free_plan' and change nothing; mark_application_viewed leaves S and T applications in applied; the candidates' withdraw_application still works for all five organisations

**AC5 · Stage-change note rules and visibility** (database test (pgTAP))

- Given a member moving applications to rejected with a note, and the candidate who owns them
- When the note is 1000 characters, 1001 characters, empty, or '  Position filled  '
- Then 1000 characters is stored in application_events.note; 1001 is refused with CHARA_INVALID_INPUT and nothing changes; empty is stored as null; the padded text is stored trimmed as 'Position filled'; the candidate can read the note through v_my_application_timeline; no row is written to application_notes by set_application_status

**AC6 · Events are append-only and written only by the RPCs** (database test (pgTAP))

- Given Existing application_events rows; the roles authenticated (member and candidate), anon, service_role, and the table owner postgres outside the RPCs
- When INSERT, UPDATE, DELETE and TRUNCATE on application_events are attempted by each of them
- Then for authenticated, anon and service_role every statement fails with permission denied (no grant); for the table owner UPDATE, DELETE and TRUNCATE are blocked by a trigger; the rows are unchanged; the only INSERT path is the RPCs (an INSERT by the owner inside apply_to_job, set_application_status, mark_application_viewed and withdraw_application succeeds)

**AC7 · Status, event, audit, notification and queue are one transaction** (database test (pgTAP))

- Given an application in state applied and a test trigger that makes the insert into notifications raise an error
- When a member calls set_application_status(id, 'shortlisted', 'note')
- Then the call fails; status is still 'applied'; no row is added to application_events, audit.log, notifications or the pgmq queue and passport_shares is unchanged; without the trigger the same call writes the new status, 1 event, 1 audit.log row (action application.status_changed (proposed name), metadata application id, organisation id, from, to, no note text), 1 status_changed notification to the candidate with 1 queue message

**AC8 · Share expiry is set when the application reaches Hired or Not selected** (database test (pgTAP))

- Given Applications in offer and in interview with active shares, setting share_expiry_days_after_final = 30 (then changed to 14)
- When a member moves one to hired and the other to rejected; the test then sets expires_at into the past as table owner and a member calls document_access_grant before and after
- Then passport_shares.expires_at = transaction time + 30 days (14 days after the setting change) for both hired and rejected; moves to shortlisted, interview and offer leave expires_at null; document_access_grant succeeds while expires_at is in the future and raises CHARA_FORBIDDEN once it is past; revoked_at stays null

**AC9 · Bulk moves apply the guard to each item** (database test (pgTAP))

- Given a member of organisation A and three applications: one in applied, one in hired, one non-existent id
- When bulk_set_application_status moves all three to rejected with the note 'Position filled'
- Then the applied item becomes rejected with its own event, its own audit row and its own status_changed notification; the hired item is refused with CHARA_INVALID_TRANSITION and the unknown id with CHARA_NOT_FOUND, each reported per item (result shape proposed in FR-E3) and leaving no row; for a restricted free_employer organisation every item is refused with CHARA_FEATURE_NOT_IN_PLAN

**AC10 · Concurrent changes produce one consistent history** (browser test (Playwright))

- Given an application in state shortlisted and two members of the organisation in two browser contexts
- When both submit Not selected with different notes at the same moment
- Then exactly one move is applied; the other receives CHARA_INVALID_TRANSITION and the UI shows 'This applicant was already moved. Reload to see the current stage'; the application has exactly one new event, the final status is rejected with the winning note, and the candidate receives exactly one status_changed email

**AC11 · Stage machine and labels in code match the transition table** (unit test (Vitest))

- Given the shared stage machine module (packages/shared) and the label map
- When allowedTargets(state, role, features) is evaluated for all 8 states and label(state) for all 8 values
- Then allowedTargets returns exactly the targets of the transition table (nothing for hired, rejected and withdrawn; shortlisted omitted when the shortlisting feature is absent; viewed and withdrawn never offered to employers); label('rejected') is 'Not selected' and the other labels are Applied, Viewed, Shortlisted, Interview, Offer, Hired, Withdrawn

**AC12 · Employer status change in the browser** (browser test (Playwright))

- Given an organisation member on the applicant detail page of an application in state viewed
- When the member opens the stage menu with the keyboard (Enter), chooses 'Not selected', types a note in the field labelled 'Visible to the candidate', confirms in the dialog that lists the applicant, the target stage and the note, and submits
- Then the menu offers only Shortlisted, Interview and Not selected; Escape closes the dialog and returns focus to the menu button; the page shows stage 'Not selected' and a history entry with the note; while pending the confirm button is disabled; an error from the RPC is shown as a toast and the stage is unchanged; the candidate's tracker shows the same note

### Data and validation

- p_application_id: uuid, required; must be visible to the caller as an accepted member of the job's organisation
- p_status: one of shortlisted, interview, offer, hired, rejected; 'applied', 'viewed' and 'withdrawn' are refused with CHARA_INVALID_TRANSITION
- p_note: optional text, trimmed, at most 1000 characters (proposed limit), empty becomes null; visible to the candidate
- application_events: application_id, from_status (null only for the first 'applied' event), to_status, actor_id (null for the system 'viewed' move, proposed), note, created_at; append-only
- job_applications.status: enum applied, viewed, shortlisted, interview, offer, hired, rejected, withdrawn; UI label of rejected is 'Not selected'
- private.settings.share_expiry_days_after_final: integer, default 30, read with value #>> '{}' and cast
- passport_shares.expires_at: set to now() plus that many days when the status becomes hired or rejected
- audit.log row per change: action application.status_changed (proposed name), entity_id = application id, metadata = organisation id, from, to; no note text

### States and transitions

- (none) -> Applied (candidate, FR-D1)
- Applied -> Viewed (system only, first open by an accepted member of the job's organisation; not for an organisation whose application writes are refused; not selectable by users)
- Applied -> Shortlisted (employer, minimum role member; needs has_feature(org, 'shortlisting'))
- Applied -> Interview or Not selected (employer, minimum role member)
- Viewed -> Shortlisted (employer, minimum role member; needs shortlisting feature)
- Viewed -> Interview or Not selected (employer, minimum role member)
- Shortlisted -> Interview, Offer or Not selected (employer, minimum role member; no move back to Applied or Viewed)
- Interview -> Offer or Not selected (employer, minimum role member)
- Offer -> Hired or Not selected (employer, minimum role member)
- Applied, Viewed, Shortlisted, Interview or Offer -> Withdrawn (candidate who owns the application; FR-D4)
- Hired, Not selected, Withdrawn -> none (final, terminal)

### Roles and permissions

- Employer owner, admin, member of the job's organisation: may change status along the table; may not set Viewed or Withdrawn; refused when the organisation is on free_employer and restricted (lapsed, or limits enforced) and when it is suspended; owner and admin reach the applicant pages only at aal2 (FR-A4)
- Employer user of another organisation, member with a pending invitation: denied (CHARA_NOT_FOUND)
- Candidate: may not call set_application_status or mark_application_viewed (CHARA_FORBIDDEN); may withdraw own application through withdraw_application only
- Anonymous: denied (no EXECUTE)
- Platform administrator, verification reviewer, trust and safety administrator: denied (CHARA_NOT_FOUND; no read or write path to applications in Phase 1)
- System (mark_application_viewed path): only Applied -> Viewed

### Objects

- public.set_application_status, public.bulk_set_application_status, public.withdraw_application
- proposed: public.mark_application_viewed(application_id), the only path to 'viewed'
- proposed: trigger private.applications_guard_transition on public.job_applications (mirrors private.jobs_guard_transition)
- public.job_applications.status, public.application_events
- public.passport_shares.expires_at
- private.has_feature, private.free_plan_restricted, private.assert_org_writable
- private.settings (share_expiry_days_after_final, entitlements_enforced)
- audit.log, public.notifications (status_changed), pgmq notification queue
- proposed: view public.v_my_application_timeline (FR-D3)
- proposed: error codes CHARA_INVALID_TRANSITION, CHARA_INVALID_INPUT; existing CHARA_FORBIDDEN, CHARA_NOT_FOUND, CHARA_FEATURE_NOT_IN_PLAN
- proposed: audit action application.status_changed
- packages/shared stage machine and label map
- Pages: app/[lang]/(app)/org/[slug]/applicants (list, board, applicant detail)

### Open points and assumed defaults

- P17: moving an applicant back from Shortlisted; default assumed: not possible (only Interview, Offer or Not selected).
- P13: how long a share stays valid after Hired or Not selected; default assumed: 30 days, setting share_expiry_days_after_final.
- P14: undo window for declines; default assumed: no undo; a confirmation step lists applicants and reason before anything is applied.
- C11: contents of free_employer and when entitlements_enforced is switched on; default assumed: limits 0, no feature rows, past applicants read-only, status changes and notes refused; lapse rules apply regardless of the setting.
- C16: whether shortlisting is included in every paid plan; default assumed: yes.
- erase_user pseudonymises application rows while application_events is append-only; the append-only trigger needs a narrow audited exception for erase_user, as ARCHITECTURE section 12 requires for audit.log.

## FR-D3 · Journey tracker

> A candidate sees, per application, a timeline of events, the current stage and a plain-language description of the usual next step, and a filterable list of all applications.

### Acceptance criteria

**AC1 · Candidate sees list, current stage, timeline and next step** (browser test (Playwright))

- Given a candidate with an application to 'Welder' (Open vacancy) in state shortlisted, with events Applied (28 Sep), Viewed (29 Sep) and Shortlisted (1 Oct, note 'We will call you next week'), and an internal application note 'Weak English' written by the employer
- When the candidate opens My applications and then the application
- Then the list row shows vacancy title, employer name, applied date and the stage label 'Shortlisted'; the application page shows the three events oldest first with dates, the note 'We will call you next week' labelled 'Message from the employer', the current stage 'Shortlisted' and the plain-language next-step text for that stage; the text 'Weak English' appears nowhere in the page HTML or in the data sent to the browser

**AC2 · Filter the list by stage** (browser test (Playwright))

- Given a candidate with 8 applications, one in each state
- When the candidate selects 'Interview' in the control labelled 'Filter by stage', then 'All stages'; then opens the list with ?stage=foo
- Then only the Interview application is listed and the URL contains stage=interview; reloading the URL keeps the filter; 'All stages' lists all 8; stage=foo falls back to all 8; the control offers All stages plus the 8 stage labels (Not selected for the stored value rejected) and is operable with the keyboard

**AC3 · Loading, empty and error states** (browser test (Playwright))

- Given a candidate with no applications, a candidate whose filter matches nothing, and a failing data request
- When the list is opened in each situation
- Then While loading a skeleton list is shown; with no applications the page says 'You have not applied to any vacancy yet' with a link 'Find vacancies'; a filter without matches says 'No applications in this stage' with a 'Clear filter' button; a failed request shows an error toast and a 'Try again' button

**AC4 · Timeline exposes no employer identity** (database test (pgTAP))

- Given an application with events by an employer member (Shortlisted), by the system (Viewed) and by the candidate (Applied, Withdrawn)
- When the candidate reads the timeline through the proposed view v_my_application_timeline (security_invoker)
- Then each row has only application_id, created_at, from_status, to_status, note and actor_role, with values 'you', 'employer' or 'system'; the view has no actor_id column and no other user id; the column list is asserted from information_schema; the view returns no event of another candidate's application

**AC5 · Internal application notes are never visible to the candidate** (database test (pgTAP))

- Given an application with an internal note 'Weak English' in application_notes and a stage-change note 'Position filled' in application_events
- When the candidate selects from application_notes, from v_my_application_timeline and from the my_applications function
- Then application_notes returns zero rows; the timeline returns 'Position filled' and no text of the internal note; no output column of either source carries note text from application_notes

**AC6 · Candidate pages carry no employer user ids** (browser test (Playwright))

- Given an application with events by an employer member whose user id, name and email are known
- When the candidate opens the list and the application page and the responses are captured (HTML and server-component data)
- Then None of the employer member's user id, name or email occurs in the HTML or the data sent to the browser; only the employer organisation display name is shown

**AC7 · Application stays visible after the vacancy leaves the public site** (database test (pgTAP))

- Given Applications of one candidate to vacancies that are now Paused, Closed, Filled, hidden by moderation (hidden) and org_suspended
- When the candidate calls the proposed function my_applications (SECURITY DEFINER, filters on worker_user_id = auth.uid(), the only source of the list)
- Then all 5 applications are returned with job title, organisation display name, job status, moderation_state, application status, applied date and last event time; the return columns are exactly these (no description, salary, city or any other vacancy column) and are asserted from pg_proc; another candidate's applications are never returned

**AC8 · Next-step text exists for every stage** (unit test (Vitest))

- Given the copy dictionary (en.json) for application stages
- When the text for applied, viewed, shortlisted, interview, offer, hired, rejected and withdrawn is read
- Then all 8 entries exist, are not empty and are at most 200 characters; the rejected entry uses the words 'not selected' and does not contain 'rejected'; the withdrawn entry states that the employer no longer has access to the shared documents

**AC9 · Page actions depend on the application and vacancy state** (browser test (Playwright))

- Given Applications in each of the 8 states; for the vacancy link, applications to an Open visible vacancy and to a Paused one
- When the application pages are opened
- Then a button 'Withdraw application' is present for applied, viewed, shortlisted, interview and offer, and absent for hired, rejected and withdrawn; a link to the public vacancy page is present only when the vacancy is Open and visible

**AC10 · Pagination and ordering of the list** (browser test (Playwright))

- Given a candidate with 45 applications whose latest event times differ
- When the list is opened and the pager is used
- Then Pages contain 20, 20 and 5 rows; rows are ordered by the time of the latest event, newest first (equal times: newer application first); the pager is a labelled navigation reachable by keyboard

**AC11 · Access by role** (browser test (Playwright))

- Given an anonymous visitor, an employer user and a platform staff member (any of the 3 roles)
- When each opens /applications and /applications/<any id>
- Then the anonymous visitor is redirected to /login with a next parameter; the employer user is redirected to the employer dashboard; the staff member is redirected to the admin area; none sees application data

**AC12 · Accessibility and small screens** (browser test (Playwright))

- Given the list and the application page at 360 px width with 8 applications
- When the pages are scanned with axe (WCAG 2.2 AA) and used with the keyboard
- Then no axe violations of level AA; no horizontal page scroll; the stage is shown as text, not only by colour; every interactive element has a visible focus and an accessible name

### Data and validation

- List fields shown: vacancy title, employer display name, applied date (job_applications.created_at), current stage label, date of latest event
- Filter: stage, one of all or the 8 stored values; carried in the URL query parameter stage; invalid values fall back to all
- Page size 20 (proposed); order by latest application_events.created_at descending
- Timeline fields: event date, to_status label, note (stage-change note or decline reason), actor_role you / employer / system
- Next-step text: one entry per state in en.json, at most 200 characters
- Read-only requirement: this requirement stores nothing

### Roles and permissions

- Candidate: may read own applications, events and stage-change notes; may start withdrawal on non-final states; denied other candidates' applications; denied any read of application_notes
- Employer owner, admin, member: denied the candidate tracker pages (redirected to the employer dashboard); read applications only through the applicant pages of their own organisation
- Anonymous: denied; redirected to login
- Platform administrator, verification reviewer, trust and safety administrator: denied (no read path to applications in Phase 1)

### Objects

- public.job_applications, public.application_events (read by worker_user_id = auth.uid())
- public.application_notes (no candidate rows)
- proposed: view public.v_my_application_timeline (security_invoker; application_id, created_at, from_status, to_status, note, actor_role)
- proposed: function public.my_applications(p_stage, p_limit, p_offset), SECURITY DEFINER because a security_invoker view over public.jobs would hide Paused, Closed, hidden and suspended vacancies from the candidate
- public.withdraw_application (FR-D4)
- Pages: app/[lang]/(app)/applications and applications/[id]
- lib/dal/applications.ts (DTOs without actor ids), lib/i18n/en.json stage copy and labels, packages/shared label map

### Open points and assumed defaults

- ARCHITECTURE section 4 gives the candidate row-level read of application_events including actor_id; the tracker therefore reads the view and DTOs, and a direct Data API select by the candidate would still return employer user ids. Default assumed: keep the policy as written; needs an architect decision if the ids must be hidden from the Data API as well.

## FR-D4 · Withdraw

> A candidate can withdraw an application at any time; withdrawal revokes the document share for that employer.

### Acceptance criteria

**AC1 · Withdraw in the browser** (browser test (Playwright))

- Given a candidate on the page of an application in state shortlisted
- When the candidate clicks 'Withdraw application' and confirms in the dialog 'Withdraw this application? The employer loses access to your documents immediately.'
- Then the page shows stage 'Withdrawn', a new timeline event 'Withdrawn' dated now, no Withdraw button and a confirmation toast; the application stays in My applications

**AC2 · Withdrawal from every non-final state revokes the share and ends document access** (database test (pgTAP))

- Given five applications of one candidate in applied, viewed, shortlisted, interview and offer, each with an active share whose scope holds the CV id, and a member of the job's organisation who can open the CV
- When the owning candidate calls withdraw_application for each and the member then calls document_access_grant for the CV and selects the candidate's worker_profiles row
- Then each application becomes withdrawn with exactly one event (from_status = previous state, to_status withdrawn, actor_id = candidate, note null); passport_shares.revoked_at equals the transaction time (same as the event created_at); one consents row (same purpose 'share_passport:<organisation id>', action withdrawn) is appended and the earlier granted row is unchanged; the grant raises CHARA_FORBIDDEN and writes no audit.document_access_log row; the live worker_profiles select returns zero rows; the member still reads the application row and its profile_snapshot

**AC3 · Final states cannot be withdrawn and repeat calls change nothing** (database test (pgTAP))

- Given Applications in hired, rejected and withdrawn
- When the owning candidate calls withdraw_application on each, and calls it twice in a row on a fresh applied application
- Then the calls on final states and the second call raise CHARA_INVALID_TRANSITION; no extra event, consent row, notification or audit row is written and revoked_at keeps its first value

**AC4 · Employer cannot open documents after withdrawal** (browser test (Playwright))

- Given an employer member viewing the applicant detail page with the CV link visible, while the candidate withdraws in another browser context
- When the member clicks the CV link after the withdrawal
- Then no signed URL is returned; the page shows 'This document is no longer available'; the applicant shows stage 'Withdrawn' after reload

**AC5 · All writes succeed or none** (database test (pgTAP))

- Given an application in state offer and a test trigger that makes the insert into consents raise an error
- When the candidate calls withdraw_application
- Then the call fails; status is still 'offer'; no event, audit, notification or queue row is added and revoked_at is still null

**AC6 · Only the owning candidate may withdraw** (database test (pgTAP))

- Given Application X owned by candidate A; candidate B, a member of the job's organisation, a platform staff member (each of the 3 roles) and an anonymous session
- When each calls withdraw_application(X)
- Then B, the member and the staff members get CHARA_NOT_FOUND and nothing changes; the anonymous call fails with permission denied for function

**AC7 · Withdrawal is never blocked by vacancy, organisation or plan state** (database test (pgTAP))

- Given Applications whose vacancy is Paused, Closed, Filled, hidden by moderation or org_suspended, an application of a suspended organisation, an application of an organisation on free_employer after a cancelled subscription, and entitlements_enforced set to true
- When the candidate withdraws each
- Then all withdrawals succeed

**AC8 · Candidate is emailed, employer is not** (database test (pgTAP))

- Given an organisation with owner, admin and member (digest preference true for one of them) and an application in state applied
- When the candidate withdraws
- Then one notifications row (kind status_changed, recipient candidate) with one queue message is queued; zero notifications of any kind are queued for the organisation's users; a member of the organisation still selects the application with status withdrawn and the withdrawn event

**AC9 · Records are retained and audited** (database test (pgTAP))

- Given a withdrawn application
- When the tables are inspected after withdrawal
- Then job_applications, application_events, passport_shares and consents rows still exist (nothing deleted); one audit.log row with action application.withdrawn (proposed name) and entity_id = application id exists and holds no cover note text

**AC10 · Re-applying after withdrawal does not reactivate the old share** (database test (pgTAP))

- Given a withdrawn application with a revoked share (scope: CV and Certificate) and a vacancy that is still Open
- When the candidate applies again selecting only the CV
- Then a new application, a new share and a new granted consents row are created; the old share keeps its revoked_at; document_access_grant for the Certificate is refused with CHARA_FORBIDDEN and for the CV succeeds through the new share only

**AC11 · Withdrawing one application leaves another application to the same organisation intact** (database test (pgTAP))

- Given a candidate with active applications A1 (vacancy V1) and A2 (vacancy V2) of the same organisation, both shares listing the same CV
- When the candidate withdraws A1 and a member of the organisation calls document_access_grant for the CV
- Then the grant succeeds and the access log row names the share of A2; the share of A2 has revoked_at null and A2 stays applied

**AC12 · Confirmation dialog behaviour** (browser test (Playwright))

- Given the withdraw dialog
- When it is operated with the keyboard and in error and pending states
- Then Focus moves to the Cancel button on open; Escape closes the dialog and returns focus to 'Withdraw application'; the dialog text names the employer; while pending the confirm button is disabled and reads 'Withdrawing'; a failed call shows an error toast and the stage is unchanged; a double click produces exactly one event

### Data and validation

- p_application_id: uuid, required; must belong to the caller (worker_user_id = auth.uid())
- No note or reason is captured; the withdrawn event note is null
- job_applications.status: set to 'withdrawn' (final)
- application_events: from_status = previous state, to_status 'withdrawn', actor_id = candidate
- passport_shares.revoked_at: set to now() in the same transaction
- consents: appended row with the same purpose as the grant, action 'withdrawn', created_at now(), version of the granted row (proposed); the granted row is never changed
- audit.log: action application.withdrawn (proposed name), entity_id = application id

### States and transitions

- Applied, Viewed, Shortlisted, Interview or Offer -> Withdrawn (candidate who owns the application, after confirmation; never blocked by vacancy, organisation or plan state)
- Hired, Not selected, Withdrawn -> none (final)

### Roles and permissions

- Candidate owner of the application: may withdraw a non-final application at any time
- Other candidate: denied (CHARA_NOT_FOUND)
- Employer owner, admin, member: denied withdrawing (CHARA_NOT_FOUND); may see the Withdrawn stage and event; may not obtain documents after withdrawal
- Platform staff roles: denied (CHARA_NOT_FOUND)
- Anonymous: denied (no EXECUTE)

### Objects

- public.withdraw_application
- public.job_applications.status, public.application_events
- public.passport_shares.revoked_at, public.consents (withdrawn row)
- public.document_access_grant, audit.document_access_log
- public.worker_profiles (read through an active share)
- audit.log, public.notifications (status_changed), pgmq notification queue
- proposed: error code CHARA_INVALID_TRANSITION
- proposed: audit action application.withdrawn
- Pages: app/[lang]/(app)/applications/[id] (withdraw dialog), app/[lang]/(app)/org/[slug]/applicants (Withdrawn stage)
- Edge Function document-url

### Open points and assumed defaults

- SOP FR-D4 says denied document access after withdrawal is logged; the adopted design D16 writes no access-log row for a refused request, so the refusal is visible only as the CHARA_FORBIDDEN error and in server logs. Default assumed: D16 (no row for refusals).
- P13: share expiry after Hired or Not selected; withdrawal always revokes at once (default 30 days only for the final states).
- ARCHITECTURE section 7.3 cancels a grant when a later 'withdrawn' consent row has the same user and purpose, and the purpose is per organisation; withdrawing A1 would then also cancel the share of A2 to the same organisation (AC11). The withdrawn lookup must be tied to the share's own consent (for example a purpose that includes the application id, proposed); needs an architect decision before the migration.

## FR-D5 · Visibility

> An employer sees only applications to its own vacancies; a candidate sees only their own applications.

### Acceptance criteria

**AC1 · Candidates read only their own applications; others have no read path** (database test (pgTAP))

- Given Candidates A (3 applications) and B (2 applications); an anonymous session; platform staff with roles admin, trust_safety and verification_reviewer at aal2; service_role
- When A selects from job_applications, application_events and v_my_application_timeline, with and without a filter on B's application ids; the other parties select from job_applications, application_events and application_notes
- Then A gets 3 applications and their events only, zero rows for any of B's ids; anonymous and service_role are denied by missing grants; the three staff roles get zero rows

**AC2 · No direct writes to applications and events** (database test (pgTAP))

- Given Candidate A with an application in state applied, and a member of A's job organisation
- When each runs direct INSERT, UPDATE (set status 'hired', cover_note, worker_user_id, profile_snapshot) and DELETE on job_applications, and INSERT, UPDATE and DELETE on application_events; the candidate also runs INSERT on application_notes
- Then every statement fails with SQLSTATE 42501 (permission denied for the two tables, row-level security violation for the note insert) and the data is unchanged

**AC3 · Members read applications of their own organisation only** (database test (pgTAP))

- Given Organisations A and B each with owner, admin and member; applications to A's vacancies that are open, paused, closed, filled, hidden (moderation_state) and org_suspended, and to B's vacancies
- When the owner, admin and member of A select from job_applications and application_events
- Then each sees all applications of A's vacancies regardless of vacancy status or moderation state, and zero rows of B's; the same holds mirrored for B

**AC4 · Membership changes take effect at once** (database test (pgTAP))

- Given a member of organisation A who sees A's applications, and a user with a pending invitation (accepted_at null)
- When the owner removes the member with remove_member, and the pending user selects from job_applications
- Then the removed member's next query returns zero rows without waiting for token expiry; the pending user gets zero rows

**AC5 · Internal notes are visible to the organisation only** (database test (pgTAP))

- Given an internal note by a member of A on application X to a vacancy of A
- When Members of A, members of B, the candidate who owns X, an anonymous session and the 3 staff roles select from application_notes
- Then Members of A see the note; the members of B, the candidate and the staff roles see zero rows; the anonymous session is denied

**AC6 · A note cannot be attached across organisations or under another author** (database test (pgTAP))

- Given Application X to a vacancy of organisation A; a member of B and a member of A
- When the member of B inserts a note for X with organization_id = B, the member of A inserts a note for X with organization_id = B, the member of A inserts one with organization_id = A and author_id = another user, and the member of A inserts one with organization_id = A and author_id = themselves
- Then the first three inserts are refused; the last succeeds; the candidate cannot insert a note

**AC7 · RPCs refuse applications the caller cannot see** (database test (pgTAP))

- Given a member of B, an application X of organisation A, and a non-existent application id
- When the member of B calls set_application_status, mark_application_viewed and withdraw_application for X and for the non-existent id
- Then all calls raise CHARA_NOT_FOUND with the same message for X and for the unknown id, and nothing changes

**AC8 · Cross-organisation attempts are logged by the database** (manual check)

- Given a member of B and an application X of organisation A
- When the member of B calls set_application_status for X
- Then the database log holds one line starting 'CHARA_CROSS_TENANT' (RAISE LOG) with the caller id, function name and application id and no personal data; no such line is written for a non-existent id (proposed: the log line, not an audit.log row, because the failing call rolls back any table write)

**AC9 · Past applicants stay readable for a lapsed organisation** (database test (pgTAP))

- Given an organisation on free_employer after a cancelled subscription, with 4 applications
- When a member selects from job_applications and application_events and tries note inserts and status changes
- Then all 4 applications and their events are returned; note inserts and status changes are refused with CHARA_FEATURE_NOT_IN_PLAN (detail 'read_only_free_plan')

**AC10 · Page access follows the same rules** (browser test (Playwright))

- Given an employer member of A and candidate B, application ids of organisation A and of candidate A
- When the member opens /org/<A slug>/applicants/<id of an application of B's organisation>, /org/<B slug>/applicants/<id of an application of A> and /org/<slug of an organisation they do not belong to>/applicants; candidate B opens /applications/<id of candidate A>
- Then all four requests return 404 with no applicant data in the HTML

**AC11 · Two-step verification and suspension on applicant pages** (browser test (Playwright))

- Given an organisation owner and an organisation admin at aal1, an organisation member at aal1, and a member of an organisation with status suspended
- When each opens the applicants page of the organisation
- Then the owner and the admin are redirected to the two-step verification page; the member at aal1 sees the applicants; the member of the suspended organisation is refused with a message that the organisation is suspended; candidates of that organisation's vacancies still see their own applications

**AC12 · Policies are indexed and complete** (database test (pgTAP))

- Given the tables job_applications, application_events and application_notes
- When the meta-tests run
- Then RLS is enabled and forced on all three; each has at least one policy; an index exists on every column used in a policy (job_applications.worker_user_id, job_applications.job_id, jobs.organization_id, application_events.application_id, application_notes.application_id, application_notes.organization_id); the policies are named <table>_<command>_<audience> and use (select auth.uid())

### Data and validation

- job_applications.worker_user_id: candidate reads rows where it equals auth.uid()
- job_applications.job_id -> jobs.organization_id: member reads rows where the organisation is in private.member_org_ids() (accepted members only, any role)
- application_events.application_id: visibility equals that of the parent application
- application_notes.organization_id: must equal the organisation of the application's job; author_id must equal auth.uid(); readable and insertable by its members only; never readable by the candidate
- Writes: no INSERT, UPDATE or DELETE grant for authenticated on job_applications and application_events; only the RPCs write

### Roles and permissions

- Candidate: reads own applications and events; denied other candidates' rows, denied application_notes, denied direct writes
- Employer owner, admin, member (accepted): read applications, events and notes of the organisation's own vacancies; add notes (not when restricted on free_employer); denied other organisations; owner and admin need aal2 for applicant pages; refused for a suspended organisation
- Member with pending invitation or removed member: denied
- Platform administrator, verification reviewer, trust and safety administrator: denied (zero rows)
- Anonymous and service_role: denied by missing grants

### Objects

- public.job_applications, public.application_events, public.application_notes
- proposed policy names: job_applications_select_worker, job_applications_select_member, application_events_select_worker, application_events_select_member, application_notes_select_member, application_notes_insert_member
- private.member_org_ids, private.is_org_member, private.is_aal2
- proposed: private helper that maps an application id to its organisation id for use in policies
- public.set_application_status, public.mark_application_viewed (proposed), public.withdraw_application
- public.remove_member
- public.organizations.status (suspended), public.organization_members.accepted_at
- Pages: app/[lang]/(app)/org/[slug]/applicants, app/[lang]/(app)/applications; lib/dal/session.ts (requireOrgRole, requireAal2)
- proposed: server log line CHARA_CROSS_TENANT

### Open points and assumed defaults

- C11: past applicants stay readable on free_employer; default assumed: read-only, writes refused.
- P7: members are not required to enrol two-step verification; default assumed: owners and admins only, enforced in the DAL (requireAal2); D8 limits restrictive aal2 policies to invitations, platform_staff, member-management and billing reads, so the job_applications policies do not test aal2.

## FR-D6 · Notifications

> The candidate is emailed on every state change except Viewed; the employer is emailed on each new application or, if preferred, in a daily summary.

### Acceptance criteria

**AC1 · New application emails go to every accepted member immediately by default** (database test (pgTAP))

- Given an organisation with owner (digest false), admin (no preference row) and member (digest false), one member whose invitation is not accepted (accepted_at null), one removed member, and a candidate applying to its vacancy
- When apply_to_job succeeds
- Then 3 notifications rows (kind application_received, channel email, status queued, one per accepted member), each with one message in the pgmq notification queue, are created in the same transaction; none for the candidate, the unaccepted member or the removed member

**AC2 · Daily summary preference** (database test (pgTAP))

- Given Owner and admin with digest false and a member with digest true; 3 applications received (2 for vacancy V1, 1 for V2) since the last summary
- When the applications are submitted, and later the daily summary job runs at 08:00 Europe/Berlin
- Then at submission the owner and admin get an immediate row per application and the member gets none; the job creates exactly one summary notifications row for the member (kind application_received, payload with total 3, count per vacancy and a link per vacancy); a second run on the same Berlin date creates nothing; a run with 0 new applications creates nothing; the 3 applications are not repeated the next day; the owner and admin never get a summary

**AC3 · Summary is sent at 08:00 Central European local time across daylight saving** (database test (pgTAP))

- Given the hourly job function private.enqueue_daily_summaries(p_now) (proposed) with pending digest items
- When it is called with these UTC times: 2026-01-15 07:00 (08:00 CET), 2026-01-15 06:00, 2026-07-15 06:00 (08:00 CEST), 2026-07-15 07:00, 2026-03-29 06:00 (08:00 CEST, clocks change that night), 2026-03-29 07:00, 2026-10-25 07:00 (08:00 CET, clocks change that night), 2026-10-25 06:00
- Then it sends at 2026-01-15 07:00, 2026-07-15 06:00, 2026-03-29 06:00 and 2026-10-25 07:00 and does nothing at the other four times; never twice for the same Berlin date

**AC4 · Candidate status email on every change except Viewed** (database test (pgTAP))

- Given Applications moved through set_application_status to shortlisted, interview, offer, hired and rejected, a bulk move of 3 applications, a withdrawal, and a move to viewed; candidates with digest true and with no preference row
- When each change is committed
- Then each of the 5 single moves, each of the 3 bulk items and the withdrawal queues exactly one status_changed notification (channel email, status queued, recipient the candidate) with one queue message; the move to viewed queues none; no employer notification is queued by any of these; delivery does not depend on any preference row

**AC5 · Settings pages: candidate has no switch, employer chooses immediate or summary** (browser test (Playwright))

- Given the notification settings pages of a candidate and of an employer user (proposed pages)
- When both pages are opened and the employer chooses 'Daily summary' and reloads
- Then the candidate page offers no control for application status emails and states that they are always sent; the employer page offers 'Immediately' (selected by default) or 'Daily summary' for new-application emails and keeps the choice after reload

**AC6 · Queued payloads are minimal** (database test (pgTAP))

- Given an application with cover note 'SECRETNOTE', stage-change note 'DECLINEREASON', document title 'passport-scan.pdf' and candidate name 'Amina Test'
- When apply_to_job and set_application_status (to rejected with the note) run and the notifications payloads are read
- Then application_received has exactly the keys application_id, vacancy title, organisation display name and organisation slug; status_changed has exactly application_id, vacancy title, organisation display name and the new status value (the template maps it to the label); none of 'SECRETNOTE', 'DECLINEREASON', 'passport-scan.pdf' or 'Amina Test' occurs in any payload

**AC7 · Templates: no sensitive data, English only, subjects and links** (unit test (Vitest))

- Given the templates application_received (immediate and summary variants) and status_changed, and the payloads of AC6
- When they are rendered to HTML and text
- Then None of the four strings of AC6 appears; application_received links to /org/<slug>/applicants/<id> (the summary lists vacancy titles, counts and one link per vacancy); status_changed shows the new stage label ('Not selected' for rejected) and links to /applications/<id>; links use the configured site URL; the language is English and no other locale is offered; subjects are 'New application for <vacancy title>' and 'Update on your application for <vacancy title>' (proposed wording, final text reviewed with legal)

**AC8 · Sending through Resend with an idempotency key; webhook signature** (unit test (Vitest))

- Given the notify logic with a fake Resend endpoint, 2 queued messages, and a message that becomes visible again in pgmq because the first consumer did not acknowledge in time
- When notify runs (scheduled every minute), handles the repeated message twice, and receives Resend delivery webhooks
- Then every request carries the notification id as idempotency key, and both requests for the repeated message carry the same key; a webhook with a valid signature is passed to notify_ack as 'delivered'; a webhook with an invalid signature returns 401 and calls notify_ack not at all

**AC9 · Retries with back-off and alert after 3 retries** (unit test (Vitest))

- Given a fake Resend endpoint that returns HTTP 500 for every request
- When notify processes a message over time
- Then the message is attempted 4 times in total (first attempt plus 3 retries) at delays that increase each time (proposed 1, 5 and 30 minutes); after the third retry fails the status is 'failed' and one operations alert is raised; a success on any attempt stops the retries

**AC10 · Delivery status is recorded through the service RPCs only** (database test (pgTAP))

- Given Queued notifications; the roles service_role and authenticated
- When service_role calls notify_ack with sent, failed, delivered, bounced and complained, then a hard bounce or complaint is recorded and the user's email address in auth.users is later changed; authenticated calls notify_dequeue, notify_ack and INSERT or UPDATE on notifications
- Then sent sets status 'sent' and sent_at; failed, delivered, bounced and complained are stored on the same row; a bounce or complaint sets notification_preferences.email_undeliverable_at and the email change clears it; every call and statement by authenticated is denied

**AC11 · Undeliverable address is suppressed** (unit test (Vitest))

- Given a candidate whose notification_preferences.email_undeliverable_at is set and a queued status_changed message for the candidate
- When notify handles the message
- Then the notifications row exists, notify does not call Resend and acknowledges the message with status 'suppressed'

**AC12 · Preference rows are private and limited** (database test (pgTAP))

- Given two employer users U1 and U2 and a candidate
- When U1 updates notification_preferences.digest for own row, tries it for U2's row and tries to set email_undeliverable_at; the candidate sets digest true; anonymous selects
- Then U1's own update succeeds; the update of U2's row and of email_undeliverable_at is refused; U1 reads only own row; the candidate's digest change does not affect status_changed delivery; anonymous is denied

### Data and validation

- notifications: user_id (recipient), kind application_received or status_changed, payload jsonb, channel email, status queued, sent, failed, suppressed (plus delivered, bounced, complained from Resend webhooks), sent_at
- payload application_received: application_id, vacancy title, organisation display name, organisation slug (proposed); summary variant: total, count and link per vacancy; no candidate name, no cover note, no document data
- payload status_changed: application_id, vacancy title, organisation display name, new status value; no note, no decline reason, no document data
- notification_preferences.digest: boolean, default false (false or no row = immediate email per application, true = daily summary); applies to application_received only
- notification_preferences.email_undeliverable_at: timestamp, set by a hard bounce or complaint through notify_ack only
- Daily summary time: 08:00 Europe/Berlin; the job runs hourly and acts when the Berlin hour is 8
- Summary content: applications created since the previous summary for that user, tracked by a per-user watermark (proposed)
- Retries: up to 3 with increasing back-off (proposed 1, 5, 30 minutes); idempotency key = notification id

### States and transitions

- Notification: (new) -> queued (enqueue in the same transaction as the application event; for digest users the summary row is created by the 08:00 Europe/Berlin job instead)
- Notification: queued -> sent (notify, Resend accepted)
- Notification: queued -> queued (send failed, retry 1 to 3 with back-off)
- Notification: queued -> failed (third retry failed; alert to operations)
- Notification: queued -> suppressed (address marked undeliverable)
- Notification: sent -> delivered, bounced or complained (Resend webhook)

### Roles and permissions

- Employer owner, admin, member: may set own digest preference only; denied changing another user's preference
- Candidate: denied switching off status_changed emails (no switch exists)
- notify Edge Function (service RPCs notify_dequeue, notify_ack): reads the queue and records delivery status; no direct table grants
- Anonymous and platform staff: denied reading or writing notifications
- Other organisations' users and other candidates: receive nothing and cannot read these rows

### Objects

- public.notifications, public.notification_preferences, pgmq notification queue
- proposed: private.enqueue_application_notifications, called by apply_to_job, set_application_status, bulk_set_application_status and withdraw_application
- proposed: private.enqueue_daily_summaries(p_now) and an hourly pg_cron job
- Edge Function notify; service RPCs notify_dequeue, notify_ack
- apps/web/emails templates (proposed names: application_received, status_changed)
- Resend API (EU region), idempotency key header
- auth.users email-change trigger (clears email_undeliverable_at)
- Pages: proposed employer notification settings, proposed candidate notification settings (no switch)

### Open points and assumed defaults

- P15: time of the daily summary; default assumed: 08:00 Central European local time (Europe/Berlin, CET and CEST).
- P14: no undo for declines; the Not selected email is sent when the decline is applied.
- C11: for an organisation on free_employer no status changes are possible, so no status_changed emails are triggered by employers; default assumed as in FR-D2.
- SOP FR-D6: template wording is reviewed with legal; subjects here are proposed.

## FR-D7 · Duplicate protection

> At most one non-withdrawn application exists per candidate and vacancy.

### Acceptance criteria

**AC1 · A second application for the same vacancy is not created** (database test (pgTAP))

- Given a candidate with a non-withdrawn application in each of the states applied, viewed, shortlisted, interview, offer, hired and rejected (one test per state) to an Open vacancy
- When the candidate calls apply_to_job again for the same vacancy
- Then the call returns the existing application id with outcome 'existing' and no error; job_applications still has one non-withdrawn row; no new share, consent, event or notification is created; the only new row is the duplicate_attempt audit row of AC7

**AC2 · The unique rule exists in the database and blocks only duplicates** (database test (pgTAP))

- Given an application (job J, candidate C) in state applied, inserted as the table owner in a test
- When a second row for (J, C) with any non-withdrawn status is inserted; a row is inserted after the first is withdrawn; rows are inserted for (J, another candidate) and (another job of the same organisation, C)
- Then the first insert fails with unique violation 23505 on the partial unique index; the others succeed; three withdrawn rows plus one active row for the same pair are allowed

**AC3 · Re-apply after withdrawal only while the vacancy is Open** (database test (pgTAP))

- Given a withdrawn application and a vacancy that is Open, and a second case with the vacancy Paused or Closed
- When the candidate applies again
- Then Open: a new application (new id, state applied) with new share, consent, event and employer notifications is created, and exactly one non-withdrawn application exists; Paused or Closed: CHARA_JOB_NOT_OPEN and nothing is created

**AC4 · Simultaneous submissions create one application** (browser test (Playwright))

- Given a candidate and an Open vacancy
- When two apply requests for the same vacancy are sent at the same moment from two tabs
- Then exactly one application, one share, one consent row, one applied event and one set of employer notifications exist; both requests return the same application id; neither shows a database error to the user

**AC5 · Race at the index is mapped, not leaked** (unit test (Vitest))

- Given the DAL mapper for apply results and a unique-violation error 23505 on the application index
- When the mapper receives that error
- Then it returns the existing application (outcome 'existing') and never exposes the SQL error text or the index name

**AC6 · UI shows the existing application instead of an error** (browser test (Playwright))

- Given a candidate who applied on 3 Oct 2026 and is now in state shortlisted; another candidate who withdrew
- When they open the vacancy page and the direct apply URL
- Then the first candidate sees 'You applied on 3 Oct 2026, stage Shortlisted' with a link 'View your application' instead of an Apply button, and the apply URL redirects to the application page with that notice; the second sees 'You withdrew your application' and an 'Apply again' button when the vacancy is Open

**AC7 · Duplicate attempts are counted** (database test (pgTAP))

- Given a candidate with an active application
- When the candidate attempts to apply 3 more times
- Then 3 audit.log rows with action application.duplicate_attempt (proposed name), entity_id = the existing application id and metadata with the job id only exist, and a monthly count query returns 3 for that month

**AC8 · Abuse rate limit** (database test (pgTAP))

- Given a candidate calling apply_to_job in a loop, including duplicate attempts
- When the 61st call within one hour is made
- Then it raises CHARA_RATE_LIMITED (proposed limit 60 calls per candidate per hour, a configuration value) and writes nothing; calls 1 to 60 are not affected; another candidate is not affected; once the one-hour window has elapsed calls succeed again

**AC9 · Erasure of two applicants does not violate the unique rule** (database test (pgTAP))

- Given two different candidates with non-withdrawn applications to the same vacancy, both with a completed deletion cooling-off period
- When erase_user runs for both
- Then both runs succeed; the application rows are pseudonymised with distinct pseudonyms so the unique index is not violated and no application is lost; cover_note is null and the first name, last name and headline in profile_snapshot are removed (proposed treatment)

**AC10 · Double click on Submit** (browser test (Playwright))

- Given the apply form with valid input
- When the Submit button is double-clicked
- Then the button is disabled after the first click and exactly one application exists

### Data and validation

- Unique partial index on job_applications (job_id, worker_user_id) where status <> 'withdrawn'
- apply_to_job result: application id and outcome 'created' or 'existing'
- Duplicate attempt record: audit.log action application.duplicate_attempt (proposed name), entity_id = existing application id, metadata job id
- Rate limit key per candidate for apply_to_job: 60 calls per hour (proposed values, configuration)

### States and transitions

- Withdrawn application -> new application in Applied (candidate re-applies; vacancy Open and visible)
- Applied, Viewed, Shortlisted, Interview, Offer, Hired, Not selected -> no second application possible (the existing one is shown)

### Roles and permissions

- Candidate: may apply once per vacancy while a non-withdrawn application exists; may re-apply after withdrawal while the vacancy is Open
- Employer owner, admin, member: denied applying; see the single application per candidate and vacancy
- Anonymous: denied (no EXECUTE)
- Platform staff roles: denied

### Objects

- public.job_applications and its unique partial index (proposed name job_applications_one_active_per_job_worker)
- public.apply_to_job
- audit.log
- private.check_rate_limit
- public.erase_user (service RPC)
- proposed: error code CHARA_RATE_LIMITED, audit action application.duplicate_attempt
- Pages: vacancy page (app/[lang]/(public)/jobs), proposed app/[lang]/(app)/jobs/[id]/apply, app/[lang]/(app)/applications/[id]
- lib/dal/applications.ts result mapper

### Open points and assumed defaults

- The rate limit of 60 calls per hour is a proposal; no owner decision exists and the SOP only names a rate limit.
- erase_user must pseudonymise job_applications and application_events although the events table is append-only; the narrow audited exception (ARCHITECTURE section 12) is needed for it.
