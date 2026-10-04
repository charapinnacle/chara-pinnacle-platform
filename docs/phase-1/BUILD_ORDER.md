# Phase 1 build order

The order in which the SOPs and their supporting infrastructure are implemented. One pull request per unit; a unit may cover several tightly coupled SOPs, and infrastructure units (marked `infra`) carry no SOP of their own. Progress is read from merged pull requests: every title ends with the unit id, for example `feat(FR-A1): candidate registration [U07]`.

## Rules for every unit

- Branch `feat/<slug>`, `fix/<slug>` or `chore/<slug>` from an up-to-date `main`; one logical change; commits authored by the repository owner account; no mention of AI tools in commits, branches, pull requests or files.
- Requirements and SOPs: the SOP text (`sops.json`, `CHARA - Phase 1 Standard Operating Procedures.xlsx`) is the business intent; `docs/ARCHITECTURE.md` wins on technical detail. Design points D2–D18 in `docs/OPEN_QUESTIONS.md` are adopted for implementation (2026-10-03); other open items use the default stated there. Departures are written in the pull request.
- Database: Supabase CLI migrations only, never edited once merged; every table has RLS enabled and forced, at least one policy (or no API grants), and an index on every column used in a policy; views use `security_invoker`; every function sets `search_path = ''`; types regenerated with `npm run db:types`.
- Tests: pgTAP in `supabase/tests/database/*.test.sql` for every rule, including negative cross-tenant and wrong-role cases; Vitest for pure logic; Playwright for every user flow (a real browser click-through). A unit is done only when `npm run lint`, `typecheck`, `build`, `db:test` and its own tests pass.
- Pull request body: what, requirement/SOP coverage, tests run with results, departures from the SOP or design, what was not verified.
- Merge after CI is green, with a merge commit.

## Approved dependencies (2026-10-03)

Web: `@supabase/supabase-js@2.117.2`, `@supabase/ssr@0.12.7`, `zod`, `server-only`, `react-hook-form`, `@hookform/resolvers`, and the shadcn/ui set (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`, `radix-ui`). Tests: `vitest`, `@playwright/test` (Chromium), `@axe-core/playwright` (dev only, approved 2026-10-04 for U08c). Email (from U37): `resend`, `@react-email/components`. Tooling on the developer machine: the Deno CLI for Edge Function tests. Anything else needs approval first.

## Local environment

Supabase stack: `npm run db:start` (API 54421, database 54422, Studio 54423, mail catcher 54424, Mailpit API at `http://127.0.0.1:54424/api/v1`); web dev server on port 3100. Hosted project values live only in the gitignored `apps/web/.env.hosted.local`.

## Units

| ID | Branch | Delivers | Needs |
|---|---|---|---|
| U01 | `feat/db-foundation` | infra: schemas, default-deny grants, settings, audit log (FR-F2 table), RLS meta-test, forbidden-attribute test, `db lint` in CI | — |
| U02 | `feat/db-reference-data` | infra: countries, languages, currencies, industries, seeds, `packages/db-types`, type-drift check in CI | U01 |
| U03 | `feat/web-base` | infra: env validation, Supabase clients, `proxy.ts` (session, nonce CSP, locale), `.env.example`, Vitest | U01 |
| U04 | `feat/web-ui-primitives` | infra: shadcn/ui, layout shell, tokens, accessibility basics | U03 |
| U05 | `chore/e2e-harness` | infra: Playwright, Mailpit and TOTP helpers, CI `e2e` job, built-server security header check (NFR-S5; U03 covers headers() and proxy() in unit tests only) | U04 |
| U06 | `feat/db-profiles-consents` | infra: profiles, `platform_staff` (three roles), `legal_documents`, consents, `set_account_kind`, `accept_consents` | U01, U02 |
| U07 | `feat/candidate-registration` | FR-A1, FR-A6, FR-A8, FR-A9 | U03–U06 |
| U08 | `feat/login-logout-recovery` | FR-A3 | U07 |
| U08b | `feat/auth-rate-limits` | infra: per-visitor throttling for sign-up, login and recovery in the web tier, raised Auth limits (closes D20) | U08 |
| U08c | `chore/e2e-accessibility-checks` | infra: axe accessibility checks in the browser tests on every screen (D27, NFR-U1) | U08b |
| U08d | `feat/google-sign-in` | FR-A1, FR-A3, FR-A6, FR-A8, FR-A9: Continue with Google for workers and employers (D28, D31 to D35) | U08c |
| U09 | `feat/db-organizations` | infra: organizations, members, invitations, member RPCs | U06 |
| U10 | `feat/employer-registration` | FR-A2 | U08, U09 |
| U11 | `feat/two-step-verification` | FR-A4 | U08 |
| U12 | `feat/team-membership` | FR-A5; the page guard `requireOrgRole` (FR-A4 AC3), the two-step ownership transfer with its aal2 gate (FR-A4 AC5), the status column in the team list (FR-A4 AC12) | U10, U11 |
| U13 | `feat/platform-staff-roles` | FR-A7, `account-ops` function (reads the queue `account_ops` that `reset_mfa` fills and deletes the factors, FR-A4 AC10), CI `functions` job | U06, U11 |
| U14 | `feat/plans-as-data` | FR-G1: schema `billing`, role `billing_owner` (`grant billing_owner to postgres`), plans, limits, features, subscriptions, entitlement helpers; NFR-S3 tests (`billing_owner` has no privilege on verification tables); a restrictive aal2 policy on the billing views (FR-A4 AC5); replaces `private.legal_entity_trial_used` and `private.legal_entity_locked` (U10 placeholders, OPEN_QUESTIONS.md D36) with lookups of the new tables (U45 adds `billing.customers` to them) and adds the index on `organizations.legal_entity_identifier` | U09 |
| U15 | `feat/candidate-profile` | FR-B1 | U08, U02 |
| U16 | `feat/document-upload` | FR-B2 | U15 |
| U17 | `feat/privacy-by-default` | FR-B3 | U16 |
| U18 | `feat/profile-completeness` | FR-B4 | U16 |
| U19 | `feat/document-access-log` | FR-B5 | U17 |
| U20 | `feat/account-closure` | FR-B6 | U19 |
| U21 | `feat/create-vacancy` | FR-C1 (occupations, jobs) | U12, U14 |
| U22 | `feat/vacancy-lifecycle` | FR-C2 | U21 |
| U23 | `feat/plan-limits` | FR-C6 | U22, U14 |
| U24 | `feat/public-vacancy-search` | FR-C3 | U22 |
| U25 | `feat/vacancy-page` | FR-C4 | U24 |
| U26 | `feat/saved-vacancies` | FR-C5 | U25 |
| U27 | `feat/apply-to-vacancy` | FR-D1, FR-D7 | U17, U25 |
| U28 | `feat/application-status-pipeline` | FR-D2 | U27 |
| U29 | `feat/journey-tracker` | FR-D3 | U28 |
| U30 | `feat/withdraw-application` | FR-D4 | U28 |
| U31 | `feat/application-visibility` | FR-D5 | U28 |
| U32 | `feat/applicant-list-pipeline` | FR-E1 | U28 |
| U33 | `feat/applicant-detail` | FR-E2 | U32 |
| U34 | `feat/bulk-actions` | FR-E3 | U32 |
| U35 | `feat/shortlist` | FR-E4 | U32 |
| U36 | `feat/employer-dashboard` | FR-E5 | U32 |
| U37 | `feat/transactional-emails` | FR-I2: `notify` function, queue, templates, Resend and null providers | U13 |
| U38 | `feat/application-notifications` | FR-D6 | U37, U28 |
| U39 | `feat/email-preferences` | FR-I3 | U37 |
| U40 | `feat/account-emails` | FR-I1 | U37 |
| U41 | `feat/admin-console` | FR-F1; replaces the heading-only `/admin` page of FR-A4 and shows the MFA status of `list_platform_staff` (FR-A4 AC4, AC12) | U13 |
| U42 | `feat/audited-actions` | FR-F2 | U41 |
| U43 | `feat/no-staff-document-access` | FR-F3 | U19, U41 |
| U44 | `feat/vacancy-moderation` | FR-C7 | U41, U37 |
| U45 | `feat/checkout-and-portal` | FR-G2: `billing-checkout`, Stripe and null providers; the owner control for `set_legal_entity_identifier` and the re-evaluation at checkout of audit rows whose `legal_entity_trial_used` is null (OPEN_QUESTIONS.md D36) | U14, U37 |
| U46 | `feat/webhook-processing` | FR-G3 | U45 |
| U47 | `feat/subscription-states` | FR-G4 | U46 |
| U48 | `feat/billing-page` | FR-G5 | U47 |
| U49 | `feat/workers-never-pay` | FR-G6 | U45 |
| U50 | `feat/public-pages` | FR-H1 | U04 |
| U51 | `feat/pricing-from-data` | FR-H2 | U14, U50 |
| U52 | `feat/versioned-legal-pages` | FR-H3 | U41, U50 |
| U53 | `feat/live-statistics` | FR-H4 | U22, U27 |
| U54 | `feat/search-engine-readiness` | FR-H5 | U25, U50 |
| U55 | `chore/nfr-hardening` | NFR checks: headers, accessibility, performance smoke, backup and restore runbook | all |

Items that need a live account (Stripe, Resend sending, the hosted Supabase project) are built against the null provider and the local stack and marked as not verified against the live service in their pull requests.
