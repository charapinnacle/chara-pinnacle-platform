# Runbook: payment webhook processing

FR-G3, design point D70 (OPEN_QUESTIONS.md), ARCHITECTURE.md section 10.3. The payment provider sends its events to the Edge Function `billing-webhook`. Each event is verified, stored once, and applied to the subscription records; an event that cannot be applied yet is retried; a weekly function compares the provider's subscriptions with the records. The checkout that starts a subscription is in `checkout.md`; the lapse of a cancelled organisation (FR-G4) is a later unit.

## 1. The path of an event

1. `billing-webhook` reads the raw body and asks the provider adapter to verify the signature (Stripe: header `Stripe-Signature`, HMAC-SHA256 of `<t>.<raw body>`, 300 seconds tolerance, any `v1` value of a rotated secret; null provider: header `x-chara-signature`, HMAC-SHA256 of the raw body). A delivery that does not verify is answered with `401` and no detail, is not stored, and is logged on every attempt (`billing_webhook_rejected`, provider and reason). The audit row `billing.webhook_rejected` (metadata: the reason, one of `missing_signature`, `malformed_signature`, `timestamp_outside_tolerance`, `signature_mismatch`, `invalid_payload`, `not_configured`, and the provider; no payload, no event id) is written by `billing_webhook_rejected` at most once an hour for each provider and reason, because the endpoint is public and the audit log is permanent.
2. The adapter turns the event into a normalised event (`normalize`); a type CHARA does not use (`charge.succeeded`, `customer.updated`, ...) is answered with `200` and not stored. The normalised event holds ids, the plan code, the status, dates and amounts, and no name, address or card.
3. `billing_ingest_event` stores it once, keyed by provider and provider event id; a second delivery returns the first row and changes nothing. A failure to store answers `500`, so that Stripe delivers again.
4. `billing_apply_event` applies it in one transaction and answers the status: `applied` (one audit row `billing.event_applied` with the event id, kind, organisation, status before and after), `stale`, `error` or `received`. A failure of this call is logged and answered with `200`: the event is stored and the retry job owns it.
5. `stale`: the event is older than the state held (`subscriptions.last_provider_event_at`). The function fetches the subscription from Stripe, stores it as `subscription.updated` (or `subscription.canceled`) under the id `refetch:<subscription>:<time of the fetch>` and applies that. A failed fetch is logged and left to the next event or the weekly comparison. An event that waited as `received` and turns `stale` in a retry run is not fetched again (only the function calls Stripe): the next event of the subscription or the weekly comparison corrects the record.

| Provider event | Effect (`billing_apply_event`) |
|---|---|
| `checkout.session.completed` | Sets `billing.customers.customer_ref` and the customer and subscription references of the live subscription. |
| `customer.subscription.created`, `.updated` | Upserts plan, status, current period, trial end, cancellation date. The first event with a trial end writes the trial grants of the organisation's identifiers; an identifier another organisation already holds raises the alert `billing_trial_repeated`. |
| `customer.subscription.deleted` | Status `canceled`; the organisation is on `free_employer` (`private.org_plan_code`). Pausing its vacancies (FR-G4) is added by U47. |
| `invoice.paid` | Writes the order when the amount is above zero, clears `past_due_since`, sets Active when the invoice was paid with an amount (an invoice carries no subscription status; the zero-amount invoice of a trial leaves Trialing). |
| `invoice.payment_failed` | Past due; `past_due_since` is set once per dunning period, from the time of the failure, and only then is the `payment_failed` email queued for the owner. |
| `customer.subscription.trial_will_end` | One `trial_ending` email for the owner while the subscription is Trialing. |

The organisation of an event is the one in the metadata `org_id` (set on the Checkout session and the subscription by `billing_checkout_start`); an event without it is resolved through the customer or the subscription reference. An event whose organisation or subscription is not known yet stays `received`. A plan code that is not a plan of the organisation's type (a price without `plan_code` metadata, a typo) sets the event to `error` with the reason `unknown_plan`, changes nothing and raises the alert `billing_event_error`; the retry job never takes it again.

## 2. Configuration

| Where | Name | Value |
|---|---|---|
| Function secrets of `billing-webhook` | `BILLING_PROVIDER` | `stripe` in production, `null` for the local stack and CI (no default; the function fails to start without it). |
| | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Both when the provider is `stripe` (the second is the signing secret `whsec_...` of the endpoint). |
| | `BILLING_WEBHOOK_SECRET` | The signing secret of the null provider; local stack and CI only. |
| | `SITE_URL` | Shared with `billing-checkout`. |
| Function secrets of `billing-reconcile` | `BILLING_PROVIDER`, `STRIPE_SECRET_KEY`, `EDGE_SHARED_SECRET` | The scheduler sends `x-edge-secret`; the function holds no other credential. |
| `private.settings` | `billing_retry_alert_minutes` | 60: the age at which an event that is still `received` becomes an error. |
| `private.retention_policies` | `billing_provider_events` | 396 days (13 months, L6): the stored events are deleted after it. Orders and the audit log are kept. |

`billing-webhook` has `verify_jwt = false`: the provider cannot send a token, and the signature is the authentication. Deploy with `npx supabase functions deploy billing-webhook --use-api` and `npx supabase functions deploy billing-reconcile --use-api` (`verify_jwt` comes from `config.toml`), then set the secrets with `npx supabase secrets set --env-file <file>` (names in `supabase/functions/.env.example`).

In the Stripe dashboard (test mode first) add an endpoint `https://<project>.supabase.co/functions/v1/billing-webhook` for exactly these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.paid`, `invoice.payment_failed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`. The adapter reads both API shapes of the subscription and the invoice (period dates on the subscription or on its item; `invoice.subscription` or `invoice.parent.subscription_details`). Set Stripe's retry schedule to cancel the subscription 7 days after the first failed payment (FR-G4).

The scheduler jobs are `billing-retry-events` (`*/5 * * * *`, `select billing.retry_failed_events()`) and `billing-reconcile-weekly` (`0 4 * * 1`, calls `billing-reconcile` through `private.call_edge_function`, which does nothing while the Vault secrets `project_url`, `anon_key` and `edge_shared_secret` are not all set). Check them with `select jobname, schedule from cron.job where jobname like 'billing%'` and `select status, return_message, start_time from cron.job_run_details where jobid in (select jobid from cron.job where jobname like 'billing%') order by start_time desc limit 10`.

## 3. Retry and alerts

`billing.retry_failed_events()` takes the 100 oldest events that are still `received` and applies each. An event that is still `received` after `billing_retry_alert_minutes` becomes `error` with the reason `org_not_linked` (the organisation or its subscription never appeared) or `transient` (the application itself keeps failing), and raises one alert. Alerts are rows of `private.security_events` (ids and reasons only) and a server log line `{"alert": ..., "detail": ...}`; operations configure the log platform to notify on the key `alert`. A plan that is unknown (`unknown_plan`) or a second customer for an organisation (`customer_conflict`) is an error and an alert at once, and is not retried. Alerts are kept 13 months (`security_events` in `private.retention_policies`). The kinds of this unit: `billing_event_error`, `billing_trial_repeated`, `billing_reconciliation_difference`, `billing_reconciliation_truncated`; the function logs add `billing_webhook_ingest_failed`, `billing_reconcile_failed` and `billing_reconcile_misconfigured`.

```sql
-- What waits or failed (the payload is the normalised event; read it as the database owner only)
select id, provider_event_id, kind, status, error, received_at, payload
from billing.provider_events where status in ('received', 'error') order by received_at;
select kind, detail, created_at from private.security_events order by id desc limit 20;
```

Resetting an error after its cause is fixed (for example `plan_code` added to the Stripe price metadata by running the mirror of `checkout.md` section 3, or the missing customer linked): a reviewed statement run by an operator, which leaves an audit row; the next run of the job applies the event.

```sql
with reset as (
  update billing.provider_events set status = 'received', error = null
  where id = '<event id>' and status = 'error' returning id, kind
)
select audit.record_as(null, 'billing.event_reset', 'provider_event', id::text, jsonb_build_object('kind', kind, 'ticket', '<ticket>')) from reset;
```

## 4. Reconciliation (weekly, Monday 04:00 UTC)

`billing-reconcile` lists the subscriptions Stripe holds that are not cancelled and reads the records of `billing.subscriptions` for the provider, and compares them by subscription reference: `missing_record` (Stripe has it, the records do not), `extra_record` (a live record Stripe does not list), `status_mismatch`, `plan_mismatch`. `billing-reconcile` sends the total and a sample of 100 differences; `billing_reconcile_report` raises one alert `billing_reconciliation_difference` per difference of the sample (at most 200), one alert `billing_reconciliation_truncated` when the sample is smaller than the total, and writes one audit row `billing.reconciled` (`checked`, `differences` = the total). A large run, for example after an outage of the webhook, is reported, never refused. A difference can be an event still in flight: run the function again before acting (`select private.call_edge_function('billing-reconcile')`, or POST with the shared secret), then compare the record with the subscription in Stripe and correct the cause (re-deliver the event from the Stripe dashboard; it is stored once and a stored event is not applied twice, so reset a stuck event as in section 3 instead). With the null provider the function answers `skipped`. The check that alerts when a subscription is still Past due a day after the grace period belongs to FR-G4.

## 5. KPIs (monthly review)

Events applied within 1 minute (%): applied events (and errors, and events still waiting for more than a minute) by month; the stored payloads are deleted after 13 months, so the figure exists for that window.

```sql
select date_trunc('month', received_at)::date as month,
       round(100.0 * count(*) filter (where status = 'applied' and applied_at - received_at <= interval '1 minute')
             / nullif(count(*) filter (where status in ('applied', 'error') or (status = 'received' and received_at < now() - interval '1 minute')), 0), 1) as applied_within_1_minute_pct
from billing.provider_events group by 1 order by 1 desc;
```

Reconciliation differences (target 0), per week: the total of the runs is in the audit rows (the alerts are a sample of at most 200 for each run):

```sql
select date_trunc('week', created_at)::date as week, sum((metadata ->> 'differences')::int) as differences
from audit.log where action = 'billing.reconciled' group by 1 order by 1 desc;
select created_at, metadata from audit.log where action = 'billing.reconciled' order by id desc limit 10;
```

Also review monthly (SOP frequency): events in `error`, the oldest `received` event, the rejected deliveries (`select date_trunc('day', created_at)::date, metadata ->> 'reason', count(*) from audit.log where action = 'billing.webhook_rejected' group by 1, 2 order by 1 desc`). The audit rows are bounded to one an hour for each provider and reason; the number of attempts is the log line `billing_webhook_rejected`.

## 6. Local stack and tests

`BILLING_PROVIDER=null`: `supabase/functions/serve-local.sh billing-webhook <port>` serves the function with `BILLING_WEBHOOK_SECRET`; a delivery is `{"id": "<event id>", "event": <normalised event with providerCreatedAt>}` with the header `x-chara-signature` set to the hex HMAC-SHA256 of the body. The browser tests (`billing-webhook.spec.ts`, `checkout.spec.ts`) play the provider. The Deno tests (`deno test --frozen --allow-env=NODE_ENV` in `supabase/functions`) cover the signature rules, the Stripe fixtures (`_tests/fixtures/stripe/events`, shaped after the API reference, not recorded), the handler outcomes and the comparison; the pgTAP files `089` to `091` cover storing, applying, retrying, retention and the confinement of the functions.

## 7. Not verified against a live account

Real Stripe deliveries and signatures, the API version of the account and the event shapes it sends, Stripe's retry and dunning schedule, the portal and Tax behaviour, the scheduler call to `billing-reconcile` (Vault secrets), and the routing of the log alerts to a person.
