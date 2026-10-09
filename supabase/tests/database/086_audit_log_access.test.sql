begin;
select plan(52);

-- FR-F2 AC5, AC6 and AC9: nobody changes the log, rows are added only through the audit functions, and only the Platform
-- Administrator at aal2 reads it.
\ir status_fixture.inc

create function pg_temp.rows_as(p_user uuid, p_sql text, p_aal text default 'aal2') returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text end, true);
  set local role authenticated;
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(s)), ''[]'') from (%s) s', p_sql) into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := to_jsonb(format('%s|%s|%s', v_state, v_message, coalesce(v_detail, '')));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- the rows of AC9: 60 rows, 3 actors, 4 actions, 2 entity types, one every 4 hours from the start of 2021-05-01 (UTC)
\set a1 '00000000-0000-0000-0000-00000000f901'
\set a2 '00000000-0000-0000-0000-00000000f902'
\set a3 '00000000-0000-0000-0000-00000000f903'
insert into audit.log (actor_id, action, entity_type, entity_id, metadata, ip, created_at)
select (array[:'a1', :'a2', :'a3'])[n % 3 + 1]::uuid, (array['user.suspend', 'user.reinstate', 'mfa.reset', 'legal_document.publish'])[n % 4 + 1],
       (array['profile', 'organization'])[n % 2 + 1], 'entity-' || n, jsonb_build_object('reason', 'Reason number ' || n),
       '203.0.113.7', timestamptz '2021-05-01 00:00:00+00' + n * interval '4 hours'
from generate_series(0, 59) n;
select md5(string_agg(id || action || coalesce(entity_id, '') || metadata::text || created_at::text, ',' order by id)) as digest, count(*) as total
from audit.log \gset

-- AC5: update, delete and truncate fail for every role and change nothing
create temp table roles (name text primary key, uid uuid);
insert into roles values ('anon', null), ('authenticated', :'st_admin'), ('service_role', null);
create temp table changes (statement text primary key);
insert into changes values
  ('update audit.log set action = ''tampered'''), ('update audit.log set metadata = ''{}'' where true'),
  ('delete from audit.log'), ('delete from audit.log where id > 0'), ('truncate audit.log');
select is(
  (select count(*) from roles r cross join changes c where pg_temp.call_as(r.uid, r.name, c.statement) like '42501|permission denied for %'),
  15::bigint, 'AC5: anon, authenticated and service_role are refused UPDATE, DELETE and TRUNCATE (permission denied)'
);
select throws_ok($$update audit.log set action = 'tampered'$$, '42501', 'audit.log is append-only', 'AC5: postgres: UPDATE is refused by the trigger');
select throws_ok($$delete from audit.log$$, '42501', 'audit.log is append-only', 'AC5: postgres: DELETE is refused by the trigger');
select throws_ok($$truncate audit.log$$, '42501', 'audit.log is append-only', 'AC5: postgres: TRUNCATE is refused by the trigger');
set local session_replication_role = replica;
select throws_ok($$update audit.log set action = 'tampered'$$, '42501', 'audit.log is append-only', 'AC5: replica mode: UPDATE is refused');
select throws_ok($$delete from audit.log$$, '42501', 'audit.log is append-only', 'AC5: replica mode: DELETE is refused');
select throws_ok($$truncate audit.log$$, '42501', 'audit.log is append-only', 'AC5: replica mode: TRUNCATE is refused');
set local session_replication_role = origin;
select throws_ok(
  $$select set_config('chara.retention_run', 'off', true); delete from audit.log$$, '42501', 'audit.log is append-only',
  'AC5: the retention exception is closed unless the setting is on'
);
select is(
  (select md5(string_agg(id || action || coalesce(entity_id, '') || metadata::text || created_at::text, ',' order by id)) || '|' || count(*) from audit.log),
  :'digest' || '|' || :'total', 'AC5: the row count and the contents are unchanged afterwards'
);

-- AC6: rows are added only through the audit functions
select is(
  (select count(*) from roles r where pg_temp.call_as(r.uid, r.name, $$insert into audit.log (action, entity_type) values ('forged', 'profile')$$) like '42501|%'),
  3::bigint, 'AC6: a direct INSERT is refused for anon, authenticated and service_role'
);
select is(
  (select count(*) from roles r where pg_temp.call_as(r.uid, r.name, 'select count(*) from audit.log') like '42501|%'),
  3::bigint, 'AC6: and so is a SELECT'
);
select is(
  (select count(*) from roles r where pg_temp.call_as(r.uid, r.name, $$select audit.record('forged', 'profile')$$) like '42501|%'),
  3::bigint, 'AC6: none of them can execute audit.record'
);
select is(
  (select count(*) from roles r where pg_temp.call_as(r.uid, r.name, $$select audit.record_as(null, 'forged', 'profile', null, '{}', null)$$) like '42501|%'),
  3::bigint, 'AC6: nor audit.record_as, which takes the actor as an argument'
);
select is(
  pg_temp.call_as(null, 'anon', $$select public.audit_record_external('account_ops.sign_out_global', 'profile', 'x', null, '{}')$$),
  '42501|permission denied for function audit_record_external|', 'AC6: anon is refused audit_record_external'
);
select is(
  pg_temp.call_as(:'st_admin', 'authenticated', $$select public.audit_record_external('account_ops.sign_out_global', 'profile', 'x', null, '{}')$$),
  '42501|permission denied for function audit_record_external|', 'AC6: authenticated, a Platform Administrator included, is refused it'
);
select count(*) as before_external from audit.log \gset
select is(
  pg_temp.call_as(null, 'service_role', format($$select public.audit_record_external('account_ops.sign_out_global', 'profile', 'target-1', %L, '{"request_id": "r-1", "job_id": "77"}')$$, :'st_admin')),
  'ok', 'AC6: service_role appends a row'
);
select is(
  (select format('%s|%s|%s|%s|%s', count(*), min(actor_id::text), min(entity_type), min(entity_id), min(metadata::text)) from audit.log where id > 0 and action = 'account_ops.sign_out_global' and entity_id = 'target-1'),
  format('1|%s|profile|target-1|{"job_id": "77", "request_id": "r-1"}', :'st_admin'), 'AC6: exactly one row with the actor, the entity and the metadata of the call'
);
select is(
  (select created_at = now() from audit.log where action = 'account_ops.sign_out_global' and entity_id = 'target-1'), true,
  'AC6: created_at is set by the database (the function has no argument for it)'
);
select is(
  (select count(*) from audit.log), :before_external::bigint + 1, 'AC6: and the log has one row more'
);
select is(
  pg_temp.call_as(null, 'service_role', format($$select public.audit_record_external('account_ops.sign_out_global', 'profile', 'target-1', %L, '{"request_id": "r-2", "job_id": "77"}')$$, :'st_admin')),
  'ok', 'AC6: the same step of the same job offered again is not an error'
);
select is(
  (select count(*) from audit.log where action = 'account_ops.sign_out_global' and metadata ->> 'job_id' = '77'), 1::bigint,
  'AC6: and adds no second row'
);
select is(
  (select public.audit_record_external('account_ops.ban_user', 'profile', 'target-1', null, '{"job_id": "77"}')), true,
  'AC6: another step of the same job is written'
);
select is(
  (select public.audit_record_external('account_ops.ban_user', 'profile', 'target-1', null, '{"job_id": "77"}')), false,
  'AC6: and offered again it reports that nothing was added'
);
select is(
  (select actor_id from audit.log where action = 'account_ops.sign_out_global' and entity_id = 'target-1'), :'st_admin'::uuid,
  'AC6: the actor is the person the job carries'
);
select is(
  (select public.audit_record_external('account_ops.erase', 'profile', 'target-2', gen_random_uuid(), '{"job_id": "78"}')), true,
  'AC6: an actor without a profile is not stored'
);
select is(
  (select actor_id from audit.log where action = 'account_ops.erase' and entity_id = 'target-2'), null,
  'AC6: the row has no actor'
);
select throws_ok($$select public.audit_record_external('User.Suspend', 'profile', 'x')$$, 'P0001', 'CHARA_INVALID_INPUT', 'AC6: an action that is not <entity>.<verb> in lower case is refused');
select throws_ok($$select public.audit_record_external('billing.ping', '', 'x')$$, 'P0001', 'CHARA_INVALID_INPUT', 'AC6: an empty entity type is refused');
select throws_ok($$select public.audit_record_external('billing.ping', 'profile', 'x', null, '[]')$$, 'P0001', 'CHARA_INVALID_INPUT', 'AC6: metadata that is not an object is refused');
select throws_ok(
  $$select public.audit_record_external('account_ops.ban_user', 'profile', 'x', null, '{}')$$, 'P0001', 'CHARA_INVALID_INPUT',
  'AC6: a step of an account-ops job without its job id is refused (the once-per-job guard needs it)'
);
select is(
  (select count(*) from (values ('user.suspend'), ('user.reinstate'), ('organization.suspend'), ('organization.reinstate'), ('job.org_suspend'), ('mfa.reset'), ('platform_role.grant'), ('legal_document.publish')) a (name)
   where pg_temp.call_as(null, 'service_role', format($$select public.audit_record_external(%L, 'profile', 'x', null, '{"job_id": "79"}')$$, a.name)) = 'P0001|CHARA_INVALID_INPUT|action'),
  8::bigint, 'AC6: the names of administrative rows are reserved: the service role cannot write a row that looks like one'
);
select is(
  (select count(*) from audit.log where metadata ->> 'job_id' = '79'), 0::bigint, 'AC6: and none of those calls left a row'
);
select is(
  (select public.audit_record_external('billing.webhook_rejected', 'billing_event', 'x', null, '{"reason": "signature"}')), true,
  'AC6: other dotted names, without a job id, are accepted (the billing webhook of a later unit writes its own)'
);
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosrc ~ 'audit\.record_as|insert into audit\.log'
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))$$,
  'AC6: no function granted to authenticated or anon writes the actor: they reach the log only through audit.record'
);
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosrc ~ 'audit\.record_as'),
  array['audit_admin_each', 'audit_record_external', 'record', 'record_as']::text[], 'AC6: audit.record_as is called by audit.record (the caller), private.record_as, private.audit_admin_each (the caller, for many entities) and audit_record_external (the job) only'
);

-- AC9: only the Platform Administrator at aal2 reads, with filters
select is(
  (select jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_from => date '2021-05-01', p_to => date '2021-05-10', p_limit => 100)$$))),
  60, 'AC9: the administrator at aal2 gets the 60 rows'
);
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_from => date '2021-05-01', p_to => date '2021-05-10', p_limit => 1)$$) -> 0) k),
  'action,actor_id,created_at,entity_id,entity_type,id,ip,metadata', 'AC9: the columns are id, actor_id, action, entity_type, entity_id, metadata, ip, created_at'
);
select is(
  (pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_from => date '2021-05-01', p_to => date '2021-05-10', p_limit => 1)$$) -> 0 ->> 'ip'),
  '203.0.113.7', 'AC9: and the row holds the address'
);
select is(
  (select count(*) from (values (:'st_trust'::uuid, 'aal2'), (:'st_review'::uuid, 'aal2'), (:'st_admin'::uuid, 'aal1'), (:'own1'::uuid, 'aal2')) v (uid, aal)
   where pg_temp.rows_as(v.uid, $$select * from public.admin_search_audit()$$, v.aal) = '"P0001|CHARA_FORBIDDEN|"'::jsonb
      or pg_temp.rows_as(v.uid, $$select * from public.admin_search_audit()$$, v.aal) = '"P0001|CHARA_FORBIDDEN|aal2_required"'::jsonb),
  4::bigint, 'AC9: the Trust & Safety Administrator, the Verification Reviewer, the administrator at aal1 and a user are CHARA_FORBIDDEN'
);
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.admin_search_audit()$$), '42501|permission denied for function admin_search_audit|',
  'AC9: anon is refused at EXECUTE'
);
select is(
  (select count(*) from roles r where pg_temp.call_as(r.uid, r.name, 'select * from audit.log') like '42501|%'), 3::bigint,
  'AC9: a direct SELECT is refused for anon, authenticated and service_role'
);
select is(
  (select jsonb_array_length(pg_temp.rows_as(:'st_admin', format($$select * from public.admin_search_audit(p_actor => %L, p_from => date '2021-05-01', p_to => date '2021-05-10', p_limit => 100)$$, :'a1')))),
  20, 'AC9: the filter on the actor'
);
select is(
  (select jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_action => 'mfa.reset', p_limit => 100)$$))),
  15, 'AC9: the filter on the action'
);
select is(
  (select jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_entity_type => 'organization', p_from => date '2021-05-01', p_to => date '2021-05-10', p_limit => 100)$$))),
  30, 'AC9: the filter on the entity type'
);
select is(
  (select jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_entity_id => 'entity-7')$$))),
  1, 'AC9: the filter on the entity id'
);
select is(
  (select jsonb_array_length(pg_temp.rows_as(:'st_admin', format($$select * from public.admin_search_audit(p_actor => %L, p_action => 'user.suspend', p_entity_type => 'profile', p_from => date '2021-05-01', p_to => date '2021-05-10', p_limit => 100)$$, :'a1')))),
  (select count(*)::int from audit.log where actor_id = :'a1' and action = 'user.suspend' and entity_type = 'profile'),
  'AC9: filters combine with AND'
);
select is(
  (select jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_from => date '2021-05-02', p_to => date '2021-05-02', p_limit => 100)$$))),
  6, 'AC9: a day from 00:00:00 UTC to 23:59:59.999 UTC holds its 6 rows'
);
insert into audit.log (action, entity_type, entity_id, created_at) values
  ('edge.before', 'profile', 'edge-before', timestamptz '2021-05-02 23:59:59.999+00'),
  ('edge.after', 'profile', 'edge-after', timestamptz '2021-05-03 00:00:00+00');
select is(
  (select string_agg(r ->> 'entity_id', ',' order by r ->> 'entity_id') from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_action => 'edge.before', p_from => date '2021-05-02', p_to => date '2021-05-02')$$)) r),
  'edge-before', 'AC9: 23:59:59.999 belongs to the end day'
);
select is(
  jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_action => 'edge.after', p_from => date '2021-05-02', p_to => date '2021-05-02')$$)),
  0, 'AC9: and midnight of the next day does not'
);
select is(
  (select jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_from => date '2021-05-01', p_to => date '2021-05-10')$$))),
  25, 'AC9: a page holds 25 rows'
);
insert into audit.log (action, entity_type, entity_id, created_at) values
  ('tie.row', 'profile', 'tie-1', timestamptz '2021-06-01 00:00:00+00'),
  ('tie.row', 'profile', 'tie-2', timestamptz '2021-06-01 00:00:00+00'),
  ('tie.row', 'profile', 'tie-3', timestamptz '2021-06-02 00:00:00+00');
select is(
  (select string_agg(r ->> 'entity_id', ',') from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_action => 'tie.row')$$)) r),
  'tie-3,tie-2,tie-1', 'AC9: ordered by created_at descending, then id descending'
);
select is(
  pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_from => date '2021-05-10', p_to => date '2021-05-01')$$),
  '"P0001|CHARA_INVALID_INPUT|filter"'::jsonb, 'AC9: a from date after the to date is CHARA_INVALID_INPUT'
);

select * from finish();
rollback;
