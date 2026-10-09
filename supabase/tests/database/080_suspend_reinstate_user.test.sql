begin;
select plan(51);

\ir status_fixture.inc

\set why 'Fake profile reported 3x.'
\set back 'Identity confirmed by mail.'
\set request '7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11'

select set_config(
  'request.headers',
  json_build_object('x-request-id', :'request', 'x-forwarded-for', '203.0.113.7, 10.0.0.1')::text,
  true
);

select pg_temp.open_job('Visible vacancy one') as v1 \gset
select pg_temp.open_job('Visible vacancy two') as v2 \gset

create function pg_temp.suspend_as(p_user uuid, p_target uuid, p_reason text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.suspend_user(%L, %L)', p_target, p_reason), p_aal)
$$;
create function pg_temp.reinstate_as(p_user uuid, p_target uuid, p_reason text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.reinstate_user(%L, %L)', p_target, p_reason), p_aal)
$$;
create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.moderation_actions) || ',' || (select count(*) from audit.log) || ','
      || (select count(*) from pgmq.q_account_ops) || ',' || (select count(*) from pgmq.q_notifications) || ','
      || (select string_agg(id || ':' || status, ',' order by id) from public.profiles)
$$;

-- AC5: suspending an employer user
select is(pg_temp.suspend_as(:'st_trust', :'own1', :'why'), 'ok', 'AC5: the Trust & Safety Administrator suspends the employer user');
select is((select status::text from public.profiles where id = :'own1'), 'suspended', 'AC5: the profile is suspended');
select is(
  (select format('%s|%s|%s|%s', count(*), min(target_type), min(statement_of_reasons), min(actor_id::text))
   from public.moderation_actions where target_id = :'own1' and action = 'account_suspended'),
  format('1|profile|%s|%s', :'why', :'st_trust'), 'AC5: one moderation row with the reason and the actor'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s', count(*), min(entity_type), min(actor_id::text), min(metadata ->> 'reason'),
                 min(metadata ->> 'request_id'), min(host(ip)))
   from audit.log where action = 'user.suspend' and entity_id = :'own1'),
  format('1|profile|%s|%s|%s|203.0.113.7', :'st_trust', :'why', :'request'),
  'AC5: one audit row with the actor, the reason, the request id and the address'
);
select is(
  (select count(*) from audit.log where action = 'user.suspend' and entity_id = :'own1' and created_at > now() - interval '5 seconds'),
  1::bigint, 'AC5: the audit row is written in the transaction of the change'
);
select is(
  (select count(*) from pgmq.q_account_ops where message @> jsonb_build_object('action', 'suspend_user', 'user_id', :'own1')),
  1::bigint, 'AC5: exactly one account-ops message signs the user out and sets the ban'
);
select is(
  (select format('%s|%s|%s', count(*), min(status), min(payload ->> 'reasons')) from public.notifications
   where user_id = :'own1' and kind = 'account_suspended'),
  format('1|queued|%s', :'why'), 'AC5: one mandatory account_suspended email carries the reason'
);
select is(
  (select o.status::text || '|' || (select string_agg(moderation_state::text, ',') from public.jobs where id in (:'v1', :'v2'))
   from public.organizations o where o.id = current_setting('t.a')::uuid),
  'active|visible,visible', 'AC5: the organisation stays active and its vacancies stay visible'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.create_organization('employer', 'Gamma Ltd', 'Gamma', 'DE', 'F')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|profile_not_active', 'AC5: the unexpired token of the suspended user cannot create an organisation'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.invite_member(%L, 'new@example.test', 'member')$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|profile_suspended', 'AC5: nor invite a member'
);
select is(
  pg_temp.insert_as(:'own1'), '42501|new row violates row-level security policy for table "jobs"|',
  'AC5: nor insert a vacancy'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$update public.jobs set title = 'Changed' where id = %L$$, :'v1'), 'aal1'), 'ok',
  'AC5: an update of a vacancy the user can no longer see changes no row'
);
select is((select title from public.jobs where id = :'v1'), 'Visible vacancy one', 'AC5: the vacancy keeps its title');
select is(
  pg_temp.val_as(:'own1', 'aal2', $$select count(*) from public.organizations$$), '0',
  'AC5: the suspended user is a member of no organisation'
);

-- AC5: suspending a candidate
select is(pg_temp.suspend_as(:'st_trust', :'wa', :'why'), 'ok', 'AC5: the candidate is suspended');
select is(
  pg_temp.apply_as(:'wa', :'v1'), 'P0001|CHARA_FORBIDDEN|account_not_active', 'AC5: the unexpired token of the candidate cannot apply'
);
select is(
  (select count(*) from public.moderation_actions where action = 'account_suspended'), 2::bigint,
  'AC5: one moderation row per suspended user'
);

-- AC5: the reinstatement
select is(pg_temp.reinstate_as(:'st_trust', :'own1', :'back'), 'ok', 'AC5: the employer user is reinstated');
select is((select status::text from public.profiles where id = :'own1'), 'active', 'AC5: the profile is active');
select is(
  (select format('%s|%s', count(*), min(statement_of_reasons)) from public.moderation_actions
   where target_id = :'own1' and action = 'account_reinstated'),
  format('1|%s', :'back'), 'AC5: one moderation row for the reinstatement with its reason'
);
select is(
  (select format('%s|%s|%s', count(*), min(metadata ->> 'reason'), min(metadata ->> 'request_id'))
   from audit.log where action = 'user.reinstate' and entity_id = :'own1'),
  format('1|%s|%s', :'back', :'request'), 'AC5: one audit row user.reinstate with the reason'
);
select is(
  (select count(*) from pgmq.q_account_ops where message @> jsonb_build_object('action', 'reinstate_user', 'user_id', :'own1')),
  1::bigint, 'AC5: one account-ops message lifts the ban'
);
select is(
  (select format('%s|%s', count(*), min(payload ->> 'reasons')) from public.notifications
   where user_id = :'own1' and kind = 'account_reinstated'),
  format('1|%s', :'back'), 'AC5: one account_reinstated email carries the reinstatement reason'
);
select is(pg_temp.insert_as(:'own1'), 'ok', 'AC5: after the reinstatement the user inserts a vacancy again');

-- AC7: the reason
select pg_temp.writes() as before \gset
select is(pg_temp.suspend_as(:'st_trust', :'wb', null), 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: a null reason is refused');
select is(pg_temp.suspend_as(:'st_trust', :'wb', ''), 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: an empty reason is refused');
select is(pg_temp.suspend_as(:'st_trust', :'wb', '      '), 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: a reason of spaces is refused');
select is(pg_temp.suspend_as(:'st_trust', :'wb', '  123456789   '), 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: 9 characters after trimming are refused');
select is(pg_temp.suspend_as(:'st_trust', :'wb', repeat('x', 2001)), 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: 2001 characters are refused');
select is(pg_temp.reinstate_as(:'st_trust', :'wsus', repeat('x', 2001)), 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: the same for a reinstatement');
select is(pg_temp.suspend_as(:'st_trust', :'wb', null, 'aal2') , 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: a refused reason is a refusal every time');

-- AC7: the target
select is(
  pg_temp.suspend_as(:'st_trust', '00000000-0000-0000-0000-00000000ffff', :'why'), 'P0002|CHARA_NOT_FOUND|', 'AC7: an unknown user is not found'
);
select is(pg_temp.suspend_as(:'st_trust', null, :'why'), 'P0001|CHARA_INVALID_INPUT|user', 'AC7: no user is invalid input');
select is(pg_temp.suspend_as(:'st_trust', :'wa', :'why'), 'P0001|CHARA_INVALID_STATE|suspended', 'AC7: a suspended user cannot be suspended again');
select is(pg_temp.reinstate_as(:'st_trust', :'wb', :'why'), 'P0001|CHARA_INVALID_STATE|active', 'AC7: an active user cannot be reinstated');
select is(
  pg_temp.suspend_as(:'st_trust', :'st_admin', :'why'), 'P0001|CHARA_FORBIDDEN|staff_account',
  'a user with a platform role cannot be suspended; the role is revoked first'
);
select is(
  pg_temp.suspend_as(:'st_trust', :'st_trust', :'why'), 'P0001|CHARA_FORBIDDEN|staff_account',
  'and nobody suspends their own account'
);
select is(pg_temp.writes(), :'before', 'AC7: no refused call changed a status, a moderation row, an audit row, a job or an email');

-- AC7: the limits are accepted
select is(pg_temp.suspend_as(:'st_trust', :'wb', repeat('a', 10)), 'ok', 'AC7: exactly 10 characters are accepted');
select is(pg_temp.reinstate_as(:'st_trust', :'wb', '  ' || repeat('b', 2000) || '  '), 'ok', 'AC7: exactly 2000 characters after trimming are accepted');
select is(
  (select length(statement_of_reasons) from public.moderation_actions where target_id = :'wb' and action = 'account_reinstated'),
  2000, 'AC7: the stored reason is the trimmed one'
);

-- AC5: the double submit of two Trust & Safety sessions: the second call finds the user suspended
select pg_temp.suspend_as(:'st_trust', :'mem', :'why') as first_call \gset
select pg_temp.suspend_as(:'st_trust', :'mem', :'why') as second_call \gset
select is(:'first_call' || '/' || :'second_call', 'ok/P0001|CHARA_INVALID_STATE|suspended', 'AC8: of two submissions one succeeds and the other is refused');
select is(
  (select count(*) from public.moderation_actions where target_id = :'mem') || ',' ||
  (select count(*) from audit.log where action = 'user.suspend' and entity_id = :'mem') || ',' ||
  (select count(*) from pgmq.q_account_ops where message ->> 'user_id' = :'mem'),
  '1,1,1', 'AC8: one moderation row, one audit row and one job'
);

-- the reason of the moderation row cannot be changed or deleted
select throws_ok(
  $$update public.moderation_actions set statement_of_reasons = 'Changed after the fact'$$, '42501', 'moderation_actions is append-only',
  'the record of a moderation action is append-only'
);
select throws_ok($$delete from public.moderation_actions$$, '42501', 'moderation_actions is append-only', 'and cannot be deleted');
select is(
  (select count(*) from public.moderation_actions m join public.profiles p on p.id = m.actor_id), (select count(*) from public.moderation_actions),
  'every moderation row names a profile as its actor'
);
select is(
  (select count(*) from audit.log where action in ('user.suspend', 'user.reinstate') and metadata ->> 'reason' is null),
  0::bigint, 'KPI: every audit row of a suspension or reinstatement has a reason'
);

-- the record outlives the account of the staff member who made it and that of the person it concerns
select pg_temp.new_user('00000000-0000-0000-0000-00000000b401');
select pg_temp.new_user('00000000-0000-0000-0000-00000000b402');
update public.profiles set account_kind = intended_account_kind where id in ('00000000-0000-0000-0000-00000000b401', '00000000-0000-0000-0000-00000000b402');
insert into public.platform_staff (user_id, role) values ('00000000-0000-0000-0000-00000000b401', 'trust_safety');
select is(
  pg_temp.suspend_as('00000000-0000-0000-0000-00000000b401', '00000000-0000-0000-0000-00000000b402', :'why'), 'ok',
  'a second Trust & Safety Administrator suspends a user'
);
select lives_ok(
  $$delete from public.profiles where id = '00000000-0000-0000-0000-00000000b401'$$,
  'the account of the staff member who suspended a user can be deleted'
);
select lives_ok(
  $$delete from public.profiles where id = '00000000-0000-0000-0000-00000000b402'$$,
  'and so can the account of the user who was suspended'
);
select is(
  (select format('%s|%s', count(*), min(statement_of_reasons)) from public.moderation_actions
   where target_id = '00000000-0000-0000-0000-00000000b402' and actor_id = '00000000-0000-0000-0000-00000000b401'),
  format('1|%s', :'why'), 'and the record is kept as it was'
);
select * from finish();
rollback;
