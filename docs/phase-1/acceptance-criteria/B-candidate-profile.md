# Group B: Candidate profile (CHARA Passport v1)

## FR-B1 · Profile data

> A candidate maintains: first and last name, headline, current country, occupation (ISCO-08 list), skills, languages with CEFR level, years of experience, availability (now / from date / unavailable), preferred countries, and work-authorisation countries with expiry dates.

### Acceptance criteria

**AC1 · New candidate creates the passport at onboarding** (browser test (Playwright))

- Given a confirmed candidate (profiles.account_kind 'worker', status 'active') with no worker_profiles row is on /en/onboarding after the account kind was committed
- When the candidate fills the labelled fields First name 'Amina', Last name 'Okafor', Current country 'Nigeria' and double-clicks 'Create my passport'
- Then the candidate is redirected to /en/dashboard/worker, which shows the passport checklist with '10% complete' and 'Occupation' as the next item; exactly one worker_profiles row exists; /en/passport shows 'Amina', 'Okafor' and 'Nigeria'; opening /en/onboarding again redirects to /en/dashboard/worker

**AC2 · create_worker_passport stores a private profile and audits it** (database test (pgTAP))

- Given an authenticated user with account_kind 'worker', status 'active' and no worker_profiles row
- When the user calls create_worker_passport('Amina','Okafor','NG','en')
- Then exactly one worker_profiles row exists with user_id = auth.uid(), searchable = false and occupation_id, years_experience, availability and available_from null; profiles.preferred_lang is 'en'; exactly one audit.log row exists with action 'passport.created' (proposed name), actor_id = the user, entity_type 'worker_profiles', entity_id = the user id and no name values in metadata

**AC3 · create_worker_passport refuses wrong callers and duplicates** (database test (pgTAP))

- Given (a) a user with account_kind 'company', (b) the anon role, (c) a worker whose profiles.status is 'suspended', (d) a user whose account_kind is still null, (e) a worker who already has a worker_profiles row with first_name 'Amina'
- When each calls create_worker_passport('Other','Name','DE','en')
- Then (a), (c) and (d) raise CHARA_FORBIDDEN; (b) is refused with permission denied (SQLSTATE 42501) because EXECUTE is not granted to anon; (e) raises unique_violation (23505); in all five cases no row is inserted, the existing row of (e) still has first_name 'Amina' and no audit.log row is written

**AC4 · Name, headline and years-of-experience validation** (unit test (Vitest))

- Given the shared zod schema used by the passport Server Actions
- When it parses first_name and last_name values 'Amina', "O'Brien-Smith", 'Zoë', '  Amina  ', an 80-character string, '', '   ', 'Amina1', '<b>x</b>', 'Amina\nOkafor' and an 81-character string; headline values 'Welder', a 120-character string, a 121-character string, 'Welder\nPipe fitter' and ''; years_experience values 0, 60, -1, 61, 2.5, 'ten' and ''
- Then Names are trimmed and accepted only when they are 1 to 80 characters of letters, combining marks, spaces, hyphens, apostrophes and full stops: the first five values are accepted ('  Amina  ' becomes 'Amina') and the last six are refused; headlines 'Welder' and the 120-character string are accepted, the 121-character string and the headline with a line break are refused, '' becomes null; years_experience accepts 0 and 60, refuses -1, 61, 2.5 and 'ten', and '' becomes null

**AC5 · Candidate completes each section and the values persist** (browser test (Playwright))

- Given a candidate with a worker_profiles row on /en/passport with all optional sections empty
- When the candidate types 'electrician' in the Occupation combobox, moves with ArrowDown to the option with ISCO-08 code 7411 and presses Enter; types 'wel' in Skills and selects the suggestion 'Welding'; adds language English at level B2; enters 6 years of experience; chooses availability 'From a date' with a date 30 days ahead; adds preferred country Germany; adds work authorisation Germany with an expiry date one year ahead; saves each section and reloads the page; then types 'xyzzy' in the Occupation combobox
- Then after the reload every value is shown as saved and worker_profiles.occupation_id holds the 7411 row of public.occupations; the options come from public.occupations (label and synonyms search) and show their ISCO-08 code; 'xyzzy' shows 'No matching occupation' and the saved occupation is unchanged; free text is never stored as an occupation; the completeness meter and checklist on /en/dashboard/worker reflect the new values

**AC6 · Skill tags are normalised and limited** (unit test (Vitest))

- Given the skills validator with an existing list of skills
- When the candidate adds ' Welding ', then 'welding', then a 50-character tag, a 51-character tag, an empty tag, a tag containing a control character (U+0000), and finally tries to add a 31st distinct tag to a list of 30
- Then ' Welding ' is stored as 'Welding'; 'welding' is ignored as a case-insensitive duplicate so one tag remains; the 50-character tag is accepted; the 51-character tag, the empty tag and the control-character tag are refused; the 31st tag is refused with the message 'You can add up to 30 skills'

**AC7 · Skills and languages are constrained in the database** (database test (pgTAP))

- Given a candidate with a worker_profiles row and no skills or languages, and a second candidate
- When Skills 'Welding' and then 'WELDING' are inserted for the first candidate (and 'Welding' for the second), then a 51-character skill, an empty skill, a skill with leading or trailing spaces and a skill with a control character; then up to 30 skills and a 31st; languages ('en','B2'), ('en','C1'), ('fr','B3'), ('fr','native'), ('xx','A1') and a 16th distinct valid language
- Then 'WELDING' for the same candidate is refused by the case-insensitive unique rule while 'Welding' for the second candidate is accepted; the 51-character, empty, untrimmed and control-character skills are refused; the 30th skill is accepted and the 31st is refused; ('en','B2') is stored; the second 'en' row is refused by the unique (worker_user_id, language code) rule; levels 'B3' and 'native' are refused because only A1, A2, B1, B2, C1 and C2 exist; 'xx' is refused by the foreign key to public.languages; the 16th language is refused (maximum 15)

**AC8 · Profile column rules, experience and availability** (database test (pgTAP))

- Given a candidate's worker_profiles row, with today = current_date in UTC
- When the row is updated with first_name '' and an 81-character first_name, a 121-character headline, current_country 'XX', an occupation_id that does not exist, years_experience 0, 60, -1 and 61; and availability 'from_date' with available_from null, 'now' with available_from set, 'unavailable' with available_from set, 'from_date' with available_from yesterday, today, today plus 24 months and today plus 24 months and one day; finally a row whose available_from has since passed has only its headline updated
- Then the empty and 81-character name, the 121-character headline, 'XX' (foreign key to public.countries) and the unknown occupation (foreign key to public.occupations) are refused; 0 and 60 are accepted and -1 and 61 are refused; 'from_date' without a date, 'now' or 'unavailable' with a date and yesterday are refused; today and today plus 24 months are accepted and today plus 24 months and one day is refused; the headline update on the row with a past available_from succeeds because the window is checked only when availability or available_from changes

**AC9 · Preferred countries and work authorisation** (database test (pgTAP))

- Given a candidate with a worker_profiles row
- When the candidate inserts preferred countries 'NG', 'NG' again, 'XX' and a 21st distinct country; and work authorisations ('DE', expires_on today plus 1 year), ('DE') again, ('FR', yesterday), ('FR', today), ('ES', null), ('PL', today plus 51 years) and ('de', null)
- Then the duplicate 'NG', 'XX' and the 21st preferred country are refused (unique per country, maximum 20, foreign key to public.countries); ('DE', plus 1 year) is stored; the second 'DE' is refused by the unique (worker_user_id, country code) rule; yesterday and plus 51 years are refused; ('FR', today) and ('ES', null, meaning no expiry) are accepted; the lower-case code 'de' is refused by the foreign key

**AC10 · Profile rows are owner-only and written only through allowed paths** (database test (pgTAP))

- Given Candidates A and B with filled profiles; an employer owner, admin and member of organisation O, which holds an application and an active share from A; a company user of another organisation; the anon role; users holding the platform roles admin, verification_reviewer and trust_safety (aal2)
- When each principal other than A selects, updates, deletes and inserts (with worker_user_id = A's id) in worker_profiles, worker_skills, worker_languages, worker_preferred_countries and worker_work_authorizations; and A inserts directly into worker_profiles, updates worker_profiles.user_id and searchable, and inserts a child row with worker_user_id = B's id
- Then Selects return 0 rows, updates and deletes affect 0 rows, inserts for A's id are refused and anon is refused by missing grants; A reads and changes own rows; A's direct insert into worker_profiles, the update of user_id or searchable and the insert for B's id are refused (the profile row is created only by create_worker_passport); service_role has no table grant on these tables

**AC11 · No forbidden personal attributes are stored** (database test (pgTAP))

- Given the columns of worker_profiles, worker_skills, worker_languages, worker_preferred_countries and worker_work_authorizations in information_schema
- When the forbidden-attribute test scans their names
- Then no column represents date of birth, age, nationality, gender, sex, religion, marital status, identity number, passport number or national insurance number; work authorisation exists only as country plus optional expiry date

**AC12 · Passport form labels, guidance, states and keyboard use** (browser test (Playwright))

- Given a candidate opens the Profile sections of /en/passport at 360 px width; the list requests are delayed by 2 seconds; one work authorisation whose expiry date has passed exists (inserted by the test)
- When the page loads, the candidate tabs through the form, submits First name empty, types 'wel' in Skills, and saves once with the network request aborted
- Then a skeleton shows while loading; every control has a visible label (First name, Last name, Headline, Current country, Occupation, Skills, Language, CEFR level, Years of experience, Availability, Available from, Preferred countries, Country where you may work, Expiry date); the help text under Headline tells the candidate not to enter ID numbers, date of birth, religion, health or other sensitive details; tab order follows the visual order; the First name error appears beside the field, is linked with aria-describedby and focus moves to the first invalid field; skill suggestions are selectable with ArrowDown and Enter; an empty skills list shows 'You have not added any skills yet'; the expired authorisation is labelled 'Expired'; the aborted save shows an error toast, keeps the typed values and saves nothing; axe reports 0 violations and there is no horizontal scroll

### Data and validation

- worker_profiles.user_id: primary key, equals auth.users.id, one row per candidate, set only by create_worker_passport
- worker_profiles.first_name: required, trimmed, 1 to 80 characters, letters, combining marks, spaces, hyphen, apostrophe and full stop only
- worker_profiles.last_name: required, same rule as first_name
- worker_profiles.headline: optional, 0 to 120 characters, plain text, no line breaks, empty stored as null
- worker_profiles.current_country: required, ISO 3166-1 alpha-2 upper case, must exist in public.countries
- worker_profiles.occupation_id: optional, must reference public.occupations (ISCO-08); no free-text occupation
- worker_profiles.years_experience: optional integer 0 to 60
- worker_profiles.availability: null until chosen; one of now, from_date, unavailable
- worker_profiles.available_from: date; required when availability is from_date and null otherwise; from today to today plus 24 months (UTC), checked only when availability or available_from changes
- worker_profiles.searchable: boolean not null, false in Phase 1 and cannot be set to true
- profiles.preferred_lang: 'en' (English only in Phase 1)
- worker_skills (proposed column skill): one tag per row, trimmed, 1 to 50 characters, no control characters, unique per candidate ignoring case, at most 30 per candidate
- worker_languages.language_code (proposed column name): ISO 639-1 code from public.languages, unique per candidate, at most 15 per candidate
- worker_languages.cefr_level (proposed column name): one of A1, A2, B1, B2, C1, C2
- worker_preferred_countries.country_code (proposed column name): ISO 3166-1 alpha-2 from public.countries, unique per candidate, at most 20 per candidate
- worker_work_authorizations.country_code (proposed column name): ISO 3166-1 alpha-2 from public.countries, unique per candidate
- worker_work_authorizations.expires_on (proposed column name): optional date, null means no expiry, not before today at save time, not later than today plus 50 years
- Every child table carries worker_user_id referencing worker_profiles.user_id
- No date of birth, age, nationality, gender, religion, marital status or identity number field exists anywhere in the profile

### States and transitions

- (none) -> profile created (candidate, create_worker_passport; account_kind worker, status active, no existing profile)
- null, now, from_date or unavailable -> from_date (candidate; available_from between today and today plus 24 months, UTC)
- null, now, from_date or unavailable -> now or unavailable (candidate; available_from cleared in the same save)
- searchable false -> true: not allowed for anyone in Phase 1

### Roles and permissions

- Candidate (account_kind worker, status active): create the own passport once through create_worker_passport; read, create, update and delete own skills, languages, preferred countries and work authorisations; read and update own profile columns; denied any access to another candidate's rows and denied inserting or deleting the worker_profiles row directly
- Candidate with status suspended: denied creating a passport
- Company account (account_kind company) and user without a committed account kind: denied create_worker_passport
- Employer organisation owner, admin and member: denied any direct read or write on worker_profiles and its child tables (an employer sees a candidate only through job_applications.profile_snapshot, see FR-B3)
- Platform Administrator (admin), Verification Reviewer (verification_reviewer), Trust and Safety Administrator (trust_safety): denied any read or write on worker_profiles and its child tables
- Anonymous: denied everything
- service_role: no table grants; may only execute the service RPCs (for example erase_user)

### Objects

- public.worker_profiles(user_id, first_name, last_name, headline, current_country, occupation_id, years_experience, availability, available_from, searchable)
- public.worker_skills
- public.worker_languages
- public.worker_preferred_countries
- public.worker_work_authorizations
- proposed: enum worker_availability (now, from_date, unavailable)
- proposed: enum cefr_level (A1, A2, B1, B2, C1, C2)
- proposed: triggers enforcing the list limits (30 skills, 15 languages, 20 preferred countries), the available_from window and the expiry window
- public.countries, public.languages, public.occupations (label trigram index, synonyms)
- public.profiles(account_kind, status, preferred_lang)
- RPC public.create_worker_passport(first_name, last_name, current_country, preferred_lang)
- audit.log via audit.record()
- page /[lang]/onboarding
- page /[lang]/passport (sections)
- page /[lang]/dashboard/worker (checklist)
- apps/web/lib/dal/passport.ts, apps/web/lib/actions (zod parse, then DAL)

### Open points and assumed defaults

- The SOP step 'Set preferences' mentions preferred countries and industries; FR-B1 lists only preferred countries and worker_preferred_industries is a later-phase table. Default assumed: Phase 1 stores preferred countries only.
- The SOP asks for skill suggestions but no skills taxonomy is in the reference data. Default assumed: a static suggestion list in the web app, free-text tags allowed, suggestions never derived from other candidates' data, no ESCO import.
- FR-B1 says work-authorisation countries come 'with expiry dates'. Default assumed: the expiry date is optional (null means no expiry), because a permanent right to work has none.
- Field lengths, the 30, 15 and 20 list limits, the 24-month availability window and the 50-year expiry cap are not set in the sources. They are proposed defaults and can be changed without changing the design.
- ARCHITECTURE section 4 calls worker data owner-only, while section 5.6 says members of an organisation with an active share can select it. Default assumed: owner-only table access; the employer reads the snapshot in job_applications.profile_snapshot (SOP FR-B3). To be confirmed when the policies are written.
- The column names of the four child tables (other than worker_user_id) are not in ARCHITECTURE and are proposed.

## FR-B2 · Document upload

> A candidate can upload a CV and certificates (PDF, JPG, PNG; 15 MB maximum each) to private storage, and list, rename and delete them.

### Acceptance criteria

**AC1 · Candidate uploads a CV with the metadata-first flow** (browser test (Playwright))

- Given a candidate on the Documents section of /en/passport with no documents
- When the candidate chooses type 'CV', enters title 'Amina Okafor CV 2026', selects a valid PDF of 1,258,291 bytes named 'My CV (final).pdf' and submits
- Then a worker_documents row with scan_status 'pending' exists before the file bytes are sent; the browser sends the bytes directly to Storage through a signed upload URL (no file bytes go through a Next.js request); the object is stored in bucket passport-documents under '{user_id}/{document_id}/My_CV__final_.pdf' (every character outside A-Z, a-z, 0-9, '.', '_' and '-' becomes '_'); worker_documents.file_name is 'My_CV__final_.pdf', mime 'application/pdf' and size_bytes 1258291; scan_status becomes 'skipped' once scan-document has run; the list shows the title, type 'CV', size '1.2 MB' (1 MB = 1,048,576 bytes), upload date and status 'Ready'; the submit button is disabled while the upload runs

**AC2 · Upload validation and file-name sanitising** (unit test (Vitest))

- Given the shared zod upload validator and the file-name sanitiser
- When the validator receives files of 0, 1, 15,728,640 and 15,728,641 bytes; MIME application/pdf, image/jpeg and image/png with extensions pdf, jpg, jpeg, png; image/gif, image/webp, text/html, application/zip and application/vnd.openxmlformats-officedocument.wordprocessingml.document; the name 'a.exe' with MIME application/pdf; titles of 0, 1, 120 and 121 characters after trimming; types 'cv', 'certificate' and 'passport'; and the sanitiser receives 'My CV (final).pdf', '../../etc/passwd.pdf' and a 150-character stem with extension '.pdf'
- Then only 1 and 15,728,640 bytes pass (0 is refused, 15,728,641 is refused with 'File is larger than 15 MB'); the three allowed MIME types with matching extensions pass and every other type and the extension mismatch are refused; titles of 1 and 120 characters pass and 0 and 121 are refused; types 'cv' and 'certificate' pass and 'passport' is refused; the sanitiser returns 'My_CV__final_.pdf', '.._.._etc_passwd.pdf' (no '/' remains) and a name of exactly 100 characters that keeps the '.pdf' extension; a refused upload creates no worker_documents row

**AC3 · The bucket enforces limits and metadata-first even if the web app is bypassed** (database test (pgTAP))

- Given the migrated storage configuration; candidate A with a worker_documents row d that is not deleted; candidate B
- When the test reads storage.buckets for 'passport-documents' and the policies on storage.objects; A inserts objects named 'A/d/cv.pdf', 'A/{random uuid}/cv.pdf' and, after d is marked deleted, 'A/d/cv2.pdf'; B inserts 'A/d/cv.pdf'; the anon role inserts 'A/d/cv.pdf'
- Then public is false, file_size_limit is 15728640 and allowed_mime_types is exactly application/pdf, image/jpeg and image/png; the only policies for the bucket are passport_docs_owner_select, passport_docs_owner_insert and passport_docs_owner_delete (none for anon, organisation members, platform staff or update); only A's first insert succeeds; the insert for an id with no row, the insert for a deleted row, B's insert into A's folder and the anon insert are refused

**AC4 · Metadata rules and write paths of worker_documents** (database test (pgTAP))

- Given Candidate A (worker), a company user, and the service_role
- When A inserts rows with type 'cv', 'certificate' and 'passport'; titles of 0, 1, 120 and 121 characters; size_bytes 0, 15728640 and 15728641; mime 'image/gif'; expires_on on a 'cv', on a certificate yesterday, today plus 50 years and today plus 50 years and one day; a storage_path other than '{worker_user_id}/{id}/{file_name}'; a bucket_id other than 'passport-documents'; and an insert with scan_status 'clean'; A updates title, then storage_path, scan_status, worker_user_id and deleted_at, and deletes a row directly; the company user inserts a row; service_role calls document_set_scan_status for a pending row with 'skipped', for another pending row with 'rejected' (proposed value), for the 'skipped' row again with 'rejected', for a pending row with 'bogus' and for an unknown id; A and anon call document_set_scan_status
- Then Type 'passport', the 0 and 121-character titles, size 0 and 15728641, 'image/gif', expires_on on a CV, expires_on beyond today plus 50 years, the wrong storage_path, the wrong bucket_id, the insert with scan_status 'clean' and the company user's insert are refused; the other values are accepted, a new row has scan_status 'pending', and a past expires_on is accepted for a certificate; A may update title (and expires_on) only, every other column update and the direct delete are refused; document_set_scan_status moves a pending row to 'skipped' or 'rejected', leaves the 'skipped' row unchanged when called again (webhook retry), refuses 'bogus' and raises CHARA_NOT_FOUND for the unknown id; A and anon get permission denied

**AC5 · Rejected and unfinished uploads are not usable** (browser test (Playwright))

- Given a candidate uploads 'fake.pdf' that contains plain text but is declared application/pdf (it passes the browser checks); in a second run the network is cut after the metadata row was created and before the bytes were sent
- When scan-document checks the magic bytes of the first file; the candidate opens the Documents list after the second run
- Then the first row is set to the rejecting scan status (proposed 'rejected') through document_set_scan_status; its list entry reads 'File rejected: not a valid PDF, JPG or PNG' with only a Delete action; it cannot be selected in the apply flow; document_access_grant for it raises CHARA_DOCUMENT_NOT_SCANNED; the second row stays 'pending' and reads 'Upload not finished' with only a Delete action; neither document counts toward the completeness meter

**AC6 · Document list states, expiry reminders and download** (browser test (Playwright))

- Given a candidate on the Documents section of /en/passport
- When the candidate has 0 documents; then 3 documents (a CV, a certificate expiring in 20 days and a certificate that expired yesterday); the list request is delayed; the list request fails; the candidate uses only the keyboard and selects Download on the CV
- Then with 0 documents the page shows 'You have not uploaded any documents yet' and an Upload button; the 3 documents are listed newest first in a table with header cells Title, Type, Size, Uploaded, Expires and Status, with the labels 'Expires in 20 days' and 'Expired', and /en/dashboard/worker shows a reminder for each; a skeleton shows while loading; a failed request shows an error toast and a Retry button; the file control has the visible label 'File', opens with Enter and Space, and the chosen file name and the upload result are announced through an aria-live region; Download saves 'My_CV__final_.pdf' through a 60-second link with Content-Disposition attachment (no inline preview); no email is sent for an expiring document

**AC7 · Candidate renames a document** (browser test (Playwright))

- Given a document titled 'Amina Okafor CV 2026' in the candidate's list
- When the candidate edits the title to 'CV English' and presses Enter, then tries an empty title and a 121-character title, then presses Escape during an edit
- Then after a reload the list shows 'CV English'; file_name, storage_path and the ids in every share scope are unchanged; the empty and 121-character titles are refused with a message beside the field; Escape cancels the edit and keeps the old title

**AC8 · Candidate deletes a document that is shared** (browser test (Playwright))

- Given a document d in the scope of two active shares for two applications, and a document with no share
- When the candidate selects Delete on d, reads the dialog and confirms; in a second run cancels with Escape; in a third run the delete request fails; then deletes the unshared document
- Then the dialog says d is shared with 2 applications and that deleting it ends the employers' access to all documents shared in them, with Cancel focused first; after confirming, d is gone from the list, both shares have revoked_at set and both applications remain; cancelling, pressing Escape or a failed request (error toast, document still listed) changes nothing; the unshared document is deleted without that warning

**AC9 · Deletion ends access at once and queues the object removal** (database test (pgTAP))

- Given a document d with an active share whose scope contains d.id, a second share whose scope does not, and a storage object that still exists
- When the candidate calls delete_worker_document(d.id); a member of the sharing organisation calls document_access_grant(d.id,'application_review'); the candidate calls delete_worker_document(d.id) again; another candidate and a company user call it
- Then worker_documents.deleted_at is set; only the share whose scope contains d.id gets revoked_at; exactly one pgmq job to remove the object is queued; document_access_grant raises CHARA_NOT_FOUND and writes no access-log row; the second delete by the owner and the delete by another candidate raise CHARA_NOT_FOUND, the company user's call raises CHARA_FORBIDDEN, and none of them queues a further job

**AC10 · Documents are isolated between users and roles** (database test (pgTAP))

- Given Candidate A's document row and object, candidate B, an employer member of an organisation with an active share from A, a company user, the anon role and the three platform staff roles
- When each other principal selects, updates the title of, deletes, or inserts a row with worker_user_id = A in worker_documents, and selects or deletes A's object in storage.objects
- Then Selects return 0 rows, updates and deletes affect 0 rows, inserts for A's id are refused, anon is refused, and no object of A is visible or deletable

**AC11 · Document changes are audited without personal content** (database test (pgTAP))

- Given a candidate who uploads, renames and deletes one document that is in an active share
- When the three operations complete
- Then audit.log holds rows with actions 'document.created', 'document.renamed', 'document.deleted' and 'share.revoked' (proposed names), entity_type 'worker_documents' (or 'passport_shares' for the last), the entity id, the candidate as actor and metadata that holds the document type but neither title nor file name; an attempt to update or delete those rows fails

**AC12 · Expiry labels** (unit test (Vitest))

- Given the expiry label function with today fixed at 2026-10-03 (UTC date)
- When it receives expires_on null, 2026-10-02, 2026-10-03, 2026-10-04, 2026-11-02 and 2026-11-03
- Then null gives no label, 2026-10-02 gives 'Expired', 2026-10-03 gives 'Expires today', 2026-10-04 gives 'Expires in 1 day', 2026-11-02 gives 'Expires in 30 days' and 2026-11-03 gives no label

### Data and validation

- worker_documents.type: required, one of cv, certificate (proposed enum worker_document_type)
- worker_documents.title: required, trimmed, 1 to 120 characters, duplicates allowed
- file: PDF, JPEG or PNG; MIME application/pdf, image/jpeg, image/png; extension pdf, jpg, jpeg or png; 1 to 15,728,640 bytes (15 MB)
- worker_documents.file_name: sanitised original name; every character outside A-Z, a-z, 0-9, '.', '_' and '-' replaced by '_'; at most 100 characters keeping the extension
- worker_documents.bucket_id: 'passport-documents'
- worker_documents.storage_path: '{worker_user_id}/{document_id}/{file_name}'
- worker_documents.mime and size_bytes: recorded from the validated file; mime one of the three allowed types, size_bytes 1 to 15728640
- worker_documents.scan_status: pending (default), skipped, clean or a rejecting value (proposed 'rejected'); written only by document_set_scan_status; a row that is no longer pending is not changed again
- worker_documents.expires_on: optional date, certificates only, not later than today plus 50 years; past dates allowed
- worker_documents.deleted_at: set by delete_worker_document, never cleared
- signed upload URL: issued by the Server Action with the user's session, valid 10 minutes, one path
- owner updates: title and expires_on only; no direct delete (deletion goes through delete_worker_document so shares are revoked)

### States and transitions

- (none) -> pending (candidate, metadata row inserted before any upload)
- pending -> skipped (scan-document, magic bytes valid, no scanning vendor yet)
- pending -> clean (scan-document, magic bytes valid and vendor scan passed; once a vendor exists)
- pending -> rejected (scan-document, magic bytes do not match PDF, JPEG or PNG; proposed value)
- pending, skipped, clean or rejected -> deleted (candidate, delete_worker_document; shares whose scope contains the id are revoked)

### Roles and permissions

- Candidate (worker): create, list, rename, delete and download own documents; denied access to other candidates' documents
- Company account: denied creating or reading worker documents
- Employer owner, admin, member: denied direct select, update, delete or storage access; third-party access only through document_access_grant (see FR-B3)
- Platform Administrator, Verification Reviewer, Trust and Safety Administrator: denied any read of document metadata and storage objects in Phase 1
- Anonymous: denied everything
- scan-document (service_role): may only execute document_set_scan_status
- account-ops (service_role): removes storage objects through the Storage API

### Objects

- public.worker_documents(id, worker_user_id, type, title, bucket_id, storage_path, file_name, mime, size_bytes, scan_status, expires_on, deleted_at)
- proposed: enum worker_document_type (cv, certificate)
- bucket passport-documents (private, 15728640 bytes, pdf, jpeg, png)
- storage.objects policies passport_docs_owner_select, passport_docs_owner_insert, passport_docs_owner_delete
- Edge Function scan-document (database webhook on storage.objects insert)
- service RPC public.document_set_scan_status
- proposed: RPC public.delete_worker_document(p_document_id)
- Edge Function account-ops, proposed: pgmq queue for object removal
- public.passport_shares(scope, revoked_at)
- RPC public.document_access_grant (download by the owner)
- audit.log via row trigger on worker_documents and passport_shares
- page /[lang]/passport (documents section)
- page /[lang]/dashboard/worker (expiry reminders)
- apps/web/lib/actions (upload Server Action), apps/web/lib/dal/passport.ts

### Open points and assumed defaults

- The antivirus vendor is not chosen (O4). Default assumed: the scan step records 'skipped' after the magic-byte check and documents are served download-only.
- The SOP says deleting a document revokes the active shares that reference it. Default assumed: the whole share for that application is revoked (not just the one document), and the candidate is warned in the delete dialog.
- The SOP says deletion removes the file and the metadata; ARCHITECTURE keeps worker_documents.deleted_at. Default assumed: soft delete (the row is hidden everywhere and removed at account erasure), the object removal is queued and retried through account-ops.
- A metadata row whose upload never finished stays 'pending' until the candidate deletes it. Default assumed: no automatic cleanup job in Phase 1; object orphans are prevented by the storage insert policy.
- The sources set no limit on the number of documents per candidate. Default assumed: none in Phase 1 beyond the 15 MB per file.
- The accepted document types are only CV and certificate; identity document files and verification evidence belong to a later phase.

## FR-B3 · Privacy by default

> A candidate profile and its documents are not visible to any employer except through an application the candidate submitted.

### Acceptance criteria

**AC1 · Employers and anonymous callers cannot read candidate data directly** (database test (pgTAP))

- Given Organisation O with an application and an active share (scope [d1.id]) from candidate A; users who are owner, admin and member of O; the anon role
- When each member selects from worker_profiles, worker_skills, worker_languages, worker_preferred_countries, worker_work_authorizations and worker_documents and from storage.objects of bucket passport-documents; anon makes the same selects and executes document_access_grant
- Then every query returns 0 rows for all three employer roles while A reads the same tables; anon is refused by missing grants and no row, path or URL is returned; an employer reads a candidate only through job_applications.profile_snapshot

**AC2 · No platform staff role can open a candidate document** (database test (pgTAP))

- Given Users with platform roles admin, verification_reviewer and trust_safety, each with aal2 and not a member of O, and an active share of candidate A to organisation O
- When each calls document_access_grant for a document in the share's scope and selects from worker_documents
- Then the grant raises CHARA_FORBIDDEN, no audit.document_access_log row is written and the select returns 0 rows

**AC3 · A member of the owning organisation opens a document in scope** (database test (pgTAP))

- Given Candidate A with documents d1 (in the share scope) and d2, an active share to organisation O whose scope is the array [d1.id], a granted consent, and an owner (aal2), an admin (aal2) and a member of O
- When each calls document_access_grant(d1.id, 'application_review')
- Then each call returns bucket_id, object_path and file_name of d1 and writes exactly one audit.document_access_log row with share_id, document_id d1, worker_user_id A, organization_id O and accessed_by the caller

**AC4 · An unselected document of the same type is refused** (database test (pgTAP))

- Given the share of AC3 and a second CV d2 of candidate A that was uploaded before the application but not selected
- When a member of O calls document_access_grant(d2.id, 'application_review')
- Then CHARA_FORBIDDEN is raised and no access-log row is written

**AC5 · A document of the same type uploaded after the application is refused** (database test (pgTAP))

- Given the share of AC3 and a new CV d3 of candidate A inserted after the share was created
- When a member of O calls document_access_grant(d3.id, 'application_review')
- Then CHARA_FORBIDDEN is raised and no access-log row is written

**AC6 · Members of other organisations are refused** (database test (pgTAP))

- Given Candidate A with an active share to organisation O, a member of organisation P that has no share from A, and a member of O whose organisation has no share from candidate C
- When the P member calls document_access_grant for a document of A that is in scope, and the O member calls it for a document of C
- Then both calls raise CHARA_FORBIDDEN and write no access-log row

**AC7 · Withdrawal and consent withdrawal end access immediately** (database test (pgTAP))

- Given two active shares of candidate A to organisation O, each with a document in scope
- When in the first case the candidate withdraws the application (withdraw_application sets revoked_at and inserts a 'withdrawn' consent row); in the second case only a later 'withdrawn' consent row for the same purpose is inserted; then a member of O calls document_access_grant in the same second
- Then both calls raise CHARA_FORBIDDEN and write no access-log row

**AC8 · Share expiry is set after a final state and enforced** (database test (pgTAP))

- Given private.settings share_expiry_days_after_final = 30; applications moved by set_application_status to Hired, to Not selected (rejected) and to Interview; a share with expires_at now() minus 1 second and one with expires_at now() plus 1 hour
- When the expiry values are read; the setting is changed to 7 and another application is moved to Hired; a member of O calls document_access_grant for each share
- Then the Hired and Not selected shares have expires_at = the move time plus 30 days (within 1 second) and the Interview share has expires_at null; the later Hired share has the move time plus 7 days and the earlier shares keep their value; the share with expires_at 1 second ago is refused with CHARA_FORBIDDEN and the share with expires_at in 1 hour is allowed

**AC9 · Employers see the snapshot, not later profile edits** (database test (pgTAP))

- Given Candidate A applied to a vacancy of O with headline 'Welder' and later changed the headline to 'Pipe fitter'
- When a member of O reads job_applications for that vacancy and selects from worker_profiles
- Then profile_snapshot still shows headline 'Welder' and the worker_profiles select returns 0 rows

**AC10 · Profiles are non-searchable and no listing exists in the database** (database test (pgTAP))

- Given a candidate's worker_profiles row and the catalogue of views and functions in schema public
- When the candidate updates searchable to true, and a catalogue test lists every public view and function executable by authenticated or anon that reads worker_profiles, its child tables or worker_documents
- Then the update is refused so searchable stays false; every listed object is either an owner-only security_invoker view or on an allow-list kept in the test file, and none returns another user's rows without a valid share check

**AC11 · Document links are short-lived downloads** (browser test (Playwright))

- Given an employer member opens an applicant's CV in the real flow (Server Action to document-url)
- When the link is fetched immediately, fetched again 61 seconds after it was issued, the storage object path is fetched without a token, and the public URL form for the bucket is requested
- Then the first fetch downloads the file with Content-Disposition attachment and the stored file_name; the token in the link expires 60 seconds after issue and the second fetch is refused; the fetch without a token and the public URL form are refused (HTTP 400 or 404)

**AC12 · No employer-facing candidate listing exists in Phase 1** (browser test (Playwright))

- Given the Phase 1 build
- When an anonymous visitor, a candidate and an employer member request /en/find-workers and /en/workers, and sitemap.xml is fetched
- Then both pages return the 404 page and sitemap.xml contains no candidate or passport URL

### Data and validation

- passport_shares.scope: jsonb array of document ids (uuid), never document types; each id is the candidate's own, non-deleted worker_documents row at apply time
- passport_shares.organization_id: the organisation that owns the job
- passport_shares.application_id: required in Phase 1 (no share outside an application)
- passport_shares.consent_id: a consents row with action granted and purpose 'share_passport:<organization>'
- passport_shares.expires_at: null until the application reaches Hired or Not selected, then now plus share_expiry_days_after_final; not changed afterwards when the setting changes
- passport_shares.revoked_at: set at withdrawal or when a document in scope is deleted
- private.settings share_expiry_days_after_final: integer, default 30
- document_access_grant(p_document_id uuid, p_purpose text): returns bucket_id, object_path, file_name; errors CHARA_UNAUTHENTICATED (authenticated role without a user id), CHARA_NOT_FOUND, CHARA_DOCUMENT_NOT_SCANNED, CHARA_FORBIDDEN; anon has no EXECUTE grant
- signed download link: lifetime 60 seconds, download-only

### States and transitions

- (none) -> active (apply_to_job, candidate; scope = ids of selected documents, consent recorded)
- active -> revoked (withdraw_application, candidate; or delete_worker_document for a document in scope, candidate)
- active -> expiry set (set_application_status to Hired or Not selected, employer member; expires_at = now plus share_expiry_days_after_final)
- expiry set -> expired (time passes expires_at, no actor)

### Roles and permissions

- Candidate: read own profile and documents, choose which own documents an application shares, withdraw; denied access to other candidates' data
- Employer owner, admin, member of the organisation that owns the job: open a document through document_access_grant only while the share is active, the consent is not withdrawn and the document id is in its scope (owners and admins reach applicant pages only at aal2, FR-A4); denied direct table or storage reads, unselected documents and any other organisation's candidates
- Employer members of any other organisation: denied
- Platform Administrator, Verification Reviewer, Trust and Safety Administrator: denied any profile or document access in Phase 1
- Anonymous: denied everything

### Objects

- public.worker_profiles(searchable), worker_skills, worker_languages, worker_preferred_countries, worker_work_authorizations, worker_documents
- public.passport_shares(id, worker_user_id, organization_id, application_id, scope, consent_id, expires_at, revoked_at)
- public.consents (append-only ledger)
- public.job_applications(profile_snapshot, passport_share_id)
- RPC public.document_access_grant, apply_to_job, withdraw_application, set_application_status
- audit.document_access_log
- Edge Function document-url
- storage.objects policies on passport-documents (no organisation policy)
- private.member_org_ids()
- private.settings key share_expiry_days_after_final
- pages /[lang]/find-workers and /[lang]/workers (must not exist in Phase 1)

### Open points and assumed defaults

- How long a share stays valid after Hired or Not selected is open (P13). Default assumed: 30 days, set through the setting share_expiry_days_after_final.
- Staff access to candidate documents is open (P10). Default assumed: no staff role opens documents in Phase 1; revisit with the verification phase (FR-F3).
- Shares keyed by document id instead of document type are adopted design point D18; pgTAP tests AC4 and AC5 are the named tests from the SOP review.
- While an account deletion is pending, document access is also refused (see FR-B6).
- ARCHITECTURE section 5.6 says worker_profiles and children are selectable by members of an organisation with an active share, while section 4 says owner-only and the SOP limits the employer to the snapshot. Default assumed: owner-only tables; the employer reads job_applications.profile_snapshot and opens documents only through document_access_grant.

## FR-B4 · Completeness indicator

> The profile shows a completeness percentage and suggests the next item to add.

### Acceptance criteria

**AC1 · Weighted score from the nine published items** (unit test (Vitest))

- Given the pure function computeCompleteness with these weights: names and country 10, headline 5, occupation 15, skills 15, languages 10, years of experience 10, availability 10, work authorisation 10, CV 15 (total 100)
- When it is called for a new profile (names and country only), for names, country, occupation, three skills and a usable CV, for every item complete except the CV, and for every item complete
- Then the scores are 10, 55, 85 and 100, always whole numbers between 0 and 100

**AC2 · Skills count from three tags and languages from one** (unit test (Vitest))

- Given computeCompleteness for an otherwise empty profile
- When the profile has 0, 2, 3 and 4 skills, and separately 0 and 1 languages
- Then the skills item adds 0, 0, 15 and 15 points and the languages item adds 0 and 10 points

**AC3 · Values that count as set** (unit test (Vitest))

- Given computeCompleteness for an otherwise empty profile
- When years_experience is null, 0 and 12; availability is null, 'unavailable', 'now' and 'from_date'; headline is null, '   ' and 'Welder'
- Then the experience item adds 0, 10 and 10 points; the availability item adds 0, 10, 10 and 10 points; the headline item adds 0, 0 and 5 points

**AC4 · Only a valid work authorisation counts** (unit test (Vitest))

- Given computeCompleteness with today fixed at 2026-10-03
- When the profile has no authorisation, one with expires_on 2026-10-02, one with expires_on 2026-10-03, and one with expires_on null
- Then the authorisation item adds 0, 0, 10 and 10 points

**AC5 · Only a usable CV counts** (unit test (Vitest))

- Given computeCompleteness with documents of different kinds
- When the candidate has only a certificate, only a deleted CV, only a CV with the rejecting scan status, only a CV with scan_status 'pending', only a CV with scan_status 'skipped', and only a CV with scan_status 'clean'
- Then the CV item adds 0, 0, 0, 0, 15 and 15 points (a CV counts only when it is not deleted and its scan status is clean or skipped, the same test document_access_grant applies; a certificate never counts)

**AC6 · Next suggested item order** (unit test (Vitest))

- Given computeCompleteness for profiles where items are missing
- When it is called for a new profile, then after adding occupation, then skills, then a CV, then languages, then experience, then availability, then work authorisation, then headline
- Then the suggested next item is in turn Occupation, Skills, CV, Languages, Years of experience, Availability, Work authorisation, Headline, and finally none with the text 'Profile complete'; the order is by weight descending with ties in that fixed order

**AC7 · Nudge threshold** (unit test (Vitest))

- Given the function that decides whether the nudge banner shows
- When it is called with 0, 59, 60 and 100 percent
- Then it returns true for 0 and 59 and false for 60 and 100

**AC8 · The nudge shows below 60 percent only** (browser test (Playwright))

- Given a candidate at 55 percent (names, country, occupation, three skills and a CV) and later at 60 percent after adding a headline
- When the candidate opens /en/passport and /en/dashboard/worker at each level
- Then at 55 percent both pages show the percentage, the next suggested item and a nudge banner with a link to add it; at 60 percent both pages still show the percentage and the next item but no nudge banner

**AC9 · The meter updates after a save without a reload** (browser test (Playwright))

- Given a new candidate at 10 percent on /en/passport
- When the candidate selects an occupation and saves
- Then the meter changes to 25 percent and the next suggested item changes to Skills without a page reload

**AC10 · Weights are visible and the meter is accessible** (browser test (Playwright))

- Given the completeness card on /en/passport at 360 px width
- When the candidate opens 'How is this calculated?' with the keyboard
- Then the nine items are listed with their weights, matching the constants used by computeCompleteness; the meter has role progressbar with aria-valuemin 0, aria-valuemax 100 and aria-valuenow equal to the percentage, plus the text '55% complete'; meaning does not depend on colour alone; axe reports 0 violations

**AC11 · No reminder email and no employer visibility** (browser test (Playwright))

- Given a candidate at 10 percent for the whole test run, and an employer member viewing that candidate's application
- When the candidate profile is created and left incomplete, and the employer opens the applicant detail page
- Then the mail catcher holds no completeness reminder (only the account emails of the flow), and the employer page contains no completeness percentage

### Data and validation

- completeness: integer 0 to 100, computed on read from profile and document data, not stored
- weights: names and country 10, headline 5 (not blank), occupation 15, skills 15 (at least 3 tags), languages 10 (at least 1), years of experience 10 (set, 0 counts), availability 10 (any value chosen, including unavailable), work authorisation 10 (at least one entry whose expires_on is null or not before today), CV 15 (at least one non-deleted document of type cv whose scan status is clean or skipped)
- nudge threshold: below 60 percent
- next item order: Occupation, Skills, CV, Languages, Years of experience, Availability, Work authorisation, Headline

### Roles and permissions

- Candidate: see own completeness percentage and next item
- Employer owner, admin, member: denied; the value is not shown on any employer page
- Platform Administrator, Verification Reviewer, Trust and Safety Administrator: denied; no staff screen shows it in Phase 1
- Anonymous: denied

### Objects

- proposed: apps/web/lib/passport/completeness.ts (computeCompleteness)
- public.worker_profiles, worker_skills, worker_languages, worker_work_authorizations, worker_documents (read only)
- page /[lang]/passport
- page /[lang]/dashboard/worker

### Open points and assumed defaults

- The SOP names the scored categories and the 60 percent nudge threshold but not the weights. Default assumed: the weights and thresholds in the data list, published to the candidate in the UI ('Transparent weights'); the owner may change them without changing the design.
- The SOP fixes no reminder email in Phase 1; none is sent.
- The SOP shows the next item 'while completeness is below 60 %'. Default assumed: percentage and next item are always shown; the highlighted nudge banner appears below 60 percent only.
- A CV counts only when it is usable (clean or skipped), so an unfinished or rejected upload cannot make the score misleading.
- The monthly review of the completion distribution (SOP step Measure) has no Phase 1 screen; it is an offline query by CHARA staff.

## FR-B5 · Document access log

> A candidate can view which organisation accessed which document and when.

### Acceptance criteria

**AC1 · Every successful grant writes one log row** (database test (pgTAP))

- Given a member of organisation O and an active share that contains document d of candidate A
- When the member calls document_access_grant(d.id,'application_review') three times
- Then three separate audit.document_access_log rows exist, each with share_id, document_id d, worker_user_id A, organization_id O, accessed_by the member, purpose 'application_review' and accessed_at set by the database to the current time (no deduplication)

**AC2 · Refused requests write no row and return no path** (database test (pgTAP))

- Given Calls from the anon role, for an unknown document id, for a deleted document, for a document with scan_status 'pending' or the rejecting status, for a document not in the share scope, for a candidate whose account deletion is pending, and with a null, empty and 'other' purpose
- When each calls document_access_grant
- Then the anon call is refused with permission denied (42502 class, no EXECUTE grant); the others raise CHARA_NOT_FOUND, CHARA_NOT_FOUND, CHARA_DOCUMENT_NOT_SCANNED, CHARA_FORBIDDEN, CHARA_FORBIDDEN and an error (not_null_violation for null, check_violation for '' and 'other', because Phase 1 accepts only 'application_review' and 'owner_download'); no path is returned and the row count of audit.document_access_log is unchanged

**AC3 · The candidate sees only own entries and no accessor identity** (database test (pgTAP))

- Given Log rows for candidate A (organisation O) and candidate B (organisation P)
- When a, B, a member of O, the anon role and a platform staff user select from public.v_my_document_access_log, and A and a member of O select directly from audit.document_access_log
- Then A sees only A's rows and B only B's; the O member and the staff user get 0 rows; anon is refused; the view exposes only organisation display name, document title, accessed_at and purpose (no accessed_by, no user id); the direct select returns A's rows only for A and 0 rows for the member of O

**AC4 · The log cannot be written or changed directly** (database test (pgTAP))

- Given the table audit.document_access_log
- When the roles authenticated, anon and service_role try to insert rows, and every role including postgres tries to update, delete or truncate rows
- Then Inserts are refused for the API roles (no grants; only document_access_grant inserts); updates, deletes and truncates are refused by append-only triggers that are enabled always, except through private.apply_retention()

**AC5 · Passport page lists accesses by organisation and document** (browser test (Playwright))

- Given Candidate A with 30 log entries from two organisations, on /en/passport at the Access log section
- When the page loads, the candidate selects 'Next page' and uses only the keyboard
- Then Entries are shown newest first in a table with header cells Organisation, Document, Date and time (with time zone) and Purpose; 25 entries show on page 1 and 5 on page 2; organisation shows organizations.display_name and document shows the document title; the table and the 'Next page' control are reachable by keyboard; axe reports 0 violations

**AC6 · Empty, loading and error states** (browser test (Playwright))

- Given a candidate whose documents were never opened by an organisation, a delayed request, and a failed request
- When the Access log section loads
- Then the empty state reads 'No organisation has opened your documents yet'; a skeleton shows while loading; a failed request shows an error toast and a Retry button

**AC7 · Entries for deleted documents remain readable** (browser test (Playwright))

- Given a log entry for a document that the candidate later deleted
- When the candidate opens the Access log section
- Then the entry is still listed with the organisation and time and the document is shown as 'Deleted document'

**AC8 · The candidate's own downloads are logged but not listed** (database test (pgTAP))

- Given Candidate A downloads own document through document_access_grant(d.id,'owner_download') (proposed purpose value)
- When the grant completes and A reads v_my_document_access_log
- Then a log row exists with organization_id and share_id null, accessed_by A and purpose 'owner_download', and the view does not return it

**AC9 · Retention follows the configured period** (database test (pgTAP))

- Given retention_policies entity 'document_access_log' with days 730 (24 months) and entries inserted by the test with accessed_at 729 days and 731 days ago
- When private.apply_retention() runs, then days is changed to 365 and it runs again; then a direct delete is attempted
- Then the 731-day entry is removed and the 729-day entry is kept; after the change entries older than 365 days are removed; each run writes an audit.log row; the direct delete is still refused

**AC10 · Candidate can report suspicious access** (browser test (Playwright))

- Given a candidate viewing an access-log entry
- When the candidate selects 'Report suspicious access'
- Then the browser opens the complaints and dispute process legal page (/en/legal/<slug of that document>, which returns 200); no other request that writes data is sent, because Phase 1 has no report record

**AC11 · There is no download path around the log** (database test (pgTAP))

- Given the catalogue of functions, policies and Edge Functions
- When the catalogue test lists everything that can return a storage path or signed URL for bucket passport-documents
- Then the only function is document_access_grant (executed by the document-url Edge Function with the caller's JWT); no storage.objects select policy exists for organisation members or staff; every other function that mentions bucket passport-documents is service-only

**AC12 · document-url returns no link when the grant refuses** (browser test (Playwright))

- Given a member of an organisation without a share from candidate A, and an employer member of an organisation with a valid share that does not include document d2
- When each calls the document-url Edge Function directly with their JWT for a document of A, and an unauthenticated request calls it
- Then each response is an error status without a 'url' field, no access-log row is written, and the unauthenticated request is refused with 401

### Data and validation

- audit.document_access_log.id: primary key
- audit.document_access_log.share_id: passport_shares id, null for the owner's own access
- audit.document_access_log.document_id: worker_documents id
- audit.document_access_log.worker_user_id: document owner (the view filters on it)
- audit.document_access_log.organization_id: organisation of the accessor, null for the owner's own access
- audit.document_access_log.accessed_by: user who called the grant
- audit.document_access_log.purpose: text, not null; Phase 1 values 'application_review' (employer member) and proposed 'owner_download' (document owner); any other value is refused
- audit.document_access_log.accessed_at: timestamptz default now(), database time only
- no outcome column: refused requests raise and write no row (design point D16)
- retention: retention_policies entity document_access_log, days 730 by default, configurable
- public.v_my_document_access_log (proposed columns): organisation display name, document title, accessed_at, purpose; rows with organization_id null are excluded

### Roles and permissions

- Candidate: read own access-log entries through v_my_document_access_log; denied reading others' entries and denied any write
- Employer owner, admin, member: denied reading the log; their successful document opens are what creates entries
- Platform Administrator, Verification Reviewer, Trust and Safety Administrator: denied reading entries of candidates through the API in Phase 1
- Anonymous: denied
- service_role: no direct table grant; retention runs inside private.apply_retention()

### Objects

- audit.document_access_log(id, share_id, document_id, worker_user_id, organization_id, accessed_by, purpose, accessed_at)
- public.v_my_document_access_log (security_invoker, policy worker_user_id = auth.uid())
- proposed: append-only triggers on audit.document_access_log (same pattern as audit.log)
- RPC public.document_access_grant
- Edge Function document-url
- retention_policies, private.apply_retention() (pg_cron daily)
- public.organizations(display_name), public.worker_documents(title)
- page /[lang]/passport (shares and access log)
- page /[lang]/legal/[slug] (complaints and dispute process)

### Open points and assumed defaults

- The SOP says every decision, allowed or denied, is logged with an outcome. The adopted design point D16 removes the outcome column and logs only successful grants; refusals raise and write nothing. Default assumed: D16.
- NFR-C3 lists document-access events among the audit events retained 6 years, while the SOP, ARCHITECTURE and L6 set 24 months, configurable (L6 is open). Default assumed: 24 months for document_access_log.
- The SOP lets the candidate report suspicious access to the Trust and Safety Administrator, but reports are a later-phase table. Default assumed: a link to the complaints process page, no in-app report in Phase 1.
- The candidate's own downloads are logged (the grant writes a row for every call) but hidden from the list; this is a design default, not stated in the SOP. The purpose value 'owner_download' is proposed because the sources name only 'application_review'.
- ARCHITECTURE describes the access log as written by construction but names append-only triggers only for audit.log. Default assumed: the same append-only triggers on audit.document_access_log, with the narrow audited exception for private.apply_retention().

## FR-B6 · Account closure

> A candidate can request account deletion; after a 30-day cooling-off period the personal data is erased and application records are pseudonymised.

### Acceptance criteria

**AC1 · Candidate requests deletion from settings** (browser test (Playwright))

- Given a signed-in candidate on /en/settings with no deletion pending
- When the candidate opens 'Delete account' and confirms 'Request deletion' in the dialog
- Then the page shows 'Deletion requested on <today>. Your data will be erased on <today plus 30 days>' (for a request on 2026-10-03: 'erased on 2026-11-02') with a 'Cancel deletion' button, and the mail catcher holds exactly one 'deletion_requested' email to the address on file stating the erasure date and linking to /en/settings, with no profile content, documents or notes

**AC2 · The request takes effect immediately** (database test (pgTAP))

- Given a candidate with an active share to organisation O, a document in its scope and an application
- When the candidate calls request_account_deletion(); then a member of O calls document_access_grant for that document; then the candidate calls apply_to_job for another open vacancy and withdraw_application for the first application
- Then profiles.deleted_at equals now() and status stays 'active'; the grant raises CHARA_FORBIDDEN and writes no log row; apply_to_job raises CHARA_FORBIDDEN with detail 'account_deletion_pending' (proposed) and the UI tells the candidate to cancel the deletion first; withdraw_application still succeeds; the candidate can still sign in and read own data; no sign-in ban is set

**AC3 · A repeated request changes nothing** (database test (pgTAP))

- Given a candidate whose request was made 5 days ago
- When request_account_deletion() is called again
- Then profiles.deleted_at keeps its original value, exactly one 'account.deletion_requested' audit.log row exists (from the first call, with the candidate as actor) and no second deletion_requested notification is queued

**AC4 · Only candidates can request or cancel deletion** (database test (pgTAP))

- Given the anon role, a user with account_kind 'company' (including an employer owner, admin and member), and a platform staff user whose account_kind is not 'worker'
- When each calls request_account_deletion() and cancel_account_deletion()
- Then Anon is refused with permission denied (no EXECUTE grant) and the others raise CHARA_FORBIDDEN; no state changes and no audit row is written

**AC5 · Candidate cancels during the cooling-off period** (database test (pgTAP))

- Given a candidate with a pending request made 10 days ago and an active share to O
- When the candidate calls cancel_account_deletion(), then a member of O calls document_access_grant for a document in scope, then the candidate requests deletion again
- Then profiles.deleted_at is null after the cancel, exactly one 'account.deletion_cancelled' audit row exists, no email is sent for the cancel, the grant succeeds again because the share is otherwise valid, and the new request starts a fresh 30 days

**AC6 · The 30-day boundary** (database test (pgTAP))

- Given Candidate A with deleted_at = now() minus 29 days 23 hours, candidate B with deleted_at = now() minus 30 days, and an authenticated user
- When erase_user is called for A and for B by service_role, cancel_account_deletion is called by A and by B, and the authenticated user and anon call erase_user
- Then erase_user for A raises CHARA_FORBIDDEN with detail 'cooling_off_not_ended' (proposed) and leaves all data in place, and A's cancel succeeds; erase_user for B proceeds; B's cancel (tested before erase_user) raises CHARA_FORBIDDEN with detail 'cooling_off_ended' (proposed); the authenticated user and anon are refused with permission denied

**AC7 · The daily job queues only due accounts and a legal hold pauses erasure** (database test (pgTAP))

- Given Account X requested 31 days ago, account Y requested 29 days 23 hours ago, account Z requested 31 days ago with proposed profiles.legal_hold true, and a privacy contact address in private.settings
- When the daily erasure job runs twice; erase_user is called directly for Z; then the hold on Z is cleared and the job runs again
- Then the first run queues exactly one erasure job, for X, and the second run queues nothing new; Y is not queued; Z stays 'deletion requested' with one 'account.erasure_paused' audit row and one notification (proposed kind 'erasure_paused') to the privacy contact address, none after the second run; the direct erase_user for Z raises CHARA_FORBIDDEN with detail 'legal_hold'; after the hold is cleared the next run queues Z

**AC8 · Erasure removes personal data and pseudonymises applications** (database test (pgTAP))

- Given a candidate eligible for erasure with a profile, 2 skills, 1 language, documents, a share, 2 applications (one Interview, one Applied) with cover notes and snapshots, application_events written by the candidate, and notifications
- When erase_user(user_id) runs
- Then Rows of that user in worker_profiles, worker_skills, worker_languages, worker_preferred_countries, worker_work_authorizations, worker_documents, notifications, notification_preferences and profiles are gone; passport_shares are revoked with an empty scope and carry the pseudonym; both job_applications keep job_id, status and dates but their worker_user_id is the same pseudonym (absent from auth.users and profiles), cover_note is null and profile_snapshot holds only a deleted marker; application_events written by the candidate carry the pseudonym; document_access_grant for the old documents raises CHARA_NOT_FOUND; an employer moving the Applied application to Shortlisted succeeds and writes no status_changed notification

**AC9 · Audit and ledger rows are pseudonymised and completion is recorded** (database test (pgTAP))

- Given the candidate of AC8 with audit.log rows, consents rows and audit.document_access_log rows that name the user
- When erase_user(user_id) completes
- Then those rows now carry the same pseudonym instead of the user id and no row is deleted; one 'account.erased' audit row records requested_at and completed_at without personal data; the pseudonymisation is the only change the append-only triggers allow and any other update or delete of audit.log still fails

**AC10 · Storage and sign-in are removed after erasure** (browser test (Playwright))

- Given a candidate with uploaded objects under passport-documents/{user_id}/, a request backdated by the test through SQL to more than 30 days, an open session in a second browser, and an employer applicant page for one of the candidate's applications
- When the account-ops erasure job runs
- Then Listing the prefix returns 0 objects; the auth user no longer exists; login with the old credentials fails with 'Invalid login credentials'; the second browser's next request to a protected page is redirected to /en/login (the profile lookup finds no profile even if the access token has not expired); the employer's applicant page shows 'Deleted candidate' with no name, cover note or documents; registering again with the same email creates a fresh account with no profile, documents or applications

**AC11 · Completion email is sent once and keeps no address** (browser test (Playwright))

- Given a candidate whose erasure is due
- When the erasure job runs, and runs a second time as a retry
- Then the mail catcher holds exactly one 'deletion_completed' email to the address held before the auth user was deleted; the second run sends nothing and writes no second 'account.erased' row; after sending, neither the notifications row nor the pgmq archive retains the address

**AC12 · Settings page states, labels and keyboard use** (browser test (Playwright))

- Given /en/settings at 360 px width for a candidate with no request, then with a pending request
- When the candidate opens the dialog, tabs, presses Escape, opens it again, confirms, and the request fails once
- Then the dialog explains that the profile and documents will be erased in 30 days and that applications stay for employers without the candidate's name; focus is trapped in the dialog, starts on the Cancel button and returns to 'Delete account' on Escape; the confirm button is labelled 'Request deletion' and is disabled while the request runs; the pending banner and the 'Cancel deletion' button are reachable by keyboard; a failed request shows an error toast and leaves the state unchanged; axe reports 0 violations

### Data and validation

- profiles.deleted_at (existing column): timestamptz, null when no request is pending; set to now() by request_account_deletion, cleared by cancel_account_deletion
- cooling-off: 30 days; erasure eligible when now() >= deleted_at plus 30 days; cancel allowed while now() < that moment
- proposed: profiles.legal_hold boolean not null default false; true pauses erasure
- privacy contact: address held in private.settings (proposed key privacy_contact_email; administrator-configurable value, open)
- pseudonym: an identifier that cannot be traced back to the person from stored data (proposed: a new random uuid whose mapping is discarded), identical for all rows of one user
- deleted marker: job_applications.profile_snapshot replaced by a marker, cover_note null, displayed name 'Deleted candidate'
- audit actions (proposed names): account.deletion_requested, account.deletion_cancelled, account.erasure_paused, account.erased
- emails: deletion_requested and deletion_completed, mandatory, English, no profile content; proposed kind erasure_paused to the privacy contact only

### States and transitions

- active -> deletion requested (candidate, request_account_deletion; account_kind worker)
- deletion requested -> active (candidate, cancel_account_deletion while now() < deleted_at plus 30 days)
- deletion requested -> erasure paused (daily job, cooling-off ended and legal_hold true; flag, not a new stored state)
- erasure paused -> erased (daily job, legal_hold cleared)
- deletion requested -> erased (account-ops through erase_user, cooling-off ended and no legal hold)
- erased: terminal, no transition leaves it

### Roles and permissions

- Candidate (account_kind worker): request deletion of the own account and cancel it within 30 days; denied shortening the 30 days and denied acting for another user
- Company account and employer organisation roles (owner, admin, member): denied request_account_deletion and cancel_account_deletion (employer account closure is not part of this requirement)
- Platform Administrator, Verification Reviewer, Trust and Safety Administrator: denied requesting, cancelling or skipping the cooling-off for a candidate; the Platform Administrator may set or clear legal_hold through a ticketed, audited SQL statement only
- Anonymous: denied
- service_role through account-ops: execute erase_user only after the cooling-off period and while no legal hold is set; authenticated users and anon have no EXECUTE on erase_user

### Objects

- RPC public.request_account_deletion
- proposed: RPC public.cancel_account_deletion
- service RPC erase_user
- Edge Function account-ops (storage prefix purge through the Storage API, auth.admin.deleteUser)
- pg_cron daily job and pgmq queue (proposed: daily erasure job)
- public.profiles(deleted_at, status), proposed: profiles.legal_hold
- public.worker_profiles and child tables, worker_documents, passport_shares, job_applications, application_events, consents, notifications, notification_preferences
- audit.log, audit.document_access_log
- notification kinds deletion_requested and deletion_completed via Edge Function notify, proposed kind erasure_paused
- RPC public.document_access_grant and public.apply_to_job (refuse while deleted_at is set)
- bucket passport-documents prefix {user_id}/
- private.settings (privacy contact), private.apply_retention narrow audit exception for erase_user
- proposed: page /[lang]/settings
- page /[lang]/login

### Open points and assumed defaults

- Who acts as the designated privacy contact at launch is to be confirmed by CHARA (L1). Default assumed: the contact address is a configured setting and the notification goes to that address.
- Phase 1 has no screen to set a legal hold (reports are a later phase). Default assumed: a Platform Administrator sets or clears profiles.legal_hold through a ticketed SQL statement that is audited; no console page.
- The sources do not say what happens to in-flight applications at erasure. Default assumed: they keep their status, are shown as 'Deleted candidate', cannot be opened for documents, and employer status changes send no email.
- During the cooling-off period the employer keeps the already stored application record and snapshot but document access is refused and the candidate cannot apply; the sources say only that the profile is hidden immediately.
- ARCHITECTURE lists profiles.deleted_at without saying what sets it. Default assumed: it is the deletion request time, so no new request column is added; policies must not hide the profile from its owner while it is set.
- A suspended candidate may still request deletion (default assumed; the suspension record is kept pseudonymised).
- ARCHITECTURE names audit, billing and application rows for pseudonymisation; consents and document-access-log rows also carry the user id and are pseudonymised here (default assumed).
- The SOP step Report (monthly count of requests and completion times) has no Phase 1 screen; it is an offline query by CHARA staff.
- A data-access export (request_data_export) is a separate function and is not part of this requirement.
