begin;
select plan(56);

\ir privacy_fixture.inc

\set wc '00000000-0000-0000-0000-00000000a105'
\set wd '00000000-0000-0000-0000-00000000a106'
select pg_temp.new_user(:'wc', 'worker');
select pg_temp.new_user(:'wd', 'worker');
update public.profiles set account_kind = intended_account_kind where id in (:'wc', :'wd');

create function pg_temp.o() returns uuid language sql as $$ select current_setting('t.o')::uuid $$;
create function pg_temp.requested(p_user uuid) returns timestamptz language sql as $$ select deleted_at from public.profiles where id = p_user $$;
create function pg_temp.audits(p_user uuid, p_action text) returns bigint
language sql as $$ select count(*) from audit.log where entity_id = p_user::text and action = p_action $$;
create function pg_temp.queued(p_user uuid, p_kind text) returns bigint
language sql as $$ select count(*) from pgmq.q_notifications where message ->> 'kind' = p_kind and message ->> 'user_id' = p_user::text $$;
create function pg_temp.logged() returns bigint language sql as $$ select count(*) from audit.document_access_log $$;
create function pg_temp.refused(p_user uuid, p_sql text) returns text
language sql as $$ select pg_temp.call_as(p_user, 'authenticated', p_sql, 'aal1') $$;

select is(
  (select value #>> '{}' from private.settings where key = 'account_deletion_cooling_off_days'), '30',
  'the cooling-off period is a setting, 30 days by default'
);

-- Candidate A has an active share to O, a document in its scope and no request.
select pg_temp.doc(:'d1', :'wa');
select pg_temp.share(pg_temp.o(), :'wa', array[:'d1']::uuid[]);
update private.settings set value = '0' where key = 'document_access_repeat_seconds';
select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'ok', 'setup: a member of O opens the document before the request');
select is(pg_temp.logged(), 1::bigint, 'setup: one opening is logged');

-- AC2: the request takes effect at once.
select is(pg_temp.refused(:'wa', 'select public.request_account_deletion()'), 'ok', 'AC2: the candidate requests deletion');
select is(pg_temp.requested(:'wa') = now(), true, 'AC2: profiles.deleted_at equals now()');
select is((select status::text from public.profiles where id = :'wa'), 'active', 'AC2: the status stays active');
select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'AC2: the member of O is refused the document');
select is(pg_temp.logged(), 1::bigint, 'AC2: the refusal wrote no log row');
select is(pg_temp.grant_as(:'wa', :'d1', 'owner_download', 'aal1'), 'ok', 'AC2: the candidate still reads their own document');
select is(
  pg_temp.val_as(:'wa', 'aal1', 'select (deleted_at is not null)::text from public.profiles'), 'true',
  'AC2: the candidate still reads their own profile row'
);
select is(
  (select banned_until is null from auth.users where id = :'wa'), true, 'AC2: no sign-in ban is set'
);
select is(pg_temp.audits(:'wa', 'account.deletion_requested'), 1::bigint, 'AC2: one audit row records the request');
select is(
  (select actor_id from audit.log where entity_id = :'wa' and action = 'account.deletion_requested'), :'wa'::uuid,
  'AC2: the candidate is the actor'
);
select is(
  (select (message ->> 'erases_on')::timestamptz = now() + interval '30 days' from pgmq.q_notifications
   where message ->> 'kind' = 'deletion_requested' and message ->> 'user_id' = :'wa'),
  true, 'AC2: one deletion_requested email is queued, naming the erasure date'
);
select is(
  (select message ->> 'mandatory' from pgmq.q_notifications where message ->> 'kind' = 'deletion_requested' and message ->> 'user_id' = :'wa'),
  'true', 'AC2: the email is mandatory'
);
select is(
  (select (message - 'erases_on' - 'user_id' - 'kind' - 'mandatory') from pgmq.q_notifications
   where message ->> 'kind' = 'deletion_requested' and message ->> 'user_id' = :'wa'),
  '{}'::jsonb, 'AC2: the message holds no profile content, document or note'
);
select is(
  pg_temp.val_as(:'wa', 'aal1', $$select requested_at = now() and erases_on = now() + interval '30 days' and can_cancel and cooling_off_days = 30 from public.account_deletion_status()$$),
  'true', 'the status gives the request time, the erasure time, the right to cancel and the period'
);

-- AC3: a repeated request changes nothing.
select pg_temp.must(pg_temp.refused(:'wb', 'select public.request_account_deletion()'));
update public.profiles set deleted_at = now() - interval '5 days' where id = :'wb';
select is(pg_temp.refused(:'wb', 'select public.request_account_deletion()'), 'ok', 'AC3: the repeated request succeeds');
select is(pg_temp.requested(:'wb'), now() - interval '5 days', 'AC3: deleted_at keeps its original value');
select is(pg_temp.audits(:'wb', 'account.deletion_requested'), 1::bigint, 'AC3: exactly one deletion_requested audit row');
select is(pg_temp.queued(:'wb', 'deletion_requested'), 1::bigint, 'AC3: no second email is queued');

-- AC4: only candidates request or cancel.
select is(
  pg_temp.call_as(null, 'anon', 'select public.request_account_deletion()') ~ '^42501\|permission denied', true,
  'AC4: anonymous has no EXECUTE on request_account_deletion'
);
select is(
  pg_temp.call_as(null, 'anon', 'select public.cancel_account_deletion()') ~ '^42501\|permission denied', true,
  'AC4: anonymous has no EXECUTE on cancel_account_deletion'
);
select is(
  pg_temp.call_as(null, 'anon', 'select * from public.account_deletion_status()') ~ '^42501\|permission denied', true,
  'AC4: anonymous has no EXECUTE on account_deletion_status'
);
select is(
  (select array_agg(pg_temp.refused(u, 'select public.request_account_deletion()') order by n)
   from (values (1, :'own1'::uuid), (2, :'adm'::uuid), (3, :'mem'::uuid), (4, :'slg'::uuid)) v(n, u)),
  array_fill('P0001|CHARA_FORBIDDEN|worker_account_required'::text, array[4]),
  'AC4: an employer owner, admin, member and a platform administrator are refused the request'
);
select is(
  (select array_agg(pg_temp.refused(u, 'select public.cancel_account_deletion()') order by n)
   from (values (1, :'own1'::uuid), (2, :'adm'::uuid), (3, :'mem'::uuid), (4, :'slg'::uuid)) v(n, u)),
  array_fill('P0001|CHARA_FORBIDDEN|worker_account_required'::text, array[4]),
  'AC4: and the cancel'
);
select is(
  (select count(*) from public.profiles where id in (:'own1', :'adm', :'mem', :'slg') and deleted_at is not null), 0::bigint,
  'AC4: no state changed'
);
select is(
  (select count(*) from audit.log where action like 'account.%' and actor_id in (:'own1', :'adm', :'mem', :'slg')), 0::bigint,
  'AC4: no audit row was written'
);
select is(
  pg_temp.refused(:'own1', 'select * from public.account_deletion_status()'), 'P0001|CHARA_FORBIDDEN|worker_account_required',
  'AC4: the status page data is for candidates only'
);

-- A candidate who also holds a platform role must give it up first: the last administrator is never erased.
insert into public.platform_staff (user_id, role) values (:'wd', 'trust_safety');
select is(
  pg_temp.refused(:'wd', 'select public.request_account_deletion()'), 'P0001|CHARA_FORBIDDEN|platform_staff',
  'a candidate with an active platform role is refused the request'
);
select is(pg_temp.requested(:'wd'), null, 'and nothing is recorded');
update public.platform_staff set revoked_at = now() where user_id = :'wd';
select is(pg_temp.refused(:'wd', 'select public.request_account_deletion()'), 'ok', 'after the role is revoked the request is accepted');

-- A suspended candidate may request deletion too.
select is(pg_temp.refused(:'wsus', 'select public.request_account_deletion()'), 'ok', 'a suspended candidate may request deletion');

-- AC5: the candidate cancels during the cooling-off period.
update public.profiles set deleted_at = now() - interval '10 days' where id = :'wa';
select is(pg_temp.refused(:'wa', 'select public.cancel_account_deletion()'), 'ok', 'AC5: the candidate cancels');
select is(pg_temp.requested(:'wa'), null, 'AC5: deleted_at is null after the cancel');
select is(pg_temp.audits(:'wa', 'account.deletion_cancelled'), 1::bigint, 'AC5: exactly one deletion_cancelled audit row');
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'wa' and message ->> 'kind' <> 'deletion_requested'),
  0::bigint, 'AC5: no email is queued for the cancel'
);
select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'ok', 'AC5: the grant succeeds again because the share is otherwise valid');
select is(pg_temp.refused(:'wa', 'select public.cancel_account_deletion()'), 'ok', 'a cancel with nothing pending is a no-op');
select is(pg_temp.audits(:'wa', 'account.deletion_cancelled'), 1::bigint, 'and writes no audit row');
select is(pg_temp.refused(:'wa', 'select public.request_account_deletion()'), 'ok', 'AC5: the candidate requests deletion again');
select is(pg_temp.requested(:'wa') = now(), true, 'AC5: the new request starts a fresh period');

-- AC6: the 30-day boundary, for candidate C (29 days 23 hours) and candidate D (30 days).
select pg_temp.must(pg_temp.refused(:'wc', 'select public.request_account_deletion()'));
update public.profiles set deleted_at = now() - interval '29 days 23 hours' where id = :'wc';
update public.profiles set deleted_at = now() - interval '30 days' where id = :'wd';
select is(
  pg_temp.call_as(null, 'service_role', format('select public.erase_user(%L)', :'wc')), 'P0001|CHARA_FORBIDDEN|cooling_off_not_ended',
  'AC6: erase_user refuses before the 30 days have passed'
);
select is((select count(*) from public.profiles where id = :'wc'), 1::bigint, 'AC6: and leaves all data in place');
select is(
  pg_temp.val_as(:'wc', 'aal1', $$select can_cancel::text from public.account_deletion_status()$$), 'true',
  'AC6: the candidate can still cancel at 29 days 23 hours'
);
select is(pg_temp.refused(:'wd', 'select public.cancel_account_deletion()'), 'P0001|CHARA_FORBIDDEN|cooling_off_ended', 'AC6: the cancel after the 30 days is refused');
select is(
  pg_temp.val_as(:'wd', 'aal1', $$select can_cancel::text from public.account_deletion_status()$$), 'false',
  'AC6: and the status says so'
);
select is(pg_temp.refused(:'wc', 'select public.cancel_account_deletion()'), 'ok', 'AC6: C cancels in time');
select is(
  pg_temp.call_as(:'wc', 'authenticated', format('select public.erase_user(%L)', :'wc'), 'aal1') ~ '^42501\|permission denied', true,
  'AC6: an authenticated user has no EXECUTE on erase_user'
);
select is(
  pg_temp.call_as(null, 'anon', format('select public.erase_user(%L)', :'wc')) ~ '^42501\|permission denied', true,
  'AC6: nor anonymous'
);
select is(pg_temp.call_as(null, 'service_role', format('select public.erase_user(%L)', :'wd')), 'ok', 'AC6: erase_user proceeds for D');
select is((select count(*) from public.profiles where id = :'wd'), 0::bigint, 'AC6: D is erased');

-- NFR-S6: request and cancel in turn are capped per candidate and day, by a setting.
select is(
  (select value #>> '{}' from private.settings where key = 'account_deletion_requests_per_day_max'), '5',
  'the number of requests per day is a setting, 5 by default'
);
select pg_temp.must(pg_temp.refused(:'wnew', 'select public.request_account_deletion()')),
       pg_temp.must(pg_temp.refused(:'wnew', 'select public.cancel_account_deletion()'))
from generate_series(1, 5);
select is(pg_temp.audits(:'wnew', 'account.deletion_requested'), 5::bigint, 'five requests in a day are accepted and audited');
select is(
  pg_temp.refused(:'wnew', 'select public.request_account_deletion()'), 'P0001|CHARA_FORBIDDEN|rate_limited',
  'the sixth request in a day is refused'
);
select is(
  pg_temp.audits(:'wnew', 'account.deletion_requested') + pg_temp.queued(:'wnew', 'deletion_requested') + (pg_temp.requested(:'wnew') is not null)::integer,
  10::bigint, 'and writes no audit row, queues no email and sets no request'
);

select * from finish();
rollback;
