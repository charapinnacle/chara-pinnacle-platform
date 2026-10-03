begin;
select plan(30);

create function pg_temp.new_user(p_id uuid) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@example.test', now(), '{"intended_account_kind":"company"}')
$$;

create function pg_temp.as_user(p_id uuid) returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;

select pg_temp.new_user('00000000-0000-0000-0000-00000000a001');
select pg_temp.new_user('00000000-0000-0000-0000-00000000b002');
select pg_temp.new_user('00000000-0000-0000-0000-00000000c003');

select has_table('public', 'platform_staff', 'platform_staff exists');
select columns_are(
  'public', 'platform_staff',
  array['id', 'user_id', 'role', 'granted_by', 'granted_at', 'revoked_at'],
  'platform_staff has the staff columns'
);
select enum_has_labels(
  'public', 'platform_role', array['admin', 'verification_reviewer', 'trust_safety'],
  'the three platform roles exist from the first migration'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.platform_staff'::regclass),
  'platform_staff has RLS enabled and forced'
);
select ok(
  not has_table_privilege('authenticated', 'public.platform_staff', 'insert, update, delete, truncate')
  and not has_any_column_privilege('authenticated', 'public.platform_staff', 'insert, update')
  and not has_table_privilege('anon', 'public.platform_staff', 'select, insert, update, delete, truncate')
  and not has_any_column_privilege('anon', 'public.platform_staff', 'select, insert, update')
  and not has_table_privilege('service_role', 'public.platform_staff', 'select, insert, update, delete, truncate')
  and not has_any_column_privilege('service_role', 'public.platform_staff', 'select, insert, update'),
  'no API role can write platform_staff; anon and service_role cannot read it'
);

-- Bootstrap insert by the table owner is audited with no actor
insert into public.platform_staff (user_id, role) values ('00000000-0000-0000-0000-00000000a001', 'admin');
select is(
  (select count(*) from audit.log where action = 'platform_role_granted'
     and metadata ->> 'user_id' = '00000000-0000-0000-0000-00000000a001' and metadata ->> 'role' = 'admin' and actor_id is null),
  1::bigint,
  'the bootstrap insert writes one platform_role_granted audit row with no actor'
);

-- Grant by an administrator carries grantor and reason
select pg_temp.as_user('00000000-0000-0000-0000-00000000a001');
select set_config('chara.audit_reason', 'New hire, ticket 4812', true);
insert into public.platform_staff (user_id, role, granted_by)
values ('00000000-0000-0000-0000-00000000b002', 'trust_safety', '00000000-0000-0000-0000-00000000a001');
select set_config('chara.audit_reason', '', true);
select is(
  (select metadata from audit.log where action = 'platform_role_granted'
     and metadata ->> 'user_id' = '00000000-0000-0000-0000-00000000b002'),
  '{"user_id":"00000000-0000-0000-0000-00000000b002","role":"trust_safety","granted_by":"00000000-0000-0000-0000-00000000a001","reason":"New hire, ticket 4812"}'::jsonb,
  'a grant audit row holds grantee, role, grantor and the reason'
);
select is(
  (select actor_id from audit.log where action = 'platform_role_granted'
     and metadata ->> 'user_id' = '00000000-0000-0000-0000-00000000b002'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'the audit actor is the signed-in grantor'
);
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$insert into public.platform_staff (user_id, role) values ('00000000-0000-0000-0000-00000000b002', 'trust_safety')$$,
  '23505', null, 'a second active row for the same user and role is refused'
);
insert into public.platform_staff (user_id, role) values ('00000000-0000-0000-0000-00000000b002', 'verification_reviewer');
select is(
  (select count(*) from public.platform_staff where user_id = '00000000-0000-0000-0000-00000000b002'),
  2::bigint,
  'one person may hold several roles'
);
insert into public.platform_staff (user_id, role) values ('00000000-0000-0000-0000-00000000c003', 'trust_safety');
select is(
  (select count(*) from public.platform_staff where role = 'trust_safety'),
  2::bigint,
  'several people may hold the same role'
);
select throws_ok(
  $$insert into public.platform_staff (user_id, role) values ('00000000-0000-0000-0000-00000000c003', 'superuser')$$,
  '22P02', null, 'a role outside the enum is refused'
);
select throws_ok(
  $$insert into public.platform_staff (user_id, role) values ('00000000-0000-0000-0000-0000000000ff', 'admin')$$,
  '23503', null, 'a role cannot be granted to an unknown user'
);

-- has_platform_role looks the role up
select pg_temp.as_user('00000000-0000-0000-0000-00000000a001');
set local role authenticated;
select ok(private.has_platform_role('admin'), 'has_platform_role is true for the holder');
select ok(not private.has_platform_role('trust_safety'), 'has_platform_role is false for a role the user does not hold');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000c003');
set local role authenticated;
select ok(private.has_platform_role('trust_safety'), 'has_platform_role is true for another holder in their own session');
select ok(not private.has_platform_role('admin'), 'a trust_safety user is not an admin');
reset role;
select ok(
  not has_function_privilege('anon', 'private.has_platform_role(public.platform_role)', 'execute'),
  'anon cannot execute has_platform_role'
);

-- Reads are limited to the caller's own active rows
select pg_temp.as_user('00000000-0000-0000-0000-00000000b002');
set local role authenticated;
select results_eq(
  $$select role::text from public.platform_staff order by role$$,
  $$values ('trust_safety'), ('verification_reviewer')$$,
  'staff reads only their own roles'
);
select throws_ok($$select granted_by from public.platform_staff$$, '42501', null, 'granted_by is not readable by authenticated');
select throws_ok(
  $$insert into public.platform_staff (user_id, role) values ('00000000-0000-0000-0000-00000000b002', 'admin')$$,
  '42501', null, 'staff cannot grant themselves a role'
);
select throws_ok(
  $$update public.platform_staff set revoked_at = now()$$,
  '42501', null, 'staff cannot revoke a role directly'
);
select throws_ok($$delete from public.platform_staff$$, '42501', null, 'staff cannot delete a role row');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000b002');
set local role authenticated;
select throws_ok(
  $$update public.profiles set status = 'active'$$,
  '42501', null, 'a profile update cannot change platform roles or anything else on profiles'
);
reset role;

-- Ordinary user
select pg_temp.new_user('00000000-0000-0000-0000-00000000d004');
select pg_temp.as_user('00000000-0000-0000-0000-00000000d004');
set local role authenticated;
select is_empty($$select user_id, role from public.platform_staff$$, 'an ordinary user sees no staff rows');
select ok(not private.has_platform_role('admin'), 'an ordinary user holds no role');
reset role;

-- Revocation keeps the row, is audited and ends the role
select set_config('chara.audit_reason', 'Left the team', true);
update public.platform_staff set revoked_at = now()
where user_id = '00000000-0000-0000-0000-00000000b002' and role = 'verification_reviewer';
select set_config('chara.audit_reason', '', true);
select is(
  (select metadata ->> 'reason' from audit.log
    where action = 'platform_role_revoked' and metadata ->> 'user_id' = '00000000-0000-0000-0000-00000000b002'),
  'Left the team',
  'a revocation writes one audit row with the reason'
);
select pg_temp.as_user('00000000-0000-0000-0000-00000000b002');
set local role authenticated;
select results_eq(
  $$select role::text from public.platform_staff$$,
  $$values ('trust_safety')$$,
  'a revoked role is no longer visible to its former holder'
);
reset role;
select is(
  (select count(*) from public.platform_staff where user_id = '00000000-0000-0000-0000-00000000b002'),
  2::bigint,
  'the revoked row is kept as history'
);
insert into public.platform_staff (user_id, role) values ('00000000-0000-0000-0000-00000000b002', 'verification_reviewer');
select is(
  (select count(*) from public.platform_staff
    where user_id = '00000000-0000-0000-0000-00000000b002' and role = 'verification_reviewer'),
  2::bigint,
  'a revoked role can be granted again as a new row'
);

select * from finish();
rollback;
