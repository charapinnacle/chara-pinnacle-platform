# Runbook: transactional emails

FR-I2 and FR-D6, design points D62 and D63 (OPEN_QUESTIONS.md). The SOP is "Transactional Email Queue E2E SOP" (owner Platform / Operations, reviewed quarterly). Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them.

## 1. How an email is sent

1. A unit queues an email with `pgmq.send('notifications', {kind, user_id, mandatory, ...ids})` inside its own transaction. The trigger `notifications_enqueue` writes one `public.notifications` row (status `queued`) in the same transaction, so a rolled-back change leaves neither. An `application_received` for a member who chose the daily summary (`notification_preferences.digest`) keeps its row but loses its message: the daily summary (section 8) sends those rows (status `queued`, `msg_id` null).
2. The pg_cron job `notify-run` (every minute) calls the `notify` Edge Function when a message is visible (`private.run_notify`, which reads the Vault secrets `project_url`, `anon_key` and `edge_shared_secret` like `account-ops-run`; it does nothing until all three exist).
3. `notify` calls `notify_dequeue` (batches of 10, two sends at a time because Resend allows about two requests a second, until the queue is empty or 60 seconds are used; no message is started after that). A message stays invisible for `notify_visibility_seconds` (180); a crash or a failing acknowledgement means it is read again after that, and the provider's idempotency key (the notification id) makes the second send harmless.
4. Each message is rendered from `apps/web/emails` (English only, payload whitelisted per kind) and sent. Every call to the provider is cut after 10 seconds. A failure that can pass (server error, rate limit, network) is tried again after each delay of `notify_retry_delays_seconds` (2, 6 and 18 seconds: the first attempt and 3 retries); if it still fails the message is not closed: it returns after the visibility timeout and is tried again, and after `notify_max_reads` reads `notify_dequeue` ends it as `failed` (`abandoned`) and the alert is raised. Another refusal (a bad address) ends at once as `failed`. `notify_ack` records `sent` with the provider message id, or `failed` with a short error code.
5. Resend calls `notify` with a signed event for `delivered`, `bounced` and `complained`; `notify_ack` stores it on the row (`delivery`). A permanent bounce or a complaint sets `notification_preferences.email_undeliverable_at` (audit action `notification.address_undeliverable`); later emails to that user end as `suppressed` and are never sent. A change of the address on `auth.users` clears the mark.
6. Retention: `private.apply_retention` (daily 03:17 UTC) deletes `notifications` rows and archived queue messages older than the policy `notifications` of `private.retention_policies` (396 days, 13 months), and audits the run (`retention.run`, entity `notifications`). To change the period: `update private.retention_policies set days = <n> where entity = 'notifications';`.

## 2. Configuration

Settings (rows of `private.settings`, read as `value #>> '{}'`; defaults are the assumptions of FR-I2 and stay owner points):

| Key | Default | Meaning |
|---|---|---|
| `notify_visibility_seconds` | 180 | How long a message read by `notify` is invisible. Rule: it must exceed the time budget of a run (60 seconds, `TIME_BUDGET_MS`) plus the longest send of one message (the retry delays, 26 seconds, plus four attempts of 10 seconds each: 66 seconds), here 126 seconds; the wall clock of the platform (150 seconds) is the other limit. Change `BATCH_SIZE`, `CONCURRENCY` or `TIME_BUDGET_MS` in `notify/handler.ts` and this setting together. |
| `notify_max_reads` | 8 | A message read more often than this (a crash loop) is recorded as `failed` with `abandoned`. |
| `notify_retry_delays_seconds` | `"2,6,18"` | Seconds before each retry; the number of values is the number of retries. |
| `notify_backlog_threshold` | 500 | Messages still waiting after a batch above which one `notify_backlog` alert is raised per run. |

Function secrets (`supabase/functions/.env.example` lists the names): `EMAIL_PROVIDER` (`resend` in production, `null` for local and CI; there is no default, a function without it refuses to start), `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` (the `whsec_` value of the webhook), `EMAIL_FROM` (`CHARA <address on the verified domain>`), `SITE_URL` (the origin of the web app, no path), `EDGE_SHARED_SECRET` (the same value as the Vault secret `edge_shared_secret`), and for `null` the optional `MAIL_CATCHER_URL`.

Resend (EU region): verify the sending domain (SPF, DKIM, DMARC), create an API key limited to sending, register the webhook `https://<project>.supabase.co/functions/v1/notify` for `email.delivered`, `email.bounced` and `email.complained`, and copy its signing secret to `RESEND_WEBHOOK_SECRET`. The function is `verify_jwt = false`: it answers 401 to anything that has neither the shared secret nor a valid Svix signature.

## 3. Operating

- Alerts: the function writes a log line with the key `alert` (`notify_retries_exhausted` once for a message whose first read used up its attempt and 3 retries, with the notification id, kind, attempts and error code, SOP FR-D6 step Monitor; `notify_backlog` with the depth and the threshold, `notify_delivery_failed` with the notification id, kind, error code and, for a send, the attempts; raised for a refusal that would repeat, an unknown kind, a template that does not render, and for a message that `notify_dequeue` ended as `failed` (`abandoned` after too many reads, `no_recipient`), so a crash loop and a provider outage that does not end are not silent; never an address). Configure the alert rule in the log platform on that key; this is outside the repository.
- Failed emails (the SOP step Monitor): `select id, kind, attempts, last_error, created_at from public.notifications where status = 'failed' and created_at > now() - interval '1 day' order by created_at;`. A failed row is not retried by itself (a provider outage or rate limit does not produce one until the message has been read `notify_max_reads` times). After the cause is fixed, queue the email again with `pgmq.send` (the contract in section 5); do not update the row.
- Queue state: `select count(*) filter (where vt <= now()) as waiting, count(*) filter (where vt > now()) as in_flight, min(enqueued_at) as oldest from pgmq.q_notifications;`.
- A bounce does not stop mandatory emails by itself; it marks the address. If a person fixed the address problem without changing it, clear the mark with a ticket: `update public.notification_preferences set email_undeliverable_at = null where user_id = '<id>';`.

## 4. KPIs

All from `public.notifications` (created_at is the time of the enqueue):

```sql
-- Send success rate (SOP KPI), last 30 days
select count(*) filter (where status = 'sent')::numeric / nullif(count(*) filter (where status in ('sent', 'failed')), 0)
from public.notifications where created_at > now() - interval '30 days';

-- Queue latency and median time to send (SOP KPIs), rows sent through the queue (not the daily summary)
select percentile_cont(0.5) within group (order by sent_at - created_at) as median_latency,
       percentile_cont(0.95) within group (order by sent_at - created_at) as p95_latency
from public.notifications where status = 'sent' and created_at > now() - interval '30 days';

-- Delivery success rate (FR-D6 KPI): delivered of the sent ones
select count(*) filter (where delivery = 'delivered')::numeric / nullif(count(*) filter (where status = 'sent'), 0)
from public.notifications where created_at > now() - interval '30 days';

-- Bounces, complaints and suppressed emails
select delivery, count(*) from public.notifications where delivery is not null group by 1;
select count(*) from public.notifications where status = 'suppressed';
```

Delivery events arrive from the provider after the send, so the delivery rate of the last hours is not final.

## 5. Adding an email kind

A unit that sends a new kind:

1. Adds the kind to the `check` of `notifications.kind` (migration), a branch to `private.notification_payload` that lists the keys the email may show, and a template in `apps/web/emails/templates` registered in `emails/index.tsx`. The Vitest test `emails.test.ts` fails when the kinds of the database and the templates differ, and checks that nothing outside the whitelist is shown.
2. Queues it with `pgmq.send('notifications', jsonb_build_object('kind', ..., 'user_id', <recipient>, 'mandatory', true, <ids>))`, one message per recipient. Ids only: titles, slugs and labels are looked up by the payload builder. Keys the builder does not know are dropped.
3. Message keys by kind: `application_received` (`application_id`, `job_id`), `status_changed` (`application_id`, `job_id`, `status`), `vacancy_hidden` (`job_id`, `reasons`), `trial_ending` (`organization_id`, `trial_ends_at`, `plan_code`, `amount_minor` in the minor unit, `currency`), `payment_failed` (`organization_id`), `legal_version` (`document_slug`, `version`), `deletion_requested` (`erases_on`), `erasure_paused` (`user_id` of the account, `email` of the privacy contact; the row is not readable by that account, because the notice tells staff of a legal hold, and a bounce of the contact marks no address undeliverable), `deletion_completed` (`email`, no `user_id`), `mfa_reset` (none). A message with `email` is deleted, not archived, when finished.

## 6. Templates

The source is `apps/web/emails` (React Email). The Deno function imports it by relative path, so there is one copy. Preview or change a template with the Vitest test `apps/web/tests/unit/emails.test.ts`; run the Deno tests with `deno test --frozen --allow-env=NODE_ENV` in `supabase/functions`. `trial_ending` and `payment_failed` link to `/org/<slug>/billing`, which does not exist before the billing unit (U46): check that the route exists when U46 lands, until then those two links are a 404. The wording is to be reviewed with legal for tone and content (SOP FR-D6 step Review; quarterly, external).

## 7. Local and CI

`EMAIL_PROVIDER=null`: `notify` keeps nothing outside memory unless `MAIL_CATCHER_URL` is set, in which case every email is handed to the local mail catcher (`http://127.0.0.1:54424`). The browser test `notify-emails.spec.ts` starts the function with `supabase/functions/serve-local.sh notify <port>` and plays the scheduler. Sending through a real Resend account has not been verified.

## 8. Application emails and the daily summary (FR-D6)

- Recipients: `apply_to_job` queues `application_received` for every member of the organisation whose invitation is accepted (a removed member is no row of `organization_members`); `set_application_status`, `bulk_set_application_status` and `withdraw_application` queue `status_changed` for the candidate, never for Viewed, whatever any preference row says; nothing goes to the employer on a withdrawal (SOP FR-D4).
- Payloads: `application_received` holds the application id, the vacancy title, the organisation display name and its slug; `status_changed` the application id, the vacancy title, the organisation display name and the new status value (the template maps it to the label). No cover note, stage-change note, decline reason, document or candidate name.
- Employer choice: `public.set_notification_preferences(p_digest)` (employer accounts only), page `/<lang>/settings/notifications`. `digest` true holds the member's `application_received` rows (status `queued`, `msg_id` null).
- Summary: the pg_cron job `notify-daily-summary` runs `private.enqueue_daily_summaries()` at every full UTC hour and acts only when the hour in Berlin is 8 (06:00 UTC in summer time, 07:00 in winter time). For each member it marks the held rows `summarised` and queues one `application_received` message with the total and the 20 vacancies with the most applications (a link per vacancy to `/org/<slug>/applicants?job=<id>`); a held row of an organisation the member has left is marked and not sent. A second run in the same hour finds nothing held, and a held row stays held until the next 08:00 (a day the database was down or a failed run sends the day after). The hour, the time zone and the length of the list are the settings `daily_summary_hour` (8), `daily_summary_timezone` (`Europe/Berlin`) and `daily_summary_max_vacancies` (20) of `private.settings` (owner point P15); the function raises `CHARA_SETTING_MISSING` when one is absent, and the words "08:00 Central European time" on the settings page are text to change with them. Watch the job: `select status, return_message, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'notify-daily-summary') order by start_time desc limit 5;`.
- Held items waiting: `select user_id, count(*) from public.notifications where status = 'queued' and msg_id is null group by 1;`. Share of employer users on the summary (SOP KPI; users without a row are on the default, immediate): `select (select count(*) from public.notification_preferences where digest)::numeric / nullif((select count(*) from public.profiles where account_kind = 'company'), 0);`.
