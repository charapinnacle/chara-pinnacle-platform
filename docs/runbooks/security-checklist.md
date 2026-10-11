# Runbook: security release checklist

NFR-S2, NFR-S4, NFR-S6, NFR-S7, NFR-C1, NFR-C3; findings SA-01 to SA-20 of the whole-product security review; design point D79 (OPEN_QUESTIONS.md). Section 1 is what the code does since D79, section 2 is the automated gate, section 3 the settings that only a person with access to the hosted project and the web host can make, in the order they must be done. Platform and Operations run it before go-live and after any change to Auth, the web host or the Supabase plan; record the date, the person and the result of each item in the go-live checklist.

## 1. Controls in the code (no action, for reference)

| Finding | Control | Test |
|---|---|---|
| SA-02 | `rate_limit_attempt` counts each visitor in a counter of its own (31 bits of the keyed address hash), caps the new counters of an action per window (`rate_limit_visitor_keys_max`, 20,000) and beyond the cap counts new visitors in the 16,384 shared buckets for the rest of the window. A direct caller fills only keys it made up. Moving the call behind a server-only role was not possible: the web tier holds only the publishable key (ADR 0003). | pgTAP `014`, `098` |
| SA-04 | Owners and administrators at aal1 get no applicant rows (policies through `private.active_member_org_ids`) and `CHARA_FORBIDDEN` / `aal2_required` from the applicant, document, export, stage and note functions; plain members keep aal1 access. | pgTAP `099` |
| SA-06 | At most `worker_documents_max` (50) live documents per candidate; daily quotas on documents, vacancies and notes (`rate_limit_audited_write_max` 500 per user, `rate_limit_org_audited_write_max` 2,000 per organisation, window 86,400 s). Staff, billing and scheduled work are not counted. | pgTAP `100`, Vitest `documents-actions`, Playwright `documents-upload` |
| SA-08 | `npm run go-live:check` (section 2). | Vitest `go-live-check` |
| SA-13 | Retention rows for invitations, deleted documents, login failures, scheduler history and dead letters. | pgTAP `102` |
| SA-14 | Abandoned account-ops jobs are dead letters with their message; reconciliation queries in `platform-staff.md` section 3. | pgTAP `101` |
| SA-18 | Actions pinned by commit, Dependabot for npm and Actions. | review of `.github/` |

Change a quota with a ticketed `update private.settings set value = '...' where key = '...'`; the counters are rows of `private.rate_limit_hits` (`keys:<action>`, `shared:<action>`, `user:audited_write`, `user:org_audited_write`).

## 2. The automated gate

Export the three files from production as the database owner and run the gate; it exits non-zero and names every failure: entitlements off, a sold plan not mirrored at Stripe, an empty legal-entity detail, no active platform administrator, no published legal document, or a current legal document that is still a draft. `--allow-draft-legal` lets draft texts pass (and still prints them) for a launch that counsel has not cleared; it changes nothing else. Delete the files afterwards.

```sh
psql "$PRODUCTION_DATABASE_URL" -Atc "select jsonb_object_agg(key, value) from private.settings" > settings.json
DATABASE_URL="$PRODUCTION_DATABASE_URL" STRIPE_SECRET_KEY=... node scripts/sync-stripe-plans.mjs --export > plans.json
psql "$PRODUCTION_DATABASE_URL" -Atc "select jsonb_build_object(
  'active_administrators', (select count(*) from public.platform_staff s join public.profiles p on p.id = s.user_id
                            where s.role = 'admin' and s.revoked_at is null and p.status = 'active'),
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
5. **SA-02 WAF rule** (medium). On the CDN or WAF in front of Supabase or the web host (host undecided, O3): at most 60 requests per minute per client address to `POST /rest/v1/rpc/rate_limit_attempt`, and the same for `POST /auth/v1/token`, `/auth/v1/signup`, `/auth/v1/recover` and `/auth/v1/otp`. The database cap of section 1 bounds the damage without it.
6. **SA-05 Malware scanning** (medium, FR-B2, O4). Choose the vendor (O4); until then documents stay `skipped` after the signature check and are served download-only. When chosen: set its key with `npx supabase secrets set`, have `scan-document` write `clean` or `rejected` from its answer only, and add the vendor to the records of processing.
7. **SA-07 Alert routing** (medium, NFR-O1). Every Edge Function alert is one JSON log line with the key `alert`; `private.security_events` holds the database alerts. Project Settings → Log Drains: add the drain of the chosen log platform (EU region); on that platform create a rule on `alert` (any value) and on `event_message` containing `"alert"` that notifies the operations address, and a daily query of `select kind, count(*) from private.security_events where created_at > now() - interval '1 day' group by kind`. Write the incident runbook (GDPR 72-hour checklist) and `SECURITY.md` before go-live (ARCHITECTURE.md section 12).
8. **Session and MFA** (FR-A3, FR-A4). Authentication → Sessions: JWT expiry 1800 seconds; Authentication → Multi-Factor: TOTP enabled (enroll and verify), phone off. Authentication → URL Configuration: site URL = production origin, redirect list = exactly `https://<app>/auth/callback`.
9. **SA-12 pg_net queue** (low). The tables `net.http_request_queue` and `net._http_response` belong to `supabase_admin` and grant everything to PUBLIC; the project's `postgres` role holds no grant option, so a migration cannot revoke it (tried in D79; pgTAP `103` fails when that changes, and then a migration should revoke it). Keep `net` out of the Data API: Project Settings → Data API → Exposed schemas = `public`, `graphql_public` only (Vitest `auth-config`), and rotate `edge_shared_secret` on the schedule of `platform-staff.md` section 3.
10. **Web host secrets** (SA-08). `VISITOR_HASH_SECRET` (32 characters or more, never reused), `TRUSTED_PROXY_HOPS` = the number of proxies that append to `X-Forwarded-For` (check with a request from a known address, `audit-log.md` section 1), `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`; Edge Function secrets `EDGE_SHARED_SECRET`, `BILLING_PROVIDER=stripe`, `EMAIL_PROVIDER=resend`. Confirm with `npx supabase secrets list` (names only).
11. **Advisors** (weekly). Advisors → Security Advisor: the only expected warnings are `anon_security_definer_function_executable` for the seven public functions, `authenticated_security_definer_function_executable` and `extension_in_public` for `pg_net` (SA-20); anything else is a ticket.

## 4. Decisions recorded with D79

- The document access log keeps 24 months (G-07): FR-B5 AC9, the SOP, L6 and ARCHITECTURE.md section 12 say so; NFR-C3's six years apply to `audit.log`, which keeps 2191 days. The period is the row `document_access_log` of `private.retention_policies`.
- No retention rule yet for the applications and notes of candidates who stay inactive (L6): CHARA has to say what makes a candidate inactive and how long an employer keeps a hiring record.
