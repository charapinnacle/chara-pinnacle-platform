begin;
select plan(40);

\ir search_fixture.inc

-- Required experience on vacancies and the Experience filter of Find Jobs (V62; FR-Q4 AC9 and AC10; NFR-S8). Acme (t.a:
-- owner own1, admin adm, member mem) and Beta (t.b: owner own2, admin adm2) are employers of the fixture; wa and wb are
-- candidates; two partners are made below.

\set pr1 '00000000-0000-0000-0000-0000000f6201'
\set pr2 '00000000-0000-0000-0000-0000000f6202'
\set p1 '00000000-0000-0000-0000-0000000f6211'
\set p2 '00000000-0000-0000-0000-0000000f6212'

select pg_temp.new_user(:'pr1');
select pg_temp.new_user(:'pr2');
update public.profiles set account_kind = intended_account_kind where id in (:'pr1', :'pr2');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country) values
  (:'p1', 'recruitment_company', 'v62-partner-one', 'Partner One Ltd', 'Partner One', 'PH'),
  (:'p2', 'staffing_company', 'v62-partner-two', 'Partner Two Ltd', 'Partner Two', 'PL');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (:'p1', :'pr1', 'owner', now()), (:'p2', :'pr2', 'owner', now());

create function pg_temp.sorted_titles(p_args text default '') returns text
language sql as $$
  select coalesce(string_agg(t, ',' order by t), '')
  from unnest(string_to_array(nullif(pg_temp.search_titles(p_args), ''), ',')) t
$$;

-- AC9: the column, its range and its grants ----------------------------------------------------------------------------

select is(pg_temp.insert_as(:'adm', '{"title": "Exp null", "required_experience_years": null}'), 'ok', 'AC9: an admin stores no required experience');
select is(pg_temp.insert_as(:'adm', '{"title": "Exp zero", "required_experience_years": 0}'), 'ok', 'AC9: an admin stores 0 years');
select is(pg_temp.insert_as(:'own1', '{"title": "Exp forty", "required_experience_years": 40}'), 'ok', 'AC9: the owner stores 40 years');
select is(
  split_part(pg_temp.insert_as(:'adm', '{"title": "Exp too many", "required_experience_years": 41}'), '|', 1), '23514',
  'AC9: 41 years fail the check'
);
select matches(
  pg_temp.insert_as(:'adm', '{"title": "Exp negative", "required_experience_years": -1}'),
  '^23514\|.*"jobs_required_experience_years_check"', 'AC9: -1 fails the named check'
);
select is(
  split_part(pg_temp.insert_as(:'adm', '{"title": "Exp fraction", "required_experience_years": "2.5"}'), '|', 1), '22P02',
  'AC9: 2.5 is not a smallint (22P02)'
);
select is(
  split_part(pg_temp.insert_as(:'mem', '{"title": "Exp by member", "required_experience_years": 3}'), '|', 1), '42501',
  'AC9: a member cannot create a vacancy with it'
);
select is(
  split_part(pg_temp.insert_as(:'adm2', '{"title": "Exp by Beta", "required_experience_years": 3}'), '|', 1), '42501',
  'AC9: an admin of another employer cannot create one for Acme'
);

select ok(has_column_privilege('authenticated', 'public.jobs', 'required_experience_years', 'insert'), 'AC9: the column is in the insert grant');
select ok(has_column_privilege('authenticated', 'public.jobs', 'required_experience_years', 'update'), 'AC9: and in the update grant');
select ok(not has_column_privilege('anon', 'public.jobs', 'required_experience_years', 'update'), 'AC9: anon has no update grant');
select ok(not has_column_privilege('anon', 'public.jobs', 'required_experience_years', 'insert'), 'AC9: nor an insert grant');

select pg_temp.seed_job('{"title": "Edited vacancy", "status": "open"}') as j_edit \gset
select count(*) as audit_base from audit.log where entity_id = :'j_edit' \gset

select is(
  pg_temp.affected_as(:'adm', 'authenticated', format('update public.jobs set required_experience_years = 3 where id = %L', :'j_edit')),
  1::bigint, 'AC9: an admin sets the required experience of an open vacancy'
);
select is(
  (select metadata -> 'changed_fields' from audit.log where action = 'job.updated' and entity_id = :'j_edit'),
  '["required_experience_years"]'::jsonb, 'AC9: audited as job.updated naming the column'
);
select is(
  (select count(*) from audit.log where entity_id = :'j_edit') - :'audit_base'::bigint, 1::bigint,
  'AC9: one audit row for the change'
);
select is(
  pg_temp.affected_as(:'mem', 'authenticated', format('update public.jobs set required_experience_years = 9 where id = %L', :'j_edit')),
  0::bigint, 'AC9: a member of Acme updates 0 rows'
);
select is(
  (select count(*) from unnest(array[:'own2', :'adm2']::uuid[]) u
   where pg_temp.affected_as(u, 'authenticated', format('update public.jobs set required_experience_years = 9 where id = %L', :'j_edit')) = 0),
  2::bigint, 'NFR-S8: the owner and the admin of another employer update 0 rows'
);
select is(
  (select count(*) from unnest(array[:'pr1', :'pr2']::uuid[]) u
   where pg_temp.affected_as(u, 'authenticated', format('update public.jobs set required_experience_years = 9 where id = %L', :'j_edit')) = 0),
  2::bigint, 'NFR-S8: the owners of two partners update 0 rows'
);
select is(
  (select count(*) from unnest(array[:'wa', :'wb']::uuid[]) u
   where pg_temp.affected_as(u, 'authenticated', format('update public.jobs set required_experience_years = 9 where id = %L', :'j_edit')) = 0),
  2::bigint, 'NFR-S8: two candidates update 0 rows'
);
select is(
  split_part(pg_temp.call_as(null, 'anon', format('update public.jobs set required_experience_years = 9 where id = %L', :'j_edit'), 'aal1'), '|', 1),
  '42501', 'NFR-S8: anonymous is refused for lack of grants'
);
select is((select required_experience_years from public.jobs where id = :'j_edit'), 3::smallint, 'the value is still the admin''s');

select is(
  pg_temp.call_as(null, 'anon',
    format($$select set_config('t.exp', (select required_experience_years::text from public.get_public_job(%L)), true)$$, :'j_edit'), 'aal1')
    || '|' || current_setting('t.exp'),
  'ok|3', 'a visitor reads the required experience on the public vacancy'
);

select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_form_invalid(%L, array['requiredExperience'])$$, current_setting('t.a')), 'aal1'),
  'ok', 'a refused form that names the new field counts towards the validation error rate'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_form_invalid(%L, array['experience'])$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|p_fields', 'a name the form does not have is still refused'
);

-- AC10: the Experience filter ------------------------------------------------------------------------------------------

delete from public.jobs;
select pg_temp.seed_job('{"title": "Needs 0", "status": "open", "required_experience_years": 0}');
select pg_temp.seed_job('{"title": "Needs 2", "status": "open", "required_experience_years": 2}');
select pg_temp.seed_job('{"title": "Needs 5", "status": "open", "required_experience_years": 5}');
select pg_temp.seed_job('{"title": "Needs 10", "status": "open", "required_experience_years": 10}');
select pg_temp.seed_job('{"title": "Needs nothing", "status": "open"}');
select pg_temp.seed_job('{"title": "Draft needs 0", "status": "draft", "required_experience_years": 0}');
select pg_temp.seed_job('{"title": "Hidden needs 0", "status": "open", "moderation_state": "hidden", "required_experience_years": 0}');

select is(pg_temp.sorted_titles('p_experience => 5'), 'Needs 0,Needs 2,Needs 5,Needs nothing',
  'AC10: experience 5 finds the vacancies needing 0, 2 and 5 years and the one with no requirement');
select is(pg_temp.sorted_titles('p_experience => 0'), 'Needs 0,Needs nothing', 'AC10: experience 0 finds 0 and no requirement');
select is(pg_temp.sorted_titles(), 'Needs 0,Needs 10,Needs 2,Needs 5,Needs nothing', 'AC10: without the filter all five are found');
select is(pg_temp.sorted_titles('p_experience => null'), pg_temp.sorted_titles(), 'AC10: null is no filter');
select is(pg_temp.sorted_titles('p_experience => 40'), pg_temp.sorted_titles(), 'AC10: 40 finds every public vacancy');
select is(pg_temp.search_ids('anon', null, 'p_experience => 41'), 'P0001|CHARA_INVALID_INPUT|p_experience', 'AC10: 41 is refused');
select is(pg_temp.search_ids('anon', null, 'p_experience => -1'), 'P0001|CHARA_INVALID_INPUT|p_experience', 'AC10: -1 is refused');
select is(
  pg_temp.search_ids('authenticated', :'adm', 'p_experience => 5'), pg_temp.search_ids('anon', null, 'p_experience => 5'),
  'a member of the employer gets the same results as a visitor'
);
select is(
  pg_temp.search_ids('authenticated', :'wa', 'p_experience => 5'), pg_temp.search_ids('anon', null, 'p_experience => 5'),
  'and so does a candidate'
);
select is(pg_temp.sorted_titles('p_experience => 5, p_q => ''needs'', p_country => ''DE'''), 'Needs 0,Needs 2,Needs 5,Needs nothing',
  'the filter combines with the others');

select pg_temp.page('p_experience => 5, p_limit => 3') as pg1 \gset
select is(jsonb_array_length(:'pg1'::jsonb -> 'ids'), 3, 'a page of three of the four matches');
select is(
  jsonb_array_length((pg_temp.page(format('p_experience => 5, p_limit => 3, p_cursor => %L', :'pg1'::jsonb ->> 'cursor'))) -> 'ids'),
  1, 'the cursor leads to the last match of the same filter'
);

select ok(
  exists (select 1 from pg_indexes where indexname = 'jobs_public_required_experience_idx'
          and indexdef like '%(required_experience_years, created_at DESC, id DESC)%'
          and indexdef like '%WHERE%status = ''open''%deleted_at IS NULL%moderation_state = ''visible''%'),
  'AC10: an index on required_experience_years covers the open public vacancies'
);
select is(
  (select p.proargnames[14] from pg_proc p where p.oid = 'public.search_jobs(text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean, public.recruitment_preference, text, integer, text, integer)'::regprocedure),
  'p_experience', 'p_experience follows p_employer'
);
select is(
  (select count(*) from pg_proc where proname = 'search_jobs' and pronamespace = 'public'::regnamespace), 1::bigint,
  'the old signature is dropped: one search_jobs'
);

select ok(
  has_column_privilege('authenticated', 'public.jobs', 'required_experience_years', 'SELECT')
    and has_column_privilege('anon', 'public.jobs', 'required_experience_years', 'SELECT'),
  'members and visitors read required_experience_years like the other vacancy columns, so the vacancy pages can load it'
);
select * from finish();
rollback;
