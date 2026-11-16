begin;
select plan(66);

\ir organizations_fixture.inc

-- What you offer (V07, FR-K2 AC1, AC3, AC4, AC5, AC8; NFR-S8, NFR-A4, NFR-M3): the tables organization_occupations,
-- organization_industries, organization_languages and organization_service_types, their read policies,
-- set_organization_workforce_offer with the listed_occupations limit, read through org_usage.

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

-- Calls set_organization_workforce_offer as the user; the recruitment type and service types are passed as text and cast
-- in the call, as PostgREST does, so an unknown enum value fails there.
create function pg_temp.set_offer(
  p_user uuid, p_org uuid, p_occupations text[], p_industries text[], p_languages text[],
  p_recruitment text default 'international', p_services text default '{}', p_band text default null,
  p_year integer default null
) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', public.set_organization_workforce_offer(%L, %L, %L, %L, %L::public.recruitment_preference, '
      || '%L::public.partner_service_type[], %L::public.workforce_size_band, %L::smallint)::text, true)',
      p_org, p_occupations, p_industries, p_languages, p_recruitment, p_services, p_band, p_year), 'aal1')
$$;

-- The stored offer of an organisation, read past row level security: 'occupations|industries|languages|services|type'.
create function pg_temp.offer(p_org uuid) returns text
language sql as $$
  select concat_ws('|',
    (select coalesce(string_agg(occupation_id, ',' order by occupation_id), '') from public.organization_occupations where organization_id = p_org),
    (select coalesce(string_agg(industry_code, ',' order by industry_code), '') from public.organization_industries where organization_id = p_org),
    (select coalesce(string_agg(language_code, ',' order by language_code), '') from public.organization_languages where organization_id = p_org),
    (select coalesce(string_agg(service::text, ',' order by service), '') from public.organization_service_types where organization_id = p_org),
    (select coalesce(recruitment_type::text, '') from public.organizations where id = p_org))
$$;

create function pg_temp.audits(p_org uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(l.metadata order by l.id), '[]') from audit.log l
  where l.entity_id = p_org::text and l.action = 'organization.workforce_profile_changed'
$$;

-- The rows of the organisation a caller sees in each table, 'occupations/industries/languages/services' (null caller:
-- anonymous).
create function pg_temp.seen_by(p_user uuid, p_org uuid) returns text
language plpgsql as $$
declare
  v_seen text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text end,
    true);
  if p_user is null then set local role anon; else set local role authenticated; end if;
  select format('%s/%s/%s/%s',
    (select count(*) from public.organization_occupations where organization_id = p_org),
    (select count(*) from public.organization_industries where organization_id = p_org),
    (select count(*) from public.organization_languages where organization_id = p_org),
    (select count(*) from public.organization_service_types where organization_id = p_org))
  into v_seen;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_seen;
end;
$$;

-- Read in a function of its own, so a query that also calls set_offer sees what the call wrote.
create function pg_temp.occupation_count(p_org uuid) returns bigint
language sql as $$ select count(*) from public.organization_occupations where organization_id = p_org $$;

create function pg_temp.extras(p_org uuid) returns text
language sql as $$
  select coalesce(workforce_size_band::text, 'null') || '/' || coalesce(founded_year::text, 'null')
  from public.organizations where id = p_org
$$;

create function pg_temp.occupations(p_n integer) returns text[]
language sql as $$ select array(select code from public.occupations order by code limit p_n) $$;

\set ow '00000000-0000-0000-0000-0000000e0001'
\set ad '00000000-0000-0000-0000-0000000e0002'
\set mb '00000000-0000-0000-0000-0000000e0003'
\set ow2 '00000000-0000-0000-0000-0000000e0004'
\set ow3 '00000000-0000-0000-0000-0000000e0005'
\set ow4 '00000000-0000-0000-0000-0000000e0006'
\set pp '00000000-0000-0000-0000-0000000e0007'
\set pr '00000000-0000-0000-0000-0000000e0008'
\set pe '00000000-0000-0000-0000-0000000e0009'
\set pd '00000000-0000-0000-0000-0000000e000a'
\set ps '00000000-0000-0000-0000-0000000e000b'
\set wk2 '00000000-0000-0000-0000-0000000e000c'

-- Schema ---------------------------------------------------------------------------------------------------------------
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) = true and count(*) = 4 from pg_class
   where oid in ('public.organization_occupations'::regclass, 'public.organization_industries'::regclass,
                 'public.organization_languages'::regclass, 'public.organization_service_types'::regclass)),
  'the four tables exist with row level security enabled and forced'
);
select col_is_pk('public', 'organization_occupations', array['organization_id', 'occupation_id'], 'one row per organisation and occupation');
select col_is_pk('public', 'organization_industries', array['organization_id', 'industry_code'], 'one row per organisation and industry');
select col_is_pk('public', 'organization_languages', array['organization_id', 'language_code'], 'one row per organisation and language');
select col_is_pk('public', 'organization_service_types', array['organization_id', 'service'], 'one row per organisation and service');
select fk_ok('public', 'organization_occupations', 'occupation_id', 'public', 'occupations', 'code',
  'NFR-M3: every occupation is a row of the ISCO-08 code list');
select fk_ok('public', 'organization_industries', 'industry_code', 'public', 'industries', 'code',
  'NFR-M3: every industry is a row of the ISIC section code list');
select fk_ok('public', 'organization_languages', 'language_code', 'public', 'languages', 'code',
  'NFR-M3: every language is a row of the ISO 639-1 code list');
select col_type_is('public', 'organization_service_types', 'service', 'partner_service_type',
  'NFR-M3: the service is the enum partner_service_type');
select ok(
  (select count(*) = 4 from pg_constraint
   where contype = 'f' and confrelid = 'public.organizations'::regclass and confdeltype = 'c'
     and conrelid in ('public.organization_occupations'::regclass, 'public.organization_industries'::regclass,
                      'public.organization_languages'::regclass, 'public.organization_service_types'::regclass)),
  'every row belongs to an organisation and goes with it'
);
select ok(
  (select count(*) = 4 from pg_indexes where schemaname = 'public' and indexdef like any (array[
    '%organization_occupations USING btree (occupation_id, organization_id)%',
    '%organization_industries USING btree (industry_code, organization_id)%',
    '%organization_languages USING btree (language_code, organization_id)%',
    '%organization_service_types USING btree (service, organization_id)%'])),
  'the directory indexes by occupation, industry, language and service exist'
);
select ok(
  (select bool_and(
     has_table_privilege('anon', t, 'select') and has_table_privilege('authenticated', t, 'select')
     and not has_table_privilege('service_role', t, 'select')
     and not has_table_privilege('anon', t, 'insert, update, delete, truncate')
     and not has_table_privilege('authenticated', t, 'insert, update, delete, truncate')
     and not has_table_privilege('service_role', t, 'insert, update, delete, truncate'))
   from unnest(array['public.organization_occupations', 'public.organization_industries',
     'public.organization_languages', 'public.organization_service_types']) t),
  'AC3, AC8: the API roles may only select the four tables; nobody writes them directly'
);
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
   where oid in ('public.set_organization_workforce_offer(uuid, text[], text[], text[], public.recruitment_preference, public.partner_service_type[], public.workforce_size_band, smallint)'::regprocedure,
                 'public.org_usage(uuid, text[])'::regprocedure))
  and has_function_privilege('authenticated', 'public.set_organization_workforce_offer(uuid, text[], text[], text[], public.recruitment_preference, public.partner_service_type[], public.workforce_size_band, smallint)', 'execute')
  and not has_function_privilege('anon', 'public.set_organization_workforce_offer(uuid, text[], text[], text[], public.recruitment_preference, public.partner_service_type[], public.workforce_size_band, smallint)', 'execute')
  and not has_function_privilege('service_role', 'public.set_organization_workforce_offer(uuid, text[], text[], text[], public.recruitment_preference, public.partner_service_type[], public.workforce_size_band, smallint)', 'execute')
  and has_function_privilege('authenticated', 'public.org_usage(uuid, text[])', 'execute')
  and not has_function_privilege('anon', 'public.org_usage(uuid, text[])', 'execute'),
  'both functions are security definer with an empty search_path and run for authenticated only'
);

-- Fixture: Manila Skills (owner ow, admin ad, member mb), a second recruitment company (ow2), two staffing companies
-- (ow3, ow4), two employers (own1 with admin adm, own2), two candidates (wkr, wk2) and anonymous.
update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(id, 'recruitment_company') from unnest(array[
  :'ow', :'ad', :'mb', :'ow2', :'pp', :'pr', :'pe', :'pd', :'ps']::uuid[]) id;
select pg_temp.new_partner(id, 'staffing_company') from unnest(array[:'ow3', :'ow4']::uuid[]) id;
select pg_temp.new_user(:'wk2', 'worker');
update public.profiles set account_kind = intended_account_kind where id = :'wk2';

select pg_temp.new_org(:'ow', 'recruitment_company') as manila \gset
select pg_temp.add_member(:'manila', :'ad', 'admin');
select pg_temp.add_member(:'manila', :'mb', 'member');
select pg_temp.new_org(:'ow2', 'recruitment_company') as rival \gset
select pg_temp.new_org(:'ow3', 'staffing_company') as staffing \gset
select pg_temp.new_org(:'ow4', 'staffing_company') as staffing2 \gset
select pg_temp.new_org(:'own1', 'employer') as emp1 \gset
select pg_temp.add_member(:'emp1', :'adm', 'admin');
select pg_temp.new_org(:'own2', 'employer') as emp2 \gset

-- Release switch -------------------------------------------------------------------------------------------------------
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(
  pg_temp.set_offer(:'ow', :'manila', array['7212'], array['C'], array['en'])
    || ',' || pg_temp.call_as(:'ow', 'authenticated', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''listed_occupations'']) u)', :'manila'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|release_off,42501|CHARA_FORBIDDEN|release_off',
  'while release 2a is off both functions refuse'
);
update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC3: reference values are enforced -----------------------------------------------------------------------------------
select is(
  pg_temp.set_offer(:'ow', :'manila', array['7212', '0000'], array['C'], array['en'])
    || ',' || pg_temp.set_offer(:'ow', :'manila', array['7212'], array['C', '25'], array['en'])
    || ',' || pg_temp.set_offer(:'ow', :'manila', array['7212'], array['C'], array['en', 'xx'])
    || ',' || pg_temp.set_offer(:'ow', :'manila', array['7212'], array['C'], array['en'], 'global'),
  'P0001|CHARA_INVALID_INPUT|occupation_id,P0001|CHARA_INVALID_INPUT|industry_code,'
    || 'P0001|CHARA_INVALID_INPUT|language_code,22P02|invalid input value for enum recruitment_preference: "global"|',
  'AC3: an unknown occupation, a division instead of a section and an unknown language name their field; "global" is no recruitment type'
);
select is(pg_temp.offer(:'manila'), '||||', 'AC3: the refused calls wrote nothing');
select is(
  pg_temp.set_offer(:'ow', :'manila', array['7212', null], array['C'], array['en'])
    || ',' || pg_temp.set_offer(:'ow', :'manila', array['7212'], array[''], array['en'])
    || ',' || pg_temp.set_offer(:'ow', :'manila', array['7212'], array['C'], array['en'], null)
    || ',' || pg_temp.set_offer(:'ow', :'manila', array['7212'], array['C'], array['en'], 'local', '{staffing,NULL}'),
  'P0001|CHARA_INVALID_INPUT|occupation_id,P0001|CHARA_INVALID_INPUT|industry_code,'
    || 'P0001|CHARA_INVALID_INPUT|recruitment_type,P0001|CHARA_INVALID_INPUT|service_types',
  'AC3: a null or empty code, a missing recruitment type and a null service type are refused'
);
select is(
  pg_temp.set_offer(:'ow', :'manila', array_fill('7212'::text, array[437]), null, null)
    || ',' || pg_temp.set_offer(:'ow', :'manila', null, array_fill('C'::text, array[22]), null)
    || ',' || pg_temp.set_offer(:'ow', :'manila', null, null, array_fill('en'::text, array[185]))
    || ',' || pg_temp.set_offer(:'ow', :'manila', null, null, null, 'local', '{staffing,temporary,contract,project,permanent,staffing}'),
  'P0001|CHARA_INVALID_INPUT|occupation_id,P0001|CHARA_INVALID_INPUT|industry_code,'
    || 'P0001|CHARA_INVALID_INPUT|language_code,P0001|CHARA_INVALID_INPUT|service_types',
  'a list longer than its code list is refused before any lookup'
);
select is(
  pg_temp.set_offer(:'ow', :'manila', null, null, null, 'local', '{}', null, 1799)
    || ',' || pg_temp.set_offer(:'ow', :'manila', null, null, null, 'local', '{}', null, extract(year from now())::integer + 1)
    || ',' || pg_temp.set_offer(:'ow', :'manila', null, null, null, 'local', '{}', 'huge'),
  'P0001|CHARA_INVALID_INPUT|founded_year,P0001|CHARA_INVALID_INPUT|founded_year,'
    || '22P02|invalid input value for enum workforce_size_band: "huge"|',
  'a founded year before 1800 or in the future, and an unknown size band, are refused'
);

-- AC1: the owner at aal1 records the offer; one audit row lists the changed sets.
select is(
  pg_temp.set_offer(:'ow', :'manila', array['7212', ' 7126 ', '7212'], array['c', 'F'], array['EN', 'tl', 'ar'],
    'international', '{}', '50_249', 2019),
  'ok',
  'AC1, AC8: the owner at aal1 saves the offer'
);
select is(pg_temp.offer(:'manila'), '7126,7212|C,F|ar,en,tl||international',
  'AC1, AC3: two occupations (the repeated one stored once), industries C and F, languages en, tl and ar, recruitment type international');
select is(current_setting('t.result')::jsonb,
  '{"occupations": ["7126", "7212"], "industries": ["C", "F"], "languages": ["ar", "en", "tl"], "recruitment_type": "international",
    "service_types": [], "workforce_size_band": "50_249", "founded_year": 2019, "changed": true}'::jsonb,
  'the result is the stored offer');
select is(pg_temp.audits(:'manila'),
  '[{"occupations": {"added": ["7126", "7212"], "removed": []}, "industries": {"added": ["C", "F"], "removed": []},
     "languages": {"added": ["ar", "en", "tl"], "removed": []}, "recruitment_type": {"old": null, "new": "international"},
     "workforce_size_band": {"old": null, "new": "50_249"}, "founded_year": {"old": null, "new": 2019}}]'::jsonb,
  'AC1: one audit row organization.workforce_profile_changed lists the changed sets and values');
select is(
  (select format('%s|%s|%s', workforce_size_band, founded_year, (workforce_profile_updated_at > now() - interval '1 minute')::text)
   from public.organizations where id = :'manila'),
  '50_249|2019|true',
  'AC1: the size band and founded year are stored and workforce_profile_updated_at is now'
);

update public.organizations set workforce_profile_updated_at = '2026-03-03 10:00+00' where id = :'manila';
select is(
  pg_temp.set_offer(:'ow', :'manila', array['7126', '7212'], array['F', 'C'], array['tl', 'ar', 'en'],
    'international', '{}', '50_249', 2019),
  'ok',
  'saving the same offer in another order succeeds'
);
select is(
  (select format('%s|%s|%s', jsonb_array_length(pg_temp.audits(:'manila')), workforce_profile_updated_at,
     current_setting('t.result')::jsonb -> 'changed')
   from public.organizations where id = :'manila'),
  '1|2026-03-03 10:00:00+00|false',
  'a save that changes nothing writes no audit row and keeps the date of the last change'
);
select is(
  pg_temp.set_offer(:'ow', :'manila', array['7212'], array['C', 'F'], array['ar', 'en', 'tl'], 'both', '{}', '50_249', 2019),
  'ok',
  'removing an occupation and changing the recruitment type succeeds'
);
select is(pg_temp.audits(:'manila') -> 1,
  '{"occupations": {"added": [], "removed": ["7126"]}, "recruitment_type": {"old": "international", "new": "both"}}'::jsonb,
  'AC1: the audit row of a change lists only what changed');
select ok(
  (select workforce_profile_updated_at > '2026-03-03 10:00+00' from public.organizations where id = :'manila'),
  'a change stamps workforce_profile_updated_at again'
);
select throws_ok(
  format($$insert into public.organization_occupations (organization_id, occupation_id) values (%L, '7212')$$, :'manila'),
  '23505', null,
  'AC3: a direct duplicate of (organisation, occupation) fails with unique_violation'
);
select is(
  (select string_agg(r, ',') from (
    select pg_temp.call_as(null, 'postgres', format($$insert into public.organization_occupations values (%L, '0000')$$, :'manila')) r
    union all select pg_temp.call_as(null, 'postgres', format($$insert into public.organization_industries values (%L, '25')$$, :'manila'))
    union all select pg_temp.call_as(null, 'postgres', format($$insert into public.organization_languages values (%L, 'xx')$$, :'manila'))
  ) t),
  '23503|insert or update on table "organization_occupations" violates foreign key constraint "organization_occupations_occupation_id_fkey"|Key (occupation_id)=(0000) is not present in table "occupations".,'
    || '23503|insert or update on table "organization_industries" violates foreign key constraint "organization_industries_industry_code_fkey"|Key (industry_code)=(25) is not present in table "industries".,'
    || '23503|insert or update on table "organization_languages" violates foreign key constraint "organization_languages_language_code_fkey"|Key (language_code)=(xx) is not present in table "languages".',
  'NFR-M3: a value outside its code list is refused by the foreign key, even past the function'
);
select is(
  pg_temp.set_offer(:'ow', :'manila', null, null, null, 'both') || ',' || pg_temp.offer(:'manila')
    || ',' || pg_temp.extras(:'manila'),
  'ok,||||both,null/null',
  'null lists clear the sets, and the size band and founded year are cleared when left out'
);

-- AC5: staffing rules ---------------------------------------------------------------------------------------------------
select is(
  pg_temp.set_offer(:'ow3', :'staffing', array['7212'], null, null, 'local', '{}')
    || ',' || pg_temp.set_offer(:'ow3', :'staffing', array['7212'], null, null, 'local', '{staffing,temporary}'),
  'P0001|CHARA_INVALID_INPUT|staffing_types,P0001|CHARA_INVALID_INPUT|service_types',
  'AC5: a staffing company without a staffing type is refused with staffing_types; staffing is its type, not a service it adds'
);
select is(
  pg_temp.set_offer(:'ow3', :'staffing', array['7212'], null, null, 'local', '{temporary,contract,temporary}')
    || ',' || pg_temp.offer(:'staffing'),
  'ok,7212|||temporary,contract|local',
  'AC5: with temporary and contract the staffing company stores two service type rows'
);
select is(
  pg_temp.set_offer(:'ow2', :'rival', array['7212'], null, null, 'local', '{temporary}')
    || ',' || pg_temp.set_offer(:'ow2', :'rival', array['7212'], null, null, 'local', '{staffing}'),
  'P0001|CHARA_INVALID_INPUT|staffing_service_required,P0001|CHARA_INVALID_INPUT|staffing_types',
  'AC5: a recruitment company names staffing types only with the service staffing, and staffing only with a type'
);
select is(
  pg_temp.set_offer(:'ow2', :'rival', array['7212'], null, null, 'local', '{staffing,temporary,permanent}')
    || ',' || pg_temp.offer(:'rival'),
  'ok,7212|||staffing,temporary,permanent|local',
  'AC5: with staffing, temporary and permanent the recruitment company stores the three rows'
);
select is(
  pg_temp.set_offer(:'ow2', :'rival', array['7212'], null, null, 'local', '{}') || ',' || pg_temp.offer(:'rival')
    || ',' || (pg_temp.audits(:'rival') -> 1 -> 'service_types')::text,
  'ok,7212||||local,{"added": [], "removed": ["permanent", "staffing", "temporary"]}',
  'AC5 states: the recruitment company switches the staffing service off again, audited'
);

-- AC8: who writes -------------------------------------------------------------------------------------------------------
select is(
  pg_temp.set_offer(:'ad', :'manila', array['7212'], array['C'], array['ar']) || ',' || pg_temp.offer(:'manila'),
  'ok,7212|C|ar||international',
  'AC8: the admin writes too'
);
select is(
  pg_temp.set_offer(:'mb', :'manila', array['7126'], null, null)
    || ',' || pg_temp.set_offer(:'ow2', :'manila', array['7126'], null, null)
    || ',' || pg_temp.set_offer(:'ow3', :'manila', array['7126'], null, null)
    || ',' || pg_temp.set_offer(:'adm', :'manila', array['7126'], null, null)
    || ',' || pg_temp.set_offer(:'wkr', :'manila', array['7126'], null, null),
  'P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|',
  'AC8: the member, the other partners, an employer admin and a candidate get CHARA_FORBIDDEN'
);
select is(
  pg_temp.set_offer(null, :'manila', array['7126'], null, null),
  '42501|permission denied for function set_organization_workforce_offer|',
  'AC8: the anonymous caller is refused at the EXECUTE grant'
);
select is(pg_temp.offer(:'manila'), '7212|C|ar||international', 'AC8: the refused callers changed nothing');
select is(
  (select string_agg(r, ',') from (
    select pg_temp.call_as(:'ow', 'authenticated', format($$insert into public.%I (organization_id, %I) values (%L, %L)$$, t, c, :'manila', v)) r
    from (values ('organization_occupations', 'occupation_id', '7126'), ('organization_industries', 'industry_code', 'F'),
                 ('organization_languages', 'language_code', 'en'), ('organization_service_types', 'service', 'staffing')) x (t, c, v)
    union all
    select pg_temp.call_as(null, 'anon', format('delete from public.%I where organization_id = %L', t, :'manila'))
    from unnest(array['organization_occupations', 'organization_industries', 'organization_languages', 'organization_service_types']) t
    union all
    select pg_temp.call_as(:'ow', 'authenticated', format('update public.%I set created_at = now() where organization_id = %L', t, :'manila'))
    from unnest(array['organization_occupations', 'organization_industries', 'organization_languages', 'organization_service_types']) t
  ) s),
  (select string_agg(format('42501|permission denied for table %s|', t), ',') from (
    select t from unnest(array['organization_occupations', 'organization_industries', 'organization_languages',
      'organization_service_types', 'organization_occupations', 'organization_industries', 'organization_languages',
      'organization_service_types', 'organization_occupations', 'organization_industries', 'organization_languages',
      'organization_service_types']) with ordinality u (t, n) order by n) s),
  'AC3, AC8: direct INSERT, UPDATE and DELETE on the four tables are refused for every API role'
);
select is(
  pg_temp.set_offer(:'own1', :'emp1', array['7212'], null, null),
  'P0001|CHARA_FORBIDDEN|partner_only',
  'an employer cannot record a workforce offer for its own organisation'
);
update public.organizations set status = 'suspended' where id = :'rival';
select is(
  pg_temp.set_offer(:'ow2', :'rival', array['7126'], null, null),
  'P0001|CHARA_FORBIDDEN|organization_suspended',
  'a suspended partner cannot change its offer'
);
update public.organizations set status = 'active' where id = :'rival';
update public.profiles set status = 'suspended' where id = :'ad';
select is(
  pg_temp.set_offer(:'ad', :'manila', array['7126'], null, null),
  'P0001|CHARA_FORBIDDEN|profile_suspended',
  'a suspended admin cannot change it'
);
update public.profiles set status = 'active' where id = :'ad';

-- AC8, NFR-S8: who reads ------------------------------------------------------------------------------------------------
select is(
  pg_temp.set_offer(:'ow', :'manila', array['7212', '7126'], array['C', 'F'], array['ar', 'en', 'tl'], 'international',
    '{staffing,temporary}')
    || ',' || pg_temp.set_offer(:'ow4', :'staffing2', array['7212'], array['F'], array['en'], 'local', '{project}'),
  'ok,ok',
  'Manila Skills and the second staffing company record their offers'
);
update public.organizations set review_status = 'listed', listed_at = now() where id = :'manila';

select is(
  format('%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s',
    pg_temp.seen_by(:'ow', :'manila'), pg_temp.seen_by(:'mb', :'manila'), pg_temp.seen_by(:'ow2', :'manila'),
    pg_temp.seen_by(:'ow3', :'manila'), pg_temp.seen_by(:'ow4', :'manila'), pg_temp.seen_by(:'own1', :'manila'),
    pg_temp.seen_by(:'own2', :'manila'), pg_temp.seen_by(:'wkr', :'manila'), pg_temp.seen_by(:'wk2', :'manila'),
    pg_temp.seen_by(null, :'manila'), pg_temp.seen_by(:'nul', :'manila')),
  '2/2/3/2,2/2/3/2,2/2/3/2,2/2/3/2,2/2/3/2,2/2/3/2,2/2/3/2,2/2/3/2,2/2/3/2,2/2/3/2,2/2/3/2',
  'AC8, NFR-S8: everyone reads the four sets of the listed, active partner, anonymous included'
);
select is(
  format('%s,%s,%s,%s,%s,%s,%s,%s,%s',
    pg_temp.seen_by(:'ow4', :'staffing2'), pg_temp.seen_by(:'ow3', :'staffing2'), pg_temp.seen_by(:'ow', :'staffing2'),
    pg_temp.seen_by(:'own1', :'staffing2'), pg_temp.seen_by(:'own2', :'staffing2'), pg_temp.seen_by(:'wkr', :'staffing2'),
    pg_temp.seen_by(:'wk2', :'staffing2'), pg_temp.seen_by(null, :'staffing2'), pg_temp.seen_by(:'adm', :'staffing2')),
  '1/1/1/1,0/0/0/0,0/0/0/0,0/0/0/0,0/0/0/0,0/0/0/0,0/0/0/0,0/0/0/0,0/0/0/0',
  'AC8, NFR-S8: only members read the offer of a partner that is not listed: not the competing partners, the employers, the candidates or anonymous'
);
update public.organizations set status = 'suspended' where id = :'manila';
select is(
  format('%s,%s,%s', pg_temp.seen_by(:'mb', :'manila'), pg_temp.seen_by(:'own1', :'manila'), pg_temp.seen_by(null, :'manila')),
  '2/2/3/2,0/0/0/0,0/0/0/0',
  'NFR-S8: a suspended listed partner is no longer listed, so only its members read its offer'
);
update public.organizations set status = 'active', review_status = 'declined' where id = :'manila';
select is(
  format('%s,%s', pg_temp.seen_by(:'mb', :'manila'), pg_temp.seen_by(:'ow2', :'manila')),
  '2/2/3/2,0/0/0/0',
  'NFR-S8: a declined partner is not public either'
);
update public.organizations set review_status = 'listed' where id = :'manila';
select is(
  pg_temp.set_offer(:'ow', :'manila', array['7212', '7126', '7111'], array['C', 'F'], array['ar', 'en', 'tl'], 'international',
    '{staffing,temporary}') || ',' || pg_temp.seen_by(null, :'manila'),
  'ok,3/2/3/2',
  'AC9 data: a saved occupation is read at once from the table, without a refresh step'
);

-- AC4: the occupation limit follows the plan ---------------------------------------------------------------------------
update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.new_org(:'pp', 'recruitment_company') as org_partner \gset
select pg_temp.new_org(:'pr', 'recruitment_company') as org_pro \gset
select pg_temp.new_org(:'pe', 'recruitment_company') as org_ent \gset
select pg_temp.new_org(:'pd', 'recruitment_company') as org_down \gset
select pg_temp.new_org(:'ps', 'recruitment_company') as org_free \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (:'org_partner', 'recruitment_partner', 'active', 'null'),
  (:'org_pro', 'recruitment_professional', 'active', 'null'),
  (:'org_ent', 'recruitment_enterprise', 'active', 'null'),
  (:'org_down', 'recruitment_professional', 'active', 'null');

select is(
  pg_temp.set_offer(:'pp', :'org_partner', pg_temp.occupations(10), array['C'], array['en'])
    || ',' || pg_temp.set_offer(:'pp', :'org_partner', pg_temp.occupations(11), array['C', 'F'], array['en']),
  'ok,P0001|CHARA_LIMIT_REACHED|listed_occupations',
  'AC4: the Basic plan stores 10 occupations and refuses the eleventh with CHARA_LIMIT_REACHED listed_occupations'
);
select is(pg_temp.offer(:'org_partner'), array_to_string(pg_temp.occupations(10), ',') || '|C|en||international',
  'AC4: the refused call keeps the previous set, industries included');
select is(
  pg_temp.set_offer(:'pr', :'org_pro', pg_temp.occupations(30), null, null)
    || ',' || pg_temp.set_offer(:'pr', :'org_pro', pg_temp.occupations(31), null, null),
  'ok,P0001|CHARA_LIMIT_REACHED|listed_occupations',
  'AC4: the Professional plan stores 30 and refuses 31'
);
select is(
  pg_temp.set_offer(:'pe', :'org_ent', pg_temp.occupations(120), null, null)
    || ',' || pg_temp.occupation_count(:'org_ent'),
  'ok,120',
  'AC4: the Enterprise plan stores 120'
);
select is(
  pg_temp.set_offer(:'pp', :'org_partner', pg_temp.occupations(10), (select array_agg(code) from public.industries),
    (select array_agg(code) from public.languages)),
  'ok',
  'AC4: industries and languages are not limited'
);
select is(
  pg_temp.set_offer(:'ps', :'org_free', pg_temp.occupations(10), null, null)
    || ',' || pg_temp.set_offer(:'ps', :'org_free', pg_temp.occupations(11), null, null),
  'ok,P0001|CHARA_LIMIT_REACHED|listed_occupations',
  'AC4: during onboarding the fallback free plan carries the Basic limit of 10'
);
select is(pg_temp.set_offer(:'pd', :'org_down', pg_temp.occupations(15), null, null), 'ok', 'a Professional company lists 15 occupations');
update billing.subscriptions set plan_code = 'recruitment_partner' where organization_id = :'org_down';
select is(
  pg_temp.set_offer(:'pd', :'org_down', pg_temp.occupations(15), array['C'], null)
    || ',' || pg_temp.set_offer(:'pd', :'org_down', pg_temp.occupations(12), null, null)
    || ',' || pg_temp.set_offer(:'pd', :'org_down', pg_temp.occupations(11) || array['9629'], null, null),
  'ok,ok,P0001|CHARA_LIMIT_REACHED|listed_occupations',
  'after a downgrade the saved occupations stay and may be removed, but none is added above the limit'
);
select is(
  format('%s,%s,%s,%s',
    pg_temp.val_as(:'pp', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''listed_occupations'']) u)', :'org_partner')),
    pg_temp.val_as(:'pr', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''listed_occupations'']) u)', :'org_pro')),
    coalesce(pg_temp.val_as(:'pe', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''listed_occupations'']) u)', :'org_ent')), 'null'),
    pg_temp.val_as(:'mb', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''listed_occupations'']) u)', :'manila'))),
  '10,30,null,10',
  'AC10: the form reads the limit that applies: 10, 30, unlimited, and 10 for a member of a company on the free plan'
);
select is(
  pg_temp.call_as(:'ow2', 'authenticated', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''listed_occupations'']) u)', :'manila'), 'aal1')
    || ',' || pg_temp.call_as(null, 'anon', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''listed_occupations'']) u)', :'manila')),
  '42501|CHARA_FORBIDDEN|,42501|permission denied for function org_usage|',
  'the limit is read by members only'
);
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(
  coalesce(pg_temp.val_as(:'pp', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''listed_occupations'']) u)', :'org_partner')), 'null')
    || ',' || pg_temp.set_offer(:'pp', :'org_partner', pg_temp.occupations(11), null, null),
  'null,ok',
  'while entitlements are not enforced no limit is shown or applied'
);
update private.settings set value = 'true' where key = 'entitlements_enforced';

-- NFR-A4: saves of one organisation are serialised ----------------------------------------------------------------------
-- A second session holds the lock of a partner, as a save in progress would. Without the lock two saves could each read
-- the old rows and together store more occupations than the limit; with it the second save waits, then reads what the
-- first committed. Another organisation is not held up.
select pg_temp.new_org(:'pp', 'recruitment_company') as org_lock \gset
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select is(
  (select l from extensions.dblink('holder',
    format('select pg_advisory_lock(hashtextextended(%L, 0))::text', 'organization_workforce_offer:' || :'org_lock'))
    as t (l text)),
  '',
  'a second session holds the save lock of a partner'
);
set local lock_timeout = '300ms';
select is(
  split_part(pg_temp.set_offer(:'pp', :'org_lock', pg_temp.occupations(10), null, null), '|', 1),
  '55P03',
  'NFR-A4: a save of the same organisation waits for the save in progress'
);
select is(
  pg_temp.set_offer(:'pr', :'org_pro', pg_temp.occupations(2), null, null),
  'ok',
  'NFR-A4: a save of another organisation does not wait'
);
select l from extensions.dblink('holder',
  format('select pg_advisory_unlock(hashtextextended(%L, 0))::text', 'organization_workforce_offer:' || :'org_lock')) as t (l text);
select extensions.dblink_disconnect('holder');
select is(
  pg_temp.set_offer(:'pp', :'org_lock', pg_temp.occupations(10), null, null)
    || ',' || pg_temp.occupation_count(:'org_lock'),
  'ok,10',
  'NFR-A4: once the other save is over the save goes through, up to the limit'
);
reset lock_timeout;

select * from finish();
rollback;
