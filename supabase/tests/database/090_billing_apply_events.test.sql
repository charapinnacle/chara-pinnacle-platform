begin;
select plan(84);

\ir organizations_fixture.inc
\ir billing_events_fixture.inc

-- FR-G3 AC3 to AC5, AC7 and AC9: what billing_apply_event does to the customers, subscriptions, orders, trial grants,
-- notifications and the audit log (ARCHITECTURE.md section 10.3).

create function pg_temp.customer_ref(p_org uuid) returns text
language sql as $$ select customer_ref from billing.customers where organization_id = p_org $$;
create function pg_temp.sub_count(p_org uuid) returns bigint
language sql as $$ select count(*) from billing.subscriptions where organization_id = p_org $$;
create function pg_temp.live_count(p_org uuid) returns bigint
language sql as $$ select count(*) from billing.subscriptions where organization_id = p_org and status <> 'canceled' $$;
create function pg_temp.errors() returns bigint
language sql as $$ select count(*) from billing.provider_events where status = 'error' $$;
create function pg_temp.mails(p_user uuid, p_kind text) returns bigint
language sql as $$ select count(*) from public.notifications where user_id = p_user and kind = p_kind $$;

-- AC3: the customer and the subscription are linked in either order.
select pg_temp.new_org(:'own1', null, 'AC3REG1') as a \gset
select is(pg_temp.deliver('a_checkout', 'checkout.completed', pg_temp.checkout_event(:'a', 'cus_1', 'sub_1')), 'applied', 'AC3: the checkout event is applied');
select is(pg_temp.customer_ref(:'a'), 'cus_1', 'AC3: it links the Stripe customer to the organisation');
select is(pg_temp.sub_count(:'a'), 0::bigint, 'AC3: and creates no subscription, which has no plan yet');
select is(
  pg_temp.deliver('a_sub', 'subscription.activated', pg_temp.sub_event(:'a', 'employer_starter', 'trialing', 'sub_1', '2026-12-01T10:00:00Z')),
  'applied', 'AC3: the subscription event is applied'
);
select is(
  pg_temp.sub(:'a'), 'employer_starter|trialing|cus_1|sub_1|2026-12-01T10:00|||2026-11-01T10:00',
  'AC3: checkout first: one subscription with the customer, the subscription, the plan and the status'
);
select is(pg_temp.live_count(:'a'), 1::bigint, 'AC3: and exactly one row');

select pg_temp.new_org(:'own1', null, 'AC3REG2') as b \gset
select is(
  pg_temp.deliver('b_sub', 'subscription.activated', pg_temp.sub_event(:'b', 'employer_starter', 'trialing', 'sub_1b', '2026-12-01T10:00:00Z')),
  'applied', 'AC3: subscription first: the event is applied before the customer is linked'
);
select is(pg_temp.sub(:'b'), 'employer_starter|trialing||sub_1b|2026-12-01T10:00|||2026-11-01T10:00', 'AC3: the row has no customer yet');
select is(
  pg_temp.deliver('b_checkout', 'checkout.completed', pg_temp.checkout_event(:'b', 'cus_1b', 'sub_1b')), 'applied', 'AC3: then the checkout event is applied'
);
select is(pg_temp.customer_ref(:'b'), 'cus_1b', 'AC3: the customer is linked');
select is(
  pg_temp.sub(:'b'), 'employer_starter|trialing|cus_1b|sub_1b|2026-12-01T10:00|||2026-11-01T10:00',
  'AC3: and the same single row holds the customer, the subscription, the plan and the status'
);
select is(pg_temp.sub_count(:'b'), 1::bigint, 'AC3: there is still one row');
select is(pg_temp.errors(), 0::bigint, 'AC3: no event is in error');
select pg_temp.ingest('b_checkout2', 'checkout.completed', pg_temp.checkout_event(:'b', 'cus_other', 'sub_x')) as conflicting \gset
select throws_ok(
  format($f$select public.billing_apply_event(%L)$f$, :'conflicting'), 'P0001', 'CHARA_CONFLICT', 'a second customer for an organisation is not accepted'
);
select is(pg_temp.event_status('b_checkout2'), 'received', 'and the event waits for the retry job, which raises the alert');
select is(pg_temp.customer_ref(:'b'), 'cus_1b', 'the customer is unchanged');

-- AC4: status, plan and dates are upserted; the trial grants are written once.
select pg_temp.new_org(:'own1', 'DE123456789', 'HRB99001') as o \gset
select pg_temp.new_org(:'own2', null, 'HRB99001') as o2 \gset
select pg_temp.alerts('billing_trial_repeated') as repeated \gset

select is(
  pg_temp.deliver('o_created', 'subscription.activated',
    pg_temp.sub_event(:'o', 'employer_starter', 'trialing', 'sub_o', '2026-11-04T10:00:00Z', '2026-11-04T10:00:00Z'), '2026-11-01T10:00:00Z'),
  'applied', 'AC4: subscription.activated is applied'
);
select is(pg_temp.sub(:'o'), 'employer_starter|trialing||sub_o|2026-11-04T10:00|2026-11-04T10:00||2026-11-01T10:00', 'AC4: plan, status, trial end and period end');
select is(
  (select string_agg(identifier_key, ',' order by identifier_key) from billing.trial_grants where organization_id = :'o'),
  'reg:DE:HRB99001,vat:DE123456789', 'AC4: one trial grant per identifier of the organisation'
);
select is(
  pg_temp.deliver('o_updated', 'subscription.updated',
    pg_temp.sub_event(:'o', 'employer_professional', 'active', 'sub_o', '2026-11-04T10:00:00Z', '2026-12-04T10:00:00Z'), '2026-11-02T09:00:00Z'),
  'applied', 'AC4: subscription.updated is applied'
);
select is(
  pg_temp.sub(:'o'), 'employer_professional|active||sub_o|2026-11-04T10:00|2026-12-04T10:00||2026-11-02T09:00',
  'AC4: the plan, the status and the period end change, the trial end stays, last_provider_event_at is the newest creation time'
);
select is(pg_temp.live_count(:'o'), 1::bigint, 'AC4: there is one non-canceled row');
select is((select count(*) from billing.trial_grants where organization_id = :'o'), 2::bigint, 'AC4: the trial grants are unchanged');
select is(pg_temp.alerts('billing_trial_repeated'), :'repeated'::bigint, 'AC4: and raised no alert');

select is(
  pg_temp.deliver('o2_created', 'subscription.activated',
    pg_temp.sub_event(:'o2', 'employer_starter', 'trialing', 'sub_o2', '2026-11-05T10:00:00Z'), '2026-11-02T10:00:00Z'),
  'applied', 'AC4: the same registration number starts a trial for a second organisation, which is applied'
);
select is(pg_temp.sub(:'o2'), 'employer_starter|trialing||sub_o2|2026-11-05T10:00|||2026-11-02T10:00', 'AC4: with status trialing');
select is((select count(*) from billing.trial_grants where organization_id = :'o'), 2::bigint, 'AC4: no grant row of the first organisation is changed');
select is((select count(*) from billing.trial_grants where organization_id = :'o2'), 0::bigint, 'AC4: the second organisation holds none');
select is(pg_temp.alerts('billing_trial_repeated'), :'repeated'::bigint + 1, 'AC4: and one operations alert is raised');
select is(
  (select detail ->> 'organization_id' from private.security_events where kind = 'billing_trial_repeated' order by id desc limit 1), :'o2',
  'AC4: it names the second organisation'
);

-- AC5: an event older than the stored state is stale and changes nothing.
select pg_temp.new_org(:'own1', null, 'HRB99002') as s \gset
select pg_temp.deliver('s_active', 'subscription.updated', pg_temp.sub_event(:'s', 'employer_starter', 'active', 'sub_s'), '2026-11-05T12:00:00Z') as ignored \gset
select pg_temp.applied_audit(:'s') as audits, (select count(*) from public.notifications) as mails \gset
select is(
  pg_temp.deliver('s_old', 'subscription.updated', pg_temp.sub_event(:'s', 'employer_starter', 'past_due', 'sub_s'), '2026-11-05T11:59:00Z'),
  'stale', 'AC5: an older event is reported stale'
);
select is(pg_temp.event_status('s_old'), 'stale', 'AC5: its status is stale');
select is(pg_temp.sub(:'s'), 'employer_starter|active||sub_s||||2026-11-05T12:00', 'AC5: the subscription keeps its status, and last_provider_event_at does not move back');
select is((select count(*) from public.notifications), :'mails'::bigint, 'AC5: no email is queued');
select is(pg_temp.applied_audit(:'s'), :'audits'::bigint, 'AC5: and no billing.event_applied row is written');
select is(
  pg_temp.deliver('s_old_fail', 'payment.failed', jsonb_build_object('orgId', :'s'::uuid, 'providerSubscriptionRef', 'sub_s'), '2026-11-05T11:00:00Z'),
  'stale', 'a payment failure older than the stored state is stale as well'
);
select is(pg_temp.sub(:'s'), 'employer_starter|active||sub_s||||2026-11-05T12:00', 'and does not make the subscription past due');
select is(
  pg_temp.deliver('s_equal', 'subscription.updated', pg_temp.sub_event(:'s', 'employer_professional', 'active', 'sub_s'), '2026-11-05T12:00:00Z'),
  'applied', 'an event created in the same second as the stored state is applied'
);

-- AC7: a plan that is unknown is an error and changes nothing.
select pg_temp.new_org(:'own1', null, 'HRB99003') as u \gset
select pg_temp.alerts('billing_event_error') as alerted \gset
select is(
  pg_temp.deliver('u_unknown', 'subscription.activated', pg_temp.sub_event(:'u', 'employer_gold', 'trialing', 'sub_u')),
  'error', 'AC7: a plan code that is not in billing.plans is an error'
);
select is(pg_temp.event_status('u_unknown'), 'error/unknown_plan', 'AC7: with the reason unknown_plan');
select is(
  pg_temp.deliver('u_none', 'subscription.activated', pg_temp.sub_event(:'u', null, 'trialing', 'sub_u')), 'error',
  'AC7: a price without a plan code is an error'
);
select is(pg_temp.sub_count(:'u'), 0::bigint, 'AC7: no subscription is created');
select is(pg_temp.alerts('billing_event_error'), :'alerted'::bigint + 2, 'AC7: one alert for each');
select is(
  (select detail from private.security_events where kind = 'billing_event_error' order by id desc limit 1),
  jsonb_build_object('event_id', (select id from billing.provider_events where provider_event_id = 'u_none'), 'kind', 'subscription.activated',
                     'error', 'unknown_plan', 'organization_id', :'u'::uuid),
  'AC7: the alert holds ids and the reason, no payload'
);
select is(public.billing_apply_event((select id from billing.provider_events where provider_event_id = 'u_unknown')), 'error', 'an event in error is not applied again');
select is(pg_temp.alerts('billing_event_error'), :'alerted'::bigint + 2, 'and raises no second alert');

insert into billing.plans (code, org_type, name, price_minor, currency, interval, trial_days, is_public, sort)
values ('recruitment_probe', 'recruitment_company', 'Probe', 100, 'EUR', 'month', 0, false, 99);
select is(
  pg_temp.deliver('u_type', 'subscription.activated', pg_temp.sub_event(:'u', 'recruitment_probe', 'trialing', 'sub_u')), 'error',
  'a plan of another organisation type is refused as well'
);

-- AC9: every applied event writes one audit row; the trial reminder queues one email for the owner.
select pg_temp.new_org(:'own1', null, 'HRB99004') as m \gset
select pg_temp.join_org(:'m', :'adm', 'admin');
select pg_temp.join_org(:'m', :'mem', 'member');
select pg_temp.deliver('m_checkout', 'checkout.completed', pg_temp.checkout_event(:'m', 'cus_m', 'sub_m'), '2026-11-01T10:00:00Z') as ignored \gset
select pg_temp.deliver('m_created', 'subscription.activated', pg_temp.sub_event(:'m', 'employer_starter', 'trialing', 'sub_m', '2026-11-04T10:00:00Z'), '2026-11-01T10:01:00Z') as ignored \gset
select is(
  pg_temp.deliver('m_trial_end', 'subscription.trial_will_end',
    jsonb_build_object('orgId', :'m'::uuid, 'providerSubscriptionRef', 'sub_m', 'trialEndsAt', '2026-11-04T10:00:00Z'), '2026-11-01T10:02:00Z'),
  'applied', 'AC9: subscription.trial_will_end is applied'
);
select is(pg_temp.mails(:'own1', 'trial_ending'), 1::bigint, 'AC9: it queues one trial_ending email for the owner');
select is(
  pg_temp.mails(:'adm', 'trial_ending') + pg_temp.mails(:'mem', 'trial_ending'), 0::bigint, 'AC9: and none for the admin or the member'
);
select is(
  (select payload from public.notifications where user_id = :'own1' and kind = 'trial_ending' order by created_at desc limit 1),
  jsonb_build_object('org_slug', (select slug from public.organizations where id = :'m'), 'trial_ends_at', '2026-11-04T10:00:00Z',
                     'plan_code', 'employer_starter', 'amount_minor', 3900, 'currency', 'EUR'),
  'AC9: it carries the end of the trial and the price after it'
);
select is(
  pg_temp.deliver('m_trial_end', 'subscription.trial_will_end',
    jsonb_build_object('orgId', :'m'::uuid, 'providerSubscriptionRef', 'sub_m', 'trialEndsAt', '2026-11-04T10:00:00Z'), '2026-11-01T10:02:00Z'),
  'applied', 'AC9: its duplicate is acknowledged'
);
select is(pg_temp.mails(:'own1', 'trial_ending'), 1::bigint, 'AC9: and queues none');
select pg_temp.deliver('m_updated', 'subscription.updated', pg_temp.sub_event(:'m', 'employer_starter', 'active', 'sub_m', '2026-11-04T10:00:00Z', '2026-12-04T10:00:00Z'), '2026-11-04T10:00:05Z') as ignored \gset
select is(
  pg_temp.deliver('m_failed', 'payment.failed', jsonb_build_object('orgId', :'m'::uuid, 'providerSubscriptionRef', 'sub_m', 'providerPaymentRef', 'in_1'), '2026-11-04T10:05:00Z'),
  'applied', 'AC9: payment.failed is applied'
);
select is(pg_temp.sub(:'m'), 'employer_starter|past_due|cus_m|sub_m|2026-11-04T10:00|2026-12-04T10:00|2026-11-04T10:05|2026-11-04T10:05', 'AC9: the subscription is past due since the first failure');
select is(pg_temp.mails(:'own1', 'payment_failed'), 1::bigint, 'AC9: the payment_failed email is queued for the owner');
select is(pg_temp.mails(:'adm', 'payment_failed') + pg_temp.mails(:'mem', 'payment_failed'), 0::bigint, 'AC9: and for nobody else');
select is(
  pg_temp.deliver('m_failed2', 'payment.failed', jsonb_build_object('orgId', :'m'::uuid, 'providerSubscriptionRef', 'sub_m', 'providerPaymentRef', 'in_1'), '2026-11-05T10:05:00Z'),
  'applied', 'a second failure of the same dunning period is applied'
);
select is(pg_temp.sub(:'m'), 'employer_starter|past_due|cus_m|sub_m|2026-11-04T10:00|2026-12-04T10:00|2026-11-04T10:05|2026-11-05T10:05', 'past_due_since keeps its first value');
select is(pg_temp.mails(:'own1', 'payment_failed'), 1::bigint, 'and queues no second email');
select is(
  (select payload from public.notifications where user_id = :'own1' and kind = 'payment_failed'),
  jsonb_build_object('org_slug', (select slug from public.organizations where id = :'m')), 'the email names the organisation only'
);

select is(
  pg_temp.deliver('m_paid', 'payment.succeeded', jsonb_build_object(
    'orgId', :'m'::uuid, 'providerSubscriptionRef', 'sub_m', 'purpose', 'subscription', 'subscriptionStatus', 'active', 'amountMinor', 3900,
    'taxMinor', 741, 'currency', 'EUR', 'invoiceRef', 'in_2', 'providerPaymentRef', 'pi_2'), '2026-11-06T09:00:00Z'),
  'applied', 'AC9: payment.succeeded is applied'
);
select is(pg_temp.sub(:'m'), 'employer_starter|active|cus_m|sub_m|2026-11-04T10:00|2026-12-04T10:00||2026-11-06T09:00', 'a paid invoice clears past_due_since and makes the subscription Active');
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s', kind, sku_or_plan, amount_minor, tax_minor, currency, invoice_ref, provider_ref) from billing.orders where organization_id = :'m'),
  'subscription|employer_starter|3900|741|EUR|in_2|pi_2', 'the order holds the amount, the tax, the invoice and the payment reference'
);
select is(
  pg_temp.deliver('m_paid_again', 'payment.succeeded', jsonb_build_object(
    'orgId', :'m'::uuid, 'providerSubscriptionRef', 'sub_m', 'subscriptionStatus', 'active', 'amountMinor', 3900, 'taxMinor', 741, 'currency', 'EUR',
    'invoiceRef', 'in_2', 'providerPaymentRef', 'pi_2'), '2026-11-06T09:00:30Z'),
  'applied', 'the same payment under another event id is applied'
);
select is((select count(*) from billing.orders where organization_id = :'m'), 1::bigint, 'and is one order');

select is(
  pg_temp.deliver('m_deleted', 'subscription.canceled', pg_temp.sub_event(:'m', 'employer_starter', 'canceled', 'sub_m'), '2026-11-07T09:00:00Z'),
  'applied', 'AC9: subscription.canceled is applied'
);
select is(pg_temp.sub(:'m'), 'employer_starter|canceled|cus_m|sub_m|2026-11-04T10:00|2026-12-04T10:00||2026-11-07T09:00', 'the subscription is canceled and keeps its dates');
select is(private.org_plan_code(:'m'), 'free_employer', 'the organisation falls back to the free plan');
select is(
  (select string_agg(format('%s:%s>%s', metadata ->> 'kind', coalesce(metadata ->> 'from_status', '-'), coalesce(metadata ->> 'to_status', '-')), ' ' order by id)
   from audit.log where action = 'billing.event_applied' and entity_id = :'m'),
  'checkout.completed:->- subscription.activated:->trialing subscription.trial_will_end:trialing>trialing subscription.updated:trialing>active payment.failed:active>past_due payment.failed:past_due>past_due payment.succeeded:past_due>active payment.succeeded:active>active subscription.canceled:active>canceled',
  'AC9: each applied event wrote one audit row with its kind and the status before and after'
);
select is(
  (select count(*) from audit.log where action = 'billing.event_applied' and entity_id = :'m' and entity_type = 'organization'
     and metadata ? 'event_id' and metadata ->> 'organization_id' = :'m' and actor_id is null),
  9::bigint, 'AC9: the rows are filed under the organisation, carry the event id and have no actor'
);
select is(
  pg_temp.deliver('m_late', 'subscription.updated', pg_temp.sub_event(:'m', 'employer_starter', 'active', 'sub_m'), '2026-11-06T10:00:00Z'),
  'stale', 'an update that arrives after the cancellation is stale'
);
select is(pg_temp.sub(:'m'), 'employer_starter|canceled|cus_m|sub_m|2026-11-04T10:00|2026-12-04T10:00||2026-11-07T09:00', 'and does not bring the subscription back');
select is(
  pg_temp.applied_audit(:'m'), 9::bigint, 'AC9: the duplicate, the stale event and the error event wrote no audit row'
);

-- The zero-amount invoice of a trial leaves Trialing; the lookup by customer finds an organisation whose invoice carries no metadata.
select pg_temp.new_org(:'own1', null, 'HRB99005') as t \gset
select pg_temp.deliver('t_checkout', 'checkout.completed', pg_temp.checkout_event(:'t', 'cus_t', 'sub_t')) as ignored \gset
select pg_temp.deliver('t_created', 'subscription.activated', pg_temp.sub_event(:'t', 'employer_starter', 'trialing', 'sub_t', '2026-12-01T10:00:00Z'), '2026-11-01T10:01:00Z') as ignored \gset
select is(
  pg_temp.deliver('t_zero', 'payment.succeeded', jsonb_build_object(
    'providerCustomerRef', 'cus_t', 'providerSubscriptionRef', 'sub_t', 'subscriptionStatus', 'trialing', 'amountMinor', 0, 'currency', 'EUR',
    'invoiceRef', 'in_0', 'providerPaymentRef', 'in_0'), '2026-11-01T10:02:00Z'),
  'applied', 'an invoice without organisation metadata is resolved through the customer'
);
select is(pg_temp.sub(:'t'), 'employer_starter|trialing|cus_t|sub_t|2026-12-01T10:00|||2026-11-01T10:02', 'the zero-amount invoice of the trial leaves the subscription Trialing');
select is((select count(*) from billing.orders where organization_id = :'t'), 0::bigint, 'and is no order');
select is(
  pg_temp.deliver('t_unlinked', 'payment.failed', jsonb_build_object('providerCustomerRef', 'cus_unknown', 'providerSubscriptionRef', 'sub_unknown'), '2026-11-01T10:03:00Z'),
  'received', 'an event of a customer that is not linked stays received'
);
select is(pg_temp.event_status('t_unlinked'), 'received', 'its status is received');
select is(
  pg_temp.deliver('t_noorg', 'payment.failed', jsonb_build_object('orgId', gen_random_uuid(), 'providerSubscriptionRef', 'sub_none'), '2026-11-01T10:03:00Z'),
  'received', 'so does an event of an organisation that does not exist'
);

-- A suspended organisation is still billed.
update public.organizations set status = 'suspended' where id = :'t';
select is(
  pg_temp.deliver('t_suspended', 'subscription.updated', pg_temp.sub_event(:'t', 'employer_starter', 'active', 'sub_t'), '2026-11-02T10:00:00Z'),
  'applied', 'the events of a suspended organisation are applied'
);

select throws_ok(
  $$select private.billing_audit('user.suspend', 'profile', 'x', '{}')$$, 'P0001', 'CHARA_INVALID_INPUT', 'the audit helper of billing writes billing actions only'
);
select ok(
  not has_function_privilege('authenticated', 'private.billing_audit(text, text, text, jsonb)', 'execute')
  and not has_function_privilege('service_role', 'private.billing_notify_owner(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('service_role', 'private.raise_alert(text, jsonb)', 'execute')
  and has_function_privilege('billing_owner', 'private.raise_alert(text, jsonb)', 'execute'),
  'only billing_owner reaches the audit, notification and alert helpers'
);
select throws_ok(
  $$select private.billing_notify_owner(gen_random_uuid(), 'legal_version', '{}')$$, 'P0001', 'CHARA_INVALID_INPUT', 'and queues the two billing emails only'
);

select * from finish();
rollback;
