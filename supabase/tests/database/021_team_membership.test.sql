begin;
select plan(94);

\ir organizations_fixture.inc

select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.a', (public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'DE', 'F'))->>'organization_id', true)$$, 'aal1'), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'own2', 'authenticated',
  $$select set_config('t.b', (public.create_organization('employer', 'Beta Works Ltd', 'Beta Works', 'GB', 'F'))->>'organization_id', true)$$, 'aal1'), 'ok', 'setup call succeeds');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.a')::uuid, :'adm', 'admin', now()), (current_setting('t.a')::uuid, :'mem', 'member', now());
update public.profiles set display_name = 'Mia Member' where id = :'mem';

-- FR-A5 AC2: invitations per hour. The ceiling is a setting; re-invitations count because the audit log keeps the
-- replaced invitation.
select is(
  pg_temp.call_as(:'own2', 'authenticated',
    $$select public.invite_member(current_setting('t.b')::uuid, 'r' || g || '@example.test', 'member') from generate_series(1, 20) g$$),
  'ok', 'an owner at aal2 makes 20 invitations in an hour'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.invite_member(current_setting('t.b')::uuid, 'r21@example.test', 'member')$$),
  'P0001|CHARA_RATE_LIMITED|', 'the 21st invitation within the hour is refused'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.invite_member(current_setting('t.b')::uuid, 'r1@example.test', 'admin')$$),
  'P0001|CHARA_RATE_LIMITED|', 'a re-invitation counts as an invitation'
);
select is(
  (select count(*) from public.organization_invitations where organization_id = current_setting('t.b')::uuid)
  + (select count(*) from audit.log where action = 'member_invited' and metadata ->> 'organization_id' = current_setting('t.b')),
  40::bigint, 'the refused invitations wrote no row and no audit entry'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'first@example.test', 'member')$$),
  'ok', 'the limit counts per organization'
);
update private.settings set value = '2' where key = 'invitations_per_hour_max';
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'second@example.test', 'member')$$),
  'ok', 'a lowered setting still allows invitations up to it'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'third@example.test', 'member')$$),
  'P0001|CHARA_RATE_LIMITED|', 'the ceiling is read from the setting'
);
update private.settings set value = '20' where key = 'invitations_per_hour_max';

-- FR-A5 AC3: the member limit. The billing migration brings the plans; until then the fallback plan counts the owner.
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'third@example.test', 'member')$$),
  'ok', 'with entitlements_enforced false an organization that never had a subscription is not limited'
);
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'fourth@example.test', 'member')$$),
  'P0001|CHARA_LIMIT_REACHED|members', 'with entitlements_enforced true an organization on the fallback plan cannot invite'
);
select is(
  (select count(*) from public.organization_invitations where organization_id = current_setting('t.a')::uuid and email = 'fourth@example.test'),
  0::bigint, 'a refused invitation writes no row'
);

-- A plan that allows 5 members: 3 accepted members and 3 pending invitations from above make a count of 6, so the
-- count is first brought to 3.
create or replace function private.org_limit(p_org uuid, p_key text) returns integer
language sql stable set search_path = '' as $$ select case p_key when 'members' then 5 end $$;
delete from public.organization_invitations where organization_id = current_setting('t.a')::uuid;
select is(
  pg_temp.val_as(:'own1', 'aal2', format($$select format('%%s/%%s', member_limit, used) from public.team_member_allowance(%L)$$, current_setting('t.a'))),
  '5/3', 'the allowance names the limit and the count of accepted members including the owner'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'p1@example.test', 'member')$$),
  'ok', 'a count of 3 may invite'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'p2@example.test', 'member')$$),
  'ok', 'a count of 3 members and 1 pending (4 of 5) may invite'
);
select is(
  pg_temp.val_as(:'own1', 'aal2', format($$select format('%%s/%%s', member_limit, used) from public.team_member_allowance(%L)$$, current_setting('t.a'))),
  '5/5', 'pending invitations count toward the limit'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'p3@example.test', 'member')$$),
  'P0001|CHARA_LIMIT_REACHED|members', 'a count of 5 of 5 is refused'
);
select is(
  (select count(*) from public.organization_invitations where organization_id = current_setting('t.a')::uuid),
  2::bigint, 'the refused invitation left the pending ones as they were'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'p1@example.test', 'admin')$$),
  'ok', 're-inviting a pending address at the limit is allowed: it counts once'
);
select is(
  (select format('%s/%s', count(*), min(role::text)) from public.organization_invitations
   where organization_id = current_setting('t.a')::uuid and email = 'p1@example.test'),
  '1/admin', 'the re-invitation replaced the pending one'
);
update public.organization_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
where organization_id = current_setting('t.a')::uuid and email = 'p2@example.test';
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'p3@example.test', 'member')$$),
  'ok', 'a count of 4 members plus 1 pending and 1 expired invitation (the expired one does not count) may invite'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'p2@example.test', 'member')$$),
  'P0001|CHARA_LIMIT_REACHED|members', 'resending an expired invitation at the limit is refused'
);
select is(
  pg_temp.val_as(:'own1', 'aal2', format($$select count(*) from public.team_member_allowance(%L)$$, current_setting('t.a'))),
  '1', 'the owner reads the allowance'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select * from public.team_member_allowance(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|', 'a plain member cannot read the allowance'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select * from public.team_member_allowance(%L)$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'the allowance needs aal2'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format($$select * from public.team_member_allowance(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organization cannot read the allowance'
);
select is(
  pg_temp.call_as(null, 'anon', format($$select * from public.team_member_allowance(%L)$$, current_setting('t.a'))),
  '42501|permission denied for function team_member_allowance|', 'an anonymous caller is refused at EXECUTE'
);
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(
  pg_temp.val_as(:'own1', 'aal2', format($$select coalesce(member_limit::text, 'none') from public.team_member_allowance(%L)$$, current_setting('t.a'))),
  'none', 'no limit applies while limits are not enforced'
);
delete from public.organization_invitations where organization_id = current_setting('t.a')::uuid;

-- invitation_preview: what the invitee sees before signing in
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.tok', public.invite_member(current_setting('t.a')::uuid, 'Bea@Example.com', 'member'), true)$$), 'ok', 'setup call succeeds');
set local role anon;
select is(
  (select format('%s|%s|%s|%s', organization_name, role, email, expires_at > now() + interval '6 days')
   from public.invitation_preview(current_setting('t.tok'))),
  'Acme Bau|member|bea@example.com|t', 'an anonymous visitor sees the organization, the role, the invited address and the expiry'
);
select is(
  (select count(*) from public.invitation_preview('not-a-token') ) + (select count(*) from public.invitation_preview(null)),
  0::bigint, 'an unknown or missing token shows nothing'
);
reset role;
update public.organization_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 second'
where email = 'bea@example.com';
set local role anon;
select is((select count(*) from public.invitation_preview(current_setting('t.tok'))), 0::bigint, 'an expired invitation shows nothing');
reset role;
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.tok', public.invite_member(current_setting('t.a')::uuid, 'Bea@Example.com', 'member'), true)$$), 'ok', 'a new invitation replaces the expired one');
update public.organizations set status = 'suspended' where id = current_setting('t.a')::uuid;
set local role anon;
select is((select count(*) from public.invitation_preview(current_setting('t.tok'))), 0::bigint, 'an invitation of a suspended organization shows nothing');
reset role;
update public.organizations set status = 'active' where id = current_setting('t.a')::uuid;
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select set_config('t.joined', public.accept_invitation(current_setting('t.tok'))::text, true)$$),
  'P0001|CHARA_INVITATION_INVALID|', 'the address of the invitation belongs to nobody yet'
);
select ok(
  not has_function_privilege('anon', 'public.accept_invitation(text)', 'execute')
  and has_function_privilege('anon', 'public.invitation_preview(text)', 'execute')
  and not has_function_privilege('service_role', 'public.invitation_preview(text)', 'execute'),
  'the preview is open to visitors, accepting is not'
);

-- FR-A5 AC6: removal queues the sign-out and cancels a waiting transfer
select is(
  (select count(*) from pgmq.q_account_ops where message ->> 'action' = 'sign_out'),
  0::bigint, 'no sign-out job is queued before a removal'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'own2')),
  'P0001|CHARA_INVALID_INPUT|not_a_member', 'a removal of a user outside the organization is refused'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_FORBIDDEN|cannot_remove_owner', 'a removal of the owner is refused'
);
select is(
  (select count(*) from pgmq.q_account_ops where message ->> 'action' = 'sign_out'),
  0::bigint, 'refused removals queued nothing'
);

-- FR-A5 AC8: ownership transfer
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|', 'an admin cannot start a transfer'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'adm'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'the owner at aal1 cannot start a transfer'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_INVALID_INPUT|new_owner', 'a transfer to oneself is refused'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'wkr')),
  'P0001|CHARA_INVALID_INPUT|new_owner', 'a transfer to someone outside the organization is refused'
);
select is(
  (select count(*) from public.organization_ownership_transfers) + (select count(*) from audit.log where action like 'ownership_transfer%'),
  0::bigint, 'refused transfers wrote no row and no audit entry'
);
create temp table queued_before as select count(*) as n from pgmq.q_notifications;
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'adm')),
  'ok', 'the owner at aal2 designates an admin'
);
select is(
  (select string_agg(user_id || ':' || role, ',' order by user_id) from public.organization_members where organization_id = current_setting('t.a')::uuid and accepted_at is not null),
  format('%s:owner,%s:admin,%s:member', :'own1', :'adm', :'mem'), 'no role has changed'
);
select is(
  (select format('%s|%s|%s|%s', from_user_id = :'own1', to_user_id = :'adm', accepted_at is null and cancelled_at is null, expires_at = created_at + interval '7 days')
   from public.organization_ownership_transfers where organization_id = current_setting('t.a')::uuid),
  't|t|t|t', 'one pending transfer exists and is valid for 7 days'
);
select is(
  (select metadata - 'transfer_id' from audit.log where action = 'ownership_transfer_requested' and entity_id = current_setting('t.a')),
  jsonb_build_object('from', :'own1', 'to', :'adm'), 'the request is audited with both people'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_INVALID_INPUT|no_pending_transfer', 'a member who is not the designated one cannot confirm'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_INVALID_INPUT|no_pending_transfer', 'the owner cannot confirm their own transfer'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|', 'someone outside the organization cannot confirm'
);
select is(
  pg_temp.call_as(:'wkr', 'authenticated', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|', 'a worker cannot confirm'
);
select is(
  pg_temp.call_as(null, 'anon', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a'))),
  '42501|permission denied for function accept_ownership_transfer|', 'an anonymous caller is refused at EXECUTE'
);
select is(
  pg_temp.val_as(:'adm', 'aal1', format($$select count(*) from public.organization_ownership_transfers where organization_id = %L$$, current_setting('t.a'))),
  '1', 'the designated member reads the transfer, even at aal1'
);
select is(
  pg_temp.val_as(:'own1', 'aal1', format($$select count(*) from public.organization_ownership_transfers where organization_id = %L$$, current_setting('t.a'))),
  '1', 'the owner reads the transfer'
);
select is(
  pg_temp.val_as(:'mem', 'aal2', format($$select count(*) from public.organization_ownership_transfers where organization_id = %L$$, current_setting('t.a')))
  || pg_temp.val_as(:'own2', 'aal2', format($$select count(*) from public.organization_ownership_transfers where organization_id = %L$$, current_setting('t.a'))),
  '00', 'another member and the owner of another organization read nothing'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  'ok', 'a second request replaces the first'
);
select is(
  (select format('%s/%s', count(*) filter (where accepted_at is null and cancelled_at is null), count(*) filter (where cancelled_at is not null))
   from public.organization_ownership_transfers where organization_id = current_setting('t.a')::uuid),
  '1/1', 'one transfer is pending and the replaced one is cancelled'
);
select is(
  (select count(*) from audit.log where action = 'ownership_transfer_cancelled' and metadata ->> 'reason' = 'replaced'),
  1::bigint, 'the replacement is audited'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_INVALID_INPUT|no_pending_transfer', 'the replaced designation can no longer confirm'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'the designated member needs aal2 to confirm'
);
select is(
  (select string_agg(user_id || ':' || role, ',' order by user_id) from public.organization_members where organization_id = current_setting('t.a')::uuid and accepted_at is not null),
  format('%s:owner,%s:admin,%s:member', :'own1', :'adm', :'mem'), 'the refused confirmations changed no role'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.cancel_ownership_transfer(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|', 'an admin cannot cancel a transfer'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.cancel_ownership_transfer(%L)$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'the owner at aal1 cannot cancel a transfer'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.cancel_ownership_transfer(%L)$$, current_setting('t.a'))),
  'ok', 'the owner cancels the pending transfer'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_INVALID_INPUT|no_pending_transfer', 'a cancelled transfer cannot be confirmed'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.cancel_ownership_transfer(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_INVALID_INPUT|no_pending_transfer', 'there is nothing left to cancel'
);
select is(
  (select count(*) from audit.log where action = 'ownership_transfer_cancelled' and metadata ->> 'reason' = 'cancelled'),
  1::bigint, 'the cancellation is audited'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'adm')),
  'ok', 'the owner designates again'
);
update public.organization_ownership_transfers set created_at = now() - interval '8 days', expires_at = now() - interval '1 second'
where organization_id = current_setting('t.a')::uuid and accepted_at is null and cancelled_at is null;
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_INVALID_INPUT|no_pending_transfer', 'a transfer not confirmed within 7 days cannot be confirmed'
);
select is(
  (select string_agg(user_id || ':' || role, ',' order by user_id) from public.organization_members where organization_id = current_setting('t.a')::uuid and accepted_at is not null),
  format('%s:owner,%s:admin,%s:member', :'own1', :'adm', :'mem'), 'the expired transfer changed no role'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'adm')),
  'ok', 'a new designation replaces the expired one'
);
update public.organizations set status = 'suspended' where id = current_setting('t.a')::uuid;
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'a suspended organization cannot change owner'
);
update public.organizations set status = 'active' where id = current_setting('t.a')::uuid;
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a'))),
  'ok', 'the designated admin confirms at aal2'
);
select is(
  (select string_agg(user_id || ':' || role, ',' order by user_id) from public.organization_members where organization_id = current_setting('t.a')::uuid and accepted_at is not null),
  format('%s:admin,%s:owner,%s:member', :'own1', :'adm', :'mem'), 'the old owner is an admin and the designated admin is the owner'
);
select is(
  (select count(*) from public.organization_members where organization_id = current_setting('t.a')::uuid and role = 'owner'),
  1::bigint, 'the organization has exactly one owner'
);
select is(
  (select metadata from audit.log where action = 'ownership_transferred' and entity_id = current_setting('t.a')),
  jsonb_build_object('from', :'own1', 'to', :'adm'), 'the transfer is audited with both people'
);
select is(
  (select accepted_at is not null from public.organization_ownership_transfers where organization_id = current_setting('t.a')::uuid and cancelled_at is null),
  true, 'the transfer is marked completed'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.accept_ownership_transfer(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_INVALID_INPUT|no_pending_transfer', 'a completed transfer cannot be confirmed twice'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|', 'the former owner can no longer start a transfer'
);
select is(
  (select count(*) from pgmq.q_notifications) - (select n from queued_before),
  0::bigint, 'no email is queued for a transfer'
);
select is(
  (select count(*) from public.organizations o
   where (select count(*) from public.organization_members m where m.organization_id = o.id and m.role = 'owner') <> 1),
  0::bigint, 'KPI orphaned organizations: no organization lacks its single owner'
);

-- removal after the transfer: the queue and the cancelled designation
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  'ok', 'the new owner designates the member'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'mem')),
  'ok', 'an admin removes the designated member'
);
select is(
  (select count(*) from public.organization_ownership_transfers where organization_id = current_setting('t.a')::uuid and accepted_at is null and cancelled_at is null),
  0::bigint, 'removing the designated member cancels the transfer'
);
select is(
  (select format('%s|%s|%s|%s', count(*), min(message ->> 'user_id') = :'mem', min(message ->> 'reason'), min(message ->> 'organization_id') = current_setting('t.a'))
   from pgmq.q_account_ops where message ->> 'action' = 'sign_out'),
  '1|t|member_removed|t', 'the removal queued one sign-out job for the removed member'
);
select is(
  (select count(*) from audit.log where action = 'member_removed' and metadata ->> 'user_id' = :'mem'),
  1::bigint, 'the removal is audited'
);

-- list_organization_members: names for every member, addresses and status for owners and admins at aal2
select pg_temp.new_user('00000000-0000-0000-0000-00000000a021', 'company', 'extra1@example.test');
select pg_temp.new_user('00000000-0000-0000-0000-00000000a022', 'company', 'extra2@example.test');
update public.profiles set account_kind = 'company' where id in ('00000000-0000-0000-0000-00000000a021', '00000000-0000-0000-0000-00000000a022');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.a')::uuid, '00000000-0000-0000-0000-00000000a021', 'member', now()),
  (current_setting('t.a')::uuid, '00000000-0000-0000-0000-00000000a022', 'member', now());
update public.profiles set display_name = 'Mia Member' where id = '00000000-0000-0000-0000-00000000a021';
select is(
  pg_temp.val_as('00000000-0000-0000-0000-00000000a021', 'aal1', format($$
    select string_agg(coalesce(display_name, 'none') || '/' || coalesce(email, 'no address') || '/' || role::text, ',' order by user_id)
    from public.list_organization_members(%L)$$, current_setting('t.a'))),
  'none/no address/admin,Mia Member/no address/member,none/no address/member,none/no address/owner',
  'a plain member sees names and roles at aal1 and no address'
);
select is(
  pg_temp.val_as(:'adm', 'aal2', format($$
    select string_agg(coalesce(email, 'no address') || '/' || coalesce(mfa_enrolled::text, 'null'), ',' order by user_id)
    from public.list_organization_members(%L)$$, current_setting('t.a'))),
  format('%s/false,extra1@example.test/null,extra2@example.test/null,%s/false', (select email from auth.users where id = :'own1'), (select email from auth.users where id = :'adm')),
  'an owner or admin at aal2 sees the addresses, and mfa_enrolled for owner and admin rows only'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select * from public.list_organization_members(%L)$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an owner or admin at aal1 is asked for aal2'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select * from public.list_organization_members(%L)$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|', 'a removed member can no longer list the organization'
);
select is(
  pg_temp.val_as(:'adm', 'aal2', format($$select count(*) from public.list_organization_members(%L, 2)$$, current_setting('t.a'))),
  '2', 'a page holds at most the requested number of rows'
);
select is(
  pg_temp.val_as(:'adm', 'aal2', format($$select string_agg(role::text, ',' order by user_id) from public.list_organization_members(%L, 2, '00000000-0000-0000-0000-00000000a021')$$,
    current_setting('t.a'))),
  'member,owner', 'the cursor continues after the last row of a page'
);

select * from finish();
rollback;
