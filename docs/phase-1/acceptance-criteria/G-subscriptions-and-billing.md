# Group G: Subscriptions and billing

## FR-G1 · Plans as data

> Three employer plans (Basic, also called Starter; Professional; Enterprise) have their prices, limits, features and trial length (default 30 days) stored as administrator-editable configuration records, not code; Enterprise limits can be set per organisation. Prices are in EUR, exclusive of VAT; the base plan costs EUR 39 per month. The records can be extended with further organisation types and paid services without redesign (to be confirmed by CHARA: prices of the Professional and Enterprise plans; display name of the lowest plan).

### Acceptance criteria

**AC1 · Seeded plan records** (database test (pgTAP))

- Given a database rebuilt from all migrations and seeds
- When billing.plans is read, and the plan seed file is then loaded a second time
- Then there are exactly 4 rows: free_employer (price_minor 0, is_public false), employer_starter (name Basic, price_minor 3900, is_public true), employer_professional (name Professional, price_minor 7900, is_public true) and employer_enterprise (name Enterprise, is_public false); every row has org_type employer, currency EUR and interval month; trial_days is 30 on the three paid plans and 0 on free_employer; the second load leaves 4 rows with unchanged values

**AC2 · Seeded limits and features contain Phase 1 keys only** (database test (pgTAP))

- Given the seeded database
- When billing.plan_limits and billing.plan_features are read
- Then active_jobs is 3, 15 and 50 and members is 1, 5 and 15 for employer_starter, employer_professional and employer_enterprise; free_employer has active_jobs 0 and members 0; all 4 plans have both limit rows with a non-null value (100 % defined); shortlisting exists for the three paid plans; analytics_advanced exists for employer_professional and employer_enterprise only; free_employer has no feature row; no limit row uses a later-phase key (active_requirements, messages_per_month, candidate_submissions_per_month, partner_invitations_per_requirement) and no feature row uses a later-phase key (advanced_worker_search, advanced_partner_search, chara_match, corridors, available_workforce_search, job_order_access, multi_partner_invitation, analytics_enterprise, multi_country_requirements, priority_visibility)

**AC3 · Plan values change without a code change** (database test (pgTAP))

- Given an organisation O with a trialing employer_starter subscription and the seeded data
- When a migration updates billing.plan_limits (employer_starter, active_jobs) to 4 and billing.plans (employer_starter) to trial_days 14 and name 'Standard', and no function is redefined
- Then Right after the migration commits, private.org_limit(O, 'active_jobs') returns 4 and public.v_plans shows trial_days 14 and name 'Standard' for employer_starter; the subscription row of O is unchanged

**AC4 · Plan tables cannot be written through the API roles** (database test (pgTAP))

- Given Sessions for an organisation owner at aal2, a Platform Administrator (admin) at aal2, a Trust & Safety Administrator (trust_safety), a Verification Reviewer (verification_reviewer), an authenticated candidate, and anon
- When each tries insert, update, delete and truncate on billing.plans, billing.plan_limits and billing.plan_features, and insert, update and delete on public.v_plans
- Then every attempt fails with permission denied and no row changes; anon and authenticated hold SELECT only on the three tables and on the view; anon and authenticated hold no privilege at all on billing.provider_events, billing.customers and billing.orders; no public RPC that edits plans, limits, features or trial_days exists (checked against pg_proc)

**AC5 · Plans are readable through the public view, only when visible** (database test (pgTAP))

- Given an anonymous visitor, a member of an organisation on free_employer (lapsed) and a member of an organisation on employer_enterprise
- When each selects from public.v_plans (security_invoker) and directly from billing.plans
- Then Anon sees only employer_starter and employer_professional, each with code, name, price_minor, currency, interval, trial_days, limits and features; the lapsed member additionally sees free_employer and the Enterprise member additionally sees employer_enterprise (the plan used by their own organisation, so that plan_name in public.v_my_subscription resolves) but not each other's plan; the view has the security_invoker option and no column holding a provider product or price reference (checked against information_schema); direct reads of rows that are not visible return nothing

**AC6 · Plan data constraints** (database test (pgTAP))

- Given the seeded database
- When a migration tries to insert or update with price_minor -1, currency 'QQQ' (not in public.currencies), interval 'week', trial_days -1, trial_days 366, a plan code 'Bad Code' (not lower-case snake_case), a plan_limits row with limit_value -1, a duplicate (plan_code, limit_key), and a plan_limits row for a plan code that does not exist
- Then each statement fails with a constraint error (check, foreign key or primary key) and no row is written; trial_days 0 and 365 and limit_value NULL (unlimited) are accepted

**AC7 · Per-organisation Enterprise limits** (database test (pgTAP))

- Given the migration that creates billing.organization_limit_overrides has run; organisations E1 and E2 are on employer_enterprise (active_jobs 50) and one organisation is on employer_professional; one override row (E1, active_jobs, 80) exists
- When private.org_limit is called for E1, E2 and the Professional organisation, then the override row is deleted, then a negative limit_value and a second row for (E1, active_jobs) are inserted
- Then E1 returns 80, E2 returns 50, the Professional organisation returns 15; after the delete E1 returns 50; the negative value and the duplicate key are rejected by constraints; anon and authenticated hold no privilege on the table

**AC8 · Records extend to other organisation types and paid services without schema change** (database test (pgTAP))

- Given the seeded database
- When a migration inserts a plan with org_type recruitment_company, code recruitment_partner and price_minor 4900 with limit rows, and an orders row with kind 'boost' and a sku in sku_or_plan
- Then both inserts succeed with no DDL; the pricing and billing queries that filter org_type = 'employer' still return only the 4 employer plans; organization_type and orders.kind accept values beyond the Phase 1 ones

**AC9 · Plan changes are audited** (database test (pgTAP))

- Given the audit row trigger on billing.plans, billing.plan_limits, billing.plan_features and billing.organization_limit_overrides
- When a migration changes employer_starter price_minor from 3900 to 4200, deletes one plan_features row and inserts one plan_limits row
- Then one audit.log row per change is written (action billing.plan_changed, entity_type plan, actor_id null for the migration role) with the plan code, the table name and the before and after values in metadata, for example before price_minor 3900 and after 4200

**AC10 · Stripe mirror script creates and updates products and prices** (unit test (Vitest))

- Given Plan records and a stubbed Stripe snapshot with no products
- When the sync script runs twice, then employer_starter price_minor is changed to 4200 and the script runs again, then a run is made in which the Stripe call for the second plan fails
- Then the first run creates one product and one EUR monthly price (tax_behavior exclusive, metadata plan_code set) for employer_starter (3900) and employer_professional (7900) only, not for free_employer and not for the non-public Enterprise plan, and stores the provider identifiers; the second run makes 0 changes; the third run creates exactly 1 new price, archives the old one and stores the new identifier; in the failing run the script exits non-zero, the identifier of the plan already created stays stored and the next successful run creates only the missing object

**AC11 · Go-live check on plans** (unit test (Vitest))

- Given Plan records, a stubbed Stripe snapshot and the setting entitlements_enforced
- When the go-live check runs with one sold plan missing a limit row, then with one sold plan lacking a stored price reference, then with a Stripe amount different from price_minor, then with entitlements_enforced false, then with all conditions met
- Then each of the first four runs exits non-zero and names the plan or setting that failed; the last run exits 0 because every sold plan (is_public true) has both limit rows, a stored price reference and a Stripe amount equal to price_minor, and entitlements_enforced is true

### Data and validation

- plans.code: text primary key, lower-case snake_case, 3 to 64 characters; Phase 1 values free_employer, employer_starter, employer_professional, employer_enterprise; plan codes never change
- plans.org_type: organization_type enum, required; Phase 1 plans use employer
- plans.name: text, required, 1 to 60 characters (display name; Basic or Starter is open, OPEN_QUESTIONS.md C13)
- plans.price_minor: integer, required, >= 0, EUR minor units, exclusive of VAT (3900 = EUR 39.00)
- plans.currency: text, required, foreign key to public.currencies (ISO 4217); EUR only in Phase 1
- plans.interval: text, required, check in ('month') in Phase 1
- plans.trial_days: integer, required, 0 to 365, default 30 for sold plans
- plans.is_public: boolean, required; false for free_employer and employer_enterprise
- plans.contact_sales and plans.is_default_trial: boolean, required, default false; plans.sort: integer, required
- plan_limits: primary key (plan_code, limit_key); plan_code foreign key to plans; limit_key in active_jobs, members in Phase 1; limit_value integer >= 0, NULL means unlimited
- plan_features: primary key (plan_code, feature_key); plan_code foreign key to plans; feature_key in shortlisting, analytics_advanced in Phase 1
- organization_limit_overrides(organization_id, limit_key, limit_value): later phase; unique (organization_id, limit_key); limit_value integer >= 0; takes precedence over the plan row
- proposed: billing.plan_provider_refs(plan_code, provider, provider_product_ref, provider_price_ref): written only by the sync script; never exposed through views
- Prices: EUR, exclusive of VAT; EUR 39 per month for the base plan

### Roles and permissions

- Platform Administrator (admin): owns plan changes; in Phase 1 makes them only through a reviewed migration, no console screen and no RPC; denied direct table writes
- Trust & Safety Administrator, Verification Reviewer: denied any plan change
- Organisation owner, admin, member: may read public plans and the plan used by their own organisation through public.v_plans; denied any write
- Candidate (worker) and anonymous visitor: may read public plans through public.v_plans only; denied any write
- billing_owner: owns the billing schema; no privilege on verification tables
- service_role: no table grants in billing

### Objects

- billing.plans
- billing.plan_limits
- billing.plan_features
- billing.organization_limit_overrides (later phase)
- public.v_plans
- public.v_my_subscription
- public.currencies
- billing.subscriptions (plan_code)
- billing.orders (kind, sku_or_plan)
- private.org_plan_code
- private.org_limit
- private.has_feature
- enum organization_type
- audit.log
- audit.record()
- private.settings (entitlements_enforced)
- supabase/seeds/ref (plan seed)
- supabase/migrations (reviewed plan changes)
- CODEOWNERS on supabase/**
- proposed: billing.plan_provider_refs
- proposed: scripts/sync-stripe-plans.mjs (create and update Stripe products and prices; go-live check)
- proposed: audit row trigger on billing.plans, plan_limits, plan_features, organization_limit_overrides (action billing.plan_changed)

### Open points and assumed defaults

- C10 (open): the Professional price 7900 comes from the pricing source and is not confirmed; the Enterprise price is not stated. Default assumed: 7900, and employer_enterprise is seeded is_public false with price_minor 0 as a placeholder that is never shown or sent to Stripe until a price is stated.
- C13 (open): display name of the lowest plan, Basic or Starter. Default assumed: the seed uses Basic (AC3 renames it to prove it is data); the plan code employer_starter does not change.
- P9 (open): screens and RPCs for editing plans, limits, features and trial_days are later phase. Default assumed: a reviewed migration (CODEOWNERS on supabase/**) is the only way to change them in Phase 1.
- C16 (open): tier assignment of features. Default assumed: shortlisting on every paid plan, analytics_advanced on Professional and Enterprise; a plan lists only features delivered in the current release.
- The audit trigger on plan tables is proposed to meet the SOP control 'audited changes'; ARCHITECTURE section 12 lists row triggers for billing events only.
- billing.organization_limit_overrides is later phase in ARCHITECTURE section 10.1 while the requirement text asks for per-organisation Enterprise limits; AC7 applies when the table is created, and Enterprise is not sold in Phase 1 (C10).
- The stored provider identifiers are not in the architecture column list of billing.plans, so billing.plan_provider_refs is proposed. The Stripe price carries metadata plan_code so that the webhook adapter can name the plan (FR-G3).
- The trial_days range 0 to 365 and the plan code length are proposed validation bounds, not owner decisions.
- The database role the sync script uses is not specified. Default assumed: an operator's direct database connection as a member of billing_owner, never PostgREST, an Edge Function or service_role.

## FR-G2 · Checkout and portal

> Subscription purchase uses Stripe Checkout and the Stripe Customer Portal for card changes, cancellation and invoices; Stripe Tax calculates VAT; billing country and VAT ID are collected. The free trial requires payment details, is granted once per legal entity (identifier of FR-A2; otherwise checkout starts without a trial) and converts automatically to the selected paid plan when it ends. Before the trial begins the user is shown the trial period, the price after the trial, the billing frequency, the automatic conversion and the cancellation procedure (to be confirmed by CHARA: whether payment details are collected at registration or at checkout when the trial starts).

### Acceptance criteria

**AC1 · Owner starts a trial through hosted checkout** (browser test (Playwright))

- Given Owner Ana of organisation Acme GmbH (slug acme, no subscription, TOTP enrolled, session at aal2) on /en/org/acme/billing, with the null billing provider in use
- When she chooses the Basic plan, enters billing country DE, VAT ID DE123456789 and registration number HRB 12345, ticks the Subscription and Billing Terms box and presses Continue to payment, and the test then posts the signed null-provider events checkout.completed and subscription.activated (trialing) for her organisation
- Then the browser is redirected to the provider's hosted checkout URL; no CHARA page contains a card input (no autocomplete cc-number, cc-exp or cc-csc) and no CHARA request carries card data; billing.customers holds billing_country DE, the VAT ID and the registration number; after the events are applied, the billing page shows plan Basic, status Trial and a trial end 30 days after the start

**AC2 · Disclosure before the redirect** (browser test (Playwright))

- Given the confirmation step that precedes the redirect, for an organisation eligible for a trial, with plans.trial_days 30 for employer_starter
- When the step is rendered, then trial_days is changed to 14 and the step is rendered again, then it is rendered for an organisation that already had a trial
- Then for an eligible organisation the step states the trial period (30 days, then 14 days), the price after the trial (EUR 39.00 per month, excluding VAT), the billing frequency (monthly), that the trial converts automatically to the paid plan, and how to cancel (Manage billing, before the trial ends); for the organisation that already had a trial it states that there is no free trial and that the first payment is due at once, and shows no trial period; no redirect happens before she presses Continue to payment

**AC3 · Checkout form: terms gate, labels, validation, keyboard** (browser test (Playwright))

- Given the confirmation step for organisation Acme
- When the terms box is left unticked, then ticked; both VAT ID and registration number are left empty and she submits; VAT ID 'DE12' is entered; the form is used with the keyboard only; Continue to payment is activated twice in quick succession
- Then the terms box carries a link to the current Subscription and Billing Terms and Continue to payment stays disabled until it is ticked; the fields are labelled Billing country, VAT ID and Company registration number; an invalid or missing field shows its error text next to it and receives focus; every control is reachable with Tab and Enter; the button shows a loading state, and the double activation creates one checkout session and one billing.checkout_started audit row

**AC4 · Terms acceptance and checkout start are recorded** (database test (pgTAP))

- Given Subscription and Billing Terms published at version N (and version N-1 earlier), and an owner at aal2 of organisation O
- When billing_checkout_start is called with accepted version N, then with version N-1, with no version, and in a database where no version of the terms is published
- Then the first call writes one consents row (user_id the caller, purpose subscription_billing_terms, version N, action granted) and one audit.log row billing.checkout_started (actor the owner, entity_type organization, entity_id O, metadata plan_code and trial_days, without VAT ID, registration number or card data); each of the other calls raises an error (detail terms_version_mismatch or terms_not_published) and writes no consents row, no audit row and no billing.customers row

**AC5 · Role, two-step verification and sign-in checks** (database test (pgTAP))

- Given Organisation O with an owner and an admin at aal2, a member, an owner whose session is aal1, an owner of another organisation, a Platform Administrator who is not a member of O, and an anonymous caller
- When each calls billing_checkout_start(O, 'employer_starter', 'DE', 'DE123456789', 'HRB 12345', current terms version)
- Then the owner and the admin at aal2 succeed; the member, the other organisation's owner and the Platform Administrator raise CHARA_FORBIDDEN (42501); the aal1 owner raises CHARA_FORBIDDEN with detail mfa_required; the anonymous caller is refused with permission denied because anon has no EXECUTE; every refusal leaves billing.customers, consents and audit.log unchanged

**AC6 · Invalid plan or tax input is refused** (database test (pgTAP))

- Given an owner at aal2
- When billing_checkout_start is called with plan employer_enterprise or free_employer, with an unknown plan code, with billing country 'XX', 'DEU' or null, with both VAT ID and registration number empty, with VAT ID 'DE12', and with a registration number of 3 or 33 characters; and then with valid boundary values (VAT ID of 8 and of 14 characters after normalisation, registration number of 4 and of 32 characters)
- Then a plan that is not sold raises CHARA_FORBIDDEN with detail plan_not_sold, an unknown code raises CHARA_FORBIDDEN with detail unknown_plan, each invalid country or identifier raises an invalid-input error (22023) with the field name in the detail; no row is written and no provider call is made; the boundary values are accepted

**AC7 · One free trial per legal entity** (database test (pgTAP))

- Given Organisation A (billing country DE, registration number HRB 12345, VAT ID DE123456789) has one billing.trial_grants row per identifier
- When Organisation B starts checkout with registration number 'hrb-12345' and country DE, organisation C with VAT ID 'DE 123 456 789', organisation E with a new registration number and the VAT ID of A, organisation A itself after its subscription was canceled, and organisation D with new identifiers, each for employer_starter
- Then for B, C, E and A the RPC returns trial_days 0 and for D it returns 30; identifiers are compared after upper-casing and removing spaces, dots, hyphens and slashes; the RPC itself writes no billing.trial_grants row

**AC8 · Checkout session parameters** (unit test (Vitest))

- Given providers/stripe.ts createCheckout with org id O, plan price reference price_basic, trialDays 30, no customerRef and return URLs on the app origin
- When the session parameters are built, then built again with trialDays 0, with customerRef cus_1, and with a successUrl on another origin
- Then mode is subscription, one line item with the plan's price reference and quantity 1, payment_method_collection always, subscription_data.trial_period_days 30, client_reference_id and subscription_data.metadata.org_id equal O, automatic_tax enabled, billing address collection required, tax ID collection enabled, success and cancel URLs equal to the app origin plus /en/org/acme/billing; with trialDays 0 the trial field is absent; with customerRef the customer is cus_1 and no new customer is created; the foreign-origin URL throws and no session is created

**AC9 · Checkout function verifies the caller and fails safely** (unit test (Vitest))

- Given the billing-checkout handler with a provider spy and an RPC stub
- When it receives a request with no Authorization header, with an expired JWT, and with the publishable key as bearer; then a valid user JWT whose body also contains a customer reference and return URLs; then a valid request while createCheckout throws
- Then the first three return 401 and call neither the RPC nor the provider; the valid request calls billing_checkout_start with a client scoped to that JWT (never the secret key), uses the customer reference and the return URLs returned by the RPC and ignores those in the body, reads and writes no table directly, and answers with the redirect URL only; when createCheckout throws the function answers 502 with a generic message and no billing row is created

**AC10 · Portal access rules and audit** (database test (pgTAP))

- Given Organisation O with a customer reference, a lapsed organisation Q with a customer reference and only canceled subscriptions, organisation P that never checked out, an owner at aal2, an admin at aal2, a member, an aal1 owner and an owner of another organisation
- When each calls billing_portal_start for O, the owner calls it for Q and for P
- Then the owner and the admin at aal2 receive the customer reference of O, and the owner receives that of Q; the member, the aal1 owner and the other organisation's owner raise CHARA_FORBIDDEN; the call for P raises CHARA_FORBIDDEN with detail no_customer; each successful call writes one audit.log row billing.portal_opened (entity_type organization, entity_id the organisation); refused calls write no audit row

**AC11 · Return from the hosted pages** (browser test (Playwright))

- Given Owner Ana at aal2 of an organisation with a customer reference, and a second owner without one, with the null provider
- When the second owner opens the hosted checkout and cancels, and Ana presses Manage billing and later returns
- Then after cancelling, the second owner lands on the billing page, which shows the plan choice unchanged and a notice that no payment was taken, and no subscription row and no billing.trial_grants row exist; Ana is redirected to the portal session created for her organisation's customer only, with the billing page as return URL, and the billing page loads on return without error

**AC12 · Stripe Tax computes the VAT** (manual check)

- Given Stripe test mode with Stripe Tax enabled, the CHARA legal entity's tax registrations set up in Stripe, and the Basic plan price EUR 39.00
- When Test checkouts are completed by a customer in the legal entity's home country without a VAT ID, and by a business in another EU country with a valid VAT ID
- Then the first checkout shows VAT at that country's standard rate on EUR 39.00 (for example 19 % gives EUR 7.41 VAT and EUR 46.41 in total, and the stored order has tax_minor 741); the second shows reverse charge with 0 % VAT and the VAT ID on the invoice

### Data and validation

- plan_code: required, one of the plans with is_public true, price_minor > 0 and contact_sales false for the organisation's org_type (Phase 1: employer_starter, employer_professional)
- billing_country: required, ISO 3166-1 alpha-2 present in public.countries, upper-cased
- vat_id: optional; after normalisation (upper-case, spaces, dots, hyphens and slashes removed) 2 letters followed by 6 to 12 letters or digits (8 to 14 characters); verified by Stripe
- registration_number: optional; 4 to 32 letters or digits after the same normalisation; at least one of vat_id and registration_number is required (legal-entity identifier, FR-A2; pre-filled when already recorded there, the submitted value is the one used)
- terms_version: required, must equal the current published version of the Subscription and Billing Terms (public.legal_documents)
- billing.customers(organization_id unique, provider, customer_ref, billing_country, vat_id, registration_number, legal_address): written by billing_checkout_start; customer_ref is set by the webhook (FR-G3)
- proposed: billing.trial_grants(identifier_key text primary key, organization_id, granted_at): identifier_key is reg:<country>:<normalised registration number> or vat:<normalised VAT ID>; written when the first trialing subscription is applied (FR-G3)
- trial_days returned to the caller: plans.trial_days when none of the organisation's identifier keys is in billing.trial_grants, otherwise 0
- success and cancel return URLs: fixed to /[lang]/org/[slug]/billing on the app origin, never taken from the request

### States and transitions

- (no subscription or only Cancelled rows) -> Trialing (webhook, after checkout with a trial; a new row is created, old Cancelled rows are kept)
- (no subscription or only Cancelled rows) -> Active (webhook, after checkout without a trial)

### Roles and permissions

- Organisation owner: may start checkout and open the portal, at aal2 only
- Organisation admin: may start checkout and open the portal, at aal2 only
- Organisation member: denied checkout and portal
- Owner or admin of another organisation: denied
- Candidate (worker): denied (FR-G6)
- Platform staff (admin, trust_safety, verification_reviewer) who are not members of the organisation: denied
- Anonymous: denied
- billing-checkout Edge Function: acts with the caller's JWT only; no direct table access

### Objects

- app/[lang]/(app)/org/[slug]/billing (checkout confirmation step and return states)
- Edge Function billing-checkout
- public.billing_checkout_start (RPC)
- supabase/functions/_shared/billing/provider.ts (createCheckout, createPortal)
- supabase/functions/_shared/billing/providers/stripe.ts
- supabase/functions/_shared/billing/providers/null.ts
- billing.customers
- billing.plans
- billing.subscriptions
- billing.orders
- public.consents
- public.legal_documents
- public.countries
- audit.log
- audit.record()
- private.is_aal2
- billing-webhook (activates the trial, FR-G3)
- proposed: public.billing_portal_start (RPC, role and aal2 check, audit, returns the customer reference)
- proposed: billing.trial_grants
- proposed: private.normalize_legal_identifier(text)
- proposed: consents purpose subscription_billing_terms
- proposed: CheckoutInput fields priceRef and trialDays (ARCHITECTURE section 10.2 has neither)
- proposed: audit actions billing.checkout_started and billing.portal_opened

### Open points and assumed defaults

- C15 (open, needs owner confirmation): the reply says payment details are collected at registration. Default assumed: the card is collected at checkout, before the trial starts; an organisation exists on free_employer without a card (D4).
- C14 (open): which legal-entity identifier is mandatory per country and how it is validated. Default assumed: at least one of registration number and VAT ID, format rules as in the data list, uniqueness through billing.trial_grants; identifiers of the same entity given in different forms by different organisations are not linked.
- L9 (open): which legal documents need recorded acceptance at checkout. Default assumed: the Subscription and Billing Terms only.
- C10 (open): Enterprise is not sold, so checkout refuses it. Default assumed: not sold until its price is stated.
- C7 and L1 (open): prices are EUR exclusive of VAT; the home country of the CHARA legal entity is not decided, so AC12 gives the German rate only as an example and covers the home-country and intra-EU cases; tax treatment outside the EU follows the accounting set-up agreed with the owner's advisers.
- The trial grant is written when the first trialing subscription is applied, so two organisations with the same identifier that both open Checkout before either completes can both receive a trial; the second application is still applied and raises an operations alert (FR-G3 AC4).
- The portal RPC, the trial ledger, the consent purpose, the audit action names and the error details (plan_not_sold, unknown_plan, mfa_required, no_customer, terms_version_mismatch, terms_not_published) are proposed; ARCHITECTURE section 5.5 lists only billing_checkout_start and the codes CHARA_FORBIDDEN, CHARA_LIMIT_REACHED and CHARA_FEATURE_NOT_IN_PLAN. billing-checkout also serves the portal action.
- Edge Function and adapter tests run under deno test (ARCHITECTURE section 14.4); they are labelled vitest here as the nearest of the four test types because they are pure-logic tests.
- ARCHITECTURE section 12 sets form-action 'self' in the CSP; AC1 must confirm that the redirect to the hosted checkout is not blocked by it.
- Stripe and Resend are not available until O7; checkout is built against the null provider and marked not verified against live Stripe in the pull request.

## FR-G3 · Webhook processing

> Stripe events are received, verified, stored once (idempotent) and applied to the subscription record.

### Acceptance criteria

**AC1 · Signature verification and rejection** (unit test (Vitest))

- Given billing-webhook configured for the Stripe provider with secret S, a stub for billing_ingest_event and audit_record_external, Stripe-style headers (t, v1 = HMAC-SHA256 of t.rawBody), and the null-provider header x-chara-signature (HMAC-SHA256 of rawBody with BILLING_WEBHOOK_SECRET)
- When Requests arrive with a valid signature (t = now), body changed by one byte or re-serialised JSON, signature made with another secret, missing header, no v1 value, t = now-301 s, t = now-299 s, and a request carrying only a correctly signed x-chara-signature
- Then Valid requests and t = now-299 s are accepted (verification on the raw body); every other case returns 401, never calls billing_ingest_event, and calls audit_record_external exactly once with action billing.webhook_rejected and a reason, without the payload and without an event id taken from the body; the response body gives no detail; the null-provider header is refused while the function is configured for Stripe, and with the null provider configured the header with a valid HMAC is accepted and a missing or wrong one returns 401

**AC2 · Duplicate delivery changes nothing** (database test (pgTAP))

- Given Event evt_1 (customer.subscription.updated) already stored and applied
- When billing_ingest_event is called again with the same provider and provider_event_id but a different payload, and billing_apply_event is called for it again
- Then billing.provider_events still has exactly 1 row for evt_1 with the original payload; billing_ingest_event returns the id of the existing row; the subscription row, the notifications and audit.log are unchanged

**AC3 · Linking works in either arrival order** (database test (pgTAP))

- Given Organisation O with a billing.customers row without customer_ref, a checkout.completed event (client_reference_id O, customer cus_1, subscription sub_1) and a subscription.activated event (metadata org_id O, sub_1, trialing, employer_starter)
- When the two events are applied in the order checkout first, and in a fresh database in the order subscription first
- Then in both runs billing.customers.customer_ref is cus_1 and there is exactly one billing.subscriptions row with provider_customer_ref cus_1, provider_subscription_ref sub_1, status trialing and plan employer_starter; no event is in status error

**AC4 · Subscription events upsert status, plan and dates and record trial grants** (database test (pgTAP))

- Given Stripe prices whose metadata plan_code is employer_starter and employer_professional; organisation O with a VAT ID and a registration number in billing.customers; organisation O2 with the same registration number
- When subscription.activated (trialing, employer_starter, trial end 2026-11-04T10:00Z, current period end 2026-11-04T10:00Z) is applied for O; subscription.updated (employer_professional, active, current period end 2026-12-04T10:00Z, later provider_created_at) is applied for O; then subscription.activated (trialing) is applied for O2
- Then after the first the row has plan employer_starter, status trialing and that trial_ends_at, and billing.trial_grants has one row per identifier of O; after the second the same row has plan employer_professional, status active and current_period_end 2026-12-04T10:00Z, there is still exactly one non-canceled row for O, last_provider_event_at equals the newest provider_created_at and the trial grants are unchanged; the third event is applied (O2 status trialing), no grant row of O is changed and one operations alert is raised in private.security_events

**AC5 · Out-of-order event is marked stale** (database test (pgTAP))

- Given a subscription with status active and last_provider_event_at 2026-11-05T12:00Z
- When a subscription.updated event (status past_due) with provider_created_at 2026-11-05T11:59Z is applied
- Then the event status becomes stale, the subscription row keeps status active, last_provider_event_at does not move back, no email is queued and no billing.event_applied audit row is written

**AC6 · Webhook function outcomes after ingest** (unit test (Vitest))

- Given the billing-webhook handler with stubs for billing_ingest_event and billing_apply_event and a provider stub whose current subscription sub_1 has status active and plan employer_starter
- When billing_apply_event reports stale; then it raises a transient database error; then billing_ingest_event itself fails
- Then for stale the function fetches sub_1 from the provider once, normalises it with providerCreatedAt set to the fetch time, ingests it under the synthetic event id refetch:sub_1:<fetch time>, applies it and answers 200; for the apply error it answers 200 because the stored event is owned by the retry job; when ingest fails it answers 500 so that Stripe redelivers; the database layer makes no outbound call; log lines contain event ids and never payloads

**AC7 · Unknown price is an error and is not retried** (database test (pgTAP))

- Given a subscription event whose price has no plan_code metadata or a plan_code that is not in billing.plans
- When billing_apply_event runs and then billing.retry_failed_events() runs 3 times
- Then the event has status error with error unknown_plan, no subscription row is created or changed, exactly one operations alert (private.security_events and the notify alert) is raised, the webhook answered 200, and the retry job never picks the event up again

**AC8 · Unresolved organisation is retried every 5 minutes, then escalated; jobs are scheduled** (database test (pgTAP))

- Given an invoice event whose organisation is not yet linked, received at 10:00, and billing.retry_failed_events() scheduled with pg_cron
- When in case 1 the link appears at 10:12 (checkout.completed applied) and the job runs at 10:15; in case 2 the link never appears and the job runs every 5 minutes until 11:05; cron.job is inspected
- Then Case 1: the event stays received until the 10:15 run and then has status applied; case 2: the runs at 10:05 to 10:55 leave it received without an alert, the 11:00 run (age of at least 60 minutes) sets status error with error org_not_linked and raises exactly one alert; an event that failed for a transient reason follows the same rule; cron.job holds retry_failed_events with the schedule */5 * * * * and one weekly entry for the reconciliation (AC12)

**AC9 · Every applied event is audited; trial_will_end queues one email** (database test (pgTAP))

- Given Organisation O with an owner, an admin and a member, and one event of each type (checkout completed, subscription created, updated, deleted, invoice paid, invoice payment failed, trial will end)
- When each is applied once, then a duplicate, a stale event and an error event are processed
- Then each applied event writes exactly one audit.log row billing.event_applied with metadata event_id, kind, organization_id, from_status and to_status; duplicate, stale and error events write no such row; the trial_will_end event queues exactly one trial_ending notification, addressed to the owner only, and its duplicate queues none

**AC10 · Billing functions and payloads are confined** (database test (pgTAP))

- Given the migrated database
- When Privileges are inspected for anon, authenticated (including sessions of a Platform Administrator and a Trust & Safety Administrator), public, service_role and billing_owner
- Then billing_ingest_event and billing_apply_event are owned by billing_owner with EXECUTE for service_role only; anon, authenticated and public have none; service_role holds no table privilege in billing, audit or public; billing_owner holds SELECT on public.organizations and no privilege on public.verifications* tables and no direct INSERT, UPDATE or DELETE on any table in public or audit (it writes there only through definer functions); authenticated users cannot read billing.provider_events and cannot insert, update or delete billing.subscriptions; every billing table has RLS enabled and forced with the billing_owner policy

**AC11 · Stripe payloads are normalised** (unit test (Vitest))

- Given Sample Stripe payloads for checkout.session.completed, customer.subscription.created, .updated, .deleted, .trial_will_end, invoice.paid, invoice.payment_failed, and for charge.succeeded and customer.updated
- When providers/stripe.ts normalize is called on each
- Then they yield checkout.completed (orgId from client_reference_id), subscription.activated, subscription.updated, subscription.canceled, subscription.trial_will_end, payment.succeeded (purpose subscription, with the Stripe subscription status, amount, currency, tax amount, invoice reference and payment reference) and payment.failed; planCode is read from the price metadata plan_code; orgId comes from the subscription metadata org_id for every kind except checkout; every event carries providerCreatedAt from the Stripe event time; unsupported types return an empty list and are acknowledged with 200 without being stored

**AC12 · Weekly reconciliation finds differences** (unit test (Vitest))

- Given a list of Stripe subscriptions and the billing.subscriptions records, differing by one missing record, one extra record, one status mismatch and one plan mismatch
- When the reconcile function compares them, and then compares two identical lists
- Then the first run returns exactly 4 differences, each with its kind (missing_record, extra_record, status_mismatch, plan_mismatch) and subscription reference, and raises one alert per difference; the second run returns 0 differences and raises none

### Data and validation

- provider_events.provider: text, required; provider_event_id: text, required; unique (provider, provider_event_id)
- provider_events.kind: text, required (normalised kind)
- provider_events.payload: jsonb, required; never readable by anon or authenticated; retention default 13 months (OPEN_QUESTIONS.md L6)
- provider_events.signature_valid: boolean, true for every stored row (an event with an invalid signature is never stored)
- provider_events.provider_created_at: timestamptz, required; received_at: timestamptz default now()
- provider_events.status: received, applied, stale or error; applied_at set when applied; error: reason code (unknown_plan, org_not_linked, transient) set when status is error
- NormalizedEvent.providerCreatedAt: ISO time of the provider event, required on every event
- subscriptions.last_provider_event_at: creation time of the newest applied event
- orgId: taken from subscription metadata org_id, or client_reference_id for checkout.session.completed
- planCode: taken from the Stripe price metadata plan_code set by the sync script (FR-G1)
- Stripe signature tolerance: 300 seconds

### States and transitions

- received -> applied (billing_apply_event, event valid, organisation resolved, plan known)
- received -> stale (billing_apply_event, event older than last_provider_event_at)
- received -> error (billing_apply_event, unknown plan code)
- received -> error (retry job, organisation still unresolved or transient failure still failing 60 minutes or more after received_at)
- error -> received (operator, after fixing the cause such as the price metadata)

### Roles and permissions

- Stripe (caller with a valid signature): may POST events to billing-webhook
- Any other caller or invalid signature: refused with 401 and logged
- service_role (billing-webhook, retry job): may execute billing_ingest_event and billing_apply_event only
- billing_owner: owns the billing schema and the two functions
- anon, authenticated (all roles, including Platform Administrator and Trust & Safety Administrator): no access to provider_events or the functions
- Platform Administrator: no Phase 1 screen; operators inspect events with SQL

### Objects

- Edge Function billing-webhook (verify_jwt = false)
- supabase/functions/_shared/billing/provider.ts (verifyWebhook, normalize)
- supabase/functions/_shared/billing/providers/stripe.ts
- supabase/functions/_shared/billing/providers/null.ts
- public.billing_ingest_event
- public.billing_apply_event
- billing.retry_failed_events()
- private.pause_jobs_on_lapse (called inside billing_apply_event, FR-G4)
- billing.provider_events
- billing.subscriptions
- billing.customers
- billing.orders
- billing.plans
- public.notifications (trial_ending)
- private.security_events
- audit.log
- audit.record()
- audit_record_external
- notify (alert through pg_net)
- pg_cron
- role billing_owner
- billing.trial_grants (proposed, see FR-G2)
- proposed: Edge Function billing-reconcile, called weekly by pg_cron through pg_net, with a service RPC that reads the subscription records and raises the alerts
- proposed: NormalizedEvent fields subscriptionStatus, taxMinor and invoiceRef on payment.succeeded, and cancelAt on subscription.updated
- proposed: audit action billing.webhook_rejected

### Open points and assumed defaults

- O7 (open): no Stripe account yet; the null provider (x-chara-signature HMAC) is used in development, CI and e2e, and Stripe signature handling is not verified live until the account exists.
- L6 (open): retention of provider payloads. Default assumed: 13 months, set through retention_policies.
- ARCHITECTURE sections 14.4 and 15.2 name 401 as the response to a bad signature, so AC1 uses 401, not 400.
- An invalid-signature request is not stored: storing it under the event id would let a forged event block the genuine event with the same id; billing_ingest_event also rejects p_signature_valid = false. Rejected requests are logged as audit rows (proposed); if their volume becomes a problem they can be reduced to function log lines.
- The price-to-plan mapping is not specified. Default assumed: the sync script sets plan_code in the Stripe price metadata and the adapter reads it; billing_apply_event rejects codes absent from billing.plans (unknown_plan).
- The mechanism an operator uses to reset an error event to received is not specified. Default assumed: a reviewed SQL statement run by an operator with an audit row.
- payment.succeeded must carry the Stripe subscription status (so a zero-amount trial invoice leaves trialing unchanged, FR-G4) and tax and invoice reference for the order record; these and cancelAt are not in the NormalizedEvent type of ARCHITECTURE section 10.2 and are proposed.
- Reconciliation needs the Stripe API, so it runs as an Edge Function started by pg_cron (ARCHITECTURE section 8); its name and the service RPC are proposed. A failed re-fetch of a stale event is logged and left to the next event or the weekly reconciliation (default assumed).
- Unresolved-organisation and transient failures stay received and are retried by received_at age; no attempts column is added.

## FR-G4 · Subscription states

> Subscriptions are Trialing, Active, Past due (7-day grace) or Cancelled; a lapsed organisation falls back to a restricted free plan with read-only access to past applicants.

### Acceptance criteria

**AC1 · Trial starts and stays Trialing** (database test (pgTAP))

- Given Organisation O on free_employer with no subscription row
- When subscription.activated (status trialing, employer_starter, trial end 2026-11-04T10:00Z) is applied, followed by payment.succeeded for the zero-amount trial invoice (amount 0, Stripe subscription status trialing)
- Then Status is trialing before and after the invoice event, trial_ends_at is 2026-11-04T10:00Z, private.org_plan_code(O) is employer_starter, private.org_limit(O, 'active_jobs') is 3, past_due_since is null, no billing.orders row is written for the zero-amount invoice, and 2 billing.event_applied audit rows exist (the first with from_status null and to_status trialing)

**AC2 · Paid invoice makes a subscription Active and writes one order** (database test (pgTAP))

- Given an employer_starter subscription trialing with trial end 2026-11-04 (S1) and an employer_starter subscription past_due with past_due_since 2026-11-04T12:00Z (S2)
- When for S1 subscription.updated (active) and then payment.succeeded (purpose subscription, amount 3900, tax 741, Stripe subscription status active) are applied; for S2 the same payment.succeeded is applied; each payment event is then replayed
- Then both subscriptions are active and past_due_since is null; each payment wrote one billing.orders row (kind subscription, sku_or_plan employer_starter, amount_minor 3900, tax_minor 741, currency EUR, status paid, provider reference and invoice reference of the event); the replays write no second order

**AC3 · Failed payment email once per dunning period** (database test (pgTAP))

- Given an active subscription of organisation O whose owner has notification_preferences.digest true, plus an admin and a member; and a trialing subscription of another organisation
- When payment.failed arrives at T, again at T+3 days, then payment.succeeded (active), then payment.failed at T+30 days; and payment.failed arrives for the trialing subscription
- Then after the first event the status is past_due and past_due_since is T; the second event leaves past_due_since at T; exactly 1 payment_failed notification exists after the first two events, addressed to the owner only, linking to the billing page; after the recovery and the new failure past_due_since is T+30 days and the total is 2 notifications; the trialing subscription also becomes past_due; the kind is mandatory and the owner's preferences do not suppress it

**AC4 · Grace period is driven by Stripe, never by a local timer** (database test (pgTAP))

- Given a past_due subscription with past_due_since 2026-11-04T12:00Z (grace ends 2026-11-11T12:00Z), an open vacancy and an applied application
- When the state is checked on 2026-11-10, then on 2026-11-12T12:00Z with no Stripe event, and billing.check_past_due_overdue(p_now) runs with p_now 2026-11-12T13:00Z and again with 2026-11-12T14:00Z; a daily pg_cron entry for the check is inspected
- Then on 2026-11-10 private.org_plan_code is employer_starter, the vacancy stays open and set_application_status works; on 2026-11-12 the status is still past_due and no scheduled job has changed any row; the 13:00 run raises exactly one operations alert for the subscription (more than one day after grace end) and the 14:00 run raises none; cron.job holds one daily entry for the check

**AC5 · Only the deleted event cancels** (database test (pgTAP))

- Given an active subscription of organisation O, an organisation with no subscription row and an organisation with only canceled rows
- When subscription.updated arrives with cancel_at 2026-12-04 and status active, then suspend_organization is run for O, then subscription.deleted arrives
- Then after the first the status stays active, cancel_at is stored and plan rights are unchanged; the suspension leaves the subscription row unchanged; after the deleted event the status is canceled, the row is kept and private.org_plan_code(O) returns free_employer; the organisations with no row and with only canceled rows also resolve to free_employer, never null

**AC6 · Lapse pauses open vacancies in the same transaction** (database test (pgTAP))

- Given Organisation O with 4 open, 1 draft, 1 closed, 1 filled and 1 already paused vacancy and an active subscription; another organisation with 2 open vacancies
- When subscription.deleted is applied for O, and in a second run the pause function is forced to raise
- Then in the same transaction the 4 open vacancies become paused and the other 3 vacancies of O are unchanged; 4 audit rows are written (entity_type job, from open to paused, metadata chara.actor_fn pause_jobs_on_lapse); moderation_state is untouched; the vacancies of the other organisation are untouched; in the failing run the subscription status stays unchanged and the event is not applied

**AC7 · Lapsed organisation is read-only for the employer; withdrawal stays open** (database test (pgTAP))

- Given Lapsed organisation L (canceled subscription, free_employer) with private.settings entitlements_enforced false, applications in states applied, interview and hired, one earlier note, and the candidate of the applied application
- When a member and the owner call set_application_status to shortlisted, call bulk_set_application_status, insert an application note and open the applied application for the first time; a member lists and opens the applicants; the candidate calls withdraw_application
- Then the first three raise CHARA_FEATURE_NOT_IN_PLAN with detail read_only_free_plan; opening does not set viewed; no application_events row and no email is created by the refused calls; the member reads all 3 applications and the note and no row is deleted; the withdrawal succeeds (status withdrawn, share revoked, status_changed email queued to the candidate)

**AC8 · free_employer restrictions follow the setting for organisations that never subscribed** (database test (pgTAP))

- Given Lapsed organisation L (paused vacancy, one member invitation to send) and organisation N that never subscribed, each with one applied application
- When with entitlements_enforced false the owner of L reopens the paused vacancy and calls invite_member, and the owner of N sets an application to shortlisted, opens a vacancy and calls invite_member; then entitlements_enforced is set to true and the owner of N repeats the three calls
- Then for L the reopening raises CHARA_LIMIT_REACHED with detail active_jobs and the invitation raises CHARA_LIMIT_REACHED with detail members; with the setting false the three calls of N succeed; with the setting true they raise CHARA_FEATURE_NOT_IN_PLAN (read_only_free_plan), CHARA_LIMIT_REACHED (active_jobs) and CHARA_LIMIT_REACHED (members)

**AC9 · Checkout availability and the one-live-subscription rule** (database test (pgTAP))

- Given Organisations with a trialing, an active, a past_due and a canceled subscription
- When each owner at aal2 calls billing_checkout_start, and a second non-canceled row is inserted for the first three organisations and a second canceled row for the fourth
- Then Checkout is refused with CHARA_FORBIDDEN detail subscription_exists for the first three and allowed for the canceled one (which returns trial_days 0 when it had a trial); the partial unique index rejects the second non-canceled row (unique violation) while any number of canceled rows are accepted

**AC10 · Limits after reactivation and after a downgrade keep data** (database test (pgTAP))

- Given entitlements_enforced true; a lapsed organisation with 4 paused vacancies that has just received a new Basic subscription (the old canceled row is kept); an organisation on Professional with 5 open vacancies
- When the reactivated owner reopens the 4 vacancies one by one; the Professional organisation receives subscription.updated to employer_starter, then the owner opens a 6th vacancy, closes 3 vacancies and opens one again
- Then the first 3 reopenings succeed and the 4th raises CHARA_LIMIT_REACHED detail active_jobs; set_application_status works again; after the downgrade all 5 vacancies stay open (no pause audit row, nothing deleted), opening the 6th raises CHARA_LIMIT_REACHED, and after 3 are closed the opening succeeds

**AC11 · Past-due warning and lapsed notice** (browser test (Playwright))

- Given an organisation with past_due_since 2026-11-04 with an owner and an admin at aal2 and a member; and a lapsed organisation with paused vacancies and past applicants, its owner at aal2, and a candidate with an applied application
- When the owner and the admin open the billing page and the employer dashboard, the member opens the dashboard, and invoice.paid is then delivered and the owner reloads; the lapsed owner opens the applicants list, an applicant detail and the vacancies list; the candidate opens the journey tracker
- Then the owner and the admin see the alert 'Payment failed on 4 Nov 2026. Update your payment method before 11 Nov 2026 to keep your plan.' with an Update payment method button that opens the portal; the member sees no billing warning; after the paid invoice the warning is gone; the lapsed pages show a notice that the subscription has ended, past applicants stay readable and changes need an active plan, with a Choose a plan link to the billing page; status controls, note form and bulk actions are disabled with that reason available to assistive technology and reachable by keyboard; vacancies show Paused; the candidate's tracker is unchanged and its Withdraw button works

**AC12 · Trial end, grace and cancellation on a Stripe test clock** (manual check)

- Given Stripe test mode with a test clock, a Basic subscription with a 30-day trial and a good test card, and a second subscription with a card that fails after the trial, the dunning schedule set to cancel 7 days after the first failure
- When the clock is advanced to day 27, day 30, day 37 and beyond
- Then both subscriptions show Trialing from day 0 to day 30 (not Active after the zero-amount invoice); at day 27 one trial_ending email is queued to the owner; the first becomes Active at day 30 after the paid invoice of EUR 39.00 plus VAT; the second becomes Past due with one payment_failed email, is canceled by Stripe at day 37, becomes Cancelled, falls back to free_employer and its open vacancies become Paused

### Data and validation

- subscriptions.status: trialing, active, past_due or canceled (the enum also has paused, which no Phase 1 path sets)
- subscriptions.plan_code: required, foreign key to billing.plans
- subscriptions.trial_ends_at: timestamptz, set while trialing (trial start plus plans.trial_days, from Stripe)
- subscriptions.current_period_start, current_period_end: timestamptz, from Stripe
- subscriptions.cancel_at: timestamptz, null unless cancellation is scheduled
- subscriptions.past_due_since: timestamptz, set by the first invoice.payment_failed of a dunning period, cleared by invoice.paid; grace end = past_due_since + 7 days
- subscriptions.last_provider_event_at: timestamptz
- partial unique index: one non-canceled subscription per organisation; check: organisation type is a company type
- private.settings.entitlements_enforced: jsonb boolean read with value #>> '{}', default false; lapse rules apply regardless of it
- free_employer limits: active_jobs 0, members 0, no features
- billing.orders written only for a payment.succeeded with amount_minor > 0

### States and transitions

- (none) -> Trialing (webhook: subscription created with a trial)
- (none) -> Active (webhook: subscription created without a trial)
- Trialing -> Active (webhook: subscription updated to active after the trial converts)
- Trialing -> Past due (webhook: invoice.payment_failed)
- Active -> Past due (webhook: invoice.payment_failed)
- Past due -> Active (webhook: invoice.paid with Stripe subscription status active)
- Trialing, Active, Past due -> Cancelled (webhook: customer.subscription.deleted only; Stripe dunning cancels 7 days after the first failure)
- Cancelled -> no transition; a new checkout creates a new row

### Roles and permissions

- Stripe through billing-webhook: the only actor that changes subscription status
- Organisation owner and admin (aal2): may start a new checkout when no non-canceled subscription exists; denied manual state changes
- Organisation member: denied billing actions; on a lapsed organisation denied status changes, notes and bulk actions
- Candidate: may withdraw an application even when the employer is lapsed; may read own applications
- Platform Administrator, Trust & Safety Administrator: no Phase 1 function and no grant that changes subscription status; suspension leaves the subscription as is (OPEN_QUESTIONS.md P12)
- billing_owner: runs billing_apply_event and pause_jobs_on_lapse

### Objects

- billing.subscriptions
- billing.plans
- billing.plan_limits
- billing.provider_events
- billing.orders
- public.jobs (status, trigger jobs_guard_transition, jobs_enforce_limits)
- public.job_applications
- public.application_events
- public.application_notes
- public.notifications (payment_failed, trial_ending)
- public.organization_invitations
- private.org_plan_code
- private.free_plan_restricted
- private.assert_org_writable
- private.org_limit
- private.assert_within_limit
- private.pause_jobs_on_lapse
- private.settings
- private.security_events
- public.billing_apply_event
- public.billing_checkout_start
- public.set_application_status
- public.bulk_set_application_status
- public.withdraw_application
- public.invite_member
- public.suspend_organization
- audit.log
- pg_cron
- pages org/[slug]/billing, org/[slug]/applicants, org/[slug]/jobs, dashboard/employer, applications
- proposed: billing.check_past_due_overdue(p_now timestamptz default now()) daily job (alert when still past_due more than one day after grace end, once per past_due_since)

### Open points and assumed defaults

- C11 (open): when entitlements_enforced is switched on and the contents of free_employer. Default assumed: limits 0, no features, past applicants read-only; lapse rules apply whether or not enforcement is on; for an organisation that never subscribed the restrictions follow the setting.
- C12 (open): whether the members limit counts the owner. Default assumed: the owner counts, and invitations on a lapsed organisation are refused by members limit 0.
- C9 (open): behaviour on downgrade above the new limits. Default assumed: keep data, block opening further vacancies over the limit.
- P12 (open): suspension and the subscription. Default assumed: the subscription is left as is (no pause, cancellation or refund).
- The paused value exists in the status enum for later phases; Phase 1 never writes it.
- AC10 sets entitlements_enforced to true because with the setting false a reactivated or downgraded organisation is not limit-checked.
- No order is written for the zero-amount trial invoice (default assumed); the first order is the first paid invoice.
- The overdue-past-due check is named in ARCHITECTURE section 10.1 as a reconciliation alert; its function name, the p_now parameter (for testing) and the daily schedule are proposed; the alert is raised once per past_due_since.
- Stripe test-mode verification (AC12) needs the Stripe account (O7); until then the null provider covers the database rules only.

## FR-G5 · Billing page

> An owner or administrator sees the current plan, usage against limits, next invoice date, and links to upgrade, downgrade or open the portal.

### Acceptance criteria

**AC1 · Owner and admin see the billing page** (browser test (Playwright))

- Given Organisation Acme with owner Ana and admin Ben, both at aal2, on a trialing Basic subscription
- When each opens /en/org/acme/billing
- Then the page renders the heading Billing, the plan name Basic (from billing.plans) and the status Trial; it exposes no Stripe customer or subscription reference in the HTML or in network responses

**AC2 · Everyone else is kept out** (browser test (Playwright))

- Given Member Mia of Acme, owner Ana whose session is aal1, an anonymous visitor, user Zed who belongs to another organisation, and a Platform Administrator who is not a member of Acme
- When each requests /en/org/acme/billing
- Then Mia receives a 403 page without billing data and sees no Billing item in the navigation; Ana is redirected to /en/mfa with the billing page as next; the visitor is redirected to /en/login with the billing page as next; Zed and the Platform Administrator receive a 404 that does not reveal that Acme exists

**AC3 · Database gate on the subscription view** (database test (pgTAP))

- Given Organisation O with an active subscription, its owner at aal2, its admin at aal2, a member at aal2, its owner at aal1, an owner of another organisation, and anon
- When each selects from public.v_my_subscription
- Then the owner and the admin at aal2 get 1 row (the non-canceled row, otherwise the newest canceled row) of O only; the member, the aal1 owner and the other organisation's owner get 0 rows; anon is refused with permission denied; the view has no column for provider_customer_ref, provider_subscription_ref or any provider payload (checked against information_schema)

**AC4 · Plan, state and dates for trial and active subscriptions** (browser test (Playwright))

- Given a Basic subscription trialing with trial_ends_at 2026-11-04, and a Professional subscription active with current_period_end 2026-12-04
- When the owner opens the billing page for each
- Then the first shows Basic, Trial, Trial ends 4 Nov 2026 and First payment of EUR 39.00 excl. VAT on 4 Nov 2026; the second shows Professional, Active, Next invoice 4 Dec 2026 and EUR 79.00 per month excl. VAT; dates are UTC calendar dates in English

**AC5 · Plan, state and dates for past-due, ending and lapsed subscriptions** (browser test (Playwright))

- Given a subscription past_due with past_due_since 2026-11-04, an active one with cancel_at 2026-12-04, and an organisation whose subscription is canceled and has a customer reference
- When the owner opens the billing page for each
- Then the first shows Past due, Payment failed 4 Nov 2026, Grace period ends 11 Nov 2026 and no next invoice date; the second shows Active, Ends 4 Dec 2026 and no next invoice date; the third shows No active plan, Free plan with read-only access to past applicants, a Choose a plan link and a View invoices link

**AC6 · Usage classification** (unit test (Vitest))

- Given the usage helper used by the page
- When it is called with (used, limit) = (2, 3), (3, 3), (5, 3), (0, 15), (3, null) and (0, 0)
- Then it returns ok with label '2 of 3' and 67 %; at_limit '3 of 3' and 100 %; over_limit '5 of 3' and 100 %; ok '0 of 15' and 0 %; unlimited 'Unlimited' without a percentage; at_limit '0 of 0' and 100 %

**AC7 · Usage against limits on the page** (browser test (Playwright))

- Given a Professional organisation with 7 open, 2 paused, 1 closed and 1 deleted vacancy and 3 members (owner, admin, member); a Basic organisation with 3 open vacancies; and an organisation downgraded to Basic with 5 open vacancies
- When each owner opens the billing page
- Then the first shows Open vacancies 7 of 15 and Team members 3 of 5 (paused, closed and deleted vacancies are not counted); the second shows 3 of 3 with Limit reached and an Upgrade link; the third shows 5 of 3 as over the limit with the text that existing vacancies stay open and no more can be opened until usage is below the limit

**AC8 · Plan-change and portal controls** (browser test (Playwright))

- Given an active Basic subscription and an active Professional subscription, owner at aal2, null provider
- When the owner opens the billing page for each and uses Upgrade to Professional (Basic page) or Downgrade to Basic (Professional page), Manage billing, Change tax details and View invoices in turn
- Then the Basic page offers Upgrade to Professional and the Professional page offers Downgrade to Basic; Enterprise is never offered; each of the four controls opens a Customer Portal session for the organisation's customer with the billing page as return URL; each click writes one billing.portal_opened audit row

**AC9 · Organisation without a subscription** (browser test (Playwright))

- Given an organisation on free_employer that has never subscribed, and one that had a canceled subscription earlier, owner at aal2
- When each owner opens the billing page
- Then the page shows Free plan and No subscription (or No active plan for the earlier subscriber); it offers the plans from public.v_plans (Basic EUR 39.00 and Professional EUR 79.00 per month excl. VAT, not Enterprise), each with Start 30-day free trial for the organisation that never subscribed and Subscribe for the earlier subscriber, leading to the checkout form where the final trial eligibility is decided; the organisation that never subscribed shows no Manage billing and no View invoices

**AC10 · Plan change in the portal appears on the page** (browser test (Playwright))

- Given an active Basic subscription and the null provider
- When the owner switches to Professional in the portal, returns to the billing page before the provider event is delivered, and the provider then delivers customer.subscription.updated
- Then before the event is applied the page shows the unchanged plan without an error; within 60 seconds after delivery the page shows Professional and the limits 15 open vacancies and 5 members

**AC11 · Loading and error states** (browser test (Playwright))

- Given a billing page whose data request is delayed 2 s, and one whose data request fails
- When the owner opens each
- Then the delayed page shows skeleton placeholders with aria-busy until the data arrives; the failing page shows an error message 'Billing details could not be loaded' with a Try again button and an error toast, and no stale data or blank page

**AC12 · Keyboard, labels and small screens** (browser test (Playwright))

- Given the billing page in the trial, past-due and no-subscription states
- When it is used with the keyboard only, checked with the accessibility scanner, and shown at 360 px width
- Then every action is reachable with Tab and Enter in reading order with a visible focus ring; controls have accessible names such as Upgrade to Professional; usage bars have role progressbar with aria-valuenow, aria-valuemax and the label Open vacancies; status is given in text, not only colour; the scanner reports 0 violations of WCAG 2.2 AA; there is no horizontal scroll

### Data and validation

- No data is captured by the page itself; it reads public.v_my_subscription (organization_id, plan_code, plan_name, status, trial_ends_at, current_period_end, cancel_at, past_due_since) and public.v_plans
- Usage: open vacancies = count of public.jobs with status open and deleted_at null; team members = count of accepted organization_members rows including the owner; limits from private.org_limit; a NULL limit is shown as Unlimited; both come from the proposed RPC billing_usage
- Dates shown as UTC calendar dates; prices shown in EUR excluding VAT
- Provider references and webhook payloads are never selected into the page

### Roles and permissions

- Organisation owner: may open the billing page at aal2 and use all actions
- Organisation admin: same as owner at aal2
- Organisation member: denied the billing page and the subscription view (403)
- Owner or admin whose session is aal1: redirected to two-step verification, denied data
- Owner or admin of another organisation: denied (404)
- Candidate (worker): denied (FR-G6)
- Platform staff who are not members: denied the page (404) and the view
- Anonymous: redirected to login

### Objects

- app/[lang]/(app)/org/[slug]/billing
- lib/dal/billing.ts
- public.v_my_subscription
- public.v_plans
- billing.subscriptions
- billing.plans
- billing.plan_limits
- public.jobs
- public.organization_members
- private.org_limit
- private.org_plan_code
- private.is_aal2
- requireOrgRole, requireAal2 (DAL)
- public.billing_checkout_start
- Edge Function billing-checkout
- audit.log (billing.portal_opened)
- proposed: public.billing_usage (RPC returning used and limit per limit key for owners and admins at aal2)
- proposed: public.billing_portal_start (see FR-G2)
- proposed: usage classification helper used by the page

### Open points and assumed defaults

- C12 (open): whether the members limit counts the owner. Default assumed: the owner counts, so a Basic organisation shows 1 of 1.
- C13 (open): display name of the lowest plan. Default assumed: Basic; examples use Basic.
- C9 (open): downgrade above the new limits. Default assumed: keep data, block creation over the limit (AC7).
- Tax details and invoices: the SOP asks for a way to change tax details and links to Stripe-hosted invoices; default assumed: both open the Customer Portal, which hosts address, tax ID and invoice history. Local billing.customers.vat_id is not synchronised afterwards because customer.updated is not among the FR-G3 events.
- ARCHITECTURE section 10.1 says subscriptions are readable by organisation members; FR-G5 and its SOP restrict the page to owners and admins with two-step verification, so the view is gated to those roles at aal2 (members still meet plan limits through private functions).
- Upgrade and downgrade in Phase 1 are plan changes in the Customer Portal; the portal must list the Basic and Professional prices only.
- An organisation with no subscription row or only canceled rows is shown as Free plan; the plan row of a non-public plan (Enterprise) is visible to members of the organisation using it so that plan_name resolves (FR-G1 AC5).

## FR-G6 · Workers never pay

> A candidate account cannot start a checkout or hold a subscription.

### Acceptance criteria

**AC1 · Worker checkout and portal are refused by the database** (database test (pgTAP))

- Given Worker W (profiles.account_kind worker) with a valid session, a user whose account_kind is still null, and company user C (account_kind company, owner of an organisation at aal2)
- When each calls billing_checkout_start and billing_portal_start through the API with a valid organisation id of a company, with a random uuid, and with a sold plan, billing country DE and a valid registration number
- Then W raises CHARA_FORBIDDEN (42501) with detail worker_account and the null user with detail account_kind_unset, in both RPCs and before any other check, so the organisation id is never probed; no row is written to billing.customers, billing.subscriptions, billing.orders, consents or audit.log; C passes the account-kind check and receives the checkout parameters for its own organisation, so the refusal is not a blanket refusal

**AC2 · No billing structure can hold a worker** (database test (pgTAP))

- Given the migrated database
- When the billing schema is inspected through information_schema and the foreign-key catalogue, and the enum organization_type is read
- Then no billing table has a column named user_id or worker_user_id or a foreign key to auth.users or public.profiles; billing.subscriptions and billing.customers reference organisations only; organization_type has the labels employer, recruitment_company and staffing_company and no worker label

**AC3 · A worker cannot become a billing user through an organisation** (database test (pgTAP))

- Given Worker W, organisation O and a pending invitation to W's email
- When a row (O, W, admin) is inserted into organization_members and W calls accept_invitation, then W selects from public.v_my_subscription
- Then the insert is rejected by the trigger, accept_invitation raises, W has no row in organization_members and the view returns 0 rows

**AC4 · A worker cannot become a company user later** (database test (pgTAP))

- Given Worker W with a committed account_kind worker
- When W tries to update profiles.account_kind to company, directly and through set_account_kind, and then calls billing_checkout_start
- Then both updates are rejected by the immutability trigger and account_kind stays worker; the checkout call raises CHARA_FORBIDDEN with detail worker_account

**AC5 · No pricing or payment elements in candidate areas** (browser test (Playwright))

- Given a signed-in candidate
- When she visits /en/dashboard/worker, /en/passport (sections, documents, shares, consents), /en/applications, an application detail and account settings
- Then no navigation item or link in these pages points to /pricing, a billing page or a checkout; no button is labelled Subscribe, Upgrade, Start trial or Pay; the page loads no Stripe script; no price of CHARA appears

**AC6 · Direct billing URL as a candidate** (browser test (Playwright))

- Given the signed-in candidate
- When she opens /en/org/acme/billing for an existing organisation and /en/org/unknown/billing
- Then both return the same 404 page without organisation data, and the browser makes no request to Stripe

**AC7 · Checkout function refuses and records a worker attempt** (unit test (Vitest))

- Given the billing-checkout handler with a provider spy and an RPC stub that raises CHARA_FORBIDDEN with detail worker_account
- When it is called with a worker's JWT for checkout and for the portal
- Then it returns 403 with a generic message, never calls createCheckout or createPortal, and calls audit_record_external once per attempt with action billing.worker_checkout_refused and the user id, without a payload, so refused attempts can be counted (target 100 %)

**AC8 · Policy text states that workers never pay** (manual check)

- Given the Platform Rules in legal_documents (draft or approved)
- When a reviewer reads them against the checklist
- Then they state that a worker never pays CHARA or anyone else a fee for finding work, applying, or using CHARA; they or the complaints process tell users how to report a request for a fee and name the Trust & Safety Administrator as the recipient; legal counsel has approved the text before launch

### Data and validation

- No data is captured; the requirement is a rule on account_kind and on the billing schema
- profiles.account_kind: worker or company, immutable once set (FR-A6); null until committed
- billing_checkout_start and billing_portal_start reject when the caller's account_kind is not company
- Billing tables hold no column that references a user

### Roles and permissions

- Candidate (worker): denied checkout, portal and any billing page; cannot hold a subscription or be an organisation member
- Company organisation owner or admin at aal2: allowed (FR-G2, FR-G5)
- Anonymous: denied
- Trust & Safety Administrator: receives reports of fee requests through the complaints process; no billing function
- Platform Administrator: no billing function that affects a worker

### Objects

- public.billing_checkout_start
- proposed: public.billing_portal_start
- Edge Function billing-checkout
- public.profiles (account_kind, immutability trigger from FR-A6)
- public.set_account_kind
- public.organization_members (worker-membership trigger)
- public.accept_invitation
- billing.customers
- billing.subscriptions
- billing.orders
- public.v_my_subscription
- enum organization_type
- pages dashboard/worker, passport, applications (no pricing or payment elements)
- public.legal_documents (platform-rules)
- audit_record_external
- proposed: audit action billing.worker_checkout_refused

### Open points and assumed defaults

- ILO Convention C181 is the stated regulatory risk; the automated refusal test (AC1) is part of the CI database job.
- L5 and L7 (open): legal texts are drafts until counsel approves them; AC8 is a launch-gate check, not a build check.
- Phase 1 has no report form (report_content is later phase). Default assumed: the Platform Rules or complaints process name a Trust & Safety contact address held as a row in private.settings, changed by migration because the editing page is later phase (OPEN_QUESTIONS.md L1).
- AC5 limits 'candidate areas' to the signed-in candidate application area; public marketing and job pages, including the public pricing page, remain visible to everyone (FR-H2).
- The audit action billing.worker_checkout_refused and the details account_kind_unset and worker_account are proposed so that the SOP KPI 'worker checkout attempts refused (100 %)' is measurable; the database refusal itself rolls back and writes no row, so the Edge Function writes the audit row.
