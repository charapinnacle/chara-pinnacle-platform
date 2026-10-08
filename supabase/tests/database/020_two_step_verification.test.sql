begin;
select plan(82);

\ir organizations_fixture.inc

\set sta '00000000-0000-0000-0000-00000000b101'
\set stb '00000000-0000-0000-0000-00000000b102'
\set tss '00000000-0000-0000-0000-00000000b103'
\set vrv '00000000-0000-0000-0000-00000000b104'
\set rev '00000000-0000-0000-0000-00000000b105'
\set tgt '00000000-0000-0000-0000-00000000b106'

select pg_temp.new_user(:'sta');
select pg_temp.new_user(:'stb');
select pg_temp.new_user(:'tss');
select pg_temp.new_user(:'vrv');
select pg_temp.new_user(:'rev');
select pg_temp.new_user(:'tgt');

create function pg_temp.add_factor(p_user uuid, p_name text, p_status auth.factor_status) returns void
language sql as $$
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (gen_random_uuid(), p_user, p_name, 'totp', p_status, now(), now(), 'JBSWY3DPEHPK3PXP')
$$;

insert into public.platform_staff (user_id, role) values
  (:'sta', 'admin'), (:'stb', 'admin'), (:'tss', 'trust_safety'), (:'vrv', 'verification_reviewer');
insert into public.platform_staff (user_id, role, revoked_at) values (:'rev', 'admin', now());
select pg_temp.add_factor(:'sta', 'Authenticator', 'verified');
select pg_temp.add_factor(:'vrv', 'Authenticator', 'unverified');
select pg_temp.add_factor(:'tgt', 'Authenticator', 'verified');
select pg_temp.add_factor(:'tgt', 'Backup', 'verified');
select pg_temp.add_factor(:'own1', 'Authenticator', 'verified');
select pg_temp.add_factor(:'adm', 'Authenticator', 'unverified');
select pg_temp.add_factor(:'mem', 'Authenticator', 'verified');

select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.a', (public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'DE', 'F'))->>'organization_id', true)$$, 'aal1'),
  'ok', 'a new owner at aal1 creates an organization');
select is(pg_temp.call_as(:'own2', 'authenticated',
  $$select set_config('t.b', (public.create_organization('employer', 'Beta Works Ltd', 'Beta Works', 'GB', 'F'))->>'organization_id', true)$$, 'aal1'),
  'ok', 'a second owner at aal1 creates an organization');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.a')::uuid, :'adm', 'admin', now()), (current_setting('t.a')::uuid, :'mem', 'member', now()),
  (current_setting('t.b')::uuid, :'adm2', 'admin', now()), (current_setting('t.b')::uuid, :'late', 'member', now());

-- AC5: reads. The own membership and organization stay readable at aal1 so a new owner reaches enrolment (D8).
select is(pg_temp.val_as(:'own1', 'aal1', 'select count(*) from public.organizations'), '1', 'an owner at aal1 reads the organization');
select is(pg_temp.val_as(:'own1', 'aal1', format($$select count(*) from public.organization_members where user_id = %L$$, :'own1')), '1',
  'an owner at aal1 reads their own membership');
select is(pg_temp.call_as(:'own1', 'authenticated', format($$select public.invite_member(%L, 'later@example.test', 'member')$$, current_setting('t.a'))),
  'ok', 'an owner at aal2 invites a member');
select is(pg_temp.val_as(:'own1', 'aal1', 'select count(*) from public.organization_invitations'), '0', 'an owner at aal1 reads no invitations');
select is(pg_temp.val_as(:'own1', 'aal2', 'select count(*) from public.organization_invitations'), '1', 'an owner at aal2 reads the invitations');
select is(pg_temp.val_as(:'sta', 'aal1', 'select count(*) from public.platform_staff'), '0', 'staff at aal1 read no platform_staff row, not even their own');
select is(pg_temp.val_as(:'sta', 'aal2', 'select count(*) from public.platform_staff'), '1', 'staff at aal2 read their own platform_staff row');
select is(pg_temp.val_as(:'rev', 'aal2', 'select count(*) from public.platform_staff'), '0', 'a revoked staff member reads no platform_staff row at aal2 either');
select ok(
  exists (select 1 from pg_policy p where p.polrelid = 'public.platform_staff'::regclass and not p.polpermissive and p.polname = 'platform_staff_requires_mfa'),
  'the aal2 gate of platform_staff is a restrictive policy'
);

-- AC5: the member-management RPCs need aal2
select is(pg_temp.call_as(:'own1', 'authenticated', format($$select public.invite_member(%L, 'x@example.test', 'member')$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'invite_member refuses aal1');
select is(pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.a'), :'mem'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'change_member_role refuses aal1');
select is(pg_temp.call_as(:'own1', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'mem'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'remove_member refuses aal1');
select is(pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'adm'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'transfer_ownership refuses aal1');
select is(pg_temp.call_as(:'own2', 'authenticated', format($$select public.invite_member(%L, 'x@example.test', 'member')$$, current_setting('t.b'))),
  'ok', 'invite_member succeeds at aal2');
select is(pg_temp.call_as(:'own2', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.b'), :'late')),
  'ok', 'change_member_role succeeds at aal2');
select is(pg_temp.call_as(:'own2', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.b'), :'late')),
  'ok', 'remove_member succeeds at aal2');

-- accept_invitation works at aal1: the invited person has not enrolled yet
select is(pg_temp.call_as(:'own2', 'authenticated',
  format($$select set_config('t.tok', (select token from public.invite_member(%L, 'bea@example.test', 'member')), true)$$, current_setting('t.b'))),
  'ok', 'the invitation of a person who has not enrolled yet is made at aal2');
select is(pg_temp.call_as(:'inv', 'authenticated', $$select public.accept_invitation(current_setting('t.tok'))$$, 'aal1'),
  'ok', 'accept_invitation works at aal1');
select is(pg_temp.call_as(:'own2', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.b'), :'adm2')),
  'ok', 'transfer_ownership succeeds at aal2');

-- AC11: list_organization_members
select is(
  pg_temp.val_as(:'own1', 'aal2', format($$
    select string_agg(role || ':' || coalesce(mfa_enrolled::text, 'null'), ',' order by role)
    from (select role::text as role, mfa_enrolled from public.list_organization_members(%L)) t$$, current_setting('t.a'))),
  'admin:false,member:null,owner:true',
  'the owner at aal2 gets mfa_enrolled for the owner and admin rows and null for the member row, even though the member has a factor'
);
select is(
  pg_temp.val_as(:'adm', 'aal2', format($$select count(*) from public.list_organization_members(%L)$$, current_setting('t.a'))),
  '3', 'an admin at aal2 lists the members'
);
select is(pg_temp.call_as(:'own1', 'authenticated', format($$select * from public.list_organization_members(%L)$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'the owner at aal1 gets aal2_required');
select is(
  pg_temp.val_as(:'mem', 'aal1', format($$
    select string_agg(coalesce(mfa_enrolled::text, 'null') || '/' || coalesce(email, 'null'), ',')
    from public.list_organization_members(%L)$$, current_setting('t.a'))),
  'null/null,null/null,null/null', 'a plain member gets no status data and no email address, even at aal1');
select is(pg_temp.call_as(:'own2', 'authenticated', format($$select * from public.list_organization_members(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organization gets no status data');
select is(pg_temp.call_as(:'tss', 'authenticated', format($$select * from public.list_organization_members(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|', 'a trust_safety user gets no member status data');
select is(pg_temp.call_as(:'wkr', 'authenticated', format($$select * from public.list_organization_members(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|', 'a worker gets no status data');
select is(pg_temp.call_as(:'own1', 'authenticated', $$select * from public.list_organization_members(null)$$),
  'P0001|CHARA_FORBIDDEN|', 'a missing organization answers like a foreign one');
select is(pg_temp.call_as(null, 'anon', format($$select * from public.list_organization_members(%L)$$, current_setting('t.a'))),
  '42501|permission denied for function list_organization_members|', 'the anonymous caller is refused at EXECUTE');
select is(
  (select proargnames::text from pg_proc where oid = 'public.list_organization_members(uuid, integer, uuid)'::regprocedure),
  '{p_org,p_limit,p_after_user,user_id,display_name,email,role,accepted_at,mfa_enrolled}', 'no factor id or secret is returned; the name and address are the only added columns'
);
select is(
  pg_temp.val_as(:'own1', 'aal2', format($$select pg_typeof(mfa_enrolled)::text from public.list_organization_members(%L) limit 1$$, current_setting('t.a'))),
  'boolean', 'mfa_enrolled is a boolean'
);

-- Keyset pages: an organization with more than 100 accepted members loses no one
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select ('00000000-0000-0000-0000-0000000f' || lpad(n::text, 4, '0'))::uuid, 'bulk' || n || '@example.test', now(),
  jsonb_build_object('intended_account_kind', 'company')
from generate_series(1, 102) n;
update public.profiles set account_kind = intended_account_kind where id::text like '00000000-0000-0000-0000-0000000f%';
insert into public.organization_members (organization_id, user_id, role, accepted_at)
select current_setting('t.a')::uuid, ('00000000-0000-0000-0000-0000000f' || lpad(n::text, 4, '0'))::uuid, 'member', now()
from generate_series(1, 102) n;
select is(pg_temp.val_as(:'own1', 'aal2', format($$select count(*) from public.list_organization_members(%L)$$, current_setting('t.a'))),
  '50', 'a list without a limit returns a page of 50');
select is(pg_temp.val_as(:'own1', 'aal2', format($$select count(*) from public.list_organization_members(%L, 100000)$$, current_setting('t.a'))),
  '100', 'a limit above 100 is capped at 100');
select is(pg_temp.val_as(:'own1', 'aal2', format($$select count(*) from public.list_organization_members(%L, 0)$$, current_setting('t.a'))),
  '1', 'a limit of 0 is raised to 1');
select is(
  pg_temp.val_as(:'own1', 'aal2', format($$
    select count(distinct user_id) from (
      select user_id from public.list_organization_members(%1$L, 100)
      union all
      select user_id from public.list_organization_members(%1$L, 100,
        (select user_id from public.list_organization_members(%1$L, 100) order by user_id desc limit 1))
    ) t$$, current_setting('t.a'))),
  '105', 'two pages by keyset return all 105 accepted members once each');
select is(
  pg_temp.val_as(:'own1', 'aal2', format($$
    select count(*) from public.list_organization_members(%1$L, 100,
      (select user_id from public.list_organization_members(%1$L, 100) order by user_id desc limit 1))$$, current_setting('t.a'))),
  '5', 'the second page holds the remaining 5');
select has_index('audit', 'log', 'log_action_created_at_idx', 'the reset KPI reads an index on action and created_at');

-- AC11: list_platform_staff
select is(
  pg_temp.val_as(:'sta', 'aal2', $$
    select string_agg(role || ':' || mfa_enrolled::text, ',' order by role, mfa_enrolled)
    from (select role::text as role, mfa_enrolled from public.list_platform_staff()) t$$),
  'admin:false,admin:false,admin:true,trust_safety:false,verification_reviewer:false',
  'the administrator at aal2 gets mfa_enrolled for each staff row, a revoked one included; an unverified factor does not count'
);
select is(pg_temp.call_as(:'sta', 'authenticated', $$select * from public.list_platform_staff()$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'the administrator at aal1 gets aal2_required');
select is(pg_temp.call_as(:'tss', 'authenticated', $$select * from public.list_platform_staff()$$),
  'P0001|CHARA_FORBIDDEN|', 'a trust_safety user gets no staff status data');
select is(pg_temp.call_as(:'vrv', 'authenticated', $$select * from public.list_platform_staff()$$),
  'P0001|CHARA_FORBIDDEN|', 'a verification_reviewer gets no staff status data');
select is(pg_temp.call_as(:'rev', 'authenticated', $$select * from public.list_platform_staff()$$),
  'P0001|CHARA_FORBIDDEN|', 'a revoked administrator gets no staff status data');
select is(pg_temp.call_as(:'own1', 'authenticated', $$select * from public.list_platform_staff()$$),
  'P0001|CHARA_FORBIDDEN|', 'an employer owner gets no staff status data');
select is(pg_temp.call_as(null, 'anon', $$select * from public.list_platform_staff()$$),
  '42501|permission denied for function list_platform_staff|', 'the anonymous caller is refused at EXECUTE');
select is(
  (select proargnames::text from pg_proc where oid = 'public.list_platform_staff(integer, bigint)'::regprocedure),
  '{p_limit,p_after_id,id,user_id,display_name,email,role,granted_by,granted_by_email,granted_at,revoked_at,mfa_enrolled,last_sign_in_at}',
  'the staff list returns no factor id or secret, only the name, the email address, the dates and a boolean for two-step verification'
);
select is(
  pg_temp.val_as(:'sta', 'aal2', $$select count(*) from public.list_platform_staff(2)$$), '2', 'the staff list honours the limit');
select is(
  pg_temp.val_as(:'sta', 'aal2', $$select count(*) from public.list_platform_staff(2, (select min(id) from public.list_platform_staff(2)))$$),
  '2', 'the second page of the staff list holds the other two active staff members');
select is(
  pg_temp.val_as(:'sta', 'aal2', $$select count(*) from public.list_platform_staff(100, (select min(id) from public.list_platform_staff(100)))$$),
  '0', 'a page after the last row is empty');

-- my_platform_roles: what the page guard asks, at any aal
select is(pg_temp.val_as(:'sta', 'aal1', $$select string_agg(r::text, ',') from public.my_platform_roles() r$$), 'admin',
  'staff at aal1 learn their role');
select is(pg_temp.val_as(:'tss', 'aal1', $$select string_agg(r::text, ',') from public.my_platform_roles() r$$), 'trust_safety',
  'a trust_safety user learns the role');
select is(pg_temp.val_as(:'rev', 'aal1', $$select count(*) from public.my_platform_roles()$$), '0', 'a revoked role is not reported');
select is(pg_temp.val_as(:'own1', 'aal1', $$select count(*) from public.my_platform_roles()$$), '0', 'an employer owner holds no platform role');
select is(pg_temp.call_as(null, 'anon', $$select * from public.my_platform_roles()$$),
  '42501|permission denied for function my_platform_roles|', 'an anonymous caller cannot ask');

-- AC8: reset_mfa
select is(
  (select count(*) from audit.log where action = 'mfa.reset') + (select count(*) from pgmq.q_account_ops where message ->> 'action' = 'reset_mfa')
  + (select count(*) from pgmq.q_notifications where message ->> 'kind' = 'mfa_reset'),
  0::bigint, 'nothing is queued or audited before the first reset'
);
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, '  Identity checked by video call, ticket 4711  ')$$, :'tgt')),
  'ok', 'an administrator at aal2 resets another user');
select is(
  (select format('%s|%s|%s|%s', actor_id = :'sta', entity_type, entity_id = :'tgt', metadata - 'request_id')
   from audit.log where action = 'mfa.reset'),
  't|profile|t|{"reason": "Identity checked by video call, ticket 4711"}',
  'one audit row names the administrator, the target and the trimmed reason'
);
select is((select count(*) from audit.log where action = 'mfa.reset'), 1::bigint, 'exactly one audit row is written');
select is(
  (select format('%s|%s', count(*), min(message ->> 'action')) from pgmq.q_account_ops where message ->> 'user_id' = :'tgt'),
  '1|reset_mfa', 'one account-ops job is queued for the target'
);
select is(
  (select format('%s|%s', count(*), min(message ->> 'mandatory')) from pgmq.q_notifications
   where message ->> 'user_id' = :'tgt' and message ->> 'kind' = 'mfa_reset'),
  '1|true', 'one mandatory mfa_reset notification is queued for the target'
);
select is(
  (select count(*) from auth.mfa_factors where user_id = :'tgt' and status = 'verified'), 2::bigint,
  'no factor is deleted inside the database call'
);
select ok(
  not exists (select 1 from audit.log where metadata::text like '%JBSWY3DPEHPK3PXP%'),
  'no secret reaches the audit log'
);
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, 'Identity checked by video call, ticket 4711')$$, :'tgt')),
  'ok', 'a repeated reset of the same user while the job waits is accepted');
select is((select count(*) from audit.log where action = 'mfa.reset'), 2::bigint, 'the repeat is audited too');
select is(
  (select format('%s|%s', (select count(*) from pgmq.q_account_ops where message ->> 'user_id' = :'tgt'),
     (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'tgt'))),
  '1|1', 'but queues no second job and no second mandatory email');

-- AC9: refusals write nothing
create temp table before_counts as
select (select count(*) from audit.log where action = 'mfa.reset') as audits,
       (select count(*) from pgmq.q_account_ops) as jobs,
       (select count(*) from pgmq.q_notifications) as notes;

select is(pg_temp.call_as(:'tss', 'authenticated', format($$select public.reset_mfa(%L, 'Identity checked by video call')$$, :'tgt')),
  'P0001|CHARA_FORBIDDEN|', 'a trust_safety user is refused');
select is(pg_temp.call_as(:'vrv', 'authenticated', format($$select public.reset_mfa(%L, 'Identity checked by video call')$$, :'tgt')),
  'P0001|CHARA_FORBIDDEN|', 'a verification_reviewer is refused');
select is(pg_temp.call_as(:'rev', 'authenticated', format($$select public.reset_mfa(%L, 'Identity checked by video call')$$, :'tgt')),
  'P0001|CHARA_FORBIDDEN|', 'an administrator whose role was revoked is refused');
select is(pg_temp.call_as(:'own1', 'authenticated', format($$select public.reset_mfa(%L, 'Identity checked by video call')$$, :'tgt')),
  'P0001|CHARA_FORBIDDEN|', 'an employer owner is refused');
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, 'Identity checked by video call')$$, :'tgt'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an administrator at aal1 is refused with aal2_required');
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, 'Identity checked by video call')$$, :'sta')),
  'P0001|CHARA_FORBIDDEN|own_account', 'an administrator cannot reset their own factors');
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, 'too short')$$, :'tgt')),
  'P0001|CHARA_INVALID_INPUT|reason', 'a reason of 9 characters is refused');
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, %L)$$, :'tgt', repeat('x', 2001))),
  'P0001|CHARA_INVALID_INPUT|reason', 'a reason of 2001 characters is refused (FR-F2 AC3)');
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, '')$$, :'tgt')),
  'P0001|CHARA_INVALID_INPUT|reason', 'an empty reason is refused');
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, '            ')$$, :'tgt')),
  'P0001|CHARA_INVALID_INPUT|reason', 'a reason of spaces only is refused');
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, null)$$, :'tgt')),
  'P0001|CHARA_INVALID_INPUT|reason', 'a missing reason is refused');
select is(pg_temp.call_as(:'sta', 'authenticated', $$select public.reset_mfa('00000000-0000-0000-0000-0000000000ee', 'Identity checked by video call')$$),
  'P0001|CHARA_INVALID_INPUT|user', 'an unknown user id is refused');
select is(pg_temp.call_as(:'sta', 'authenticated', $$select public.reset_mfa(null, 'Identity checked by video call')$$),
  'P0001|CHARA_INVALID_INPUT|user', 'a missing user id is refused');
select is(pg_temp.call_as(null, 'anon', format($$select public.reset_mfa(%L, 'Identity checked by video call')$$, :'tgt')),
  '42501|permission denied for function reset_mfa|', 'the anonymous caller is refused at EXECUTE');
select is(
  (select format('%s|%s|%s', (select count(*) from audit.log where action = 'mfa.reset') - audits,
     (select count(*) from pgmq.q_account_ops) - jobs, (select count(*) from pgmq.q_notifications) - notes)
   from before_counts),
  '0|0|0', 'no refusal writes an audit row, a job or a notification'
);

-- the queues are closed to the API roles
select ok(
  not has_schema_privilege('authenticated', 'pgmq', 'usage') and not has_schema_privilege('anon', 'pgmq', 'usage')
  and not has_schema_privilege('service_role', 'pgmq', 'usage')
  and not has_table_privilege('authenticated', 'pgmq.q_account_ops', 'select, insert, update, delete')
  and not has_table_privilege('service_role', 'pgmq.q_notifications', 'select, insert, update, delete'),
  'the API roles have no access to the queues'
);
select ok(
  not has_function_privilege('service_role', 'public.reset_mfa(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.my_platform_roles()', 'execute'),
  'reset_mfa is not executable by service_role and my_platform_roles not by anon'
);

select * from finish();
rollback;
