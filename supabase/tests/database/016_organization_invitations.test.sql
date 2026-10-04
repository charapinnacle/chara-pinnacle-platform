begin;
select plan(56);

\ir organizations_fixture.inc

select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.a', (public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'DE', 'F'))->>'organization_id', true)$$, 'aal1'), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'own2', 'authenticated',
  $$select set_config('t.b', (public.create_organization('employer', 'Beta Works Ltd', 'Beta Works', 'GB', 'F'))->>'organization_id', true)$$, 'aal1'), 'ok', 'setup call succeeds');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.a')::uuid, :'adm', 'admin', now()), (current_setting('t.a')::uuid, :'mem', 'member', now());

-- invite_member: refusals
select is(
  pg_temp.call_as(:'mem', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$),
  'P0001|CHARA_FORBIDDEN|', 'a plain member cannot invite'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an owner at aal1 cannot invite'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organization cannot invite'
);
select is(
  pg_temp.call_as(:'wkr', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$),
  'P0001|CHARA_FORBIDDEN|', 'a worker cannot invite'
);
select is(
  pg_temp.call_as(null, 'anon', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$),
  '42501|permission denied for function invite_member|', 'an anonymous caller is refused at EXECUTE'
);
update public.organizations set status = 'suspended' where id = current_setting('t.a')::uuid;
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'the owner of a suspended organization cannot invite'
);
update public.organizations set status = 'active' where id = current_setting('t.a')::uuid;
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'owner')$$),
  'P0001|CHARA_INVALID_INPUT|role', 'an invitation cannot carry the owner role'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'not-an-email', 'member')$$),
  'P0001|CHARA_INVALID_INPUT|email', 'an invalid email address is refused'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, null, 'member')$$),
  'P0001|CHARA_INVALID_INPUT|email', 'a missing email address is refused'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    format($$select public.invite_member(current_setting('t.a')::uuid, %L, 'member')$$, upper(:'mem' || '@example.test'))),
  'P0001|CHARA_CONFLICT|already_a_member', 'an existing member cannot be invited, whatever the letter case'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'superuser')$$),
  'P0001|CHARA_INVALID_INPUT|role', 'an unknown role is refused with CHARA_INVALID_INPUT'
);
select is(
  (select count(*) from public.organization_invitations where organization_id = current_setting('t.a')::uuid)
  + (select count(*) from audit.log where action = 'member_invited' and metadata ->> 'organization_id' = current_setting('t.a')),
  0::bigint, 'refused invitations write no row and no audit entry'
);

-- invite_member: success and re-invitation
select is(
  pg_temp.call_as(:'own2', 'authenticated',
    $$select set_config('t.tokb', (select token from public.invite_member(current_setting('t.b')::uuid, 'bea@example.test', 'member')), true)$$),
  'ok', 'the owner of another organization invites the same address there'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    $$select set_config('t.tok1', (select token from public.invite_member(current_setting('t.a')::uuid, ' Bea@Example.TEST ', 'member')), true)$$),
  'ok', 'an owner at aal2 invites by email'
);
select is(
  (select format('%s|%s|%s|%s|%s', email, role, invited_by = :'own1', accepted_at is null, expires_at = created_at + interval '7 days')
   from public.organization_invitations where organization_id = current_setting('t.a')::uuid),
  'bea@example.test|member|t|t|t', 'the invitation holds the lower-cased email, the role and a 7-day expiry'
);
select ok(current_setting('t.tok1') ~ '^[A-Za-z0-9_-]{43}$', 'the token is 32 random bytes as 43 base64url characters');
select is(
  (select token_hash from public.organization_invitations where organization_id = current_setting('t.a')::uuid),
  encode(extensions.digest(current_setting('t.tok1'), 'sha256'), 'hex'),
  'only the SHA-256 hash of the token is stored'
);
select ok(
  not exists (select 1 from public.organization_invitations i where row_to_json(i)::text like '%' || current_setting('t.tok1') || '%')
  and not exists (select 1 from audit.log where metadata::text like '%' || current_setting('t.tok1') || '%'),
  'the token appears neither in the invitation row nor in the audit log'
);
select is(
  (select format('%s|%s|%s', actor_id, metadata ->> 'organization_id' = current_setting('t.a'), metadata ->> 'role')
   from audit.log where action = 'member_invited' and entity_type = 'organization_invitation'
     and metadata ->> 'organization_id' = current_setting('t.a')),
  format('%s|t|member', :'own1'), 'one member_invited audit row names the actor, the organization and the role'
);
select ok(
  not exists (select 1 from audit.log where metadata::text ilike '%@example.test%'),
  'no audit row holds an email address'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated',
    $$select set_config('t.tok2', (select token from public.invite_member(current_setting('t.a')::uuid, 'bea@example.test', 'admin')), true)$$),
  'ok', 'an admin at aal2 re-invites the same address with another role'
);
select ok(current_setting('t.tok1') <> current_setting('t.tok2'), 'the second invitation has a new token');
select is(
  (select format('%s|%s', count(*), min(role::text)) from public.organization_invitations
   where organization_id = current_setting('t.a')::uuid and email = 'bea@example.test' and accepted_at is null),
  '1|admin', 're-inviting replaces the pending invitation'
);
select is(
  (select count(*) from public.organization_invitations where organization_id = current_setting('t.b')::uuid and email = 'bea@example.test'),
  1::bigint, 'an invitation of the same address in another organization is untouched'
);
select is(
  (select count(*) from audit.log where action = 'member_invited' and metadata ->> 'organization_id' = current_setting('t.a')),
  2::bigint, 'both invitations are audited'
);

-- accept_invitation: refusals
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select public.accept_invitation(current_setting('t.tok1'))$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'a replaced invitation link no longer works'
);
select is(
  pg_temp.call_as(:'oth', 'authenticated', $$select public.accept_invitation(current_setting('t.tok2'))$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'an invitation addressed to another email cannot be accepted'
);
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select public.accept_invitation('not-a-token')$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'an unknown token answers like a wrong one'
);
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select public.accept_invitation(null)$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'a missing token answers like a wrong one'
);
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.tok3', (select token from public.invite_member(current_setting('t.a')::uuid, 'late@example.test', 'member')), true)$$), 'ok', 'setup call succeeds');
update public.organization_invitations
set created_at = now() - interval '8 days', expires_at = now() - interval '1 second'
where email = 'late@example.test';
select is(
  pg_temp.call_as(:'late', 'authenticated', $$select public.accept_invitation(current_setting('t.tok3'))$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'an expired invitation cannot be accepted'
);
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.tok4', (select token from public.invite_member(current_setting('t.a')::uuid, 'unc@example.test', 'member')), true)$$), 'ok', 'setup call succeeds');
select is(
  pg_temp.call_as(:'unc', 'authenticated', $$select public.accept_invitation(current_setting('t.tok4'))$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|email_unconfirmed', 'a user with an unconfirmed email cannot accept'
);
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.tok5', (select token from public.invite_member(current_setting('t.a')::uuid, '00000000-0000-0000-0000-00000000e005@example.test', 'member')), true)$$), 'ok', 'setup call succeeds');
select is(
  pg_temp.call_as(:'wkr', 'authenticated', $$select public.accept_invitation(current_setting('t.tok5'))$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|workers_cannot_join_organizations', 'a worker cannot accept, even an invitation to their own address'
);
select is(
  (select count(*) from public.organization_invitations i
   where i.email = (select email from auth.users where id = :'wkr') and i.accepted_at is null),
  1::bigint, 'the invitation stays pending after a worker tried it'
);
select is(
  pg_temp.call_as(:'nul', 'authenticated', $$select public.accept_invitation(current_setting('t.tok2'))$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|', 'a user without a committed account kind cannot accept'
);
select is(
  pg_temp.call_as(null, 'anon', $$select public.accept_invitation(current_setting('t.tok2'))$$),
  '42501|permission denied for function accept_invitation|', 'an anonymous caller is refused at EXECUTE'
);
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.tok6', (select token from public.invite_member(current_setting('t.a')::uuid, 'oth@example.test', 'member')), true)$$), 'ok', 'setup call succeeds');
update public.organizations set status = 'suspended' where id = current_setting('t.a')::uuid;
select is(
  pg_temp.call_as(:'oth', 'authenticated', $$select public.accept_invitation(current_setting('t.tok6'))$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'an invitation of a suspended organization answers like an invalid one'
);
update public.organizations set status = 'active' where id = current_setting('t.a')::uuid;
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.a')::uuid, :'adm2', 'admin', now());
select is(pg_temp.call_as(:'adm2', 'authenticated',
  $$select set_config('t.tok7', (select token from public.invite_member(current_setting('t.a')::uuid, 'gone@example.test', 'admin')), true)$$), 'ok', 'setup call succeeds');
update public.organization_members set role = 'member'
where organization_id = current_setting('t.a')::uuid and user_id = :'adm2';
select is(
  pg_temp.call_as(:'gone', 'authenticated', $$select public.accept_invitation(current_setting('t.tok7'))$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'an invitation whose inviter was demoted below admin cannot be accepted'
);
delete from public.organization_members where user_id = :'adm2';
select is(
  pg_temp.call_as(:'gone', 'authenticated', $$select public.accept_invitation(current_setting('t.tok7'))$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'an invitation whose inviter was removed cannot be accepted'
);
select is(
  (select count(*) from public.organization_members where organization_id = current_setting('t.a')::uuid),
  3::bigint, 'no refused acceptance created a membership'
);

-- accept_invitation: success and single use
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.b')::uuid, :'inv', 'member', now());
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select set_config('t.joined', public.accept_invitation(current_setting('t.tok2'))::text, true)$$, 'aal1'),
  'ok', 'the matching company user accepts at aal1, whatever the letter case of their address'
);
select is(current_setting('t.joined'), current_setting('t.a'), 'accepting returns the organization id');
select is(
  (select format('%s|%s|%s', role, accepted_at is not null, invited_by = :'adm')
   from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id = :'inv'),
  'admin|t|t', 'the membership has the invited role, an acceptance time and the inviter'
);
select is(
  (select accepted_at is not null from public.organization_invitations where token_hash = encode(extensions.digest(current_setting('t.tok2'), 'sha256'), 'hex')),
  true, 'the invitation is marked accepted'
);
select is(
  (select count(*) from audit.log where action = 'invitation_accepted' and actor_id = :'inv'
     and metadata ->> 'organization_id' = current_setting('t.a') and metadata ->> 'role' = 'admin'),
  1::bigint, 'acceptance is audited'
);
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select public.accept_invitation(current_setting('t.tok2'))$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'an invitation works once'
);
select is(
  (select count(*) from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id = :'inv'),
  1::bigint, 'the second attempt created no second membership'
);
select is(
  pg_temp.val_as(:'inv', 'aal1', 'select count(*) from public.organizations'),
  '2', 'the new member reads the new organization at aal1 and keeps access to the other one'
);
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select public.accept_invitation(current_setting('t.tokb'))$$, 'aal1'),
  'P0001|CHARA_CONFLICT|already_a_member', 'an invitation to an organization the user already belongs to is a conflict, not a constraint error'
);
select is(
  pg_temp.call_as(:'oth', 'authenticated',
    format($$select public.accept_invitation(%L)$$, current_setting('t.tok2'))),
  'P0001|CHARA_INVITATION_INVALID|', 'a used token stays invalid for everyone'
);

select * from finish();
rollback;
