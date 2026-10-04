begin;
select plan(42);

\set u '00000000-0000-0000-0000-00000000d001'
\set v '00000000-0000-0000-0000-00000000d002'
\set stranger '00000000-0000-0000-0000-00000000d0ff'

insert into auth.users (id, email, email_confirmed_at, encrypted_password, raw_user_meta_data)
values
  (:'u', 'login-u@example.test', now(), 'hash-1', '{"intended_account_kind":"worker"}'),
  (:'v', 'login-v@example.test', now(), 'hash-1', '{"intended_account_kind":"company"}');

create function pg_temp.fail(p_user uuid) returns jsonb
language sql as $$
  select private.hook_password_verification_attempt(jsonb_build_object('user_id', p_user, 'valid', false))
$$;

create function pg_temp.rows(p_user uuid, p_action text) returns bigint
language sql as $$
  select count(*) from audit.log where entity_id = p_user::text and action = p_action
$$;

select coalesce((select failures from stats.login_failures_daily where day = (now() at time zone 'utc')::date), 0) as failures_before \gset

-- Settings
select results_eq(
  $$select key, value #>> '{}' from private.settings
    where key in ('login_failure_threshold', 'login_failure_window_minutes', 'recovery_link_minutes') order by key$$,
  $$values ('login_failure_threshold', '5'), ('login_failure_window_minutes', '15'), ('recovery_link_minutes', '60')$$,
  'threshold 5, window 15 minutes and recovery lifetime 60 minutes are settings'
);

-- The hook: shape, privileges
select is_definer('private', 'hook_password_verification_attempt', array['jsonb'], 'the hook is SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = 'private.hook_password_verification_attempt(jsonb)'::regprocedure),
  array['search_path=""'],
  'the hook sets search_path to empty'
);
select ok(
  has_function_privilege('supabase_auth_admin', 'private.hook_password_verification_attempt(jsonb)', 'execute')
  and has_schema_privilege('supabase_auth_admin', 'private', 'usage'),
  'Auth can run the hook'
);
select ok(
  not has_function_privilege('anon', 'private.hook_password_verification_attempt(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.hook_password_verification_attempt(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'private.hook_password_verification_attempt(jsonb)', 'execute'),
  'no API role can run the hook, so nobody can forge failures'
);
select ok(
  not has_function_privilege('anon', 'private.record_as(uuid, text, text, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.record_as(uuid, text, text, text, jsonb)', 'execute')
  and not has_function_privilege('service_role', 'private.record_as(uuid, text, text, text, jsonb)', 'execute'),
  'no API role can write audit rows as another actor'
);
select ok(
  not has_table_privilege('anon', 'private.login_failures', 'select, insert, update, delete')
  and not has_table_privilege('authenticated', 'private.login_failures', 'select, insert, update, delete')
  and not has_table_privilege('service_role', 'private.login_failures', 'select, insert, update, delete')
  and not has_table_privilege('authenticated', 'stats.login_failures_daily', 'select, insert, update, delete')
  and not has_table_privilege('service_role', 'stats.login_failures_daily', 'select, insert, update, delete'),
  'the failure counters have no API grants'
);

-- A valid password check changes nothing
select is(
  private.hook_password_verification_attempt(jsonb_build_object('user_id', :'u', 'valid', true)),
  '{"decision": "continue"}'::jsonb,
  'a valid check continues'
);
select is((select count(*) from private.login_failures where user_id = :'u'), 0::bigint, 'a valid check records no failure');

-- AC11: four failures write nothing, the fifth writes one row, the sixth none
select is(pg_temp.fail(:'u'), '{"decision": "continue"}'::jsonb, 'a failed check continues (Auth still answers invalid credentials)');
select pg_temp.fail(:'u');
select pg_temp.fail(:'u');
select pg_temp.fail(:'u');
select is(pg_temp.rows(:'u', 'login_failures_threshold'), 0::bigint, 'four failures write no audit row');
select is((select failures from private.login_failures where user_id = :'u'), 4, 'four failures are counted');

select pg_temp.fail(:'u');
select is(pg_temp.rows(:'u', 'login_failures_threshold'), 1::bigint, 'the fifth failure writes one audit row');
select is(
  (select actor_id from audit.log where action = 'login_failures_threshold' and entity_id = :'u'),
  :'u'::uuid,
  'the row names the account as actor'
);
select is(
  (select entity_type from audit.log where action = 'login_failures_threshold' and entity_id = :'u'),
  'user',
  'the entity is the user'
);
select is(
  (select metadata from audit.log where action = 'login_failures_threshold' and entity_id = :'u'),
  '{"failures": 5, "window_minutes": 15}'::jsonb,
  'the metadata holds the count and the window and nothing else'
);

select pg_temp.fail(:'u');
select is(pg_temp.rows(:'u', 'login_failures_threshold'), 1::bigint, 'the sixth failure in the window adds no second row');
select is((select failures from private.login_failures where user_id = :'u'), 6, 'the sixth failure is still counted');

select private.hook_password_verification_attempt(jsonb_build_object('user_id', :'u', 'valid', true));
select is(
  (select failures from private.login_failures where user_id = :'u'), 6,
  'a successful login does not delete the record'
);

-- Other accounts are counted on their own
select pg_temp.fail(:'v');
select is((select failures from private.login_failures where user_id = :'v'), 1, 'another account has its own count');
select is(pg_temp.rows(:'v', 'login_failures_threshold'), 0::bigint, 'one failure of another account writes no row');

-- A new window after 15 minutes: five more failures write a second row
update private.login_failures set window_started_at = now() - interval '16 minutes' where user_id = :'u';
select pg_temp.fail(:'u');
select is((select failures from private.login_failures where user_id = :'u'), 1, 'a failure after the window starts a new count');
select pg_temp.fail(:'u');
select pg_temp.fail(:'u');
select pg_temp.fail(:'u');
select is(pg_temp.rows(:'u', 'login_failures_threshold'), 1::bigint, 'four failures of the new window write no row');
select pg_temp.fail(:'u');
select is(pg_temp.rows(:'u', 'login_failures_threshold'), 2::bigint, 'five failures of a new window write a second row');

-- A window just inside the limit still counts
update private.login_failures set window_started_at = now() - interval '14 minutes', failures = 3, audited = false
  where user_id = :'v';
select pg_temp.fail(:'v');
select pg_temp.fail(:'v');
select is(pg_temp.rows(:'v', 'login_failures_threshold'), 1::bigint, 'failures 14 minutes apart count as one window');

-- The threshold is a setting
update private.settings set value = '2' where key = 'login_failure_threshold';
delete from private.login_failures where user_id = :'u';
select pg_temp.fail(:'u');
select pg_temp.fail(:'u');
select is(pg_temp.rows(:'u', 'login_failures_threshold'), 3::bigint, 'a changed threshold applies without a code change');
update private.settings set value = '5' where key = 'login_failure_threshold';

-- KPI counter: every failed check above is counted for its UTC day (16 calls so far)
select is(
  (select failures from stats.login_failures_daily where day = (now() at time zone 'utc')::date) - :failures_before,
  16,
  'failed checks are counted per day'
);

-- record_as leaves the caller's identity as it was
select set_config('request.jwt.claims', json_build_object('sub', :'stranger', 'role', 'authenticated')::text, true);
select pg_temp.fail(:'u');
select is(auth.uid(), :'stranger'::uuid, 'the caller keeps its own identity after an audited call');
select set_config('request.jwt.claims', '', true);
select is(auth.uid(), null, 'no identity is left behind when there was none');

-- AC10: every password change is audited, once, with no secret in the row
update auth.users set encrypted_password = 'hash-2' where id = :'u';
select is(pg_temp.rows(:'u', 'password_changed'), 1::bigint, 'a password change writes one audit row');
select is(
  (select actor_id from audit.log where action = 'password_changed' and entity_id = :'u'),
  :'u'::uuid,
  'the actor is the user whose password changed'
);
select is(
  (select entity_type from audit.log where action = 'password_changed' and entity_id = :'u'),
  'user',
  'the entity type is user'
);
select is(
  (select metadata from audit.log where action = 'password_changed' and entity_id = :'u'),
  '{}'::jsonb,
  'the row carries no password or token material'
);
update auth.users set encrypted_password = 'hash-2', raw_user_meta_data = raw_user_meta_data || '{"x":1}' where id = :'u';
update auth.users set last_sign_in_at = now() where id = :'u';
select is(pg_temp.rows(:'u', 'password_changed'), 1::bigint, 'an update that leaves the password alone writes no row');

-- Recovery link lifetime
insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at)
values
  (gen_random_uuid(), :'u', 'recovery_token', 'fresh-hash', 'login-u@example.test', now() at time zone 'utc'),
  (gen_random_uuid(), :'v', 'recovery_token', 'old-hash', 'login-v@example.test', (now() at time zone 'utc') - interval '61 minutes');
insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at)
values (gen_random_uuid(), :'u', 'confirmation_token', 'confirm-hash', 'login-u@example.test', now() at time zone 'utc');

set local role anon;
select is(public.recovery_link_is_fresh('fresh-hash'), true, 'a visitor can ask about a link younger than an hour');
select is(public.recovery_link_is_fresh('old-hash'), false, 'a link older than an hour is not fresh although Auth still accepts it');
select is(public.recovery_link_is_fresh('confirm-hash'), false, 'a confirmation token is not a recovery link');
select is(public.recovery_link_is_fresh('unknown-hash'), false, 'an unknown or used token is not fresh');
reset role;

update auth.one_time_tokens set created_at = (now() at time zone 'utc') - interval '59 minutes' where token_hash = 'fresh-hash';
select is(public.recovery_link_is_fresh('fresh-hash'), true, 'a link of 59 minutes is fresh');
update private.settings set value = '30' where key = 'recovery_link_minutes';
select is(public.recovery_link_is_fresh('fresh-hash'), false, 'the lifetime is a setting');
update private.settings set value = '60' where key = 'recovery_link_minutes';

select ok(
  not has_function_privilege('service_role', 'public.recovery_link_is_fresh(text)', 'execute')
  and has_function_privilege('authenticated', 'public.recovery_link_is_fresh(text)', 'execute'),
  'the link check is open to visitors and signed-in users only'
);
select is(
  (select proconfig from pg_proc where oid = 'public.recovery_link_is_fresh(text)'::regprocedure),
  array['search_path=""'],
  'the link check sets search_path to empty'
);

select * from finish();
rollback;
