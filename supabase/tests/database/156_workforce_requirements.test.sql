begin;
select plan(102);

\ir apply_fixture.inc

-- Workforce requirements (V32, FR-M1 AC3 to AC7 and AC11; NFR-S8 with two employers, two partners, two candidates and
-- anon; NFR-M3; DATA_MODEL.md sections 2, 5, 6, 7 and 10): the tables workforce_requirements, requirement_occupations
-- and requirement_countries, the prohibited terms, save_requirement for create and edit, the release switch, the count
-- of active_requirements and the deployment check. Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner
-- own2, admin adm2) are employers of the fixture; wa and wb are candidates. The partners are made below.

\set dadm '00000000-0000-0000-0000-0000000f3201'
\set gadm '00000000-0000-0000-0000-0000000f3202'
\set delta '00000000-0000-0000-0000-0000000f3211'
\set gamma '00000000-0000-0000-0000-0000000f3212'
\set zown '00000000-0000-0000-0000-0000000f3203'
\set zeta '00000000-0000-0000-0000-0000000f3213'

-- A recruitment or staffing company with an owner, listed.
create function pg_temp.partner(p_id uuid, p_owner uuid, p_type text, p_slug text) returns void
language plpgsql as $$
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (p_id, p_type::public.organization_type, p_slug, initcap(p_slug) || ' Ltd', initcap(p_slug), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_id, p_owner, 'owner', now());
  update public.organizations set review_status = 'listed', submitted_at = now(), listed_at = now() where id = p_id;
end;
$$;

select pg_temp.partner(:'delta', :'dadm', 'recruitment_company', 'delta-recruit');
select pg_temp.partner(:'gamma', :'gadm', 'staffing_company', 'gamma-staffing');
select pg_temp.new_user(:'zown');
update public.profiles set account_kind = intended_account_kind where id = :'zown';
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, status)
values (:'zeta', 'employer', 'zeta-works', 'Zeta Works GmbH', 'Zeta Works', 'DE', 'suspended');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'zeta', :'zown', 'owner', now());

-- The call of save_requirement for p_org (and p_req, null to create) with the valid requirement of AC1, each key of
-- p_over replacing a value; the new or changed id lands in t.req.
create function pg_temp.req_sql(p_org uuid, p_req uuid, p_over jsonb default '{}') returns text
language sql as $$
  with v as (
    select jsonb_build_object(
      'title', null, 'workers', 100, 'country', 'DE', 'city', 'Hamburg', 'industry', 'C',
      'occupations', '[{"occupation_id": "7212", "quantity": 80}, {"occupation_id": "7214", "quantity": 20}]'::jsonb,
      'skills', 'MIG/MAG welding, blueprint reading', 'experience', 2,
      'start', ((now() at time zone 'utc')::date + 120)::text, 'duration', 12, 'employment', 'full_time',
      'salary_min', 2800, 'salary_max', 3400, 'currency', 'EUR', 'period', 'month', 'accommodation', true,
      'permit', true, 'visa', true, 'preference', 'international', 'need', 'both'
    ) || p_over as j
  )
  select format(
    $f$select set_config('t.req', public.save_requirement(
      p_org => %L, p_requirement => %L, p_title => %L, p_workers_needed => %L::integer, p_country_code => %L,
      p_city_region => %L, p_industry_code => %L, p_occupations => %L::jsonb, p_skills => %L,
      p_experience_years => %L::smallint, p_start_date => %L::date, p_duration_months => %L::smallint,
      p_employment_type => %L::public.employment_type, p_salary_min => %L::numeric, p_salary_max => %L::numeric,
      p_salary_currency => %L, p_salary_period => %L::public.salary_period, p_accommodation => %L::boolean,
      p_work_permit_support => %L::boolean, p_visa_support => %L::boolean,
      p_recruitment_preference => %L::public.recruitment_preference, p_partner_need => %L::public.partner_need
    )::text, true)$f$,
    p_org, p_req, j ->> 'title', j ->> 'workers', j ->> 'country', j ->> 'city', j ->> 'industry', j -> 'occupations',
    j ->> 'skills', j ->> 'experience', j ->> 'start', j ->> 'duration', j ->> 'employment', j ->> 'salary_min',
    j ->> 'salary_max', j ->> 'currency', j ->> 'period', j ->> 'accommodation', j ->> 'permit', j ->> 'visa',
    j ->> 'preference', j ->> 'need')
  from v
$$;

create function pg_temp.save_as(p_user uuid, p_org uuid, p_over jsonb default '{}', p_aal text default 'aal2', p_req uuid default null)
returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    pg_temp.req_sql(p_org, p_req, p_over), p_aal)
$$;

create function pg_temp.req() returns uuid
language sql as $$ select current_setting('t.req')::uuid $$;

-- Rows of the three tables and the requirement audit rows, to compare before and after refused saves.
create function pg_temp.req_counts() returns text
language sql as $$
  select (select count(*) from public.workforce_requirements) || ',' || (select count(*) from public.requirement_occupations)
    || ',' || (select count(*) from public.requirement_countries) || ','
    || (select count(*) from audit.log where action like 'requirement.%')
$$;

-- A query run as the user (anonymous when null): its single value, or 'sqlstate|message|detail' when refused.
create function pg_temp.read_as(p_user uuid, p_sql text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text end, true);
  execute format('set local role %I', case when p_user is null then 'anon' else 'authenticated' end);
  begin
    execute p_sql into v_result;
  exception when others then
    v_result := sqlstate || '|' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- Schema --------------------------------------------------------------------------------------------------------------

select has_table('public', 'workforce_requirements', 'the requirement table exists');
select has_table('public', 'requirement_occupations', 'the occupations of a requirement are rows of their own');
select has_table('public', 'requirement_countries', 'the destination countries of a requirement are rows of their own');
select has_table('private', 'prohibited_terms', 'the prohibited terms are a private table');
select enum_has_labels('public', 'requirement_status', array['draft', 'open', 'paused', 'closed', 'filled'], 'requirement_status');
select enum_has_labels('public', 'requirement_visibility', array['private', 'job_order_marketplace'], 'requirement_visibility [d3.1]');
select enum_has_labels('public', 'partner_need', array['none', 'recruitment', 'staffing', 'both'], 'partner_need');
select is(
  (select count(*)::integer from pg_class c
   where c.oid in ('public.workforce_requirements'::regclass, 'public.requirement_occupations'::regclass,
                   'public.requirement_countries'::regclass, 'private.prohibited_terms'::regclass)
     and c.relrowsecurity and c.relforcerowsecurity),
  4, 'NFR-S8: row level security is enabled and forced on the four tables');
select is(
  (select coalesce(string_agg(table_name || '.' || column_name, ','), '') from information_schema.columns
   where table_schema = 'public' and table_name in ('workforce_requirements', 'requirement_occupations', 'requirement_countries')
     and column_name ~ '(gender|sex|age|date_of_birth|nationality|religion|marital_status|ethnicity|id_number|photo)'),
  '', 'AC6: no column is or contains gender, sex, age, date_of_birth, nationality, religion, marital_status, ethnicity, id_number or photo');
select is(
  (select string_agg(a.attname || '>' || f.relname, ',' order by a.attname)
   from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
   join pg_class f on f.oid = k.confrelid
   where k.conrelid = 'public.workforce_requirements'::regclass and k.contype = 'f'
     and a.attname in ('country_code', 'industry_code', 'salary_currency')),
  'country_code>countries,industry_code>industries,salary_currency>currencies',
  'NFR-M3: country, industry and currency are foreign keys to the code lists');

-- Release switch ------------------------------------------------------------------------------------------------------

select is(pg_temp.save_as(:'own1', current_setting('t.a')::uuid), 'P0001|CHARA_FORBIDDEN|release_off',
  'release 2b off: saving a requirement is refused');
update private.settings set value = 'true' where key = 'release_job_orders';

-- AC1 and AC3: the valid requirement ---------------------------------------------------------------------------------

select is(pg_temp.save_as(:'own1', current_setting('t.a')::uuid), 'ok', 'AC3: the owner at aal2 saves the requirement of AC1');
select set_config('t.r1', pg_temp.req()::text, true) as r1 \gset
select is(
  (select format('%s|%s|%s|%s|%s', status, organization_id = current_setting('t.a')::uuid, created_by, visibility is null, show_identity)
   from public.workforce_requirements where id = current_setting('t.r1')::uuid),
  format('draft|t|%s|t|f', :'own1'),
  'AC1: one draft of Acme created by the owner, without visibility and anonymous');
select is(
  (select string_agg(occupation_id || 'x' || quantity, ',' order by occupation_id) from public.requirement_occupations
   where requirement_id = current_setting('t.r1')::uuid),
  '7212x80,7214x20', 'AC1: two occupation rows, 7212 x 80 and 7214 x 20');
select is(
  (select string_agg(country_code, ',') from public.requirement_countries where requirement_id = current_setting('t.r1')::uuid),
  'DE', 'the destination country is a row of requirement_countries');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.created' and entity_id = current_setting('t.r1')
     and actor_id = :'own1' and metadata ->> 'organization_id' = current_setting('t.a') and metadata ->> 'partner_need' = 'both'),
  1, 'AC1: one audit row requirement.created with the organisation and the partner need');
select is(
  (select title from public.workforce_requirements where id = current_setting('t.r1')::uuid),
  '100 workers: Welders and flame cutters, Structural-metal preparers and erectors, Hamburg',
  'an empty title is written from the workers, the occupations by quantity and the place');
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s', workers_needed, country_code, city_region, industry_code, experience_years,
     duration_months, salary_min || '-' || salary_max || ' ' || salary_currency || '/' || salary_period,
     accommodation and work_permit_support and visa_support and recruitment_preference = 'international')
   from public.workforce_requirements where id = current_setting('t.r1')::uuid),
  '100|DE|Hamburg|C|2|12|2800.00-3400.00 EUR/month|t', 'AC1: every field of the form is stored');

-- AC3: refusals, none of which writes anything ------------------------------------------------------------------------

select set_config('t.counts', pg_temp.req_counts(), true) as counts \gset
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"workers": 0}'),
  '23514|%workforce_requirements_workers_needed_check%', 'AC3: 0 workers fails its check (23514)');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    '{"workers": 100001, "occupations": [{"occupation_id": "7212", "quantity": 100001}]}'),
  '23514|%workforce_requirements_workers_needed_check%', 'AC3: 100,001 workers fail their check (23514)');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    '{"occupations": [{"occupation_id": "7212", "quantity": 80}, {"occupation_id": "7214", "quantity": 10}]}'),
  'P0001|CHARA_INVALID_INPUT|occupation_quantities', 'AC3: quantities of 80 and 10 for 100 workers are refused');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"salary_min": 3500, "salary_max": 3000}'),
  '23514|%workforce_requirements_salary_order%', 'AC3: a minimum salary above the maximum fails (23514)');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"salary_max": null, "currency": null}'),
  '23514|%workforce_requirements_salary_terms%', 'AC3: a salary without currency fails (23514)');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    jsonb_build_object('start', ((now() at time zone 'utc')::date - 1)::text)),
  'P0001|CHARA_INVALID_INPUT|start_date', 'AC3: a start date of yesterday is refused');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    jsonb_build_object('start', ((now() at time zone 'utc')::date + interval '3 years' + interval '1 day')::date::text)),
  'P0001|CHARA_INVALID_INPUT|start_date', 'a start more than three years ahead is refused');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"employment": "gig"}'),
  '22P02|%employment_type%', 'AC3: employment type "gig" is not a value (22P02)');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"need": "maybe"}'),
  '22P02|%partner_need%', 'AC3: partner need "maybe" is not a value (22P02)');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    jsonb_build_object('occupations', (select jsonb_agg(jsonb_build_object('occupation_id', code, 'quantity', 10))
                                       from (select code from public.occupations order by code limit 11) o),
                       'workers', 110)),
  'P0001|CHARA_INVALID_INPUT|occupations', 'eleven occupations are refused');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    '{"occupations": [{"occupation_id": "7212", "quantity": 50}, {"occupation_id": "7212", "quantity": 50}]}'),
  'P0001|CHARA_INVALID_INPUT|occupations', 'the same occupation twice is refused');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"occupations": []}'),
  'P0001|CHARA_INVALID_INPUT|occupations', 'a requirement without occupations is refused');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    '{"occupations": [{"occupation_id": "7212", "quantity": 99.5}, {"occupation_id": "7214", "quantity": 0.5}]}'),
  'P0001|CHARA_INVALID_INPUT|occupations', 'a quantity that is not a whole number is refused');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"experience": 51}'),
  '23514|%experience_years_check%', 'experience of 51 years fails its check');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"duration": 121}'),
  '23514|%duration_months_check%', 'a duration of 121 months fails its check');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"duration": 0}'),
  '23514|%duration_months_check%', 'a duration of 0 months fails its check');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, jsonb_build_object('skills', repeat('a', 1001))),
  '23514|%skills_check%', 'skills of 1,001 characters fail their check');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, jsonb_build_object('city', repeat('a', 101))),
  '23514|%city_region_check%', 'a city or region of 101 characters fails its check');

-- AC4: the code lists
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    '{"occupations": [{"occupation_id": "9999", "quantity": 100}]}'),
  '23503|%requirement_occupations_occupation_id_fkey%', 'AC4: an occupation outside public.occupations (23503)');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"industry": "ZZ"}'),
  '23503|%workforce_requirements_industry_code_fkey%', 'AC4: an industry outside public.industries (23503)');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"country": "XX"}'),
  '23503|%workforce_requirements_country_code_fkey%', 'AC4: country XX (23503)');
select alike(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"currency": "ABC"}'),
  '23503|%workforce_requirements_salary_currency_fkey%', 'AC4: currency ABC (23503)');
select is(pg_temp.req_counts(), current_setting('t.counts'), 'AC3, AC4: none of the refused saves wrote a row or an audit entry');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    jsonb_build_object('start', ((now() at time zone 'utc')::date)::text, 'title', '  Welders for Hamburg  ')),
  'ok', 'AC4: 7212, C, DE and EUR succeed, and a start date of today is accepted');
select is((select title from public.workforce_requirements where id = pg_temp.req()), 'Welders for Hamburg',
  'a title given is kept, trimmed');

-- AC5: who may create -------------------------------------------------------------------------------------------------

select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{}', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'AC5: an admin at aal1 is refused (aal2_required)');
select is(pg_temp.save_as(:'mem', current_setting('t.a')::uuid), 'P0001|CHARA_FORBIDDEN|',
  'AC5: a member is refused');
select is(pg_temp.save_as(:'adm2', current_setting('t.a')::uuid), 'P0001|CHARA_FORBIDDEN|',
  'AC5: an admin of Beta is refused for Acme');
select is(pg_temp.save_as(:'dadm', current_setting('t.a')::uuid), 'P0001|CHARA_FORBIDDEN|',
  'AC5: the owner of recruitment company Delta is refused for Acme');
select is(pg_temp.save_as(:'dadm', :'delta'), 'P0001|CHARA_FORBIDDEN|employer_only',
  'a recruitment company posts no requirement of its own');
select is(pg_temp.save_as(:'wa', current_setting('t.a')::uuid), 'P0001|CHARA_FORBIDDEN|', 'AC5: a candidate is refused');
select alike(pg_temp.save_as(null, current_setting('t.a')::uuid), '42501|%', 'AC5: an anonymous caller has no execute grant (42501)');
select is(pg_temp.save_as(:'zown', :'zeta'), 'P0001|CHARA_FORBIDDEN|organization_suspended',
  'the owner of a suspended employer is refused');
select alike(pg_temp.call_as(:'adm', 'authenticated', format(
    $$insert into public.workforce_requirements (organization_id, title, workers_needed, country_code, city_region, industry_code,
      start_date, employment_type, recruitment_preference, partner_need, status, created_by)
      values (%L, 'Direct', 1, 'DE', 'Hamburg', 'C', current_date + 30, 'full_time', 'local', 'none', 'open', %L)$$,
    current_setting('t.a'), :'own2')), '42501|%', 'AC5: a direct insert with status open and another creator is refused (42501)');
select alike(pg_temp.call_as(:'adm', 'authenticated', format(
    $$update public.workforce_requirements set status = 'open' where id = %L$$, current_setting('t.r1'))),
  '42501|%', 'a direct update is refused (42501)');
select alike(pg_temp.call_as(:'own1', 'authenticated', format(
    $$delete from public.requirement_occupations where requirement_id = %L$$, current_setting('t.r1'))),
  '42501|%', 'a direct delete of an occupation row is refused (42501)');
select is(pg_temp.req_counts(), (select string_agg(x, ',') from (
    select (split_part(current_setting('t.counts'), ',', 1)::integer + 1)::text as x, 1 as o
    union all select (split_part(current_setting('t.counts'), ',', 2)::integer + 2)::text, 2
    union all select (split_part(current_setting('t.counts'), ',', 3)::integer + 1)::text, 3
    union all select (split_part(current_setting('t.counts'), ',', 4)::integer + 1)::text, 4 order by o) s),
  'AC5: the refused callers created no row');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid), 'ok', 'AC5: the admin at aal2 succeeds');

-- AC7: prohibited wording ---------------------------------------------------------------------------------------------

select set_config('t.counts', pg_temp.req_counts(), true) as counts \gset
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, jsonb_build_object('skills', s)),
  'P0001|CHARA_INVALID_INPUT|prohibited_criterion:skills', format('AC7: skills "%s" are refused', s))
from unnest(array['male only', 'MALE ONLY', 'Welders under 35 years', 'no women', 'Nationality: Indian preferred', 'Mâle only']) s;
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"title": "Welders, women only"}'),
  'P0001|CHARA_INVALID_INPUT|prohibited_criterion:title', 'the title is checked too');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"city": "Hamburg, married couples"}'),
  'P0001|CHARA_INVALID_INPUT|prohibited_criterion:city_region', 'the city or region is checked too');
select is(pg_temp.req_counts(), current_setting('t.counts'), 'AC7: the refused wording wrote nothing');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{"skills": "MIG/MAG welding, 2 years, English B1"}'),
  'ok', 'AC7: "MIG/MAG welding, 2 years, English B1" is accepted');
select alike(pg_temp.read_as(:'adm', 'select count(*) from private.prohibited_terms'), '42501|%',
  'no API role reads the prohibited terms');
select throws_ok($$insert into private.prohibited_terms (pattern, label) values ('(unclosed', 'broken')$$, '2201B', null,
  'a pattern that is not a valid regular expression is refused');

-- Editing -------------------------------------------------------------------------------------------------------------

select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    '{"workers": 120, "occupations": [{"occupation_id": "7214", "quantity": 20}, {"occupation_id": "7212", "quantity": 100}]}',
    'aal2', current_setting('t.r1')::uuid),
  'ok', 'an admin changes the workers and the quantities of a draft');
select is(
  (select metadata -> 'changed_fields' from audit.log where action = 'requirement.updated' and entity_id = current_setting('t.r1')),
  '["title", "workers_needed", "occupations"]'::jsonb,
  'one audit row requirement.updated names the changed fields, never their values');
select is(
  (select string_agg(occupation_id || 'x' || quantity, ',' order by occupation_id) from public.requirement_occupations
   where requirement_id = current_setting('t.r1')::uuid),
  '7212x100,7214x20', 'the occupation rows are replaced');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    '{"workers": 120, "occupations": [{"occupation_id": "7212", "quantity": 100}, {"occupation_id": "7214", "quantity": 20}]}',
    'aal2', current_setting('t.r1')::uuid),
  'ok', 'saving the same values again succeeds');
select is((select count(*)::integer from audit.log where action = 'requirement.updated' and entity_id = current_setting('t.r1')),
  1, 'a save without changes writes no audit row');
select is(pg_temp.save_as(:'own1', current_setting('t.a')::uuid,
    '{"country": "NL", "workers": 120, "occupations": [{"occupation_id": "7212", "quantity": 120}]}', 'aal2',
    current_setting('t.r1')::uuid),
  'ok', 'the owner moves the requirement to NL');
select is(
  (select string_agg(country_code, ',') from public.requirement_countries where requirement_id = current_setting('t.r1')::uuid),
  'NL', 'the destination row follows the country');
select is(pg_temp.save_as(:'adm2', current_setting('t.b')::uuid, '{}', 'aal2', current_setting('t.r1')::uuid),
  'P0002|CHARA_NOT_FOUND|', 'an admin of Beta cannot reach a requirement of Acme through Beta');
select is(pg_temp.save_as(:'mem', current_setting('t.a')::uuid, '{}', 'aal2', current_setting('t.r1')::uuid),
  'P0001|CHARA_FORBIDDEN|', 'a member cannot edit');
update public.workforce_requirements set start_date = (now() at time zone 'utc')::date - 10 where id = current_setting('t.r1')::uuid;
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    jsonb_build_object('start', ((now() at time zone 'utc')::date - 10)::text, 'country', 'NL', 'workers', 120,
      'occupations', '[{"occupation_id": "7212", "quantity": 120}]'::jsonb, 'duration', 6),
    'aal2', current_setting('t.r1')::uuid),
  'ok', 'a start date that has passed may stay when other fields change');
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid,
    jsonb_build_object('start', ((now() at time zone 'utc')::date - 5)::text), 'aal2', current_setting('t.r1')::uuid),
  'P0001|CHARA_INVALID_INPUT|start_date', 'but it cannot be moved to another past date');
update public.workforce_requirements set status = 'closed', visibility = 'private' where id = current_setting('t.r1')::uuid;
select is(pg_temp.save_as(:'adm', current_setting('t.a')::uuid, '{}', 'aal2', current_setting('t.r1')::uuid),
  'P0001|CHARA_INVALID_TRANSITION|closed', 'a closed requirement is final');
select throws_ok(
  format($$update public.workforce_requirements set status = 'draft', visibility = 'private' where id = %L$$, current_setting('t.r1')),
  '23514', null, 'a draft has no visibility');

-- AC11 and NFR-S8: who reads ------------------------------------------------------------------------------------------

select is(pg_temp.save_as(:'own2', current_setting('t.b')::uuid), 'ok', 'the owner of Beta saves a requirement');
select set_config('t.rb', pg_temp.req()::text, true) as rb \gset
-- One requirement of Acme open on the marketplace and one open and private, as V33 will leave them.
update public.workforce_requirements set status = 'open', visibility = 'job_order_marketplace'
where id = (select id from public.workforce_requirements where organization_id = current_setting('t.a')::uuid and status = 'draft'
            order by created_at, id limit 1);
update public.workforce_requirements set status = 'open', visibility = 'private'
where id = (select id from public.workforce_requirements where organization_id = current_setting('t.a')::uuid and status = 'draft'
            order by created_at, id limit 1);
select set_config('t.acme', (select count(*) from public.workforce_requirements where organization_id = current_setting('t.a')::uuid)::text, true) as acme \gset

select is(pg_temp.read_as(:'own1', 'select count(*) from public.workforce_requirements'), current_setting('t.acme'),
  'the owner of Acme reads every requirement of Acme');
select is(pg_temp.read_as(:'mem', format(
    'select count(*) from public.workforce_requirements where organization_id = %L', current_setting('t.a'))),
  current_setting('t.acme'), 'a member of Acme reads them too');
select is(pg_temp.read_as(:'mem', format(
    'select count(*) from public.requirement_occupations o join public.requirement_countries c using (requirement_id) where requirement_id = %L',
    current_setting('t.r1'))), '1', 'a member reads the occupations and countries of a requirement');
select is(pg_temp.read_as(:'own2', 'select string_agg(id::text, '','') from public.workforce_requirements'),
  current_setting('t.rb'), 'the owner of Beta reads only the requirement of Beta');
select is(pg_temp.read_as(:'own2', format(
    'select count(*) from public.requirement_occupations where requirement_id in (select id from public.workforce_requirements r where r.organization_id <> %L) or requirement_id not in (select id from public.workforce_requirements)',
    current_setting('t.b'))), '0', 'Beta reads no occupation row of Acme');
select is(
  pg_temp.read_as(u, 'select (select count(*) from public.workforce_requirements) + (select count(*) from public.requirement_occupations) + (select count(*) from public.requirement_countries)'),
  '0', format('AC11, NFR-S8: %s reads no requirement, occupation or country row', n))
from (values (:'dadm'::uuid, 'the recruitment partner Delta'), (:'gadm'::uuid, 'the staffing partner Gamma'),
             (:'wa'::uuid, 'the candidate wa'), (:'wb'::uuid, 'the candidate wb')) v (u, n);
select alike(pg_temp.read_as(null, format('select count(*) from public.%I', t)), '42501|%',
  format('AC11: an anonymous caller is refused on %s (42501)', t))
from unnest(array['workforce_requirements', 'requirement_occupations', 'requirement_countries']) t;
select alike(pg_temp.read_as(:'own1', 'select created_by from public.workforce_requirements limit 1'), '42501|%',
  'created_by is not readable through the Data API');
select set_config('t.apps', (select count(*) from public.job_applications)::text, true) as apps \gset
-- apply_to_job answers an id that is no open vacancy as it always did (Phase 1), whatever the id names.
select is(pg_temp.apply_as(:'wa', current_setting('t.r1')::uuid), 'P0001|CHARA_JOB_NOT_OPEN|',
  'AC11: apply_to_job with a requirement id is refused as for any id that is no open vacancy');
select is((select count(*) from public.job_applications)::text, current_setting('t.apps'), 'AC11: and creates no application');

-- Usage, quota and deployment check -----------------------------------------------------------------------------------

select is(private.limit_usage(current_setting('t.a')::uuid, 'active_requirements'), 2,
  'active_requirements counts the open requirements of the organisation (V13 counted 0 until V32)');
select is(private.limit_usage(current_setting('t.b')::uuid, 'active_requirements'), 0, 'a draft is not counted');
update private.settings set value = '0' where key = 'rate_limit_org_audited_write_max';
select is(pg_temp.save_as(:'own1', current_setting('t.a')::uuid), 'P0001|CHARA_RATE_LIMITED|',
  'a save counts against the daily quota of audited writes');
update private.settings set value = '2000' where key = 'rate_limit_org_audited_write_max';
select is((select count(*)::integer from private.missing_reference_data() where name = 'private.prohibited_terms'), 0,
  'the deployment check finds the prohibited terms');
delete from private.prohibited_terms;
select is((select count(*)::integer from private.missing_reference_data() where name = 'private.prohibited_terms'), 1,
  'and names them when the list is empty');

select * from finish();
rollback;
