begin;
select plan(120);

\ir apply_fixture.inc
\ir billing_events_fixture.inc

-- Workforce requirement plan limits (V34, FR-M4 AC1 to AC7, AC10 and the database parts of AC8, AC9 and AC11; SOP P2-18;
-- NFR-A4, NFR-S8; DATA_MODEL.md sections 2, 4 and 8): the active_requirements check on every change to Open, serialised
-- per organisation, the multi_country_requirements check on further destinations, save_requirement with
-- p_additional_countries, the pause on a lapse above the free plan's limit, the usage reads and the prompt event. Acme
-- (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner own2, admin adm2) are employers of the fixture; wa is a
-- candidate. Every other organisation is made below with own1 as its owner.

create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'utc')::date $$;

create function pg_temp.subscribe(p_org uuid, p_plan text, p_status text default 'active') returns void
language sql as $$
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (p_org, p_plan, p_status, 'null')
$$;

create function pg_temp.enforce(p_on boolean) returns void
language sql as $$ update private.settings set value = to_jsonb(p_on) where key = 'entitlements_enforced' $$;

-- A requirement of p_org in p_status written as the database owner (an insert passes no trigger of the status), as the
-- lifecycle functions leave it, with the destinations p_countries (the first is the main one).
create function pg_temp.seed_req(
  p_org uuid, p_status text, p_title text default null, p_countries text[] default array['DE'],
  p_published timestamptz default now() - interval '10 days'
) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_published boolean := p_status <> 'draft';
begin
  insert into public.workforce_requirements (
    organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on, close_reason, status_changed_at,
    updated_at
  ) values (
    p_org, coalesce(p_title, 'Welders ' || p_status), 10, p_countries[1], 'Hamburg', 'C', pg_temp.today() + 30, 'full_time',
    'international', 'both', p_status::public.requirement_status,
    case when v_published then 'private'::public.requirement_visibility end,
    case when v_published then p_published end,
    case when v_published then pg_temp.today() + 80 end,
    case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason,
    now() - interval '1 day', now() - interval '1 day'
  ) returning id into v_id;
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) select v_id, unnest(p_countries);
  return v_id;
end;
$$;

create function pg_temp.seed_many(p_org uuid, p_status text, p_count integer) returns void
language sql as $$ select pg_temp.seed_req(p_org, p_status, p_status || ' ' || n) from generate_series(1, p_count) n $$;

create function pg_temp.version(p_req uuid) returns timestamptz
language sql as $$ select updated_at from public.workforce_requirements where id = p_req $$;

create function pg_temp.org_of(p_req uuid) returns uuid
language sql as $$ select organization_id from public.workforce_requirements where id = p_req $$;

create function pg_temp.pub(p_user uuid, p_req uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    'select public.publish_requirement(%L, %L, ''private'', false, %L::timestamptz)',
    pg_temp.org_of(p_req), p_req, pg_temp.version(p_req)))
$$;

create function pg_temp.st(p_user uuid, p_req uuid, p_status text) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    'select public.set_requirement_status(%L, %L, %L::public.requirement_status, %L::timestamptz)',
    pg_temp.org_of(p_req), p_req, p_status, pg_temp.version(p_req)))
$$;

-- save_requirement as the user with the fields of seed_req, the main country p_country, the title p_title and the
-- further destinations p_more (null keeps them); p_req null creates a draft of p_org.
create function pg_temp.save(
  p_user uuid, p_org uuid, p_req uuid, p_more text[], p_country text default 'DE', p_title text default null
) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.saved', public.save_requirement(
      p_org => %L, p_requirement => %L, p_expected_updated_at => %L::timestamptz, p_workers_needed => 10,
      p_country_code => %L, p_city_region => 'Hamburg', p_industry_code => 'C',
      p_occupations => '[{"occupation_id": "7212", "quantity": 10}]', p_start_date => %L::date,
      p_employment_type => 'full_time', p_recruitment_preference => 'international', p_partner_need => 'both',
      p_accommodation => false, p_work_permit_support => false, p_visa_support => false, p_title => %L,
      p_additional_countries => %L::text[])::text, true)$f$,
    p_org, p_req, case when p_req is not null then pg_temp.version(p_req) end, p_country,
    coalesce((select start_date from public.workforce_requirements where id = p_req), pg_temp.today() + 30),
    coalesce(p_title, 'Welders'), p_more))
$$;

create function pg_temp.countries(p_req uuid) returns text
language sql as $$
  select coalesce(string_agg(country_code, ',' order by country_code), '') from public.requirement_countries where requirement_id = p_req
$$;

create function pg_temp.state(p_req uuid) returns text
language sql as $$ select status::text from public.workforce_requirements where id = p_req $$;

create function pg_temp.open_count(p_org uuid) returns integer
language sql as $$ select count(*)::integer from public.workforce_requirements where organization_id = p_org and status = 'open' $$;

create function pg_temp.status_audits(p_req uuid) returns integer
language sql as $$
  select count(*)::integer from audit.log where action = 'requirement.status_changed' and entity_id = p_req::text
$$;

-- A query run as the user: its single value, or 'sqlstate|message|detail' when refused.
create function pg_temp.read_as(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text end, true);
  execute format('set local role %I', case when p_user is null then 'anon' else 'authenticated' end);
  begin
    execute p_sql into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- Concurrency at the boundary (NFR-A4, AC8) -----------------------------------------------------------------------------
-- A second session publishes a requirement of an organisation at 2 of its 3 open requirements and keeps its transaction
-- open; this one finds the organisation's advisory lock taken, waits for it, and once the other publish is committed
-- counts it and is refused. The organisation, its owner and the release switch must be committed for the second session,
-- so a third session writes them and removes them again at the end of the block (the audit rows stay: audit.log is
-- append-only). This transaction reads the committed release switch and changes only entitlements_enforced, which the
-- third session does not write, so no session waits for a row this one holds.
select gen_random_uuid() as cown, gen_random_uuid() as org_c, gen_random_uuid() as c_d1, gen_random_uuid() as c_d2 \gset
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('setup',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_exec('setup', format($$
  begin;
  update private.settings set value = 'true' where key = 'release_job_orders';
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%1$L, %1$L || '@employer.test', now(), '{"intended_account_kind": "company"}');
  update public.profiles set account_kind = intended_account_kind where id = %1$L;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (%2$L, 'employer', 'org-' || left(%2$L, 8), 'Org Lock C', 'Org Lock C', 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (%2$L, %1$L, 'owner', now());
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (%2$L, 'employer_starter', 'active', 'null');
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on, updated_at
  )
  select coalesce(d.id, gen_random_uuid()), %2$L, 'Lock ' || n, 10, 'DE', 'Hamburg', 'C', current_date + 30, 'full_time',
    'international', 'both', d.status::public.requirement_status,
    case when d.status = 'open' then 'private'::public.requirement_visibility end,
    case when d.status = 'open' then now() end, case when d.status = 'open' then current_date + 80 end,
    '2026-01-01T00:00:00Z'
  from (values (1, null::uuid, 'open'), (2, null::uuid, 'open'), (3, %3$L::uuid, 'draft'), (4, %4$L::uuid, 'draft'))
    d (n, id, status);
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select id, '7212', 10 from public.workforce_requirements where organization_id = %2$L;
  insert into public.requirement_countries (requirement_id, country_code)
  select id, 'DE' from public.workforce_requirements where organization_id = %2$L;
  commit;
$$, :'cown', :'org_c', :'c_d1', :'c_d2'));
select pg_temp.enforce(true);
select is(pg_temp.open_count(:'org_c'), 2, 'the organisation of the concurrency test holds 2 of its 3 open requirements');
select is(
  (select t from extensions.dblink('holder', format($$
    begin;
    select set_config('request.jwt.claims', json_build_object('sub', %L, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;
    select (public.publish_requirement(%L, %L, 'private', false, '2026-01-01T00:00:00Z')) ->> 'status';
  $$, :'cown', :'org_c', :'c_d1')) as r (t text)),
  'open',
  'a second session publishes the third requirement and keeps its transaction open'
);
select is(pg_try_advisory_xact_lock(hashtextextended('active_requirements:' || :'org_c', 0)), false,
  'NFR-A4: the publish in progress holds the advisory lock of the organisation''s open requirements');
set local lock_timeout = '300ms';
select is(split_part(pg_temp.pub(:'cown', :'c_d2'), '|', 1), '55P03', 'NFR-A4: a publish at the same time waits for it');
select pg_temp.new_org(:'own1') as o_free \gset
select pg_temp.subscribe(:'o_free', 'employer_professional');
select pg_temp.seed_req(:'o_free', 'draft', 'Unrelated draft') as r_free \gset
select is(pg_temp.pub(:'own1', :'r_free'), 'ok', 'NFR-A4: a publish of another organisation does not wait');
select extensions.dblink_exec('holder', 'commit');
reset lock_timeout;
select is(pg_temp.pub(:'cown', :'c_d2'), 'P0001|CHARA_LIMIT_REACHED|active_requirements',
  'NFR-A4, AC8: once the other publish is committed, this one counts it and is refused at the limit');
select is(pg_temp.open_count(:'org_c'), 3, 'NFR-A4, AC8: the organisation ends at its limit of 3, never above');
select is(pg_temp.state(:'c_d2'), 'draft', 'AC8: the refused draft stays draft');
select pg_temp.enforce(false);
select extensions.dblink_disconnect('holder');
select extensions.dblink_exec('setup', format($$
  begin;
  delete from public.workforce_requirements where organization_id = %2$L;
  delete from billing.subscriptions where organization_id = %2$L;
  delete from public.organizations where id = %2$L;
  delete from auth.users where id = %1$L;
  update private.settings set value = 'false' where key = 'release_job_orders';
  commit;
$$, :'cown', :'org_c'));
select extensions.dblink_disconnect('setup');
select is(
  (select count(*)::integer from public.organizations where id = :'org_c')
    + (select count(*)::integer from auth.users where id = :'cown')
    + (select count(*)::integer from public.workforce_requirements where organization_id = :'org_c'),
  0,
  'the committed organisation of the concurrency test is removed again'
);

-- Schema ----------------------------------------------------------------------------------------------------------------

select has_trigger('public', 'workforce_requirements', 'workforce_requirements_limit_check', 'the limit trigger exists');
select is((select tgenabled::text from pg_trigger where tgname = 'workforce_requirements_limit_check'), 'A',
  'the limit trigger fires always, also for a replica session');
select ok(
  'workforce_requirements_guard_transition' < 'workforce_requirements_limit_check',
  'the guard sorts first, so a refused move or role is never reported as a limit');
select has_trigger('public', 'requirement_countries', 'requirement_countries_feature_check', 'the destination trigger exists');
select is((select tgenabled::text from pg_trigger where tgname = 'requirement_countries_feature_check'), 'A',
  'the destination trigger fires always');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname, p.proname) in (('private', 'requirements_enforce_limits'), ('private', 'requirement_countries_enforce_feature'),
     ('public', 'requirement_multi_country'), ('public', 'save_requirement'))),
  'requirement_countries_enforce_feature:true:search_path="" requirement_multi_country:true:search_path="" requirements_enforce_limits:true:search_path="" save_requirement:true:search_path=""',
  'the new and recreated functions are security definer with an empty search_path');
select is((select count(*)::integer from pg_proc where proname = 'save_requirement'), 1,
  'save_requirement has one signature: the one without the destinations is dropped');
select ok(has_function_privilege('authenticated', 'public.requirement_multi_country(uuid)', 'execute'),
  'authenticated may call requirement_multi_country');
select ok(not has_function_privilege('anon', 'public.requirement_multi_country(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.requirement_multi_country(uuid)', 'execute'),
  'anon and service_role may not');
select ok(not has_function_privilege('authenticated', 'private.requirements_enforce_limits()', 'execute')
  and not has_function_privilege('authenticated', 'private.requirement_countries_enforce_feature()', 'execute'),
  'no API role runs the trigger functions');

-- AC1: the limit and the feature are data, closed to users ----------------------------------------------------------------

select is(
  (select string_agg(plan_code || '=' || coalesce(limit_value::text, 'null'), ',' order by limit_value)
   from billing.plan_limits where limit_key = 'active_requirements'),
  'free_employer=0,employer_starter=3,employer_professional=15,employer_enterprise=50',
  'AC1: active_requirements is 0 / 3 / 15 / 50 for free, Basic, Professional and Enterprise');
select is(
  (select string_agg(plan_code, ',' order by plan_code) from billing.plan_features where feature_key = 'multi_country_requirements'),
  'employer_enterprise,employer_professional',
  'AC1: multi_country_requirements is on Professional and Enterprise only');
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$update billing.plan_limits set limit_value = 99 where limit_key = 'active_requirements'$$),
  '42501|permission denied for table plan_limits|', 'AC1: a user cannot change the limit');
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    $$insert into billing.plan_features (plan_code, feature_key) values ('employer_starter', 'multi_country_requirements')$$),
  '42501|permission denied for table plan_features|', 'AC1: a user cannot add the feature to a plan');
select is(
  pg_temp.call_as(:'own1', 'service_role', $$delete from billing.plan_features where feature_key = 'multi_country_requirements'$$),
  '42501|permission denied for schema billing|', 'AC1: service_role cannot remove it');
select is(
  pg_temp.call_as(null, 'anon', $$update billing.plan_limits set limit_value = 99 where limit_key = 'active_requirements'$$),
  '42501|permission denied for table plan_limits|', 'AC1: anonymous callers cannot change it');

-- Release switch --------------------------------------------------------------------------------------------------------

select is(pg_temp.read_as(:'own1', format('select public.requirement_multi_country(%L)', current_setting('t.a'))),
  '42501|CHARA_FORBIDDEN|release_off', 'release 2b off: requirement_multi_country is refused');
select is(pg_temp.save(:'own1', current_setting('t.a')::uuid, null, array['NL']), 'P0001|CHARA_FORBIDDEN|release_off',
  'release 2b off: a save with destinations is refused');
update private.settings set value = 'true' where key = 'release_job_orders';

-- AC2: publish at the boundary of each plan -------------------------------------------------------------------------------

select pg_temp.enforce(true);
create temp table t_ac2 (plan text, org uuid, d1 uuid, d2 uuid, r1 text, r2 text, n1 integer, n2 integer);
insert into t_ac2 (plan, org) select p, pg_temp.new_org(:'own1')
from unnest(array['employer_starter', 'employer_professional', 'employer_enterprise']) p;
select pg_temp.subscribe(org, plan) from t_ac2;
select pg_temp.seed_many(org, 'open', case plan when 'employer_starter' then 2 when 'employer_professional' then 14 else 49 end)
from t_ac2;
update t_ac2 set d1 = pg_temp.seed_req(org, 'draft', 'AC2 draft 1'), d2 = pg_temp.seed_req(org, 'draft', 'AC2 draft 2');
update t_ac2 set r1 = pg_temp.pub(:'own1', d1);
update t_ac2 set n1 = pg_temp.open_count(org);
update t_ac2 set r2 = pg_temp.pub(:'own1', d2);
update t_ac2 set n2 = pg_temp.open_count(org);
select is(string_agg(plan || ' ' || r1 || ' ' || n1, ', ' order by n1),
  'employer_starter ok 3, employer_professional ok 15, employer_enterprise ok 50',
  'AC2: the publish that reaches 3, 15 and 50 open requirements succeeds') from t_ac2;
select is(string_agg(plan || ' ' || r2 || ' ' || n2, ', ' order by n2),
  'employer_starter P0001|CHARA_LIMIT_REACHED|active_requirements 3, employer_professional P0001|CHARA_LIMIT_REACHED|active_requirements 15, employer_enterprise P0001|CHARA_LIMIT_REACHED|active_requirements 50',
  'AC2: the next publish is refused with CHARA_LIMIT_REACHED and detail active_requirements') from t_ac2;
select is((select count(*)::integer from t_ac2 where pg_temp.state(d2) = 'draft' and pg_temp.status_audits(d2) = 0), 3,
  'AC2: each refused requirement stays draft with no status audit row');

-- AC3: reopening is checked, and only open requirements of the organisation count -----------------------------------------

select pg_temp.new_org(:'own1') as o3 \gset
select pg_temp.subscribe(:'o3', 'employer_starter');
select pg_temp.seed_many(:'o3', 'open', 2);
select pg_temp.seed_req(:'o3', 'draft', 'AC3 draft 1') as a3_d1 \gset
select pg_temp.seed_req(:'o3', 'draft', 'AC3 draft 2') as a3_d2 \gset
select pg_temp.seed_req(:'o3', 'paused', 'AC3 paused 1') as a3_p1 \gset
select pg_temp.seed_req(:'o3', 'paused', 'AC3 paused 2') as a3_p2 \gset
select pg_temp.seed_req(:'o3', 'closed', 'AC3 closed') as a3_c \gset
select pg_temp.seed_req(:'o3', 'filled', 'AC3 filled') as a3_f \gset
select pg_temp.open_job('AC3 vacancy ' || n, :'o3') from generate_series(1, 3) n;
select pg_temp.seed_many(current_setting('t.b')::uuid, 'open', 3);
select is(private.limit_usage(:'o3', 'active_requirements'), 2,
  'AC3: drafts, paused, closed and filled requirements, the vacancies and Beta''s requirements are not counted');
select is(private.limit_usage(:'o3', 'active_jobs'), 3, 'AC3: the open vacancies count against their own key');
select is(pg_temp.st(:'own1', :'a3_p1', 'open'), 'ok', 'AC3: the first reopen succeeds');
select is(pg_temp.open_count(:'o3'), 3, 'AC3: 3 open requirements');
select is(pg_temp.st(:'own1', :'a3_p2', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_requirements', 'AC3: the second reopen is refused');
select is(pg_temp.pub(:'own1', :'a3_d1'), 'P0001|CHARA_LIMIT_REACHED|active_requirements', 'AC3: and so is a publish');
select is(pg_temp.state(:'a3_p2') || ',' || pg_temp.state(:'a3_d1'), 'paused,draft', 'AC3: both keep their status');
select is(pg_temp.st(:'own1', :'a3_p1', 'paused'), 'ok', 'pausing is never limited');
select is(pg_temp.st(:'own1', :'a3_p2', 'open'), 'ok', 'after a pause the other reopen goes through');
select is(pg_temp.st(:'adm', :'a3_d2', 'paused'), 'P0001|CHARA_FORBIDDEN|',
  'an admin of another organisation is refused before any limit');
select is(pg_temp.st(:'own1', :'a3_c', 'open'), 'P0001|CHARA_INVALID_TRANSITION|closed to open',
  'a closed requirement answers the guard''s refusal, not the limit');

-- AC4: several destinations need multi_country_requirements ---------------------------------------------------------------

select pg_temp.new_org(:'own1') as o4b \gset
select pg_temp.subscribe(:'o4b', 'employer_starter');
select pg_temp.new_org(:'own1') as o4p \gset
select pg_temp.subscribe(:'o4p', 'employer_professional');
select pg_temp.seed_req(:'o4b', 'draft', 'AC4 basic') as r4b \gset
select pg_temp.seed_req(:'o4p', 'draft', 'AC4 professional') as r4p \gset
select is(pg_temp.save(:'own1', :'o4b', :'r4b', array['NL']), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|multi_country_requirements',
  'AC4: a Basic organisation adding NL is refused with CHARA_FEATURE_NOT_IN_PLAN');
select is(pg_temp.countries(:'r4b'), 'DE', 'AC4: no requirement_countries row is written');
select is(pg_temp.save(:'own1', :'o4b', :'r4b', '{}', 'DE', 'AC4 basic renamed'), 'ok',
  'a Basic organisation saves its single destination');
select is(pg_temp.save(:'own1', :'o4p', :'r4p', array['NL', 'nl', ' AT', 'DE'], 'DE', 'AC4 professional'), 'ok', 'AC4: a Professional organisation adds NL and AT');
select is(pg_temp.countries(:'r4p'), 'AT,DE,NL', 'AC4: the codes are upper-cased, repeats and the main country dropped');
select is(
  (select metadata -> 'changed_fields' from audit.log where action = 'requirement.updated' and entity_id = :'r4p' order by id desc limit 1),
  '["countries"]'::jsonb, 'requirement.updated names countries when the destinations change');
select is(pg_temp.save(:'own1', :'o4p', :'r4p', null, 'DE', 'AC4 professional renamed'), 'ok', 'a save without p_additional_countries');
select is(pg_temp.countries(:'r4p'), 'AT,DE,NL', 'keeps the destinations');
select is(pg_temp.save(:'own1', :'o4p', :'r4p', array['AT', 'DE'], 'NL'), 'ok', 'the main country moves to a former destination');
select is(pg_temp.countries(:'r4p') || ' ' || (select country_code from public.workforce_requirements where id = :'r4p'), 'AT,DE,NL NL',
  'the former main country stays a destination');
select is(pg_temp.save(:'own1', :'o4p', null, array['FR']), 'ok', 'AC4: a new Professional draft with two destinations');
select is(pg_temp.countries(current_setting('t.saved')::uuid), 'DE,FR', 'AC4: both are written with it');
select is(pg_temp.save(:'own1', :'o4p', :'r4p', array['AT', 'BE', 'CZ', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HU'], 'NL'),
  'P0001|CHARA_INVALID_INPUT|countries', 'more than 9 further destinations are refused');
select is(pg_temp.save(:'own1', :'o4p', :'r4p', array['A1'], 'NL'), 'P0001|CHARA_INVALID_INPUT|countries', 'a code that is not two letters is refused');
select is(pg_temp.save(:'own1', :'o4p', :'r4p', array[null], 'NL'), 'P0001|CHARA_INVALID_INPUT|countries', 'and so is a null code');
select alike(pg_temp.save(:'own1', :'o4p', :'r4p', array['XX'], 'NL'), '23503|%requirement_countries_country_code_fkey%',
  'NFR-M3: an unknown code is refused by the foreign key to the code list');

select pg_temp.new_org(:'own1') as o4d \gset
select pg_temp.subscribe(:'o4d', 'employer_professional');
select pg_temp.seed_req(:'o4d', 'open', 'AC4 downgraded', array['DE', 'NL']) as r4d \gset
select pg_temp.seed_req(:'o4d', 'draft', 'AC4 two-country draft', array['DE', 'NL']) as r4dd \gset
update billing.subscriptions set plan_code = 'employer_starter' where organization_id = :'o4d';
select is(pg_temp.state(:'r4d'), 'open', 'AC4: the downgraded organisation keeps its open two-country requirement');
select is(pg_temp.save(:'own1', :'o4d', :'r4d', array['NL'], 'DE', 'AC4 downgraded renamed'), 'ok',
  'AC4: it may edit fields other than the destinations');
select is(pg_temp.save(:'own1', :'o4d', :'r4d', array['NL', 'AT']), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|multi_country_requirements',
  'AC4: it adds no destination');
select is(pg_temp.save(:'own1', :'o4d', :'r4d', array['NL'], 'AT'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|multi_country_requirements',
  'AC4: nor moves the main country while another destination remains');
select is(pg_temp.st(:'own1', :'r4d', 'paused'), 'ok', 'AC4: it pauses the requirement');
select is(pg_temp.st(:'own1', :'r4d', 'open'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|multi_country_requirements',
  'AC4: reopening is refused while it has two destinations');
select is(pg_temp.save(:'own1', :'o4d', :'r4d', '{}'), 'ok', 'AC4: one destination is removed');
select is(pg_temp.countries(:'r4d'), 'DE', 'AC4: the requirement keeps its main country');
select is(pg_temp.st(:'own1', :'r4d', 'open'), 'ok', 'AC4: then it reopens');
select is(pg_temp.pub(:'own1', :'r4dd'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|multi_country_requirements',
  'AC4: publishing a two-country draft without the feature is refused');
select is(pg_temp.state(:'r4dd'), 'draft', 'AC4: and it stays draft');
select throws_ok(format($$insert into public.requirement_countries values (%L, 'AT')$$, :'r4b'),
  'P0001', 'CHARA_FEATURE_NOT_IN_PLAN', 'AC4: the check holds for any writer of requirement_countries');

-- AC5: the enforcement switch and the free plan -----------------------------------------------------------------------------

select pg_temp.new_org(:'own1') as o5 \gset
select pg_temp.subscribe(:'o5', 'employer_starter');
select pg_temp.seed_many(:'o5', 'open', 3);
select pg_temp.seed_req(:'o5', 'draft', 'AC5 basic 1') as r5a \gset
select pg_temp.seed_req(:'o5', 'draft', 'AC5 basic 2') as r5b \gset
select pg_temp.new_org(:'own1') as o5n \gset
select pg_temp.seed_req(:'o5n', 'draft', 'AC5 never 1') as r5n1 \gset
select pg_temp.seed_req(:'o5n', 'draft', 'AC5 never 2') as r5n2 \gset
select pg_temp.new_org(:'own1') as o5l \gset
select pg_temp.subscribe(:'o5l', 'employer_starter', 'canceled');
select pg_temp.seed_req(:'o5l', 'draft', 'AC5 lapsed 1') as r5l1 \gset
select pg_temp.seed_req(:'o5l', 'draft', 'AC5 lapsed 2') as r5l2 \gset
select pg_temp.enforce(false);
select is(pg_temp.pub(:'own1', :'r5a'), 'ok', 'AC5: with the switch off a Basic organisation at 3 of 3 publishes');
select is(pg_temp.pub(:'own1', :'r5n1'), 'ok', 'AC5: with the switch off an organisation that never subscribed publishes (see departure 1)');
select is(pg_temp.pub(:'own1', :'r5l1'), 'P0001|CHARA_LIMIT_REACHED|active_requirements',
  'AC5: a lapsed organisation is refused with the switch off (free plan, limit 0)');
select is(pg_temp.save(:'own1', :'o5', :'r5b', array['NL']), 'ok', 'with the switch off a Basic organisation adds a destination');
select is(pg_temp.read_as(:'own1', format('select public.requirement_multi_country(%L)', :'o5')), 'true',
  'and the form is told so');
select is(pg_temp.save(:'own1', :'o5l', :'r5l2', array['NL']), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|multi_country_requirements',
  'a lapsed organisation adds no destination with the switch off');
select pg_temp.enforce(true);
select is(pg_temp.save(:'own1', :'o5', :'r5b', '{}'), 'ok', 'the destination is removed again');
select is(pg_temp.pub(:'own1', :'r5b'), 'P0001|CHARA_LIMIT_REACHED|active_requirements', 'AC5: with the switch on the Basic organisation is refused');
select is(pg_temp.pub(:'own1', :'r5n2'), 'P0001|CHARA_LIMIT_REACHED|active_requirements',
  'AC5: with the switch on the never-subscribed organisation is refused (free plan, limit 0)');
select is(pg_temp.pub(:'own1', :'r5l2'), 'P0001|CHARA_LIMIT_REACHED|active_requirements', 'AC5: and the lapsed one still is');
select is(pg_temp.read_as(:'own1', format('select public.requirement_multi_country(%L)', :'o5')), 'false',
  'with the switch on a Basic organisation is not offered further destinations');
select is(pg_temp.read_as(:'own1', format('select public.requirement_multi_country(%L)', :'o4p')), 'true',
  'a Professional organisation is');

-- AC6: the per-organisation Enterprise override -----------------------------------------------------------------------------

select pg_temp.new_org(:'own1') as o6 \gset
select pg_temp.subscribe(:'o6', 'employer_enterprise');
select pg_temp.seed_many(:'o6', 'open', 50);
select pg_temp.seed_req(:'o6', 'draft', 'AC6 51st') as r6a \gset
select pg_temp.seed_req(:'o6', 'draft', 'AC6 52nd') as r6b \gset
insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value, expires_at)
values (:'o6', 'active_requirements', 80, now() + interval '1 day');
select is(
  (select count(*)::integer from audit.log where action = 'billing.plan_changed' and entity_id = :'o6'
     and metadata ->> 'limit_key' = 'active_requirements' and metadata -> 'after' ->> 'limit_value' = '80'),
  1, 'AC6: the override is one audit row with its new value');
select is(pg_temp.pub(:'own1', :'r6a'), 'ok', 'AC6: with the override of 80 the 51st publish succeeds');
update billing.organization_limit_overrides set expires_at = now() - interval '1 minute'
where organization_id = :'o6' and limit_key = 'active_requirements';
select is(pg_temp.pub(:'own1', :'r6b'), 'P0001|CHARA_LIMIT_REACHED|active_requirements',
  'AC6: once the override expired the plan''s 50 applies again');
select is(pg_temp.open_count(:'o6'), 51, 'AC6: the open requirements stay open');
select pg_temp.join_org(:'o6', :'mem', 'member');
select is(
  pg_temp.call_as(:'mem', 'authenticated',
    format($$insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value) values (%L, 'active_requirements', 999)$$, :'o6')),
  '42501|permission denied for table organization_limit_overrides|', 'AC6: a member of the organisation cannot write an override');
select is(pg_temp.st(:'mem', :'r6b', 'paused'), 'P0001|CHARA_FORBIDDEN|', 'a member changes no requirement status');

-- AC7: a lapse pauses the requirements above the free plan's limit, newest first ---------------------------------------------

select pg_temp.new_org(:'own1') as o7 \gset
select pg_temp.deliver('act_o7', 'subscription.activated', pg_temp.sub_event(:'o7', 'employer_starter', 'active', 'sub_o7'),
  '2026-11-01T00:00:00Z') as ignored \gset
select pg_temp.seed_req(:'o7', 'open', 'L 1 March', array['DE'], '2027-03-01T09:00:00Z') as l7_1 \gset
select pg_temp.seed_req(:'o7', 'open', 'L 2 March', array['DE'], '2027-03-02T09:00:00Z') as l7_2 \gset
select pg_temp.seed_req(:'o7', 'open', 'L 3 March', array['DE'], '2027-03-03T09:00:00Z') as l7_3 \gset
select pg_temp.seed_req(:'o7', 'open', 'L 4 March', array['DE'], '2027-03-04T09:00:00Z') as l7_4 \gset
select pg_temp.seed_req(:'o7', 'draft', 'L draft') as l7_d \gset
create function pg_temp.lapse_states(p_org uuid) returns text
language sql as $$
  select string_agg(title || ':' || status, ',' order by title) from public.workforce_requirements where organization_id = p_org
$$;
select is(
  pg_temp.deliver('del_o7', 'subscription.canceled', pg_temp.sub_event(:'o7', 'employer_starter', 'canceled', 'sub_o7'),
    '2026-11-05T00:00:00Z'),
  'applied', 'AC7: the lapse is applied');
select is(pg_temp.lapse_states(:'o7'), 'L 1 March:paused,L 2 March:paused,L 3 March:paused,L 4 March:paused,L draft:draft',
  'AC7: with the free plan''s 0 all four open requirements are paused and the draft is untouched');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.status_changed' and entity_id in (:'l7_1', :'l7_2', :'l7_3', :'l7_4')
     and actor_id is null and metadata ->> 'actor_fn' = 'pause_requirements_on_lapse'),
  4, 'AC7: one audit row each, made by pause_requirements_on_lapse');

update billing.plan_limits set limit_value = 1 where plan_code = 'free_employer' and limit_key = 'active_requirements';
select pg_temp.new_org(:'own1') as o7b \gset
select pg_temp.deliver('act_o7b', 'subscription.activated', pg_temp.sub_event(:'o7b', 'employer_starter', 'active', 'sub_o7b'),
  '2026-11-01T00:00:00Z') as ignored \gset
select pg_temp.seed_req(:'o7b', 'open', 'M 1 March', array['DE'], '2027-03-01T09:00:00Z') as m7_1 \gset
select pg_temp.seed_req(:'o7b', 'open', 'M 2 March', array['DE'], '2027-03-02T09:00:00Z') as m7_2 \gset
select pg_temp.seed_req(:'o7b', 'open', 'M 3 March', array['DE'], '2027-03-03T09:00:00Z') as m7_3 \gset
select pg_temp.seed_req(:'o7b', 'open', 'M 4 March', array['DE'], '2027-03-04T09:00:00Z') as m7_4 \gset
select is(
  pg_temp.deliver('del_o7b', 'subscription.canceled', pg_temp.sub_event(:'o7b', 'employer_starter', 'canceled', 'sub_o7b'),
    '2026-11-05T00:00:00Z'),
  'applied', 'AC7: a second lapse, with free_employer active_requirements 1');
select is(pg_temp.lapse_states(:'o7b'), 'M 1 March:open,M 2 March:paused,M 3 March:paused,M 4 March:paused',
  'AC7: the requirements of 4, 3 and 2 March are paused and the one of 1 March stays open');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.status_changed'
     and entity_id in (:'m7_1', :'m7_2', :'m7_3', :'m7_4') and metadata ->> 'actor_fn' = 'pause_requirements_on_lapse'),
  3, 'AC7: three audit rows');
select lives_ok(format('select private.pause_requirements_on_lapse(%L)', :'o7b'), 'AC7: a second run');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.status_changed' and entity_id in (:'m7_1', :'m7_2', :'m7_3', :'m7_4')),
  3, 'AC7: changes nothing');
select is((select count(*)::integer from public.workforce_requirements where organization_id in (:'o7', :'o7b')), 9,
  'AC7: nothing is deleted');
update billing.plan_limits set limit_value = null where plan_code = 'free_employer' and limit_key = 'active_requirements';
select pg_temp.new_org(:'own1') as o7c \gset
select pg_temp.subscribe(:'o7c', 'employer_starter', 'canceled');
select pg_temp.seed_req(:'o7c', 'open', 'N open') as n7 \gset
select lives_ok(format('select private.pause_requirements_on_lapse(%L)', :'o7c'), 'a lapse to a plan without a limit');
select is(pg_temp.state(:'n7'), 'open', 'pauses nothing');
update billing.plan_limits set limit_value = 0 where plan_code = 'free_employer' and limit_key = 'active_requirements';

-- The lapse pause holds until a new subscription (task item 2; FR-M2 Paused -> Open) ------------------------------------

select pg_temp.enforce(false);
select is(pg_temp.st(:'own1', :'l7_1', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_requirements',
  'after the lapse the owner cannot reopen a paused requirement, even with the switch off (free plan, limit 0)');
select is(pg_temp.state(:'l7_1'), 'paused', 'it stays paused');
select is(
  pg_temp.deliver('act2_o7', 'subscription.activated', pg_temp.sub_event(:'o7', 'employer_starter', 'active', 'sub2_o7'),
    '2026-11-10T00:00:00Z'),
  'applied', 'a new Basic subscription is applied');
select is(pg_temp.st(:'own1', :'l7_1', 'open'), 'ok', 'then the owner reopens the paused requirement');
select is(pg_temp.state(:'l7_1'), 'open', 'it is open again');

-- AC10: usage next to the vacancy usage ---------------------------------------------------------------------------------------

select pg_temp.enforce(true);
select pg_temp.new_org(:'own1') as o10 \gset
select pg_temp.subscribe(:'o10', 'employer_starter');
select pg_temp.seed_many(:'o10', 'open', 2);
select pg_temp.seed_req(:'o10', 'paused', 'AC10 paused') as r10p \gset
select pg_temp.open_job('AC10 vacancy ' || n, :'o10') from generate_series(1, 3) n;
select pg_temp.join_org(:'o10', :'mem', 'member');
select is(
  pg_temp.read_as(:'own1', format(
    $$select string_agg(format('(%%s, %%s, %%s)', limit_key, used, limit_value), ', ' order by limit_key)
      from public.billing_usage(%L) where limit_key in ('active_jobs', 'active_requirements')$$, :'o10')),
  '(active_jobs, 3, 3), (active_requirements, 2, 3)', 'AC10: billing_usage reports the open requirements next to the vacancies');
select is(pg_temp.read_as(:'adm2', format('select count(*) from public.billing_usage(%L)', :'o10')), 'P0001|CHARA_FORBIDDEN|',
  'AC10: an admin of Beta is refused');
select is(
  pg_temp.read_as(:'mem', format(
    $$select format('%%s|%%s|%%s|%%s', used, limit_value, applies, plan_name) from public.org_usage(%L, array['active_requirements'])$$, :'o10'),
    'aal1'),
  '2|3|t|Basic', 'a member reads the usage through org_usage, without aal2');
select is(pg_temp.read_as(:'own2', format('select count(*) from public.org_usage(%L)', :'o10')), '42501|CHARA_FORBIDDEN|',
  'NFR-S8: an owner of another organisation reads none');
update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.read_as(:'mem', format('select count(*) from public.org_usage(%L)', :'o10')), '42501|CHARA_FORBIDDEN|release_off',
  'org_usage is closed while releases 2a and 2b are both off');
update private.settings set value = 'true' where key = 'release_job_orders';

-- AC9 (database part): the prompt event at the limit ------------------------------------------------------------------------

select is(pg_temp.call_as(:'own1', 'authenticated', format($$select public.record_limit_prompt(%L, 'active_requirements')$$, :'o10')), 'ok',
  'below the limit the prompt call');
select is((select count(*)::integer from audit.log where action = 'limit.prompt_shown' and entity_id = :'o10'), 0, 'records nothing');
select is(pg_temp.st(:'own1', :'r10p', 'open'), 'ok', 'the organisation reaches 3 of 3');
select is(pg_temp.call_as(:'own1', 'authenticated', format($$select public.record_limit_prompt(%L, 'active_requirements')$$, :'o10')), 'ok',
  'AC9: at the limit the prompt call');
select is(
  (select metadata from audit.log where action = 'limit.prompt_shown' and entity_id = :'o10'),
  jsonb_build_object('limit_key', 'active_requirements', 'plan_code', 'employer_starter', 'limit', 3, 'used', 3),
  'AC9: records one limit.prompt_shown row with detail active_requirements');
select is(pg_temp.call_as(:'mem', 'authenticated', format($$select public.record_limit_prompt(%L, 'active_requirements')$$, :'o10')),
  '42501|CHARA_FORBIDDEN|', 'AC9: a member records no prompt');

-- Who may ask about the feature (NFR-S8) ----------------------------------------------------------------------------------------

select is(pg_temp.read_as(:'mem', format('select public.requirement_multi_country(%L)', :'o10'), 'aal1'), 'false',
  'a member of the organisation reads whether the plan has further destinations');
select is(pg_temp.read_as(:'adm2', format('select public.requirement_multi_country(%L)', :'o10')), '42501|CHARA_FORBIDDEN|',
  'an admin of Beta is refused');
select is(pg_temp.read_as(:'wa', format('select public.requirement_multi_country(%L)', :'o10')), '42501|CHARA_FORBIDDEN|',
  'a candidate is refused');
select is(pg_temp.read_as(null, format('select public.requirement_multi_country(%L)', :'o10')),
  '42501|permission denied for function requirement_multi_country|', 'anonymous callers are refused');
select is(pg_temp.read_as(:'mem', 'select count(*) from public.requirement_countries'),
  (select count(*)::text from public.requirement_countries rc join public.workforce_requirements r on r.id = rc.requirement_id
   join public.organization_members m on m.organization_id = r.organization_id and m.user_id = :'mem'),
  'NFR-S8: a member reads the destinations of the requirements of their own organisations only');
select is(pg_temp.read_as(:'own2', format('select count(*) from public.requirement_countries where requirement_id = %L', :'r4p')), '0',
  'NFR-S8: an owner of Beta reads no destination of another organisation');

select pg_temp.enforce(false);
update private.settings set value = 'false' where key = 'release_job_orders';

select * from finish();
rollback;
