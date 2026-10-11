-- SA-06 (security review), NFR-S6, D79: a candidate keeps at most worker_documents_max documents, and a user and an
-- organisation make at most a daily number of the writes that reach storage and the immutable audit log. Platform staff,
-- billing and scheduled jobs are never counted.
begin;
select plan(29);

\ir status_fixture.inc

create function pg_temp.doc_as(p_user uuid, p_n integer) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes)
       values ('00000000-0000-0000-0000-%s', %L, 'cv', 'CV %s', %L || '/00000000-0000-0000-0000-%s/cv.pdf', 'cv.pdf', 'application/pdf', 1000)$f$,
    lpad(p_n::text, 12, '0'), p_user, p_n, p_user, lpad(p_n::text, 12, '0')), 'aal1')
$$;
create function pg_temp.docs_of(p_user uuid) returns bigint
language sql as $$ select count(*) from public.worker_documents where worker_user_id = p_user and deleted_at is null $$;
create function pg_temp.reset_quotas() returns void
language sql as $$ delete from private.rate_limit_hits where action in ('user:audited_write', 'user:org_audited_write') $$;

-- The settings and their defaults.
select results_eq(
  $$select key, value #>> '{}' from private.settings
    where key in ('worker_documents_max', 'rate_limit_audited_write_max', 'rate_limit_audited_write_seconds',
                  'rate_limit_org_audited_write_max', 'rate_limit_org_audited_write_seconds') order by key$$,
  $$values ('rate_limit_audited_write_max', '500'), ('rate_limit_audited_write_seconds', '86400'),
           ('rate_limit_org_audited_write_max', '2000'), ('rate_limit_org_audited_write_seconds', '86400'),
           ('worker_documents_max', '50')$$,
  'the document cap and the daily quotas are settings: 50 documents, 500 writes per user and 2000 per organisation a day'
);

-- Documents per candidate.
select is(
  (select string_agg(pg_temp.doc_as(:'wa', i), ',') from generate_series(1, 50) i),
  (select string_agg('ok', ',') from generate_series(1, 50)), 'a candidate adds 50 documents'
);
select count(*) as audit_before from audit.log where action = 'document.created' \gset
select is(pg_temp.doc_as(:'wa', 51), 'P0001|CHARA_LIMIT_REACHED|worker_documents', 'the 51st is refused with the limit');
select is(pg_temp.docs_of(:'wa'), 50::bigint, 'and no row was added');
select is((select count(*) from audit.log where action = 'document.created'), :'audit_before'::bigint, 'nor an audit row');
select is(pg_temp.doc_as(:'wb', 1001), 'ok', 'another candidate has a limit of their own');
select is(
  pg_temp.call_as(:'wa', 'authenticated', $$select public.delete_worker_document('00000000-0000-0000-0000-000000000001')$$, 'aal1'),
  'ok', 'the candidate deletes one'
);
select is(pg_temp.doc_as(:'wa', 52), 'ok', 'and may add one again: deleted documents do not count');
update private.settings set value = '10' where key = 'worker_documents_max';
select is(pg_temp.doc_as(:'wb', 1002), 'ok', 'a changed limit applies at once: a candidate below it adds');
select is(pg_temp.doc_as(:'wa', 53), 'P0001|CHARA_LIMIT_REACHED|worker_documents', 'one above it is refused');
insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes)
values ('00000000-0000-0000-0000-0000000f0001', :'wa', 'cv', 'Restored', :'wa' || '/00000000-0000-0000-0000-0000000f0001/cv.pdf', 'cv.pdf', 'application/pdf', 1);
select is(pg_temp.docs_of(:'wa'), 51::bigint, 'the database owner is not held to the limit (no signed-in user)');
update private.settings set value = '50' where key = 'worker_documents_max';

-- The daily quota of a user: inserts and real renames count, a rename to the same title does not.
select pg_temp.reset_quotas();
update private.settings set value = '3' where key = 'rate_limit_audited_write_max';
select is(pg_temp.doc_as(:'wb', 1003) || pg_temp.doc_as(:'wb', 1004), 'okok', 'two documents count two writes');
select is(
  pg_temp.call_as(:'wb', 'authenticated', $$update public.worker_documents set title = title where id = '00000000-0000-0000-0000-000000001003'$$, 'aal1'),
  'ok', 'saving an unchanged title is no write'
);
select is(
  pg_temp.call_as(:'wb', 'authenticated', $$update public.worker_documents set title = 'Renamed' where id = '00000000-0000-0000-0000-000000001003'$$, 'aal1'),
  'ok', 'a rename is the third write'
);
select is(pg_temp.doc_as(:'wb', 1005), 'P0001|CHARA_RATE_LIMITED|', 'the fourth write of the day is refused');
select is(
  pg_temp.call_as(:'wb', 'authenticated', $$update public.worker_documents set title = 'Again' where id = '00000000-0000-0000-0000-000000001003'$$, 'aal1'),
  'P0001|CHARA_RATE_LIMITED|', 'so is a further rename'
);
select is((select title from public.worker_documents where id = '00000000-0000-0000-0000-000000001003'), 'Renamed', 'which changed nothing');
select is(
  (select hits from private.rate_limit_hits where action = 'user:audited_write'
     and bucket = ((hashtextextended(:'wb'::text, 0) & 2147483647) % 1048576)::integer),
  3, 'the refused writes were rolled back with their count'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', $$update public.worker_documents set title = 'Mine' where id = '00000000-0000-0000-0000-000000000002'$$, 'aal1'),
  'ok', 'another user has a quota of their own'
);
update private.rate_limit_hits set expires_at = now() - interval '1 second' where action = 'user:audited_write';
select is(pg_temp.doc_as(:'wb', 1005), 'ok', 'the next day the user writes again');
update private.settings set value = '500' where key = 'rate_limit_audited_write_max';

-- The daily quota of an organisation: vacancies and notes of all its members.
select pg_temp.reset_quotas();
update private.settings set value = '3' where key = 'rate_limit_org_audited_write_max';
select pg_temp.seed_app('applied') as app \gset
select is(
  pg_temp.insert_as(:'own1', '{"title": "Quota one"}') || pg_temp.insert_as(:'adm', '{"title": "Quota two"}'),
  'okok', 'the owner and an admin of Acme create a vacancy each'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($f$insert into public.application_notes (application_id, organization_id, body) values (%L, %L, 'Third')$f$, :'app', current_setting('t.a')), 'aal1'),
  'ok', 'a member adds a note: the third write of Acme'
);
select is(pg_temp.insert_as(:'own1', '{"title": "Quota four"}'), 'P0001|CHARA_RATE_LIMITED|', 'the fourth write of Acme is refused, whoever makes it');
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($f$insert into public.application_notes (application_id, organization_id, body) values (%L, %L, 'Fourth')$f$, :'app', current_setting('t.a')), 'aal1'),
  'P0001|CHARA_RATE_LIMITED|', 'and so is a further note'
);
select is((select count(*) from public.jobs where title like 'Quota%'), 2::bigint, 'only the two vacancies exist');
select is(pg_temp.insert_as(:'own2', '{"title": "Beta quota"}', current_setting('t.b')::uuid), 'ok', 'another organisation has a quota of its own');

-- Staff and scheduled work are not counted, so a spent quota never stops a control.
select pg_temp.seed_job('{"title": "Quota open", "status": "open"}') as quota_job \gset
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', format($f$select public.moderate_job(%L, 'hide', %L)$f$, :'quota_job', 'Misleading advert reported by users.'), 'aal2'),
  'ok', 'Trust & Safety hides a vacancy of the organisation whose quota is spent'
);
select is((select moderation_state::text from public.jobs where id = :'quota_job'), 'hidden', 'and it is hidden');
update private.settings set value = '2000' where key = 'rate_limit_org_audited_write_max';

select ok(
  not has_function_privilege('anon', 'private.count_audited_write(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.count_audited_write(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.count_audited_write(uuid)', 'execute'),
  'no API role can count or reset a quota'
);

select * from finish();
rollback;
