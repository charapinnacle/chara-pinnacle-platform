begin;
select plan(56);

\ir organizations_fixture.inc
\ir billing_events_fixture.inc

-- FR-G3 AC2 (a duplicate delivery changes nothing) and AC10 (the billing functions and payloads are confined), with the
-- constraints of billing.provider_events and billing.orders.

\set plat '00000000-0000-0000-0000-00000000a031'
\set tsa '00000000-0000-0000-0000-00000000a032'
select pg_temp.new_user(:'plat');
select pg_temp.new_user(:'tsa');
update public.profiles set account_kind = intended_account_kind where id in (:'plat', :'tsa');
insert into public.platform_staff (user_id, role) values (:'plat', 'admin'), (:'tsa', 'trust_safety');

select pg_temp.new_org(:'own1', 'DE123456789', 'HRB12345') as o \gset
select pg_temp.new_org(:'own2') as x \gset

-- AC2: the same provider and event id, a different payload.
select pg_temp.ingest('evt_1', 'subscription.updated', pg_temp.sub_event(:'o', 'employer_starter', 'trialing', 'sub_1', '2026-11-04T10:00:00Z')) as first_id \gset
select is(pg_temp.event_status('evt_1'), 'received', 'AC2: a stored event waits to be applied');
select is(public.billing_apply_event(:'first_id'), 'applied', 'AC2: it is applied');

create function pg_temp.footprint(p_org uuid) returns text
language sql as $$
  select format('%s|%s|%s|%s|%s', (select count(*) from billing.subscriptions), (select count(*) from public.notifications),
    pg_temp.applied_audit(p_org), pg_temp.sub(p_org), (select count(*) from audit.log))
$$;
select pg_temp.footprint(:'o') as footprint \gset

select is(
  pg_temp.ingest('evt_1', 'subscription.updated', pg_temp.sub_event(:'o', 'employer_professional', 'active', 'sub_1')),
  :'first_id'::uuid, 'AC2: a second delivery of the same event id returns the id of the stored row'
);
select is(public.billing_apply_event(:'first_id'), 'applied', 'AC2: applying the event again answers its status');
select is(
  (select count(*) from billing.provider_events where provider = 'null' and provider_event_id = 'evt_1'), 1::bigint,
  'AC2: there is still one row for the event'
);
select is(
  (select payload ->> 'planCode' from billing.provider_events where id = :'first_id'), 'employer_starter',
  'AC2: and it holds the original payload'
);
select is(pg_temp.footprint(:'o'), :'footprint', 'AC2: the subscription, the notifications and the audit log are unchanged');

-- The same event id of the other provider is a different event.
select isnt(
  public.billing_ingest_event('stripe', 'evt_1', 'subscription.updated', '{"orgId": null}', true, '2026-11-01T10:00:00Z'), :'first_id'::uuid,
  'the event id is unique per provider'
);

-- Refusals.
select throws_ok(
  $$select public.billing_ingest_event('null', 'evt_forged', 'subscription.updated', '{}', false, now())$$,
  'P0001', 'CHARA_INVALID_INPUT', 'an event with an invalid signature is refused'
);
select throws_ok(
  $$select public.billing_ingest_event('null', 'evt_forged', 'subscription.updated', '{}', null, now())$$,
  'P0001', 'CHARA_INVALID_INPUT', 'and one with an unknown signature state'
);
select is((select count(*) from billing.provider_events where provider_event_id = 'evt_forged'), 0::bigint, 'neither is stored');
select throws_ok(
  $$select public.billing_ingest_event('null', 'evt_x', 'charge.succeeded', '{}', true, now())$$, '23514', null, 'a kind that is not normalised is refused'
);
select throws_ok(
  $$select public.billing_ingest_event('paypal', 'evt_x', 'payment.failed', '{}', true, now())$$, '23514', null, 'an unknown provider is refused'
);
select throws_ok(
  $$select public.billing_ingest_event('null', 'evt_x', 'payment.failed', '[]', true, now())$$, '23514', null, 'a payload that is not an object is refused'
);
select throws_ok(
  $$select public.billing_ingest_event('null', '', 'payment.failed', '{}', true, now())$$, '23514', null, 'an empty event id is refused'
);
select throws_ok(
  $$select public.billing_ingest_event('null', 'evt_x', 'payment.failed', '{}', true, null)$$, '23502', null, 'an event without a creation time is refused'
);
select throws_ok(
  $$select public.billing_ingest_event('null', 'evt_big', 'payment.failed', jsonb_build_object('x', repeat('a', 40000)), true, now())$$,
  '23514', null, 'a payload above 32 kB is refused'
);
select throws_ok(
  $$insert into billing.provider_events (provider, provider_event_id, kind, payload, signature_valid, provider_created_at, status)
    values ('null', 'evt_bad1', 'payment.failed', '{}', true, now(), 'applied')$$,
  '23514', null, 'a row cannot be applied without applied_at'
);
select throws_ok(
  $$insert into billing.provider_events (provider, provider_event_id, kind, payload, signature_valid, provider_created_at, status)
    values ('null', 'evt_bad2', 'payment.failed', '{}', true, now(), 'error')$$,
  '23514', null, 'nor in error without a reason'
);
select throws_ok(
  $$insert into billing.provider_events (provider, provider_event_id, kind, payload, signature_valid, provider_created_at, error)
    values ('null', 'evt_bad3', 'payment.failed', '{}', true, now(), 'transient')$$,
  '23514', null, 'nor with a reason while it is not in error'
);
select throws_ok(
  $$select public.billing_apply_event('00000000-0000-0000-0000-000000000099')$$, 'P0002', 'CHARA_NOT_FOUND', 'applying an event that does not exist is an error'
);

-- AC10: owners, privileges and policies.
select ok(
  (select bool_and(pg_get_userbyid(p.proowner) = 'billing_owner' and p.prosecdef and p.proconfig = array['search_path=""'])
   from pg_proc p where p.oid in (
     'public.billing_ingest_event(text, text, text, jsonb, boolean, timestamptz)'::regprocedure, 'public.billing_apply_event(uuid)'::regprocedure)),
  'AC10: both functions are owned by billing_owner, run with its rights and have an empty search path'
);
select ok(
  not has_function_privilege('anon', 'public.billing_ingest_event(text, text, text, jsonb, boolean, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.billing_ingest_event(text, text, text, jsonb, boolean, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.billing_ingest_event(text, text, text, jsonb, boolean, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.billing_apply_event(uuid)', 'execute'),
  'AC10: service_role alone executes billing_ingest_event and billing_apply_event'
);
select is(
  (select count(*) from pg_proc p, aclexplode(p.proacl) a
   where p.oid in ('public.billing_ingest_event(text, text, text, jsonb, boolean, timestamptz)'::regprocedure, 'public.billing_apply_event(uuid)'::regprocedure)
     and a.grantee = 0),
  0::bigint, 'AC10: and public has no grant on either'
);
select is(
  (select string_agg(distinct pg_get_userbyid(a.grantee), ',') from pg_proc p, aclexplode(p.proacl) a
   where p.oid in ('public.billing_ingest_event(text, text, text, jsonb, boolean, timestamptz)'::regprocedure, 'public.billing_apply_event(uuid)'::regprocedure)),
  'billing_owner,service_role', 'AC10: the grants are the owner and service_role'
);
select is(
  (select count(*) from pg_class c, aclexplode(c.relacl) a
   where c.relnamespace = 'billing'::regnamespace and c.relkind = 'r' and pg_get_userbyid(a.grantee) in ('service_role', 'anon', 'authenticated', 'public')
     and c.relname in ('provider_events', 'orders', 'customers', 'trial_grants')),
  0::bigint, 'AC10: no API role holds a privilege on the billing tables of this unit'
);
select ok(
  not exists (
    select 1 from pg_class c
    where c.relnamespace in ('billing'::regnamespace, 'public'::regnamespace, 'audit'::regnamespace) and c.relkind in ('r', 'p')
      and (has_table_privilege('service_role', c.oid, 'select, insert, update, delete, truncate, references, trigger')
        or has_any_column_privilege('service_role', c.oid, 'select, insert, update, references'))
  ),
  'AC10: service_role holds no table privilege in billing, audit or public'
);
select ok(
  has_table_privilege('billing_owner', 'public.organizations', 'select')
  and not has_table_privilege('billing_owner', 'public.organizations', 'insert, update, delete, truncate')
  and not has_schema_privilege('billing_owner', 'public', 'create')
  and not exists (select 1 from pg_class c where c.relnamespace in ('public'::regnamespace, 'audit'::regnamespace) and c.relkind in ('r', 'p')
    and has_table_privilege('billing_owner', c.oid, 'insert, update, delete, truncate')),
  'AC10: billing_owner reads public.organizations, writes no table of public or audit and cannot create objects there'
);
select is(
  (select count(*) from pg_class c where c.relkind in ('r', 'p', 'v', 'm') and c.relname ~ '^verification'
     and has_table_privilege('billing_owner', c.oid, 'select, insert, update, delete')),
  0::bigint, 'AC10: billing_owner has no privilege on a verification table'
);
select ok(
  (select prosrc !~* 'verification' from pg_proc where oid = 'public.billing_apply_event(uuid)'::regprocedure)
  and not exists (select 1 from pg_proc p where p.pronamespace = 'billing'::regnamespace and p.prosrc ~* 'verification'),
  'AC10: no billing function refers to a verification table'
);
select is(
  (select count(*) from pg_class c
   where c.relnamespace = 'billing'::regnamespace and c.relkind = 'r' and c.relname in ('provider_events', 'orders')
     and c.relrowsecurity and c.relforcerowsecurity
     and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polroles = array['billing_owner'::regrole::oid] and p.polcmd = '*')),
  2::bigint, 'AC10: provider_events and orders have RLS enabled and forced with the billing_owner policy'
);

create function pg_temp.as_role(p_user uuid, p_role text, p_aal text, p_sql text) returns text
language sql as $$ select pg_temp.call_as(p_user, p_role, p_sql, p_aal) $$;

select ok(
  (select bool_and(pg_get_userbyid(p.proowner) = 'billing_owner' and p.prosecdef and p.proconfig = array['search_path=""'])
   from pg_proc p where p.oid in (
     'billing.retry_failed_events()'::regprocedure, 'public.billing_webhook_rejected(text, text)'::regprocedure,
     'public.billing_reconcile_records(text, uuid, integer)'::regprocedure,
     'public.billing_reconcile_report(text, integer, integer, jsonb)'::regprocedure)),
  'AC10: the retry job and the other service functions of this unit are owned by billing_owner as well'
);
select ok(
  not has_table_privilege('billing_owner', 'private.settings', 'insert, update, delete, truncate')
  and (select count(*) from pg_policy p where p.polrelid = 'private.settings'::regclass) = 1,
  'AC10: billing_owner may read one setting of private.settings and write none'
);
select ok(
  not exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_table_privilege(r, 'private.security_events', 'select, insert, update, delete, truncate, references, trigger')
      or has_any_column_privilege(r, 'private.security_events', 'select, insert, update, references')
  )
  and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.security_events'::regclass)
  and not exists (select 1 from pg_policy p where p.polrelid = 'private.security_events'::regclass),
  'AC10: the operations alerts are unreachable for the API roles, with RLS enabled and forced and no policy'
);

-- A request with an invalid signature is audited at most once an hour for each provider and reason.
select is(public.billing_webhook_rejected('stripe', 'signature_mismatch'), true, 'the first rejection of a reason is audited');
select is(public.billing_webhook_rejected('stripe', 'signature_mismatch'), false, 'the next ones of the same provider and reason are not');
select is(public.billing_webhook_rejected('stripe', 'missing_signature'), true, 'another reason is audited');
select is(public.billing_webhook_rejected('null', 'signature_mismatch'), true, 'and another provider');
select is(
  (select string_agg(entity_id || ':' || (metadata ->> 'reason'), ',' order by id) from audit.log where action = 'billing.webhook_rejected'),
  'stripe:signature_mismatch,stripe:missing_signature,null:signature_mismatch', 'three rows were written for the four attempts, with no payload'
);
select throws_ok($$select public.billing_webhook_rejected('paypal', 'signature_mismatch')$$, 'P0001', 'CHARA_INVALID_INPUT', 'an unknown provider is refused');
select throws_ok($$select public.billing_webhook_rejected('stripe', 'Bad Reason!')$$, 'P0001', 'CHARA_INVALID_INPUT', 'and a reason that is not a fixed word');
select is(
  pg_temp.as_role(null, 'anon', 'aal1', $$select public.billing_webhook_rejected('stripe', 'signature_mismatch')$$),
  '42501|permission denied for function billing_webhook_rejected|', 'an anonymous caller cannot write the audit row'
);
select is(
  pg_temp.as_role(null, 'service_role', 'aal1', $$select public.billing_webhook_rejected('stripe', 'invalid_payload')$$), 'ok', 'service_role can'
);

select is(
  pg_temp.as_role(:'own1', 'authenticated', 'aal2', $$select count(*) from billing.provider_events$$),
  '42501|permission denied for table provider_events|', 'AC10: an authenticated owner cannot read provider_events'
);
select is(
  pg_temp.as_role(:'plat', 'authenticated', 'aal2', $$select count(*) from billing.provider_events$$),
  '42501|permission denied for table provider_events|', 'AC10: nor a Platform Administrator'
);
select is(
  pg_temp.as_role(:'tsa', 'authenticated', 'aal2', $$select count(*) from billing.provider_events$$),
  '42501|permission denied for table provider_events|', 'AC10: nor a Trust & Safety Administrator'
);
select is(
  pg_temp.as_role(null, 'anon', 'aal1', $$select count(*) from billing.provider_events$$),
  '42501|permission denied for table provider_events|', 'AC10: nor an anonymous caller'
);
select is(
  pg_temp.as_role(:'own1', 'authenticated', 'aal2', $$select count(*) from billing.orders$$),
  '42501|permission denied for table orders|', 'orders are not readable through the API either'
);
select is(
  pg_temp.as_role(:'own1', 'authenticated', 'aal2', format($f$update billing.subscriptions set status = 'active' where organization_id = %L$f$, :'o')),
  '42501|permission denied for table subscriptions|', 'AC10: an owner cannot update a subscription'
);
select is(
  pg_temp.as_role(:'plat', 'authenticated', 'aal2', format($f$insert into billing.subscriptions (organization_id, plan_code, status, provider) values (%L, 'employer_starter', 'active', 'null')$f$, :'x')),
  '42501|permission denied for table subscriptions|', 'AC10: nor a Platform Administrator insert one'
);
select is(
  pg_temp.as_role(:'own1', 'authenticated', 'aal2', format($f$delete from billing.subscriptions where organization_id = %L$f$, :'o')),
  '42501|permission denied for table subscriptions|', 'AC10: nor delete one'
);
select is(
  pg_temp.as_role(:'own1', 'authenticated', 'aal2', format($f$select public.billing_apply_event(%L)$f$, :'first_id')),
  '42501|permission denied for function billing_apply_event|', 'AC10: an authenticated session cannot apply an event'
);
select is(
  pg_temp.as_role(:'plat', 'authenticated', 'aal2', $$select public.billing_ingest_event('null', 'evt_staff', 'payment.failed', '{}', true, now())$$),
  '42501|permission denied for function billing_ingest_event|', 'AC10: nor can a Platform Administrator store one'
);
select is(
  pg_temp.as_role(null, 'anon', 'aal1', $$select public.billing_apply_event(gen_random_uuid())$$),
  '42501|permission denied for function billing_apply_event|', 'AC10: nor an anonymous caller'
);
select is(
  pg_temp.as_role(null, 'service_role', 'aal1', $$select public.billing_ingest_event('null', 'evt_svc', 'payment.failed', '{}', true, '2026-11-01T10:00:00Z')$$),
  'ok', 'service_role stores an event'
);
select is(
  pg_temp.as_role(null, 'service_role', 'aal1', $$select count(*) from billing.provider_events$$),
  '42501|permission denied for schema billing|', 'but cannot read the table'
);

select * from finish();
rollback;
