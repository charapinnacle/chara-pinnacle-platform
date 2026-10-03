# Group I: Notifications

## FR-I1 · Account emails

> Confirmation, password reset, invitation and two-step recovery emails are sent through the configured email provider.

### Acceptance criteria

**AC1 · Confirmation email on sign-up** (browser test (Playwright))

- Given an anonymous visitor on /en/signup with an unused address and a password of 12 characters, on the local stack with the mail catcher (port 54424)
- When the visitor submits the sign-up form with valid input
- Then exactly one email reaches the catcher within 60 seconds, addressed to that address, from the configured sender, in English, with a link to /auth/confirm carrying token_hash and type=signup; logging in before the link is opened is refused; opening the link confirms the address and the user can log in

**AC2 · Password reset email and new password** (browser test (Playwright))

- Given a confirmed user on /en/forgot-password
- When the user submits the registered address, then opens the emailed link and sets a new password of 12 characters
- Then exactly one email with a link to /auth/confirm (type=recovery) reaches the catcher within 60 seconds; after the new password is saved the user can log in with it and the old password is refused

**AC3 · No account enumeration on reset** (browser test (Playwright))

- Given one address with an account and one address without
- When each is submitted on /en/forgot-password
- Then both submissions show the same neutral confirmation text and return the same HTTP status; an email reaches the catcher only for the address that has an account

**AC4 · Used links are refused** (browser test (Playwright))

- Given a confirmation link and a recovery link that were each already opened once
- When each link is opened a second time
- Then the user sees an invalid-or-expired message with a way to request a new link; no session is created, the password is unchanged and the account stays confirmed

**AC5 · Minimum interval between auth emails** (browser test (Playwright))

- Given a reset email was requested for an address less than 60 seconds ago (Auth minimum interval between emails to one address, Supabase default, tuned after launch)
- When the same address is submitted again inside that interval
- Then no second email reaches the catcher and the form shows a message asking the user to wait before requesting another

**AC6 · Invitation is queued with a single-use token** (database test (pgTAP))

- Given an owner at aal2 of an organisation whose plan allows another member (Professional, 1 of 5 members), with limit enforcement on
- When the owner calls invite_member for New.Member@Example.com with role member, then notify_ack records the message as sent
- Then organization_invitations holds one row with the address (case-insensitive), role member, accepted_at null, only token_hash (never the raw token) and expires_at = creation time + 7 days; one audit row exists; one member_invitation notifications row (status queued) and one pgmq message exist; the payload holds organisation name, role, expiry date and the link token only while queued and no longer contains the token once status is sent

**AC7 · Invitation email opens the accept flow** (browser test (Playwright))

- Given the invitation of AC6 delivered to the mail catcher by notify with the local non-live provider
- When the invitee opens the emailed link, logs in with a company account of the invited address and accepts
- Then the invitee becomes a member with role member; opening the same link again shows a used-or-expired message and creates no second membership

**AC8 · Two-step verification reset notice is queued** (database test (pgTAP))

- Given a Platform Administrator (role admin) at aal2 and another user with digest = true whose authenticator device is lost
- When the administrator calls reset_mfa(user_id, reason) with a non-empty reason
- Then one audit row with the reason, one account-ops job and exactly one mfa_reset notifications row (status queued, one pgmq message) for the affected user exist; the digest setting does not delay it

**AC9 · Unauthorised calls queue nothing** (database test (pgTAP))

- Given Callers that must be refused: for invite_member a member, an owner at aal1, an admin of another organisation, a request for role owner, and an owner of a Professional organisation already at 5 members with limit enforcement on; for reset_mfa a trust_safety user, a verification_reviewer, an admin targeting oneself, an admin at aal1, and an empty reason
- When each caller calls the RPC
- Then every call is refused with a permission or limit error, and no organization_invitations row, no notifications row, no pgmq message and no account-ops job is created

**AC10 · Invitation and reset-notice templates** (unit test (Vitest))

- Given the member_invitation and mfa_reset templates rendered with sample payloads
- When the rendered text is inspected
- Then both are English and name the platform; member_invitation shows the organisation name, the role, the 7-day expiry and one link to the invitation page; mfa_reset says the factors were removed and the user must enrol again, and contains no code, secret or link that skips two-step verification; both tell the reader what to do if the email was not expected

**AC11 · Sign-up shows an error when the confirmation email cannot be sent** (unit test (Vitest))

- Given Supabase Auth returns an email-sending error for the sign-up call
- When the sign-up server action handles the response
- Then the form state shows a plain-language error with a retry action, keeps the entered email, clears the password field, does not redirect to verify-email and exposes no provider name or stack trace; the server log holds no password

**AC12 · Go-live check of sending domain and wording** (manual check)

- Given the production sending domain, the Resend EU account and the four templates (confirmation, reset, invitation, two-step reset notice)
- When Platform and Operations run the check before go-live and again after each wording change
- Then SPF, DKIM and DMARC records are published and Resend shows the domain verified; a test confirmation email reaches an external mailbox; each template is English only, names the platform and states what to do if the email was not requested; result, date and reviewer are recorded in the go-live checklist

**AC13 · Weekly monitoring and credential rotation** (manual check)

- Given the weekly review and the key-rotation runbook
- When an operator reviews delivery and rotates the Resend credentials
- Then the review records delivery rate and bounce rate (and complaints) for the week; after rotation the Auth SMTP password and the notify API key are both replaced, a test email is delivered through each path, and the old credentials are revoked

### Data and validation

- email: valid address, case-insensitive (citext), required for every account email
- password (sign-up and reset): minimum 12 characters, breached-password protection on; never logged and never stored in notifications.payload
- organization_invitations.email: valid address, required; role: admin or member (owner only through transfer_ownership)
- organization_invitations.token_hash: hash only, raw token never stored; expires_at: creation time + 7 days; accepted_at: null until accepted
- notifications.kind: member_invitation or mfa_reset for the two emails queued by this requirement; payload: organisation name, role, expiry date, link token (member_invitation only, removed once sent)
- proposed: notifications.recipient_email: address of an invitee who has no profile yet; notifications.user_id is then null
- reset_mfa.reason: required, non-empty text

### States and transitions

- Invitation pending -> accepted (invitee, matching address, company account, before expires_at, single use)
- Invitation pending -> expired (system, when expires_at passes)
- Notification queued -> sent (notify, provider accepted)
- Notification queued -> failed (notify, retries exhausted)
- Notification queued -> suppressed (notify, recipient marked undeliverable)

### Roles and permissions

- Anonymous visitor: may request a sign-up confirmation and a reset email for any address; the reply never shows whether an account exists; may not read any notification row
- Organisation owner and admin (aal2): may invite members, which queues member_invitation; member: may not invite
- Platform Administrator (admin + aal2): may call reset_mfa on another user, never on oneself, which queues mfa_reset
- trust_safety and verification_reviewer: may not call reset_mfa
- service_role: may only dequeue and acknowledge notifications through notify_dequeue and notify_ack

### Objects

- Supabase Auth custom SMTP through Resend (EU region); [auth.email] and the SMTP settings in supabase/config.toml
- pages: app/[lang]/(auth)/signup, forgot-password, verify-email; routes app/auth/confirm/route.ts, app/auth/callback/route.ts
- proposed: page app/[lang]/(auth)/reset-password (set new password after the recovery link)
- proposed: page for the invitation link (accept_invitation)
- public.organization_invitations (email, role, token_hash, expires_at, accepted_at); public.organization_members
- public.notifications; pgmq notification queue
- RPCs: invite_member, accept_invitation, reset_mfa, notify_dequeue, notify_ack
- Edge Functions: notify, account-ops
- React Email templates in apps/web/emails (member_invitation, mfa_reset)
- audit.log through audit.record; local mail catcher (port 54424)

### Open points and assumed defaults

- The FR-I1 SOP says the authentication service sends all four emails; ARCHITECTURE section 4 sends member_invitation and mfa_reset through the notify queue. Default assumed: ARCHITECTURE (Auth sends confirmation and reset; notify sends invitation and two-step reset notice). Until notify exists the UI shows a copyable invitation link (OPEN_QUESTIONS.md, D10).
- The invitation email needs the raw token, which ARCHITECTURE says is returned once and never stored. Default assumed: the token sits in the notification payload only while queued and is removed by notify_ack; the pgmq message carries only the notification id. Needs a design decision.
- An invitee may have no profile, so notifications.user_id cannot always be set. Default assumed: proposed recipient_email column, user_id null; bounce suppression by user does not apply to such recipients.
- Auth minimum interval and Auth email rate limits use Supabase defaults and are tuned after launch (ARCHITECTURE section 6.1).
- Whether the Basic limit of 1 member counts the owner (so Basic cannot invite) is to be confirmed by CHARA (SOP FR-A5); the limit criterion uses Professional (5 members).
- Resend account and sending domain come from the owner (OPEN_QUESTIONS.md, W1); until then everything is checked only in the local mail catcher and marked not verified against the live service.
- Used, expired and wrong-address invitation openings are covered by FR-A5; the local non-live provider is assumed to deliver to the mail catcher.

## FR-I2 · Transactional emails

> Application received, application state changed, vacancy hidden, trial ending (3 days before), payment failed and new legal version emails are queued and sent with delivery status recorded.

### Acceptance criteria

**AC1 · Application received creates one row per member** (database test (pgTAP))

- Given an organisation with an owner, an admin and a member (digest false or no preference row), a member of another organisation, and an open, visible vacancy
- When a candidate calls apply_to_job
- Then three notifications rows of kind application_received are created in the same transaction for the three members only, each status queued, channel email, with one pgmq message each; the payload holds only application id, vacancy id and vacancy title (no cover note, no document, no candidate contact details); no row exists for the other organisation

**AC2 · Application received reaches the employer inbox** (browser test (Playwright))

- Given the same organisation on the local stack with the non-live provider and notify scheduled every minute
- When the candidate applies in the browser
- Then within 2 minutes each of the three members has one email in the mail catcher with the vacancy title and a link to the applicants page, and no document name, cover note or candidate email or phone; each notifications row is status sent with sent_at set

**AC3 · Status emails go to the candidate on every move except Viewed** (database test (pgTAP))

- Given Application A1 in Applied, A2 in Interview and A3 in Shortlisted of one candidate, an employer member of the organisation with the shortlisting feature, and a lapsed organisation on free_employer
- When a1 goes Applied -> Viewed (system, on first open) and then to Shortlisted, Interview, Offer and Hired with set_application_status; the employer declines A2; the candidate withdraws A3 with withdraw_application; a move is tried on A1 in Hired and on an application of the lapsed organisation
- Then no row for Viewed; exactly one status_changed row addressed to the candidate per other move (labels Shortlisted, Interview, Offer, Hired, Not selected, Withdrawn: 6 rows), each with the new state label and vacancy title and no employer note or decline reason; no row goes to employer members on withdrawal; the two refused moves create no row

**AC4 · Bulk change queues one email per accepted applicant** (database test (pgTAP))

- Given an employer selection of 5 applications, 4 that may move to Interview and 1 already in Hired that the transition guard refuses
- When bulk_set_application_status is called after the confirmation step
- Then four status_changed rows are created, each for its own candidate, none for the refused application, which is returned with its reason

**AC5 · Vacancy hidden email to owner and admins** (database test (pgTAP))

- Given a vacancy of an organisation with an owner, an admin and a member
- When a Trust and Safety Administrator (trust_safety + aal2) calls moderate_job to hide it with a statement of reasons; a verification_reviewer, and a call without reasons, are tried as well
- Then two mandatory vacancy_hidden rows are created, for the owner and the admin only, with vacancy title and statement of reasons in the payload; the refused calls create no row

**AC6 · Billing emails are sent once to the owner** (database test (pgTAP))

- Given a trialing organisation and an active organisation with past_due_since empty, each with an owner, an admin and a member
- When the event customer.subscription.trial_will_end is ingested twice with the same provider event id and applied; for the other organisation invoice.payment_failed, a second invoice.payment_failed of the same period, invoice.paid and a new invoice.payment_failed are applied in turn through billing_ingest_event and billing_apply_event
- Then one trial_ending row for the owner only (payload: trial end date, plan code) and no row from the duplicate event; payment_failed rows for the owner only on the first and on the last failure; the second failure leaves past_due_since unchanged and adds no row

**AC7 · New legal version email to affected users only** (database test (pgTAP))

- Given Active candidates (worker), active company users, one deleted user, and a Worker Terms and a Privacy Policy version ready to publish
- When a Platform Administrator calls publish_legal_document for the Worker Terms, then for the Privacy Policy; a trust_safety user and a failed publish are tried as well
- Then Worker Terms creates one mandatory legal_version row per active candidate and none for company or deleted users; Privacy Policy creates one per active user of both kinds; the refused and failed calls create none

**AC8 · Suspension, reinstatement and deletion emails** (database test (pgTAP))

- Given a Trust and Safety Administrator (aal2), an organisation with owner, admin and member, a user with a pending deletion and a completed erasure
- When suspend_user, suspend_organization, reinstate_user, reinstate_organization (each with reasons), request_account_deletion and the completed erasure run
- Then account_suspended and account_reinstated rows go to the user, or to the owner and admin of the organisation (not the member), with the statement of reasons in the payload; deletion_requested goes to the account holder at the request; deletion_completed is queued for the address held before erasure; all are mandatory; a call without reasons creates no row

**AC9 · Queue, visibility timeout and acknowledgement** (database test (pgTAP))

- Given a queued notification, a configured visibility timeout, and a service_role caller
- When notify_dequeue is called twice in a row, then after the timeout, and notify_ack records sent with the provider message id; a rolled-back transaction that enqueued a notification and a call from authenticated and anon are also tried
- Then the second call returns nothing until the timeout ends; after notify_ack the status is sent, sent_at and provider message id are stored, the message is archived and never returned again; a message whose row is already sent is archived without a new send; the rolled-back transaction leaves neither row nor message; authenticated and anon cannot execute either RPC

**AC10 · Idempotent send, retries and alerts** (unit test (Vitest))

- Given the notify handler with a mocked Resend that returns a server error for notification N, and a queue depth above the configured threshold
- When notify processes N and runs
- Then Resend is called 4 times (first attempt plus 3 retries) with delays that strictly grow and the notification id as idempotency key on every call, including a redelivery after a crash; then notify_ack stores status failed with the error text and an operations alert is raised; a depth above the threshold raises one backlog alert per run

**AC11 · Bounces and complaints suppress later email** (database test (pgTAP))

- Given Sent notifications N1, N2 and N3 for users U1, U2 and U3
- When notify_ack records a hard bounce for N1, a complaint for N2 and a transient bounce for N3, then emails of any kind are queued for U1; then U1 changes the email address in auth.users
- Then each row shows its delivery result; email_undeliverable_at is set for U1 and U2 only (the preference row is created if missing); the later email for U1 is never sent to Resend and ends as suppressed; after the address change the field is cleared and the next email is sent

**AC12 · Webhook and scheduler calls are authenticated** (unit test (Vitest))

- Given the notify function
- When a Resend delivery event arrives with an invalid or missing signature, and a scheduler call arrives without the shared secret header; then a validly signed event is sent twice
- Then the first two are refused with 401, change no row and are logged without the payload; the signed event is accepted and recorded once

**AC13 · Templates carry minimal data** (unit test (Vitest))

- Given every notification kind rendered with a sample payload
- When the rendered email is inspected
- Then each is English, links to the page concerned and shows only whitelisted fields; vacancy_hidden and account_suspended show the statement of reasons and vacancy_hidden also the appeal route; trial_ending shows the trial end date and the price after the trial; no kind shows a document, note, password or token

**AC14 · Retention is configurable** (database test (pgTAP))

- Given retention_policies for notifications set to D days, rows aged D-1 and D+1 days
- When private.apply_retention runs, then D is changed to a smaller value and it runs again
- Then only the D+1 row is deleted at first, the cut-off then follows the new value without a code change, and each run is audited

**AC15 · Notification rows are private** (database test (pgTAP))

- Given two company users, a candidate, an anonymous caller, a Platform Administrator and service_role
- When each selects, inserts, updates and deletes on public.notifications
- Then a user sees only own rows; no authenticated or anonymous insert, update or delete succeeds; staff see no other user's rows; service_role has no direct table grant

### Data and validation

- notifications.user_id: references the recipient profile; one row per recipient and kind; null only for member_invitation and deletion_completed (proposed: recipient_email)
- notifications.kind: application_received, status_changed, vacancy_hidden, trial_ending, payment_failed, legal_version, account_suspended, account_reinstated, member_invitation, deletion_requested, deletion_completed, mfa_reset
- notifications.channel: email in Phase 1
- notifications.status: queued, sent, failed or suppressed; changed only through notify_ack
- notifications.payload: jsonb with minimal data (ids, titles, state label, dates, statement of reasons); no documents, notes, passwords
- notifications.sent_at: set when the provider accepted the message
- proposed: notifications columns for delivery result (delivered, bounced, complained), attempts, provider message id and last error
- idempotency key: the notification id on every provider call
- retries: 3 after the first failed attempt, growing back-off
- retention: 13 months by default as a retention_policies value in days
- language: English only; templates in apps/web/emails

### States and transitions

- queued -> sent (notify, provider accepted)
- queued -> queued (notify, provider failure, within 3 retries)
- queued -> failed (notify, retries exhausted)
- queued -> suppressed (notify, recipient email_undeliverable_at set)
- sent -> delivery recorded as delivered, bounced or complained (Resend webhook through notify_ack)

### Roles and permissions

- Authenticated user: may read only own notifications rows; may not insert, update or delete any row
- Anonymous: no access to notifications or the queue
- Employer members (owner, admin, member): receive application_received subject to digest; owner receives trial_ending and payment_failed; owner and admin receive vacancy_hidden, account_suspended and account_reinstated
- Candidate: receives status_changed on every state change except Viewed; cannot switch it off
- trust_safety (aal2): triggers vacancy_hidden, account_suspended, account_reinstated through moderate_job and suspend/reinstate; verification_reviewer: may not
- Platform Administrator (admin): triggers legal_version through publish_legal_document
- service_role (notify, billing-webhook through RPCs): only notify_dequeue and notify_ack execute for it; no direct table grants
- Platform staff: no screen to read or edit notifications in Phase 1

### Objects

- public.notifications; public.notification_preferences; pgmq notification queue (proposed: queue name notifications)
- RPCs: apply_to_job, set_application_status, bulk_set_application_status, withdraw_application, moderate_job, suspend_user, suspend_organization, reinstate_user, reinstate_organization, publish_legal_document, request_account_deletion, invite_member, reset_mfa, notify_dequeue, notify_ack, billing_ingest_event, billing_apply_event, erase_user
- Edge Functions: notify, account-ops, billing-webhook
- billing.provider_events; billing.retry_failed_events
- pg_cron: notify every minute, private.apply_retention; retention_policies; private.security_events; audit.log through audit.record
- React Email templates in apps/web/emails; Resend API (EU region)
- proposed: private.settings keys for the visibility timeout, back-off and backlog threshold

### Open points and assumed defaults

- Retries: SOP says back-off up to 3 times. Default assumed: 3 retries after the first attempt.
- Back-off intervals, visibility timeout and backlog threshold are not specified. Default assumed: values in private.settings set before go-live.
- Retention is 13 months by default and a configuration value (SOP; OPEN_QUESTIONS.md, L6, open). retention_policies stores days, so the seeded value must be fixed in the migration.
- ARCHITECTURE does not state a read policy on notifications. Default assumed: a user reads own rows only, nothing else.
- deletion_completed goes to a user whose profile is erased; how the address is kept until sending is not specified. Default assumed: proposed recipient_email set before erasure and cleared once sent.
- Legal documents per account kind follow OPEN_QUESTIONS.md, L9 (open): Terms and Privacy for all, Worker Terms for candidates, Employer Terms for company users.
- Whether admin may also suspend is open (OPEN_QUESTIONS.md, P12); default is trust_safety only.
- Vacancy-hidden email carries statement of reasons and appeal route (SOP FR-C7).
- Employer daily summary is covered by FR-I3 (OPEN_QUESTIONS.md, P15).

## FR-I3 · Preferences

> Employer users choose immediate or daily summary for new-application emails; application status emails to candidates are mandatory and cannot be switched off.

### Acceptance criteria

**AC1 · Default is immediate, daily summary holds emails** (database test (pgTAP))

- Given an organisation with U1 (no preference row), U2 (digest false) and U3 (digest true), all members, and two applications made at 09:10 and 13:00 Europe/Berlin
- When apply_to_job runs for each application
- Then U1 and U2 each get one application_received row with one pgmq message per application (2 each); U3 gets no row and no message, and both applications are held for the summary

**AC2 · Settings form is labelled, keyboard operable and saves** (browser test (Playwright))

- Given a company user (owner, admin or member) with no preference row on the notification settings page
- When the user tabs to the group, chooses Daily summary with the arrow keys and Space, presses Enter, then reloads
- Then Immediate is selected at first; the two options are a radio group with a visible label and a short description each, with visible focus; a success message appears after saving and Daily summary is still selected after the reload

**AC3 · Daily summary content and hour** (database test (pgTAP))

- Given U3 (digest true) with 2 held applications, one for vacancy V1 and one for V2, and the summary function called with a given time
- When it is called at 07:00 Berlin, at 08:00 Berlin, and at 08:00 on the next day with no new applications
- Then nothing is sent at 07:00; at 08:00 one email is queued listing V1 and V2 with one application each and a link to the applicants page; nothing is queued the next day

**AC4 · Summary hour across daylight saving** (database test (pgTAP))

- Given the 24 hourly runs of 29 March 2026 and 25 October 2026 (clock changes) and of 15 June and 15 December 2026
- When the hourly job decides for each run
- Then exactly one run per day sends, the one where the Berlin hour is 08: UTC 06 in summer time, UTC 07 in winter time, on the change days as well; no day is skipped or repeated

**AC5 · Each held application is summarised once** (database test (pgTAP))

- Given two held applications already included in the 08:00 summary
- When the job runs twice in the same hour at overlapping times, and again the next day
- Then one summary is queued; the applications are marked as summarised once and are not included again

**AC6 · Switching back keeps held items** (database test (pgTAP))

- Given U3 with digest true and one held application
- When U3 switches to Immediate and a new application arrives, then the next 08:00 job runs
- Then the new application creates an individual row at once; the held application is delivered in the next summary and is not lost

**AC7 · One summary across organisations** (database test (pgTAP))

- Given a user who is a member of two organisations with digest true and one held application in each
- When the summary job runs at 08:00 Berlin
- Then one email is queued, grouped by vacancy, with a link to each organisation's applicants page

**AC8 · Mandatory emails ignore the choice** (database test (pgTAP))

- Given an owner with digest true, a candidate with a status change, a hidden vacancy, a failed payment and a new legal version
- When the events occur
- Then status_changed, vacancy_hidden, payment_failed and legal_version rows are queued at once with pgmq messages; the digest setting changes only application_received

**AC9 · Candidate has no switch** (browser test (Playwright))

- Given a candidate (account kind worker) opens the notification settings
- When the page is displayed
- Then no control turns status emails off and no daily-summary option is shown; the page states that application status emails are always sent

**AC10 · Invalid preference input** (unit test (Vitest))

- Given a company user on the settings form
- When a value other than immediate or daily_summary, or an unknown field, is submitted
- Then Validation rejects it with a field error, the action is not called, the stored value is unchanged and no audit row is written

**AC11 · Preference changes are audited** (database test (pgTAP))

- Given a company user with no preference row
- When the user saves Daily summary, saves it again unchanged, then saves Immediate
- Then one row exists with user_id = the user (no duplicate); two audit.log rows exist (actor = the user, entity = the user's preferences, old and new value in metadata); the unchanged save writes none

**AC12 · Only the owner of a preference may change it** (database test (pgTAP))

- Given Company user A, company user B (also an owner of the same organisation), a candidate and an anonymous caller
- When a updates B's row, B's row is read by A, the candidate and the anonymous caller call set_notification_preferences, and A writes email_undeliverable_at
- Then all are refused or return no row; B's row is unchanged; the candidate gets a permission error and no row is written; email_undeliverable_at is writable only through notify_ack

**AC13 · Loading and error states of the settings page** (browser test (Playwright))

- Given the settings page with a slow response, and a save that returns an error
- When the page loads and the user saves
- Then a skeleton shows while loading; during the save the button is disabled and shows a pending state; on the error an error toast appears and the radio keeps the last saved value

### Data and validation

- notification_preferences.user_id: required, unique, equals auth.uid() on write
- notification_preferences.digest: boolean, not null, default false (immediate); true means daily summary
- notification_preferences.email_undeliverable_at: timestamptz, null by default; written only by notify_ack, cleared by the trigger on auth.users when the address changes
- daily summary time: 08:00 Europe/Berlin, job runs hourly in UTC
- form value: immediate or daily_summary, validated by zod and React Hook Form
- audit.log: action for preference change, actor_id, entity_type, entity_id, metadata with old and new value

### States and transitions

- Immediate (digest false) -> Daily summary (digest true) (company user, own preference)
- Daily summary (digest true) -> Immediate (digest false) (company user, own preference)
- Held application -> summarised (summary job, once)

### Roles and permissions

- Company user (owner, admin, member; aal1 is enough): may read and change own digest preference
- Candidate: may not change any notification preference; status emails are mandatory
- Another user, including another owner or admin of the same organisation: may not read or change someone else's preference
- Anonymous: denied
- Platform staff: no Phase 1 screen to change user preferences
- service_role (notify): may set email_undeliverable_at through notify_ack only

### Objects

- public.notification_preferences(user_id, digest, email_undeliverable_at)
- public.notifications; apply_to_job and its enqueue trigger; pg_cron hourly summary job; Edge Function notify
- audit.record; audit.log
- proposed: RPC set_notification_preferences
- proposed: page app/[lang]/(app)/settings/notifications
- proposed: private.notification_digest_items(user_id, application_id, created_at, summarised_at) and function private.send_daily_summaries(p_now)

### Open points and assumed defaults

- Daily summary time is open (OPEN_QUESTIONS.md, P15). Default assumed: once a day at 08:00 Europe/Berlin, only when there are new applications.
- ARCHITECTURE does not say how held items are stored. Default assumed: the proposed digest items table, and the summary is one application_received row with the application ids in the payload.
- Switching back to Immediate with held items is not specified. Default assumed: held items stay in the next summary.
- The preference is per user, not per organisation, so a user in several organisations gets one summary grouped by vacancy.
- The share of company users on the daily summary (SOP KPI) has no Phase 1 screen and is read by query.
- The settings route and the RPC name are not in ARCHITECTURE.md and are proposed.
