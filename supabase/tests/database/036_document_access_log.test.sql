begin;
select plan(79);

\ir privacy_fixture.inc

create function pg_temp.o() returns uuid language sql as $$ select current_setting('t.o')::uuid $$;
create function pg_temp.p() returns uuid language sql as $$ select current_setting('t.p')::uuid $$;
create function pg_temp.logged() returns bigint language sql as $$ select count(*) from audit.document_access_log $$;
create function pg_temp.listed(p_user uuid, p_role text default 'authenticated') returns bigint
language sql as $$ select pg_temp.affected_as(p_user, p_role, 'select 1 from public.v_my_document_access_log') $$;

-- Candidate A shared d1 with O and d2 with P, candidate B shared dc with O.
select pg_temp.doc(:'d1', :'wa');
select pg_temp.doc(:'d2', :'wa');
select pg_temp.doc(:'dc', :'wb');
select pg_temp.share(pg_temp.o(), :'wa', array[:'d1']::uuid[]);
select pg_temp.share(pg_temp.p(), :'wa', array[:'d2']::uuid[]);
select pg_temp.share(pg_temp.o(), :'wb', array[:'dc']::uuid[]);

select is(
  (select value #>> '{}' from private.settings where key = 'document_access_repeat_seconds'), '10',
  'a caller who repeats a call within 10 seconds is logged once by default'
);
update private.settings set value = '0' where key = 'document_access_repeat_seconds';

select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'ok', 'setup: a member of O opens d1');
select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'ok', 'setup: and again');
select is(pg_temp.grant_as(:'own2', :'d2'), 'ok', 'setup: an owner of P opens d2');
select is(pg_temp.grant_as(:'mem', :'dc', p_aal => 'aal1'), 'ok', 'setup: a member of O opens the document of B');
select is(pg_temp.grant_as(:'wa', :'d1', 'owner_download', 'aal1'), 'ok', 'setup: A downloads the own d1');
select is(pg_temp.logged(), 5::bigint, 'setup: five rows, four openings by organisations and one by the owner');

-- FR-B5 AC3: the view returns only the caller's rows, without who opened the file.
select columns_are(
  'public', 'v_my_document_access_log', array['id', 'organization_name', 'document_title', 'accessed_at', 'purpose'],
  'AC3: the view exposes the organisation name, document title, time and purpose, and no accessor or user id'
);
select is(pg_temp.listed(:'wa'), 3::bigint, 'AC3: A sees the three openings by organisations');
select is(
  pg_temp.val_as(:'wa', 'aal1', $$select string_agg(organization_name || '|' || document_title || '|' || purpose, ';' order by organization_name, id)
    from public.v_my_document_access_log$$),
  'Acme Bau|Title 00000000-0000-0000-0000-0000000d0001|application_review;Acme Bau|Title 00000000-0000-0000-0000-0000000d0001|application_review;'
    || 'Beta Works|Title 00000000-0000-0000-0000-0000000d0002|application_review',
  'AC3: each row names the organisation display name and the document title'
);
select is(pg_temp.listed(:'wb'), 1::bigint, 'AC3: B sees only the one opening of the own document');
select is(pg_temp.listed(:'mem'), 0::bigint, 'AC3: a member of O who opened the files sees no row');
select is(pg_temp.listed(:'own1'), 0::bigint, 'AC3: an owner of O sees no row');
select is(pg_temp.listed(:'own2'), 0::bigint, 'AC3: an owner of P sees no row');
select is(pg_temp.listed(:'slg'), 0::bigint, 'AC3: a platform administrator sees no row');
select is(pg_temp.listed(:'adm2'), 0::bigint, 'AC3: a verification reviewer sees no row');
select is(pg_temp.listed(:'late'), 0::bigint, 'AC3: a trust and safety administrator sees no row');
select is(pg_temp.listed(:'wnew'), 0::bigint, 'AC3: a candidate whom nobody opened sees no row');
select is(
  pg_temp.call_as(null, 'anon', 'select 1 from public.v_my_document_access_log') ~ '^42501\|permission denied', true,
  'AC3: anonymous is refused by the missing grant'
);
select is(pg_temp.affected_as(:'wa', 'authenticated', 'select 1 from audit.document_access_log'), 4::bigint, 'AC3: A reads the own four rows of the table, the owner row included');
select is(pg_temp.affected_as(:'wb', 'authenticated', 'select 1 from audit.document_access_log'), 1::bigint, 'AC3: B reads only the own row');
select is(pg_temp.affected_as(:'mem', 'authenticated', 'select 1 from audit.document_access_log'), 0::bigint, 'AC3: a member of O reads no row of the table');
select is(pg_temp.affected_as(:'slg', 'authenticated', 'select 1 from audit.document_access_log', 'aal2'), 0::bigint, 'AC3: nor does platform staff');
select is(pg_temp.state_as(:'wa', 'select accessed_by from audit.document_access_log'), '42501', 'AC3: the table does not give out accessed_by, not even to the candidate');
select is(pg_temp.state_as(:'wa', 'select share_id from audit.document_access_log'), '42501', 'nor the share id');
select is(
  pg_temp.val_as(:'wb', 'aal1', format($$select coalesce(private.access_log_organization_name(%s), 'none')$$, (select min(id) from audit.document_access_log where worker_user_id = :'wa'))),
  'none', 'the organisation lookup answers nothing for the row of another candidate'
);
select is(
  pg_temp.val_as(:'wa', 'aal1', format($$select private.access_log_organization_name(%s)$$, (select min(id) from audit.document_access_log where worker_user_id = :'wa'))),
  'Acme Bau', 'and answers the name for the own row'
);

-- FR-B5 AC7 (database side): the document the candidate deleted is not readable, so the row stays with no title.
update public.worker_documents set deleted_at = now() where id = :'d2';
select is(
  pg_temp.val_as(:'wa', 'aal1', $$select count(*) from public.v_my_document_access_log where document_title is null$$),
  '1', 'AC7: the opening of the deleted document is still listed, with no title'
);
select is(pg_temp.listed(:'wa'), 3::bigint, 'AC7: and the list still has three rows');

-- FR-B5 AC8: the owner's own download is logged and not listed.
select is(
  (select format('%s|%s|%s|%s', share_id is null, organization_id is null, accessed_by = :'wa', purpose)
   from audit.document_access_log where purpose = 'owner_download'),
  't|t|t|owner_download', 'AC8: the owner row has no share and no organisation'
);
select is(
  pg_temp.val_as(:'wa', 'aal1', $$select count(*) from public.v_my_document_access_log where purpose = 'owner_download'$$),
  '0', 'AC8: the view does not return it'
);

-- FR-B5 AC4: nobody writes through the API, and no role changes or removes a row.
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$insert into audit.document_access_log (document_id, worker_user_id, accessed_by, purpose) values (%L, %L, %L, 'owner_download')$$, :'d1', :'wa', :'wa')) ~ '^42501\|permission denied',
  true, 'AC4: authenticated cannot insert'
);
select is(
  pg_temp.call_as(null, 'anon', format($$insert into audit.document_access_log (document_id, worker_user_id, accessed_by, purpose) values (%L, %L, %L, 'owner_download')$$, :'d1', :'wa', :'wa')) ~ '^42501\|permission denied',
  true, 'AC4: anon cannot insert'
);
select is(
  pg_temp.call_as(null, 'service_role', format($$insert into audit.document_access_log (document_id, worker_user_id, accessed_by, purpose) values (%L, %L, %L, 'owner_download')$$, :'d1', :'wa', :'wa')) ~ '^42501\|permission denied',
  true, 'AC4: service_role cannot insert'
);
select is(pg_temp.state_as(:'wa', 'update audit.document_access_log set purpose = purpose'), '42501', 'AC4: authenticated cannot update');
select is(pg_temp.state_as(:'wa', 'delete from audit.document_access_log'), '42501', 'AC4: authenticated cannot delete');
select is(pg_temp.state_as(:'wa', 'truncate audit.document_access_log'), '42501', 'AC4: authenticated cannot truncate');
select throws_ok(
  $$update audit.document_access_log set purpose = 'application_review'$$, '42501', 'audit.document_access_log is append-only',
  'AC4: the table owner cannot update'
);
select throws_ok($$delete from audit.document_access_log$$, '42501', 'audit.document_access_log is append-only', 'AC4: the table owner cannot delete');
select throws_ok($$truncate audit.document_access_log$$, '42501', 'audit.document_access_log is append-only', 'AC4: the table owner cannot truncate');
set local session_replication_role = replica;
select throws_ok($$delete from audit.document_access_log$$, '42501', 'audit.document_access_log is append-only', 'AC4: delete is refused in replica mode');
select throws_ok($$truncate audit.document_access_log$$, '42501', 'audit.document_access_log is append-only', 'AC4: truncate is refused in replica mode');
set local session_replication_role = origin;
select is(
  (select array_agg(tgenabled::text order by tgname) from pg_trigger
   where tgrelid = 'audit.document_access_log'::regclass and tgname in ('document_access_log_append_only', 'document_access_log_no_truncate')),
  array['A', 'A'], 'AC4: both triggers are ENABLE ALWAYS'
);
select set_config('chara.retention_run', 'on', true);
select throws_ok($$update audit.document_access_log set purpose = 'application_review'$$, '42501', 'audit.document_access_log is append-only', 'AC4: the retention exception does not allow an update');
select throws_ok($$truncate audit.document_access_log$$, '42501', 'audit.document_access_log is append-only', 'AC4: nor a truncate');
select set_config('chara.retention_run', 'off', true);
select is(pg_temp.logged(), 5::bigint, 'AC4: no attempt changed the log');

-- FR-B5 AC9: the retention period is configuration, 730 days by default, applied by private.apply_retention().
select is((select days from private.retention_policies where entity = 'document_access_log'), 730, 'AC9: the default period is 730 days (24 months)');
select throws_ok(
  $$update private.retention_policies set days = 0 where entity = 'document_access_log'$$, '23514', null, 'AC9: a period below one day is refused'
);
select is(
  has_function_privilege('anon', 'private.apply_retention()', 'execute') or has_function_privilege('authenticated', 'private.apply_retention()', 'execute')
    or has_function_privilege('service_role', 'private.apply_retention()', 'execute'),
  false, 'AC9: no API role can run the retention job'
);
select is(
  has_table_privilege('anon', 'private.retention_policies', 'select') or has_table_privilege('authenticated', 'private.retention_policies', 'select')
    or has_table_privilege('service_role', 'private.retention_policies', 'select'),
  false, 'AC9: no API role can read the retention periods'
);

create temp table old_rows (id bigint, age integer) on commit drop;
with ins as (
  insert into audit.document_access_log (share_id, document_id, worker_user_id, organization_id, accessed_by, purpose, accessed_at)
  select null, :'d1', :'wa', pg_temp.o(), :'mem', 'application_review', now() - make_interval(days => a)
  from unnest(array[729, 731]) as a
  returning id, (now()::date - accessed_at::date) as age
)
insert into old_rows select id, age from ins;
select is((select count(*) from audit.document_access_log), 7::bigint, 'AC9 setup: rows 729 and 731 days old are in the log');

select private.apply_retention();
select is((select count(*) from audit.document_access_log where id in (select id from old_rows where age = 731)), 0::bigint, 'AC9: the 731-day entry is removed');
select is((select count(*) from audit.document_access_log where id in (select id from old_rows where age = 729)), 1::bigint, 'AC9: the 729-day entry is kept');
select is((select count(*) from audit.document_access_log), 6::bigint, 'AC9: current entries are kept');
select is(
  (select metadata::text || '|' || (actor_id is null)::text from audit.log where action = 'retention.run' order by id desc limit 1),
  '{"days": 730, "removed": 1}|true', 'AC9: the run is audited with the period and the count, without an actor'
);

update private.retention_policies set days = 365 where entity = 'document_access_log';
select private.apply_retention();
select is((select count(*) from audit.document_access_log where id in (select id from old_rows)), 0::bigint, 'AC9: with 365 days the 729-day entry is removed too');
select is(
  (select metadata::text from audit.log where action = 'retention.run' order by id desc limit 1), '{"days": 365, "removed": 1}',
  'AC9: the second run is audited with the new period'
);
select is((select count(*) from audit.log where action = 'retention.run'), 2::bigint, 'AC9: each run wrote one audit row');
select private.apply_retention();
select is(
  (select metadata::text from audit.log where action = 'retention.run' order by id desc limit 1), '{"days": 365, "removed": 0}',
  'AC9: a run with nothing due removes nothing'
);
select is(current_setting('chara.retention_run'), 'off', 'AC9: the deletion exception ends with the run');
select throws_ok($$delete from audit.document_access_log$$, '42501', 'audit.document_access_log is append-only', 'AC9: a direct delete is still refused');
select is(pg_temp.logged(), 5::bigint, 'AC9: the five current rows remain');

-- Indexes the page and the job read, and the job that runs the retention.
select is(
  (select count(*) from pg_indexes where schemaname = 'audit' and tablename = 'document_access_log'
     and indexname in ('document_access_log_owner_idx', 'document_access_log_accessed_at_idx')),
  2::bigint, 'the owner and time indexes exist'
);
select is(
  (select count(*) from pg_indexes where schemaname = 'audit' and tablename = 'document_access_log'
     and indexname = 'document_access_log_owner_idx' and indexdef like '%WHERE (organization_id IS NOT NULL)'),
  1::bigint, 'the owner index holds only the rows the page lists'
);
select is(
  (select count(*) from cron.job where jobname = 'apply-retention' and schedule = '17 3 * * *'
     and command = 'select private.apply_retention()' and active),
  1::bigint, 'AC9: the retention job is scheduled daily'
);

-- A repeated call inside the window adds no row, so a loop cannot fill the append-only log; another caller, another
-- document or a window of zero still logs.
update private.settings set value = '10' where key = 'document_access_repeat_seconds';
select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'ok', 'a member of O who opened d1 opens it again within the window');
select is(pg_temp.logged(), 5::bigint, 'the repeat adds no row');
select is(pg_temp.grant_as(:'wa', :'d1', 'owner_download', 'aal1'), 'ok', 'A downloads d1 again within the window');
select is(pg_temp.logged(), 5::bigint, 'the repeated owner download adds no row');
select is(pg_temp.grant_as(:'own1', :'d1'), 'ok', 'another member of O opens d1');
select is(pg_temp.logged(), 6::bigint, 'a different caller is logged');
update private.settings set value = '0' where key = 'document_access_repeat_seconds';
select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'ok', 'with a window of zero the same member opens d1 again');
select is(pg_temp.logged(), 7::bigint, 'and every call is logged');

-- FR-B5 AC7: an organisation that no longer exists leaves the entry, with no name.
insert into audit.document_access_log (share_id, document_id, worker_user_id, organization_id, accessed_by, purpose)
values (null, :'d1', :'wa', gen_random_uuid(), :'mem', 'application_review');
select is(
  pg_temp.val_as(:'wa', 'aal1', format($$select coalesce(organization_name, 'none') from public.v_my_document_access_log where id = %s$$, (select max(id) from audit.document_access_log))),
  'none', 'AC7: the entry of a vanished organisation is listed with no organisation name'
);

-- FR-B5 AC11: the grant is the one function that hands out a storage path, and no policy gives a third party a read.
select set_eq(
  $$select p.proname::text from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'audit'::regnamespace)
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
      and (p.prosrc ~* '(passport-documents|storage_path|object_path|createSignedUrl|storage\.objects)')$$,
  $$values ('document_access_grant'), ('delete_worker_document')$$,
  'AC11: of the functions open to anon or authenticated, only the grant and the owner delete mention the bucket or a storage path'
);
select is(
  (select count(*) from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'audit'::regnamespace)
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute'))
     and pg_get_function_result(p.oid) ~* '(object_path|storage_path|bucket_id|url)'),
  1::bigint, 'AC11: exactly one function open to an API role returns a path, a bucket or a link'
);
select is(
  (select p.proname::text from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'audit'::regnamespace)
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute'))
     and pg_get_function_result(p.oid) ~* '(object_path|storage_path|bucket_id|url)'),
  'document_access_grant', 'AC11: and it is document_access_grant'
);
select is(
  (select count(*) from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'audit'::regnamespace)
     and p.prosrc ~* '(passport-documents|storage_path|object_path|createSignedUrl|storage\.objects)'
     and p.proname not in ('document_access_grant', 'delete_worker_document')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0::bigint, 'AC11: every other function that mentions the bucket is closed to anon and authenticated'
);
select is_empty(
  $$select polname::text from pg_policy where polrelid = 'storage.objects'::regclass
      and (coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), ''))
          ~* '(member_org_ids|is_org_member|platform|organization|passport_shares)'$$,
  'AC11: no storage policy gives an organisation member or platform staff a read'
);

select * from finish();
rollback;
