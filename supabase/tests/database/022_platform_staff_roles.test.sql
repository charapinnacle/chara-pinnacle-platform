begin;
select plan(128);

\ir organizations_fixture.inc

\set adm '00000000-0000-0000-0000-00000000c101'
\set tss '00000000-0000-0000-0000-00000000c102'
\set vrv '00000000-0000-0000-0000-00000000c103'
\set own '00000000-0000-0000-0000-00000000c104'
\set u1 '00000000-0000-0000-0000-00000000c105'
\set u2 '00000000-0000-0000-0000-00000000c106'
\set unc '00000000-0000-0000-0000-00000000c107'
\set sus '00000000-0000-0000-0000-00000000c108'
\set rev '00000000-0000-0000-0000-00000000c109'
\set u3 '00000000-0000-0000-0000-00000000c110'
\set tgt '00000000-0000-0000-0000-00000000c111'
\set nobody '00000000-0000-0000-0000-00000000c1ee'

select pg_temp.new_user(:'adm');
select pg_temp.new_user(:'tss');
select pg_temp.new_user(:'vrv');
select pg_temp.new_user(:'own');
select pg_temp.new_user(:'u1');
select pg_temp.new_user(:'u2');
select pg_temp.new_user(:'unc', 'company', 'unc-staff@example.test', false);
select pg_temp.new_user(:'sus');
select pg_temp.new_user(:'rev');
select pg_temp.new_user(:'u3');
select pg_temp.new_user(:'tgt');
update public.profiles set status = 'suspended' where id = :'sus';

create function pg_temp.snapshot() returns text
language sql as $$
  select format('%s|%s|%s|%s',
    (select count(*) from public.platform_staff),
    (select count(*) from audit.log where action in ('platform_role.grant', 'platform_role.revoke')),
    (select count(*) from pgmq.q_account_ops),
    (select count(*) from pgmq.q_notifications))
$$;

-- AC8: the ticketed bootstrap insert of the runbook is audited without an actor and carries its ticket as the reason
select is((select count(*) from public.platform_staff), 0::bigint, 'platform_staff starts empty');
select set_config('chara.audit_reason', 'Bootstrap of the first administrator, ticket 4800', true);
insert into public.platform_staff (user_id, role)
select u.id, 'admin' from auth.users u where u.id = :'adm' and u.email_confirmed_at is not null;
select set_config('chara.audit_reason', '', true);
select is(
  (select format('%s|%s|%s|%s', count(*), min(actor_id::text), min(metadata ->> 'role'), min(metadata ->> 'reason'))
   from audit.log where action = 'platform_role.grant' and metadata ->> 'user_id' = :'adm'),
  '1||admin|Bootstrap of the first administrator, ticket 4800',
  'the bootstrap insert writes one audit row with no actor, the role and its ticket'
);
insert into public.platform_staff (user_id, role) values (:'tss', 'trust_safety'), (:'vrv', 'verification_reviewer');
insert into public.platform_staff (user_id, role, revoked_at) values (:'rev', 'admin', now());
select is(pg_temp.call_as(:'adm', 'authenticated', format($$insert into public.platform_staff (user_id, role) values (%L, 'admin')$$, :'u1')),
  '42501|permission denied for table platform_staff|', 'after the bootstrap an authenticated administrator cannot insert a row directly');

-- AC1: grants
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'New T&S hire, ticket 4812')$$, :'u1')),
  'ok', 'an administrator at aal2 grants trust_safety to U1');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'New T&S hire, ticket 4813')$$, :'u2')),
  'ok', 'the same role goes to U2');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'verification_reviewer', '  Second role for U1, ticket 4814  ')$$, :'u1')),
  'ok', 'U1 gets a second role');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'admin', 'Second administrator, ticket 4815')$$, :'u1')),
  'ok', 'U1 gets the admin role');
select is(
  (select string_agg(role::text, ',' order by role) from public.platform_staff where user_id = :'u1'),
  'admin,verification_reviewer,trust_safety', 'one person holds several roles'
);
select is(
  (select count(*) from public.platform_staff where role = 'trust_safety' and user_id in (:'u1', :'u2')),
  2::bigint, 'several people hold the same role'
);
select is(
  (select count(*) from public.platform_staff
   where user_id in (:'u1', :'u2') and granted_by = :'adm' and granted_at = now() and revoked_at is null),
  4::bigint, 'each grant leaves a row with the grantor, granted_at now and no revocation'
);
select is(
  (select count(*) from audit.log where action = 'platform_role.grant' and actor_id = :'adm'), 4::bigint,
  'each grant writes exactly one audit row'
);
select is(
  (select metadata - 'staff_id' - 'request_id' from audit.log where action = 'platform_role.grant' and metadata ->> 'user_id' = :'u1' and metadata ->> 'role' = 'trust_safety'),
  format('{"user_id":"%s","role":"trust_safety","granted_by":"%s","reason":"New T&S hire, ticket 4812"}', :'u1', :'adm')::jsonb,
  'the audit row holds grantee, role, grantor and the reason'
);
select is(
  (select metadata ->> 'reason' from audit.log where action = 'platform_role.grant' and metadata ->> 'role' = 'verification_reviewer' and metadata ->> 'user_id' = :'u1'),
  'Second role for U1, ticket 4814', 'the reason is trimmed'
);
select is(
  (select format('%s|%s|%s', count(*), min(message ->> 'action'), min(message ->> 'reason'))
   from pgmq.q_account_ops where message ->> 'user_id' in (:'u1', :'u2')),
  '4|sign_out|platform_role_granted', 'each grant queues one sign-out job'
);
select is((select count(*) from pgmq.q_account_ops where message ->> 'user_id' = :'u1'), 3::bigint, 'one job per call, also for the same user');
select is((select count(*) from pgmq.q_notifications), 0::bigint, 'no notification is queued');
select is(pg_temp.val_as(:'u1', 'aal2', $$select private.has_platform_role('trust_safety')$$), 'true', 'U1 holds trust_safety in their own session');
select is(pg_temp.val_as(:'u2', 'aal2', $$select private.has_platform_role('trust_safety')$$), 'true', 'U2 holds trust_safety in their own session');
select is(pg_temp.val_as(:'u2', 'aal2', $$select private.has_platform_role('admin')$$), 'false', 'U2 does not hold the admin role');

-- AC2: grant refusals write nothing
create temp table before_grants as select pg_temp.snapshot() as snap;

select is(pg_temp.call_as(:'tss', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u3')),
  'P0001|CHARA_FORBIDDEN|', 'a trust_safety user is refused');
select is(pg_temp.call_as(:'vrv', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u3')),
  'P0001|CHARA_FORBIDDEN|', 'a verification_reviewer is refused');
select is(pg_temp.call_as(:'own', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u3')),
  'P0001|CHARA_FORBIDDEN|', 'an employer owner is refused');
select is(pg_temp.call_as(:'rev', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u3')),
  'P0001|CHARA_FORBIDDEN|', 'an administrator whose role was revoked is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u3'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an administrator at aal1 is refused with aal2_required');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'adm')),
  'P0001|CHARA_FORBIDDEN|own_account', 'an administrator cannot grant a role to themselves');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'nobody')),
  'P0001|CHARA_INVALID_INPUT|user', 'an unknown user id is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', $$select public.grant_platform_role(null, 'trust_safety', 'Reason with enough length')$$),
  'P0001|CHARA_INVALID_INPUT|user', 'a missing user id is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'unc')),
  'P0001|CHARA_INVALID_INPUT|user', 'an unconfirmed user is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'sus')),
  'P0001|CHARA_INVALID_INPUT|user', 'a suspended user is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'too short')$$, :'u3')),
  'P0001|CHARA_INVALID_INPUT|reason', 'a reason of 9 characters is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', %L)$$, :'u3', repeat('x', 2001))),
  'P0001|CHARA_INVALID_INPUT|reason', 'a reason of 2001 characters is refused (FR-F2 AC3)');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', '')$$, :'u3')),
  'P0001|CHARA_INVALID_INPUT|reason', 'an empty reason is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', '            ')$$, :'u3')),
  'P0001|CHARA_INVALID_INPUT|reason', 'a reason of spaces only is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', null)$$, :'u3')),
  'P0001|CHARA_INVALID_INPUT|reason', 'a missing reason is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'superuser', 'Reason with enough length')$$, :'u3')),
  'P0001|CHARA_INVALID_INPUT|role', 'a role outside the enum is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, null, 'Reason with enough length')$$, :'u3')),
  'P0001|CHARA_INVALID_INPUT|role', 'a missing role is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'Admin', 'Reason with enough length')$$, :'u3')),
  'P0001|CHARA_INVALID_INPUT|role', 'a role spelled in another case is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u2')),
  'P0001|CHARA_CONFLICT|role_active', 'a repeat grant of an active role is a conflict');
select is(pg_temp.call_as(null, 'anon', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u3')),
  '42501|permission denied for function grant_platform_role|', 'the anonymous caller is refused at EXECUTE');
select is((select pg_temp.snapshot() = snap from before_grants), true, 'no refusal creates a row, an audit entry or a job');

-- AC3: revocation keeps history; U1 holds admin, so the revocation of one of two administrators succeeds
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', '  Moved to another team, ticket 4816  ')$$, :'u1')),
  'ok', 'an administrator revokes trust_safety of U1');
select is(
  (select count(*) from public.platform_staff where user_id = :'u1' and role = 'trust_safety' and revoked_at = now()), 1::bigint,
  'the row is kept and revoked_at is set'
);
select is(
  (select format('%s|%s|%s', count(*), min(actor_id::text), min(metadata ->> 'reason')) from audit.log
   where action = 'platform_role.revoke' and metadata ->> 'user_id' = :'u1'),
  format('1|%s|Moved to another team, ticket 4816', :'adm'), 'one audit row holds the actor and the trimmed reason'
);
select is(
  (select format('%s|%s', count(*), min(message ->> 'reason')) from pgmq.q_account_ops
   where message ->> 'user_id' = :'u1' and message ->> 'action' = 'sign_out' and message ->> 'reason' = 'platform_role_revoked'),
  '1|platform_role_revoked', 'the revocation queues a sign-out job'
);
select is(pg_temp.val_as(:'u1', 'aal2', $$select private.has_platform_role('trust_safety')$$), 'false', 'the former holder loses the role at once');
select is(pg_temp.val_as(:'u1', 'aal2', $$select private.has_platform_role('verification_reviewer')$$), 'true', 'their other roles stay');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', 'Moved to another team, ticket 4816')$$, :'u1')),
  'P0001|CHARA_CONFLICT|role_revoked', 'revoking the same row again is a conflict');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Back on the team, ticket 4820')$$, :'u1')),
  'ok', 'a revoked role is granted again');
select is(
  (select format('%s|%s', count(*), count(*) filter (where revoked_at is null)) from public.platform_staff
   where user_id = :'u1' and role = 'trust_safety'),
  '2|1', 'the new grant is a new row beside the revoked one'
);
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.revoke_platform_role(%L, 'admin', 'Second administrator leaves, ticket 4821')$$, :'u1')),
  'ok', 'one of two administrators is revoked');
select is(
  (select count(*) from public.platform_staff where role = 'admin' and revoked_at is null), 1::bigint, 'one administrator remains'
);
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.revoke_platform_role(%L, 'admin', 'Trying to remove the last administrator')$$, :'adm')),
  'P0001|CHARA_FORBIDDEN|last_administrator', 'the only active administrator cannot be revoked');
select is(pg_temp.call_as(null, 'postgres',
  format($$update public.platform_staff set revoked_at = now() where user_id = %L and role = 'admin'$$, :'adm')),
  'P0001|CHARA_FORBIDDEN|last_administrator', 'direct SQL by the table owner that leaves no administrator fails at commit');
select is(
  (select count(*) from public.platform_staff where role = 'admin' and revoked_at is null), 1::bigint,
  'the failed transaction left the administrator in place'
);
select is(pg_temp.call_as(null, 'postgres',
  format($$update public.platform_staff set revoked_at = now() where user_id = %L and role = 'verification_reviewer'$$, :'vrv')),
  'ok', 'the owner may revoke a role that is not the last administrator');

-- an administrator may revoke their own admin role while another remains
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'admin', 'Replacement administrator, ticket 4822')$$, :'u2')),
  'ok', 'a replacement administrator is granted');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.revoke_platform_role(%L, 'admin', 'Handing over the administrator role')$$, :'adm')),
  'ok', 'an administrator revokes their own role while another remains');
select is(pg_temp.val_as(:'adm', 'aal2', $$select private.has_platform_role('admin')$$), 'false', 'the former administrator no longer passes the check');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.grant_platform_role(%L, 'admin', 'Former administrator tries again')$$, :'u3')),
  'P0001|CHARA_FORBIDDEN|', 'and is refused from then on');
select is(pg_temp.call_as(:'u2', 'authenticated', format($$select public.grant_platform_role(%L, 'admin', 'Former administrator returns, ticket 4823')$$, :'adm')),
  'ok', 'the new administrator grants the role again');

-- AC4: revoke refusals write nothing
create temp table before_revokes as select pg_temp.snapshot() as snap;

select is(pg_temp.call_as(:'tss', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u2')),
  'P0001|CHARA_FORBIDDEN|', 'a trust_safety user is refused');
select is(pg_temp.call_as(:'vrv', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u2')),
  'P0001|CHARA_FORBIDDEN|', 'a verification_reviewer is refused');
select is(pg_temp.call_as(:'own', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u2')),
  'P0001|CHARA_FORBIDDEN|', 'an employer owner is refused');
select is(pg_temp.call_as(:'adm', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u2'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an administrator at aal1 is refused with aal2_required');
select is(pg_temp.call_as(:'u2', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u2'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'also an administrator at aal1 acting on their own role');
select is(pg_temp.call_as(null, 'anon', format($$select public.revoke_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u2')),
  '42501|permission denied for function revoke_platform_role|', 'the anonymous caller is refused at EXECUTE');
select is(pg_temp.call_as(:'u2', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', 'too short')$$, :'u1')),
  'P0001|CHARA_INVALID_INPUT|reason', 'a reason of 9 characters is refused');
select is(pg_temp.call_as(:'u2', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', %L)$$, :'u1', repeat('x', 2001))),
  'P0001|CHARA_INVALID_INPUT|reason', 'a reason of 2001 characters is refused (FR-F2 AC3)');
select is(pg_temp.call_as(:'u2', 'authenticated', format($$select public.revoke_platform_role(%L, 'admin', 'Reason with enough length')$$, :'own')),
  'P0001|CHARA_INVALID_INPUT|role', 'a user without that role is refused');
select is(pg_temp.call_as(:'u2', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'nobody')),
  'P0001|CHARA_INVALID_INPUT|user', 'an unknown user id is refused');
select is(pg_temp.call_as(:'u2', 'authenticated', format($$select public.revoke_platform_role(%L, 'superuser', 'Reason with enough length')$$, :'u1')),
  'P0001|CHARA_INVALID_INPUT|role', 'a role outside the enum is refused');
select is(pg_temp.call_as(:'u2', 'authenticated', format($$select public.revoke_platform_role(%L, null, 'Reason with enough length')$$, :'u1')),
  'P0001|CHARA_INVALID_INPUT|role', 'a missing role is refused');
select is((select pg_temp.snapshot() = snap from before_revokes), true, 'no refusal changes a row, writes an audit entry or queues a job');

-- AC6: the roles are technically separated. The other six actions of the criterion belong to later units.
create temp table before_separation as select pg_temp.snapshot() as snap,
  (select count(*) from audit.log where action = 'mfa.reset') as resets;

select is(pg_temp.call_as(:'tss', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u3')),
  'P0001|CHARA_FORBIDDEN|', 'trust_safety is refused grant_platform_role');
select is(pg_temp.call_as(:'tss', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u2')),
  'P0001|CHARA_FORBIDDEN|', 'trust_safety is refused revoke_platform_role');
select is(pg_temp.call_as(:'tss', 'authenticated', format($$select public.reset_mfa(%L, 'Identity checked by video call')$$, :'tgt')),
  'P0001|CHARA_FORBIDDEN|', 'trust_safety is refused reset_mfa');
select is(pg_temp.call_as(:'vrv', 'authenticated', format($$select public.grant_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u3')),
  'P0001|CHARA_FORBIDDEN|', 'a verification_reviewer is refused grant_platform_role');
select is(pg_temp.call_as(:'vrv', 'authenticated', format($$select public.revoke_platform_role(%L, 'trust_safety', 'Reason with enough length')$$, :'u2')),
  'P0001|CHARA_FORBIDDEN|', 'a verification_reviewer is refused revoke_platform_role');
select is(pg_temp.call_as(:'vrv', 'authenticated', format($$select public.reset_mfa(%L, 'Identity checked by video call')$$, :'tgt')),
  'P0001|CHARA_FORBIDDEN|', 'a verification_reviewer is refused reset_mfa');
select is(
  (select pg_temp.snapshot() = snap and resets = (select count(*) from audit.log where action = 'mfa.reset') from before_separation),
  true, 'the refusals of the other two roles write no audit row for the action'
);
select is(pg_temp.call_as(:'u2', 'authenticated', format($$select public.grant_platform_role(%L, 'verification_reviewer', 'Reason with enough length')$$, :'u3')),
  'ok', 'the administrator succeeds with grant_platform_role');
select is(pg_temp.call_as(:'u2', 'authenticated', format($$select public.revoke_platform_role(%L, 'verification_reviewer', 'Reason with enough length')$$, :'u3')),
  'ok', 'the administrator succeeds with revoke_platform_role');
select is(pg_temp.call_as(:'u2', 'authenticated', format($$select public.reset_mfa(%L, 'Identity checked by video call')$$, :'tgt')),
  'ok', 'the administrator succeeds with reset_mfa');

-- AC7: staff roles are written only through the RPCs
select is(pg_temp.call_as(:'u2', 'authenticated', format($$insert into public.platform_staff (user_id, role) values (%L, 'admin')$$, :'u3')),
  '42501|permission denied for table platform_staff|', 'an administrator at aal2 cannot insert directly');
select is(pg_temp.call_as(:'u2', 'authenticated', $$update public.platform_staff set revoked_at = now()$$),
  '42501|permission denied for table platform_staff|', 'an administrator at aal2 cannot update directly');
select is(pg_temp.call_as(:'u2', 'authenticated', $$delete from public.platform_staff$$),
  '42501|permission denied for table platform_staff|', 'an administrator at aal2 cannot delete directly');
select is(pg_temp.val_as(:'own', 'aal2', $$select count(*) from public.platform_staff$$), '0', 'an ordinary user selects no staff rows');
select ok(
  not has_any_column_privilege('authenticated', 'public.profiles', 'insert, update'),
  'no profile column can be updated by a user, so no update can change a staff row or a role check'
);

-- the service RPCs of account-ops
select ok(
  has_function_privilege('service_role', 'public.account_ops_dequeue(integer)', 'execute')
  and has_function_privilege('service_role', 'public.account_ops_ack(bigint, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.account_ops_end_sessions(uuid)', 'execute'),
  'service_role executes the three account-ops RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.account_ops_dequeue(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.account_ops_dequeue(integer)', 'execute')
  and not has_function_privilege('anon', 'public.account_ops_ack(bigint, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.account_ops_ack(bigint, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.account_ops_end_sessions(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.account_ops_end_sessions(uuid)', 'execute'),
  'neither anon nor authenticated executes them'
);
select ok(
  not has_function_privilege('service_role', 'public.grant_platform_role(uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.revoke_platform_role(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.grant_platform_role(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.revoke_platform_role(uuid, text, text)', 'execute'),
  'service_role and anon cannot grant or revoke a role'
);
select is_empty(
  $$select c.oid::regclass
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private', 'audit', 'stats', 'pgmq') and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (has_table_privilege('service_role', c.oid, 'select, insert, update, delete, truncate, references, trigger')
        or has_any_column_privilege('service_role', c.oid, 'select, insert, update, references'))$$,
  'service_role has no direct table grants in public, private, audit, stats and the queues'
);
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('service_role', p.oid, 'execute')
      and p.proname not in ('account_ops_dequeue', 'account_ops_ack', 'account_ops_end_sessions', 'account_ops_user_status', 'account_ops_organization_members', 'account_ops_fan_out_legal_version', 'document_set_scan_status', 'erase_user', 'notify_dequeue', 'notify_ack', 'audit_record_external', 'audit_export_month', 'audit_export_count', 'billing_ingest_event', 'billing_apply_event', 'billing_reconcile_records', 'billing_reconcile_report', 'billing_webhook_rejected', 'billing_record_worker_attempt')
  ),
  'service_role executes no other function of public'
);

create temp table jobs_before as select count(*) as n from pgmq.q_account_ops;
select pgmq.send('account_ops', jsonb_build_object('action', 'sign_out', 'user_id', :'u3', 'reason', 'test'));
select pgmq.send('account_ops', jsonb_build_object('action', 'reset_mfa', 'user_id', :'nobody', 'reason', 'test-attempts'));

select is(pg_temp.call_as(null, 'service_role', $$select count(*) from public.account_ops_dequeue(1000)$$), 'ok', 'service_role dequeues');
select is(
  (select count(*) from pgmq.q_account_ops where vt > now()), (select n + 2 from jobs_before),
  'every message read is invisible for a while, so overlapping runs do not share one'
);
select is(pg_temp.call_as(null, 'service_role', $$select count(*) from public.account_ops_dequeue(1000)$$), 'ok', 'a second read is empty but not an error');
select is(
  (select count(*) from (select * from public.account_ops_dequeue(25)) d), 0::bigint, 'and returns nothing while the messages are invisible'
);

-- ack removes the job once, audits what was done and ignores a repeat
select set_config('t.msg', (select msg_id::text from pgmq.q_account_ops where message ->> 'reason' = 'test'), true);
select is(pg_temp.call_as(null, 'service_role', $$select public.account_ops_ack(current_setting('t.msg')::bigint, '{"sessions_ended": 2}')$$), 'ok', 'service_role acks a job');
select is(
  (select format('%s|%s|%s|%s|%s', count(*), min(metadata ->> 'action'), min(metadata ->> 'sessions_ended'), min(entity_id), min(actor_id::text))
   from audit.log where action = 'account_ops_done' and entity_id = :'u3'),
  format('1|sign_out|2|%s|', :'u3'), 'one audit row records the action and the result without an actor'
);
select is((select count(*) from pgmq.q_account_ops where msg_id = current_setting('t.msg')::bigint), 0::bigint, 'the job left the queue');
select is((select count(*) from pgmq.a_account_ops where msg_id = current_setting('t.msg')::bigint), 0::bigint, 'and is not archived, the audit row is the record');
select is((select public.account_ops_ack(current_setting('t.msg')::bigint, '{"sessions_ended": 2}')), false, 'a second ack returns false');
select is((select count(*) from audit.log where action = 'account_ops_done' and entity_id = :'u3'), 1::bigint, 'and writes no second audit row');
select is(pg_temp.call_as(null, 'service_role', $$select public.account_ops_ack(1, '[1]')$$),
  'P0001|CHARA_INVALID_INPUT|result', 'a result that is not an object is refused');
select is(pg_temp.call_as(:'u2', 'authenticated', $$select public.account_ops_ack(1, '{}')$$),
  '42501|permission denied for function account_ops_ack|', 'a staff administrator cannot ack a job');

-- a message read more often than the setting allows is removed and audited, not returned
select is((select value #>> '{}' from private.settings where key = 'account_ops_max_attempts'), '8', 'a job gets 8 attempts');
update pgmq.q_account_ops set read_ct = 9, vt = now() - interval '1 second' where message ->> 'reason' = 'test-attempts';
select is(
  (select count(*) from public.account_ops_dequeue(25) d where d.message ->> 'reason' = 'test-attempts'), 0::bigint,
  'a message past the attempt limit is not handed out'
);
select is(
  (select format('%s|%s', count(*), min(metadata ->> 'action')) from audit.log where action = 'account_ops_abandoned' and entity_id is null),
  '1|reset_mfa', 'it is audited as abandoned, naming nobody because the user has no profile'
);
select is(
  (select count(*) from pgmq.q_account_ops where message ->> 'reason' = 'test-attempts'), 0::bigint,
  'and no longer waits in the queue'
);
select is(
  (select count(*) from pgmq.a_account_ops where message ->> 'reason' = 'test-attempts'), 0::bigint,
  'and is not archived'
);

select pgmq.send('account_ops', jsonb_build_object('action', 'sign_out', 'user_id', :'nobody', 'reason', 'test-backoff'));
-- each retry waits longer: 60 seconds after the first read, 60 x n after the n-th
update pgmq.q_account_ops set read_ct = 2, vt = now() - interval '1 second' where message ->> 'reason' = 'test-backoff';
select is(
  (select count(*) from public.account_ops_dequeue(25) d where d.message ->> 'reason' = 'test-backoff'), 1::bigint,
  'a message that is read again is handed out'
);
select is(
  (select count(*) from pgmq.q_account_ops
   where message ->> 'reason' = 'test-backoff' and read_ct = 3
     and vt > now() + interval '170 seconds' and vt <= now() + interval '181 seconds'),
  1::bigint, 'and waits 180 seconds after its third read'
);

-- sessions
insert into auth.sessions (id, user_id, created_at, updated_at) values
  (gen_random_uuid(), :'u3', now(), now()), (gen_random_uuid(), :'u3', now(), now()), (gen_random_uuid(), :'tgt', now(), now());
insert into auth.refresh_tokens (token, user_id, session_id, revoked)
select 'rt-' || s.id, s.user_id::text, s.id, false from auth.sessions s where s.user_id in (:'u3', :'tgt');
select is((select public.account_ops_end_sessions(:'u3')), 2, 'the sessions of the user are ended and counted');
select is((select count(*) from auth.sessions where user_id = :'u3'), 0::bigint, 'none of their sessions is left');
select is((select count(*) from auth.refresh_tokens where user_id = :'u3'), 0::bigint, 'nor any refresh token');
select is((select count(*) from auth.sessions where user_id = :'tgt'), 1::bigint, 'another user keeps their session');
select is((select public.account_ops_end_sessions(:'u3')), 0, 'ending sessions again changes nothing');

-- the scheduler call: nothing while no job is visible, a warning without the secrets, one request with them
update pgmq.q_account_ops set vt = now() + interval '1 hour';
select is((select private.run_account_ops()), null::bigint, 'no request is made while no job is visible');
update pgmq.q_account_ops set vt = now() - interval '1 second';
select is((select count(*) from pgmq.q_account_ops where vt <= now()) > 0, true, 'a job is visible');
set local client_min_messages = error;
select is((select private.run_account_ops()), null::bigint, 'no request is made without the Vault secrets');
set local client_min_messages = notice;
select is((select count(*) from net.http_request_queue), 0::bigint, 'and none is queued');
select vault.create_secret('https://project.example.test/', 'project_url');
set local client_min_messages = error;
select is((select private.run_account_ops()), null::bigint, 'no request is made with only some of the secrets');
set local client_min_messages = notice;
select is((select count(*) from net.http_request_queue), 0::bigint, 'and none is queued');
select vault.create_secret('anon-key-value', 'anon_key');
select vault.create_secret('shared-secret-value', 'edge_shared_secret');
select is((select private.run_account_ops() is not null), true, 'with the secrets one request is made');
select is(
  (select format('%s|%s|%s|%s', count(*), min(method::text), min(url), min(headers ->> 'x-edge-secret'))
   from net.http_request_queue),
  '1|POST|https://project.example.test/functions/v1/account-ops|shared-secret-value',
  'it is a POST to the function with the shared secret'
);
select is((select min(headers ->> 'Authorization') from net.http_request_queue), 'Bearer anon-key-value', 'and the project key for the platform check');
select is(
  (select count(*) from cron.job where jobname = 'account-ops-run' and schedule = '* * * * *'
     and command = 'select private.run_account_ops()'), 1::bigint,
  'the call is scheduled every minute'
);
select ok(
  not has_function_privilege('authenticated', 'private.run_account_ops()', 'execute')
  and not has_function_privilege('service_role', 'private.run_account_ops()', 'execute'),
  'no API role can run the scheduler call'
);

select * from finish();
rollback;
