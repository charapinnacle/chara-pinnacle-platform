begin;
select plan(51);

\ir applicants_fixture.inc

-- FR-E1 AC1: Organisation A (employer_starter, active) has an Open vacancy J with four applications.
create temp table t_a as select pg_temp.org_on('employer_starter') as org;
create temp table t_j as select pg_temp.seed_job('{"title": "Listed welder", "status": "open"}', (select org from t_a)) as id;
select pg_temp.seed_applicant((select id from t_j), (select org from t_a), 'applied', '2026-09-04 10:00+00', 'Ana Silva', 80, 2) as ana \gset
select pg_temp.seed_applicant((select id from t_j), (select org from t_a), 'shortlisted', '2026-09-03 10:00+00', 'Ben Okoro', 55, 0) as ben \gset
select pg_temp.seed_applicant((select id from t_j), (select org from t_a), 'withdrawn', '2026-09-02 10:00+00', 'Chi Wei', 70, 2, true) as chi \gset
select pg_temp.seed_applicant((select id from t_j), (select org from t_a), 'hired', '2026-09-01 10:00+00', 'Dev Rao', 90, 1) as dev \gset
select pg_temp.member_of((select org from t_a)) as m1 \gset

create function pg_temp.rows_of(p_user uuid, p_where text, p_order text default 'applied_at desc, id desc') returns jsonb
language sql as $$
  select pg_temp.json_as(
    p_user,
    format('select candidate_name, status, applied_at::date as applied, completeness, documents from public.v_job_applicants where %s order by %s', p_where, p_order)
  )
$$;

select is(
  pg_temp.rows_of(:'m1', format('job_id = %L', (select id from t_j))),
  '[{"status": "applied", "applied": "2026-09-04", "documents": 2, "completeness": 80, "candidate_name": "Ana Silva"},
    {"status": "shortlisted", "applied": "2026-09-03", "documents": 0, "completeness": 55, "candidate_name": "Ben Okoro"},
    {"status": "withdrawn", "applied": "2026-09-02", "documents": 0, "completeness": 70, "candidate_name": "Chi Wei"},
    {"status": "hired", "applied": "2026-09-01", "documents": 1, "completeness": 90, "candidate_name": "Dev Rao"}]'::jsonb,
  'AC1: one row per application, newest first, with name, stage, date, completeness and document count; the withdrawn one stays and counts 0 documents because its share is revoked'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'v_job_applicants'),
  array['id', 'job_id', 'organization_id', 'job_title', 'candidate_name', 'status', 'applied_at', 'completeness', 'documents'],
  'AC1: the view holds ids, the vacancy title, the name, the stage, the date, the completeness and the count, no document name or id and no candidate id'
);
select is(
  (select reloptions::text from pg_class where relname = 'v_job_applicants'), '{security_invoker=true}', 'the view runs with the rights of its caller'
);

-- A share that has expired counts no document; one that expires later still counts.
update public.passport_shares set expires_at = now() - interval '1 minute' where application_id = :'dev';
select is((select (e ->> 'documents')::int from jsonb_array_elements(pg_temp.rows_of(:'m1', format('id = %L', :'dev'))) e), 0, 'an expired share counts 0 documents');
select pg_temp.seed_applicant((select id from t_j), (select org from t_a), 'hired', '2026-08-30 10:00+00', 'Eve Ng', 60, 3) as eve \gset
update public.passport_shares set expires_at = now() + interval '30 days' where application_id = :'eve';
select is((select (e ->> 'documents')::int from jsonb_array_elements(pg_temp.rows_of(:'m1', format('id = %L', :'eve'))) e), 3, 'a share that expires later still counts its documents');

-- Pipeline order is the order of the enum, so a sort by status sorts by stage.
create temp table t_all as select pg_temp.seed_job('{"title": "Every stage", "status": "open"}', (select org from t_a)) as id;
select pg_temp.seed_applicant((select id from t_all), (select org from t_a), s, now(), 'Stage ' || s, 10, 0) from unnest(
  array['withdrawn', 'rejected', 'hired', 'offer', 'interview', 'shortlisted', 'viewed', 'applied']) s;
select is(
  (select string_agg(e ->> 'status', ',') from jsonb_array_elements(pg_temp.rows_of(:'m1', format('job_id = %L', (select id from t_all)), 'status')) e),
  'applied,viewed,shortlisted,interview,offer,hired,rejected,withdrawn',
  'AC2: ordering by status gives the pipeline order'
);
select is(
  (select string_agg(e ->> 'status', ',') from jsonb_array_elements(pg_temp.rows_of(:'m1', format('job_id = %L', (select id from t_all)), 'status desc')) e),
  'withdrawn,rejected,hired,offer,interview,shortlisted,viewed,applied', 'AC2: and descending the reverse'
);

-- AC2: the stage filter and the second vacancy K of the organisation.
create temp table t_k as select pg_temp.seed_job('{"title": "Second vacancy", "status": "open"}', (select org from t_a)) as id;
select pg_temp.seed_applicant((select id from t_k), (select org from t_a), 'applied', now(), 'Kay Lin', 40, 0);
select pg_temp.seed_applicant((select id from t_k), (select org from t_a), 'applied', now(), 'Kim Lee', 40, 0);
select is(
  pg_temp.val_as(:'m1', 'aal1', format('select count(*) from public.v_job_applicants where organization_id = %L', (select org from t_a))),
  '15', 'AC2: without a vacancy the view holds the applications of all vacancies of the organisation (5, 8 and 2)'
);
select is(
  pg_temp.val_as(:'m1', 'aal1', format('select count(*) from public.v_job_applicants where job_id = %L and status = ''shortlisted''', (select id from t_j))),
  '1', 'AC2: a stage filter on one vacancy returns only that stage'
);
select is(
  pg_temp.val_as(:'m1', 'aal1', format('select string_agg(distinct job_title, '','') from public.v_job_applicants where job_id = %L', (select id from t_k))),
  'Second vacancy', 'AC2: the view names the vacancy of each application'
);

-- AC10 (reads): other organisations, other candidates, staff and visitors see nothing.
create temp table t_b as select pg_temp.org_on('employer_starter') as org;
select pg_temp.member_of((select org from t_b)) as mb \gset
select is(pg_temp.val_as(:'mb', 'aal1', 'select count(*) from public.v_job_applicants'), '0', 'AC10: a member of another organisation sees no applicant');
select is(pg_temp.val_as(:'wb', 'aal1', 'select count(*) from public.v_job_applicants'), '0', 'AC10: a candidate with no application sees none');
select is(pg_temp.val_as(:'st_admin', 'aal2', 'select count(*) from public.v_job_applicants'), '0', 'AC10: a platform administrator who is no member sees none');
select is(pg_temp.val_as(:'st_trust', 'aal2', 'select count(*) from public.v_job_applicants'), '0', 'AC10: trust and safety sees none');
select is(pg_temp.val_as(:'st_review', 'aal2', 'select count(*) from public.v_job_applicants'), '0', 'AC10: a verification reviewer sees none');
select is(pg_temp.call_as(null, 'anon', 'select 1 from public.v_job_applicants'), '42501|permission denied for view v_job_applicants|', 'AC10: an anonymous request is denied by the missing grant');
select is(pg_temp.call_as(null, 'service_role', 'select 1 from public.v_job_applicants'), '42501|permission denied for view v_job_applicants|', 'AC10: service_role is denied too');
select pg_temp.seed_applicant(pg_temp.seed_job('{"status": "open"}', (select org from t_b)), (select org from t_b), 'applied', now(), 'Sus Pended', 10, 2) as sus \gset
select passport_share_id as sus_share from public.job_applications where id = :'sus' \gset
select is(pg_temp.val_as(:'mb', 'aal1', format('select private.application_document_count(%L)', :'sus_share')), '2', 'AC11: a member of an active organisation reads the document count of its share');
update public.organizations set status = 'suspended' where id = (select org from t_b);
select is(pg_temp.val_as(:'mb', 'aal1', 'select count(*) from public.v_job_applicants'), '0', 'AC11: the members of a suspended organisation see none of its applicants');
select is(pg_temp.val_as(:'mb', 'aal1', format('select private.application_document_count(%L)', :'sus_share')), null, 'AC11: and the document count of its share is null for them');

-- A candidate reads the own application through the view and nothing else.
select pg_temp.apply_as(:'wa', pg_temp.open_job('Own vacancy', (select org from t_a))) as applied \gset
select is(pg_temp.val_as(:'wa', 'aal1', 'select count(*) from public.v_job_applicants'), '1', 'a candidate sees only the own application');
select is(
  (select pg_temp.val_as(:'wa', 'aal1', format('select count(*) from public.v_job_applicants where job_id = %L', (select id from t_j)))), '0',
  'and none of the others of a vacancy'
);

-- The count of documents of a share is for the members of the share's organisation only: the function is granted to the
-- API role because the view calls it as the caller, so it checks the caller itself.
select app_share.id as ana_share from (select passport_share_id as id from public.job_applications where id = :'ana') app_share \gset
select is(pg_temp.val_as(:'m1', 'aal1', format('select private.application_document_count(%L)', :'ana_share')), '2', 'the document count of a share is read by a member of its organisation');
select is(pg_temp.val_as(:'mb', 'aal1', format('select private.application_document_count(%L)', :'ana_share')), null, 'the document count of a share is null for a member of another organisation');
select is(pg_temp.val_as(:'wa', 'aal1', format('select private.application_document_count(%L)', :'ana_share')), null, 'and for a candidate who is not its owner');
select is(pg_temp.val_as(:'m1', 'aal1', format('select private.application_document_count(%L)', gen_random_uuid())), null, 'and for a share that does not exist');
select is(
  (select array_agg(r order by r) from unnest(array['anon', 'service_role', 'authenticated']) r where has_function_privilege(r, 'private.application_document_count(uuid)', 'execute')),
  array['authenticated'], 'only the API role of signed-in users may execute it'
);

-- An erased candidate has no name left in the snapshot: the name is null.
select pg_temp.seed_applicant((select id from t_k), (select org from t_a), 'applied', now(), 'Gone Soon', 30, 0) as gone \gset
update public.job_applications set profile_snapshot = profile_snapshot - 'first_name' - 'last_name' where id = :'gone';
select is((select (e ->> 'candidate_name') is null from jsonb_array_elements(pg_temp.rows_of(:'m1', format('id = %L', :'gone'))) e), true, 'an erased candidate has no name in the view');

-- Applications made before the snapshot held a completeness show 0.
update public.job_applications set profile_snapshot = profile_snapshot - 'completeness' where id = :'ana';
select is((select (e ->> 'completeness')::int from jsonb_array_elements(pg_temp.rows_of(:'m1', format('id = %L', :'ana'))) e), 0, 'a snapshot without a completeness shows 0');

-- get_applicant_access: what the pages offer an organisation.
create function pg_temp.access_of(p_user uuid, p_org uuid) returns jsonb
language sql as $$ select pg_temp.json_as(p_user, format('select * from public.get_applicant_access(%L)', p_org)) $$;
create temp table t_lapsed as select pg_temp.org_on('employer_starter', 'canceled') as org;
create temp table t_never as select pg_temp.org_on() as org;
select is(pg_temp.access_of(:'m1', (select org from t_a)), '[{"csv_export_available": true, "shortlisting_available": true, "note_max_chars": 1000, "stage_change_blocked": null}]'::jsonb, 'access: an active paid plan may move, shortlist and export');
select is(
  pg_temp.access_of(pg_temp.member_of((select org from t_lapsed)), (select org from t_lapsed)),
  '[{"csv_export_available": false, "shortlisting_available": false, "note_max_chars": 1000, "stage_change_blocked": "read_only_free_plan"}]'::jsonb,
  'access: a lapsed organisation may not move, shortlist or export'
);
select is(
  pg_temp.access_of(pg_temp.member_of((select org from t_never)), (select org from t_never)),
  '[{"csv_export_available": true, "shortlisting_available": true, "note_max_chars": 1000, "stage_change_blocked": null}]'::jsonb,
  'access: an organisation that never subscribed has everything while limits are not enforced'
);
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(
  pg_temp.access_of(pg_temp.member_of((select org from t_never)), (select org from t_never)),
  '[{"csv_export_available": false, "shortlisting_available": false, "note_max_chars": 1000, "stage_change_blocked": "read_only_free_plan"}]'::jsonb,
  'access: once limits are enforced the free plan is read only'
);
delete from billing.plan_features where plan_code = 'employer_starter' and feature_key = 'csv_export';
select is(pg_temp.access_of(:'m1', (select org from t_a)), '[{"csv_export_available": false, "shortlisting_available": true, "note_max_chars": 1000, "stage_change_blocked": null}]'::jsonb, 'access: a plan without csv_export has no export');
select is(pg_temp.access_of(:'m1', (select org from t_b)), '[]'::jsonb, 'access: no row for an organisation the caller is not a member of');
select is(pg_temp.access_of(:'wa', (select org from t_a)), to_jsonb('P0001|CHARA_FORBIDDEN|company_account_required'::text), 'access: a candidate is refused');
select is(pg_temp.call_as(null, 'anon', format('select * from public.get_applicant_access(%L)', (select org from t_a))), '42501|permission denied for function get_applicant_access|', 'access: an anonymous caller has no EXECUTE');

-- A pending invitee and a removed member of organisation A are not members: no access row, no applicant and no count.
select pg_temp.ex_member((select org from t_a), false) as pending_a \gset
select pg_temp.ex_member((select org from t_a), true) as removed_a \gset
select is(pg_temp.access_of(:'pending_a', (select org from t_a)), '[]'::jsonb, 'AC10: an invitee who has not accepted gets no access row');
select is(pg_temp.val_as(:'pending_a', 'aal1', 'select count(*) from public.v_job_applicants'), '0', 'AC10: and sees no applicant');
select is(pg_temp.val_as(:'pending_a', 'aal1', format('select private.application_document_count(%L)', :'ana_share')), null, 'AC10: and reads no document count');
select is(pg_temp.access_of(:'removed_a', (select org from t_a)), '[]'::jsonb, 'AC10: a removed member gets no access row');
select is(pg_temp.val_as(:'removed_a', 'aal1', 'select count(*) from public.v_job_applicants'), '0', 'AC10: and sees no applicant');
select is(pg_temp.val_as(:'removed_a', 'aal1', format('select private.application_document_count(%L)', :'ana_share')), null, 'AC10: and reads no document count');

-- get_board_counts: the stages of one vacancy as the caller may read them.
create function pg_temp.board_counts_of(p_user uuid, p_job uuid) returns jsonb
language sql as $$ select pg_temp.json_as(p_user, format('select status, total from public.get_board_counts(%L) order by status', p_job)) $$;
select job_id as sus_job from public.job_applications where id = :'sus' \gset
select is(
  pg_temp.board_counts_of(:'m1', (select id from t_j)),
  '[{"status": "applied", "total": 1}, {"status": "shortlisted", "total": 1}, {"status": "hired", "total": 2}, {"status": "withdrawn", "total": 1}]'::jsonb,
  'board counts: a member reads the number of applications of each stage, a stage with none has no row'
);
select is(pg_temp.board_counts_of(:'m1', :'sus_job'), '[]'::jsonb, 'board counts: a vacancy of another organisation counts nothing');
select is(
  pg_temp.board_counts_of(:'pending_a', (select id from t_j)) || pg_temp.board_counts_of(:'removed_a', (select id from t_j)) || pg_temp.board_counts_of(:'wb', (select id from t_j)),
  '[]'::jsonb, 'board counts: an invitee, a removed member and another candidate count nothing'
);
select is(pg_temp.call_as(null, 'anon', format('select * from public.get_board_counts(%L)', (select id from t_j))), '42501|permission denied for function get_board_counts|', 'board counts: an anonymous caller has no EXECUTE');

-- Indexes of the list and the sort of the view.
select is(
  (select count(*) from pg_indexes where tablename = 'job_applications' and indexname in ('job_applications_job_created_idx', 'job_applications_organization_created_idx', 'job_applications_organization_status_idx')),
  3::bigint, 'the vacancy list, the organisation list and its sort by stage each have an index in the order of the list'
);
select is(
  (select indexdef from pg_indexes where indexname = 'job_applications_organization_status_idx'),
  'CREATE INDEX job_applications_organization_status_idx ON public.job_applications USING btree (organization_id, status, created_at DESC, id DESC)',
  'the stage sort of the organisation list is served by an index'
);
select is(
  (select indexdef from pg_indexes where indexname = 'job_applications_job_created_idx'),
  'CREATE INDEX job_applications_job_created_idx ON public.job_applications USING btree (job_id, created_at DESC, id DESC)',
  'the vacancy index serves the filter and the newest-first order'
);
select is(
  (select count(*) from pg_indexes where indexname = 'job_applications_organization_idx'), 0::bigint,
  'the index on the organisation alone is replaced by the ordered one'
);

select * from finish();
rollback;
