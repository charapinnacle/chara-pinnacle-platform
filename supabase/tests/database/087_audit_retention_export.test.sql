begin;
select plan(38);

-- FR-F2 AC10 (retention is a configuration value and deletion is narrow) and the database part of AC11 (the monthly export).
\ir status_fixture.inc

select set_config('request.jwt.claims', '', true);
select set_config('request.headers', '', true);

select is((select days from private.retention_policies where entity = 'audit_log'), 2191, 'AC10: the seeded default is 2191 days, six years');
select is(
  (select count(*) from cron.job where jobname = 'apply-retention' and schedule = '17 3 * * *'), 1::bigint,
  'AC10: the daily job runs private.apply_retention'
);
select throws_ok(
  $$update private.retention_policies set days = 0 where entity = 'audit_log'$$, '23514', null, 'AC10: days = 0 is refused by the check constraint'
);
select is(
  (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r (name)
   cross join (values ('insert'), ('update'), ('delete')) p (privilege)
   where has_table_privilege(r.name, 'private.retention_policies', p.privilege)
      or (p.privilege <> 'delete' and has_any_column_privilege(r.name, 'private.retention_policies', p.privilege))),
  0::bigint, 'AC10: no API role can write retention_policies'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+private\.retention_policies'
     and n.nspname in ('public', 'private', 'audit')), 0::bigint,
  'AC10: and no function does: the value is changed only by migration'
);

-- the four rows of the criterion, aged 1, 2190, 2192 and 3000 days
create function pg_temp.aged_rows() returns void
language sql as $$
  insert into audit.log (action, entity_type, entity_id, created_at)
  select 'aged.row', 'test', 'aged-' || d, now() - d * interval '1 day' from unnest(array[1, 2190, 2192, 3000]) d
$$;
select pg_temp.aged_rows();
select count(*) as other_rows from audit.log where action <> 'aged.row' \gset

select private.apply_retention();
select is(
  (select string_agg(entity_id, ',' order by entity_id) from audit.log where action = 'aged.row'), 'aged-1,aged-2190',
  'AC10: with 2191 the rows aged 2192 and 3000 days are deleted and the rows aged 1 and 2190 days stay'
);
select is(
  (select count(*) from audit.log where action <> 'aged.row' and action <> 'retention.run'), :other_rows::bigint,
  'AC10: and no other row is deleted'
);
select is(
  (select format('%s|%s|%s|%s', count(*), min(actor_id::text), min(metadata ->> 'removed'), min(metadata ->> 'days')) from audit.log
   where action = 'retention.run' and entity_id = 'audit_log'),
  '1||2|2191', 'AC10: the run writes one retention.run row without an actor, with the 2 rows removed and the period'
);
select throws_ok($$delete from audit.log where action = 'aged.row'$$, '42501', 'audit.log is append-only', 'AC10: right after the run a direct DELETE by postgres still fails');
select is(pg_temp.call_as(:'st_admin', 'authenticated', $$delete from audit.log where action = 'aged.row'$$), '42501|permission denied for table log|', 'AC10: and by authenticated');
select is(
  (select current_setting('chara.retention_run', true)), 'off', 'AC10: the exception is closed again at the end of the run'
);
select private.apply_retention();
select is(
  (select string_agg(metadata ->> 'removed', ',' order by id) from audit.log where action = 'retention.run' and entity_id = 'audit_log'), '2,0',
  'AC10: a second run the same day finds nothing to remove and says so'
);

select pg_temp.aged_rows();
update private.retention_policies set days = 3650 where entity = 'audit_log';
select private.apply_retention();
select is(
  (select count(*) from audit.log where action = 'aged.row'), 6::bigint,
  'AC10: with 3650 days all rows stay (the two kept and the four new ones, 3000 days old at most)'
);
select is(
  (select format('%s|%s', metadata ->> 'removed', metadata ->> 'days') from audit.log where action = 'retention.run' and entity_id = 'audit_log' order by id desc limit 1),
  '0|3650', 'AC10: and the run records 0 removed and the period of the setting, without a code change'
);
update private.retention_policies set days = 2191 where entity = 'audit_log';

-- the retention of the document access log is unchanged
select is(
  (select count(*) from audit.log where action = 'retention.run' and entity_id = 'document_access_log'), 3::bigint,
  'AC10: the other entities keep their own run rows (one per run)'
);

-- AC11: the service RPCs of the export
insert into audit.log (action, entity_type, entity_id, created_at) values
  ('export.row', 'test', 'jan-last', timestamptz '2020-01-31 23:59:59.999+00'),
  ('export.row', 'test', 'feb-first', timestamptz '2020-02-01 00:00:00+00'),
  ('export.row', 'test', 'feb-a', timestamptz '2020-02-10 12:00:00+00'),
  ('export.row', 'test', 'feb-b', timestamptz '2020-02-10 12:00:00+00'),
  ('export.row', 'test', 'feb-last', timestamptz '2020-02-29 23:59:59.999+00'),
  ('export.row', 'test', 'mar-first', timestamptz '2020-03-01 00:00:00+00');
select is(pg_temp.call_as(null, 'anon', $$select public.audit_export_month('2020-02')$$), '42501|permission denied for function audit_export_month|', 'AC11: anon cannot export');
select is(pg_temp.call_as(:'st_admin', 'authenticated', $$select public.audit_export_month('2020-02')$$), '42501|permission denied for function audit_export_month|', 'AC11: nor a Platform Administrator');
select is(pg_temp.call_as(:'st_admin', 'authenticated', $$select public.audit_export_count('2020-02')$$), '42501|permission denied for function audit_export_count|', 'AC11: nor count');
select is(pg_temp.call_as(null, 'service_role', $$select public.audit_export_month('2020-02')$$), 'ok', 'AC11: service_role can');
select is(public.audit_export_count('2020-02'), 4::bigint, 'AC11: the count of February 2020 is 4');
select is(
  (select string_agg(r ->> 'entity_id', ',' order by ord) from jsonb_array_elements(public.audit_export_month('2020-02')) with ordinality e (r, ord) where r ->> 'action' = 'export.row'),
  'feb-first,feb-a,feb-b,feb-last', 'AC11: the month holds the first and the last instant of February and nothing of January or March'
);
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(public.audit_export_month('2020-02', null, null, 1) -> 0) k),
  'action,actor_id,created_at,entity_id,entity_type,id,ip,metadata', 'AC11: every row has the columns of the log'
);
select is(
  (select string_agg(r ->> 'entity_id', ',') from jsonb_array_elements(public.audit_export_month('2020-02', null, null, 2)) r), 'feb-first,feb-a',
  'AC11: pages of the size asked for'
);
select is(
  (select string_agg(r ->> 'entity_id', ',') from jsonb_array_elements(public.audit_export_month(
    '2020-02', (select created_at from audit.log where entity_id = 'feb-a'), (select id from audit.log where entity_id = 'feb-a'), 2)) r),
  'feb-b,feb-last', 'AC11: the next page continues after the last row (keyset on time and id)'
);
select is(
  jsonb_array_length(public.audit_export_month('2020-02', (select created_at from audit.log where entity_id = 'feb-last'), (select id from audit.log where entity_id = 'feb-last'))),
  0, 'AC11: and the page after the last row is empty'
);
select is(
  (select count(*) from generate_series(1, 1) where (select sum(jsonb_array_length(public.audit_export_month('2020-02', null, null, 100))) = public.audit_export_count('2020-02'))),
  1::bigint, 'AC11: the rows of the pages add up to the count'
);
select throws_ok($$select public.audit_export_month('2020-13')$$, 'P0001', 'CHARA_INVALID_INPUT', 'AC11: a month that is not YYYY-MM is refused');
select throws_ok($$select public.audit_export_month('2020-2')$$, 'P0001', 'CHARA_INVALID_INPUT', 'AC11: so is a short one');
select throws_ok($$select public.audit_export_month(null)$$, 'P0001', 'CHARA_INVALID_INPUT', 'AC11: and none');
select throws_ok(
  format($$select public.audit_export_count(%L)$$, to_char(now() at time zone 'UTC', 'YYYY-MM')), 'P0001', 'CHARA_INVALID_INPUT',
  'AC11: the month that is not over is refused, so a file never holds half a month'
);
select is(
  (select count(*) from cron.job where jobname = 'audit-export-monthly' and schedule = '0 3 1 * *' and command like '%call_edge_function(''audit-export'')%'),
  1::bigint, 'AC11: the job runs at 03:00 UTC on the first day of the month'
);
select is(
  (select count(*) from cron.job where jobname = 'audit-export-monthly-retry' and schedule = '0 15 1 * *' and command like '%call_edge_function(''audit-export'')%'),
  1::bigint, 'AC11: and again at 15:00 UTC the same day, which is the retry of a month that failed'
);
insert into audit.log (actor_id, action, entity_type, entity_id, ip, created_at) values
  (:'st_admin', 'export.ip', 'test', 'staff', '203.0.113.5', timestamptz '2020-04-10 12:00:00+00'),
  (:'pending', 'export.ip', 'test', 'candidate', '198.51.100.9', timestamptz '2020-04-11 12:00:00+00'),
  (null, 'export.ip', 'test', 'system', '192.0.2.1', timestamptz '2020-04-12 12:00:00+00');
select is(
  (select string_agg((r ->> 'entity_id') || '=' || coalesce(r ->> 'ip', '-'), ',' order by r ->> 'entity_id')
   from jsonb_array_elements(public.audit_export_month('2020-04')) r where r ->> 'action' = 'export.ip'),
  'candidate=-,staff=203.0.113.5,system=-', 'AC11: the archive keeps the address of platform staff and leaves out that of everybody else'
);
select is(
  (select ip::text from audit.log where entity_id = 'candidate' and action = 'export.ip'), '198.51.100.9/32',
  'AC11: the log itself keeps it (erase_user removes it there)'
);
select is(
  (select r ->> 'actor_id' from jsonb_array_elements(public.audit_export_month('2020-04')) r where r ->> 'entity_id' = 'candidate'), :'pending',
  'AC11: the actor stays in the export, so the act can still be attributed'
);
select is(public.audit_export_count('1999-01'), 0::bigint, 'AC11: a month without rows has the count 0');
select is(jsonb_array_length(public.audit_export_month('1999-01')), 0, 'AC11: and an empty page');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('audit_export_month', 'audit_export_count', 'audit_record_external')
     and p.prosecdef and 'search_path=""' = any (p.proconfig)
     and has_function_privilege('service_role', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')),
  3::bigint, 'the three service functions are definer functions with an empty search path, executable by service_role only'
);

select * from finish();
rollback;
