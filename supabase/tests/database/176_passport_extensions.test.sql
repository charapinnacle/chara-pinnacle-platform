begin;
select plan(75);

\ir apply_fixture.inc

-- Passport extensions (V61; FR-Q4 AC1 to AC5 and AC7; NFR-S8, NFR-M3, NFR-O5): worker_training,
-- worker_employment_history, worker_preferred_industries, worker_preferred_employment_types, their list limits, the
-- completeness weights, passport_limits and the user's copy. Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b:
-- owner own2) are employers of the fixture; wa (Amina) and wb (Bruno) are candidates with passports; two partners are
-- made below. The concurrency of the list limits is tested in 177.

\set pr1 '00000000-0000-0000-0000-0000000f6101'
\set pr2 '00000000-0000-0000-0000-0000000f6102'
\set p1 '00000000-0000-0000-0000-0000000f6111'
\set p2 '00000000-0000-0000-0000-0000000f6112'

select pg_temp.new_user(:'pr1');
select pg_temp.new_user(:'pr2');
update public.profiles set account_kind = intended_account_kind where id in (:'pr1', :'pr2');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country) values
  (:'p1', 'recruitment_company', 'v61-partner-one', 'Partner One Ltd', 'Partner One', 'PH'),
  (:'p2', 'staffing_company', 'v61-partner-two', 'Partner Two Ltd', 'Partner Two', 'PL');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (:'p1', :'pr1', 'owner', now()), (:'p2', :'pr2', 'owner', now());
insert into public.platform_staff (user_id, role) values (:'slg', 'admin');

-- The SQLSTATE of a statement run by a candidate ('ok' when it succeeds), and the SQLSTATE, message and detail.
create function pg_temp.st(p_user uuid, p_sql text) returns text
language sql as $$ select split_part(pg_temp.call_as(p_user, 'authenticated', p_sql, 'aal1'), '|', 1) $$;
create function pg_temp.err(p_user uuid, p_sql text) returns text
language sql as $$ select pg_temp.call_as(p_user, 'authenticated', p_sql, 'aal1') $$;

select set_config('t.year', extract(year from now() at time zone 'utc')::text, true) as keep \gset
select set_config('t.next_month', to_char(date_trunc('month', now() at time zone 'utc') + interval '1 month', 'YYYY-MM-DD'), true) as keep \gset
select set_config('t.this_month', to_char(date_trunc('month', now() at time zone 'utc'), 'YYYY-MM-DD'), true) as keep \gset

-- AC1: training ---------------------------------------------------------------------------------------------------------

select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, provider, year_completed)
  values (%L, 'Welding MIG/MAG level 2', 'TÜV Nord', 2021)$$, :'wa')), 'ok', 'AC1: the worker adds a training entry');
select results_eq(
  format($$select course, provider, year_completed from public.worker_training where worker_user_id = %L$$, :'wa'),
  $$values ('Welding MIG/MAG level 2'::text, 'TÜV Nord'::text, 2021::smallint)$$,
  'AC1: it is stored as entered'
);
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, 'W', 2020)$$, :'wa')),
  '23514', 'AC1: a course of 1 character fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, 'We', 2020)$$, :'wa')),
  'ok', 'AC1: a course of 2 characters is stored');
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, repeat('c', 120), 2020)$$, :'wa')),
  'ok', 'AC1: a course of 120 characters is stored');
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, repeat('c', 121), 2020)$$, :'wa')),
  '23514', 'AC1: a course of 121 characters fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, ' Padded', 2020)$$, :'wa')),
  '23514', 'a course that is not trimmed fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, e'Line\nbreak', 2020)$$, :'wa')),
  '23514', 'a course with a control character fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, provider, year_completed) values (%L, 'Empty provider', '', 2020)$$, :'wa')),
  'ok', 'AC1: an empty provider is accepted');
select is((select provider from public.worker_training where worker_user_id = :'wa' and course = 'Empty provider'), null,
  'AC1: and stored as null');
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, provider, year_completed) values (%L, 'Long provider', repeat('p', 121), 2020)$$, :'wa')),
  '23514', 'AC1: a provider of 121 characters fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, 'Old course', 1959)$$, :'wa')),
  '23514', 'AC1: the year 1959 fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, 'Oldest course', 1960)$$, :'wa')),
  'ok', 'AC1: the year 1960 is stored');
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, 'This year', %s)$$, :'wa', current_setting('t.year'))),
  'ok', 'AC1: the current year is stored');
select is(pg_temp.st(:'wa', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, 'Next year', %s)$$, :'wa', current_setting('t.year')::int + 1)),
  '23514', 'AC1: next year fails');
select is(pg_temp.st(:'wa', format($$update public.worker_training set year_completed = %s where worker_user_id = %L and course = 'This year'$$, current_setting('t.year')::int + 1, :'wa')),
  '23514', 'an update to next year fails too');
select is(pg_temp.st(:'wa', format($$update public.worker_training set course = 'Course renamed', provider = '  ' where worker_user_id = %L and course = 'This year'$$, :'wa')),
  'ok', 'the worker edits an entry');
select is((select provider from public.worker_training where worker_user_id = :'wa' and course = 'Course renamed'), null,
  'and a blank provider is stored as null');

insert into public.worker_training (worker_user_id, course, year_completed)
select :'wa', 'Filler ' || n, 2015 from generate_series(1, 20 - (select count(*)::int from public.worker_training where worker_user_id = :'wa')) n;
select is((select count(*)::int from public.worker_training where worker_user_id = :'wa'), 20, 'setup: 20 training entries');
select is(pg_temp.err(:'wa', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, 'Twenty-first', 2020)$$, :'wa')),
  'P0001|CHARA_LIMIT_REACHED|worker_training', 'AC1: the 21st entry fails with CHARA_LIMIT_REACHED (worker_training_max 20)');

-- AC2: employment history -----------------------------------------------------------------------------------------------

select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, employer_name, country_code, from_month, to_month)
  values (%L, 'Pipe welder', null, 'DE', '2019-03-01', '2022-11-01')$$, :'wa')), 'ok', 'AC2: the worker adds an entry without an employer name');
select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, employer_name, country_code, from_month)
  values (%L, 'Welder', 'Acme Bau', 'DE', '2022-12-01')$$, :'wa')), 'ok', 'AC2: an entry without an end month (current) is stored');
select is((select to_month from public.worker_employment_history where worker_user_id = :'wa' and role = 'Welder'), null,
  'AC2: a null end month means current');
select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, country_code, from_month, to_month)
  values (%L, 'Fitter', 'DE', '2019-03-01', '2019-02-01')$$, :'wa')), '23514', 'AC2: an end before the start fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, country_code, from_month)
  values (%L, 'Fitter', 'DE', %L)$$, :'wa', current_setting('t.next_month'))), '23514', 'AC2: a start next month fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, country_code, from_month)
  values (%L, 'Starter', 'DE', %L)$$, :'wa', current_setting('t.this_month'))), 'ok', 'a start this month is stored');
select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, country_code, from_month)
  values (%L, '', 'DE', '2019-03-01')$$, :'wa')), '23514', 'AC2: an empty role fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, employer_name, country_code, from_month)
  values (%L, 'Fitter', repeat('e', 121), 'DE', '2019-03-01')$$, :'wa')), '23514', 'AC2: an employer name of 121 characters fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, country_code, from_month)
  values (%L, 'Fitter', 'XX', '2019-03-01')$$, :'wa')), '23503', 'AC2: an unknown country fails with a foreign key violation');
select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, country_code, from_month)
  values (%L, 'Fitter', 'DE', '2019-03-15')$$, :'wa')), '23514', 'AC2: a start that is not the first day of a month fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, country_code, from_month, to_month)
  values (%L, 'Fitter', 'DE', '2019-03-01', '2019-05-20')$$, :'wa')), '23514', 'an end that is not the first day of a month fails');
select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, employer_name, country_code, from_month)
  values (%L, 'Blank employer', '', 'PL', '2018-01-01')$$, :'wa')), 'ok', 'an empty employer name is accepted');
select is((select employer_name from public.worker_employment_history where worker_user_id = :'wa' and role = 'Blank employer'), null,
  'and stored as null');
select is(pg_temp.st(:'wa', format($$update public.worker_employment_history set role = 'Senior pipe welder' where worker_user_id = %L and role = 'Pipe welder'$$, :'wa')),
  'ok', 'the worker edits the role of an entry');

insert into public.worker_employment_history (worker_user_id, role, country_code, from_month)
select :'wa', 'Filler ' || n, 'DE', '2010-01-01' from generate_series(1, 20 - (select count(*)::int from public.worker_employment_history where worker_user_id = :'wa')) n;
select is(pg_temp.err(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, country_code, from_month)
  values (%L, 'Twenty-first', 'DE', '2019-03-01')$$, :'wa')), 'P0001|CHARA_LIMIT_REACHED|worker_employment_history',
  'AC2: the 21st entry fails with CHARA_LIMIT_REACHED (worker_employment_history_max 20)');

-- AC3: preferred industries and employment types (NFR-M3: both come from a list) -------------------------------------

select is(pg_temp.st(:'wa', format($$insert into public.worker_preferred_industries (worker_user_id, industry_code) values (%L, 'C')$$, :'wa')),
  'ok', 'AC3: section C is stored');
select is(pg_temp.st(:'wa', format($$insert into public.worker_preferred_industries (worker_user_id, industry_code) values (%L, 'C')$$, :'wa')),
  '23505', 'AC3: section C again fails with a unique violation');
select is(pg_temp.st(:'wa', format($$insert into public.worker_preferred_industries (worker_user_id, industry_code) values (%L, 'F')$$, :'wa')),
  'ok', 'AC3: section F is stored');
select is(pg_temp.st(:'wa', format($$insert into public.worker_preferred_industries (worker_user_id, industry_code) values (%L, 'Z9')$$, :'wa')),
  '23503', 'AC3: a code that is not in public.industries fails with a foreign key violation');
insert into public.worker_preferred_industries (worker_user_id, industry_code)
select :'wa', code from public.industries where code not in ('C', 'F') order by code limit 8;
select is(pg_temp.err(:'wa', format($$insert into public.worker_preferred_industries (worker_user_id, industry_code)
  select %L, code from public.industries where code not in (select industry_code from public.worker_preferred_industries where worker_user_id = %L) limit 1$$, :'wa', :'wa')),
  'P0001|CHARA_LIMIT_REACHED|worker_preferred_industries', 'AC3: the 11th section fails with CHARA_LIMIT_REACHED (worker_preferred_industries_max 10)');

select is(pg_temp.st(:'wa', format($$insert into public.worker_preferred_employment_types (worker_user_id, employment_type) values (%L, 'full_time'), (%1$L, 'seasonal')$$, :'wa')),
  'ok', 'the worker adds preferred employment types');
select is(pg_temp.st(:'wa', format($$insert into public.worker_preferred_employment_types (worker_user_id, employment_type) values (%L, 'full_time')$$, :'wa')),
  '23505', 'the same type again fails with a unique violation');
select is(pg_temp.st(:'wa', format($$insert into public.worker_preferred_employment_types (worker_user_id, employment_type) values (%L, 'hourly')$$, :'wa')),
  '22P02', 'a type outside the list of public.employment_type fails');
select is(
  (select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'public.worker_preferred_employment_types'::regclass and attname = 'employment_type'),
  'employment_type', 'NFR-M3: the employment type is the list vacancies and requirements use');

-- AC4: the new sections are private to the worker (NFR-S8) ---------------------------------------------------------------

insert into public.worker_training (worker_user_id, course, year_completed) values (:'wb', 'Bruno course', 2020);
-- The limit trigger runs before the row policy, so A's lists are taken below their limits for the refused inserts below.
delete from public.worker_training where worker_user_id = :'wa' and course like 'Filler %';
select is(pg_temp.apply_as(:'wa', pg_temp.open_job('V61 vacancy')), 'ok', 'setup: Amina applied to Acme');

create function pg_temp.reach(p_user uuid, p_role text default 'authenticated') returns text
language plpgsql as $$
declare
  v_out text := '';
  v_table text;
  v_set text;
  v_count text;
begin
  for v_table, v_set in
    select * from (values
      ('worker_training', 'course = ''Changed'''),
      ('worker_employment_history', 'role = ''Changed'''),
      ('worker_preferred_industries', 'industry_code = ''A'''),
      ('worker_preferred_employment_types', 'employment_type = ''contract''')
    ) t(a, b)
  loop
    foreach v_count in array array[
      format('select 1 from public.%I where worker_user_id = %L', v_table, current_setting('t.wa')),
      format('update public.%I set %s where worker_user_id = %L', v_table, v_set, current_setting('t.wa')),
      format('delete from public.%I where worker_user_id = %L', v_table, current_setting('t.wa'))
    ] loop
      begin
        v_out := v_out || pg_temp.affected_as(p_user, p_role, v_count, 'aal2')::text;
      exception when others then
        reset role;
        v_out := v_out || 'E' || sqlstate;
      end;
      v_out := v_out || ',';
    end loop;
  end loop;
  return v_out;
end;
$$;
select set_config('t.wa', :'wa', true) as keep \gset

select is(pg_temp.reach(:'wb'), repeat('0,', 12), 'AC4: candidate B reads, updates and deletes none of A''s rows in the four tables');
select is(pg_temp.reach(:'own1'), repeat('0,', 12), 'AC4: the owner of Acme, which holds an application from A, reaches none');
select is(pg_temp.reach(:'adm'), repeat('0,', 12), 'NFR-S8: an admin of Acme reaches none');
select is(pg_temp.reach(:'own2'), repeat('0,', 12), 'NFR-S8: the owner of the second employer reaches none');
select is(pg_temp.reach(:'pr1'), repeat('0,', 12), 'NFR-S8: the owner of a recruitment partner reaches none');
select is(pg_temp.reach(:'pr2'), repeat('0,', 12), 'NFR-S8: the owner of a staffing partner reaches none');
select is(pg_temp.reach(:'slg'), repeat('0,', 12), 'FR-Q4: a Platform Administrator reaches none');
select is(pg_temp.reach(null, 'anon'), repeat('E42501,', 12), 'AC4: the anonymous caller is refused for lack of grants');
select is((select count(*)::int from public.worker_training where worker_user_id = :'wa'), 6, 'and A''s rows are all still there');
select is(
  pg_temp.val_as(:'wb', 'aal1', format($$select count(*) from public.worker_training where worker_user_id in (%L, %L)$$, :'wa', :'wb')),
  '1', 'NFR-S8: candidate B reads only the own entry'
);
select is(pg_temp.st(:'wb', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, 'Planted', 2020)$$, :'wa')),
  '42501', 'AC4: B''s insert with A''s id is refused by row level security');
select is(pg_temp.st(:'wb', format($$insert into public.worker_preferred_employment_types (worker_user_id, employment_type) values (%L, 'contract')$$, :'wa')),
  '42501', 'AC4: also into the preferred employment types');
select is(pg_temp.st(:'wb', format($$update public.worker_training set worker_user_id = %L where worker_user_id = %L$$, :'wa', :'wb')),
  '42501', 'a row never moves to another candidate: worker_user_id has no update grant');
select is(pg_temp.st(:'own1', format($$insert into public.worker_training (worker_user_id, course, year_completed) values (%L, 'Planted', 2020)$$, :'own1')),
  '23503', 'a company user has no passport to attach an entry to');

select is_empty(
  $$select c.oid::regclass::text from pg_class c
    where c.oid in ('public.worker_training'::regclass, 'public.worker_employment_history'::regclass,
                    'public.worker_preferred_industries'::regclass, 'public.worker_preferred_employment_types'::regclass)
      and not (c.relrowsecurity and c.relforcerowsecurity)$$,
  'NFR-S8: row level security is enabled and forced on the four tables'
);
select is_empty(
  $$select c.relname || '.' || a.attname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'worker_user_id'
    where c.relname in ('worker_training', 'worker_employment_history', 'worker_preferred_industries', 'worker_preferred_employment_types')
      and c.relnamespace = 'public'::regnamespace
      and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)$$,
  'every policy column leads an index'
);

-- AC5: no sensitive characteristics ---------------------------------------------------------------------------------------

select is_empty(
  $$select table_name || '.' || column_name from information_schema.columns
    where table_schema = 'public'
      and table_name in ('worker_training', 'worker_employment_history', 'worker_preferred_industries',
                         'worker_preferred_employment_types', 'worker_profiles', 'jobs')
      and column_name ~ '(date_of_birth|birth|age|nationality|citizenship|gender|sex|religion|ethnicity|marital_status|health|photo|id_number)'$$,
  'AC5: no column of the passport tables or of jobs names a sensitive characteristic'
);

-- Settings (NFR-O5) and the limits the forms read --------------------------------------------------------------------------

select results_eq(
  $$select r.key, s.value::text, r.min, r.max, r.editable from private.setting_rules r join private.settings s on s.key = r.key
    where r.key in ('worker_training_max', 'worker_employment_history_max', 'worker_preferred_industries_max') order by r.key$$,
  $$values ('worker_employment_history_max', '20', 1, 100, true), ('worker_preferred_industries_max', '10', 1, 21, true),
           ('worker_training_max', '20', 1, 100, true)$$,
  'NFR-O5: the three list limits are settings an administrator changes in the audited settings editor'
);
update private.settings set value = '21' where key = 'worker_employment_history_max';
select is(pg_temp.st(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, country_code, from_month) values (%L, 'Twenty-first', 'DE', '2019-03-01')$$, :'wa')),
  'ok', 'a raised limit takes effect at once');
select is(
  pg_temp.val_as(:'wa', 'aal1', $$select row(l.*)::text from public.passport_limits() l$$),
  '(30,24,50,20,21,10)', 'passport_limits gives the forms the three new limits beside the Phase 1 values'
);
select is(split_part(pg_temp.call_as(null, 'anon', $$select * from public.passport_limits()$$), '|', 1), '42501',
  'passport_limits is not open to anonymous callers');

-- AC7: completeness weights ------------------------------------------------------------------------------------------------
-- The Phase 1 weights stay while release_find_workers is off, so no score changes with V61; FR-Q4 AC7 once it is on.

update private.settings set value = 'false' where key = 'release_find_workers';
update public.worker_profiles set headline = 'Plumber', years_experience = 4, availability = 'now' where user_id = :'wb';
insert into public.worker_skills (worker_user_id, skill) values (:'wb', 'Pipes'), (:'wb', 'Valves'), (:'wb', 'Pumps');
insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (:'wb', 'en', 'B2');
insert into public.worker_work_authorizations (worker_user_id, country_code) values (:'wb', 'DE');
select pg_temp.doc(:'d1', :'wb');
delete from public.worker_training where worker_user_id = :'wb';
delete from public.worker_employment_history where worker_user_id = :'wb';
select is(private.passport_completeness(:'wb'), 100, 'AC7, switch off: a passport complete under the Phase 1 rules keeps 100');
insert into public.worker_training (worker_user_id, course, year_completed) values (:'wb', 'Pipe fitting', 2019);
insert into public.worker_employment_history (worker_user_id, role, country_code, from_month) values (:'wb', 'Plumber', 'PH', '2015-01-01');
update public.worker_profiles set years_experience = null where user_id = :'wb';
delete from public.worker_skills where worker_user_id = :'wb' and skill = 'Pumps';
select is(private.passport_completeness(:'wb'), 75,
  'AC7, switch off: training and employment history add nothing, skills weigh 15 and years of experience 10 as in Phase 1');
update public.worker_profiles set years_experience = 4 where user_id = :'wb';
insert into public.worker_skills (worker_user_id, skill) values (:'wb', 'Pumps');
delete from public.worker_training where worker_user_id = :'wb';
delete from public.worker_employment_history where worker_user_id = :'wb';

update private.settings set value = 'true' where key = 'release_find_workers';
select is(private.passport_completeness(:'wb'), 90, 'AC7, switch on: a passport complete under the Phase 1 rules scores 90');
insert into public.worker_training (worker_user_id, course, year_completed) values (:'wb', 'Pipe fitting', 2019);
select is(private.passport_completeness(:'wb'), 95, 'AC7, switch on: a training entry adds 5');
insert into public.worker_employment_history (worker_user_id, role, country_code, from_month) values (:'wb', 'Plumber', 'PH', '2015-01-01');
select is(private.passport_completeness(:'wb'), 100, 'AC7, switch on: an employment history entry adds 5: 100');
insert into public.worker_preferred_industries (worker_user_id, industry_code) values (:'wb', 'F');
insert into public.worker_preferred_employment_types (worker_user_id, employment_type) values (:'wb', 'contract');
select is(private.passport_completeness(:'wb'), 100, 'AC7, switch on: preferred industries and employment types carry no weight');
update public.worker_profiles set years_experience = null where user_id = :'wb';
delete from public.worker_skills where worker_user_id = :'wb' and skill = 'Pumps';
select is(private.passport_completeness(:'wb'), 85, 'AC7, switch on: skills weigh 10 and years of experience 5');
update private.settings set value = 'false' where key = 'release_find_workers';
select is(private.passport_completeness(:'wb'), 75, 'AC7: switched off again, the Phase 1 weights apply again');

-- The user's copy (FR-S3, V29) holds the new lists ---------------------------------------------------------------------

insert into public.data_export_requests (id, user_id) values (:'dx', :'wb');
select is(
  (public.account_ops_export_data(:'dx') #> '{sections,passport}') - array['first_name', 'last_name', 'headline', 'current_country',
    'occupation', 'years_experience', 'availability', 'available_from', 'searchable', 'created_at', 'skills', 'languages',
    'preferred_countries', 'work_authorizations'],
  jsonb_build_object(
    'training', jsonb_build_array(jsonb_build_object('course', 'Pipe fitting', 'provider', null, 'year_completed', 2019)),
    'employment_history', jsonb_build_array(jsonb_build_object('role', 'Plumber', 'employer_name', null, 'country', 'PH',
      'from_month', '2015-01', 'to_month', null)),
    'preferred_industries', jsonb_build_array((select name from public.industries where code = 'F')),
    'preferred_employment_types', jsonb_build_array('contract')
  ),
  'FR-S3: the passport section of the user''s copy holds the training, the employment history and the preferences'
);

select * from finish();
rollback;
