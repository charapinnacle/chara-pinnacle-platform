begin;
select plan(30);

\ir status_fixture.inc

insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (current_setting('t.a')::uuid, 'employer_starter', 'active', 'null');

-- FR-D2 AC1: every pair of current state and target state (8 x 8), each on a fresh application, by a member of the job's
-- organisation on a plan with shortlisting. Thirteen moves are listed; the other 51 are refused.
create temp table t_expected (from_s text, to_s text);
insert into t_expected values
  ('applied', 'shortlisted'), ('applied', 'interview'), ('applied', 'rejected'),
  ('viewed', 'shortlisted'), ('viewed', 'interview'), ('viewed', 'rejected'),
  ('shortlisted', 'interview'), ('shortlisted', 'offer'), ('shortlisted', 'rejected'),
  ('interview', 'offer'), ('interview', 'rejected'),
  ('offer', 'hired'), ('offer', 'rejected');
create temp table t_states (s text primary key);
insert into t_states values ('applied'), ('viewed'), ('shortlisted'), ('interview'), ('offer'), ('hired'), ('rejected'), ('withdrawn');
create temp table t_pairs as
  select f.s as from_s, t.s as to_s, pg_temp.seed_app(f.s) as single_app, pg_temp.seed_app(f.s) as bulk_app
  from t_states f cross join t_states t;
create temp table t_before as select pg_temp.status_counts() as c, (select count(*) from public.application_events) as events;

create temp table t_single as
  select p.from_s, p.to_s, p.single_app, pg_temp.set_as(:'mem', p.single_app, p.to_s, 'Note ' || p.to_s) as result from t_pairs p;
select is((select count(*) from t_pairs), 64::bigint, 'AC1: the grid has 64 pairs');
select is(
  (select string_agg(from_s || '>' || to_s, ',' order by from_s, to_s) from t_single where result = 'ok'),
  (select string_agg(from_s || '>' || to_s, ',' order by from_s, to_s) from t_expected),
  'AC1: exactly the 13 listed moves succeed through set_application_status'
);
select is(
  (select count(*) from t_single s where result <> 'ok' and result <> 'P0001|CHARA_INVALID_TRANSITION|' || from_s || ' to ' || to_s),
  0::bigint, 'AC1: the other 51 pairs are refused with CHARA_INVALID_TRANSITION, the detail naming both states'
);
select is(
  (select count(*) from t_single s where result <> 'ok' and pg_temp.status_of(single_app) <> from_s),
  0::bigint, 'AC1: a refused pair leaves the status as it was'
);
select is(
  (select count(*) from t_single s where result = 'ok' and pg_temp.status_of(single_app) <> to_s),
  0::bigint, 'AC1: an accepted pair has the new status'
);
select is(
  (select count(*) from public.application_events where application_id in (select single_app from t_single where result <> 'ok') and from_status is not null),
  0::bigint, 'AC1: a refused pair wrote no event'
);
select is(
  (select count(*) from t_single s where result = 'ok' and (select count(*) from public.application_events e
     where e.application_id = s.single_app and e.from_status = s.from_s::public.application_status and e.to_status = s.to_s::public.application_status
       and e.actor_id = :'mem' and e.note = 'Note ' || s.to_s and e.created_at <= now()) = 1),
  13::bigint, 'AC1: an accepted pair wrote one event with the actor, both states, the note and the time'
);
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'application_id' in (select single_app::text from t_single where result <> 'ok')),
  0::bigint, 'AC1: a refused pair queued no notification'
);
select is(
  (select count(*) from public.passport_shares s where s.application_id in (select single_app from t_single where result <> 'ok') and s.expires_at is not null),
  0::bigint, 'AC1: a refused pair left the shares as they were'
);

-- The same moves through bulk_set_application_status, per application (a target of applied, viewed or withdrawn is no
-- target for a bulk call at all).
create temp table t_bulk as
  select p.from_s, p.to_s, p.bulk_app,
         pg_temp.bulk_as(:'mem', array[p.bulk_app], p.to_s, 'Note ' || p.to_s) as result
  from t_pairs p where p.to_s not in ('applied', 'viewed', 'withdrawn');
select is(
  (select string_agg(from_s || '>' || to_s, ',' order by from_s, to_s) from t_bulk where result -> 0 ->> 'ok' = 'true'),
  (select string_agg(from_s || '>' || to_s, ',' order by from_s, to_s) from t_expected),
  'AC1: exactly the 13 listed moves succeed through bulk_set_application_status'
);
select is(
  (select count(*) from t_bulk where result -> 0 ->> 'ok' = 'false' and result -> 0 ->> 'error_code' <> 'CHARA_INVALID_TRANSITION'),
  0::bigint, 'AC1: every refused bulk item is CHARA_INVALID_TRANSITION'
);
select is(
  (select count(*) from t_bulk b where result -> 0 ->> 'ok' = 'false' and pg_temp.status_of(bulk_app) <> from_s),
  0::bigint, 'AC1: a refused bulk item leaves the status as it was'
);
select is(
  (select count(*) from public.application_events) - (select events from t_before), 26::bigint,
  'AC1: 13 + 13 accepted moves wrote 26 events in all, the refused ones none'
);
select is(
  pg_temp.bulk_as(:'mem', array[(select bulk_app from t_pairs where from_s = 'applied' limit 1)], 'viewed'),
  to_jsonb('P0001|CHARA_INVALID_INPUT|p_status'::text), 'AC1: viewed is no bulk target'
);

-- FR-D2 AC2: Viewed is the system's move, on the first open only.
create temp table t_open as select pg_temp.seed_app('applied') as id;
select set_config('t.open', (select id::text from t_open), true) as keep \gset
create temp table t_before2 as select pg_temp.status_counts() as c;
select is(pg_temp.set_as(:'own1', current_setting('t.open')::uuid, 'viewed'), 'P0001|CHARA_INVALID_TRANSITION|applied to viewed', 'AC2: an owner cannot select Viewed');
select is(pg_temp.set_as(:'adm', current_setting('t.open')::uuid, 'viewed'), 'P0001|CHARA_INVALID_TRANSITION|applied to viewed', 'AC2: an admin cannot select Viewed');
select is(pg_temp.set_as(:'mem', current_setting('t.open')::uuid, 'viewed'), 'P0001|CHARA_INVALID_TRANSITION|applied to viewed', 'AC2: a member cannot select Viewed');
select is(pg_temp.viewed_as(:'wa', current_setting('t.open')::uuid), 'P0001|CHARA_FORBIDDEN|company_account_required', 'AC2: the candidate cannot mark an application viewed');
select is(pg_temp.status_counts(), (select c from t_before2), 'AC2: the refused calls changed nothing');
select is(pg_temp.viewed_as(:'own1', current_setting('t.open')::uuid), 'ok', 'AC2: the first open by a member succeeds');
select is(pg_temp.status_of(current_setting('t.open')::uuid), 'viewed', 'AC2: the application is Viewed');
select is(
  (select count(*) from public.application_events e where e.application_id = current_setting('t.open')::uuid
     and e.from_status = 'applied' and e.to_status = 'viewed' and e.actor_id is null and e.note is null),
  1::bigint, 'AC2: one event applied to viewed with no actor'
);
select is(pg_temp.queued_for(current_setting('t.open')::uuid), 0::bigint, 'AC2: no status_changed message for a move to Viewed');
select is(pg_temp.viewed_as(:'adm', current_setting('t.open')::uuid), 'ok', 'AC2: a second open is no error');
select is(pg_temp.event_count(current_setting('t.open')::uuid), 2::bigint, 'AC2: a second open wrote no event');
create temp table t_short as select pg_temp.seed_app('shortlisted') as id;
select pg_temp.viewed_as(:'mem', (select id from t_short)) as opened \gset
select is(pg_temp.status_of((select id from t_short)) || pg_temp.event_count((select id from t_short)), 'shortlisted1', 'AC2: opening a shortlisted application changes nothing');

select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select public.set_application_status(%L, null)$$, current_setting('t.open')::uuid), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|p_status', 'a null target is CHARA_INVALID_INPUT, not an internal error'
);

-- The trigger judges every change of status, whoever makes it: the database owner needs the name of a function that may
-- make it, and Withdrawn is the candidate's function only.
create temp table t_guard as select pg_temp.seed_app('applied') as id, pg_temp.seed_app('hired') as final_id;
select throws_ok(
  format($$update public.job_applications set status = 'hired' where id = %L$$, (select id from t_guard)),
  'P0001', 'CHARA_INVALID_TRANSITION', 'a direct update by the table owner is refused'
);
select set_config('chara.actor_fn', 'withdraw_application', true) as keep \gset
select lives_ok(
  format($$update public.job_applications set status = 'withdrawn' where id = %L$$, (select id from t_guard)),
  'the withdraw function may move a non-final application to Withdrawn'
);
select throws_ok(
  format($$update public.job_applications set status = 'withdrawn' where id = %L$$, (select final_id from t_guard)),
  'P0001', 'CHARA_INVALID_TRANSITION', 'a final state has no way out, not even to Withdrawn'
);
select set_config('chara.actor_fn', '', true) as keep \gset

select * from finish();
rollback;
