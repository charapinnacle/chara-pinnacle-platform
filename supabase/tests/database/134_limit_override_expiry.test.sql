begin;
select plan(26);

\ir status_fixture.inc

-- Limit overrides with an expiry and the reason in the plan audit rows (V16, FR-R2 AC5 time part; DATA_MODEL.md section 4
-- Billing, both risky): private.org_limit ignores an expired override, an override without expiry keeps applying, and
-- private.billing_plan_audit takes chara.audit_reason into the metadata and writes nothing while
-- chara.billing_audit_suppress is on. The clock cannot move inside a test, so "91 days later" is an expiry set into the
-- past.

update private.settings set value = 'true' where key = 'entitlements_enforced';

select pg_temp.org_on('employer_enterprise') as ent \gset
select pg_temp.org_on('employer_starter') as basic \gset

select is(
  (select format('%s|%s', data_type, is_nullable) from information_schema.columns
   where table_schema = 'billing' and table_name = 'organization_limit_overrides' and column_name = 'expires_at'),
  'timestamp with time zone|YES', 'expires_at is a nullable timestamptz'
);

-- an override written before the editor has no expiry and keeps applying
insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value) values (:'ent', 'active_jobs', 80);
select is(private.org_limit(:'ent', 'active_jobs'), 80, 'an override without expiry (null) applies');
update billing.organization_limit_overrides set expires_at = now() + interval '90 days' where organization_id = :'ent';
select is(private.org_limit(:'ent', 'active_jobs'), 80, 'an override with a future expiry applies');
update billing.organization_limit_overrides set expires_at = now() where organization_id = :'ent';
select is(private.org_limit(:'ent', 'active_jobs'), 50, 'an override that expires at this instant no longer applies: the plan limit 50');
update billing.organization_limit_overrides set expires_at = now() - interval '1 day' where organization_id = :'ent';
select is(private.org_limit(:'ent', 'active_jobs'), 50, 'an expired override is ignored and the plan limit applies');
select is(private.org_limit(:'ent', 'members'), 15, 'a key without override reads the plan row');

-- the limit check of every caller reads the same helper
select is(
  pg_temp.call_as(null, 'postgres', format($$select private.assert_within_limit(%L, 'active_jobs', 50)$$, :'ent')),
  'P0001|CHARA_LIMIT_REACHED|active_jobs', 'NFR-A4: with the override expired, 50 open vacancies meet the plan limit of 50'
);
update billing.organization_limit_overrides set expires_at = now() + interval '1 day' where organization_id = :'ent';
select is(
  pg_temp.call_as(null, 'postgres', format($$select private.assert_within_limit(%L, 'active_jobs', 50)$$, :'ent')),
  'ok', 'NFR-A4: with the override active, the 51st vacancy is within the override of 80'
);
select is(
  pg_temp.call_as(null, 'postgres', format($$select private.assert_within_limit(%L, 'active_jobs', 79)$$, :'ent')) || ',' ||
  pg_temp.call_as(null, 'postgres', format($$select private.assert_within_limit(%L, 'active_jobs', 80)$$, :'ent')),
  'ok,P0001|CHARA_LIMIT_REACHED|active_jobs', 'NFR-A4: the boundary of the active override: 79 passes, 80 is refused'
);

-- AC5: 40 members until the expiry, 15 after it, and the members are kept
select count(*) as members_before from public.organization_members where organization_id = :'ent' \gset
insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value, expires_at)
values (:'ent', 'members', 40, now() + interval '90 days');
select is(private.org_limit(:'ent', 'members'), 40, 'AC5: the override of 40 members applies before its expiry');
update billing.organization_limit_overrides set expires_at = now() - interval '1 day' where organization_id = :'ent' and limit_key = 'members';
select is(private.org_limit(:'ent', 'members'), 15, 'AC5: after the expiry org_limit(E, members) returns 15 again');
select is(
  (select count(*) from public.organization_members where organization_id = :'ent'), :'members_before'::bigint,
  'AC5: and the existing members of E are kept'
);
select is(private.org_limit(gen_random_uuid(), 'members'), 0, 'an organisation without a plan row still reads 0');

-- an override applies only while the organisation is on an Enterprise plan
insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value, expires_at)
values (:'basic', 'active_jobs', 9, now() + interval '30 days');
select is(private.org_limit(:'basic', 'active_jobs'), (select limit_value from billing.plan_limits where plan_code = 'employer_starter' and limit_key = 'active_jobs'),
  'an active override of an organisation on Basic is ignored: the Basic limit applies');
select is(private.org_limit(:'ent', 'active_jobs'), 80, 'the active override of E applies while E is on Enterprise');
update billing.subscriptions set status = 'canceled' where organization_id = :'ent';
select is(private.org_limit(:'ent', 'active_jobs'), (select limit_value from billing.plan_limits where plan_code = 'free_employer' and limit_key = 'active_jobs'),
  'once the Enterprise subscription is cancelled E reads the value of the free plan, not the override');
update billing.subscriptions set status = 'active' where organization_id = :'ent';

-- the audit rows of the trigger: no reason outside the editor, as before
select coalesce(max(id), 0) as base from audit.log \gset
update billing.plan_limits set limit_value = 4 where plan_code = 'employer_starter' and limit_key = 'active_jobs';
select is(
  (select format('%s|%s|%s|%s', count(*), bool_and(not metadata ? 'reason'), bool_and(not metadata ? 'request_id'),
     max(metadata -> 'after' ->> 'limit_value')) from audit.log where id > :base),
  '1|t|t|4', 'a change outside the editor writes one row without a reason or a request id, as before'
);

-- with the reason of an editor call
select coalesce(max(id), 0) as base from audit.log \gset
select set_config('request.headers', json_build_object('x-request-id', '0b3f5d1e-2a4c-4e6f-8a9b-1c2d3e4f5a6b')::text, true);
select set_config('chara.audit_reason', 'Raise after the usage review', true);
update billing.plan_limits set limit_value = 5 where plan_code = 'employer_starter' and limit_key = 'active_jobs';
insert into billing.plan_features (plan_code, feature_key) values ('employer_starter', 'advanced_partner_search');
delete from billing.plan_features where plan_code = 'employer_starter' and feature_key = 'advanced_partner_search';
update billing.plans set name = 'Basic Plus' where code = 'employer_starter';
update billing.organization_limit_overrides set limit_value = 41 where organization_id = :'ent' and limit_key = 'members';
select is(
  (select string_agg(format('%s:%s:%s', metadata ->> 'table', metadata ->> 'operation', metadata ->> 'reason'), ',' order by id)
   from audit.log where id > :base),
  'plan_limits:update:Raise after the usage review,plan_features:insert:Raise after the usage review,plan_features:delete:Raise after the usage review,plans:update:Raise after the usage review,organization_limit_overrides:update:Raise after the usage review',
  'every billing table writes chara.audit_reason into metadata.reason'
);
select is(
  (select count(*) from audit.log where id > :base and metadata ->> 'request_id' = '0b3f5d1e-2a4c-4e6f-8a9b-1c2d3e4f5a6b'), 5::bigint,
  'and the request id of the call'
);
select is(
  (select format('%s|%s', metadata -> 'before', metadata -> 'after') from audit.log
   where id > :base and metadata ->> 'table' = 'plans'),
  '{"name": "Basic"}|{"name": "Basic Plus"}', 'an update still records only the changed columns'
);

-- the suppress flag: a change that writes its single row itself
select coalesce(max(id), 0) as base from audit.log \gset
select set_config('chara.billing_audit_suppress', 'on', true);
update billing.plans set price_minor = price_minor + 100 where code = 'employer_starter';
update billing.plan_limits set limit_value = 6 where plan_code = 'employer_starter' and limit_key = 'active_jobs';
insert into billing.plan_features (plan_code, feature_key) values ('employer_starter', 'advanced_partner_search');
delete from billing.organization_limit_overrides where organization_id = :'ent' and limit_key = 'members';
insert into billing.plan_provider_refs (plan_code, provider, provider_product_ref, provider_price_ref)
values ('employer_professional', 'stripe', 'prod_suppress', 'price_suppress')
on conflict (plan_code, provider) do update set provider_price_ref = excluded.provider_price_ref;
select is((select count(*) from audit.log where id > :base), 0::bigint, 'with the suppress flag on, no table of the five writes a row');
select set_config('chara.billing_audit_suppress', 'off', true);
update billing.plan_limits set limit_value = 7 where plan_code = 'employer_starter' and limit_key = 'active_jobs';
select is((select count(*) from audit.log where id > :base), 1::bigint, 'with the flag off the rows are written again');
select set_config('chara.audit_reason', '', true);
select coalesce(max(id), 0) as base from audit.log \gset
update billing.plan_limits set limit_value = 7 where plan_code = 'employer_starter' and limit_key = 'active_jobs';
select is((select count(*) from audit.log where id > :base), 0::bigint, 'an update that changes nothing writes nothing');
update billing.plan_limits set limit_value = 8 where plan_code = 'employer_starter' and limit_key = 'active_jobs';
select is(
  (select count(*) from audit.log where id > :base and not metadata ? 'reason'), 1::bigint,
  'an empty chara.audit_reason is no reason'
);

select is(
  (select format('%s|%s', p.prosecdef, p.proconfig) from pg_proc p where p.oid = 'private.billing_plan_audit()'::regprocedure),
  't|{"search_path=\"\""}', 'the trigger function stays security definer with an empty search_path'
);
select is(
  (select format('%s|%s', p.prosecdef, p.proconfig) from pg_proc p where p.oid = 'private.org_limit(uuid, text)'::regprocedure)
  || '|' || has_function_privilege('authenticated', 'private.org_limit(uuid, text)', 'execute'),
  't|{"search_path=\"\""}|false', 'org_limit stays security definer with an empty search_path and no API grant'
);

select * from finish();
rollback;
