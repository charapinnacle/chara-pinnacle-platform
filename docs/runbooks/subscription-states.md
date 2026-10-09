# Runbook: subscription states and the lapse

FR-G4, design point D71 (OPEN_QUESTIONS.md), ARCHITECTURE.md sections 10.1 and 10.4. The state of a subscription is changed by the payment provider's events only (`billing_apply_event`, see `webhook-processing.md`); no timer, no staff function and no API role changes it.

## 1. States

| State | Set by | Rights |
|---|---|---|
| Trialing | `subscription.activated` with a trial; stays while the zero-amount trial invoice is paid | The plan, with its limits. |
| Active | `subscription.updated` with status active, or `invoice.paid` for an amount above zero when the subscription was Past due or Trialing | The plan. `past_due_since` is cleared. |
| Past due | The first `invoice.payment_failed` of a dunning period (sets `past_due_since`; one `payment_failed` email to the owner) | The plan, for the 7-day grace period counted from `past_due_since`. Owners and admins see the warning with a button to the portal on the dashboard and the billing page. |
| Cancelled | `customer.subscription.deleted` (Stripe's dunning settings send it 7 days after the first failure, or the customer cancels) | The organisation is on `free_employer`. The row is kept; a new checkout creates a new row. |

## 2. The lapse

When a status turns `canceled`, `billing_apply_event` calls `private.pause_jobs_on_lapse` in the same transaction: every Open vacancy becomes Paused, with one audit row each (`job.status_changed`, `actor_fn` `pause_jobs_on_lapse`). If the pause raises, the event is not applied and the status stays; the retry job tries the event again every 5 minutes. For a lapsed organisation (it has subscription rows and every one is canceled) the rules hold whether or not `entitlements_enforced` is on, and for every organisation on `free_employer` once it is on:

- Status changes, bulk actions and notes are refused with `CHARA_FEATURE_NOT_IN_PLAN` (detail `read_only_free_plan`); opening an application does not set Viewed. The applicants, their documents and the notes stay readable. The candidate can still withdraw.
- Reopening a vacancy and inviting a member go through the limits `active_jobs` and `members` of `free_employer` (both 0): `CHARA_LIMIT_REACHED`.
- The pages of the applicants and the vacancies show the notice that the subscription has ended (`v_org_limits.subscription_ended`), with a link to choose a plan for an owner or an admin; the controls that change applicants are `aria-disabled` and point to the notice.

A new checkout restores the plan. The paused vacancies are reopened one by one by the owner or an admin through the normal limit check; after a downgrade nothing is paused or deleted and only opening further vacancies over the new limit is refused.

## 3. The overdue check

`billing.check_past_due_overdue(p_now)` runs daily at 05:30 UTC (`cron.job` entry `billing-past-due-overdue`). Stripe should have cancelled a subscription 7 days after its first failed payment; when one is still Past due more than one day after the grace period (`past_due_since` plus 8 days) the check raises the operations alert `billing_past_due_overdue` (subscription, organisation, `past_due_since`), once for each dunning period. It changes nothing else. When it fires, compare the subscription with Stripe (the weekly reconciliation does the same) and check the dunning settings of the Stripe account.

```sql
select kind, detail, created_at from private.security_events where kind = 'billing_past_due_overdue' order by id desc;
select jobname, schedule, active from cron.job where jobname = 'billing-past-due-overdue';
```

## 4. Verification with a Stripe test clock (FR-G4 AC12, manual)

Needs the Stripe account (open item O7). In test mode, with the dunning schedule set to cancel 7 days after the first failure: create a clock; subscribe a customer with a good test card to Basic with the 30-day trial and another with a card that fails after the trial; advance the clock to day 27, day 30, day 37 and beyond. Expect: both Trialing from day 0 to day 30 (not Active after the zero-amount invoice); one `trial_ending` email at day 27; the first Active at day 30 after the invoice of EUR 39.00 plus VAT; the second Past due with one `payment_failed` email, cancelled by Stripe at day 37, Cancelled, on `free_employer`, its open vacancies Paused. Until then the null provider covers the database rules (pgTAP `092_subscription_states`) and the browser tests (`subscription-states.spec.ts`).

## 5. KPIs

- Involuntary churn rate: subscriptions that became `canceled` after a `payment_failed` (audit rows `billing.event_applied` with `kind` `payment.failed` and `to_status` `past_due`, followed by `subscription.canceled` with `to_status` `canceled` for the same organisation and no cancellation request `cancel_at`), divided by the subscriptions that were Active or Trialing at the start of the period.
- Recovery within grace: of the organisations with `billing.event_applied` rows `payment.failed` with `to_status` `past_due`, the share whose next `payment.succeeded` row (`to_status` `active`) is within 7 days. Both are read from `audit.log` (`action = 'billing.event_applied'`, `metadata`) and need no further field.
