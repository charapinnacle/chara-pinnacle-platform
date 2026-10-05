begin;
select plan(16);

\ir passport_fixture.inc

\set d1 '00000000-0000-0000-0000-0000000d0001'

select is(pg_temp.call_as(:'wa', 'authenticated', $$select public.create_worker_passport('Amina', 'Okafor', 'NG', 'en')$$, 'aal1'), 'ok', 'setup: candidate A has a passport');
select is(pg_temp.call_as(:'wb', 'authenticated', $$select public.create_worker_passport('Bruno', 'Silva', 'PT', 'en')$$, 'aal1'), 'ok', 'setup: candidate B has a passport');
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.o', (public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'DE', 'F'))->>'organization_id', true)$$, 'aal1'), 'ok', 'setup: organization O');
select is(pg_temp.call_as(:'own2', 'authenticated',
  $$select public.create_organization('employer', 'Beta Works Ltd', 'Beta Works', 'GB', 'F')$$, 'aal1'), 'ok', 'setup: another organization');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.o')::uuid, :'adm', 'admin', now()), (current_setting('t.o')::uuid, :'mem', 'member', now());
insert into public.platform_staff (user_id, role) values (:'slg', 'admin'), (:'adm2', 'verification_reviewer'), (:'late', 'trust_safety');

insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes)
values (:'d1', :'wa', 'cv', 'My CV', :'wa' || '/' || :'d1' || '/cv.pdf', 'cv.pdf', 'application/pdf', 1000);
insert into storage.objects (bucket_id, name) values ('passport-documents', :'wa' || '/' || :'d1' || '/cv.pdf');
select set_config('t.a', :'wa', true);
select set_config('t.d', :'d1', true);
select set_config('storage.allow_delete_query', 'true', true);

create function pg_temp.count_as(p_user uuid, p_role text, p_sql text, p_aal text) returns text
language plpgsql as $$
begin
  return pg_temp.affected_as(p_user, p_role, p_sql, p_aal)::text;
exception when others then
  reset role;
  return 'E' || sqlstate;
end;
$$;

-- What a principal can do with the row and the object of candidate A: rows read, updated and deleted from the table and
-- the storage objects, and the state of an insert of a row for A.
create function pg_temp.probe(p_user uuid, p_role text, p_aal text default 'aal2') returns text
language sql as $$
  select format('table: select=%s update=%s delete=%s insert=%s; objects: select=%s delete=%s',
    pg_temp.count_as(p_user, p_role, format('select 1 from public.worker_documents where worker_user_id = %L', current_setting('t.a')), p_aal),
    pg_temp.count_as(p_user, p_role, format('update public.worker_documents set title = ''x'' where worker_user_id = %L', current_setting('t.a')), p_aal),
    pg_temp.count_as(p_user, p_role, format('delete from public.worker_documents where worker_user_id = %L', current_setting('t.a')), p_aal),
    split_part(pg_temp.call_as(p_user, p_role, format(
      $f$insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes)
         values (gen_random_uuid(), %L, 'cv', 'x', %L || '/' || gen_random_uuid() || '/cv.pdf', 'cv.pdf', 'application/pdf', 1)$f$,
      current_setting('t.a'), current_setting('t.a')), p_aal), '|', 1),
    pg_temp.count_as(p_user, p_role, format('select 1 from storage.objects where bucket_id = ''passport-documents'' and name like %L', current_setting('t.a') || '/%'), p_aal),
    pg_temp.count_as(p_user, p_role, format('delete from storage.objects where bucket_id = ''passport-documents'' and name like %L', current_setting('t.a') || '/%'), p_aal))
$$;

-- The insert is refused by the row policy (42501) except where it fails on the foreign key first (23503)
create function pg_temp.denied(p_insert text) returns text language sql as $$
  select format('table: select=0 update=0 delete=E42501 insert=%s; objects: select=0 delete=0', p_insert)
$$;

select is(pg_temp.probe(:'own1', 'authenticated'), pg_temp.denied('42501'), 'AC10: an employer owner sees and changes nothing');
select is(pg_temp.probe(:'adm', 'authenticated'), pg_temp.denied('42501'), 'AC10: an employer admin sees and changes nothing');
select is(pg_temp.probe(:'mem', 'authenticated', 'aal1'), pg_temp.denied('42501'), 'AC10: an employer member sees and changes nothing');
select is(pg_temp.probe(:'own2', 'authenticated'), pg_temp.denied('42501'), 'AC10: a company user of another organization sees and changes nothing');
select is(pg_temp.probe(:'slg', 'authenticated'), pg_temp.denied('42501'), 'AC10: a platform administrator at aal2 sees and changes nothing');
select is(pg_temp.probe(:'adm2', 'authenticated'), pg_temp.denied('42501'), 'AC10: a verification reviewer at aal2 sees and changes nothing');
select is(pg_temp.probe(:'late', 'authenticated'), pg_temp.denied('42501'), 'AC10: a trust and safety administrator at aal2 sees and changes nothing');
select is(pg_temp.probe(:'wb', 'authenticated', 'aal1'), pg_temp.denied('42501'), 'AC10: another candidate sees and changes nothing');
select is(
  pg_temp.probe(null, 'anon'),
  'table: select=E42501 update=E42501 delete=E42501 insert=42501; objects: select=0 delete=0',
  'AC10: anonymous is refused by missing grants and sees no object'
);
select is(
  (select format('%s %s', (select count(*) from public.worker_documents), (select count(*) from storage.objects where bucket_id = 'passport-documents'))),
  '1 1', 'AC10: the refused and empty statements changed nothing'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$select 1 from public.worker_documents where id = %L$$, :'d1'), 'aal1')
  + pg_temp.affected_as(:'wa', 'authenticated', format($$select 1 from storage.objects where bucket_id = 'passport-documents' and name like %L$$, :'wa' || '/%'), 'aal1'),
  2::bigint, 'AC10: the owner reads the own row and object'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$delete from storage.objects where bucket_id = 'passport-documents' and name like %L$$, :'wa' || '/%'), 'aal1'),
  1::bigint, 'AC10: and may remove the own object'
);

select * from finish();
rollback;
