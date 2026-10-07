begin;
select plan(27);

\ir status_fixture.inc

-- FR-D5 AC7: the RPCs answer an application of another organisation as they answer an unknown id, and change nothing.
create temp table t_other as select pg_temp.org_on() as org;
select pg_temp.seed_app('applied') as x \gset
select pg_temp.seed_app('applied', (select org from t_other)) as y \gset
select gen_random_uuid() as ghost \gset
select pg_temp.member_of((select org from t_other)) as other_member \gset
select pg_temp.status_counts() as before \gset

select is(pg_temp.set_as(:'other_member', :'x', 'interview'), 'P0002|CHARA_NOT_FOUND|', 'AC7: set_application_status refuses an application of another organisation');
select is(pg_temp.set_as(:'other_member', :'ghost', 'interview'), 'P0002|CHARA_NOT_FOUND|', 'AC7: with the very answer it gives for an unknown id');
select is(pg_temp.viewed_as(:'other_member', :'x'), 'P0002|CHARA_NOT_FOUND|', 'AC7: mark_application_viewed refuses it');
select is(pg_temp.viewed_as(:'other_member', :'ghost'), 'P0002|CHARA_NOT_FOUND|', 'AC7: and the unknown id the same way');
select is(
  pg_temp.call_as(:'other_member', 'authenticated', format('select public.withdraw_application(%L)', :'x'), 'aal1'), 'P0002|CHARA_NOT_FOUND|',
  'AC7: withdraw_application refuses it'
);
select is(
  pg_temp.call_as(:'other_member', 'authenticated', format('select public.withdraw_application(%L)', :'ghost'), 'aal1'), 'P0002|CHARA_NOT_FOUND|',
  'AC7: and the unknown id the same way'
);
select is(
  pg_temp.call_as(:'wb', 'authenticated', format('select public.withdraw_application(%L)', :'x'), 'aal1'), 'P0002|CHARA_NOT_FOUND|',
  'AC7: another candidate cannot withdraw it'
);
select is(pg_temp.status_counts(), :'before', 'AC7: nothing was written by the refused calls');
select is(
  pg_temp.bulk_as(:'other_member', array[:'x'::uuid, :'ghost'::uuid], 'interview'),
  (select jsonb_agg(jsonb_build_object('ok', false, 'application_id', i, 'error_code', 'CHARA_NOT_FOUND') order by i)
   from unnest(array[:'x'::uuid, :'ghost'::uuid]) i),
  'AC7: bulk_set_application_status reports both as CHARA_NOT_FOUND'
);
select is(pg_temp.status_of(:'x') || pg_temp.event_count(:'x'), 'applied1', 'AC7: and the bulk call left the application and its events as they were');
select is(
  pg_temp.json_as(:'other_member', format('select * from public.get_applicant(%L)', :'x')), '[]'::jsonb,
  'AC7: get_applicant returns no row for it'
);
select is(
  pg_temp.json_as(:'other_member', format('select * from public.list_applicant_events(%L)', :'x')), '[]'::jsonb,
  'AC7: nor does list_applicant_events'
);
select is(
  pg_temp.json_as(:'other_member', format('select id from public.get_applicant(%L)', :'y')), jsonb_build_array(jsonb_build_object('id', :'y')),
  'AC7: both still answer for an application of the own organisation'
);

-- AC12: the three tables are covered by policies and the columns they use are indexed.
select is(
  (select count(*) from pg_class c where c.oid in ('public.job_applications'::regclass, 'public.application_events'::regclass, 'public.application_notes'::regclass)
     and c.relrowsecurity and c.relforcerowsecurity),
  3::bigint, 'AC12: row-level security is enabled and forced on all three tables'
);
select is(
  (select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname) from pg_policies
   where schemaname = 'public' and tablename in ('job_applications', 'application_events', 'application_notes')),
  'application_events.application_events_select_member, application_events.application_events_select_worker, '
    'application_notes.application_notes_insert_member, application_notes.application_notes_select_member, '
    'job_applications.job_applications_select_member, job_applications.job_applications_select_worker',
  'AC12: the policies are named <table>_<command>_<audience>, and each table has one'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('job_applications', 'application_events', 'application_notes')
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'auth\.uid\(\)' and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'SELECT auth\.uid\(\)'),
  0::bigint, 'AC12: every policy calls auth.uid() inside a sub-select, so once per query'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('job_applications', 'application_events', 'application_notes')
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'member_org_ids' and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'SELECT private\.(active_)?member_org_ids'),
  0::bigint, 'AC12: and every policy calls member_org_ids inside a sub-select'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('job_applications', 'application_events', 'application_notes')
     and policyname like '%select_member' and qual ~ 'ARRAY\(\s*SELECT private\.active_member_org_ids'),
  3::bigint, 'AC12: the three member read policies take the organisations as an array, so that a read without a filter uses an index'
);
create function pg_temp.leading_index(p_table regclass, p_column text) returns boolean
language sql as $$
  select exists (
    select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = p_table and a.attname = p_column and i.indisvalid
  )
$$;
select ok(pg_temp.leading_index('public.job_applications', 'worker_user_id'), 'AC12: job_applications.worker_user_id is indexed');
select ok(pg_temp.leading_index('public.job_applications', 'organization_id'), 'AC12: job_applications.organization_id is indexed');
select ok(pg_temp.leading_index('public.job_applications', 'job_id'), 'AC12: job_applications.job_id is indexed');
select ok(pg_temp.leading_index('public.jobs', 'organization_id'), 'AC12: jobs.organization_id is indexed');
select ok(pg_temp.leading_index('public.application_events', 'application_id'), 'AC12: application_events.application_id is indexed');
select ok(pg_temp.leading_index('public.application_notes', 'application_id'), 'AC12: application_notes.application_id is indexed');
select ok(pg_temp.leading_index('public.application_notes', 'organization_id'), 'AC12: application_notes.organization_id is indexed');
select ok(pg_temp.leading_index('public.application_notes', 'author_id'), 'AC12: application_notes.author_id is indexed');
select is(
  (select count(*) from pg_class c where c.oid = 'public.v_my_application_timeline'::regclass and c.reloptions @> array['security_invoker=true']),
  1::bigint, 'the candidate''s timeline is a security_invoker view'
);

select * from finish();
rollback;
