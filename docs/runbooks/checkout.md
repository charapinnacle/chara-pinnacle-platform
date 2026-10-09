# Runbook: subscription checkout and customer portal

FR-G2, design points D4, D36, D67 (OPEN_QUESTIONS.md). An owner or admin at the second step chooses Basic or Professional on `/[lang]/org/[slug]/billing`, reads the five disclosures on the confirmation page, enters the billing country and a VAT ID or a company registration number, accepts the Subscription and Billing Terms and is sent to the hosted checkout of the payment provider. CHARA never receives card data. Manage billing opens the hosted customer portal (card, plan change, cancellation, invoices). The webhook (FR-G3) activates the subscription.

## 1. Configuration

| Where | Name | Value |
|---|---|---|
| Function secrets of `billing-checkout` | `BILLING_PROVIDER` | `stripe` in production, `null` for the local stack and CI. There is no default: a deployment without it fails to start. |
| | `STRIPE_SECRET_KEY` | The restricted or secret key of the Stripe account, only when the provider is `stripe`. Never in `apps/web`. |
| | `SITE_URL` | The origin of the web application. The return addresses of Checkout and the portal are this origin plus `/en/org/<slug>/billing`; no address from a request is used. |
| Web environment (optional) | `BILLING_CHECKOUT_ENDPOINT` | The address of the function when it is not the project's functions address plus `/billing-checkout`. |

The function has `verify_jwt = true` and acts with the caller's own token. It also holds the service key that the platform provides to every function, used only to record a refused worker attempt (section 7). The checks (role, second step, plan, tax input, terms, trial rule) are in `billing_checkout_start` and `billing_portal_start`.

Deploy with `npx supabase functions deploy billing-checkout --use-api` (`verify_jwt = true` from `config.toml`) and set the secrets with `npx supabase secrets set --env-file <file>` (names in `supabase/functions/.env.example`). Verify on each environment: a request without `Authorization` answers 401; a request with the project's publishable key as the bearer answers 401; an owner at the second step who posts `{"action":"portal","orgId":"<id>"}` for an organisation the webhook has not linked answers 403 with the reason `no_customer`.

## 2. Stripe set-up (not verified against a live account)

No Stripe account existed when this was built. The adapter was tested with response fixtures that follow the API reference, not with recordings, so everything below is to be checked in Stripe test mode before launch (acceptance criterion AC12 of FR-G2 is a manual check):

1. Enable Stripe Tax, enter the tax registrations of the CHARA legal entity and a preset product tax code (the mirror script does not set one).
2. Configure the Customer Portal: update payment method, view invoice history, cancel subscription, and switch plans between the Basic and Professional products.
3. Run the mirror (section 3) so that every sold plan has a product and a monthly EUR price, exclusive of VAT.
4. Check the full path in test mode: a customer in the home country without a VAT ID (VAT at the standard rate), a business in another EU country with a valid VAT ID (reverse charge), the trial (30 days, card required, automatic conversion) and a customer who already had a trial (charged at once).
5. Confirm that the redirect to `checkout.stripe.com` and `billing.stripe.com` works in the production build (the content security policy has `form-action 'self'`; the redirect is made by the browser after a fetch, not by a form post, and the browser test checks that it is not blocked).

## 3. Mirroring the plans and the go-live check

Plans are rows of `billing.plans` (FR-G1). The script creates the Stripe product and the monthly price of every sold plan (public, priced, not contact-sales) and stores the identifiers in `billing.plan_provider_refs`. It reads Stripe first, so it never creates an object twice, and a price is replaced (new price, old one archived) when `price_minor` changes. It needs `psql` and the direct connection of an operator who is a member of `billing_owner`.

```sh
DATABASE_URL="$PRODUCTION_DATABASE_URL" STRIPE_SECRET_KEY=... node scripts/sync-stripe-plans.mjs
```

A sold plan without a stored price makes the checkout answer `plan_not_synced`. Before go-live, export the facts and run the gate together with the settings export of `docs/runbooks/plan-limits.md`:

```sh
psql "$PRODUCTION_DATABASE_URL" -Atc "select jsonb_object_agg(key, value) from private.settings" > settings.json
DATABASE_URL="$PRODUCTION_DATABASE_URL" STRIPE_SECRET_KEY=... node scripts/sync-stripe-plans.mjs --export > plans.json
npm run go-live:check -- settings.json plans.json
```

It exits non-zero and names the plan or the setting when a sold plan lacks a limit row, a stored price or a Stripe amount equal to `price_minor`, or when `entitlements_enforced` is not true. Delete the two files afterwards.

## 4. The free-trial rule

One free trial per legal entity. At checkout the trial is refused (the plan starts without a trial and the first payment is due at once) when:

- a `billing.trial_grants` row names the organisation, or one of the identifiers submitted (`vat:<VAT ID>`, `reg:<country>:<registration number>`, upper case, without spaces, dots, hyphens and slashes); the webhook writes that row when the first trialing subscription is applied;
- a subscription of the organisation ever had a trial;
- another organisation whose stored identifier equals the stored or a submitted identifier has a subscription that had a trial.

The confirmation page shows the answer before the redirect, and the form sends the trial length it showed. When the answer changed in between, because the VAT ID or registration number typed into the form belongs to a company that had its trial, or a second organisation of the same company finished its checkout first, the start saves the submitted tax data (no consent, no audit row) and is answered with `trial_changed` (HTTP 409): the page reloads its disclosures from the saved data, clears the acceptance of the terms and asks for a new acceptance of the corrected terms before the next submit. Identifiers of one entity given in different forms by different organisations are not linked (C14). Two organisations of one entity that both open Checkout before either completes can both receive a trial; the second is applied and raises the operations alert of FR-G3.

To lift a wrong block, delete the `billing.trial_grants` row in a reviewed migration; the audit row of the checkout start (`legal_entity_trial_used`) shows what was decided and when.

## 5. KPIs

Both read data this unit and the webhook store; run them quarterly in the SQL editor as the database owner.

Checkout conversion: organisations that started a checkout, and those that have a subscription created at or after their first start.

```sql
with starts as (
  select entity_id::uuid as organization_id, min(created_at) as first_start
  from audit.log where action = 'billing.checkout_started' group by entity_id
)
select date_trunc('quarter', st.first_start)::date as quarter,
       count(*) as organisations_started,
       count(*) filter (where exists (
         select 1 from billing.subscriptions s
         where s.organization_id = st.organization_id and s.created_at >= st.first_start
       )) as organisations_subscribed
from starts st group by 1 order by 1 desc;
```

Trial-to-paid conversion: trials that have ended, and those whose subscription is paying (`active` or `past_due`) now. A subscription that converted and was cancelled later counts as not converted; the exact conversion needs the paid invoices of FR-G3.

```sql
select date_trunc('quarter', trial_ends_at)::date as quarter,
       count(*) as trials_ended,
       count(*) filter (where status in ('active', 'past_due')) as on_paid_plan
from billing.subscriptions
where trial_ends_at <= now()
group by 1 order by 1 desc;
```

## 6. Audit and controls

- A start is committed (customer row with the tax data, consent, audit row) before the provider is called. When the provider fails, the person is told that nothing was charged and the customer row stays; it holds no provider reference and does not lock the identifier of the organisation (only a customer the provider has linked does). The next attempt replaces the row.
- Stripe sessions: a Checkout request carries an idempotency key of its parameters and the current five minutes, so a double submit creates one session and a later attempt creates a new one; a portal request carries none.
- A caller cannot change the provider of a customer the provider has linked (`provider_mismatch`).

- `billing.checkout_started` (entity: the organisation; metadata: plan code, trial days, whether the legal entity had used its trial) and `billing.portal_opened` are written by the two RPCs, with the person as actor; neither holds a VAT ID, a registration number or card data. The tax data is in `billing.customers`, which no API role can read.
- The acceptance of the Subscription and Billing Terms is a `granted` row in `public.consents` (purpose `subscription-and-billing-terms`, the version shown). A new version of the terms is published as a legal document; the page and the check use the current version at once.
- Changing the trial length or a price is a reviewed migration of `billing.plans` (FR-G1); run the mirror afterwards for a price.

## 7. Workers never pay (FR-G6)

A candidate account cannot start a checkout or hold a subscription. The guarantee has four layers, each tested:

- `private.assert_company_account()` is the first statement of `billing_checkout_start` and of `private.assert_billing_manager` (the portal and `billing_checkout_state`): an account of kind worker raises `CHARA_FORBIDDEN` with the detail `worker_account`, an account whose kind is not committed yet `account_kind_unset`. The answer does not depend on the organisation id.
- No billing table has a column or a foreign key for a person, `organization_members` refuses a worker, and the account kind is committed once (pgTAP `089_workers_never_pay`).
- The billing pages answer a candidate with the page of an unknown address, and no page of the candidate area links to pricing, billing or checkout or loads a payment script (Playwright `workers-never-pay`).
- The refusal rolls the call back, so `billing-checkout` records it through `billing_record_worker_attempt` (service role only), which writes the audit row `billing.worker_checkout_refused` (entity: the profile, actor: the person, no metadata). A company user refused for another reason is not recorded. The allowance is 60 rows per person and hour (settings `worker_checkout_refused_audit_max` and `worker_checkout_refused_audit_seconds`), so a loop on the endpoint cannot grow the append-only log without bound; the refusal itself is unconditional.

KPI "worker checkout attempts refused (100 %)": the first column counts the recorded refusals, the second the starts of a checkout or portal by a worker account that got through. The target is a second column of 0 for every period; run it quarterly as the database owner, with `:from` and `:to` the start and end of the quarter (the range is served by `log_created_at_id_idx`). The first column is a lower bound: attempts beyond the allowance, and a refusal whose audit write failed (the function logs `billing-checkout could not record a worker attempt` and the refusal stands), are not counted, so a first column below the number of `403` answers with the log line `worker_account` points to a failed write. The guarantee is the database refusal, not this count. A worker whose account has been erased has no actor and is not counted in the second column.

```sql
select date_trunc('quarter', l.created_at)::date as quarter,
       count(*) filter (where l.action = 'billing.worker_checkout_refused') as worker_attempts_refused,
       count(*) filter (where l.action in ('billing.checkout_started', 'billing.portal_opened') and p.account_kind = 'worker') as worker_attempts_admitted
from audit.log l left join public.profiles p on p.id = l.actor_id
where l.action in ('billing.worker_checkout_refused', 'billing.checkout_started', 'billing.portal_opened')
  and l.created_at >= :from and l.created_at < :to
group by 1 order by 1 desc;
```

Hosted check after each deploy of `billing-checkout`: post a checkout with the token of a candidate, expect `403` with `{"error":"forbidden","reason":null}` and one new `billing.worker_checkout_refused` row for that person. No row means the function's service-role key or the RPC is missing on the project.
