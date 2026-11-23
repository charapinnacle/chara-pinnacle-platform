begin;
select plan(4);

\ir organizations_fixture.inc

-- Only an employer has vacancies (V05, FR-J1, FR-C1): the trigger jobs_employer_only refuses a vacancy of a partner
-- organisation for every caller.

create function pg_temp.new_partner(p_id uuid, p_type text) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

create function pg_temp.job_insert(p_org uuid) returns text
language sql as $$
  select format(
    $f$insert into public.jobs (organization_id, title, description, occupation_id, industry_code, country_code, city,
      employment_type, accommodation, visa_support, recruitment_preference)
    values (%L, 'Welder MIG/MAG', 'Weld steel frames in our Hamburg workshop. Weld steel frames.', '7212', 'C', 'DE',
      'Hamburg', 'full_time', true, true, 'both')$f$, p_org)
$$;

\set rc1 '00000000-0000-0000-0000-0000000d0001'

update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(:'rc1', 'recruitment_company');

select pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.emp', (public.create_organization('employer', 'Boundary Employer GmbH', null, 'DE', 'F'))->>'organization_id', true)$$,
  'aal1') as setup_emp \gset
select pg_temp.call_as(:'rc1', 'authenticated',
  $$select set_config('t.rec', (public.create_organization('recruitment_company', 'Boundary Recruitment Ltd', null, 'PH', 'N',
    null, 'BOUND1234', 'other', p_description => 'We recruit welders and electricians from the Philippines for employers in Germany.'))->>'organization_id', true)$$, 'aal1') as setup_rec \gset

-- Vacancies --------------------------------------------------------------------------------------------------------
select is(
  pg_temp.call_as(:'rc1', 'authenticated', pg_temp.job_insert(current_setting('t.rec')::uuid), 'aal2'),
  'P0001|CHARA_FORBIDDEN|organization_not_employer',
  'the owner of a recruitment company cannot insert a vacancy'
);
select throws_ok(
  pg_temp.job_insert(current_setting('t.rec')::uuid),
  'P0001', 'CHARA_FORBIDDEN',
  'not even the table owner inserts a vacancy of a partner organisation'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', pg_temp.job_insert(current_setting('t.emp')::uuid), 'aal2'),
  'ok',
  'an employer still inserts a vacancy'
);
select ok(
  (select tgenabled = 'A' from pg_trigger where tgname = 'jobs_employer_only' and tgrelid = 'public.jobs'::regclass)
  and not has_function_privilege('authenticated', 'private.jobs_employer_only()', 'execute'),
  'the guard fires always, also during replication, and is not callable by API roles'
);

select * from finish();
rollback;
