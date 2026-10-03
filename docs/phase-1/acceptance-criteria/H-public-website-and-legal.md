# Group H: Public website and legal

## FR-H1 · Public pages

> Home, Find Jobs, Vacancy, Pricing, How CHARA Works, Trust & Safety, About, Contact and Imprint, and the legal pages Terms of Service, Privacy Policy, Cookie Policy, Platform Rules, Acceptable Use Policy, Subscription and Billing Terms, Employer Terms, Worker Terms, Complaints and Dispute Process, and Account Suspension and Termination Rules. Legal-entity details, privacy contact and data-protection contact shown on these pages come from configurable settings (to be confirmed by CHARA: which of the eighteen legal documents are needed at the Phase 1 launch).

### Acceptance criteria

**AC1 · All public pages open for an anonymous visitor and are server-rendered** (browser test (Playwright))

- Given an anonymous visitor with no session, no cookies and JavaScript disabled, and one open, visible vacancy with id V
- When the visitor requests /en, /en/jobs, /en/jobs/V, /en/pricing, /en/how-it-works, /en/trust-safety, /en/about, /en/contact, /en/imprint and /en/legal/<slug> for each of the ten Phase 1 slugs (terms-of-service, privacy-policy, cookie-policy, platform-rules, acceptable-use-policy, subscription-and-billing-terms, employer-terms, worker-terms, complaints-and-dispute-process, account-suspension-and-termination-rules), each with a published version
- Then every response is HTTP 200 with no redirect to login, the HTML already contains exactly one h1, a non-empty title and at least 100 characters of text inside main, and the html element has lang="en"

**AC2 · Locale redirect and unknown pages** (browser test (Playwright))

- Given an anonymous visitor; legal_documents has no row for the slugs nope and verification-policy (a document that is not in Phase 1)
- When the visitor requests /pricing, /en/legal/nope, /en/legal/verification-policy and /en/legal/Terms-Of-Service
- Then /pricing redirects (HTTP 307 or 308) to /en/pricing; the other three return HTTP 404 with the not-found page, which shows a link to /en and no stack trace; a legal page exists exactly when a published row exists for its lower-case slug, so the route holds no fixed list of slugs

**AC3 · Shared layout and navigation** (browser test (Playwright))

- Given an anonymous visitor on /en/pricing, on /en/jobs/V and on /en/legal/terms-of-service
- When the visitor reads the header and the footer
- Then the header holds links named Find Jobs, Pricing, How CHARA Works, Trust & Safety, About, Contact, Log in and Sign up in this order; the footer holds Imprint and the ten legal page links; the set and order are identical on the three pages; every link target returns HTTP 200

**AC4 · Automated accessibility check** (browser test (Playwright))

- Given the 19 public pages (Home, Find Jobs, one Vacancy, Pricing, How CHARA Works, Trust & Safety, About, Contact, Imprint and the ten legal pages) rendered with seeded data
- When axe-core runs on each page with the tags wcag2a, wcag2aa, wcag21aa and wcag22aa
- Then there are 0 violations of impact serious or critical on every page; any such violation fails the CI e2e job (KPI: 0 serious)

**AC5 · Keyboard use** (browser test (Playwright))

- Given a visitor using only the keyboard on /en
- When the visitor presses Tab from the top of the page, then Enter on the first stop
- Then the first stop is a visible Skip to main content link; Enter moves focus to main; further Tab presses reach every header link in visual order and then every footer link; every focused element shows a visible focus indicator (computed outline-style is not none, or a box-shadow is set)

**AC6 · Layout at 360 px width** (browser test (Playwright))

- Given a viewport of 360 by 800 px
- When each of /en, /en/jobs, /en/jobs/V, /en/pricing, /en/how-it-works, /en/trust-safety, /en/about, /en/contact and /en/imprint is loaded, and the menu is operated by keyboard on /en
- Then document.documentElement.scrollWidth is at most 360 on every page; the navigation is behind a button named Menu that opens with Enter or Space, closes with Escape and returns focus to the button

**AC7 · Legal-entity and contact details come from settings** (browser test (Playwright))

- Given private.settings rows legal_entity_name = 'Example GmbH', legal_entity_address, legal_entity_registration_number, legal_entity_vat_id, legal_entity_email, privacy_contact and data_protection_contact are set
- When a visitor opens /en/imprint, /en/contact and /en/legal/privacy-policy, then the row legal_entity_name is changed to 'Example Ltd' by SQL and the Imprint is reloaded
- Then the Imprint shows legal_entity_name, address, registration number, VAT ID and email; the Contact page shows the legal-entity email, the privacy contact and the data-protection contact; the Privacy Policy page shows the privacy contact and the data-protection contact below the legal text; the reloaded Imprint shows 'Example Ltd' without a rebuild or redeploy

**AC8 · Missing or unsafe setting values** (unit test (Vitest))

- Given the settings renderer receives a missing key, a value of '' , a value of three spaces, a value '<b>x</b>', an email value 'privacy@example.com' and a non-email value in an email key
- When it builds the rows for the Imprint and Contact pages, and the settings accessor returns an error
- Then Missing, empty and whitespace-only values produce no row (no label without value, no text 'null' or 'undefined'); '<b>x</b>' is output as escaped text; only a value matching an email pattern becomes a mailto: link; an accessor error is thrown to the error page (HTTP 500, no stack trace) and is not swallowed into empty rows

**AC9 · Only the public settings are readable by visitors** (database test (pgTAP))

- Given private.settings also holds entitlements_enforced and share_expiry_days_after_final
- When the roles anon and authenticated select from private.settings and call the public accessor function
- Then the direct select is refused (permission denied for table settings; the schema usage grant exists only for functions); the accessor returns only the seven keys legal_entity_name, legal_entity_address, legal_entity_registration_number, legal_entity_vat_id, legal_entity_email, privacy_contact and data_protection_contact and none of the other keys; service_role has no table grant on private.settings

**AC10 · No tracking and no non-essential cookies** (browser test (Playwright))

- Given a fresh browser context with no cookies
- When the visitor loads /en, /en/jobs, /en/jobs/V, /en/pricing, /en/how-it-works, /en/trust-safety, /en/about, /en/contact, /en/imprint and /en/legal/cookie-policy
- Then no response sets a cookie, document.cookie is empty, every network request goes to the app origin (images may also use the project storage host) and no cookie consent banner is shown

**AC11 · Find Jobs and Vacancy pages show open vacancies only** (browser test (Playwright))

- Given Eight vacancies of one organisation: open and visible, open and hidden by moderation, open with moderation_state org_suspended, paused, closed, filled, draft, and open with deleted_at set
- When an anonymous visitor opens /en/jobs and then requests the page of each vacancy
- Then /en/jobs lists only the open and visible vacancy; its page returns HTTP 200 and the pages of the other seven return HTTP 404

**AC12 · Content approval, trust statement and cookie statement** (manual check)

- Given the release that publishes Home, How CHARA Works, Trust & Safety, About, Contact and Imprint
- When the release checklist is reviewed before deployment
- Then it records content approval by CHARA and legal review for those six pages; the launch check fails while legal_entity_name, legal_entity_address, privacy_contact or data_protection_contact is empty; the Trust & Safety page states that paying for a plan does not make an organisation verified or move its vacancies up in search results; the Cookie Policy states that only strictly necessary cookies are used; no text promises a feature of a later phase; a recurring quarterly content review with a named owner exists

### Data and validation

- private.settings.legal_entity_name: text, trimmed, 1 to 200 characters, required before launch
- private.settings.legal_entity_address: text, trimmed, 1 to 500 characters, required before launch
- private.settings.legal_entity_registration_number: text, trimmed, 1 to 50 characters
- private.settings.legal_entity_vat_id: text, trimmed, 1 to 50 characters, optional
- private.settings.legal_entity_email: email address, at most 254 characters; checked by the renderer, which makes a mailto link only for a valid address
- private.settings.privacy_contact: email address, at most 254 characters, required before launch
- private.settings.data_protection_contact: email address, at most 254 characters, required before launch
- private.settings.value: jsonb, always read with value #>> '{}' (D6)
- Page metadata per public page: see FR-H5; page texts are stored in lib/i18n/en.json (English only)
- No visitor input is captured by the public pages in Phase 1; Contact is a page of details, not a form

### Roles and permissions

- Anonymous visitor (anon): may read every public page and every published legal page; may not read private.settings directly
- Candidate (account_kind worker): may read the same pages; no extra rights
- Organisation owner, admin, member: may read the same pages; no extra rights
- Platform Administrator (admin): changes legal-entity and contact settings only through a reviewed migration in Phase 1; no editing screen
- Trust & Safety Administrator (trust_safety), Verification Reviewer (verification_reviewer): may read the public pages only; may not change settings
- service_role: no direct table grants on private.settings

### Objects

- pages: app/[lang]/(public)/page, app/[lang]/(public)/jobs, proposed: app/[lang]/(public)/jobs/[id], app/[lang]/(public)/pricing, app/[lang]/(public)/how-it-works, app/[lang]/(public)/trust-safety, app/[lang]/(public)/about, proposed: app/[lang]/(public)/contact, proposed: app/[lang]/(public)/imprint, app/[lang]/(public)/legal/[slug]
- app/[lang]/layout.tsx, shared public layout (header, footer, skip link), app/global-not-found.tsx, proxy.ts (locale redirect, nonce CSP), lib/i18n/locale.ts, lib/i18n/en.json
- table private.settings(key, value jsonb); proposed: keys legal_entity_name, legal_entity_address, legal_entity_registration_number, legal_entity_vat_id, legal_entity_email, privacy_contact, data_protection_contact
- proposed: function public.get_public_settings() (security definer, search_path empty, returns only the seven keys above, execute for anon and authenticated)
- table public.legal_documents (legal pages), table public.jobs (Find Jobs and Vacancy pages)

### Open points and assumed defaults

- To be confirmed by CHARA (L7): which of the eighteen legal documents are needed at launch. Default assumed: the ten Phase 1 documents listed in AC1; the other eight (for example the Verification Policy) follow with their features and have no row, so they return 404.
- L1 is open (jurisdiction, data-protection officer or EU representative). Default assumed: legal-entity, privacy-contact and data-protection-contact values are settings rows; until they exist the pages omit the empty rows (AC8) and the launch check fails if the required ones are empty.
- ARCHITECTURE.md lists no route for Contact, Imprint or a vacancy; proposed: /[lang]/contact, /[lang]/imprint and /[lang]/jobs/[id]. Default assumed: Contact shows details only and has no form, because no email flow for visitor messages exists in Phase 1. The route app/[lang]/(public)/companies in ARCHITECTURE.md is not in the FR-H1 page list and is not covered here.
- The settings editing screen is later phase (P9); until then a change is a reviewed migration (FR-F1).
- The axe-core test dependency (for example @axe-core/playwright) is not in the approved dependency list of BUILD_ORDER.md; approval is needed before AC4 can be built.

## FR-H2 · Pricing from data

> The pricing page renders plan names, prices in EUR labelled exclusive of VAT, trial terms and features from the plan configuration records; a plan lists only features delivered in the current release (to be confirmed by CHARA: that Phase 1 plans list Phase 1 features only).

### Acceptance criteria

**AC1 · Plan cards render from plan records** (browser test (Playwright))

- Given Public plan records employer_starter (name 'Basic', price_minor 3900, currency EUR, interval month, sort 1) and employer_professional (name 'Professional', price_minor 7900, sort 2), both with trial_days 30
- When an anonymous visitor opens /en/pricing
- Then one card per public plan appears in sort order, each showing the plan name from the record, the price as €39.00 and €79.00, the interval as 'per month' and the label 'excl. VAT' next to the price; no card appears for any other plan

**AC2 · Candidates are shown as free** (browser test (Playwright))

- Given no billing row exists for candidates
- When a visitor opens /en/pricing
- Then a candidate card states that CHARA is free for candidates and that candidates never pay; it shows no price from a plan record and no checkout button

**AC3 · Trial terms come from the record** (browser test (Playwright))

- Given employer_starter has trial_days 30 and price_minor 3900
- When the pricing page is rendered, then trial_days is changed to 14 and the page reloaded, then to 0 and reloaded
- Then First the card reads '30-day free trial', 'then €39.00 per month excl. VAT', that the trial converts automatically to the paid plan and that one free trial is granted per legal entity; then it reads '14-day'; with 0 no trial text is shown

**AC4 · Price and name changes appear without a deployment** (browser test (Playwright))

- Given the page shows €39.00 for the plan named 'Basic'
- When billing.plans.price_minor of employer_starter is changed to 4900 and name to 'Starter' by SQL and the page is requested again
- Then the next response shows €49.00 and 'Starter' with no rebuild or redeploy; no other card changes

**AC5 · Non-public plans are hidden, contact-sales plans show no price** (browser test (Playwright))

- Given employer_enterprise and free_employer have is_public = false
- When the page is rendered, then employer_enterprise is set to is_public = true with contact_sales = false and a price, then to contact_sales = true
- Then the first render shows neither plan; the second shows the Enterprise card with its price; the third shows the card with a Contact sales link to /en/contact and no price

**AC6 · Only features and limits delivered in Phase 1** (browser test (Playwright))

- Given plan_features rows for the later-phase keys chara_match, corridors and advanced_worker_search on a paid plan and for shortlisting on every paid plan; plan_limits active_jobs and members of 3 and 1 (Basic), 15 and 5 (Professional), 50 and 15 (Enterprise, public in this test); one plan_limits row with limit_value null
- When the page is rendered
- Then each card lists the shortlisting feature with its label and the limits from its own rows: '3 active vacancies' and '1 team member' (Basic), '15 active vacancies' and '5 team members' (Professional), '50 active vacancies' and '15 team members' (Enterprise); keys without a label in lib/i18n/en.json, here the three later-phase keys, are not listed; the row with limit_value null produces no limit line

**AC7 · Price formatting** (unit test (Vitest))

- Given the price formatter receives price_minor 3900, 7900, 4950 and 0 with currency EUR
- When it formats each value
- Then it returns €39.00, €79.00, €49.50 and €0.00 with no rounding and no VAT added

**AC8 · Advertised price equals recorded and charged price** (browser test (Playwright))

- Given every public plan in the seeded database, and an organisation owner at aal2 whose organisation has had no trial, with the checkout running on the null provider
- When the pricing test compares each card with its billing.plans row, then the owner starts the checkout for employer_starter from the organisation billing page
- Then for every public plan the card name, amount, currency, interval and trial days equal the record (KPI: 0 mismatches; any difference fails the CI e2e job); the checkout confirmation page shows the same plan name, €39.00 excl. VAT and the 30-day trial as the pricing card

**AC9 · Read access to plans is public and read-only** (database test (pgTAP))

- Given billing.plans holds public and non-public plans
- When anon selects from public.v_plans, selects from billing.subscriptions, billing.customers, billing.orders and billing.provider_events, and inserts, updates or deletes a plan
- Then v_plans returns exactly the rows with is_public = true; the other selects and all writes are refused; no billing table holds a row of any candidate

**AC10 · No claim that payment buys verification or visibility** (browser test (Playwright))

- Given the rendered pricing page
- When Its text is checked
- Then it contains the sentence 'A paid plan does not make an organisation verified or move its vacancies up in search results' and none of the words boost, badge, corridor, messaging or CHARA Match

**AC11 · Empty and error states** (browser test (Playwright))

- Given v_plans returns zero public plans, then the query fails
- When the page is requested in each case
- Then with zero rows the employer cards are replaced by 'Pricing is currently unavailable' and a link to /en/contact, and the candidate card still renders; on a query failure the error page appears with HTTP 500, shows no prices and no stack trace

**AC12 · Call-to-action by role and accessible names** (browser test (Playwright))

- Given an anonymous visitor, an authenticated candidate, an organisation owner, an organisation admin and an organisation member
- When each opens /en/pricing
- Then the anonymous visitor sees one link per paid plan to the employer sign-up; the candidate sees no checkout or sign-up link on employer cards and a note that plans are for employers; the owner and the admin see links to the billing page of their organisation (FR-G5); the member sees no link and a note that the owner or an admin manages the plan; every link has an accessible name that contains the plan name

### Data and validation

- billing.plans.code: text primary key (employer_starter, employer_professional, employer_enterprise, free_employer)
- billing.plans.name: text, 1 to 60 characters, display name shown on the page (Basic or Starter is open, C13)
- billing.plans.price_minor: integer, 0 or more, amount in minor units; 3900 for employer_starter
- billing.plans.currency: 'EUR' in Phase 1; price always labelled excl. VAT
- billing.plans.interval: 'month' in Phase 1
- billing.plans.trial_days: integer, 0 or more, 30 by default; 0 means no trial text
- billing.plans.is_public: boolean; false for free_employer and, until its price is stated, employer_enterprise
- billing.plans.contact_sales: boolean; true shows a Contact sales link instead of a price
- billing.plans.sort: integer, ascending order of the cards
- billing.plan_limits(plan_code, limit_key, limit_value int null): active_jobs and members shown in Phase 1; null shows no line
- billing.plan_features(plan_code, feature_key): only keys with a label in lib/i18n/en.json are shown
- The page stores nothing

### Roles and permissions

- Anonymous visitor, candidate, organisation owner, admin and member: may read public plans through public.v_plans; may not write any plan record
- Organisation owner and admin: see the link to their organisation billing page; organisation member: no billing link
- Platform Administrator (admin): changes plan records only by a reviewed migration in Phase 1 (editing screens are later phase)
- Trust & Safety Administrator (trust_safety), Verification Reviewer (verification_reviewer): no write access to plan records
- billing_owner: owns the billing schema and the plan tables
- service_role: no direct grants on the billing schema

### Objects

- page app/[lang]/(public)/pricing
- view public.v_plans (security_invoker; select for anon and authenticated; proposed: exposes the limits and the feature keys of public plans, because the page needs them)
- tables billing.plans, billing.plan_limits, billing.plan_features
- lib/i18n/en.json (feature labels, trial and VAT texts)
- function billing_checkout_start and the checkout confirmation page (FR-G2, used in AC8); page app/[lang]/(app)/org/[slug]/billing (FR-G5)
- seed file in supabase/seeds/ref (plans)

### Open points and assumed defaults

- To be confirmed by CHARA (C10): price of Professional and Enterprise. Default assumed: Professional stays 7900 (EUR 79); Enterprise is seeded with is_public = false and is not shown until a price is stated.
- To be confirmed by CHARA (C13): display name of the lowest plan. Default assumed: the page prints billing.plans.name, seeded 'Basic'; the code stays employer_starter; only the record changes.
- To be confirmed by CHARA (FR-H2): that Phase 1 plans list Phase 1 features only. Default assumed: yes; a feature key is listed only if a label for it ships with the release (shortlisting; analytics_advanced only if the release delivers it).
- To be confirmed by CHARA (C15): payment details at registration or at checkout. Default assumed: at checkout when the trial starts; the pricing text says only that the trial converts automatically.
- C12 is open: whether the members limit counts the owner. Default assumed: the page prints the number from the record as 'team members' and makes no statement about the owner.
- C16 (tier assignment of some features) and P9 (editing screens) are open; default assumed: records are changed by migration.
- Not verified against live Stripe: AC8 runs on the null provider; the Stripe price used at checkout must be created from the same plan record.

## FR-H3 · Versioned legal pages

> Legal pages render the current published version with version number, date and change summary.

### Acceptance criteria

**AC1 · Legal page shows the current version, its date and the change log** (browser test (Playwright))

- Given terms-of-service has versions 1 (published 1 September 2026), 2 (20 September 2026) and 3 (1 October 2026), each with a different body and change summary; the body of version 3 holds a line '## Scope' and two paragraphs separated by a blank line
- When a visitor opens /en/legal/terms-of-service
- Then the page shows the title as h1, 'Version 3', 'Published 1 October 2026' (UTC date), the change summary and body of version 3 and not the body of versions 1 or 2; '## Scope' is an h2 and the two paragraphs are two p elements; below it a change log lists versions 3, 2 and 1 newest first with number, date and change summary

**AC2 · Current version is the highest version** (database test (pgTAP))

- Given Rows for terms-of-service versions 1, 2 and 3 and for privacy-policy version 1
- When the current-version view is queried as anon
- Then it returns exactly one row per slug: terms-of-service with version 3 and privacy-policy with version 1; a slug with no row returns nothing

**AC3 · Unapproved text is marked as a draft** (browser test (Playwright))

- Given a version with is_draft = true and another with is_draft = false
- When each legal page is opened
- Then the draft page shows a visible banner 'Draft - not yet approved by legal counsel' above the text; the approved page shows no banner

**AC4 · Publish a new version** (database test (pgTAP))

- Given a Platform Administrator at aal2 and terms-of-service at version 1
- When the administrator calls publish_legal_document with slug terms-of-service, a new title and body, a 40-character change summary and is_draft false
- Then a row with version 2 is inserted and published_at equals the transaction time; version 1 is unchanged; the function returns 2; exactly one audit.log row is written through audit.record() with the actor, action legal_document.publish, entity_type legal_document and metadata holding slug, version, is_draft and the change summary; the notifications of AC10 are queued in the same transaction, and if queuing fails no version row remains

**AC5 · Input validation on publish** (database test (pgTAP))

- Given a Platform Administrator at aal2
- When the administrator publishes with a slug of 81 characters, a slug containing a capital letter, a space or a double hyphen, a title of 2 or 201 characters, an empty body or a body of 200001 characters, or a change summary of 9 or 1001 characters
- Then each call is refused with CHARA_INVALID_INPUT, no row is inserted, no notification is queued and no audit row is written

**AC6 · Only an administrator with two-step verification can publish** (database test (pgTAP))

- Given a candidate, an organisation owner, a Trust & Safety Administrator, a Verification Reviewer, a Platform Administrator at aal1 and an anonymous caller
- When each calls publish_legal_document with valid input
- Then the signed-in callers are refused with CHARA_FORBIDDEN; the anonymous caller is refused (CHARA_UNAUTHENTICATED or no execute privilege); no legal_documents row, notification or audit row is created

**AC7 · Versions are immutable and never deleted** (database test (pgTAP))

- Given a published version 2 of terms-of-service
- When the roles admin, authenticated, anon and service_role try to update or delete that row or to insert a legal_documents row directly, and publish_legal_document is asked to produce version 2 again
- Then every update, delete and direct insert is refused; the row is unchanged; a duplicate (slug, version) fails on the unique constraint; the only write path is publish_legal_document

**AC8 · Concurrent publishes** (browser test (Playwright))

- Given the current version of privacy-policy is 1 and two Platform Administrators at aal2 are in separate sessions
- When both submit different new bodies for privacy-policy at the same moment
- Then both calls succeed, one returns 2 and the other 3, no call fails with a unique violation, and exactly two new rows and two audit rows exist

**AC9 · Re-consent at next login** (browser test (Playwright))

- Given a candidate and an employer owner whose latest granted consent for terms-of-service is version 1, and version 2 has been published
- When each logs in
- Then each is redirected to a re-consent page that lists Terms of Service version 2 with its change summary and a link to the full text, cannot open any page of the signed-in area (for example /en/dashboard/worker or /en/dashboard/employer) until the version is accepted, and can still log out; accepting through accept_consents inserts a consents row with purpose terms-of-service, version 2 and action granted; a user whose latest consent is already version 2, or whose latest row for a document is withdrawn, is not asked; accept_consents with a version that is not the current one is refused and inserts no row

**AC10 · Notifications go to affected users only** (database test (pgTAP))

- Given five users with a latest consent granted for privacy-policy version 1, one of them with notification_preferences.digest = true; one user whose profile has deleted_at set; one user who never accepted it; one user whose latest privacy-policy row is withdrawn; one employer owner with a granted employer-terms consent
- When Version 2 of privacy-policy is published, then version 2 of cookie-policy (no acceptance recorded for it), then version 2 of employer-terms
- Then for privacy-policy exactly 5 notifications of kind legal_version are queued, one per affected user (the digest user included, the other three excluded), each with a payload holding only slug, version and title and never the body; for cookie-policy 0 are queued and no re-consent is required; for employer-terms exactly 1 is queued, for the employer owner and for no candidate

**AC11 · Administration page: publish, export, wrong roles** (browser test (Playwright))

- Given three versions of terms-of-service and one of privacy-policy exist; a Platform Administrator at aal2, a Platform Administrator at aal1, and a Trust & Safety Administrator
- When the administrator publishes version 4 of terms-of-service through the form (labelled fields slug, title, body, change summary and a draft checkbox), submits it once with an empty body, then uses Export all versions; the other two open the same page
- Then the empty body shows a field error and creates no version; the valid submission shows 'Published version 4'; the export downloads a JSON file with 5 entries, each holding slug, version, title, body, change_summary, is_draft and published_at; the aal1 administrator is redirected to the MFA page and the Trust & Safety Administrator receives the forbidden page, and neither sees the form or a file

**AC12 · Legal text is rendered as text** (browser test (Playwright))

- Given a version whose body contains '<script>window.hacked=1</script>' and '<img src=x onerror=window.hacked=1>'
- When a visitor opens the page
- Then both strings appear as literal text, no script runs, window.hacked is undefined and no CSP violation event fires

### Data and validation

- legal_documents.slug: matches ^[a-z0-9]+(-[a-z0-9]+)*$, 1 to 80 characters
- legal_documents.version: integer from 1, assigned by publish_legal_document as the highest version of the slug plus 1; unique with slug
- legal_documents.title: text, 3 to 200 characters
- legal_documents.body: text, 1 to 200000 characters, rendered escaped
- legal_documents.change_summary: text, 10 to 1000 characters (first version 'Initial version')
- legal_documents.published_at: timestamptz set by the server, never by the caller
- proposed: legal_documents.is_draft: boolean, true until legal counsel has approved the text
- consents.purpose: the document slug; consents.version: the document version; consents.action: granted or withdrawn
- audit.log.action for a publication: proposed: legal_document.publish
- notifications.kind legal_version, payload: proposed: slug, version, title

### States and transitions

- (none) -> Published as draft (Platform Administrator at aal2, publish_legal_document with is_draft = true)
- (none) -> Published as approved (Platform Administrator at aal2, publish_legal_document with is_draft = false, counsel approval recorded outside the system)
- Published (any) -> Superseded (system, automatically when a higher version of the same slug is published)
- Any version -> edited or deleted: not allowed for any role; a change, including approval of a draft text, is always a new version

### Roles and permissions

- Platform Administrator (admin) at aal2: may publish versions and export all versions
- Platform Administrator at aal1: denied (CHARA_FORBIDDEN)
- Trust & Safety Administrator (trust_safety), Verification Reviewer (verification_reviewer): denied publish and export
- Candidate, organisation owner, admin, member: may read published versions; may accept new versions for themselves through accept_consents; denied publish
- Anonymous visitor (anon): may read published versions only
- service_role: no direct table grants; no role may update or delete a version

### Objects

- table public.legal_documents(slug, version, title, body, change_summary, published_at), unique (slug, version); proposed: column is_draft
- function publish_legal_document (security definer, role admin and aal2, writes audit.record())
- proposed: view public.v_legal_current (security_invoker, one row per slug with the highest version, select for anon)
- tables public.consents, public.notifications; kind legal_version; function accept_consents; Edge Function notify
- table audit.log; page app/[lang]/(public)/legal/[slug]
- page app/[lang]/(admin)/admin (legal documents section, role admin, aal2); proposed: re-consent page under app/[lang]/(app)

### Open points and assumed defaults

- To be confirmed by CHARA (L7): which of the eighteen documents are needed at launch. Default assumed: the ten Phase 1 documents; publish_legal_document accepts any valid slug, so later documents need no code change and a page exists as soon as a row does.
- L9 is open: which documents need recorded acceptance. Default assumed: Terms of Service and Privacy Policy for everyone, Worker Terms for candidates, Employer Terms for employers, Subscription and Billing Terms at checkout. Re-consent and email apply to every document for which the user's latest consent row is granted; a document with no recorded acceptance queues no email and needs no re-consent.
- L5 and W7: until legal counsel approves a text its row is a DRAFT placeholder (is_draft true, banner shown). Default assumed: a draft is published like any version, so it also queues email and re-consent; is_draft is a proposed column added to the D2 columns.
- Body format is not defined. Default assumed: plain text with paragraphs separated by blank lines and lines starting '## ' as headings, always escaped.
- Default assumed: re-consent is enforced at login only (SOP FR-A8); sessions already open are not interrupted. Date format is the UTC date, for example 1 October 2026.
- Export format JSON is assumed; the KPI 'users re-consented within 30 days' is computed from consents and is not a screen in Phase 1.
- CHARA_INVALID_INPUT is a proposed stable error code; the email template and its delivery are covered by FR-I2.

## FR-H4 · Live statistics

> Home page statistics (vacancies, employers, candidates, countries) are computed from real data and hidden when a value is below 5.

### Acceptance criteria

**AC1 · Statistics shown on the home page** (browser test (Playwright))

- Given a refreshed snapshot with 15 open visible vacancies, 8 active employer organisations, 30 active candidates and 6 countries, and k = 5
- When an anonymous visitor opens /en
- Then the statistics block shows four labelled values (Vacancies 15, Employers 8, Candidates 30, Countries 6), each as text with its label in the same element group

**AC2 · Threshold boundary** (database test (pgTAP))

- Given Exact employer counts of 4 and of 5 and the setting k = 5
- When public.v_platform_counts is queried as anon after each count
- Then a count of 4 is returned as null and a count of 5 is returned as a number; the comparison is made on the exact count before any rounding

**AC3 · A single low value is hidden without a placeholder** (browser test (Playwright))

- Given Employers = 3 and the other three values at least 5
- When the home page is rendered
- Then three values are shown; there is no Employers label, no 0, no dash and no empty tile

**AC4 · All values low hides the block** (browser test (Playwright))

- Given all four values below 5, for example an empty production database
- When the home page is rendered
- Then the page returns HTTP 200 without a statistics heading or block, and the rest of the page is unchanged

**AC5 · Vacancy count uses open, visible, undeleted vacancies only** (database test (pgTAP))

- Given seven vacancies: open and visible, draft, paused, closed, filled, open with moderation_state hidden, open with org_suspended; plus one open and visible with deleted_at set
- When stats.platform_counts_mv is refreshed and read as postgres
- Then active_jobs is 1

**AC6 · Employers, candidates and countries are exact counts of real rows** (database test (pgTAP))

- Given 3 active and 1 suspended employer organisation; 4 candidates (account_kind worker) of which 1 is suspended and 1 has deleted_at set; 2 company users and 1 platform staff user; open visible vacancies in country_code DE (2), PL (1) and one paused vacancy in FR
- When stats.platform_counts_mv is refreshed and read as postgres
- Then employers = 3, workers = 2, countries = 2 (DE and PL); company users and staff are not counted as candidates; each value equals the direct aggregate query on the base tables

**AC7 · Candidate count is rounded to the nearest 10** (database test (pgTAP))

- Given Exact candidate counts in the snapshot of 14, 15 and 1234 (each at least k = 5)
- When the view is queried as anon
- Then it returns 10, 20 and 1230; employer, vacancy and country values are not rounded

**AC8 · Threshold comes from the settings** (database test (pgTAP))

- Given the setting stats_min_count is 5, then is changed to 10 by SQL, with an exact vacancy count of 9
- When the view is queried as anon after each setting
- Then with 5 the vacancy value is 9; with 10 it is null; a missing or invalid setting row falls back to 5

**AC9 · Scheduled refresh** (database test (pgTAP))

- Given the migrations applied
- When cron.job and the materialized view are inspected, then a vacancy is opened, the view read, the refresh run and the view read again
- Then an active job refresh-platform-counts exists with schedule */10 * * * *; the materialized view is populated at creation (a select works before the first job run) and has a unique index so refresh concurrently works; before the refresh the vacancy value is unchanged and after it the value is one higher

**AC10 · Visitors can read only aggregate numbers** (database test (pgTAP))

- Given the roles anon and authenticated
- When they select from public.v_platform_counts, from stats.platform_counts_mv and from public.profiles, and read the column list of the view
- Then the view is readable and has exactly the four Phase 1 value columns (active_jobs, employers, workers, countries); the materialized view and profiles are refused for anon; the view holds no name, identifier or per-record data

**AC11 · Failed refresh keeps the last values** (manual check)

- Given a deployed environment with a successful snapshot
- When a refresh failure is forced (for example by revoking the job owner's privilege on the source table), the home page and cron.job_run_details are checked, then the privilege is restored
- Then the home page still renders with the previous values, the failed run appears as failed in cron.job_run_details so the refresh success rate can be computed, and the next run succeeds

**AC12 · Display mapping, number format and query failure** (unit test (Vitest))

- Given the statistics mapper receives {active_jobs: 15, employers: null, workers: 1230, countries: null}, then an error result from the view
- When it builds the tiles
- Then the first input yields two tiles, Vacancies 15 and Candidates '1,230' (thousands separator from 1,000 upwards), and none for the null values; the error input yields no tiles, the error is logged and the home page still returns HTTP 200

### Data and validation

- stats.platform_counts_mv: Phase 1 columns countries, workers, employers, active_jobs (exact counts; later-phase columns of ARCHITECTURE.md section 9.4 are not exposed); refreshed every 10 minutes
- public.v_platform_counts: each value is null when the exact count is below k; the workers (candidate) count is rounded to the nearest 10 after the threshold test
- private.settings: proposed: key stats_min_count, integer 1 or more, default 5
- Counted sets: active_jobs = jobs with status open, moderation_state visible and deleted_at null; employers = organizations of type employer with status active; workers = profiles with account_kind worker, status active and deleted_at null; countries = distinct country_code of the counted vacancies
- No individual record, name or identifier is stored in or returned by the statistics

### Roles and permissions

- Anonymous visitor (anon) and authenticated users: may read public.v_platform_counts only
- No user role may read stats.platform_counts_mv or the base tables through the statistics
- pg_cron job (runs as postgres): refreshes the materialized view
- Platform Administrator (admin): changes the threshold setting only by a reviewed migration in Phase 1
- Trust & Safety Administrator (trust_safety), Verification Reviewer (verification_reviewer): no access beyond what visitors have

### Objects

- materialized view stats.platform_counts_mv with a unique index
- view public.v_platform_counts (select granted to anon and authenticated)
- pg_cron job refresh-platform-counts (*/10 * * * *)
- table private.settings (proposed: stats_min_count); proposed: function private.stats_min_count() (security definer, execute for anon and authenticated); tables public.jobs, public.organizations, public.profiles
- page app/[lang]/(public)/page (statistics block)

### Open points and assumed defaults

- The meaning of 'countries' is not defined in the sources. Default assumed: distinct countries of open, visible vacancies; CHARA may prefer including candidates' current countries.
- ARCHITECTURE.md section 9.4 rounds worker counts to the nearest 10 and takes k from settings with default 5; the default assumed is to apply both to the candidate count.
- Conflict in ARCHITECTURE.md section 9.4: a security_invoker view needs the caller to hold select on the materialized view, which would let anon read exact counts below k. Default assumed: v_platform_counts runs with its owner's rights (a documented exception to the security_invoker view rule), anon has no privilege on the materialized view, and k is read by a security definer function because anon cannot read private.settings. To be confirmed.
- Default assumed: all four values are Phase 1 values; recruitment, staffing, requirement and corridor counts are later phase and are not exposed.

## FR-H5 · Search engine readiness

> Pages have metadata, sitemap and robots files, and vacancies carry JobPosting structured data.

### Acceptance criteria

**AC1 · Metadata on every public page** (browser test (Playwright))

- Given the eight pages /en, /en/jobs, /en/pricing, /en/how-it-works, /en/trust-safety, /en/about, /en/contact and /en/imprint, the ten legal pages and one open vacancy
- When each page is requested (also /en/jobs?q=warehouse) and its head is read
- Then each has a non-empty title of at most 60 characters and a non-empty meta description of at most 160 characters; the description is 50 to 160 characters and different on each of the 18 static and legal pages; the canonical link is absolute, starts with NEXT_PUBLIC_SITE_URL and has no query string (for /en/jobs?q=warehouse it is the /en/jobs URL); og:title and og:description are non-empty

**AC2 · Vacancy page metadata and canonical** (browser test (Playwright))

- Given an open vacancy titled 'Warehouse Operator' of the organisation 'Example Logistics' with a 400-character description
- When /en/jobs/<id>?utm_source=x is requested
- Then the title contains 'Warehouse Operator' and 'Example Logistics' and is cut to 60 characters when longer; the description is the first 155 characters of the description as plain text; the canonical link is the absolute /en/jobs/<id> URL without the query string

**AC3 · Sitemap lists public pages and open vacancies only** (browser test (Playwright))

- Given Nine vacancies: open and visible (2), draft, paused, closed, filled, open and hidden by moderation, open with org_suspended, open with deleted_at set; ten legal slugs with a published version
- When /sitemap.xml is requested anonymously
- Then it is valid XML with 20 absolute URLs starting with NEXT_PUBLIC_SITE_URL: the eight pages /en, /en/jobs, /en/pricing, /en/how-it-works, /en/trust-safety, /en/about, /en/contact and /en/imprint, the ten legal pages and exactly the 2 open visible vacancies; each vacancy entry has a lastmod date equal to the date of jobs.updated_at; no URL of any other vacancy appears

**AC4 · Sitemap follows live data** (browser test (Playwright))

- Given a vacancy that is not in /sitemap.xml
- When the vacancy is opened, the sitemap requested, the vacancy paused (and, in a second run, hidden by moderation) and the sitemap requested again
- Then the URL appears after opening and disappears after pausing or hiding, with no rebuild or redeploy

**AC5 · Private areas never enter the sitemap** (unit test (Vitest))

- Given the sitemap entries built from seeded data
- When each URL path is checked
- Then no path starts with /en/dashboard, /en/org, /en/passport, /en/applications, /en/admin, /en/onboarding, /en/login, /en/signup, /en/verify-email, /en/forgot-password, /en/mfa, /auth or /api, and no URL contains a query string

**AC6 · Robots rules** (browser test (Playwright))

- Given NEXT_PUBLIC_SITE_URL is https://chara.example in the test environment
- When /robots.txt is requested anonymously
- Then it allows /, disallows /en/dashboard, /en/org, /en/passport, /en/applications, /en/admin, /en/onboarding, /en/login, /en/signup, /en/verify-email, /en/forgot-password, /en/mfa, /auth/ and /api/, and has the line 'Sitemap: https://chara.example/sitemap.xml'

**AC7 · Private pages carry noindex** (browser test (Playwright))

- Given Signed-in and signed-out requests to each private route (dashboard, org, passport, applications, admin, onboarding, login, signup, verify-email, forgot-password, mfa)
- When the response headers or head are read
- Then each response has X-Robots-Tag noindex, nofollow (or an equivalent robots meta tag), including the final page after the redirect of an anonymous request and the forbidden page of a wrong role; the eight public pages, the legal pages and an open vacancy have no noindex directive

**AC8 · JobPosting markup on an open vacancy** (browser test (Playwright))

- Given an open visible vacancy with title, description, city 'Hamburg', country_code DE, the employment_type for full time (value set by FR-C1), organisation display_name 'Example Logistics' and website https://example.com, created on 2026-09-01 UTC
- When /en/jobs/<id> is requested and the single script of type application/ld+json is parsed; then every other public page is requested
- Then the JSON is valid, @type is JobPosting, and it holds title, description as plain text, datePosted 2026-09-01, hiringOrganization (@type Organization, name 'Example Logistics', sameAs https://example.com), jobLocation with addressLocality Hamburg and addressCountry DE, and employmentType FULL_TIME; no other page has JobPosting markup; no validThrough is emitted

**AC9 · Salary, location and organisation fields in the markup** (unit test (Vitest))

- Given the structured-data builder receives vacancies with salary_min 12, salary_max 15, salary_currency EUR and salary_period hour; with only salary_max 3000, EUR and month; with no salary; with an employment_type that has no schema.org mapping; with city null; and an organisation without website
- When it builds each JobPosting
- Then baseSalary is a MonetaryAmount with currency EUR and a QuantitativeValue with minValue 12, maxValue 15 and unitText HOUR for the first, maxValue 3000 and unitText MONTH without minValue for the second, and is omitted for the third; employmentType is omitted for the unmapped value; addressLocality is omitted when city is null while addressCountry stays; sameAs is omitted without website; no value is currency-converted

**AC10 · Markup is limited to public fields and escaped** (unit test (Vitest))

- Given a builder input with title '</script><script>window.hacked=1</script>' and extra fields such as organization_id, created_by and applicant data
- When the markup is built and serialised
- Then the output contains only the whitelisted keys (title, description, datePosted, hiringOrganization, jobLocation, employmentType, baseSalary) and no id, user or applicant data; the serialised JSON escapes < as < so it cannot contain the string </script>

**AC11 · Hostile title does not run on the page** (browser test (Playwright))

- Given an open vacancy whose title is '</script><script>window.hacked=1</script>'
- When /en/jobs/<id> is loaded in a browser
- Then no extra script element exists, window.hacked is undefined and the title is shown as literal text

**AC12 · Validation and monitoring** (manual check)

- Given a release candidate with at least one open vacancy of each employment type, with and without salary
- When the vacancy page is checked in Google's Rich Results Test before release and Search Console is reviewed monthly
- Then the test reports a valid JobPosting with no errors; any Search Console error is logged with an owner and a fix date; the indexed-vacancy percentage is recorded each month

### Data and validation

- Page metadata: title at most 60 characters; description at most 160 characters (50 to 160 for static and legal pages); canonical absolute URL without query string; og:title, og:description
- Legal page metadata: title from the current version title; description from a lib/i18n/en.json template with title, version and date, unique per slug
- Vacancy page metadata: title from jobs.title and organizations.display_name; description = first 155 characters of jobs.description as plain text
- Sitemap entry: loc absolute URL from NEXT_PUBLIC_SITE_URL; lastmod = date of jobs.updated_at for vacancies, none for other pages
- JobPosting.title = jobs.title; description = jobs.description as plain text; datePosted = UTC date of jobs.created_at (ISO 8601)
- JobPosting.hiringOrganization.name = organizations.display_name; sameAs = organizations.website when set
- JobPosting.jobLocation: addressLocality = jobs.city when set; addressCountry = jobs.country_code (ISO 3166-1 alpha-2)
- JobPosting.employmentType: mapped from jobs.employment_type to a schema.org value; omitted when unmapped
- JobPosting.baseSalary: from salary_min, salary_max, salary_currency (ISO 4217) and salary_period (hour, month, year to HOUR, MONTH, YEAR); omitted without salary; no currency conversion
- validThrough is not emitted because a vacancy has no closing date; a closed vacancy returns 404 and leaves the sitemap
- The requirement stores no data

### Roles and permissions

- Anonymous visitor (anon) and search engines: may read the sitemap, robots file, public pages and JobPosting markup of open, visible vacancies
- Candidate, organisation owner, admin, member: same public rights; private pages stay behind login and noindex
- Platform Administrator (admin), Trust & Safety Administrator (trust_safety), Verification Reviewer (verification_reviewer): no special SEO function; administration pages are noindex
- No role can add a private page to the sitemap; it is generated from live data

### Objects

- app/sitemap.ts, app/robots.ts
- generateMetadata in the public pages and the vacancy page (proposed: app/[lang]/(public)/jobs/[id])
- proposed: lib/seo/job-posting.ts (JobPosting builder, pure function)
- proposed: next.config.ts headers() or proxy.ts rule for X-Robots-Tag on private routes
- tables public.jobs (status, moderation_state, deleted_at, created_at, proposed: updated_at), public.organizations(display_name, website), public.legal_documents
- env NEXT_PUBLIC_SITE_URL

### Open points and assumed defaults

- The jobs table has no published date, closing date or updated_at in the sources. Default assumed: datePosted = created_at, no validThrough, and a proposed updated_at column for lastmod.
- The list of employment_type values is set by FR-C1; the mapping to schema.org values is assumed and must be completed with that list.
- Default assumed: robots.txt blocks crawling and noindex covers private pages that are linked from elsewhere; the same rules apply to every environment.
- Default assumed: one sitemap file; the capacity target is 10,000 vacancies (NFR-P1), far below the protocol limit of 50,000 URLs per file. Splitting is added only if that target is raised.
- The public employer profile route (app/[lang]/(public)/companies in ARCHITECTURE.md) is not in FR-H1 and is not in the sitemap unless FR-C4 creates it.
