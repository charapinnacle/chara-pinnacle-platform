# CHARA Architecture — Supabase backend + Next.js 16 frontend

- Status: Accepted. Reconciled with the Phase-1 handoff on 2026-10-02: the owner decisions (§2) and the one-page architecture (§5) of `docs/phase-1/HANDOFF.md` are incorporated, and this is the single current architecture document (see ADR-0002 to ADR-0005). The owner's decisions reply (2026-10-02; client document, not in git) is incorporated as well; its points are tracked in `docs/OPEN_QUESTIONS.md` (R20–R31).
- Last verified against: Next.js 16.3.8 bundled docs, Supabase CLI 2.119.0 config/command specs, supabase/postgres role definitions, product spec (36 sections) and pricing document (both kept locally in `docs/spec`, not in git).
- Markers: "(later phase)" = designed here, not built in Phase 1. "(proposed — see OPEN_QUESTIONS.md, D<n>)" = recommended resolution of a design conflict that is not yet decided. Since 2026-10-03 these proposals are adopted for implementation unless OPEN_QUESTIONS.md says otherwise. "(decided — OPEN_QUESTIONS.md, <ID>)" = settled by the owner.

CHARA is a global workforce network (Search → Match → Connect → Collaborate), not a job board. Four participants (Worker, Employer, Recruitment Company, Staffing Company) plus CHARA platform staff. Workers never pay. Paying ≠ verified ≠ boosted. Candidate documents are private unless the candidate shares them for a specific application.

---

## 1. Overview

Phase 1 scope: candidate (worker) and employer accounts only — public site, vacancies, applications with a journey tracker, employer applicant management (ATS core), platform admin, subscriptions, legal pages and email. Everything else described in this document is later phase and is labelled "(later phase)" where it first appears: recruitment and staffing accounts, workforce requirements, job orders, multi-partner invitations, CHARA Match, corridors, network map, verification badges and fees, boosts, messaging, Find Workers. The schema stays ready for those parts; they are not built now. English is the only language in Phase 1; routing is `app/[lang]` from day one and CSS uses logical properties for RTL readiness.

```
                 ┌────────────────────────────── Browser ──────────────────────────────┐
                 │  Server-rendered HTML (nonce CSP)  ·  Realtime client (Broadcast)   │
                 │  Signed-URL uploads/downloads (60 s)                                │
                 └───────────────┬───────────────────────────────┬─────────────────────┘
                                 │ HTTPS (cookies)               │ wss / https (publishable key + user JWT)
                 ┌───────────────▼───────────────┐               │
                 │   apps/web — Next.js 16       │               │
                 │   proxy.ts: session refresh   │               │
                 │   (getClaims), CSP nonce,     │               │
                 │   locale, optimistic redirect │               │
                 │   Server Components + DAL     │               │
                 │   ('server-only', DTOs)       │               │
                 │   Server Actions (zod → DAL)  │               │
                 │   Holds ONLY publishable key  │               │
                 └───────────────┬───────────────┘               │
                                 │ supabase-js over HTTPS, user session (RLS applies)
┌────────────────────────────────▼───────────────────────────────▼─────────────────────────────┐
│                               Supabase project (Frankfurt)                                    │
│                                                                                               │
│  Auth (GoTrue)      PostgREST Data API        Storage (S3, EU)       Realtime (Broadcast)      │
│  email+pw, TOTP     exposed: public           private buckets        private topics, RLS on   │
│  MFA (aal2),        max_rows 100              owner-only RLS         realtime.messages        │
│  ES256 signing key                                                                            │
│        │                   │                        │                        │                │
│  ┌─────▼───────────────────▼────────────────────────▼────────────────────────▼─────────────┐  │
│  │ Postgres 17 (cloud) — the authorization engine and system of record                   │  │
│  │  public   : tables, views, RPCs — RLS on every table (ENABLE + FORCE), default-deny    │  │
│  │  private  : helper fns (member_org_ids, has_platform_role, is_aal2), settings, counters│  │
│  │  billing  : plans, subscriptions, provider_events — owner billing_owner                │  │
│  │             later phase: boosts, fees                                                  │  │
│  │  audit    : log (append-only), document_access_log                                     │  │
│  │  stats    : materialized views (counters; later: corridors, network) — k-anonymised    │  │
│  │  ext      : pg_cron · pg_net · pgmq · vault · pg_trgm · unaccent · citext · pgcrypto   │  │
│  └────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                               │
│  Edge Functions (Deno, x-region = project region) — the ONLY place the secret key exists      │
│   document-url · billing-webhook · billing-checkout · account-ops · notify · scan-document    │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
          ▲                                        ▲
          │ Stripe webhooks (signature-verified)    │ Resend (EU region) · AV scanner (vendor undecided)
```

Two tiers, one trust boundary: Postgres Row Level Security decides who may read or write what; the Next.js tier can never bypass it because it has no privileged key.

---

## 2. Components

| Component | Responsibility | Technology / notes |
|---|---|---|
| Postgres (Supabase) | System of record and authorization engine. Constraints, RLS, triggers, SECURITY DEFINER RPCs for multi-table writes, matching functions, materialized statistics. | Cloud: Postgres 17 (confirm in dashboard; `db.major_version` must match). Local: the same Supabase stack in Docker (§14.3). Extensions: pgcrypto, pg_trgm, unaccent, citext, btree_gin, pg_stat_statements, pg_cron, pg_net, pgmq, supabase_vault, pgtap (tests). |
| Supabase Auth | Sign-up/in, email confirmation, password policy, TOTP MFA with `aal` claim, session cookies via @supabase/ssr. Trigger creates `public.profiles`. | GoTrue; asymmetric ES256 signing key; `jwt_expiry = 1800`; custom SMTP through the transactional email provider (see Email). |
| Supabase Storage | Private buckets only: passport documents, DSAR exports, organization media; (later phase) verification evidence, safety evidence. | RLS on `storage.objects`, owner-only policies; signed URLs (60 s download, 10 min upload). |
| Supabase Realtime | Messaging (later phase) and notification badges. | Broadcast on private channels; `realtime.broadcast_changes` triggers; no `postgres_changes`. |
| Edge Functions | Only work that needs a secret, outbound network or long processing. Reach the database only through public RPCs granted to `service_role` (§8). | Deno; `verify_jwt = true` except `billing-webhook` (provider signature), `scan-document` (shared-secret header) and `notify` (shared-secret header from the scheduler; Resend webhook signature for delivery events, §4). Limits: 150 s free / 400 s paid wall-clock, 2 s CPU, 256 MB. |
| Scheduler and queues | MV refresh, expiries, retention, billing retries, notifications. | pg_cron → SQL or `net.http_post` to Edge Functions (secret header from Vault); pgmq for retryable jobs. |
| Payments | Subscriptions, checkout, customer portal, tax, webhooks. | Stripe (Checkout, Customer Portal, Tax, webhooks) behind the provider-neutral `BillingProvider` adapter (§10.2); the null/HMAC provider is used in dev, CI and e2e. |
| Email | Auth emails and transactional emails. | Resend, EU region (decided 2026-10-03; OPEN_QUESTIONS.md, O10). Auth emails: Supabase custom SMTP through Resend. Transactional emails: the Resend API called from the `notify` Edge Function, React Email templates in `apps/web/emails`. Local development uses the mail catcher. |
| apps/web | Public site, auth + onboarding, worker and employer dashboards (recruitment and staffing dashboards: later phase), admin console. | `@chara-pinnacle/web`. Next.js 16.3 App Router, React 19.2, TypeScript, Tailwind 4, @supabase/ssr 0.12, supabase-js 2.117, zod, `server-only`. Portable: `output: 'standalone'`, Node runtime, no vendor adapters. Dev server on port 3100. |
| packages/db-types | Generated `Database` type from `npx supabase gen types`. | Created with the first tables. Committed; CI drift check. |
| packages/shared | zod schemas, enums mirrored from DB, application stage machine, limit/feature keys, ISO code helpers. | Pure TypeScript. Created only when a second consumer needs it; until then this code lives in `apps/web/lib`. |
| Reference seeds | ISO 3166-1, ISO 639-1, ISO 4217, ISCO-08, ISIC Rev.4 rows in `supabase/seeds/ref/*.sql`. | Written by `scripts/gen-ref-seeds.mjs` from `Intl` plus committed code lists; no separate package. Licences noted per dataset. |
| Local development | The real Supabase stack in Docker, started through npm scripts. | `npm run db:start` / `db:stop` / `db:reset` / `db:test` wrap `npx supabase …` (CLI is the devDependency `supabase@2.119.0`). Node from `.nvmrc` (24); `engines.node >=22`. No plain-Postgres alternative (§14.2). |
| CI/CD | Lint, typecheck, build; real Supabase stack in GitHub Actions; pgTAP database tests; type drift; Deno tests; Playwright; security checks; deploy to Supabase on main. | GitHub Actions (`actions/checkout@v7`, `actions/setup-node@v7`), Supabase CLI from the npm devDependency, Playwright, Vitest, npm audit, secret-pattern check. Jobs are added as the code they test appears (§14.5). |

---

## 3. Repository layout

Legend: `[now]` exists in the repository today · no marker = target, created by a Phase-1 work package when first needed · `(later phase)` = designed, not built in Phase 1.

```
chara-pinnacle-platform/
  package.json                [now] workspaces: apps/*, packages/*; scripts: dev, build, lint, typecheck, test,
                                    db:start, db:stop, db:reset, db:test (run the Supabase CLI devDependency)
  .nvmrc (24)                 [now] engines.node >=22
  .editorconfig · .gitignore · README.md · .github/CODEOWNERS      [now]
  SECURITY.md
  .github/workflows/ci.yml    [now] jobs today: web · db · security; functions and e2e are added with the
                                    first Edge Function / first user flow (§14.5)
  .github/workflows/deploy-supabase.yml   on push to main (environment "production", required reviewer)
  apps/web/                   [now] @chara-pinnacle/web, the only app; never holds a secret key (ADR-0003); dev server on port 3100.
                                    Today: Next.js 16 skeleton plus the web base (next.config.ts security headers, proxy.ts, lib/env.ts, lib/csp.ts, lib/i18n/locale.ts, lib/safe-next.ts, lib/supabase/, app/api/health, Vitest in tests/unit) and the UI primitives (shadcn/ui on Radix with neutral placeholder tokens in app/globals.css, the public, auth and app layout shells, skip link, toasts, skeleton, empty state and React Hook Form field wrappers).
                                    Everything listed below is the target.
    next.config.ts                  output:'standalone', deploymentId, headers() (HSTS etc.; CSP comes from proxy),
                                    experimental.taint, experimental.globalNotFound, experimental.serverActions.bodySizeLimit '2mb',
                                    images.remotePatterns (project storage host), typedRoutes
    proxy.ts                        updateSession (getClaims) + nonce CSP + locale redirect + optimistic auth redirects
    instrumentation.ts              register(): zod env validation, pino logger with redaction
    app/[lang]/layout.tsx           html lang from next/root-params; calls connection() (every response needs its own nonce) → whole app dynamic
    app/global-not-found.tsx        404 for unmatched URLs; awaits connection() so it is rendered per request with a nonce (experimental.globalNotFound)
    app/[lang]/(public)/            page, jobs, companies, how-it-works, pricing, trust-safety, about, legal/[slug];
                                    (later phase) find-workers, partners/recruitment, partners/staffing,
                                    corridors, network, job-orders
    app/[lang]/(auth)/              login, signup, verify-email, forgot-password, mfa
    app/[lang]/(app)/onboarding/    account kind → worker passport | employer organization → MFA;
                                    (later phase) recruitment/staffing organization wizard, geographies
    app/[lang]/(app)/dashboard/{worker,employer}/        (later phase) dashboard/{recruitment,staffing}/
    app/[lang]/(app)/org/[slug]/    members, jobs, applicants (ATS), billing;
                                    (later phase) workforce profile, availability, requirements, verification
    app/[lang]/(app)/passport/      sections, documents, shares + access log, consents
    app/[lang]/(app)/applications/  candidate applications and journey tracker
    app/[lang]/(admin)/admin/       job moderation, suspensions and reinstatements, legal documents, staff, MFA reset, audit search
                                    (aal2 and a per-page role: moderation, suspensions and reinstatements trust_safety;
                                    legal documents, staff and MFA reset admin);
                                    (later phase) verification queue (role verification_reviewer), reports,
                                    plans, limits and settings editor (role admin)
    app/auth/callback/route.ts      PKCE exchangeCodeForSession → redirect (validated `next`)
    app/auth/confirm/route.ts       verifyOtp(token_hash) for email links
    app/api/health/route.ts         build id only
    app/sitemap.ts · app/robots.ts  search engine readiness (FR-H5)
    lib/env.ts                      zod: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SITE_URL
    lib/supabase/server.ts          createServerClient(cookies getAll/setAll with try/catch)  — 'server-only'
    lib/supabase/proxy.ts           updateSession helper (verbatim Supabase pattern)
    lib/supabase/browser.ts         createBrowserClient — Realtime only
    lib/dal/                        session.ts (getCurrentUser via React cache, requireUser/OrgRole/PlatformRole/Aal2),
                                    orgs.ts, passport.ts, hiring.ts, applications.ts, billing.ts, compliance.ts — DTOs only;
                                    (later phase) trust.ts
    lib/actions/                    'use server' files: zod parse → DAL → redirect/return
    lib/i18n/                       en.json dictionaries, getDictionary(lang)
    components/                     ui (shadcn primitives added with the shadcn CLI, never edited: wrap them), layout (shell, header, footer, skip link), feedback (toast, skeleton, empty state), forms (React Hook Form field wrappers); (later phase) VerifiedBadge (trust) and BoostedRail (billing) — never cross-imported
    emails/                         React Email templates for transactional emails (sent by the notify Edge Function)
    tests/unit, tests/e2e, playwright.config.ts, vitest.config.mts, .env.example (public vars only)
  packages/db-types/                src/database.ts (generated, public schema); created with the first tables
  packages/shared/                  zod schemas, enums, stage machine, limit/feature keys; created only when a second consumer needs it
  supabase/                   [now] today: config.toml, .gitignore and tests/database/000_stack.test.sql; the rest below is the target
    config.toml               [now] generated by `npx supabase init`, then edited; see §15.1 for the values that matter
    migrations/                     <timestamp>_<name>.sql, small and forward-only, one pull request each:
                                    foundation · reference data · profiles and consents · organizations · billing core · …
    seeds/ref/*.sql                 reference data, plans, legal documents; listed in config.toml [db.seed] sql_paths
    seeds/dev/*.sql                 synthetic fixtures; never production; added when first needed
    functions/deno.json             import map
    functions/_shared/              supabase.ts (user + secret clients), auth.ts, audit.ts, http.ts,
                                    billing/provider.ts, billing/providers/{null,stripe}.ts,
                                    database.types.ts (generated: public + billing + audit)
    functions/_tests/               Deno tests (a directory named tests/ would deploy as a function)
    functions/document-url · billing-checkout · billing-webhook · notify · account-ops · scan-document
    functions/.env.example          committed, names only; local values go in functions/.env (gitignored)
    tests/database/*.test.sql [now] pgTAP tests, run with `npx supabase test db` (`npm run db:test`)
  scripts/gen-ref-seeds.mjs         writes supabase/seeds/ref/*.sql from Intl plus committed code lists
  docs/ARCHITECTURE.md (this) · OPEN_QUESTIONS.md                  [now]
  docs/adr/                   [now] 0001 (superseded) · 0002-supabase-backend · 0003-no-secret-keys-in-web ·
                                    0004-csp-and-caching · 0005-rule-based-matching
  docs/phase-1/               [now] HANDOFF.md, requirements.js, sops.json, diagrams/
  docs/phase-1/client/ · docs/spec/   local only (gitignored): client Word/Excel documents and spec PDFs
  docs/COMPLIANCE.md · DATA_CLASSIFICATION.md · THREAT_MODEL.md
  docs/runbooks/{deploy,migrations,incident,dsar,key-rotation,backup-restore}.md
```

Generated types have exactly two locations: `packages/db-types/src/database.ts` (schema `public`, used by apps/web) and `supabase/functions/_shared/database.types.ts` (schemas `public`, `billing`, `audit`, used by Edge Functions only). Edge Function secrets have one local file, `supabase/functions/.env`, described by the committed `supabase/functions/.env.example`.

---

## 4. Data model

Table catalogue. Enum values are lower-case snake_case Postgres enums. Tables are in Phase 1 unless marked "(later phase)". Phase-1 columns follow the Phase-1 design description (entity catalogue); where that catalogue and earlier versions of this document disagreed, the proposed resolution is shown with its D-number.

| Area | Tables and key columns | Rules |
|---|---|---|
| Reference data | `public.countries`, `languages`, `currencies`, `occupations`, `industries` | Read-only for users. ISO 3166-1, ISO 639-1, ISO 4217, ISCO-08, ISIC Rev.4 codes and labels; versioned seeds in `supabase/seeds/ref`. `occupations.label` trigram index, `synonyms text[]`. |
| Identity | `auth.users` (Supabase) + `public.profiles(id = auth.users.id, account_kind worker/company, intended_account_kind worker/company, pending_consents jsonb, display_name, preferred_lang, status active/suspended, deleted_at)` | Created by trigger on sign-up, which copies the intended kind and the consent versions and age attestation ticked on the sign-up form into `intended_account_kind` and `pending_consents`. No email, no password hash in public. After email confirmation `account_kind` is committed once from the intended kind by the RPC `set_account_kind`, which in the same transaction calls `accept_consents` and clears `pending_consents`; an immutability trigger protects `account_kind`; both are in the profiles migration (proposed — see OPEN_QUESTIONS.md, D9; flow in §6.3). |
| Platform staff | `public.platform_staff(user_id, role, granted_by, granted_at, revoked_at)` | Separate table so a profile update can never escalate privilege. `role` values from the first migration: `admin`, `verification_reviewer`, `trust_safety`, with separate permissions and named users, no shared administrator account (decided — OPEN_QUESTIONS.md, D1). Phase 1 builds the administrator console only; the reviewer queue is later phase. |
| Legal documents | `public.legal_documents(slug, version, title, body, change_summary, published_at)`, unique `(slug, version)` | Current version = highest published version per slug (proposed — see OPEN_QUESTIONS.md, D2). |
| Consents | `public.consents(id, user_id, purpose, version, action granted/withdrawn, created_at)` | Append-only; withdrawal inserts a row with `action = 'withdrawn'`; there is no `withdrawn_at` column. Age attestation (FR-A9) is the purpose `age_18_plus` (proposed — see OPEN_QUESTIONS.md, D3). |
| Organizations | `public.organizations(id, type, legal_name, display_name, slug, based_in_country, industry_code, website, status)`, `organization_members(organization_id, user_id, role owner/admin/member, invited_by, accepted_at)`, `organization_invitations(email, role, token_hash, expires_at, accepted_at)` | Slug unique; created only via `create_organization`. Exactly one owner (partial unique index); workers cannot be members (trigger). Invitations are single use with a 7-day expiry. The `organization_type` enum keeps all three company types; Phase 1 creates employer organizations only (proposed — see OPEN_QUESTIONS.md, D7). |
| Workforce profile (later phase) | `organization_geographies`, `organization_occupations`, `organization_industries`, `organization_languages`, `organization_service_types`, `workforce_availability` | `geography_scope` = sources_from / serves_market; based_in stays a column on `organizations` (three geographies). `workforce_availability.updated_at` always displayed. |
| Worker passport | `public.worker_profiles(user_id pk, first_name, last_name, headline, current_country, occupation_id, years_experience, availability, available_from, searchable)`, `worker_skills`, `worker_languages`, `worker_preferred_countries`, `worker_work_authorizations`; (later phase) `worker_preferred_industries`, `worker_experience` | Owner-only. `searchable default false` and stays false in Phase 1. |
| Documents | `public.worker_documents(id, worker_user_id, type, title, bucket_id, storage_path, file_name, mime, size_bytes, scan_status, expires_on, deleted_at)` | Metadata row must exist before upload; owner-only. The owner column is named `worker_user_id` in every worker-owned table (proposed — see OPEN_QUESTIONS.md, D13). |
| Sharing | `public.passport_shares(id, worker_user_id, organization_id, application_id, scope jsonb, consent_id, expires_at, revoked_at)` | Per-organization sharing with a consent row. `scope` is a jsonb array of the ids of the documents the candidate selected for that application, never document types; `document_access_grant` checks the document id, so an unselected document or a later upload of the same type is refused (proposed — see OPEN_QUESTIONS.md, D18). In Phase 1 a share is created by `apply_to_job`, revoked at once by `withdraw_application`, and given `expires_at` by `set_application_status` when the application reaches Hired or Not selected (default 30 days, setting `share_expiry_days_after_final`; OPEN_QUESTIONS.md, P13). |
| Jobs | `public.jobs(id, organization_id, posted_on_behalf_of_organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type, salary_min, salary_max, salary_currency, salary_period hour/month/year, accommodation, visa_support, recruitment_preference, status draft/open/paused/closed/filled, moderation_state visible/hidden/org_suspended, search_vector, created_by, deleted_at)`, `saved_jobs(worker_user_id, job_id)` | `search_vector` generated tsvector; `created_by default auth.uid()`; status transitions guarded by trigger (vacancy transition table below); public read of open, visible jobs only; `moderation_state` is `hidden` when set by `moderate_job` and `org_suspended` when set by `suspend_organization` (§11). Salary: check `salary_min <= salary_max` when both are set; `salary_currency` and `salary_period` are required when either amount is set; no currency conversion in Phase 1 (search filter in §9.2). Jobs can be posted by any company type; `posted_on_behalf_of_organization_id` is null in Phase 1. `saved_jobs` is owner-only. |
| Applications (ATS) | `public.job_applications(id, job_id, worker_user_id, status, cover_note, passport_share_id, profile_snapshot jsonb, created_at)`, `application_events(application_id, from_status, to_status, actor_id, note, created_at)`, `application_notes(application_id, organization_id, author_id, body)` | `status`: applied, viewed, shortlisted, interview, offer, hired, rejected, withdrawn; the UI label of `rejected` is "Not selected". Shortlisting is the `shortlisted` state, set through `set_application_status` and gated by `private.has_feature(org, 'shortlisting')`; there is no separate shortlisted flag (the SDD column `shortlisted` is not created). Unique partial index on `(job_id, worker_user_id) where status <> 'withdrawn'`. Profile snapshot taken at apply. `application_events` is append-only and written by RPCs only; its `note` holds the stage-change note or the decline reason and is visible to the candidate in the journey tracker, and the employer UI labels the field "Visible to the candidate". Internal remarks go only in `application_notes`, which is visible to members of the job's organization only and never shown to the candidate. Writes go through `apply_to_job`, `withdraw_application`, `set_application_status`, `bulk_set_application_status`. Read: `worker_user_id = auth.uid()` or member of the job's organization. |
| Notifications | `public.notifications(user_id, kind, payload, channel, status, sent_at)`, `notification_preferences(user_id, digest, email_undeliverable_at)` | Queued via pgmq and delivered by the `notify` Edge Function through Resend; preferences are checked by the enqueue trigger, mandatory kinds ignore them. Kinds, triggers and recipients: email catalogue below. |
| Hiring network (later phase) | `public.workforce_requirements` (+ `requirement_occupations`), `requirement_invitations`, `partner_responses`, `candidate_submissions`, `connections`, `conversations`, `conversation_participants`, `messages`, `saved_items`, `follows` | Spec §21–§23. |
| Billing | `billing.plans`, `plan_limits`, `plan_features`, `subscriptions`, `customers`, `orders`, `provider_events`; (later phase) `boosts`, `boost_products`, `verification_products`, `verification_fees`, `organization_limit_overrides` | Unexposed schema, owner `billing_owner`; read through public views. Columns in §10.1. |
| Verification (later phase) | `public.verifications` (+ `verification_evidence`, `verification_events`, `badge_definitions`, view `org_badges`) | Writes only via RPC; guard trigger. |
| Moderation | `public.moderation_actions(target_type, target_id, action, statement_of_reasons not null, actor_id)`; (later phase) `reports`, `report_appeals` | Reason mandatory. DSA notice-and-action (reports, appeals) is later phase (§11). |
| Matching (later phase) | `public.match_rules`, `match_runs`, `match_results(reasons jsonb not null)` | Explainable matching (ADR-0005). |
| Audit | `audit.log(id, actor_id, action, entity_type, entity_id, metadata jsonb, ip, created_at)`, `audit.document_access_log(id, share_id, document_id, worker_user_id, organization_id, accessed_by, purpose, accessed_at)` | Insert through `audit.record()` only; UPDATE and DELETE blocked. The document access log is written only by `document_access_grant` and is worker-visible through a view. Its columns are those of the design description plus `worker_user_id` and `purpose`, without `outcome` (proposed — see OPEN_QUESTIONS.md, D16). |
| Settings | `private.settings(key, value jsonb)` | Always read as `value #>> '{}'` and then cast (proposed — see OPEN_QUESTIONS.md, D6). |

Application state machine (SDD §4.2; enforced in `set_application_status`, `bulk_set_application_status` and `withdraw_application`). "Not selected" in the UI and in FR-D2 is stored as `rejected`.

| From | To | Allowed actor | Minimum role |
|---|---|---|---|
| applied | viewed | System, on the first open of the application by a member of the job's organization | `member` |
| applied | shortlisted, interview, rejected | Employer: member of the job's organization | `member`; `shortlisted` also needs `has_feature(org, 'shortlisting')` |
| viewed | shortlisted, interview, rejected | Employer | `member`; as above for `shortlisted` |
| shortlisted | interview, offer, rejected | Employer | `member`; there is no move back to applied or viewed (OPEN_QUESTIONS.md, P17) |
| interview | offer, rejected | Employer | `member` |
| offer | hired, rejected | Employer | `member` |
| any non-final | withdrawn | Candidate who owns the application | none (`worker_user_id = auth.uid()`) |
| hired, rejected, withdrawn | — | Final states; terminal, no transition leaves them | — |

- Owners and admins reach applicant pages only at aal2 (FR-A4); members are not required to enrol (D8, OPEN_QUESTIONS.md, P7).
- Every transition appends an `application_events` row (actor, from, to, note, time) and queues the candidate's `status_changed` email, except a move to `viewed`.
- `withdrawn` revokes the share at once (`revoked_at`, plus the `withdrawn` consent row); `hired` and `rejected` set `passport_shares.expires_at` to now plus `share_expiry_days_after_final` (default 30; OPEN_QUESTIONS.md, P13).
- Bulk changes and declines apply the same guard per application. Before anything is applied the UI shows a confirmation step listing the selected applicants, the target state and the reason. There is no undo: a decline is final and its email is sent (OPEN_QUESTIONS.md, P14).
- For an organization on `free_employer` (lapsed, or any organization on that plan once limits are enforced) `set_application_status`, `bulk_set_application_status` and note inserts are refused and `viewed` is not set; past applicants stay readable (§10.4; OPEN_QUESTIONS.md, C11). `withdraw_application` is never blocked.

Vacancy state machine (FR-C2; enforced by the trigger `private.jobs_guard_transition`, BEFORE UPDATE OF `status` on `public.jobs`; every change is audited). The UPDATE policy already limits status changes to owners and admins.

| From | To | Allowed actor | Check |
|---|---|---|---|
| draft | open | Owner or admin | `active_jobs` limit (§10.4) |
| open | paused, closed, filled | Owner or admin | — |
| open | paused | System, on lapse of the subscription (§10.4) | only with `chara.actor_fn = 'pause_jobs_on_lapse'` |
| paused | open | Owner or admin | `active_jobs` limit |
| paused | closed, filled | Owner or admin | — |
| closed | open | Owner or admin | `active_jobs` limit |
| filled | — | Final state | — |

A Paused vacancy is hidden from search and from public pages (the public read policy requires `status = 'open'`) and closed to new applications (`apply_to_job` requires `status = 'open'` and `moderation_state = 'visible'`); its existing applications continue through the pipeline (OPEN_QUESTIONS.md, P16). Moderation is separate from status: hiding a vacancy changes `moderation_state`, not `status`.

Notifications and transactional email (FR-D6, FR-I2). One `notifications` row per recipient and kind, queued through pgmq and sent by `notify` through the Resend API (EU region). English only in Phase 1; templates in `apps/web/emails`. Emails carry no documents and no notes; they link to the page concerned.

| Kind | Trigger | Recipients | Mandatory or preference |
|---|---|---|---|
| `application_received` | `apply_to_job` | Members of the job's organization | Preference `notification_preferences.digest`: false (default) = one email per application; true = daily summary, sent once a day at 08:00 Central European local time (Europe/Berlin) when there are new applications (OPEN_QUESTIONS.md, P15) |
| `status_changed` | Every application state change except to `viewed` (employer moves, bulk moves, declines, withdrawal) | Candidate | Mandatory transactional email; cannot be switched off |
| `vacancy_hidden` | `moderate_job` hides a vacancy | Owner and admins of the organization | Mandatory |
| `trial_ending` | Stripe `customer.subscription.trial_will_end` (3 days before the trial ends) | Owner | Mandatory |
| `payment_failed` | Stripe `invoice.payment_failed` that sets `past_due_since` | Owner | Mandatory |
| `legal_version` | `publish_legal_document` | All users affected by the new version (accepted documents per account kind) | Mandatory |
| `account_suspended`, `account_reinstated` | `suspend_*` / `reinstate_*` (§11) | The user, or the owner and admins of the organization | Mandatory; carries the statement of reasons |
| `member_invitation`, `deletion_requested`, `deletion_completed`, `mfa_reset` | `invite_member` (§6.3; once `notify` exists), `request_account_deletion` and the completed erasure (§12), `reset_mfa` (§6.1) | The invitee, the account holder, or the user whose factors were reset | Mandatory |

Delivery: `notify` runs every minute, sends with the notification id as idempotency key and records the result through `notify_ack` (`queued`, `sent`, `failed` after retries). Resend delivery webhooks (`delivered`, `bounced`, `complained`), signature-verified by `notify`, are recorded on the notification row through `notify_ack`; a hard bounce or a complaint sets `notification_preferences.email_undeliverable_at`, and later emails to that address are not sent and are recorded as `suppressed`; a trigger on `auth.users` clears `email_undeliverable_at` when the email address changes. pg_cron runs in UTC, so the daily-summary job runs hourly and sends when the hour in Europe/Berlin is 08.

Data rules (enforced in SQL):
1. Country-neutral: ISO 3166-1 alpha-2 everywhere; never hard-code corridors.
2. Taxonomies: ISCO-08/ESCO, ISIC Rev.4, ISO 639-1, ISO 4217 minor units, UTC timestamps.
3. Company geography has three dimensions: based in / sources from / serves.
4. Job ≠ Workforce Requirement; a Job Order is a requirement with `visibility = job_order_marketplace` (assumed; later phase).
5. Forbidden attributes: no ID numbers, no date of birth, no nationality, religion, gender or marital-status columns, as fields or as filters; work authorization per country instead. Enforced by a pgTAP test over `information_schema.columns`.
6. Worker data private by default; sharing requires a consent row and, in Phase 1, a specific application; documents never public.
7. Subscription, Verification and Boost are three separate systems; billing code cannot write verification rows.
8. Live statistics come only from the database; small counts are suppressed.
9. Append-only audit log for admin, verification, document, consent and billing actions.
10. Matching v1 is rule-based and explainable; every match stores its reasons.

---

## 5. Tenancy, roles and Row Level Security

### 5.1 Roles

| Role | Used by | Notes |
|---|---|---|
| `anon`, `authenticated` | PostgREST, Storage, Realtime | Default-deny; explicit per-table grants. |
| `service_role` (BYPASSRLS) | Edge Functions only | Never configured in apps/web. Has no direct table grants in any schema; it reaches data only through the service RPCs listed in §8 (asserted by a test). |
| `postgres` (NOSUPERUSER, BYPASSRLS, CREATEROLE) | Migrations, owner of all SECURITY DEFINER RPCs | Verified attributes in supabase/postgres. FORCE RLS therefore does not break postgres-owned RPCs. |
| `billing_owner` (NOLOGIN, created with schema `billing` by the first billing migration (U14), not by the foundation migration; `grant billing_owner to postgres`) | Owner of schema `billing` and of `public.billing_ingest_event()` / `public.billing_apply_event()` | Has zero privileges on `public.verifications*`; asserted by a test. BYPASSRLS is not inherited through role membership, so every `billing` table has a policy `to billing_owner using (true) with check (true)`. |
| `supabase_auth_admin` | GoTrue | Only touched if the access-token hook is adopted later. |

Baseline grants (foundation migration, verified Supabase form):

```sql
revoke all on schema public from public;
grant usage on schema public to anon, authenticated;
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role, public;
alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated, service_role;
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from anon, authenticated, service_role, public;
```

Every table is then granted explicitly to `anon` / `authenticated` (column lists for INSERT/UPDATE so clients cannot set `organization_id`, `created_by`, `status` fields reserved to RPCs), and gets `enable row level security` + `force row level security` in the same migration that creates it. `service_role` receives no table grants, only EXECUTE on the service RPCs (§8). A pgTAP meta-test asserts that every table in `public`, `private`, `billing` and `audit` has RLS enabled and forced, and has at least one policy or zero grants to the API roles (proposed — see OPEN_QUESTIONS.md, D12).

### 5.2 Identity and tenancy model

- `auth.users` → `public.profiles` (1:1, created by trigger `private.handle_new_user()`; `intended_account_kind` from the sign-up form; `account_kind` null until committed from it after email confirmation, then `worker` or `company`, immutable afterwards; set by `set_account_kind` and guarded by a trigger — proposed, see OPEN_QUESTIONS.md, D9; §6.3).
- `public.organizations` (`type` employer | recruitment_company | staffing_company, `slug citext unique`, `based_in_country`), `public.organization_members` (`role` owner | admin | member, `accepted_at`), `public.organization_invitations` (email citext, token_hash, role, expires_at). Phase 1 has employer organizations only: the enum keeps all three values and `create_organization` rejects the other two (proposed — see OPEN_QUESTIONS.md, D7).
- `public.platform_staff` (`role` admin | verification_reviewer | trust_safety, all three in the `platform_role` enum from the first migration — decided, OPEN_QUESTIONS.md, D1). One row per named person and role; further staff are added as rows, without code changes. Phase 1 builds the administrator console only; the verification reviewer queue is later phase.
- A user may belong to several organizations; the active organization is chosen by URL (`/org/[slug]`) and validated by the DAL against membership, never trusted from a cookie alone.

### 5.3 Claims vs lookups

Lookups for everything authorization-relevant (membership, roles, platform roles): immediate revocation, no stale-claim window. JWT is read only for `sub` (`auth.uid()`) and `aal` (MFA level, issued by Auth). The custom access token hook is not used in the foundation.

### 5.4 Helper functions (schema `private`)

```sql
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;   -- functions still need explicit EXECUTE

create or replace function private.role_rank(r public.member_role) returns int
language sql immutable as $$ select case r when 'owner' then 3 when 'admin' then 2 else 1 end $$;

-- Set-returning helper: used as `organization_id in (select private.member_org_ids('admin'))`
-- Postgres evaluates the sub-select once per statement (hashed subplan), not once per row.
create or replace function private.member_org_ids(p_min_role public.member_role default 'member')
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = (select auth.uid())
    and m.accepted_at is not null
    and private.role_rank(m.role) >= private.role_rank(p_min_role)
$$;

create or replace function private.is_org_member(p_org uuid, p_min_role public.member_role default 'member')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.member_org_ids(p_min_role) o where o = p_org)
$$;

create or replace function private.org_type(p_org uuid) returns public.organization_type
language sql stable security definer set search_path = '' as $$
  select o.type from public.organizations o where o.id = p_org
$$;

-- public.platform_role is enum ('admin', 'verification_reviewer', 'trust_safety') (decided — OPEN_QUESTIONS.md, D1)
create or replace function private.has_platform_role(p_role public.platform_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_staff s
                 where s.user_id = (select auth.uid()) and s.role = p_role and s.revoked_at is null)
$$;

create or replace function private.is_aal2() returns boolean
language sql stable as $$ select coalesce((select auth.jwt()->>'aal') = 'aal2', false) $$;

create or replace function private.account_kind() returns public.account_kind
language sql stable security definer set search_path = '' as $$
  select p.account_kind from public.profiles p where p.id = (select auth.uid())
$$;

-- For every helper:
revoke all on function private.member_org_ids(public.member_role) from public;
grant execute on function private.member_org_ids(public.member_role) to authenticated;
```

Hot index: `create index organization_members_user_org on public.organization_members (user_id, organization_id) include (role, accepted_at);` plus an index on every column a policy filters on.

### 5.5 Policy conventions

- One policy per (command, audience); descriptive names `<table>_<command>_<audience>`; `to` always explicit; public reads `to anon, authenticated`, member logic `to authenticated` only (so anon never evaluates membership helpers).
- Always `(select auth.uid())`, never bare `auth.uid()`.
- No cross-table joins inside policies except through `private.*` helpers.
- `as restrictive` only for MFA (`aal2`) gates and moderation visibility. aal2 is required only for invitations, `platform_staff`, member-management RPCs and billing reads; never for reading one's own membership or organization, so a new owner still at aal1 can reach onboarding and MFA enrolment (proposed — see OPEN_QUESTIONS.md, D8).
- Multi-table or privileged writes go through SECURITY DEFINER RPCs in `public` (owned by `postgres`, `set search_path = ''`, first lines re-check `auth.uid()`/role/aal, write `audit.record()`).
  - Phase 1: `accept_consents`, `withdraw_consent`, `set_account_kind` (added with the profiles migration; proposed — see OPEN_QUESTIONS.md, D9), `create_organization`, `invite_member`, `accept_invitation`, `remove_member`, `transfer_ownership`, `change_member_role` (added with the organizations migration; proposed — see OPEN_QUESTIONS.md, D14), `grant_platform_role` (added with the admin console; proposed — see OPEN_QUESTIONS.md, D11), `create_worker_passport`, `document_access_grant`, `search_jobs`, `apply_to_job`, `withdraw_application`, `set_application_status`, `bulk_set_application_status`, `moderate_job`, `suspend_user`, `suspend_organization`, `reinstate_user`, `reinstate_organization` (§11), `reset_mfa` (§6.1; proposed — see OPEN_QUESTIONS.md, D17), `publish_legal_document`, `billing_checkout_start`, `request_data_export`, `request_account_deletion`.
  - Later phase: `share_document`, `withdraw_share` (sharing outside an application), `publish_requirement`, `invite_partners`, `respond_to_invitation`, `submit_candidate`, `approve_submission`, `chara_match`, `verification_start/submit/claim/request_info/decide/suspend`, `report_content`, `moderation_decide`.
- Service RPCs called by Edge Functions have EXECUTE granted to `service_role` only; they are listed in §8.
- RPC errors use stable codes (`CHARA_FORBIDDEN`, `CHARA_LIMIT_REACHED`, `CHARA_FEATURE_NOT_IN_PLAN`, `CHARA_DOCUMENT_NOT_SCANNED`, …) that the DAL maps to UI messages.

### 5.6 Example policy set — `public.jobs`

```sql
alter table public.jobs enable row level security;
alter table public.jobs force row level security;

grant select on public.jobs to anon, authenticated;
grant insert (organization_id, posted_on_behalf_of_organization_id, title, description, occupation_id,
              industry_code, country_code, city, employment_type, salary_min, salary_max, salary_currency,
              salary_period, accommodation, visa_support, recruitment_preference)
  on public.jobs to authenticated;                      -- created_by uses `default auth.uid()`, status defaults to 'draft'
grant update (title, description, occupation_id, industry_code, country_code, city, employment_type,
              salary_min, salary_max, salary_currency, salary_period, accommodation, visa_support,
              recruitment_preference, status)
  on public.jobs to authenticated;                      -- organization_id / created_by are not updatable
grant delete on public.jobs to authenticated;

create policy jobs_select_public on public.jobs
  for select to anon, authenticated
  using (status = 'open' and deleted_at is null and moderation_state = 'visible');

create policy jobs_select_member on public.jobs
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- Any company type may post jobs (posted_on_behalf_of_organization_id names the hiring organization when a
-- partner posts for it); the policy does not test the organization type. Phase 1 only has employer organizations (D7).
create policy jobs_insert_admin on public.jobs
  for insert to authenticated
  with check (organization_id in (select private.member_org_ids('admin')));

create policy jobs_update_admin on public.jobs
  for update to authenticated
  using  (organization_id in (select private.member_org_ids('admin')))
  with check (organization_id in (select private.member_org_ids('admin')));

create policy jobs_delete_owner on public.jobs
  for delete to authenticated
  using (organization_id in (select private.member_org_ids('owner')));

-- Example restrictive MFA gate. aal2 gates cover invitations, platform_staff and billing reads only;
-- never the reading of one's own membership or organization (proposed — see OPEN_QUESTIONS.md, D8).
create policy organization_invitations_requires_mfa on public.organization_invitations
  as restrictive for all to authenticated
  using ((select private.is_aal2()));
```

Worker data: `worker_profiles` and children are selectable only by the owner or by members of an organization with an active `passport_shares` row whose consent is not withdrawn. Platform staff have no read path to worker documents in Phase 1 (FR-F3; a policy test asserts it); reviewer access with aal2 arrives with the verification phase. Find Workers (later phase): company users search workers only through `public.worker_search` (security_invoker view: headline, occupation, skills + verified flags, languages, work-authorization countries, availability, current country — never name, contact or documents; a test asserts the column list from `information_schema`).

### 5.7 Testing policies

Every policy has a positive, a negative and a cross-tenant test. Tests are pgTAP files in `supabase/tests/database/*.test.sql`, run with `npx supabase test db` (`npm run db:test`):

```sql
begin;
select plan(1);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated","aal":"aal1"}', true);
select is_empty(
  $$ select 1 from public.organization_members where organization_id = '…org-b…' $$,
  'member of org A cannot read members of org B');
select * from finish();
rollback;
```

This is exactly how PostgREST sets the role and claims, so the tests exercise the same path as the Data API. The same suite runs locally and in the CI `db` job.

---

## 6. Authentication and sessions

### 6.1 Auth configuration

- Providers: email + password (minimum 12 characters, email confirmation required, `secure_password_change = true`), OAuth (Google/Microsoft) for company users later via the same callback. Magic link optional for workers later. Anonymous sign-ins disabled.
- MFA: TOTP enrol/verify enabled. Mandatory for platform staff and organization owners/admins (enforced three ways: `as restrictive` aal2 policies on sensitive tables, aal2 checks inside RPCs, `requireAal2()` in the DAL which redirects to `/[lang]/mfa`). Optional for workers.
- MFA recovery (proposed — see OPEN_QUESTIONS.md, D17): there are no recovery codes (Supabase TOTP issues none, and a custom code cannot raise a session to aal2). The MFA page lets a user enrol a second TOTP factor as a backup, for example on a second device. A lost device is reset by a Platform Administrator after an identity check: the console calls `reset_mfa(user_id, reason)` (role `admin` + aal2, never on oneself, reason mandatory, `audit.record`), which has `account-ops` delete the user's TOTP factors through the Auth admin API and sign the user out globally; the user enrols again on the next protected page, and the mandatory `mfa_reset` email is queued (§4).
- JWT: asymmetric ES256 signing key enabled at project creation so `getClaims()` verifies locally against JWKS; `jwt_expiry = 1800`; refresh-token rotation and reuse detection on.
- Rate limits: `[auth.rate_limit]` defaults, tuned after launch; Auth emails go through Supabase custom SMTP on the transactional email provider; transactional emails are sent by the `notify` Edge Function through that provider's API. The provider is Resend, EU region (decided; OPEN_QUESTIONS.md, O10).

### 6.2 Next.js 16 wiring (verified against bundled docs)

- `middleware.ts` is deprecated; `apps/web/proxy.ts` exports `proxy(request)` and runs on the Node runtime. Matcher: `'/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)'` — it must not exclude app routes because Server Functions are POSTs to the page route (a matcher that excludes a path silently removes session refresh and CSP for its actions).
- `lib/supabase/proxy.ts` is the documented `updateSession`: create `createServerClient(url, publishableKey, { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies, headers) => { write to request.cookies; recreate NextResponse.next({ request: { headers: requestHeaders } }); set cookies and headers on it } } })`, then immediately `await supabase.auth.getClaims()` (no code in between), then optimistic redirects, then return the same response object. `getSession()` is never trusted on the server.
- `proxy.ts` also generates the CSP nonce (`crypto.randomUUID()` base64), sets `Content-Security-Policy` on both request and response headers, `x-nonce`, `x-request-id`, and redirects paths without a locale prefix to `/en/...` (except `/auth/*`, `/api/*`).
- `lib/supabase/server.ts`: `const cookieStore = await cookies()` (async in 16); `setAll` wrapped in try/catch because Server Components cannot write cookies; cookies are set only in Server Actions and Route Handlers.
- Proxy is an optimistic check only. Every Server Action and Route Handler re-reads the session through the DAL and RLS is the final check.
- DAL (`lib/dal/session.ts`, `import 'server-only'`): `getCurrentUser = cache(async () => { claims via getClaims(); profile lookup; return narrow DTO { id, accountKind, platformRoles, aal, displayName } })`, `requireUser()`, `requireOrgRole(slug, minRole)`, `requirePlatformRole(role)`, `requireAal2()`. Raw rows never reach Client Components; `experimental.taint` is on and `taintUniqueValue` is applied to tokens. Session reads sit behind `<Suspense>` boundaries and layouts never await the session at top level (keeps the Cache Components migration a config change).
- Server Actions: `useActionState` forms, zod validation, `redirect()` after success. Built-in Origin/Host CSRF check; `experimental.serverActions.allowedOrigins` only if a reverse proxy rewrites Host; `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` set per environment; `deploymentId = process.env.DEPLOYMENT_VERSION` for skew protection.
- Route Handlers exist only for `auth/callback`, `auth/confirm`, `api/health`. No provider webhook ever hits Next.js.
- Browser client (`createBrowserClient`, publishable key, reads the non-httpOnly auth cookies exactly as @supabase/ssr documents) is used only for Realtime subscriptions. Everything else goes through the server. The strict nonce CSP (ADR-0004) is what makes keeping cookies readable by the browser acceptable.

### 6.3 Onboarding per user type

1. Sign-up asks "candidate or company" first, because the kind decides which consent and age-attestation checkboxes are shown (documents per kind: OPEN_QUESTIONS.md, L9). The form collects email + password, the intended kind, versioned consent to the documents shown for that kind, and the age attestation (FR-A9, consent purpose `age_18_plus`; no date of birth is stored) (proposed — see OPEN_QUESTIONS.md, D3). They travel as sign-up metadata; `private.handle_new_user()` copies them into `profiles.intended_account_kind` and `profiles.pending_consents`. No `consents` row is written before the email is confirmed.
2. After email confirmation, `/[lang]/onboarding` shows the intended kind and commits it once through the RPC `set_account_kind`, which copies `intended_account_kind` into `account_kind`, calls `accept_consents` with the versions held in `pending_consents` (writing the `consents` rows in the same transaction) and clears `pending_consents`; a trigger makes `account_kind` immutable afterwards (proposed — see OPEN_QUESTIONS.md, D9). If a document version shown at sign-up has been superseded, the user accepts the current version first.
   - Worker → `create_worker_passport(first_name, last_name, current_country, preferred_lang)` → `worker_profiles` (`searchable = false`) → worker dashboard with passport completion checklist.
   - Employer → `create_organization(type, legal_name, display_name, based_in_country, website)` inserts organization + owner membership + audit row atomically → MFA enrolment (blocking for the owner). No subscription row is inserted at this point: the plan resolves to `free_employer`, and the `trialing` subscription row arrives through the billing webhook after checkout, where the card is collected before the trial starts (FR-G2) (decided — OPEN_QUESTIONS.md, D4; card timing to be confirmed — OPEN_QUESTIONS.md, C15; trial rules in §10.1). In Phase 1 `create_organization` rejects the recruitment and staffing types (proposed — see OPEN_QUESTIONS.md, D7).
   - Recruitment / Staffing (later phase) → same RPC, then the "Where do you serve?" wizard (three geographies, industries, occupations, languages, service types, capacity).
3. Members: `invite_member(org, email, role)` → `organization_invitations` (hashed token, 7 days). The RPC returns the token once and the UI shows a copyable invitation link; the invitation email is added when the `notify` function exists. `accept_invitation(token)` requires the caller's email to match the invitation and rejects workers (proposed — see OPEN_QUESTIONS.md, D10). Roles are changed with `change_member_role` (proposed — see OPEN_QUESTIONS.md, D14).
4. Platform staff are never self-service and never share an account: `grant_platform_role(user, role)` takes any of the three roles `admin`, `verification_reviewer`, `trust_safety` (decided — OPEN_QUESTIONS.md, D1), requires an existing admin with aal2, is audited, and calls `account-ops` to sign the target out globally so a fresh session carries the new state. The `platform_staff` table and `private.has_platform_role()` are created now; the RPC is added with the admin console, when `account-ops` exists (proposed — see OPEN_QUESTIONS.md, D11). The first admin is created by a one-off, ticketed SQL statement in production (owner question).

---

## 7. Storage and documents

### 7.1 Buckets (created in migration via `insert into storage.buckets`, mirrored in `config.toml`)

| Bucket | Public | Limit | MIME | Path convention |
|---|---|---|---|---|
| `passport-documents` | no | 15 MB | pdf, jpeg, png | `{worker_user_id}/{document_id}/{sanitised_filename}` |
| `verification-evidence` (later phase) | no | 25 MB | pdf, jpeg, png | `{organization_id}/{verification_id}/{filename}` |
| `dsar-exports` | no | 200 MB | zip | `{user_id}/{request_id}.zip` (7-day lifecycle) |
| `safety-evidence` (later phase) | no | 10 MB | pdf, jpeg, png | `{report_id}/{filename}` |
| `org-media` | no | 2 MB | jpeg, png, webp, svg | `{organization_id}/logo.{ext}` |

All buckets are private with owner-only policies. The first folder is always the owning principal, so owner policies are one-liners. Identity document numbers are not stored anywhere (file + expiry only). Worker photos are excluded from the MVP (protected-attribute proxy).

### 7.2 Storage policies (example — `passport-documents`)

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('passport-documents', 'passport-documents', false, 15728640,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

create policy passport_docs_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'passport-documents'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- metadata first: the document_id folder must belong to a worker_documents row owned by the uploader
create policy passport_docs_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'passport-documents'
          and (storage.foldername(name))[1] = (select auth.uid())::text
          and exists (select 1 from public.worker_documents d
                      where d.id::text = (storage.foldername(name))[2]
                        and d.worker_user_id = (select auth.uid())
                        and d.deleted_at is null));

create policy passport_docs_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'passport-documents'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Deliberately NO policy lets an organization SELECT passport objects: third-party access exists only via the broker.
```

`verification-evidence` (later phase): insert/select by org owners/admins on their folder; select by `verification_reviewer` with aal2; no client delete (retention job only). `org-media`: private like the others; select/insert/update/delete by org admins on their own folder only, no public or anonymous read policy. How a logo is served on public pages is not designed yet; it must not make the bucket public. `dsar-exports`: select by owner path within 7 days.

### 7.3 Access flow (sharing, signed URLs, access log)

1. Upload: Server Action validates type/size (zod), inserts `worker_documents` (`scan_status = 'pending'`), mints `createSignedUploadUrl(path)` with the user's server session (the INSERT policy applies), returns it; the browser PUTs the bytes directly to Storage. A database webhook on `storage.objects` INSERT (`supabase_functions.http_request` → `scan-document`, shared-secret header) checks magic bytes and, once a vendor exists, scans; until then `scan_status = 'skipped'` and documents are served download-only (`Content-Disposition: attachment`). `scan-document` writes the result through the service RPC `document_set_scan_status`, never by a direct table update.
2. Share: in Phase 1 a share exists only for a specific application. `apply_to_job(job_id, note, document_ids)` inserts a `consents` row (`purpose = 'share_passport:<org>'`, version of the sharing notice, `action = 'granted'`) and a `passport_shares` row (`application_id` set, `scope` = jsonb array of the ids of the documents the candidate selected; each id must be the caller's own, non-deleted `worker_documents` row) (proposed — see OPEN_QUESTIONS.md, D18); `withdraw_application` sets `revoked_at` and inserts the `withdrawn` consent row. When the application reaches `hired` or `rejected`, `set_application_status` sets `expires_at` (default 30 days; OPEN_QUESTIONS.md, P13). The worker's passport page lists shares and the access log. Sharing outside an application (`share_document(organization_id, scope jsonb, expires_at)` / `withdraw_share`) is later phase.
3. Access (organization member; reviewers in the verification phase): Server Action → DAL → `supabase.functions.invoke('document-url', { body: { documentId, purpose }, region })` with the user's JWT → the function builds a user-scoped client from the forwarded Authorization header and calls `rpc('document_access_grant')`:

```sql
create or replace function public.document_access_grant(p_document_id uuid, p_purpose text)
returns table (bucket_id text, object_path text, file_name text)
language plpgsql security definer set search_path = '' as $$
declare d public.worker_documents%rowtype; v_uid uuid := (select auth.uid()); v_org uuid; v_share uuid;
begin
  if v_uid is null then raise exception 'CHARA_UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into d from public.worker_documents where id = p_document_id and deleted_at is null;
  if not found then raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.scan_status not in ('clean','skipped') then raise exception 'CHARA_DOCUMENT_NOT_SCANNED'; end if;
  if d.worker_user_id <> v_uid then
    select s.organization_id, s.id into v_org, v_share
    from public.passport_shares s join public.consents c on c.id = s.consent_id
    where s.worker_user_id = d.worker_user_id
      and s.organization_id in (select private.member_org_ids())
      and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
      and c.action = 'granted'
      and s.scope ? d.id::text   -- scope lists document ids, not types (proposed — see OPEN_QUESTIONS.md, D18)
      -- append-only consent ledger: a later 'withdrawn' row cancels the grant (proposed — see OPEN_QUESTIONS.md, D3)
      and not exists (select 1 from public.consents w
                      where w.user_id = c.user_id and w.purpose = c.purpose
                        and w.action = 'withdrawn' and w.created_at > c.created_at)
    limit 1;
    -- Phase 1: no platform-staff path (FR-F3). The role exists from the first migration (D1); the verification
    -- phase adds "or (private.has_platform_role('verification_reviewer') and private.is_aal2())".
    if v_org is null then
      raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  -- columns and the p_purpose argument: proposed — see OPEN_QUESTIONS.md, D16; accessed_at defaults to now()
  insert into audit.document_access_log (share_id, document_id, worker_user_id, organization_id, accessed_by, purpose)
  values (v_share, d.id, d.worker_user_id, v_org, v_uid, p_purpose);
  return query select d.bucket_id, d.storage_path, d.file_name;
end $$;
revoke all on function public.document_access_grant(uuid, text) from public;
grant execute on function public.document_access_grant(uuid, text) to authenticated;
```

   Because the grant checks the document id, a pgTAP test (`supabase/tests/database/`) asserts that, for an active share, `document_access_grant` refuses with `CHARA_FORBIDDEN` both a document of a shared type that the candidate did not select and a document of the same type uploaded after the application, and writes no access-log row for either (proposed — see OPEN_QUESTIONS.md, D18).
4. The function then uses the secret client only to `createSignedUrl(path, 60, { download: file_name })` and returns the URL. No access-log row, no URL. The worker reads `public.v_my_document_access_log` (security_invoker over `audit.document_access_log`, policy `worker_user_id = auth.uid()`).
5. Retention: `retention_policies(entity, days)` rows drive `private.apply_retention()` (pg_cron daily); object deletion always goes through the Storage API from `account-ops` (SQL deletes on `storage.objects` would orphan S3 objects). Account erasure purges the whole `{user_id}/` prefix.
6. Backups: Supabase database backups exclude Storage objects, so a nightly replication of the private buckets to a CHARA-controlled EU object store is a launch requirement (`account-ops` job or an external scheduled job; budget is an owner question).

---

## 8. Where logic lives

| Rule | Lives in | Examples |
|---|---|---|
| Must be true regardless of caller (ownership, visibility, limits, status transitions, append-only, k-anonymity, workers never pay) | Postgres: constraints, RLS, triggers, security_invoker views | `audit.log` immutability trigger; owner-count constraint; `jobs_enforce_limits` trigger; application transition guard; `guard_verification_transition` (later phase) |
| Touches several tables or needs a privileged read | SECURITY DEFINER RPC in `public` (owned by postgres, `set search_path = ''`, re-checks uid/role/aal, writes audit) | `create_organization`, `apply_to_job`, `set_application_status`, `document_access_grant`; later phase: `verification_decide`, `chara_match` |
| Needs a secret, outbound network or long runtime | Edge Function (one capability each); database access only through RPCs | `billing-checkout`, `billing-webhook`, `document-url`, `notify`, `account-ops`, `scan-document` |
| Scheduled | pg_cron → SQL function; pg_net to an Edge Function when the outside world is needed; pgmq for retries | MV refresh, expiries, retention, billing retry, notification fan-out |
| Rendering, forms, navigation, i18n | Next.js Server Components and thin Server Actions (zod → DAL → RPC/table via the user's session) | — |

Edge Functions and the database: an Edge Function never reads or writes a table directly. Calls made on behalf of a user (`document_access_grant`, `billing_checkout_start`) use a client scoped to the caller's JWT. Privileged calls use the secret key, and `service_role` can only execute these public RPCs (`grant execute … to service_role`, revoked from `public`, `anon`, `authenticated`):

| Service RPC | Called by | Effect |
|---|---|---|
| `billing_ingest_event` | `billing-webhook` | Idempotent insert into `billing.provider_events` (unique provider + provider event id). |
| `billing_apply_event` | `billing-webhook`, billing retry job | Applies a stored event to subscriptions, customers and orders. |
| `audit_record_external` | any function | Appends an `audit.log` row for an action that happened outside the database. |
| `document_set_scan_status` | `scan-document` | Sets `worker_documents.scan_status`. |
| `notify_dequeue` / `notify_ack` | `notify` | Reads a batch from the pgmq notification queue; records delivery status (send result and Resend delivery webhooks; a bounce or complaint marks the address undeliverable, §4) and archives the message. |
| `erase_user` | `account-ops` | Pseudonymises audit, billing and application rows and deletes passport rows after the cooling-off period. |

`service_role` has no direct table grants in any schema; a pgTAP test asserts this. Storage and Auth admin calls (signed URLs, prefix purge, user deletion, global sign-out, sign-in ban and lifting it on suspension and reinstatement (§11), TOTP factor deletion for an MFA reset (§6.1)) go through their own APIs with the secret key; the RPCs `suspend_user`, `suspend_organization`, `reinstate_user` and `reset_mfa` queue an `account-ops` job through pgmq after their audit row is written.

Privileged-operation confinement: the secret key is an Edge Function secret only; `billing_ingest_event` and `billing_apply_event` are owned by `billing_owner` with EXECUTE for `service_role` only; `audit.log` accepts rows only through `audit.record()` (wrapped by `audit_record_external` for Edge Functions); the CI `security` job fails if `sb_secret_|service_role|SUPABASE_SECRET` appears outside `supabase/`, `docs/` and `.github/`; ESLint `no-restricted-imports` forbids importing anything from `supabase/functions` or a secret-key client into `apps/web`.

Rate limiting: Auth built-ins; `private.check_rate_limit(key, max, window)` at the top of abuse-prone RPCs (messages, reports, invitations, match runs, document-url); bucket size/MIME limits; `serverActions.bodySizeLimit = '2mb'`; a CDN/WAF in front of the web host once chosen.

---

## 9. Matching, search, corridors and statistics

Phase 1 builds only job search (`search_jobs`), the job and application indexes, and the platform counts. Workforce profiles, requirements, partner search, CHARA Match, corridors and the network map are later phase; their design is kept below.

### 9.1 Tables and indexes

- Workforce profile (later phase): `organization_geographies(scope sources_from | serves_market)` (+ `based_in_country` on organizations), `organization_occupations`, `organization_industries`, `organization_languages`, `organization_service_types`, `workforce_availability(organization_id, source_country, occupation_id, available, updated_at)`.
- Hiring, Phase 1: `jobs`, `saved_jobs`, `job_applications`, `application_events`, `application_notes` (§4).
- Hiring, later phase: `workforce_requirements` (+ `requirement_occupations` for "welders + assemblers", `visibility` private | invited_partners | job_order_marketplace), `requirement_invitations(status invited | viewed | responded | declined)`, `partner_responses(candidates_count, capacity, available_from, pricing_note, experience_note, supporting_note)` (employer compares responses in one table), `candidate_submissions(worker_approved_at; trigger requires it before status 'submitted')`, `connections(kind message | inquiry | invite_to_job | submit_candidate | request_workforce | save | follow)`, `conversations`, `conversation_participants`, `messages`, `saved_items`, `follows`.
- Phase-1 indexes: `jobs(status, country_code, occupation_id, created_at desc)`; `jobs(organization_id, status)`; GIN on `jobs.search_vector`; pg_trgm GIN on `jobs.title`; `job_applications(job_id, status)`; `job_applications(worker_user_id, created_at desc)`; unique partial `job_applications(job_id, worker_user_id) where status <> 'withdrawn'`; covering index on `organization_members(user_id, organization_id)`; an index on every column referenced by a policy.
- Indexes (including later phase): `workforce_requirements(status, visibility, country_code, occupation_id, start_date)`; `workforce_availability(occupation_id, source_country) include (available, updated_at)`; `organization_geographies(scope, country_code, organization_id)`; `worker_profiles(searchable, current_country, availability) where searchable`; `worker_work_authorizations(country_code, worker_user_id)`; GIN on `jobs.search_vector` / `workforce_requirements.search_vector` (`to_tsvector('simple', unaccent(title || ' ' || description))`, language-neutral); pg_trgm GIN on `occupations.label`, `organizations.display_name`; partial index on `billing.boosts(target_type, target_id) where ends_at > now()`; `worker_documents(storage_path)`. Keyset pagination on `(created_at, id)`; PostgREST `max_rows = 100`.

### 9.2 Search functions (SQL, called via RPC, all RLS-aware)

`search_jobs(filters, cursor, limit)`, `search_workers(filters)` (only `searchable` profiles, through `worker_search`), `search_partners(kind, filters)` (based_in / sources_from / serves_market / industries / occupations / languages / service type / capacity / verification level per country / availability), `search_available_workforce(destination, occupation, workers_needed, within_days)` (flags rows older than 60 days), job-order marketplace query (visibility rules in RLS: marketplace rows readable by recruitment/staffing members; invited rows only by invited orgs; private rows only by the owner). Organic ordering: relevance, then verification presence, then freshness. Minimum-salary filter in `search_jobs` (FR-C3): the filter takes an amount, a currency and a pay period (hour, month, year) and matches jobs with the same `salary_currency` and `salary_period` and `salary_max >= amount`; jobs without a salary in that currency and period do not match while the filter is set; there is no currency or period conversion in Phase 1. None of these functions reference `billing.boosts`; a test proves that inserting a boost does not change organic order.

### 9.3 CHARA Match v1 (EU AI Act posture: deterministic, documented, logged)

`public.chara_match(p_destination, p_industry, p_occupation, p_workers, p_start, p_recruitment, p_partner)` scores three candidate sets with weights from `match_rules(rule_key, entity_type, weight, enabled)` (seeded v1: workers — occupation 40, work authorization for destination 25 or preferred country 10, availability 15, skills overlap 5 each cap 15, language 5; recruitment partners — serves_market 35, sources_from matches preference 15, occupation 20, industry 10, availability ≥ 10 % of need 10, any approved badge 10, licence badge for destination 10; staffing partners analogous with service type). Each contribution appends `{rule, points, detail}`; results persist in `match_runs`/`match_results(reasons jsonb not null)` and the UI shows "Why this match". Summary counts ("1,820 matching workers / 23 recruitment partners / 8 staffing partners / source countries") come from the same run. Verification is a filter and a weighted rule; boosts never enter the score. AI matching later requires a DPIA and an ADR.

### 9.4 Corridors, network map, live statistics

- `stats.corridor_stats_mv(source_country, destination_country, workers_available, recruitment_partners, staffing_partners, industries_count, refreshed_at)` from `organization_geographies` pairs and `workforce_availability`; unique index for `refresh materialized view concurrently`; every 30 min.
- `stats.network_stats_mv(destination_country, industry_code, occupation_id, source_country, recruitment_agencies, staffing_companies, available_workers)` hourly.
- `stats.platform_counts_mv(countries, workers, employers, recruitment_companies, staffing_companies, active_jobs, workforce_requirements, connected_countries)` every 10 min — the homepage shows only these numbers.
- `public.v_corridor_stats`, `v_network_stats`, `v_platform_counts` (security_invoker, select granted to anon) apply `case when n < k then null end` with `k` from `private.settings` (default 5) and round worker counts to the nearest 10; public filters are limited to the MV dimensions.
- Corridor rules engine (later phase; decided in principle — OPEN_QUESTIONS.md, L4, R28). The platform is country-neutral and no corridor is hard-coded; for each source-country → destination-country pair an administrator maintains one rule row with:
  - direct hiring allowed or not;
  - recruitment partner required;
  - licensed agency required;
  - additional verification required;
  - required documentation;
  - applicable restrictions;
  - applicable warnings;
  - whether the direct Find Workers channel is available.
- The rule row selects the workflow. The direct employer-to-worker channel (`search_workers`, Find Workers) is available only where the corridor rule allows it; where the source country requires an authorised agency, the employer is routed to a verified recruitment partner instead. The employer-to-staffing-partner flow is likewise selected by the corridor rule. A corridor rule that enables a regulated workflow is switched on only after the legal review for that corridor (OPEN_QUESTIONS.md, L3, L4). The table is designed with that phase.

---

## 10. Billing (provider-neutral)

### 10.1 Schema `billing` (not exposed; owner `billing_owner`)

Plans, limits and features are rows, not code.

- `plans(code pk, org_type, name, price_minor, currency 'EUR', interval, trial_days, is_public, is_default_trial, contact_sales, sort)`. Phase-1 seed: the fallback plan `free_employer` (price 0, not sold), `employer_starter` 3900 (the "Basic" tier; decided — OPEN_QUESTIONS.md, D15), `employer_professional` 7900 (pricing source; not confirmed by the reply — OPEN_QUESTIONS.md, C10) and `employer_enterprise` (seeded with `is_public = false`, not sold until its price is stated — OPEN_QUESTIONS.md, C10). The display name of the lowest tier is open (C13); the plan codes do not change. `trial_days` is 30 and administrator-editable. Later phase, seeded with those account types (proposed — see OPEN_QUESTIONS.md, D7): the fallback plans `free_recruitment_company` and `free_staffing_company`, `recruitment_partner` 4900, `recruitment_professional` 9900, `recruitment_enterprise` 19900 (contact sales), `staffing_partner` 5900, `staffing_professional` 12900, `staffing_enterprise` 24900 (contact sales).
- `plan_limits(plan_code, limit_key, limit_value int null)` — keys: active_jobs, members; later phase: active_requirements, markets, messages_per_month, candidate_submissions_per_month, job_order_responses_per_month, partner_invitations_per_requirement. Seeded with the owner's initial numbers (decided — OPEN_QUESTIONS.md, C3); keys without a number (markets, job_order_responses_per_month) stay NULL until decided. `free_employer` is seeded with `active_jobs` 0 and `members` 0 (no open vacancies, no members besides the owner; if the members limit is decided to count the owner, `free_employer` is seeded with `members` 1 — OPEN_QUESTIONS.md, C12) and no feature rows; its past applicants are read-only. The contents of `free_employer` are to be confirmed by CHARA (OPEN_QUESTIONS.md, C11). Paid-plan limits are enforced only when `entitlements_enforced` is true (§10.4; when that happens is open — OPEN_QUESTIONS.md, C11); for a lapsed organization the `free_employer` rules apply whether or not it is on (§10.4).

  | `limit_key` | `employer_starter` | `employer_professional` | `employer_enterprise` | Used from |
  |---|---|---|---|---|
  | `active_jobs` | 3 | 15 | 50 | Phase 1 |
  | `members` | 1 | 5 | 15 | Phase 1 |
  | `active_requirements` | 3 | 15 | 50 | later phase |
  | `messages_per_month` | 100 | 500 | 2000 | later phase |
  | `candidate_submissions_per_month` | 25 | 100 | 500 | later phase |
  | `partner_invitations_per_requirement` | 3 | 10 | 25 | later phase |

  Limits and features are rows, so they change without a deployment. The administrator console page and the admin-only, audited RPCs (role `admin` + aal2) that edit plans, limits, features, `trial_days` and settings are not in the Phase-1 console list (§3); they are later phase (to confirm — OPEN_QUESTIONS.md, P9), and until then a change is made by migration. The Enterprise values are starting numbers, raised per organization under fair-use rules: a row in `billing.organization_limit_overrides(organization_id, limit_key, limit_value)` (later phase) takes precedence over the plan row for that organization.
- `plan_features(plan_code, feature_key)` — keys: shortlisting, analytics_advanced; later phase: advanced_worker_search, advanced_partner_search, chara_match, corridors, available_workforce_search, job_order_access, multi_partner_invitation, analytics_enterprise, multi_country_requirements, priority_visibility. Feature rows per tier (decided — OPEN_QUESTIONS.md, C2, C3; two tier assignments and three undefined values open — C16):
  - Every paid plan, from `employer_starter`: job posting, workforce requirement, `chara_match`, basic search, messaging, job order posting and access, access to relevant workforce opportunities, basic partner connection, standard profile visibility, and `shortlisting` (team default; the reply does not mention it). `chara_match` and the core workforce-requirement workflow are never reserved for a higher plan.
  - `employer_professional` and `employer_enterprise` add: advanced search (`advanced_worker_search`, `advanced_partner_search`), `analytics_advanced`, `corridors`, `multi_partner_invitation`, `multi_country_requirements` (follows the limits table; conflict open — OPEN_QUESTIONS.md, C16; the Basic tier is "limited" and the meaning of limited is not defined yet). More partner invitations and messaging capacity are limits (table above); enhanced company visibility has no feature key yet (later phase).
  - `employer_enterprise` adds: `analytics_enterprise`, `priority_visibility` ("included or available"; the exact rule is not defined yet), priority support, multi-country partner network access, higher or unlimited volumes under fair-use rules (per-organization overrides), enhanced and enterprise-level verification options and Verified Partner eligibility (no feature keys yet; later phase). On the other plans priority visibility is bought as a boost (follows the limits table; conflict open — OPEN_QUESTIONS.md, C16).
  - `available_workforce_search` is not assigned to a tier by the reply; open (OPEN_QUESTIONS.md, C16).
- `subscriptions(id, organization_id, plan_code, status trialing | active | past_due | canceled | paused, trial_ends_at, current_period_start, current_period_end, cancel_at, past_due_since, last_provider_event_at, provider, provider_customer_ref, provider_subscription_ref)`; partial unique index: one non-canceled subscription per organization; check: organization type is a company type. No row is inserted when an organization is created; the first (`trialing`) row arrives through the billing webhook after checkout (decided — OPEN_QUESTIONS.md, D4). `past_due_since` is set from the first `invoice.payment_failed` of a dunning period and cleared by `invoice.paid`; `last_provider_event_at` is the creation time of the newest provider event applied, used to detect stale events (§10.3).
- Grace period and dunning (FR-G4): the 7-day grace starts at `past_due_since`. Stripe's retry (dunning) settings retry the payment and cancel the subscription 7 days after the first failure; the local `canceled` state comes only from `customer.subscription.deleted`, never from a local timer. During the grace period the organization keeps its plan. A reconciliation check alerts operations when a subscription is still `past_due` more than one day after the grace period ends. Tested in Stripe test mode with a test clock (trial end, failed payment, retries, cancellation).
- Lapse (FR-G4; defaults to be confirmed by CHARA — OPEN_QUESTIONS.md, C11): when a subscription is cancelled the organization falls back to `free_employer`. In the same transaction `billing_apply_event` calls `private.pause_jobs_on_lapse(org)` (owned by `postgres`, EXECUTE granted to `billing_owner` only), which moves every `open` vacancy to `paused` with `chara.actor_fn = 'pause_jobs_on_lapse'` and writes one audit row per vacancy. For the lapsed organization, application status changes, notes and bulk actions are refused and reopening a vacancy goes through the `active_jobs` limit (0), whether or not `entitlements_enforced` is on (§10.4). A new checkout restores the plan; paused vacancies are then reopened by the owner or an admin through the normal limit check.
- Trial (decided — OPEN_QUESTIONS.md, D4, C6): the card is collected at checkout before the trial starts (card timing to be confirmed — OPEN_QUESTIONS.md, C15); the trial lasts `plans.trial_days` (30, administrator-editable) and converts automatically to the selected paid plan. One trial per legal entity: the billing customer carries a unique legal-entity identifier (company registration number, VAT number or another unique legal-entity identifier; C14), and `billing_checkout_start` grants no trial when that identifier has already had one. Which identifier is mandatory per country and how it is validated is open (C14). Before the trial starts the checkout confirmation page states the trial period, the price after the trial, the billing frequency, the automatic conversion and how to cancel.
- `customers(organization_id, provider, customer_ref, billing_country, vat_id, registration_number, legal_address)`.
- Currency and VAT (decided — OPEN_QUESTIONS.md, C7): prices are stored and displayed in EUR, exclusive of VAT; VAT is calculated by the payment provider from the customer's location and the applicable tax rules. EUR is the only billing currency in the first release; every price row has a `currency` column so further currencies can be added as rows. Tax treatment for customers outside the EU follows the payment provider and accounting setup agreed with the owner's advisers.
- `orders(id, organization_id, kind, sku_or_plan, amount_minor, tax_minor, currency, status, provider_ref, invoice_ref, details jsonb)` — the tax amount and invoice reference come from the provider (Stripe Tax).
- `provider_events(id, provider, provider_event_id, kind, payload jsonb, signature_valid, provider_created_at, received_at, status received | applied | stale | error, applied_at, error, unique(provider, provider_event_id))` — inserted only by `billing_ingest_event`; `status`, `applied_at` and `error` are set by `billing_apply_event` (§10.3).
- (later phase) `boost_products(sku, target_type job | organization, org_type, days, price_minor, currency)` seeded from the pricing doc: job 2500/7d, 3900/14d, 5900/30d; recruitment 5900/10900/19900; staffing 4900/8900/13900. `boosts(id, organization_id, sku, target_type, target_id, starts_at, ends_at, provider_payment_ref unique)`; `public.v_active_boosts` is the only reader (BoostedRail). Decided (OPEN_QUESTIONS.md, R29): boosts are sold to hiring, recruitment and staffing companies for job postings, workforce requirements, company profiles and partner profiles, and can be bought on any plan, without a higher plan. Possible functions: top search placement, featured profile, job or requirement, priority visibility, regional or country visibility, homepage or category placement. The reply asks for the boost system in the production architecture from the start; it is designed here and built in the boosts phase (to confirm — OPEN_QUESTIONS.md, P9). Boost products are administrator-editable rows; administrators control price, duration, placement, country or region, category, availability and promotional discounts. The catalogue prices are open (C8), and the columns for the attributes not listed above are designed with that phase.
- (later phase) `verification_products(sku verification_basic | professional | enterprise, price_minor 4900 | 9900 | 19900 (Enterprise is a starting price), interval 'year', eligible_levels text[])`; `verification_fees(id, organization_id, sku, paid_at, expires_at, provider_payment_ref unique)` — a paid fee only allows `verification_submit` for a paid level; it never touches `verifications.status`.
- Every `billing` table has RLS enabled and forced and a policy `to billing_owner using (true) with check (true)`, because BYPASSRLS is not inherited through role membership (§10.3). `service_role` has no grants on the schema.
- Workers have no rows anywhere in `billing`; checkout RPCs reject `account_kind = 'worker'`.
- UI reads through `public.v_plans`, `public.v_my_subscription` and, later phase, `public.v_active_boosts` (security_invoker; SELECT granted on the underlying tables with RLS policies: plans/products public, subscriptions/boosts by org members; provider refs excluded from the views).

### 10.2 Adapter interface (`supabase/functions/_shared/billing/provider.ts`)

```ts
// Every event also carries providerCreatedAt (ISO time the provider created it), used for the stale check (§10.3).
export type NormalizedEvent = { providerCreatedAt: string } & (
  | { kind: 'checkout.completed'; orgId: string; providerCustomerRef: string; providerSubscriptionRef?: string }
  | { kind: 'subscription.activated' | 'subscription.updated' | 'subscription.canceled' | 'subscription.past_due';
      orgId: string; planCode: string; status: 'trialing'|'active'|'past_due'|'canceled'|'paused';
      providerSubscriptionRef: string; currentPeriodEnd?: string; trialEndsAt?: string }
  | { kind: 'subscription.trial_will_end'; orgId: string; providerSubscriptionRef: string; trialEndsAt: string }
  | { kind: 'payment.succeeded'; orgId: string; purpose: 'subscription'|'boost'|'verification_fee';
      sku?: string; targetId?: string; amountMinor: number; currency: string; providerPaymentRef: string }
  | { kind: 'payment.failed'; orgId: string; providerPaymentRef: string; reason?: string }
  | { kind: 'refund.issued'; orgId: string; providerPaymentRef: string; amountMinor: number });

export interface CheckoutInput {
  orgId: string; kind: 'subscription'|'boost'|'verification_fee'; planCode?: string; sku?: string;
  targetId?: string; successUrl: string; cancelUrl: string; customerRef?: string;
}

export interface BillingProvider {
  readonly name: 'null' | 'stripe';
  verifyWebhook(req: Request, rawBody: string): Promise<{ ok: boolean; eventId: string; type: string; payload: unknown }>;
  normalize(payload: unknown): NormalizedEvent[];
  createCheckout(input: CheckoutInput): Promise<{ url: string; providerRef: string }>;
  createPortal(input: { customerRef: string; returnUrl: string }): Promise<{ url: string }>;
}
```

`providers/null.ts` verifies `x-chara-signature` = HMAC-SHA256(rawBody, `BILLING_WEBHOOK_SECRET`) and parses already-normalized JSON; it is the provider in dev, CI and E2E. `providers/stripe.ts` is the production provider: Stripe Checkout, Customer Portal, Stripe Tax and webhook signature verification. The `boost` and `verification_fee` kinds in the interface are later phase. `billing_checkout_start` passes the organization id, which `providers/stripe.ts` sets as the Checkout session `client_reference_id` and in `subscription_data.metadata`; `normalize` takes `orgId` from that subscription metadata (from `client_reference_id` for `checkout.session.completed`), so subscription and invoice events resolve to the organization even when they arrive before `checkout.session.completed`.

### 10.3 Webhook ingestion and application

`billing-webhook` (`verify_jwt = false`): read raw body → `provider.verifyWebhook` (secret from Edge Function secrets) → for each normalized event `rpc('billing_ingest_event', …)`, which inserts into `billing.provider_events` with `on conflict do nothing` (duplicates return 200) → `rpc('billing_apply_event', { event_id })` → 200. The function never writes a `billing` table directly. `billing.retry_failed_events()` runs every 5 min via pg_cron.

```sql
create role billing_owner nologin;           -- guarded with `if not exists` in the migration
grant billing_owner to postgres;
alter schema billing owner to billing_owner;
-- billing_owner gets NO grant on public.verifications, verification_evidence, verification_events (later phase; asserted by test)
grant select on public.organizations to billing_owner;
create policy organizations_select_billing_owner on public.organizations for select to billing_owner using (true);

-- BYPASSRLS is not inherited through role membership, so every billing table gets this pair:
alter table billing.provider_events enable row level security;
alter table billing.provider_events force row level security;
create policy provider_events_all_billing_owner on billing.provider_events
  for all to billing_owner using (true) with check (true);

create or replace function public.billing_ingest_event(
  p_provider text, p_provider_event_id text, p_kind text, p_payload jsonb, p_signature_valid boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$ /* insert into billing.provider_events … on conflict (provider, provider_event_id) do nothing; returns the event id */ $$;

create or replace function public.billing_apply_event(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$ /* maps NormalizedEvent kinds to subscriptions, customers, orders (later phase: boosts, verification_fees) per the table below; skips stale events; an unknown plan code or organization sets status 'error'; sets applied_at; audit.record('billing.event_applied') */ $$;

-- for both functions:
alter function public.billing_apply_event(uuid) owner to billing_owner;
revoke all on function public.billing_apply_event(uuid) from public, anon, authenticated;
grant execute on function public.billing_apply_event(uuid) to service_role;
```

Stripe event → effect (FR-G3), applied by `billing_apply_event` to `billing.subscriptions` unless stated:

| Stripe event | Normalized kind | Effect |
|---|---|---|
| `checkout.session.completed` | `checkout.completed` | Link the customer and the subscription to the organization (`billing.customers.customer_ref`, `subscriptions.provider_customer_ref` / `provider_subscription_ref`). |
| `customer.subscription.created`, `customer.subscription.updated` | `subscription.activated`, `subscription.updated` | Upsert status, plan code, current period end and trial end. |
| `customer.subscription.deleted` | `subscription.canceled` | Status `canceled`; the organization falls back to `free_employer` and the lapse rules run (§10.1). The only path to the local `canceled` state. |
| `invoice.paid` | `payment.succeeded` (purpose `subscription`) | Clear `past_due_since`; set `active` only when the Stripe subscription status is `active` (the zero-amount invoice paid when a trial starts leaves `trialing` unchanged). |
| `invoice.payment_failed` | `payment.failed` | Status `past_due`; set `past_due_since` if it is empty, and, only when it sets it, queue the `payment_failed` email (§4). |
| `customer.subscription.trial_will_end` | `subscription.trial_will_end` | Queue the `trial_ending` email to the owner (Stripe sends it 3 days before the trial ends). |

- Idempotency: each event is stored once, keyed by `(provider, provider_event_id)`; a duplicate delivery returns 200 and changes nothing.
- Ordering: Stripe does not guarantee delivery order. An event whose `provider_created_at` is older than `subscriptions.last_provider_event_at` is not applied over newer state: it is marked `stale`, and the adapter re-fetches the current subscription from Stripe and applies that instead.
- Unknown data: an event whose organization is not yet linked is retried by `billing.retry_failed_events()` before it is marked `error`; an event whose price maps to no known plan code, or whose organization still cannot be resolved, is stored with `status = 'error'` and the reason in `error`, is not applied, and raises an operations alert (`private.security_events` and the pg_net alert through `notify`, §12).
- Dunning: the Stripe retry schedule is set to cancel the subscription 7 days after the first failed payment; the grace rule is in §10.1.

### 10.4 Entitlement-check pattern (limits and features are data)

The SQL below shows the proposed resolutions of two open conflicts: the plan code falls back to `'free_' || organization type` when there is no usable subscription row, and an unknown plan code denies (proposed — see OPEN_QUESTIONS.md, D5); `private.settings.value` is jsonb and is always read as `value #>> '{}'` and then cast (proposed — see OPEN_QUESTIONS.md, D6).

```sql
-- Never returns null for an existing organization: no subscription row or a canceled one resolves to the
-- seeded fallback plan 'free_<organization type>'. past_due keeps the plan: the 7-day grace is enforced by
-- Stripe dunning, and the local 'canceled' state comes only from customer.subscription.deleted (§10.1, §10.3).
create or replace function private.org_plan_code(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when s.status in ('trialing','active','past_due') then s.plan_code end
     from billing.subscriptions s where s.organization_id = p_org and s.status <> 'canceled'
     order by s.created_at desc limit 1),
    'free_' || (select o.type::text from public.organizations o where o.id = p_org))
$$;

-- free_* restrictions apply when limits are enforced, and always to a lapsed organization (it is on a free_*
-- plan and has a subscription row, so every row it has is canceled) — OPEN_QUESTIONS.md, C11.
create or replace function private.free_plan_restricted(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.org_plan_code(p_org) like 'free\_%'
     and (coalesce((select (value #>> '{}')::boolean from private.settings where key = 'entitlements_enforced'), false)
          or exists (select 1 from billing.subscriptions s where s.organization_id = p_org))
$$;

-- Read-only past applicants. Called first in set_application_status, bulk_set_application_status and by the
-- application_notes insert trigger; never in withdraw_application.
create or replace function private.assert_org_writable(p_org uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.free_plan_restricted(p_org) then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'read_only_free_plan', errcode = 'P0001';
  end if;
end $$;

create or replace function private.org_limit(p_org uuid, p_key text) returns integer   -- null = unlimited (known plan only)
language sql stable security definer set search_path = '' as $$
  select l.limit_value from billing.plan_limits l
  where l.plan_code = private.org_plan_code(p_org) and l.limit_key = p_key
$$;

create or replace function private.has_feature(p_org uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce((select (value #>> '{}')::boolean from private.settings where key = 'entitlements_enforced'), false)
      or exists (select 1 from billing.plan_features f          -- an unknown plan code has no feature rows: denied
                 where f.plan_code = private.org_plan_code(p_org) and f.feature_key = p_key)
$$;

create or replace function private.assert_within_limit(p_org uuid, p_key text, p_current integer) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_plan text := private.org_plan_code(p_org); v_limit integer;
begin
  if not coalesce((select (value #>> '{}')::boolean from private.settings where key = 'entitlements_enforced'), false)
     and not private.free_plan_restricted(p_org) then
    return;                                                     -- limits are not enforced yet, except for a lapsed organization
  end if;
  if not exists (select 1 from billing.plans p where p.code = v_plan) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'unknown_plan', errcode = '42501';   -- unknown plan code denies
  end if;
  v_limit := private.org_limit(p_org, p_key);
  if v_limit is not null and p_current >= v_limit then
    raise exception 'CHARA_LIMIT_REACHED' using detail = p_key, errcode = 'P0001';
  end if;
end $$;

-- Canonical use: BEFORE triggers on the counted tables (works for direct inserts and RPCs alike)
create or replace function private.jobs_enforce_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    perform private.assert_within_limit(new.organization_id, 'active_jobs',
      (select count(*) from public.jobs j
        where j.organization_id = new.organization_id and j.status = 'open' and j.id <> new.id));
  end if;
  return new;
end $$;
create trigger jobs_enforce_limits before insert or update of status on public.jobs
  for each row execute function private.jobs_enforce_limits();
-- Feature gates inside RPCs:  if not private.has_feature(v_org, 'chara_match') then raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'chara_match'; end if;
```

`private.settings.entitlements_enforced` starts as `false`; while it is false no limit or feature gate blocks anything for an organization that has never had a subscription, so the week 1–3 demos work before checkout exists. The lapse rules do not depend on it (OPEN_QUESTIONS.md, C11): a lapsed organization (back on `free_employer` after a cancelled subscription) cannot open or reopen a vacancy (`active_jobs` 0) or invite members (`members` 0), and cannot change application states or add notes (`private.assert_org_writable`); its open vacancies were moved to Paused on lapse (§10.1). Once the setting is true, the same `free_employer` restrictions apply to every organization on that plan, including one that has not yet started a trial. The owner supplied the plan limits and the tier features on 2026-10-02 and they are seeded (§10.1); when the setting is switched to `true` is open (OPEN_QUESTIONS.md, C11; recommended: with the billing work package, and C12 for the one-member limit of the Basic tier). Having it `true` is a go-live checklist item. Per-organization overrides (§10.1) are read by `private.org_limit` once that table exists. Monthly counters live in `private.usage_counters(organization_id, key, period, count)` maintained by the same triggers. Downgrade behaviour defaults to "keep data, block creation over limit" (see OPEN_QUESTIONS.md, C9).

### 10.5 The invariant, enforced structurally

Verification and boosts are later phase; Phase 1 builds the `billing_owner` isolation and the worker rule, and the tests for the first two points arrive with the verification and boost tables.

- paying ≠ verified: `billing_owner` cannot touch verification tables (grants); `billing_apply_event` body never references them; `private.guard_verification_transition()` rejects any status change to approved/rejected/suspended unless `current_setting('chara.actor_fn', true) = 'verification_decide'`, which only that RPC sets (`set_config(..., true)`); a test applies `payment.succeeded` for a verification fee and asserts zero approved verifications.
- verified ≠ boosted: boosts live in `billing` and are read only by `BoostedRail`; search/match functions never reference them; `VerifiedBadge` and `BoostedRail` are separate components with a lint rule against cross-import; boosted slots are always labelled "Boosted".
- workers never pay: no billing rows reference worker users; checkout RPCs raise for workers; workers cannot be organization members.

---

## 11. Verification, trust, reports and moderation

Later phase, except `moderation_actions` and the Phase-1 admin RPCs `moderate_job`, `suspend_user`, `suspend_organization`, `reinstate_user` and `reinstate_organization` (`trust_safety` + aal2, statement of reasons mandatory, audited; `verification_reviewer` may not call them, and whether `admin` may is stated per RPC with the admin console work package — responsibilities per role: OPEN_QUESTIONS.md, R27). The verification, badge, report and appeal design below is kept for the later phases.

Suspend and reinstate (Phase 1, FR-F1). Actor: the Trust & Safety Administrator (`trust_safety` + aal2); whether the Platform Administrator may also act is open (OPEN_QUESTIONS.md, P12). Every action takes a mandatory statement of reasons, writes a `moderation_actions` row and an `audit.record()` row with the reason, and queues a mandatory email (§4).

| Effect | `suspend_user(user_id, reasons)` | `suspend_organization(org_id, reasons)` |
|---|---|---|
| Status | `profiles.status = 'suspended'` | `organizations.status = 'suspended'` |
| Sessions | `account-ops` signs the user out globally | `account-ops` signs every member out globally; members can sign in again, but the DAL and the organization's RPCs refuse access to the suspended organization |
| Login | `account-ops` sets a sign-in ban on the auth user through the Auth admin API; the DAL and RPCs also refuse a suspended profile | Members can still sign in (they may belong to other organizations or use their own account) |
| Vacancies | Unchanged (a suspended user who owns an organization does not suspend it) | Every `visible` vacancy gets `moderation_state = 'org_suspended'`, so it leaves search, public pages and new applications |
| Billing | None | Subscription left as is: no pause, cancellation or refund (to be confirmed by CHARA — OPEN_QUESTIONS.md, P12) |
| Email | `account_suspended` to the user, with the statement of reasons | `account_suspended` to the owner and admins, with the statement of reasons |

`reinstate_user(user_id, reasons)` and `reinstate_organization(org_id, reasons)` reverse each effect: status back to `active`, the sign-in ban lifted through `account-ops` (the user signs in again; sessions are not restored), vacancies with `moderation_state = 'org_suspended'` set back to `visible` (vacancies hidden by `moderate_job` stay hidden), and an `account_reinstated` email with the reasons. Each reinstatement is audited with its reason.

- `badge_definitions(level identity | business | licence | workforce_capability | verified_partner | skill, label, description, default_validity_months, checks_catalog jsonb)`.
- `verifications(id, subject_type organization | worker_skill, organization_id, worker_skill_id, level, status draft | submitted | in_review | info_requested | approved | rejected | suspended | expired, country_code (required for licence), source (skills), checks_completed jsonb, submitted_at, claimed_by, claimed_at, decided_by, second_approved_by, decided_at, verified_at, expires_at, decision_reason, info_request, verification_fee_id)`, `verification_evidence`, `verification_events` (append-only transitions), view `public.org_badges` (approved and unexpired only: level, country, verified_at, expires_at, checks_completed labels, source — licence badges always carry the country; nothing implies "authorised everywhere").
- Fee tiers and badges (decided — OPEN_QUESTIONS.md, C4): Basic (EUR 49) makes a company eligible for identity and business; Professional (EUR 99) for identity, business, licence and workforce_capability; Enterprise (from EUR 199) for those four plus multi-country verification and eligibility for verified_partner. These are the `eligible_levels` of `billing.verification_products` (§10.1). Worker verification is free at launch; paid verification applies primarily to businesses and professional partners. What each badge means, what it does not guarantee, and the criteria and documents per badge are defined in the verification policy approved by legal counsel (OPEN_QUESTIONS.md, L5).
- Workflow RPCs: user side `verification_start`, evidence upload (storage policy), `verification_submit` (requires a valid fee row when the level is paid; worker skill verification is free); reviewer side (`verification_reviewer` + aal2) `verification_claim` (48 h lock), `verification_request_info`, `verification_decide(id, approved, checks, reason, expires_at)`, `verification_suspend` (reviewer or `trust_safety`); daily `expire_verifications()` plus reminders at 30/7 days.
- Separation of duties: requester ≠ reviewer ≠ second approver; reviewers cannot act on organizations they belong to; `verified_partner` needs a second distinct reviewer (configurable in `private.settings`); admins decide only if they also hold the reviewer role; every transition writes `verification_events` and `audit.log`; evidence is viewed only through `document-url` (logged).
- Skill verification: per `worker_skills` row with `source` (employer, training_institution, trade_test_provider, recruitment_company, submitted_documentation, chara); employer-sourced attestations require a business-verified employer with an accepted connection to the worker and display "Verified by employer", distinct from CHARA verification.
- Reports (DSA): `reports(reporter_user_id null for anonymous illegal-content reports, target_type profile | job | organization | content | message, target_id, category, description, evidence_paths, status received | under_review | actioned | dismissed, acknowledged_at)`, `moderation_actions(report_id, actor_id, action none | content_removed | listing_paused | account_suspended | verification_suspended | warning, statement_of_reasons not null, legal_basis, notified_reporter_at, notified_subject_at, appeal_deadline)`, `report_appeals`. RPCs `report_content` (rate-limited), `moderation_decide` (`trust_safety` + aal2), `appeal`. Hidden content is filtered by the `moderation_state = 'visible'` predicate in public read policies.

---

## 12. Compliance controls

| Control | Implementation | Where verified |
|---|---|---|
| Data classification | `docs/DATA_CLASSIFICATION.md`: C0 public (jobs, org profiles, badges, stats), C1 internal (plans, rules), C2 personal (profiles, messages, consents, audit), C3 sensitive (passport, documents, evidence). Class decides schema, bucket, logging and retention. | review |
| Consent ledger | `consents` append-only (a withdrawal is a new `withdrawn` row) + `legal_documents` versions; sharing requires a consent row; withdrawal is immediate (checked in `document_access_grant`) (proposed — see OPEN_QUESTIONS.md, D3). | pgTAP test |
| Audit log | `audit.log` written only by `audit.record()` (Edge Functions go through the service RPC `audit_record_external`); UPDATE/DELETE/TRUNCATE revoked from every role and blocked by triggers that are ENABLE ALWAYS (they also fire under `session_replication_role = replica`); `ip` is the leftmost `x-forwarded-for` entry, which the client controls, so it is context and not evidence; `erase_user` and `private.apply_retention()` (U42) conflict with the append-only triggers and must add a narrow, audited exception (for example a transaction-local setting checked in `audit.refuse_change()`) with its own pgTAP test; row triggers on platform_staff, passport_shares, worker_documents, billing events and, later phase, verifications; monthly export to an immutable bucket outside Supabase; retention 6 years. | pgTAP test |
| Document access log | `audit.document_access_log` written by construction (no row, no URL); worker-visible view; 24-month retention. | pgTAP + Deno test |
| DSAR export / erasure | `request_data_export()` → pgmq → `account-ops` builds JSON + files into `dsar-exports`, signed link (10 min) by email (the service RPC that reads the export data is not specified yet). `request_account_deletion()` hides the profile immediately, 30-day cooling-off, legal hold if a report is open; then `account-ops` calls the service RPC `erase_user` (pseudonymises audit, billing and application rows, deletes passport rows), purges the storage prefix through the Storage API and deletes the auth user (`auth.admin.deleteUser`). `dsar_requests` tracks the 30-day SLA. | E2E |
| Retention | `retention_policies` rows + `private.apply_retention()` daily (exports 7 d, evidence 24 months after decision, access log 24 months, provider payloads 13 months, inactive worker data 24 months — confirm), each run audited. | pgTAP test |
| Legal and privacy settings | Legal entity details, privacy contact and data-protection contact are rows in `private.settings`; retention periods are rows in `retention_policies`. None is hard-coded; the administrator console page that edits them is later phase (§10.1) and until then a change is made by migration. The values are open (OPEN_QUESTIONS.md, L1, L6). Legal documents are versioned `legal_documents` rows; the document set is listed in OPEN_QUESTIONS.md, L5. | review |
| Data minimisation | No ID-number, date-of-birth, nationality, religion, gender or marital-status columns (pgTAP test over `information_schema.columns`); work authorization instead; no worker photos in MVP; `worker_search` column-list test (later phase). | CI `db` job |
| Encryption and keys | TLS everywhere; provider encryption at rest; future C3 identifiers encrypted with pgcrypto using Vault keys inside definer functions; secret key only in Edge Function secrets; publishable key only in the web app; `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` per environment; rotation runbook (JWT signing key, API keys, SMTP, provider secrets). | CI guard |
| Access control | Default-deny grants, RLS on every table (ENABLE + FORCE), platform roles in their own table, aal2 restrictive policies, SoD checks, `billing_owner` isolation, no direct table grants for `service_role`, CODEOWNERS on `supabase/**`. | pgTAP tests |
| MFA | TOTP mandatory for platform staff and org owners/admins; enforced in RLS, RPCs and DAL. | pgTAP + E2E |
| Logging and redaction | pino via `instrumentation.ts` with redaction of cookies, tokens, emails, document names; request id from proxy; Edge Functions log event ids never payloads; lint rule against logging user objects. | review |
| Security headers | proxy.ts: nonce CSP (`default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'; img-src 'self' blob: data: https://<project>.supabase.co; connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co; frame-ancestors 'none'; form-action 'self'; base-uri 'self'`), HSTS preload, nosniff, Referrer-Policy, Permissions-Policy. | E2E header check |
| Backups / PITR | Frankfurt, Pro plan (7 daily backups) + PITR add-on (needs Small compute) before launch (decided — OPEN_QUESTIONS.md, O1, O2); nightly Storage object replication to an EU bucket (DB backups exclude objects; open — OPEN_QUESTIONS.md, O5); quarterly restore drill. | runbook |
| Incident process | SECURITY.md contact; `docs/runbooks/incident.md` with the GDPR 72-hour checklist; `private.security_events` fed by triggers (failed admin actions, document-access bursts) with pg_net alert through `notify`; Supabase advisors reviewed weekly. | runbook |
| Accessibility (WCAG 2.2 AA) | eslint-plugin-jsx-a11y via eslint-config-next, @axe-core/playwright on key pages, `lang` from root param, logical CSS properties for RTL. | CI |
| EU AI Act / fairness | Deterministic SQL matching with stored reasons and tunable weights; any ML change needs a DPIA and ADR. | design |
| DSA / consumer law | Statement of reasons mandatory; later phase: reports, appeals, transparency counts, paid placement labelled "Boosted". | pgTAP test |
| ILO C181 | No worker billing path (structural); verification of worker skills free (later phase). | pgTAP test |
| Supply chain | Dependabot, `npm audit --omit=dev --audit-level=high` (blocking; a full audit is reported without blocking), secret-pattern check in the CI `security` job, pinned Actions, Deno lockfile. | CI |

---

## 13. Scalability and cost

- Connections: the web tier uses supabase-js over HTTPS (no Postgres pool); direct connections exist only for migrations, typegen and tests. Any future server-side SQL client uses the Supavisor transaction pooler (6543) with prepared statements disabled.
- Reads: explicit column lists, keyset pagination, `max_rows = 100`; aggregates from `stats.*` MVs refreshed on a schedule; `pg_stat_statements` reviewed weekly; EXPLAIN assertions in pgTAP tests for the top search functions.
- Next.js: all routes dynamic (nonce CSP); Postgres is the cache; React `cache()` dedupes per request; static assets and images are CDN-cacheable; `output: 'standalone'`, `deploymentId`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` make multi-instance self-hosting safe.
- Realtime: Broadcast on private topics (`conversation:{id}`, `user:{id}`), subscribed only on messaging views, polling fallback; plan connection limits monitored.
- Background work: pg_cron jobs kept idempotent and short; pg_net to Edge Functions with a Vault-stored secret header; pgmq with visibility timeout and archive as dead-letter.
- Cost drivers: compute size (FTS, MV refresh), storage egress (60-s signed URLs only), Edge Function invocations (document-url per download, notify), Realtime peak connections, PITR add-on, log retention.
- Exit seams: search behind `search_*` functions (Meilisearch/Typesense via an outbox later); matching writes `match_results` (a separate service can replace the SQL function); billing behind the adapter; email/scan behind Edge Functions; Realtime behind `lib/supabase/browser.ts`; Storage paths are S3-compatible; the whole stack is self-hostable (plain SQL migrations, GoTrue, storage-api), so leaving Supabase is a hosting change rather than a rewrite.

---

## 14. Development workflow

Branches and pull requests: work happens on `feat/…`, `fix/…` and `chore/…` branches, one pull request each into `main`. Nothing is committed directly to `main`.

### 14.1 Schema and types

- Hand-written SQL in `supabase/migrations/<timestamp>_<name>.sql`, forward-only, small, one concern per file, each with pgTAP tests in `supabase/tests/database/`. A committed migration is never edited; a correction is a new migration. Rules: enable + force RLS in the same migration that creates a table; grants explicit; functions always `set search_path = ''`.
- The handoff's "migration 0001" is delivered as several small timestamped migrations, one pull request each: foundation (extensions, schemas, roles, default-deny grants, `private.settings`, `audit.log`); reference data; profiles and consents; organizations; billing core.
- Extensions (pg_cron, pg_net, pgmq, supabase_vault, pgtap) exist in the local stack, in CI and in the cloud project, so migrations create and use them directly, without conditional guards:

```sql
select cron.schedule('refresh-platform-counts', '*/10 * * * *',
  $cron$ refresh materialized view concurrently stats.platform_counts_mv $cron$);
```

- Declarative schemas (`[experimental.pgdelta]`, `supabase/schemas`) exist in CLI 2.119 but stay optional; they do not capture policies, grants, DML or buckets, so hand-written migrations remain the source of truth.
- Types: `npx supabase gen types typescript --local --schema public > packages/db-types/src/database.ts`; a second run with `--schema public --schema billing --schema audit` feeds `supabase/functions/_shared/database.types.ts`. Both committed; CI regenerates them from the running stack and fails on drift.
- Seeds: `scripts/gen-ref-seeds.mjs` writes the reference-data files in `supabase/seeds/ref/` (countries, languages and currencies from `Intl`; ISCO-08 and ISIC Rev.4 from committed code lists); plans and legal documents are seed files in the same directory. `[db.seed] sql_paths = ["./seeds/ref/*.sql"]`. `supabase/seeds/dev/*.sql` (synthetic users in `auth.users`, organizations, documents) is not in `sql_paths`, is loaded only into local and CI databases, never into production, and is added when first needed.

### 14.2 Without Docker

The local database needs Docker. A session without Docker uses the CI `db` job on a draft pull request instead; there is no plain-Postgres alternative.

### 14.3 Standard: Docker available

```
npm run db:start    # npx supabase start: API :54421, DB :54422, Studio :54423, mail catcher :54424 (shadow DB :54420)
npm run db:reset    # npx supabase db reset: all migrations, then seeds/ref
npm run db:test     # npx supabase test db: pgTAP files in supabase/tests/database
npm run db:stop     # npx supabase stop
npm run dev         # web dev server on http://localhost:3100
```

The Supabase CLI is the devDependency `supabase@2.119.0` and is always invoked as `npx supabase`; it is not installed globally. Other commands: `npx supabase functions serve --env-file supabase/functions/.env`, `npx supabase gen types typescript --local`, `npx supabase test new <name> --template pgtap` for a new test file. `apps/web/.env.local` holds the local API URL (`http://127.0.0.1:54421`) and the publishable key printed by `npx supabase status`. Edge Functions need Deno; they are typechecked and tested in the CI `functions` job.

### 14.4 Testing matrix

- Database: pgTAP tests in `supabase/tests/database/*.test.sql`, run with `npx supabase test db` (policies allow/deny/cross-tenant, triggers, `billing_owner` privilege test, `service_role` has no direct table grants, audit immutability, k-anonymity, RLS enabled and forced on every table, forbidden-attribute test over `information_schema.columns`, EXPLAIN plan assertions; later phase: match reasons). `npm run db:lint` (`npx supabase db lint --local --fail-on error`) runs in the CI `db` job.
  Named tests from the SOP review: `document_access_grant` refuses an unselected document and a later upload of a shared type (D18); vacancy and application transition guards accept exactly the rows of the §4 tables; a lapsed organization's open vacancies become Paused and its application writes are refused with `entitlements_enforced` false (C11).
- Edge Functions: `deno test` in `supabase/functions/_tests` with the null provider and a fake fetch (bad signature → 401, duplicate event → 200 no-op, stale event not applied, unknown plan or organization stored with status `error`, `document-url` 401/403/200 and access-log write).
- Billing in Stripe test mode: a test clock drives trial end, a failed payment, the retries and the cancellation after 7 days, and asserts that the status stays `trialing` after the trial starts, `past_due_since`, the `canceled` state from `customer.subscription.deleted` and the fallback to `free_employer` (§10.1).
- Web: Vitest + Testing Library for synchronous components, zod schemas, DTO mappers; proxy unit tests with `next/experimental/testing/server` (`unstable_doesProxyMatch`, `getRedirectUrl`); Playwright E2E against `next build && next start` + local stack (sign-up → confirmation link from the mail catcher API → onboarding worker and employer → dashboards; worker applies with a document → employer downloads it → access log visible; billing with the null provider); @axe-core/playwright on public pages; header check for CSP nonce and no `'unsafe-inline'` for scripts.

### 14.5 CI (`.github/workflows/ci.yml`)

Jobs are added as the code they test appears. All jobs use `actions/checkout@v7` and `actions/setup-node@v7` (Node from `.nvmrc`) and run `npm ci`; the Supabase CLI comes from the npm devDependency, not from a separate setup action.

1. `web` (exists): lint, typecheck, unit tests (`npm test`), build.
2. `db` (exists): `npm run db:start` → `npm run db:test` (`npx supabase start`, `npx supabase test db`). Also in the job: `npm run db:lint` (`npx supabase db lint --local --fail-on error`). Added later: the type-drift check (`npx supabase gen types typescript --local` compared with the committed type files).
3. `functions` (added with the first Edge Function): Deno setup → `deno fmt --check`, `deno lint`, `deno test supabase/functions/_tests`.
4. `e2e` (added with the first user flow): depends on web + db; Playwright against the built app and the local stack.
5. `security` (exists): `npm audit --omit=dev --audit-level=high` (blocking), a full `npm audit` reported without blocking, and the secret-pattern check: `git grep` for `sb_secret_|service_role|SUPABASE_SECRET` must find nothing outside `supabase/`, `docs/` and `.github/`.

The forbidden-attribute check is a pgTAP test over `information_schema.columns` in the `db` job, not a grep.

---

## 15. Deployment

### 15.1 `supabase/config.toml` (values that matter)

The file is generated by `npx supabase init` (CLI 2.119.0) and then edited, so section and key names follow the generated template; where a name below differs from the generated file, the generated file is right.

```toml
project_id = "chara-pinnacle"
[api]
port = 54421
schemas = ["public", "graphql_public"]
max_rows = 100
[db]
port = 54422
shadow_port = 54420
major_version = 17            # must equal the cloud project's version — confirm after creation
[db.seed]
enabled = true
sql_paths = ["./seeds/ref/*.sql"]
[studio]
port = 54423
[local_smtp]                  # mail catcher
port = 54424
[auth]
site_url = "http://localhost:3100"
additional_redirect_urls = ["http://localhost:3100/auth/callback"]
jwt_expiry = 1800
enable_signup = true
minimum_password_length = 12
[auth.email]
enable_signup = true
enable_confirmations = true
secure_password_change = true
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
[auth.rate_limit]
sign_in_sign_ups = 30
token_verifications = 30
[storage]
file_size_limit = "50MiB"
[storage.buckets.passport-documents]
public = false
file_size_limit = "15MiB"
allowed_mime_types = ["application/pdf", "image/jpeg", "image/png"]
# … verification-evidence, dsar-exports, safety-evidence, org-media
[functions.billing-webhook]
verify_jwt = false
[functions.scan-document]
verify_jwt = false
[functions.notify]
verify_jwt = false            # scheduler shared-secret header; Resend webhook signature
[functions.document-url]
verify_jwt = true
```

### 15.2 Exact steps once the Supabase project exists

1. Create the project in Frankfurt (`eu-central-1`) on the Pro plan, with daily backups and point-in-time recovery (decided — OPEN_QUESTIONS.md, O1, O2; PITR is step 11); note the Postgres major version shown under Settings → Infrastructure and set `db.major_version` to it.
2. Settings → JWT keys: create and activate an asymmetric signing key (ES256). Settings → API keys: create the publishable key (for apps/web) and one secret key (for Edge Functions only). Record both in the key-rotation runbook.
3. Authentication → URL configuration: site URL = production origin; redirect allow-list = exact `https://<app>/auth/callback` and `/auth/confirm` URLs. Authentication → Providers → Email: confirmations on, secure password change on, minimum length 12, breached-password protection on. MFA: TOTP on. SMTP: custom SMTP through Resend, EU region (sender domain, DKIM/SPF/DMARC). Mirror every value in `config.toml` (`npx supabase config diff` previews and `npx supabase config push` applies the properties declared in `config.toml` to the linked project; settings it cannot write are set in the dashboard, and `docs/runbooks/deploy.md` is the checklist).
4. Settings → API: exposed schemas `public, graphql_public`; max rows 100.
5. Integrations: enable Cron (pg_cron), Queues (pgmq), and the pg_net and supabase_vault extensions; add Vault secrets `edge_shared_secret`, `billing_webhook_secret`.
6. Locally: `npx supabase login`, `npx supabase link --project-ref <ref>` (DB password prompted), `npx supabase db push --dry-run`, then `npx supabase db push` (migrations create roles, schemas, buckets, policies, cron jobs), then `npx supabase db push --include-seed` once for reference data only (never dev fixtures).
7. `npx supabase secrets set --env-file <file>` with an uncommitted file that uses the variable names of `supabase/functions/.env.example` (BILLING_WEBHOOK_SECRET, EDGE_SHARED_SECRET, the Stripe secret key and webhook signing secret, the Resend API key and webhook signing secret, the AV key when chosen; names must not start with `SUPABASE_`). In Stripe: register the `billing-webhook` URL as the webhook endpoint for the events in §10.3, enable Stripe Tax and the Customer Portal, and set the subscription retry schedule to cancel the subscription 7 days after the first failed payment (§10.1). In Resend: register the `notify` URL for the `delivered`, `bounced` and `complained` webhooks.
8. `npx supabase functions deploy --use-api` (no Docker needed; `verify_jwt` per function from `config.toml`).
9. Verify: `select * from cron.job`; sign up a test account and receive the confirmation email; `document-url` returns a 60-s URL and an access-log row; `billing-webhook` rejects a bad signature with 401 and applies a signed test event (Stripe test mode).
10. GitHub: add `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` to the `production` environment with required reviewers; enable `deploy-supabase.yml` (link → `db push` → `functions deploy --use-api` → `secrets set`). Optionally enable Branching for per-PR preview projects (no production data is copied; migrations, seeds and functions are applied).
11. Enable the PITR add-on (requires Small compute) and schedule the Storage object replication job; record the first restore drill date.
12. Web host (undecided): set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `DEPLOYMENT_VERSION`; build per environment (public vars are inlined at build time); deploy the standalone output or Docker image; put a CDN/WAF in front.
13. Bootstrap the first platform admin with a ticketed SQL insert into `public.platform_staff` (audited), then grant further roles only through `grant_platform_role`.
14. Separate staging project (same region) with the same steps and synthetic seeds only; not yet confirmed by the owner (OPEN_QUESTIONS.md, O9).

---

## 16. Threat model summary

| Threat | Primary control | Secondary |
|---|---|---|
| Cross-tenant read/write through the Data API | Default-deny grants + RLS on every table (ENABLE + FORCE), membership via indexed helper subqueries | Per-policy negative tests; Splinter lints; CODEOWNERS |
| Privilege escalation to platform roles | Roles in `platform_staff`, writable only by `grant_platform_role` (admin + aal2), session invalidation on change | Audit trigger; no profile column can grant privilege |
| Secret-key leakage from the web tier | The web tier has no secret key (ADR-0003) | CI pattern guard; ESLint restricted imports; rotation runbook |
| Billing granting trust (verification: later phase) | `billing_owner` has no privilege on verification tables; guard trigger keyed on `chara.actor_fn` | Privilege test; code review |
| Document exfiltration / URL replay | Owner-only storage policies; broker RPC with consent + scan checks; 60-s download-only URLs; access log by construction | Burst alerting on `document_access_log`; AV scanning when a vendor exists |
| Stale authorization after revocation | Lookups instead of claims; `jwt_expiry` 1800 s; global sign-out on role change | aal window bounded by token lifetime |
| XSS | Nonce CSP with `'strict-dynamic'`, React escaping, no `dangerouslySetInnerHTML` without review | `taint`, narrow DTOs, cookies limited to Realtime use |
| CSRF on Server Actions | Built-in Origin/Host check; `allowedOrigins` only when needed | SameSite=Lax cookies |
| Webhook forgery / replay | Provider signature verification; idempotent `provider_events` | Secrets in Edge Function secrets; 401 audited |
| Scheduled job abuse (pg_net → functions) | Shared-secret header from Vault; functions verify it | Function-level rate limits |
| Protected-attribute leakage | No such columns (pgTAP test over `information_schema.columns`); worker cards anonymised; photos excluded | Moderation and copy guidelines for free text |
| Re-identification via statistics | k-anonymity (k from settings) and rounding in public views; fixed dimensions only | Privacy review for each new public stat |
| Data loss | Daily backups + PITR; Storage object replication (DB backups exclude objects); restore drills | Forward-only migrations with tested rollback scripts |
| Local/cloud drift (CLI stack vs cloud project) | The same Supabase stack locally and in CI on every pull request; `db.major_version` equals the cloud project's version | Staging project before production |

---

## 17. ADRs and open decisions

The records are in `docs/adr/`.

- ADR-0001 — Express + Prisma backend. Superseded by ADR-0002; never built in this repository.
- ADR-0002 — Supabase is the entire backend; SQL migrations are the single source of schema truth.
- ADR-0003 — No secret keys in apps/web; privileged work only in Edge Functions.
- ADR-0004 — Strict nonce CSP with fully dynamic rendering; Cache Components deferred. Revisit when (a) hosting is chosen and public pages need CDN-cached HTML, or (b) Next.js SRI/hash-based CSP leaves experimental; the DAL/session code already follows the Cache Components authentication guide so the flip is a config + CSP change.
- ADR-0005 — Rule-based, explainable matching: every match stores its reasons (`reasons jsonb not null`); no machine learning in v1 (later phase).
- Open decisions are tracked in `docs/OPEN_QUESTIONS.md`: design conflicts (D1–D18; D1, D4 and D15 are decided by the owner, the others are marked "proposed" in this document) and decisions that belong to the owner. The owner's decisions reply (2026-10-02; client document, not in git) is recorded there as R20–R31, with the questions it raised as C10–C17, L7–L9, O9, O10 and P9–P12; O10 (email provider) is now decided: Resend. The SOP review of 2026-10-03 added D17 (MFA recovery), D18 (shares by document id) and P13–P17 (share expiry after a final state, decline undo, daily-summary time, applications to a Paused vacancy, moving back from Shortlisted), and extended C11 (contents of `free_employer`) and P12 (billing effect of a suspension).
