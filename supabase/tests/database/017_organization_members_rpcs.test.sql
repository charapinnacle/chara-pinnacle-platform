begin;
select plan(59);

\ir organizations_fixture.inc

select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.a', (public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'DE', 'F'))->>'organization_id', true)$$, 'aal1'), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'own2', 'authenticated',
  $$select set_config('t.b', (public.create_organization('employer', 'Beta Works Ltd', 'Beta Works', 'GB', 'F'))->>'organization_id', true)$$, 'aal1'), 'ok', 'setup call succeeds');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.a')::uuid, :'adm', 'admin', now()), (current_setting('t.a')::uuid, :'mem', 'member', now()),
  (current_setting('t.a')::uuid, :'inv', 'admin', now());
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select public.invite_member(current_setting('t.a')::uuid, e, 'member') from unnest(array['p1@example.test', 'p2@example.test', 'p3@example.test']) e$$), 'ok', 'setup call succeeds');

-- Reads: cross-organization negatives and the MFA gate
select is(pg_temp.val_as(:'own2', 'aal2', 'select count(*) from public.organizations'), '1', 'the owner of B sees only organization B');
select is(
  pg_temp.val_as(:'own2', 'aal2', format($$select count(*) from public.organizations where id = %L$$, current_setting('t.a'))),
  '0', 'organization A is invisible to the owner of B'
);
select is(
  pg_temp.val_as(:'own2', 'aal2', format($$select count(*) from public.organization_members where organization_id = %L$$, current_setting('t.a'))),
  '0', 'the members of A are invisible to the owner of B'
);
select is(
  pg_temp.val_as(:'own2', 'aal2', format($$select count(*) from public.organization_invitations where organization_id = %L$$, current_setting('t.a'))),
  '0', 'the invitations of A are invisible to the owner of B'
);
select is(
  pg_temp.val_as(:'mem', 'aal1', format($$select count(*) from public.organization_members where organization_id = %L$$, current_setting('t.a'))),
  '4', 'a plain member lists the members of the organization'
);
select is(
  pg_temp.val_as(:'mem', 'aal2', format($$select count(*) from public.organization_invitations where organization_id = %L$$, current_setting('t.a'))),
  '0', 'a plain member cannot read invitations even at aal2'
);
select is(
  pg_temp.val_as(:'adm', 'aal2', format($$select count(*) from public.organization_invitations where organization_id = %L and accepted_at is null$$, current_setting('t.a'))),
  '3', 'an admin at aal2 reads the pending invitations'
);
select is(
  pg_temp.val_as(:'adm', 'aal1', format($$select count(*) from public.organization_invitations where organization_id = %L$$, current_setting('t.a'))),
  '0', 'an admin at aal1 reads no invitations'
);
select is(
  pg_temp.val_as(:'adm', 'aal1', format($$select count(*) from public.organizations where id = %L$$, current_setting('t.a'))),
  '1', 'an admin at aal1 still reads the organization (D8)'
);
select is(
  pg_temp.val_as(:'adm', 'aal1', format($$select count(*) from public.organization_members where user_id = %L$$, :'adm')),
  '1', 'an admin at aal1 still reads their own membership (D8)'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', 'select token_hash from public.organization_invitations', 'aal2'),
  '42501|permission denied for table organization_invitations|', 'the token hash cannot be selected through the API'
);
select is(
  pg_temp.call_as(null, 'anon', 'select count(*) from public.organizations'),
  '42501|permission denied for table organizations|', 'an anonymous caller cannot read organizations'
);
select is(pg_temp.val_as(:'wkr', 'aal2', 'select count(*) from public.organizations'), '0', 'a worker sees no organization');

-- change_member_role
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|', 'a plain member cannot change roles'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.a'), :'mem'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an owner at aal1 cannot change roles'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organization cannot change roles'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'owner')$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_INVALID_INPUT|role', 'a role change cannot create a second owner'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_FORBIDDEN|use_transfer_ownership', 'the owner role changes only through transfer_ownership'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.change_member_role(%L, %L, 'member')$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_FORBIDDEN|use_transfer_ownership', 'an admin cannot touch the owner'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'member')$$, current_setting('t.a'), :'own2')),
  'P0001|CHARA_INVALID_INPUT|not_a_member', 'a user of another organization cannot be given a role here'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.a'), :'mem')),
  'ok', 'the owner promotes a member to admin'
);
select is(
  (select role::text from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id = :'mem'),
  'admin', 'the role is changed'
);
select is(
  (select metadata from audit.log where action = 'member_role_changed' and metadata ->> 'user_id' = :'mem'),
  jsonb_build_object('user_id', :'mem', 'from', 'member', 'to', 'admin'), 'the role change is audited with the old and new role'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.change_member_role(%L, %L, 'member')$$, current_setting('t.a'), :'inv')),
  'ok', 'an admin demotes another admin to member'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.change_member_role(%L, %L, 'member')$$, current_setting('t.a'), :'inv')),
  'ok', 'repeating the same role is accepted'
);
select is(
  (select count(*) from audit.log where action = 'member_role_changed' and entity_id = current_setting('t.a')),
  2::bigint, 'an unchanged role writes no audit row'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'superuser')$$, current_setting('t.a'), :'mem')),
  '22P02|invalid input value for enum member_role: "superuser"|', 'an unknown role is refused by the enum type before the function runs'
);
update public.organizations set status = 'suspended' where id = current_setting('t.a')::uuid;
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'member')$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'the owner of a suspended organization cannot change roles'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'the owner of a suspended organization cannot remove members'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'the owner of a suspended organization cannot transfer ownership'
);
update public.organizations set status = 'active' where id = current_setting('t.a')::uuid;
select is(
  (select string_agg(user_id || ':' || role, ',' order by user_id) from public.organization_members where organization_id = current_setting('t.a')::uuid),
  format('%s:owner,%s:member,%s:admin,%s:admin', :'own1', :'inv', :'adm', :'mem'), 'the refusals on a suspended organization changed no role and removed nobody'
);

-- remove_member
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.a')::uuid, :'adm2', 'admin', now());
select is(
  pg_temp.call_as(:'inv', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'adm2')),
  'P0001|CHARA_FORBIDDEN|', 'a plain member cannot remove anyone'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'adm2'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an owner at aal1 cannot remove anyone'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'adm2')),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organization cannot remove anyone'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_FORBIDDEN|cannot_remove_owner', 'an admin cannot remove the owner'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_FORBIDDEN|cannot_remove_owner', 'the owner cannot remove themselves, so the last owner is never removed'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'own2')),
  'P0001|CHARA_INVALID_INPUT|not_a_member', 'a user of another organization cannot be removed here'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'wkr')),
  'P0001|CHARA_INVALID_INPUT|not_a_member', 'an unknown member answers not_a_member'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'adm2')),
  'ok', 'an admin removes another admin'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'inv')),
  'ok', 'an admin removes a member'
);
select is(
  (select count(*) from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id in (:'adm2', :'inv')),
  0::bigint, 'the removed memberships are gone'
);
select is(
  (select metadata from audit.log where action = 'member_removed' and metadata ->> 'user_id' = :'inv'),
  jsonb_build_object('user_id', :'inv', 'role', 'member'), 'the removal is audited'
);
select is(
  pg_temp.val_as(:'inv', 'aal2', 'select count(*) from public.organizations')
  || '|' || pg_temp.val_as(:'inv', 'aal2', 'select count(*) from private.member_org_ids()'),
  '0|0', 'a removed member loses access in the very next query'
);
select is(
  (select count(*) from public.organization_members where organization_id = current_setting('t.a')::uuid and role = 'owner'),
  1::bigint, 'the organization still has its owner'
);

-- transfer_ownership
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|', 'an admin cannot transfer ownership'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an owner at aal1 cannot transfer ownership'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organization cannot transfer ownership'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_INVALID_INPUT|new_owner', 'ownership cannot be transferred to oneself'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'own2')),
  'P0001|CHARA_INVALID_INPUT|new_owner', 'ownership cannot go to a user outside the organization'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, null)$$, current_setting('t.a'))),
  'P0001|CHARA_INVALID_INPUT|new_owner', 'ownership needs a new owner'
);
select is(
  pg_temp.call_as(null, 'anon', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  '42501|permission denied for function transfer_ownership|', 'an anonymous caller is refused at EXECUTE'
);
select is(
  (select role::text from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id = :'own1'),
  'owner', 'refused transfers changed no role'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  'ok', 'the owner transfers ownership to an admin'
);
select is(
  (select string_agg(user_id || ':' || role, ',' order by user_id) from public.organization_members where organization_id = current_setting('t.a')::uuid),
  format('%s:admin,%s:admin,%s:owner', :'own1', :'adm', :'mem'), 'the old owner is an admin and the new owner is the only owner'
);
select is(
  (select metadata from audit.log where action = 'ownership_transferred' and entity_id = current_setting('t.a')),
  jsonb_build_object('from', :'own1', 'to', :'mem'), 'the transfer is audited with both people'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'adm')),
  'P0001|CHARA_FORBIDDEN|', 'the former owner can no longer transfer ownership'
);

select * from finish();
rollback;
