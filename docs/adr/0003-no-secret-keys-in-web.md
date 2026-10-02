# ADR-0003: No secret keys in the web application

- Status: Accepted
- Date: 2026-10-02

## Context

Supabase issues two kinds of API key: a publishable key, which is safe to expose and leaves every request subject to Row Level Security under the user's session, and a secret key, which bypasses Row Level Security.

Every Next.js Server Action is a request that a browser can trigger. If the web tier held the secret key, a single flawed action, a leaked environment variable or a compromised web instance would expose the whole database. Web hosting is also undecided, so the web tier must not be assumed to be a trusted environment.

## Decision

1. `apps/web` holds only the publishable key. All data access from the web tier runs under the signed-in user's session, so Row Level Security always applies.
2. The secret key exists only as an Edge Function secret.
3. Work that needs privilege, a provider secret or outbound network access is done only in Edge Functions, one capability per function (planned: `document-url`, `billing-checkout`, `billing-webhook`, `notify`, `account-ops`, `scan-document`). Provider webhooks are received by Edge Functions, never by Next.js.
4. Edge Functions reach the database only through RPCs in `public` with `grant execute to service_role` (planned: `billing_ingest_event`, `billing_apply_event`, `audit_record_external`, `document_set_scan_status`, `notify_dequeue` / `notify_ack`, `erase_user`). `service_role` has no direct table grants; a database test is to assert this.
5. CI guards the rule. The `security` job fails if `sb_secret_`, `service_role` or `SUPABASE_SECRET` appears anywhere outside `supabase/`, `docs/` and `.github/`. An ESLint `no-restricted-imports` rule that forbids importing Edge Function code or a secret-key client into `apps/web` is planned.

## Consequences

Benefits:

- A compromised web instance or leaked web environment yields at most the sessions of the users passing through it, never a bypass of Row Level Security.
- The privileged surface is a short, enumerable list of RPCs granted to `service_role`, each of which can be reviewed and tested.

Costs:

- A privileged feature takes more pieces than a server-side call with a secret key: an Edge Function, an RPC, a grant and tests for each.
- Edge Functions are a second runtime (Deno) with their own tests and CI job, added with the first function. Code shared with the web application has to be made available to both runtimes.
- Administrative operations that need the Auth admin API (for example ending a user's sessions) cannot be called from Next.js and must go through an Edge Function.
- The CI guard is a pattern match. It is a backstop, not the control: it does not detect a key stored under another name, and it rejects any legitimate use of those strings outside the excluded paths.
