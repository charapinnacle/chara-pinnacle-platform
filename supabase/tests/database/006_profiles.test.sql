begin;
select plan(41);

create function pg_temp.new_user(p_id uuid, p_meta jsonb, p_confirmed boolean default true) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@example.test', case when p_confirmed then now() end, p_meta)
$$;

create function pg_temp.as_user(p_id uuid) returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;

select has_table('public', 'profiles', 'profiles exists');
select columns_are(
  'public', 'profiles',
  array['id', 'account_kind', 'intended_account_kind', 'pending_consents', 'display_name', 'preferred_lang', 'status', 'deleted_at', 'created_at', 'legal_hold'],
  'profiles has the identity columns, the legal hold flag and no email or password'
);
select enum_has_labels('public', 'account_kind', array['worker', 'company'], 'account_kind is worker or company');
select enum_has_labels('public', 'profile_status', array['active', 'suspended', 'deletion_pending'], 'profile_status values');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled and forced'
);
select is_definer('private', 'handle_new_user', 'handle_new_user is SECURITY DEFINER');
select ok(
  (select 'search_path=""' = any (proconfig) from pg_proc where oid = 'private.handle_new_user()'::regprocedure),
  'handle_new_user sets search_path to empty'
);

select pg_temp.new_user(
  '00000000-0000-0000-0000-00000000a001',
  '{"intended_account_kind":"worker","pending_consents":[{"purpose":"terms-of-service","version":0},{"purpose":"age-18-plus","version":0}]}'
);
select pg_temp.new_user('00000000-0000-0000-0000-00000000b002', '{"intended_account_kind":"company"}');

select is(
  (select p.intended_account_kind::text || '/' || coalesce(p.account_kind::text, 'null') || '/' || p.status::text || '/' || p.preferred_lang
     from public.profiles p where p.id = '00000000-0000-0000-0000-00000000a001'),
  'worker/null/active/en',
  'sign-up creates one profile with the intended kind, no committed kind, active, English'
);
select is(
  (select p.pending_consents from public.profiles p where p.id = '00000000-0000-0000-0000-00000000a001'),
  '[{"purpose":"terms-of-service","version":0},{"purpose":"age-18-plus","version":0}]'::jsonb,
  'the sign-up consent entries are kept as pending consents'
);
select is(
  (select p.pending_consents from public.profiles p where p.id = '00000000-0000-0000-0000-00000000b002'),
  '[]'::jsonb,
  'pending consents default to an empty list'
);
select is(
  (select p.intended_account_kind::text from public.profiles p where p.id = '00000000-0000-0000-0000-00000000b002'),
  'company',
  'a company sign-up stores the company kind'
);
select is(
  (select count(*) from public.profiles where id in ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000b002')),
  2::bigint,
  'exactly one profile exists per user'
);

select throws_ok(
  $$select pg_temp.new_user('00000000-0000-0000-0000-00000000c003', '{"intended_account_kind":"admin"}')$$,
  'P0001', 'CHARA_INVALID_INPUT', 'sign-up with intended kind admin is refused'
);
select throws_ok(
  $$select pg_temp.new_user('00000000-0000-0000-0000-00000000c003', '{"intended_account_kind":"Worker"}')$$,
  'P0001', 'CHARA_INVALID_INPUT', 'sign-up with a kind in another spelling is refused'
);
select pg_temp.new_user('00000000-0000-0000-0000-00000000d101', '{"intended_account_kind":null}');
select pg_temp.new_user('00000000-0000-0000-0000-00000000d102', '{"other":"x","pending_consents":[{"purpose":"terms-of-service","version":0}]}');
select pg_temp.new_user('00000000-0000-0000-0000-00000000d103', null);
select is(
  (select count(*) from public.profiles
    where id in ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-00000000d102', '00000000-0000-0000-0000-00000000d103')
      and intended_account_kind is null and account_kind is null and pending_consents = '[]'),
  3::bigint,
  'a sign-up that names no kind (null, missing key, no metadata) gets a profile with no kind and no pending consents'
);
select throws_ok(
  $$select pg_temp.new_user('00000000-0000-0000-0000-00000000c003', '{"intended_account_kind":"worker","pending_consents":{"a":1}}')$$,
  '23514', null, 'pending consents that are not a list are refused'
);
select throws_ok(
  format(
    $$select pg_temp.new_user('00000000-0000-0000-0000-00000000c003', %L::jsonb)$$,
    jsonb_build_object('intended_account_kind', 'worker', 'pending_consents', (select jsonb_agg('{"purpose":"x","version":0}'::jsonb) from generate_series(1, 21)))
  ),
  '23514', null, 'more than 20 pending consent entries are refused'
);
select is_empty(
  $$select 1 from auth.users where id = '00000000-0000-0000-0000-00000000c003'
    union all select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000c003'$$,
  'a refused sign-up leaves no auth user and no profile'
);

-- Visibility
select pg_temp.as_user('00000000-0000-0000-0000-00000000a001');
set local role authenticated;
select results_eq(
  $$select id from public.profiles$$,
  $$values ('00000000-0000-0000-0000-00000000a001'::uuid)$$,
  'a user reads only their own profile'
);
select is_empty(
  $$select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000b002'$$,
  'another user''s profile is not readable'
);
select is(private.account_kind(), null, 'private.account_kind() is null before the kind is committed');

select throws_ok(
  $$update public.profiles set account_kind = 'worker' where id = '00000000-0000-0000-0000-00000000a001'$$,
  '42501', null, 'authenticated cannot update account_kind'
);
select throws_ok(
  $$update public.profiles set pending_consents = '[]' where id = '00000000-0000-0000-0000-00000000a001'$$,
  '42501', null, 'authenticated cannot update pending_consents'
);
select throws_ok(
  $$update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000a001'$$,
  '42501', null, 'authenticated cannot update status'
);
select throws_ok(
  $$update public.profiles set intended_account_kind = 'company' where id = '00000000-0000-0000-0000-00000000a001'$$,
  '42501', null, 'authenticated cannot update intended_account_kind'
);
select throws_ok(
  $$insert into public.profiles (id, intended_account_kind) values ('00000000-0000-0000-0000-00000000c003', 'worker')$$,
  '42501', null, 'authenticated cannot insert a profile'
);
select throws_ok(
  $$delete from public.profiles where id = '00000000-0000-0000-0000-00000000a001'$$,
  '42501', null, 'authenticated cannot delete a profile'
);
reset role;

set local role anon;
select throws_ok($$select * from public.profiles$$, '42501', null, 'anon cannot read profiles');
reset role;

set local role service_role;
select throws_ok($$select * from public.profiles$$, '42501', null, 'service_role cannot read profiles');
select throws_ok(
  $$update public.profiles set account_kind = 'worker' where id = '00000000-0000-0000-0000-00000000a001'$$,
  '42501', null, 'service_role cannot update account_kind'
);
reset role;

-- Immutability, as the table owner
select throws_ok(
  $$update public.profiles set intended_account_kind = 'company' where id = '00000000-0000-0000-0000-00000000a001'$$,
  'P0001', 'CHARA_FORBIDDEN', 'the intended kind cannot be changed'
);
select throws_ok(
  $$update public.profiles set account_kind = 'company' where id = '00000000-0000-0000-0000-00000000a001'$$,
  'P0001', 'CHARA_FORBIDDEN', 'the kind cannot be committed to a value other than the intended kind'
);

update public.profiles set account_kind = 'worker' where id = '00000000-0000-0000-0000-00000000a001';
select is(
  (select account_kind::text from public.profiles where id = '00000000-0000-0000-0000-00000000a001'),
  'worker',
  'the kind can be committed once from null to the intended kind'
);
select throws_ok(
  $$update public.profiles set account_kind = 'company' where id = '00000000-0000-0000-0000-00000000a001'$$,
  'P0001', 'CHARA_FORBIDDEN', 'a committed kind cannot change to the other kind'
);
select throws_ok(
  $$update public.profiles set account_kind = null where id = '00000000-0000-0000-0000-00000000a001'$$,
  'P0001', 'CHARA_FORBIDDEN', 'a committed kind cannot be cleared'
);
set local session_replication_role = replica;
select throws_ok(
  $$update public.profiles set account_kind = 'company' where id = '00000000-0000-0000-0000-00000000a001'$$,
  'P0001', 'CHARA_FORBIDDEN', 'the immutability rule also holds in replica mode'
);
set local session_replication_role = origin;
select is(
  (select account_kind::text from public.profiles where id = '00000000-0000-0000-0000-00000000a001'),
  'worker',
  'the kind is unchanged after the refused updates'
);
select is(
  (select account_kind from public.profiles where id = '00000000-0000-0000-0000-00000000b002'),
  null,
  'another user''s uncommitted kind is untouched'
);

select pg_temp.as_user('00000000-0000-0000-0000-00000000a001');
set local role authenticated;
select is(private.account_kind()::text, 'worker', 'private.account_kind() returns the committed kind');
reset role;

select ok(
  not has_function_privilege('anon', 'private.account_kind()', 'execute'),
  'anon cannot execute private.account_kind()'
);

delete from auth.users where id = '00000000-0000-0000-0000-00000000b002';
select is_empty(
  $$select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000b002'$$,
  'deleting the auth user removes the profile'
);

select * from finish();
rollback;
