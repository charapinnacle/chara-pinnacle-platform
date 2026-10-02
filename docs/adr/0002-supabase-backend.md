# ADR-0002: Supabase is the entire backend

- Status: Accepted
- Date: 2026-10-02
- Supersedes: [ADR-0001](0001-express-prisma-backend.md)

## Context

CHARA needs authentication, a multi-tenant relational data model, private document storage, scheduled and queued work, and payment webhooks. Three product invariants must hold regardless of which client calls the backend: workers never pay; paying ≠ verified ≠ boosted; candidate documents are private unless the candidate shares them for a specific application.

The first design (ADR-0001) put a custom API server and an ORM in front of Postgres. Row Level Security, grants, triggers and definer functions depend on exact statement ordering that an ORM schema cannot express, and a separate API server is one more component to build, secure and operate.

## Decision

1. Supabase (EU region) is the whole backend: Auth, Postgres with Row Level Security, Storage, Edge Functions, and `pg_cron` / `pgmq` / `pg_net` for scheduled and queued work. There is no custom API server.
2. Hand-written Supabase CLI SQL migrations in `supabase/migrations/` are the single source of schema truth. They are forward-only and a committed migration is never edited. No ORM is used.
3. TypeScript types are generated with `npx supabase gen types` into `packages/db-types` (created with the first tables), committed, and checked for drift in CI.
4. Postgres is the policy engine. Every exposed table has `ENABLE` and `FORCE ROW LEVEL SECURITY`; grants are default-deny with explicit per-table grants; invariants are constraints and triggers; multi-table writes are `SECURITY DEFINER` RPCs with `set search_path = ''` that re-check `auth.uid()`. The three product invariants are enforced in the database, not in application code.
5. Authorization is decided by lookup at query time (membership and staff tables through helper functions in the `private` schema), never by custom JWT claims. Only `sub` and `aal` are read from the token. Platform roles live in `public.platform_staff`.
6. Logic that needs a secret, outbound network access or a long runtime goes into an Edge Function (ADR-0003). Next.js is a presentation layer only.

## Consequences

Benefits:

- One trust boundary. Any client (web today, mobile later) is subject to the same policies.
- Revoking a membership or role takes effect on the next query; there is no stale-claim window.
- Fewer components to deploy and operate.

Costs:

- Local development needs Docker: `npm run db:start` runs the real Supabase stack (`npx supabase start`). A machine without Docker cannot run the database and relies on the CI `db` job.
- Business rules are written in SQL and PL/pgSQL. They need their own tests (pgTAP files in `supabase/tests/database/`, run with `npx supabase test db`) and reviewers who can read policies and definer functions.
- Lookup-based authorization adds helper-function calls to every policy check. Helpers are `STABLE` and membership columns are indexed to keep this cheap; it is still more work per query than reading a claim.
- Edge Functions run on Deno with platform limits (wall-clock, CPU, memory), so long or CPU-heavy work has to be split or queued.
- The design depends on Supabase services. The stack is self-hostable and migrations are plain SQL, so leaving the hosted service is a hosting change, but Auth, Storage and the Data API would have to be run or replaced.
- The local Postgres major version in `supabase/config.toml` must match the cloud project.
