begin;
select plan(75);

\ir apply_fixture.inc

-- Draft vacancies from a workforce requirement (V35, FR-M1 AC10 and the vacancy part of step Next steps; decision 3.1;
-- NFR-S8, NFR-S11, NFR-A4; DATA_MODEL.md sections 4 and 7): public.jobs.requirement_id, closed to every API role,
-- create_vacancies_from_requirement and requirement_vacancies. Acme (t.a: owner own1, admin adm, member mem) and Beta
-- (t.b: owner own2, admin adm2) are employers of the fixture; wa is a candidate. The recruitment company Delta and the
-- suspended employer Zeta are made below.

\set dadm '00000000-0000-0000-0000-0000000f3501'
\set delta '00000000-0000-0000-0000-0000000f3511'
\set zown '00000000-0000-0000-0000-0000000f3502'
\set zeta '00000000-0000-0000-0000-0000000f3512'

select pg_temp.new_user(:'dadm');
update public.profiles set account_kind = intended_account_kind where id = :'dadm';
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
values (:'delta', 'recruitment_company', 'delta-v35', 'Delta V35 Ltd', 'Delta V35', 'PH');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'delta', :'dadm', 'owner', now());
select pg_temp.new_user(:'zown');
update public.profiles set account_kind = intended_account_kind where id = :'zown';
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, status)
values (:'zeta', 'employer', 'zeta-v35', 'Zeta V35 GmbH', 'Zeta V35', 'DE', 'suspended');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'zeta', :'zown', 'owner', now());

create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'utc')::date $$;

-- The requirement of FR-M1 AC1 for p_org in p_status, written as the database owner as the lifecycle functions leave it:
-- 100 workers in Hamburg, DE, 7212 x 80 and 7214 x 20, published ten days ago when it is not a draft.
create function pg_temp.seed_req(p_org uuid, p_status text) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_published boolean := p_status <> 'draft';
begin
  insert into public.workforce_requirements (
    organization_id, title, workers_needed, country_code, city_region, industry_code, skills, experience_years,
    start_date, duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation,
    work_permit_support, visa_support, recruitment_preference, partner_need, status, visibility, published_at, closes_on,
    close_reason, updated_at
  ) values (
    p_org, 'Welders ' || p_status, 100, 'DE', 'Hamburg', 'C', 'MIG/MAG welding, blueprint reading', 2,
    date '2027-03-01', 12, 'full_time', 2800, 3400, 'EUR', 'month', true, true, true, 'international', 'both',
    p_status::public.requirement_status, case when v_published then 'private'::public.requirement_visibility end,
    case when v_published then now() - interval '10 days' end, case when v_published then pg_temp.today() + 80 end,
    case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason,
    now() - interval '1 day'
  ) returning id into v_id;
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 80), (v_id, '7214', 20);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

create function pg_temp.version(p_req uuid) returns timestamptz
language sql as $$ select updated_at from public.workforce_requirements where id = p_req $$;

-- create_vacancies_from_requirement as p_user for p_org (Acme unless given) with the current version of p_req: 'ok'
-- (the answer, as id:occupation pairs in order, lands in t.made) or 'sqlstate|message|detail'.
create function pg_temp.make(
  p_user uuid, p_req uuid, p_org uuid default null, p_aal text default 'aal2', p_role text default 'authenticated'
) returns text
language sql as $$
  select pg_temp.call_as(p_user, p_role, format(
    $f$select set_config('t.made', coalesce((select string_agg(v.occupation_id || '=' || v.title, ',' order by v.o)
       from (select r.*, row_number() over () as o from public.create_vacancies_from_requirement(%L, %L, %L::timestamptz) r) v), ''), true)$f$,
    coalesce(p_org, current_setting('t.a')::uuid), p_req, pg_temp.version(p_req)), p_aal)
$$;

-- requirement_vacancies as p_user (null for anonymous): the titles in order, or 'sqlstate|message|detail'.
create function pg_temp.listed(p_user uuid, p_req uuid, p_org uuid default null) returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text end, true);
  execute format('set local role %I', case when p_user is null then 'anon' else 'authenticated' end);
  begin
    execute format(
      $f$select coalesce(string_agg(v.status || ' ' || v.title, ',' order by v.o), '') from (select r.*, row_number() over () as o from public.requirement_vacancies(%L, %L) r) v$f$,
      coalesce(p_org, current_setting('t.a')::uuid), p_req) into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

create function pg_temp.linked(p_req uuid) returns integer
language sql as $$ select count(*)::integer from public.jobs where requirement_id = p_req $$;

create function pg_temp.created_audits(p_req uuid) returns integer
language sql as $$
  select count(*)::integer from audit.log a join public.jobs j on a.entity_id = j.id::text
  where a.action = 'job.created' and a.entity_type = 'job' and j.requirement_id = p_req
$$;

create function pg_temp.req_row(p_req uuid) returns jsonb
language sql as $$ select to_jsonb(r) from public.workforce_requirements r where r.id = p_req $$;

-- The schema and who may touch it -----------------------------------------------------------------------------------------

select has_column('public', 'jobs', 'requirement_id', 'jobs.requirement_id exists');
select fk_ok('public', 'jobs', 'requirement_id', 'public', 'workforce_requirements', 'id', 'jobs.requirement_id references the requirement');
select is(
  (select confdeltype from pg_constraint where conrelid = 'public.jobs'::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute where attrelid = 'public.jobs'::regclass and attname = 'requirement_id')]),
  'n'::"char", 'a requirement removed by retention leaves its vacancies, unlinked (on delete set null)');
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'jobs' and indexdef like '%(requirement_id, created_at DESC)%'),
  'jobs.requirement_id is indexed for the read and the set null');
select ok(
  not has_column_privilege('anon', 'public.jobs', 'requirement_id', 'select')
  and not has_column_privilege('authenticated', 'public.jobs', 'requirement_id', 'select')
  and not has_column_privilege('service_role', 'public.jobs', 'requirement_id', 'select'),
  'NFR-S11: no API role reads jobs.requirement_id');
select ok(
  not has_column_privilege('authenticated', 'public.jobs', 'requirement_id', 'insert')
  and not has_column_privilege('authenticated', 'public.jobs', 'requirement_id', 'update'),
  'no client writes jobs.requirement_id');
select ok(
  not has_function_privilege('anon', 'public.create_vacancies_from_requirement(uuid, uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.requirement_vacancies(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.create_vacancies_from_requirement(uuid, uuid, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.requirement_vacancies(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.requirement_vacancy_description(public.workforce_requirements, text, integer, text)', 'execute'),
  'the two functions are executable by authenticated only; the description helper by no API role');
select is(
  (select count(*)::integer from pg_proc
   where proname in ('create_vacancies_from_requirement', 'requirement_vacancies', 'requirement_vacancy_description')
     and proconfig = array['search_path=""']),
  3, 'the three functions set search_path to empty');
select is(
  (select array_agg(proname::text order by proname) from pg_proc
   where proname in ('create_vacancies_from_requirement', 'requirement_vacancies', 'requirement_vacancy_description') and prosecdef),
  array['create_vacancies_from_requirement', 'requirement_vacancies'], 'only the two RPCs run as definer');

-- The release switch ------------------------------------------------------------------------------------------------------

select pg_temp.seed_req(current_setting('t.a')::uuid, 'open') as open_req \gset
select is(pg_temp.make(:'own1', :'open_req'), 'P0001|CHARA_FORBIDDEN|release_off', 'release 2b off: creating is refused');
select is(pg_temp.listed(:'own1', :'open_req'), '42501|CHARA_FORBIDDEN|release_off', 'release 2b off: the list is refused');
select is(pg_temp.linked(:'open_req'), 0, 'release 2b off: nothing written');
update private.settings set value = 'true' where key = 'release_job_orders';

-- AC10: linked draft vacancies in one step ------------------------------------------------------------------------------

select pg_temp.req_row(:'open_req') as before_row \gset
select count(*)::integer as audits_before from audit.log \gset
select is(pg_temp.make(:'adm', :'open_req'), 'ok', 'AC10: an admin of Acme at aal2 creates the vacancies');
select is(current_setting('t.made'), '7212=Welders and flame cutters,7214=Structural-metal preparers and erectors',
  'AC10: one per occupation, titled by the occupation label, largest quantity first');
select is(pg_temp.linked(:'open_req'), 2, 'AC10: two jobs rows are linked to the requirement');
select is(
  (select count(*)::integer from public.jobs j join public.workforce_requirements r on r.id = j.requirement_id
   where j.requirement_id = :'open_req' and j.status = 'draft' and j.organization_id = r.organization_id
     and j.country_code = r.country_code and j.city = r.city_region and j.industry_code = r.industry_code
     and j.employment_type = r.employment_type and j.salary_min = r.salary_min and j.salary_max = r.salary_max
     and j.salary_currency = r.salary_currency and j.salary_period = r.salary_period and j.accommodation = r.accommodation
     and j.visa_support = r.visa_support and j.recruitment_preference = r.recruitment_preference
     and j.moderation_state = 'visible' and j.deleted_at is null and j.published_at is null and j.created_by = :'adm'),
  2, 'AC10: both are drafts with country, city, industry, employment type, salary, accommodation, visa support and recruitment preference copied, created by the admin');
select is(
  (select array_agg(occupation_id order by occupation_id) from public.jobs where requirement_id = :'open_req'),
  array['7212', '7214'], 'AC10: the occupations are 7212 and 7214');
select is(
  (select description from public.jobs where requirement_id = :'open_req' and occupation_id = '7212'),
  E'Welders and flame cutters: 80 workers needed in Hamburg, Germany, from 1 March 2027.\n\nProject duration: 12 months.\n\nExperience: 2 years.\n\nSkills: MIG/MAG welding, blueprint reading\n\nAccommodation is provided. Work permit support is provided. Visa support is provided.',
  'the description carries the facts jobs has no column for');
select is(pg_temp.created_audits(:'open_req'), 2, 'AC10: one audit row job.created per vacancy');
select is(
  (select count(*)::integer from audit.log a join public.jobs j on a.entity_id = j.id::text
   where a.action = 'job.created' and j.requirement_id = :'open_req' and a.actor_id = :'adm'
     and a.metadata ->> 'organization_id' = current_setting('t.a')),
  2, 'the audit rows name the admin and the organisation');
select is((select count(*)::integer from audit.log), :audits_before + 2, 'no other audit row is written (the requirement is not)');
select is(pg_temp.req_row(:'open_req'), :'before_row'::jsonb, 'AC10: the requirement is unchanged');
select is(
  (select count(*)::integer from public.jobs where requirement_id = :'open_req' and status <> 'draft'), 0,
  'AC10: no vacancy is opened');

select is(pg_temp.make(:'adm', :'open_req'), 'ok', 'AC10: a second call succeeds');
select is(pg_temp.linked(:'open_req'), 4, 'AC10: the second call creates two further drafts');
select is(pg_temp.created_audits(:'open_req'), 4, 'AC10: and two further job.created rows');
select is(pg_temp.make(:'own1', :'open_req'), 'ok', 'the owner at aal2 creates them too');
select is(pg_temp.linked(:'open_req'), 6, 'the owner''s call adds two drafts');

-- Who may create ----------------------------------------------------------------------------------------------------------

select is(pg_temp.make(:'adm', :'open_req', p_aal => 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'an admin of Acme at aal1 is refused');
select is(pg_temp.make(:'mem', :'open_req'), 'P0001|CHARA_FORBIDDEN|', 'a member of Acme is refused');
select is(pg_temp.make(:'adm2', :'open_req'), 'P0001|CHARA_FORBIDDEN|', 'an admin of Beta is refused for Acme');
select is(pg_temp.make(:'own2', :'open_req', current_setting('t.b')::uuid), 'P0002|CHARA_NOT_FOUND|',
  'the owner of Beta naming Beta finds no requirement of Acme');
select is(pg_temp.make(:'dadm', :'open_req'), 'P0001|CHARA_FORBIDDEN|', 'the owner of recruitment company Delta is refused for Acme');
select is(pg_temp.make(:'dadm', :'open_req', :'delta'), 'P0001|CHARA_FORBIDDEN|employer_only', 'a recruitment company has no requirement to copy');
select is(pg_temp.make(:'wa', :'open_req'), 'P0001|CHARA_FORBIDDEN|', 'a candidate is refused');
select is(pg_temp.make(null, :'open_req', p_role => 'anon'), '42501|permission denied for function create_vacancies_from_requirement|',
  'an anonymous caller has no execute grant');
select is(
  pg_temp.call_as(:'adm', 'authenticated', format(
    'select * from public.create_vacancies_from_requirement(%L, %L, %L::timestamptz)', current_setting('t.a'), :'open_req',
    pg_temp.version(:'open_req') - interval '1 second')),
  'P0001|CHARA_CONFLICT|stale', 'a page drawn before the last change is refused as stale');
select is(
  pg_temp.call_as(:'adm', 'authenticated', format(
    'select * from public.create_vacancies_from_requirement(%L, %L, null)', current_setting('t.a'), :'open_req')),
  'P0001|CHARA_CONFLICT|stale', 'no version counts as stale');
select pg_temp.seed_req(:'zeta', 'open') as zeta_req \gset
select is(pg_temp.make(:'zown', :'zeta_req', :'zeta'), 'P0001|CHARA_FORBIDDEN|organization_suspended', 'a suspended employer is refused');
select is(pg_temp.linked(:'open_req') + pg_temp.linked(:'zeta_req'), 6, 'none of the refused calls wrote a vacancy');
select is(
  pg_temp.call_as(:'adm', 'authenticated', format(
    'insert into public.jobs (organization_id, requirement_id, title, description, occupation_id, industry_code, country_code, city, employment_type, recruitment_preference) values (%L, %L, ''Welder linked'', %L, ''7212'', ''C'', ''DE'', ''Hamburg'', ''full_time'', ''both'')',
    current_setting('t.a'), :'open_req', repeat('Weld steel frames. ', 4))),
  '42501|permission denied for table jobs|', 'an admin cannot link a vacancy by a direct insert');
select is(
  pg_temp.call_as(:'adm', 'authenticated', format(
    'update public.jobs set requirement_id = null where requirement_id = %L', :'open_req')),
  '42501|permission denied for table jobs|', 'nor unlink one by an update');

-- Requirement states: only an open requirement is copied ---------------------------------------------------------------

select pg_temp.seed_req(current_setting('t.a')::uuid, 'draft') as draft_req \gset
select pg_temp.seed_req(current_setting('t.a')::uuid, 'paused') as paused_req \gset
select pg_temp.seed_req(current_setting('t.a')::uuid, 'closed') as closed_req \gset
select pg_temp.seed_req(current_setting('t.a')::uuid, 'filled') as filled_req \gset
select is(pg_temp.make(:'own1', :'draft_req'), 'P0001|CHARA_INVALID_STATE|draft', 'a draft requirement is refused (publish it first)');
select is(pg_temp.make(:'own1', :'paused_req'), 'P0001|CHARA_INVALID_STATE|paused', 'a paused requirement is refused');
select is(pg_temp.make(:'own1', :'closed_req'), 'P0001|CHARA_INVALID_STATE|closed', 'a closed requirement is refused');
select is(pg_temp.make(:'own1', :'filled_req'), 'P0001|CHARA_INVALID_STATE|filled', 'a filled requirement is refused');
select is(
  pg_temp.linked(:'draft_req') + pg_temp.linked(:'paused_req') + pg_temp.linked(:'closed_req') + pg_temp.linked(:'filled_req'), 0,
  'the refused states wrote nothing');

-- The quota of audited writes counts every vacancy, and a refusal leaves nothing behind -------------------------------------

update private.settings set value = '0' where key = 'rate_limit_audited_write_max';
select is(pg_temp.make(:'adm', :'open_req'), 'P0001|CHARA_RATE_LIMITED|', 'beyond the daily quota of audited writes the call is refused');
select is(pg_temp.linked(:'open_req'), 6, 'and writes no vacancy');
update private.settings set value = '500' where key = 'rate_limit_audited_write_max';

-- Plan limits: drafts count against nothing, each publish is judged by active_jobs (NFR-A4) -------------------------------

create function pg_temp.enforce(p_on boolean) returns void
language sql as $$ update private.settings set value = to_jsonb(p_on) where key = 'entitlements_enforced' $$;

insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (current_setting('t.b')::uuid, 'employer_starter', 'active', 'null');
select pg_temp.open_job('Open one', current_setting('t.b')::uuid);
select pg_temp.open_job('Open two', current_setting('t.b')::uuid);
select pg_temp.open_job('Open three', current_setting('t.b')::uuid);
select pg_temp.seed_req(current_setting('t.b')::uuid, 'open') as beta_req \gset
select pg_temp.enforce(true);
select is(pg_temp.make(:'own2', :'beta_req', current_setting('t.b')::uuid), 'ok',
  'entitlements enforced, Beta at 3 of 3 open vacancies on Basic: the drafts are still created');
select is(
  (select count(*)::integer from public.jobs where organization_id = current_setting('t.b')::uuid and status = 'open'), 3,
  'creating them opens nothing');
select is(
  pg_temp.set_status(:'own2', (select id from public.jobs where requirement_id = :'beta_req' and occupation_id = '7212'), 'open'),
  'P0001|CHARA_LIMIT_REACHED|active_jobs', 'publishing one at the limit is refused by the vacancy limit');
select pg_temp.enforce(false);
select is(pg_temp.make(:'own2', :'beta_req', current_setting('t.b')::uuid), 'ok', 'entitlements not enforced: the drafts are created');
select is(pg_temp.linked(:'beta_req'), 4, 'Beta has four linked drafts');
select is(
  pg_temp.set_status(:'own2', (select id from public.jobs where requirement_id = :'beta_req' and occupation_id = '7212' order by created_at limit 1), 'open'),
  'ok', 'and with the limit not enforced a fourth vacancy opens');

-- requirement_vacancies and tenant isolation (NFR-S8) ------------------------------------------------------------------------

select is(pg_temp.listed(:'mem', :'open_req'),
  'draft Structural-metal preparers and erectors,draft Structural-metal preparers and erectors,draft Structural-metal preparers and erectors,draft Welders and flame cutters,draft Welders and flame cutters,draft Welders and flame cutters',
  'a member of Acme reads the six linked drafts (one transaction here, so by title)');
select is(pg_temp.listed(:'adm', :'draft_req'), '', 'a requirement without vacancies lists none');
select is(pg_temp.listed(:'own2', :'open_req'), '42501|CHARA_FORBIDDEN|', 'the owner of Beta cannot read Acme''s list');
select is(pg_temp.listed(:'own2', :'open_req', current_setting('t.b')::uuid), '',
  'naming Beta with Acme''s requirement lists nothing');
select is(pg_temp.listed(:'dadm', :'open_req'), '42501|CHARA_FORBIDDEN|', 'a recruitment company cannot read it');
select is(pg_temp.listed(:'dadm', :'open_req', :'delta'), '42501|CHARA_FORBIDDEN|employer_only', 'nor through its own organisation');
select is(pg_temp.listed(:'wa', :'open_req'), '42501|CHARA_FORBIDDEN|', 'a candidate cannot read it');
select is(pg_temp.listed(null, :'open_req'), '42501|permission denied for function requirement_vacancies|', 'anon has no execute grant');
select is(
  pg_temp.call_as(:'mem', 'authenticated', 'select requirement_id from public.jobs limit 1'),
  '42501|permission denied for table jobs|', 'a member cannot select jobs.requirement_id');
select is(
  pg_temp.call_as(:'wa', 'authenticated', 'select requirement_id from public.jobs limit 1', 'aal1'),
  '42501|permission denied for table jobs|', 'a candidate cannot select jobs.requirement_id');
select is(
  pg_temp.call_as(null, 'anon', 'select requirement_id from public.jobs limit 1'),
  '42501|permission denied for table jobs|', 'anon cannot select jobs.requirement_id');
select is(
  pg_temp.call_as(:'wa', 'authenticated', format('select count(*) from public.jobs where requirement_id = %L', :'beta_req'), 'aal1'),
  '42501|permission denied for table jobs|', 'a candidate cannot filter public vacancies by requirement');
select ok(
  not exists (select 1 from information_schema.parameters where specific_schema = 'public'
    and specific_name like 'search_jobs%' and parameter_name = 'requirement_id'),
  'search_jobs answers no requirement id');
update public.jobs set deleted_at = now() where id = (select id from public.jobs where requirement_id = :'open_req' order by created_at, id limit 1);
select is(
  (select count(*)::integer from unnest(string_to_array(pg_temp.listed(:'adm', :'open_req'), ','))), 5,
  'a deleted vacancy is no longer listed');

-- Retention of the requirement (V58) leaves the vacancies ----------------------------------------------------------------

delete from public.workforce_requirements where id = :'beta_req';
select is(
  (select count(*)::integer from public.jobs where organization_id = current_setting('t.b')::uuid and title like '%Welders and flame cutters%'
     and requirement_id is null), 2,
  'removing a requirement keeps its vacancies, unlinked');

-- The description's variants ---------------------------------------------------------------------------------------------

select is(
  private.requirement_vacancy_description(
    jsonb_populate_record(null::public.workforce_requirements, jsonb_build_object(
      'city_region', 'Lyon', 'start_date', '2027-01-15', 'duration_months', null, 'experience_years', 0, 'skills', null,
      'accommodation', false, 'work_permit_support', false, 'visa_support', false)),
    'Cooks', 1, 'France'),
  E'Cooks: 1 worker needed in Lyon, France, from 15 January 2027.\n\nPermanent or open-ended position.\n\nNo experience required.',
  'one worker, open-ended, no experience, no skills and no support');
select is(
  private.requirement_vacancy_description(
    jsonb_populate_record(null::public.workforce_requirements, jsonb_build_object(
      'city_region', 'Lyon', 'start_date', '2027-01-15', 'duration_months', 1, 'experience_years', 1, 'skills', null,
      'accommodation', false, 'work_permit_support', true, 'visa_support', false)),
    'Cooks', 3, 'France'),
  E'Cooks: 3 workers needed in Lyon, France, from 15 January 2027.\n\nProject duration: 1 month.\n\nExperience: 1 year.\n\nWork permit support is provided.',
  'one month, one year and only work permit support');
select is(
  private.requirement_vacancy_description(
    jsonb_populate_record(null::public.workforce_requirements, jsonb_build_object(
      'city_region', 'Lyon', 'start_date', '2027-01-15', 'duration_months', 120, 'experience_years', null,
      'skills', repeat('x', 1000), 'accommodation', true, 'work_permit_support', true, 'visa_support', true)),
    repeat('L', 81), 100000, 'France') ~ '^L{81}: 100000 workers needed',
  true, 'the longest inputs still make a description');
select ok(
  length(private.requirement_vacancy_description(
    jsonb_populate_record(null::public.workforce_requirements, jsonb_build_object(
      'city_region', 'Lyon', 'start_date', '2027-01-15', 'duration_months', 120, 'experience_years', 50,
      'skills', repeat('x', 1000), 'accommodation', true, 'work_permit_support', true, 'visa_support', true)),
    repeat('L', 81), 100000, repeat('C', 100))) between 50 and 10000,
  'the longest description stays within the 50 to 10,000 characters of jobs');
select ok(
  length(private.requirement_vacancy_description(
    jsonb_populate_record(null::public.workforce_requirements, jsonb_build_object(
      'city_region', 'X', 'start_date', '2027-05-01', 'duration_months', null, 'experience_years', null, 'skills', null,
      'accommodation', false, 'work_permit_support', false, 'visa_support', false)),
    'Cooks', 1, 'Chad')) >= 50,
  'the shortest description has the 50 characters jobs asks for');

update private.settings set value = 'false' where key = 'release_job_orders';

select * from finish();
rollback;
