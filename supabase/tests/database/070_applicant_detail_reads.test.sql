begin;
select plan(54);

\ir status_fixture.inc

\set d4 '00000000-0000-0000-0000-0000000d0004'
\set d5 '00000000-0000-0000-0000-0000000d0005'
\set d6 '00000000-0000-0000-0000-0000000d0006'

select count(*) as logged_before from audit.document_access_log \gset

-- FR-E2: the reads of the applicant page. wa applies with d1 (a CV, skipped), d2 (a certificate, clean), d4 (deleted
-- afterwards), d5 (rejected) and d6 (pending); d3 is uploaded after the application and is in no scope.
select pg_temp.doc(:'d1', :'wa');
select pg_temp.doc(:'d2', :'wa', 'clean', 'certificate');
select pg_temp.doc(:'d4', :'wa');
select pg_temp.doc(:'d5', :'wa', 'rejected');
select pg_temp.doc(:'d6', :'wa', 'pending');
update public.worker_profiles set headline = 'Welder', years_experience = 6, availability = 'now' where user_id = :'wa';
insert into public.worker_skills (worker_user_id, skill) values (:'wa', 'MIG welding'), (:'wa', 'TIG welding');
insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (:'wa', 'en', 'C1'), (:'wa', 'de', 'A2');
insert into public.worker_preferred_countries (worker_user_id, country_code) values (:'wa', 'DE');
insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values (:'wa', 'NG', '2030-05-01');

select pg_temp.apply_as(:'wa', pg_temp.open_job('Reads vacancy 1'), 'Cover note', array[:'d1', :'d2', :'d4', :'d5', :'d6']::uuid[]) as ok1 \gset
select current_setting('t.app') as a1 \gset
select pg_temp.apply_as(:'wa', pg_temp.open_job('Reads vacancy 2')) as ok2 \gset
select current_setting('t.app') as a2 \gset
select pg_temp.apply_as(:'wa', pg_temp.open_job('Reads vacancy 3')) as ok3 \gset
select current_setting('t.app') as a3 \gset
select pg_temp.apply_as(:'wa', pg_temp.open_job('Reads vacancy 4')) as ok4 \gset
select current_setting('t.app') as a4 \gset
select pg_temp.doc('00000000-0000-0000-0000-0000000d0003', :'wa');
update public.worker_documents set deleted_at = now() where id = :'d4';

create function pg_temp.reads_as(p_user uuid, p_fn text, p_app uuid) returns text
language sql as $$
  select coalesce(pg_temp.json_as(p_user, format('select * from public.%s(%L)', p_fn, p_app))::text, 'null')
$$;
create function pg_temp.changed_as(p_user uuid, p_app uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format($f$select set_config('t.changed', coalesce(public.application_profile_changed(%L)::text, 'null'), true)$f$, p_app), 'aal1')
    || '#' || coalesce(current_setting('t.changed', true), '')
$$;

-- The snapshot is the profile in the shape the page reads, and the helper builds exactly what the application stored.
select is(
  (select a.profile_snapshot - 'completeness' from public.job_applications a where a.id = :'a1'),
  private.profile_snapshot(:'wa'),
  'the snapshot apply_to_job stored is what private.profile_snapshot builds from the live profile'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(private.profile_snapshot(:'wa')) k),
  array['availability', 'available_from', 'current_country', 'first_name', 'headline', 'languages', 'last_name', 'occupation', 'occupation_id',
        'preferred_countries', 'skills', 'work_authorizations', 'years_experience'],
  'the snapshot holds no date of birth, nationality, gender, religion or marital status'
);

-- AC6: the list of documents.
select is(
  pg_temp.json_as(:'mem', format('select id::text, title, type::text, file_name, size_bytes, expires_on, available from public.application_documents(%L)', :'a1')),
  jsonb_build_array(
    jsonb_build_object('id', :'d1', 'title', 'Title ' || :'d1', 'type', 'cv', 'file_name', 'cv.pdf', 'size_bytes', 1000, 'expires_on', null, 'available', true),
    jsonb_build_object('id', :'d2', 'title', 'Title ' || :'d2', 'type', 'certificate', 'file_name', 'cv.pdf', 'size_bytes', 1000, 'expires_on', null, 'available', true),
    jsonb_build_object('id', :'d6', 'title', 'Title ' || :'d6', 'type', 'cv', 'file_name', 'cv.pdf', 'size_bytes', 1000, 'expires_on', null, 'available', false)
  ),
  'AC6: a member reads the documents of the scope that are not deleted or rejected; a pending file is listed as not available; d3 is not in the scope'
);
select is(
  (select array_agg(n order by o) from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as x(n, m, o)
   where p.oid = 'public.application_documents(uuid)'::regprocedure and m = 't'),
  array['id', 'title', 'type', 'file_name', 'size_bytes', 'expires_on', 'available'],
  'AC6: the list has no bucket and no storage path'
);
select is(pg_temp.reads_as(:'own1', 'application_documents', :'a1')::jsonb -> 0 ->> 'id', :'d1', 'an owner of the organisation reads the list too');
select is(jsonb_array_length(pg_temp.json_as(:'adm', format('select * from public.application_documents(%L)', :'a1'))), 3, 'and an admin');

-- AC6: errors.
select is(pg_temp.reads_as(:'own2', 'application_documents', :'a1'), '"P0002|CHARA_NOT_FOUND|"', 'AC6: a member of another organisation gets CHARA_NOT_FOUND');
select is(pg_temp.reads_as(:'st_admin', 'application_documents', :'a1'), '"P0002|CHARA_NOT_FOUND|"', 'AC6: a platform administrator who is no member gets CHARA_NOT_FOUND');
select is(pg_temp.reads_as(:'pending', 'application_documents', :'a1'), '"P0002|CHARA_NOT_FOUND|"', 'a member whose invitation is not accepted gets CHARA_NOT_FOUND');
select is(pg_temp.reads_as(:'mem', 'application_documents', gen_random_uuid()), '"P0002|CHARA_NOT_FOUND|"', 'an unknown id gets CHARA_NOT_FOUND');
select is(pg_temp.reads_as(:'wa', 'application_documents', :'a1'), '"P0001|CHARA_FORBIDDEN|company_account_required"', 'AC6: the applicant gets CHARA_FORBIDDEN');
select is(
  pg_temp.call_as(null, 'anon', format('select * from public.application_documents(%L)', :'a1')),
  '42501|permission denied for function application_documents|', 'AC6: an anonymous call has no EXECUTE'
);
select is(
  pg_temp.call_as(null, 'anon', format('select public.application_profile_changed(%L)', :'a1')),
  '42501|permission denied for function application_profile_changed|', 'and none for the changed check either'
);
select is(pg_temp.changed_as(:'own2', :'a1'), 'P0002|CHARA_NOT_FOUND|#', 'AC6: the changed check gives a member of another organisation CHARA_NOT_FOUND');
select is(pg_temp.changed_as(:'wa', :'a1'), 'P0001|CHARA_FORBIDDEN|company_account_required#', 'AC6: and the applicant CHARA_FORBIDDEN');

-- AC2, AC6: the indicator.
select is(pg_temp.changed_as(:'mem', :'a1'), 'ok#false', 'AC2: nothing changed, nothing is indicated');
update public.worker_profiles set headline = 'Welder' where user_id = :'wa';
update public.worker_profiles set years_experience = years_experience where user_id = :'wa';
select is(pg_temp.changed_as(:'mem', :'a1'), 'ok#false', 'AC2: a save without a change of value is not a change');
update public.worker_profiles set headline = 'Senior welder' where user_id = :'wa';
select is(pg_temp.changed_as(:'mem', :'a1'), 'ok#true', 'AC2: a changed headline is indicated');
select is(pg_temp.changed_as(:'mem', :'a2'), 'ok#true', 'AC2: and in every application of the candidate whose share is valid');
update public.worker_profiles set headline = 'Welder' where user_id = :'wa';
select is(pg_temp.changed_as(:'mem', :'a1'), 'ok#false', 'AC2: restoring the value removes the indicator, the comparison is by content');
insert into public.worker_skills (worker_user_id, skill) values (:'wa', 'Pipe welding');
select is(pg_temp.changed_as(:'mem', :'a1'), 'ok#true', 'a new skill is a change');
delete from public.worker_skills where worker_user_id = :'wa' and skill = 'Pipe welding';
update public.worker_languages set cefr_level = 'C2' where worker_user_id = :'wa' and language_code = 'de';
select is(pg_temp.changed_as(:'mem', :'a1'), 'ok#true', 'a changed language level is a change');
update public.worker_languages set cefr_level = 'A2' where worker_user_id = :'wa' and language_code = 'de';
update public.worker_work_authorizations set expires_on = '2031-05-01' where worker_user_id = :'wa';
select is(pg_temp.changed_as(:'mem', :'a1'), 'ok#true', 'a changed expiry of a work authorisation is a change');
update public.worker_work_authorizations set expires_on = '2030-05-01' where worker_user_id = :'wa';
select is(pg_temp.changed_as(:'mem', :'a1'), 'ok#false', 'and back to the snapshot it is none');
update public.occupations set label = label || ' (renamed)' where code = (select occupation_id from public.worker_profiles where user_id = :'wa');
select is(pg_temp.changed_as(:'mem', :'a1'), 'ok#false', 'AC2: a renamed occupation in the reference data is no change of the profile');

-- AC2, AC6: a revoked or an expired share shows nothing and the live profile is not read.
update public.worker_profiles set headline = 'Changed after withdrawing' where user_id = :'wa';
select pg_temp.force_status(:'a3', 'viewed');
select pg_temp.call_as(:'wa', 'authenticated', format('select public.withdraw_application(%L)', :'a3'), 'aal1') as wd \gset
select is(pg_temp.changed_as(:'mem', :'a3'), 'ok#null', 'AC2: a withdrawn application (share revoked) has no indicator');
select is(pg_temp.reads_as(:'mem', 'application_documents', :'a3'), '[]', 'AC6: and no documents');
select pg_temp.force_status(:'a4', 'hired');
update public.passport_shares set expires_at = now() - interval '1 second' where application_id = :'a4';
select is(pg_temp.changed_as(:'mem', :'a4'), 'ok#null', 'AC2: a share that expired after Hired has no indicator');
select is(pg_temp.reads_as(:'mem', 'application_documents', :'a4'), '[]', 'AC6: and no documents');
select is(pg_temp.changed_as(:'mem', :'a1'), 'ok#true', 'the valid share still shows the change');

-- The consent withdrawn ends both, as it ends the link.
insert into public.consents (user_id, purpose, version, action)
select c.user_id, c.purpose, c.version, 'withdrawn' from public.passport_shares s join public.consents c on c.id = s.consent_id where s.application_id = :'a2';
select is(pg_temp.changed_as(:'mem', :'a2'), 'ok#null', 'a withdrawn consent ends the check');
select is(pg_temp.reads_as(:'mem', 'application_documents', :'a2'), '[]', 'and the list');

-- A suspended organisation and a lapsed one.
update public.organizations set status = 'suspended' where id = current_setting('t.a')::uuid;
select is(pg_temp.reads_as(:'mem', 'application_documents', :'a1'), '"P0002|CHARA_NOT_FOUND|"', 'a suspended organisation is answered as an unknown id');
update public.organizations set status = 'active' where id = current_setting('t.a')::uuid;
create temp table t_lapsed as select pg_temp.org_on('employer_starter', 'canceled') as org;
select pg_temp.seed_app('applied', (select org from t_lapsed)) as al \gset
select is(
  pg_temp.json_as(pg_temp.member_of((select org from t_lapsed)), format('select * from public.application_documents(%L)', :'al')), '[]'::jsonb,
  'a lapsed organisation reads the list of a valid share (it is read only, not hidden)'
);

-- No read writes an access-log row.
select is((select count(*) from audit.document_access_log), :'logged_before'::bigint, 'AC6: none of the reads wrote an access-log row');

-- AC7, AC8: the notes.
select pg_temp.call_as(:'mem', 'authenticated', format($$insert into public.application_notes (application_id, organization_id, body) values (%L, %L, 'Call on Monday')$$, :'a1', current_setting('t.a')), 'aal1') as n1 \gset
select pg_temp.call_as(:'adm', 'authenticated', format($$insert into public.application_notes (application_id, organization_id, body) values (%L, %L, 'Second note')$$, :'a1', current_setting('t.a')), 'aal2') as n2 \gset
update public.profiles set display_name = 'Mia Member' where id = :'mem';
update public.application_notes set created_at = now() - interval '1 hour' where body = 'Call on Monday';
select is(
  pg_temp.json_as(:'own1', format('select author_name, body from public.list_application_notes(%L)', :'a1')),
  '[{"body": "Second note", "author_name": null}, {"body": "Call on Monday", "author_name": "Mia Member"}]'::jsonb,
  'AC7: the notes are listed newest first with the name of the author'
);
select is(pg_temp.reads_as(:'own2', 'list_application_notes', :'a1'), '"P0002|CHARA_NOT_FOUND|"', 'AC8: a member of another organisation is told CHARA_NOT_FOUND');
select is(pg_temp.reads_as(:'wa', 'list_application_notes', :'a1'), '"P0001|CHARA_FORBIDDEN|company_account_required"', 'AC8: the applicant is refused');
select is(pg_temp.reads_as(:'st_admin', 'list_application_notes', :'a1'), '"P0002|CHARA_NOT_FOUND|"', 'AC8: a platform administrator who is no member is told CHARA_NOT_FOUND');
select is(
  pg_temp.call_as(null, 'anon', format('select * from public.list_application_notes(%L)', :'a1')),
  '42501|permission denied for function list_application_notes|', 'AC8: an anonymous call has no EXECUTE'
);
insert into public.application_notes (application_id, organization_id, author_id, body)
select :'a2', current_setting('t.a')::uuid, :'mem', 'Note ' || g from generate_series(1, 105) g;
select is(jsonb_array_length(pg_temp.json_as(:'mem', format('select * from public.list_application_notes(%L)', :'a2'))), 50, 'a page is bounded at 50 notes');
select is(
  pg_temp.json_as(:'mem', format('select body, has_more from public.list_application_notes(%L) limit 1', :'a2')), '[{"body": "Note 105", "has_more": true}]'::jsonb,
  'and starts with the newest, with the sign that older notes exist'
);
select id as last1 from public.application_notes where application_id = :'a2' and body = 'Note 56' \gset
select id as last2 from public.application_notes where application_id = :'a2' and body = 'Note 6' \gset
select is(
  pg_temp.json_as(:'mem', format('select count(*) as n, min(body) filter (where body = ''Note 55'') as first, bool_and(has_more) as more from public.list_application_notes(%L, %L)', :'a2', :'last1')),
  '[{"n": 50, "first": "Note 55", "more": true}]'::jsonb, 'keyset paging: the next page continues after the last note of the page before'
);
select is(
  pg_temp.json_as(:'mem', format('select count(*) as n, bool_or(has_more) as more from public.list_application_notes(%L, %L)', :'a2', :'last2')),
  '[{"n": 5, "more": false}]'::jsonb, 'and the last page has the rest and no sign of more'
);
select is(
  pg_temp.json_as(:'mem', format('select count(*) as n from public.list_application_notes(%L, %L)', :'a2', (select id from public.application_notes where application_id = :'a1' limit 1))),
  '[{"n": 0}]'::jsonb, 'a cursor from another application gives no rows'
);
select is(
  pg_temp.json_as(pg_temp.member_of((select org from t_lapsed)), format('select count(*) as n from public.list_application_notes(%L)', :'al')),
  '[{"n": 0}]'::jsonb, 'a lapsed organisation reads its notes'
);


-- AC9: notes under the plan rules. L is lapsed, N has never had a subscription, E is on free_employer; each has a note.
create function pg_temp.note_in(p_org uuid, p_app uuid) returns text
language sql as $$
  select pg_temp.call_as(
    pg_temp.member_of(p_org), 'authenticated',
    format($f$insert into public.application_notes (application_id, organization_id, body) values (%L, %L, 'Another note')$f$, p_app, p_org), 'aal1')
$$;
create temp table t_plans as select pg_temp.org_on('employer_starter', 'canceled') as l, pg_temp.org_on() as n, pg_temp.org_on() as e;
select pg_temp.seed_app('applied', (select l from t_plans)) as app_l \gset
select pg_temp.seed_app('applied', (select n from t_plans)) as app_n \gset
select pg_temp.seed_app('applied', (select e from t_plans)) as app_e \gset
insert into public.application_notes (application_id, organization_id, author_id, body)
values (:'app_l', (select l from t_plans), pg_temp.member_of((select l from t_plans)), 'Existing note of L'),
       (:'app_e', (select e from t_plans), pg_temp.member_of((select e from t_plans)), 'Existing note of E');

select is(pg_temp.note_in((select l from t_plans), :'app_l'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC9: limits not enforced, a lapsed organisation is refused a note');
select is(pg_temp.note_in((select n from t_plans), :'app_n'), 'ok', 'AC9: and an organisation that never subscribed may add one');
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.note_in((select l from t_plans), :'app_l'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC9: limits enforced, the lapsed organisation is refused the same way');
select is(pg_temp.note_in((select e from t_plans), :'app_e'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC9: and an organisation on free_employer');
select is(pg_temp.note_in((select n from t_plans), :'app_n'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC9: and the one that never subscribed');
select is(
  pg_temp.json_as(pg_temp.member_of((select l from t_plans)), format('select body from public.list_application_notes(%L)', :'app_l')),
  '[{"body": "Existing note of L"}]'::jsonb, 'AC9: the existing notes of L stay readable'
);
select is(
  pg_temp.json_as(pg_temp.member_of((select e from t_plans)), format('select body from public.list_application_notes(%L)', :'app_e')),
  '[{"body": "Existing note of E"}]'::jsonb, 'AC9: and those of E'
);
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is((select count(*) from public.application_notes where application_id in (:'app_l', :'app_e')), 2::bigint, 'AC9: the refused notes left no row');

select * from finish();
rollback;
