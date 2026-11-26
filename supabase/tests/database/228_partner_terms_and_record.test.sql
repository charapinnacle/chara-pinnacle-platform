-- A partner's standard terms and track record: who may set them, the fee rules of its kind, and what the public profile
-- reads.
begin;
select plan(16);

\ir organizations_fixture.inc

create function pg_temp.new_partner_user(p_id uuid, p_type text) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

create function pg_temp.partner(p_owner uuid, p_type public.organization_type, p_slug text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, founded_year)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug, initcap(p_slug), 'PH', 2015);
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

-- Runs one statement as the user (anonymous when null) and returns 'ok' or 'sqlstate|message|detail'; the value of the
-- statement lands in t.result.
create function pg_temp.run(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((%s)::text, ''''), true)', p_sql), p_aal)
$$;

\set rown '00000000-0000-0000-0000-0000000f2801'
\set sown '00000000-0000-0000-0000-0000000f2802'
\set rmem '00000000-0000-0000-0000-0000000f2803'
update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner_user(:'rown', 'recruitment_company');
select pg_temp.new_partner_user(:'sown', 'staffing_company');
select pg_temp.new_partner_user(:'rmem', 'recruitment_company');
select pg_temp.partner(:'rown', 'recruitment_company', 'terms-recruit') as rec \gset
select pg_temp.partner(:'sown', 'staffing_company', 'terms-staff') as stf \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'rec', :'rmem', 'member', now());

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
   where oid in ('public.partner_standard_terms'::regclass, 'public.partner_track_records'::regclass)),
  'row level security is on and forced on both tables'
);
select is_empty(
  $$ select 1 from unnest(array['anon', 'authenticated']) r(role)
     cross join unnest(array['public.partner_standard_terms', 'public.partner_track_records']) t(name)
     cross join unnest(array['insert', 'update', 'delete']) p(priv)
     where has_table_privilege(r.role, t.name, p.priv) $$,
  'no API role writes the tables directly'
);

-- Standard terms -------------------------------------------------------------------------------------------------------
select is(
  pg_temp.run(:'rown', format('public.set_partner_standard_terms(%L, ''fee_per_hire'', 1500, ''eur'', 90, 8, ''Includes trade test'')', :'rec')),
  'ok', 'a recruitment company states a fee per hire with a guarantee'
);
select is(
  (select fee_model || '|' || fee_amount || '|' || fee_currency || '|' || guarantee_days || '|' || coalesce(min_assignment_weeks::text, '-') || '|' || note
   from public.partner_standard_terms where organization_id = :'rec'),
  'fee_per_hire|1500.00|EUR|90|-|Includes trade test',
  'the currency is upper case, and the assignment length of a rate is not kept with a placement fee'
);
select is(
  pg_temp.run(:'rown', format('public.set_partner_standard_terms(%L, ''hourly_rate'', 18, ''EUR'')', :'rec')),
  'P0001|CHARA_INVALID_INPUT|fee_model_for_kind', 'a recruitment company cannot state an hourly rate'
);
select is(
  pg_temp.run(:'sown', format('public.set_partner_standard_terms(%L, ''hourly_rate'', 18.5, ''EUR'', 30, 12)', :'stf')),
  'ok', 'a staffing company states an hourly rate'
);
select is(
  (select fee_model || '|' || coalesce(guarantee_days::text, '-') || '|' || min_assignment_weeks
   from public.partner_standard_terms where organization_id = :'stf'),
  'hourly_rate|-|12', 'with its shortest assignment, and no guarantee'
);
select is(
  pg_temp.run(:'sown', format('public.set_partner_standard_terms(%L, ''fee_per_hire'', 1500, ''EUR'')', :'stf'))
    || ',' || pg_temp.run(:'rown', format('public.set_partner_standard_terms(%L, ''percent_first_year_salary'', 12, ''EUR'')', :'rec'))
    || ',' || pg_temp.run(:'rown', format('public.set_partner_standard_terms(%L, ''fee_per_hire'', 1500, ''XXX'')', :'rec')),
  'P0001|CHARA_INVALID_INPUT|fee_model_for_kind,P0001|CHARA_INVALID_INPUT|standard_terms,P0001|CHARA_INVALID_INPUT|fee_currency',
  'a staffing company cannot state a fee per hire; a percentage has no currency; the currency is one of the list'
);
select is(
  pg_temp.run(:'rmem', format('public.set_partner_standard_terms(%L, ''on_request'')', :'rec'))
    || ',' || pg_temp.run(:'rown', format('public.set_partner_standard_terms(%L, ''on_request'')', :'rec'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|aal2_required',
  'a member, and the owner below aal2, cannot change them'
);

-- Track record ---------------------------------------------------------------------------------------------------------
select is(
  pg_temp.run(:'rown', format('public.set_partner_track_record(%L, 120, array[''de'', ''ae'', ''XX''])', :'rec')),
  'P0001|CHARA_INVALID_INPUT|countries_placed', 'a country outside the list is refused'
);
select pg_temp.run(:'rown', format('public.set_partner_track_record(%L, 120, array[''de'', ''ae'', ''DE''])', :'rec')) as saved \gset
select is(
  :'saved' || '|' || (select placements_last_year || ':' || array_to_string(countries_placed, ',') from public.partner_track_records where organization_id = :'rec'),
  'ok|120:AE,DE', 'the stated placements and the countries, upper case, once each, sorted by code'
);
select is(
  pg_temp.run(:'rown', format('public.set_partner_track_record(%L, -1)', :'rec')),
  'P0001|CHARA_INVALID_INPUT|track_record', 'a negative number of placements is refused'
);

-- Reading ----------------------------------------------------------------------------------------------------------------
select is(
  pg_temp.val_as(:'rmem', 'aal1', format('select count(*) from public.partner_standard_terms where organization_id = %L', :'rec'))
    || ',' || pg_temp.val_as(:'sown', 'aal1', format('select count(*) from public.partner_standard_terms where organization_id = %L', :'rec')),
  '1,0', 'a member reads the company''s own terms; another partner does not'
);
select is(
  pg_temp.run(null, 'public.get_partner_terms_and_record(''terms-recruit'')') || '|' || current_setting('t.result'),
  'ok|', 'an unlisted company''s terms are not public'
);
update public.organizations set review_status = 'listed', listed_at = now() where id = :'rec';
select is(
  pg_temp.run(null, 'public.get_partner_terms_and_record(''terms-recruit'')'),
  'ok', 'a listed company''s terms are public'
);
select is(
  (current_setting('t.result')::jsonb #>> '{terms,fee_model}') || '|' || (current_setting('t.result')::jsonb #>> '{record,placements_last_year}')
    || '|' || (current_setting('t.result')::jsonb #>> '{record,founded_year}') || '|' || (current_setting('t.result')::jsonb #>> '{record,platform_hires}')
    || '|' || (select string_agg(e ->> 'code', ',') from jsonb_array_elements(current_setting('t.result')::jsonb #> '{record,countries_placed}') e),
  'fee_per_hire|120|2015|0|DE,AE',
  'with its terms, the stated record (countries by name), the year founded and the hires counted on the platform'
);

select * from finish();
rollback;
