begin;
select plan(26);

\ir passport_fixture.inc

\set d1 '00000000-0000-0000-0000-0000000d0001'
\set stranger '00000000-0000-0000-0000-0000000d00aa'

select is(pg_temp.call_as(:'wa', 'authenticated', $$select public.create_worker_passport('Amina', 'Okafor', 'NG', 'en')$$, 'aal1'), 'ok', 'setup: candidate A has a passport');
select is(pg_temp.call_as(:'wb', 'authenticated', $$select public.create_worker_passport('Bruno', 'Silva', 'PT', 'en')$$, 'aal1'), 'ok', 'setup: candidate B has a passport');
insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes)
values (:'d1', :'wa', 'cv', 'My CV', :'wa' || '/' || :'d1' || '/cv.pdf', 'cv.pdf', 'application/pdf', 1000);

-- AC3: the bucket
select is((select public from storage.buckets where id = 'passport-documents'), false, 'AC3: the bucket is private');
select is((select file_size_limit from storage.buckets where id = 'passport-documents'), 15728640::bigint, 'AC3: the size limit is 15 MB');
select is(
  (select allowed_mime_types from storage.buckets where id = 'passport-documents'),
  array['application/pdf', 'image/jpeg', 'image/png'], 'AC3: the allowed types are PDF, JPEG and PNG'
);

-- AC3: the policies
select set_eq(
  $$select policyname::text from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) like '%passport-documents%'$$,
  $$values ('passport_docs_owner_select'), ('passport_docs_owner_insert'), ('passport_docs_owner_delete')$$,
  'AC3: the only policies of the bucket are the three owner policies'
);
select set_eq(
  $$select policyname::text || ':' || cmd || ':' || roles::text from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) like '%passport-documents%'$$,
  $$values ('passport_docs_owner_select:SELECT:{authenticated}'), ('passport_docs_owner_insert:INSERT:{authenticated}'),
           ('passport_docs_owner_delete:DELETE:{authenticated}')$$,
  'AC3: they are for authenticated users and for select, insert and delete only (none for anon or update)'
);
select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'passport_docs%' and ('anon' = any (roles::text[]) or 'public' = any (roles::text[]) or 'service_role' = any (roles::text[]))),
  0::bigint, 'AC3: no policy names anon, public or service_role'
);

-- AC3: metadata first
select is(
  pg_temp.state_as(:'wa', format($$insert into storage.objects (bucket_id, name) values ('passport-documents', %L)$$, :'wa' || '/' || :'d1' || '/cv.pdf'), 'aal1'),
  'ok', 'AC3: A uploads under the id of the own row'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into storage.objects (bucket_id, name) values ('passport-documents', %L)$$, :'wa' || '/' || gen_random_uuid() || '/cv.pdf'), 'aal1'),
  '42501', 'AC3: an id with no row is refused'
);
select is(
  pg_temp.state_as(:'wb', format($$insert into storage.objects (bucket_id, name) values ('passport-documents', %L)$$, :'wa' || '/' || :'d1' || '/cv.pdf'), 'aal1'),
  '42501', 'AC3: B cannot upload into the folder of A'
);
select is(
  pg_temp.state_as(:'wb', format($$insert into storage.objects (bucket_id, name) values ('passport-documents', %L)$$, :'wb' || '/' || :'d1' || '/cv.pdf'), 'aal1'),
  '42501', 'AC3: B cannot use the row id of A in the own folder'
);
select is(
  pg_temp.call_as(null, 'anon', format($$insert into storage.objects (bucket_id, name) values ('passport-documents', %L)$$, :'wa' || '/' || :'d1' || '/cv.pdf'), 'aal1') like '42501|%',
  true, 'AC3: anon cannot upload'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into storage.objects (bucket_id, name) values ('passport-documents', %L)$$, :'wa' || '/cv.pdf'), 'aal1'),
  '42501', 'AC3: an object outside a document folder is refused'
);
update public.worker_documents set deleted_at = now() where id = :'d1';
select is(
  pg_temp.state_as(:'wa', format($$insert into storage.objects (bucket_id, name) values ('passport-documents', %L)$$, :'wa' || '/' || :'d1' || '/cv2.pdf'), 'aal1'),
  '42501', 'AC3: a deleted row accepts no further object'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'passport-documents'), 1::bigint,
  'AC3: only the first insert of A succeeded'
);

-- The webhook to scan-document
select is((select count(*) from net.http_request_queue), 0::bigint, 'no webhook is queued without the Vault secrets');
select vault.create_secret('https://project.example.test/', 'project_url');
set local client_min_messages = error;
insert into storage.objects (bucket_id, name) values ('passport-documents', :'wa' || '/' || :'d1' || '/one.pdf');
set local client_min_messages = notice;
select is((select count(*) from net.http_request_queue), 0::bigint, 'none is queued with only the project URL');
select vault.create_secret('shared-secret-value', 'edge_shared_secret');
insert into storage.buckets (id, name) values ('other-bucket', 'other-bucket');
insert into storage.objects (bucket_id, name) values ('other-bucket', 'x/y/z.pdf');
select is((select count(*) from net.http_request_queue), 0::bigint, 'an object of another bucket queues nothing');
insert into storage.objects (bucket_id, name, metadata)
values ('passport-documents', :'wa' || '/' || :'d1' || '/two.pdf', '{"mimetype": "application/pdf"}');
select is(
  (select format('%s|%s|%s|%s', count(*), min(method::text), min(url), min(headers ->> 'x-edge-secret')) from net.http_request_queue),
  '1|POST|https://project.example.test/functions/v1/scan-document|shared-secret-value',
  'a new object of the bucket queues one POST to scan-document with the shared secret'
);
select is(
  (select convert_from(body, 'utf8')::jsonb -> 'record' ->> 'name' from net.http_request_queue),
  :'wa' || '/' || :'d1' || '/two.pdf', 'the body names the object'
);
select is(
  (select convert_from(body, 'utf8')::jsonb ->> 'type' || '|' || (convert_from(body, 'utf8')::jsonb -> 'record' -> 'metadata' ->> 'mimetype')
   from net.http_request_queue),
  'INSERT|application/pdf', 'the body is shaped like a database webhook and carries the stored content type'
);
select is(
  (select count(*) from pg_trigger where tgname = 'passport_documents_scan' and tgenabled = 'O'), 1::bigint,
  'the webhook trigger is on storage.objects'
);
select ok(
  not has_function_privilege('authenticated', 'private.scan_document_webhook()', 'execute')
  and not has_function_privilege('service_role', 'private.scan_document_webhook()', 'execute'),
  'no API role can run the webhook function'
);

-- Reading is limited to the own folder (storage.protect_delete blocks a SQL delete for everyone, so removal is the Storage API's)
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$select 1 from storage.objects where bucket_id = 'passport-documents' and name like %L$$, :'wa' || '/%')),
  3::bigint, 'the owner sees the objects of the own folder'
);
select is(
  pg_temp.affected_as(:'wb', 'authenticated', format($$select 1 from storage.objects where bucket_id = 'passport-documents' and name like %L$$, :'wa' || '/%')),
  0::bigint, 'another candidate sees none of them'
);
select * from finish();
rollback;
