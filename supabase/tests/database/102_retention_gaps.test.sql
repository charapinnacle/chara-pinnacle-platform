-- SA-13 (security review), NFR-C1, L6, D79: invitations, deleted documents, login failures, the scheduler history and
-- the account-ops dead letters are removed after the period of their row in private.retention_policies, by the daily
-- apply_retention, which audits every rule it ran.
begin;
select plan(23);

\ir jobs_fixture.inc

select pg_temp.state_as(:'wa', $$select public.create_worker_passport('Amina', 'Okafor', 'NG', 'en')$$, 'aal1') as passport \gset

select results_eq(
  $$select entity, days from private.retention_policies
    where entity in ('organization_invitations', 'deleted_worker_documents', 'login_failures', 'cron_job_run_details',
                     'account_ops_archive', 'inactive_worker_data', 'document_access_log', 'audit_log')
    order by entity$$,
  $$values ('account_ops_archive', 90), ('audit_log', 2191), ('cron_job_run_details', 30), ('deleted_worker_documents', 30),
           ('document_access_log', 730), ('inactive_worker_data', 730), ('login_failures', 30), ('organization_invitations', 90)$$,
  'the new periods are rows of retention_policies next to the access log (24 months) and the audit log (6 years)'
);

-- Invitations: closed (accepted or expired) more than 90 days ago go; open and recently closed ones stay.
insert into public.organization_invitations (organization_id, email, role, token_hash, created_at, expires_at, accepted_at) values
  (current_setting('t.a')::uuid, 'old-accepted@example.test', 'member', repeat('a', 64), now() - interval '100 days', now() - interval '93 days', now() - interval '95 days'),
  (current_setting('t.a')::uuid, 'old-expired@example.test', 'member', repeat('b', 64), now() - interval '98 days', now() - interval '91 days', null),
  (current_setting('t.a')::uuid, 'recent-accepted@example.test', 'member', repeat('c', 64), now() - interval '90 days', now() - interval '83 days', now() - interval '89 days'),
  (current_setting('t.a')::uuid, 'open@example.test', 'member', repeat('d', 64), now() - interval '1 day', now() + interval '6 days', null);

-- Documents: deleted more than 30 days ago and without a file go; one whose file is still there, a recent deletion and a
-- live document stay.
insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes, deleted_at)
select d.id, :'wa', 'cv', d.title, :'wa' || '/' || d.id || '/cv.pdf', 'cv.pdf', 'application/pdf', 10, d.deleted_at
from (values
  ('00000000-0000-0000-0000-00000000e001'::uuid, 'Old gone', now() - interval '31 days'),
  ('00000000-0000-0000-0000-00000000e002'::uuid, 'Old with file', now() - interval '31 days'),
  ('00000000-0000-0000-0000-00000000e003'::uuid, 'Recent', now() - interval '29 days'),
  ('00000000-0000-0000-0000-00000000e004'::uuid, 'Live', null::timestamptz)
) as d (id, title, deleted_at);
insert into storage.objects (bucket_id, name) values ('passport-documents', :'wa' || '/00000000-0000-0000-0000-00000000e002/cv.pdf');

-- Login failures, scheduler history and dead letters: one row past the period and one within it each.
insert into private.login_failures (user_id, window_started_at, failures) values
  (:'wa', now() - interval '31 days', 3), (:'wb', now() - interval '1 day', 2);
insert into cron.job_run_details (jobid, runid, command, status, start_time, end_time) values
  (null, -101, 'select 1', 'succeeded', now() - interval '31 days', now() - interval '31 days'),
  (null, -102, 'select 1', 'succeeded', now() - interval '1 day', now() - interval '1 day');
insert into pgmq.a_account_ops (msg_id, read_ct, enqueued_at, archived_at, vt, message) values
  (-201, 9, now() - interval '92 days', now() - interval '91 days', now(), '{"action": "delete_object"}'),
  (-202, 9, now() - interval '3 days', now() - interval '2 days', now(), '{"action": "delete_object"}');

select private.apply_retention();

select results_eq(
  $$select email::text from public.organization_invitations where email like '%@example.test' order by email$$,
  $$values ('open@example.test'), ('recent-accepted@example.test')$$,
  'the invitations closed more than 90 days ago are gone, the open and the recent ones stay'
);
select results_eq(
  $$select title from public.worker_documents where worker_user_id = '00000000-0000-0000-0000-00000000a101' order by title$$,
  $$values ('Live'), ('Old with file'), ('Recent')$$,
  'the old deleted document without a file is gone; the one whose file is still there, the recent one and the live one stay'
);
select results_eq(
  $$select user_id::text from private.login_failures where user_id in ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000a102')$$,
  $$values ('00000000-0000-0000-0000-00000000a102')$$,
  'the login failures of a window 31 days ago are gone, yesterday''s stay'
);
select results_eq($$select runid from cron.job_run_details where runid < 0$$, $$values (-102::bigint)$$, 'the scheduler history keeps 30 days');
select results_eq($$select msg_id from pgmq.a_account_ops where msg_id < 0$$, $$values (-202::bigint)$$, 'the dead letters keep 90 days');

select results_eq(
  $$select entity_id, (metadata ->> 'days')::int, (metadata ->> 'removed')::int
    from audit.log where action = 'retention.run'
      and entity_id in ('organization_invitations', 'deleted_worker_documents', 'login_failures', 'cron_job_run_details', 'account_ops_archive')
    order by entity_id$$,
  $$values ('account_ops_archive', 90, 1), ('cron_job_run_details', 30, 1), ('deleted_worker_documents', 30, 1),
           ('login_failures', 30, 1), ('organization_invitations', 90, 2)$$,
  'each rule writes one audit row with its period and the number removed'
);
select is(
  (select count(*) from audit.log where action = 'retention.run' and actor_id is null), 11::bigint,
  'eleven rules ran, all without an actor'
);

-- Idempotent, configurable, and a missing row skips its rule.
select private.apply_retention();
select is(
  (select count(*) from audit.log where action = 'retention.run'
     and entity_id in ('organization_invitations', 'deleted_worker_documents', 'login_failures', 'cron_job_run_details', 'account_ops_archive')
     and (metadata ->> 'removed')::int = 0),
  5::bigint, 'a second run the same day removes nothing'
);
update private.retention_policies set days = 20 where entity = 'deleted_worker_documents';
update private.retention_policies set days = 80 where entity = 'organization_invitations';
delete from private.retention_policies where entity = 'login_failures';
insert into private.login_failures (user_id, window_started_at, failures) values (:'wnew', now() - interval '400 days', 1);
select private.apply_retention();
select results_eq(
  $$select title from public.worker_documents where worker_user_id = '00000000-0000-0000-0000-00000000a101' order by title$$,
  $$values ('Live'), ('Old with file')$$,
  'a shorter period applies at the next run'
);
select results_eq(
  $$select email::text from public.organization_invitations where email like '%@example.test' order by email$$,
  $$values ('open@example.test')$$,
  'for every entity'
);
select is((select count(*) from private.login_failures where user_id = :'wnew'), 1::bigint, 'an entity without a row is kept');
select is(
  (select count(*) from audit.log where action = 'retention.run' and entity_id = 'login_failures'), 2::bigint,
  'and its rule writes no audit row'
);

-- Shape: the job stays the database's own, the deletes have indexes, the daily schedule is unchanged.
select ok(
  not has_function_privilege('anon', 'private.apply_retention()', 'execute')
  and not has_function_privilege('authenticated', 'private.apply_retention()', 'execute')
  and not has_function_privilege('service_role', 'private.apply_retention()', 'execute'),
  'no API role can run the retention job'
);
select is(
  (select proconfig from pg_proc where oid = 'private.apply_retention()'::regprocedure), array['search_path=""'],
  'the job sets search_path to empty'
);
select has_index('public', 'organization_invitations', 'organization_invitations_closed_at_idx', 'the invitation rule reads an index');
select has_index('public', 'worker_documents', 'worker_documents_deleted_at_idx', 'the document rule reads an index');
select is(
  (select count(*) from pg_indexes where schemaname = 'private' and tablename = 'login_failures' and indexdef ~ 'window_started_at'), 0::bigint,
  'the login failure rule scans its small table, so failed logins stay HOT updates'
);
select has_index('pgmq', 'a_account_ops', 'archived_at_idx_account_ops', 'the dead letter rule reads the queue''s own index');
select is(
  (select count(*) from cron.job where jobname = 'apply-retention' and schedule = '17 3 * * *' and command = 'select private.apply_retention()' and active),
  1::bigint, 'the retention job runs daily'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.retention_policies'::regclass)
  and not has_table_privilege('authenticated', 'private.retention_policies', 'select, insert, update, delete'),
  'the periods stay unreadable for API roles'
);
select is(
  (select count(*) from private.retention_policies), 11::bigint,
  'twelve entities have a period, less the one removed above'
);
select is(
  (select days from private.retention_policies where entity = 'document_access_log'), 730,
  'the access log keeps 24 months (G-07, D79)'
);

select * from finish();
rollback;
