begin;
select plan(23);

\ir passport_fixture.inc

\set x '00000000-0000-0000-0000-00000000a111'
\set y '00000000-0000-0000-0000-00000000a112'
\set z '00000000-0000-0000-0000-00000000a113'
\set w '00000000-0000-0000-0000-00000000a114'
select pg_temp.new_user(:'x', 'worker');
select pg_temp.new_user(:'y', 'worker');
select pg_temp.new_user(:'z', 'worker');
select pg_temp.new_user(:'w', 'worker');
update public.profiles set account_kind = intended_account_kind where id in (:'x', :'y', :'z', :'w');

create function pg_temp.jobs(p_user uuid) returns bigint language sql as $$
  select count(*) from pgmq.q_account_ops where message ->> 'action' = 'erase_user' and message ->> 'user_id' = p_user::text
$$;
create function pg_temp.paused(p_user uuid) returns bigint language sql as $$
  select count(*) from audit.log where action = 'account.erasure_paused' and entity_id = p_user::text
$$;
create function pg_temp.paused_mails(p_user uuid) returns bigint language sql as $$
  select count(*) from pgmq.q_notifications where message ->> 'kind' = 'erasure_paused' and message ->> 'user_id' = p_user::text
$$;

-- X requested 31 days ago, Y 29 days 23 hours ago, Z 31 days ago with a legal hold.
update public.profiles set deleted_at = now() - interval '31 days' where id = :'x';
update public.profiles set deleted_at = now() - interval '29 days 23 hours' where id = :'y';
update public.profiles set deleted_at = now() - interval '31 days', legal_hold = true where id = :'z';
update private.settings set value = '"privacy@example.test"' where key = 'privacy_contact_email';

select is(private.queue_account_erasures(), 1, 'AC7: the first run queues one erasure job');
select is(pg_temp.jobs(:'x'), 1::bigint, 'AC7: the job is for X');
select is(pg_temp.jobs(:'y'), 0::bigint, 'AC7: Y is not queued');
select is(pg_temp.jobs(:'z'), 0::bigint, 'AC7: Z is not queued while the hold is set');
select is(
  (select message from pgmq.q_account_ops where message ->> 'user_id' = :'x'),
  jsonb_build_object('action', 'erase_user', 'user_id', :'x'::uuid), 'AC7: the job names the action and the user and nothing else'
);
select is(private.queue_account_erasures(), 0, 'AC7: the second run queues nothing new');
select is(pg_temp.jobs(:'x'), 1::bigint, 'AC7: X still has exactly one job');
select is((select deleted_at is not null from public.profiles where id = :'z'), true, 'AC7: Z stays deletion requested');
select is(pg_temp.paused(:'z'), 1::bigint, 'AC7: one erasure_paused audit row for Z, after both runs');
select is(pg_temp.paused_mails(:'z'), 1::bigint, 'AC7: one notification to the privacy contact, after both runs');
select is(
  (select message ->> 'email' from pgmq.q_notifications where message ->> 'kind' = 'erasure_paused'), 'privacy@example.test',
  'AC7: it goes to the configured address'
);
select is(pg_temp.paused(:'x') + pg_temp.paused(:'y'), 0::bigint, 'AC7: no pause is recorded for the others');
select is(
  pg_temp.call_as(null, 'service_role', format('select public.erase_user(%L)', :'z')), 'P0001|CHARA_FORBIDDEN|legal_hold',
  'AC7: a direct erase_user for Z raises legal_hold'
);
select is((select count(*) from public.profiles where id = :'z'), 1::bigint, 'AC7: and changes nothing');
update public.profiles set legal_hold = false where id = :'z';
select is(private.queue_account_erasures(), 1, 'AC7: after the hold is cleared the next run queues Z');
select is(pg_temp.jobs(:'z'), 1::bigint, 'AC7: Z has its job');
select is(pg_temp.jobs(:'x'), 1::bigint, 'AC7: X is not queued a second time');

-- Without a configured contact the pause is still audited, and nobody is mailed.
update private.settings set value = '""' where key = 'privacy_contact_email';
update public.profiles set deleted_at = now() - interval '40 days', legal_hold = true where id = :'w';
select is(private.queue_account_erasures(), 0, 'a held account queues nothing');
select is(pg_temp.paused(:'w'), 1::bigint, 'a pause is audited without a contact address');
select is(pg_temp.paused_mails(:'w'), 0::bigint, 'and no notification is queued');

select is(
  (select schedule from cron.job where jobname = 'queue-account-erasures'), '30 2 * * *', 'the job runs daily'
);
select is(
  (select command from cron.job where jobname = 'queue-account-erasures'), 'select private.queue_account_erasures()',
  'and calls the queueing function'
);
select is(
  has_function_privilege('authenticated', 'private.queue_account_erasures()', 'execute')
  or has_function_privilege('service_role', 'private.queue_account_erasures()', 'execute'), false,
  'no API role can run the daily job'
);

select * from finish();
rollback;
