begin;
select plan(145);

\ir status_fixture.inc
\ir billing_events_fixture.inc

-- FR-G4 AC1 to AC10: the states of a subscription, the lapse and what a lapsed or a downgraded organisation may do
-- (ARCHITECTURE.md sections 10.1, 10.3, 10.4). The events are those of the null provider, applied the way the webhook does.

\set plat '00000000-0000-0000-0000-00000000a031'
select pg_temp.new_user(:'plat');
update public.profiles set account_kind = intended_account_kind where id = :'plat';
insert into public.platform_staff (user_id, role) values (:'plat', 'admin');

create function pg_temp.sub_row(p_org uuid) returns text
language sql as $$
  select format('%s|%s|%s|%s', status, plan_code, coalesce(to_char(past_due_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'), '-'),
    coalesce(to_char(cancel_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'), '-'))
  from billing.subscriptions where organization_id = p_org order by (status = 'canceled'), created_at desc limit 1
$$;

create function pg_temp.owner_of(p_org uuid) returns uuid
language sql as $$ select user_id from public.organization_members where organization_id = p_org and role = 'owner' $$;

create function pg_temp.activate(p_org uuid, p_sub text, p_status text, p_at timestamptz, p_plan text default 'employer_starter', p_trial text default null) returns text
language sql as $$
  select pg_temp.deliver('act_' || p_sub, 'subscription.activated', pg_temp.sub_event(p_org, p_plan, p_status, p_sub, p_trial), p_at)
$$;

create function pg_temp.fail(p_org uuid, p_sub text, p_at timestamptz, p_id text) returns text
language sql as $$
  select pg_temp.deliver(p_id, 'payment.failed', jsonb_build_object('orgId', p_org, 'providerSubscriptionRef', p_sub, 'providerPaymentRef', 'in_' || p_id), p_at)
$$;

create function pg_temp.pay(p_org uuid, p_sub text, p_at timestamptz, p_id text, p_amount integer default 3900, p_status text default 'active', p_ref text default null) returns text
language sql as $$
  select pg_temp.deliver(p_id, 'payment.succeeded', jsonb_build_object(
    'orgId', p_org, 'providerSubscriptionRef', p_sub, 'purpose', 'subscription', 'subscriptionStatus', p_status, 'amountMinor', p_amount,
    'taxMinor', case when p_amount > 0 then 741 else 0 end, 'currency', 'EUR', 'invoiceRef', 'in_' || coalesce(p_ref, p_id), 'providerPaymentRef', 'pi_' || coalesce(p_ref, p_id)), p_at)
$$;

create function pg_temp.applied_audit_rows(p_org uuid) returns text
language sql as $$
  select string_agg(format('%s:%s>%s', metadata ->> 'kind', coalesce(metadata ->> 'from_status', '-'), coalesce(metadata ->> 'to_status', '-')), ' ' order by id)
  from audit.log where action = 'billing.event_applied' and entity_id = p_org::text
$$;

-- AC1: a trial starts and stays Trialing after the zero-amount invoice.
select pg_temp.new_org(:'own1') as o1 \gset
select is(pg_temp.activate(:'o1', 'sub_1', 'trialing', '2026-10-05T10:00:00Z', 'employer_starter', '2026-11-04T10:00:00Z'), 'applied', 'AC1: subscription.activated for a trial is applied');
select is(pg_temp.sub_row(:'o1'), 'trialing|employer_starter|-|-', 'AC1: the status is trialing before the invoice event');
select is(pg_temp.pay(:'o1', 'sub_1', '2026-10-05T10:00:05Z', 'trial_inv', 0, 'trialing'), 'applied', 'AC1: payment.succeeded for the zero-amount trial invoice is applied');
select is(pg_temp.sub_row(:'o1'), 'trialing|employer_starter|-|-', 'AC1: the status is trialing after it');
select is((select trial_ends_at from billing.subscriptions where organization_id = :'o1'), '2026-11-04T10:00:00Z'::timestamptz, 'AC1: trial_ends_at is the end of the trial');
select is(private.org_plan_code(:'o1'), 'employer_starter', 'AC1: the organisation is on employer_starter');
select is(private.org_limit(:'o1', 'active_jobs'), 3, 'AC1: and has the active_jobs limit of the plan');
select is((select count(*) from billing.orders where organization_id = :'o1'), 0::bigint, 'AC1: the zero-amount invoice wrote no order');
select is(pg_temp.applied_audit_rows(:'o1'), 'subscription.activated:->trialing payment.succeeded:trialing>trialing', 'AC1: two billing.event_applied rows exist, the first from no status to trialing');

-- AC2: a paid invoice makes a subscription Active and writes one order.
select pg_temp.new_org(:'own1') as s1 \gset
select pg_temp.new_org(:'own1') as s2 \gset
select pg_temp.activate(:'s1', 'sub_s1', 'trialing', '2026-10-05T10:00:00Z', 'employer_starter', '2026-11-04T00:00:00Z') as ignored \gset
select pg_temp.activate(:'s2', 'sub_s2', 'active', '2026-10-05T10:00:00Z') as ignored \gset
select pg_temp.fail(:'s2', 'sub_s2', '2026-11-04T12:00:00Z', 's2_failed') as ignored \gset
select is(pg_temp.sub_row(:'s2'), 'past_due|employer_starter|2026-11-04T12:00|-', 'AC2: setup: S2 is past due since 2026-11-04T12:00Z');
select is(
  pg_temp.deliver('s1_active', 'subscription.updated', pg_temp.sub_event(:'s1', 'employer_starter', 'active', 'sub_s1'), '2026-11-04T00:00:10Z'),
  'applied', 'AC2: subscription.updated (active) is applied for S1'
);
select is(pg_temp.pay(:'s1', 'sub_s1', '2026-11-04T00:01:00Z', 's1_paid'), 'applied', 'AC2: payment.succeeded is applied for S1');
select is(pg_temp.pay(:'s2', 'sub_s2', '2026-11-05T09:00:00Z', 's2_paid'), 'applied', 'AC2: payment.succeeded is applied for S2');
select is(pg_temp.sub_row(:'s1'), 'active|employer_starter|-|-', 'AC2: S1 is active and has no past_due_since');
select is(pg_temp.sub_row(:'s2'), 'active|employer_starter|-|-', 'AC2: S2 is active and past_due_since is cleared');
select is(
  (select string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s', organization_id = :'s1', kind, sku_or_plan, amount_minor, tax_minor, currency, provider_ref, invoice_ref, 'paid'), ';' order by provider_ref)
   from billing.orders where organization_id in (:'s1', :'s2')),
  't|subscription|employer_starter|3900|741|EUR|pi_s1_paid|in_s1_paid|paid;f|subscription|employer_starter|3900|741|EUR|pi_s2_paid|in_s2_paid|paid',
  'AC2: each payment wrote one order of kind subscription with the plan, the amounts, the currency and the references of the event'
);
select is(pg_temp.pay(:'s1', 'sub_s1', '2026-11-04T00:01:00Z', 's1_paid'), 'applied', 'AC2: replaying the event of S1 is acknowledged');
select is(pg_temp.pay(:'s2', 'sub_s2', '2026-11-05T09:00:00Z', 's2_paid'), 'applied', 'AC2: replaying the event of S2 is acknowledged');
select is(pg_temp.pay(:'s2', 'sub_s2', '2026-11-05T09:00:30Z', 's2_paid_again', 3900, 'active', 's2_paid'), 'applied', 'AC2: the same payment under another event id is applied');
select is((select count(*) from billing.orders where organization_id in (:'s1', :'s2')), 2::bigint, 'AC2: the replays wrote no second order');

-- AC3: the failed-payment email once for each dunning period.
select pg_temp.new_org(:'own1') as o3 \gset
select pg_temp.join_org(:'o3', :'adm', 'admin') as ignored \gset
select pg_temp.join_org(:'o3', :'mem', 'member') as ignored \gset
select pg_temp.new_org(:'own2') as t3 \gset
insert into public.notification_preferences (user_id, digest) values (:'own1', true) on conflict (user_id) do update set digest = true;
select pg_temp.activate(:'o3', 'sub_o3', 'active', '2026-11-01T00:00:00Z') as ignored \gset
select pg_temp.activate(:'t3', 'sub_t3', 'trialing', '2026-11-01T00:00:00Z', 'employer_starter', '2026-12-01T00:00:00Z') as ignored \gset
create function pg_temp.mails_of(p_org uuid) returns bigint
language sql as $$ select count(*) from public.notifications where kind = 'payment_failed' and payload ->> 'org_slug' = (select slug from public.organizations where id = p_org) $$;
select is(pg_temp.fail(:'o3', 'sub_o3', '2026-11-10T12:00:00Z', 'o3_f1'), 'applied', 'AC3: payment.failed at T is applied');
select is(pg_temp.sub_row(:'o3'), 'past_due|employer_starter|2026-11-10T12:00|-', 'AC3: the status is past_due and past_due_since is T');
select is(pg_temp.fail(:'o3', 'sub_o3', '2026-11-13T12:00:00Z', 'o3_f2'), 'applied', 'AC3: payment.failed at T + 3 days is applied');
select is(pg_temp.sub_row(:'o3'), 'past_due|employer_starter|2026-11-10T12:00|-', 'AC3: past_due_since stays T');
select is(pg_temp.mails_of(:'o3'), 1::bigint, 'AC3: exactly one payment_failed notification exists after the two events');
select is(
  (select format('%s|%s|%s', n.user_id, n.status, n.payload) from public.notifications n where n.kind = 'payment_failed' and n.payload ->> 'org_slug' = (select slug from public.organizations where id = :'o3')),
  format('%s|queued|%s', :'own1', jsonb_build_object('org_slug', (select slug from public.organizations where id = :'o3'))),
  'AC3: it is queued for the owner only, with the slug of the organisation that builds the link to the billing page, whatever the owner''s summary setting'
);
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'kind' = 'payment_failed' and message ->> 'organization_id' = :'o3' and (message ->> 'mandatory')::boolean),
  1::bigint, 'AC3: the kind is mandatory'
);
select is(
  (select count(*) from public.notifications where kind = 'payment_failed' and user_id in (:'adm', :'mem')), 0::bigint,
  'AC3: the administrator and the member get none'
);
select is(pg_temp.pay(:'o3', 'sub_o3', '2026-11-14T12:00:00Z', 'o3_p1'), 'applied', 'AC3: payment.succeeded (active) is applied');
select is(pg_temp.sub_row(:'o3'), 'active|employer_starter|-|-', 'AC3: the subscription is active again');
select is(pg_temp.fail(:'o3', 'sub_o3', '2026-12-10T12:00:00Z', 'o3_f3'), 'applied', 'AC3: payment.failed at T + 30 days is applied');
select is(pg_temp.sub_row(:'o3'), 'past_due|employer_starter|2026-12-10T12:00|-', 'AC3: past_due_since is T + 30 days');
select is(pg_temp.mails_of(:'o3'), 2::bigint, 'AC3: the total is 2 notifications');
select is(pg_temp.fail(:'t3', 'sub_t3', '2026-11-20T12:00:00Z', 't3_f1'), 'applied', 'AC3: payment.failed for the trialing subscription is applied');
select is(pg_temp.sub_row(:'t3'), 'past_due|employer_starter|2026-11-20T12:00|-', 'AC3: the trialing subscription also becomes past_due');

-- AC4: the grace period is driven by Stripe, never by a local timer.
create temp table t_g as select pg_temp.org_on('employer_starter', 'past_due') as org;
update billing.subscriptions set past_due_since = '2026-11-04T12:00:00Z' where organization_id = (select org from t_g);
select pg_temp.seed_job('{"title": "Grace vacancy", "status": "open"}', (select org from t_g)) as g_job \gset
select pg_temp.seed_app('applied', (select org from t_g)) as g_app \gset
select pg_temp.sub_row((select org from t_g)) as g_before \gset
select count(*) as g_security_before from private.security_events where kind = 'billing_past_due_overdue' \gset
select is(billing.check_past_due_overdue('2026-11-10T00:00:00Z'), 0, 'AC4: on 2026-11-10 the check raises nothing');
select is(private.org_plan_code((select org from t_g)), 'employer_starter', 'AC4: on 2026-11-10 the organisation keeps its plan');
select is((select status from public.jobs where id = :'g_job'), 'open', 'AC4: and its vacancy stays open');
select is(pg_temp.set_as(pg_temp.member_of((select org from t_g)), :'g_app', 'interview'), 'ok', 'AC4: and an application status can be set');
select is(billing.check_past_due_overdue('2026-11-12T12:00:00Z'), 0, 'AC4: at the end of the day after the grace period the check raises nothing yet');
select is(pg_temp.sub_row((select org from t_g)), :'g_before', 'AC4: on 2026-11-12 the status is still past_due and nothing changed it');
select is(billing.check_past_due_overdue('2026-11-12T13:00:00Z'), 1, 'AC4: the run at 13:00 raises one alert');
select is(billing.check_past_due_overdue('2026-11-12T14:00:00Z'), 0, 'AC4: the run at 14:00 raises none');
select is(
  (select count(*) from private.security_events where kind = 'billing_past_due_overdue' and detail ->> 'organization_id' = (select org::text from t_g)
     and detail ->> 'subscription_id' = (select id::text from billing.subscriptions where organization_id = (select org from t_g))
     and detail ->> 'past_due_since' = '2026-11-04T12:00:00.000000Z'),
  1::bigint, 'AC4: the alert names the subscription and past_due_since, nothing else'
);
select is((select count(*) from private.security_events where kind = 'billing_past_due_overdue'), :'g_security_before'::bigint + 1, 'AC4: and it is the only new alert');
select is(pg_temp.sub_row((select org from t_g)), :'g_before', 'AC4: the subscription is unchanged after the runs');
select is((select status from public.jobs where id = :'g_job'), 'open', 'AC4: and so is the vacancy');
select is(pg_temp.status_of(:'g_app'), 'interview', 'AC4: and the application');
select is((select count(*) from cron.job where jobname = 'billing-past-due-overdue' and schedule ~ '^\d+ \d+ \* \* \*$' and command = 'select billing.check_past_due_overdue()'), 1::bigint, 'AC4: cron.job holds one daily entry for the check');
select is((select count(*) from cron.job where command ~ 'check_past_due_overdue'), 1::bigint, 'AC4: and no other');
update billing.subscriptions set past_due_since = '2026-12-04T12:00:00Z' where organization_id = (select org from t_g);
select billing.check_past_due_overdue('2026-12-12T13:00:00Z') as ignored \gset
select is(
  (select count(*) from private.security_events where kind = 'billing_past_due_overdue' and detail ->> 'organization_id' = (select org::text from t_g)),
  2::bigint, 'AC4: a new dunning period (another past_due_since) is alerted again, once'
);
select ok(
  not has_function_privilege('anon', 'billing.check_past_due_overdue(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'billing.check_past_due_overdue(timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'billing.check_past_due_overdue(timestamptz)', 'execute'),
  'AC4: no API role can run the check'
);
select billing.check_past_due_overdue('2030-01-01T00:00:00Z') as ignored \gset
select billing.check_past_due_overdue('2030-01-01T00:00:00Z') as ignored \gset
create temp table t_many as select pg_temp.org_on('employer_starter', 'past_due') as org, n from generate_series(1, 101) as n;
update billing.subscriptions s set past_due_since = '2029-01-01T00:00:00Z'::timestamptz + make_interval(days => m.n)
from t_many m where s.organization_id = m.org;
select is(billing.check_past_due_overdue('2030-01-01T00:00:00Z'), 100, 'AC4: with 101 overdue subscriptions a run raises 100 alerts');
select is(
  (select count(*) from private.security_events e join t_many m on e.detail ->> 'organization_id' = m.org::text
   where e.kind = 'billing_past_due_overdue' and m.n = 1),
  1::bigint, 'AC4: and the first run alerted the oldest by past_due_since'
);
select is(
  (select count(*) from private.security_events e join t_many m on e.detail ->> 'organization_id' = m.org::text
   where e.kind = 'billing_past_due_overdue' and m.n = 101),
  0::bigint, 'AC4: and left the newest for the next run'
);
select is(billing.check_past_due_overdue('2030-01-01T00:00:00Z'), 1, 'AC4: the next run raises the one left');
select is(
  (select count(*) from private.security_events e join t_many m on e.detail ->> 'organization_id' = m.org::text
   where e.kind = 'billing_past_due_overdue' and m.n = 101),
  1::bigint, 'AC4: and it is the newest'
);

-- AC5: only the deleted event cancels.
select set_config('request.headers', json_build_object('x-request-id', '7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11')::text, true) as ignored \gset
select pg_temp.new_org(:'own1') as o5 \gset
select pg_temp.new_org(:'own1') as none5 \gset
create temp table t_only_canceled as select pg_temp.org_on('employer_starter', 'canceled') as org;
select pg_temp.activate(:'o5', 'sub_o5', 'active', '2026-11-01T00:00:00Z') as ignored \gset
select is(
  pg_temp.deliver('o5_cancel_at', 'subscription.updated',
    pg_temp.sub_event(:'o5', 'employer_starter', 'active', 'sub_o5') || '{"cancelAt": "2026-12-04T00:00:00Z"}', '2026-11-02T00:00:00Z'),
  'applied', 'AC5: subscription.updated with cancel_at and status active is applied'
);
select is(pg_temp.sub_row(:'o5'), 'active|employer_starter|-|2026-12-04T00:00', 'AC5: the status stays active and cancel_at is stored');
select is(private.org_plan_code(:'o5'), 'employer_starter', 'AC5: plan rights are unchanged');
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', format('select public.suspend_organization(%L, %L)', :'o5', 'The company details are false and misleading.'), 'aal2'),
  'ok', 'AC5: the organisation is suspended'
);
select is(pg_temp.sub_row(:'o5'), 'active|employer_starter|-|2026-12-04T00:00', 'AC5: the suspension leaves the subscription unchanged');
select is(private.org_plan_code(:'o5'), 'employer_starter', 'AC5: and its plan');
select is(
  pg_temp.deliver('o5_deleted', 'subscription.canceled', pg_temp.sub_event(:'o5', 'employer_starter', 'canceled', 'sub_o5'), '2026-11-03T00:00:00Z'),
  'applied', 'AC5: subscription.deleted is applied'
);
select is(pg_temp.sub_row(:'o5'), 'canceled|employer_starter|-|-', 'AC5: the status is canceled');
select is((select count(*) from billing.subscriptions where organization_id = :'o5'), 1::bigint, 'AC5: and the row is kept');
select is(private.org_plan_code(:'o5'), 'free_employer', 'AC5: the organisation falls back to free_employer');
select is(private.org_plan_code(:'none5'), 'free_employer', 'AC5: an organisation with no row resolves to free_employer');
select is(private.org_plan_code((select org from t_only_canceled)), 'free_employer', 'AC5: so does one with only canceled rows, never null');

-- AC6: the lapse pauses the open vacancies in the same transaction.
select pg_temp.new_org(:'own1') as o6 \gset
select pg_temp.new_org(:'own2') as x6 \gset
select pg_temp.new_org(:'own1') as f6 \gset
select pg_temp.activate(:'o6', 'sub_o6', 'active', '2026-11-01T00:00:00Z') as ignored \gset
select pg_temp.activate(:'x6', 'sub_x6', 'active', '2026-11-01T00:00:00Z') as ignored \gset
select pg_temp.activate(:'f6', 'sub_f6', 'active', '2026-11-01T00:00:00Z') as ignored \gset
select pg_temp.seed_job(format('{"title": "O open %s", "status": "open"}', n)::jsonb, :'o6') from generate_series(1, 3) n;
select pg_temp.seed_job('{"title": "O open hidden", "status": "open", "moderation_state": "hidden"}', :'o6');
select pg_temp.seed_job('{"title": "O draft"}', :'o6');
select pg_temp.seed_job('{"title": "O closed", "status": "closed"}', :'o6');
select pg_temp.seed_job('{"title": "O filled", "status": "filled"}', :'o6');
select pg_temp.seed_job('{"title": "O paused", "status": "paused"}', :'o6');
select pg_temp.seed_job(format('{"title": "X open %s", "status": "open"}', n)::jsonb, :'x6') from generate_series(1, 2) n;
select pg_temp.seed_job('{"title": "F open", "status": "open"}', :'f6');
create function pg_temp.job_states(p_org uuid) returns text
language sql as $$ select string_agg(title || ':' || status || ':' || moderation_state, ',' order by title) from public.jobs where organization_id = p_org $$;
select pg_temp.job_states(:'o6') as o6_before \gset
select pg_temp.job_states(:'x6') as x6_before \gset
select is(
  pg_temp.deliver('o6_deleted', 'subscription.canceled', pg_temp.sub_event(:'o6', 'employer_starter', 'canceled', 'sub_o6'), '2026-11-05T00:00:00Z'),
  'applied', 'AC6: subscription.deleted is applied'
);
select is(
  pg_temp.job_states(:'o6'),
  'O closed:closed:visible,O draft:draft:visible,O filled:filled:visible,O open 1:paused:visible,O open 2:paused:visible,O open 3:paused:visible,O open hidden:paused:hidden,O paused:paused:visible',
  'AC6: the 4 open vacancies became paused, the other 3 are unchanged and moderation_state is untouched'
);
select is(
  (select count(*) from audit.log where action = 'job.status_changed' and entity_type = 'job' and metadata ->> 'organization_id' = :'o6'
     and metadata ->> 'from' = 'open' and metadata ->> 'to' = 'paused' and metadata ->> 'actor_fn' = 'pause_jobs_on_lapse'),
  4::bigint, 'AC6: 4 audit rows were written, from open to paused, made by pause_jobs_on_lapse'
);
select is((select count(*) from audit.log where action = 'job.status_changed' and metadata ->> 'organization_id' = :'o6'), 4::bigint, 'AC6: and no other status change of the organisation');
select is(pg_temp.job_states(:'x6'), :'x6_before', 'AC6: the vacancies of the other organisation are untouched');
select is(pg_temp.applied_audit(:'o6'), 2::bigint, 'AC6: the lapse is audited as the event: activated, then canceled');
create function pg_temp.refuse_pause() returns trigger language plpgsql as $$ begin raise exception 'pause is down'; end $$;
create trigger refuse_pause before update of status on public.jobs for each row when (new.status = 'paused') execute function pg_temp.refuse_pause();
select pg_temp.ingest('f6_deleted', 'subscription.canceled', pg_temp.sub_event(:'f6', 'employer_starter', 'canceled', 'sub_f6'), '2026-11-05T00:00:00Z') as f6_event \gset
select throws_ok(format('select public.billing_apply_event(%L)', :'f6_event'), 'P0001', 'pause is down', 'AC6: when the pause fails the application of the event fails');
select is(pg_temp.sub_row(:'f6'), 'active|employer_starter|-|-', 'AC6: the subscription status stays unchanged');
select is(pg_temp.event_status('f6_deleted'), 'received', 'AC6: and the event is not applied');
select is(pg_temp.job_states(:'f6'), 'F open:open:visible', 'AC6: and its vacancy is still open');
select is(pg_temp.applied_audit(:'f6'), 1::bigint, 'AC6: and the cancellation wrote no audit row');
drop trigger refuse_pause on public.jobs;
select is(public.billing_apply_event(:'f6_event'::uuid), 'applied', 'AC6: without the failure the retry applies the event');
select is(pg_temp.job_states(:'f6'), 'F open:paused:visible', 'AC6: and pauses the vacancy');

-- AC7: a lapsed organisation is read-only for the employer, and withdrawal stays open.
create temp table t_l as select pg_temp.org_on('employer_starter', 'canceled') as org;
select pg_temp.owner_of((select org from t_l)) as l_owner \gset
select pg_temp.member_of((select org from t_l)) as l_member \gset
select pg_temp.seed_app('applied', (select org from t_l)) as l_applied \gset
select pg_temp.seed_app('interview', (select org from t_l)) as l_interview \gset
select pg_temp.seed_app('hired', (select org from t_l)) as l_hired \gset
insert into public.application_notes (application_id, organization_id, author_id, body) values (:'l_applied', (select org from t_l), :'l_member', 'Earlier note');
create function pg_temp.note_as(p_user uuid, p_app uuid, p_org uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('insert into public.application_notes (application_id, organization_id, body) values (%L, %L, %L)', p_app, p_org, 'New note'), 'aal1')
$$;
create function pg_temp.withdraw_as(p_user uuid, p_app uuid) returns text
language sql as $$ select pg_temp.call_as(p_user, 'authenticated', format('select public.withdraw_application(%L)', p_app), 'aal1') $$;
create function pg_temp.lapse_counts() returns text
language sql as $$ select pg_temp.status_counts() || ',' || (select count(*) from public.application_notes) $$;
select pg_temp.lapse_counts() as l_before \gset
select is(private.org_plan_code((select org from t_l)), 'free_employer', 'AC7: setup: the organisation is lapsed');
select is((select (value #>> '{}')::boolean from private.settings where key = 'entitlements_enforced'), false, 'AC7: setup: entitlements_enforced is false');
select is(pg_temp.set_as(:'l_member', :'l_applied', 'shortlisted'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC7: a member is refused a status change');
select is(pg_temp.set_as(:'l_owner', :'l_applied', 'shortlisted'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC7: the owner is refused a status change');
select is(pg_temp.bulk_as(:'l_member', array[:'l_applied'::uuid], 'shortlisted'), to_jsonb('P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan'::text), 'AC7: a member is refused a bulk call');
select is(pg_temp.bulk_as(:'l_owner', array[:'l_applied'::uuid], 'shortlisted'), to_jsonb('P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan'::text), 'AC7: the owner is refused a bulk call');
select is(pg_temp.note_as(:'l_member', :'l_applied', (select org from t_l)), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC7: a member is refused a note');
select is(pg_temp.note_as(:'l_owner', :'l_applied', (select org from t_l)), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC7: the owner is refused a note');
select is(pg_temp.viewed_as(:'l_member', :'l_applied'), 'ok', 'AC7: opening the applied application raises nothing');
select is(pg_temp.status_of(:'l_applied'), 'applied', 'AC7: and does not set viewed');
select is(pg_temp.lapse_counts(), :'l_before', 'AC7: the refused calls wrote no application event, no email, no note and no audit row');
select is(
  pg_temp.json_as(:'l_member', format('select id from public.job_applications where organization_id = %L order by id', (select org from t_l))),
  (select jsonb_agg(jsonb_build_object('id', id) order by id) from (values (:'l_applied'::uuid), (:'l_interview'::uuid), (:'l_hired'::uuid)) v (id)),
  'AC7: a member reads all 3 applications'
);
select is(
  pg_temp.json_as(:'l_member', format('select body from public.application_notes where application_id = %L', :'l_applied')),
  '[{"body": "Earlier note"}]'::jsonb, 'AC7: and the earlier note'
);
select is(pg_temp.withdraw_as(:'wa', :'l_applied'), 'ok', 'AC7: the candidate withdraws');
select is(pg_temp.status_of(:'l_applied'), 'withdrawn', 'AC7: the application is withdrawn');
select is((select revoked_at is not null from public.passport_shares where application_id = :'l_applied'), true, 'AC7: and its share is revoked');
select is(pg_temp.queued_for(:'l_applied'), 1::bigint, 'AC7: and a status_changed email is queued');
select is((select user_id from public.notifications where payload ->> 'application_id' = :'l_applied' limit 1), :'wa'::uuid, 'AC7: for the candidate');
select is((select count(*) from public.job_applications where organization_id = (select org from t_l)), 3::bigint, 'AC7: no application row is deleted');

-- AC8: free_employer restrictions follow the setting for an organisation that never subscribed.
create temp table t_l8 as select pg_temp.org_on('employer_starter', 'canceled') as org;
create temp table t_n8 as select pg_temp.org_on() as org;
select pg_temp.owner_of((select org from t_l8)) as l8_owner \gset
select pg_temp.owner_of((select org from t_n8)) as n8_owner \gset
select pg_temp.seed_job('{"title": "L paused", "status": "paused"}', (select org from t_l8)) as l8_job \gset
select pg_temp.seed_job('{"title": "N draft one"}', (select org from t_n8)) as n8_job1 \gset
select pg_temp.seed_job('{"title": "N draft two"}', (select org from t_n8)) as n8_job2 \gset
select pg_temp.seed_app('applied', (select org from t_n8)) as n8_app1 \gset
select pg_temp.seed_app('applied', (select org from t_n8)) as n8_app2 \gset
create function pg_temp.invite_as(p_user uuid, p_org uuid, p_email text) returns text
language sql as $$ select pg_temp.call_as(p_user, 'authenticated', format('select public.invite_member(%L, %L, ''member'')', p_org, p_email), 'aal2') $$;
select is(pg_temp.set_status(:'l8_owner', :'l8_job', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'AC8: with the setting false the lapsed owner cannot reopen the paused vacancy');
select is(pg_temp.invite_as(:'l8_owner', (select org from t_l8), 'l8@example.test'), 'P0001|CHARA_LIMIT_REACHED|members', 'AC8: nor invite a member');
select is(pg_temp.set_as(:'n8_owner', :'n8_app1', 'shortlisted'), 'ok', 'AC8: with the setting false the owner of the organisation that never subscribed shortlists');
select is(pg_temp.set_status(:'n8_owner', :'n8_job1', 'open'), 'ok', 'AC8: opens a vacancy');
select is(pg_temp.invite_as(:'n8_owner', (select org from t_n8), 'n8a@example.test'), 'ok', 'AC8: and invites a member');
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.set_as(:'n8_owner', :'n8_app2', 'shortlisted'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC8: with the setting true the same owner is refused a status change');
select is(pg_temp.set_status(:'n8_owner', :'n8_job2', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'AC8: is refused a vacancy');
select is(pg_temp.invite_as(:'n8_owner', (select org from t_n8), 'n8b@example.test'), 'P0001|CHARA_LIMIT_REACHED|members', 'AC8: and an invitation');
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- AC9: checkout is available only without a live subscription, and there is one live subscription at most.
insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
values ('subscription-and-billing-terms', 1, 'Subscription and Billing Terms', 'Version one.', 'First approved text of the terms.', now() - interval '1 day');
select set_config('t.terms', private.current_legal_version('subscription-and-billing-terms')::text, true) as ignored \gset
create function pg_temp.checkout_as(p_user uuid, p_org uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.result', (select row_to_json(r)::text from public.billing_checkout_start(%L, 'employer_starter', 'DE', 'DE123456789', 'HRB 12345', %s) r), true)$f$, p_org, current_setting('t.terms')), 'aal2')
$$;
select pg_temp.new_org(:'own1') as c_trial \gset
select pg_temp.new_org(:'own1') as c_active \gset
select pg_temp.new_org(:'own1') as c_due \gset
select pg_temp.new_org(:'own1') as c_canceled \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at) values
  (:'c_trial', 'employer_starter', 'trialing', 'null', now() + interval '10 days'),
  (:'c_active', 'employer_starter', 'active', 'null', null),
  (:'c_due', 'employer_starter', 'past_due', 'null', null),
  (:'c_canceled', 'employer_starter', 'canceled', 'null', now() - interval '60 days');
select is(pg_temp.checkout_as(:'own1', :'c_trial'), 'P0001|CHARA_FORBIDDEN|already_subscribed', 'AC9: checkout is refused for a trialing subscription');
select is(pg_temp.checkout_as(:'own1', :'c_active'), 'P0001|CHARA_FORBIDDEN|already_subscribed', 'AC9: for an active one');
select is(pg_temp.checkout_as(:'own1', :'c_due'), 'P0001|CHARA_FORBIDDEN|already_subscribed', 'AC9: for a past due one');
select is(pg_temp.checkout_as(:'own1', :'c_canceled'), 'ok', 'AC9: checkout is allowed for the organisation whose subscription is canceled');
select is((current_setting('t.result')::jsonb ->> 'trial_days')::integer, 0, 'AC9: and it has no trial when it had one');
select throws_ok(
  format($$insert into billing.subscriptions (organization_id, plan_code, status, provider) values (%L, 'employer_starter', 'trialing', 'null')$$, :'c_trial'),
  '23505', null, 'AC9: a second non-canceled row for the trialing organisation is rejected'
);
select throws_ok(
  format($$insert into billing.subscriptions (organization_id, plan_code, status, provider) values (%L, 'employer_starter', 'canceled', 'null'), (%L, 'employer_starter', 'active', 'null')$$, :'c_canceled', :'c_active'),
  '23505', null, 'AC9: a second non-canceled row for the active organisation is rejected'
);
select throws_ok(
  format($$insert into billing.subscriptions (organization_id, plan_code, status, provider) values (%L, 'employer_starter', 'active', 'null')$$, :'c_due'),
  '23505', null, 'AC9: a second non-canceled row for the past due organisation is rejected'
);
select lives_ok(
  format($$insert into billing.subscriptions (organization_id, plan_code, status, provider) values (%L, 'employer_starter', 'canceled', 'null'), (%L, 'employer_starter', 'canceled', 'null')$$, :'c_canceled', :'c_canceled'),
  'AC9: any number of canceled rows are accepted'
);

-- AC10: limits after a reactivation and after a downgrade keep the data.
update private.settings set value = 'true' where key = 'entitlements_enforced';
create temp table t_r as select pg_temp.org_on('employer_starter', 'canceled') as org;
select pg_temp.owner_of((select org from t_r)) as r_owner \gset
select pg_temp.seed_job(format('{"title": "R paused %s", "status": "paused"}', n)::jsonb, (select org from t_r)) as r_job from generate_series(1, 4) n;
select array_agg(id order by title) as r_jobs from public.jobs where organization_id = (select org from t_r) \gset
select pg_temp.seed_app('applied', (select org from t_r)) as r_app \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values ((select org from t_r), 'employer_starter', 'active', 'null');
select is((select count(*) from billing.subscriptions where organization_id = (select org from t_r)), 2::bigint, 'AC10: setup: the old canceled row is kept next to the new subscription');
select is(pg_temp.set_status(:'r_owner', (:'r_jobs'::uuid[])[1], 'open'), 'ok', 'AC10: the first paused vacancy reopens');
select is(pg_temp.set_status(:'r_owner', (:'r_jobs'::uuid[])[2], 'open'), 'ok', 'AC10: the second reopens');
select is(pg_temp.set_status(:'r_owner', (:'r_jobs'::uuid[])[3], 'open'), 'ok', 'AC10: the third reopens');
select is(pg_temp.set_status(:'r_owner', (:'r_jobs'::uuid[])[4], 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'AC10: the fourth is refused by the limit of employer_starter');
select is(pg_temp.set_as(pg_temp.member_of((select org from t_r)), :'r_app', 'interview'), 'ok', 'AC10: set_application_status works again');

select pg_temp.new_org(:'own2') as p10 \gset
select pg_temp.activate(:'p10', 'sub_p10', 'active', '2026-11-01T00:00:00Z', 'employer_professional') as ignored \gset
select pg_temp.seed_job(format('{"title": "P open %s", "status": "open"}', n)::jsonb, :'p10') from generate_series(1, 5) n;
select pg_temp.seed_job('{"title": "P draft"}', :'p10') as p_draft \gset
select array_agg(id order by title) as p_jobs from public.jobs where organization_id = :'p10' and status = 'open' \gset
select count(*) as pause_rows_before from audit.log where action = 'job.status_changed' and metadata ->> 'actor_fn' = 'pause_jobs_on_lapse' \gset
select is(
  pg_temp.deliver('p10_down', 'subscription.updated', pg_temp.sub_event(:'p10', 'employer_starter', 'active', 'sub_p10'), '2026-11-06T00:00:00Z'),
  'applied', 'AC10: subscription.updated to employer_starter is applied'
);
select is(private.org_plan_code(:'p10'), 'employer_starter', 'AC10: the organisation is on employer_starter');
select is((select count(*) from public.jobs where organization_id = :'p10' and status = 'open' and deleted_at is null), 5::bigint, 'AC10: all 5 vacancies stay open');
select is((select count(*) from audit.log where action = 'job.status_changed' and metadata ->> 'actor_fn' = 'pause_jobs_on_lapse'), :'pause_rows_before'::bigint, 'AC10: and no vacancy was paused');
select is(pg_temp.set_status(:'own2', :'p_draft', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'AC10: opening a sixth is refused');
select is(pg_temp.set_status(:'own2', (:'p_jobs'::uuid[])[1], 'closed'), 'ok', 'AC10: closing the first vacancy works');
select is(pg_temp.set_status(:'own2', (:'p_jobs'::uuid[])[2], 'closed'), 'ok', 'AC10: and the second');
select is(pg_temp.set_status(:'own2', (:'p_jobs'::uuid[])[3], 'closed'), 'ok', 'AC10: and the third');
select is(pg_temp.set_status(:'own2', :'p_draft', 'open'), 'ok', 'AC10: after closing 3, opening one succeeds');
select is((select count(*) from public.jobs where organization_id = :'p10'), 6::bigint, 'AC10: nothing was deleted');
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- Roles and permissions: only the provider, through billing_apply_event, changes a status.
select is(
  array(select r from unnest(array['anon', 'authenticated', 'service_role']) r
        where has_table_privilege(r, 'billing.subscriptions', 'insert') or has_table_privilege(r, 'billing.subscriptions', 'update') or has_table_privilege(r, 'billing.subscriptions', 'delete')),
  array[]::text[], 'no API role can write a subscription'
);
select is(split_part(pg_temp.call_as(pg_temp.owner_of((select org from t_g)), 'authenticated', 'update billing.subscriptions set status = ''active''', 'aal2'), '|', 1), '42501', 'the owner of a past due organisation at aal2 is denied a manual state change');
select is(split_part(pg_temp.call_as(:'plat', 'authenticated', 'update billing.subscriptions set status = ''canceled''', 'aal2'), '|', 1), '42501', 'a platform administrator at aal2 is denied one too');
select is(split_part(pg_temp.call_as(pg_temp.owner_of((select org from t_g)), 'authenticated', format('select public.billing_apply_event(%L)', gen_random_uuid()), 'aal2'), '|', 1), '42501', 'and cannot apply an event');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and pg_get_functiondef(p.oid) ~* 'update\s+billing\.subscriptions'
     and p.proname not in ('billing_apply_event')),
  0::bigint, 'no other public function writes a subscription'
);

-- The pages tell a member that the subscription has ended (v_org_limits.subscription_ended).
select is(pg_temp.json_as(:'l_member', format('select subscription_ended from public.v_org_limits where organization_id = %L', (select org from t_l))), '[{"subscription_ended": true}]'::jsonb, 'a member of a lapsed organisation reads subscription_ended true');
select is(pg_temp.json_as(:'l8_owner', format('select subscription_ended from public.v_org_limits where organization_id = %L', (select org from t_l8))), '[{"subscription_ended": true}]'::jsonb, 'so does the owner');
select is(pg_temp.json_as(:'n8_owner', format('select subscription_ended from public.v_org_limits where organization_id = %L', (select org from t_n8))), '[{"subscription_ended": false}]'::jsonb, 'an organisation that never subscribed reads false');
select is(pg_temp.json_as(pg_temp.member_of((select org from t_r)), format('select subscription_ended from public.v_org_limits where organization_id = %L', (select org from t_r))), '[{"subscription_ended": false}]'::jsonb, 'a reactivated organisation, whose old canceled row is kept, reads false');
select is(pg_temp.json_as(:'own2', format('select subscription_ended from public.v_org_limits where organization_id = %L', (select org from t_l))), '[]'::jsonb, 'a user outside the organisation reads no row');
select is(split_part(pg_temp.call_as(null, 'anon', 'select subscription_ended from public.v_org_limits', 'aal1'), '|', 1), '42501', 'an anonymous caller is refused');

select * from finish();
rollback;
