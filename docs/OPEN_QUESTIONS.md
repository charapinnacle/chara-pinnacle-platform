# Open questions

## 1. How to use this file

Every open item here is a decision about data or configuration (a seeded row, a setting, a role list, a policy text), not about code structure, so development continues on the recommended default until the owner answers. Nothing here blocks week 1 unless its row says so. IDs are stable — `D` design conflict, `C` commercial, `L` legal, `O` operating, `P` product, `W` week-1 input, `R` resolved — and are referenced from pull requests and from `ARCHITECTURE.md`. When an item is answered, its row stays where it is, its Status becomes `decided` with the date, the decision replaces the recommended default, and a one-line entry is added to [Resolved](#5-resolved); do not delete or renumber rows.

The owner's decisions reply (2026-10-02; client document, not in git) answered part of sections 2 and 3. Those rows show `decided (owner, 2026-10-02)`; the settled points are listed as R20–R31. Items the reply raised are added as C10–C17, L7–L9, O9, O10 and P9–P12.

Abbreviations: HANDOFF = `docs/phase-1/HANDOFF.md`; ARCHITECTURE = `docs/ARCHITECTURE.md`; SDD = Phase 1 System Design Description (client document, not in git, see R19); FR/NFR = `docs/phase-1/requirements.js`; reply = the owner's decisions reply (2026-10-02; client document, not in git), cited by its item number.

## 2. Design conflicts to settle before the first migration

The source documents disagreed on these points, or left a gap. In the Conflict column, ARCHITECTURE means the text of that document before the 2026-10-02 reconciliation (precedence used then: HANDOFF §2 and §5 over ARCHITECTURE). The current `docs/ARCHITECTURE.md` shows each proposed resolution, marked `(proposed — see OPEN_QUESTIONS.md, D<n>)`; a proposal becomes final when the pull request containing the migration is merged. D1, D4 and D15 were decided by the owner and are marked `(decided — OPEN_QUESTIONS.md, D<n>)` there.

| ID | Conflict | Resolution (proposed or decided) | Source that wins | Status |
|---|---|---|---|---|
| D1 | `platform_staff.role`: SDD §4.1 has `admin`, `trust_safety`; ARCHITECTURE adds `verification_reviewer`. | Three values from the first migration: `admin`, `verification_reviewer`, `trust_safety`, with technically separated permissions and named users. Phase 1 builds the administration console only; the verification reviewer queue is later phase. | Reply 3.3 | decided (owner, 2026-10-02) |
| D2 | `legal_documents` columns: SDD `slug, version, title, body, change_summary, published_at` (unique `slug` + `version`); ARCHITECTURE `key, version, url, published_at`. | SDD columns. | SDD §4.1 | proposed |
| D3 | `consents`: append-only rule vs a `withdrawn_at` column (the SDD lists both). | Append-only rows with `action` (`granted`, `withdrawn`) and `created_at`; no `withdrawn_at`. Age attestation (FR-A9) is a purpose. | Append-only rule (SDD rule text, ARCHITECTURE) | proposed |
| D4 | `create_organization` inserts a `trialing` subscription; FR-G2 says a card is required at trial start. | No subscription row at organization creation; plan resolves to `free_employer`; the trial starts at checkout with a card and the row arrives through the billing webhook. One trial per legal entity: a unique legal-entity identifier (company registration number, VAT number or another unique legal-entity identifier) is captured before checkout and checked for uniqueness (C14). Trial length is `plans.trial_days`, administrator-editable. The reply says payment details are collected at registration; this is read as the checkout step that starts the trial, not the account sign-up form, and needs owner confirmation (C15). | FR-G2; reply 1.5 | decided (owner, 2026-10-02); card timing to confirm (C15) |
| D5 | `private.org_plan_code` returns NULL when no subscription row exists, which reads as unlimited. | Coalesce to `'free_'` + organization type; an unknown plan code denies. | HANDOFF §5 item 9 | proposed |
| D6 | `private.settings.value` is read both as `value->>0` and as `value::boolean`. | `value jsonb`, always read with `value #>> '{}'` and then cast. | Neither; one convention | proposed |
| D7 | `organization_type` enum has employer, recruitment and staffing types; Phase 1 is employer only. | Keep the enum; `create_organization` rejects non-employer types in Phase 1; seed only the employer plans and `free_employer`. The reply keeps recruitment and staffing companies as separate categories (R30), which supports keeping the enum. | HANDOFF §2 | proposed |
| D8 | Restrictive aal2 policies vs a new owner who is still at aal1. | Require aal2 only for invitations, `platform_staff`, member-management RPCs and billing reads; never for reading one's own membership or organization. | FR-A4 | proposed |
| D9 | Nothing sets `account_kind = 'worker'` before the passport work package. | A small RPC, `set_account_kind`, plus an immutability trigger in the profiles migration. | FR-A6 | proposed |
| D10 | Invitation email depends on the `notify` function (a later work package); the first demo needs invitations. | `invite_member` returns the token once and the UI shows a copyable link; `accept_invitation` requires a matching email and rejects workers. | Neither; delivery order | proposed; needs owner confirmation |
| D11 | `grant_platform_role` ends sessions through `account-ops`, which does not exist yet. | Keep the table and helper now; add the RPC with the admin console. | FR-A7 | proposed |
| D12 | "Every table has at least one policy" vs unexposed tables in `private`, `audit`, `billing`. | ENABLE + FORCE RLS everywhere; the meta-test accepts "at least one policy OR zero API-role grants". | NFR-S1 ("every exposed table") | proposed; needs owner confirmation |
| D13 | Column name `worker_id` (SDD) vs `worker_user_id` (ARCHITECTURE). | `worker_user_id`. | ARCHITECTURE | proposed |
| D14 | FR-A5 requires changing member roles; no `change_member_role` RPC is listed. | Add it with the organizations migration. | FR-A5 | proposed |
| D15 | Employer Starter price: 3900 vs 4900 cents in the pricing source. | 3900 (EUR 39 per month). | Reply 1.1 | decided (owner, 2026-10-02) |
| D16 | `audit.document_access_log` columns: SDD `share_id, document_id, organization_id, accessed_by, accessed_at, outcome` and `document_access_grant(document_id)`; ARCHITECTURE `document_id, worker_user_id, accessor_user_id, accessor_org_id, purpose` and `document_access_grant(p_document_id, p_purpose)`. | SDD names (`share_id`, `organization_id`, `accessed_by`, `accessed_at`) plus `worker_user_id` (the worker's view filters on it without a join) and `purpose` (kept as the second RPC argument). No `outcome`: a refused request raises and writes no row, so the column would hold a single value. | SDD §4.1 for names; ARCHITECTURE for the two added columns | proposed |

## 3. Owner decisions

"Needed by" uses the four-week Phase 1 schedule (week 1 foundation, week 2 profiles and vacancies, week 3 applications and admin, week 4 billing and staging) or a later milestone. "Default applies" means work proceeds on the recommended default. In a decided row the third column holds the decision.

### Commercial

| ID | Question | Recommended default, or decision | Needed by | Status |
|---|---|---|---|---|
| C1 | Employer Starter monthly price: 3900 or 4900 cents? | 3900 (EUR 39 per month) for the base employer plan (see D15). Recruitment and staffing companies get their own plans. | Week 4 (checkout); seeded at 3900 from week 1 | decided (owner, 2026-10-02) |
| C2 | Which plans include Post Workforce Requirement, CHARA Match, Workforce Corridors, Search Available Workforce, Multi-Partner Invitation, and Job Order posting and access? | Three tiers. Basic: company profile, workforce requirement, CHARA Match, basic search, applications and submissions, messaging, job order posting, access to relevant workforce opportunities, basic partner connection, standard profile visibility. Professional adds advanced search and filters, higher volumes, more partner invitations, multi-partner requests, advanced messaging capacity, corridor search, enhanced company visibility, analytics, priority matching and search visibility. Enterprise adds higher or unlimited volumes under fair use, multi-country requirements and partner network, enterprise analytics, more team and admin users, priority support, enhanced and enterprise-level verification options, Verified Partner eligibility, priority placement options. CHARA Match and the core requirement workflow stay in the lowest paid plan. Two points conflict with the C3 table: priority visibility on Professional and the tier of multi-country requirements (C16). | Before launch (`plan_features` rows) | decided (owner, 2026-10-02); two points open (C16) |
| C3 | Limits per plan: active jobs, active requirements, team members, monthly messages, monthly candidate submissions, partner invitations per requirement. | Table below. Limits are administrator-editable rows, not code; Enterprise limits can be set per organization. Enforcement timing: C11. | Before go-live (the go-live check requires enforcement on) | decided (owner, 2026-10-02) |
| C4 | Which trust badges does each verification level make a company eligible for? | Basic (EUR 49): Identity, Business. Professional (EUR 99): adds Licence, Workforce Capability. Enterprise (from EUR 199): adds multi-country verification and Verified Partner eligibility. Worker verification is free at launch; workers may receive free verification indicators for identity, skills, qualifications, experience, documents, language and other employment information. Criteria and documents per badge: verification policy (L5). | Verification phase | decided (owner, 2026-10-02) |
| C5 | Refund rules, verification fees in particular. | None given. | Verification phase | open |
| C6 | Free first month: card collected at sign-up? Automatic conversion after 30 days? One per legal entity? | Card before the trial starts, collected at checkout (D4); the reply says at registration, and this reading needs confirmation (C15). Automatic conversion after 30 days; one trial per legal entity. Before the trial starts the user is shown the trial period, price after trial, billing frequency, automatic conversion and how to cancel. The administrator can change the trial period. See D4, C14. | Week 4 (checkout) | decided (owner, 2026-10-02) |
| C7 | Prices exclusive of VAT and billed in EUR for all customers? | EUR, exclusive of VAT; VAT by customer location and tax rules. EUR only in the first release; more currencies must be possible later. Tax treatment outside the EU follows the payment provider and accounting setup agreed with the owner's advisers. | Week 4 (checkout) | decided (owner, 2026-10-02) |
| C8 | Boost catalogue (products, durations, prices). | Seed values listed in ARCHITECTURE §10.1. The reply fixes the administrator-controlled attributes and the "no higher plan needed" rule (R29) but gives no catalogue prices. | Boosts phase | open |
| C9 | Behaviour on downgrade when usage exceeds the new plan's limits. | Keep data, block creation over the limit. | Before limits are enforced | open |
| C10 | Prices of the Employer Professional plan (7900 from the pricing source, not confirmed by the reply) and the Employer Enterprise plan (not stated; sold by quote?). | Professional stays seeded at 7900. Enterprise: none given; the plan is not sold until answered. | Week 4 (checkout) | open |
| C11 | When is `entitlements_enforced` switched on, now that the limits exist (C3)? The reply gives no limits for the fallback plan `free_employer`. | Seed the numbers now; switch enforcement on with the billing work package (week 4). | Week 4 | open |
| C12 | Basic allows 1 team member, but the week-1 demo has an employer inviting a member. | Not enforced until C11; afterwards the invitation UI shows the limit, and inviting needs Professional or a rule for active trials. | With C11 | open |
| C13 | Display name of the lowest paid employer plan: the reply uses both "Starter" and "Basic". | Plan codes stay `employer_starter` and `employer_professional`, plus a new `employer_enterprise`; only the display name changes. | Week 4 (pricing page) | open |
| C14 | Trial eligibility: which legal-entity identifier is mandatory per country (registration number, VAT number, other), and how is it validated? | None given; D4 needs at least one identifier, checked for uniqueness. | Week 4 (checkout) | open |
| C15 | Card timing: at account registration, or at checkout when the trial starts (an organization can exist on `free_employer` without a card)? The reply says payment details are collected at registration. | At checkout, before the trial starts (D4). | Week 4 (checkout) | open; needs owner confirmation |
| C16 | Tier assignment. The reply's feature list (1.2) and limits table (1.3) disagree on priority visibility for Professional (included vs optional boost) and on multi-country requirements (Enterprise only vs Professional and Enterprise). Not defined: "limited" multi-country requirements on Basic; "included or available" priority visibility on Enterprise; the tier of `available_workforce_search`; `shortlisting` (not mentioned by the reply); CSV export of the applicant list (not mentioned by the reply). | Follow the 1.3 table (C3); `shortlisting` on every paid plan; the other three stay unset; CSV export on every paid plan. | Before launch (`plan_features` rows) | open; needs owner confirmation |
| C17 | Does the monthly candidate-submissions limit (C3) apply to direct applications in Phase 1, and what happens when the cap is reached? | It applies to partner submissions only, a later phase; direct applications are not capped in Phase 1. | Week 3 (applications); with C11 | open |

Initial limits (C3). A `+` means the seeded number can be raised per organization.

| Limit or feature | Basic | Professional | Enterprise |
|---|---|---|---|
| Active job postings | 3 | 15 | 50+ |
| Active workforce requirements | 3 | 15 | 50+ |
| Team members | 1 | 5 | 15+ |
| Monthly messages | 100 | 500 | 2,000+ |
| Candidate submissions per month | 25 | 100 | 500+ |
| Partner invitations per requirement | 3 | 10 | 25+ |
| Advanced search | no | yes | yes |
| Analytics | basic | advanced | enterprise |
| Multi-country requirements | limited | yes | yes |
| Priority visibility | optional boost | optional boost | included or available |

### Legal

| ID | Question | Recommended default, or decision | Needed by | Status |
|---|---|---|---|---|
| L1 | Jurisdiction of the operating legal entity; who acts as Data Protection Officer or EU representative; controller, processor or joint-controller role. | Owner action with legal counsel before launch. Until then legal entity details, privacy contact and data-protection contact are administrator-configurable settings (ARCHITECTURE §12). | Start now; before legal texts v1 | open |
| L2 | Launch corridors (source country to destination country). | Global, country-neutral platform with no technical restriction to a set of countries; initial commercial focus Europe plus selected corridors. The concrete launch corridor list is still open; legal texts and assessments need it. | Before launch | decided in principle (owner, 2026-10-02); corridor list open |
| L3 | Does the platform itself need a recruitment, placement or employment-agency licence in any launch country? | Formal legal review. The specification does not assume the platform is itself an agency; platform activities (marketplace, profile hosting, search, matching, messaging, partner discovery, subscription, boost, verification) are kept apart from regulated recruitment and staffing activities, whether performed by the platform operator or by third parties; the platform is built so licensed partners can perform regulated services where required. A written legal opinion per launch jurisdiction or corridor is required before regulated workflows are activated. | Before launch (launch gate) | open |
| L4 | Which source-country restrictions on direct hiring apply in the launch corridors? | Country and corridor rules engine, administrator-configured (later phase; ARCHITECTURE §9.4). The concrete rules are open pending legal review; regulated source countries are reviewed before direct hire is enabled. | Find Workers phase | decided in principle (owner, 2026-10-02); rules open |
| L5 | Who authors and approves the Terms of Service, Privacy Policy, Platform Rules and the verification policy? | The team prepares structured drafts of the 18 documents listed below; legal counsel approves. DRAFT placeholders until approved (see W7). The verification policy states what each badge means and what it does not guarantee. | Week 2 (legal pages); approval before launch | decided (owner, 2026-10-02) |
| L6 | Retention periods. | Exports 7 days; verification evidence 24 months after decision; access log 24 months; provider payloads 13 months; inactive worker data 24 months; audit log 6 years. Not addressed by the reply; periods must be administrator-configurable. | Before launch (retention job) | open |
| L7 | Which of the 18 documents are needed for the Phase 1 launch scope? | Terms of Service, Privacy Policy, Cookie Policy, Platform Rules, Acceptable Use Policy, Subscription and Billing Terms, Employer Terms, Worker Terms, complaints process, suspension rules; the rest with their features. | Week 2 (legal pages) | open |
| L8 | May the direct employer-to-worker application loop go live for every country pair before the corridor rules engine (L4) exists? | Yes in Phase 1, with a general notice; the per-corridor block comes with the rules engine. Needs owner and legal confirmation before launch. Corridor rules use the worker's current country, never nationality. | Before launch | open |
| L9 | Which legal documents need recorded acceptance at sign-up and at checkout? | Terms of Service and Privacy Policy for everyone; Worker Terms for candidates; Employer Terms for employers; Subscription and Billing Terms at checkout. | Week 1 (sign-up consent, FR-A8); week 4 (checkout) | open |

Documents under L5: Terms of Service; Privacy Policy; Cookie Policy; Platform Rules; Verification Policy; Acceptable Use Policy; Subscription and Billing Terms; Boost and Promotion Terms; Partner Terms; Employer Terms; Worker Terms; Recruitment Company Terms; Staffing Company Terms; Data Processing Agreements where required; disclaimer on immigration, visa and legal advice; rules on fraudulent profiles, documents and job postings; complaints and dispute process; account suspension and termination rules.

### Operating

| ID | Question | Recommended default, or decision | Needed by | Status |
|---|---|---|---|---|
| O1 | Database region: Frankfurt or Ireland. | Frankfurt (`eu-central-1`). | Before first deployment (week 4 staging) | decided (owner, 2026-10-02) |
| O2 | Supabase tier, point-in-time recovery, separate staging project. | Pro tier or equivalent with daily backups, PITR, encryption at rest and in transit, access controls, audit logging, monitoring and disaster-recovery procedures. Designed with GDPR and future security certification in mind; hosting must scale with users, profiles, documents and transactions. Staging project: O9. | Before first deployment | decided (owner, 2026-10-02) |
| O3 | Web hosting provider (must offer an EU region and EU log retention). | None given; the app stays portable (`output: 'standalone'`, no vendor-specific features). | Week 4 (staging deploy) | open |
| O4 | Antivirus vendor for uploaded documents. | None given; the scan step stays a stub until chosen. | Before launch (stub from week 2) | open |
| O5 | Nightly copy of the private storage buckets to a second EU location: target and budget. | Required for launch (NFR-A2); database backups do not include storage objects. | Before launch | open |
| O6 | Initial platform administrators, verification reviewers and trust-and-safety staff; at least one named person per role. | Three separate roles confirmed (D1): named users, no shared administrator account, more staff added later without redevelopment. Names come before production deployment. First administrator by a one-off audited SQL insert; further roles only through `grant_platform_role`. | Week 3 (admin console); before go-live | roles decided (owner, 2026-10-02); names open |
| O7 | Stripe account (test mode first). | Null provider in development and CI until then. | Week 3 | open |
| O8 | Two-person rule for verification decisions. | None given. | Verification phase | open |
| O9 | Separate staging project. Not addressed by the reply. | A staging project in the same region before production. | Before first deployment | open |
| O10 | Transactional email provider. The owner selects after the team supplies a comparison of 2–3 EU-compatible providers (pricing, EU data location, DPA, expected monthly cost, integration complexity). | Resend (EU region) is the team's working recommendation; local development keeps using the mail catcher. | Week 1 exit criterion (W1) | open; comparison owed by the team |

### Product

| ID | Question | Recommended default, or decision | Needed by | Status |
|---|---|---|---|---|
| P1 | Job order: definition, and who creates one. | A workforce requirement with `visibility = job_order_marketplace`. | Workforce requirements phase | open |
| P2 | Must a worker approve a partner's submission of their profile? | None given. | Partner submissions phase | open |
| P3 | Who may start a conversation? | None given. | Messaging phase | open |
| P4 | Are recruitment-to-recruitment connections allowed? | None given. | Partner network phase | open |
| P5 | One account kind per person? | Yes; `account_kind` is set once and is immutable (FR-A6). | Week 1 (profiles migration); default applies | open |
| P6 | Worker search: anonymity and photos. | Anonymised worker cards (no name, contact or documents); no photos in the MVP. | Find Workers phase | open |
| P7 | MFA scope for ordinary organization members. | Mandatory for owners, admins and platform staff (FR-A4); optional for workers; members not required (see D8). | Week 1 (MFA pages); default applies | open |
| P8 | Launch languages and right-to-left support after Phase 1. | English only in Phase 1 (R8); `app/[lang]` routing and logical CSS are in place from day one. | Before launch | open |
| P9 | Does the reply enlarge Phase 1? It describes the whole product (four user groups, corridor rules engine, boosts, messaging, workforce requirements and matching in the basic plan); Phase 1 is candidate and employer only (R6). The reply asks for the Boost system from the first production architecture, and for limits, trial period and boosts to be editable in the administrator panel; the Phase-1 console has no such pages. | No: the reply is input to the technical specification; Phase 1 scope is unchanged and the schema stays ready for the rest. Confirm that designing the Boost system and the plan and limit editor now, and building them in their later phases, meets the reply. | Before week 2 planning | open; needs owner confirmation |
| P10 | Staff access to candidate documents: may any platform staff role open them? | No staff role opens candidate documents in Phase 1; Trust & Safety acts on reports without document access; revisit with the verification phase. | Week 3 (admin console) | open |
| P11 | Plan-based "priority visibility" (reply 1.2, 1.3; see C16) versus the invariant that paying is not boosted. | A plan never changes ranking; priority placement only through boosts, and labelled as such. | Before launch (`plan_features` rows) | open |
| P12 | Who may suspend or reinstate users and organisations: the Trust & Safety Administrator only, or also the Platform Administrator (the reply lists user management under one role and account restrictions under the other)? | Trust & Safety Administrator only (ARCHITECTURE §11); the Platform Administrator searches and views. | Week 3 (admin console) | open |

## 4. Needed from the owner to finish week 1

| ID | Item | Needed for | Until then | Blocks week 1 |
|---|---|---|---|---|
| W1 | Selected email provider (O10), an account with it, and a sending domain with DNS access (SPF, DKIM, DMARC). | Auth email over custom SMTP; exit criterion "provider sending verified". | Email is checked in the local mail catcher (port 54424). | Yes: the exit criterion cannot be met until a provider is selected |
| W2 | Supabase project in Frankfurt (`eu-central-1`) on the Pro tier (O1, O2 decided); the project itself is still to be created. | First remote deployment. | Local stack and CI only. | No |
| W3 | Branch protection on `main`. Only the repository owner account can enable it. | Enforcing the pull-request workflow (R17). | Followed by convention. | No |
| W4 | Repository visibility: public or private. | Private would allow the client documents to be committed (R19). | `docs/phase-1/client/` and `docs/spec/` stay gitignored. | No |
| W5 | Which PDF is the source product specification. | Tracing requirements and page content to one document. | `docs/phase-1/requirements.js` is the working catalogue. | No |
| W6 | Brand assets: logo, colours. | Layout, design primitives, email templates. | Neutral placeholder styling. | No |
| W7 | Legal texts v1 (see L5, L7). | Sign-up consent (FR-A8) and legal pages. | `legal_documents` rows are DRAFT placeholders. | No |
| W8 | Security contact address. | `SECURITY.md` and vulnerability reports. | No contact address is published. | No |

## 5. Resolved

Do not reopen these. Dated 2026-10-02 unless stated.

### Owner decisions (HANDOFF §2)

| ID | Decision |
|---|---|
| R1 | Backend: Supabase only (Auth, Postgres with RLS, Storage, Edge Functions, pg_cron, pgmq, pg_net). No custom API server. |
| R2 | Frontend: Next.js 16 in `apps/web` (App Router, TypeScript, Tailwind 4), kept portable (`output: 'standalone'`, no vendor-specific features) because hosting is undecided (O3). |
| R3 | Supabase project: created by the owner in the EU; develop locally until it exists; deploy with `npx supabase link`, `db push`, `functions deploy`. The region is Frankfurt (O1, R26). |
| R4 | Payments: Stripe (Checkout, Customer Portal, Tax, webhooks) behind a provider-neutral adapter. |
| R5 | Email: superseded by the owner's decisions reply. The provider is not decided (O10); Resend, EU region, is the team's working recommendation. The provider-neutral design stands: Supabase custom SMTP for auth emails; the provider API from the `notify` Edge Function for transactional emails. |
| R6 | Phase 1 account kinds: candidate (worker) and employer only. |
| R7 | Schema tooling: Supabase CLI SQL migrations are the single source of truth; types generated with `npx supabase gen types` into `packages/db-types`. No ORM. |
| R8 | Language: English only in Phase 1; routing is `app/[lang]` from day one; logical CSS for right-to-left readiness. |
| R9 | Pricing model: plans, limits and features are rows, not code; seeded prices and limits are listed in ARCHITECTURE §10.1. The owner has supplied the limit numbers (C3, R22); limits stay unenforced (`entitlements_enforced = false`) until C11 is decided. |

### Owner decisions reply (2026-10-02)

Source: the owner's decisions reply (2026-10-02; client document, not in git). Open follow-ups are in section 3.

| ID | Decision |
|---|---|
| R20 | Employer base subscription: EUR 39 per month (3900); recruitment and staffing companies get their own plans (C1, D15). |
| R21 | Three tiers (Basic, Professional, Enterprise); CHARA Match and the core workforce-requirement workflow are in the lowest paid plan (C2). |
| R22 | Initial limits per tier as in the C3 table; limits are administrator-editable rows; Enterprise supports per-organization limits (C3). |
| R23 | Verification tiers map to badges as in C4; worker verification is free at launch; paid verification applies primarily to businesses and professional partners. |
| R24 | Trial: payment details collected at registration (read as: at checkout, before the trial starts; C15), automatic conversion after 30 days, one trial per legal entity, disclosure before the trial, administrator-editable trial period (C6, D4). |
| R25 | Prices in EUR, exclusive of VAT; EUR is the billing currency of the first release; more currencies must be possible later (C7). |
| R26 | Hosting: Frankfurt, Pro tier or equivalent, daily backups, point-in-time recovery (O1, O2). |
| R27 | Three separate staff roles at launch — Platform Administrator, Verification Reviewer, Trust & Safety Administrator — with technically separated permissions and named users (D1, O6). Platform Administrator: configuration, user management, subscriptions, pricing, boost and corridor configuration, settings, reporting. Verification Reviewer: business, identity, licence and workforce-capability verification, document review, approvals and rejections. Trust & Safety Administrator: fraud and abuse reports, fake profiles, suspicious documents, misleading job advertisements, complaints, account restrictions, content moderation, escalation. |
| R28 | Global, country-neutral design; legal eligibility, licensing and hiring restrictions are configurable by country and corridor (L2, L4). |
| R29 | Boosts are a separate system, part of the production architecture from the start, for hiring, recruitment and staffing companies, purchasable without a higher plan. Possible functions: top search placement, featured profile, job or requirement, priority visibility, regional or country visibility, homepage or category placement. Administrators control price, duration, placement, country or region, category, availability and promotional discounts (C8). |
| R30 | Recruitment companies and staffing companies remain separate user categories (D7). |
| R31 | Legal documents are drafted by the team and approved by legal counsel (L5). |

### Repository and tooling facts

| ID | Fact |
|---|---|
| R10 | The earlier code skeleton described in the handoff (Express and Prisma API, `docker-compose.yml`, a 25-model `schema.prisma`, an earlier working branch) never existed in this repository. It was scaffolded from scratch; nothing was deleted or carried over. |
| R11 | Local development uses the real Supabase stack in Docker only: `npm run db:start` (wraps `npx supabase start`), `db:stop`, `db:reset`, `db:test`. The CLI is the devDependency `supabase@2.119.0`, always run as `npx supabase`. There is no plain-Postgres shim, no `scripts/db/*.sh`, no port 54329, no `chara.env` setting, no extension guards and no no-Docker runbook; a session without Docker relies on the CI `db` job. |
| R12 | Database tests are pgTAP files in `supabase/tests/database/*.test.sql`, run with `npx supabase test db`. |
| R13 | Local ports: Supabase API 54421, database 54422, shadow database 54420, Studio 54423, mail catcher 54424; web dev server 3100 (auth `site_url` is `http://localhost:3100`). `config.toml` has `project_id = "chara-pinnacle"`. |
| R14 | Node: `.nvmrc` is 24; `engines.node` is `>=22`. |
| R15 | CI: jobs `web` (install, lint, typecheck, build), `db` (`npm run db:start`, `npm run db:test`; later lint and type-drift) and `security` (`npm audit --omit=dev --audit-level=high` blocking, full audit reported, secret-pattern grep excluding `supabase/`, `docs/`, `.github/`) exist. `functions` and `e2e` are added with the first Edge Function and the first user flow. Uses `actions/checkout@v7` and `actions/setup-node@v7`; no `supabase/setup-cli` action, no gitleaks. The forbidden-attribute check is a pgTAP test over `information_schema.columns`, not a grep. |
| R16 | Packages: only `apps/web` (`@chara-pinnacle/web`) exists. `packages/db-types` is created with the first tables; `packages/shared` only when a second consumer needs it; there is no `packages/ref-data` (reference seeds come from `scripts/gen-ref-seeds.mjs`, using `Intl` plus committed code lists). |
| R17 | Workflow: branches `feat/…`, `fix/…`, `chore/…`, one pull request each into `main`, never direct commits to `main`. The handoff's "migration 0001" is delivered as several small timestamped migrations (foundation; reference data; profiles and consents; organizations; billing core); a committed migration is never edited. |
| R18 | Naming: repository, package and project identifiers use `chara-pinnacle`. The product brand "CHARA" and brand-derived identifiers (`CHARA_FORBIDDEN`, `x-chara-signature`, `chara_match`) are unchanged. |
| R19 | Client-facing Word and Excel documents and the spec PDFs are not in git; `docs/phase-1/client/` and `docs/spec/` are gitignored. Revisit only with W4. |
| R32 | 2026-10-03: the Phase 1 requirement catalogue (`docs/phase-1/requirements.js`), the SOP data (`docs/phase-1/sops.json`) and the handoff (`docs/phase-1/HANDOFF.md`) were updated to the owner's decisions reply. Unresolved points are carried there as "to be confirmed by CHARA". |
