# Runbook: account emails

FR-I1, design point D65 (OPEN_QUESTIONS.md). The SOP is "Account Email Delivery E2E SOP" (owner Platform / Operations, reviewed quarterly): authentication emails are delivered reliably from a verified domain. Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them. The queue, templates and retries of the emails that `notify` sends are in `docs/runbooks/transactional-emails.md`.

## 1. The four emails and the path each one takes

| Email | Sent by | Template and subject | Trigger |
|---|---|---|---|
| Confirmation | Supabase Auth, through the custom SMTP of the provider | `supabase/templates/confirmation.html`, subject in `[auth.email.template.confirmation]` of `config.toml` | Sign-up, and the resend of the link |
| Password reset | Supabase Auth, through the custom SMTP | `supabase/templates/recovery.html`, `[auth.email.template.recovery]` | `/forgot-password` |
| Team invitation | `notify`, through the Resend API | `apps/web/emails/templates/member-invitation.tsx` | `invite_member` queues kind `member_invitation` |
| Two-step verification reset notice | `notify`, through the Resend API | `apps/web/emails/templates/mfa-reset.tsx` | `reset_mfa` queues kind `mfa_reset` |

Auth also sends two notices that FR-A3 and FR-A1 added (`password_changed`, `identity_linked`); they use the same SMTP and the same checks.

The confirmation and reset links open `/en/confirm-email` and `/en/reset-password` with `token_hash`: a page with a button spends the single-use token, so a mail scanner that opens the link does not use it up. The invitation link is `/en/invitations/<token>`; the token is in the email only (and in the row for as long as the email is queued).

Auth emails are not stored in the database. Their delivery is read in the Resend dashboard (section 4).

## 2. Set up (SOP step 1)

1. Resend, EU region: add the sending domain and publish the DNS records Resend shows (SPF, DKIM) plus a DMARC record (`_dmarc.<domain>` TXT, start with `p=none` and a `rua` address, move to `quarantine` when the reports are clean). Wait until Resend shows the domain as verified.
2. Create two API keys with sending access limited to that domain: one for Auth (the SMTP password) and one for `notify` (`RESEND_API_KEY`). Two keys so that a rotation or a revocation of one path leaves the other working and each path's sending is visible on its own.
3. Supabase dashboard, Authentication, Emails, SMTP Settings (these are not in `config.toml`: the local stack and CI would then send through the provider): host `smtp.resend.com`, port `465`, user `resend`, password the Auth key, sender email `no-reply@<domain>`, sender name `CHARA`. Set `EMAIL_FROM` of `notify` to a different address of the domain (for example `CHARA <notifications@<domain>>`): `notify` ignores delivery events of any other sender, which is how the events of the Auth emails (same Resend account, same webhook) are kept out of its lookup.
4. Authentication, Emails, Templates: the subjects and bodies equal `config.toml` and `supabase/templates` (`npx supabase config diff` shows differences; `npx supabase config push` applies them, see ARCHITECTURE.md section 15.2 step 3). Authentication, Providers, Email: confirmations on, secure password change on, minimum length 12, breached-password protection on, minimum interval between emails 60 seconds.
5. Resend webhooks: register the `notify` URL for `email.delivered`, `email.bounced` and `email.complained` (transactional-emails.md section 2).

## 3. Go-live check of the sending domain and the wording (AC12)

Run it before go-live and again after each change of wording, the domain or the SMTP settings. Platform and Operations do it together; record the result, the date and the reviewer in the go-live checklist (`docs/runbooks/deploy.md` when it exists) with these lines:

| Check | How | Result, date, reviewer |
|---|---|---|
| SPF, DKIM and DMARC published | `dig TXT <domain>`, the DKIM selector Resend shows, `_dmarc.<domain>`; Resend shows the domain Verified | |
| A test confirmation reaches an external mailbox | Sign up with an address at a public mail provider; the email arrives in the inbox (not spam) from `CHARA <no-reply@<domain>>` | |
| A test invitation reaches an external mailbox | Invite that address from a test organization; the email arrives and the link opens the invitation page | |
| Reset and two-step notice | Request a reset; check that the reset email arrives. The notice is checked in the Resend dashboard after a staff reset of a test user (never on a real account) | |
| Wording of the four templates | Each is English only, names CHARA, carries one link and says what to do if the email was not requested. `apps/web/tests/unit/account-email-wording.test.ts` checks this on every change; a person reads the final text as well | |

The wording is reviewed by Platform and Operations; legal review of the tone is outside the repository.

## 4. Monitor (weekly) and the KPIs

Delivery rate and bounce rate are the KPIs of the SOP.

- Auth emails: Resend dashboard, Emails, filter by the sender `no-reply@<domain>`, last 7 days: delivered, bounced and complained as shares of sent. Record them in the weekly review. This is the only record of these emails; the database does not hold them.
- `notify` emails of this requirement (`member_invitation`, `mfa_reset`):

```sql
select kind,
       count(*) filter (where status = 'sent') as sent,
       count(*) filter (where delivery = 'delivered')::numeric / nullif(count(*) filter (where status = 'sent'), 0) as delivery_rate,
       count(*) filter (where delivery in ('bounced_transient', 'bounced_permanent'))::numeric
         / nullif(count(*) filter (where status = 'sent'), 0) as bounce_rate,
       count(*) filter (where delivery = 'complained') as complaints,
       count(*) filter (where status = 'failed') as failed
from public.notifications
where kind in ('member_invitation', 'mfa_reset') and created_at > now() - interval '7 days'
group by kind;
```

  The delivery events arrive some seconds to hours after the send, so the rate of the last hours is not final. A bounce of an invitation does not mark an address undeliverable (the invitee has no user row); the inviter learns of it when the person does not answer, and invites again.
- One address receiving invitations from several organisations (accepted risk, D65): the only limit on invitation emails is per organisation, so look for an invitee address that many organisations mail. A re-invitation by the same organisation replaces its earlier row, so repeats from one organisation show only in the per-recipient view of the Resend dashboard.

```sql
select email, count(distinct organization_id) as organisations, count(*) as invitations
from public.organization_invitations
where created_at > now() - interval '7 days'
group by email
having count(distinct organization_id) > 3
order by organisations desc;
```

- Act on it: a bounce rate above 2 % or any complaint is looked at the same day (wrong sender address, domain reputation, a mistyped invitation address); a failing SMTP connection shows as `500 unexpected_failure` on sign-up in the Auth logs and as the form message "We could not send the confirmation email" (nobody is registered by such a call, so there is nothing to repair afterwards).

## 5. Rotate the provider credentials (SOP step Rotate; AC13)

At the interval of the key-rotation runbook (`docs/runbooks/key-rotation.md` when the hardening unit adds it; until then at least once a year and whenever a person with access leaves).

1. In Resend create the two new keys (Auth, `notify`); do not revoke the old ones yet.
2. Supabase dashboard, Authentication, SMTP Settings: replace the password with the new Auth key and save. Sign up a test account and check that the confirmation email arrives.
3. `npx supabase secrets set RESEND_API_KEY=<new key>` (an uncommitted file or the shell, never the repository), then wait for the next minute run of `notify`. Queue a test: invite a test address from a test organization and check that the email arrives (the Resend dashboard shows it sent with the new key).
4. Revoke the old keys in Resend. Check that a second test of each path still delivers.
5. Record the date, the person and the result of both tests in the rotation log. The webhook signing secret (`RESEND_WEBHOOK_SECRET`) is separate: rotate it with Resend's rotation of the signing secret and `supabase secrets set`; Svix accepts both signatures during the change.

## 6. Local stack and tests

The local stack sends the Auth emails to the mail catcher (port 54424) from `CHARA <no-reply@chara.test>` (`[local_smtp]` in `config.toml`); `notify` hands its emails to the same catcher with `EMAIL_PROVIDER=null`. The browser tests `account-emails.spec.ts` (confirmation, reset, used links, minimum interval) and `member-invitation-email.spec.ts` (invitation) run against it; sending through a real Resend account, the DNS records and delivery to an external mailbox are checked only by the go-live check above.
