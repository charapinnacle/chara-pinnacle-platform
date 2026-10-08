begin;
select plan(23);

\ir status_fixture.inc

create function pg_temp.immediate(p_user uuid) returns bigint
language sql as $$
  select count(*) from public.notifications n
  where n.user_id = p_user and n.kind = 'application_received' and not n.payload ? 'vacancies' and n.msg_id is not null
$$;
create function pg_temp.held(p_user uuid) returns bigint
language sql as $$
  select count(*) from public.notifications where user_id = p_user and kind = 'application_received' and status = 'queued' and msg_id is null
$$;

-- AC1: no row (adm), digest false (own1) and digest true (mem) are members of one organisation.
insert into public.notification_preferences (user_id, digest) values (:'own1', false), (:'mem', true);
create temp table t_job as select pg_temp.open_job('Welder MIG/MAG') as id;
select is(pg_temp.apply_as(:'wa', (select id from t_job)), 'ok', 'AC1: the first application is made');
select is(pg_temp.apply_as(:'wb', (select id from t_job)), 'ok', 'AC1: and the second');
select is(
  (select array_agg(pg_temp.immediate(u) order by u) from unnest(array[:'adm', :'own1']::uuid[]) u), array[2, 2]::bigint[],
  'AC1: without a row and with digest false there are two rows with a message each'
);
select is(
  (select array_agg((select count(*) from pgmq.q_notifications where message ->> 'user_id' = u) order by u)
   from unnest(array[:'adm', :'own1']) u),
  array[2, 2]::bigint[], 'AC1: and two messages wait in the queue for each of them'
);
select is(
  (select count(*) from public.notifications n join pgmq.q_notifications q on q.msg_id = n.msg_id
   where n.user_id in (:'adm', :'own1') and n.kind = 'application_received'),
  4::bigint, 'AC1: each of those four rows points at its own message'
);
select is(pg_temp.immediate(:'mem'), 0::bigint, 'AC1: with digest true there is no row with a message');
select is(pg_temp.held(:'mem'), 2::bigint, 'AC1: both applications are held for the summary');
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'mem'), 0::bigint, 'AC1: and no message waits for that member'
);

-- AC4: the 24 hourly runs of the two clock-change days and of a summer and a winter day; each held row is new, so only the hour decides.
create function pg_temp.run_at(p_now timestamptz) returns integer
language plpgsql as $$
begin
  insert into public.notifications (user_id, kind, payload)
  values (current_setting('t.mem')::uuid, 'application_received', jsonb_build_object('application_id', current_setting('t.app')));
  return private.enqueue_daily_summaries(p_now);
end;
$$;
select set_config('t.mem', :'mem', true);
create temp table t_sweep as
  select d, h, pg_temp.run_at((d || ' 00:00:00+00')::timestamptz + h * interval '1 hour') as sent
  from unnest(array['2026-03-29', '2026-10-25', '2026-06-15', '2026-12-15']) d, generate_series(0, 23) h;
select is(
  (select array_agg(d || '=' || n order by d) from (select d, sum(sent) as n from t_sweep group by d) s),
  array['2026-03-29=1', '2026-06-15=1', '2026-10-25=1', '2026-12-15=1'], 'AC4: exactly one of the 24 runs of each day sends'
);
select is(
  (select array_agg(d || '@' || h order by d) from t_sweep where sent = 1),
  array['2026-03-29@6', '2026-06-15@6', '2026-10-25@7', '2026-12-15@7'],
  'AC4: it is UTC 06 in summer time and UTC 07 in winter time, on the change days as well'
);

-- AC12: the preference of one owner is out of reach of another owner and of a candidate; the other cases are in 076 and 078.
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$update public.notification_preferences set digest = false where user_id = %L$$, :'mem'), 'aal1'),
  '42501|permission denied for table notification_preferences|', 'AC12: a member cannot update the row of another member'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$insert into public.notification_preferences (user_id, digest) values (%L, true)$$, :'own2'), 'aal1'),
  '42501|permission denied for table notification_preferences|', 'AC12: nor insert one for somebody else'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$delete from public.notification_preferences where user_id = %L$$, :'mem'), 'aal1'),
  '42501|permission denied for table notification_preferences|', 'AC12: nor delete it'
);
select is(
  (select digest::text from public.notification_preferences where user_id = :'mem'), 'true', 'AC12: the row of the member is unchanged'
);
select is(
  pg_temp.val_as(:'own1', 'aal1', format($$select count(*)::text from public.notification_preferences where user_id = %L$$, :'mem')), '0',
  'AC12: another owner of the organisation reads no row of the member'
);
select is(
  pg_temp.val_as(:'wb', 'aal1', format($$select count(*)::text from public.notification_preferences where user_id = %L$$, :'mem')), '0',
  'AC12: a candidate reads none either'
);
select is(
  (select count(*) from information_schema.role_column_grants
   where table_schema = 'public' and table_name = 'notification_preferences' and privilege_type in ('INSERT', 'UPDATE')
     and grantee in ('anon', 'authenticated', 'service_role', 'public')),
  0::bigint, 'AC12: no API role holds a write grant on any column of the table'
);
select is(
  (select bool_and(has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'notify_ack'),
  true, 'AC12: the function that writes email_undeliverable_at is granted to service_role'
);
select is(
  (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'notify_ack' and has_function_privilege('authenticated', p.oid, 'execute')),
  0::bigint, 'AC12: and not to a signed-in user'
);

-- KPI: the share of employer users on the daily summary; the expression is that of section 8 of the transactional emails runbook.
delete from public.notification_preferences;
insert into public.notification_preferences (user_id, digest) values (:'own1', true), (:'adm', false), (:'mem', true);
select is(
  (select count(*) from public.profiles where account_kind = 'company'), 16::bigint, 'KPI: the fixture has sixteen employer users (the denominator)'
);
select is(
  (select count(*) from public.notification_preferences where digest)::numeric
    / nullif((select count(*) from public.profiles where account_kind = 'company'), 0),
  2::numeric / 16, 'KPI: two of sixteen employer users are on the daily summary; those without a row count as immediate'
);
select is(
  (select count(*) from public.notification_preferences where digest and user_id in (select id from public.profiles where account_kind = 'worker')), 0::bigint,
  'KPI: and no candidate is among them'
);
select is(
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'notification_preferences' and indexdef like '%(user_id)%'), 1::bigint,
  'the column of the read policy is indexed'
);

select * from finish();
rollback;
