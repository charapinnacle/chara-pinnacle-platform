begin;
select plan(34);

select has_table('audit', 'log', 'audit.log exists');
select columns_are(
  'audit', 'log',
  array['id', 'actor_id', 'action', 'entity_type', 'entity_id', 'metadata', 'ip', 'created_at'],
  'audit.log has the FR-F2 columns'
);
select ok(
  (select tgtype & 27 = 27 from pg_trigger where tgrelid = 'audit.log'::regclass and tgname = 'log_append_only'),
  'a BEFORE row trigger blocks UPDATE and DELETE'
);
select ok(
  (select tgtype & 35 = 34 from pg_trigger where tgrelid = 'audit.log'::regclass and tgname = 'log_no_truncate'),
  'a BEFORE statement trigger blocks TRUNCATE'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'audit.log'::regclass),
  'audit.log has RLS enabled and forced'
);

select is_definer('audit', 'record', array['text', 'text', 'text', 'jsonb'], 'audit.record is SECURITY DEFINER');
select ok(
  (select 'search_path=""' = any (proconfig) from pg_proc where oid = 'audit.record(text, text, text, jsonb)'::regprocedure),
  'audit.record sets search_path to empty'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}',
  true
);
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.7, 10.0.0.1"}', true);

select audit.record(
  'suspend_user', 'profile', '00000000-0000-0000-0000-0000000000b2',
  '{"reason":"abuse report 17","request_id":"req-1"}'
) as first_id \gset

select is(
  (select actor_id from audit.log where id = :first_id),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'record() stores auth.uid() as the actor'
);
select is(
  (select action || '/' || entity_type || '/' || entity_id from audit.log where id = :first_id),
  'suspend_user/profile/00000000-0000-0000-0000-0000000000b2',
  'record() stores action, entity type and entity id'
);
select is(
  (select metadata from audit.log where id = :first_id),
  '{"reason":"abuse report 17","request_id":"req-1"}'::jsonb,
  'record() stores the reason and request id in metadata'
);
select is(
  (select host(ip) from audit.log where id = :first_id),
  '203.0.113.7',
  'record() stores the first x-forwarded-for address as the ip'
);
select ok(
  (select created_at between now() - interval '1 minute' and now() + interval '1 minute' from audit.log where id = :first_id),
  'record() stamps created_at'
);

select set_config('request.headers', '{"x-forwarded-for":"not-an-address"}', true);
select audit.record('grant_platform_role', 'platform_staff') as second_id \gset

select is(
  (select ip from audit.log where id = :second_id),
  null,
  'an unparseable x-forwarded-for is stored as no ip and does not fail the action'
);
select is(
  (select metadata from audit.log where id = :second_id),
  '{}'::jsonb,
  'metadata defaults to an empty object'
);
select is(
  (select entity_id from audit.log where id = :second_id),
  null,
  'entity_id is optional'
);

select set_config('request.jwt.claims', '', true);
select set_config('request.headers', '', true);
select audit.record('retention_run', 'system') as third_id \gset

select is(
  (select actor_id from audit.log where id = :third_id),
  null,
  'a system action without a user is recorded with no actor'
);
select ok(:second_id > :first_id and :third_id > :second_id, 'ids increase in insertion order');

select throws_ok(
  $$select audit.record('', 'profile')$$, '23514', null,
  'an empty action is refused'
);
select throws_ok(
  $$select audit.record('x', '')$$, '23514', null,
  'an empty entity type is refused'
);
select throws_ok(
  $$select audit.record('x', 'profile', null, '[1]')$$, '23514', null,
  'metadata that is not a json object is refused'
);

select throws_ok(
  format($$update audit.log set action = 'tampered' where id = %s$$, :first_id),
  '42501', 'audit.log is append-only',
  'update is refused for the table owner'
);
select throws_ok(
  format($$delete from audit.log where id = %s$$, :first_id),
  '42501', 'audit.log is append-only',
  'delete is refused for the table owner'
);
select throws_ok(
  $$truncate audit.log$$,
  '42501', 'audit.log is append-only',
  'truncate is refused for the table owner'
);
select is(
  (select action from audit.log where id = :first_id),
  'suspend_user',
  'the row is unchanged after the refused update and delete'
);

set local role authenticated;
select throws_ok($$select * from audit.log$$, '42501', null, 'authenticated cannot read audit.log');
select throws_ok(
  $$insert into audit.log (action, entity_type) values ('forged', 'profile')$$,
  '42501', null, 'authenticated cannot insert into audit.log directly'
);
select throws_ok($$select audit.record('forged', 'profile')$$, '42501', null, 'authenticated cannot call audit.record');
select throws_ok($$update audit.log set action = 'tampered'$$, '42501', null, 'authenticated cannot update audit.log');
select throws_ok($$delete from audit.log$$, '42501', null, 'authenticated cannot delete from audit.log');
reset role;

set local role anon;
select throws_ok($$select * from audit.log$$, '42501', null, 'anon cannot read audit.log');
select throws_ok($$select audit.record('forged', 'profile')$$, '42501', null, 'anon cannot call audit.record');
reset role;

set local role service_role;
select throws_ok($$select * from audit.log$$, '42501', null, 'service_role cannot read audit.log');
select throws_ok($$select audit.record('forged', 'profile')$$, '42501', null, 'service_role cannot call audit.record');
reset role;

select is(
  (select count(*) from audit.log),
  3::bigint,
  'only the three records written through audit.record() exist'
);

select * from finish();
rollback;
