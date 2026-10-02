# CHARA — Development Handoff (Phase 1, Foundation & MVP)

> **Corrections (2026-10-02).** This file is kept as written for reference; where it disagrees with `docs/ARCHITECTURE.md`, the architecture document is current.
>
> - §3: the working branch and commit `4912058` described there never existed on the remote. The repository was scaffolded from scratch; there was no `apps/api`, Prisma schema or `docker-compose.yml` to delete.
> - §3, §7: work happens on `feat/…`, `fix/…` and `chore/…` branches, one pull request each into `main`.
> - §4: describes a Docker-less Linux session. Local development uses the real Supabase stack in Docker (`npm run db:start`); the plain-Postgres shim and `scripts/db/*.sh` were not built. Database tests are pgTAP files run with `npx supabase test db`.
> - §4: Node version is the one in `.nvmrc` (24). Local ports are 54420–54424 for Supabase and 3100 for the web app.
> - §7 WP3: "migration 0001" is delivered as several small migrations, one per pull request.
> - §10: the Word/Excel documents and the spec PDFs are not committed while the repository is public; they live locally in `docs/phase-1/client/` and `docs/spec/`.
> - Tool-specific session notes (§11 and two lines of §3) were removed from this copy.

Read this first. It contains everything a new session needs to start building: what CHARA is, what has been decided, the exact state of the repository, the environment quirks, the week-1 work packages, and where every document lives.

---

## 1. The product in five lines

- **CHARA** is a global workforce network connecting **workers, employers, recruitment companies and staffing companies**. Not a job board: the flow is **Search → Match → Connect → Collaborate**.
- Source spec: `docs/spec/CHARA_Website_Content_and_Structure.pdf` (36 sections) and `docs/spec/CHARA_Recommended_Pricing.pdf` — both already committed in the repo.
- **Phase 1 (one month)** builds only the candidate ↔ employer loop: public website, candidate & employer accounts, vacancies, applications with a journey tracker, employer applicant management (ATS core), platform admin, Stripe subscriptions, legal pages, email.
- Later phases (schema must stay ready, do not build now): recruitment/staffing accounts, workforce requirements & job orders, multi-partner invitations, CHARA Match, corridors & network map, verification badges & fees, boosts, messaging, Find Workers.
- Three invariants that must hold **in the database**, not in app code: **workers never pay**; **paying ≠ verified ≠ boosted**; **candidate documents are private unless the candidate shares them for a specific application**.

## 2. Decisions already made by the owner (do not re-open)

| Decision | Value |
|---|---|
| Backend | **Supabase only** (Auth, Postgres + RLS, Storage, Edge Functions, pg_cron/pgmq/pg_net). **No custom API server.** |
| Frontend | **Next.js 16** (`apps/web`, App Router, TypeScript, Tailwind 4). Hosting undecided → keep portable (`output: 'standalone'`, no vendor-specific features). |
| Supabase project | Owner is creating it in the **EU (Frankfurt recommended)**; not available yet. Develop locally; deploy later with `supabase link` + `db push` + `functions deploy --use-api`. |
| Payments | **Stripe** (Checkout, Customer Portal, Tax, webhooks) behind a provider-neutral adapter. |
| Email | **Resend, EU region**: Supabase custom SMTP for auth emails; Resend API from the `notify` Edge Function for transactional emails (React Email templates). |
| Phase 1 account kinds | **Candidate (worker) and employer only.** |
| Schema tooling | **Supabase CLI SQL migrations** are the single source of truth. **Prisma and the Express API are to be deleted.** Generated types via `supabase gen types` into `packages/db-types`. |
| Language | English only in Phase 1, but routing is `app/[lang]` from day one; logical CSS for RTL readiness. |
| Pricing | Employer Starter **€39** (flagged: one place in the pricing doc says €49), Professional €79; Recruitment €49/€99/€199+; Staffing €59/€129/€249+ (later phases). Plans, limits, features are **rows**, not code. Limits are **not enforced** (`entitlements_enforced=false`) until the owner supplies numbers. |

## 3. Repository state

- Repo: `charapinnacle/chara-pinnacle-platform` (GitHub).
- Branch for all work: an earlier working branch (see Corrections). Base: `main` (contains only `.gitignore`).
- Latest commit on the branch: **`4912058` "chore: set up CHARA project skeleton"** — an **earlier design** (Express 5 + Prisma 6 in `apps/api`, Next.js placeholder in `apps/web`, CI, docs). It was superseded by the Supabase-only decision. **Keep `apps/web`, CI, docs and spec PDFs; delete `apps/api`, Prisma and `docker-compose.yml`** (work package WP1).
- `apps/api/prisma/schema.prisma` is still useful as the **entity source** (25 models) when writing SQL migrations — read it, then delete it.
- `apps/web/AGENTS.md` says: this is Next.js 16, APIs differ from training data — **read `node_modules/next/dist/docs/` before writing Next-specific code** (proxy.ts replaces middleware; `cookies()` is async; `revalidateTag(tag, 'max')`; `next/root-params` only in Server Components; `unstable_cache` is superseded by `use cache`).

## 4. Environment facts (cloud session)

- Node 22, npm 10; **no Docker**; PostgreSQL 16 binaries at `/usr/lib/postgresql/16/bin` (= `pg_config --bindir`), **not on PATH**; session runs as **root**, so `initdb`/`postgres` must run via `runuser -u postgres --` with a postgres-owned data dir (e.g. `/var/tmp/chara-pg`, port 54329, `--auth-local=trust`). Local contrib extensions available: pgcrypto, pg_trgm, unaccent, citext, btree_gin, uuid-ossp. **Not available locally:** pg_cron, pg_net, pgmq, supabase_vault, pgtap → guard them in migrations and stub them in the shim.
- Supabase CLI: `npm i -D supabase@2.119.0` (npx downloads the binary). `@supabase/supabase-js@2.117.2`, `@supabase/ssr@0.12.7`. Supabase Cloud creates projects on **Postgres 17**; local is 16 → keep SQL to the common subset.
- GitHub Actions has Docker → CI runs the **real** `supabase start` stack; locally we use a plain-Postgres **shim** (`supabase/tests/shim/00_supabase_shim.sql`: roles anon/authenticated/service_role, `auth.uid()/jwt()`, `auth.users`, `storage.objects` + helpers, no-op `pgmq/net/cron/vault` stubs, `chara.env='shim'`).
- LibreOffice is broken in this environment (cannot render docx previews). matplotlib and openpyxl were pip-installed for diagrams/spreadsheets.
- **Never commit secrets.** `.env*` ignored; only `.env.example` with public values. CI should grep for `sb_secret_|service_role|SUPABASE_SECRET` outside `supabase/functions`.

## 5. Architecture in one page (full text: `ARCHITECTURE.md` in this bundle → becomes `docs/ARCHITECTURE.md`)

1. Two tiers: Supabase (EU) is the whole backend; Next.js is a thin, portable presentation layer that holds **only the publishable key** (ADR-0003). The secret key lives only in Edge Function secrets.
2. Postgres is the policy engine: every exposed table `ENABLE` + `FORCE ROW LEVEL SECURITY`; default-deny grants (`alter default privileges for role postgres in schema public revoke …` + per-table GRANTs with column lists); invariants as constraints/triggers; multi-table writes as `SECURITY DEFINER` RPCs with `set search_path = ''` that re-check `auth.uid()`.
3. Schemas: `public` (exposed, `max_rows=100`), `private` (helpers/settings), `billing` (owner `billing_owner`, not exposed), `audit` (append-only), `stats` (MVs). `api.schemas=["public","graphql_public"]`.
4. Authorization by **lookup**, never JWT claims (immediate revocation). Membership policies: `organization_id in (select private.member_org_ids('role'))`. Helpers are `STABLE SECURITY DEFINER` with EXECUTE granted to `authenticated` (policies run as the querying role). Only `sub` and `aal` are read from the JWT. Platform roles in `public.platform_staff`, never on profiles.
5. Edge Functions reach the DB only through **public RPCs with `grant execute to service_role`** (`billing_ingest_event`, `billing_apply_event`, `audit_record_external`, `document_set_scan_status`, `notify_dequeue/ack`, `erase_user`). `billing` tables get `to billing_owner using (true) with check (true)` policies (BYPASSRLS is not inherited). Test: service_role has no direct table grants.
6. Accounts: `profiles.account_kind` (worker|company) set once; trigger forbids workers in `organization_members`; checkout RPC rejects workers. One owner per org (partial unique index). TOTP MFA (aal2) mandatory for owners/admins/staff via `as restrictive` policies + DAL `requireAal2()`.
7. Documents: private buckets (`passport-documents`, `verification-evidence`, `dsar-exports`, `safety-evidence`, `org-media`), owner-only policies, metadata-row-first INSERT. Third-party access only via Edge Function `document-url` → RPC `document_access_grant()` → 60-second signed URL + `audit.document_access_log` row the worker can read. No ID numbers, no DOB, no nationality/religion/gender/marital status columns (CI grep).
8. Session/CSP: documented `@supabase/ssr` pattern (`proxy.ts` `updateSession` with `getClaims()`); strict nonce CSP (`'strict-dynamic'`) ⇒ dynamic rendering, `cacheComponents` off (ADR-0004); Postgres MVs are the cache. ES256 JWT, `jwt_expiry 1800`.
9. Billing: `BillingProvider` adapter (Stripe + null/HMAC provider for dev/CI); idempotent `billing.provider_events`; `billing.plans/plan_limits/plan_features` seeded; `free_*` fallback plans; unknown plan code ⇒ deny; `billing.customers` has `billing_country`, `vat_id`, `legal_address`; orders carry tax fields.
10. Matching (later phase) stays rule-based with `reasons jsonb not null` (ADR-0005). Stats via k-anonymised views (threshold 5). Realtime = Broadcast on private channels only.
11. Jobs can be posted by any company type (`posted_on_behalf_of_organization_id`); `job_applications` with states applied|viewed|shortlisted|interview|offer|hired|rejected|withdrawn, `application_events` append-only, unique partial index per (job, worker) where status <> 'withdrawn'.
12. Seeds split: `supabase/seeds/ref/*.sql` (reference data, plans, legal docs; in `config.toml sql_paths`) vs `supabase/seeds/dev/*.sql` (synthetic fixtures; never production). Edge Function tests in `supabase/functions/_tests` (a `tests/` dir would deploy as a function). `supabase/functions/deno.json` import map.

## 6. Target repository layout (Phase 1)

```
package.json (workspaces apps/*, packages/*; scripts db:local db:apply db:test db:types db:reset seed:gen supabase:*)
apps/web/            Next.js 16: proxy.ts, instrumentation.ts, app/[lang]/{(public),(auth),(app),(admin)}, lib/{env,supabase,dal,actions,i18n}, components, emails, tests
packages/db-types/   generated types (committed; CI drift check)
packages/shared/     zod schemas, enums, application stage machine, limit/feature keys
packages/ref-data/   ISO 3166/639/4217, ISCO-08, ISIC JSON + generate-seeds.ts
supabase/            config.toml, migrations/, seeds/{ref,dev}, functions/{_shared,_tests,document-url,billing-checkout,billing-webhook,notify,account-ops}, tests/{shim,sql}
scripts/db/          local-pg.sh apply.sh test.sh gen-types.sh reset.sh guard-secrets.sh
docs/                ARCHITECTURE.md COMPLIANCE.md DATA_CLASSIFICATION.md THREAT_MODEL.md OPEN_QUESTIONS.md adr/ runbooks/ phase-1/ spec/
.github/workflows/   ci.yml (web · db · functions · e2e · security), deploy-supabase.yml
```

## 7. Work packages and order (4 weeks; details in `CHARA - Phase 1 Order of Execution.docx`)

| WP | Week | Scope | Exit criterion |
|---|---|---|---|
| WP1 | 1 | Delete `apps/api`, Prisma, docker-compose; add packages; ADR-0002…0005; rewrite README/ARCHITECTURE.md | lint/typecheck/build green; `git grep -i prisma` only in ADRs |
| WP2 | 1 | `supabase/config.toml`, shim, `scripts/db/*`, CI db/functions/security jobs | `npm run db:local && db:apply` boots PG16 on :54329; `select auth.uid()` works with `set_config('request.jwt.claims', …)` |
| WP3 | 1 | Migration 0001: extensions (guarded), schemas, roles, default-deny, `private.settings`, reference tables, `audit.log`, profiles + `handle_new_user` trigger, platform_staff, organizations/members/invitations, consents, legal_documents, **billing core** (plans/limits/features/subscriptions + entitlement helpers + `free_*` plans), RPCs (`create_organization`, `invite_member`, `accept_invitation`, `remove_member`, `transfer_ownership`, `grant_platform_role`, `accept_consents`), seeds, typegen, SQL tests | All policy/invariant tests pass locally and in CI; ≥249 countries; no type drift |
| WP4 | 1 | Web base: env, Supabase clients, proxy (session + nonce CSP + locale), layout, design primitives, auth pages, onboarding (candidate/employer), MFA, team invites; Resend SMTP | Demo 1: both account kinds register, confirm, log in, MFA, invite |
| WP5 | 2 | Migration 0002: worker passport tables, documents, shares, access log, storage buckets/policies; `document-url` + `scan-document` stub; profile pages | Owner-only storage; grant denied without share; access log visible |
| WP6 | 2 | Migration 0003 (jobs part): jobs, saved_jobs, `search_jobs`; employer job CRUD; public Find Jobs + job page; public pages; legal pages from `legal_documents`; sitemap/robots/JobPosting | Demo 2 |
| WP7 | 3 | Migration 0003 (applications): job_applications, application_events, notes, RPCs (`apply_to_job`, `withdraw_application`, `set_application_status`, bulk); candidate apply + journey tracker; employer ATS; Migration 0005: moderation_actions, notifications, pgmq, stats MVs; `notify` Edge Function; admin console | Demo 3 |
| WP8 | 4 | Migration 0004 billing products/customers/orders/provider_events; `billing-checkout` + `billing-webhook` (Stripe adapter); billing page; e2e (Playwright), axe, k6 smoke, security review, restore drill; staging deploy; runbooks; UAT | Final review on staging in Stripe test mode |

**Start with WP1.** Commit per work package; push after WP1 and at each week end. Every commit message references FR-xx / WP ids.

## 8. Requirements and SOPs

- `requirements.js` (in this bundle) is the **machine-readable catalogue**: 51 FRs (groups A–I) and 21 NFRs. Use the same IDs in migrations, tests, commits and PRs.
- `sops.json` holds one SOP per FR (purpose, scope, owner, inputs, steps, outputs, KPIs, risks/controls, review frequency).
- Place both under `docs/phase-1/` in the repo together with the Word/Excel documents.

## 9. Open questions (data decides, not code — do not block on these)

Employer price €39 vs €49 · plan limits & feature matrix · verification tier→badge mapping, refunds, two-person rule · free-month rules (card, auto-convert, once per entity) · boost catalogue · job-order definition & who creates them · worker approval of partner submissions · who starts conversations · recruitment↔recruitment connections · one account kind per person (assumed yes) · worker search anonymity & photos · MFA scope for members · retention periods · Supabase region (Frankfurt vs Ireland), Pro + PITR, staging project · EU email provider (Resend assumed) · AV vendor · launch languages/RTL · web hosting (must be EU) · first platform admins · legal entity, DPO, launch corridors, placement licence. Full list: `docs/OPEN_QUESTIONS.md` (update it in WP1) and `CHARA - Decisions Required (Planning Phase).docx`.

## 10. Documents in this bundle (copy to `docs/phase-1/` in WP1)

| File | Purpose |
|---|---|
| `HANDOFF.md` | This file |
| `ARCHITECTURE.md` | Full synthesized architecture (becomes `docs/ARCHITECTURE.md`; fix per §5 where it differs) |
| `requirements.js`, `sops.json` | Requirement catalogue and SOP data |
| `CHARA - Phase 1 Requirements Specification (FR-NFR).docx` | ISO/IEC/IEEE 29148 SRS |
| `CHARA - Phase 1 Order of Execution.docx` | ISO 21502 / 12207 schedule, WPs, risks |
| `CHARA - Phase 1 System Architecture Description.docx` | ISO/IEC/IEEE 42010 |
| `CHARA - Phase 1 System Design Description.docx` | ISO/IEC/IEEE 1016, incl. traceability matrix |
| `CHARA - Phase 1 Standard Operating Procedures.docx/.xlsx` | 51 SOPs (ISO 9001/10013) |
| `CHARA - Phase 1 Planning Document.docx` | Client-facing plan |
| `CHARA - Decisions Required (Planning Phase).docx` | Client-facing open questions |
| `diagrams/*.png` | All diagrams used in the documents |

