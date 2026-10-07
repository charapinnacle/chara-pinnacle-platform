begin;
select plan(38);

\ir status_fixture.inc

-- FR-D2 AC3: only an accepted member of the job's organisation may change a status. A fresh application of Acme for each call.
create function pg_temp.try_as(p_user uuid, p_role text default 'authenticated', p_aal text default 'aal1') returns text
language plpgsql as $$
declare
  v_app uuid := pg_temp.seed_app('applied');
  v_result text;
begin
  v_result := case when p_role = 'anon'
    then pg_temp.call_as(null, 'anon', format($f$select public.set_application_status(%L, 'interview')$f$, v_app))
    else pg_temp.set_as(p_user, v_app, 'interview', null, p_aal) end;
  return v_result || '#' || pg_temp.status_of(v_app);
end;
$$;
select is(pg_temp.try_as(:'own1'), 'ok#interview', 'AC3: the owner succeeds');
select is(pg_temp.try_as(:'adm'), 'ok#interview', 'AC3: an admin succeeds');
select is(pg_temp.try_as(:'mem'), 'ok#interview', 'AC3: a member succeeds');
select is(pg_temp.try_as(:'own2'), 'P0002|CHARA_NOT_FOUND|#applied', 'AC3: the owner of another organisation gets CHARA_NOT_FOUND');
select is(pg_temp.try_as(:'adm2'), 'P0002|CHARA_NOT_FOUND|#applied', 'AC3: an admin of another organisation gets CHARA_NOT_FOUND');
select is(pg_temp.try_as(:'pending'), 'P0002|CHARA_NOT_FOUND|#applied', 'AC3: a member whose invitation is not accepted gets CHARA_NOT_FOUND');
select is(pg_temp.try_as(:'st_admin', 'authenticated', 'aal2'), 'P0002|CHARA_NOT_FOUND|#applied', 'AC3: a platform administrator at aal2 gets CHARA_NOT_FOUND');
select is(pg_temp.try_as(:'st_trust', 'authenticated', 'aal2'), 'P0002|CHARA_NOT_FOUND|#applied', 'AC3: trust and safety at aal2 gets CHARA_NOT_FOUND');
select is(pg_temp.try_as(:'st_review', 'authenticated', 'aal2'), 'P0002|CHARA_NOT_FOUND|#applied', 'AC3: a verification reviewer at aal2 gets CHARA_NOT_FOUND');
select is(
  pg_temp.viewed_as(:'st_admin', (select id from (select pg_temp.seed_app('applied') as id) x), 'aal2'),
  'P0002|CHARA_NOT_FOUND|', 'AC3: a platform administrator at aal2 cannot open an application either'
);
select is(pg_temp.try_as(:'wa'), 'P0001|CHARA_FORBIDDEN|company_account_required#applied', 'AC3: the candidate who owns the application gets CHARA_FORBIDDEN');
select is(pg_temp.try_as(:'wb'), 'P0001|CHARA_FORBIDDEN|company_account_required#applied', 'AC3: another candidate gets CHARA_FORBIDDEN');
select is(pg_temp.try_as(:'nul'), 'P0001|CHARA_FORBIDDEN|company_account_required#applied', 'AC3: a user without an account kind gets CHARA_FORBIDDEN');
select is(pg_temp.try_as(null, 'anon'), '42501|permission denied for function set_application_status|#applied', 'AC3: an anonymous call has no EXECUTE');
select is(
  pg_temp.set_as(:'mem', gen_random_uuid(), 'interview'), 'P0002|CHARA_NOT_FOUND|',
  'AC3: an unknown id gives the very answer an application of another organisation gives'
);
select is(pg_temp.set_as(:'mem', null, 'interview'), 'P0002|CHARA_NOT_FOUND|', 'AC3: so does a null id');

create temp table t_suspended as select pg_temp.org_on() as org;
select pg_temp.seed_app('applied', (select org from t_suspended)) as susp_app \gset
update public.organizations set status = 'suspended' where id = (select org from t_suspended);
select is(
  pg_temp.set_as(pg_temp.member_of((select org from t_suspended)), :'susp_app', 'interview'),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'AC3: a member of a suspended organisation gets CHARA_FORBIDDEN, detail organization_suspended'
);
select is(pg_temp.status_of(:'susp_app'), 'applied', 'AC3: the application of a suspended organisation is unchanged');
select is(
  pg_temp.viewed_as(pg_temp.member_of((select org from t_suspended)), :'susp_app') || pg_temp.status_of(:'susp_app'), 'okapplied',
  'AC3: opening the application of a suspended organisation moves nothing and raises nothing'
);
select is(
  pg_temp.bulk_as(pg_temp.member_of((select org from t_suspended)), array[:'susp_app'::uuid], 'interview'),
  ('[{"ok": false, "application_id": "' || :'susp_app' || '", "error_code": "CHARA_FORBIDDEN"}]')::jsonb,
  'AC3: a bulk call reports the item of a suspended organisation as CHARA_FORBIDDEN'
);

-- FR-D2 AC4: the plan gates. entitlements_enforced is a global setting, so the organisations are tried with it false and
-- then true: R never subscribed, S lapsed (a cancelled subscription), P on employer_starter, Q on a paid plan with no
-- shortlisting feature, T never subscribed.
insert into billing.plans (code, org_type, name, price_minor, currency, interval, trial_days, is_public, sort)
values ('employer_noshort', 'employer', 'No shortlist', 100, 'EUR', 'month', 0, false, 99);
create temp table t_orgs as
  select 'P' as k, pg_temp.org_on('employer_starter') as org
  union all select 'Q', pg_temp.org_on('employer_noshort')
  union all select 'R', pg_temp.org_on()
  union all select 'S', pg_temp.org_on('employer_starter', 'canceled')
  union all select 'T', pg_temp.org_on();
create function pg_temp.gate(p_key text, p_target text) returns text
language plpgsql as $$
declare
  v_org uuid := (select org from t_orgs where k = p_key);
  v_app uuid := pg_temp.seed_app('applied', v_org);
begin
  return pg_temp.set_as(pg_temp.member_of(v_org), v_app, p_target) || '#' || pg_temp.status_of(v_app);
end;
$$;
create function pg_temp.bulk_gate(p_key text, p_target text) returns text
language plpgsql as $$
declare
  v_org uuid := (select org from t_orgs where k = p_key);
  v_app uuid := pg_temp.seed_app('applied', v_org);
  v_result jsonb := pg_temp.bulk_as(pg_temp.member_of(v_org), array[v_app], p_target);
begin
  return case when jsonb_typeof(v_result) = 'string' then v_result #>> '{}'
              when v_result -> 0 ->> 'ok' = 'true' then 'ok' else v_result -> 0 ->> 'error_code' end
         || '#' || pg_temp.status_of(v_app);
end;
$$;
create function pg_temp.open_gate(p_key text) returns text
language plpgsql as $$
declare
  v_org uuid := (select org from t_orgs where k = p_key);
  v_app uuid := pg_temp.seed_app('applied', v_org);
begin
  return pg_temp.viewed_as(pg_temp.member_of(v_org), v_app) || '#' || pg_temp.status_of(v_app);
end;
$$;

update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(pg_temp.gate('R', 'shortlisted'), 'ok#shortlisted', 'AC4: never subscribed, limits not enforced: shortlisting works');
select is(pg_temp.gate('R', 'interview'), 'ok#interview', 'AC4: never subscribed, limits not enforced: interview works');
select is(pg_temp.gate('S', 'shortlisted'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan#applied', 'AC4: a lapsed organisation cannot shortlist');
select is(pg_temp.gate('S', 'interview'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan#applied', 'AC4: a lapsed organisation cannot move to interview');
select is(pg_temp.bulk_gate('S', 'interview'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan#applied', 'AC4: a lapsed organisation is refused a bulk call as a whole');
select is(pg_temp.open_gate('S'), 'ok#applied', 'AC4: opening an application of a lapsed organisation leaves it Applied');
select is(pg_temp.open_gate('R'), 'ok#viewed', 'AC4: opening an application of an organisation that never subscribed moves it to Viewed');

update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.gate('P', 'shortlisted'), 'ok#shortlisted', 'AC4: employer_starter can shortlist');
select is(pg_temp.gate('P', 'interview'), 'ok#interview', 'AC4: employer_starter can move to interview');
select is(pg_temp.gate('Q', 'shortlisted'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|shortlisting#applied', 'AC4: a plan without the shortlisting feature raises CHARA_FEATURE_NOT_IN_PLAN, detail shortlisting');
select is(pg_temp.gate('Q', 'interview'), 'ok#interview', 'AC4: the same plan can move to interview');
select is(pg_temp.bulk_gate('Q', 'shortlisted'), 'CHARA_FEATURE_NOT_IN_PLAN#applied', 'AC4: a bulk call refuses the shortlisting item of that plan, with the code');
select is(pg_temp.bulk_gate('P', 'shortlisted'), 'ok#shortlisted', 'AC4: a bulk call shortlists on employer_starter');
select is(pg_temp.gate('T', 'shortlisted'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan#applied', 'AC4: with limits enforced an organisation on free_employer cannot shortlist');
select is(pg_temp.gate('T', 'interview'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan#applied', 'AC4: nor move to interview');
select is(pg_temp.bulk_gate('T', 'interview'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan#applied', 'AC4: nor in a bulk call');
select is(pg_temp.open_gate('T'), 'ok#applied', 'AC4: with limits enforced, opening an application on free_employer leaves it Applied');
select is(pg_temp.open_gate('P'), 'ok#viewed', 'AC4: a paid plan opens to Viewed');

select * from finish();
rollback;
