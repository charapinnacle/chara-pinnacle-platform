# Runbook: deploy

NFR-O2 (repeatable deployment from version control, forward-only migrations, an approver for production), NFR-S2 (the secret key never reaches the web tier), ARCHITECTURE.md section 15.2; unit U55 (D80). This is the order for every environment, staging first (O9), then production (`fikxmfveggwjoqzgzuke`, Frankfurt). Each step names the exact command; values in angle brackets come from the password manager and are never written into the repository, a ticket or a chat. Every command runs from the root of a clean checkout of the release tag, never from another working directory (security review SA-17: the Edge Functions on production were once deployed from a different folder).

Before step 1: CI is green on the release commit of `main` (web with the bundle budget, db, functions, e2e with the smoke journeys and the performance project, security), the release checklist (`release-checklist.md`) has no open P0 item for this environment, and the approver has signed the release record. The signed record is the approval of NFR-O2 until a deploy workflow with a protected production environment exists (ARCHITECTURE.md section 15.2 step 10; OPEN_QUESTIONS.md D80); the deployer and the approver are two different people. Tag the commit: `git tag -a v<yyyy.mm.dd> -m "<summary>" && git push origin v<yyyy.mm.dd>`.

The CLI is the pinned devDependency, always `npx supabase` (2.119.0). It needs `SUPABASE_ACCESS_TOKEN` in the environment (a personal access token of the deployer) and asks for the database password where a command reaches the database.

## 1. Database migrations

```sh
npx supabase link --project-ref <project-ref>
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push --include-seed
```

- `migration list` must show the same version in the Local and Remote columns for every migration already applied. The production history does not yet: its migrations were applied through the dashboard connector with apply-time versions (SA-17). Repair it once, before the first `db push`, for each row where only Remote has a version and the name matches a local file: `npx supabase migration repair --status reverted <remote version>` then `npx supabase migration repair --status applied <local version>`; repeat until `migration list` pairs every row. Repairing writes only the history table, never the schema.
- `db push --dry-run` must print exactly the migrations of this release, in filename order. Anything else stops the deployment.
- `--include-seed` applies `supabase/seeds/ref/*.sql` (reference data, plans, legal document drafts) on every deployment of every hosted environment, not only the first: the files are idempotent (`on conflict`), the CLI runs a file again only when its content changed, and a seed that gained a row later (the legal document `sharing-notice`) otherwise never reaches an older environment (OPEN_QUESTIONS.md D89).
- Then, in the SQL editor as `postgres`: `select * from private.missing_reference_data();` must return no rows. Each row names a legal document without a published version, an empty reference table, a missing setting (one that a function reads by its literal key, a list limit of a passport trigger, or a throttle setting; the legal entity details are checked by the go-live gate) or the missing Vault secret `rate_limit_proof_key`; while one is listed the features that need it fail with `CHARA_SETTING_MISSING` (applications without `sharing-notice`), or, for the secret, a direct call of the Data API skips the visitor proof and can mail every registered address (`notify_existing_account`). Apply the seed, insert the setting or create the secret (`security-checklist.md` item 10, section 4 below), and run the check again before step 2.
- A release that adds a notification kind (D89: `account_exists`) deploys `notify` (section 2) before this push: a message of a kind the running `notify` does not know is marked failed with `unknown_kind` and never retried, while the new template is inert until a row of its kind exists.
- Migrations are forward-only and must work with the web build that is still running until step 6 (add columns and functions first, remove them in a later release).
- After the push: Advisors, Security Advisor lists only the warnings of `security-checklist.md` item 11.

## 2. Edge Functions

```sh
npx supabase functions deploy --project-ref <project-ref> --use-api
npx supabase functions list --project-ref <project-ref>
```

`--use-api` bundles on the platform (no Docker). With no name it deploys all eight folders of `supabase/functions` (`account-ops`, `audit-export`, `billing-checkout`, `billing-reconcile`, `billing-webhook`, `document-url`, `notify`, `scan-document`) with `verify_jwt` from `config.toml`; one function is `npx supabase functions deploy <name> --project-ref <project-ref> --use-api`. Never pass `--no-verify-jwt`: the three functions without a JWT check (`billing-webhook`, `notify`, `scan-document`) have it off in `config.toml`, and every other one must keep it. `functions list` shows each function with a version one higher than before.

Check that each one starts: `curl -s -w " %{http_code}\n" -X POST https://<project-ref>.supabase.co/functions/v1/<name> -H "Authorization: Bearer <anon key>"` answers with a JSON error of the function itself and a 4xx status (401 `unauthorized` without the shared secret, the user token or the signature, or 400 `bad_request` for an empty body), which shows the bundle runs; a 5xx or `BOOT_ERROR` means the bundle failed. `notify` imports the email templates from `apps/web/emails`, outside `supabase/functions`: its first deployment from this command must be checked this way before the first email is queued.

## 3. Function secrets

```sh
npx supabase secrets set --project-ref <project-ref> --env-file <uncommitted file>
npx supabase secrets list --project-ref <project-ref>
```

The file uses the names of `supabase/functions/.env.example`: `EDGE_SHARED_SECRET`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, `SITE_URL`, `BILLING_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the `AUDIT_ARCHIVE_*` values (`audit-log.md` section 5); `BILLING_WEBHOOK_SECRET` and `MAIL_CATCHER_URL` are for the local stack only. `SUPABASE_URL` and the service key are provided by the platform and cannot be set. `secrets list` shows names and digests only. Delete the file after use. Then, in Stripe, the webhook endpoint `https://<project-ref>.supabase.co/functions/v1/billing-webhook` (`webhook-processing.md`); in Resend, the event webhook to `.../functions/v1/notify` (`transactional-emails.md`).

## 4. Vault

In the SQL editor of the project, as `postgres` (first deployment, or after a rotation):

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<anon key>', 'anon_key');
select vault.create_secret('<EDGE_SHARED_SECRET value>', 'edge_shared_secret');
select vault.create_secret('<proof key derived from VISITOR_HASH_SECRET>', 'rate_limit_proof_key');
select name from vault.secrets order by name;
```

The last query lists exactly these four names. The first three let the pg_cron jobs call the functions (`platform-staff.md` section 3); the proof key and how it is derived are in `security-checklist.md` item 10. A changed value is `select vault.update_secret((select id from vault.secrets where name = '<name>'), '<new value>');` in the same minute as the matching function secret or web host secret.

## 5. Auth settings

`npx supabase config diff --project-ref <project-ref>` shows how the project differs from `config.toml`. Never run `npx supabase config push` against production while `config.toml` holds the local values (`site_url = "http://localhost:3100"`, the local redirect, Google disabled with empty secrets): set these in the dashboard instead, in this order, with the exact values of `security-checklist.md` section 3: leaked-password protection, minimum length 12 (item 1); Auth rate limits (item 2); custom SMTP through Resend and the four templates of `supabase/templates` (`confirmation`, `recovery`, `password_changed`, `identity_linked`) (item 3, `account-emails.md` section 2); JWT expiry 1800 s, TOTP on, phone off, site URL = the production origin, redirect list = exactly `https://<app>/auth/callback` (item 8); exposed schemas `public, graphql_public`, max rows 100 (item 9); Continue with Google only when it is switched on (ARCHITECTURE.md section 15.1).

## 6. Web host

The host is not chosen yet (O3); the application is a standalone Node.js server and needs nothing specific to a host (NFR-M2). Build once per environment, because the three public values are inlined at build time:

```sh
npm ci
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key> \
NEXT_PUBLIC_SITE_URL=https://<app> \
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=<key of the environment> \
DEPLOYMENT_VERSION=$(git describe --tags) \
npm run build
cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -R apps/web/public/. apps/web/.next/standalone/apps/web/public/
```

`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (base64 of 32 random bytes, kept per environment in the password manager) is embedded in the build output, so it is given to the build, never only to the running server; every build of an environment uses the same key, otherwise a form opened before a switch or served by another instance fails with "Failed to find Server Action". The standalone server copies neither `public` nor `.next/static`, hence the two `cp` lines. Ship `apps/web/.next/standalone` (it contains `apps/web/server.js`, the traced `node_modules` and the two copied folders) and start it with `PORT=<port> HOSTNAME=0.0.0.0 node apps/web/server.js`. Runtime environment of the server, never `NEXT_PUBLIC_`: `VISITOR_HASH_SECRET` (32 characters or more), `TRUSTED_PROXY_HOPS` (the number of proxies that append to `X-Forwarded-For`), `GOOGLE_SIGN_IN_ENABLED` (`false` unless step 5 enabled Google); leave `DOCUMENT_URL_ENDPOINT` and `BILLING_CHECKOUT_ENDPOINT` unset. No Supabase secret key is ever set on the web host (ADR 0003); the CI `security` job fails if one appears in the code.

Check after the switch: `curl -s https://<app>/api/health` returns the `buildId` of this tag; `curl -sI https://<app>/brand/cp-monogram-128.webp` answers 200 (the logo of every page, from `public`); `curl -sI https://<app>/en` carries `Strict-Transport-Security`, a `Content-Security-Policy` with a nonce and `'strict-dynamic'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` (the assertions of `accessibility-sweep.spec.ts` through `tests/e2e/support/security-headers.ts`); `curl -sI https://<app>/en/passport` also carries `X-Robots-Tag: noindex, nofollow`; a test candidate signs in and opens the dashboard.

## 7. DNS and email

- The application domain points at the web host (the record the host names); HTTPS works on the domain and every subdomain before the first visitor, because the application sends `Strict-Transport-Security` with `includeSubDomains; preload` from the first response. Submit the domain to the HSTS preload list only once every subdomain serves HTTPS permanently.
- The sending domain of Resend carries the SPF, DKIM and DMARC records that Resend shows, verified in Resend before step 5's SMTP settings (`account-emails.md` sections 2 and 3). Check: a sign-up on the environment receives the confirmation from `no-reply@<domain>` within a minute and the message passes SPF, DKIM and DMARC in its headers.

## 8. Rollback

- Web: start the previous tag's standalone build again (keep the last two builds of each environment); `/api/health` shows the old `buildId`. Because migrations are additive (step 1), the old build works with the new schema.
- Edge Functions: `git switch --detach <previous tag> && npx supabase functions deploy <name> --project-ref <project-ref> --use-api`, then back to the release tag.
- Secrets: set the previous value from the password manager with `npx supabase secrets set` (and `vault.update_secret` for a Vault value) in the same minute.
- Database: never edit or revert a migration that ran. A wrong migration is corrected by a new one released through steps 1 to 6. Data that a migration destroyed is recovered by point-in-time recovery (`backup-and-restore.md` section 3), which rewinds every table and is the last resort.
- Record what was rolled back, why and when in the release record; a rollback of production is followed by the same release on staging before it is tried again.
