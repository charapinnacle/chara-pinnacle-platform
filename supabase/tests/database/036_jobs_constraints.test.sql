begin;
select plan(57);

\ir jobs_fixture.inc


-- FR-C1 AC4: the salary rules and the required columns, enforced by the database.
select alike(
  pg_temp.insert_as(:'adm', '{"salary_min": 3500, "salary_max": 3000, "salary_currency": "EUR", "salary_period": "month"}'),
  '23514|%jobs_salary_order%', 'a minimum above the maximum is refused'
);
select alike(
  pg_temp.insert_as(:'adm', '{"salary_min": 2800, "salary_currency": null, "salary_period": "month"}'),
  '23514|%jobs_salary_terms%', 'an amount without a currency is refused'
);
select alike(
  pg_temp.insert_as(:'adm', '{"salary_max": 3400, "salary_currency": "EUR", "salary_period": null}'),
  '23514|%jobs_salary_terms%', 'an amount without a pay period is refused'
);
select alike(
  pg_temp.insert_as(:'adm', '{"salary_min": -1, "salary_currency": "EUR", "salary_period": "month"}'),
  '23514|%salary_min_check%', 'a negative amount is refused'
);
select alike(
  pg_temp.insert_as(:'adm', '{"salary_max": 10000000, "salary_currency": "EUR", "salary_period": "month"}'),
  '23514|%salary_max_check%', 'an amount above 9,999,999.99 is refused'
);
select alike(
  pg_temp.insert_as(:'adm', '{"salary_max": 9999999.99, "salary_currency": "EUR", "salary_period": "month"}'),
  'ok', 'the largest amount is accepted'
);
select alike(
  pg_temp.insert_as(:'adm', '{"salary_min": 3000, "salary_currency": "EUR", "salary_period": "week"}'),
  '22P02|%', 'the pay period week is not a value of the enum'
);

select alike(
  pg_temp.insert_as(:'adm', jsonb_build_object(c, null)), '23502|%' || c || '%',
  'a null ' || c || ' is refused'
) from unnest(array[
  'title', 'description', 'occupation_id', 'industry_code', 'country_code', 'city', 'employment_type', 'accommodation',
  'visa_support', 'recruitment_preference'
]) as c;

select is(
  pg_temp.insert_as(:'adm', '{"salary_min": 3000, "salary_max": 3000, "salary_currency": "EUR", "salary_period": "month"}'),
  'ok', 'equal amounts with a currency and a period are accepted'
);
select is(
  pg_temp.insert_as(:'adm'), 'ok', 'a vacancy without a salary is accepted'
);
select is(
  (select count(*) from public.jobs where salary_min is null and salary_max is null and salary_currency is null),
  1::bigint, 'the vacancy without a salary has no currency and no period'
);
select is(
  (select count(*) from public.jobs), 3::bigint, 'only the accepted inserts left a row'
);

-- FR-C1 AC5: reference values come from the controlled lists.
select is(
  pg_temp.insert_as(:'adm', '{"occupation_id": "9999"}') like '23503|%jobs_occupation_id_fkey%', true,
  'an occupation outside the list is refused'
);
select is(
  pg_temp.insert_as(:'adm', '{"industry_code": "Z"}') like '23503|%jobs_industry_code_fkey%', true,
  'an industry outside the list is refused'
);
select is(
  pg_temp.insert_as(:'adm', '{"country_code": "XX"}') like '23503|%jobs_country_code_fkey%', true,
  'a country outside the list is refused'
);
select is(
  pg_temp.insert_as(:'adm', '{"salary_min": 1000, "salary_currency": "ABC", "salary_period": "month"}') like '23503|%jobs_salary_currency_fkey%',
  true, 'a currency outside the list is refused'
);
select alike(
  pg_temp.insert_as(:'adm', '{"employment_type": "gig"}'), '22P02|%', 'an employment type outside the enum is refused'
);
select alike(
  pg_temp.insert_as(:'adm', '{"recruitment_preference": "any"}'), '22P02|%', 'a recruitment preference outside the enum is refused'
);
select is((select count(*) from public.jobs), 3::bigint, 'the refused inserts created no row');
select is(
  pg_temp.insert_as(:'adm', '{"occupation_id": "7212", "industry_code": "C", "country_code": "DE", "salary_min": 1, "salary_currency": "EUR", "salary_period": "hour"}'),
  'ok', 'the same insert with valid reference values is accepted'
);

-- The text rules (FR-C1 data and validation): trimmed, bounded, no control characters.
select is(pg_temp.insert_as(:'adm', jsonb_build_object('title', repeat('t', 4))) like '23514|%', true, 'a title of 4 characters is refused');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('title', repeat('t', 5))), 'ok', 'a title of 5 characters is accepted');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('title', repeat('t', 120))), 'ok', 'a title of 120 characters is accepted');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('title', repeat('t', 121))) like '23514|%', true, 'a title of 121 characters is refused');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('title', '      ')) like '23514|%', true, 'a title of six spaces is refused');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('title', ' Welder ')) like '23514|%', true, 'a title with outer spaces is refused');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('title', E'Weld\x07er')) like '23514|%', true, 'a title with a control character is refused');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('description', repeat('d', 49))) like '23514|%', true, 'a description of 49 characters is refused');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('description', repeat('d', 50))), 'ok', 'a description of 50 characters is accepted');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('description', repeat('d', 10000))), 'ok', 'a description of 10,000 characters is accepted');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('description', repeat('d', 10001))) like '23514|%', true, 'a description of 10,001 characters is refused');
select is(
  pg_temp.insert_as(:'adm', jsonb_build_object('description', repeat('d', 30) || E'\r\n\tsecond line\n' || repeat('e', 30))),
  'ok', 'line breaks and tabs are allowed in a description'
);
select is(pg_temp.insert_as(:'adm', jsonb_build_object('description', repeat('d', 60) || E'\x1b')) like '23514|%', true, 'a description with a control character is refused');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('city', repeat('c', 100))), 'ok', 'a city of 100 characters is accepted');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('city', repeat('c', 101))) like '23514|%', true, 'a city of 101 characters is refused');
select is(pg_temp.insert_as(:'adm', jsonb_build_object('city', '')) like '23514|%', true, 'an empty city is refused');

-- Defaults of a created vacancy.
select is(
  (select count(*) from public.jobs where status = 'draft' and moderation_state = 'visible' and deleted_at is null
     and posted_on_behalf_of_organization_id is null and created_by = :'adm'),
  (select count(*) from public.jobs), 'every created vacancy is a visible draft created by the caller'
);
select is(
  (select accommodation::text || visa_support::text from public.jobs where title = 'Welder MIG/MAG' limit 1), 'truetrue',
  'the booleans are stored as sent'
);
delete from public.jobs;
select is(
  pg_temp.call_as(:'adm', 'authenticated',
    format($$insert into public.jobs (organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type, recruitment_preference)
      values (%L, 'Welder', %L, '7212', 'C', 'DE', 'Hamburg', 'part_time', 'local')$$, current_setting('t.a'), repeat('d', 60)), 'aal1'),
  'ok', 'a vacancy without the two booleans is accepted'
);
select is(
  (select accommodation::text || visa_support::text from public.jobs), 'falsefalse', 'accommodation and visa support default to false'
);

-- FR-C1 AC8: no attribute of a person in the data model.
select is_empty(
  $$select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs'
      and column_name ~* '(gender|sex|age|date_of_birth|nationality|religion|marital_status|ethnicity|id_number|photo)'$$,
  'no column of jobs names a gender, age, nationality, religion, marital status, ethnicity, ID number or photo'
);

-- The text search column and the indexes the screens and the policies rely on.
select is(
  (select search_vector @@ to_tsquery('simple', 'schweisser') from (
     select private.search_text('Schweisser gesucht', 'Cafe in Hamburg') as search_vector) s),
  true, 'the search text matches a word of the title'
);
select is(
  (select private.search_text('Fabrikarbeiter', 'Caf' || chr(233) || ' Bar') @@ to_tsquery('simple', 'cafe')), true,
  'the search text ignores accents'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'jobs' and indexname = 'jobs_organization_created_idx'
          and indexdef like '%(organization_id, created_at DESC, id DESC)%'),
  'the organisation list has a keyset index'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'jobs' and indexname = 'jobs_created_by_idx'
          and indexdef like '%(created_by)%WHERE%created_by IS NOT NULL%'),
  'the erasure of an account finds its vacancies through an index'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'jobs' and indexname = 'jobs_posted_on_behalf_idx'),
  'the hiring-on-behalf foreign key has an index'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.jobs'::regclass)
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'jobs') = 5
  and not has_table_privilege('service_role', 'public.jobs', 'select'),
  'jobs has RLS enabled and forced, five policies, and no access for service_role'
);
select is(
  (select count(*) from pg_trigger where tgrelid = 'public.jobs'::regclass and tgname = 'jobs_audit' and tgenabled = 'A'),
  1::bigint, 'the audit trigger fires always'
);

select * from finish();
rollback;
