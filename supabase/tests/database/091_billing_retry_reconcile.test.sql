begin;
select plan(50);

\ir organizations_fixture.inc
\ir billing_events_fixture.inc

-- FR-G3 AC7 (an unknown plan is never retried), AC8 (an unresolved organisation is retried every 5 minutes and escalated
-- after an hour; the jobs are scheduled), the retention of the payloads (L6), and the database side of AC12 (the
-- weekly reconciliation raises one alert per difference).

create function pg_temp.age(p_provider_event_id text, p_minutes integer) returns void
language sql as $$
  update billing.provider_events set received_at = now() - make_interval(mins => p_minutes)
  where provider = 'null' and provider_event_id = p_provider_event_id
$$;

create function pg_temp.paid_for_customer(p_customer text) returns jsonb
language sql as $$
  select jsonb_build_object(
    'providerCustomerRef', p_customer, 'providerSubscriptionRef', 'sub_' || p_customer, 'subscriptionStatus', 'active', 'amountMinor', 3900,
    'taxMinor', 0, 'currency', 'EUR', 'invoiceRef', 'in_' || p_customer, 'providerPaymentRef', 'pi_' || p_customer)
$$;

-- The jobs.
select is(
  (select format('%s|%s', schedule, command) from cron.job where jobname = 'billing-retry-events'),
  '*/5 * * * *|select billing.retry_failed_events()', 'AC8: billing.retry_failed_events() runs every 5 minutes'
);
select is(
  (select count(*) from cron.job where command like '%billing-reconcile%' and schedule = '0 4 * * 1'), 1::bigint,
  'AC8: and one weekly entry runs the reconciliation'
);
select ok(
  not has_function_privilege('anon', 'billing.retry_failed_events()', 'execute')
  and not has_function_privilege('authenticated', 'billing.retry_failed_events()', 'execute')
  and not has_function_privilege('service_role', 'billing.retry_failed_events()', 'execute'),
  'no API role can run the retry job'
);

-- AC8 case 1: the link appears before the event is an hour old.
select pg_temp.new_org(:'own1', null, 'HRB98001') as o1 \gset
select pg_temp.ingest('r1_paid', 'payment.succeeded', pg_temp.paid_for_customer('cus_r1')) as e1 \gset
select pg_temp.age('r1_paid', 15);
select is(public.billing_apply_event(:'e1'), 'received', 'AC8: an invoice event of a customer that is not linked stays received');
select pg_temp.alerts() as alerts0 \gset
select is(billing.retry_failed_events(), 1, 'AC8: the job looks at the event');
select is(pg_temp.event_status('r1_paid'), 'received', 'AC8: it stays received while the link is missing');
select is(pg_temp.deliver('r1_checkout', 'checkout.completed', pg_temp.checkout_event(:'o1', 'cus_r1')), 'applied', 'AC8: the link appears');
select is(pg_temp.event_status('r1_paid'), 'received', 'AC8: the event stays received until the next run');
select is(billing.retry_failed_events(), 1, 'AC8: the next run takes it');
select is(pg_temp.event_status('r1_paid'), 'applied', 'AC8: and it is applied');
select is(
  (select count(*) from billing.orders where organization_id = :'o1' and provider_ref = 'pi_cus_r1'), 1::bigint, 'AC8: with its effect'
);
select is(pg_temp.alerts(), :'alerts0'::bigint, 'AC8: and no alert');
select is(billing.retry_failed_events(), 0, 'a run with nothing waiting does nothing');

-- AC8 case 2: the link never appears.
select pg_temp.ingest('r2_paid', 'payment.succeeded', pg_temp.paid_for_customer('cus_r2')) as e2 \gset
select pg_temp.age('r2_paid', 5);
select billing.retry_failed_events();
select is(pg_temp.event_status('r2_paid'), 'received', 'AC8: at 5 minutes the event is still received');
select pg_temp.age('r2_paid', 55);
select billing.retry_failed_events();
select is(pg_temp.event_status('r2_paid'), 'received', 'AC8: at 55 minutes too');
select is(pg_temp.alerts(), :'alerts0'::bigint, 'AC8: without an alert');
select pg_temp.age('r2_paid', 60);
select is(billing.retry_failed_events(), 1, 'AC8: the run at 60 minutes takes it');
select is(pg_temp.event_status('r2_paid'), 'error/org_not_linked', 'AC8: and sets the status error with the reason org_not_linked');
select is(pg_temp.alerts(), :'alerts0'::bigint + 1, 'AC8: exactly one alert is raised');
select is(
  (select detail from private.security_events order by id desc limit 1),
  jsonb_build_object('event_id', :'e2'::uuid, 'kind', 'payment.succeeded', 'error', 'org_not_linked'), 'it holds ids and the reason, no payload'
);
select is(billing.retry_failed_events(), 0, 'AC8: an event in error is not taken again');
select is(pg_temp.alerts(), :'alerts0'::bigint + 1, 'AC8: and raises no second alert');

-- A failure of the application itself (an organisation with another customer already) follows the same rule.
select pg_temp.new_org(:'own1', null, 'HRB98002') as o3 \gset
select pg_temp.deliver('r3_checkout', 'checkout.completed', pg_temp.checkout_event(:'o3', 'cus_r3')) as ignored \gset
select pg_temp.ingest('r3_conflict', 'checkout.completed', pg_temp.checkout_event(:'o3', 'cus_r3_other')) as e3 \gset
select pg_temp.age('r3_conflict', 59);
select billing.retry_failed_events();
select is(pg_temp.event_status('r3_conflict'), 'received', 'AC8: a transient failure is retried while it is younger than an hour');
select pg_temp.age('r3_conflict', 61);
select billing.retry_failed_events();
select is(pg_temp.event_status('r3_conflict'), 'error/transient', 'AC8: and becomes an error with the reason transient after it');
select is(pg_temp.alerts(), :'alerts0'::bigint + 2, 'AC8: with one alert');

-- AC7: the unknown plan is not retried.
select pg_temp.new_org(:'own1', null, 'HRB98003') as o4 \gset
select pg_temp.deliver('r4_unknown', 'subscription.activated', pg_temp.sub_event(:'o4', 'employer_gold', 'trialing', 'sub_r4')) as ignored \gset
select pg_temp.alerts() as alerts1 \gset
select billing.retry_failed_events();
select billing.retry_failed_events();
select billing.retry_failed_events();
select is(pg_temp.event_status('r4_unknown'), 'error/unknown_plan', 'AC7: three runs of the job leave the event in error');
select is(pg_temp.alerts(), :'alerts1'::bigint, 'AC7: with no further alert');
select is((select count(*) from billing.subscriptions where organization_id = :'o4'), 0::bigint, 'AC7: and no subscription');

-- An operator resets an event after fixing the cause: the next run applies it.
update billing.provider_events set payload = jsonb_set(payload, '{planCode}', '"employer_starter"') where provider_event_id = 'r4_unknown';
update billing.provider_events set status = 'received', error = null where provider_event_id = 'r4_unknown' and status = 'error';
select billing.retry_failed_events();
select is(pg_temp.event_status('r4_unknown'), 'applied', 'an event that an operator reset to received is applied by the next run');

-- The run is bounded.
insert into billing.provider_events (provider, provider_event_id, kind, payload, signature_valid, provider_created_at)
select 'null', 'bulk_' || n, 'payment.failed', jsonb_build_object('providerCustomerRef', 'cus_bulk'), true, now() from generate_series(1, 105) n;
select is(billing.retry_failed_events(), 100, 'a run takes at most 100 events');

-- The setting is required.
delete from private.settings where key = 'billing_retry_alert_minutes';
select throws_ok($$select billing.retry_failed_events()$$, 'P0001', 'CHARA_SETTING_MISSING', 'the job refuses to run without its setting');
insert into private.settings (key, value) values ('billing_retry_alert_minutes', '60');

-- Retention of the payloads (L6).
select is((select days from private.retention_policies where entity = 'billing_provider_events'), 396, 'the payloads are kept 13 months by default');
update billing.provider_events set received_at = now() - interval '397 days' where provider_event_id in ('r1_paid', 'r2_paid');
update billing.provider_events set received_at = now() - interval '395 days' where provider_event_id = 'r3_conflict';
select private.apply_retention();
select is(
  (select string_agg(provider_event_id, ',' order by provider_event_id) from billing.provider_events where provider_event_id in ('r1_paid', 'r2_paid', 'r3_conflict', 'r1_checkout')),
  'r1_checkout,r3_conflict', 'events older than the period are deleted, younger ones are kept'
);
select is(
  (select metadata ->> 'days' from audit.log where action = 'retention.run' and entity_id = 'billing_provider_events' order by id desc limit 1), '396',
  'and the run is audited'
);
select is((select count(*) from billing.orders where organization_id = :'o1'), 1::bigint, 'orders are not deleted with the payloads');

-- Reconciliation: the records, and the report of the differences (AC12 is tested on the function in Deno).
insert into billing.subscriptions (organization_id, plan_code, status, provider, provider_subscription_ref)
select (pg_temp.new_org(:'own1', null, 'HRB97' || n)), 'employer_starter', case when n = 3 then 'canceled' else 'active' end, 'stripe', 'sub_rec_' || n
from generate_series(1, 4) n;
select is(
  (select count(*) from jsonb_array_elements(public.billing_reconcile_records('stripe'))), 4::bigint, 'the reconciliation reads the records of the provider'
);
select is(
  (select jsonb_array_length(public.billing_reconcile_records('stripe', null, 3))), 3, 'a page is bounded by its limit'
);
select is(
  (select jsonb_array_length(public.billing_reconcile_records('stripe', (public.billing_reconcile_records('stripe', null, 3) -> 2 ->> 'id')::uuid, 3))), 1,
  'and the next page starts after the last row of the previous one'
);
select is(
  (select r ->> 'provider_subscription_ref' from jsonb_array_elements(public.billing_reconcile_records('stripe')) r where r ->> 'status' = 'canceled'), 'sub_rec_3',
  'a canceled record is included'
);
select is(
  jsonb_array_length(public.billing_reconcile_records('null')), (select count(*)::int from billing.subscriptions where provider = 'null' and provider_subscription_ref is not null),
  'the records of the other provider are read separately'
);

select pg_temp.alerts() as before_report \gset
select is(
  public.billing_reconcile_report('stripe', 10, jsonb_build_array(
    jsonb_build_object('kind', 'missing_record', 'subscription_ref', 'sub_a'), jsonb_build_object('kind', 'extra_record', 'subscription_ref', 'sub_b'),
    jsonb_build_object('kind', 'status_mismatch', 'subscription_ref', 'sub_c'), jsonb_build_object('kind', 'plan_mismatch', 'subscription_ref', 'sub_d'))),
  4, 'the report counts the differences'
);
select is(pg_temp.alerts('billing_reconciliation_difference'), 4::bigint, 'it raises one alert per difference');
select is(
  (select string_agg(detail ->> 'difference' || ':' || (detail ->> 'subscription_ref'), ',' order by id) from private.security_events where kind = 'billing_reconciliation_difference'),
  'missing_record:sub_a,extra_record:sub_b,status_mismatch:sub_c,plan_mismatch:sub_d', 'each names its kind and the subscription'
);
select is(
  (select metadata from audit.log where action = 'billing.reconciled' order by id desc limit 1), '{"checked": 10, "differences": 4}'::jsonb, 'and writes one audit row for the run'
);
select is(public.billing_reconcile_report('stripe', 10, '[]'), 0, 'a run without differences raises no alert');
select is(pg_temp.alerts(), :'before_report'::bigint + 4, 'AC12: none');
select throws_ok(
  $$select public.billing_reconcile_report('stripe', 1, '[{"kind": "bogus", "subscription_ref": "sub_x"}]')$$, 'P0001', 'CHARA_INVALID_INPUT', 'a difference of an unknown kind is refused'
);
select ok(
  has_function_privilege('service_role', 'public.billing_reconcile_records(text, uuid, integer)', 'execute')
  and has_function_privilege('service_role', 'public.billing_reconcile_report(text, integer, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.billing_reconcile_records(text, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.billing_reconcile_report(text, integer, jsonb)', 'execute'),
  'only service_role executes the two reconciliation functions'
);

-- The KPIs as the runbook states them: events applied within 1 minute (%), and the differences per week.
insert into billing.provider_events (provider, provider_event_id, kind, payload, signature_valid, provider_created_at, received_at, status, applied_at, error)
values
  ('null', 'kpi_fast', 'payment.failed', '{}', true, '2026-01-15T10:00:00Z', '2026-01-15T10:00:00Z', 'applied', '2026-01-15T10:00:10Z', null),
  ('null', 'kpi_slow', 'payment.failed', '{}', true, '2026-01-15T10:00:00Z', '2026-01-15T10:00:00Z', 'applied', '2026-01-15T10:01:30Z', null),
  ('null', 'kpi_error', 'payment.failed', '{}', true, '2026-01-15T10:00:00Z', '2026-01-15T10:00:00Z', 'error', null, 'transient'),
  ('null', 'kpi_waiting', 'payment.failed', '{}', true, '2026-01-15T10:00:00Z', '2026-01-15T10:00:00Z', 'received', null, null),
  ('null', 'kpi_stale', 'payment.failed', '{}', true, '2026-01-15T10:00:00Z', '2026-01-15T10:00:00Z', 'stale', null, null);
select is(
  (select round(100.0 * count(*) filter (where status = 'applied' and applied_at - received_at <= interval '1 minute')
                / nullif(count(*) filter (where status in ('applied', 'error') or (status = 'received' and received_at < now() - interval '1 minute')), 0), 1)
   from billing.provider_events where date_trunc('month', received_at)::date = '2026-01-01'),
  25.0, 'KPI: the share of events applied within a minute counts errors and waiting events, not stale ones'
);
select is(
  (select count(*) from private.security_events where kind = 'billing_reconciliation_difference' and date_trunc('week', created_at)::date = date_trunc('week', now())::date),
  4::bigint, 'KPI: the differences of the week are read from the alerts'
);

select * from finish();
rollback;
