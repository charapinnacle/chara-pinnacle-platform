begin;
select plan(38);

\ir privacy_fixture.inc

-- These tests count the rows of single calls; the repeat window is tested in 036.
update private.settings set value = '0' where key = 'document_access_repeat_seconds';

\set d4 '00000000-0000-0000-0000-0000000d0004'
\set d5 '00000000-0000-0000-0000-0000000d0005'
\set d6 '00000000-0000-0000-0000-0000000d0006'
\set d7 '00000000-0000-0000-0000-0000000d0007'
\set d8 '00000000-0000-0000-0000-0000000d0008'
\set d9 '00000000-0000-0000-0000-0000000d0009'
\set d10 '00000000-0000-0000-0000-0000000d0010'
\set d11 '00000000-0000-0000-0000-0000000d0011'
\set d12 '00000000-0000-0000-0000-0000000d0012'
\set dd '00000000-0000-0000-0000-0000000d00d1'

create function pg_temp.o() returns uuid language sql as $$ select current_setting('t.o')::uuid $$;
create function pg_temp.p() returns uuid language sql as $$ select current_setting('t.p')::uuid $$;
create function pg_temp.logged() returns bigint language sql as $$ select count(*) from audit.document_access_log $$;

-- Candidate A: d1 selected for the application of organisation O, d2 uploaded before it but not selected, d3 after it.
select pg_temp.doc(:'d1', :'wa');
select pg_temp.doc(:'d2', :'wa');
select set_config('t.s1', pg_temp.share(pg_temp.o(), :'wa', array[:'d1']::uuid[])::text, true);
select pg_temp.doc(:'d3', :'wa');
select pg_temp.doc(:'dc', :'wb');
insert into storage.objects (bucket_id, name) values ('passport-documents', :'wa' || '/' || :'d1' || '/cv.pdf');
insert into public.worker_skills (worker_user_id, skill) values (:'wa', 'Welding');
insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (:'wa', 'en', 'B2');
insert into public.worker_preferred_countries (worker_user_id, country_code) values (:'wa', 'DE');
insert into public.worker_work_authorizations (worker_user_id, country_code) values (:'wa', 'NG');

-- AC1: no employer role reads a candidate table or object; the candidate reads their own; anonymous is refused.
create function pg_temp.reads(p_user uuid, p_role text, p_aal text) returns text language plpgsql as $$
declare
  v_table text;
  v_out text[] := '{}';
begin
  foreach v_table in array array['public.worker_profiles', 'public.worker_skills', 'public.worker_languages',
      'public.worker_preferred_countries', 'public.worker_work_authorizations', 'public.worker_documents'] loop
    begin
      v_out := v_out || pg_temp.affected_as(p_user, p_role, 'select 1 from ' || v_table, p_aal)::text;
    exception when others then
      reset role;
      v_out := v_out || sqlstate;
    end;
  end loop;
  begin
    v_out := v_out || pg_temp.affected_as(p_user, p_role, $q$select 1 from storage.objects where bucket_id = 'passport-documents'$q$, p_aal)::text;
  exception when others then
    reset role;
    v_out := v_out || sqlstate;
  end;
  return array_to_string(v_out, ',');
end;
$$;

select is(pg_temp.reads(:'wa', 'authenticated', 'aal1'), '1,1,1,1,1,3,1', 'AC1: the candidate reads the own profile, children, documents and object');
select is(pg_temp.reads(:'own1', 'authenticated', 'aal2'), '0,0,0,0,0,0,0', 'AC1: an owner of the organisation with a share reads nothing');
select is(pg_temp.reads(:'adm', 'authenticated', 'aal2'), '0,0,0,0,0,0,0', 'AC1: an admin of that organisation reads nothing');
select is(pg_temp.reads(:'mem', 'authenticated', 'aal1'), '0,0,0,0,0,0,0', 'AC1: a member of that organisation reads nothing');
select is(pg_temp.reads(:'own2', 'authenticated', 'aal2'), '0,0,0,0,0,0,0', 'AC1: an owner of another organisation reads nothing');
select is(pg_temp.reads(null, 'anon', 'aal1'), '42501,42501,42501,42501,42501,42501,0', 'AC1: anonymous is refused by missing grants and sees no object');
select is(pg_temp.reads(:'slg', 'authenticated', 'aal2'), '0,0,0,0,0,0,0', 'AC2: a platform administrator at aal2 reads nothing');
select is(pg_temp.reads(:'adm2', 'authenticated', 'aal2'), '0,0,0,0,0,0,0', 'AC2: a verification reviewer at aal2 reads nothing');
select is(pg_temp.reads(:'late', 'authenticated', 'aal2'), '0,0,0,0,0,0,0', 'AC2: a trust and safety administrator at aal2 reads nothing');

-- AC3: a member of the owning organisation opens a document of the scope, and each opening is one row.
select is(pg_temp.logged(), 0::bigint, 'setup: nothing is logged yet');
select is(pg_temp.grant_as(:'own1', :'d1'), 'ok', 'AC3: an owner of O opens d1 at aal2');
select is(pg_temp.grant_as(:'adm', :'d1'), 'ok', 'AC3: an admin of O opens d1 at aal2');
select is(
  pg_temp.val_as(:'mem', 'aal1', format($$select bucket_id || '|' || object_path || '|' || file_name from public.document_access_grant(%L, 'application_review')$$, :'d1')),
  'passport-documents|' || :'wa' || '/' || :'d1' || '/cv.pdf|cv.pdf', 'AC3: a member of O at aal1 gets the bucket, path and file name of d1'
);
select is(pg_temp.logged(), 3::bigint, 'AC3: three openings wrote three rows');
select is(
  (select count(*) from audit.document_access_log
   where share_id = current_setting('t.s1')::uuid and document_id = :'d1' and worker_user_id = :'wa' and organization_id = pg_temp.o()
     and purpose = 'application_review' and accessed_by in (:'own1', :'adm', :'mem') and accessed_at = now()),
  3::bigint, 'AC3: each row names the share, document, candidate, organisation, caller, purpose and the database time'
);
select is(
  (select count(distinct accessed_by) from audit.document_access_log), 3::bigint, 'AC3: one row for each caller'
);
select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'ok', 'a second opening by the same person is allowed');
select is(pg_temp.logged(), 4::bigint, 'and is logged again when no repeat window is set');

-- AC4, AC5, AC6: only the document ids of the scope, only the owning organisation.
select is(pg_temp.grant_as(:'own1', :'d2'), '42501|CHARA_FORBIDDEN|', 'AC4: a CV of the same candidate that was not selected is refused');
select is(pg_temp.grant_as(:'mem', :'d2', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'AC4: also for a member');
select is(pg_temp.grant_as(:'own1', :'d3'), '42501|CHARA_FORBIDDEN|', 'AC5: a CV of the same type uploaded after the application is refused');
select is(pg_temp.grant_as(:'own2', :'d1'), '42501|CHARA_FORBIDDEN|', 'AC6: a member of an organisation without a share from A is refused');
select is(pg_temp.grant_as(:'own1', :'dc'), '42501|CHARA_FORBIDDEN|', 'AC6: a member of O is refused the document of a candidate who shared nothing with O');
select is(pg_temp.grant_as(:'wb', :'d1', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'another candidate is refused');
select is(pg_temp.grant_as(:'slg', :'d1'), '42501|CHARA_FORBIDDEN|', 'AC2: a platform administrator is refused the document of a share');
select is(pg_temp.grant_as(:'adm2', :'d1'), '42501|CHARA_FORBIDDEN|', 'AC2: a verification reviewer is refused');
select is(pg_temp.grant_as(:'late', :'d1'), '42501|CHARA_FORBIDDEN|', 'AC2: a trust and safety administrator is refused');
select is(pg_temp.logged(), 4::bigint, 'AC2, AC4 to AC6: no refusal wrote a row');

-- AC7: withdrawal and withdrawn consent end access at once, in the same transaction.
select pg_temp.doc(:'d4', :'wa');
select pg_temp.doc(:'d7', :'wa');
select pg_temp.doc(:'d8', :'wa');
select set_config('t.s2', pg_temp.share(pg_temp.o(), :'wa', array[:'d4']::uuid[], 'sharing-notice-b')::text, true);
select set_config('t.s3', pg_temp.share(pg_temp.o(), :'wa', array[:'d7']::uuid[], 'sharing-notice-c')::text, true);
select set_config('t.s4', pg_temp.share(pg_temp.o(), :'wa', array[:'d8']::uuid[])::text, true);
select is(pg_temp.grant_as(:'mem', :'d4', p_aal => 'aal1'), 'ok', 'setup: the document of the second share opens');
update public.passport_shares set revoked_at = now() where id = current_setting('t.s2')::uuid;
insert into public.consents (user_id, purpose, version, action) values (:'wa', 'sharing-notice-b', 1, 'withdrawn');
select is(pg_temp.grant_as(:'mem', :'d4', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'AC7: a withdrawn application (revoked share and withdrawn consent) is refused at once');
select is(pg_temp.grant_as(:'mem', :'d7', p_aal => 'aal1'), 'ok', 'setup: the document of the third share opens');
select is(pg_temp.call_as(:'wa', 'authenticated', $$select public.withdraw_consent('sharing-notice-c')$$, 'aal1'), 'ok', 'the candidate withdraws the consent');
select is(pg_temp.grant_as(:'mem', :'d7', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'AC7: a later withdrawn consent row alone ends access in the same second');
update public.passport_shares set revoked_at = now() where id = current_setting('t.s4')::uuid;
select is(pg_temp.grant_as(:'mem', :'d8', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'a revoked share alone ends access');
select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'ok', 'the other shares of the candidate are not touched');
select is(pg_temp.logged(), 7::bigint, 'AC7: the refusals wrote no row');

-- AC8: the expiry is enforced.
select pg_temp.doc(:'d5', :'wa');
select pg_temp.doc(:'d6', :'wa');
select pg_temp.share(pg_temp.o(), :'wa', array[:'d5']::uuid[], 'sharing-notice', now() - interval '1 second');
select pg_temp.share(pg_temp.o(), :'wa', array[:'d6']::uuid[], 'sharing-notice', now() + interval '1 hour');
select is(pg_temp.grant_as(:'mem', :'d5', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'AC8: a share that expired one second ago is refused');
select is(pg_temp.grant_as(:'mem', :'d6', p_aal => 'aal1'), 'ok', 'AC8: a share that expires in one hour is allowed');

select * from finish();
rollback;
