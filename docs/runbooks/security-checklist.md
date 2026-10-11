# Runbook: security release checklist

NFR-S2, NFR-S4, NFR-S6, NFR-S7, NFR-C1, NFR-C3; findings SA-01 to SA-20 of the whole-product security review; design point D79 (OPEN_QUESTIONS.md). Section 1 is what the code does since D79, section 2 is the automated gate, section 3 the settings that only a person with access to the hosted project and the web host can make, in the order they must be done. Platform and Operations run it before go-live and after any change to Auth, the web host or the Supabase plan; record the date, the person and the result of each item in the go-live checklist.

## 1. Controls in the code (no action, for reference)

What each control does is in D79 of `OPEN_QUESTIONS.md` and the header of its migration; the tests are:

| Finding | Test |
|---|---|
| SA-02 | pgTAP `014`, `071`, `098`; Vitest `visitor-address`, `rate-limit-dal`, `go-live-check` |
| SA-04 | pgTAP `099` and the owner and admin cases of `050` to `092` |
| SA-06 | pgTAP `100`; Vitest `documents-actions`, `jobs-actions`, `applicant-review-dal`, `applicant-review-action`; Playwright `documents-upload` |
| SA-08 | Vitest `go-live-check` |
| SA-12 | pgTAP `103` |
| SA-13 | pgTAP `102`, `104` |
| SA-14 | pgTAP `101` |
| SA-18 | review of `.github/` |

Change a quota or a period with a ticketed `update private.settings ...` or `update private.retention_policies ...`. How often the quotas are hit is the count of the web log lines `{"alert":"quota_refused",...}` (item 7); the database rolls a refusal back with its count.

## 2. The automated gate

Export the three files from production as the database owner and run the gate; it exits non-zero and names every failure: entitlements off, a sold plan not mirrored at Stripe, an empty legal-entity detail, no active platform administrator, no published legal document, a current legal document that is still a draft, or no Vault secret `rate_limit_proof_key` (item 10). `--allow-draft-legal` lets draft texts pass (and still prints them) for a launch that counsel has not cleared; it changes nothing else. Delete the files afterwards.

```sh
psql "$PRODUCTION_DATABASE_URL" -Atc "select jsonb_object_agg(key, value) from private.settings" > settings.json
DATABASE_URL="$PRODUCTION_DATABASE_URL" STRIPE_SECRET_KEY=... node scripts/sync-stripe-plans.mjs --export > plans.json
psql "$PRODUCTION_DATABASE_URL" -Atc "select jsonb_build_object(
  'active_administrators', (select count(*) from public.platform_staff s join public.profiles p on p.id = s.user_id
                            where s.role = 'admin' and s.revoked_at is null and p.status = 'active'),
  'rate_limit_proof_key_set', exists (select 1 from vault.secrets where name = 'rate_limit_proof_key'),
  'current_legal_documents', (select coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'version', c.version, 'is_draft', c.is_draft) order by c.slug), '[]')
                              from public.v_legal_current c))" > release.json
npm run go-live:check -- settings.json plans.json release.json
```

`platform-staff.md` asks for at least two named administrators before go-live (O6); the gate fails only at zero, so check the second by hand.

## 3. Settings made by hand, in priority order

Each item names the place in the Supabase dashboard (project `fikxmfveggwjoqzgzuke` for production) or on the web host, the exact value, and how to confirm it.

1. **SA-03 Leaked-password protection** (high, NFR-S6, FR-A1). Authentication → Attack Protection (older dashboards: Authentication → Providers → Email): turn on "Prevent use of leaked passwords" (needs the Pro plan). In the same place keep "Minimum password length" at 12 and "Password requirements" at "No required characters" (`config.toml`). Confirm: the security advisor no longer lists `auth_leaked_password_protection`, and a sign-up with the password `Password1234` is refused with "This password has appeared in a data breach" (the app maps the `pwned` reason).
2. **SA-01 Auth rate limits** (high, D20). Authentication → Rate Limits, values of `config.toml` `[auth.rate_limit]`: "Rate limit for sending emails" 3000 per hour (needs custom SMTP, item 3), "Rate limit for token refreshes" 5000, "Rate limit for sign ups and sign ins" 3000, "Rate limit for token verifications" 3000 (per 5 minutes and IP address), anonymous users 30, SMS 30, Web3 30. They are high because the web tier calls Auth from its own address and counts each visitor itself (`rate_limit_attempt`); Auth is still reachable directly with the public key, so lower them as soon as the web host forwards the client address to Auth, and confirm after every change that a burst of 31 sign-in attempts through the site is refused while another visitor still signs in.
3. **SMTP** (high, FR-I1, FR-A1). Authentication → Emails → SMTP Settings: enable custom SMTP, host `smtp.resend.com`, port 465, user `resend`, password = a Resend API key with sending rights only for the CHARA domain, sender address `no-reply@<domain>`, sender name `CHARA`; the domain has SPF, DKIM and DMARC records verified in Resend. Authentication → Emails → Templates: the five templates of `supabase/templates` (`account-emails.md` section 1). Confirm: a sign-up on production receives the confirmation from that sender within a minute.
4. **SA-01 CAPTCHA** (high). Not to be switched on yet: Auth then refuses every sign-up, sign-in and recovery that does not carry a CAPTCHA token, and the forms do not send one. Prerequisite (a follow-up unit with an approved widget and a CSP change for its script): Cloudflare Turnstile site key in the web tier, token passed as `options.captchaToken` from the sign-up, login and recovery forms. Then Authentication → Attack Protection → "Enable Captcha protection", provider Turnstile, secret key from Cloudflare. Confirm: a direct `POST /auth/v1/token?grant_type=password` without a token answers 400 `captcha_failed`.
5. **SA-02 WAF rule** (medium). On the CDN or WAF in front of Supabase or the web host (host undecided, O3): at most 60 requests per minute per client address to `POST /rest/v1/rpc/rate_limit_attempt`, `POST /rest/v1/rpc/submit_report` and the report form (every accepted report stores a row and an audit row: D82), to the sign-in, sign-up and recovery pages of the web host, and to `POST /auth/v1/token`, `/auth/v1/signup`, `/auth/v1/recover` and `/auth/v1/otp`. With the proof key (item 10) only the web tier can count an attempt; what is left is a client with more than about 180,000 networks (IPv4 addresses or IPv6 /64) that spends the cap of new visitors and fills the shared buckets through the web tier within one window, which only this rule stops.
6. **SA-05 Malware scanning** (medium, FR-B2, O4). Choose the vendor (O4); until then documents stay `skipped` after the signature check and are served download-only. When chosen: set its key with `npx supabase secrets set`, have `scan-document` write `clean` or `rejected` from its answer only, and add the vendor to the records of processing.
7. **SA-07 Alert routing** (medium, NFR-O1). Every Edge Function alert is one JSON log line with the key `alert`; `private.security_events` holds the database alerts. Project Settings → Log Drains: add the drain of the chosen log platform (EU region); on that platform create a rule on `alert` (any value) and on `event_message` containing `"alert"` that notifies the operations address (this includes the web host's logs, where `quota_refused` lines record each refused quota of SA-06; count them by `quota` and `flow` per day for the quota KPI), and a daily query of `select kind, count(*) from private.security_events where created_at > now() - interval '1 day' group by kind`. Write the incident runbook (GDPR 72-hour checklist) and `SECURITY.md` before go-live (ARCHITECTURE.md section 12).
8. **Session and MFA** (FR-A3, FR-A4). Authentication → Sessions: JWT expiry 1800 seconds; Authentication → Multi-Factor: TOTP enabled (enroll and verify), phone off. Authentication → URL Configuration: site URL = production origin, redirect list = exactly `https://<app>/auth/callback`.
9. **SA-12 pg_net queue** (low). The tables `net.http_request_queue` and `net._http_response` belong to `supabase_admin` and grant everything to PUBLIC; the project's `postgres` role holds no grant option, so a migration cannot revoke it, nor the USAGE that `anon` and `authenticated` hold on the schema `net` ("no privileges could be revoked" for both, tried in D79; pgTAP `103` fails when either changes, and then a migration should revoke them). Keep `net` out of the Data API: Project Settings → Data API → Exposed schemas = `public`, `graphql_public` only (Vitest `auth-config`), and rotate `edge_shared_secret` on the schedule of `platform-staff.md` section 3.
10. **Web host secrets** (SA-08, SA-02). `VISITOR_HASH_SECRET` (32 characters or more, never reused) and, in the database, the Vault secret derived from it: `VISITOR_HASH_SECRET=... node -e 'console.log(require("node:crypto").createHmac("sha256", process.env.VISITOR_HASH_SECRET).update("rate_limit_attempt").digest("hex"))'`, then `select vault.create_secret('<that value>', 'rate_limit_proof_key');` (with a new `VISITOR_HASH_SECRET`, `vault.update_secret` in the same minute as the deploy; in between sign-ins answer with an error). Confirm: a sign-in through the site works, and `select * from public.rate_limit_attempt('login', repeat('a', 64))` as `anon` fails with `CHARA_FORBIDDEN`. Further: `TRUSTED_PROXY_HOPS` = the number of proxies that append to `X-Forwarded-For` (check with a request from a known address, `audit-log.md` section 1), `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (given to the build, `deploy.md` section 6); Edge Function secrets `EDGE_SHARED_SECRET`, `BILLING_PROVIDER=stripe`, `EMAIL_PROVIDER=resend`. Confirm with `npx supabase secrets list` (names only).
11. **Advisors** (weekly). Advisors → Security Advisor: the only expected warnings are `anon_security_definer_function_executable` for the seven public functions, `authenticated_security_definer_function_executable` and `extension_in_public` for `pg_net` (SA-20); anything else is a ticket.

## 4. Decisions recorded with D79

- The document access log keeps 24 months (G-07): FR-B5 AC9, the SOP, L6 and ARCHITECTURE.md section 12 say so; NFR-C3's six years apply to `audit.log`, which keeps 2191 days. The period is the row `document_access_log` of `private.retention_policies`.
- Inactive candidates (L6 default, 24 months): the row `inactive_worker_data` (730 days). The rule writes a deletion request (audit `account.deletion_requested` with `reason` `inactivity`) and sends no email, because the `deletion_requested` text says the candidate asked; a notice for this case needs wording from CHARA. The account-closure runbook's queries count these requests with the others; tell them apart by the reason.
