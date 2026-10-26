begin;
select plan(59);

\ir organizations_fixture.inc

-- Where you serve (V06, FR-K1 AC1, AC3, AC4, AC6; NFR-S8, NFR-A4, NFR-M3): the table organization_geographies, its read
-- policies, set_organization_geographies with the markets limit, read through org_usage.

create function pg_temp.new_partner(p_id uuid, p_type text) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_country text default 'PH') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), p_country);
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.add_member(p_org uuid, p_user uuid, p_role public.member_role) returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

create function pg_temp.set_geo(p_user uuid, p_org uuid, p_sources text[], p_serves text[], p_aal text default 'aal1')
returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select public.set_organization_geographies(%L, %L, %L)', p_org, p_sources, p_serves), p_aal)
$$;

-- The stored rows of an organisation, read past row level security: 'sources|serves', codes sorted.
create function pg_temp.geo(p_org uuid) returns text
language sql as $$
  select coalesce(string_agg(country_code, ',' order by country_code) filter (where scope = 'sources_from'), '')
    || '|' || coalesce(string_agg(country_code, ',' order by country_code) filter (where scope = 'serves_market'), '')
  from public.organization_geographies where organization_id = p_org
$$;

create function pg_temp.audits(p_org uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(l.metadata order by l.id), '[]') from audit.log l
  where l.entity_id = p_org::text and l.action = 'organization.geographies_changed'
$$;

-- The number of rows of the organisation a caller sees (null caller: anonymous).
create function pg_temp.seen_by(p_user uuid, p_org uuid) returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text end,
    true);
  if p_user is null then set local role anon; else set local role authenticated; end if;
  select count(*) into v_count from public.organization_geographies where organization_id = p_org;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_count;
end;
$$;

create function pg_temp.countries(p_n integer) returns text[]
language sql as $$ select array(select code from public.countries order by code limit p_n) $$;

\set ow '00000000-0000-0000-0000-0000000d0001'
\set ad '00000000-0000-0000-0000-0000000d0002'
\set mb '00000000-0000-0000-0000-0000000d0003'
\set ow2 '00000000-0000-0000-0000-0000000d0004'
\set ow3 '00000000-0000-0000-0000-0000000d0005'
\set pp '00000000-0000-0000-0000-0000000d0006'
\set pr '00000000-0000-0000-0000-0000000d0007'
\set pe '00000000-0000-0000-0000-0000000d0008'
\set po '00000000-0000-0000-0000-0000000d0009'
\set pd '00000000-0000-0000-0000-0000000d000a'
\set ps '00000000-0000-0000-0000-0000000d000b'
\set wk2 '00000000-0000-0000-0000-0000000d000c'

-- Schema ---------------------------------------------------------------------------------------------------------------
select has_table('public', 'organization_geographies', 'the table organization_geographies exists');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.organization_geographies'::regclass),
  'row level security is enabled and forced'
);
select col_is_pk('public', 'organization_geographies', array['organization_id', 'scope', 'country_code'],
  'one row per organisation, scope and country');
select fk_ok('public', 'organization_geographies', 'country_code', 'public', 'countries', 'code',
  'NFR-M3: every country is a row of the countries code list');
select fk_ok('public', 'organization_geographies', 'organization_id', 'public', 'organizations', 'id',
  'every row belongs to an organisation');
select col_type_is('public', 'organization_geographies', 'scope', 'geography_scope', 'the scope is the enum geography_scope');
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'organization_geographies'
    and indexdef like '%(scope, country_code, organization_id)%'),
  'the directory index (scope, country_code, organization_id) exists'
);
select ok(
  has_table_privilege('anon', 'public.organization_geographies', 'select')
  and has_table_privilege('authenticated', 'public.organization_geographies', 'select')
  and not has_table_privilege('service_role', 'public.organization_geographies', 'select')
  and not has_table_privilege('anon', 'public.organization_geographies', 'insert, update, delete, truncate')
  and not has_table_privilege('authenticated', 'public.organization_geographies', 'insert, update, delete, truncate')
  and not has_table_privilege('service_role', 'public.organization_geographies', 'insert, update, delete, truncate'),
  'AC6: the API roles may only select; nobody writes the table directly'
);
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
   where oid in ('public.set_organization_geographies(uuid, text[], text[])'::regprocedure,
                 'public.org_usage(uuid, text[])'::regprocedure))
  and has_function_privilege('authenticated', 'public.set_organization_geographies(uuid, text[], text[])', 'execute')
  and not has_function_privilege('anon', 'public.set_organization_geographies(uuid, text[], text[])', 'execute')
  and not has_function_privilege('service_role', 'public.set_organization_geographies(uuid, text[], text[])', 'execute')
  and has_function_privilege('authenticated', 'public.org_usage(uuid, text[])', 'execute')
  and not has_function_privilege('anon', 'public.org_usage(uuid, text[])', 'execute'),
  'both functions are security definer with an empty search_path and run for authenticated only'
);

-- Fixture: Manila Skills (owner ow, admin ad, member mb), a second recruitment company (ow2), a staffing company (ow3),
-- two employers (own1 with admin adm, own2), two candidates (wkr, wk2) and anonymous.
update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(id, 'recruitment_company') from unnest(array[
  :'ow', :'ad', :'mb', :'ow2', :'pp', :'pr', :'pe', :'po', :'pd', :'ps']::uuid[]) id;
select pg_temp.new_partner(:'ow3', 'staffing_company');
select pg_temp.new_user(:'wk2', 'worker');
update public.profiles set account_kind = intended_account_kind where id = :'wk2';

select pg_temp.new_org(:'ow', 'recruitment_company') as manila \gset
select pg_temp.add_member(:'manila', :'ad', 'admin');
select pg_temp.add_member(:'manila', :'mb', 'member');
select pg_temp.new_org(:'ow2', 'recruitment_company') as rival \gset
select pg_temp.new_org(:'ow3', 'staffing_company', 'DE') as staffing \gset
select pg_temp.new_org(:'own1', 'employer', 'DE') as emp1 \gset
select pg_temp.add_member(:'emp1', :'adm', 'admin');
select pg_temp.new_org(:'own2', 'employer', 'DE') as emp2 \gset

-- Release switch -------------------------------------------------------------------------------------------------------
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(
  pg_temp.set_geo(:'ow', :'manila', array['PH'], array['DE'])
    || ',' || pg_temp.call_as(:'ow', 'authenticated', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''markets'']) u)', :'manila'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|release_off,42501|CHARA_FORBIDDEN|release_off',
  'while release 2a is off both functions refuse'
);
update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC3: countries must exist, codes are upper-cased and merged ---------------------------------------------------------
select is(
  pg_temp.set_geo(:'ow', :'manila', array['PH', 'ph', 'NP', 'PH'], array['DE', 'XX']),
  'P0001|CHARA_INVALID_INPUT|country_code',
  'AC3: an unknown country refuses the call with the detail country_code'
);
select is(pg_temp.geo(:'manila'), '|', 'AC3: the refused call wrote nothing');
select is(
  pg_temp.set_geo(:'ow', :'manila', array['PH'], array_fill('DE'::text, array[251]))
    || ',' || pg_temp.set_geo(:'ow', :'manila', array_fill('PH'::text, array[251]), array['DE']),
  'P0001|CHARA_INVALID_INPUT|country_code,P0001|CHARA_INVALID_INPUT|country_code',
  'a list longer than the 250 reference countries is refused before any lookup, in either scope'
);
select is(
  pg_temp.set_geo(:'ow', :'manila', array['PH'], array['DE', null])
    || ',' || pg_temp.set_geo(:'ow', :'manila', array[''], array['DE']),
  'P0001|CHARA_INVALID_INPUT|country_code,P0001|CHARA_INVALID_INPUT|country_code',
  'AC3: a null or empty code is no country either'
);

-- AC1: the owner at aal1 records the countries; one audit row with added and removed per scope.
select is(
  pg_temp.call_as(:'ow', 'authenticated',
    format($$select set_config('t.result', public.set_organization_geographies(%L, array['PH', 'ph', ' NP ', 'PH'],
      array['DE', 'AE', 'sa'])::text, true)$$, :'manila'), 'aal1'),
  'ok',
  'AC1, AC6: the owner at aal1 saves the countries'
);
select is(pg_temp.geo(:'manila'), 'NP,PH|AE,DE,SA',
  'AC1, AC3: two source rows (PH, NP) and three served rows (DE, AE, SA), upper-cased, trimmed and merged');
select is(current_setting('t.result')::jsonb,
  '{"sources_from": ["NP", "PH"], "serves_market": ["AE", "DE", "SA"], "changed": true}'::jsonb,
  'the result is the stored sets');
select is(pg_temp.audits(:'manila'),
  '[{"sources_from": {"added": ["NP", "PH"], "removed": []}, "serves_market": {"added": ["AE", "DE", "SA"], "removed": []}}]'::jsonb,
  'AC1: one audit row organization.geographies_changed lists the added countries per scope');
select is(
  (select based_in_country || '|' || (workforce_profile_updated_at is not null)::text from public.organizations where id = :'manila'),
  'PH|true',
  'AC1: based_in_country stays PH and the profile date is stamped'
);

update public.organizations set workforce_profile_updated_at = '2026-03-03 10:00+00' where id = :'manila';
select is(
  pg_temp.set_geo(:'ow', :'manila', array['np', 'PH'], array['SA', 'DE', 'AE', 'de']),
  'ok',
  'saving the same countries in another order and case succeeds'
);
select is(
  (select format('%s|%s', jsonb_array_length(pg_temp.audits(:'manila')), workforce_profile_updated_at)
   from public.organizations where id = :'manila'),
  '1|2026-03-03 10:00:00+00',
  'a save that changes nothing writes no audit row and keeps the date of the last change'
);

select is(
  pg_temp.set_geo(:'ow', :'manila', array['PH', 'NP'], array['DE', 'DE', 'AE']),
  'ok',
  'AC3: the second call with a repeated served country succeeds'
);
select is(pg_temp.geo(:'manila'), 'NP,PH|AE,DE', 'AC3: DE and AE are stored once each');
select is(pg_temp.audits(:'manila') -> 1,
  '{"sources_from": {"added": [], "removed": []}, "serves_market": {"added": [], "removed": ["SA"]}}'::jsonb,
  'AC1: the audit row of a change lists the removed country of its scope');
select ok(
  (select workforce_profile_updated_at > '2026-03-03 10:00+00' from public.organizations where id = :'manila'),
  'a change stamps workforce_profile_updated_at again'
);
select throws_ok(
  format($$insert into public.organization_geographies (organization_id, scope, country_code) values (%L, 'serves_market', 'DE')$$,
    :'manila'),
  '23505', null,
  'AC3: a direct duplicate of (organisation, scope, country) fails with unique_violation'
);
select throws_ok(
  format($$insert into public.organization_geographies (organization_id, scope, country_code) values (%L, 'serves_market', 'XX')$$,
    :'manila'),
  '23503', null,
  'NFR-M3: a country outside the code list is refused by the foreign key'
);
select is(
  pg_temp.set_geo(:'ow', :'manila', array[]::text[], array['DE', 'AE']) || ',' || pg_temp.geo(:'manila'),
  'ok,|AE,DE',
  'AC3: an empty source list stores no source country'
);
select is(
  pg_temp.set_geo(:'ow', :'manila', null, null) || ',' || pg_temp.geo(:'manila'),
  'ok,|',
  'null lists clear both scopes'
);

-- AC6: who writes -------------------------------------------------------------------------------------------------------
select is(
  pg_temp.set_geo(:'ad', :'manila', array['PH', 'NP'], array['DE', 'AE', 'SA']) || ',' || pg_temp.geo(:'manila'),
  'ok,NP,PH|AE,DE,SA',
  'AC6: the admin writes too'
);
select is(
  pg_temp.set_geo(:'mb', :'manila', array['PH'], array['DE'])
    || ',' || pg_temp.set_geo(:'ow2', :'manila', array['PH'], array['DE'])
    || ',' || pg_temp.set_geo(:'adm', :'manila', array['PH'], array['DE'])
    || ',' || pg_temp.set_geo(:'wkr', :'manila', array['PH'], array['DE']),
  'P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|',
  'AC6: the member, another partner''s owner, an employer admin and a candidate get CHARA_FORBIDDEN'
);
select is(
  pg_temp.set_geo(null, :'manila', array['PH'], array['DE']),
  '42501|permission denied for function set_organization_geographies|',
  'AC6: the anonymous caller is refused at the EXECUTE grant'
);
select is(pg_temp.geo(:'manila'), 'NP,PH|AE,DE,SA', 'AC6: the refused callers changed nothing');
select is(
  pg_temp.call_as(:'ow', 'authenticated',
    format($$insert into public.organization_geographies (organization_id, scope, country_code) values (%L, 'serves_market', 'FR')$$, :'manila'))
    || ',' || pg_temp.call_as(:'ow', 'authenticated',
      format($$update public.organization_geographies set country_code = 'FR' where organization_id = %L$$, :'manila'))
    || ',' || pg_temp.call_as(:'ow', 'authenticated',
      format($$delete from public.organization_geographies where organization_id = %L$$, :'manila'))
    || ',' || pg_temp.call_as(null, 'anon',
      format($$delete from public.organization_geographies where organization_id = %L$$, :'manila')),
  '42501|permission denied for table organization_geographies|,42501|permission denied for table organization_geographies|,'
    || '42501|permission denied for table organization_geographies|,42501|permission denied for table organization_geographies|',
  'AC6: direct INSERT, UPDATE and DELETE are refused for the API roles'
);
select is(
  pg_temp.set_geo(:'own1', :'emp1', array['PH'], array['DE']),
  'P0001|CHARA_FORBIDDEN|partner_only',
  'an employer cannot record partner geographies for its own organisation'
);
update public.organizations set status = 'suspended' where id = :'rival';
select is(
  pg_temp.set_geo(:'ow2', :'rival', array['PH'], array['DE']),
  'P0001|CHARA_FORBIDDEN|organization_suspended',
  'a suspended partner cannot change its geographies'
);
update public.organizations set status = 'active' where id = :'rival';
update public.profiles set status = 'suspended' where id = :'ad';
select is(
  pg_temp.set_geo(:'ad', :'manila', array['PH'], array['DE']),
  'P0001|CHARA_FORBIDDEN|profile_suspended',
  'a suspended admin cannot change them'
);
update public.profiles set status = 'active' where id = :'ad';

-- AC6, NFR-S8: who reads ------------------------------------------------------------------------------------------------
select is(pg_temp.set_geo(:'ow2', :'rival', array['IN'], array['AE']), 'ok', 'the second partner records its countries');
select is(pg_temp.set_geo(:'ow3', :'staffing', array['IN'], array['DE']), 'ok', 'the staffing company records its countries');
update public.organizations set review_status = 'listed', listed_at = now() where id = :'manila';

select is(
  format('%s,%s,%s,%s,%s,%s,%s,%s,%s,%s',
    pg_temp.seen_by(:'ow', :'manila'), pg_temp.seen_by(:'mb', :'manila'), pg_temp.seen_by(:'ow2', :'manila'),
    pg_temp.seen_by(:'ow3', :'manila'), pg_temp.seen_by(:'own1', :'manila'), pg_temp.seen_by(:'own2', :'manila'),
    pg_temp.seen_by(:'wkr', :'manila'), pg_temp.seen_by(:'wk2', :'manila'), pg_temp.seen_by(null, :'manila'),
    pg_temp.seen_by(:'nul', :'manila')),
  '5,5,5,5,5,5,5,5,5,5',
  'AC6, NFR-S8: everyone reads the five rows of the listed partner, anonymous included'
);
select is(
  format('%s,%s,%s,%s,%s,%s,%s,%s',
    pg_temp.seen_by(:'ow2', :'rival'), pg_temp.seen_by(:'ow', :'rival'), pg_temp.seen_by(:'ow3', :'rival'),
    pg_temp.seen_by(:'own1', :'rival'), pg_temp.seen_by(:'own2', :'rival'), pg_temp.seen_by(:'wkr', :'rival'),
    pg_temp.seen_by(:'wk2', :'rival'), pg_temp.seen_by(null, :'rival')),
  '2,0,0,0,0,0,0,0',
  'AC6, NFR-S8: only members read the rows of a partner that is not listed: not the competing partners, the employers, the candidates or anonymous'
);
update public.organizations set status = 'suspended' where id = :'manila';
select is(
  format('%s,%s,%s', pg_temp.seen_by(:'ow', :'manila'), pg_temp.seen_by(:'own1', :'manila'), pg_temp.seen_by(null, :'manila')),
  '5,0,0',
  'NFR-S8: a suspended listed partner is no longer listed, so only its members read its rows'
);
update public.organizations set status = 'active', review_status = 'declined' where id = :'manila';
select is(
  format('%s,%s', pg_temp.seen_by(:'mb', :'manila'), pg_temp.seen_by(:'ow2', :'manila')),
  '5,0',
  'NFR-S8: a declined partner is not public either'
);
update public.organizations set review_status = 'listed' where id = :'manila';

-- AC4: the served-country limit follows the plan -----------------------------------------------------------------------
update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.new_org(:'pp', 'recruitment_company') as org_partner \gset
select pg_temp.new_org(:'pr', 'recruitment_company') as org_pro \gset
select pg_temp.new_org(:'pe', 'recruitment_company') as org_ent \gset
select pg_temp.new_org(:'po', 'recruitment_company') as org_ovr \gset
select pg_temp.new_org(:'pd', 'recruitment_company') as org_down \gset
select pg_temp.new_org(:'ps', 'recruitment_company') as org_free \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (:'org_partner', 'recruitment_partner', 'active', 'null'),
  (:'org_pro', 'recruitment_professional', 'active', 'null'),
  (:'org_ent', 'recruitment_enterprise', 'active', 'null'),
  (:'org_ovr', 'recruitment_enterprise', 'active', 'null'),
  (:'org_down', 'recruitment_professional', 'active', 'null');
insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value) values (:'org_ovr', 'markets', 5);

select is(
  pg_temp.set_geo(:'pp', :'org_partner', array['PH'], pg_temp.countries(3)) || ',' || pg_temp.set_geo(:'pp', :'org_partner', array['PH'], pg_temp.countries(4)),
  'ok,P0001|CHARA_LIMIT_REACHED|markets',
  'AC4: the Partner plan stores 3 served countries and refuses the fourth with CHARA_LIMIT_REACHED markets'
);
select is(pg_temp.geo(:'org_partner'), 'PH|' || array_to_string(pg_temp.countries(3), ','),
  'AC4: the refused call leaves the previous rows unchanged');
select is(
  pg_temp.set_geo(:'pr', :'org_pro', null, pg_temp.countries(10)) || ',' || pg_temp.set_geo(:'pr', :'org_pro', null, pg_temp.countries(11)),
  'ok,P0001|CHARA_LIMIT_REACHED|markets',
  'AC4: the Professional plan stores 10 and refuses 11'
);
select is(
  pg_temp.set_geo(:'pe', :'org_ent', null, pg_temp.countries(40)) || ',' || split_part(pg_temp.geo(:'org_ent'), '|', 2),
  'ok,' || array_to_string(pg_temp.countries(40), ','),
  'AC4: the Enterprise plan stores 40'
);
select is(
  pg_temp.set_geo(:'po', :'org_ovr', null, pg_temp.countries(5)) || ',' || pg_temp.set_geo(:'po', :'org_ovr', null, pg_temp.countries(6)),
  'ok,P0001|CHARA_LIMIT_REACHED|markets',
  'AC4: an organisation override of 5 stores 5 and refuses 6'
);
select is(
  pg_temp.set_geo(:'pp', :'org_partner', pg_temp.countries(60), pg_temp.countries(3)),
  'ok',
  'AC4: source countries are not limited'
);
select is(
  pg_temp.set_geo(:'ps', :'org_free', null, pg_temp.countries(3)) || ',' || pg_temp.set_geo(:'ps', :'org_free', null, pg_temp.countries(4)),
  'ok,P0001|CHARA_LIMIT_REACHED|markets',
  'AC4 open point: during onboarding the fallback free plan carries the Partner-tier limit of 3'
);

select is(pg_temp.set_geo(:'pd', :'org_down', null, pg_temp.countries(5)), 'ok', 'a Professional company serves 5 countries');
update billing.subscriptions set plan_code = 'recruitment_partner' where organization_id = :'org_down';
select is(
  pg_temp.set_geo(:'pd', :'org_down', array['PH'], pg_temp.countries(5))
    || ',' || pg_temp.set_geo(:'pd', :'org_down', null, pg_temp.countries(4))
    || ',' || pg_temp.set_geo(:'pd', :'org_down', null, pg_temp.countries(3) || array['ZW']),
  'ok,ok,P0001|CHARA_LIMIT_REACHED|markets',
  'AC4 open point: after a downgrade the saved countries stay and may be removed, but no country is added above the limit'
);

select is(
  format('%s,%s,%s,%s,%s',
    pg_temp.val_as(:'pp', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''markets'']) u)', :'org_partner')),
    pg_temp.val_as(:'pr', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''markets'']) u)', :'org_pro')),
    coalesce(pg_temp.val_as(:'pe', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''markets'']) u)', :'org_ent')), 'null'),
    pg_temp.val_as(:'po', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''markets'']) u)', :'org_ovr')),
    pg_temp.val_as(:'mb', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''markets'']) u)', :'manila'))),
  '3,10,null,5,3',
  'AC5: the form reads the limit that applies: 3, 10, unlimited, the override 5, and 3 for a member of a company on the free plan'
);
select is(
  pg_temp.call_as(:'ow2', 'authenticated', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''markets'']) u)', :'manila'), 'aal1')
    || ',' || pg_temp.call_as(null, 'anon', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''markets'']) u)', :'manila')),
  '42501|CHARA_FORBIDDEN|,42501|permission denied for function org_usage|',
  'the limit is read by members only'
);
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(
  coalesce(pg_temp.val_as(:'pp', 'aal1', format('select (select case when u.applies then u.limit_value end from public.org_usage(%L, array[''markets'']) u)', :'org_partner')), 'null')
    || ',' || pg_temp.set_geo(:'pp', :'org_partner', null, pg_temp.countries(4)),
  'null,ok',
  'while entitlements are not enforced no limit is shown or applied'
);
update private.settings set value = 'true' where key = 'entitlements_enforced';

-- NFR-A4: saves of one organisation are serialised ----------------------------------------------------------------------
-- A second session holds the lock of a partner, as a save in progress would (one that this transaction has not saved yet:
-- the lock lasts until the end of the transaction that took it). Without the lock two saves could
-- each read the old rows and together store more countries than the limit; with it the second save waits, then reads
-- what the first committed. Another organisation is not held up.
select pg_temp.new_org(:'pp', 'recruitment_company') as org_lock \gset
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select is(
  (select l from extensions.dblink('holder',
    format('select pg_advisory_lock(hashtextextended(%L, 0))::text', 'organization_geographies:' || :'org_lock'))
    as t (l text)),
  '',
  'a second session holds the save lock of a partner'
);
set local lock_timeout = '300ms';
select is(
  split_part(pg_temp.set_geo(:'pp', :'org_lock', null, pg_temp.countries(2)), '|', 1),
  '55P03',
  'NFR-A4: a save of the same organisation waits for the save in progress'
);
select is(
  pg_temp.set_geo(:'pr', :'org_pro', null, pg_temp.countries(2)),
  'ok',
  'NFR-A4: a save of another organisation does not wait'
);
select l from extensions.dblink('holder',
  format('select pg_advisory_unlock(hashtextextended(%L, 0))::text', 'organization_geographies:' || :'org_lock')) as t (l text);
select extensions.dblink_disconnect('holder');
select is(
  pg_temp.set_geo(:'pp', :'org_lock', null, pg_temp.countries(2)) || ',' || split_part(pg_temp.geo(:'org_lock'), '|', 2),
  'ok,' || array_to_string(pg_temp.countries(2), ','),
  'NFR-A4: once the other save is over the save goes through'
);
reset lock_timeout;

select * from finish();
rollback;
