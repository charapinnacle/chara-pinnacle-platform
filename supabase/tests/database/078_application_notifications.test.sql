begin;
select plan(77);

\ir status_fixture.inc

create function pg_temp.keys(p_payload jsonb) returns text[]
language sql as $$ select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_payload) k $$;
create function pg_temp.held(p_user uuid) returns bigint
language sql as $$
  select count(*) from public.notifications where user_id = p_user and kind = 'application_received' and status = 'queued' and msg_id is null
$$;
create function pg_temp.summaries(p_user uuid) returns bigint
language sql as $$
  select count(*) from public.notifications where user_id = p_user and kind = 'application_received' and payload ? 'vacancies'
$$;
create function pg_temp.immediate(p_user uuid) returns bigint
language sql as $$
  select count(*) from public.notifications where user_id = p_user and kind = 'application_received' and not payload ? 'vacancies' and msg_id is not null
$$;

-- FR-D6 AC1 is asserted by 076 (FR-I2 AC1). Here: the daily summary of AC2 to AC4, the payloads of AC6 and the choice of AC12.
-- Owner and admin are immediate (a row with digest false, no row), the member chose the daily summary.
insert into public.notification_preferences (user_id, digest) values (:'own1', false), (:'mem', true);
create temp table t_v as
  select pg_temp.open_job('Welder MIG/MAG') as v1, pg_temp.open_job('Pipe fitter') as v2;
select is(pg_temp.apply_as(:'wa', (select v1 from t_v)), 'ok', 'AC2: Amina applies to V1');
select is(pg_temp.apply_as(:'wb', (select v1 from t_v)), 'ok', 'AC2: Bruno applies to V1');
select is(pg_temp.apply_as(:'wa', (select v2 from t_v)), 'ok', 'AC2: Amina applies to V2');

select is(
  (select array_agg(pg_temp.immediate(u) order by u) from unnest(array[:'own1', :'adm']::uuid[]) u), array[3, 3]::bigint[],
  'AC2: at submission the owner and the admin get an immediate row for each of the three applications'
);
select is(pg_temp.immediate(:'mem'), 0::bigint, 'AC2: and the member gets none');
select is(pg_temp.held(:'mem'), 3::bigint, 'AC2: the three applications wait for the summary, as rows without a message');
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'mem'), 0::bigint, 'AC2: and no message is queued for the member'
);

-- AC3: the hour in Berlin decides; the same Berlin date never sends twice.
select is(private.enqueue_daily_summaries('2026-01-15 06:00:00+00'), 0, 'AC2: nothing is sent at 07:00 in Berlin');
select is(pg_temp.held(:'mem'), 3::bigint, 'AC2: the applications are still held');
select is(private.enqueue_daily_summaries('2026-01-15 07:00:00+00'), 1, 'AC2: at 08:00 in Berlin one summary is queued');
select is(pg_temp.summaries(:'mem'), 1::bigint, 'AC2: one summary row for the member');
select is(
  (select row(kind, status, msg_id is not null, sent_at is null)::text from public.notifications where user_id = :'mem' and payload ? 'vacancies'),
  '(application_received,queued,t,t)', 'AC2: it is a queued application_received with a message'
);
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'mem'), 1::bigint, 'AC2: with exactly one message'
);
select is(
  (select pg_temp.keys(payload) from public.notifications where user_id = :'mem' and payload ? 'vacancies'), array['total', 'vacancies'],
  'AC2: the payload holds the total and the vacancies and nothing else'
);
select is(
  (select (payload ->> 'total')::int from public.notifications where user_id = :'mem' and payload ? 'vacancies'), 3, 'AC2: the total is 3'
);
select is(
  (select jsonb_agg(jsonb_build_object('title', v ->> 'job_title', 'count', (v ->> 'count')::int, 'org', v ->> 'org_name') order by v ->> 'job_title')
   from public.notifications n, jsonb_array_elements(n.payload -> 'vacancies') v where n.user_id = :'mem' and n.payload ? 'vacancies'),
  '[{"org": "Acme Bau", "title": "Pipe fitter", "count": 1}, {"org": "Acme Bau", "title": "Welder MIG/MAG", "count": 2}]'::jsonb,
  'AC2: with the count per vacancy and the organisation'
);
select is(
  (select pg_temp.keys(v) from public.notifications n, jsonb_array_elements(n.payload -> 'vacancies') v where n.user_id = :'mem' limit 1),
  array['count', 'job_id', 'job_title', 'org_name', 'org_slug'], 'AC2: each vacancy has the keys the links and the lines need'
);
select is(
  (select count(*) from public.notifications where user_id = :'mem' and status = 'summarised'), 3::bigint,
  'AC2: the three held rows are marked summarised'
);
select is(private.enqueue_daily_summaries('2026-01-15 07:30:00+00'), 0, 'AC2: a second run on the same Berlin date queues nothing');
select is(pg_temp.summaries(:'mem'), 1::bigint, 'AC2: and creates no row');
select is(private.enqueue_daily_summaries('2026-01-16 07:00:00+00'), 0, 'AC2: a run with no new application queues nothing');
select is(
  (select array_agg(pg_temp.summaries(u) order by u) from unnest(array[:'own1', :'adm']::uuid[]) u), array[0, 0]::bigint[],
  'AC2: the owner and the admin never get a summary'
);

-- The applications are not repeated the next day; a new one is the only item.
select is(pg_temp.apply_as(:'wb', (select v2 from t_v)), 'ok', 'AC2: a new application arrives');
select is(pg_temp.held(:'mem'), 1::bigint, 'AC2: and is held');
select is(private.enqueue_daily_summaries('2026-01-17 07:00:00+00'), 1, 'AC2: the next summary is queued');
select is(
  (select payload ->> 'total' from public.notifications where user_id = :'mem' and payload ? 'vacancies' order by msg_id desc limit 1),
  '1', 'AC2: it holds only the new application'
);

-- AC3 of FR-D6: the eight times, the clocks changing on 29 March and 25 October 2026.
create function pg_temp.run_at(p_now timestamptz) returns integer
language plpgsql as $$
begin
  delete from public.notifications where user_id = current_setting('t.mem')::uuid and msg_id is null and status = 'queued';
  insert into public.notifications (user_id, kind, payload)
  values (current_setting('t.mem')::uuid, 'application_received', jsonb_build_object('application_id', current_setting('t.app')));
  return private.enqueue_daily_summaries(p_now);
end;
$$;
select set_config('t.mem', :'mem', true);
select is(pg_temp.run_at('2026-01-15 07:00:00+00'), 1, 'AC3: 07:00 UTC in winter (08:00 CET) sends');
select is(pg_temp.run_at('2026-01-15 06:00:00+00'), 0, 'AC3: 06:00 UTC in winter does not');
select is(pg_temp.run_at('2026-07-15 06:00:00+00'), 1, 'AC3: 06:00 UTC in summer (08:00 CEST) sends');
select is(pg_temp.run_at('2026-07-15 07:00:00+00'), 0, 'AC3: 07:00 UTC in summer does not');
select is(pg_temp.run_at('2026-03-29 06:00:00+00'), 1, 'AC3: 06:00 UTC on the day the clocks go forward sends');
select is(pg_temp.run_at('2026-03-29 07:00:00+00'), 0, 'AC3: 07:00 UTC on that day does not');
select is(pg_temp.run_at('2026-10-25 07:00:00+00'), 1, 'AC3: 07:00 UTC on the day the clocks go back sends');
select is(pg_temp.run_at('2026-10-25 06:00:00+00'), 0, 'AC3: 06:00 UTC on that day does not');
select is(
  (select count(*) from generate_series('2026-03-29 00:00:00+00'::timestamptz, '2026-03-29 23:00:00+00', interval '1 hour') h
   where extract(hour from (h at time zone 'Europe/Berlin')) = 8),
  1::bigint, 'AC3: one hourly run of the day the clocks go forward falls in the eighth hour in Berlin'
);
select is(
  (select count(*) from generate_series('2026-10-25 00:00:00+00'::timestamptz, '2026-10-25 23:00:00+00', interval '1 hour') h
   where extract(hour from (h at time zone 'Europe/Berlin')) = 8),
  1::bigint, 'AC3: and so does the day the clocks go back'
);
select is(
  (select schedule from cron.job where jobname = 'notify-daily-summary'), '0 * * * *', 'AC3: the job runs at every full hour in UTC'
);

-- Held applications of an organisation the member has left are not sent; a member of two organisations gets one summary.
delete from public.notifications where user_id = :'mem' and msg_id is null and status = 'queued';
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (current_setting('t.a')::uuid, :'adm2', 'member', now());
insert into public.notification_preferences (user_id, digest) values (:'adm2', true);
create temp table t_b as select pg_temp.open_job('Beta electrician', current_setting('t.b')::uuid) as v;
select is(pg_temp.apply_as(:'wb', (select v from t_b)), 'ok', 'a candidate applies to a vacancy of Beta');
select is(pg_temp.held(:'adm2'), 1::bigint, 'one application of Beta is held for the member of both organisations');
insert into public.notifications (user_id, kind, payload)
select :'adm2', 'application_received', jsonb_build_object('application_id', a.id::text)
from public.job_applications a where a.job_id = (select v1 from t_v) limit 1;
select is(pg_temp.held(:'adm2'), 2::bigint, 'and one of Acme');
select is(private.enqueue_daily_summaries('2026-02-02 07:00:00+00'), 1, 'AC7: one summary is queued for the member of both');
select is(
  (select array_agg(v ->> 'org_slug' order by v ->> 'org_slug') from public.notifications n, jsonb_array_elements(n.payload -> 'vacancies') v
   where n.user_id = :'adm2' and n.payload ? 'vacancies'),
  (select array_agg(slug order by slug) from public.organizations where id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid)),
  'AC7: it lists a vacancy of each organisation with its slug'
);

create temp table t_left as select pg_temp.seed_app('applied') as app;
insert into public.notification_preferences (user_id, digest) values (:'pending', true);
insert into public.notifications (user_id, kind, payload)
values (:'pending', 'application_received', jsonb_build_object('application_id', (select app from t_left)::text));
select is(private.enqueue_daily_summaries('2026-02-03 07:00:00+00'), 0, 'a member whose invitation is not accepted gets no summary');
select is(
  (select status from public.notifications where user_id = :'pending'), 'summarised', 'and the held row is marked, not kept for ever'
);
select is(
  has_function_privilege('authenticated', 'private.enqueue_daily_summaries(timestamptz)', 'execute')
  or has_function_privilege('anon', 'private.enqueue_daily_summaries(timestamptz)', 'execute')
  or has_function_privilege('service_role', 'private.enqueue_daily_summaries(timestamptz)', 'execute'), false,
  'no API role executes the summary job'
);

-- Only the 20 vacancies with most applications are listed; the total counts all.
delete from public.notifications where user_id = :'adm2';
insert into public.notifications (user_id, kind, payload)
select :'adm2', 'application_received', jsonb_build_object('application_id', pg_temp.seed_app('applied')::text) from generate_series(1, 22);
select is(private.enqueue_daily_summaries('2026-02-04 07:00:00+00'), 1, 'a summary of 22 vacancies is queued');
select is(
  (select row(payload ->> 'total', jsonb_array_length(payload -> 'vacancies'))::text from public.notifications where user_id = :'adm2' and payload ? 'vacancies'),
  '(22,20)', 'it lists 20 vacancies and states the total of 22'
);

-- AC4: a candidate gets a status email whatever a preference row says; Viewed and employers get none.
insert into public.notification_preferences (user_id, digest) values (:'wa', true);
create temp table t_s as select pg_temp.seed_app('applied') as a, pg_temp.seed_app('applied') as b;
select is(pg_temp.viewed_as(:'mem', (select a from t_s)), 'ok', 'AC4: the application is opened');
select is(pg_temp.set_as(:'mem', (select a from t_s), 'shortlisted'), 'ok', 'AC4: then shortlisted');
select is(pg_temp.call_as(:'wa', 'authenticated', format('select public.withdraw_application(%L)', (select b from t_s)), 'aal1'), 'ok', 'AC4: the other is withdrawn');
select is(
  (select count(*) from public.notifications n join pgmq.q_notifications q on q.msg_id = n.msg_id
   where n.kind = 'status_changed' and n.user_id = :'wa' and n.status = 'queued' and n.payload ->> 'application_id' in ((select a::text from t_s), (select b::text from t_s))),
  2::bigint, 'AC4: a candidate with digest true has one queued row and one message for each, none for Viewed'
);
select is(
  (select count(*) from public.notifications where kind = 'status_changed' and user_id in (:'own1', :'adm', :'mem')), 0::bigint,
  'AC4: no employer gets one'
);

-- AC6: the payloads hold ids, titles and names of the organisation, and nothing the candidate or the employer wrote.
update public.worker_profiles set first_name = 'Amina', last_name = 'Test' where user_id = :'wb';
select pg_temp.doc(:'d1', :'wb');
update public.worker_documents set title = 'passport-scan.pdf' where id = :'d1';
create temp table t_p as select pg_temp.open_job('Payload vacancy') as v;
select is(pg_temp.apply_as(:'wb', (select v from t_p), 'SECRETNOTE', array[:'d1']::uuid[]), 'ok', 'AC6: a candidate applies with a cover note');
create temp table t_p_app as select current_setting('t.app')::uuid as id;
select is(pg_temp.set_as(:'mem', (select id from t_p_app), 'rejected', 'DECLINEREASON'), 'ok', 'AC6: and is declined with a reason');
select is(
  (select pg_temp.keys(payload) from public.notifications where user_id = :'own1' and payload ->> 'application_id' = (select id::text from t_p_app)),
  array['application_id', 'job_title', 'org_name', 'org_slug'], 'AC6: application_received has exactly the application, the title, the organisation name and its slug'
);
select is(
  (select pg_temp.keys(payload) from public.notifications where kind = 'status_changed' and payload ->> 'application_id' = (select id::text from t_p_app)),
  array['application_id', 'job_title', 'org_name', 'status'], 'AC6: status_changed has exactly the application, the title, the organisation name and the status'
);
select is(
  (select payload ->> 'org_name' from public.notifications where kind = 'status_changed' and payload ->> 'application_id' = (select id::text from t_p_app)),
  (select display_name from public.organizations where id = current_setting('t.a')::uuid), 'AC6: the organisation name is the display name'
);
select is(
  (select payload ->> 'status' from public.notifications where kind = 'status_changed' and payload ->> 'application_id' = (select id::text from t_p_app)),
  'rejected', 'AC6: and the status is the value, which the template maps to its label'
);
select is(
  (select count(*) from public.notifications n where n.payload::text ~* 'SECRETNOTE|DECLINEREASON|passport-scan|Amina Test'
     or (select count(*) from pgmq.q_notifications q where q.msg_id = n.msg_id and q.message::text ~* 'SECRETNOTE|DECLINEREASON|passport-scan') > 0),
  0::bigint, 'AC6: none of the four strings is in a payload or a message'
);

-- AC12 and FR-I3: the choice is the member's own, through one function.
create temp table t_audit_before as select count(*) as n from audit.log where action = 'notification_preferences.changed';
delete from public.notification_preferences where user_id in (:'own1', :'adm');
select is(pg_temp.call_as(:'adm', 'authenticated', 'select public.set_notification_preferences(true)', 'aal1'), 'ok', 'AC12: a member saves the daily summary');
select is(
  (select row(count(*), bool_and(digest))::text from public.notification_preferences where user_id = :'adm'), '(1,t)', 'AC12: one row exists with the choice'
);
select is(pg_temp.call_as(:'adm', 'authenticated', 'select public.set_notification_preferences(true)', 'aal1'), 'ok', 'AC12: saving it again is not an error');
select is(pg_temp.call_as(:'adm', 'authenticated', 'select public.set_notification_preferences(false)', 'aal1'), 'ok', 'AC12: then the member switches back');
select is(
  (select row(count(*), bool_and(not digest))::text from public.notification_preferences where user_id = :'adm'), '(1,t)',
  'AC12: still one row, now immediate'
);
select is(
  (select count(*) - (select n from t_audit_before) from audit.log where action = 'notification_preferences.changed'), 2::bigint,
  'AC12: two audit rows, none for the unchanged save'
);
select is(
  (select metadata::text from audit.log where action = 'notification_preferences.changed' and actor_id = :'adm' order by id limit 1),
  '{"to": "daily_summary", "from": "immediate"}', 'AC12: with the old and the new value'
);
select is(
  (select row(entity_type, entity_id)::text from audit.log where action = 'notification_preferences.changed' and actor_id = :'adm' limit 1),
  format('(notification_preferences,%s)', :'adm'), 'AC12: and the preferences of the member as the entity'
);
select is(pg_temp.call_as(:'own1', 'authenticated', 'select public.set_notification_preferences(false)', 'aal1'), 'ok', 'AC12: keeping the default is accepted');
select is(
  (select count(*) from public.notification_preferences where user_id = :'own1'), 0::bigint, 'AC12: and creates no row and no audit entry'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', 'select public.set_notification_preferences(null)', 'aal1'), 'P0001|CHARA_INVALID_INPUT|p_digest',
  'AC12: a missing value is refused'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', 'select public.set_notification_preferences(true)', 'aal1'), 'P0001|CHARA_FORBIDDEN|company_account_required',
  'AC12: a candidate has no choice'
);
select is(
  (select digest::text from public.notification_preferences where user_id = :'wa'), 'true', 'AC12: and what was stored for the candidate before is not changed by the call'
);
select is(
  pg_temp.call_as(null, 'anon', 'select public.set_notification_preferences(true)'), '42501|permission denied for function set_notification_preferences|',
  'AC12: anonymous is refused'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$update public.notification_preferences set email_undeliverable_at = now() where user_id = %L$$, :'adm'), 'aal1'),
  '42501|permission denied for table notification_preferences|', 'AC12: email_undeliverable_at cannot be written by the member'
);
insert into public.notification_preferences (user_id, digest) values (:'own1', true);
select is(pg_temp.call_as(:'adm', 'authenticated', 'select public.set_notification_preferences(true)', 'aal1'), 'ok', 'AC12: the member saves again');
select is(
  (select digest::text from public.notification_preferences where user_id = :'own1'), 'true', 'AC12: the row of another owner is not touched'
);
select is(
  pg_temp.val_as(:'adm', 'aal1', format($$select count(*)::text from public.notification_preferences where user_id = %L$$, :'own1')), '0',
  'AC12: and cannot be read by another member'
);

select * from finish();
rollback;
