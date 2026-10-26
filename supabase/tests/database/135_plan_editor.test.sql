begin;
select plan(56);

\ir status_fixture.inc

-- The plan, limit, feature, override and settings editor (V16, FR-R2 AC2 to AC7, SOP FR-R2 steps Edit, Override, Audit
-- and Effect, controls role, two-step, ranges, reasons and audit; NFR-O5, NFR-S8, NFR-A4).

\set reason 'Raise after first month of usage review'
\set gone_admin '00000000-0000-0000-0000-00000000b601'
\set second_admin '00000000-0000-0000-0000-00000000b602'

select pg_temp.new_user(:'gone_admin');
select pg_temp.new_user(:'second_admin');
update public.profiles set account_kind = intended_account_kind where id in (:'gone_admin', :'second_admin');
update public.profiles set display_name = 'Second Admin' where id = :'second_admin';
insert into public.platform_staff (user_id, role, revoked_at) values (:'gone_admin', 'admin', now());
insert into public.platform_staff (user_id, role) values (:'second_admin', 'admin');
update private.settings set value = 'true' where key = 'entitlements_enforced';

-- A partner organisation of p_type with an owner, on p_plan.
create function pg_temp.partner_on(p_type public.organization_type, p_plan text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (v_owner, v_owner || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = v_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Partner ' || left(v_id::text, 8), 'Partner ' || left(v_id::text, 8), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, v_owner, 'owner', now());
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  return v_id;
end;
$$;

create function pg_temp.admin(p_sql text, p_user uuid default '00000000-0000-0000-0000-00000000a021', p_aal text default 'aal2') returns text
language sql as $$ select pg_temp.call_as(p_user, 'authenticated', p_sql, p_aal) $$;

-- Everything an editor call can write, to compare before and after a refused call.
create function pg_temp.state() returns text
language sql as $$
  select (select count(*) from audit.log) || '|' || (select md5(string_agg(to_jsonb(p)::text, ',' order by code)) from billing.plans p)
      || '|' || (select md5(string_agg(to_jsonb(l)::text, ',' order by plan_code, limit_key)) from billing.plan_limits l)
      || '|' || (select md5(string_agg(to_jsonb(f)::text, ',' order by plan_code, feature_key)) from billing.plan_features f)
      || '|' || (select count(*) || coalesce(md5(string_agg(to_jsonb(o)::text, ',' order by organization_id, limit_key)), '')
                 from billing.organization_limit_overrides o)
      || '|' || (select md5(string_agg(key || value::text, ',' order by key)) from private.settings)
$$;

update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.partner_on('recruitment_company', 'recruitment_partner') as r \gset
select pg_temp.partner_on('staffing_company', 'staffing_partner') as s \gset
select pg_temp.partner_on('recruitment_company', 'recruitment_enterprise') as re \gset
update private.settings set value = 'false' where key = 'release_partner_directories';
select pg_temp.org_on('employer_enterprise') as e \gset
select pg_temp.org_on('employer_professional') as p \gset

-- AC3: only an active Platform Administrator at aal2 may edit -----------------------------------------------------
create temp table calls (fn text primary key, sql text not null);
insert into calls values
  ('admin_update_plan', $$select public.admin_update_plan('staffing_professional', 'Professional', true, 30, 'Matrix call reason')$$),
  ('admin_set_plan_limit', $$select public.admin_set_plan_limit('staffing_professional', 'markets', 11, 'Matrix call reason')$$),
  ('admin_set_plan_feature', $$select public.admin_set_plan_feature('staffing_professional', 'analytics_enterprise', true, 'Matrix call reason')$$),
  ('admin_set_limit_override', format($$select public.admin_set_limit_override(%L, 'members', 20, now() + interval '30 days', 'Matrix call reason')$$, :'e')),
  ('admin_remove_limit_override', format($$select public.admin_remove_limit_override(%L, 'members', 'Matrix call reason')$$, :'e')),
  ('admin_set_setting', $$select public.admin_set_setting('stats_min_count', '6', 'Matrix call reason')$$),
  ('admin_list_plans', $$select * from public.admin_list_plans()$$),
  ('admin_list_plan_history', $$select * from public.admin_list_plan_history('staffing_professional')$$),
  ('admin_list_limit_overrides', $$select * from public.admin_list_limit_overrides()$$),
  ('admin_list_enterprise_organizations', $$select * from public.admin_list_enterprise_organizations()$$),
  ('admin_list_settings', $$select * from public.admin_list_settings()$$);
create temp table callers (label text primary key, uid uuid, db_role text, aal text, expected text);
insert into callers values
  ('admin at aal1', :'st_admin', 'authenticated', 'aal1', 'P0001|CHARA_FORBIDDEN|aal2_required'),
  ('revoked admin', :'gone_admin', 'authenticated', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('trust and safety', :'st_trust', 'authenticated', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('verification reviewer', :'st_review', 'authenticated', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('organisation owner', :'own1', 'authenticated', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('candidate', '00000000-0000-0000-0000-00000000a101', 'authenticated', 'aal2', 'P0001|CHARA_FORBIDDEN|');
select pg_temp.state() as before_matrix \gset
select is_empty(
  $$select c.label, f.fn, pg_temp.call_as(c.uid, c.db_role, f.sql, c.aal) as outcome from callers c cross join calls f
    where pg_temp.call_as(c.uid, c.db_role, f.sql, c.aal) <> c.expected$$,
  'AC3: aal1 gets aal2_required; a revoked administrator, T&S, a reviewer, an owner and a candidate get CHARA_FORBIDDEN, for all 11 functions'
);
select is(
  (select count(*) from calls f where pg_temp.call_as(null, 'anon', f.sql) ~ '^42501\|permission denied for function'), 11::bigint,
  'AC3: the anonymous caller lacks EXECUTE on all 11'
);
select is(
  (select count(*) from calls f where not has_function_privilege('anon', (
     select p.oid from pg_proc p where p.proname = f.fn and p.pronamespace = 'public'::regnamespace), 'execute')
     and has_function_privilege('authenticated', (
     select p.oid from pg_proc p where p.proname = f.fn and p.pronamespace = 'public'::regnamespace), 'execute')), 11::bigint,
  'AC3: EXECUTE is granted to authenticated only'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$update billing.plan_limits set limit_value = 99 where plan_code = 'employer_starter'$$),
  '42501|permission denied for table plan_limits|', 'AC3: a direct update of billing.plan_limits is refused'
);
select is(pg_temp.state(), :'before_matrix', 'AC3: no row changed and no audit row was written by a refused caller');
select is(
  (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
   cross join (values ('private.setting_rules'), ('private.settings')) t (tbl)
   where has_table_privilege(r.rol, t.tbl, 'select, insert, update, delete, truncate, references, trigger')),
  0::bigint, 'AC7, NFR-S8: private.settings and private.setting_rules stay closed to every API role'
);
select is(
  (select format('%s|%s', c.relrowsecurity, c.relforcerowsecurity) from pg_class c where c.oid = 'private.setting_rules'::regclass),
  't|t', 'NFR-S8: the rules table has RLS enabled and forced'
);

-- AC2: a limit change applies at once and is audited with the old and new value -------------------------------------
select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid)) as defs from pg_proc p
where p.oid in ('private.org_limit(uuid, text)'::regprocedure, 'private.assert_within_limit(uuid, text, integer)'::regprocedure) \gset
select is(
  pg_temp.call_as(null, 'postgres', format($$select private.assert_within_limit(%L, 'job_order_responses_per_month', 10)$$, :'r')),
  'P0001|CHARA_LIMIT_REACHED|job_order_responses_per_month', 'AC2: with 10 responses this month R is at its limit of 10'
);
select coalesce(max(id), 0) as base from audit.log \gset
select is(
  pg_temp.admin(format($$select public.admin_set_plan_limit('recruitment_partner', 'job_order_responses_per_month', 12, %L)$$, :'reason')),
  'ok', 'AC2: the administrator raises the limit to 12'
);
select is(
  (select limit_value from billing.plan_limits where plan_code = 'recruitment_partner' and limit_key = 'job_order_responses_per_month'),
  12, 'AC2: plan_limits holds 12'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s|%s', count(*), max(action), max(actor_id::text), max(entity_type), max(entity_id),
     max(metadata ->> 'limit_key'), max((metadata -> 'before')::text), max((metadata -> 'after')::text), max(metadata ->> 'reason'))
   from audit.log where id > :base),
  format('1|billing.plan_changed|%s|plan|recruitment_partner|job_order_responses_per_month|{"limit_value": 10}|{"limit_value": 12}|%s',
    :'st_admin', :'reason'),
  'AC2: exactly one audit row with the action, actor, entity, key, before, after and reason'
);
select is(
  pg_temp.call_as(null, 'postgres', format($$select private.assert_within_limit(%L, 'job_order_responses_per_month', 10)$$, :'r')),
  'ok', 'AC2: the next response of R succeeds (11 of 12)'
);
select is(
  (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid)) from pg_proc p
   where p.oid in ('private.org_limit(uuid, text)'::regprocedure, 'private.assert_within_limit(uuid, text, integer)'::regprocedure)),
  :'defs', 'AC2: without any function being redefined'
);
select coalesce(max(id), 0) as base from audit.log \gset
select is(
  pg_temp.call_as(:'st_admin', 'authenticated',
    format($$select public.admin_set_plan_limit('recruitment_partner', 'job_order_responses_per_month', 12, %L)$$, :'reason')),
  'ok', 'the same value again is accepted'
);
select is((select count(*) from audit.log where id > :base), 0::bigint, 'and a change to the same value writes nothing');
select is(
  pg_temp.json_as(:'st_admin', $$select public.admin_set_plan_limit('recruitment_partner', 'job_order_responses_per_month', 12, 'Same value once more') as changed$$, 'aal2'),
  '[{"changed": false}]'::jsonb, 'the call says that nothing changed'
);

-- AC4: values, ranges and reasons ------------------------------------------------------------------------------------
select pg_temp.state() as before_invalid \gset
create temp table invalid (label text primary key, sql text, expected text);
insert into invalid values
  ('limit -1', $$select public.admin_set_plan_limit('recruitment_partner', 'markets', -1, 'Valid reason text')$$, 'limit_value'),
  ('limit 1000001', $$select public.admin_set_plan_limit('recruitment_partner', 'markets', 1000001, 'Valid reason text')$$, 'limit_value'),
  ('key job_offers', $$select public.admin_set_plan_limit('recruitment_partner', 'job_offers', 5, 'Valid reason text')$$, 'unknown_limit_key'),
  ('employer key on a partner plan', $$select public.admin_set_plan_limit('recruitment_partner', 'active_requirements', 5, 'Valid reason text')$$, 'unknown_limit_key'),
  ('trial -1', $$select public.admin_update_plan('recruitment_partner', 'Basic', true, -1, 'Valid reason text')$$, 'trial_days'),
  ('trial 366', $$select public.admin_update_plan('recruitment_partner', 'Basic', true, 366, 'Valid reason text')$$, 'trial_days'),
  ('name 0', $$select public.admin_update_plan('recruitment_partner', '   ', true, 30, 'Valid reason text')$$, 'name'),
  ('name 61', format($$select public.admin_update_plan('recruitment_partner', %L, true, 30, 'Valid reason text')$$, repeat('n', 61)), 'name'),
  ('public free plan', $$select public.admin_update_plan('free_staffing_company', 'Free', true, 0, 'Valid reason text')$$, 'is_public'),
  ('reason null', $$select public.admin_set_plan_limit('recruitment_partner', 'markets', 4, null)$$, 'reason'),
  ('reason 6 spaces', $$select public.admin_set_plan_limit('recruitment_partner', 'markets', 4, '      ')$$, 'reason'),
  ('reason 9', format($$select public.admin_set_plan_limit('recruitment_partner', 'markets', 4, %L)$$, repeat('r', 9)), 'reason'),
  ('reason 501', format($$select public.admin_set_plan_limit('recruitment_partner', 'markets', 4, %L)$$, repeat('r', 501)), 'reason'),
  ('plan recruitment_gold', $$select public.admin_set_plan_limit('recruitment_gold', 'markets', 4, 'Valid reason text')$$, 'plan_code'),
  ('unknown plan on update', $$select public.admin_update_plan('recruitment_gold', 'Gold', true, 30, 'Valid reason text')$$, 'plan_code'),
  ('feature analytics_premium', $$select public.admin_set_plan_feature('staffing_partner', 'analytics_premium', true, 'Valid reason text')$$, 'unknown_feature_key'),
  ('employer feature on a partner plan', $$select public.admin_set_plan_feature('staffing_partner', 'shortlisting', true, 'Valid reason text')$$, 'unknown_feature_key');
select is_empty(
  $$select label, pg_temp.admin(sql) from invalid where pg_temp.admin(sql) <> 'P0001|CHARA_INVALID_INPUT|' || expected$$,
  'AC4: -1, 1,000,001, unknown keys, trial -1 and 366, both names, the public free plan, the bad reasons and the unknown plan are refused naming the field'
);
select is(pg_temp.state(), :'before_invalid', 'AC4: a refused call writes nothing');
select is(
  pg_temp.admin($$select public.admin_set_plan_limit('recruitment_partner', 'markets', null, 'Unlimited markets')$$) || ',' ||
  pg_temp.admin($$select public.admin_update_plan('recruitment_partner', 'Basic', true, 0, 'Valid reason text')$$) || ',' ||
  pg_temp.admin($$select public.admin_update_plan('recruitment_partner', 'Basic', true, 365, 'Valid reason text')$$) || ',' ||
  pg_temp.admin(format($$select public.admin_set_plan_limit('recruitment_partner', 'markets', 5, %L)$$, repeat('r', 10))) || ',' ||
  pg_temp.admin(format($$select public.admin_set_plan_limit('recruitment_partner', 'markets', 6, %L)$$, repeat('r', 500))) || ',' ||
  pg_temp.admin(format($$select public.admin_update_plan('recruitment_partner', %L, true, 30, 'Valid reason text')$$, repeat('n', 60))),
  'ok,ok,ok,ok,ok,ok', 'AC4: null (unlimited), trial 0 and 365, reasons of 10 and 500 characters and a name of 60 are accepted'
);
select is(
  (select format('%s|%s', name, trial_days) from billing.plans where code = 'recruitment_partner'),
  repeat('n', 60) || '|30', 'AC4: the plan holds the accepted name and trial length'
);
select is(
  (select metadata ->> 'reason' from audit.log where action = 'billing.plan_changed' and entity_id = 'recruitment_partner'
     and metadata ->> 'limit_key' = 'markets' order by id desc limit 1),
  repeat('r', 500), 'AC4: a reason of 500 characters is stored whole'
);
select is(
  pg_temp.admin($$select public.admin_update_plan('free_staffing_company', 'Free', false, 0, 'Valid reason text')$$) || ',' ||
  pg_temp.admin($$select public.admin_update_plan('staffing_partner', 'Basic', false, 30, 'Hide while repriced')$$),
  'ok,ok', 'a free plan stays not public; a paid plan can be hidden'
);
select is(
  pg_temp.call_as(null, 'anon', $$select count(*) from public.v_plans where code = 'staffing_partner'$$), 'ok',
  'the hidden plan is read without error'
);
select is(
  (select count(*) from billing.plans where code = 'staffing_partner' and not is_public), 1::bigint, 'and is no longer public'
);

-- AC5: per-organisation override with an expiry ----------------------------------------------------------------------
select coalesce(max(id), 0) as base from audit.log \gset
select is(
  pg_temp.admin(format($$select public.admin_set_limit_override(%L, 'members', 40, now() + interval '90 days', %L)$$, :'e', :'reason')),
  'ok', 'AC5: the administrator sets 40 members for E until 90 days from now'
);
select is(private.org_limit(:'e', 'members'), 40, 'AC5: private.org_limit(E, members) returns 40');
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s', count(*), max(entity_type), max(entity_id), bool_and(metadata -> 'before' = 'null'),
     max(metadata -> 'after' ->> 'limit_value'), bool_and((metadata -> 'after' ->> 'expires_at')::timestamptz > now() + interval '89 days'),
     max(metadata ->> 'reason'))
   from audit.log where id > :base),
  format('1|organization|%s|t|40|t|%s', :'e', :'reason'),
  'AC5: one audit row: entity organization E, before null, after 40 with the expiry, and the reason'
);
select is(
  pg_temp.admin(format($$select public.admin_set_limit_override(%L, 'members', 40, now() + interval '90 days', %L)$$, :'p', :'reason')),
  'P0001|CHARA_FORBIDDEN|override_enterprise_only', 'AC5: an override for P on employer_professional is refused'
);
select is(
  pg_temp.admin(format($$select public.admin_set_limit_override(%L, 'members', 40, now() - interval '1 day', %L)$$, :'e', :'reason')) || ',' ||
  pg_temp.admin(format($$select public.admin_set_limit_override(%L, 'members', 40, null, %L)$$, :'e', :'reason')),
  'P0001|CHARA_INVALID_INPUT|expires_at,P0001|CHARA_INVALID_INPUT|expires_at', 'AC5: an expiry in the past, or none, is refused'
);
select is(
  pg_temp.admin(format($$select public.admin_set_limit_override(%L, 'members', 1000001, now() + interval '9 days', %L)$$, :'e', :'reason')) || ',' ||
  pg_temp.admin(format($$select public.admin_set_limit_override(%L, 'members', null, now() + interval '9 days', %L)$$, :'e', :'reason')) || ',' ||
  pg_temp.admin(format($$select public.admin_set_limit_override(%L, 'markets', 9, now() + interval '9 days', %L)$$, :'e', :'reason')) || ',' ||
  pg_temp.admin(format($$select public.admin_set_limit_override(%L, 'members', 9, now() + interval '9 days', %L)$$, gen_random_uuid(), :'reason')),
  'P0001|CHARA_INVALID_INPUT|limit_value,P0001|CHARA_INVALID_INPUT|limit_value,P0001|CHARA_INVALID_INPUT|unknown_limit_key,P0001|CHARA_NOT_FOUND|',
  'AC5: over 1,000,000, null, a key of another organisation type and an unknown organisation are refused'
);
select is(
  pg_temp.admin(format($$select public.admin_set_limit_override(%L, 'job_order_responses_per_month', 400, now() + interval '30 days', %L)$$, :'re', :'reason')),
  'ok', 'a partner on recruitment_enterprise can get an override of a partner key'
);
select is(
  (select string_agg(x ->> 'limit_key' || ':' || (x ->> 'limit_value') || ':' || (x ->> 'plan_limit') || ':' || (x ->> 'expired') || ':' || (x ->> 'reason'), ',' order by x ->> 'limit_key')
   from jsonb_array_elements(pg_temp.json_as(:'st_admin', format($$select * from public.admin_list_limit_overrides() where organization_id in (%L, %L)$$, :'e', :'re'), 'aal2')) x),
  format('job_order_responses_per_month:400:200:false:%s,members:40:15:false:%s', :'reason', :'reason'),
  'AC11: the overrides list holds each override with its value, the plan limit, the expiry state and the reason'
);
update billing.organization_limit_overrides set expires_at = now() - interval '1 day' where organization_id = :'e' and limit_key = 'members';
select is(
  (select x ->> 'expired' from jsonb_array_elements(pg_temp.json_as(:'st_admin', format($$select * from public.admin_list_limit_overrides() where organization_id = %L$$, :'e'), 'aal2')) x),
  'true', 'AC11: an expired override is marked expired'
);
select is(private.org_limit(:'e', 'members'), 15, 'AC5: after the expiry the plan limit of 15 applies again');
select is(
  pg_temp.admin(format($$select public.admin_remove_limit_override(%L, 'members', 'No longer needed now')$$, :'e')) || ',' ||
  pg_temp.admin(format($$select public.admin_remove_limit_override(%L, 'members', 'No longer needed now')$$, :'e')),
  'ok,P0001|CHARA_NOT_FOUND|', 'an override is removed once; a second removal finds nothing'
);
select is(
  (select format('%s|%s', metadata ->> 'operation', metadata ->> 'reason') from audit.log
   where entity_id = :'e' and metadata ->> 'table' = 'organization_limit_overrides' order by id desc limit 1),
  'delete|No longer needed now', 'the removal is audited with its reason'
);

-- AC6: feature switches take effect immediately ----------------------------------------------------------------------
select coalesce(max(id), 0) as base from audit.log \gset
select is(private.has_feature(:'s', 'analytics_advanced'), false, 'AC6: staffing_partner has no advanced analytics');
select pg_temp.admin($$select public.admin_set_plan_feature('staffing_partner', 'analytics_advanced', true, 'Trial advanced analytics')$$) as added \gset
select is(private.has_feature(:'s', 'analytics_advanced'), true, 'AC6: has_feature(S, analytics_advanced) is true after the addition');
select pg_temp.admin($$select public.admin_set_plan_feature('staffing_partner', 'analytics_advanced', false, 'End of the trial period')$$) as removed \gset
select is(private.has_feature(:'s', 'analytics_advanced'), false, 'AC6: and false after the removal');
select is(
  (select string_agg(format('%s:%s:%s', metadata ->> 'operation', metadata ->> 'feature_key', metadata ->> 'reason'), ',' order by id)
   from audit.log where id > :base),
  'insert:analytics_advanced:Trial advanced analytics,delete:analytics_advanced:End of the trial period',
  'AC6: each change writes one audit row with the operation, the feature key and the reason'
);
select is(
  pg_temp.json_as(:'st_admin', $$select public.admin_set_plan_feature('staffing_partner', 'analytics_advanced', false, 'Already switched off') as changed$$, 'aal2'),
  '[{"changed": false}]'::jsonb, 'removing a feature that is off changes nothing'
);

-- AC7: platform settings within their rules --------------------------------------------------------------------------
select coalesce(max(id), 0) as base from audit.log \gset
select is(
  pg_temp.admin($$select public.admin_set_setting('stats_min_count', '4', 'Lower the threshold')$$) || ',' ||
  pg_temp.admin($$select public.admin_set_setting('stats_min_count', '5', 'Back to the minimum')$$) || ',' ||
  pg_temp.admin($$select public.admin_set_setting('stats_min_count', '20', 'Raise the threshold')$$) || ',' ||
  pg_temp.admin($$select public.admin_set_setting('organizations_per_user_max', 'three', 'Three organisations each')$$),
  'P0001|CHARA_INVALID_INPUT|value,ok,ok,P0001|CHARA_INVALID_INPUT|value',
  'AC7: 4 is refused (minimum 5), 5 and 20 are accepted, "three" is the wrong type'
);
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', action, entity_id, metadata ->> 'before', metadata ->> 'after', metadata ->> 'reason'), ',' order by id)
   from audit.log where id > :base),
  'setting.changed:stats_min_count:5:20:Raise the threshold',
  'AC7: one audit row per real change with the value before and after and the reason (5 to 5 changed nothing)'
);
select is((select value from private.settings where key = 'stats_min_count'), '20'::jsonb, 'AC7: the setting holds the number 20');
select is(
  pg_temp.admin($$select public.admin_set_setting('entitlements_enforced', 'false', 'Switch limits off')$$) || ',' ||
  pg_temp.admin($$select public.admin_set_setting('audit_retention_years', '7', 'Keep the log longer')$$) || ',' ||
  pg_temp.admin($$select public.admin_set_setting('no_such_setting', '1', 'An unknown setting')$$) || ',' ||
  pg_temp.admin($$select public.admin_set_setting('rate_limit_login_max', '50', 'Not on the list')$$),
  'P0001|CHARA_FORBIDDEN|setting_not_editable,P0001|CHARA_FORBIDDEN|setting_not_editable,P0001|CHARA_FORBIDDEN|setting_not_editable,P0001|CHARA_FORBIDDEN|setting_not_editable',
  'AC7: entitlements_enforced, audit_retention_years, an unknown key and an unlisted setting are not editable'
);
select throws_ok(
  $$insert into private.setting_rules (key, value_type, label) values ('entitlements_enforced', 'boolean', 'Limits')$$,
  '23514', null, 'AC7: entitlements_enforced can never enter the allow-list'
);
select is(
  pg_temp.admin($$select public.admin_set_setting('release_partner_directories', 'yes', 'Go live with 2a')$$) || ',' ||
  pg_temp.admin($$select public.admin_set_setting('legal_entity_email', 'not-an-address', 'Set the address')$$) || ',' ||
  pg_temp.admin($$select public.admin_set_setting('legal_entity_email', 'legal@chara.example', 'Set the address')$$) || ',' ||
  pg_temp.admin(format($$select public.admin_set_setting('legal_entity_name', %L, 'Set the name')$$, repeat('n', 201))) || ',' ||
  pg_temp.admin($$select public.admin_set_setting('legal_entity_name', null, 'Set the name')$$),
  'P0001|CHARA_INVALID_INPUT|value,P0001|CHARA_INVALID_INPUT|value,ok,P0001|CHARA_INVALID_INPUT|value,P0001|CHARA_INVALID_INPUT|value',
  'booleans take true or false only, emails and text lengths are checked, a null value is refused'
);
select is(
  (select format('%s|%s', jsonb_typeof(value), value #>> '{}') from private.settings where key = 'legal_entity_email'),
  'string|legal@chara.example', 'a text setting is stored as a JSON string and read as value #>> ''{}'''
);
select pg_temp.admin($$select public.admin_set_setting('release_partner_directories', 'true', 'Go live with release 2a')$$) as switched \gset
select is(
  :'switched' || '|' || private.release_on('release_partner_directories')::text || '|'
  || (select jsonb_typeof(value) from private.settings where key = 'release_partner_directories'),
  'ok|true|boolean', 'switching a release on through the editor is what puts it live'
);
select is(
  (select x -> 'release_gaps' from jsonb_array_elements(pg_temp.json_as(:'st_admin', $$select * from public.admin_list_settings()$$, 'aal2')) x
   where x ->> 'key' = 'release_partner_directories'),
  (select to_jsonb(array_agg(slug || ':' || state)) from private.legal_release_gaps('partner_accounts')),
  'the settings list names the legal documents that still stop the release'
);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.json_as(:'st_admin', $$select * from public.admin_list_settings()$$, 'aal2')) x
   where x ->> 'key' in ('entitlements_enforced', 'audit_retention_years')), 0::bigint,
  'the settings list never offers entitlements_enforced or audit_retention_years'
);

-- AC11 data: history and the plan list -------------------------------------------------------------------------------
select pg_temp.admin($$select public.admin_set_plan_limit('recruitment_professional', 'markets', 11, 'First change of the plan')$$) as h1 \gset
select pg_temp.admin($$select public.admin_set_plan_limit('recruitment_professional', 'markets', 12, 'Second change of the plan')$$, :'second_admin') as h2 \gset
select pg_temp.admin($$select public.admin_update_plan('recruitment_professional', 'Professional Plus', true, 30, 'Third change of the plan')$$) as h3 \gset
select is(
  (select string_agg(format('%s|%s|%s|%s', x ->> 'actor_name', coalesce(x ->> 'limit_key', 'plan'), x ->> 'reason', x -> 'after'), ' ; ' order by ord)
   from jsonb_array_elements(pg_temp.json_as(:'st_admin', $$select * from public.admin_list_plan_history('recruitment_professional', 3)$$, 'aal2'))
     with ordinality as t (x, ord)),
  format('%s|plan|Third change of the plan|{"name": "Professional Plus"} ; Second Admin|markets|Second change of the plan|{"limit_value": 12} ; %s|markets|First change of the plan|{"limit_value": 11}',
    (select coalesce(display_name, (select email from auth.users where id = :'st_admin')) from public.profiles where id = :'st_admin'),
    (select coalesce(display_name, (select email from auth.users where id = :'st_admin')) from public.profiles where id = :'st_admin')),
  'AC11: the history lists the three changes newest first with the administrator, the field, the new value and the reason'
);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.json_as(:'st_admin', $$select * from public.admin_list_plan_history('recruitment_professional', 100)$$, 'aal2')) x
   where x::text ~* 'customer|subscription|card|stripe_customer'), 0::bigint,
  'AC11: the history holds no customer, subscription or card data'
);
select is(
  (select format('%s|%s|%s', count(*), count(*) filter (where not (x ->> 'is_public')::boolean), max(x -> 'limits' ->> 'markets') filter (where x ->> 'code' = 'recruitment_professional'))
   from jsonb_array_elements(pg_temp.json_as(:'st_admin', $$select * from public.admin_list_plans()$$, 'aal2')) x),
  (select format('%s|%s|12', count(*), count(*) filter (where not is_public)) from billing.plans),
  'AC1 data: the administrator reads every plan, the ones that are not public included, with its limits'
);

-- NFR-A4: two administrators changing the same plan are serialised by the row lock ------------------------------------
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_exec('holder', 'begin');
select is(
  (select l from extensions.dblink('holder', $$select code from billing.plans where code = 'employer_starter' for update$$) as t (l text)),
  'employer_starter', 'a second session holds the plan row of employer_starter'
);
set local lock_timeout = '300ms';
select is(
  split_part(pg_temp.admin($$select public.admin_set_plan_limit('employer_starter', 'members', 4, 'Concurrent edit test')$$), '|', 1),
  '55P03', 'NFR-A4: a concurrent change of the same plan waits for the other one'
);
select extensions.dblink_exec('holder', 'rollback');
select extensions.dblink_disconnect('holder');
reset lock_timeout;

select * from finish();
rollback;
