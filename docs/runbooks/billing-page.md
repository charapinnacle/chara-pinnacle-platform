# Runbook: billing page

FR-G5, design point D73 (OPEN_QUESTIONS.md), ARCHITECTURE.md sections 10.1 and 10.4.

## 1. Who sees what

The page `/<lang>/org/<slug>/billing` is for owners and administrators at the second step (aal2). A member gets the forbidden page, a person at aal1 is sent to two-step verification, a visitor to the login, and anyone who is not a member (including platform staff) gets the not-found page. The database applies the same gate to `public.v_my_subscription` and `public.billing_usage`; the page never selects a provider reference.

## 2. Usage

`billing_usage(p_org)` returns one row per limit key (`active_jobs`, `members`) with the number used and the limit of the plan (`null` is unlimited). A usage above the limit after a downgrade is shown as over the limit; nothing is paused or deleted, and only opening or inviting beyond the limit is refused.

```sql
select * from public.billing_usage('<organisation id>'); -- as the owner at aal2
```

## 3. Actions

Upgrade, Downgrade, Manage billing, Change tax details and View invoices each open one Customer Portal session of the organisation's customer and return to the billing page. The portal in the Stripe account must list the Basic and Professional prices only and allow the customer to update address, tax ID and payment method and to see its invoices. A plan changed in the portal shows on the page once `customer.subscription.updated` has been applied (`webhook-processing.md`); before that the page shows the unchanged plan.

## 4. Self-service resolution rate (KPI)

```sql
select count(*) as portal_sessions, count(distinct entity_id) as organisations
from audit.log where action = 'billing.portal_opened' and created_at >= now() - interval '90 days';
select kind, count(*) from billing.provider_events
where kind like 'subscription.%' and received_at >= now() - interval '90 days' group by kind;
```

The rate is the portal sessions that end without a billing contact to staff. The contacts to staff come from the support mailbox and are counted by hand at the semi-annual review of the SOP; the platform holds no support tickets.
