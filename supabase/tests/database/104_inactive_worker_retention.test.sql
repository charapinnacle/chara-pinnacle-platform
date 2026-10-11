-- SA-13 (security review), NFR-C1, L6 default "inactive worker data 24 months", D79: the daily apply_retention gives a
-- candidate who has been inactive for the period of inactive_worker_data a deletion request, and the account-closure
-- pipeline erases the account after the cooling-off period. Activity is a sign-in, a session refresh, an application or a
-- stage change of an application; a legal hold, an employer account and a missing row keep the data.
begin;
select plan(17);

\ir status_fixture.inc

\set idle '00000000-0000-0000-0000-00000000b301'
\set signed '00000000-0000-0000-0000-00000000b302'
\set session '00000000-0000-0000-0000-00000000b303'
\set held '00000000-0000-0000-0000-00000000b304'

select pg_temp.new_user(:'idle', 'worker');
select pg_temp.new_user(:'signed', 'worker');
select pg_temp.new_user(:'session', 'worker');
select pg_temp.new_user(:'held', 'worker');
update public.profiles set account_kind = intended_account_kind where id in (:'idle', :'signed', :'session', :'held');

-- Every account below is 800 days old and last signed in 750 days ago, except where a case says otherwise. wa applied
-- today; wb applied long ago, but the employer moved the application today.
select pg_temp.seed_app('applied', null, :'wa') as wa_app \gset
select pg_temp.seed_app('applied', null, :'wb') as wb_app \gset
update public.job_applications set created_at = now() - interval '800 days' where id = :'wb_app';
update public.profiles set created_at = now() - interval '800 days' where id in (:'idle', :'signed', :'session', :'held', :'wa', :'wb', :'own1');
update auth.users set created_at = now() - interval '800 days', last_sign_in_at = now() - interval '750 days'
where id in (:'idle', :'signed', :'session', :'held', :'wa', :'wb', :'own1');
update auth.users set last_sign_in_at = now() - interval '10 days' where id = :'signed';
insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at)
values (gen_random_uuid(), :'session', now() - interval '760 days', now() - interval '760 days', (now() - interval '5 days') at time zone 'UTC');
select set_config('chara.audit_reason', 'Ticket 104: dispute', true) as reason \gset
update public.profiles set legal_hold = true where id = :'held';

select private.apply_retention();

select results_eq(
  $$select id::text from public.profiles where deleted_at is not null order by id$$,
  $$values ('00000000-0000-0000-0000-00000000b301')$$,
  'only the candidate without any activity for 730 days gets a deletion request'
);
select is((select deleted_at::date from public.profiles where id = :'idle'), current_date, 'requested today');
select is(
  (select format('%s|%s|%s', count(*), max(metadata ->> 'reason'), max(metadata ->> 'days')) from audit.log
   where action = 'account.deletion_requested' and entity_id = :'idle' and actor_id is null),
  '1|inactivity|730', 'the request is audited with its reason and period, without an actor'
);
select is(
  (select format('%s|%s', metadata ->> 'days', metadata ->> 'removed') from audit.log where action = 'retention.run' and entity_id = 'inactive_worker_data'),
  '730|1', 'and the run is audited with its period and count'
);
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'idle'), 0::bigint,
  'no email says the candidate asked for it'
);
select is((select deleted_at from public.profiles where id = :'signed'), null, 'a candidate who signed in 10 days ago is kept');
select is((select deleted_at from public.profiles where id = :'session'), null, 'so is one whose session was refreshed 5 days ago');
select is((select deleted_at from public.profiles where id = :'wa'), null, 'one who applied today');
select is((select deleted_at from public.profiles where id = :'wb'), null, 'one whose old application moved today');
select is((select deleted_at from public.profiles where id = :'held'), null, 'one under a legal hold');
select is((select deleted_at from public.profiles where id = :'own1'), null, 'and an inactive employer account, which this rule does not cover');

-- Idempotent; a missing row keeps the data.
select private.apply_retention();
select is(
  (select count(*) from audit.log where action = 'account.deletion_requested' and entity_id = :'idle'), 1::bigint,
  'a second run asks nothing again'
);
delete from private.retention_policies where entity = 'inactive_worker_data';
update auth.users set last_sign_in_at = now() - interval '750 days' where id = :'signed';
select private.apply_retention();
select is((select deleted_at from public.profiles where id = :'signed'), null, 'without the row an inactive candidate is kept');

-- After the cooling-off period the existing pipeline queues the erasure.
update public.profiles set deleted_at = now() - interval '31 days' where id = :'idle';
select private.queue_account_erasures() as queued \gset
select is(
  (select count(*) from pgmq.q_account_ops where message ->> 'action' = 'erase_user' and message ->> 'user_id' = :'idle'), 1::bigint,
  'the daily erasure job queues the erasure of the inactive candidate'
);

select ok(
  not has_function_privilege('anon', 'private.request_inactive_erasures(integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.request_inactive_erasures(integer)', 'execute')
  and not has_function_privilege('service_role', 'private.request_inactive_erasures(integer)', 'execute'),
  'no API role can request the erasures'
);
select is(
  (select proconfig from pg_proc where oid = 'private.request_inactive_erasures(integer)'::regprocedure), array['search_path=""'],
  'the function sets search_path to empty'
);
select has_index('public', 'profiles', 'profiles_worker_created_at_idx', 'the selection starts from an index of the oldest candidates');

select * from finish();
rollback;
