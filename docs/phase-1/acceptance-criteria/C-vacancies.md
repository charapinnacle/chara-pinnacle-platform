# Group C: Vacancies

## FR-C1 · Create vacancy

> An employer creates a vacancy with title, description, occupation, industry, country, city, employment type, salary range (minimum not above maximum), currency and pay period (hour, month or year), accommodation, visa support and recruitment preference (local, international, both). Reference values come from controlled lists.

### Acceptance criteria

**AC1 · Create a complete draft vacancy** (browser test (Playwright))

- Given an owner of employer organisation Acme (any plan, any number of open vacancies) is signed in and opens org/acme/jobs/new
- When they enter title "Welder MIG/MAG", a 120-character description, occupation "Welders and flame cutters" (ISCO-08 7212), industry ISIC 2511, country DE, city "Hamburg", employment type full_time, salary 2800 to 3400 EUR per month, accommodation yes, visa support yes, recruitment preference both, and submit
- Then exactly one public.jobs row exists with status draft, moderation_state visible, deleted_at null, organization_id of Acme, created_by = the user and posted_on_behalf_of_organization_id null; the user lands on the vacancy page with a "Draft - not public" banner; exactly one audit.log row with action job.created and entity_id = the new id exists; the row is not returned by the public search

**AC2 · Required fields, length limits and insert payload in the form schema** (unit test (Vitest))

- Given the zod schema and the insert-payload mapper used by the vacancy form
- When each required field (title, description, occupation, industry, country, city, employment type, recruitment preference) is empty; title is tried at 4, 5, 120 and 121 characters and as 6 spaces; description at 49, 50, 10,000 and 10,001 characters; city at 100 and 101 characters; and the input object also contains status, created_by, moderation_state and posted_on_behalf_of_organization_id
- Then each empty required field gives an error keyed to that field; title accepts 5 to 120 characters after trimming, description 50 to 10,000, city 1 to 100, and the values at 4, 49, 10,001 and 101 characters and the whitespace-only title are rejected; accommodation and visa support default to false without being touched; the mapped payload never contains status, created_by, moderation_state or posted_on_behalf_of_organization_id

**AC3 · Salary rules in the form schema** (unit test (Vitest))

- Given the zod schema used by the vacancy form
- When it is given: min 3500 and max 3000; min 3000 and max 3000; only max 3400; min -1; min 10,000,000; amount 2800.555; amount 2800 without currency; amount 2800 with currency EUR but no period; period "week"; and no amounts with no currency or period
- Then 3500/3000 fails with an error on salary_min (minimum must not exceed maximum); 3000/3000 and a max-only range pass; -1, 10,000,000 (above 9,999,999.99) and 2800.555 (more than 2 decimals) fail; an amount without currency fails on salary_currency and without period on salary_period; "week" fails (only hour, month and year are accepted); the empty salary passes

**AC4 · Database constraints on salary and required columns** (database test (pgTAP))

- Given a signed-in admin of Acme at the SQL level (role authenticated, aal1)
- When they insert vacancies with: salary_min 3500 and salary_max 3000; salary_min 2800 and null currency; salary_max 3400 with currency EUR and null period; salary_min -1; salary_max 10,000,000; salary_period "week"; each required column set to null in turn (title, description, occupation_id, industry_code, country_code, city, employment_type, accommodation, visa_support, recruitment_preference); and finally salary_min 3000, salary_max 3000, EUR, month
- Then the first five fail with check_violation 23514, "week" fails with invalid_text_representation 22P02, every null required column fails with not_null_violation 23502, and the last insert succeeds

**AC5 · Reference values must come from the controlled lists** (database test (pgTAP))

- Given a signed-in admin of Acme at the SQL level
- When they insert vacancies with an occupation_id not in public.occupations, an industry_code not in public.industries, country_code "XX" not in public.countries, salary_currency "ABC" not in public.currencies, employment_type "gig" and recruitment_preference "any"
- Then each insert fails (foreign_key_violation 23503 for the first four, invalid_text_representation 22P02 for the two enum values) and no row is created; the same insert with valid values (7212, an ISIC code from the seed, DE, EUR, full_time, both) succeeds

**AC6 · Occupation, industry, country and currency are chosen from lists** (browser test (Playwright))

- Given an admin on the new-vacancy form
- When they type "weld" into the occupation field, move through the options with the arrow keys and press Enter, then type "Welding xyz" (not in the list) into the industry field and submit
- Then the occupation list shows matching ISCO-08 labels and synonyms (including "Welders and flame cutters") and Enter selects one; the free text in the industry field is not accepted: the form is not submitted, the field shows "Select an industry from the list" and receives focus; country, industry and currency are never stored from typed text

**AC7 · Only owner and admin of the organisation can insert; reserved columns are not writable** (database test (pgTAP))

- Given the owner and an admin of Acme, a member of Acme, an admin of Beta, a candidate (account_kind worker) and an anonymous caller
- When each inserts a valid vacancy with organization_id = Acme at the SQL level, and the admin of Acme also inserts with status 'open', with created_by set to another user, with moderation_state 'hidden' and with deleted_at set
- Then Owner and admin succeed and the row has status draft, created_by = the caller, moderation_state visible; the member, the Beta admin and the candidate are refused by row-level security (42501); the anonymous caller is refused for lack of an insert grant (42501); the four reserved-column inserts are refused with permission denied (column grants) and create no row

**AC8 · No prohibited attributes in the data model** (database test (pgTAP))

- Given the migrated database
- When the columns of public.jobs are read from information_schema.columns
- Then no column name is or contains gender, sex, age, date_of_birth, nationality, religion, marital_status, ethnicity, id_number or photo

**AC9 · Form fields and Platform Rules notice** (browser test (Playwright))

- Given an admin on the new-vacancy form
- When the page is rendered and the user reaches the "Platform Rules" link with the Tab key and activates it with Enter
- Then the form has exactly the fields title, description, occupation, industry, country, city, employment type, salary minimum, salary maximum, currency, pay period, accommodation, visa support and recruitment preference, each with a visible label, and no field for gender, age, nationality, religion, marital status or photo; a short notice states that vacancies must follow the Platform Rules and links to legal/platform-rules, which opens in a new tab with rel="noopener"; the entered form values are unchanged

**AC10 · Organisation URL and preview isolation** (browser test (Playwright))

- Given a draft vacancy of Acme, a signed-in member of Acme, a signed-in admin of Beta and an anonymous visitor
- When the Acme member opens the vacancy Preview; the Beta admin requests org/acme/jobs/new, org/acme/jobs/[id] and the preview URL; the visitor requests the preview URL and the public URL jobs/[id] of the draft
- Then the Acme member sees the public vacancy layout (details, employer card, Apply and Save) with a "Preview - not public" banner and a noindex robots tag; the Beta admin gets 404 on all three URLs; the visitor is redirected to login with next set to the preview URL and gets the neutral "This vacancy is no longer available" page (HTTP 404) on the public URL

**AC11 · Editing and deleting are validated, role-limited and audited** (database test (pgTAP))

- Given a draft vacancy of Acme with no applications
- When an admin of Acme changes the title to a 6-character value and separately sets salary_min above salary_max; a member of Acme and an admin of Beta try the same update; the admin updates organization_id, created_by, moderation_state and deleted_at; the owner, an admin and a member of Acme each delete the draft
- Then the valid title update succeeds and writes exactly one audit.log row (job.updated, metadata changed_fields ["title"]); the invalid salary update fails with 23514 and writes no audit row; the member and the Beta admin update 0 rows; the four reserved-column updates are refused with permission denied; delete succeeds for the owner only (0 rows for the admin and the member)

**AC12 · Form error, pending and keyboard behaviour** (browser test (Playwright))

- Given an admin on the new-vacancy form
- When they submit with title and description empty, then fill the form by keyboard only and double-click Submit on a valid form, and then submit while the server action returns an error
- Then the errors appear next to the fields, an error summary is announced and focus moves to the first invalid field; Submit is disabled while pending and the double-click creates exactly one row; on a server error a toast appears and all entered values are kept

### Data and validation

- title: required, trimmed, 5 to 120 characters, plain text
- description: required, trimmed, 50 to 10,000 characters, plain text with line breaks (no HTML)
- occupation_id: required, must exist in public.occupations (ISCO-08)
- industry_code: required, must exist in public.industries (ISIC Rev.4)
- country_code: required, ISO 3166-1 alpha-2, must exist in public.countries
- city: required, free text, trimmed, 1 to 100 characters
- employment_type: required, value of the proposed enum employment_type (full_time, part_time, contract, temporary, seasonal)
- salary_min, salary_max: optional, numeric(12,2), 0 to 9,999,999.99, at most 2 decimals; salary_min <= salary_max when both are set; one amount alone is allowed
- salary_currency: ISO 4217 code from public.currencies; required when either amount is set
- salary_period: hour, month or year; required when either amount is set
- accommodation: required boolean, default false
- visa_support: required boolean, default false
- recruitment_preference: required, local, international or both (proposed enum)
- status: draft on creation, not client-writable at insert
- organization_id: taken from the active organisation (URL slug validated against membership), not editable afterwards
- created_by: default auth.uid(), not client-writable, not editable
- posted_on_behalf_of_organization_id: null in Phase 1 (never sent by the form)
- moderation_state: visible on creation, not client-writable
- deleted_at: null on creation, not client-writable

### States and transitions

- (none) -> Draft (owner or admin of the organisation, all validations pass)

### Roles and permissions

- Owner: may create, preview and edit vacancies of own organisation; may delete (policy jobs_delete_owner, no UI in Phase 1)
- Admin (organisation): may create, preview and edit vacancies of own organisation; denied delete
- Member (organisation): may read drafts and open the preview of own organisation; denied create, edit and delete
- Admin or owner of another organisation: denied any access to the vacancy (row-level security; 404 on the pages)
- Candidate (worker): denied create, edit and preview
- Anonymous: denied; the draft is not public; preview redirects to login
- Platform staff: no create or edit function in Phase 1

### Objects

- public.jobs (columns title, description, occupation_id, industry_code, country_code, city, employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation, visa_support, recruitment_preference, status, organization_id, created_by, posted_on_behalf_of_organization_id, moderation_state, deleted_at, search_vector)
- public.occupations, public.industries, public.countries, public.currencies
- proposed: enums public.employment_type, public.salary_period, public.recruitment_preference
- proposed: check constraints on public.jobs (salary_min <= salary_max, currency and period required with an amount, 0 <= amount <= 9999999.99)
- RLS policies jobs_insert_admin, jobs_update_admin, jobs_delete_owner, jobs_select_member; column grants for insert and update (ARCHITECTURE 5.6)
- proposed: row trigger on public.jobs calling audit.record() (actions job.created, job.updated)
- private.is_org_member, private.member_org_ids
- pages: app/[lang]/(app)/org/[slug]/jobs (list, new, [id], proposed [id]/preview); legal/[slug] (Platform Rules)
- lib/dal/hiring.ts, lib/actions (zod, React Hook Form)

### Open points and assumed defaults

- The employment type list, the length limits (title 5 to 120, description 50 to 10,000, city 100) and the salary range 0 to 9,999,999.99 (same upper bound as the FR-C3 filter) are not fixed in the sources; the defaults above are assumed.
- Accommodation and visa support are assumed to be yes/no values (boolean), not three-state.
- No automatic wording check for discriminatory text in Phase 1; the controls are controlled lists, no prohibited attributes, the Platform Rules link and moderation (FR-C7).
- ARCHITECTURE 5.6 grants insert on posted_on_behalf_of_organization_id; Phase 1 never sends it (the payload mapper drops it) and the migration may revoke the grant until the later phase; default: the form and the DAL never set it.
- The UPDATE grant covers the content fields and status only; the owner delete policy exists in ARCHITECTURE 5.6; default: the UI offers Close, not delete, in Phase 1.
- Vacancy management does not require aal2 (FR-A4 lists billing, team, applicant and administration pages).
- The slug of the Platform Rules page (platform-rules) and the audit action names job.created and job.updated are assumed.

## FR-C2 · Vacancy lifecycle

> A vacancy moves through Draft → Open → Paused → Closed or Filled; only Open vacancies are visible to the public.

### Acceptance criteria

**AC1 · Allowed transitions succeed, are audited and set the timestamps** (database test (pgTAP))

- Given Acme vacancies in each state, an owner and an admin of Acme, entitlements_enforced false
- When each of draft->open, open->paused, open->closed, open->filled, paused->open, paused->closed, paused->filled and closed->open is applied once by the owner and once by the admin on fresh rows; and one vacancy goes draft->open, open->paused, paused->open
- Then every update succeeds and the status is the new value; exactly one audit.log row exists per change (action job.status_changed, entity_type job, entity_id, actor_id = the user, metadata from and to); status_changed_at is set on every change; published_at is set at the first draft->open and is unchanged by the later paused->open and closed->open; a moderation_state change does not alter status_changed_at

**AC2 · The twelve refused transitions change nothing** (database test (pgTAP))

- Given Acme vacancies in each state and an owner of Acme
- When the owner applies draft->paused, draft->closed, draft->filled, open->draft, paused->draft, closed->draft, closed->paused, closed->filled, filled->draft, filled->open, filled->paused and filled->closed; and sets a vacancy to the status it already has
- Then all twelve attempts fail with CHARA_INVALID_TRANSITION (proposed), the row keeps its status and no audit row is written; setting the current status succeeds as a no-op without an audit row; a Filled vacancy never changes status again

**AC3 · Only owner and admin of the organisation may change status** (database test (pgTAP))

- Given an open vacancy of Acme
- When a member of Acme, an admin of Beta, a candidate and an anonymous caller each try open->paused at the SQL level
- Then the member, the Beta admin and the candidate update 0 rows (row-level security); the anonymous caller is refused with permission denied (no update grant); the vacancy stays open and no audit row exists

**AC4 · System pause on lapse is the only system transition** (database test (pgTAP))

- Given an organisation with 3 open (one of them hidden by moderation), 1 draft, 1 paused and 1 closed vacancy that lapses to free_employer
- When private.pause_jobs_on_lapse(org) runs with entitlements_enforced false and again with it true, and runs a second time on the same organisation; and, separately, an open->paused update runs with no authenticated user and no chara.actor_fn setting, and a draft->open update runs with chara.actor_fn set to 'pause_jobs_on_lapse'
- Then the 3 open vacancies become paused with one audit row each (actor_id null, metadata actor_fn pause_jobs_on_lapse); the draft, the paused and the closed vacancy are untouched; the second run changes and writes nothing; the update without actor and setting is refused; the setting does not allow draft->open (refused with CHARA_INVALID_TRANSITION); no vacancy is deleted

**AC5 · Only open, visible, undeleted vacancies are public** (database test (pgTAP))

- Given 30 vacancies covering every combination of status (5 values), moderation_state (visible, hidden, org_suspended) and deleted_at (null or set)
- When an anonymous caller and a signed-in candidate select from public.jobs
- Then only the row with status open, moderation_state visible and deleted_at null is returned to each; a member of the owning organisation additionally reads all rows of that organisation

**AC6 · Applications after a vacancy stops being open** (database test (pgTAP))

- Given a vacancy of Acme with Applied applications from candidates 1 and 3, and candidate 2 who has not applied; and a lapsed organisation (cancelled subscription, entitlements_enforced false) with an Applied application
- When in separate runs the vacancy is draft, paused, closed, filled, hidden and org_suspended and candidate 2 calls apply_to_job; then, on paused, closed, filled and hidden, candidate 1 withdraws and a member of Acme moves the application of candidate 3 from applied to interview; and a member of the lapsed organisation calls set_application_status while its candidate calls withdraw_application
- Then apply_to_job is refused in all six cases with the stable apply refusal code of FR-D1 (proposed CHARA_JOB_NOT_OPEN), which the UI shows as "This vacancy is no longer accepting applications", and no application row is created; the withdrawal and the applied->interview move succeed; for the lapsed organisation set_application_status fails with CHARA_FEATURE_NOT_IN_PLAN (detail read_only_free_plan) and withdraw_application succeeds

**AC7 · Public pages and search follow the status at the next request** (browser test (Playwright))

- Given an open vacancy that appears at jobs/[id] and in the search for its title
- When the owner pauses it, then reopens it
- Then after pausing, the next request to jobs/[id] shows the neutral "no longer available" page (404) and the search no longer lists it; after reopening both show it again, with no manual cache purge

**AC8 · Status actions offered per state** (browser test (Playwright))

- Given an admin and a member of Acme on a vacancy page in each state
- When the pages are rendered and the admin activates Close and then Mark as filled by keyboard
- Then Draft offers Publish; Open offers Pause, Close and Mark as filled; Paused offers Reopen, Close and Mark as filled; Closed offers Reopen; Filled offers no action; the status badge shows the state in words; Close and Mark as filled ask for confirmation and the Filled dialog states that it is final; the member sees the state and no action

**AC9 · Final state update prompt on close or fill** (browser test (Playwright))

- Given an open vacancy with 6 applications (2 Applied, 1 Interview, 1 Offer, 1 Hired, 1 Not selected) and a second open vacancy with only Hired and Not selected applications
- When the owner closes the first vacancy and marks the second as filled
- Then after closing the first, a prompt "4 applications are still in progress" links to the applicant list filtered to that vacancy; no application changes state and no notification row is queued; the second vacancy shows no prompt

**AC10 · Stale open vacancies are flagged** (unit test (Vitest))

- Given the function that marks stale vacancies
- When it is evaluated for open vacancies whose last change of status (status_changed_at) was 91, 90 and 89 days ago, and for a paused vacancy 120 days after its last change
- Then only the 91-day open vacancy is flagged (more than 90 days); the 90-day, 89-day and paused vacancies are not; the function sends nothing

**AC11 · Concurrent status change from a stale page** (browser test (Playwright))

- Given two admins of Acme have the same Open vacancy page loaded
- When Admin A closes the vacancy, then admin B (page still showing Open) clicks Pause
- Then B's request is refused as invalid transition closed->paused and B sees "This vacancy was changed by someone else, reload" with the current status; the vacancy stays closed and has exactly one status audit row (the close)

**AC12 · Vacancy list states and stale flag** (browser test (Playwright))

- Given the organisation vacancy list
- When it loads for an organisation with no vacancies, for one with vacancies including an open vacancy 91 days after its last status change, for an owner and for a member, and when the data request fails
- Then a skeleton shows while loading; no vacancies shows "No vacancies yet" with a Create vacancy button for owner and admin and no button for a member; each row shows title, status badge and the date of the last status change, and the 91-day open vacancy shows "Open for more than 90 days"; on failure a toast and a retry action appear instead of a blank page

### Data and validation

- status: enum draft, open, paused, closed, filled; default draft; changed only through the guarded update
- moderation_state: visible, hidden, org_suspended; independent of status (see FR-C7)
- deleted_at: null for live vacancies; a soft-deleted vacancy is never public
- proposed: status_changed_at timestamptz, set by the guard trigger on every status change (used for the 90-day stale flag and by FR-C5 clean-up)
- proposed: published_at timestamptz, set once at the first draft->open transition (used for datePosted in FR-C4)
- chara.actor_fn: transaction-local setting, only 'pause_jobs_on_lapse' is recognised and only for open->paused

### States and transitions

- Draft -> Open (owner or admin; active_jobs limit check, FR-C6)
- Open -> Paused (owner or admin)
- Open -> Closed (owner or admin)
- Open -> Filled (owner or admin)
- Open -> Paused (system, subscription lapse, only with chara.actor_fn = pause_jobs_on_lapse; audited)
- Paused -> Open (owner or admin; active_jobs limit check)
- Paused -> Closed (owner or admin)
- Paused -> Filled (owner or admin)
- Closed -> Open (owner or admin; active_jobs limit check)
- Filled -> (none) (final; no transition leaves it)

### Roles and permissions

- Owner: may change status of own organisation's vacancies along the table above
- Admin (organisation): same as owner
- Member (organisation): may read all own vacancies; denied any status change
- Admin or owner of another organisation: denied (row-level security)
- Candidate (worker) and anonymous: may only read Open, visible vacancies; denied status change
- System (pause_jobs_on_lapse): Open -> Paused only
- Platform staff: no status change function in Phase 1 (moderation uses moderation_state, FR-C7)

### Objects

- public.jobs (status, moderation_state, deleted_at; proposed status_changed_at, published_at)
- private.jobs_guard_transition (BEFORE UPDATE OF status trigger)
- private.jobs_enforce_limits, private.assert_within_limit (FR-C6)
- private.pause_jobs_on_lapse(org) (called by billing_apply_event)
- private.assert_org_writable
- jobs_select_public, jobs_select_member, jobs_update_admin policies
- apply_to_job, set_application_status, withdraw_application
- audit.log via audit.record() (proposed action job.status_changed)
- proposed: error code CHARA_INVALID_TRANSITION; apply refusal code CHARA_JOB_NOT_OPEN (owned by FR-D1)
- pages: org/[slug]/jobs and org/[slug]/jobs/[id]; public jobs/[id]; lib/dal/hiring.ts

### Open points and assumed defaults

- P16 (open): a Paused vacancy is assumed hidden from search and closed to new applications while existing applications continue (apply_to_job requires status open and moderation_state visible); to be confirmed by CHARA.
- C11 (open): for an organisation on free_employer the application writes are refused (FR-G4) even for existing applications; the pause-on-lapse rule applies whether or not entitlements_enforced is on.
- The "final state update prompt" on Closed or Filled is assumed to be an in-app prompt listing applications still in progress; no automatic state change and no email.
- Stale-vacancy reminders are assumed to be the in-app flag only; the email catalogue has no reminder kind.
- Hiding a vacancy (FR-C7) does not change status, so an employer can still pause or close a hidden vacancy.

## FR-C3 · Public search

> Visitors and candidates search vacancies by keyword, country, city, occupation, industry, employment type, minimum salary (in a chosen currency and pay period, matched against the top of the salary range, without currency conversion), accommodation, visa support and recruitment preference, with paginated results ordered by relevance and recency.

### Acceptance criteria

**AC1 · Search returns public vacancies and public columns only, even for the owner** (database test (pgTAP))

- Given Vacancies of Acme in every status, moderation_state and deleted state (exactly one open, visible and undeleted), and a signed-in owner of Acme
- When an anonymous caller, a candidate and the Acme owner each call search_jobs without filters, and the result columns are read
- Then all three get only the open, visible, undeleted vacancy; the owner does not see Acme's draft, paused, closed, filled, hidden, org_suspended or deleted vacancies; the function is executable by anon and authenticated; the columns are exactly id, title, employer display name, employer slug, country_code, city, employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation, visa_support, recruitment_preference and created_at (no created_by, legal name or member data)

**AC2 · Ordering by relevance, then recency, independent of plan** (database test (pgTAP))

- Given Open vacancies: A (the word "welder" 5 times), B and C with identical text containing "welder" once (C created 1 day after B), D without the word; B belongs to an organisation on employer_starter and C to one on employer_enterprise
- When search_jobs runs with keyword "welder", and again with no keyword
- Then with the keyword the order is A, C, B and D is absent (more relevant first; equal relevance: newer created_at first, then id; the plan has no effect); without keyword the order is created_at descending, then id

**AC3 · Keyword and city matching is literal, accent-insensitive and whole-word** (database test (pgTAP))

- Given Open vacancies V1 (title "Schweisser", description mentioning "Muenchen" and "München", city "München") and V2 (title "Welder", city "Hamburg")
- When search_jobs runs with keyword "munchen", "WELDER", "welders", "welder hamburg" and "welder schweisser"; with city "munchen" and "Mün"; with keyword "'; drop table jobs; --"; with city "%" and "_"; and with a 100-character string of non-Latin characters
- Then "munchen" finds V1 and "WELDER" finds V2; "welders" finds nothing (no stemming); "welder hamburg" finds V2 and "welder schweisser" finds nothing (all words must match); city "munchen" finds V1 and "Mün" nothing (whole value); the hostile and wildcard inputs return 0 rows without error, match literally, and public.jobs keeps all its rows

**AC4 · Each filter narrows the results and filters combine with AND** (database test (pgTAP))

- Given 12 seeded open vacancies varying in country, city, occupation, industry, employment type, accommodation, visa support and recruitment preference (local, international, both)
- When search_jobs runs with one filter at a time (country DE; one occupation_id; one industry_code; employment_type full_time; accommodation true; visa_support true; recruitment local; recruitment international; country XX) and then with country DE plus accommodation true plus a keyword
- Then each single filter returns exactly the expected vacancy ids; recruitment local returns local and both, international returns international and both; country XX returns 0 rows without error; accommodation and visa filters only select vacancies where the value is true; the combined call returns the intersection

**AC5 · Minimum salary matches the top of the range without conversion** (database test (pgTAP))

- Given Open vacancies: EUR month 2000-3000; EUR month 2500-3500; EUR month with only min 4000 (max null); EUR month with only max 3400; EUR year 30000-40000; USD month 3000-5000; no salary
- When search_jobs runs with minimum salary 3000, currency EUR, period month, and again with 3001
- Then at 3000 the 2000-3000 (max exactly 3000), 2500-3500 and max-only 3400 vacancies match; the max-null, EUR year, USD month and no-salary vacancies do not; at 3001 only the 2500-3500 and max-only 3400 vacancies match

**AC6 · Keyset pagination is stable** (database test (pgTAP))

- Given 45 open vacancies matching one filter and a page size of 20
- When Page 1 is fetched, a new matching vacancy is created, then pages 2 and 3 are fetched with the returned cursors; and a limit of 500 is requested
- Then the pages hold 20, 20 and 5 vacancies with no duplicate and none skipped among the original 45; the last page returns no next cursor; the new vacancy does not shift page 2; the requested limit of 500 is capped at 50 and a missing limit gives 20

**AC7 · Filter parameters are parsed and validated** (unit test (Vitest))

- Given the pure function that turns URL parameters into search filters and back
- When it receives q of 101 characters, q "  welder  ", country "DEU" and "de", salary_min 3000 without currency, salary_min 3000 with currency but no period, salary_min 0, -5, "abc" and 10000000, salary_period "week", recruitment "both" and "local", limit 0, 99 and "abc", and an unknown parameter
- Then q of 101 characters is rejected with an error naming q and "  welder  " becomes "welder"; "DEU" is rejected and "de" becomes "DE"; salary_min without currency or without period is an error naming the missing parameter; salary_min must be greater than 0 and at most 9,999,999.99 so 0, -5, "abc" and 10000000 are errors; "week" is an error (hour, month and year only); "both" is an error and "local" is accepted; limit 0 becomes 1, 99 becomes 50, "abc" becomes 20; the unknown parameter is ignored; invalid values are dropped and each error names its parameter; a valid filter set serialises to the same query string

**AC8 · Search state is in the URL** (browser test (Playwright))

- Given an anonymous visitor on the Find Jobs page
- When they set country DE, employment type full_time and minimum salary 3000 EUR per month, open the next page, press Back, and open the same URL in a new anonymous browser context
- Then the URL contains the filters (for example ?country=DE&employment_type=full_time&salary_min=3000&salary_currency=EUR&salary_period=month) and, on page 2, the cursor; Back restores the previous filters and page; the new context shows the same results

**AC9 · Result cards, page states and keyboard use** (browser test (Playwright))

- Given the Find Jobs page
- When Results load, the filters match nothing, the search request fails, and a user fills the form by keyboard and presses Enter in the keyword field
- Then a skeleton shows while loading; each card shows title, employer name, "city, country", employment type, the salary as a range with currency and pay period, accommodation and visa badges and the date, and no person name, email or legal name; zero results show "No vacancies match your search" with a Clear filters action; a failed request shows a toast and a retry action; every filter has a visible label; Enter in the keyword field runs the search; the result count is announced in a polite live region; axe reports no violations at 360 px width

**AC10 · Indexes exist for every filter and policy column** (database test (pgTAP))

- Given the migrated database
- When pg_indexes for public.jobs is read
- Then the indexes (status, country_code, occupation_id, created_at desc), (organization_id, status), the GIN index on search_vector and the pg_trgm GIN index on title exist, together with proposed indexes covering industry_code, employment_type, the salary filter (salary_currency, salary_period, salary_max) for open vacancies, and the policy columns moderation_state and deleted_at

**AC11 · Search time target** (manual check)

- Given a database with 10,000 vacancies and 50,000 candidates (NFR-P1) and the 12 most common filter combinations
- When a scripted load test renders the search page for each combination
- Then 95 percent of search page renders complete within 500 ms server time; the result is reviewed before launch

**AC12 · Search timing log holds no search terms** (unit test (Vitest))

- Given the logger helper for search timing
- When a search with keyword "welder", country DE and salary_min 3000 is logged
- Then the entry holds the duration and the names of the filters used (q, country, salary_min) but not the keyword or any filter value

### Data and validation

- q: optional, trimmed, 1 to 100 characters, whole-word match on title and description (language-neutral, accent-insensitive, case-insensitive; no stemming); several words must all match
- country: optional ISO 3166-1 alpha-2
- city: optional, 1 to 100 characters, matched case- and accent-insensitively as a whole value
- occupation: optional occupation id from public.occupations
- industry: optional ISIC code from public.industries
- employment_type: optional value of the employment_type list
- salary_min: optional, greater than 0, up to 9,999,999.99; requires salary_currency and salary_period
- salary_currency: ISO 4217 code from public.currencies; salary_period: hour, month or year
- accommodation, visa_support: optional, only the value true is a filter
- recruitment: optional, local (matches local and both) or international (matches international and both)
- cursor: opaque keyset cursor over (relevance, created_at, id)
- limit: integer 1 to 50, default 20
- nothing is stored; no personal data is collected by the search

### Roles and permissions

- Anonymous (visitor): may search and read public results
- Candidate (worker): may search and read public results
- Company user (owner, admin, member): may search; their own non-public vacancies never appear in the public search
- Platform staff roles: same as any visitor; no special search privilege
- Nobody: cannot reach drafts, paused, closed, filled, hidden, org_suspended or deleted vacancies through search

### Objects

- search_jobs(filters, cursor, limit) (RPC; EXECUTE for anon and authenticated; applies the public predicate itself because jobs_select_member would otherwise show members their own drafts)
- public.jobs (search_vector generated tsvector, status, moderation_state, deleted_at, salary_* columns, created_at)
- public.organizations (display_name, slug; read for anonymous callers only through search_jobs or a proposed public view that never exposes legal_name)
- indexes of ARCHITECTURE 9.1 (status/country/occupation/created_at, organization_id/status, GIN search_vector, pg_trgm title); proposed indexes on industry_code, employment_type, the salary filter, moderation_state and deleted_at
- jobs_select_public policy
- pages: app/[lang]/(public)/jobs; lib/dal/hiring.ts; pino logger (instrumentation.ts)
- proposed: lib/search-params module (parse and serialise filters)

### Open points and assumed defaults

- Salary: no currency or pay-period conversion in Phase 1; a vacancy without a salary_max never matches while the salary filter is set (follows from salary_max >= amount, ARCHITECTURE 9.2).
- P11 (open): a plan never changes the ranking; no boost exists in Phase 1, so order is relevance then recency (created_at).
- The recruitment filter offers local and international only; a vacancy with preference both matches either (assumed).
- The default page size of 20, the maximum of 50, the 100-character keyword limit and whole-word matching without stemming are assumed defaults.
- Column names of the search result (employer_display_name, employer_slug) are proposed.

## FR-C4 · Vacancy page

> The vacancy page shows the vacancy details, the employer's public profile and the actions Apply (login required) and Save.

### Acceptance criteria

**AC1 · Vacancy details and employer card render** (browser test (Playwright))

- Given an open vacancy of Acme (Hamburg, DE, EUR 2,800 to 3,400 per month, accommodation yes, visa support yes, recruitment both) and an anonymous visitor
- When the visitor opens jobs/[id]
- Then the page shows the title as the only h1, the description with its line breaks, "Hamburg, Germany", the occupation and industry labels, the employment type, the salary range with currency and pay period, accommodation, visa support, recruitment preference, the date published, an employer card with display name, country, industry and website, and the Apply and Save actions; the response has no noindex robots tag

**AC2 · Employer card exposes only public profile fields** (browser test (Playwright))

- Given an organisation with legal_name "Acme Holding GmbH i.G.", display name "Acme", members with known emails and a website value
- When the vacancy page HTML and the page data are inspected, with the website set to "javascript:alert(1)" in one run and "https://acme.example" in another
- Then neither legal_name, member emails, subscription data nor created_by occur anywhere in the HTML or data; the valid website is a link with rel="nofollow noopener noreferrer" opening in a new tab; the javascript: value is not rendered as a link

**AC3 · Apply and Save need a candidate login and a safe return** (browser test (Playwright))

- Given an anonymous visitor on an open vacancy page
- When they click Apply, sign in as a candidate, and then click Save; and a login request uses next=//evil.example and another uses next=https://evil.example
- Then Apply leads to login with next set to the vacancy page and returns to that page after login; Save then works for the signed-in candidate; an absolute or protocol-relative next value is ignored and the user lands on the default page

**AC4 · Save toggle for a candidate** (browser test (Playwright))

- Given a signed-in candidate on an open vacancy page
- When they press Save, then press it again
- Then the button changes to "Saved" with aria-pressed true, then back to "Save" with aria-pressed false; saved_jobs holds one row after the first press and none after the second

**AC5 · Applied state of the page** (browser test (Playwright))

- Given a signed-in candidate with no application, with a non-withdrawn application, and with only a withdrawn application to the vacancy
- When they open the vacancy page and press Apply where it is offered
- Then with no application or only a withdrawn one Apply is offered and opens the application step of FR-D1; with a non-withdrawn application the page shows "Applied on <date>" with a link to the application tracker and no Apply button

**AC6 · Company users cannot apply or save** (browser test (Playwright))

- Given a signed-in company user (owner of an employer organisation) and a signed-in Platform Administrator
- When they open an open vacancy page
- Then the page renders for them, Apply and Save are not offered and a short text explains that only candidates can apply

**AC7 · Unavailable vacancies show one neutral page** (browser test (Playwright))

- Given Vacancy ids that are draft, paused, closed, filled, hidden, org_suspended, soft-deleted, nonexistent and a malformed id ("abc")
- When an anonymous visitor requests jobs/[id] for each
- Then every request returns HTTP 404 with the identical body "This vacancy is no longer available", a link to Find Jobs and a noindex robots tag, without any vacancy field, employer name, JSON-LD or reason; the bodies are byte-identical apart from the request id

**AC8 · Own non-public vacancies are not served on the public URL** (browser test (Playwright))

- Given a draft, a paused and a hidden vacancy of Acme, and a signed-in owner and member of Acme
- When they request jobs/[id] of each
- Then each request returns the same neutral 404 page as for an anonymous visitor; the vacancy is reachable only through the preview URL

**AC9 · JobPosting structured data** (unit test (Vitest))

- Given the function that builds the JobPosting JSON-LD from a vacancy
- When it is run for a vacancy with salary EUR 2800-3400 per month and employment type full_time; for one with only salary_min; for one without salary; for each of the five employment types; and for a description containing "</script><script>alert(1)</script>"
- Then the output has @type JobPosting, title, description, datePosted (published_at as ISO 8601), hiringOrganization name, jobLocation with addressLocality and addressCountry DE and employmentType FULL_TIME; baseSalary (currency EUR, minValue 2800, maxValue 3400, unitText MONTH) exists only when a salary exists and carries only minValue when only salary_min is set; full_time, part_time, contract, temporary and seasonal map to FULL_TIME, PART_TIME, CONTRACTOR, TEMPORARY and TEMPORARY; the < character is escaped so the script block cannot be closed early; legal_name never appears

**AC10 · User text is never interpreted as HTML** (browser test (Playwright))

- Given a vacancy with title "<img src=x onerror=alert(1)>" and a description containing "<script>alert(1)</script>" and a URL
- When the public page, the search card and the preview render it
- Then the text appears literally, no script runs and no element is injected; the URL in the description is plain text, not a link

**AC11 · Rendered on the server from live data** (browser test (Playwright))

- Given an open vacancy and an owner who edits its title
- When the page is fetched without JavaScript before and right after the edit, and once while the database request fails
- Then each normal response already contains the current title, description and employer card, and the response after the edit shows the new title with no stale cache; the failing request returns a 5xx error page, not the "no longer available" page

**AC12 · Accessibility and responsive layout** (browser test (Playwright))

- Given the vacancy page of an open vacancy
- When it is checked with axe at 1280 px and at 360 px width and operated by keyboard
- Then there are no axe violations at WCAG 2.2 AA; there is no horizontal scroll at 360 px; Apply and Save are reachable by Tab, operable with Enter or Space and show a visible focus; the document title is "<vacancy title> - <employer name> | CHARA"

### Data and validation

- route parameter id: uuid of the vacancy; any other value renders the neutral page
- nothing is stored by this page; it reads vacancy fields (title, description, location, occupation, industry, employment type, salary, accommodation, visa support, recruitment preference, published date) and the employer's public fields (display_name, based_in_country, industry_code, website, slug)
- description is shown as plain text with line breaks
- JobPosting fields: title, description, datePosted, hiringOrganization, jobLocation, employmentType, baseSalary (only when a salary exists)

### Roles and permissions

- Anonymous: may view the page of an Open, visible vacancy; Apply and Save lead to login
- Candidate (worker): may view, Save and Apply
- Company user (owner, admin, member): may view as any visitor; denied Apply and Save; own non-public vacancies are seen through the preview, not this URL
- Platform staff: no special view of non-public vacancies on this URL

### Objects

- public.jobs, public.organizations (display_name, slug, based_in_country, industry_code, website; never legal_name)
- public.occupations, public.industries, public.countries (labels)
- jobs_select_public policy; the page query also filters status, moderation_state and deleted_at itself because jobs_select_member would show members their own rows
- saved_jobs (Save), apply_to_job (FR-D1)
- pages: app/[lang]/(public)/jobs/[id] (proposed route), org/[slug]/jobs/[id]/preview (proposed), app/global-not-found.tsx
- lib/safe-next.ts, lib/dal/hiring.ts, proposed: JobPosting JSON-LD builder (lib module)
- proposed: jobs.published_at (FR-C2)

### Open points and assumed defaults

- Hidden, closed and other unavailable vacancies are assumed to return HTTP 404 with the neutral page and a noindex tag, so the reason is never disclosed.
- The employer card shows name, country, industry and website only, as the SOP states; the full public company page (companies) is a separate Phase 1 public page.
- The sitemap and robots files for vacancies belong to FR-H5; the JobPosting markup is required by the FR-C4 SOP and by FR-H5.
- The document title format and the employment type mapping to JobPosting values (seasonal to TEMPORARY) are assumed.
- If public.organizations has no anonymous read policy, the employer card reads through a proposed public view of its public columns.

## FR-C5 · Saved vacancies

> A candidate can save and unsave vacancies and view the saved list.

### Acceptance criteria

**AC1 · Save from search and from the vacancy page** (browser test (Playwright))

- Given a signed-in candidate and two open vacancies
- When they press Save on a search result card and on the other vacancy's page, then reload and open the saved list
- Then both buttons change to "Saved" (aria-pressed true); the saved list shows both vacancies, most recently saved first; the state persists after reload

**AC2 · Unsave and empty list** (browser test (Playwright))

- Given a candidate with 2 saved vacancies
- When they press Unsave on both in the saved list
- Then each row disappears at once, the rows are removed from public.saved_jobs, and the empty state "No saved vacancies yet" with a link to Find Jobs appears

**AC3 · Saving and unsaving are idempotent** (database test (pgTAP))

- Given a candidate and an open vacancy
- When the save is requested twice in sequence and twice in parallel, and then the unsave is requested twice
- Then exactly one saved_jobs row exists for (worker_user_id, job_id) after the saves, no call returns an error, a primary key on that pair exists, and the second unsave is a no-op without error

**AC4 · Saved vacancies are private and for candidates only** (database test (pgTAP))

- Given Candidates A and B, a company user and an anonymous caller
- When B selects and deletes A's saved rows, B inserts a row with worker_user_id = A, the company user inserts a row for themselves, and the anonymous caller selects
- Then B sees and deletes 0 rows and the insert for A is refused; the company user's insert is refused; the anonymous caller is refused for lack of a grant; A's rows are unchanged

**AC5 · Only public vacancies can be saved** (database test (pgTAP))

- Given a candidate and vacancies that are open, draft, paused, closed, filled, hidden, org_suspended, soft-deleted and nonexistent
- When they save each one
- Then only the open, visible, undeleted vacancy is saved; the other eight attempts are refused and create no row

**AC6 · The saved-list data discloses no moderated content** (database test (pgTAP))

- Given a candidate who saved vacancies that are now open, paused, closed, filled, hidden, org_suspended and soft-deleted
- When the saved-list view or RPC is called by that candidate and by another candidate
- Then the caller gets only own rows; open, paused, closed and filled rows return title, employer name and a status flag; hidden, org_suspended and soft-deleted rows return only the id and an unavailable flag with null title and employer; no description, reason or moderation_state value is returned for any row

**AC7 · Saved list shows status flags** (browser test (Playwright))

- Given a candidate who saved 1 open, 1 paused, 1 closed, 1 filled and 1 hidden vacancy
- When they open the saved list
- Then the open vacancy shows "Open" and an Apply link to its page; the paused, closed and filled vacancies show title, employer name and the flag "No longer open" and no Apply link; the hidden vacancy shows only "This vacancy is no longer available" with no title and no employer

**AC8 · Clean-up after 90 days** (database test (pgTAP))

- Given Saved rows for vacancies whose status last changed as follows: closed 91 days ago, filled 91 days ago, closed 90 days ago, closed 89 days ago, paused 120 days ago, hidden (status open) 120 days ago, open, and one closed 120 days ago and reopened yesterday
- When the clean-up function runs, and runs again
- Then only the rows of the vacancies closed or filled more than 90 days ago (the two 91-day rows) are deleted; all other rows are kept; the second run deletes nothing further; a daily pg_cron job for the function exists

**AC9 · Applied marker and quick apply** (browser test (Playwright))

- Given a candidate with a saved open vacancy they applied to (non-withdrawn), a saved open vacancy with only a withdrawn application, and a saved open vacancy they did not apply to
- When they open the saved list and use Quick apply on the last two
- Then the first row shows "Applied" with a link to the tracker and no Quick apply; the other two offer Quick apply, which opens the vacancy page at its application step

**AC10 · Access control on the saved page and the Save action** (browser test (Playwright))

- Given an anonymous visitor and a company user
- When they open the saved page, and the visitor presses Save on a search result card
- Then the visitor is redirected to login with next set to the saved page; the company user gets 404; Save on the card leads to login with next set to the page it was pressed on

**AC11 · Saved list states, paging and keyboard** (browser test (Playwright))

- Given the saved page
- When it loads, the request fails, and a candidate with 25 saved vacancies uses the keyboard
- Then a skeleton shows while loading; a failure shows a toast and a retry action; page 1 shows 20 rows with a next page control and page 2 shows 5; each Save button has the accessible name "Save vacancy: <title>" and toggles with Enter and Space

### Data and validation

- worker_user_id: required, = auth.uid(), account kind worker
- job_id: required, reference to a vacancy that is Open, visible and not deleted at save time
- primary key (worker_user_id, job_id): one row per pair
- proposed: created_at timestamptz default now(), used for ordering the list
- list page size 20

### States and transitions

- Not saved -> Saved (candidate, vacancy Open and visible)
- Saved -> Not saved (candidate; or clean-up when the vacancy has been Closed or Filled for more than 90 days)

### Roles and permissions

- Candidate (worker): may save, unsave and list own saved vacancies
- Another candidate: denied any access to the rows
- Company user (owner, admin, member): denied save and the saved page
- Anonymous: denied; redirected to login
- Platform staff: no access

### Objects

- public.saved_jobs(worker_user_id, job_id; proposed created_at)
- RLS policies on saved_jobs (owner-only, worker account kind via private.account_kind(), public vacancy at insert)
- proposed: security-definer view or RPC for the saved list (title, employer name, status flag only; null for non-public rows)
- proposed: private.cleanup_saved_jobs() run daily by pg_cron
- public.jobs (status, moderation_state, deleted_at, proposed status_changed_at)
- public.job_applications (applied marker)
- pages: proposed app/[lang]/(app)/saved; Save control on jobs, jobs/[id]; lib/dal/hiring.ts

### Open points and assumed defaults

- The 90 days run from the moment the vacancy became Closed or Filled (status_changed_at); Paused and hidden vacancies are flagged but not removed; applying the clean-up to Filled as well as Closed is assumed (the SOP names closed vacancies).
- A saved vacancy that is hidden, suspended or soft-deleted shows no title or employer, so moderated content is not disclosed through the list.
- The saved page route and the list page size of 20 are assumed.

## FR-C6 · Plan limits

> The number of Open vacancies per organisation is limited by its plan: initially 3 (Basic), 15 (Professional) and 50 (Enterprise, adjustable per organisation), stored as administrator-editable configuration. Enforcement is switched on by a configuration setting; when it is on, reaching the limit shows an upgrade prompt (to be confirmed by CHARA: the date on which limit enforcement is switched on).

### Acceptance criteria

**AC1 · Limit data: seeded, changed by migration only, readable only through the member view** (database test (pgTAP))

- Given the seeded database, an admin of Acme, an admin of Beta, a candidate and an anonymous caller
- When billing.plan_limits and private.settings are read as postgres; plan_limits.active_jobs of employer_starter is changed from 3 to 4 inside a test transaction with entitlements_enforced true and a Basic organisation with 3 open vacancies; and the roles select, insert, update and delete on both tables and read the proposed public.v_org_limits
- Then active_jobs is 3 for employer_starter, 15 for employer_professional, 50 for employer_enterprise and 0 (not null) for free_employer; private.settings has entitlements_enforced with value false; after the change the Basic organisation can publish a fourth vacancy and is refused a fifth with no code change; anon, authenticated and service_role are refused on both tables; the Acme admin reads limit and open count for Acme from v_org_limits, the Beta admin sees no Acme row, the anonymous caller is refused

**AC2 · The enforcement setting is read in every stored form** (database test (pgTAP))

- Given an organisation that never had a subscription (resolves to free_employer, limit 0) and private.settings entitlements_enforced stored as jsonb false, jsonb true, jsonb "true" and with no row
- When the organisation publishes a draft vacancy under each form
- Then with false and with the row missing, 5 publishes of 5 drafts all succeed; with jsonb true and with jsonb "true" the publish is refused with CHARA_LIMIT_REACHED (limit 0)

**AC3 · Publish at the boundary for each plan** (database test (pgTAP))

- Given entitlements_enforced is true and organisations with an active subscription on employer_starter (2 open), employer_professional (14 open) and employer_enterprise (49 open), each with 3 drafts
- When each publishes its drafts one after the other
- Then the first publish in each organisation (bringing the open count to 3, 15 and 50) succeeds; the next publish in each fails with CHARA_LIMIT_REACHED and detail active_jobs, the vacancy stays draft and no status audit row exists for it

**AC4 · Reopening is checked like publishing** (database test (pgTAP))

- Given entitlements_enforced is true and a Basic organisation with 3 open, 1 paused and 1 closed vacancy
- When the admin reopens the paused vacancy, then reopens the closed one, then pauses one open vacancy and reopens one paused vacancy, then reopens another
- Then the first two reopens fail with CHARA_LIMIT_REACHED; after one open vacancy is paused (2 open), reopening one paused vacancy succeeds (3 open) and the next reopen fails again

**AC5 · Only open vacancies count** (database test (pgTAP))

- Given entitlements_enforced is true and a Basic organisation with 1 open visible vacancy, 1 open vacancy hidden by moderation, 2 drafts, 2 paused, 2 closed, 1 filled and 1 soft-deleted vacancy with status open, plus organisation Beta with 3 open vacancies
- When the Basic organisation creates a draft, publishes one draft, and then tries to publish another
- Then Creating a draft is never blocked; draft, paused, closed, filled and soft-deleted vacancies and Beta's vacancies are not counted; the hidden open vacancy is counted; so the first publish succeeds (2 counted, limit 3) and the next fails with CHARA_LIMIT_REACHED

**AC6 · Free plan, lapsed, past due and trialing organisations** (database test (pgTAP))

- Given an organisation with no subscription row and enforcement true; a lapsed organisation (one canceled subscription row) once with enforcement false and once true; an organisation with a past_due subscription and one with a trialing subscription on employer_starter, both with 2 open vacancies
- When each publishes or reopens a vacancy
- Then the organisation without subscription and the lapsed organisation (under both settings) are refused with CHARA_LIMIT_REACHED (limit 0); the past_due and trialing organisations keep the Basic limit of 3 and may publish a third vacancy

**AC7 · Downgrade keeps data and blocks creation over the limit** (database test (pgTAP))

- Given entitlements_enforced is true and an organisation on employer_professional with 10 open vacancies that changes to employer_starter
- When Vacancies are listed, edited and closed, and drafts are created and published
- Then all 10 vacancies remain open and none is deleted or paused automatically; editing an open vacancy and creating drafts still work; publishing or reopening is refused until the open count is 2 or fewer; closing one of the 10 (9 open) does not allow another publish

**AC8 · Unknown plan denies and a null limit means unlimited** (database test (pgTAP))

- Given an organisation whose plan code is not in billing.plans, and an organisation on a known plan whose active_jobs limit_value is null
- When each publishes a vacancy with entitlements_enforced true
- Then the unknown plan is refused with CHARA_FORBIDDEN and detail unknown_plan; the null limit never blocks, even at 100 open vacancies

**AC9 · Concurrent publishes cannot exceed the limit** (browser test (Playwright))

- Given Enforcement on, a Basic organisation with 2 open vacancies and 2 drafts, and two admins with a draft each in separate browser sessions
- When both press Publish at the same moment
- Then exactly one publish succeeds and the open count is 3; the other admin sees the upgrade prompt and that draft remains draft

**AC10 · Upgrade prompt** (browser test (Playwright))

- Given Enforcement on and a Basic organisation with 3 open vacancies, an admin and a member viewing a draft
- When the admin presses Publish, then closes one open vacancy and presses Publish again
- Then the first attempt keeps the vacancy a draft and shows a prompt stating the plan name from billing.plans, the limit and the usage ("3 of 3 open vacancies"), a link Upgrade to org/[slug]/billing and a hint to pause or close a vacancy; after closing one vacancy the publish succeeds; the member sees no Publish action

**AC11 · Error mapping** (unit test (Vitest))

- Given the data access layer mapping of RPC and database errors
- When it receives CHARA_LIMIT_REACHED with detail active_jobs, CHARA_FORBIDDEN with detail unknown_plan and an unexpected error
- Then the first maps to the upgrade prompt model with limit and usage fields, the second to a generic access message, and the third to a generic error toast; no SQL text or error detail is shown to the user

**AC12 · Go-live gate for enforcement** (unit test (Vitest))

- Given the go-live check script and a production settings export
- When it is run with entitlements_enforced false, missing, jsonb "true" and jsonb true
- Then it exits non-zero and prints the setting name for false and missing, and exits zero for both true forms

### Data and validation

- billing.plan_limits(plan_code, limit_key = 'active_jobs', limit_value integer >= 0 or null; null means unlimited for a known plan)
- seed values: employer_starter 3, employer_professional 15, employer_enterprise 50, free_employer 0 (never empty)
- private.settings key entitlements_enforced: jsonb boolean, read as value #>> '{}', default false, missing row reads as false
- organisation plan: private.org_plan_code(org); no subscription or a canceled one resolves to free_employer; trialing, active and past_due keep their plan
- limits are administrator-editable records; until the editing screen exists a change is made by migration

### States and transitions

- Draft -> Open (owner or admin, only while open count < active_jobs limit)
- Paused -> Open (owner or admin, only while open count < active_jobs limit)
- Closed -> Open (owner or admin, only while open count < active_jobs limit)

### Roles and permissions

- Owner and admin (organisation): may publish or reopen up to the limit; see the upgrade prompt when blocked
- Member (organisation): denied publish and reopen
- Candidate, anonymous: denied
- Platform Administrator: owns limit records; changes are made by reviewed migration in Phase 1 (no editing screen)
- billing_owner: owns the limit tables; users and service_role have no access to plan_limits or private.settings

### Objects

- billing.plan_limits, billing.plans, billing.subscriptions
- private.settings (entitlements_enforced)
- private.org_plan_code, private.org_limit, private.free_plan_restricted, private.assert_within_limit
- private.jobs_enforce_limits (BEFORE INSERT OR UPDATE OF status trigger on public.jobs; proposed: serialises per organisation, for example by locking the organizations row; proposed: ignores soft-deleted rows in the count)
- private.pause_jobs_on_lapse
- public.jobs (status, moderation_state, deleted_at)
- proposed: public.v_org_limits (security_invoker, members only; limit and open count for the prompt)
- error codes CHARA_LIMIT_REACHED, CHARA_FORBIDDEN
- pages: org/[slug]/jobs, org/[slug]/billing; proposed scripts/check-go-live; lib/dal/hiring.ts

### Open points and assumed defaults

- C11 (open): when entitlements_enforced is switched on is open; the default is to seed the numbers now and switch enforcement on with the billing work package (week 4); it must be true at go-live. The lapse rules apply regardless of the setting.
- C9 (open): on downgrade the default is keep data, block creation over the limit.
- Enterprise per-organisation values: billing.organization_limit_overrides is later phase (ARCHITECTURE 10.1); until it exists the Enterprise limit is changed on the plan row by migration.
- C11 (open): the contents of free_employer (0 open vacancies, no feature rows) are to be confirmed by CHARA.
- The trigger in ARCHITECTURE 10.4 counts without locking and without the deleted_at filter; the implementation is assumed to serialise per organisation (AC9) and to ignore soft-deleted vacancies (AC5).
- C13 (open): the display name of the lowest paid plan (Basic or Starter) is open; the prompt uses the plan name from billing.plans.

## FR-C7 · Moderation

> A Trust & Safety Administrator can hide or unhide a vacancy with a written statement of reasons; the employer is notified.

### Acceptance criteria

**AC1 · Hide a vacancy** (database test (pgTAP))

- Given an open, visible vacancy of Acme and a Trust & Safety Administrator (platform_staff role trust_safety, not revoked) at aal2
- When they call moderate_job to hide it with a statement of reasons of 40 characters
- Then moderation_state becomes hidden and status stays open; one public.moderation_actions row exists (target_type job, target_id, action hide, statement_of_reasons as given, actor_id = the caller); one audit.log row exists with the reason in metadata

**AC2 · Statement of reasons is mandatory for hide and unhide** (database test (pgTAP))

- Given a Trust & Safety Administrator at aal2 and a visible vacancy and a hidden vacancy
- When they hide and unhide with reasons null, empty, 6 spaces, 19 characters and 2,001 characters
- Then each call fails with CHARA_REASON_INVALID (proposed); moderation_state is unchanged, no moderation_actions or audit row is written and no notification is queued; 20 and 2,000 characters are accepted

**AC3 · Only trust_safety at aal2 can moderate** (database test (pgTAP))

- Given an open vacancy of Acme and a hidden vacancy of Acme
- When moderate_job is called by a Platform Administrator (role admin only), a verification_reviewer, the Acme owner, a candidate, a trust_safety user at aal1 and a trust_safety user whose role has revoked_at set, and by an anonymous caller; the Acme owner also updates moderation_state of the hidden vacancy to visible directly; and a trust_safety user at aal2 calls it for a nonexistent and a soft-deleted vacancy
- Then every authenticated call fails with CHARA_FORBIDDEN (CHARA_INVALID_STATE (proposed) for the nonexistent and soft-deleted ids); the anonymous call is refused for lack of EXECUTE; the direct update is refused with permission denied (the column is not in the update grant); the vacancies keep their state and no row is written

**AC4 · A hidden vacancy leaves the public and takes no new applications** (database test (pgTAP))

- Given a hidden vacancy of Acme with status open, one existing Applied application, a saved row of a candidate, and a second candidate
- When an anonymous caller reads public.jobs, search_jobs runs, the second candidate calls apply_to_job, the existing candidate withdraws (in another run), the employer moves the existing application applied->interview, and a member of Acme reads the vacancy
- Then the vacancy is not returned by the table read or the search; apply_to_job is refused; the existing application can still be moved and withdrawn; the member of Acme still reads the vacancy

**AC5 · Unhide a vacancy** (database test (pgTAP))

- Given a hidden open vacancy, a hidden paused vacancy and a Trust & Safety Administrator at aal2
- When they unhide each with reasons of 30 characters, and then try to unhide the first again
- Then moderation_state becomes visible, one moderation_actions row (action unhide) and one audit row are written per call; the open vacancy is public again and the paused one stays non-public; the second unhide fails with CHARA_INVALID_STATE (proposed) and writes nothing

**AC6 · Hide queues one mandatory notification per owner and admin** (database test (pgTAP))

- Given Acme with 1 owner, 2 admins and 2 members (one invitation not yet accepted), an employer digest preference true for one admin, and a visible vacancy
- When the vacancy is hidden, unhidden, hidden again, and hidden a third time in a row
- Then the first hide creates 3 notifications of kind vacancy_hidden with status queued (owner and the 2 admins; none for members, the pending invitation or candidates) with vacancy id, title and reasons in the payload, regardless of the digest preference; the unhide queues none; the second hide queues 3 more (6 in total); the third hide in a row fails with CHARA_INVALID_STATE and the total stays 6

**AC7 · The employer receives the email with reasons and appeal route** (browser test (Playwright))

- Given a hide action and the notify function running against the local mail catcher
- When the queue is processed
- Then the owner and each admin receive one English email that names the vacancy, quotes the statement of reasons, explains how to appeal by linking to the Complaints and Dispute Process page, and contains no applicant data; the notification status becomes sent; the hide stays committed if the mail catcher is down and the notification stays queued for retry

**AC8 · Interaction with organisation suspension** (database test (pgTAP))

- Given Acme with 2 visible vacancies and 1 vacancy hidden by moderation
- When suspend_organization runs, then reinstate_organization, and moderate_job is called on a vacancy in org_suspended state while the organisation is suspended
- Then after suspension the 2 visible vacancies are org_suspended and the hidden one stays hidden; after reinstatement the 2 return to visible and the hidden one stays hidden; moderate_job on an org_suspended vacancy fails with CHARA_INVALID_STATE

**AC9 · Administration page for hiding and unhiding** (browser test (Playwright))

- Given a trust_safety user at aal2, a Platform Administrator at aal2 and a trust_safety user at aal1
- When they open the vacancy moderation page, and the trust_safety user searches for "Welder", opens the vacancy and hides it by keyboard
- Then the Platform Administrator gets 403 and the aal1 user is sent to two-step verification; the search finds vacancies by title, id or organisation name and shows status and moderation state without applicant data; the Hide dialog has a labelled "Statement of reasons" field that is required, lists the vacancy title and organisation, and after confirmation the page shows the badge "Hidden" and an Unhide action

**AC10 · The employer sees the moderation state** (browser test (Playwright))

- Given a vacancy of Acme hidden by moderation and a member and an admin of Acme
- When they open the organisation vacancy list and the vacancy page
- Then the vacancy shows the badge "Hidden by moderation" and a notice with the appeal route (link to the Complaints and Dispute Process page); the status actions stay available according to FR-C2; the vacancy is still not public

**AC11 · Moderation search and staff separation** (database test (pgTAP))

- Given a trust_safety user at aal2, a Platform Administrator, a verification_reviewer, a candidate and the proposed admin_search_jobs RPC
- When each calls admin_search_jobs; and the trust_safety user selects from job_applications, application_notes and worker_documents
- Then only trust_safety at aal2 gets rows, with exactly id, title, organisation name, status, moderation_state and created_at; every other caller is refused with CHARA_FORBIDDEN; the trust_safety user gets 0 rows or permission denied on the three applicant tables

**AC12 · Appeal decision within 7 days** (manual check)

- Given an employer appeal received on day 0 for a hidden vacancy, through the contact route of the Complaints and Dispute Process page
- When the Trust & Safety Administrator decides it
- Then the decision is made on or before day 7; a decision to restore is recorded as an unhide with a statement of reasons (moderation_actions and audit rows); a decision to uphold is recorded in the moderation log of the operating procedure with its reasons and the date, and the employer is told by reply to the appeal

### Data and validation

- moderate_job(job_id, action hide or unhide, statement_of_reasons): parameter list proposed
- statement_of_reasons: required for hide and unhide, trimmed, 20 to 2,000 characters
- moderation_actions: target_type 'job', target_id (vacancy id), action (proposed values hide, unhide), statement_of_reasons not null, actor_id = caller
- jobs.moderation_state: visible, hidden, org_suspended
- audit record: actor, target, reason, time
- notification vacancy_hidden payload: job_id, title, reasons

### States and transitions

- Visible -> Hidden (Trust & Safety Administrator at aal2, statement of reasons)
- Hidden -> Visible (Trust & Safety Administrator at aal2, statement of reasons)
- Visible -> Org suspended (system, suspend_organization)
- Org suspended -> Visible (system, reinstate_organization)

### Roles and permissions

- Trust & Safety Administrator (trust_safety, aal2): may search vacancies, hide and unhide; no access to applications, notes or candidate documents
- Platform Administrator (admin): denied hide and unhide (default; whether admin may also act is stated with the admin console)
- Verification Reviewer: denied (no Phase 1 screens)
- Owner and admin of the organisation: may see the hidden state and receive the email; denied hide, unhide and direct update of moderation_state
- Member (organisation), candidate, anonymous: denied; the hidden vacancy is not public

### Objects

- moderate_job (RPC; trust_safety + aal2, audited)
- public.jobs (moderation_state)
- public.moderation_actions(target_type, target_id, action, statement_of_reasons not null, actor_id)
- audit.log via audit.record()
- public.notifications kind vacancy_hidden; pgmq; notify Edge Function; Resend; apps/web/emails template (proposed vacancy_hidden)
- public.platform_staff, private.has_platform_role, private.is_aal2
- suspend_organization, reinstate_organization (FR-F1, moderation_state org_suspended)
- apply_to_job, set_application_status, withdraw_application
- proposed: admin_search_jobs RPC for the moderation page (trust_safety + aal2; no applicant data)
- proposed: error codes CHARA_REASON_INVALID, CHARA_INVALID_STATE
- pages: app/[lang]/(admin)/admin/ job moderation (proposed admin/jobs); org/[slug]/jobs; legal/[slug] (Complaints and Dispute Process)

### Open points and assumed defaults

- P12 (open): who may suspend accounts is open; for hiding vacancies the default is Trust & Safety only, consistent with FR-F1 and role separation (NFR-S3).
- The email catalogue has no kind for unhide, so no email is sent on unhide; the employer sees the state in the UI. To be confirmed by CHARA.
- Phase 1 has no appeal form (report appeals are later phase): the appeal route is the contact route of the Complaints and Dispute Process page, and the 7-day decision is an operating procedure; an upheld appeal has no database record in Phase 1 (default), a restore is an unhide.
- Hiding is allowed for a vacancy of any status that is visible (default); a vacancy in org_suspended cannot be hidden until reinstated.
- The employer sees the reasons in the email, not in the UI (default).
- The monthly moderation statistics come from a query over moderation_actions; no Phase 1 screen is assumed.
- The two-person review control applies to suspensions, not to hiding a vacancy.
- The length limits of the statement of reasons (20 to 2,000) and the action values are assumed defaults.
