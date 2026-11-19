begin;
select plan(66);

\ir organizations_fixture.inc

-- Usage helpers (V13, FR-R1 AC7, AC8, AC10 profile part; NFR-A4, NFR-S8): private.month_start, private.monthly_usage,
-- private.limit_usage, public.org_usage, the partner keys of public.billing_usage and public.record_limit_prompt with
-- its old name kept as a wrapper.

create function pg_temp.new_partner(p_id uuid, p_type text) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.add_member(p_org uuid, p_user uuid, p_role public.member_role, p_accepted boolean default true) returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (p_org, p_user, p_role, case when p_accepted then now() end)
$$;

create function pg_temp.subscribe(p_org uuid, p_plan text, p_status text default 'active') returns void
language sql as $$
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (p_org, p_plan, p_status, 'null')
$$;

-- The first p_count occupations of the code list (from 7212 on).
create function pg_temp.occupations(p_org uuid, p_count integer) returns void
language sql as $$
  insert into public.organization_occupations (organization_id, occupation_id)
  select p_org, code from public.occupations where code >= '7212' order by code limit p_count
$$;

create function pg_temp.countries(p_org uuid, p_scope text, p_codes text[]) returns void
language sql as $$
  insert into public.organization_geographies (organization_id, scope, country_code)
  select p_org, p_scope::public.geography_scope, c from unnest(p_codes) c
$$;

-- p_count listings, one per occupation of the profile from the source country p_country.
create function pg_temp.listings(p_org uuid, p_country text, p_count integer) returns void
language sql as $$
  insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity, available_from)
  select p_org, o.occupation_id, p_country, 10, 5, current_date
  from public.organization_occupations o where o.organization_id = p_org order by o.occupation_id limit p_count
$$;

-- 'key=used/limit;...' of a usage function in key order, or 'sqlstate|message|detail'.
create function pg_temp.usage(p_user uuid, p_fn text, p_org uuid, p_aal text default 'aal1') returns text
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
  v_result text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text end, true);
  set local role authenticated;
  begin
    execute format($q$select string_agg(format('%%s=%%s/%%s', u.limit_key, u.used, coalesce(u.limit_value::text, 'null')), ';'
      order by u.limit_key) from public.%I(%L) u$q$, p_fn, p_org)
    into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- One column of org_usage for one key, read as the user at aal1.
create function pg_temp.usage_of(p_user uuid, p_org uuid, p_key text, p_column text) returns text
language sql as $$
  select pg_temp.val_as(p_user, 'aal1',
    format('select %I::text from public.org_usage(%L) where limit_key = %L', p_column, p_org, p_key))
$$;

create function pg_temp.prompt(p_user uuid, p_org uuid, p_key text, p_aal text default 'aal1') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select public.record_limit_prompt(%L, %L)', p_org, p_key), p_aal)
$$;

create function pg_temp.prompts(p_org uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(l.metadata || jsonb_build_object('actor', l.actor_id) order by l.id), '[]') from audit.log l
  where l.action = 'limit.prompt_shown' and l.entity_id = p_org::text
$$;

create function pg_temp.set_geographies(p_user uuid, p_org uuid, p_sources text[], p_serves text[]) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format('select public.set_organization_geographies(%L, %L, %L)', p_org, p_sources, p_serves), 'aal1')
$$;

create function pg_temp.set_occupations(p_user uuid, p_org uuid, p_count integer) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format('select public.set_organization_workforce_offer(%L, %L, ''{}'', ''{}'', ''international'', ''{}'')', p_org,
      (select array_agg(code order by code) from (select code from public.occupations where code >= '7212' order by code limit p_count) c)),
    'aal1')
$$;

\set ow '00000000-0000-0000-0000-0000000f0001'
\set ad '00000000-0000-0000-0000-0000000f0002'
\set mb '00000000-0000-0000-0000-0000000f0003'
\set pend '00000000-0000-0000-0000-0000000f0004'
\set ow2 '00000000-0000-0000-0000-0000000f0005'
\set ow3 '00000000-0000-0000-0000-0000000f0006'

-- Schema and grants ----------------------------------------------------------------------------------------------------
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
   where oid in ('public.org_usage(uuid, text[])'::regprocedure, 'public.record_limit_prompt(uuid, text)'::regprocedure,
                 'public.billing_usage(uuid)'::regprocedure, 'private.monthly_usage(uuid, text)'::regprocedure,
                 'private.limit_usage(uuid, text)'::regprocedure, 'private.org_usage_keys(uuid)'::regprocedure))
  and (select proconfig = array['search_path=""'] and provolatile = 'i' from pg_proc
       where oid = 'private.month_start(timestamptz)'::regprocedure),
  'the functions are security definer with an empty search_path; month_start is immutable'
);
select ok(
  (select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
     and not has_function_privilege('service_role', f, 'execute'))
   from unnest(array['public.org_usage(uuid, text[])', 'public.record_limit_prompt(uuid, text)']) f),
  'org_usage and record_limit_prompt run for authenticated only'
);
select ok(
  (select bool_and(not has_function_privilege(r, f, 'execute'))
   from unnest(array['private.month_start(timestamptz)', 'private.monthly_usage(uuid, text)', 'private.limit_usage(uuid, text)',
                     'private.org_usage_keys(uuid)']) f
   cross join unnest(array['anon', 'authenticated', 'service_role']) r),
  'no API role executes the private helpers'
);
select is(
  (select value #>> '{}' from private.settings where key = 'limit_prompt_per_org_key_hour_max'), '10',
  'the ceiling per organisation and key is a setting (10 an hour)'
);

-- month_start: the calendar month in UTC -------------------------------------------------------------------------------
select is(
  concat_ws(',',
    private.month_start('2026-11-30 23:59:59.999+00'),
    private.month_start('2026-12-01 00:00:00+00'),
    private.month_start('2026-12-01 03:00:00+05'),
    private.month_start('2027-01-15 12:00:00-08')),
  concat_ws(',', '2026-11-01 00:00:00+00'::timestamptz, '2026-12-01 00:00:00+00'::timestamptz,
    '2026-11-01 00:00:00+00'::timestamptz, '2027-01-01 00:00:00+00'::timestamptz),
  'the last instant of November is November; midnight UTC on 1 December is December; 03:00 in UTC+5 on 1 December is still November in UTC'
);
select is(private.month_start(), date_trunc('month', now() at time zone 'UTC') at time zone 'UTC', 'without an argument it is the current UTC month');

-- Fixture: R (recruitment, Basic, owner ow, admin ad, member mb, an unaccepted member pend), S (staffing, Professional,
-- owner ow2), X (recruitment, lapsed, owner ow3), E (employer on its free plan, owner own1, admin adm).
update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(id, 'recruitment_company') from unnest(array[:'ow', :'ad', :'mb', :'pend', :'ow3']::uuid[]) id;
select pg_temp.new_partner(:'ow2', 'staffing_company');

select pg_temp.new_org(:'ow', 'recruitment_company') as r \gset
select pg_temp.add_member(:'r', :'ad', 'admin');
select pg_temp.add_member(:'r', :'mb', 'member');
select pg_temp.add_member(:'r', :'pend', 'member', false);
select pg_temp.subscribe(:'r', 'recruitment_partner');
select pg_temp.countries(:'r', 'serves_market', array['DE', 'AE', 'SA']);
select pg_temp.countries(:'r', 'sources_from', array['PH', 'NP', 'IN', 'LK', 'BD']);
select pg_temp.occupations(:'r', 4);
select pg_temp.listings(:'r', 'PH', 2);

select pg_temp.new_org(:'ow2', 'staffing_company') as s \gset
select pg_temp.subscribe(:'s', 'staffing_professional');
select pg_temp.new_org(:'ow3', 'recruitment_company') as x \gset
select pg_temp.subscribe(:'x', 'recruitment_partner', 'canceled');
select pg_temp.countries(:'x', 'serves_market', array['DE', 'AE', 'SA']);
select pg_temp.new_org(:'own1', 'employer') as e \gset
select pg_temp.add_member(:'e', :'adm', 'admin');

-- monthly_usage --------------------------------------------------------------------------------------------------------
select is(
  concat_ws(',', private.monthly_usage(:'r', 'job_order_responses_per_month'), private.monthly_usage(:'r', 'candidate_submissions_per_month'),
    private.monthly_usage(:'r', 'messages_per_month')),
  '0,0,0',
  'AC7: the monthly keys count 0 while their tables do not exist (V44, V48, V66 wire them)'
);
select throws_ok(format('select private.monthly_usage(%L, %L)', :'r', 'markets'), '22023', 'CHARA_INVALID_INPUT',
  'a key that is not monthly is refused');
select throws_ok(format('select private.monthly_usage(%L, %L)', :'r', 'no_such_key'), '22023', 'CHARA_INVALID_INPUT',
  'an unknown key is refused');
select throws_ok(format('select private.limit_usage(%L, %L)', :'r', 'partner_invitations_per_requirement'), '22023',
  'CHARA_INVALID_INPUT', 'a per-requirement key has no organisation count');

-- org_usage ------------------------------------------------------------------------------------------------------------
select is(
  pg_temp.usage(:'mb', 'org_usage', :'r'),
  'candidate_submissions_per_month=0/25;job_order_responses_per_month=0/10;listed_occupations=4/10;markets=3/3;members=3/1;messages_per_month=0/100;workforce_listings=2/10',
  'AC8: a member at aal1 reads the partner keys only: 3 served countries (the 5 source countries are not counted), 4 occupations, 2 listings, 3 members'
);
select is(pg_temp.usage(:'ad', 'org_usage', :'r'), pg_temp.usage(:'mb', 'org_usage', :'r'), 'the admin reads the same');
select is(
  pg_temp.usage(:'ow2', 'org_usage', :'s'),
  'candidate_submissions_per_month=0/100;job_order_responses_per_month=0/50;listed_occupations=0/30;markets=0/10;members=1/5;messages_per_month=0/500;workforce_listings=0/50',
  'a staffing company on Professional reads the limits of its plan'
);
select is(
  pg_temp.usage(:'adm', 'org_usage', :'e'),
  'active_jobs=0/0;active_requirements=0/0;members=2/0;messages_per_month=0/0',
  'an employer reads its own keys, the Phase 2 employer keys included and no partner key'
);
select is(
  pg_temp.val_as(:'mb', 'aal1', format(
    $$select string_agg(limit_key || '=' || coalesce((period_resets_at = %L::timestamptz)::text, 'null'), ';' order by limit_key)
      from public.org_usage(%L)$$, (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC', :'r')),
  'candidate_submissions_per_month=true;job_order_responses_per_month=true;listed_occupations=null;markets=null;members=null;messages_per_month=true;workforce_listings=null',
  'AC7: the monthly keys reset at the start of the next UTC month, the others never'
);
set local timezone = 'America/Los_Angeles';
select is(
  pg_temp.usage_of(:'mb', :'r', 'messages_per_month', 'period_resets_at')::timestamptz,
  (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC',
  'AC7: the reset date is the next UTC month whatever the session time zone'
);
set local timezone = 'UTC';
select is(pg_temp.usage_of(:'mb', :'r', 'markets', 'plan_name'), 'Basic', 'the plan name is read from billing.plans');
select is(
  pg_temp.val_as(:'mb', 'aal1', format($$select string_agg(limit_key, ',' order by limit_key) from public.org_usage(%L, '{markets,members,no_such_key}')$$, :'r')),
  'markets,members', 'p_keys narrows the rows to the keys named (an unknown one is ignored)'
);
select is(
  pg_temp.usage_of(:'mb', :'r', 'markets', 'applies') || ',' || pg_temp.usage_of(:'ow3', :'x', 'markets', 'applies'),
  'false,true',
  'AC10: while enforcement is off the limit does not apply to an active plan, but it does to a lapsed partner'
);
select is(pg_temp.usage(:'ow3', 'org_usage', :'x'),
  'candidate_submissions_per_month=0/0;job_order_responses_per_month=0/0;listed_occupations=0/10;markets=3/3;members=1/0;messages_per_month=0/0;workforce_listings=0/0',
  'AC10: a lapsed partner reads the limits of its free plan');
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.usage_of(:'mb', :'r', 'markets', 'applies'), 'true', 'with enforcement on the limit applies');
insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value) values (:'r', 'markets', 5);
select is(pg_temp.usage_of(:'mb', :'r', 'markets', 'limit_value'), '3', 'an override is ignored while the plan is not Enterprise (FR-R2)');
update billing.subscriptions set plan_code = 'recruitment_enterprise' where organization_id = :'r';
select is(pg_temp.usage_of(:'mb', :'r', 'markets', 'limit_value'), '5', 'on Enterprise the override replaces the plan limit');
update billing.subscriptions set plan_code = 'recruitment_partner' where organization_id = :'r';
delete from billing.organization_limit_overrides where organization_id = :'r';
update billing.subscriptions set plan_code = 'staffing_enterprise' where organization_id = :'s';
select is(pg_temp.usage_of(:'ow2', :'s', 'markets', 'limit_value'), null, 'Enterprise reads null (unlimited) for markets');
update billing.subscriptions set plan_code = 'staffing_partner' where organization_id = :'s';

-- NFR-S8: members only.
select is(pg_temp.usage(:'ow2', 'org_usage', :'r'), '42501|CHARA_FORBIDDEN|', 'the owner of another partner is refused');
select is(pg_temp.usage(:'own1', 'org_usage', :'r'), '42501|CHARA_FORBIDDEN|', 'an employer is refused');
select is(pg_temp.usage(:'pend', 'org_usage', :'r'), '42501|CHARA_FORBIDDEN|', 'a member who has not accepted is refused');
select is(pg_temp.usage(:'wkr', 'org_usage', :'r'), '42501|CHARA_FORBIDDEN|', 'a candidate is refused');
select is(pg_temp.usage(:'inv', 'org_usage', :'r'), '42501|CHARA_FORBIDDEN|', 'a signed-in non-member is refused');
select is(pg_temp.usage(:'ow', 'org_usage', gen_random_uuid()), '42501|CHARA_FORBIDDEN|', 'an unknown organisation is refused like another one');
select is(
  pg_temp.call_as(null, 'anon', format('select * from public.org_usage(%L)', :'r')),
  '42501|permission denied for function org_usage|', 'anonymous has no EXECUTE'
);
select is(
  pg_temp.call_as(null, 'authenticated', format('select * from public.org_usage(%L)', :'r')),
  '42501|CHARA_FORBIDDEN|', 'a token without a user is refused'
);
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.usage(:'mb', 'org_usage', :'r'), '42501|CHARA_FORBIDDEN|release_off', 'while release 2a is off org_usage is refused');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- billing_usage: the same keys, still owner or admin at aal2 --------------------------------------------------------------
select is(pg_temp.usage(:'ow', 'billing_usage', :'r', 'aal2'), pg_temp.usage(:'mb', 'org_usage', :'r'),
  'the owner at aal2 reads the partner keys on billing_usage with the counts of org_usage');
select is(pg_temp.usage(:'own1', 'billing_usage', :'e', 'aal2'), 'active_jobs=0/0;active_requirements=0/0;members=2/0;messages_per_month=0/0',
  'an employer gets the Phase 2 employer keys');
select is(pg_temp.usage(:'ow', 'billing_usage', :'r', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'the gate is not loosened: aal1 is refused');
select is(pg_temp.usage(:'mb', 'billing_usage', :'r', 'aal2'), 'P0001|CHARA_FORBIDDEN|', 'and a member is refused');

-- NFR-A4: the counts are the ones the limit checks refuse at (enforcement on) --------------------------------------------
select is(pg_temp.usage_of(:'mb', :'r', 'markets', 'used'), '3', 'R is at 3 of 3 served countries');
select is(pg_temp.set_geographies(:'ow', :'r', array['PH', 'NP', 'IN', 'LK', 'BD'], array['DE', 'AE', 'SA', 'FR']),
  'P0001|CHARA_LIMIT_REACHED|markets', 'AC8: a fourth served country is refused with detail markets');
select is(pg_temp.set_geographies(:'ow', :'r', array['PH', 'NP', 'IN', 'LK', 'BD', 'VN'], array['DE', 'AE', 'SA']),
  'ok', 'AC8: a sixth source country is not counted and succeeds');
select is(pg_temp.usage_of(:'mb', :'r', 'markets', 'used'), '3', 'and the served count stays 3');
select is(pg_temp.set_occupations(:'ow', :'r', 10), 'ok', 'at 4 of 10 occupations, up to 10 are accepted');
select is(pg_temp.usage_of(:'mb', :'r', 'listed_occupations', 'used') || '/' || pg_temp.usage_of(:'mb', :'r', 'listed_occupations', 'limit_value'),
  '10/10', 'org_usage reads 10 of 10 occupations');
select is(pg_temp.set_occupations(:'ow', :'r', 11), 'P0001|CHARA_LIMIT_REACHED|listed_occupations',
  'AC8: the eleventh occupation is refused with detail listed_occupations');
select is(
  pg_temp.call_as(:'ow', 'authenticated', format('select public.invite_member(%L, %L, %L)', :'r', 'new@partner.test', 'member')),
  'P0001|CHARA_LIMIT_REACHED|members', 'AC8: at 3 of 1 members an invitation is refused with detail members'
);
select pg_temp.occupations(:'s', 10);
select pg_temp.countries(:'s', 'sources_from', array['PH']);
select pg_temp.listings(:'s', 'PH', 9);
select is(pg_temp.usage_of(:'ow2', :'s', 'workforce_listings', 'used'), '9', 'S on Basic reads 9 of 10 listings');
select is(
  pg_temp.call_as(:'ow2', 'authenticated', format('select public.add_workforce_availability(%L, %L, %L, 10, 5, current_date)', :'s',
    (select max(occupation_id) from public.organization_occupations where organization_id = :'s'), 'PH')),
  'ok', 'the tenth listing is accepted'
);
select is(pg_temp.usage_of(:'ow2', :'s', 'workforce_listings', 'used'), '10', 'and org_usage reads 10 of 10');
select pg_temp.countries(:'s', 'sources_from', array['NP']);
select is(
  pg_temp.call_as(:'ow2', 'authenticated', format('select public.add_workforce_availability(%L, %L, %L, 10, 5, current_date)', :'s',
    (select min(occupation_id) from public.organization_occupations where organization_id = :'s'), 'NP')),
  'P0001|CHARA_LIMIT_REACHED|workforce_listings', 'AC8: the eleventh listing is refused with detail workforce_listings'
);

-- record_limit_prompt --------------------------------------------------------------------------------------------------
create temp table t_baseline as select coalesce(max(id), 0) as id from audit.log;
select is(pg_temp.prompt(:'ad', :'r', 'markets'), 'ok', 'the admin reports the prompt of a refused served country');
select is(pg_temp.prompts(:'r'),
  jsonb_build_array(jsonb_build_object('limit_key', 'markets', 'plan_code', 'recruitment_partner', 'limit', 3, 'used', 3, 'actor', :'ad')),
  'at the limit one row limit.prompt_shown names the key, the plan, the limit, the usage and the actor');
select is(pg_temp.prompt(:'ow', :'r', 'job_order_responses_per_month') || ',' || jsonb_array_length(pg_temp.prompts(:'r')),
  'ok,1', 'below a limit (0 of 10 responses) nothing is recorded');
select is(pg_temp.prompt(:'mb', :'r', 'markets'), '42501|CHARA_FORBIDDEN|', 'a member cannot report a prompt');
select is(pg_temp.prompt(:'ow2', :'r', 'markets'), '42501|CHARA_FORBIDDEN|', 'nor the owner of another partner');
select is(split_part(pg_temp.prompt(null, :'r', 'markets'), '|', 1), '42501', 'nor an anonymous caller');
select is(
  concat_ws(',', pg_temp.prompt(:'ow', :'r', 'active_jobs'), pg_temp.prompt(:'ow', :'r', 'no_such_key'), pg_temp.prompt(:'ow', :'r', null)),
  '22023|CHARA_INVALID_INPUT|limit_key,22023|CHARA_INVALID_INPUT|limit_key,22023|CHARA_INVALID_INPUT|limit_key',
  'a key that is not usage of a partner, an unknown key and no key are refused'
);
update private.settings set value = '2' where key = 'limit_prompt_per_org_key_hour_max';
select pg_temp.prompt(:'ow', :'r', 'markets') as p1 \gset
select pg_temp.prompt(:'ad', :'r', 'markets') as p2 \gset
select pg_temp.prompt(:'ow', :'r', 'members') as p3 \gset
select is(
  (select string_agg(metadata ->> 'limit_key', ',' order by id) from audit.log where id > (select id from t_baseline) and action = 'limit.prompt_shown'),
  'markets,markets,members',
  'a ceiling of 2 per organisation and key stops the third markets prompt from another user; members has its own ceiling'
);
update private.settings set value = '10' where key = 'limit_prompt_per_org_key_hour_max';
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.prompt(:'ow', :'r', 'members'), '42501|CHARA_FORBIDDEN|release_off', 'a partner cannot report while release 2a is off');
select is(pg_temp.call_as(:'adm', 'authenticated', format('select public.record_job_limit_prompt(%L)', :'e'), 'aal1'), 'ok',
  'the old name still works for an employer, which release 2a does not gate');
select is(
  (select metadata from audit.log where action = 'limit.prompt_shown' and entity_id = :'e'),
  jsonb_build_object('limit_key', 'active_jobs', 'plan_code', 'free_employer', 'limit', 0, 'used', 0),
  'and records the open-vacancy prompt through record_limit_prompt'
);
update private.settings set value = 'true' where key = 'release_partner_directories';
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(pg_temp.prompt(:'ow', :'r', 'listed_occupations') || ',' || jsonb_array_length(pg_temp.prompts(:'r')), 'ok,3',
  'while enforcement is off an active partner at a limit records nothing');
select is(pg_temp.prompt(:'ow3', :'x', 'markets') || ',' || (pg_temp.prompts(:'x') -> 0 ->> 'plan_code'), 'ok,free_recruitment_company',
  'AC10: a lapsed partner at its free plan limit is recorded with the free plan');

-- AC8: after an upgrade the same additions succeed without a code change.
update private.settings set value = 'true' where key = 'entitlements_enforced';
update billing.subscriptions set plan_code = 'recruitment_professional' where organization_id = :'r';
select is(pg_temp.set_geographies(:'ow', :'r', array['PH', 'NP', 'IN', 'LK', 'BD', 'VN'], array['DE', 'AE', 'SA', 'FR']),
  'ok', 'AC8: on Professional the fourth served country succeeds');
select is(pg_temp.set_occupations(:'ow', :'r', 11), 'ok', 'AC8: and the eleventh occupation');
select is(pg_temp.usage(:'mb', 'org_usage', :'r'),
  'candidate_submissions_per_month=0/100;job_order_responses_per_month=0/50;listed_occupations=11/30;markets=4/10;members=3/5;messages_per_month=0/500;workforce_listings=2/50',
  'org_usage follows the new plan and the new rows at once');
select max(id) as before_read from audit.log \gset
select pg_temp.usage(:'mb', 'org_usage', :'r') as read1 \gset
select pg_temp.usage(:'ow', 'billing_usage', :'r', 'aal2') as read2 \gset
select is((select count(*)::integer from audit.log where id > :before_read), 0, 'reading the usage writes no audit row');

select * from finish();
rollback;
