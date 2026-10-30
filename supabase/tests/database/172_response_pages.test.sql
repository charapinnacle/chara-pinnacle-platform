begin;
select plan(10);

\ir jobs_fixture.inc

-- The reads of the response pages (V46, FR-O2 AC4, AC5; decision 3.3; NFR-S8): the documents limit of a response is a
-- public setting, and the members of an employer read the capacity tolerance of their own requirements, nobody else, and
-- nobody writes it but set_requirement_capacity_tolerance.

insert into public.workforce_requirements (
  id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
  recruitment_preference, partner_need, max_capacity_over_percent
) values (
  '00000000-0000-0000-0000-0000000f4601', current_setting('t.a')::uuid, 'Hamburg welders', 100, 'DE', 'Hamburg', 'C',
  (now() at time zone 'utc')::date + 30, 'full_time', 'international', 'both', 10
);

select is(
  (select value from public.get_public_settings() where key = 'response_documents_max'), '5',
  'the documents limit of a response is a public setting (5 by default)'
);
update private.settings set value = '3' where key = 'response_documents_max';
set local role anon;
select is(
  (select value from public.get_public_settings() where key = 'response_documents_max'), '3',
  'an anonymous visitor reads the value the administrator set, as plain text'
);
reset role;

select ok(
  has_column_privilege('authenticated', 'public.workforce_requirements', 'max_capacity_over_percent', 'select'),
  'a signed-in user may select the capacity tolerance'
);
select ok(
  not has_column_privilege('authenticated', 'public.workforce_requirements', 'max_capacity_over_percent', 'insert')
  and not has_column_privilege('authenticated', 'public.workforce_requirements', 'max_capacity_over_percent', 'update'),
  'and may neither insert nor update it'
);
select ok(
  not has_column_privilege('anon', 'public.workforce_requirements', 'max_capacity_over_percent', 'select'),
  'an anonymous visitor may not select it'
);

select is(
  pg_temp.val_as(:'own1', 'aal1',
    $$select max_capacity_over_percent::text from public.workforce_requirements where id = '00000000-0000-0000-0000-0000000f4601'$$),
  '10', 'the Acme owner reads the tolerance of its requirement'
);
select is(
  pg_temp.val_as(:'mem', 'aal1',
    $$select max_capacity_over_percent::text from public.workforce_requirements where id = '00000000-0000-0000-0000-0000000f4601'$$),
  '10', 'an Acme member reads it too'
);
select is(
  pg_temp.val_as(:'own2', 'aal2',
    $$select count(*)::text from public.workforce_requirements where id = '00000000-0000-0000-0000-0000000f4601'$$),
  '0', 'the Beta owner reads no row of the Acme requirement (NFR-S8)'
);
select is(
  pg_temp.val_as(:'wa', 'aal1',
    $$select count(*)::text from public.workforce_requirements where id = '00000000-0000-0000-0000-0000000f4601'$$),
  '0', 'a candidate reads no row'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    $$update public.workforce_requirements set max_capacity_over_percent = 50 where id = '00000000-0000-0000-0000-0000000f4601'$$),
  '42501|permission denied for table workforce_requirements|',
  'the owner cannot write the tolerance directly'
);

select * from finish();
rollback;
