# Open questions

## 1. How to use this file

Every open item here is a decision about data or configuration (a seeded row, a setting, a role list, a policy text), not about code structure, so development continues on the recommended default until the owner answers. Nothing here blocks week 1 unless its row says so. IDs are stable — `D` design conflict, `C` commercial, `L` legal, `O` operating, `P` product, `W` week-1 input, `R` resolved — and are referenced from pull requests and from `ARCHITECTURE.md`. When an item is answered, move it to [Resolved](#5-resolved) with the date and the pull request that applied it; do not delete rows.

Abbreviations: HANDOFF = `docs/phase-1/HANDOFF.md`; ARCHITECTURE = `docs/ARCHITECTURE.md`; SDD = Phase 1 System Design Description (client document, not in git, see R19); FR/NFR = `docs/phase-1/requirements.js`.

## 2. Design conflicts to settle before the first migration

The source documents disagreed on these points, or left a gap. In the Conflict column, ARCHITECTURE means the text of that document before the 2026-10-02 reconciliation (precedence used then: HANDOFF §2 and §5 over ARCHITECTURE). The current `docs/ARCHITECTURE.md` already shows each proposed resolution, marked `(proposed — see OPEN_QUESTIONS.md, D<n>)`. A proposal becomes final when the pull request containing the migration is merged.

| ID | Conflict | Proposed resolution | Source that wins | Status |
|---|---|---|---|---|
| D1 | `platform_staff.role`: SDD §4.1 has `admin`, `trust_safety`; ARCHITECTURE adds `verification_reviewer`. | `admin` and `trust_safety` now; add `verification_reviewer` in the verification phase. | SDD §4.1, FR-A7 | proposed |
| D2 | `legal_documents` columns: SDD `slug, version, title, body, change_summary, published_at` (unique `slug` + `version`); ARCHITECTURE `key, version, url, published_at`. | SDD columns. | SDD §4.1 | proposed |
| D3 | `consents`: append-only rule vs a `withdrawn_at` column (the SDD lists both). | Append-only rows with `action` (`granted`, `withdrawn`) and `created_at`; no `withdrawn_at`. Age attestation (FR-A9) is a purpose. | Append-only rule (SDD rule text, ARCHITECTURE) | proposed |
| D4 | `create_organization` inserts a `trialing` subscription; FR-G2 says a card is required at trial start. | No subscription row at organization creation; plan resolves to `free_employer`; the trial row arrives through the billing webhook. | FR-G2 | proposed; needs owner confirmation |
| D5 | `private.org_plan_code` returns NULL when no subscription row exists, which reads as unlimited. | Coalesce to `'free_'` + organization type; an unknown plan code denies. | HANDOFF §5 item 9 | proposed |
| D6 | `private.settings.value` is read both as `value->>0` and as `value::boolean`. | `value jsonb`, always read with `value #>> '{}'` and then cast. | Neither; one convention | proposed |
| D7 | `organization_type` enum has employer, recruitment and staffing types; Phase 1 is employer only. | Keep the enum; `create_organization` rejects non-employer types in Phase 1; seed only the employer plans and `free_employer`. | HANDOFF §2 | proposed |
| D8 | Restrictive aal2 policies vs a new owner who is still at aal1. | Require aal2 only for invitations, `platform_staff`, member-management RPCs and billing reads; never for reading one's own membership or organization. | FR-A4 | proposed |
| D9 | Nothing sets `account_kind = 'worker'` before the passport work package. | A small RPC, `set_account_kind`, plus an immutability trigger in the profiles migration. | FR-A6 | proposed |
| D10 | Invitation email depends on the `notify` function (a later work package); the first demo needs invitations. | `invite_member` returns the token once and the UI shows a copyable link; `accept_invitation` requires a matching email and rejects workers. | Neither; delivery order | proposed; needs owner confirmation |
| D11 | `grant_platform_role` ends sessions through `account-ops`, which does not exist yet. | Keep the table and helper now; add the RPC with the admin console. | FR-A7 | proposed |
| D12 | "Every table has at least one policy" vs unexposed tables in `private`, `audit`, `billing`. | ENABLE + FORCE RLS everywhere; the meta-test accepts "at least one policy OR zero API-role grants". | NFR-S1 ("every exposed table") | proposed; needs owner confirmation |
| D13 | Column name `worker_id` (SDD) vs `worker_user_id` (ARCHITECTURE). | `worker_user_id`. | ARCHITECTURE | proposed |
| D14 | FR-A5 requires changing member roles; no `change_member_role` RPC is listed. | Add it with the organizations migration. | FR-A5 | proposed |
| D15 | Employer Starter price: 3900 vs 4900 cents in the pricing source. | Seed 3900; owner to confirm (C1). | HANDOFF §2 | proposed |
| D16 | `audit.document_access_log` columns: SDD `share_id, document_id, organization_id, accessed_by, accessed_at, outcome` and `document_access_grant(document_id)`; ARCHITECTURE `document_id, worker_user_id, accessor_user_id, accessor_org_id, purpose` and `document_access_grant(p_document_id, p_purpose)`. | SDD names (`share_id`, `organization_id`, `accessed_by`, `accessed_at`) plus `worker_user_id` (the worker's view filters on it without a join) and `purpose` (kept as the second RPC argument). No `outcome`: a refused request raises and writes no row, so the column would hold a single value. | SDD §4.1 for names; ARCHITECTURE for the two added columns | proposed |

## 3. Owner decisions

"Needed by" uses the four-week Phase 1 schedule (week 1 foundation, week 2 profiles and vacancies, week 3 applications and admin, week 4 billing and staging) or a later milestone. "Default applies" means work proceeds on the recommended default.

### Commercial

| ID | Question | Recommended default | Needed by | Status |
|---|---|---|---|---|
| C1 | Employer Starter monthly price: 3900 or 4900 cents? | 3900 (see D15). | Week 4 (checkout); seeded at 3900 from week 1 | open |
| C2 | Which plans include Post Workforce Requirement, CHARA Match, Workforce Corridors, Search Available Workforce, Multi-Partner Invitation, and Job Order posting and access? | Core workflow (Workforce Requirement, CHARA Match) in every paid plan; advanced search, analytics and higher volumes on Professional and Enterprise. | Before launch (`plan_features` rows) | open |
| C3 | Limits per plan: active jobs, active requirements, team members, monthly messages, monthly candidate submissions, partner invitations per requirement. | All NULL (unlimited) with `entitlements_enforced = false`; a limit table can be proposed for approval. | Before go-live (the go-live check requires enforcement on) | open |
| C4 | Which trust badges does each verification level make a company eligible for? | Basic: Identity, Business. Professional: adds Licence, Workforce Capability. Enterprise: multi-country, eligible for Verified Partner. Worker skill verification stays free. | Verification phase | open |
| C5 | Refund rules, verification fees in particular. | None given. | Verification phase | open |
| C6 | Free first month: card collected at sign-up? Automatic conversion after 30 days? One per legal entity? | Yes to all three; duplicates detected by company registration or VAT number. | Week 4 (checkout); see D4 | open |
| C7 | Prices exclusive of VAT and billed in EUR for all customers? | Exclusive of VAT; EUR only in the first release. | Week 4 (checkout) | open |
| C8 | Boost catalogue (products, durations, prices). | Seed values listed in ARCHITECTURE §10.1. | Boosts phase | open |
| C9 | Behaviour on downgrade when usage exceeds the new plan's limits. | Keep data, block creation over the limit. | Before limits are enforced | open |

### Legal

| ID | Question | Recommended default | Needed by | Status |
|---|---|---|---|---|
| L1 | Jurisdiction of the operating legal entity; who acts as Data Protection Officer or EU representative. | None given. | Start now; before legal texts v1 | open |
| L2 | Launch corridors (source country to destination country). | None given; the platform is country-neutral, but legal texts and assessments are corridor-specific. | Before launch | open |
| L3 | Does the platform itself need a recruitment, placement or employment-agency licence in any launch country? | Written legal opinion per launch corridor. | Before launch (launch gate) | open |
| L4 | Which source-country restrictions on direct hiring apply in the launch corridors? | None given; configures the direct "Find Workers" channel per corridor. | Find Workers phase | open |
| L5 | Who authors and approves the Terms of Service, Privacy Policy, Platform Rules and the verification policy? | Structured drafts are supplied for legal review; DRAFT placeholders until approved (see W7). | Week 2 (legal pages); approval before launch | open |
| L6 | Retention periods. | Exports 7 days; verification evidence 24 months after decision; access log 24 months; provider payloads 13 months; inactive worker data 24 months; audit log 6 years. | Before launch (retention job) | open |

### Operating

| ID | Question | Recommended default | Needed by | Status |
|---|---|---|---|---|
| O1 | Database region: Frankfurt or Ireland. | Frankfurt (`eu-central-1`). | Before first deployment (week 4 staging) | open |
| O2 | Supabase tier, point-in-time recovery, separate staging project. | Pro tier with daily backups and PITR from day one; a staging project before production. | Before first deployment | open |
| O3 | Web hosting provider (must offer an EU region and EU log retention). | None given; the app stays portable (`output: 'standalone'`, no vendor-specific features). | Week 4 (staging deploy) | open |
| O4 | Antivirus vendor for uploaded documents. | None given; the scan step stays a stub until chosen. | Before launch (stub from week 2) | open |
| O5 | Nightly copy of the private storage buckets to a second EU location: target and budget. | Required for launch (NFR-A2); database backups do not include storage objects. | Before launch | open |
| O6 | Initial platform administrators and trust-and-safety staff (verification reviewers later); at least one named person per role, roles kept separate. | First administrator by a one-off audited SQL insert; further roles only through `grant_platform_role`. | Week 3 (admin console); before go-live | open |
| O7 | Stripe account (test mode first). | Null provider in development and CI until then. | Week 3 | open |
| O8 | Two-person rule for verification decisions. | None given. | Verification phase | open |

### Product

| ID | Question | Recommended default | Needed by | Status |
|---|---|---|---|---|
| P1 | Job order: definition, and who creates one. | A workforce requirement with `visibility = job_order_marketplace`. | Workforce requirements phase | open |
| P2 | Must a worker approve a partner's submission of their profile? | None given. | Partner submissions phase | open |
| P3 | Who may start a conversation? | None given. | Messaging phase | open |
| P4 | Are recruitment-to-recruitment connections allowed? | None given. | Partner network phase | open |
| P5 | One account kind per person? | Yes; `account_kind` is set once and is immutable (FR-A6). | Week 1 (profiles migration); default applies | open |
| P6 | Worker search: anonymity and photos. | Anonymised worker cards (no name, contact or documents); no photos in the MVP. | Find Workers phase | open |
| P7 | MFA scope for ordinary organization members. | Mandatory for owners, admins and platform staff (FR-A4); optional for workers; members not required (see D8). | Week 1 (MFA pages); default applies | open |
| P8 | Launch languages and right-to-left support after Phase 1. | English only in Phase 1 (R8); `app/[lang]` routing and logical CSS are in place from day one. | Before launch | open |

## 4. Needed from the owner to finish week 1

| ID | Item | Needed for | Until then | Blocks week 1 |
|---|---|---|---|---|
| W1 | Resend account and a sending domain with DNS access (SPF, DKIM, DMARC). | Auth email over custom SMTP; exit criterion "Resend sending verified". | Email is checked in the local mail catcher (port 54424). | Yes: the exit criterion cannot be met |
| W2 | Supabase project in the EU (see O1, O2). | First remote deployment. | Local stack and CI only. | No |
| W3 | Branch protection on `main`. Only the repository owner account can enable it. | Enforcing the pull-request workflow (R17). | Followed by convention. | No |
| W4 | Repository visibility: public or private. | Private would allow the client documents to be committed (R19). | `docs/phase-1/client/` and `docs/spec/` stay gitignored. | No |
| W5 | Which PDF is the source product specification. | Tracing requirements and page content to one document. | `docs/phase-1/requirements.js` is the working catalogue. | No |
| W6 | Brand assets: logo, colours. | Layout, design primitives, email templates. | Neutral placeholder styling. | No |
| W7 | Legal texts v1 (see L5). | Sign-up consent (FR-A8) and legal pages. | `legal_documents` rows are DRAFT placeholders. | No |
| W8 | Security contact address. | `SECURITY.md` and vulnerability reports. | No contact address is published. | No |

## 5. Resolved

Do not reopen these. Dated 2026-10-02 unless stated.

### Owner decisions (HANDOFF §2)

| ID | Decision |
|---|---|
| R1 | Backend: Supabase only (Auth, Postgres with RLS, Storage, Edge Functions, pg_cron, pgmq, pg_net). No custom API server. |
| R2 | Frontend: Next.js 16 in `apps/web` (App Router, TypeScript, Tailwind 4), kept portable (`output: 'standalone'`, no vendor-specific features) because hosting is undecided (O3). |
| R3 | Supabase project: created by the owner in the EU; develop locally until it exists; deploy with `npx supabase link`, `db push`, `functions deploy`. The exact region is O1. |
| R4 | Payments: Stripe (Checkout, Customer Portal, Tax, webhooks) behind a provider-neutral adapter. |
| R5 | Email: Resend, EU region. Supabase custom SMTP for auth emails; Resend API from the `notify` Edge Function for transactional emails. |
| R6 | Phase 1 account kinds: candidate (worker) and employer only. |
| R7 | Schema tooling: Supabase CLI SQL migrations are the single source of truth; types generated with `npx supabase gen types` into `packages/db-types`. No ORM. |
| R8 | Language: English only in Phase 1; routing is `app/[lang]` from day one; logical CSS for right-to-left readiness. |
| R9 | Pricing model: plans, limits and features are rows, not code; seeded prices are listed in ARCHITECTURE §10.1; limits are not enforced (`entitlements_enforced = false`) until the owner supplies numbers (C3). |

### Repository and tooling facts

| ID | Fact |
|---|---|
| R10 | The earlier code skeleton described in the handoff (Express and Prisma API, `docker-compose.yml`, a 25-model `schema.prisma`, an earlier working branch) never existed in this repository. It was scaffolded from scratch; nothing was deleted or carried over. |
| R11 | Local development uses the real Supabase stack in Docker only: `npm run db:start` (wraps `npx supabase start`), `db:stop`, `db:reset`, `db:test`. The CLI is the devDependency `supabase@2.119.0`, always run as `npx supabase`. There is no plain-Postgres shim, no `scripts/db/*.sh`, no port 54329, no `chara.env` setting, no extension guards and no no-Docker runbook; a session without Docker relies on the CI `db` job. |
| R12 | Database tests are pgTAP files in `supabase/tests/database/*.test.sql`, run with `npx supabase test db`. |
| R13 | Local ports: Supabase API 54421, database 54422, shadow database 54420, Studio 54423, mail catcher 54424; web dev server 3100 (auth `site_url` is `http://localhost:3100`). `config.toml` has `project_id = "chara-pinnacle"`. |
| R14 | Node: `.nvmrc` is 24; `engines.node` is `>=22`. |
| R15 | CI: jobs `web` (install, lint, typecheck, build) and `security` (`npm audit --audit-level=high`, secret-pattern grep excluding `supabase/`, `docs/`, `.github/`) exist. Job `db` (`npx supabase start`, `npx supabase test db`; later lint and type-drift) is added with the Supabase setup; `functions` and `e2e` with the first Edge Function and the first user flow. Uses `actions/checkout@v7` and `actions/setup-node@v7`; no `supabase/setup-cli` action, no gitleaks. The forbidden-attribute check is a pgTAP test over `information_schema.columns`, not a grep. |
| R16 | Packages: only `apps/web` (`@chara-pinnacle/web`) exists. `packages/db-types` is created with the first tables; `packages/shared` only when a second consumer needs it; there is no `packages/ref-data` (reference seeds come from `scripts/gen-ref-seeds.mjs`, using `Intl` plus committed code lists). |
| R17 | Workflow: branches `feat/…`, `fix/…`, `chore/…`, one pull request each into `main`, never direct commits to `main`. The handoff's "migration 0001" is delivered as several small timestamped migrations (foundation; reference data; profiles and consents; organizations; billing core); a committed migration is never edited. |
| R18 | Naming: repository, package and project identifiers use `chara-pinnacle`. The product brand "CHARA" and brand-derived identifiers (`CHARA_FORBIDDEN`, `x-chara-signature`, `chara_match`) are unchanged. |
| R19 | Client-facing Word and Excel documents and the spec PDFs are not in git; `docs/phase-1/client/` and `docs/spec/` are gitignored. Revisit only with W4. |
