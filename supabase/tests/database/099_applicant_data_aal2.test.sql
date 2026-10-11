-- SA-04 (security review), FR-A4, D79: an owner or administrator at aal1 is refused applicant data, documents, exports
-- and stage changes by the database itself; a plain member at aal1 and everybody at aal2 keep their access, and reading
-- one's own membership, organisation and vacancies needs no aal2 (D8).
begin;
select plan(44);

\ir status_fixture.inc

select pg_temp.doc(:'d1', :'wa');
select pg_temp.apply_as(:'wa', pg_temp.open_job('Aal2 vacancy'), 'Cover note', array[:'d1']::uuid[]) as applied \gset
select current_setting('t.app') as a1 \gset
select job_id as j1 from public.job_applications where id = :'a1' \gset
select pg_temp.seed_app('applied', current_setting('t.b')::uuid) as b1 \gset
insert into public.application_notes (application_id, organization_id, author_id, body)
values (:'a1', current_setting('t.a')::uuid, :'mem', 'Strong welder');
-- The member of Acme is also an administrator of Beta.
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (current_setting('t.b')::uuid, :'mem', 'admin', now());
select count(*) as logged_before from audit.document_access_log \gset

create function pg_temp.n_as(p_user uuid, p_aal text, p_sql text) returns text
language sql as $$ select pg_temp.val_as(p_user, p_aal, 'select count(*) from (' || p_sql || ') q') $$;

-- Every read and write of applicant data, run in turn as p_user; the outcomes joined by ' / '.
create function pg_temp.all_as(p_user uuid, p_aal text) returns text
language plpgsql as $$
declare
  v_sql text;
  v_out text[] := '{}';
begin
  foreach v_sql in array array[
    format('select * from public.get_applicant(%L)', current_setting('t.a1')),
    format('select * from public.list_applicant_events(%L)', current_setting('t.a1')),
    format('select * from public.application_documents(%L)', current_setting('t.a1')),
    format('select public.application_profile_changed(%L)', current_setting('t.a1')),
    format('select * from public.list_application_notes(%L)', current_setting('t.a1')),
    format('select * from public.get_applicant_access(%L)', current_setting('t.a')),
    format('select public.export_applicants(%L)', current_setting('t.j1')),
    format('select * from public.document_access_grant(%L, %L)', current_setting('t.d1'), 'application_review'),
    format('select public.mark_application_viewed(%L)', current_setting('t.a1')),
    format('select public.set_application_status(%L, %L)', current_setting('t.a1'), 'shortlisted'),
    format('insert into public.application_notes (application_id, organization_id, body) values (%L, %L, %L)', current_setting('t.a1'), current_setting('t.a'), 'New note')
  ] loop
    v_out := v_out || pg_temp.call_as(p_user, 'authenticated', v_sql, p_aal);
  end loop;
  return array_to_string(v_out, ' / ');
end;
$$;

select set_config('t.a1', :'a1', true) as keep_a1 \gset
select set_config('t.j1', :'j1', true) as keep_j1 \gset
select set_config('t.d1', :'d1', true) as keep_d1 \gset

-- The database refuses an owner and an administrator at aal1, every call with the same answer.
select is(
  pg_temp.all_as(:'own1', 'aal1'),
  array_to_string(array_fill('P0001|CHARA_FORBIDDEN|aal2_required'::text, array[11]), ' / '),
  'the owner at aal1 is refused every applicant read, the export, the document link, the stage changes and a note'
);
select is(
  pg_temp.all_as(:'adm', 'aal1'),
  array_to_string(array_fill('P0001|CHARA_FORBIDDEN|aal2_required'::text, array[11]), ' / '),
  'and so is an administrator at aal1'
);
select is(pg_temp.status_of(:'a1'), 'applied', 'no call moved the application');
select is(pg_temp.event_count(:'a1'), 1::bigint, 'or wrote an event');
select is((select count(*) from audit.document_access_log), :'logged_before'::bigint, 'or logged a document access');
select is((select count(*) from public.application_notes where application_id = :'a1'), 1::bigint, 'or added a note');
select is((select count(*) from audit.log where action = 'applicants_exported'), 0::bigint, 'or exported');

-- The policies hide the rows from an owner and an administrator at aal1.
select is(
  pg_temp.n_as(:'own1', 'aal1', 'select 1 from public.job_applications') || pg_temp.n_as(:'own1', 'aal1', 'select 1 from public.application_events')
    || pg_temp.n_as(:'own1', 'aal1', 'select 1 from public.application_notes') || pg_temp.n_as(:'own1', 'aal1', 'select 1 from public.v_job_applicants'),
  '0000', 'the owner at aal1 reads no application, event, note or list row'
);
select is(
  pg_temp.n_as(:'adm', 'aal1', 'select 1 from public.job_applications') || pg_temp.n_as(:'adm', 'aal1', 'select 1 from public.v_job_applicants'),
  '00', 'nor does an administrator at aal1'
);
select is(
  pg_temp.n_as(:'own1', 'aal1', format('select 1 from public.get_board_counts(%L)', :'j1'))
    || pg_temp.n_as(:'own1', 'aal1', format('select 1 from public.get_dashboard_applications(%L)', current_setting('t.a'))),
  '00', 'the board and dashboard counts of applications are empty for the owner at aal1'
);
select is(
  pg_temp.bulk_as(:'own1', array[:'a1']::uuid[], 'shortlisted', null, 'aal1')::text,
  jsonb_build_array(jsonb_build_object('application_id', :'a1', 'ok', false, 'error_code', 'CHARA_FORBIDDEN'))::text,
  'a bulk change by the owner at aal1 refuses the application'
);
select is(pg_temp.status_of(:'a1'), 'applied', 'and leaves it where it was');

-- At aal1 the owner still reaches the own membership, organisation and vacancies (D8, FR-A4 AC3), and the count the
-- close and fill dialogs show (FR-C2 AC9).
select is(
  pg_temp.n_as(:'own1', 'aal1', 'select 1 from public.organization_members where user_id = auth.uid()')
    || pg_temp.n_as(:'own1', 'aal1', format('select 1 from public.organizations where id = %L', current_setting('t.a')))
    || pg_temp.n_as(:'own1', 'aal1', format('select 1 from public.jobs where id = %L', :'j1')),
  '111', 'the owner at aal1 reads the own membership, organisation and vacancy'
);
select is(pg_temp.val_as(:'own1', 'aal1', format('select public.count_applications_in_progress(%L)', :'j1')), '1', 'and the number of applications in progress');
select is(pg_temp.val_as(:'adm', 'aal1', format('select public.count_applications_in_progress(%L)', :'j1')), '1', 'so does an administrator');
select is(pg_temp.val_as(:'own2', 'aal2', format('select public.count_applications_in_progress(%L)', :'j1')), '0', 'another organisation counts none');
update public.organizations set status = 'suspended' where id = current_setting('t.a')::uuid;
select is(pg_temp.val_as(:'own1', 'aal2', format('select public.count_applications_in_progress(%L)', :'j1')), '0', 'a suspended organisation counts none, as under the policy the count replaced');
update public.organizations set status = 'active' where id = current_setting('t.a')::uuid;
select pg_temp.force_status(:'a1', 'withdrawn');
select is(pg_temp.val_as(:'own1', 'aal1', format('select public.count_applications_in_progress(%L)', :'j1')), '0', 'a withdrawn application is not in progress');
select pg_temp.force_status(:'a1', 'hired');
select is(pg_temp.val_as(:'own1', 'aal1', format('select public.count_applications_in_progress(%L)', :'j1')), '0', 'a decided application is not in progress');
select pg_temp.force_status(:'a1', 'applied');
select is(
  pg_temp.call_as(null, 'anon', format('select public.count_applications_in_progress(%L)', :'j1')),
  '42501|permission denied for function count_applications_in_progress|', 'an anonymous caller cannot count'
);

-- A plain member at aal1 keeps the applicant pages (FR-A4); being an administrator elsewhere changes nothing for Acme,
-- but Beta's applicants need aal2.
select is(pg_temp.n_as(:'mem', 'aal1', 'select 1 from public.job_applications'), '1', 'the member at aal1 reads Acme''s application and not Beta''s');
select is(pg_temp.n_as(:'mem', 'aal1', format('select 1 from public.get_applicant(%L)', :'a1')), '1', 'and opens it');
select is(pg_temp.call_as(:'mem', 'authenticated', format('select * from public.document_access_grant(%L, %L)', :'d1', 'application_review'), 'aal1'), 'ok', 'and its shared document');
select is(
  pg_temp.call_as(:'mem', 'authenticated', format('select * from public.get_applicant(%L)', :'b1'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'but is refused Beta''s application, where it is an administrator'
);
select is(pg_temp.n_as(:'mem', 'aal2', 'select 1 from public.job_applications'), '2', 'at aal2 it reads both');

-- A plain member at aal1 also moves applications (FR-A4: members are never asked for aal2).
select is(pg_temp.viewed_as(:'mem', :'a1', 'aal1'), 'ok', 'the member at aal1 opens the application as viewed');
select is(pg_temp.status_of(:'a1'), 'viewed', 'and it is viewed');
select is(pg_temp.set_as(:'mem', :'a1', 'shortlisted', null, 'aal1'), 'ok', 'the member at aal1 shortlists');
select is(pg_temp.status_of(:'a1'), 'shortlisted', 'and it is shortlisted');
select is(
  pg_temp.bulk_as(:'mem', array[:'a1']::uuid[], 'interview', null, 'aal1') -> 0 -> 'ok', 'true'::jsonb,
  'the member at aal1 moves it in a bulk change'
);
select is(pg_temp.status_of(:'a1'), 'interview', 'and it is at the interview stage');
select pg_temp.force_status(:'a1', 'applied');

-- At aal2 the owner and the administrator have every read and write again.
select is(pg_temp.n_as(:'own1', 'aal2', 'select 1 from public.job_applications'), '1', 'the owner at aal2 reads the application');
select is(pg_temp.n_as(:'own1', 'aal2', 'select 1 from public.v_job_applicants'), '1', 'and the list row');
select is(pg_temp.n_as(:'own1', 'aal2', 'select 1 from public.application_notes'), '1', 'and the note');
select is(pg_temp.n_as(:'own1', 'aal2', format('select 1 from public.get_applicant(%L)', :'a1')), '1', 'and opens it');
select is(pg_temp.call_as(:'adm', 'authenticated', format('select * from public.document_access_grant(%L, %L)', :'d1', 'application_review'), 'aal2'), 'ok', 'the administrator at aal2 opens the document');
select is((select count(*) from audit.document_access_log), :'logged_before'::bigint + 2, 'the two openings are logged');
select is(pg_temp.set_as(:'own1', :'a1', 'shortlisted', null, 'aal2'), 'ok', 'the owner at aal2 shortlists');
select is(pg_temp.status_of(:'a1'), 'shortlisted', 'and the application moved');

-- The member of Acme administers Beta, and the candidate shared the document with Beta after Acme. At aal1 the grant
-- takes Acme's share, which the member may use, instead of refusing for Beta's newer one.
select is(pg_temp.apply_as(:'wa', pg_temp.open_job('Beta aal2 vacancy', current_setting('t.b')::uuid), null, array[:'d1']::uuid[]), 'ok', 'the candidate applies to Beta with the same document');
update private.settings set value = '0' where key = 'document_access_repeat_seconds';
select is(
  pg_temp.call_as(:'mem', 'authenticated', format('select * from public.document_access_grant(%L, %L)', :'d1', 'application_review'), 'aal1'),
  'ok', 'the member of Acme at aal1 still opens the document'
);
select is(
  (select format('%s|%s', count(*), max(organization_id::text)) from audit.document_access_log where id > (select max(id) - 1 from audit.document_access_log) and accessed_by = :'mem'),
  format('1|%s', current_setting('t.a')),
  'and the access is logged once more, for Acme, whose share was used'
);

-- The helper is the database's own.
select ok(
  not has_function_privilege('anon', 'private.assert_member_aal2(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.assert_member_aal2(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.assert_member_aal2(uuid)', 'execute'),
  'no API role can call assert_member_aal2'
);
select is(
  (select proconfig from pg_proc where oid = 'public.count_applications_in_progress(uuid)'::regprocedure),
  array['search_path=""'], 'the count sets search_path to empty'
);

select * from finish();
rollback;
