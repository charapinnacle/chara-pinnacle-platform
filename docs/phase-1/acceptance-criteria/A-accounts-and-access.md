# Group A: Accounts and access

## FR-A1 · Candidate registration

> A candidate can register with email and password (minimum 12 characters, checked against known breached passwords) and must confirm the email address before first login.

### Acceptance criteria

**AC1 · Candidate registers and receives a confirmation email** (browser test (Playwright))

- Given an anonymous visitor on /en/signup, with current published versions of terms_of_service, privacy_policy, worker_terms and age_18_plus
- When they choose 'I'm a worker', enter a new email and a 14-character password, tick the three document boxes and the 'I am 18 or older' box, and submit
- Then the 'Check your email' page (verify-email) is shown and no auth cookie is set. auth.users has one row for the email with email_confirmed_at null. public.profiles has one row with intended_account_kind 'worker', account_kind null, status 'active', preferred_lang 'en' and the four submitted entries in pending_consents. public.consents has zero rows for the user. One confirmation email to that address is in the mail catcher within 60 seconds and contains an /auth/confirm link and no password.

**AC2 · Sign-up input validation rules** (unit test (Vitest))

- Given the sign-up zod schema used by the Server Action
- When it parses passwords of 0, 11, 12, 72 and 73 ASCII characters; the email '  Ana@Example.COM '; an email without '@'; emails of 254 and 255 characters; and a submission with no account kind, with kind 'admin' and with kind 'worker'
- Then the 0, 11 and 73-character passwords are rejected; 12 and 72 pass. The email is trimmed and lowercased to 'ana@example.com'. The email without '@' and the 255-character email are rejected; the 254-character email passes. A missing kind and kind 'admin' are rejected; 'worker' and 'company' pass. Each rejection is a field-level message naming the field, and the password is never echoed back in the returned state.

**AC3 · Breached password is refused** (manual check)

- Given the hosted project with breached-password protection switched on (ARCHITECTURE section 15.2 step 3; the local stack does not provide the check)
- When a visitor submits sign-up with the password 'password1234' (12 characters, present in public breach lists)
- Then Sign-up is refused with the message 'This password has appeared in a data breach. Choose another one.', no auth.users row and no email is created, and the same visitor succeeds with a random 16-character password. The result is recorded in the pull request as a release-checklist item.

**AC4 · Profile row created by trigger from sign-up metadata** (database test (pgTAP))

- Given a row inserted into auth.users with raw_user_meta_data holding intended_account_kind 'worker' and pending_consents with the submitted document versions and the age attestation
- When private.handle_new_user() fires
- Then exactly one public.profiles row exists with id equal to the user id, intended_account_kind 'worker', the submitted pending_consents, account_kind null, status 'active' and preferred_lang 'en'. public.consents has zero rows for the user. public.profiles has no column named email or password. An insert whose metadata has intended_account_kind 'admin', any other value than 'worker' or 'company', or no such key fails and leaves no auth.users row and no profiles row.

**AC5 · Duplicate email does not reveal or alter the existing account** (browser test (Playwright))

- Given a confirmed candidate account for ana@example.test with a known password
- When another visitor submits sign-up as 'I'm an employer' with 'ANA@example.test' and a different password
- Then the same 'Check your email' page and HTTP status as for a new address are returned. auth.users still has one row for the address and the profile is unchanged (intended_account_kind and account_kind keep their values). No session or auth cookie is created and no email is sent to the address. The original password still logs in and the new one does not.

**AC6 · Login before confirmation is refused** (browser test (Playwright))

- Given a registered candidate who has not clicked the confirmation link
- When they log in with the correct email and password, and then with a wrong password
- Then with the correct password no session or cookie is issued and the page shows 'Confirm your email address first' with a form to request a new confirmation link. With the wrong password the generic message of FR-A3 is shown, so the unconfirmed state is revealed only to someone who knows the password.

**AC7 · Confirmation activates the account and commits kind and consents** (browser test (Playwright))

- Given an unconfirmed worker account and its confirmation link, clicked 1 hour after it was sent
- When /auth/confirm verifies the token (verifyOtp with token_hash)
- Then email_confirmed_at is set, the user is signed in and redirected to /en/onboarding. Onboarding commits account_kind 'worker' once through set_account_kind, which writes four 'granted' consents rows (terms_of_service, privacy_policy, worker_terms, age_18_plus) with the versions shown at sign-up, clears pending_consents, and writes audit.log rows 'account_kind_set' and 'consents_accepted' for the user. The profile-creation step is then shown.

**AC8 · Confirmation link lifetime is 24 hours and the link is single use** (browser test (Playwright))

- Given three confirmation links for unconfirmed accounts: one opened 23 hours 59 minutes after sending, one opened 24 hours 1 minute after sending (confirmation_sent_at moved back in the test), and one that was already used successfully
- When each is opened (the used one in the same and in another browser)
- Then the first confirms the account. The second and the third show the same text 'This link is invalid or has expired.' with a form to request a new link, because Auth does not tell an expired link from a used one. Neither creates a session, changes email_confirmed_at, or writes a second profile, consents or audit row.

**AC9 · Confirmation redirect stays on the site** (browser test (Playwright))

- Given a valid confirmation link for an unconfirmed account
- When it is opened with next set to 'https://evil.example', and for another account with next set to '//evil.example'
- Then the next value is ignored in both cases and the browser lands on /en/onboarding on the CHARA origin. No redirect to another origin occurs.

**AC10 · Resend is uniform and throttled** (browser test (Playwright))

- Given the invalid-link page with a resend form, one unconfirmed account (ana@example.test), one confirmed account and one unknown address; the minimum interval between emails to one address set to 60 seconds
- When the form is submitted for each address, and then again for the unconfirmed address 30 seconds later
- Then all three first submissions show the identical text 'If an account with this email is waiting for confirmation, a new link has been sent.' Only the unconfirmed address receives an email, and its older link stops working. The second request for the same address within 60 seconds sends no further email and shows the same text.

**AC11 · Sign-up attempts are rate limited** (browser test (Playwright))

- Given the Auth limit of 30 sign-up and sign-in requests per 5 minutes per IP address (config.toml sign_in_sign_ups = 30), the email-sent limit raised above 31 in the test stack, and a run isolated from other tests because the limit is per IP address
- When one client submits 31 sign-up requests with different emails inside 5 minutes
- Then the first 30 succeed. The 31st is refused with HTTP 429 and the message 'Too many attempts. Try again in a few minutes.', and no auth.users row or email is created for it.

**AC12 · Sign-up form states, labels and keyboard use** (browser test (Playwright))

- Given /en/signup at widths 360 px and 1280 px
- When a keyboard-only user fills and submits the form, once empty and once with the network blocked
- Then the account-kind choice is the first control, a labelled radio group ('I'm a worker', 'I'm an employer') operable with arrow keys and with no pre-selected value. Email has a visible label and autocomplete 'email'; password has autocomplete 'new-password'. Enter submits. An invalid submit moves focus to an error summary (role 'alert') whose links jump to each invalid field. While pending the button shows 'Creating account...' and is disabled, so a double click sends one request. With the network blocked an error toast appears, the email stays filled and the password is cleared. axe reports zero violations.

### Data and validation

- email: required, trimmed, lowercased, valid address, maximum 254 characters, unique case-insensitively in auth.users; stored only in auth.users, never in public tables or logs
- password: required, 12 to 72 characters (72 is the Auth limit), not present in breached-password lists; never stored outside Auth, never logged
- intended_account_kind: required, 'worker' for a candidate in this requirement; stored in profiles.intended_account_kind; account_kind stays null until committed (FR-A6)
- consent boxes terms_of_service, privacy_policy, worker_terms: each required and unticked by default; the version shown is the current published version at display time; stored in profiles.pending_consents as a list of {purpose, version} until the kind is committed (FR-A8)
- age attestation: required for candidates; stored as an age_18_plus entry of pending_consents (FR-A9)
- preferred_lang: 'en' in Phase 1
- confirmation link: single use, valid 24 hours from sending, superseded by a newer link

### States and transitions

- Not registered -> Unconfirmed (anonymous visitor, valid sign-up)
- Unconfirmed -> Unconfirmed (anonymous visitor, resend request; the earlier link becomes invalid)
- Unconfirmed -> Active (user, confirmation link used within 24 hours)
- Active, kind not committed -> Active, kind committed (system, onboarding runs set_account_kind; see FR-A6)
- Confirmation link: Issued -> Used (user, first use within 24 hours)
- Confirmation link: Issued -> Expired (system, after 24 hours)
- Confirmation link: Issued -> Superseded (system, a newer link is requested)

### Roles and permissions

- Anonymous visitor: may sign up and request a new confirmation link; may not read any profile
- Unconfirmed user: denied login and any session
- Authenticated user: may read only their own profiles row; denied update of intended_account_kind and pending_consents (no column grant)

### Objects

- pages: /[lang]/signup, /[lang]/verify-email, /[lang]/onboarding, route handlers app/auth/confirm and app/auth/callback
- auth.users (email, email_confirmed_at, confirmation_sent_at, raw_user_meta_data)
- public.profiles (id, intended_account_kind, account_kind, pending_consents, status, preferred_lang)
- private.handle_new_user() trigger on auth.users
- RPCs set_account_kind, accept_consents (run at onboarding)
- public.legal_documents, public.consents, audit.log
- config.toml: [auth] minimum_password_length = 12, [auth.email] enable_confirmations = true, [auth.rate_limit] sign_in_sign_ups = 30; Auth SMTP through Resend
- proposed: [auth.email] otp_expiry for the 24-hour confirmation lifetime (see notes)
- proposed: [auth.email] max_frequency = 60s for the resend throttle
- proposed: [auth.rate_limit] email_sent raised in the test config only

### Open points and assumed defaults

- Documents recorded at sign-up (L9, open): Terms of Service and Privacy Policy for everyone, Worker Terms for candidates. Default assumed.
- Legal texts are DRAFT placeholders until approved (W7); the Resend sending domain is open (W1), so delivery to a real mailbox cannot be verified until it exists; tests use the local mail catcher.
- The breached-password check is a hosted-project Auth setting; AC3 is therefore a manual release check.
- Auth cannot tell an expired link from a used one, so both show one message (AC8).
- The 72-character password maximum is the Auth limit, not a CHARA decision.
- Implementation point: Auth has one email-link lifetime setting shared by confirmation and recovery links, but this SOP needs 24 hours and the FR-A3 SOP needs 1 hour for reset. The mechanism is chosen in unit U08; the criteria of both requirements hold either way.
- The SOP state 'pending confirmation' is read as: email unconfirmed in auth.users and account_kind null in profiles (profiles.status has only active and suspended).

## FR-A2 · Employer registration

> An employer can register and create the organisation in the same flow; the registering user becomes the organisation owner. A unique legal-entity identifier (company registration number, VAT number or another unique legal-entity identifier) is recorded for the organisation, at the latest before checkout, so that one free trial is granted per legal entity (to be confirmed by CHARA: which identifier is mandatory per country and how it is validated).

### Acceptance criteria

**AC1 · Employer registers and creates the organisation** (browser test (Playwright))

- Given an anonymous visitor on /en/signup, with current published versions of terms_of_service, privacy_policy and employer_terms
- When they choose 'I'm an employer', enter a work email and a 14-character password, tick terms_of_service, privacy_policy and employer_terms (no age box is visible), submit, click the confirmation link, and on /en/onboarding enter legal name 'Acme Bau GmbH', display name 'Acme Bau', country DE, an industry from the list (ISIC division 41), website https://acme-bau.example and identifier 'DE123456789' of kind vat_number
- Then profiles.account_kind is 'company'. consents holds granted rows for terms_of_service, privacy_policy and employer_terms and no age_18_plus row. One organizations row exists (type 'employer', slug 'acme-bau', status 'active', based_in_country 'DE', the chosen industry_code) and one organization_members row (role 'owner', accepted_at set, invited_by null) for the user. The browser lands on /en/mfa.

**AC2 · Organisation and owner membership are created atomically, with no subscription** (database test (pgTAP))

- Given a confirmed company user with committed account_kind and a test trigger on organization_members that raises an exception
- When create_organization is called with valid input, then the test trigger is dropped and the same call is repeated
- Then the first call fails and leaves zero rows in organizations, organization_members and audit.log from that call. The second call leaves exactly one organizations row (type 'employer', status 'active'), one owner membership row and one audit.log row with action 'organization_created', actor_id equal to the caller, entity_type 'organization', entity_id equal to the organisation id and metadata containing slug, type, duplicate_legal_name and legal_entity_trial_used but no identifier value. billing.subscriptions has zero rows for the organisation, private.org_plan_code returns 'free_employer' and no trial is running.

**AC3 · Company detail validation** (unit test (Vitest))

- Given the create-organization zod schema
- When it parses legal name of '', 1, 2, 200 and 201 characters and of spaces only; display name empty and of 201 characters; country 'DE', 'de', 'D' and 'DEU'; website 'https://acme-bau.example', 'javascript:alert(1)', 'ftp://x.example', an https URL of 2048 characters, one of 2049 characters and an empty value; and a submitted type 'recruitment_company'
- Then Legal name is trimmed and accepted for 2 to 200 characters only. An empty display name defaults to the legal name; 201 characters are rejected. Country is uppercased and accepted when it is exactly two letters ('DE' and 'de' pass; 'D' and 'DEU' fail); that it exists in countries is checked by the database (AC9). Website is optional (empty becomes null) and accepted only for http or https URLs with a host up to 2048 characters. The type is always 'employer' whatever is submitted. Each rejection is a field-level message naming the field.

**AC4 · Slug is generated, unique and URL-safe** (database test (pgTAP))

- Given an organization with slug 'acme-bau' exists
- When Organisations are created with display names 'Acme Bau!', 'Acme Bau', 'Müller & Söhne', '###' and a 200-character name, and the 200-character name is created a second time
- Then the slugs are 'acme-bau-2', 'acme-bau-3', 'muller-sohne', 'org-' plus the first 8 characters of the organisation id, and a 60-character slug; the second 200-character name gets a different slug of at most 60 characters including its numeric suffix. Every slug is lowercase ASCII letters, digits and single hyphens, without leading or trailing hyphen. A direct insert of a duplicate slug (any letter case) fails with unique violation 23505.

**AC5 · Duplicate legal name warns but does not block** (database test (pgTAP))

- Given an organization with legal name 'Acme Bau GmbH' exists
- When a second company user creates an organisation with legal name 'ACME   Bau GmbH', and a third creates one named 'Acme Bau AG'
- Then both organisations are created. For the second the RPC result has duplicate_legal_name true (names are compared ignoring letter case and repeated spaces) and contains no id, slug or other detail of the other organisation, and the audit metadata records duplicate_legal_name true. For the third the value is false.

**AC6 · Legal-entity identifier is normalised and validated** (database test (pgTAP))

- Given a company user creating an organisation
- When they enter identifier 'DE 123.456-789' with kind 'vat_number'; 'ab/12' with kind 'registration_number'; 'x1', 33 characters, and 'DE123456789' with kind 'passport'; and, separately, leave the identifier empty
- Then the stored identifier is 'DE123456789' and 'AB12' (uppercase, spaces, dots, hyphens and slashes removed, 4 to 32 characters after normalisation). 'x1', the 33-character value and the kind 'passport' raise CHARA_INVALID_INPUT and create no organisation. An empty identifier stores null and the organisation is still created. The kind must be registration_number, vat_number or other whenever an identifier is given.

**AC7 · Identifier is required before checkout and can be set later by the owner only** (database test (pgTAP))

- Given an organisation X with null identifier and its owner at aal2, an admin, a member, an owner at aal1 and the owner of another organisation
- When billing_checkout_start is called for X; the owner at aal2 calls set_legal_entity_identifier('DE 123 456 789', 'vat_number'); the others call it; and after a billing.customers or billing.subscriptions row exists for X the owner calls it with a different value
- Then the checkout call raises CHARA_FORBIDDEN with detail 'legal_entity_identifier_required'. The owner at aal2 stores 'DE123456789' and one audit row 'legal_entity_identifier_set' is written. The admin, the member and the other organisation's owner get CHARA_FORBIDDEN and the owner at aal1 gets CHARA_FORBIDDEN with detail 'aal2_required'. After the lock the call raises CHARA_FORBIDDEN with detail 'legal_entity_identifier_locked' and the value is unchanged.

**AC8 · A legal entity that already had a trial is flagged and gets no second trial** (database test (pgTAP))

- Given Organization A has identifier 'DE123456789' and a billing.subscriptions row with trial_ends_at set (any status, including canceled); organization A2 has identifier 'FR999999999' and no trial
- When Organization B is created with identifier 'de 123 456 789' and organization B2 with identifier 'fr 999 999 999', and each owner at aal2, with the Subscription and Billing Terms accepted, calls billing_checkout_start
- Then B and B2 are created (never blocked). The audit metadata of B records legal_entity_trial_used true and that of B2 false; the RPC result of create_organization contains neither the flag nor any detail of A. The checkout parameters returned for B carry trial_days 0 (no trial), those for B2 carry plans.trial_days (30). An organisation with a null identifier never matches another.

**AC9 · Wrong caller, wrong type or unknown reference data is refused** (database test (pgTAP))

- Given a worker user, a company user whose account_kind is still null, a suspended company user, an anonymous caller, and a valid company user
- When each of the first four calls create_organization with valid input, and the valid user calls it with type 'recruitment_company', with type 'staffing_company', with an unknown based_in_country and with an unknown industry_code
- Then the worker, null-kind and suspended callers get CHARA_FORBIDDEN. The anonymous caller is refused at the EXECUTE grant (42501). The two other types raise CHARA_FORBIDDEN with detail 'organization_type_not_available'. The unknown country and industry fail with foreign-key violation 23503. No organizations, organization_members or audit.log row is written in any case.

**AC10 · Direct writes are closed and other tenants cannot see the organisation** (database test (pgTAP))

- Given Company users U1 (owner of organisation A), U2 (owner of organisation B) and U3 (no membership), and an anonymous caller
- When U1 runs INSERT on organizations and on organization_members as authenticated; U2 and U3 select organization_members and organization_invitations of A and run UPDATE on A; the anonymous caller selects organization_members
- Then the direct INSERTs are refused (no table grant). U2 and U3 get zero rows from the selects and the UPDATE changes zero rows. The anonymous caller gets zero rows or 42501. No organisation, membership or audit row changes.

**AC11 · Owner is sent to two-step setup, then reaches the guided dashboard** (browser test (Playwright))

- Given an owner who has just created the organisation and has no enrolled factor
- When they are redirected, open the employer dashboard, then enrol and verify a TOTP code
- Then the redirect lands on /en/mfa. The dashboard (/en/dashboard/employer) is reachable at aal1 and shows an empty state with the guided next steps: set up two-step verification, start the free trial, post the first vacancy, invite a team member. After the code is verified the owner returns to the dashboard and the first step is marked done.

**AC12 · Organisation form states, labels and keyboard use** (browser test (Playwright))

- Given the organisation step of /en/onboarding at 360 px and 1280 px
- When a keyboard-only user completes it with a legal name that duplicates an existing one, double-clicks Submit once, and once submits with the RPC failing
- Then Fields are labelled 'Legal company name', 'Display name (optional)', 'Country', 'Industry', 'Website (optional)' and 'Company registration number or VAT number (optional until you start your trial)'. Country and industry are searchable comboboxes operable with arrow keys and Enter. Invalid fields are announced in an error summary. The button is disabled while pending and the double click creates exactly one organization. The notice 'An organisation with a similar name already exists on CHARA.' is shown after creation. On RPC failure a toast appears and the typed values stay. axe reports zero violations.

### Data and validation

- legal_name: required, trimmed, 2 to 200 characters
- display_name: optional, 1 to 200 characters, defaults to legal_name
- based_in_country: required, ISO 3166-1 alpha-2, must exist in public.countries
- industry_code: required, must exist in public.industries (ISIC Rev.4)
- website: optional, http or https URL with a host, at most 2048 characters
- legal_entity_identifier: optional at creation, required before checkout; normalised to uppercase letters and digits, 4 to 32 characters; kind one of registration_number, vat_number, other; not editable once a billing customer or subscription exists
- type: always 'employer' in Phase 1
- slug: generated, citext, unique, at most 60 characters, never user-supplied
- status: 'active' at creation
- owner membership: role 'owner', accepted_at set at creation, invited_by null

### States and transitions

- No organisation -> Active (company user, create_organization)
- Identifier unset -> Identifier set (owner at aal2, before checkout)
- Identifier set -> Identifier locked (system, first billing customer or subscription row)

### Roles and permissions

- Company user with committed account_kind: may create an organisation and becomes its owner
- Candidate (worker): denied create_organization
- User with null account_kind, suspended user, anonymous caller: denied
- Employer owner at aal2: may set the legal-entity identifier until it is locked; may read the organisation
- Employer owner at aal1, admin and member: denied changing the identifier
- Owner or member of another organisation: denied reading or changing this organisation's members and invitations
- Platform Administrator (admin): may view organisations (FR-F1); may not create them here

### Objects

- pages: /[lang]/signup, /[lang]/onboarding, /[lang]/mfa, /[lang]/dashboard/employer, /[lang]/org/[slug]
- RPC create_organization (existing parameters type, legal_name, display_name, based_in_country, website; extended with proposed parameters industry_code, legal_entity_identifier, legal_entity_identifier_kind)
- tables organizations (legal_name, display_name, slug, based_in_country, industry_code, website, status), organization_members, audit.log, countries, industries, profiles
- billing.subscriptions, billing.customers, billing.plans, private.org_plan_code(), RPC billing_checkout_start
- proposed: organizations.legal_entity_identifier, organizations.legal_entity_identifier_kind, RPC set_legal_entity_identifier, private.legal_entity_trial_used()
- proposed: trial_days field in the result of billing_checkout_start
- proposed: extension unaccent for slug generation
- proposed: error code CHARA_INVALID_INPUT

### Open points and assumed defaults

- C14 (open): which identifier is mandatory per country and how it is validated. Default: any one identifier of the three kinds, format check and normalisation only, trial refusal by matching normalised value; no external register lookup.
- C15 (open, owner confirmation): card at checkout when the trial starts, not at registration. Default: checkout; registration collects no payment details.
- C11 (open): contents of free_employer. Default: active_jobs 0, no features, past applicants read-only; restrictions apply once entitlements_enforced is true.
- The identifier is stored on organizations and copied to billing.customers (registration_number or vat_id) at checkout, where trial eligibility is decided (D4). 'Had a trial' means a billing.subscriptions row of any organisation with the same normalised identifier has trial_ends_at set.
- The trial flag is kept in the audit metadata and evaluated at checkout; it is not returned to the browser, so a user cannot probe whether another company has used a trial.
- Duplicate identifiers are not blocked (the SOP flags them only); a match without a trial changes nothing.

## FR-A3 · Login, logout and recovery

> Users can log in, log out and reset a forgotten password by email. Access tokens expire after 30 minutes; sessions are refreshed transparently for up to 7 days.

### Acceptance criteria

**AC1 · Login issues a 30-minute token and 7-day cookies** (browser test (Playwright))

- Given a confirmed candidate and a confirmed company user, each with committed account kind and the correct password
- When each submits /en/login
- Then the candidate lands on /en/dashboard/worker and the company user on /en/dashboard/employer. The auth cookies are set with SameSite=Lax, Path=/ and Max-Age=604800, and Secure when the site URL is https; they stay readable by the browser client (ARCHITECTURE section 6.2). The decoded access token has exp minus iat equal to 1800 seconds.

**AC2 · Session is refreshed transparently and ends 7 days after login** (browser test (Playwright))

- Given a test stack with jwt_expiry 5 seconds and three users with expired access tokens and valid refresh tokens, whose auth.sessions.created_at is 1 minute, 6 days 23 hours and 7 days 1 minute old (session timebox 168 hours)
- When each requests /en/org/acme-bau/members
- Then for the first two the request returns 200 with a new access-token cookie set by the proxy, no redirect and no interruption. For the third the refresh is refused, the auth cookies are cleared and the browser is redirected to /en/login with next set to /en/org/acme-bau/members.

**AC3 · Suspended account cannot log in or keep a session** (browser test (Playwright))

- Given a user whose profiles.status is 'suspended' with the sign-in ban set (FR-F1), and another suspended user who already has a session
- When the first logs in with the correct password and with a wrong password; the second requests a protected page
- Then with the correct password no session is created and the page says the account is suspended and refers to the email with the reasons; with a wrong password the generic message of AC4 is shown. The second user's request is refused by the data access layer with the suspended-account page and no private data.

**AC4 · Failed login never reveals whether the email exists** (browser test (Playwright))

- Given one registered confirmed email and one unknown email
- When each is submitted with a wrong password
- Then both responses have the same HTTP status and the same message 'Email or password is incorrect.', with no other difference in page text or form state. No session or cookie is created.

**AC5 · Login attempts are rate limited** (browser test (Playwright))

- Given the Auth limit of 30 sign-in and sign-up requests per 5 minutes per IP address, in a run isolated from other tests
- When one client submits 31 login attempts in 5 minutes, the last with correct credentials
- Then the 31st is refused with HTTP 429 and 'Too many attempts. Try again in a few minutes.' even though the credentials are correct, and the message does not mention the account.

**AC6 · Logout revokes the session on the server** (browser test (Playwright))

- Given the same user logged in in browser A and browser B
- When they click 'Log out' in browser A (sign-out of this session only)
- Then a's auth cookies are removed (Set-Cookie with Max-Age=0 for each), A's row in auth.sessions is deleted, a refresh request with A's old refresh token to Auth fails, and A is redirected to /en/login. Protected pages in A return a redirect and are served with Cache-Control no-store, so the back button shows no private content. Browser B stays signed in.

**AC7 · Reset request answer is uniform, throttled, and the email goes only to real accounts** (browser test (Playwright))

- Given a confirmed account, an unconfirmed account and an unknown address
- When /en/forgot-password is submitted for each, and again for the confirmed address 30 seconds later
- Then all submissions show the identical text 'If an account exists for this email, we have sent a reset link.' with the same status. Only the confirmed account receives one recovery email, within 60 seconds, containing a single-use link to /auth/confirm and no password; the unknown and unconfirmed addresses receive no recovery email. The repeat request within 60 seconds sends no second email.

**AC8 · Reset link lasts 1 hour and works once** (browser test (Playwright))

- Given a reset link opened 59 minutes after sending, one opened 61 minutes after sending, one already used, and one older link when a newer one has been requested
- When each is opened
- Then the 59-minute link opens the new-password page. The other three show 'This link has expired or was already used' with a link back to /en/forgot-password, and no new-password page is shown.

**AC9 · Reset applies the password policy and ends other sessions** (browser test (Playwright))

- Given a user with a verified TOTP factor who is logged in on browser A and resets the password in browser B through a valid link
- When they submit a new password of 11 characters, then one of 14 characters
- Then the 11-character password is refused with a field error and nothing changes. The 14-character password is saved. Browser B continues signed in at aal1 (not aal2). Every other session of the user is revoked: browser A's refresh token fails and A is redirected to login at its next request after the access token expires (at most 30 minutes). The old password no longer works and the new one does.

**AC10 · Password change sends a confirmation email and is audited** (browser test (Playwright))

- Given a completed password reset
- When the mail catcher and audit.log are read
- Then a 'password changed' email reached the account address within 60 seconds and contains no password and no reset link. audit.log has one row with action 'password_changed', actor_id the user, entity_type 'user' and entity_id the user id, and no password or token material in its metadata.

**AC11 · Repeated login failures are audited above the threshold** (database test (pgTAP))

- Given an existing account and the password-verification-attempt hook
- When four, then a fifth failed password check for the account occur within 15 minutes, then a sixth in the same window; later, after 15 minutes without a row, five more failures occur within 15 minutes
- Then no row exists after four failures. After the fifth one audit.log row exists with action 'login_failures_threshold', actor_id the user and metadata failures 5 and window_minutes 15. The sixth failure adds no second row. A successful login does not delete the record. The five later failures write a second row. Failures for an unknown email write no row.

**AC12 · Login form states, safe redirect and keyboard use** (browser test (Playwright))

- Given /en/login at 360 px and 1280 px
- When a keyboard-only user logs in with next set to /en/org/acme-bau/members, and again with next set to https://evil.example and to //evil.example, and once with the network blocked
- Then Fields are labelled 'Email' and 'Password' with autocomplete 'username' and 'current-password', Enter submits, and the button shows a pending state. The relative next path is honoured; each external next is ignored and the user lands on their own dashboard. Errors appear in a role 'alert' summary that takes focus. With the network blocked an error toast appears. axe reports zero violations.

### Data and validation

- login email: required, trimmed, lowercased, valid address, maximum 254 characters
- login password: required, not length-validated on login
- new password (reset): required, 12 to 72 characters, not in breached-password lists
- reset link: single use, valid 1 hour, superseded by a newer request
- next: optional, accepted only as a relative path beginning with a single '/' (lib/safe-next.ts)
- access token lifetime 1800 seconds; session maximum 7 days (timebox 168 hours); cookie Max-Age 604800
- failed-login audit threshold: 5 failures per account in 15 minutes, one audit row per window

### States and transitions

- No session -> Active (user, correct credentials, confirmed email, status active)
- Active -> Refreshed (system, proxy, access token near or past expiry, session younger than 7 days)
- Active -> Revoked (user logout, password reset elsewhere, suspension, removal from organisation, role change by account-ops)
- Active -> Expired (system, 7 days after login)
- Reset link: Issued -> Used (user, first use within 1 hour)
- Reset link: Issued -> Expired (system, after 1 hour)
- Reset link: Issued -> Superseded (system, a newer link is requested)

### Roles and permissions

- Anonymous visitor: may log in and request a reset; no information about accounts is returned
- Any confirmed active user: may log in, log out and reset their own password
- Suspended user: login refused through the sign-in ban (FR-F1)
- Unconfirmed user: login refused (FR-A1)
- service_role: signs users out globally only through account-ops

### Objects

- pages: /[lang]/login, /[lang]/forgot-password, proposed /[lang]/reset-password, route handlers app/auth/confirm and app/auth/callback
- proxy.ts updateSession (getClaims), lib/supabase/proxy.ts, lib/safe-next.ts, lib/dal/session.ts
- auth.users, auth.sessions, auth.refresh_tokens
- config.toml: [auth] jwt_expiry = 1800, [auth.rate_limit] sign_in_sign_ups = 30, [auth.email] secure_password_change = true; refresh-token rotation and reuse detection on
- proposed: [auth.sessions] timebox = 168h; cookie option maxAge 604800 in lib/supabase/server.ts and lib/supabase/proxy.ts
- proposed: private.hook_password_verification_attempt (Auth hook) and a failure-counter table in schema private, writing audit.log through audit.record()
- proposed: trigger on auth.users writing audit.log action 'password_changed' through audit.record()
- audit.log; Auth email templates through Resend SMTP (recovery, password changed)
- proposed: error code CHARA_RATE_LIMITED (UI message for the Auth 429)

### Open points and assumed defaults

- Departure from the SOP wording: the SOP says cookies are HTTP-only; ARCHITECTURE section 6.2 keeps the @supabase/ssr cookies readable by the browser client (Realtime) under the strict nonce CSP. ARCHITECTURE wins; the criteria follow it.
- Implementation point: reset links last 1 hour while confirmation links last 24 hours, but Auth has one shared email-link lifetime setting (see FR-A1 notes). The mechanism is chosen in unit U08.
- The SOP gives no value for 'login failures above threshold'. Default assumed: 5 failures per account in 15 minutes. No account lockout is built; rate limits are the control.
- The SOP says the reset email is sent 'regardless of whether the account exists'; this is read as the answer shown to the visitor being identical, not as an email to unknown addresses.
- The SOP logs 'all resets'; a trigger on auth.users logs every password change, which includes every reset.
- To confirm in U08: availability of the Auth password-verification-attempt hook on the chosen Supabase tier (O2: Pro); if it is not available the failure counter needs another feed and AC11 is rewritten.
- AC2 needs a test stack with a short jwt_expiry; the production value 1800 is asserted in AC1.

## FR-A4 · Two-step verification

> Organisation owners and administrators and all platform staff must enrol TOTP two-step verification before accessing billing, team, applicant or administration pages.

### Acceptance criteria

**AC1 · Owner enrols a TOTP factor** (browser test (Playwright))

- Given a newly created owner at aal1 with no factor
- When they open /en/mfa and enter the current 6-digit code generated from the shown secret
- Then the page shows a QR code image with alt text and the manual key as selectable text. After a valid code auth.mfa_factors has one factor with status 'verified', the session token carries aal 'aal2', and the user is sent to the requested next page or the dashboard.

**AC2 · Wrong or malformed code is refused** (browser test (Playwright))

- Given the enrolment or challenge form
- When the user enters '000000' (wrong), '12345' and '12a456'
- Then '000000' shows 'That code is incorrect or has expired. Try again.', keeps focus in the field and leaves the factor unverified and the session at aal1. '12345' and '12a456' are rejected in the browser before any request. The input has inputmode 'numeric' and autocomplete 'one-time-code'.

**AC3 · Owners and administrators are held at the MFA page for protected pages; members and candidates are not** (browser test (Playwright))

- Given an owner, an admin, a member just promoted to admin, a plain member and a candidate, each at aal1
- When each opens /en/org/acme-bau/members, /en/org/acme-bau/billing, the applicant list, an applicant detail page, the vacancy list and the dashboard (candidate: dashboard and applications)
- Then Owner, admin and promoted member are redirected from members, billing and applicant pages to /en/mfa with the requested page as next: to enrolment if no verified factor exists, to the code challenge if one exists; after a valid code they return to the page. The promoted member is redirected on the next request without logging in again. The plain member opens the applicant list and the candidate opens their pages without any redirect to /en/mfa, and the MFA page stays optional for the candidate. Vacancy pages and dashboards are not gated for anyone.

**AC4 · Platform staff must be at aal2 for every administration page** (browser test (Playwright))

- Given a user with an active platform_staff row (each of admin, verification_reviewer, trust_safety in turn) at aal1, and a user whose row has revoked_at set
- When they open /en/admin and a sub page
- Then Active staff are redirected to /en/mfa with next set. The revoked user is treated as non-staff and gets the forbidden page without an MFA prompt.

**AC5 · Database enforces aal2 where decided, and only there** (database test (pgTAP))

- Given an owner session with claims aal1, then the same with aal2
- When the user selects from organization_invitations, from public.platform_staff (as admin) and from the billing views; calls invite_member, change_member_role, remove_member, transfer_ownership and accept_ownership_transfer; calls create_organization and accept_invitation; and reads their own organization_members row and organizations row
- Then at aal1 the invitation, platform_staff and billing selects return zero rows and the five member-management RPCs raise CHARA_FORBIDDEN with detail 'aal2_required'. At aal1 create_organization, accept_invitation and reading the own membership and organization still work, so a new owner can reach onboarding and enrolment. At aal2 all of these succeed for a permitted role.

**AC6 · Backup factor, no recovery codes, abandoned enrolment** (browser test (Playwright))

- Given an enrolled owner at aal2 and a second user who started enrolment and left without entering a code
- When the owner enrols a second TOTP factor named 'Backup phone', verifies it, logs in in a fresh browser using the backup code, then tries a third factor and a second factor with the same name; the second user opens /en/mfa again
- Then two verified factors exist and the login reaches aal2 with either factor's code. The third enrolment is refused with 'You can register at most two authenticator devices.' and the duplicate name with a field error. No recovery codes are shown or issued anywhere. The second user's abandoned factor is replaced and does not count toward the limit of two.

**AC7 · Session level follows the login, not the account** (browser test (Playwright))

- Given an enrolled owner with the shortened-token test stack
- When they log in with the password, then verify a code, then wait for a token refresh, then log out and log in again
- Then the token is aal1 after the password and aal2 after the code, stays aal2 across the refresh, and is aal1 again after the new login until a code is entered. A protected page at aal1 redirects to the challenge page, not to enrolment.

**AC8 · reset_mfa succeeds only for an administrator at aal2** (database test (pgTAP))

- Given a Platform Administrator at aal2 and another user who lost their device
- When the administrator calls reset_mfa(user_id, 'Identity checked by video call, ticket 4711')
- Then one audit.log row has action 'mfa_reset', actor the administrator, entity the target user and the reason. One account-ops job is queued in pgmq for the target. One mandatory mfa_reset notification is queued for the target. No factor is deleted inside the database call itself.

**AC9 · reset_mfa refusals** (database test (pgTAP))

- Given Callers: a trust_safety user at aal2, a verification_reviewer at aal2, a user with a revoked admin row, an employer owner, an admin at aal1, an admin targeting themselves, an admin with a reason of 9 characters, of 501 characters and empty, an admin with an unknown user id, and an anonymous caller
- When each calls reset_mfa
- Then the trust_safety, verification_reviewer, revoked-admin, employer-owner, aal1 and self-target callers get CHARA_FORBIDDEN (the aal1 case with detail 'aal2_required'). The three bad reasons and the unknown user id get CHARA_INVALID_INPUT. The anonymous caller is refused at EXECUTE. No audit row, job or notification is written in any case.

**AC10 · Reset removes factors and signs the user out** (browser test (Playwright))

- Given a queued reset job for a user with two verified factors, logged in on two devices
- When account-ops runs it, and runs it a second time
- Then within 2 minutes of the reset both TOTP factors are deleted through the Auth admin API, both sessions are revoked and the user has received the mfa_reset email. The second run succeeds without error and changes nothing. At the next login the user is sent to enrolment on the first protected page and can enrol again.

**AC11 · Enrolment status function returns a boolean to permitted callers only** (database test (pgTAP))

- Given an organisation with an owner, an admin without a factor and a member, a staff list with one enrolled and one non-enrolled staff user, and callers: the owner at aal2 and at aal1, the member, a user of another organisation, an admin at aal2 for the staff list, a trust_safety user, and an anonymous caller
- When each calls list_organization_members(org) or list_platform_staff()
- Then the owner at aal2 gets the member rows with mfa_enrolled true or false for owner and admin rows and null for the member row; the administrator at aal2 gets mfa_enrolled for each staff row. The column is boolean and no factor id, secret or factor name is returned. The owner at aal1 gets CHARA_FORBIDDEN with detail 'aal2_required'; the member, the other organisation's user and the trust_safety user get no status data; the anonymous caller is refused at EXECUTE.

**AC12 · Enrolment status is shown in team and staff lists** (browser test (Playwright))

- Given the team page for an owner at aal2 and the staff page for a Platform Administrator at aal2, with the data of AC11
- When both pages load
- Then Owners, admins and staff rows show 'Enrolled' or 'Not enrolled'; the member row shows 'Not required'. A skeleton shows while loading and a toast on failure.

### Data and validation

- totp code: exactly 6 digits
- factor friendly name: 1 to 32 characters, unique per user, default 'Authenticator' for the first factor and 'Backup' for the second
- verified factors per user: at most 2 (primary and backup)
- recovery codes: none are issued
- reset_mfa reason: required, trimmed, 10 to 500 characters
- reset_mfa target: an existing user id other than the caller

### States and transitions

- No factor -> Unverified factor (user, starts enrolment)
- Unverified factor -> Verified factor (user, valid 6-digit code)
- Unverified factor -> Deleted (system, the user starts a new enrolment)
- Verified factor -> Deleted (Platform Administrator through reset_mfa and account-ops, aal2, reason, never on oneself)
- Session aal1 -> aal2 (user, valid code from a verified factor)
- Session aal2 -> Ended (logout, 7-day limit, or global sign-out by account-ops)

### Roles and permissions

- Employer owner and admin: must be at aal2 for billing, team and applicant pages
- Employer member: not required to enrol; may use applicant pages at aal1
- Candidate (worker): enrolment optional
- Platform Administrator (admin), Verification Reviewer, Trust & Safety Administrator: must be at aal2 for every administration page
- Platform Administrator at aal2: may call reset_mfa for any other user
- Trust & Safety Administrator and Verification Reviewer: denied reset_mfa
- Anonymous visitor: denied everything on this page
- service_role: deletes factors only through the account-ops job queued by reset_mfa

### Objects

- page /[lang]/mfa; DAL requireAal2() in lib/dal/session.ts; private.is_aal2()
- Supabase Auth MFA API and auth.mfa_factors; config.toml [auth.mfa.totp] enroll_enabled and verify_enabled; proposed [auth.mfa] max_enrolled_factors = 2
- restrictive policy organization_invitations_requires_mfa; proposed restrictive policies on public.platform_staff and on the billing views
- RPCs invite_member, change_member_role, remove_member, transfer_ownership, reset_mfa(user_id, reason); proposed accept_ownership_transfer
- Edge Function account-ops; pgmq queue for account-ops jobs; notifications kind mfa_reset; audit.log
- proposed: RPCs list_organization_members(org) and list_platform_staff() returning mfa_enrolled as boolean only
- proposed: error code CHARA_INVALID_INPUT

### Open points and assumed defaults

- D8 (adopted): database aal2 gates cover invitations, platform_staff, member-management RPCs and billing reads only; applicant pages for owners and admins are protected by the page guard (requireAal2), not by a database policy.
- D17 (adopted): no recovery codes; one backup TOTP factor; lost device reset by a Platform Administrator after an identity check. The reason length of 10 to 500 characters and the 2-minute execution time are team defaults; D17 says only that the reason is mandatory.
- P7 (open): members and workers are not required to enrol. Default assumed.
- O6 (open): staff names. With a single named Platform Administrator nobody can reset that person's factors (self-reset is refused); default assumed: at least two named administrators before go-live, otherwise a ticketed database action is the fallback.
- The Auth limit of enrolled factors may count unverified factors, which is why an abandoned enrolment is removed when the user starts again (AC6).

## FR-A5 · Team membership

> An owner or administrator can invite members by email (single-use link, 7-day expiry), change roles (owner, admin, member), remove members and transfer ownership. Exactly one owner exists at all times. The number of team members is limited by the plan (initially 1 / 5 / 15 for Basic / Professional / Enterprise; the Enterprise value is adjustable per organisation; administrator-editable) when limit enforcement is switched on; reaching the limit shows an upgrade prompt (to be confirmed by CHARA: whether the Basic limit of 1 counts the owner, so that Basic cannot invite members).

### Acceptance criteria

**AC1 · Invitation is created with a hashed, expiring token; re-inviting replaces it** (database test (pgTAP))

- Given an owner or an admin at aal2 of an organisation on employer_professional (members limit 5) with 2 accepted members and entitlements_enforced true
- When they call invite_member(org, 'Bea@Example.com', 'member'), and later invite the same email to the same organisation again with role 'admin'
- Then one organization_invitations row exists with email 'bea@example.com', role 'member', accepted_at null, invited_by the caller, expires_at equal to now plus 7 days (within 5 seconds) and token_hash equal to the 64-character lowercase hex SHA-256 of the returned token. The token (32 random bytes, 43-character base64url) is returned once and is stored in clear in neither organization_invitations nor audit.log. One audit.log row 'member_invited' records actor, organisation, invitation id and role. After the second call the first token is refused by accept_invitation with CHARA_INVITATION_INVALID, exactly one unexpired pending invitation exists for the organisation and email (role 'admin', expiring 7 days after its own creation), it counts once toward the member limit, two 'member_invited' rows exist, and invitations for the same email in another organisation are untouched.

**AC2 · Invitation refusals** (database test (pgTAP))

- Given Callers: a plain member, an owner at aal1, the owner of another organisation, an owner of a suspended organisation, an anonymous caller, and an owner at aal2 of an organisation that has created 20 invitations in the last hour
- When each calls invite_member; the owner at aal2 also calls it with role 'owner', role 'superuser', the email 'not-an-email', the email of an existing member in other letter case, and then (with a fresh organisation) makes a 21st invitation within one hour
- Then the member, aal1 owner, other-organisation owner and suspended-organisation owner get CHARA_FORBIDDEN (the aal1 case with detail 'aal2_required'); the anonymous caller is refused at EXECUTE. Roles 'owner' and 'superuser' and the invalid email give CHARA_INVALID_INPUT, the existing member gives CHARA_CONFLICT, the 21st invitation gives CHARA_RATE_LIMITED. No invitation row or audit entry is written in any case.

**AC3 · Member limit by plan** (database test (pgTAP))

- Given entitlements_enforced true; members limit 1 (Basic), 5 (Professional), 15 (Enterprise); the count is accepted members including the owner plus unexpired pending invitations
- When Owners invite: Basic with only the owner; Professional with 4 members and 1 pending; Professional with 3 members and 1 pending; Professional with 4 members and 1 expired pending; Enterprise with 14 members and with 15 members; an organisation that never had a subscription; and, with entitlements_enforced false, a lapsed organisation on free_employer (its subscription canceled) and an organisation that never had a subscription
- Then Refused with CHARA_LIMIT_REACHED and detail 'members': Basic with the owner only, Professional with a count of 5, Enterprise with 15, the never-subscribed organisation (flag true) and the lapsed organisation (flag false). Allowed: Professional with a count of 4 (3 members plus 1 pending, and 4 members plus 1 expired), Enterprise with 14, and the never-subscribed organisation with the flag false.

**AC4 · Accepting an invitation creates one active membership** (database test (pgTAP))

- Given a pending invitation for 'bea@example.com' and a signed-in company user at aal1 whose confirmed email is that address in any letter case
- When they call accept_invitation(token), and then call it again with the same token
- Then in one transaction an organization_members row is inserted with the invited role, accepted_at set and invited_by the inviter, and the invitation's accepted_at is set. An audit row 'invitation_accepted' is written. The second call raises CHARA_INVITATION_INVALID and there is still one membership row. The user can now read the organisation through RLS and keeps access to any other organisation they belong to.

**AC5 · Accept refusals** (database test (pgTAP))

- Given Invitations: one 7 days and 1 second old, one for another email, one valid invitation addressed to a candidate's own email, and an unknown token; callers: the matching company user, a candidate (worker), a company user with null account_kind, an anonymous caller; and a direct insert of an organization_members row for a worker made as the table owner
- When accept_invitation is called in each case
- Then the expired, wrong-email and unknown-token cases all raise the same CHARA_INVITATION_INVALID with no hint which. The candidate gets CHARA_FORBIDDEN with detail 'workers_cannot_join_organizations' and the invitation stays pending. The null-kind user gets CHARA_FORBIDDEN. The anonymous call is refused at EXECUTE. The direct worker insert is rejected by the membership trigger. No membership row is created in any case.

**AC6 · Changing roles and removing members** (database test (pgTAP))

- Given one organisation with owner O, admin A, another admin B, member M and a user X of another organisation; callers at aal2 unless stated
- When O makes M 'admin'; A makes B 'member'; O and A try role 'owner'; they try to change O's role and X's role; M calls change_member_role and remove_member; A removes the former member B; O and A try remove_member on O, on X and on an unknown user
- Then the two valid role changes succeed, each with an audit row 'member_role_changed' holding from and to. Role 'owner' gives CHARA_INVALID_INPUT, a change of O gives CHARA_FORBIDDEN with detail 'use_transfer_ownership', X and the plain member give CHARA_FORBIDDEN. The valid removal deletes the membership row, writes an audit row 'member_removed' and queues one account-ops job for the removed user. Removing O gives CHARA_FORBIDDEN with detail 'cannot_remove_owner', removing X gives CHARA_FORBIDDEN, the unknown user gives CHARA_INVALID_INPUT. The organisation still has exactly one owner.

**AC7 · Exactly one owner at all times** (database test (pgTAP))

- Given an organisation created by create_organization
- When a second 'owner' row is inserted, the owner row is deleted or demoted by direct SQL, and a transaction that leaves the organisation with no owner is committed
- Then the second owner insert fails with unique violation 23505. The delete and the demotion fail with a trigger error unless done inside transfer_ownership or accept_ownership_transfer. At commit a constraint trigger finds exactly one owner for the organisation and rejects any other result.

**AC8 · Ownership transfer needs both people to confirm** (database test (pgTAP))

- Given an owner at aal2, an accepted admin at aal2 and an accepted plain member at aal1 in the same organisation
- When the owner calls transfer_ownership(org, admin_user), then the admin calls accept_ownership_transfer(org); further cases: the member as designated user, an admin starting a transfer, a transfer to oneself, to a user outside the organisation, a transfer not accepted within 7 days, a transfer cancelled by the owner, and a second pending transfer
- Then after the first call a pending transfer exists, no role has changed and audit row 'ownership_transfer_requested' exists. After the admin's confirmation, in one transaction the admin becomes 'owner' and the former owner becomes 'admin'; audit row 'ownership_transferred' holds from and to; the owner count is 1 before and after. The member's confirmation at aal1 gets CHARA_FORBIDDEN with detail 'aal2_required' and changes nothing. The admin as starter, the self, outside, expired and cancelled cases are refused with CHARA_FORBIDDEN or CHARA_INVALID_INPUT and change no role, and a second pending transfer replaces the first. No email is sent.

**AC9 · Removing a member ends access at once** (browser test (Playwright))

- Given an owner or admin at aal2, and a member who has the organisation open in another browser and also belongs to a second organisation
- When the owner removes the member and the member reloads a page of the first organisation
- Then the member's very next request to the first organisation returns the forbidden page, before any session job has run. The account-ops job then signs the member out globally within 2 minutes. Vacancies the member created stay in place and the second organisation is unaffected after the member signs in again.

**AC10 · Invitation flow from link to membership** (browser test (Playwright))

- Given an owner on Professional, an invitee without an account, and a candidate
- When the owner invites 'bea@example.test' as 'member' and copies the link from the dialog; the invitee opens it, registers as an employer with the locked email, confirms and accepts; the candidate opens the same kind of link
- Then the dialog shows the link once with the role and an 'Expires on' date; after a reload only 'Pending, expires on <date>' is shown. The invitee registers as a company user without being asked to create an organisation, joins the organisation and lands on /en/org/[slug]. The candidate sees 'This invitation can only be accepted by an employer account. Use a different email address.' From unit U37 on, one member_invitation email with the link and the organisation name is also queued and delivered, notifications.payload and audit.log hold no token, and no email is sent for a refused invitation.

**AC11 · Team page states, upgrade prompt, privacy and keyboard use** (browser test (Playwright))

- Given the team page /en/org/[slug]/members at 360 px and 1280 px for an owner at aal2, and for a plain member
- When the page loads, shows only the owner, shows a Basic organisation with the limit reached, shows an expired invitation, and a keyboard-only user opens and submits the invite dialog
- Then a skeleton shows while loading. With only the owner an empty state says 'You are the only member' with an 'Invite member' button. With the limit reached the dialog says 'Your plan allows 1 team member. Upgrade to invite more.' with a 'View plans' link to billing, and the submit is disabled. An expired invitation shows 'Expired' with a 'Resend' action that issues a new invitation. The dialog is labelled, traps focus, closes with Escape and returns focus. Errors appear as a toast. The plain member sees names and roles but no email addresses and no invite or role controls. axe reports zero violations.

**AC12 · Concurrent invitations cannot exceed the limit** (browser test (Playwright))

- Given an owner and an admin at aal2 of a Professional organisation with a count of 4 of 5, each in their own browser, entitlements_enforced true
- When both submit the invite dialog for different emails at the same moment
- Then exactly one invitation is created and the count is 5. The other request shows the upgrade prompt for CHARA_LIMIT_REACHED and writes no row or audit entry.

### Data and validation

- invitee email: required, trimmed, lowercased, valid address, at most 254 characters (citext)
- invitation role: 'admin' or 'member'; 'owner' is only reachable through transfer_ownership
- invitation token: 32 random bytes shown once, stored only as SHA-256 hash; single use; expires 7 days after creation
- member role: 'owner', 'admin' or 'member'; exactly one owner per organisation
- team-member limit: plan_limits key 'members', seeded 1, 5 and 15 for Basic, Professional and Enterprise; counts accepted members including the owner plus unexpired pending invitations
- ownership transfer: target must be an accepted admin or member of the same organisation; valid 7 days; one pending per organisation; started by the owner only
- invitations per organisation: at most 20 per hour

### States and transitions

- Invitation: Pending -> Accepted (invitee, matching company account, within 7 days)
- Invitation: Pending -> Expired (system, 7 days after creation)
- Invitation: Pending -> Superseded (owner or admin, re-invites the same email)
- Member: not a member -> Active (invitee accepts)
- Member role: member <-> admin (owner or admin at aal2)
- Member: Active -> Removed (owner or admin at aal2; the owner cannot be removed)
- Ownership: owner -> admin and admin or member -> owner (owner starts, designated user confirms)
- Ownership transfer: Pending -> Completed (designated user) / Cancelled (owner) / Expired (system, 7 days) / Replaced (owner, new transfer)

### Roles and permissions

- Employer owner at aal2: may invite, change roles, remove members, start and cancel an ownership transfer
- Employer admin at aal2: may invite, change roles between admin and member, remove members other than the owner; may not touch the owner or start a transfer
- Employer member: may read the list of names and roles; denied invitations, role changes, removals and transfers
- Owner or admin at aal1: denied all of the above
- Candidate (worker) and user with null account_kind: denied accepting invitations and denied membership
- Owner or member of another organisation: denied reading or changing this organisation's team and invitations
- Anonymous caller: denied every RPC
- Platform staff: no write path to memberships in Phase 1

### Objects

- pages: /[lang]/org/[slug]/members, proposed /[lang]/invitations/[token], /[lang]/onboarding
- tables organizations, organization_members(organization_id, user_id, role, invited_by, accepted_at), organization_invitations(organization_id, email, role, token_hash, expires_at, accepted_at)
- RPCs invite_member, accept_invitation, change_member_role, remove_member, transfer_ownership; proposed: accept_ownership_transfer, cancel_ownership_transfer, list_organization_members(org)
- proposed: organization_invitations.invited_by; table organization_ownership_transfers(organization_id, from_user_id, to_user_id, created_at, expires_at, accepted_at, cancelled_at)
- partial unique index for one owner; membership trigger refusing workers; constraint trigger for the owner count; private.check_rate_limit
- billing.plan_limits key 'members', private.assert_within_limit, private.org_limit, private.settings key entitlements_enforced, private.free_plan_restricted
- Edge Function account-ops, pgmq queue for account-ops jobs; notifications kind member_invitation (from U37); audit.log
- proposed: error codes CHARA_INVITATION_INVALID, CHARA_CONFLICT, CHARA_RATE_LIMITED, CHARA_INVALID_INPUT

### Open points and assumed defaults

- C12 (open): whether the Basic limit of 1 counts the owner. Default assumed: it counts, so Basic cannot invite members and inviting needs Professional (or a rule for active trials); not enforced until entitlements_enforced is switched on (C11).
- D10 (adopted, owner confirmation wanted): until notify exists the RPC returns the token once and the UI shows a copyable link; the invitation email is added in unit U37. ARCHITECTURE says notify archives queue messages, so U37 must keep the token out of any archived message or notifications row; the mechanism is chosen there.
- D14 (adopted): change_member_role is part of the organisations migration.
- Enterprise limits adjustable per organisation use organization_limit_overrides, which is a later-phase table; Phase 1 tests use the plan row values 15 and below, and editing limits is a reviewed migration (P9).
- Team defaults not in the sources: 20 invitations per organisation per hour, counting unexpired pending invitations toward the limit, 7-day validity of an ownership transfer, no email for a transfer, emails visible to owner and admin only. invite_member must lock the organisation row so concurrent calls cannot pass the limit (AC12).
- There is no separate revoke action; re-inviting the same email replaces the earlier link.

## FR-A6 · Account kind

> A user account is either a candidate or a company user, chosen once at sign-up, committed after email confirmation and not changeable afterwards.

### Acceptance criteria

**AC1 · Sign-up asks for the account kind first and explains it is final** (browser test (Playwright))

- Given /en/signup
- When the page loads, the visitor chooses 'I'm a worker', ticks the worker document boxes and the age box, then chooses 'I'm an employer', and submits without choosing a kind in a fresh load
- Then the kind choice is required and has no pre-selected value. The text 'This choice cannot be changed later. To use CHARA as both worker and employer, register a second account with a different email address.' is visible before submit. After switching to employer the worker boxes and the age box are gone and cleared, and the submitted data contains no worker_terms or age_18_plus entry. Submitting without a kind shows 'Choose worker or employer' and creates no account.

**AC2 · Intended kind is stored but the account kind stays empty until commit** (database test (pgTAP))

- Given a sign-up with kind 'company'
- When the profile row is read after sign-up and again after email confirmation but before set_account_kind, and create_organization is called in that state
- Then intended_account_kind is 'company' and account_kind is null in both reads, private.account_kind() returns null, and create_organization raises CHARA_FORBIDDEN.

**AC3 · set_account_kind commits the kind once, with consents, audited** (database test (pgTAP))

- Given a user with a confirmed email, intended_account_kind 'worker' and valid pending_consents for terms_of_service, privacy_policy, worker_terms and age_18_plus at current versions
- When set_account_kind() is called (it takes no kind argument), then called again; and separately for users with an unconfirmed email, with null intended_account_kind, with status 'suspended', and an anonymous caller
- Then account_kind becomes 'worker', four consents rows are written in the same transaction, pending_consents is cleared, and one audit.log row 'account_kind_set' with metadata kind 'worker' and one 'consents_accepted' row exist. The repeat call returns without error and writes nothing. The unconfirmed and suspended users get CHARA_FORBIDDEN, the null-intended user gets CHARA_INVALID_INPUT, the anonymous caller is refused at EXECUTE; account_kind stays null and nothing is written. If accept_consents fails, the kind commit is rolled back.

**AC4 · Simultaneous commits write one audit row and one set of consents** (browser test (Playwright))

- Given a confirmed user with intended kind and valid pending_consents, with /en/onboarding open in two tabs
- When both tabs trigger the commit at the same moment
- Then exactly one 'account_kind_set' audit row and one set of consents rows exist, and both tabs end on the same next page without an error toast.

**AC5 · The kind cannot be changed afterwards** (database test (pgTAP))

- Given a user whose account_kind is 'worker', and a user whose account_kind is null with intended_account_kind 'worker'
- When the first runs UPDATE profiles SET account_kind = 'company', account_kind = null and a change of intended_account_kind as authenticated, then as the table owner and as service_role; the table owner sets account_kind of the second user to 'company'
- Then the authenticated and service_role updates are refused because no column grant exists. The table-owner updates are refused by the immutability trigger, which allows only the change from null to the stored intended_account_kind. set_account_kind leaves 'worker' unchanged. account_kind stays 'worker' for the first user and null for the second.

**AC6 · Onboarding routes by kind and areas stay separate** (browser test (Playwright))

- Given a committed worker, a committed company user without a pending invitation, a committed company user with a valid invitation for their email, and a user with null kind
- When each opens /en/onboarding, and the worker opens /en/org/acme-bau, the company user opens /en/passport, and the null-kind user opens /en/dashboard/worker and /en/dashboard/employer
- Then the worker goes to profile creation. The company user goes to organisation creation, and the invited company user is offered 'Accept invitation' as well. The worker is refused /en/org/acme-bau and the company user is refused /en/passport (both land on their own dashboard with a forbidden notice). The null-kind user is redirected to /en/onboarding from both dashboards.

**AC7 · Database rules keep workers out of company functions and the reverse** (database test (pgTAP))

- Given a worker, a company user and a user with null account_kind
- When the worker inserts an organization_members row, calls billing_checkout_start and create_organization; the company user calls create_worker_passport and inserts into worker_profiles; the null-kind user calls all five
- Then every call is refused (trigger error or CHARA_FORBIDDEN, or an RLS violation for the worker_profiles insert) and no row is written. No billing customer or subscription row exists for the worker.

**AC8 · Onboarding page states the kind and is accessible** (browser test (Playwright))

- Given /en/onboarding at 360 px for a committed company user and for a worker
- When the page loads and is used by keyboard
- Then it shows 'Your account type is Employer' (or 'Worker') and 'This cannot be changed later.' in text. While set_account_kind runs a loading state shows, and on error a toast appears and the page can be retried. Controls are labelled, focus order follows the page, and axe reports zero violations.

### Data and validation

- intended_account_kind: 'worker' or 'company', required at sign-up, stored once
- account_kind: null until set_account_kind, then 'worker' or 'company' and never changed
- commit precondition: email confirmed, intended_account_kind not null, profile status active, caller is the account owner
- consents and age attestation: written by accept_consents inside the same transaction (FR-A8, FR-A9)

### States and transitions

- Unset (null) -> worker (system, set_account_kind, intended kind worker, after email confirmation)
- Unset (null) -> company (system, set_account_kind, intended kind company, after email confirmation)
- worker -> any other value: never allowed
- company -> any other value: never allowed

### Roles and permissions

- Authenticated user with confirmed email: may call set_account_kind once for their own account
- Anonymous visitor: denied
- Any user, any staff role, service_role: denied changing account_kind afterwards
- Candidate (worker): denied organization membership, checkout and create_organization
- Company user: denied create_worker_passport and worker_profiles writes

### Objects

- RPC set_account_kind, RPC accept_consents
- public.profiles (account_kind, intended_account_kind, pending_consents, status); immutability trigger on profiles; private.account_kind()
- organization_members worker-refusal trigger; RPCs billing_checkout_start, create_organization, create_worker_passport; table worker_profiles
- page /[lang]/onboarding, /[lang]/signup, /[lang]/dashboard/worker, /[lang]/dashboard/employer; audit.log
- proposed: error code CHARA_INVALID_INPUT

### Open points and assumed defaults

- P5 (open): one account kind per person. Default assumed: yes; the kind is set once and is immutable; a person who needs both uses two accounts with different emails.
- D9 (adopted): sign-up stores the intended kind; set_account_kind commits it after email confirmation together with the consents.
- The onboarding page commits the kind itself once the user is confirmed (and, if a legal document was superseded, after the user accepts it, FR-A8 AC5); there is no extra confirm button. Default assumed.

## FR-A7 · Platform staff roles

> The platform roles Platform Administrator, Verification Reviewer and Trust & Safety Administrator have technically separated permissions and are held by named accounts; there is no shared administrator account. Only a Platform Administrator with two-step verification can grant or revoke a role; every grant and revocation is audited and the affected user's sessions are ended. Further staff are added without redevelopment. The Verification Reviewer role has no screens in Phase 1.

### Acceptance criteria

**AC1 · A Platform Administrator grants staff roles** (database test (pgTAP))

- Given a Platform Administrator at aal2 and two confirmed, active users U1 and U2 who are not staff
- When the administrator calls grant_platform_role(U1, 'trust_safety', 'New T&S hire, ticket 4812'), then for U2 with the same role, then for U1 with 'verification_reviewer' and with 'admin'
- Then each call leaves one platform_staff row with the given user and role, granted_by the administrator, granted_at now and revoked_at null, so one person may hold several roles and several people the same role. Each call writes exactly one audit.log row 'platform_role_granted' (by the row trigger on platform_staff) holding grantor, grantee, role and the reason, and queues one account-ops job to sign the grantee out globally. private.has_platform_role('trust_safety') is true in U1's and U2's own sessions. No notification is queued.

**AC2 · Grant refusals** (database test (pgTAP))

- Given Callers: a trust_safety user at aal2, a verification_reviewer at aal2, an employer owner, an admin at aal1, an admin granting to themselves, an admin granting to an unknown id, to an unconfirmed user and to a suspended user, an admin giving a reason of 9 characters, of 501 characters and empty, an admin giving an invalid role value, a repeat grant of an active role, and an anonymous caller
- When each calls grant_platform_role
- Then the role, aal and self-grant refusals raise CHARA_FORBIDDEN (the aal1 case with detail 'aal2_required'). The unknown, unconfirmed, suspended, reason and role-value cases raise CHARA_INVALID_INPUT. The repeat raises CHARA_CONFLICT. The anonymous caller is refused at EXECUTE. No row, audit entry or job is created in any case.

**AC3 · Revocation keeps history and always leaves one administrator** (database test (pgTAP))

- Given a Platform Administrator at aal2, staff with active roles, and exactly one active 'admin' row in total
- When the administrator calls revoke_platform_role(user, role, reason) for a trust_safety user, again for the same row, and then for the only active 'admin' row; and, as table owner, a transaction revokes the last admin by direct SQL and commits
- Then the first call sets revoked_at, keeps the row, writes one audit row 'platform_role_revoked' with the reason and queues an account-ops sign-out; the grantee loses the role at once (has_platform_role false). The repeat raises CHARA_CONFLICT. Revoking the last active 'admin' raises CHARA_FORBIDDEN, and the deferred constraint trigger rejects the direct-SQL transaction at commit. A role can be granted again later as a new row.

**AC4 · Revoke refusals** (database test (pgTAP))

- Given Callers: a trust_safety user at aal2, a verification_reviewer at aal2, an admin at aal1, an anonymous caller, and an admin at aal2 using a reason of 9 characters, a user without that role, and an unknown user id
- When each calls revoke_platform_role
- Then the staff-role and aal1 callers raise CHARA_FORBIDDEN (aal1 with detail 'aal2_required'); the anonymous caller is refused at EXECUTE; the short reason, the missing role and the unknown user raise CHARA_INVALID_INPUT. No row changes, no audit entry and no job is created.

**AC5 · Affected user's sessions end after grant and revoke** (browser test (Playwright))

- Given a staff user signed in on one device, with the account-ops function running
- When a role is granted or revoked for them
- Then within 2 minutes the user's refresh tokens are revoked, the device is redirected to /en/login at its next refresh, and after login the new role state applies. A staff-only page opened with a revoked role is forbidden immediately because roles are looked up, not read from the token.

**AC6 · Staff roles are technically separated** (database test (pgTAP))

- Given one user for each of admin, trust_safety and verification_reviewer, each at aal2
- When each calls grant_platform_role, revoke_platform_role, reset_mfa, publish_legal_document, suspend_user, suspend_organization, reinstate_user, reinstate_organization and moderate_job with valid arguments
- Then admin succeeds only for grant, revoke, reset_mfa and publish_legal_document and is refused suspend, reinstate and moderate. trust_safety succeeds only for suspend, reinstate and moderate. verification_reviewer is refused all nine. Every refusal raises CHARA_FORBIDDEN and writes no audit row for the action.

**AC7 · Staff roles cannot be written except through the RPCs** (database test (pgTAP))

- Given an authenticated Platform Administrator at aal2 and an ordinary user
- When they run INSERT, UPDATE and DELETE on platform_staff directly, the ordinary user selects from it, and the ordinary user updates every column they are allowed to update on profiles
- Then all direct writes are refused (no table grants). The ordinary user's select returns zero rows. No profile update changes any platform_staff row or any has_platform_role result.

**AC8 · Bootstrap insert is audited** (database test (pgTAP))

- Given an empty platform_staff table and a ticketed SQL insert of the first 'admin' row by the database owner
- When the insert is run
- Then the row trigger on platform_staff writes one audit.log row 'platform_role_granted' with actor null and the new user and role, so the bootstrap is visible in the audit log. Afterwards authenticated users can add rows only through grant_platform_role.

**AC9 · Bootstrap, named accounts and quarterly review are documented and followed** (manual check)

- Given the deploy runbook and the staff list before production go-live and at each quarter
- When the release owner and the Platform Administrator check them
- Then the runbook records the ticket number, date and executor of the bootstrap insert; every active staff row maps to a named individual supplied by CHARA with their own email address; no generic or shared administrator account exists; the quarterly review sign-off lists every active and revoked role and flags accounts with no sign-in for 90 days.

**AC10 · Staff page lists roles and grants or revokes with a reason** (browser test (Playwright))

- Given /en/admin/staff for a Platform Administrator at aal2
- When the page loads empty, with rows, and the administrator grants a role to a user found by exact email and revokes another, once with the call failing
- Then a skeleton shows while loading and an empty state says 'No staff roles yet' if there are none. Each row shows display name, email, role, granted by, granted at, revoked at, two-step status and last sign-in. The grant and revoke dialogs require a reason of 10 to 500 characters, are labelled, keyboard operable and show a toast on success or failure.

**AC11 · Each staff role sees only its own functions** (browser test (Playwright))

- Given three staff users, one per role, each at aal2, and a trust_safety user at aal1
- When each opens /en/admin and tries the URLs of the other roles' pages
- Then the administrator sees legal documents, staff, two-step reset, user and organisation search and audit search. The Trust & Safety Administrator sees moderation, suspensions and reinstatements and search. The Verification Reviewer sees a page saying 'No functions are available for your role in this release' and no navigation entries. Direct access to another role's page returns the forbidden page. The user at aal1 is redirected to /en/mfa.

### Data and validation

- platform_staff.user_id: an existing, confirmed, active user, not the caller
- platform_staff.role: one of admin, verification_reviewer, trust_safety (platform_role enum)
- reason: required, trimmed, 10 to 500 characters, written to the audit entry
- granted_by, granted_at: set by the RPC; revoked_at set on revocation; rows are kept
- one active row per user and role (partial unique index where revoked_at is null); a user may hold more than one role
- at least one active 'admin' row must exist at all times

### States and transitions

- No role -> Active (Platform Administrator at aal2 through grant_platform_role; or the ticketed bootstrap insert for the first admin)
- Active -> Revoked (Platform Administrator at aal2 through revoke_platform_role; never the last active admin)
- Revoked -> Active as a new row (Platform Administrator at aal2)

### Roles and permissions

- Platform Administrator (admin) at aal2: may grant and revoke any of the three roles, never to themselves; may open the staff page
- Platform Administrator at aal1: denied
- Trust & Safety Administrator and Verification Reviewer: denied grant, revoke and the staff page
- Employer and candidate users: denied; cannot read platform_staff
- service_role: only through account-ops to sign the affected user out
- Verification Reviewer: no screens and no function in Phase 1

### Objects

- table public.platform_staff(user_id, role, granted_by, granted_at, revoked_at); enum platform_role
- private.has_platform_role(role); row trigger on platform_staff to audit.log; audit.record()
- RPC grant_platform_role; proposed: RPCs revoke_platform_role(user_id, role, reason), list_platform_staff() and a lookup of a user by exact email for the grant dialog
- Edge Function account-ops; pgmq queue for account-ops jobs; page /[lang]/admin/staff and /[lang]/admin
- DAL requirePlatformRole(role) and requireAal2()
- RPCs reset_mfa, publish_legal_document, suspend_user, suspend_organization, reinstate_user, reinstate_organization, moderate_job (used in the separation test)
- proposed: partial unique index for one active row per user and role; proposed: deferred constraint trigger keeping at least one active admin
- proposed: error codes CHARA_INVALID_INPUT, CHARA_CONFLICT

### Open points and assumed defaults

- D1 (decided): three roles from the first migration; Verification Reviewer has no Phase 1 screens.
- D11 (adopted): the table and helper come first; grant_platform_role is added with account-ops and the admin console (units U13 and U41). AC6 is completed when the RPCs of unit U41 exist.
- O6 (open): names for each role come before production deployment; the first administrator is created by a one-off audited insert. Default assumed: at least two named administrators.
- P12 (open): whether the Platform Administrator may also suspend accounts. Default assumed: Trust & Safety only, so admin is refused suspend and reinstate in the separation test.
- P10 (open): no staff role opens candidate documents in Phase 1; this requirement grants none.
- Team defaults not in the sources: reason length 10 to 500 characters, 2-minute sign-out time, 90 days without sign-in flagged in the quarterly review, the account-ops queue polled every minute.
- The audit row is written once, by the row trigger, so the reason is passed from the RPC to the trigger (for example a transaction-local setting); the bootstrap insert has no reason.

## FR-A8 · Consent capture

> Sign-up records consent to the current versions of the Terms of Service and Privacy Policy, and of the Worker Terms (candidates) or the Employer Terms (employers); checkout records acceptance of the Subscription and Billing Terms; publication of a new version requires re-consent at next login (to be confirmed by CHARA: which legal documents need recorded acceptance at sign-up and at checkout).

### Acceptance criteria

**AC1 · Sign-up shows the right documents with versions** (browser test (Playwright))

- Given Current published versions of terms_of_service v3, privacy_policy v2, worker_terms v1 and employer_terms v1
- When a visitor chooses worker, then employer, on /en/signup
- Then Worker sees three separate unticked required checkboxes for Terms of Service (v3), Privacy Policy (v2) and Worker Terms (v1); employer sees Terms of Service, Privacy Policy and Employer Terms. Each label links to the document's legal page and shows the version number and publication date. No checkbox is pre-ticked and each is reachable and toggled by keyboard with a visible label.

**AC2 · Sign-up cannot proceed with a missing consent** (browser test (Playwright))

- Given the sign-up form with one required document box unticked
- When the visitor submits, and the Server Action is called directly without that consent
- Then the form shows an error naming the document ('Accept the Privacy Policy to continue') and moves focus to the error summary; the direct call returns the same refusal. In both cases no auth.users row is created.

**AC3 · Consents are written when the kind is committed** (database test (pgTAP))

- Given a confirmed candidate with pending_consents for terms_of_service v3, privacy_policy v2, worker_terms v1 and age_18_plus v1, and a confirmed employer with the three employer documents
- When set_account_kind runs for each
- Then the candidate gets four consents rows and the employer three, each with user_id, purpose, the shown version, action 'granted' and created_at now. pending_consents is cleared. Before this call neither user has any consents row. A matching 'consents_accepted' audit row exists for each.

**AC4 · Invalid or incomplete consent sets are refused** (database test (pgTAP))

- Given Pending consents for a worker that: miss a required purpose; name a superseded version; name version 99 that does not exist; name an unpublished draft version; are empty (a sign-up made directly against Auth without metadata); and contain an extra employer_terms entry; and a company user calling accept_consents for worker_terms
- When set_account_kind or accept_consents is called
- Then Missing purpose, superseded version and empty pending_consents raise CHARA_CONSENT_REQUIRED with the purpose in the detail. An unknown or unpublished version raises CHARA_INVALID_INPUT. In these cases account_kind stays null and no consents row is written. An extra entry for another kind's document is ignored and not written when the worker's own set is complete. The company user's accept_consents for worker_terms raises CHARA_INVALID_INPUT.

**AC5 · A superseded version is accepted first** (browser test (Playwright))

- Given a user who ticked privacy_policy v2 at sign-up and a publication of v3 before they confirm their email
- When they open /en/onboarding after confirming
- Then the page shows Privacy Policy v3 with its change summary and a required box before the kind is committed. The consents row written has version 3, never 2, and the kind is not committed until the box is ticked.

**AC6 · The ledger is append-only** (database test (pgTAP))

- Given Users A and B with consents rows
- When UPDATE, DELETE and TRUNCATE are attempted on consents as authenticated, as the table owner and as service_role, and INSERT is attempted as authenticated
- Then all are refused (no grants and ENABLE ALWAYS triggers) and the rows are unchanged.

**AC7 · The ledger is idempotent, private and complete** (database test (pgTAP))

- Given Users A and B with consents rows, and an anonymous caller
- When accept_consents is called twice for the same purpose and version by A; A selects from consents; a row with null or unknown version is inserted by the table owner; the anonymous caller calls accept_consents
- Then the repeat call adds no second row while A's latest row for that purpose is already 'granted' at that version. A sees only their own rows and none of B's. The row with null or unknown version is rejected (not null and foreign key on purpose and version to legal_documents). The anonymous call is refused at EXECUTE.

**AC8 · Publishing a new version makes re-consent pending and queues the email** (database test (pgTAP))

- Given terms_of_service v3 accepted by all users, a suspended company user, and an admin at aal2
- When the admin calls publish_legal_document for employer_terms with a change summary, and with an empty summary; an admin at aal1, a trust_safety user and a non-staff user attempt the same
- Then employer_terms v2 is created with published_at now and is the current version; v1 stays stored; one audit row 'legal_document_published' exists. The pending re-consent function returns employer_terms for every company user and nothing for candidates. One mandatory legal_version notification is queued per affected active user and none for the suspended user. The empty summary raises CHARA_INVALID_INPUT; the other three callers get CHARA_FORBIDDEN (aal1 with detail 'aal2_required') and nothing is created.

**AC9 · Re-consent is required at next sign-in** (browser test (Playwright))

- Given a company user who accepted employer_terms v1 and a published v2 with a change summary; one session of the user started before the publication
- When the pre-existing session browses on; the user signs out, signs in, tries other pages, accepts, and in another case chooses 'Log out'
- Then the pre-existing session is not gated. After sign-in the user lands on /en/consent showing the document title, v2, publication date, the change summary and a link to the full text, with one required box per changed document only (terms_of_service is not shown). Every app page redirects to /en/consent; legal pages and logout stay available. After accepting, a consents row with v2 exists and the user continues to the originally requested page. Logging out leaves the consent pending. A session opened before publication is gated at its next sign-in, at the latest 7 days later.

**AC10 · Withdrawal adds a row and ends dependent access** (database test (pgTAP))

- Given a user with a granted worker_terms row
- When they call withdraw_consent('worker_terms'), then sign in, then accept again on the consent page; and call withdraw_consent for a purpose with no granted row, and for terms_of_service as an anonymous caller
- Then a new consents row with action 'withdrawn' and the last granted version is inserted, the old row is untouched, and an audit row 'consent_withdrawn' is written. At the next sign-in the user is held on /en/consent. Accepting adds a new 'granted' row. The call for a purpose with no granted row raises CHARA_INVALID_INPUT; the anonymous call is refused at EXECUTE. All rows stay in order of created_at.

**AC11 · Checkout records acceptance of the Subscription and Billing Terms** (database test (pgTAP))

- Given an owner at aal2 and the current version of subscription_billing_terms
- When billing_checkout_start is called without a granted row for the current version, then after accept_consents for it, then after a new version is published
- Then the first call raises CHARA_CONSENT_REQUIRED; after acceptance the consent check passes and the consents row has the current version; after a newer version is published the old row no longer satisfies the check. This document is not part of the sign-up consent set nor of the login re-consent gate.

**AC12 · Consent evidence can be exported for an audit** (manual check)

- Given a ledger with granted and withdrawn rows across several users and versions
- When the privacy contact runs the documented export query as the database owner
- Then the result lists user_id, purpose, version, action and created_at for every row in created_at order, shows no row without a version, and includes all stored versions of legal_documents with publication dates. The step is recorded in the runbook.

### Data and validation

- consents.user_id: authenticated user id
- consents.purpose: one of terms_of_service, privacy_policy, worker_terms, employer_terms, subscription_billing_terms, age_18_plus (equal to legal_documents.slug)
- consents.version: required, must exist and be published in legal_documents for that purpose
- consents.action: 'granted' or 'withdrawn'
- consents.created_at: set by the database, never supplied by the client
- pending_consents: list of {purpose, version}; set_account_kind uses only the purposes required for the account kind and ignores others
- required at sign-up: candidates terms_of_service, privacy_policy, worker_terms (plus age_18_plus, FR-A9); employers terms_of_service, privacy_policy, employer_terms
- required at checkout: subscription_billing_terms current version
- legal_documents: slug, version, title, body, change_summary (required on publication), published_at; unique (slug, version); current version is the highest published
- consent status per purpose is the latest row: current only if action is 'granted' and its version equals the current version

### States and transitions

- No consent -> Granted v1 (user, at set_account_kind after confirmation, or at checkout for the billing terms)
- Granted vN -> Granted vN+1 (user, on the consent page after a new version is published)
- Granted vN -> Withdrawn (user, withdraw_consent)
- Withdrawn -> Granted (user, accepts again on the consent page)
- Legal document: Published vN -> Published vN+1 as the current version (Platform Administrator, publish_legal_document)

### Roles and permissions

- Authenticated user: may record and withdraw their own consents; may read only their own rows
- Anonymous visitor: may read current legal pages; may not write consents
- Platform Administrator (admin) at aal2: may publish legal document versions
- Trust & Safety Administrator and Verification Reviewer: denied publishing
- No role: may update or delete a consents row
- service_role: no direct access to consents

### Objects

- tables legal_documents, consents, profiles (pending_consents)
- RPCs accept_consents, withdraw_consent, set_account_kind, publish_legal_document, billing_checkout_start; proposed: RPC pending_reconsents()
- pages /[lang]/signup, /[lang]/onboarding, /[lang]/legal/[slug], proposed /[lang]/consent
- DAL session helper in lib/dal/session.ts; notifications kind legal_version; audit.log
- proposed: legal_documents row for age_18_plus (the versioned attestation wording)
- proposed: ENABLE ALWAYS triggers refusing consents update, delete and truncate; proposed: error codes CHARA_CONSENT_REQUIRED, CHARA_INVALID_INPUT

### Open points and assumed defaults

- L9 (open): which documents need recorded acceptance at sign-up and checkout. Default assumed: Terms of Service and Privacy Policy for everyone, Worker Terms for candidates, Employer Terms for employers, Subscription and Billing Terms at checkout.
- L7 and W7 (open): legal texts v1 are DRAFT placeholders until approved by legal counsel (L5).
- D2 (adopted): legal_documents uses the SDD columns; D3 (adopted): consents is append-only with action granted or withdrawn and age attestation is a purpose.
- Re-consent timing: the SOP and requirement say 'at next login'; a session started before publication is gated at its next sign-in, at the latest 7 days later (session limit). The mechanism for telling an older session from a new one is chosen in implementation.
- Default assumed: the login gate covers terms_of_service, privacy_policy and worker_terms or employer_terms only; subscription_billing_terms is re-checked at checkout and age_18_plus is not re-asked.
- How the onboarding page records a newer version before the kind is committed (for example an optional consents argument of set_account_kind) is an implementation choice; AC5 asserts the outcome.

## FR-A9 · Age attestation

> Candidates confirm they are at least 18 years old at sign-up; no date of birth is stored.

### Acceptance criteria

**AC1 · Age checkbox appears for candidates only** (browser test (Playwright))

- Given /en/signup
- When the visitor chooses 'I'm a worker', then 'I'm an employer'
- Then for worker an unticked required checkbox labelled 'I am 18 or older' is shown, reachable and toggled by keyboard, with its error message tied to it by aria-describedby. For employer no age checkbox or date field exists in the page.

**AC2 · Sign-up is blocked without the attestation** (browser test (Playwright))

- Given a worker sign-up with every field valid and the age box unticked
- When the visitor submits, and the Server Action is called directly without the attestation
- Then the form shows 'Confirm that you are 18 or older to create an account' and moves focus to the error summary; the direct call returns the same refusal. In both cases no auth.users row is created.

**AC3 · The attestation is recorded as a consent row at commit** (database test (pgTAP))

- Given a confirmed worker with age_18_plus in pending_consents
- When set_account_kind runs
- Then one consents row exists with purpose 'age_18_plus', the version of the attestation wording shown, action 'granted' and created_at now. Afterwards a query for profiles with account_kind 'worker' and no granted age_18_plus row returns zero rows. No row for age_18_plus exists before confirmation.

**AC4 · The database does not accept a worker without attestation, nor an attestation from a company user, and the attestation cannot be withdrawn** (database test (pgTAP))

- Given a worker whose pending_consents lacks age_18_plus, a company user whose sign-up metadata contains age_18_plus, and a worker with a granted age_18_plus row
- When set_account_kind runs for the first two; the company user calls accept_consents for age_18_plus; the worker calls withdraw_consent('age_18_plus')
- Then the first worker's call raises CHARA_CONSENT_REQUIRED with detail 'age_18_plus' and account_kind stays null. The company user commits normally, the entry is ignored and no age_18_plus consents row is written for them; their direct accept_consents raises CHARA_INVALID_INPUT. The withdrawal raises CHARA_INVALID_INPUT and the ledger is unchanged.

**AC5 · No date of birth or age column exists** (database test (pgTAP))

- Given all columns in the schemas public, private, audit and billing
- When the forbidden-attribute test scans information_schema.columns
- Then no column name has an underscore-separated token equal to date_of_birth, dob, birth, birthday, birthdate or age (so 'age_group' fails but 'message' and 'page' pass), and the test fails if one is added. consents holds only purpose, version, action and timestamp for the attestation.

**AC6 · No birth data leaves the browser or is stored in Auth metadata** (browser test (Playwright))

- Given a worker sign-up in a real browser with network inspection
- When the form is submitted and the auth.users row is read
- Then the Server Action request contains only email, password, the account kind, the consent entries and the attestation entry; no field name or value holds a date of birth or an age number. auth.users.raw_user_meta_data has only the keys intended_account_kind and pending_consents.

**AC7 · A report of an underage user is handled through suspension** (browser test (Playwright))

- Given a report that a candidate is under 18 reaches the complaints process, a Trust & Safety Administrator at aal2 and a Platform Administrator at aal2
- When the Trust & Safety Administrator suspends the user with a statement of reasons (FR-F1), and the Platform Administrator attempts the same
- Then profiles.status becomes 'suspended', the user is signed out and login is refused, an account_suspended email with the reasons is queued, and audit.log records actor, target and reason. The Platform Administrator is refused with CHARA_FORBIDDEN and nothing changes.

**AC8 · Legal reviews the attestation wording per launch country** (manual check)

- Given the list of launch countries and the current age_18_plus wording
- When Legal reviews the wording before launch and at the annual review
- Then the review result and date are recorded; a change of wording is published as a new version of the age_18_plus document and applies to new sign-ups; the pull request or runbook names the reviewer and countries covered.

### Data and validation

- age attestation: boolean checkbox, required and unticked by default for candidates, not shown for company sign-ups
- stored as consents row: purpose 'age_18_plus', version of the attestation wording, action 'granted', created_at; carried before confirmation as an age_18_plus entry in profiles.pending_consents
- date of birth, age and any birth-related value: never collected, never stored
- attestation wording: a versioned legal_documents row with slug 'age_18_plus'

### States and transitions

- Unattested -> Attested (system, set_account_kind writes the consent after email confirmation, only for kind worker)
- Attested -> Unattested: not allowed

### Roles and permissions

- Candidate (worker) sign-up: must attest; cannot complete sign-up otherwise
- Employer sign-up: no age attestation is asked or stored
- Trust & Safety Administrator at aal2: may suspend an underage-reported user with reasons (SOP FR-F1)
- Platform Administrator and Verification Reviewer: denied suspension
- Any role: may not read another user's consents rows
- Anonymous visitor: no access

### Objects

- sign-up form /[lang]/signup; /[lang]/onboarding
- profiles.pending_consents; RPCs set_account_kind, accept_consents, withdraw_consent; table consents (purpose age_18_plus); table legal_documents
- pgTAP forbidden-attribute test over information_schema.columns
- RPC suspend_user; audit.log; notifications kind account_suspended
- proposed: legal_documents row age_18_plus; proposed: error codes CHARA_CONSENT_REQUIRED, CHARA_INVALID_INPUT

### Open points and assumed defaults

- The SOP asks Legal to confirm the attestation wording per launch country. Default assumed: the wording states 18 or older for every country until Legal says otherwise.
- D3 (adopted): age attestation is a consent purpose, not a column on any table.
- Changing the age wording does not trigger the login re-consent gate; the gate covers only the documents listed in the FR-A8 notes.
- P12 (open): AC7 follows the default that only the Trust & Safety Administrator may suspend.
