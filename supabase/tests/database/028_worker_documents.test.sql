begin;
select plan(86);

\ir passport_fixture.inc

\set d1 '00000000-0000-0000-0000-0000000d0001'
\set d2 '00000000-0000-0000-0000-0000000d0002'
\set d3 '00000000-0000-0000-0000-0000000d0003'
\set d4 '00000000-0000-0000-0000-0000000d0004'
\set d5 '00000000-0000-0000-0000-0000000d0005'
\set d6 '00000000-0000-0000-0000-0000000d0006'
\set unknown '00000000-0000-0000-0000-0000000d00ff'

select is(
  pg_temp.call_as(:'wa', 'authenticated', $$select public.create_worker_passport('Amina', 'Okafor', 'NG', 'en')$$, 'aal1'),
  'ok', 'setup: candidate A has a passport'
);
select is(
  pg_temp.call_as(:'wb', 'authenticated', $$select public.create_worker_passport('Bruno', 'Silva', 'PT', 'en')$$, 'aal1'),
  'ok', 'setup: candidate B has a passport'
);

-- Inserts a document row as p_user and returns the SQLSTATE or 'ok'. The defaults make a valid CV; each argument breaks
-- one rule. p_expires is SQL text.
create function pg_temp.new_doc(
  p_user uuid, p_id uuid default gen_random_uuid(), p_type text default 'cv', p_title text default 'My CV',
  p_size integer default 1000, p_mime text default 'application/pdf', p_expires text default 'null',
  p_path text default null, p_columns text default '', p_values text default ''
) returns text
language sql as $$
  select pg_temp.state_as(p_user, format(
    $f$insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes, expires_on%s)
       values (%L, %L, %L, %L, %L, 'cv.pdf', %L, %s, %s%s)$f$,
    p_columns, p_id, p_user, p_type, p_title, coalesce(p_path, p_user || '/' || p_id || '/cv.pdf'), p_mime, p_size,
    p_expires, p_values), 'aal1')
$$;

-- AC4: what a candidate may insert
select is(pg_temp.new_doc(:'wa', :'d1', 'cv'), 'ok', 'AC4: type cv is accepted');
select is(pg_temp.new_doc(:'wa', :'d2', 'certificate'), 'ok', 'AC4: type certificate is accepted');
select is(pg_temp.new_doc(:'wa', p_type => 'passport'), '22P02', 'AC4: type passport is refused');
select is(pg_temp.new_doc(:'wa', p_title => ''), '23514', 'AC4: a title of 0 characters is refused');
select is(pg_temp.new_doc(:'wa', p_title => 'x'), 'ok', 'AC4: a title of 1 character is accepted');
select is(pg_temp.new_doc(:'wa', p_title => repeat('x', 120)), 'ok', 'AC4: a title of 120 characters is accepted');
select is(pg_temp.new_doc(:'wa', p_title => repeat('x', 121)), '23514', 'AC4: a title of 121 characters is refused');
select is(pg_temp.new_doc(:'wa', p_title => ' padded '), '23514', 'AC4: a title with surrounding spaces is refused');
select is(pg_temp.new_doc(:'wa', p_title => 'bell' || chr(7)), '23514', 'AC4: a title with a control character is refused');
select is(pg_temp.new_doc(:'wa', p_size => 0), '23514', 'AC4: size 0 is refused');
select is(pg_temp.new_doc(:'wa', p_size => 15728640), 'ok', 'AC4: size 15728640 is accepted');
select is(pg_temp.new_doc(:'wa', p_size => 15728641), '23514', 'AC4: size 15728641 is refused');
select is(pg_temp.new_doc(:'wa', p_mime => 'image/gif'), '23514', 'AC4: image/gif is refused');
select is(pg_temp.new_doc(:'wa', p_mime => 'image/png'), 'ok', 'AC4: image/png is accepted');
select is(
  pg_temp.new_doc(:'wa', p_expires => $$(now() at time zone 'utc')::date + 30$$), '23514',
  'AC4: an expiry date on a CV is refused'
);
select is(
  pg_temp.new_doc(:'wa', p_type => 'certificate', p_expires => $$(now() at time zone 'utc')::date - 1$$), 'ok',
  'AC4: an expiry date of yesterday is accepted for a certificate'
);
select is(
  pg_temp.new_doc(:'wa', p_type => 'certificate', p_expires => $$((now() at time zone 'utc')::date + interval '50 years')::date$$), 'ok',
  'AC4: an expiry date of today plus 50 years is accepted'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', format(
    $f$insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes, expires_on)
       values (%L, %L, 'certificate', 'Late', %L, 'cv.pdf', 'application/pdf', 1000,
               ((now() at time zone 'utc')::date + interval '50 years')::date + 1)$f$,
    :'d6', :'wa', :'wa' || '/' || :'d6' || '/cv.pdf'), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|expires_on', 'AC4: an expiry date of today plus 50 years and one day is refused'
);
update private.settings set value = '1' where key = 'worker_document_expiry_max_years';
select is(
  pg_temp.new_doc(:'wa', p_type => 'certificate', p_expires => $$(now() at time zone 'utc')::date + 400$$), 'P0001',
  'AC4: the window is read from the setting'
);
update private.settings set value = '50' where key = 'worker_document_expiry_max_years';
select is(
  pg_temp.new_doc(:'wa', p_path => :'wa' || '/' || gen_random_uuid() || '/cv.pdf'), '23514',
  'AC4: a storage path with another document id is refused'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes)
    values (%L, %L, 'cv', 'Other', %L, 'cv.pdf', 'application/pdf', 1)$$, :'d6', :'wb', :'wb' || '/' || :'d6' || '/cv.pdf')),
  '42501', 'AC4: A cannot insert a row for B'
);
select is(pg_temp.new_doc(:'wa', :'d6', p_path => 'cv.pdf'), '23514', 'AC4: a bare path is refused');
select is(
  pg_temp.new_doc(:'wa', p_columns => ', bucket_id', p_values => ', ''other-bucket'''), '42501',
  'AC4: the bucket cannot be chosen'
);
select is(
  pg_temp.new_doc(:'wa', p_columns => ', scan_status', p_values => ', ''clean'''), '42501',
  'AC4: an insert with scan status clean is refused'
);
select is(
  pg_temp.new_doc(:'wa', p_columns => ', deleted_at', p_values => ', now()'), '42501',
  'AC4: an insert that is already deleted is refused'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes)
    values (%L, %L, 'cv', 'Other', %L, 'a b.pdf', 'application/pdf', 1)$$, :'d6', :'wa', :'wa' || '/' || :'d6' || '/a b.pdf')),
  '23514', 'AC4: a file name outside A-Z, a-z, 0-9, dot, underscore and hyphen is refused'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes)
    values (%L, %L, 'cv', 'Other', %L, %L, 'application/pdf', 1)$$, :'d6', :'wa',
    :'wa' || '/' || :'d6' || '/' || repeat('a', 101), repeat('a', 101))),
  '23514', 'AC4: a file name of 101 characters is refused'
);
select is(pg_temp.new_doc(:'own1'), '42501', 'AC4: a company user cannot insert a row');
select is(pg_temp.new_doc(:'wsus', :'d6'), '23503', 'a worker with no passport cannot insert a row');
select is(pg_temp.call_as(null, 'anon', 'select 1 from public.worker_documents', 'aal1'), '42501|permission denied for table worker_documents|', 'AC4: anon is refused');

select is(
  (select array[scan_status, (deleted_at is null)::text, (created_at is not null)::text, bucket_id] from public.worker_documents where id = :'d1'),
  array['pending', 'true', 'true', 'passport-documents'], 'AC4: a new row is pending, not deleted, dated and in the bucket'
);

-- AC4: what the owner may change
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$update public.worker_documents set title = 'CV English' where id = %L$$, :'d1')),
  1::bigint, 'AC4: A changes the title'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$update public.worker_documents set expires_on = (now() at time zone 'utc')::date + 20 where id = %L$$, :'d2')),
  1::bigint, 'AC4: A changes the expiry date of a certificate'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_documents set expires_on = (now() at time zone 'utc')::date + 20 where id = %L$$, :'d1')),
  '23514', 'AC4: A cannot give a CV an expiry date'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_documents set title = repeat('x', 121) where id = %L$$, :'d1')),
  '23514', 'AC4: A cannot set a title of 121 characters'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_documents set title = '' where id = %L$$, :'d1')),
  '23514', 'AC4: A cannot set an empty title'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_documents set storage_path = %L where id = %L$$, :'wa' || '/' || :'d1' || '/x.pdf', :'d1')),
  '42501', 'AC4: A cannot change the storage path'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_documents set scan_status = 'clean' where id = %L$$, :'d1')),
  '42501', 'AC4: A cannot change the scan status'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_documents set worker_user_id = %L where id = %L$$, :'wb', :'d1')),
  '42501', 'AC4: A cannot move a document to B'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_documents set deleted_at = now() where id = %L$$, :'d1')),
  '42501', 'AC4: A cannot set deleted_at'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_documents set bucket_id = 'x' where id = %L$$, :'d1')),
  '42501', 'AC4: A cannot change the bucket'
);
select is(
  pg_temp.state_as(:'wa', format($$delete from public.worker_documents where id = %L$$, :'d1')),
  '42501', 'AC4: A cannot delete a row directly'
);
select is(
  (select title from public.worker_documents where id = :'d1'), 'CV English', 'AC4: the refused statements changed nothing but the title'
);

-- AC4: document_set_scan_status
select is(pg_temp.new_doc(:'wa', :'d3'), 'ok', 'setup: document d3');
select is(pg_temp.new_doc(:'wa', :'d4'), 'ok', 'setup: document d4');
select is(pg_temp.new_doc(:'wa', :'d5'), 'ok', 'setup: document d5');
select is(
  pg_temp.call_as(null, 'service_role', format($$select public.document_set_scan_status(%L, 'skipped')$$, :'d3'), 'aal1'),
  'ok', 'AC4: service_role may call document_set_scan_status'
);
select is((select scan_status from public.worker_documents where id = :'d3'), 'skipped', 'AC4: a pending row moves to skipped');
select is(public.document_set_scan_status(:'d4', 'rejected'), 'rejected', 'AC4: a pending row moves to rejected');
select is((select scan_status from public.worker_documents where id = :'d4'), 'rejected', 'AC4: and is stored as rejected');
select is(
  public.document_set_scan_status(:'d3', 'rejected'), 'skipped',
  'AC4: a repeat leaves the skipped row as it is and returns its status'
);
select is((select scan_status from public.worker_documents where id = :'d3'), 'skipped', 'AC4: a webhook retry changes nothing');
select is(
  pg_temp.call_as(null, 'service_role', format($$select public.document_set_scan_status(%L, 'bogus')$$, :'d5'), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|status', 'AC4: the status bogus is refused'
);
select is(
  pg_temp.call_as(null, 'service_role', format($$select public.document_set_scan_status(%L, 'pending')$$, :'d5'), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|status', 'AC4: a call cannot set a row back to pending'
);
select is(
  pg_temp.call_as(null, 'service_role', format($$select public.document_set_scan_status(%L, 'skipped')$$, :'unknown'), 'aal1'),
  'P0002|CHARA_NOT_FOUND|', 'AC4: an unknown id raises CHARA_NOT_FOUND'
);
select is(
  pg_temp.state_as(:'wa', format($$select public.document_set_scan_status(%L, 'clean')$$, :'d5')),
  '42501', 'AC4: A may not call document_set_scan_status'
);
select is(
  pg_temp.call_as(null, 'anon', format($$select public.document_set_scan_status(%L, 'clean')$$, :'d5'), 'aal1') like '42501|%',
  true, 'AC4: anon may not call document_set_scan_status'
);
select is((select scan_status from public.worker_documents where id = :'d5'), 'pending', 'AC4: the refused calls changed nothing');

-- AC9 (without shares, which a later unit adds): the deletion and its queued object removal
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$select public.delete_worker_document(%L)$$, :'d5'), 'aal1'),
  'ok', 'AC9: the owner deletes a document'
);
select is(
  (select deleted_at is not null from public.worker_documents where id = :'d5'), true, 'AC9: deleted_at is set'
);
select is(
  (select count(*) from pgmq.q_account_ops
   where message = jsonb_build_object('action', 'delete_object', 'user_id', :'wa'::uuid, 'bucket_id', 'passport-documents',
                                      'path', :'wa' || '/' || :'d5' || '/cv.pdf')),
  1::bigint, 'AC9: exactly one object removal is queued'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$select 1 from public.worker_documents where id = %L$$, :'d5')),
  0::bigint, 'AC9: the deleted row is hidden from its owner'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$update public.worker_documents set title = 'Back' where id = %L$$, :'d5')),
  0::bigint, 'AC9: a deleted row cannot be renamed'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$select public.delete_worker_document(%L)$$, :'d5'), 'aal1'),
  'P0002|CHARA_NOT_FOUND|', 'AC9: a second delete by the owner raises CHARA_NOT_FOUND'
);
select is(
  pg_temp.call_as(:'wb', 'authenticated', format($$select public.delete_worker_document(%L)$$, :'d3'), 'aal1'),
  'P0002|CHARA_NOT_FOUND|', 'AC9: another candidate gets CHARA_NOT_FOUND for a document of A'
);
select is(
  split_part(pg_temp.call_as(:'own1', 'authenticated', format($$select public.delete_worker_document(%L)$$, :'d3'), 'aal2'), '|', 1 ) || '|' ||
  split_part(pg_temp.call_as(:'own1', 'authenticated', format($$select public.delete_worker_document(%L)$$, :'d3'), 'aal2'), '|', 2),
  'P0001|CHARA_FORBIDDEN', 'AC9: a company user gets CHARA_FORBIDDEN'
);
select is(
  pg_temp.call_as(null, 'anon', format($$select public.delete_worker_document(%L)$$, :'d3'), 'aal1') like '42501|%',
  true, 'AC9: anon may not call delete_worker_document'
);
select is(
  (select count(*) from pgmq.q_account_ops where message ->> 'action' = 'delete_object'), 1::bigint,
  'AC9: none of the refused calls queued a job'
);
select is(
  public.document_set_scan_status(:'d5', 'skipped'), 'pending', 'a scan result for a deleted row leaves it as it is'
);

-- AC11: audit rows, without the title or the file name
select is(
  (select array_agg(action order by id) from audit.log where entity_type = 'worker_documents' and entity_id = :'d1'),
  array['document.created', 'document.renamed'], 'AC11: creation and rename are audited'
);
select is(
  (select array_agg(action order by id) from audit.log where entity_type = 'worker_documents' and entity_id = :'d5'),
  array['document.created', 'document.deleted'], 'AC11: deletion is audited'
);
select is(
  (select array_agg(action order by id) from audit.log where entity_type = 'worker_documents' and entity_id = :'d4'),
  array['document.created', 'document.scanned'], 'the scan verdict is audited'
);
select is(
  (select metadata from audit.log where action = 'document.scanned' and entity_id = :'d4'),
  '{"type": "cv", "scan_status": "rejected"}'::jsonb, 'the verdict row holds the type and the status'
);
select is(
  (select count(*) from audit.log where entity_type = 'worker_documents' and entity_id = :'d3' and action = 'document.scanned'),
  1::bigint, 'a repeated verdict writes no second row'
);
select is(
  (select array_agg(distinct metadata::text) from audit.log where action in ('document.created', 'document.renamed', 'document.deleted')
     and entity_id = :'d1'),
  array['{"type": "cv"}'], 'AC11: the metadata holds the document type only'
);
select is(
  (select count(*) from audit.log where entity_type = 'worker_documents' and (metadata::text like '%CV English%' or metadata::text like '%cv.pdf%')),
  0::bigint, 'AC11: no audit row holds a title or a file name'
);
select is(
  (select actor_id from audit.log where action = 'document.deleted' and entity_id = :'d5'), :'wa'::uuid,
  'AC11: the candidate is the actor of the deletion'
);
select is(
  (select actor_id from audit.log where action = 'document.renamed' and entity_id = :'d1'), :'wa'::uuid,
  'AC11: and of the rename'
);
select throws_ok(
  $$update audit.log set action = 'x' where action = 'document.created'$$, '42501', 'audit.log is append-only',
  'AC11: an audit row cannot be updated'
);
select throws_ok(
  $$delete from audit.log where action = 'document.deleted'$$, '42501', 'audit.log is append-only',
  'AC11: or deleted'
);

-- Grants and indexes
select is(
  (select count(*) from pg_class c where c.oid = 'public.worker_documents'::regclass
     and (has_table_privilege('service_role', c.oid, 'select, insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege('service_role', c.oid, 'select, insert, update, references')
       or has_any_column_privilege('anon', c.oid, 'select, insert, update'))),
  0::bigint, 'service_role and anon have no grant on worker_documents'
);
select has_index('public', 'worker_documents', 'worker_documents_owner_created_idx', 'the list has its index');
select has_index('public', 'worker_documents', 'worker_documents_owner_expiry_idx', 'the reminders have their index');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('delete_worker_document', 'document_set_scan_status')
     and p.prosecdef and p.proconfig = array['search_path=""']),
  2::bigint, 'both RPCs are security definer with an empty search_path'
);

select * from finish();
rollback;
