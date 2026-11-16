begin;
select plan(71);

\ir organizations_fixture.inc

-- Workforce availability (V12, FR-K3 AC2 to AC6; NFR-S8, NFR-A4, NFR-M3): the table workforce_availability, its read
-- policies, the add, update, confirm and delete functions with the workforce_listings limit, the removal with the
-- profile entry and the confirmation reminder job.

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

create function pg_temp.add_member(p_org uuid, p_user uuid, p_role public.member_role) returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

-- The profile of a partner: the first p_occupations occupations of the code list (from 7212 on) and the source countries.
create function pg_temp.profile(p_org uuid, p_occupations integer, p_sources text[]) returns void
language sql as $$
  insert into public.organization_occupations (organization_id, occupation_id)
  select p_org, code from public.occupations where code >= '7212' order by code limit p_occupations;
  insert into public.organization_geographies (organization_id, scope, country_code)
  select p_org, 'sources_from', c from unnest(p_sources) c;
$$;

-- Runs one statement as the user (anonymous when null) and returns 'ok' or 'sqlstate|message|detail'; the value of the
-- statement lands in t.result.
create function pg_temp.run(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((%s)::text, ''''), true)', p_sql), p_aal)
$$;

create function pg_temp.add(
  p_user uuid, p_org uuid, p_occupation text, p_country text, p_available integer, p_capacity integer, p_from date,
  p_aal text default 'aal2'
) returns text
language sql as $$
  select pg_temp.run(p_user, format('public.add_workforce_availability(%L, %L, %L, %s, %s, %L)',
    p_org, p_occupation, p_country, coalesce(p_available::text, 'null'), coalesce(p_capacity::text, 'null'), p_from), p_aal)
$$;

-- Adds the listings numbered p_from to p_to of the partner's (occupation, country) pairs; 'ok' or the first refusal.
create function pg_temp.fill(p_user uuid, p_org uuid, p_from integer, p_to integer) returns text
language plpgsql as $$
declare
  v_pair record;
  v_result text;
begin
  for v_pair in
    select o.occupation_id, g.country_code
    from public.organization_occupations o
    join public.organization_geographies g on g.organization_id = o.organization_id and g.scope = 'sources_from'
    where o.organization_id = p_org
    order by o.occupation_id, g.country_code
    offset p_from - 1 limit p_to - p_from + 1
  loop
    v_result := pg_temp.add(p_user, p_org, v_pair.occupation_id, v_pair.country_code, 10, 5, current_date);
    if v_result <> 'ok' then
      return v_result;
    end if;
  end loop;
  return 'ok';
end;
$$;

create function pg_temp.listings(p_org uuid) returns integer
language sql as $$ select count(*)::integer from public.workforce_availability where organization_id = p_org $$;

create function pg_temp.listing(p_org uuid, p_occupation text, p_country text) returns uuid
language sql as $$
  select id from public.workforce_availability
  where organization_id = p_org and occupation_id = p_occupation and source_country = p_country
$$;

create function pg_temp.audits(p_action text, p_entity uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(l.metadata order by l.id), '[]') from audit.log l
  where l.action = p_action and l.entity_id = p_entity::text
$$;

-- The listings of the organisation a signed-in caller sees.
create function pg_temp.seen_by(p_user uuid, p_org uuid) returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.workforce_availability where organization_id = p_org;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_count;
end;
$$;

\set ow '00000000-0000-0000-0000-0000000e0001'
\set ad '00000000-0000-0000-0000-0000000e0002'
\set mb '00000000-0000-0000-0000-0000000e0003'
\set ow2 '00000000-0000-0000-0000-0000000e0004'
\set ow3 '00000000-0000-0000-0000-0000000e0005'
\set pp '00000000-0000-0000-0000-0000000e0006'
\set pr '00000000-0000-0000-0000-0000000e0007'
\set pe '00000000-0000-0000-0000-0000000e0008'
\set pf '00000000-0000-0000-0000-0000000e0009'
\set wk2 '00000000-0000-0000-0000-0000000e000a'

-- Schema ---------------------------------------------------------------------------------------------------------------
select has_table('public', 'workforce_availability', 'the table workforce_availability exists');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.workforce_availability'::regclass),
  'row level security is enabled and forced'
);
select col_is_unique('public', 'workforce_availability', array['organization_id', 'occupation_id', 'source_country'],
  'one listing per organisation, occupation and source country');
select fk_ok('public', 'workforce_availability', array['organization_id', 'occupation_id'],
  'public', 'organization_occupations', array['organization_id', 'occupation_id'],
  'the occupation is one of the partner''s occupations');
select fk_ok('public', 'workforce_availability', array['organization_id', 'source_scope', 'source_country'],
  'public', 'organization_geographies', array['organization_id', 'scope', 'country_code'],
  'the source country is one of the partner''s source countries');
select ok(
  (select count(*) = 2 from pg_constraint where conrelid = 'public.workforce_availability'::regclass and contype = 'f'
     and confdeltype = 'c' and confrelid in ('public.organization_occupations'::regclass, 'public.organization_geographies'::regclass)),
  'both profile foreign keys cascade on delete'
);
select ok(
  (select bool_and(confrelid is not null) from (values
     ('public.occupations'::regclass), ('public.countries'::regclass)) r (t)
   left join pg_constraint c on c.conrelid = 'public.workforce_availability'::regclass and c.confrelid = r.t),
  'NFR-M3: occupation and country are foreign keys to their code lists'
);
select is(
  (select attgenerated::text from pg_attribute where attrelid = 'public.workforce_availability'::regclass and attname = 'source_scope'),
  's',
  'source_scope is a generated column'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'workforce_availability'
    and indexdef like '%(occupation_id, source_country) INCLUDE (available, monthly_capacity, available_from, confirmed_at)%')
  and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'workforce_availability'
    and indexdef like '%(confirmed_at)%'),
  'the search index (occupation_id, source_country) and the index on the policy column confirmed_at exist'
);
select ok(
  not has_table_privilege('anon', 'public.workforce_availability', 'select')
  and not has_any_column_privilege('anon', 'public.workforce_availability', 'select')
  and has_column_privilege('authenticated', 'public.workforce_availability', 'confirmed_at', 'select')
  and not has_column_privilege('authenticated', 'public.workforce_availability', 'created_by', 'select')
  and not has_column_privilege('authenticated', 'public.workforce_availability', 'reminded_at', 'select')
  and not has_table_privilege('authenticated', 'public.workforce_availability', 'insert, update, delete, truncate')
  and not has_any_column_privilege('service_role', 'public.workforce_availability', 'select, insert, update'),
  'AC4: anonymous has no grant; authenticated selects every column but created_by and reminded_at; nobody writes directly'
);
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
   where oid in ('public.add_workforce_availability(uuid, text, text, integer, integer, date)'::regprocedure,
                 'public.update_workforce_availability(uuid, integer, integer, date)'::regprocedure,
                 'public.confirm_workforce_availability(uuid)'::regprocedure,
                 'public.delete_workforce_availability(uuid)'::regprocedure,
                 'public.org_usage(uuid, text[])'::regprocedure))
  and (select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
         and not has_function_privilege('service_role', f, 'execute'))
       from unnest(array['public.add_workforce_availability(uuid, text, text, integer, integer, date)',
         'public.update_workforce_availability(uuid, integer, integer, date)', 'public.confirm_workforce_availability(uuid)',
         'public.delete_workforce_availability(uuid)', 'public.org_usage(uuid, text[])']) f),
  'the functions are security definer with an empty search_path and run for authenticated only'
);
select is(
  (select format('%s|%s', schedule, command) from cron.job where jobname = 'workforce-availability-confirm'),
  '30 0 * * *|select private.mark_workforce_confirmations_due()',
  'AC5: the daily job workforce-availability-confirm runs at 00:30 UTC'
);
select is(
  (select string_agg(key || '=' || (value #>> '{}'), ',' order by key) from private.settings
   where key in ('workforce_listing_stale_days', 'workforce_confirm_reminder_days', 'workforce_available_from_max_days')),
  'workforce_available_from_max_days=730,workforce_confirm_reminder_days=30,workforce_listing_stale_days=60',
  'the periods are settings: stale after 60 days, reminder after 30, available from at most 730 days ahead'
);

-- Fixture: Manila Skills (owner ow, admin ad, member mb; occupations 7212 to 7215, source countries PH and NP), a second
-- recruitment company (ow2), a staffing company (ow3), two employers (own1 with admin adm, own2), two candidates (wkr,
-- wk2) and anonymous.
update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(id, 'recruitment_company') from unnest(array[:'ow', :'ad', :'mb', :'ow2', :'pp', :'pr', :'pe', :'pf']::uuid[]) id;
select pg_temp.new_partner(:'ow3', 'staffing_company');
select pg_temp.new_user(:'wk2', 'worker');
update public.profiles set account_kind = intended_account_kind where id = :'wk2';

select pg_temp.new_org(:'ow', 'recruitment_company') as manila \gset
select pg_temp.add_member(:'manila', :'ad', 'admin');
select pg_temp.add_member(:'manila', :'mb', 'member');
select pg_temp.profile(:'manila', 4, array['PH', 'NP']);
select pg_temp.new_org(:'ow2', 'recruitment_company') as rival \gset
select pg_temp.profile(:'rival', 1, array['IN']);
select pg_temp.new_org(:'ow3', 'staffing_company') as staffing \gset
select pg_temp.new_org(:'own1', 'employer') as emp1 \gset
select pg_temp.add_member(:'emp1', :'adm', 'admin');
select pg_temp.new_org(:'own2', 'employer') as emp2 \gset

-- Release switch -------------------------------------------------------------------------------------------------------
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(
  pg_temp.add(:'ow', :'manila', '7212', 'PH', 120, 40, current_date)
    || ',' || pg_temp.run(:'ow', format('(select case when u.applies then u.limit_value end from public.org_usage(%L, array[''workforce_listings'']) u)', :'manila')),
  'P0001|CHARA_FORBIDDEN|release_off,42501|CHARA_FORBIDDEN|release_off',
  'while release 2a is off adding a listing and reading the limit are refused'
);
update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC1, AC2: the owner adds listings; numbers, dates and profile consistency ------------------------------------------
select is(
  pg_temp.add(:'ow', :'manila', ' 7212 ', 'ph', 120, 40, '2027-03-01'),
  'ok',
  'AC1: the owner adds Welders and flame cutters from the Philippines, 120 available, 40 per month, from 1 March 2027'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s', occupation_id, source_country, source_scope, available, monthly_capacity,
     available_from, confirmed_at = now(), created_by = :'ow')
   from public.workforce_availability where id = current_setting('t.result')::uuid),
  '7212|PH|sources_from|120|40|2027-03-01|t|t',
  'AC1: one row with those values, trimmed and upper-cased, confirmed now and created by the owner'
);
select is(
  pg_temp.audits('workforce_availability.created', current_setting('t.result')::uuid),
  jsonb_build_array(jsonb_build_object('organization_id', :'manila', 'new', jsonb_build_object(
    'occupation_id', '7212', 'source_country', 'PH', 'available', 120, 'monthly_capacity', 40,
    'available_from', '2027-03-01', 'confirmed_at', now()))),
  'AC1: one audit row workforce_availability.created with the new values'
);
select ok(
  (select workforce_profile_updated_at = now() from public.organizations where id = :'manila'),
  'adding a listing stamps the profile date'
);

-- The state and message of a refusal, without the detail of the failing row.
create function pg_temp.head(p_result text) returns text
language sql as $$ select split_part(p_result, '|', 1) || '|' || split_part(p_result, '|', 2) $$;

select is(
  pg_temp.head(pg_temp.add(:'ow', :'manila', '7212', 'NP', 0, 40, current_date))
    || ',' || pg_temp.head(pg_temp.add(:'ow', :'manila', '7212', 'NP', 100001, 40, current_date))
    || ',' || pg_temp.head(pg_temp.add(:'ow', :'manila', '7212', 'NP', 10, 0, current_date))
    || ',' || pg_temp.head(pg_temp.add(:'ow', :'manila', '7212', 'NP', 10, 100001, current_date)),
  '23514|new row for relation "workforce_availability" violates check constraint "workforce_availability_available_check",'
    || '23514|new row for relation "workforce_availability" violates check constraint "workforce_availability_available_check",'
    || '23514|new row for relation "workforce_availability" violates check constraint "workforce_availability_monthly_capacity_check",'
    || '23514|new row for relation "workforce_availability" violates check constraint "workforce_availability_monthly_capacity_check"',
  'AC2: available 0 and 100,001 and monthly capacity 0 and 100,001 fail with check_violation'
);
select is(
  pg_temp.add(:'ow', :'manila', '7212', 'NP', 1, 1, current_date)
    || ',' || pg_temp.add(:'ow', :'manila', '7213', 'PH', 100000, 100000, current_date),
  'ok,ok',
  'AC2: 1 and 100,000 are accepted'
);
select is(
  pg_temp.add(:'ow', :'manila', '7213', 'NP', 10, 5, current_date - 1)
    || ',' || pg_temp.add(:'ow', :'manila', '7214', 'PH', 10, 5, current_date + 730)
    || ',' || pg_temp.add(:'ow', :'manila', '7214', 'NP', 10, 5, current_date + 731)
    || ',' || pg_temp.add(:'ow', :'manila', '7215', 'NP', 10, 5, null),
  'ok,ok,P0001|CHARA_INVALID_INPUT|available_from,ok',
  'AC2: yesterday and today + 730 days are accepted, today + 731 days raises CHARA_INVALID_INPUT available_from'
);
select is(
  (select string_agg(occupation_id || source_country || '=' || (available_from - current_date), ',' order by occupation_id, source_country)
   from public.workforce_availability where organization_id = :'manila' and occupation_id in ('7213', '7214', '7215')
     and (occupation_id, source_country) <> ('7213', 'PH')),
  '7213NP=0,7214PH=730,7215NP=0',
  'AC2: yesterday is stored as today, and so is a missing date'
);
select is(
  pg_temp.add(:'ow', :'manila', '7126', 'PH', 10, 5, current_date)
    || ',' || pg_temp.add(:'ow', :'manila', '7212', 'IN', 10, 5, current_date)
    || ',' || pg_temp.add(:'ow', :'manila', '7212', 'XX', 10, 5, current_date)
    || ',' || pg_temp.add(:'ow', :'manila', '7212', 'ph', 10, 5, current_date),
  'P0001|CHARA_INVALID_INPUT|occupation_not_in_profile,P0001|CHARA_INVALID_INPUT|source_country_not_in_profile,'
    || 'P0001|CHARA_INVALID_INPUT|source_country_not_in_profile,P0001|CHARA_CONFLICT|listing',
  'AC2: an occupation or country outside the profile is refused by name; the same occupation and country twice raises CHARA_CONFLICT'
);
select is(pg_temp.listings(:'manila'), 6, 'AC2: the refused calls stored nothing');
select throws_ok(
  format($$insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
    available_from) values (%L, '7221', 'PH', 1, 1, current_date)$$, :'manila'),
  '23503', null,
  'an occupation outside the profile is refused by the composite foreign key even past the functions'
);

-- AC4: who writes --------------------------------------------------------------------------------------------------------
select pg_temp.listing(:'manila', '7212', 'PH') as l_ph \gset
update public.workforce_availability set confirmed_at = now() - interval '61 days', reminded_at = now() - interval '1 day'
where id = :'l_ph';
select is(
  pg_temp.run(:'ad', format('public.update_workforce_availability(%L, 130, 45, %L)', :'l_ph', current_date - 3)),
  'ok',
  'AC4: the admin updates the stale listing'
);
select is(
  (select format('%s|%s|%s|%s|%s', available, monthly_capacity, available_from = current_date, confirmed_at = now(), reminded_at is null)
   from public.workforce_availability where id = :'l_ph'),
  '130|45|t|t|t',
  'AC4: the new numbers are stored, a past date as today; the update confirms the listing and clears the reminder'
);
select is(
  pg_temp.audits('workforce_availability.updated', :'l_ph') -> 0,
  jsonb_build_object('organization_id', :'manila',
    'old', jsonb_build_object('occupation_id', '7212', 'source_country', 'PH', 'available', 120, 'monthly_capacity', 40,
      'available_from', '2027-03-01', 'confirmed_at', now() - interval '61 days'),
    'new', jsonb_build_object('occupation_id', '7212', 'source_country', 'PH', 'available', 130, 'monthly_capacity', 45,
      'available_from', current_date, 'confirmed_at', now())),
  'AC4: the audit row workforce_availability.updated keeps the old and the new values'
);
select is(
  pg_temp.run(:'ad', format('public.update_workforce_availability(%L, 130, 45, %L)', :'l_ph', current_date + 731))
    || ',' || pg_temp.head(pg_temp.run(:'ad', format('public.update_workforce_availability(%L, 0, 45, null)', :'l_ph'))),
  'P0001|CHARA_INVALID_INPUT|available_from,23514|new row for relation "workforce_availability" violates check constraint "workforce_availability_available_check"',
  'AC2: an update checks the date and the numbers as an add does'
);
update public.workforce_availability set confirmed_at = now() - interval '10 days' where id = :'l_ph';
select is(
  pg_temp.run(:'ow', format('public.confirm_workforce_availability(%L)', :'l_ph'))
    || ',' || (current_setting('t.result')::timestamptz = now())::text,
  'ok,true',
  'AC4: the owner confirms the listing and gets the new confirmation time'
);
select is(
  pg_temp.audits('workforce_availability.confirmed', :'l_ph'),
  jsonb_build_array(jsonb_build_object('organization_id', :'manila',
    'old', jsonb_build_object('confirmed_at', now() - interval '10 days'), 'new', jsonb_build_object('confirmed_at', now()))),
  'AC4: one audit row workforce_availability.confirmed with the old and the new time'
);
select is(
  (select string_agg(r, ',') from (
    select pg_temp.add(u, :'manila', '7215', 'PH', 10, 5, current_date) as r from unnest(array[:'mb', :'ow2', :'adm', :'wkr']::uuid[]) u
    union all
    select pg_temp.run(u, format('public.update_workforce_availability(%L, 1, 1, null)', :'l_ph')) from unnest(array[:'mb', :'ow2', :'adm', :'wkr']::uuid[]) u
    union all
    select pg_temp.run(u, format('public.confirm_workforce_availability(%L)', :'l_ph')) from unnest(array[:'mb', :'ow2', :'adm', :'wkr']::uuid[]) u
    union all
    select pg_temp.run(u, format('public.delete_workforce_availability(%L)', :'l_ph')) from unnest(array[:'mb', :'ow2', :'adm', :'wkr']::uuid[]) u
  ) x),
  array_to_string(array_fill('P0001|CHARA_FORBIDDEN|'::text, array[16]), ','),
  'AC4: the member, another partner, an employer admin and a candidate get CHARA_FORBIDDEN for add, update, confirm and delete'
);
select is(
  pg_temp.add(null, :'manila', '7215', 'PH', 10, 5, current_date)
    || ',' || pg_temp.run(null, format('public.update_workforce_availability(%L, 1, 1, null)', :'l_ph'))
    || ',' || pg_temp.run(null, format('public.confirm_workforce_availability(%L)', :'l_ph'))
    || ',' || pg_temp.run(null, format('public.delete_workforce_availability(%L)', :'l_ph')),
  '42501|permission denied for function add_workforce_availability|,42501|permission denied for function update_workforce_availability|,'
    || '42501|permission denied for function confirm_workforce_availability|,42501|permission denied for function delete_workforce_availability|',
  'AC4: the anonymous caller is refused at the EXECUTE grant'
);
select is(
  pg_temp.add(:'ow', :'manila', '7215', 'PH', 10, 5, current_date, 'aal1')
    || ',' || pg_temp.run(:'ow', format('public.confirm_workforce_availability(%L)', :'l_ph'), 'aal1')
    || ',' || pg_temp.run(:'ow', format('public.confirm_workforce_availability(%L)', gen_random_uuid())),
  'P0001|CHARA_FORBIDDEN|aal2_required,P0001|CHARA_FORBIDDEN|aal2_required,P0002|CHARA_NOT_FOUND|',
  'the owner writes at aal2 only, as on every organisation page; an unknown listing raises CHARA_NOT_FOUND'
);
select is(
  pg_temp.add(:'own1', :'emp1', '7212', 'PH', 10, 5, current_date),
  'P0001|CHARA_FORBIDDEN|partner_only',
  'an employer cannot list availability for its own organisation'
);
update public.organizations set status = 'suspended' where id = :'manila';
select is(
  pg_temp.run(:'ow', format('public.confirm_workforce_availability(%L)', :'l_ph')),
  'P0001|CHARA_FORBIDDEN|organization_suspended',
  'a suspended partner cannot change its listings'
);
update public.organizations set status = 'active' where id = :'manila';
select is(
  pg_temp.call_as(:'ow', 'authenticated', format($$update public.workforce_availability set available = 1 where id = %L$$, :'l_ph'))
    || ',' || pg_temp.call_as(:'ow', 'authenticated', format($$delete from public.workforce_availability where id = %L$$, :'l_ph'))
    || ',' || pg_temp.call_as(:'ow', 'authenticated', format($$insert into public.workforce_availability (organization_id,
      occupation_id, source_country, available, monthly_capacity, available_from) values (%L, '7215', 'PH', 1, 1, current_date)$$, :'manila')),
  '42501|permission denied for table workforce_availability|,42501|permission denied for table workforce_availability|,'
    || '42501|permission denied for table workforce_availability|',
  'AC4: direct UPDATE, DELETE and INSERT are refused'
);
select pg_temp.listing(:'manila', '7214', 'PH') as l_del \gset
select is(
  pg_temp.run(:'ad', format('public.delete_workforce_availability(%L)', :'l_del')) || ',' || pg_temp.listings(:'manila'),
  'ok,5',
  'AC4: the admin deletes a listing'
);
select is(
  (select format('%s|%s', jsonb_array_length(pg_temp.audits('workforce_availability.deleted', :'l_del')),
     pg_temp.audits('workforce_availability.deleted', :'l_del') #> '{0,old,available_from}')
   || '|' || jsonb_array_length(pg_temp.audits('workforce_availability.removed_with_profile', :'l_del'))),
  '1|"' || (current_date + 730)::text || '"|0',
  'AC4: one audit row workforce_availability.deleted with the old values, and none from the removal trigger'
);

-- AC4, NFR-S8: who reads -----------------------------------------------------------------------------------------------
update public.organizations set review_status = 'listed', listed_at = now() where id = :'manila';
update public.workforce_availability set confirmed_at = now() - interval '61 days'
where id = pg_temp.listing(:'manila', '7213', 'NP');
select is(pg_temp.add(:'ow2', :'rival', '7212', 'IN', 10, 5, current_date), 'ok', 'the second partner lists availability');
select is(
  format('%s,%s,%s,%s,%s,%s,%s,%s,%s',
    pg_temp.seen_by(:'ow', :'manila'), pg_temp.seen_by(:'mb', :'manila'), pg_temp.seen_by(:'ow2', :'manila'),
    pg_temp.seen_by(:'ow3', :'manila'), pg_temp.seen_by(:'own1', :'manila'), pg_temp.seen_by(:'adm', :'manila'),
    pg_temp.seen_by(:'own2', :'manila'), pg_temp.seen_by(:'wkr', :'manila'), pg_temp.seen_by(:'wk2', :'manila')),
  '5,5,4,4,4,4,4,4,4',
  'AC4, NFR-S8: members read all five listings of the listed partner; other partners, employers and candidates the four fresh ones'
);
select is(
  pg_temp.call_as(null, 'anon', format('select count(*) from public.workforce_availability where organization_id = %L', :'manila')),
  '42501|permission denied for table workforce_availability|',
  'AC4: anonymous callers read none'
);
select is(
  format('%s,%s,%s,%s,%s,%s,%s',
    pg_temp.seen_by(:'ow2', :'rival'), pg_temp.seen_by(:'ow', :'rival'), pg_temp.seen_by(:'ow3', :'rival'),
    pg_temp.seen_by(:'own1', :'rival'), pg_temp.seen_by(:'own2', :'rival'), pg_temp.seen_by(:'wkr', :'rival'),
    pg_temp.seen_by(:'wk2', :'rival')),
  '1,0,0,0,0,0,0',
  'NFR-S8: only members read the listings of a partner that is not listed'
);
update public.organizations set status = 'suspended' where id = :'manila';
select is(format('%s,%s', pg_temp.seen_by(:'mb', :'manila'), pg_temp.seen_by(:'own1', :'manila')), '5,0',
  'NFR-S8: the listings of a suspended partner are read by its members only');
update public.organizations set status = 'active', review_status = 'declined' where id = :'manila';
select is(format('%s,%s', pg_temp.seen_by(:'mb', :'manila'), pg_temp.seen_by(:'own1', :'manila')), '5,0',
  'NFR-S8: and so are those of a declined partner');
update public.organizations set review_status = 'listed' where id = :'manila';

-- AC6: listings not confirmed for 60 days are hidden until confirmed ----------------------------------------------------
update public.workforce_availability w set confirmed_at = now() - make_interval(days => d.days)
from (values ('7212', 'PH', 59), ('7212', 'NP', 60), ('7213', 'PH', 61), ('7213', 'NP', 75), ('7215', 'NP', 90)) d (occ, country, days)
where w.organization_id = :'manila' and w.occupation_id = d.occ and w.source_country = d.country;
select is(
  pg_temp.seen_by(:'own1', :'manila') || ',' || pg_temp.seen_by(:'ow', :'manila'),
  '1,5',
  'AC6: an employer reads the 59-day listing only; the owner still reads all of them'
);
select pg_temp.listing(:'manila', '7213', 'PH') as l_61 \gset
select is(
  pg_temp.run(:'ow', format('public.confirm_workforce_availability(%L)', :'l_61')) || ',' || pg_temp.seen_by(:'own1', :'manila'),
  'ok,2',
  'AC6: once the owner confirms the 61-day listing the employer reads it again'
);
select is(
  (select confirmed_at = now() from public.workforce_availability where id = :'l_61')::text
    || ',' || jsonb_array_length(pg_temp.audits('workforce_availability.confirmed', :'l_61')),
  'true,1',
  'AC6: confirmed_at is now and one audit row workforce_availability.confirmed exists'
);
update private.settings set value = '90' where key = 'workforce_listing_stale_days';
select is(pg_temp.seen_by(:'own1', :'manila'), 4,
  'AC6: with the setting at 90 the 60- and 75-day listings are shown again without a migration; the 90-day one stays hidden');
update private.settings set value = '60' where key = 'workforce_listing_stale_days';

-- AC5: confirmation reminders -------------------------------------------------------------------------------------------
update public.workforce_availability set reminded_at = null where organization_id = :'manila';
update public.workforce_availability w set confirmed_at = now() - make_interval(days => d.days),
  reminded_at = now() - make_interval(days => d.reminded)
from (values ('7212', 'PH', 29, null), ('7212', 'NP', 30, null), ('7213', 'PH', 45, null), ('7213', 'NP', 45, 10),
  ('7215', 'NP', 70, 31)) d (occ, country, days, reminded)
where w.organization_id = :'manila' and w.occupation_id = d.occ and w.source_country = d.country;
update public.workforce_availability set confirmed_at = now() - interval '45 days' where organization_id = :'rival';
update public.organizations set status = 'suspended' where id = :'rival';
select is(private.mark_workforce_confirmations_due(), 3,
  'AC5: the first run finds the 30- and 45-day listings and the one reminded 31 days ago');
select is(
  (select string_agg(occupation_id || source_country, ',' order by occupation_id, source_country)
   from public.workforce_availability where reminded_at = now()),
  '7212NP,7213PH,7215NP',
  'AC5: the 29-day listing, the one reminded 10 days ago and the listing of a suspended partner are not included'
);
select is(private.mark_workforce_confirmations_due(), 0, 'AC5: the second run on the same day finds nothing');
update public.organizations set status = 'active' where id = :'rival';
select pg_temp.run(:'ow', format('public.confirm_workforce_availability(%L)', pg_temp.listing(:'manila', '7212', 'NP'))) as confirmed \gset
select is(
  (select format('%s|%s', reminded_at is null, confirmed_at = now()) from public.workforce_availability
   where id = pg_temp.listing(:'manila', '7212', 'NP')),
  't|t',
  'AC5: confirming a listing clears its reminder stamp'
);
update private.settings set value = 'false' where key = 'release_partner_directories';
update public.workforce_availability set reminded_at = null;
select is(private.mark_workforce_confirmations_due(), 0, 'while release 2a is off the job finds nothing');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- A listing goes with its occupation or source country, audited -------------------------------------------------------
select pg_temp.listing(:'manila', '7213', 'PH') as l_occ1 \gset
select pg_temp.listing(:'manila', '7212', 'NP') as l_np \gset
select is(
  pg_temp.call_as(:'ow', 'authenticated', format(
    $$select public.set_organization_workforce_offer(%L, array['7212', '7214', '7215'], '{}', '{}', 'both', '{}')$$, :'manila'), 'aal1'),
  'ok',
  'the owner removes the occupation 7213 from the profile'
);
select is(
  (select string_agg(occupation_id || source_country, ',' order by occupation_id, source_country)
   from public.workforce_availability where organization_id = :'manila'),
  '7212NP,7212PH,7215NP',
  'both listings of 7213 are deleted with it'
);
select is(
  pg_temp.audits('workforce_availability.removed_with_profile', :'l_occ1') #- '{0,old,confirmed_at}',
  jsonb_build_array(jsonb_build_object('organization_id', :'manila', 'reason', 'occupation_removed',
    'old', jsonb_build_object('occupation_id', '7213', 'source_country', 'PH', 'available', 100000, 'monthly_capacity', 100000,
      'available_from', current_date))),
  'the removal is audited as workforce_availability.removed_with_profile with the reason and the old values'
);
select is(
  pg_temp.call_as(:'ow', 'authenticated', format($$select public.set_organization_geographies(%L, array['PH'], '{}')$$, :'manila'), 'aal1')
    || ',' || (pg_temp.listing(:'manila', '7212', 'NP') is null)::text
    || ',' || (pg_temp.audits('workforce_availability.removed_with_profile', :'l_np') #>> '{0,reason}'),
  'ok,true,source_country_removed',
  'removing the source country NP deletes its listings, audited with the reason source_country_removed'
);

-- AC3: the listing limit follows the plan ------------------------------------------------------------------------------
update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.new_org(:'pp', 'recruitment_company') as org_partner \gset
select pg_temp.new_org(:'pr', 'recruitment_company') as org_pro \gset
select pg_temp.new_org(:'pe', 'recruitment_company') as org_ent \gset
select pg_temp.new_org(:'pf', 'recruitment_company') as org_free \gset
select pg_temp.profile(:'org_partner', 6, array['PH', 'NP']);
select pg_temp.profile(:'org_pro', 26, array['PH', 'NP']);
select pg_temp.profile(:'org_ent', 40, array['PH', 'NP']);
select pg_temp.profile(:'org_free', 1, array['PH']);
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (:'org_partner', 'recruitment_partner', 'active', 'null'),
  (:'org_pro', 'recruitment_professional', 'active', 'null'),
  (:'org_ent', 'recruitment_enterprise', 'active', 'null');

select is(
  pg_temp.fill(:'pp', :'org_partner', 1, 10) || ',' || pg_temp.fill(:'pp', :'org_partner', 11, 11) || ',' || pg_temp.listings(:'org_partner'),
  'ok,P0001|CHARA_LIMIT_REACHED|workforce_listings,10',
  'AC3: the Partner plan stores 10 listings and refuses the eleventh with CHARA_LIMIT_REACHED workforce_listings'
);
select is(
  pg_temp.fill(:'pr', :'org_pro', 1, 50) || ',' || pg_temp.fill(:'pr', :'org_pro', 51, 51) || ',' || pg_temp.listings(:'org_pro'),
  'ok,P0001|CHARA_LIMIT_REACHED|workforce_listings,50',
  'AC3: the Professional plan stores 50 and refuses the 51st'
);
select is(
  pg_temp.fill(:'pe', :'org_ent', 1, 80) || ',' || pg_temp.listings(:'org_ent'),
  'ok,80',
  'AC3: the Enterprise plan stores 80'
);
select is(
  pg_temp.fill(:'pf', :'org_free', 1, 1),
  'P0001|CHARA_LIMIT_REACHED|workforce_listings',
  'AC3: the free fallback plan includes no listing'
);
select is(
  format('%s,%s,%s,%s',
    pg_temp.val_as(:'pp', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''workforce_listings'']) u)', :'org_partner')),
    pg_temp.val_as(:'pr', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''workforce_listings'']) u)', :'org_pro')),
    coalesce(pg_temp.val_as(:'pe', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''workforce_listings'']) u)', :'org_ent')), 'null'),
    pg_temp.val_as(:'pf', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''workforce_listings'']) u)', :'org_free'))),
  '10,50,null,0',
  'the section reads the limit that applies: 10, 50, unlimited and 0'
);
select is(
  pg_temp.run(:'ow2', format('(select case when u.applies then u.limit_value end from public.org_usage(%L, array[''workforce_listings'']) u)', :'org_partner'), 'aal1'),
  '42501|CHARA_FORBIDDEN|',
  'the limit is read by members only'
);
update billing.subscriptions set plan_code = 'recruitment_partner' where organization_id = :'org_pro';
select is(
  pg_temp.run(:'pr', format('public.confirm_workforce_availability(%L)',
      (select id from public.workforce_availability where organization_id = :'org_pro' order by occupation_id, source_country limit 1)))
    || ',' || pg_temp.run(:'pr', format('public.update_workforce_availability(%L, 7, 7, null)',
      (select id from public.workforce_availability where organization_id = :'org_pro' order by occupation_id, source_country limit 1)))
    || ',' || pg_temp.fill(:'pr', :'org_pro', 51, 51),
  'ok,ok,P0001|CHARA_LIMIT_REACHED|workforce_listings',
  'AC3 open point: after a downgrade the listings stay and can be confirmed and updated, but none is added'
);
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(
  coalesce(pg_temp.val_as(:'pp', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''workforce_listings'']) u)', :'org_partner')), 'null')
    || ',' || pg_temp.fill(:'pp', :'org_partner', 11, 11),
  'null,ok',
  'while entitlements are not enforced no limit is shown or applied'
);
update private.settings set value = 'true' where key = 'entitlements_enforced';

-- NFR-A4: adds of one organisation are serialised at the limit ---------------------------------------------------------
-- A second session holds the lock of a partner on the Partner plan with 9 of its 10 listings, as an add in progress
-- would (the lock lasts until the end of the transaction that took it). Without the lock two adds could each count 9 and
-- together store 11; with it the second add waits, then counts what the first committed. Another organisation is not
-- held up.
select pg_temp.new_org(:'pp', 'recruitment_company') as org_lock \gset
select pg_temp.profile(:'org_lock', 6, array['PH', 'NP']);
insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'org_lock', 'recruitment_partner', 'active', 'null');
-- Written past the functions: an add in this transaction would hold the lock itself until the end of the test.
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity, available_from)
select o.organization_id, o.occupation_id, g.country_code, 10, 5, current_date
from public.organization_occupations o
join public.organization_geographies g on g.organization_id = o.organization_id and g.scope = 'sources_from'
where o.organization_id = :'org_lock'
order by o.occupation_id, g.country_code
limit 9;
select is(pg_temp.listings(:'org_lock'), 9, 'the partner holds 9 of its 10 listings');
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select is(
  (select l from extensions.dblink('holder',
    format('select pg_advisory_lock(hashtextextended(%L, 0))::text', 'workforce_availability:' || :'org_lock'))
    as t (l text)),
  '',
  'a second session holds the listing lock of the partner'
);
set local lock_timeout = '300ms';
select is(
  split_part(pg_temp.fill(:'pp', :'org_lock', 10, 10), '|', 1),
  '55P03',
  'NFR-A4: the tenth listing waits for the add in progress'
);
insert into public.organization_geographies (organization_id, scope, country_code) values (:'org_ent', 'sources_from', 'IN');
select is(
  pg_temp.add(:'pe', :'org_ent', '7212', 'IN', 10, 5, current_date),
  'ok',
  'NFR-A4: an add of another organisation does not wait'
);
select l from extensions.dblink('holder',
  format('select pg_advisory_unlock(hashtextextended(%L, 0))::text', 'workforce_availability:' || :'org_lock')) as t (l text);
select extensions.dblink_disconnect('holder');
reset lock_timeout;
select is(
  pg_temp.fill(:'pp', :'org_lock', 10, 10) || ',' || pg_temp.fill(:'pp', :'org_lock', 11, 11) || ',' || pg_temp.listings(:'org_lock'),
  'ok,P0001|CHARA_LIMIT_REACHED|workforce_listings,10',
  'NFR-A4: once the other add is over the tenth goes through and the eleventh is refused'
);

select * from finish();
rollback;
