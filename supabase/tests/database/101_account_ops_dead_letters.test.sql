-- SA-14 (security review): an abandoned delete_object job keeps its bucket and path as a dead letter, and the
-- reconciliation queries of docs/runbooks/platform-staff.md find every candidate file whose removal did not happen.
begin;
select plan(10);

\ir passport_fixture.inc

\set d1 '00000000-0000-0000-0000-0000000d1401'
\set d2 '00000000-0000-0000-0000-0000000d1402'
\set d3 '00000000-0000-0000-0000-0000000d1403'

select pg_temp.state_as(:'wa', $$select public.create_worker_passport('Amina', 'Okafor', 'NG', 'en')$$, 'aal1') as passport \gset

insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes, scan_status) values
  (:'d1', :'wa', 'cv', 'CV one', :'wa' || '/' || :'d1' || '/cv.pdf', 'cv.pdf', 'application/pdf', 10, 'skipped'),
  (:'d2', :'wa', 'cv', 'CV two', :'wa' || '/' || :'d2' || '/cv.pdf', 'cv.pdf', 'application/pdf', 10, 'skipped'),
  (:'d3', :'wa', 'cv', 'CV three', :'wa' || '/' || :'d3' || '/cv.pdf', 'cv.pdf', 'application/pdf', 10, 'skipped');
insert into storage.objects (bucket_id, name) values
  ('passport-documents', :'wa' || '/' || :'d1' || '/cv.pdf'),
  ('passport-documents', :'wa' || '/' || :'d3' || '/cv.pdf'),
  ('passport-documents', :'wa' || '/00000000-0000-0000-0000-0000000d14ff/lost.pdf');

-- The candidate deletes d1; the removal job fails until it is abandoned.
select is(
  pg_temp.state_as(:'wa', format('select public.delete_worker_document(%L)', :'d1'), 'aal1'), 'ok', 'the candidate deletes a document'
);
select msg_id as job from pgmq.q_account_ops where message ->> 'path' = :'wa' || '/' || :'d1' || '/cv.pdf' \gset
update pgmq.q_account_ops set read_ct = 9, vt = now() - interval '1 second' where msg_id = :'job';
select is((select count(*) from public.account_ops_dequeue(25) d where d.msg_id = :'job'), 0::bigint, 'the job past its attempts is not handed out');
select is(
  (select format('%s|%s', metadata ->> 'action', metadata ->> 'msg_id') from audit.log where action = 'account_ops_abandoned' and entity_id = :'wa'),
  format('delete_object|%s', :'job'), 'it is audited as abandoned with its message id'
);
select is(
  (select metadata::text ~ 'cv\.pdf' from audit.log where action = 'account_ops_abandoned' and entity_id = :'wa'), false,
  'the audit row carries no file name'
);
select is(
  (select format('%s|%s', message ->> 'bucket_id', message ->> 'path') from pgmq.a_account_ops where msg_id = :'job'),
  format('passport-documents|%s/%s/cv.pdf', :'wa', :'d1'), 'the dead letter keeps the bucket and the path'
);
select is((select count(*) from pgmq.q_account_ops where msg_id = :'job'), 0::bigint, 'and the job left the queue');

-- Reconciliation, as in the runbook: deleted documents whose object is still there, and objects without a document.
-- d2's file was removed (it has no object), d3 is live.
update public.worker_documents set deleted_at = now() - interval '2 hours' where id = :'d1';
update public.worker_documents set deleted_at = now() - interval '2 hours' where id = :'d2';
update storage.objects set created_at = now() - interval '2 days' where name like :'wa' || '/%';
select results_eq(
  $$select d.storage_path
    from public.worker_documents d
    join storage.objects o on o.bucket_id = d.bucket_id and o.name = d.storage_path
    where d.deleted_at is not null and d.deleted_at < now() - interval '1 hour'
    order by d.deleted_at
    limit 100$$,
  format($$values (%L)$$, :'wa' || '/' || :'d1' || '/cv.pdf'),
  'the first query lists the deleted document whose file was not removed, and neither a removed nor a live one'
);
select results_eq(
  $$select o.name
    from storage.objects o
    where o.bucket_id = 'passport-documents' and o.created_at < now() - interval '1 day'
      and not exists (select 1 from public.worker_documents d where d.storage_path = o.name)
    order by o.created_at
    limit 100$$,
  format($$values (%L)$$, :'wa' || '/00000000-0000-0000-0000-0000000d14ff/lost.pdf'),
  'the second query lists the file that has no document'
);
select is(
  (select count(*) from (
     select pgmq.send('account_ops', jsonb_build_object(
       'action', 'delete_object', 'user_id', d.worker_user_id, 'bucket_id', d.bucket_id, 'path', d.storage_path,
       'reason', 'reconcile'))
     from public.worker_documents d
     join storage.objects o on o.bucket_id = d.bucket_id and o.name = d.storage_path
     where d.deleted_at is not null and d.deleted_at < now() - interval '1 hour') q),
  1::bigint, 'the runbook statement queues the removal again'
);
select is(
  (select format('%s|%s', message ->> 'action', message ->> 'path') from pgmq.q_account_ops where message ->> 'reason' = 'reconcile'),
  format('delete_object|%s/%s/cv.pdf', :'wa', :'d1'), 'with the bucket and the path of the document'
);

select * from finish();
rollback;
