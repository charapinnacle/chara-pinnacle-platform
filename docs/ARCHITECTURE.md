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
│   audit-export (monthly export of the audit log to the archive) · billing-reconcile (weekly)  │
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
| Reference seeds | ISO 3166-1, ISO 639-1, ISO 4217, ISCO-08, ISIC Rev.4 rows in `supabase/seeds/ref/*.sql`. | Written by `scripts/gen-ref-seeds.mjs` from `Intl` plus committed code lists; no separate package. Licence noted in each seed header (CLDR: Unicode License v3; ISIC: United Nations data). Currencies exclude withdrawn ISO 4217 codes (`RETIRED_CURRENCIES` in the script). Seeds load on `db reset`; the hosted project receives them with `supabase db push --include-seed`. |
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
  .github/workflows/ci.yml    [now] jobs today: web · db · functions · e2e · security (§14.5)
  .github/workflows/deploy-supabase.yml   on push to main (environment "production", required reviewer)
  apps/web/                   [now] @chara-pinnacle/web, the only app; never holds a secret key (ADR-0003); dev server on port 3100.
                                    Today: Next.js 16 skeleton plus the web base (next.config.ts security headers, proxy.ts, lib/env.ts, lib/csp.ts, lib/i18n/locale.ts, lib/safe-next.ts, lib/supabase/, app/api/health, Vitest in tests/unit) and the UI primitives (shadcn/ui on Radix with neutral placeholder tokens in app/globals.css, the public, auth and app layout shells, skip link, toasts, skeleton, empty state and React Hook Form field wrappers; their labels are English literals until the lib/i18n dictionaries exist).
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
    app/[lang]/(auth)/              login, signup, verify-email, confirm-email, forgot-password, reset-password
    app/[lang]/(app)/mfa/           enrolment, challenge and backup device (needs a session, so it sits in (app) with the log-out button); (app)/forbidden;
                                    (admin)/admin is the console of FR-F1 (U41)
    app/[lang]/(app)/onboarding/    account kind → worker passport | employer organization → MFA;
                                    (later phase) recruitment/staffing organization wizard, geographies
    app/[lang]/(app)/dashboard/{worker,employer}/        (later phase) dashboard/{recruitment,staffing}/
    app/[lang]/(app)/org/[slug]/    members, jobs, applicants (ATS), billing;
                                    (later phase) workforce profile, availability, requirements, verification
    app/[lang]/(app)/passport/      sections, documents, shares + access log, consents
    app/[lang]/(app)/saved/         candidate's saved vacancies (FR-C5); the Save control is on jobs and jobs/[id]
    app/[lang]/(app)/applications/  candidate applications and journey tracker
    app/[lang]/(admin)/admin/       job moderation, suspensions and reinstatements, legal documents, staff, MFA reset, audit search
                                    (aal2 and a per-page role: moderation, suspensions and reinstatements trust_safety;
                                    legal documents, staff and MFA reset admin);
                                    (later phase) verification queue (role verification_reviewer), reports,
                                    plans, limits and settings editor (role admin)
    app/auth/callback/route.ts      return of Continue with Google: PKCE exchangeCodeForSession → onboarding or dashboard (destination never taken from the request)
    app/[lang]/(auth)/confirm-email  page with a button; its action runs verifyOtp(token_hash)
    app/api/health/route.ts         build id only
    app/sitemap.ts · app/robots.ts  search engine readiness (FR-H5)
    lib/env.ts                      zod: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SITE_URL; googleSignInEnabled() reads GOOGLE_SIGN_IN_ENABLED per request (server only, default off)
    lib/env.server.ts               zod, 'server-only', read lazily by serverEnv(): VISITOR_HASH_SECRET, TRUSTED_PROXY_HOPS
    lib/supabase/server.ts          createServerClient(cookies getAll/setAll with try/catch)  — 'server-only'
    lib/supabase/proxy.ts           updateSession helper (verbatim Supabase pattern)
    lib/supabase/browser.ts         createBrowserClient — Realtime only
    lib/dal/                        session.ts (getCurrentUser via React cache, requireUser/OrgRole/PlatformRole/Aal2),
                                    orgs.ts, passport.ts, hiring.ts, saved-jobs.ts, applications.ts, billing.ts, compliance.ts — DTOs only;
                                    (later phase) trust.ts
    lib/actions/                    'use server' files: zod parse → DAL → redirect/return
    lib/i18n/                       en.json dictionaries, getDictionary(lang)
    components/                     ui (shadcn primitives added with the shadcn CLI, never edited: wrap them), layout (shell, header, footer, skip link), feedback (toast, skeleton, empty state), forms (React Hook Form field wrappers); (later phase) VerifiedBadge (trust) and BoostedRail (billing) — never cross-imported
    emails/                         React Email templates for transactional emails (sent by the notify Edge Function)
    tests/unit, tests/e2e, playwright.config.ts, vitest.config.mts, .env.example (local values; the two server-only variables are placeholders)
  packages/db-types/                src/database.ts (generated, public schema); created with the first tables
  packages/shared/                  zod schemas, enums, stage machine, limit/feature keys; created only when a second consumer needs it
  supabase/                   [now] today: config.toml, .gitignore and tests/database/000_stack.test.sql; the rest below is the target
    config.toml               [now] generated by `npx supabase init`, then edited; see §15.1 for the values that matter
    migrations/                     <timestamp>_<name>.sql, small and forward-only, one pull request each:
                                    foundation · reference data · profiles and consents · organizations · billing core · …
    seeds/ref/*.sql                 reference data, plans, legal documents; listed in config.toml [db.seed] sql_paths
    seeds/dev/*.sql                 synthetic fixtures; never production; added when first needed
    functions/deno.json             [now] import map (`@supabase/supabase-js` pinned), fmt, lint and test settings; deno.lock is committed
    functions/_shared/              supabase.ts (user + secret clients), auth.ts, audit.ts, http.ts,
                                    billing/provider.ts, billing/providers/{null,stripe}.ts,
                                    database.types.ts (generated: public + billing + audit)
    functions/_tests/               [now] Deno tests (a directory named tests/ would deploy as a function)
    functions/document-url · billing-checkout · billing-webhook · billing-reconcile · notify · account-ops · scan-document · audit-export
                                    [now] account-ops (handler.ts is the testable part, index.ts only serves it); audit-export (U42: handler.ts, archive.ts)
    functions/serve-local.sh        [now] runs account-ops on the port of `ACCOUNT_OPS_PORT` (`playwright.config.ts`) against the local stack for the browser tests
    functions/.env.example          [now] committed, names only; local values go in functions/.env (gitignored)
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
| Reference data | `public.countries`, `languages`, `currencies`, `occupations`, `industries` | Read-only for users. ISO 3166-1, ISO 639-1, ISO 4217, ISCO-08, ISIC Rev.4 codes and labels; versioned seeds in `supabase/seeds/ref`. `occupations(code, label, synonyms text[])` with a trigram index on `label`; the code (four digits) is the key and columns that refer to it are named `occupation_id`. |
| Identity | `auth.users` (Supabase) + `public.profiles(id = auth.users.id, account_kind worker/company, intended_account_kind worker/company or null, pending_consents jsonb, display_name, preferred_lang, status active/suspended/deletion_pending, deleted_at)` | Created by trigger on sign-up, which copies the intended kind and the consent versions and age attestation ticked on the sign-up form into `intended_account_kind` and `pending_consents`; a sign-up that names no kind (Continue with Google) gets `intended_account_kind` null and no pending consents until `choose_account_kind` sets it once at onboarding, and the check `profiles_kind_matches_intended` ties `account_kind` to it (D31). `deleted_at` is the time a candidate asked for deletion (FR-B6, D46); `legal_hold` (default false) pauses the erasure, is set only by a ticketed SQL statement and is not readable through the API. No email, no password hash in public. After email confirmation `account_kind` is committed once from the intended kind by the RPC `set_account_kind`, which in the same transaction calls `accept_consents` and clears `pending_consents`; an immutability trigger protects `account_kind`; both are in the profiles migration (proposed — see OPEN_QUESTIONS.md, D9; flow in §6.3). `set_account_kind(p_consents)` takes the current versions the user accepted on the onboarding page; they replace superseded sign-up entries. The documents required per kind are the setting `required_consents` in `private.settings` (OPEN_QUESTIONS.md, L9); a kind with no entry makes `set_account_kind` refuse instead of committing without consents. `accept_consents` needs an active profile and answers a superseded version with `CHARA_CONSENT_REQUIRED`; `withdraw_consent` stays open to a suspended user. `signup_documents(p_kind)` (anon and authenticated) returns the documents required for a kind at their current versions, read from `required_consents`, and fails when one has no published version; the sign-up form and the onboarding page render from it. `pending_reconsents()` returns the documents of the caller's kind that need accepting again (a missing, withdrawn or superseded consent; never `age-18-plus`) and gates only a session that started after the publication or the withdrawal, found by the `session_id` claim in `auth.sessions`; a caller without a session row is treated as new. A change older than 7 days gates every session, so the 7-day bound of FR-A8 holds in the database whatever Auth does with the session. A profile that is not `active` is never gated, because `accept_consents` would refuse it. `session_id` is the one JWT claim read besides `sub` and `aal` (OPEN_QUESTIONS.md, D19). |
| Platform staff | `public.platform_staff(user_id, role, granted_by, granted_at, revoked_at)` | Separate table so a profile update can never escalate privilege. `role` values from the first migration: `admin`, `verification_reviewer`, `trust_safety`, with separate permissions and named users, no shared administrator account (decided — OPEN_QUESTIONS.md, D1). The policy limits a reader to their own active rows, so a plain `select *` is safe; revocation sets `revoked_at` and a trigger forbids undoing it, changing the role or deleting a row while the profile exists (after the profile is deleted `audit.log` is the record). Phase 1 builds the administrator console only; the reviewer queue is later phase. |
| Legal documents | `public.legal_documents(slug, version, title, body, change_summary, published_at, is_draft)`, unique `(slug, version)`; `public.v_legal_current` (security invoker, anon and authenticated) holds the current version of each slug | Current version = highest published version per slug (proposed — see OPEN_QUESTIONS.md, D2); a row with `published_at` null is unpublished and invisible to API roles. Slugs are lower-case with hyphens (`terms-of-service`). `is_draft` marks a text that legal counsel has not approved (the page shows a banner). Version 0 of each Phase 1 document and of `age-18-plus` is a DRAFT placeholder (`is_draft` true) seeded in `supabase/seeds/ref/legal_documents.sql`; the first approved text becomes version 1. A row counts as published when `published_at <= now()`. The body can be large and anon may read it: always query by slug and version and list the columns needed, never `select *` without a filter. |
| Consents | `public.consents(id, user_id, purpose, version, action granted/withdrawn, created_at)` | Append-only; withdrawal inserts a row with `action = 'withdrawn'`; there is no `withdrawn_at` column. `purpose` is the slug of the document accepted, and `(purpose, version)` references `legal_documents`; `user_id` has no foreign key so the ledger outlives the account. Age attestation (FR-A9) is the purpose `age-18-plus`, the slug of its wording (proposed — see OPEN_QUESTIONS.md, D3). |
| Organizations | `public.organizations(id, type, legal_name, display_name, slug, based_in_country, industry_code, website, legal_entity_identifier, legal_entity_identifier_kind, status)`, `organization_members(organization_id, user_id, role owner/admin/member, invited_by, accepted_at)`, `organization_invitations(email, role, token_hash, expires_at, accepted_at)` | Slug unique and `text`, lower case by check constraint (not `citext`: `citext_eq` is not leakproof, so the planner would not use the index under RLS, and the `/org/[slug]` lookup runs on every request); created only via `create_organization`, which writes the organization and the owner membership in one transaction. An organization is listed through `organization_members` joined to `organizations`, never by an unfiltered read of `organizations` (the policy filter is not an index condition). Exactly one owner (partial unique index); workers cannot be members (trigger). Invitations are single use with a 7-day expiry; one that names an inviter who is no longer an accepted admin or owner, or an organization that is not active, is refused like an unknown token. `create_organization(type, legal_name, display_name, based_in_country, industry_code, website, identifier, identifier_kind)` returns jsonb with the organization id, its slug and `duplicate_legal_name` (names compared ignoring letter case and repeated spaces; nothing about the other organization); it normalises the identifier (upper case, spaces, dots, hyphens and slashes removed, 4 to 32 letters or digits, kind `registration_number`, `vat_number` or `other`), audits `duplicate_legal_name` and `legal_entity_trial_used`, and `set_legal_entity_identifier(org, identifier, kind)` lets the owner at aal2 set it until billing records exist (OPEN_QUESTIONS.md, D36). `update_organization_profile(org, legal_name, display_name, based_in_country, industry_code, website)` lets an owner or admin at aal2 of an active organisation correct the company details afterwards (the table has no update grant); the legal name follows the identifier lock (`private.legal_entity_locked`, refusal `CHARA_FORBIDDEN` detail `legal_name_locked`), the slug never changes, a duplicate legal name is reported as at registration, and one `organization.updated` audit row names the changed fields (OPEN_QUESTIONS.md, D78). It returns the organization already created when the same user repeats the same legal name within a minute (a double click or a retried request), refuses beyond `private.settings` key `organizations_per_user_max` (3) owned organizations with `CHARA_LIMIT_REACHED` detail `organizations`, and gives a taken slug a random suffix (no counting loop). `invite_member` and `change_member_role` take the role as the `member_role` enum, so an unknown role fails with SQLSTATE 22P02 before the function runs; the web layer validates the role with zod. FR-A5 parts not in this migration: the invitation rate limit (AC2), the ownership transfer with confirmation (AC8) and the removal job (AC6) come with the team page (U12); the plan member limit (AC3, AC12) with the plan tables (U14). The `organization_type` enum keeps all three company types; Phase 1 creates employer organizations only (proposed — see OPEN_QUESTIONS.md, D7). |
| Workforce profile (later phase) | `organization_geographies`, `organization_occupations`, `organization_industries`, `organization_languages`, `organization_service_types`, `workforce_availability` | `geography_scope` = sources_from / serves_market; based_in stays a column on `organizations` (three geographies). `workforce_availability.updated_at` always displayed. |
| Worker passport | `public.worker_profiles(user_id pk, first_name, last_name, headline, current_country, occupation_id, years_experience, availability, available_from, searchable)`, `worker_skills`, `worker_languages`, `worker_preferred_countries`, `worker_work_authorizations`; (later phase) `worker_preferred_industries`, `worker_experience` | Owner-only. `searchable default false` and stays false in Phase 1. Created by `create_worker_passport`; list limits and date windows are `private.settings` rows (OPEN_QUESTIONS.md, D41). |
| Documents | `public.worker_documents(id, worker_user_id, type, title, bucket_id, storage_path, file_name, mime, size_bytes, scan_status, expires_on, deleted_at)` | Metadata row must exist before upload; owner-only. The owner column is named `worker_user_id` in every worker-owned table (proposed — see OPEN_QUESTIONS.md, D13). |
| Sharing | `public.passport_shares(id, worker_user_id, organization_id, application_id, scope jsonb, consent_id, expires_at, revoked_at)` | Per-organization sharing with a consent row. `scope` is a jsonb array of the ids of the documents the candidate selected for that application, never document types; `document_access_grant` checks the document id, so an unselected document or a later upload of the same type is refused (proposed — see OPEN_QUESTIONS.md, D18). In Phase 1 a share is created by `apply_to_job`, revoked at once by `withdraw_application`, and given `expires_at` by `set_application_status` when the application reaches Hired or Not selected (default 30 days, setting `share_expiry_days_after_final`; OPEN_QUESTIONS.md, P13). |
| Jobs | `public.jobs(id, organization_id, posted_on_behalf_of_organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type, salary_min, salary_max, salary_currency, salary_period hour/month/year, accommodation, visa_support, recruitment_preference, status draft/open/paused/closed/filled, moderation_state visible/hidden/org_suspended, search_vector, created_by, deleted_at)`, `saved_jobs(worker_user_id, job_id, created_at)` | `search_vector` generated tsvector; `created_by default auth.uid()`; status transitions guarded by trigger (vacancy transition table below; `status` is in the update grant since FR-C2, D47); `status_changed_at` and `published_at` (first change to open, kept) are set by that trigger and are not client-writable; `updated_at` is stamped by `jobs_touch_updated_at` on every update (the `lastmod` of the sitemap, FR-H5), not readable through the API and not named by `job.updated`; `private.jobs_audit` writes `job.created`, `job.updated` (changed columns, without the status), `job.status_changed` (old and new status, `actor_fn` for the system pause) and `job.deleted`; `created_by` and `search_vector` are not readable through the API and `posted_on_behalf_of_organization_id` is not insertable in Phase 1 (D45); public read of open, visible jobs only; `moderation_state` is `hidden` when set by `moderate_job` and `org_suspended` when set by `suspend_organization` (§11). `saved_jobs` (FR-C5, D51): the candidate reads, inserts and deletes own rows only, an insert needs a worker account and a vacancy that is public, the saved page reads through `list_saved_jobs` (nothing moderated is disclosed), and `private.cleanup_saved_jobs` (pg_cron, daily) removes the rows of vacancies Closed, Filled or deleted for more than the retention policy `saved_jobs` (90 days). Salary: check `salary_min <= salary_max` when both are set; `salary_currency` and `salary_period` are required when either amount is set; no currency conversion in Phase 1 (search filter in §9.2). Jobs can be posted by any company type; `posted_on_behalf_of_organization_id` is null in Phase 1. `saved_jobs` is owner-only. |
| Applications (ATS) | `public.job_applications(id, job_id, worker_user_id, status, cover_note, passport_share_id, profile_snapshot jsonb, created_at)`, `application_events(application_id, from_status, to_status, actor_id, note, created_at)`, `application_notes(application_id, organization_id, author_id, body)` | `status`: applied, viewed, shortlisted, interview, offer, hired, rejected, withdrawn; the UI label of `rejected` is "Not selected". Shortlisting is the `shortlisted` state, set through `set_application_status` and gated by `private.has_feature(org, 'shortlisting')`; there is no separate shortlisted flag (the SDD column `shortlisted` is not created). Unique partial index on `(job_id, worker_user_id) where status <> 'withdrawn'`. Profile snapshot taken at apply. `application_events` is append-only and written by RPCs only; its `note` holds the stage-change note or the decline reason and is visible to the candidate in the journey tracker, and the employer UI labels the field "Visible to the candidate". Internal remarks go only in `application_notes`, which is visible to members of the job's organization only and never shown to the candidate. Writes go through `apply_to_job`, `withdraw_application`, `set_application_status`, `bulk_set_application_status`. Read: `worker_user_id = auth.uid()` or member of the job's organization. As built for FR-D1 and FR-D7 (OPEN_QUESTIONS.md, D52): `job_applications.organization_id` is the tenant of the job, copied by `apply_to_job`; `worker_user_id` and `application_events.actor_id` carry no foreign key because `erase_user` replaces them by a pseudonym; `passport_share_id` has no foreign key (`passport_shares.application_id` is the unique, referenced side); no API role has an insert, update or delete grant on either table; the candidate reads the own rows (events without `actor_id`) and the accepted members of the job's organisation read its applications and events (FR-D5, D56); `application_events` is append-only with the one exception of that pseudonymisation. As built for FR-D3 (D54): the candidate's list is `my_applications` (the only source, because the policies of `jobs` hide vacancies that left the public site) and the timeline is the view `v_my_application_timeline` (no actor id; the role is told by a private definer helper; it joins the application and keeps only the candidate's own rows, so the member policy of the events does not widen it). As built for FR-D5 (D56): the policies are named `<table>_<command>_<audience>`; the members of an active organisation read its applications and events (a suspended organisation is refused in the database); `application_notes(id, application_id, organization_id, author_id, body, created_at)` is append-only, with member select and insert policies; `erase_user` deletes the notes of an erased candidate; an attempt on another organisation's application through an RPC leaves the log line `CHARA_CROSS_TENANT`; the design, the plans and the departures are in D56. As built for FR-E1 (D57): the applicant list and board read the view `v_job_applicants` (`security_invoker`; the row policy of FR-D5 decides the rows), the snapshot also holds the passport `completeness` at the time of applying, `export_applicants` writes the CSV rows and the audit row `applicants_exported`, and `get_applicant_access` tells the pages what the plan allows. |
| Notifications | `public.notifications(id, user_id, kind, payload, status, msg_id, attempts, provider_message_id, last_error, delivery, created_at, sent_at)`, `notification_preferences(user_id, digest, email_undeliverable_at)` | Queued via pgmq and delivered by the `notify` Edge Function through Resend; preferences are checked by the enqueue trigger, mandatory kinds ignore them. Kinds, triggers and recipients: email catalogue below. As built for FR-I2 (U37, OPEN_QUESTIONS.md, D62): the one way to queue an email is `pgmq.send('notifications', {kind, user_id, mandatory, ...ids})`; the trigger `notifications_enqueue` on `pgmq.q_notifications` writes the `notifications` row in the same transaction (payload by `private.notification_payload`: ids, titles and dates per kind, nothing else) and, for `application_received` to a member with `digest`, deletes the message and leaves the row `queued` for the daily summary (FR-D6, OPEN_QUESTIONS.md, D63: the hourly job `notify-daily-summary` queues one summary message per member and marks the held rows `summarised`). The user reads own rows through a column grant and a policy on `user_id`; nobody writes them through the API. |
| Hiring network (later phase) | `public.workforce_requirements` (+ `requirement_occupations`), `requirement_invitations`, `partner_responses`, `candidate_submissions`, `connections`, `conversations`, `conversation_participants`, `messages`, `saved_items`, `follows` | Spec §21–§23. |
| Billing | `billing.plans`, `plan_limits`, `plan_features`, `subscriptions`, `customers`, `orders`, `provider_events`; (later phase) `boosts`, `boost_products`, `verification_products`, `verification_fees`, `organization_limit_overrides` | Unexposed schema, owner `billing_owner`; read through public views. Columns in §10.1. |
| Verification (later phase) | `public.verifications` (+ `verification_evidence`, `verification_events`, `badge_definitions`, view `org_badges`) | Writes only via RPC; guard trigger. |
| Moderation | `public.moderation_actions(target_type profile | organization | job, target_id, action, statement_of_reasons not null, actor_id)`; (later phase) `reports`, `report_appeals` | Reason mandatory. DSA notice-and-action (reports, appeals) is later phase (§11). |
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
- Every transition appends an `application_events` row (actor, from, to, note, time) and queues the candidate's `status_changed` email, except a move to `viewed`. As built for FR-D2 (U28, OPEN_QUESTIONS.md, D53): the table is `private.application_transition_allowed(from, to, function)`, judged by the trigger `private.applications_guard_transition` (BEFORE UPDATE OF `status`, `ENABLE ALWAYS`; it also checks `has_feature(org, 'shortlisting')`), so the database owner needs the name of the function that may make the move (`chara.actor_fn`: `mark_application_viewed`, `set_application_status`, `withdraw_application`); the one writer is `private.move_application` (update, event, share expiry, audit row `application.status_changed` with organisation, from and to and no note, queue message `status_changed` with ids and the new state and no note); `mark_application_viewed` writes the event of the system's move with no actor (`actor_id` null).
- `withdrawn` revokes the share at once (`revoked_at`, plus the `withdrawn` consent row; As built for FR-D4 (U30, OPEN_QUESTIONS.md, D55): `public.withdraw_application(p_application_id)` calls `private.move_application`, whose audit action for this move is `application.withdrawn`); `hired` and `rejected` set `passport_shares.expires_at` to now plus `share_expiry_days_after_final` (default 30; OPEN_QUESTIONS.md, P13).
- Bulk changes and declines apply the same guard per application. Before anything is applied the UI shows a confirmation step listing the selected applicants, the target state and the reason. There is no undo: a decline is final and its email is sent (OPEN_QUESTIONS.md, P14).
- For an organization on `free_employer` (lapsed, or any organization on that plan once limits are enforced) `set_application_status`, `bulk_set_application_status` and note inserts are refused and `viewed` is not set; past applicants stay readable (§10.4; OPEN_QUESTIONS.md, C11). `withdraw_application` is never blocked.

Vacancy state machine (FR-C2; enforced by the trigger `private.jobs_guard_transition`, BEFORE UPDATE OF `status` on `public.jobs`; every change is audited). The UPDATE policy limits status changes to owners and admins, and the trigger re-checks the role, so a caller with no signed-in user is refused unless `chara.actor_fn = 'pause_jobs_on_lapse'` (then only open to paused passes). A change to the status the vacancy already has is a no-op: no trigger, no audit row. A refusal raises `CHARA_INVALID_TRANSITION` (the detail names both statuses); the audit action is `job.status_changed` with `from` and `to` in the metadata. The `active_jobs` limit check of the rows marked so is `private.jobs_enforce_limits` (FR-C6), the trigger `jobs_limit_check`, which sorts after `jobs_guard_transition` so that a wrong role or a change the table does not list is refused first.

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
| `member_invitation`, `deletion_requested`, `deletion_completed`, `mfa_reset` | `invite_member` (§6.3), `request_account_deletion` and the completed erasure (§12), `reset_mfa` (§6.1) | The invitee, the account holder, or the user whose factors were reset | Mandatory |
| `erasure_paused` | The daily erasure job finds a due account under a legal hold (once per request; §12) | The privacy contact address (`private.settings` key `privacy_contact_email`) | Mandatory |

Delivery: `notify` runs every minute (pg_cron job `notify-run`, only while a message is visible), sends with the notification id as idempotency key and records the result through `notify_ack` (`queued`, `sent`, `failed` after retries; a failure that can pass, such as a rate limit or an outage, leaves the message in the queue to come back and ends as `failed` only after `notify_max_reads` reads). Resend delivery webhooks (`delivered`, `bounced`, `complained`), signature-verified by `notify`, are recorded on the notification row through `notify_ack`; a hard bounce or a complaint sets `notification_preferences.email_undeliverable_at`, and later emails to that address are not sent and are recorded as `suppressed`; a trigger on `auth.users` clears `email_undeliverable_at` when the email address changes. pg_cron runs in UTC, so the daily-summary job runs hourly and sends when the hour in Europe/Berlin is 08.

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

- `auth.users` → `public.profiles` (1:1, created by trigger `private.handle_new_user()`; `intended_account_kind` from the sign-up form, or null for a sign-up that names none (Google) until `choose_account_kind` sets it once (D31); `account_kind` null until committed from it after email confirmation, then `worker` or `company`, immutable afterwards, tied to the intended kind by the check `profiles_kind_matches_intended`; set by `set_account_kind` and guarded by a trigger — proposed, see OPEN_QUESTIONS.md, D9; §6.3).
- `public.organizations` (`type` employer | recruitment_company | staffing_company, `slug text unique`, lower case, `based_in_country`), `public.organization_members` (`role` owner | admin | member, `accepted_at`), `public.organization_invitations` (email citext, token_hash, role, expires_at). Phase 1 has employer organizations only: the enum keeps all three values and `create_organization` rejects the other two (proposed — see OPEN_QUESTIONS.md, D7).
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
  - Phase 1: `accept_consents`, `withdraw_consent`, `set_account_kind` (added with the profiles migration; proposed — see OPEN_QUESTIONS.md, D9), `create_organization`, `invite_member`, `accept_invitation`, `remove_member`, `transfer_ownership`, `change_member_role` (added with the organizations migration; proposed — see OPEN_QUESTIONS.md, D14), `grant_platform_role`, `revoke_platform_role` (U13; OPEN_QUESTIONS.md, D11, D39), `create_worker_passport`, `passport_limits`, `document_access_grant`, `search_jobs`, `get_public_job` (FR-C4, OPEN_QUESTIONS.md D50), `apply_to_job`, `withdraw_application`, `set_application_status`, `bulk_set_application_status`, `mark_application_viewed`, `get_applicant`, `list_applicant_events`, `application_documents`, `application_profile_changed`, `list_application_notes` (the last three U33, D58; the first two U28; OPEN_QUESTIONS.md, D53), `get_dashboard_applications`, `get_dashboard_plan` (U36; D61), `moderate_job`, `suspend_user`, `suspend_organization`, `reinstate_user`, `reinstate_organization` (§11), `reset_mfa` (§6.1; proposed — see OPEN_QUESTIONS.md, D17), `list_organization_members`, `list_platform_staff` and `my_platform_roles` (§6.1; OPEN_QUESTIONS.md, D37), `record_job_form_invalid` (U21; D45), `record_job_limit_prompt` (U23; D48; writes the audit action `limit.prompt_shown` only for an organisation at its limit), `update_organization_profile` (U60; D78), `publish_legal_document`, `billing_checkout_start`, `billing_usage` (U48; D75), `request_data_export`, `request_account_deletion`.
  - Later phase: `share_document`, `withdraw_share` (sharing outside an application), `publish_requirement`, `invite_partners`, `respond_to_invitation`, `submit_candidate`, `approve_submission`, `chara_match`, `verification_start/submit/claim/request_info/decide/suspend`, `report_content`, `moderation_decide`.
- Service RPCs called by Edge Functions have EXECUTE granted to `service_role` only; they are listed in §8.
- RPC errors use stable codes (`CHARA_FORBIDDEN`, `CHARA_LIMIT_REACHED`, `CHARA_FEATURE_NOT_IN_PLAN`, `CHARA_DOCUMENT_NOT_SCANNED`, …) that the DAL maps to UI messages.

### 5.6 Example policy set — `public.jobs`

```sql
alter table public.jobs enable row level security;
alter table public.jobs force row level security;

-- As built (D45): created_by and search_vector are left out of the select grant, posted_on_behalf_of_organization_id out of
-- the insert grant (null in Phase 1), and status out of the update grant until the lifecycle (FR-C2) adds it with its guard.
grant select (id, organization_id, posted_on_behalf_of_organization_id, title, description, occupation_id, industry_code,
              country_code, city, employment_type, salary_min, salary_max, salary_currency, salary_period,
              accommodation, visa_support, recruitment_preference, status, moderation_state, deleted_at, created_at,
              status_changed_at, published_at)
  on public.jobs to anon, authenticated;
grant insert (organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type,
              salary_min, salary_max, salary_currency, salary_period, accommodation, visa_support, recruitment_preference)
  on public.jobs to authenticated;                      -- created_by uses `default auth.uid()`, status defaults to 'draft'
grant update (title, description, occupation_id, industry_code, country_code, city, employment_type,
              salary_min, salary_max, salary_currency, salary_period, accommodation, visa_support,
              recruitment_preference, status)
  on public.jobs to authenticated;                      -- organization_id / created_by are not updatable; status goes through the guard trigger
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

- Providers: email + password (minimum 12 characters, email confirmation required, `secure_password_change = true`), and Google for every account kind (D28, D31 to D35; Microsoft later via the same callback). Magic link optional for workers later. Anonymous sign-ins disabled.
- Continue with Google (U08d): the button on `/[lang]/signup` and `/[lang]/login` starts `signInWithOAuth` (PKCE) in the Server Action `continueWithGoogle`, which is throttled like a login attempt (the callback counts again, so one Google sign-in weighs two login attempts in the per-visitor bucket, D35) and stores the code verifier in the session cookies; Auth sends the browser to Google and back to `app/auth/callback`, which exchanges the code and sends the person to `/[lang]/onboarding` (no kind yet) or their dashboard. The button and the action exist only while the server flag `GOOGLE_SIGN_IN_ENABLED` is exactly `true` (default off, any other value is off; `[auth.external.google]` is `enabled = false` in `config.toml`, so the local stack and CI never reach Google). Linking rule (D32): Auth's automatic linking attaches a Google identity to an existing user only when the address is the same and the provider reports it verified, and then deletes that user's other unconfirmed identities; `enable_manual_linking` stays `false`, so no signed-in session can attach an identity; an email sign-up for an address that already has a Google account changes nothing and answers like a new address (Auth's obfuscated response). The callback adds its own check on the session Auth issued: the account email must be confirmed and the Google identity must carry `email_verified = true`, otherwise the session is ended and the login page says Google has not verified the address. A person whose Google address matches a password account therefore reaches that same account, with its kind and consents, and receives the `identity_linked` notice; an account that was pre-registered with a password and has not committed a kind lets the Google-authenticated owner choose the kind afresh, because `choose_account_kind` replaces the pre-registered intended kind and drops its pending consents when a verified Google identity is linked (D32); nobody can reach an account through an address the provider has not verified. Google accounts have no password: a password attempt gets the generic login answer, and the recovery email (Auth sends it to every confirmed address, and the web tier has no secret key to tell the cases apart without an enumeration oracle, as D24) says that Google users need no password; the reset link also lets a Google user add one. MFA is unchanged: staff and organization owners still need aal2 for the pages that require it, and a Google session is aal1 until a factor is verified.
- MFA: TOTP enrol/verify enabled. Mandatory for platform staff and organization owners/admins (enforced three ways: `as restrictive` aal2 policies on sensitive tables, aal2 checks inside RPCs, `requireAal2()` in the DAL which redirects to `/[lang]/mfa`). Optional for workers.
- MFA recovery (proposed — see OPEN_QUESTIONS.md, D17): there are no recovery codes (Supabase TOTP issues none, and a custom code cannot raise a session to aal2). The MFA page lets a user enrol a second TOTP factor as a backup, for example on a second device. A lost device is reset by a Platform Administrator after an identity check: the console calls `reset_mfa(user_id, reason)` (role `admin` + aal2, never on oneself, reason mandatory, `audit.record`), which has `account-ops` delete the user's TOTP factors through the Auth admin API and sign the user out globally; the user enrols again on the next protected page, and the mandatory `mfa_reset` email is queued (§4).
- Two-step verification (FR-A4, U11): `/[lang]/mfa?next=` has three states from the user's factors and token. No verified factor: the page renders a button; the Server Action `startFactorEnrolment` deletes the user's unverified factors (which Auth would otherwise count and whose names it keeps) and enrols the factor `Authenticator`, and the page then shows the QR code (an `<img>` with alt text, from the data URI Auth returns), the setup key as selectable text and the code field. Rendering the page changes nothing in Auth, so a reload or a crawler cannot replace the secret of a QR code that was scanned; starting again (a second tab, a reload and a new click) replaces the unfinished factor and the older tab answers "start again". Verified factor at aal1: one code field, and with two devices a choice of device, because a code cannot be tied to a device and trying each would leave a refused challenge for every login; one submission therefore checks one factor (`answerChallenge` takes the factor id and refuses one that is not a verified factor of the user). The reset-password form has no device choice and still tries each verified factor, so a user with a backup device leaves one refused challenge row per factor tried there. Aal2: the list of devices, and a form that adds the backup (name 1 to 32 characters, unique per user, default `Backup`; `startFactorEnrolment` starts it and the verification keeps the user on the page). At most two verified factors (`[auth.mfa] max_enrolled_factors = 2` and a check before the Auth call); no recovery codes are issued or shown. A further factor is only accepted from a session at aal2: `startEnrolment` refuses (`aal2_required`, also when Auth answers `insufficient_aal`) when a verified factor exists and the session is at aal1, and `verifyEnrolment` refuses at aal1 when a verified factor exists, so a password alone cannot add a factor of its own and lift the session to aal2. The code is six digits after removing spaces (checked in the browser and again in the Server Action); a wrong code keeps the focus in the field. After a valid code the user goes to `next` (`mfaReturnPath`, never the MFA page itself) or to the dashboard of their kind. Guards: `requireAal2(lang, user)` sends an aal1 session to `/[lang]/mfa?next=<requested path>`; `requirePlatformRole(lang, roles?)` (FR-F1, U41, replacing `requirePlatformStaff`) looks the roles up through `public.my_platform_roles()` (the table itself is unreadable at aal1), answers a user with no active role, and a page outside the roles of the staff member, with the not-found page (404) and no MFA prompt, and sends a staff member at aal1 to the MFA page. The page guards of the organisation pages (`requireOrgRole`: owner and admin need aal2, a plain member does not) come with those pages (U12, U32, U48). Database: restrictive policies on `organization_invitations` (U09) and `platform_staff`, aal2 inside the member-management RPCs, and inside `list_organization_members`, `list_platform_staff` and `reset_mfa`; the billing views get theirs in U14. Status for the team and staff lists is read with `list_organization_members(org)` (owner or admin at aal2; `mfa_enrolled` boolean for owner and admin rows, null for a member) and `list_platform_staff()` (admin at aal2); nothing about a factor but that boolean leaves `auth.mfa_factors`. `reset_mfa` writes the audit row `mfa_reset` (actor, target, reason in metadata), one message `{action: reset_mfa, user_id}` in the pgmq queue `account_ops` and one `{kind: mfa_reset, user_id, mandatory: true}` in the queue `notifications`, and deletes nothing; the functions that read those queues are U13 and U37. `list_organization_members(org, limit, after_user)` and `list_platform_staff(limit, after_id)` page by keyset (primary-key order, `list_platform_staff` newest first since the console shows it so; the default page is 50 and the cap 100); the role order is applied by the caller. KPIs: privileged users enrolled = owners and admins with an accepted membership plus staff with an active role, those with a verified TOTP row in `auth.mfa_factors`, divided by all of them; challenge failure rate = `auth.mfa_challenges` rows with `verified_at` null divided by all rows over a `created_at` range (indexed; one submitted code is one challenge, an enrolment verification is a challenge too, and the reset-password path counts one per factor tried); administrator resets per quarter = `audit.log` rows `mfa_reset` by `created_at` (index `log_action_created_at_idx` on `(action, created_at)`). `reset_mfa` audits every call but queues the job and the mandatory email once while a job for that user waits. The code check is throttled per visitor in the web tier (`mfa_code`, 10 per 300 s, §15.1) before Auth is asked, because Auth counts the web server's one address.
- JWT: asymmetric ES256 signing key enabled at project creation so `getClaims()` verifies locally against JWKS; `jwt_expiry = 1800`; refresh-token rotation and reuse detection on; `[auth.sessions] timebox = "168h"` ends a session 7 days after login, and the cookie adapters cap the cookies at `Max-Age=604800` (§6.2).
- Recovery (FR-A3): the link is emailed by Auth from `supabase/templates/recovery.html` and opens `/[lang]/reset-password?token_hash=…`; Auth has one link lifetime (`otp_expiry`, 24 hours for the sign-up link), so the setting `recovery_link_minutes` (60) holds the recovery link twice: `public.recovery_link_is_fresh(token_hash)` answers the web tier at once from `auth.one_time_tokens`, and the pg_cron job `expire-recovery-tokens` (every minute, `private.expire_recovery_tokens()`) deletes recovery tokens older than that, so Auth's own verify endpoint refuses an old link too, within a minute of its age (OPEN_QUESTIONS.md, D22). A newer request replaces the older token (Auth keeps one recovery token per user). `[auth.email.notification.password_changed]` sends the notice after every password change; a trigger on `auth.users` writes the audit row `password_changed` (actor and entity the user, empty metadata). The Auth hook `private.hook_password_verification_attempt` counts failed password checks per account in `private.login_failures` and writes one `login_failures_threshold` audit row per window (settings `login_failure_threshold` 5 and `login_failure_window_minutes` 15; no lockout is built); `stats.login_attempts_daily` holds correct and failed password checks per day over 16 shards chosen by the account (one row per day would serialise every failed login on one lock inside the Auth request). KPIs: login success rate = `sum(successes) / sum(successes + failures)` over a day range of that table; it covers existing, usable accounts only (Auth does not call the hook for an unknown address, a banned or an unconfirmed account, so the unknown-address case is deliberately invisible, FR-A3 AC4). Reset completion rate = `audit.log` rows `password_changed` that follow a recovery request, divided by the recovery requests, which are Auth's `auth.audit_log_entries` rows with `payload->>'action' = 'user_recovery_requested'`; that Auth table has no index on `created_at`, so the query is run ad hoc over a bounded `created_at` range (monthly), not on a dashboard. `password_changed` also fires if Auth re-hashes a password at login after a change of its hash cost; check on the hosted Auth version that it does not (OPEN_QUESTIONS.md, D26), and count only rows that follow a recovery request when computing the KPI.
- Rate limits: the Auth actions are throttled per visitor in the web tier (§15.1, OPEN_QUESTIONS.md, D20, D29) and `[auth.rate_limit]` is raised to values that only all visitors together could reach, tuned after launch; Auth emails go through Supabase custom SMTP on the transactional email provider; transactional emails are sent by the `notify` Edge Function through that provider's API. The provider is Resend, EU region (decided; OPEN_QUESTIONS.md, O10). The Auth SMTP settings of the hosted project are set in the dashboard (they are not in `config.toml`, so that the local stack and CI keep sending to the mail catcher), and the Auth and `notify` emails share one provider account and one delivery webhook (`docs/runbooks/account-emails.md`).

### 6.2 Next.js 16 wiring (verified against bundled docs)

- `middleware.ts` is deprecated; `apps/web/proxy.ts` exports `proxy(request)` and runs on the Node runtime. Matcher: `'/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)'` — it must not exclude app routes because Server Functions are POSTs to the page route (a matcher that excludes a path silently removes session refresh and CSP for its actions).
- `lib/supabase/proxy.ts` is the documented `updateSession`: create `createServerClient(url, publishableKey, { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies, headers) => { write to request.cookies; recreate NextResponse.next({ request: { headers: requestHeaders } }); set cookies and headers on it } } })`, then immediately `await supabase.auth.getClaims()` (no code in between), then optimistic redirects, then return the same response object. `getSession()` is never trusted on the server.
- `proxy.ts` also generates the CSP nonce (`crypto.randomUUID()` base64), sets `Content-Security-Policy` on both request and response headers, `x-nonce`, `x-request-id`, and redirects paths without a locale prefix to `/en/...` (except `/auth/*`, `/api/*`).
- `lib/supabase/server.ts`: `const cookieStore = await cookies()` (async in 16); `setAll` wrapped in try/catch because Server Components cannot write cookies; cookies are set only in Server Actions and Route Handlers.
- Proxy is an optimistic check only. Every Server Action and Route Handler re-reads the session through the DAL and RLS is the final check.
- `proxy.ts` also forwards the requested path and query as the request header `x-pathname`; `requireUser(lang)` uses it to send a user with a pending re-consent to `/[lang]/consent?next=…` (the gate lives in the DAL because layouts do not re-render on client navigation; `requireUser(lang, { consentGate: false })` is for the consent page and its action). `/[lang]/legal/[slug]` shows the current version with its date, change summary and change log (FR-H3).
- DAL (`lib/dal/session.ts`, `import 'server-only'`): `getCurrentUser = cache(async () => { claims via getClaims(); profile lookup; return narrow DTO { id, accountKind, platformRoles, aal, displayName } })`, `requireUser()`, `requireOrgRole(slug, minRole)`, `requirePlatformRole(role)`, `requireAal2()`. Raw rows never reach Client Components; `experimental.taint` is on and `taintUniqueValue` is applied to tokens. Session reads sit behind `<Suspense>` boundaries and layouts never await the session at top level (keeps the Cache Components migration a config change).
- Server Actions: `useActionState` forms, zod validation, `redirect()` after success. Built-in Origin/Host CSRF check; `experimental.serverActions.allowedOrigins` only if a reverse proxy rewrites Host; `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` set per environment; `deploymentId = process.env.DEPLOYMENT_VERSION` for skew protection.
- Login (`signIn`), logout (`signOut`), reset request (`requestPasswordReset`) and reset (`resetPassword`) are Server Actions in `lib/actions/login.ts` and `lib/actions/recovery.ts`. A wrong password for a known and an unknown address, and every reset request, get one answer each; `signOut` revokes this session only (`scope: 'local'`) and the reset ends all others (`scope: 'others'`). `next` is honoured only through `safeNextPath`; the landing page is `/[lang]/dashboard/worker` or `/employer` by account kind (placeholders until their units). The reset page opens a link without spending it; the click on the form validates the password first, then spends the link, then changes the password, so a mistyped password never uses the link up. The session the spent link opened carries the retries for 15 minutes (`hasRecoverySession`: an `otp` entry in `amr`), which the page also honours because every submission re-renders it; the entry is not specific to recovery (the sign-up confirmation also leaves an `otp` session), so for 15 minutes after confirming an address a holder of that session could open the form with any well-formed `token_hash` (accepted: that holder already is the user, a marker cookie would prove nothing because the holder controls the browser, and the clean fix, a signed marker, is not worth its weight yet). The reset ends all other sessions with one retry; if that still fails the form says that the password was changed but the other devices were not signed out, rather than redirecting as if all had worked. When Auth answers `insufficient_aal` (a verified factor exists) the form asks for the 6-digit code and verifies it before the password is saved (OPEN_QUESTIONS.md, D25). `lib/supabase/cookie-options.ts` replaces the 400-day lifetime that @supabase/ssr stamps on its cookies with 7 days in the server and proxy adapters. `requireUser` sends a visitor to `/[lang]/login?next=<path>` and a suspended profile to `/[lang]/suspended`. `signIn` also signs a just-created session out when the profile is suspended without a ban. The log-out button sits in the Account menu of the header of the `(app)` layout (U57, `docs/runbooks/app-shell.md`).
- Route Handlers exist only for `auth/callback` (the return of Continue with Google, nothing else) and `api/health`. The confirmation link opens the page `/[lang]/confirm-email`, whose button submits the Server Action `confirmEmail`; the Route Handler of earlier drafts is gone because a GET that spends the single-use token is spent by mail scanners and link previewers. No provider webhook ever hits Next.js.
- Browser client (`createBrowserClient`, publishable key, reads the non-httpOnly auth cookies exactly as @supabase/ssr documents) is used only for Realtime subscriptions. Everything else goes through the server. The strict nonce CSP (ADR-0004) is what makes keeping cookies readable by the browser acceptable.

### 6.3 Onboarding per user type

1. Sign-up asks "candidate or company" first, because the kind decides which consent and age-attestation checkboxes are shown (documents per kind: OPEN_QUESTIONS.md, L9). The form collects email + password, the intended kind, versioned consent to the documents shown for that kind, and the age attestation (FR-A9, consent purpose `age-18-plus`; no date of birth is stored) (proposed — see OPEN_QUESTIONS.md, D3). They travel as sign-up metadata; `private.handle_new_user()` copies them into `profiles.intended_account_kind` and `profiles.pending_consents`. No `consents` row is written before the email is confirmed.
2. After email confirmation, `/[lang]/onboarding` shows the intended kind and commits it once through the RPC `set_account_kind`, which copies `intended_account_kind` into `account_kind`, calls `accept_consents` with the versions held in `pending_consents` (writing the `consents` rows in the same transaction) and clears `pending_consents`; a trigger makes `account_kind` immutable afterwards (proposed — see OPEN_QUESTIONS.md, D9). If a document version shown at sign-up has been superseded, the user accepts the current version first. A sign-up that names a kind other than worker or company is rejected by the trigger and Auth then reports a generic database error; the web sign-up validates the kind with zod so a user never sees that error. A sign-up that names no kind (a Google sign-up, or a call made directly against Auth) gets a profile with `intended_account_kind` null and no pending consents (D31): every protected page sends it to `/[lang]/onboarding` until the kind is committed. The confirmation email links to `/en/confirm-email?token_hash=…` (template `supabase/templates/confirmation.html`); opening it changes nothing and shows a button, and the button submits the Server Action `confirmEmail`, which verifies the token, ignores any `next` parameter and lands on `/[lang]/onboarding`; any failure lands on `/[lang]/verify-email?error=invalid_link` with a form to request a new link (the resend answers alike for every address). Spending the token on a click keeps mail scanners from using it up and removes the login-CSRF of a GET that signs the visitor in. The sign-up metadata is written by the browser, so a visitor who calls Auth directly can put any consent entries there; onboarding then records them as the user's own claim, the same weight as ticking boxes unread, and the web action stays the only path that checks them against the documents shown (OPEN_QUESTIONS.md, D21). Sign-up KPIs: the share confirmed within 24 hours is `auth.users.email_confirmed_at` minus `public.profiles.created_at` (the sign-up time), because `confirmation_sent_at` is overwritten by every resend. For an account with no intended kind, onboarding shows the choice of worker or employer, then the documents of that kind (and the age box for workers) and calls `choose_account_kind(kind, consents)`: it sets `intended_account_kind` once (the profile trigger allows null to a value only) and calls `set_account_kind` in the same transaction, so the consents are written before the kind is committed and a missing or superseded consent leaves the account unchosen; repeating the same kind is a no-op, another kind is refused, `accept_consents` refuses an account with no kind, and `profiles_kind_matches_intended` states the invariant on the table. The onboarding page commits the kind itself: with nothing stale it calls `set_account_kind` on load; when a version shown at sign-up is superseded, or an entry is missing, it first shows those documents with their change summaries and passes the accepted versions as `p_consents`.
   - Worker → `create_worker_passport(first_name, last_name, current_country, preferred_lang)` → `worker_profiles` (`searchable = false`) → worker dashboard with passport completion checklist.
   - Employer → `create_organization(type, legal_name, display_name, based_in_country, industry_code, website, identifier, identifier_kind)` inserts organization + owner membership + audit row atomically → MFA enrolment (blocking for the owner); the company form is shown on `/[lang]/onboarding` once the kind is committed and until the user has an organization, and a legal name already in use is reported to the user as a notice before they continue. No subscription row is inserted at this point: the plan resolves to `free_employer`, and the `trialing` subscription row arrives through the billing webhook after checkout, where the card is collected before the trial starts (FR-G2) (decided — OPEN_QUESTIONS.md, D4; card timing to be confirmed — OPEN_QUESTIONS.md, C15; trial rules in §10.1). In Phase 1 `create_organization` rejects the recruitment and staffing types (proposed — see OPEN_QUESTIONS.md, D7).
   - Recruitment / Staffing (later phase) → same RPC, then the "Where do you serve?" wizard (three geographies, industries, occupations, languages, service types, capacity).
3. Members (FR-A5, U12): `invite_member(org, email, role)` → `organization_invitations` (hashed token, 7 days; owner or admin at aal2; at most `invitations_per_hour_max` (20) per organization and hour, counted in `audit.log`; the member limit `private.assert_within_limit(org, 'members', private.team_size(org))` counts accepted members including the owner plus unexpired invitations). The RPC returns the token once and the dialog shows the link (`/[lang]/invitations/[token]`) with its role and expiry as a fallback, and queues the `member_invitation` email in the same transaction (FR-I1, OPEN_QUESTIONS.md, D65): the message `{kind, invitation_id, email, mandatory}` carries the address and no token (`notify` deletes it when finished), the row has no `user_id` and its payload gets the link token only while it is `queued` (a trigger removes it when the row is sent, failed or suppressed); a new invitation for the address suppresses the email of the one it replaces. A new invitation for an address replaces the pending one. `invitation_preview(token)` (open to visitors) names the organization, role and invited address for a valid link and shows nothing for any other. `accept_invitation(token)` requires the caller's confirmed email to match the invitation and rejects workers (OPEN_QUESTIONS.md, D10). A visitor who registers from the link (`/[lang]/signup?invitation=<token>`: employer only, address fixed) has the link kept in the httpOnly cookie `chara_invitation` until onboarding hands it back, so they are not asked to create a company. Roles are changed with `change_member_role` (D14); `remove_member` deletes the membership at once and queues the `account_ops` message `{action: 'sign_out', user_id, reason: 'member_removed', organization_id}` for `account-ops` (U13) to end the member's sessions. Ownership moves in two steps: `transfer_ownership(org, user)` (owner, aal2) records one open row in `organization_ownership_transfers` (a new request replaces it, 7 days), `accept_ownership_transfer(org)` (the designated member, aal2) swaps the roles in one transaction, `cancel_ownership_transfer(org)` withdraws it; no email is sent. `list_organization_members(org)` gives every member names and roles and owners and admins at aal2 also the address and `mfa_enrolled`; `team_member_allowance(org)` gives the limit that applies and the size it counts. Page guard: `requireOrgRole(lang, slug, minRole)` in `lib/dal/session.ts` looks the role up on every request (a removed member is refused on the next one) and holds owners and admins at `/[lang]/mfa`. KPIs come from `audit.log`: acceptance rate = `invitation_accepted` rows over `member_invited` rows in a period, time to accept = the difference of their `created_at` for one `entity_id` (the invitation id), orphaned organizations = organizations whose count of `role = 'owner'` members is not 1 (the constraint trigger keeps it 0).
4. Platform staff are never self-service and never share an account: `grant_platform_role(user, role)` takes any of the three roles `admin`, `verification_reviewer`, `trust_safety` (decided — OPEN_QUESTIONS.md, D1), requires an existing admin with aal2, is audited, and calls `account-ops` to sign the target out globally so a fresh session carries the new state. `grant_platform_role(user, role, reason)` and `revoke_platform_role(user, role, reason)` (U13; OPEN_QUESTIONS.md, D11, D39) take the role as text so that a bad value is `CHARA_INVALID_INPUT`, refuse a caller who is not an active admin (`CHARA_FORBIDDEN`), a session below aal2 (`CHARA_FORBIDDEN`, detail `aal2_required`) and a grant to oneself (detail `own_account`), require a reason of 10 to 500 characters trimmed, grant only to a confirmed, active user, and refuse a repeat grant or revocation (`CHARA_CONFLICT`). The reason reaches the audit row through the transaction setting `chara.audit_reason`, which the row trigger of `platform_staff` reads, so the row trigger writes the one audit row (`platform_role_granted`, `platform_role_revoked`) for the RPCs and for the bootstrap insert alike. Each call queues `{action: sign_out, user_id, reason}` in `account_ops`. A revoked row stays; a later grant is a new row. At least one active admin always remains: the RPC refuses the last revocation (detail `last_administrator`) and a deferred constraint trigger fails any transaction that ends without one (a profile delete is not covered; the later account erasure must refuse the last administrator). The first admin is created by the ticketed, audited SQL insert of `docs/runbooks/platform-staff.md`, which also holds the quarterly access review. Roles are looked up on every request, so a revoked role is refused at once; the sign-out follows within a minute.

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
2. Share: in Phase 1 a share exists only for a specific application. `apply_to_job(job_id, note, document_ids)` inserts a `consents` row (`purpose = 'share_passport:<org>:<application>'`, version of the sharing notice, `action = 'granted'`; the application id makes one withdrawal cancel one share only, OPEN_QUESTIONS.md, D55) and a `passport_shares` row (`application_id` set, `scope` = jsonb array of the ids of the documents the candidate selected; each id must be the caller's own, non-deleted `worker_documents` row) (proposed — see OPEN_QUESTIONS.md, D18); `withdraw_application` sets `revoked_at` and inserts the `withdrawn` consent row (same purpose and version as the granted row) in the transaction that moves the application to `withdrawn`. When the application reaches `hired` or `rejected`, `set_application_status` sets `expires_at` (default 30 days; OPEN_QUESTIONS.md, P13). The worker's passport page lists shares and the access log. Sharing outside an application (`share_document(organization_id, scope jsonb, expires_at)` / `withdraw_share`) is later phase.
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
   As built (OPEN_QUESTIONS.md, D43): the caller is authorised before the scan state is read; the withdrawal check compares ledger ids (`w.id > c.id`) because `created_at` ties inside a transaction; the consent must be the candidate's own; the candidate's profile and the organization must be `active`; `consent_id` carries no foreign key and `application_id` references `job_applications` since `apply_to_job` (OPEN_QUESTIONS.md, D52); the log's purpose is `owner_download` when the caller owns the document and `application_review` otherwise, and any other value is refused with `CHARA_FORBIDDEN`.
4. The function then uses the secret client only to `createSignedUrl(path, 60, { download: file_name })` and returns the URL. No access-log row, no URL. The worker reads `public.v_my_document_access_log` (security_invoker over `audit.document_access_log`, policy `worker_user_id = auth.uid()`).
5. Retention: `retention_policies(entity, days)` rows drive `private.apply_retention()` (pg_cron daily); object deletion always goes through the Storage API from `account-ops` (SQL deletes on `storage.objects` would orphan S3 objects). Account erasure purges the whole `{user_id}/` prefix.
   As built (OPEN_QUESTIONS.md, D44): the access log is append-only (updates and truncates are refused, deletes only inside `private.apply_retention()`), `retention_policies` is `private.retention_policies`, the view is `public.v_my_document_access_log` (columns `id, organization_name, document_title, accessed_at, purpose`; the owner's own downloads are logged but not listed), and the owner's download also goes through the grant with purpose `owner_download`.
6. Backups: Supabase database backups exclude Storage objects, so a nightly replication of the private buckets to a CHARA-controlled EU object store is a launch requirement (`account-ops` job or an external scheduled job; budget is an owner question).

---

## 8. Where logic lives

| Rule | Lives in | Examples |
|---|---|---|
| Must be true regardless of caller (ownership, visibility, limits, status transitions, append-only, k-anonymity, workers never pay) | Postgres: constraints, RLS, triggers, security_invoker views | `audit.log` immutability trigger; owner-count constraint; `jobs_enforce_limits` trigger; application transition guard; `guard_verification_transition` (later phase) |
| Touches several tables or needs a privileged read | SECURITY DEFINER RPC in `public` (owned by postgres, `set search_path = ''`, re-checks uid/role/aal, writes audit) | `create_organization`, `apply_to_job`, `set_application_status`, `document_access_grant`; later phase: `verification_decide`, `chara_match` |
| Needs a secret, outbound network or long runtime | Edge Function (one capability each); database access only through RPCs | `billing-checkout`, `billing-webhook`, `billing-reconcile`, `document-url`, `notify`, `account-ops`, `scan-document` |
| Scheduled | pg_cron → SQL function; pg_net to an Edge Function when the outside world is needed; pgmq for retries | MV refresh, expiries, retention, billing retry, notification fan-out |
| Rendering, forms, navigation, i18n | Next.js Server Components and thin Server Actions (zod → DAL → RPC/table via the user's session) | — |

Edge Functions and the database: an Edge Function never reads or writes a table directly. Calls made on behalf of a user (`document_access_grant`, `billing_checkout_start`) use a client scoped to the caller's JWT. Privileged calls use the secret key, and `service_role` can only execute these public RPCs (`grant execute … to service_role`, revoked from `public`, `anon`, `authenticated`):

| Service RPC | Called by | Effect |
|---|---|---|
| `billing_ingest_event` | `billing-webhook` | Idempotent insert into `billing.provider_events` (unique provider + provider event id). |
| `billing_apply_event` | `billing-webhook`, billing retry job | Applies a stored event to subscriptions, customers and orders. |
| `billing_webhook_rejected` | `billing-webhook` | Audits a delivery with an invalid signature (`billing.webhook_rejected`: provider and reason, no payload), at most once an hour for each provider and reason, because the endpoint is public and the audit log permanent. |
| `billing_reconcile_records` | `billing-reconcile` | One page (at most 5,000, in primary-key order) of the subscription records that have a provider reference, for the weekly comparison with the provider. |
| `billing_reconcile_report` | `billing-reconcile` | The result of one comparison: the total of differences, one operations alert per difference of a sample of at most 200 (and one more when the sample is smaller than the total), and one audit row `billing.reconciled` with the total. A large run is never refused. |
| `audit_record_external` | any function | Appends an `audit.log` row for an action that happened outside the database. As built (U42, D68): `audit_record_external(action, entity_type, entity_id, actor_id, metadata)` takes the actor from the job (kept only while the profile exists), refuses an action that is not lower-case `<entity>.<verb>` or that starts with a name the database writes for administrative acts (`user.`, `organization.`, `job.`, `mfa.`, `platform_role.`, `legal_document.`), and for `account_ops.*` actions requires `metadata.job_id` and writes one row per action and job (a unique index): a repeat returns false and adds none. `created_at` and `ip` are never arguments. |
| `audit_export_month` / `audit_export_count` | `audit-export` | The rows of one finished calendar month (UTC) as one jsonb page of at most 5,000 (default 1,000) in keyset order of (`created_at`, `id`), and their number. A month that is not over is refused. |
| `document_set_scan_status` | `scan-document` | Sets `worker_documents.scan_status`. |
| `notify_dequeue` / `notify_ack` | `notify` | `notify_dequeue(limit)` reads a batch (invisible for `notify_visibility_seconds`, 180), closes the messages that need no send (row not queued: archived; address undeliverable: row `suppressed`; read more than `notify_max_reads` (8) times or no address: row `failed`, listed in `failed_closed` so that `notify` raises the alert) and answers one jsonb with the messages (notification id, kind, payload, recipient address, read count), the queue depth and the settings `notify_backlog_threshold` and `notify_retry_delays_seconds`. `notify_ack(outcome, notification, provider message id, attempts, error)` records `sent` or `failed` (and archives the message; a message that carries an address is deleted instead) or a delivery event of Resend (`delivered`, `bounced_transient`, `bounced_permanent`, `complained`, found by provider message id, never lowering what is recorded); a permanent bounce or a complaint marks the address undeliverable and is audited. Both return nothing that identifies a person except the recipient address of the batch. |
| `account_ops_dequeue` | `account-ops` | Reads up to 100 jobs from the pgmq queue `account_ops` (invisible for 60 s once read, 60 s x n after the n-th read); deletes and audits (`account_ops_abandoned`: the action did not happen) a job read more than `account_ops_max_attempts` (8) times. No queue archive is kept: the audit rows are the record. |
| `account_ops_end_sessions` | `account-ops` | Deletes the user's rows in `auth.sessions` (refresh tokens go by cascade) and returns their number. The Auth admin API ends sessions only with the user's own token, so this is the one session operation done in the database. |
| `account_ops_ack` | `account-ops` | Deletes a finished job from the queue and writes the audit row `account_ops_done` (action and result; the row names the user only while the user still has a profile, so an acknowledgement after an erasure writes the old id nowhere); a repeat returns false and writes nothing. |
| `erase_user` | `account-ops` | After the cooling-off period and with no legal hold: deletes the candidate's passport, documents and profile, and replaces the user id in the audit log, consent ledger, document access log and shares by one random pseudonym (a transaction setting lets the append-only triggers accept that change and no other), then writes `account.erased` and queues the completion email. Returns false when no profile exists any more, so a retry changes nothing. `account-ops` then purges the storage prefix and deletes the auth user (D46). |

`service_role` has no direct table grants in the schemas of this project (`public`, `private`, `audit`, `stats`, `pgmq`; `001_rls_meta` and `022_platform_staff_roles` assert this; the platform's own `vault`, `storage`, `cron` and `net` schemas keep their Supabase grants: pg_net's `net.http_request_queue`, which holds the headers of a pending scheduler call including `x-edge-secret`, is readable in SQL by every role, and the owner cannot revoke that, so `net` is never an exposed API schema (`auth-config.test.ts` asserts it) and the shared secret is rotated by the step in `docs/runbooks/platform-staff.md` section 3) and executes no function of `public` but the service RPCs. Storage and Auth admin calls (signed URLs, prefix purge, user deletion, global sign-out, sign-in ban and lifting it on suspension and reinstatement (§11), TOTP factor deletion for an MFA reset (§6.1)) go through their own APIs with the secret key; the RPCs `suspend_user`, `suspend_organization`, `reinstate_user` and `reset_mfa` queue an `account-ops` job through pgmq after their audit row is written.

Privileged-operation confinement: the secret key is an Edge Function secret only; `billing_ingest_event` and `billing_apply_event` are owned by `billing_owner` with EXECUTE for `service_role` only; `audit.log` accepts rows only through `audit.record()` (wrapped by `audit_record_external` for Edge Functions); the CI `security` job fails if `sb_secret_|service_role|SUPABASE_SECRET` appears outside `supabase/`, `docs/` and `.github/`; ESLint `no-restricted-imports` forbids importing anything from `supabase/functions` or a secret-key client into `apps/web`.

Rate limiting: per-visitor counters in front of the Auth calls (`public.rate_limit_attempt`, §15.1) and Auth built-ins; `private.check_rate_limit(action, subject)` at the top of abuse-prone RPCs (as built for `document_access_grant`, FR-E2, D58: the allowance is the settings `rate_limit_<action>_max` and `_seconds`, the counter a row of `private.rate_limit_hits`; messages, reports, invitations and match runs follow the same way); bucket size/MIME limits; `serverActions.bodySizeLimit = '2mb'`; a CDN/WAF in front of the web host once chosen.

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

As built for `search_jobs` (FR-C3, OPEN_QUESTIONS.md D49): the filters are optional parameters of one definer function (not a record), the result has the public columns plus `next_cursor`, and the order is relevance, then newest first, then id, over keyset pages of 1 to 50 rows (20 by default). The function reads no billing table, so no test of a boost is needed until boosts exist.

As built for the vacancy page (FR-C4, OPEN_QUESTIONS.md D50): `get_public_job(p_id)` is a definer function with the same public predicate as `search_jobs`; it returns the vacancy with the labels of its lists and the employer's public profile (display name, country, industry, website), because an anonymous caller cannot select `organizations`, and no row for a vacancy that is not public.

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

As built for `v_platform_counts` (FR-H4, OPEN_QUESTIONS.md D73): a `security_invoker` view cannot read a snapshot that anonymous callers may not select, so the view reads `private.platform_counts()`, a definer function that applies `k` (`private.stats_min_count()`) to the exact counts and rounds the candidate count after the test (`k` is never below 5); the Phase 1 snapshot has the columns `countries`, `workers`, `employers`, `active_jobs` only.

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

  Limits and features are rows, so they change without a deployment. The administrator console page and the admin-only, audited RPCs (role `admin` + aal2) that edit plans, limits, features, `trial_days` and settings are not in the Phase-1 console list (§3); they are later phase (to confirm — OPEN_QUESTIONS.md, P9), and until then a change is made by migration. The Enterprise values are starting numbers, raised per organization under fair-use rules: a row in `billing.organization_limit_overrides(organization_id, limit_key, limit_value)` (built with the plans, U14; `limit_value` is required and at least 0, so an override cannot express unlimited) takes precedence over the plan row for that organization.
- `plan_features(plan_code, feature_key)` — keys: shortlisting, csv_export, analytics_advanced; later phase: advanced_worker_search, advanced_partner_search, chara_match, corridors, available_workforce_search, job_order_access, multi_partner_invitation, analytics_enterprise, multi_country_requirements, priority_visibility. Feature rows per tier (decided — OPEN_QUESTIONS.md, C2, C3; two tier assignments and three undefined values open — C16):
  - Every paid plan, from `employer_starter`: job posting, workforce requirement, `chara_match`, basic search, messaging, job order posting and access, access to relevant workforce opportunities, basic partner connection, standard profile visibility, `shortlisting` and `csv_export` (team defaults; the reply mentions neither, OPEN_QUESTIONS.md, C16). `chara_match` and the core workforce-requirement workflow are never reserved for a higher plan.
  - `employer_professional` and `employer_enterprise` add: advanced search (`advanced_worker_search`, `advanced_partner_search`), `analytics_advanced`, `corridors`, `multi_partner_invitation`, `multi_country_requirements` (follows the limits table; conflict open — OPEN_QUESTIONS.md, C16; the Basic tier is "limited" and the meaning of limited is not defined yet). More partner invitations and messaging capacity are limits (table above); enhanced company visibility has no feature key yet (later phase).
  - `employer_enterprise` adds: `analytics_enterprise`, `priority_visibility` ("included or available"; the exact rule is not defined yet), priority support, multi-country partner network access, higher or unlimited volumes under fair-use rules (per-organization overrides), enhanced and enterprise-level verification options and Verified Partner eligibility (no feature keys yet; later phase). On the other plans priority visibility is bought as a boost (follows the limits table; conflict open — OPEN_QUESTIONS.md, C16).
  - `available_workforce_search` is not assigned to a tier by the reply; open (OPEN_QUESTIONS.md, C16).
- `subscriptions(id, organization_id, plan_code, status trialing | active | past_due | canceled | paused, trial_ends_at, current_period_start, current_period_end, cancel_at, past_due_since, last_provider_event_at, provider, provider_customer_ref, provider_subscription_ref)`; partial unique index: one non-canceled subscription per organization; check: organization type is a company type. No row is inserted when an organization is created; the first (`trialing`) row arrives through the billing webhook after checkout (decided — OPEN_QUESTIONS.md, D4). `past_due_since` is set from the first `invoice.payment_failed` of a dunning period and cleared by `invoice.paid`; `last_provider_event_at` is the creation time of the newest provider event applied, used to detect stale events (§10.3).
- Grace period and dunning (FR-G4): the 7-day grace starts at `past_due_since`. Stripe's retry (dunning) settings retry the payment and cancel the subscription 7 days after the first failure; the local `canceled` state comes only from `customer.subscription.deleted`, never from a local timer. During the grace period the organization keeps its plan. A daily check, `billing.check_past_due_overdue(p_now)`, alerts operations (once for each `past_due_since`) when a subscription is still `past_due` more than one day after the grace period ends; it changes nothing (`docs/runbooks/subscription-states.md`). Tested in Stripe test mode with a test clock (trial end, failed payment, retries, cancellation).
- Lapse (FR-G4; defaults to be confirmed by CHARA — OPEN_QUESTIONS.md, C11): when a subscription is cancelled the organization falls back to `free_employer`. In the same transaction `billing_apply_event` calls `private.pause_jobs_on_lapse(org)` (owned by `postgres`, EXECUTE granted to `billing_owner` only), which moves every `open` vacancy to `paused` with `chara.actor_fn = 'pause_jobs_on_lapse'` and writes one audit row per vacancy. For the lapsed organization, application status changes, notes and bulk actions are refused and reopening a vacancy goes through the `active_jobs` limit (0), whether or not `entitlements_enforced` is on (§10.4). A new checkout restores the plan; paused vacancies are then reopened by the owner or an admin through the normal limit check.
- Trial (decided — OPEN_QUESTIONS.md, D4, C6): the card is collected at checkout before the trial starts (card timing to be confirmed — OPEN_QUESTIONS.md, C15); the trial lasts `plans.trial_days` (30, administrator-editable) and converts automatically to the selected paid plan. One trial per legal entity: the billing customer carries a unique legal-entity identifier (company registration number, VAT number or another unique legal-entity identifier; C14), and `billing_checkout_start` grants no trial when that identifier has already had one. Which identifier is mandatory per country and how it is validated is open (C14). Before the trial starts the checkout confirmation page states the trial period, the price after the trial, the billing frequency, the automatic conversion and how to cancel.
- `customers(organization_id, provider, customer_ref, billing_country, vat_id, registration_number)`, written by `billing_checkout_start` (the webhook sets `customer_ref`); the billing address is collected by the provider and not stored. `trial_grants(identifier_key, organization_id, granted_at)` holds one row per legal-entity identifier that had a trial (`vat:<VAT ID>` or `reg:<country>:<registration number>`, normalised), written by the webhook; `plan_provider_refs(plan_code, provider, provider_product_ref, provider_price_ref)` holds the provider's product and price of a sold plan, written only by `scripts/sync-stripe-plans.mjs` and never exposed through a view. `billing_checkout_start(p_org, p_plan_code, p_billing_country, p_vat_id, p_registration_number, p_terms_version, p_provider, p_disclosed_trial_days)` returns the price reference, the customer reference, the trial length and the slug for the return address; `billing_portal_start(p_org)` returns the customer reference and the slug; both are for an owner or admin at aal2 and write an audit row (`billing.checkout_started`, `billing.portal_opened`). The runbook is `docs/runbooks/checkout.md`.
- Currency and VAT (decided — OPEN_QUESTIONS.md, C7): prices are stored and displayed in EUR, exclusive of VAT; VAT is calculated by the payment provider from the customer's location and the applicable tax rules. EUR is the only billing currency in the first release; every price row has a `currency` column so further currencies can be added as rows. Tax treatment for customers outside the EU follows the payment provider and accounting setup agreed with the owner's advisers.
- `orders(id, organization_id, kind, sku_or_plan, amount_minor, tax_minor, currency, provider, provider_ref, invoice_ref, created_at)` — one row per paid invoice with an amount above zero, written by the webhook, unique on `(provider, provider_ref)`; the tax amount and invoice reference come from the provider (Stripe Tax). Differences from this sketch: OPEN_QUESTIONS.md, D70.
- `provider_events(id, provider, provider_event_id, kind, payload jsonb, signature_valid, provider_created_at, received_at, status received | applied | stale | error, applied_at, error, unique(provider, provider_event_id))` — inserted only by `billing_ingest_event`; `status`, `applied_at` and `error` are set by `billing_apply_event` (§10.3).
- (later phase) `boost_products(sku, target_type job | organization, org_type, days, price_minor, currency)` seeded from the pricing doc: job 2500/7d, 3900/14d, 5900/30d; recruitment 5900/10900/19900; staffing 4900/8900/13900. `boosts(id, organization_id, sku, target_type, target_id, starts_at, ends_at, provider_payment_ref unique)`; `public.v_active_boosts` is the only reader (BoostedRail). Decided (OPEN_QUESTIONS.md, R29): boosts are sold to hiring, recruitment and staffing companies for job postings, workforce requirements, company profiles and partner profiles, and can be bought on any plan, without a higher plan. Possible functions: top search placement, featured profile, job or requirement, priority visibility, regional or country visibility, homepage or category placement. The reply asks for the boost system in the production architecture from the start; it is designed here and built in the boosts phase (to confirm — OPEN_QUESTIONS.md, P9). Boost products are administrator-editable rows; administrators control price, duration, placement, country or region, category, availability and promotional discounts. The catalogue prices are open (C8), and the columns for the attributes not listed above are designed with that phase.
- (later phase) `verification_products(sku verification_basic | professional | enterprise, price_minor 4900 | 9900 | 19900 (Enterprise is a starting price), interval 'year', eligible_levels text[])`; `verification_fees(id, organization_id, sku, paid_at, expires_at, provider_payment_ref unique)` — a paid fee only allows `verification_submit` for a paid level; it never touches `verifications.status`.
- Every `billing` table has RLS enabled and forced and a policy `to billing_owner using (true) with check (true)`, because BYPASSRLS is not inherited through role membership (§10.3). `service_role` has no grants on the schema.
- Workers have no rows anywhere in `billing`; checkout RPCs reject `account_kind = 'worker'`.
- UI reads through `public.v_plans`, `public.v_my_subscription`, `public.v_org_limits` (U23; D48; security_invoker, select for `authenticated`, the organisations of the caller: plan name, `active_jobs` limit, open vacancies, for the upgrade prompt) and, later phase, `public.v_active_boosts` (security_invoker; SELECT granted on the underlying tables with RLS policies: plans/products public, subscriptions/boosts by org members; provider refs excluded from the views).

### 10.2 Adapter interface (`supabase/functions/_shared/billing/provider.ts`)

```ts
// Every event also carries providerCreatedAt (ISO time the provider created it), used for the stale check (§10.3). Outside the
// checkout orgId is optional: an event without it is resolved through providerCustomerRef or providerSubscriptionRef.
export type NormalizedEvent = { providerCreatedAt: string } & (
  | { kind: 'checkout.completed'; orgId: string; providerCustomerRef: string; providerSubscriptionRef?: string }
  | { kind: 'subscription.activated' | 'subscription.updated' | 'subscription.canceled';
      orgId?: string; providerCustomerRef?: string; planCode?: string; status: 'trialing'|'active'|'past_due'|'canceled'|'paused';
      providerSubscriptionRef: string; currentPeriodStart?: string; currentPeriodEnd?: string; trialEndsAt?: string; cancelAt?: string }
  | { kind: 'subscription.trial_will_end'; orgId?: string; providerCustomerRef?: string; providerSubscriptionRef: string; trialEndsAt: string }
  | { kind: 'payment.succeeded'; purpose: 'subscription'; orgId?: string; providerCustomerRef?: string; providerSubscriptionRef: string;
      subscriptionStatus: 'active'|'trialing'; amountMinor: number; taxMinor: number; currency: string; invoiceRef: string; providerPaymentRef: string }
  | { kind: 'payment.failed'; orgId?: string; providerCustomerRef?: string; providerSubscriptionRef: string; providerPaymentRef: string });
  // later phase: refund.issued and the boost and verification_fee purposes of payment.succeeded

export interface CheckoutInput {
  orgId: string; planCode: string; priceRef: string | null; trialDays: number;
  successUrl: string; cancelUrl: string; customerRef?: string;
}

export interface BillingProvider {
  readonly name: 'null' | 'stripe';
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
  createPortal(input: { customerRef: string; returnUrl: string }): Promise<{ url: string }>;
  verifyWebhook(req: Request, rawBody: string): Promise<{ ok: true; eventId: string; type: string; payload: unknown } | { ok: false; reason: string }>;
  normalize(payload: unknown): NormalizedEvent[];            // [] for a type CHARA does not use
  fetchSubscription(providerSubscriptionRef: string, fetchedAt: Date): Promise<NormalizedEvent | null>;  // the re-fetch of a stale event
  listSubscriptions(startingAfter?: string): Promise<{ subscriptions: SubscriptionState[]; next: string | null }>;  // the weekly comparison
}
```

`providers/null.ts` verifies `x-chara-signature` = HMAC-SHA256(rawBody, `BILLING_WEBHOOK_SECRET`) (hex) and takes a body `{id, event}` whose event is already normalized; it is the provider in dev, CI and E2E. `providers/stripe.ts` is the production provider: Stripe Checkout, Customer Portal, Stripe Tax and webhook signature verification. The `boost` and `verification_fee` kinds in the interface are later phase. `billing_checkout_start` passes the organization id, which `providers/stripe.ts` sets as the Checkout session `client_reference_id` and in `subscription_data.metadata`; `normalize` takes `orgId` from that subscription metadata (from `client_reference_id` for `checkout.session.completed`), so subscription and invoice events resolve to the organization even when they arrive before `checkout.session.completed`. The interface is built in two steps: `createCheckout` and `createPortal` with the checkout function (FR-G2; the null provider answers with addresses on `null-provider.invalid`, which a test intercepts), `verifyWebhook` and `normalize` with the webhook (FR-G3).

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
  p_provider text, p_provider_event_id text, p_kind text, p_payload jsonb, p_signature_valid boolean, p_provider_created_at timestamptz)
returns uuid
language plpgsql security definer set search_path = '' as $$ /* insert into billing.provider_events … on conflict (provider, provider_event_id) do nothing; returns the event id */ $$;

create or replace function public.billing_apply_event(p_event_id uuid) returns text   -- the status of the event
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
  select case when exists (select 1 from billing.plans p where p.code = private.org_plan_code(p_org))
              then (select l.limit_value from billing.plan_limits l
                    where l.plan_code = private.org_plan_code(p_org) and l.limit_key = p_key)
              else 0 end                                         -- an unknown plan code has a limit of 0
$$;

create or replace function private.has_feature(p_org uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not (coalesce((select (value #>> '{}')::boolean from private.settings where key = 'entitlements_enforced'), false)
              or coalesce(private.free_plan_restricted(p_org), false))   -- a lapsed organization has no feature either
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

-- Canonical use: BEFORE triggers on the counted tables (works for direct inserts and RPCs alike). The organization
-- row is locked FOR NO KEY UPDATE first, so two publishes of one organization are serialised (the count then sees
-- the other one's commit), and a soft-deleted vacancy is not counted (FR-C6, D48).
create or replace function private.jobs_enforce_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status = 'open' then return new; end if;
  perform 1 from public.organizations o where o.id = new.organization_id for no key update;
  perform private.assert_within_limit(new.organization_id, 'active_jobs',
    (select count(*)::integer from public.jobs j
      where j.organization_id = new.organization_id and j.status = 'open' and j.deleted_at is null and j.id <> new.id));
  return new;
end $$;
create trigger jobs_limit_check before insert or update of status on public.jobs
  for each row when (new.status = 'open') execute function private.jobs_enforce_limits();
-- Feature gates inside RPCs:  if not private.has_feature(v_org, 'chara_match') then raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'chara_match'; end if;
```

`private.settings.entitlements_enforced` starts as `false`; while it is false no limit or feature gate blocks anything for an organization that has never had a subscription, so the week 1–3 demos work before checkout exists. The lapse rules do not depend on it (OPEN_QUESTIONS.md, C11): a lapsed organization (back on `free_employer` after a cancelled subscription) cannot open or reopen a vacancy (`active_jobs` 0) or invite members (`members` 0), and cannot change application states or add notes (`private.assert_org_writable`); its open vacancies were moved to Paused on lapse (§10.1). Once the setting is true, the same `free_employer` restrictions apply to every organization on that plan, including one that has not yet started a trial. The owner supplied the plan limits and the tier features on 2026-10-02 and they are seeded (§10.1); when the setting is switched to `true` is open (OPEN_QUESTIONS.md, C11; recommended: with the billing work package, and C12 for the one-member limit of the Basic tier). Having it `true` is a go-live checklist item. Per-organization overrides (§10.1) are read by `private.org_limit`. `private.assert_org_writable` was added with the application status changes that call it (U28, migration `20261023100000_application_status_pipeline.sql`); the helpers above exist from U14 (OPEN_QUESTIONS.md, D40). Monthly counters live in `private.usage_counters(organization_id, key, period, count)` maintained by the same triggers. Downgrade behaviour defaults to "keep data, block creation over limit" (see OPEN_QUESTIONS.md, C9).

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

As built for FR-F1 (U41, OPEN_QUESTIONS.md D66, `docs/runbooks/admin-console.md`): the four RPCs above are in `20261101110000_suspension_and_reinstatement.sql`; a suspension of a user queues one `account_ops` job `suspend_user` that signs the user out and sets the ban from the profile status it reads when it runs, a reinstatement queues `reinstate_user`, and a suspension of an organisation queues `sign_out_organization` (members signed out, nobody banned) and the reinstatement of one queues no job. A suspended user is a member of no organisation for the policies and helpers (`private.member_org_ids`), and the policies of `public.jobs` accept insert and update only through `private.active_org_ids`. `publish_legal_document` only inserts the version, audits it and queues one `account_ops` job `fan_out_legal_version`; account-ops then queues the `legal_version` emails through `account_ops_fan_out_legal_version`, a page of at most 1,000 users after the last id it was given, skipping users who already have the email of that version, so the publication does not wait for the users and a job that runs again sends nothing twice.

As built for FR-C7 (U44, `docs/runbooks/vacancy-moderation.md`, migration `20261103110000_vacancy_moderation.sql`): `moderate_job(job_id, 'hide' | 'unhide', reasons)` (`trust_safety` + aal2) locks the vacancy row, moves `moderation_state` between `visible` and `hidden` (an unhide of a vacancy of a suspended organisation goes to `org_suspended`), writes a `moderation_actions` row (`target_type = 'job'`, `job_hidden` or `job_unhidden`) and the audit row `job.hide` or `job.unhide`, and on a hide queues one mandatory `vacancy_hidden` email for each accepted owner and admin; an unhide sends none. `admin_search_jobs` (title, organisation name or id; keyset on `created_at, id`) and `admin_get_job` (the text and the history of one vacancy, no applicant data) feed the pages `admin/moderation` and `admin/moderation/<id>`. An unknown or soft-deleted vacancy raises `CHARA_NOT_FOUND` and a vacancy not in the required state `CHARA_INVALID_STATE`; the reasons follow the limits of every administrative action (10 to 2000 characters, `CHARA_INVALID_INPUT`).

As built for FR-H1 (U50, `docs/runbooks/public-pages.md`, migration `20261104120000_public_settings.sql`): the public group of `app/[lang]/(public)` holds Home, How CHARA Works, Trust & Safety, About, Pricing (FR-H2 below), Contact and Imprint beside Find Jobs, the vacancy page and `legal/[slug]`; its layout gives them one header (the links of `lib/public/navigation.ts`, behind a Menu button below 768 px) and one footer (Imprint and the ten legal pages in three groups), shows Log in and Sign up to a visitor and Go to my area and Log out to a signed-in person (the session is read behind `Suspense`, U57), and has its own error page and not-found page. The legal entity, the privacy contact and the data-protection contact are seven keys of `private.settings` that `public.get_public_settings()` (definer, granted to `anon` and `authenticated`) returns by key and no other key; a read that fails throws to the error page (500). `scripts/check-go-live.mjs` also fails while the name, the address or one of the two contacts is empty.

As built for FR-H2 (U51, no migration): the pricing page renders one card per public employer plan, read on every request from `public.v_plans` through `listPublicPlans` (`lib/dal/pricing.ts`), which is also the source of the plans the billing pages sell, so that the page, the confirmation page and the charged price follow one record. The query, the labels, the links per reader, the KPI and the change procedure are in `docs/runbooks/pricing.md`, the departures in OPEN_QUESTIONS.md D74.

As built for FR-H3 (U52, OPEN_QUESTIONS.md D76, `docs/runbooks/legal-documents.md`, migration `20261106100000_versioned_legal_pages.sql`): `legal_documents.is_draft`; the view `public.v_legal_current`; `publish_legal_document(slug, title, body, change_summary, is_draft)` takes the next version under a lock of the slug (the version check of U41 is gone; an identical repeat of the current version is `CHARA_CONFLICT` detail `unchanged`) and audits the slug, the version and the draft mark; `admin_export_legal_documents(after_slug, after_version, limit)` (administrator at aal2) feeds the download at `/[lang]/admin/legal/export`; `account_ops_fan_out_legal_version` queues the `legal_version` emails only for users whose latest consent for the slug is a grant of an older version. The legal page body is plain text (`lib/public/legal-body.ts`: `## ` lines are headings, blank lines end paragraphs), always escaped.

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
| Audit log | `audit.log` written only by `audit.record()` (Edge Functions go through the service RPC `audit_record_external`); UPDATE/DELETE/TRUNCATE revoked from every role and blocked by triggers that are ENABLE ALWAYS (they also fire under `session_replication_role = replica`); `ip` is the leftmost `x-forwarded-for` entry the database sees, which the client controls, so it is context and not evidence (the console client sends the address its own proxies wrote, `TRUSTED_PROXY_HOPS`); every administrative function writes its row through `private.audit_admin` (reason of 10 to 2000 characters and a request id that is generated when the header is missing; the staff roles through the trigger of `platform_staff`) and pgTAP 085 fails when a function gated on a platform role neither does so nor is on the list of read-only functions; `erase_user` has its narrow exception (the transaction settings `chara.erasure_user` and `chara.erasure_pseudonym`, checked in `audit.refuse_change()`: only the exact replacement of the user id by the pseudonym, in the actor, the entity and the metadata text, and the removal of the actor's address, passes; pgTAP 041) and `private.apply_retention()` has its own (as built in U42, D68: `audit.refuse_change()` lets a DELETE through only while the transaction setting `chara.retention_run` is `on`, which only that function sets, and never an UPDATE or a TRUNCATE; pgTAP 086, 087); row triggers on platform_staff, passport_shares, worker_documents, billing events and, later phase, verifications; monthly export to an immutable bucket outside Supabase (as built in U42: the pg_cron jobs `audit-export-monthly` and, as its retry, `audit-export-monthly-retry` call the Edge Function `audit-export`, which writes the file and its manifest to an S3-compatible bucket with Object Lock, without the address of anybody who is not platform staff, `docs/runbooks/audit-log.md`); retention 6 years (`private.retention_policies`, entity `audit_log`, 2191 days). | pgTAP test |
| Document access log | `audit.document_access_log` written by construction (no row, no URL); worker-visible view; 24-month retention. | pgTAP + Deno test |
| DSAR export / erasure | `request_data_export()` → pgmq → `account-ops` builds JSON + files into `dsar-exports`, signed link (10 min) by email (the service RPC that reads the export data is not specified yet). `request_account_deletion()` sets `profiles.deleted_at` at once (the profile stays active and the candidate keeps their access; document access for others is refused), the cooling-off is the setting `account_deletion_cooling_off_days` (30), `cancel_account_deletion()` ends it until then, and `profiles.legal_hold` (set by a ticketed, audited SQL statement) pauses erasure; the daily job `private.queue_account_erasures()` queues one `erase_user` job per due account in `account_ops` and tells the privacy contact (`private.settings` key `privacy_contact_email`) once about a held one; `account-ops` calls the service RPC `erase_user` (pseudonymises the audit, consent, access log and share rows, deletes passport rows), purges the storage prefix through the Storage API and deletes the auth user (`auth.admin.deleteUser`). Procedures, monthly report and KPI: `docs/runbooks/account-closure.md`. `dsar_requests` tracks the 30-day SLA. | E2E |
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
| Accessibility (WCAG 2.2 AA) | eslint-plugin-jsx-a11y via eslint-config-next, @axe-core/playwright on every screen in the browser tests (`tests/e2e/support/axe.ts`: WCAG 2.2 A and AA, fails on serious or critical), `lang` from root param, logical CSS properties for RTL. | CI |
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
npm run e2e         # Playwright (Chromium) against npm run build + npm run start on :3100 and the running local stack; ends with npm run db:reset (outside CI) because the versions tests publish legal documents that cannot be removed, which would fail the pgTAP files
```

The Supabase CLI is the devDependency `supabase@2.119.0` and is always invoked as `npx supabase`; it is not installed globally. Other commands: `npx supabase functions serve --env-file supabase/functions/.env`, `npx supabase gen types typescript --local`, `npx supabase test new <name> --template pgtap` for a new test file. `apps/web/.env.local` holds the local API URL (`http://127.0.0.1:54421`) and the publishable key printed by `npx supabase status`. Edge Functions need Deno; they are typechecked and tested in the CI `functions` job.

### 14.4 Testing matrix

- Database: pgTAP tests in `supabase/tests/database/*.test.sql`, run with `npx supabase test db` (policies allow/deny/cross-tenant, triggers, `billing_owner` privilege test, `service_role` has no direct table grants, audit immutability, k-anonymity, RLS enabled and forced on every table, forbidden-attribute test over `information_schema.columns`, EXPLAIN plan assertions; later phase: match reasons). `npm run db:lint` (`npx supabase db lint --local --fail-on error`) runs in the CI `db` job.
  Named tests from the SOP review: `document_access_grant` refuses an unselected document and a later upload of a shared type (D18); vacancy and application transition guards accept exactly the rows of the §4 tables; a lapsed organization's open vacancies become Paused and its application writes are refused with `entitlements_enforced` false (C11).
- Edge Functions: `deno test` in `supabase/functions/_tests` with the null provider and a fake fetch (bad signature → 401, duplicate event → 200 no-op, stale event not applied, unknown plan or organization stored with status `error`, `document-url` 401/403/200 and access-log write).
- Billing in Stripe test mode: a test clock drives trial end, a failed payment, the retries and the cancellation after 7 days, and asserts that the status stays `trialing` after the trial starts, `past_due_since`, the `canceled` state from `customer.subscription.deleted` and the fallback to `free_employer` (§10.1).
- Web: Vitest + Testing Library for synchronous components, zod schemas, DTO mappers; proxy unit tests with `next/experimental/testing/server` (`unstable_doesProxyMatch`, `getRedirectUrl`); Playwright E2E against `next build && next start` + local stack (sign-up → confirmation link from the mail catcher API → onboarding worker and employer → dashboards; worker applies with a document → employer downloads it → access log visible; billing with the null provider); @axe-core/playwright on every screen (sign-up, confirmation, onboarding, consent, legal reader, login, recovery, suspended, dashboards); header check for CSP nonce and no `'unsafe-inline'` for scripts.

### 14.5 CI (`.github/workflows/ci.yml`)

Jobs are added as the code they test appears. All jobs use `actions/checkout@v7` and `actions/setup-node@v7` (Node from `.nvmrc`) and run `npm ci`; the Supabase CLI comes from the npm devDependency, not from a separate setup action.

1. `web` (exists): lint, typecheck, unit tests (`npm test`), build.
2. `db` (exists): `npm run db:start` → `npm run db:test` (`npx supabase start`, `npx supabase test db`). Also in the job: `npm run db:lint` (`npx supabase db lint --local --fail-on error`). The type-drift check: `npm run db:types` then `git diff --exit-code` on the committed type file. A `node scripts/gen-ref-seeds.mjs` run followed by `git diff --exit-code -- supabase/seeds/ref` guards the reference seeds against ICU/CLDR drift.
3. `functions` (exists, from U13): Deno setup, then in `supabase/functions`: `deno fmt --check`, `deno lint`, `deno check "*/index.ts"`, `deno test --frozen --allow-env=NODE_ENV` (React reads `NODE_ENV` when the templates load). The `e2e` job installs Deno too, because the browser tests run `account-ops` (`supabase/functions/serve-local.sh`, a webServer of the Playwright configuration) and play the scheduler by calling it.
4. `e2e` (exists): depends on web + db; starts the local stack, installs Chromium and runs `npm run e2e` (Playwright against the built app, `apps/web/.env.example` copied to `.env.local`). The helpers in `apps/web/tests/e2e/support` read the Auth admin key from `E2E_AUTH_ADMIN_KEY` (from `npx supabase status` when unset); the name avoids the strings the `security` job greps for. A failed run uploads `apps/web/test-results` (traces, screenshots) as an artifact. `next start` serves the standalone build with a warning; production runs the standalone server, so the headers check covers the same proxy and `next.config.ts` code, not the server entry point.
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
max_frequency = "60s"      # minimum interval between emails to one address
otp_expiry = 86400         # 24-hour confirmation link; one value shared with recovery links (recovery_link_is_fresh holds those to 1 hour: OPEN_QUESTIONS.md, D22)
[auth.email.template.confirmation]
content_path = "./supabase/templates/confirmation.html"
[auth.email.template.recovery]
content_path = "./supabase/templates/recovery.html"
[auth.email.notification.password_changed]
enabled = true
content_path = "./supabase/templates/password_changed.html"
[auth.sessions]
timebox = "168h"           # sessions end 7 days after login (FR-A3)
[auth.hook.password_verification_attempt]
enabled = true
uri = "pg-functions://postgres/private/hook_password_verification_attempt"
[auth.mfa]
max_enrolled_factors = 2       # primary and backup (FR-A4, D17)
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
[auth.rate_limit]
sign_in_sign_ups = 3000        # shared by every visitor: raised, see below
token_refresh = 5000
email_sent = 3000
token_verifications = 3000
[storage]
file_size_limit = "50MiB"
[storage.buckets.passport-documents]
public = false
file_size_limit = "15MiB"
allowed_mime_types = ["application/pdf", "image/jpeg", "image/png"]
# … verification-evidence, dsar-exports, safety-evidence, org-media
[functions.account-ops]
verify_jwt = true              # the scheduler sends the project's anon key; the function also checks x-edge-secret
[functions.billing-webhook]
verify_jwt = false
[functions.billing-reconcile]
verify_jwt = true              # scheduler shared-secret header, as account-ops
[functions.scan-document]
verify_jwt = false
[functions.notify]
verify_jwt = false            # scheduler shared-secret header; Resend webhook signature
[functions.document-url]
verify_jwt = true
[functions.audit-export]
verify_jwt = true              # scheduler shared-secret header, as account-ops
```

Auth counts requests per IP address and the web tier calls it from its own address, so Auth's limits are shared by every visitor and one actor could exhaust them: `sign_in_sign_ups` (sign-ups and sign-ins), `token_verifications` (every confirmation and recovery link is spent from the web server's address, FR-A1 AC7, FR-A3), `token_refresh` (each active user refreshes once per 30-minute access token, so 150 per 5 minutes carried about 900 concurrently active users before refreshes failed and sessions dropped, which FR-A3 AC2 forbids) and the hourly `email_sent` cap. Two things changed (OPEN_QUESTIONS.md, D20, D29):

- Each visitor is held to its own limits in the web tier before Auth is called. `signUp`, `resendConfirmation`, `signIn`, `requestPasswordReset`, `resetPassword` and the authenticator code check (`answerChallenge`, `verifyEnrolment`; action `mfa_code`) call `isThrottled(action)` (`lib/dal/rate-limit.ts`), which asks the database function `public.rate_limit_attempt(p_action, p_key)` and, when it answers no, returns the existing `Too many attempts. Try again in a few minutes.` without naming the limit. The limits are settings `rate_limit_<action>_max` and `rate_limit_<action>_seconds` in `private.settings` (defaults: sign-up and login 30 per 300 s, resend, forgot_password, reset_password and mfa_code 10 per 300 s) and `rate_limit_buckets` (16384). A fixed window starts with the first attempt of a visitor and lasts the window length; attempts beyond the maximum are counted up to one above it and refused until the window ends.
- The visitor is `HMAC-SHA256(VISITOR_HASH_SECRET, address)` of the client address taken from `X-Forwarded-For` (`lib/visitor-address.ts`). Assumption: the web app runs behind exactly `TRUSTED_PROXY_HOPS` reverse proxies (CDN, load balancer) that each append the address of the connection they accepted, and is not reachable except through them; the entry that many places from the right was written by our infrastructure, everything left of it came from the client and is ignored. The hop count is an environment value (1 to 10, no default, so a wrong guess is never silent) and must match the real chain: too low trusts a forged value, too high yields no address. An IPv6 address counts as its /64 and an IPv4-mapped one as its IPv4 address. A request without a usable address shares one key with every other such request (fail closed). The function stores no key: it reduces the hash to a bucket number (first 32 bits modulo `rate_limit_buckets`), and `private.rate_limit_hits(action, bucket, hits, expires_at)` (unlogged: every attempt writes it and a crash only gives visitors a fresh window) has one row per action and bucket, so the table cannot exceed 5 x 16384 rows however it is called and holds nothing that identifies a visitor; two visitors that share a bucket share a budget (the cost of the bound; raise `rate_limit_buckets` for more traffic, which restarts running windows). The pg_cron job `purge-rate-limit-hits` deletes expired rows every 5 minutes. A caller who reaches the function directly can only add attempts to buckets: it cannot read a count, cannot aim at a visitor (the bucket of a victim's address is not computable without the secret) and cannot add rows; it can still fill buckets at random: (limit + 1) x `rate_limit_buckets` calls per window refuse every visitor (about 180,000 calls per 5 minutes for the 10-attempt actions and about 508,000 for login and sign-up, which one machine can send), so a WAF rate limit on `/rest/v1/rpc/rate_limit_attempt` is a release check and not an option. A failure to count stops the request (an error) rather than skipping the limit. The counting call goes through the cookie-bound server client, so a visitor whose access token has expired is refreshed against Auth just before it, which `proxy.ts` does on every request anyway (`token_refresh` is raised for it). Refused attempts are deliberately not counted or audited, so no caller can grow `audit.log` or any table through this function, and a refusal is delivered as the Server Action result with status 200, as Auth's own 429 already is (D29).

Local values: `[auth.rate_limit]` is raised in `config.toml` to `sign_in_sign_ups = 3000`, `token_refresh = 5000` (about 30,000 concurrently active users at a 30-minute token), `token_verifications = 3000` and `email_sent = 3000`, so that development and the end-to-end tests can send many emails and no single address comes near them. The browser tests play the proxy: `TRUSTED_PROXY_HOPS=1` in `.env.example`, and every test sends its own random `X-Forwarded-For` so tests do not use up one another's budgets. The local Auth container maps `sign_in_sign_ups` to its OTP limit only, so only the per-visitor throttle limits sign-ups and sign-ins locally.

Release check (D20): the hosted project does not read `config.toml`. Before each release (1) set Authentication, Rate Limits in the dashboard (or `npx supabase config push`) to the values above or higher and confirm with `npx supabase config diff`; (2) set `VISITOR_HASH_SECRET` (at least 32 random characters, never the placeholder of `.env.example`, never committed) and `TRUSTED_PROXY_HOPS` in the web host; (3) from outside, send 31 login attempts from one address and see the 31st refused while a login from another address still works, send a request with a forged leading `X-Forwarded-For` entry and see it counted with the real address, and check that two different external addresses produce two different keys (a hop count that is too low maps everyone to the proxy's address); (4) after deploy, watch the web logs for `Visitor address missing from X-Forwarded-For`: it means the hop count exceeds the real proxy chain and all visitors share one budget; (5) put a WAF rate limit on `/rest/v1/rpc/rate_limit_attempt` (see above).

Continue with Google (D31 to D35; U08d). The real Google round trip cannot run on the local stack or in CI, which have no Google client; the browser tests cover everything around it (flag, button, redirect to Auth's authorize URL with PKCE, the callback exchange of a one-time code through the real Auth endpoint, onboarding, refusals). The release check on the hosted project, in this order: (1) Google Cloud Console, APIs and Services, Credentials: create an OAuth client of type Web application; Authorized redirect URIs = `https://<project-ref>.supabase.co/auth/v1/callback` (the Auth callback, not the app); Authorized JavaScript origins = the production origin; the consent screen lists only the scopes `openid`, `email` and `profile`. (2) Supabase, Authentication, Providers, Google: enable it, enter the client ID and secret there (never in the repository, chat or a pull request), leave "Skip nonce checks" off and "Allow users without an email" off. (3) Supabase, Authentication, URL configuration: site URL = the production origin and the allow-list contains exactly `https://<app>/auth/callback`. (4) Authentication, Sign In / Providers: "Allow manual linking" off (`enable_manual_linking = false`). Authentication, Emails: the Reset password template equals `supabase/templates/recovery.html`, and the "A sign-in method was linked" notice is on with `supabase/templates/identity_linked.html`. (5) Web host: set `GOOGLE_SIGN_IN_ENABLED=true`; it is off everywhere else. (6) Checks with test addresses: a new Google address lands on onboarding with no kind, chooses worker, accepts the three documents and the age box, and `select account_kind from profiles` shows `worker` with four `consents` rows; a second Google address chooses employer with three rows; a signed-in Google person cannot choose again (the RPC refuses another kind); a Google address equal to an existing confirmed password account reaches that account (kind and consents unchanged), receives the linked-method email, and the old password still works; pre-registering an unconfirmed password account for an address (kind employer) and then signing in with Google for it leaves the person in the account with the password of the pre-registration no longer accepted, and onboarding lets the person choose worker (the pre-registered kind is replaced, its pending consents dropped) (Auth removes the unconfirmed identity; if the old password still works, switch the button off and report it); a Google account whose address Google reports unverified (a Workspace account without a verified primary address) is refused with the message on the login page; cancelling at Google returns to the login page with the cancelled message; a suspended account cannot sign in with Google; a password attempt for a Google-only address shows the generic message; the reset request for it shows the uniform text and the email says Google users need no password; `auth.users.raw_app_meta_data->>'provider'` is `google` and `auth.identities` has a `google` row. (7) `npx supabase config push` writes `[auth.external.google]` too, which is `enabled = false` with empty secrets in `config.toml`: never run it for the hosted project without `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in the environment and `enabled = true` in the pushed file, or it silently turns the provider off while the web flag still shows the button (the click then lands on the "not available" message). After the provider is enabled, `npx supabase config diff` must show no difference for `[auth.external.google]`; a difference there is the first thing to check when the button stops working. (8) One Google sign-in counts two attempts in the per-visitor `login` bucket (the start and the callback, D35): size `rate_limit_login_max` and the Auth sign-in limit for it. (9) Rotate the client secret in Google Cloud and in the Supabase dashboard together; a secret that leaves the dashboard is replaced the same day.

### 15.2 Exact steps once the Supabase project exists

1. Create the project in Frankfurt (`eu-central-1`) on the Pro plan, with daily backups and point-in-time recovery (decided — OPEN_QUESTIONS.md, O1, O2; PITR is step 11); note the Postgres major version shown under Settings → Infrastructure and set `db.major_version` to it.
2. Settings → JWT keys: create and activate an asymmetric signing key (ES256). Settings → API keys: create the publishable key (for apps/web) and one secret key (for Edge Functions only). Record both in the key-rotation runbook.
3. Authentication → URL configuration: site URL = production origin; redirect allow-list = the exact `https://<app>/auth/callback` URL. Release check (§15.1, OPEN_QUESTIONS.md, D20): the Auth rate limits match `config.toml`, the per-visitor limits work behind the hosted proxy chain, and the 24-hour confirmation lifetime is verified on the hosted project. Authentication → Providers → Google: see the release check of Continue with Google in §15.1. Authentication → Providers → Email: confirmations on, secure password change on, minimum length 12, breached-password protection on. MFA: TOTP on. SMTP: custom SMTP through Resend, EU region (sender domain, DKIM/SPF/DMARC; the settings, the go-live check and the rotation are in `docs/runbooks/account-emails.md`). Mirror every value in `config.toml` (`npx supabase config diff` previews and `npx supabase config push` applies the properties declared in `config.toml` to the linked project; settings it cannot write are set in the dashboard, and `docs/runbooks/deploy.md` is the checklist). The push also carries `[auth.external.google]`: see the warning in the Continue with Google release check (§15.1).
4. Settings → API: exposed schemas `public, graphql_public`; max rows 100.
5. Integrations: enable Cron (pg_cron), Queues (pgmq), and the pg_net and supabase_vault extensions; add Vault secrets `project_url`, `anon_key`, `edge_shared_secret` (the minute jobs `account-ops-run` and `notify-run` and the monthly job `audit-export-monthly` read them through `private.call_edge_function`; `docs/runbooks/platform-staff.md` section 3) and `billing_webhook_secret`.
6. Locally: `npx supabase login`, `npx supabase link --project-ref <ref>` (DB password prompted), `npx supabase db push --dry-run`, then `npx supabase db push` (migrations create roles, schemas, buckets, policies, cron jobs), then `npx supabase db push --include-seed` once for reference data only (never dev fixtures).
7. `npx supabase secrets set --env-file <file>` with an uncommitted file that uses the variable names of `supabase/functions/.env.example` (BILLING_WEBHOOK_SECRET, EDGE_SHARED_SECRET, the Stripe secret key and webhook signing secret, the Resend API key and webhook signing secret, `EMAIL_PROVIDER=resend`, `EMAIL_FROM` and `SITE_URL` for `notify`, the AV key when chosen; names must not start with `SUPABASE_`). In Stripe: register the `billing-webhook` URL as the webhook endpoint for the events in §10.3, enable Stripe Tax and the Customer Portal, and set the subscription retry schedule to cancel the subscription 7 days after the first failed payment (§10.1). In Resend: register the `notify` URL for the `email.delivered`, `email.bounced` and `email.complained` webhooks (`docs/runbooks/transactional-emails.md`).
8. `npx supabase functions deploy --use-api` (no Docker needed; `verify_jwt` per function from `config.toml`).
9. Verify: `select * from cron.job` (including `expire-recovery-tokens`); the hosted Auth password-verification hook runs (D26) and does not re-hash on login; `select * from cron.job` also lists `purge-rate-limit-hits`; `[auth.rate_limit]` `token_refresh`, `sign_in_sign_ups`, `token_verifications` and `email_sent` equal the `config.toml` values and fit the real visitor volume behind the web tier (D20, §15.1 release check); sign up a test account and receive the confirmation email; `document-url` returns a 60-s URL and an access-log row; `billing-webhook` rejects a bad signature with 401 and applies a signed test event (Stripe test mode).
10. GitHub: add `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` to the `production` environment with required reviewers; enable `deploy-supabase.yml` (link → `db push` → `functions deploy --use-api` → `secrets set`). Optionally enable Branching for per-PR preview projects (no production data is copied; migrations, seeds and functions are applied).
11. Enable the PITR add-on (requires Small compute) and schedule the Storage object replication job; record the first restore drill date.
12. Web host (undecided): set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `DEPLOYMENT_VERSION`, and the server-only `VISITOR_HASH_SECRET`, `TRUSTED_PROXY_HOPS` and `GOOGLE_SIGN_IN_ENABLED` (§15.1); build per environment (public vars are inlined at build time); deploy the standalone output or Docker image; put a CDN/WAF in front.
13. Bootstrap the first platform admin with a ticketed SQL insert into `public.platform_staff` (audited; the statement and the record to fill in are in `docs/runbooks/platform-staff.md`), then grant further roles only through `grant_platform_role`.
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
