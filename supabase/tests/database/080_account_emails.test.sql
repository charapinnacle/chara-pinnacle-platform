begin;
select plan(55);

\ir organizations_fixture.inc

-- FR-I1: the emails that go through the notifications queue, the invitation to a team (AC6, AC9) and the notice of a
-- reset of two-step verification (AC8, AC9). The sign-up confirmation and the reset link are sent by Auth.

\set sta '00000000-0000-0000-0000-00000000b101'
\set tss '00000000-0000-0000-0000-00000000b103'
\set vrv '00000000-0000-0000-0000-00000000b104'
\set tgt '00000000-0000-0000-0000-00000000b106'
select pg_temp.new_user(:'sta');
select pg_temp.new_user(:'tss');
select pg_temp.new_user(:'vrv');
select pg_temp.new_user(:'tgt');
insert into public.platform_staff (user_id, role) values (:'sta', 'admin'), (:'tss', 'trust_safety'), (:'vrv', 'verification_reviewer');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), :'tgt', 'Authenticator', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP');

select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.a', (public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'DE', 'F'))->>'organization_id', true)$$, 'aal1'), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'own2', 'authenticated',
  $$select set_config('t.b', (public.create_organization('employer', 'Beta Works Ltd', 'Beta Works', 'GB', 'F'))->>'organization_id', true)$$, 'aal1'), 'ok', 'setup call succeeds');

-- Acme: Professional with the owner alone, 1 of 5. Beta: Professional with 5 of 5.
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (current_setting('t.a')::uuid, 'employer_professional', 'active', 'null'),
       (current_setting('t.b')::uuid, 'employer_professional', 'active', 'null');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.b')::uuid, :'adm2', 'admin', now()), (current_setting('t.b')::uuid, :'oth', 'member', now()),
       (current_setting('t.b')::uuid, :'late', 'member', now()), (current_setting('t.b')::uuid, :'gone', 'member', now());
update private.settings set value = 'true' where key = 'entitlements_enforced';

-- The queue and the table of the earlier statements are not under test.
select pgmq.purge_queue('notifications');
delete from public.notifications;

create function pg_temp.dequeue() returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  select public.notify_dequeue(25) into v;
  reset role;
  return v;
end;
$$;

create function pg_temp.ack(p_outcome text, p_id uuid, p_provider text default null) returns text
language plpgsql as $$
declare v text;
begin
  set local role service_role;
  select public.notify_ack(p_outcome, p_id, p_provider)::text into v;
  reset role;
  return v;
end;
$$;

-- What a refused call must not touch: invitations, notifications, queue messages, account-ops jobs and audit rows.
create function pg_temp.footprint() returns text
language sql as $$
  select format('%s|%s|%s|%s|%s',
    (select count(*) from public.organization_invitations), (select count(*) from public.notifications),
    (select count(*) from pgmq.q_notifications), (select count(*) from pgmq.q_account_ops), (select count(*) from audit.log))
$$;

-- AC6: the invitation is queued with a single-use token.
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    format($$select set_config('t.tok', (select token from public.invite_member(%L, 'New.Member@Example.com', 'member')), true)$$, current_setting('t.a'))),
  'ok', 'AC6: an owner at aal2 of a Professional organization with 1 of 5 members invites New.Member@Example.com'
);
select is(
  (select format('%s|%s|%s|%s', count(*), min(i.email::text), min(i.role::text), count(*) filter (where i.accepted_at is null))
   from public.organization_invitations i where i.organization_id = current_setting('t.a')::uuid),
  '1|new.member@example.com|member|1', 'AC6: one invitation holds the address in lower case, role member and no acceptance'
);
select is(
  (select count(*) from public.organization_invitations where email = 'NEW.MEMBER@example.com'), 1::bigint,
  'AC6: the address is case-insensitive'
);
select is(
  (select token_hash = encode(sha256(convert_to(current_setting('t.tok'), 'UTF8')), 'hex') and token_hash <> current_setting('t.tok')
   from public.organization_invitations where organization_id = current_setting('t.a')::uuid),
  true, 'AC6: only the hash of the token is stored'
);
select is(
  (select count(*) from public.organization_invitations i where to_jsonb(i)::text like '%' || current_setting('t.tok') || '%'),
  0::bigint, 'AC6: the raw token is in no column of the invitation'
);
select is(
  (select expires_at - created_at from public.organization_invitations where organization_id = current_setting('t.a')::uuid),
  interval '7 days', 'AC6: the invitation expires 7 days after it is created'
);
select is(
  (select count(*) from audit.log a join public.organization_invitations i on a.entity_id = i.id::text
   where a.action = 'member_invited' and i.organization_id = current_setting('t.a')::uuid),
  1::bigint, 'AC6: one audit row names the invitation'
);
select is(
  (select format('%s|%s|%s', count(*), min(status), count(*) filter (where user_id is null))
   from public.notifications where kind = 'member_invitation'),
  '1|queued|1', 'AC6: one member_invitation row is queued and names no user, the invitee may have no account'
);
select is(
  (select count(*) from pgmq.q_notifications q join public.notifications n on n.msg_id = q.msg_id where n.kind = 'member_invitation'),
  1::bigint, 'AC6: one queue message belongs to the row'
);
select is(
  (select array(select jsonb_object_keys(message) order by 1) from pgmq.q_notifications),
  array['email', 'invitation_id', 'kind', 'mandatory'],
  'AC6: the message holds the kind, the invitation, the address and no more'
);
select is(
  (select count(*) from pgmq.q_notifications where message::text like '%' || current_setting('t.tok') || '%'), 0::bigint,
  'AC6: the token is not in the queue'
);
select is(
  (select array(select jsonb_object_keys(payload) order by 1) from public.notifications where kind = 'member_invitation'),
  array['expires_at', 'invitation_id', 'org_name', 'role', 'token'],
  'AC6: the payload holds the organization name, the role, the expiry and the link token while queued'
);
select is(
  (select payload ->> 'org_name' || '|' || (payload ->> 'role') || '|' || (payload ->> 'token' = current_setting('t.tok'))
   from public.notifications where kind = 'member_invitation'),
  'Acme Bau|member|true', 'AC6: with the display name of the organization and the token of the link'
);
select is(
  (select (payload ->> 'expires_at')::timestamptz = i.expires_at from public.notifications n
   join public.organization_invitations i on i.id = (n.payload ->> 'invitation_id')::uuid where n.kind = 'member_invitation'),
  true, 'AC6: the expiry of the payload is that of the invitation'
);
select is(
  pg_temp.val_as(:'own1', 'aal2', $$select count(*) from public.notifications where kind = 'member_invitation'$$), '0',
  'AC6: the inviter cannot read the row with the token'
);
select is(
  pg_temp.call_as(null, 'anon', 'select count(*) from public.notifications'), '42501|permission denied for table notifications|',
  'AC6: an anonymous visitor may not read any notification row'
);
select is(
  pg_temp.val_as(:'mem', 'aal2', $$select count(*) from public.notifications where kind = 'member_invitation'$$), '0',
  'AC6: a plain member of the same organization cannot read the row with the token'
);
select is(
  pg_temp.val_as(:'own2', 'aal2', $$select count(*) from public.notifications where kind = 'member_invitation'$$), '0',
  'AC6: an owner of another organization cannot read the row with the token'
);
select is(
  pg_temp.val_as(:'wkr', 'aal2', $$select count(*) from public.notifications where kind = 'member_invitation'$$), '0',
  'AC6: a worker cannot read the row with the token'
);
select is(
  pg_temp.call_as(null, 'service_role', 'select count(*) from public.notifications'), '42501|permission denied for table notifications|',
  'AC6: the service role reads the row only through notify_dequeue'
);

create temp table t_batch as select pg_temp.dequeue() as r;
select is(
  (select format('%s|%s|%s|%s', jsonb_array_length(r -> 'messages'), r -> 'messages' -> 0 ->> 'kind', r -> 'messages' -> 0 ->> 'recipient',
     r -> 'messages' -> 0 -> 'payload' ->> 'token' = current_setting('t.tok')) from t_batch),
  '1|member_invitation|new.member@example.com|t', 'AC6: notify gets the address and the token from the row, not from the queue'
);
select is(
  pg_temp.ack('sent', (select id from public.notifications where kind = 'member_invitation'), 'prov-inv-1'), 'true',
  'AC6: notify_ack records the message as sent'
);
select is(
  (select format('%s|%s|%s', status, payload ? 'token', payload ->> 'org_name') from public.notifications where kind = 'member_invitation'),
  'sent|f|Acme Bau', 'AC6: once sent the payload no longer contains the token, the rest stays'
);
select is(
  (select format('%s|%s', (select count(*) from pgmq.q_notifications), (select count(*) from pgmq.a_notifications))), '0|0',
  'AC6: the message is deleted, not archived, so the address does not outlive the send'
);

-- A new invitation to the same address replaces the one that waits, and its email is not sent.
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    format($$select set_config('t.tok1', (select token from public.invite_member(%L, 'again@example.test', 'member')), true)$$, current_setting('t.a'))),
  'ok', 'AC6: a first invitation of another address is made'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    format($$select set_config('t.tok2', (select token from public.invite_member(%L, 'AGAIN@example.test', 'admin')), true)$$, current_setting('t.a'))),
  'ok', 'AC6: and made again for the same address with another role'
);
select is(
  (select format('%s|%s', count(*), min(role::text)) from public.organization_invitations where email = 'again@example.test'),
  '1|admin', 'AC6: one invitation remains'
);
select is(
  (select format('%s|%s|%s', count(*) filter (where status = 'suppressed'), count(*) filter (where status = 'queued'),
     count(*) filter (where payload ? 'token' and status = 'suppressed'))
   from public.notifications where kind = 'member_invitation' and status <> 'sent'),
  '1|1|0', 'AC6: the email of the replaced invitation is suppressed and holds no token'
);
create temp table t_batch2 as select pg_temp.dequeue() as r;
select is(
  (select format('%s|%s', jsonb_array_length(r -> 'messages'), r -> 'messages' -> 0 -> 'payload' ->> 'role') from t_batch2),
  '1|admin', 'AC6: notify is given only the email of the new invitation'
);
select is(
  pg_temp.ack('failed', (select id from public.notifications where status = 'queued'), null), 'true', 'AC6: a failed send is recorded'
);
select is(
  (select count(*) from public.notifications where kind = 'member_invitation' and payload ? 'token'), 0::bigint,
  'AC6: no row that left the queue keeps a token'
);
select is(
  (select count(*) from pgmq.q_notifications), 0::bigint, 'AC6: and the queue is empty'
);

-- The kind is accepted without a user only for the invitation and the completed erasure.
select throws_ok(
  $$select pgmq.send('notifications', '{"kind": "mfa_reset"}')$$, '23514', null,
  'a message without a recipient is refused for every kind but the invitation and the completed erasure'
);
select lives_ok(
  $$select pgmq.send('notifications', '{"kind": "member_invitation", "email": "nobody@example.test"}')$$,
  'an invitation message needs no user, its recipient is the address'
);

-- AC8: the reset notice is queued, and the digest setting does not delay it.
insert into public.notification_preferences (user_id, digest) values (:'tgt', true);
select pgmq.purge_queue('notifications');
delete from public.notifications;
delete from audit.log where action = 'mfa_reset';
select is(
  pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, 'Authenticator device lost, identity checked')$$, :'tgt')),
  'ok', 'AC8: an administrator at aal2 resets the factors of a user with digest = true whose device is lost'
);
select is(
  (select count(*) from audit.log where action = 'mfa_reset' and entity_id = :'tgt' and metadata ->> 'reason' = 'Authenticator device lost, identity checked'),
  1::bigint, 'AC8: one audit row holds the reason'
);
select is(
  (select count(*) from pgmq.q_account_ops where message ->> 'user_id' = :'tgt' and message ->> 'action' = 'reset_mfa'), 1::bigint,
  'AC8: one account-ops job is queued'
);
select is(
  (select format('%s|%s|%s', count(*), min(status), count(msg_id)) from public.notifications where user_id = :'tgt' and kind = 'mfa_reset'),
  '1|queued|1', 'AC8: exactly one mfa_reset row is queued for the user and has its message'
);
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'tgt' and message ->> 'kind' = 'mfa_reset'), 1::bigint,
  'AC8: and one queue message exists'
);
select is(
  (select count(*) from pgmq.q_notifications q join public.notifications n on n.msg_id = q.msg_id where n.user_id = :'tgt'), 1::bigint,
  'AC8: the digest setting does not hold it back, the message waits to be sent at once'
);
create temp table t_batch3 as select pg_temp.dequeue() as r;
select is(
  (select format('%s|%s', r -> 'messages' -> 0 ->> 'kind', r -> 'messages' -> 0 -> 'payload') from t_batch3),
  'mfa_reset|{}', 'AC8: notify receives it at once, without payload'
);

-- AC9: unauthorised calls queue nothing.
create temp table t_before as select pg_temp.footprint() as f;
select is(pg_temp.call_as(:'mem', 'authenticated', format($$select public.invite_member(%L, 'x1@example.test', 'member')$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|', 'AC9: a plain member cannot invite');
select is(pg_temp.call_as(:'own1', 'authenticated', format($$select public.invite_member(%L, 'x2@example.test', 'member')$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'AC9: an owner at aal1 cannot invite');
select is(pg_temp.call_as(:'adm2', 'authenticated', format($$select public.invite_member(%L, 'x3@example.test', 'member')$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|', 'AC9: an admin of another organization cannot invite');
select is(pg_temp.call_as(:'own1', 'authenticated', format($$select public.invite_member(%L, 'x4@example.test', 'owner')$$, current_setting('t.a'))),
  'P0001|CHARA_INVALID_INPUT|role', 'AC9: the role owner is refused');
select is(pg_temp.call_as(:'own2', 'authenticated', format($$select public.invite_member(%L, 'x5@example.test', 'member')$$, current_setting('t.b'))),
  'P0001|CHARA_LIMIT_REACHED|members', 'AC9: the owner of a Professional organization with 5 of 5 members is refused, limits enforced');
select is(pg_temp.call_as(null, 'anon', format($$select public.invite_member(%L, 'x6@example.test', 'member')$$, current_setting('t.a'))),
  '42501|permission denied for function invite_member|', 'AC9: an anonymous caller is refused');
select is(pg_temp.call_as(:'tss', 'authenticated', format($$select public.reset_mfa(%L, 'Authenticator device lost, identity checked')$$, :'tgt')),
  'P0001|CHARA_FORBIDDEN|', 'AC9: a trust_safety user cannot reset');
select is(pg_temp.call_as(:'vrv', 'authenticated', format($$select public.reset_mfa(%L, 'Authenticator device lost, identity checked')$$, :'tgt')),
  'P0001|CHARA_FORBIDDEN|', 'AC9: a verification_reviewer cannot reset');
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, 'Authenticator device lost, identity checked')$$, :'sta')),
  'P0001|CHARA_FORBIDDEN|own_account', 'AC9: an administrator cannot reset themselves');
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, 'Authenticator device lost, identity checked')$$, :'tgt'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'AC9: an administrator at aal1 cannot reset');
select is(pg_temp.call_as(:'sta', 'authenticated', format($$select public.reset_mfa(%L, '')$$, :'tgt')),
  'P0001|CHARA_INVALID_INPUT|reason', 'AC9: an empty reason is refused');
select is((select pg_temp.footprint() = f from t_before), true,
  'AC9: no refused call left an invitation, a notification, a queue message, a job or an audit row');

select * from finish();
rollback;
