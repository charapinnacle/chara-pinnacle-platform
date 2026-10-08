begin;
select plan(93);

\ir passport_fixture.inc

\set u1 '00000000-0000-0000-0000-00000000a501'
\set u2 '00000000-0000-0000-0000-00000000a502'
\set u3 '00000000-0000-0000-0000-00000000a503'
select pg_temp.new_user(:'u1', 'worker');
select pg_temp.new_user(:'u2', 'worker');
select pg_temp.new_user(:'u3', 'worker');
update public.profiles set account_kind = intended_account_kind where id in (:'u1', :'u2', :'u3');
update auth.users set email = 'one@example.test' where id = :'u1';

-- The messages of the earlier statements are not under test.
select pgmq.purge_queue('notifications');
delete from public.notifications;

create function pg_temp.dequeue(p_limit integer default 25) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  select public.notify_dequeue(p_limit) into v;
  reset role;
  return v;
end;
$$;
create function pg_temp.msgs(p_limit integer default 25) returns jsonb
language sql as $$ select pg_temp.dequeue(p_limit) -> 'messages' $$;

-- notify_ack as service_role: the boolean as text, or 'sqlstate|message|detail'.
create function pg_temp.ack(p_outcome text, p_id uuid default null, p_provider text default null, p_attempts integer default null, p_error text default null) returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  set local role service_role;
  begin
    select public.notify_ack(p_outcome, p_id, p_provider, p_attempts, p_error)::text into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  return v_result;
end;
$$;

create function pg_temp.queue(p_user uuid, p_kind text default 'mfa_reset') returns uuid
language plpgsql as $$
declare v_msg bigint;
begin
  v_msg := pgmq.send('notifications', jsonb_build_object('kind', p_kind, 'user_id', p_user));
  return (select id from public.notifications where msg_id = v_msg);
end;
$$;
create function pg_temp.make_visible() returns void
language sql as $$ update pgmq.q_notifications set vt = now() - interval '1 second' $$;
create function pg_temp.row_of(p_id uuid) returns text
language sql as $$ select row(status, attempts, provider_message_id, last_error, delivery, sent_at is not null)::text from public.notifications where id = p_id $$;

-- FR-I2 AC9: the queue, the visibility timeout and the acknowledgement.
select ok(
  not has_function_privilege('anon', 'public.notify_dequeue(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.notify_dequeue(integer)', 'execute')
  and has_function_privilege('service_role', 'public.notify_dequeue(integer)', 'execute'),
  'AC9: only service_role executes notify_dequeue'
);
select ok(
  not has_function_privilege('anon', 'public.notify_ack(text, uuid, text, integer, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.notify_ack(text, uuid, text, integer, text)', 'execute')
  and has_function_privilege('service_role', 'public.notify_ack(text, uuid, text, integer, text)', 'execute'),
  'AC9: and only service_role executes notify_ack'
);
select is(
  pg_temp.call_as(:'u1', 'authenticated', 'select public.notify_dequeue(10)'), '42501|permission denied for function notify_dequeue|',
  'AC9: an authenticated call is refused'
);
select is(
  pg_temp.call_as(null, 'anon', $$select public.notify_ack('sent', gen_random_uuid(), 'x')$$), '42501|permission denied for function notify_ack|',
  'AC9: so is an anonymous one'
);

create temp table t_n1 as select pg_temp.queue(:'u1') as id;
create temp table t_first as select pg_temp.dequeue() as r;
select is(
  (select r -> 'messages' -> 0 from t_first),
  jsonb_build_object('notification_id', (select id from t_n1), 'kind', 'mfa_reset', 'payload', '{}'::jsonb, 'recipient', 'one@example.test', 'attempt', 1),
  'AC9: the first call returns the message with the address of the recipient'
);
select is(
  (select r - 'messages' from t_first),
  '{"queue_depth": 0, "backlog_threshold": 500, "retry_delays": [2, 6, 18]}'::jsonb, 'AC9: with the queue depth and the settings of the function'
);
select is(pg_temp.msgs(), '[]'::jsonb, 'AC9: the second call returns nothing until the timeout ends');
select is(
  (select extract(epoch from q.vt - now())::integer between 110 and 120 from pgmq.q_notifications q), true, 'AC9: the timeout is the setting of 120 seconds'
);
select pg_temp.make_visible();
select is((pg_temp.msgs() -> 0 ->> 'attempt')::integer, 2, 'AC9: after the timeout the message returns, read a second time');
select is(pg_temp.row_of((select id from t_n1)), '(queued,0,,,,f)', 'AC9: reading changes nothing in the row');
select is(pg_temp.ack('sent', (select id from t_n1), 'prov-1', 2), 'true', 'AC9: the acknowledgement of a send records it');
select is(pg_temp.row_of((select id from t_n1)), '(sent,2,prov-1,,,t)', 'AC9: status, attempts, provider message id and the time are stored');
select is(
  (select row((select count(*) from pgmq.q_notifications), (select count(*) from pgmq.a_notifications))::text), '(0,1)',
  'AC9: the message is archived'
);
select pg_temp.make_visible();
select is(pg_temp.msgs(), '[]'::jsonb, 'AC9: and never returned again');
select is(pg_temp.ack('sent', (select id from t_n1), 'prov-other', 1), 'false', 'AC9: a repeated acknowledgement changes nothing');
select is(pg_temp.row_of((select id from t_n1)), '(sent,2,prov-1,,,t)', 'AC9: not even the provider message id');

-- A message whose row is already sent is archived without a new send.
create temp table t_n2 as select pg_temp.queue(:'u1') as id;
update public.notifications set status = 'sent', sent_at = now(), provider_message_id = 'prov-2' where id = (select id from t_n2);
select is(pg_temp.msgs(), '[]'::jsonb, 'AC9: a message whose row is already sent is not returned');
select is((select count(*) from pgmq.a_notifications), 2::bigint, 'AC9: it is archived');
select is((select count(*) from pgmq.q_notifications), 0::bigint, 'AC9: and leaves the queue');

-- A message without a row (written before the table existed) is dropped.
select pgmq.send('notifications', '{"kind": "mfa_reset", "user_id": "00000000-0000-0000-0000-00000000a501"}');
delete from public.notifications where msg_id = (select max(msg_id) from pgmq.q_notifications);
select is(pg_temp.msgs(), '[]'::jsonb, 'a message without a row is not returned');
select is((select count(*) from pgmq.q_notifications), 0::bigint, 'and is removed');

-- A failure: the error code and the attempts are stored, the message is archived and not returned again.
create temp table t_n3 as select pg_temp.queue(:'u2') as id;
select is(jsonb_array_length(pg_temp.msgs()), 1, 'a failing message is read');
select is(pg_temp.ack('failed', (select id from t_n3), null, 4, 'resend_http_500'), 'true', 'the failure is recorded');
select is(pg_temp.row_of((select id from t_n3)), '(failed,4,,resend_http_500,,f)', 'status failed with the attempts, the error code and no send time');
select is((select count(*) from pgmq.q_notifications), 0::bigint, 'and the message left the queue');
select is(pg_temp.ack('failed', (select id from t_n3), null, 1, 'again'), 'false', 'a repeat changes nothing');
select is(pg_temp.ack('sent', (select id from t_n3), 'late', 1), 'false', 'and a send recorded after the failure is ignored');

-- A rolled-back transaction leaves neither row nor message.
savepoint s1;
select pg_temp.queue(:'u3');
rollback to savepoint s1;
select is(
  (select count(*) from public.notifications where user_id = :'u3') + (select count(*) from pgmq.q_notifications), 0::bigint,
  'AC9: a rolled-back transaction that enqueued a notification leaves neither row nor message'
);

-- Inputs.
select is(pg_temp.ack('queued', (select id from t_n3)), 'P0001|CHARA_INVALID_INPUT|outcome', 'an unknown outcome is refused');
select is(pg_temp.ack('sent', null, 'x'), 'P0001|CHARA_INVALID_INPUT|notification', 'a send without a notification is refused');
select is(pg_temp.ack('sent', (select id from t_n3)), 'P0001|CHARA_INVALID_INPUT|notification', 'a send without a provider message id is refused');
select is(pg_temp.ack('delivered'), 'P0001|CHARA_INVALID_INPUT|notification', 'an event without any reference is refused');
select is(pg_temp.ack('sent', gen_random_uuid(), 'x'), 'P0002|CHARA_NOT_FOUND|', 'an unknown notification is not found');
select is(pg_temp.ack('delivered', null, 'prov-unknown'), 'P0002|CHARA_NOT_FOUND|', 'so is an event for an unknown provider message, which makes the provider send it again');

-- Reads beyond the limit are a crash loop: the message ends as failed.
update private.settings set value = '2' where key = 'notify_max_reads';
create temp table t_n4 as select pg_temp.queue(:'u2') as id;
select is(jsonb_array_length(pg_temp.msgs()), 1, 'read 1');
select pg_temp.make_visible();
select is(jsonb_array_length(pg_temp.msgs()), 1, 'read 2 at a limit of 2');
select pg_temp.make_visible();
select is(jsonb_array_length(pg_temp.msgs()), 0, 'read 3 is not returned');
select is(pg_temp.row_of((select id from t_n4)), '(failed,0,,abandoned,,f)', 'it is recorded as failed (abandoned)');
update private.settings set value = '8' where key = 'notify_max_reads';

-- A recipient without an address is recorded as failed.
create temp table t_n5 as select pg_temp.queue(:'u3') as id;
update auth.users set email = null where id = :'u3';
select is(pg_temp.msgs(), '[]'::jsonb, 'a recipient without an address is not returned');
select is(pg_temp.row_of((select id from t_n5)), '(failed,0,,no_recipient,,f)', 'it is recorded as failed (no_recipient)');
update auth.users set email = :'u3' || '@example.test' where id = :'u3';

-- The limit and the settings.
select pg_temp.queue(:'u1') from generate_series(1, 5);
select is(jsonb_array_length(pg_temp.msgs(2)), 2, 'the limit caps the batch');
select is((pg_temp.dequeue(1) ->> 'queue_depth')::integer, 2, 'the queue depth counts what still waits after the batch');
select is(jsonb_array_length(pg_temp.msgs(0)), 1, 'a limit below 1 reads one');
select is(jsonb_array_length(pg_temp.msgs(1000)), 1, 'a limit above 100 is capped (one message is left)');
delete from private.settings where key = 'notify_backlog_threshold';
select is(
  pg_temp.call_as(null, 'service_role', 'select public.notify_dequeue(1)'), 'P0001|CHARA_SETTING_MISSING|notify',
  'a missing setting fails the call'
);
insert into private.settings (key, value) values ('notify_backlog_threshold', '500');
select pgmq.purge_queue('notifications');
delete from public.notifications;

-- The completion of an erasure travels with its address: it is deleted, not archived, and no row holds it.
create temp table t_gone as select pgmq.send('notifications', '{"kind": "deletion_completed", "email": "gone@example.test"}') as msg;
select is(pg_temp.msgs() -> 0 ->> 'recipient', 'gone@example.test', 'the address of the message is the recipient');
select is(
  pg_temp.ack('sent', (select id from public.notifications where msg_id = (select msg from t_gone)), 'prov-gone', 1), 'true', 'the send is recorded'
);
select is((select count(*) from pgmq.a_notifications where message::text like '%gone@example.test%'), 0::bigint, 'the message is not archived');
select is((select count(*) from pgmq.q_notifications), 0::bigint, 'and not in the queue');
select is(
  (select count(*) from public.notifications n where to_jsonb(n)::text like '%gone@example.test%'), 0::bigint, 'and no row names the address'
);
select pgmq.purge_queue('notifications');
delete from public.notifications;

-- FR-I2 AC11: bounces and complaints.
create temp table t_ns as
  select pg_temp.queue(:'u1') as n1, pg_temp.queue(:'u2') as n2, pg_temp.queue(:'u3') as n3;
insert into public.notification_preferences (user_id, digest) values (:'u2', true);
select is(jsonb_array_length(pg_temp.msgs()), 3, 'three messages are read');
select is(pg_temp.ack('sent', (select n1 from t_ns), 'p1', 1), 'true', 'N1 is sent');
select is(pg_temp.ack('sent', (select n2 from t_ns), 'p2', 1), 'true', 'N2 is sent');
select is(pg_temp.ack('sent', (select n3 from t_ns), 'p3', 1), 'true', 'N3 is sent');
select is(pg_temp.ack('delivered', null, 'p3'), 'true', 'a delivery event is recorded by the provider message id');
select is(pg_temp.ack('delivered', null, 'p3'), 'false', 'a repeated event changes nothing');
select is(pg_temp.ack('bounced_permanent', null, 'p1'), 'true', 'a hard bounce for N1');
select is(pg_temp.ack('complained', (select n2 from t_ns)), 'true', 'a complaint for N2, found by its id');
select is(pg_temp.ack('bounced_transient', null, 'p3'), 'true', 'a transient bounce for N3');
select is(
  (select array_agg(delivery order by n.created_at, n.id) from public.notifications n where n.id in (select n1 from t_ns union select n2 from t_ns union select n3 from t_ns) and n.user_id = :'u1'),
  array['bounced_permanent'], 'each row shows its delivery result (N1)'
);
select is(
  (select delivery from public.notifications where id = (select n2 from t_ns)) || ',' || (select delivery from public.notifications where id = (select n3 from t_ns)),
  'complained,bounced_transient', 'N2 and N3'
);
select is(
  (select array_agg(user_id order by user_id) from public.notification_preferences where email_undeliverable_at is not null),
  array[:'u1', :'u2']::uuid[], 'the address is undeliverable for U1 and U2 only'
);
select is(
  (select digest from public.notification_preferences where user_id = :'u2'), true, 'the preference row that existed keeps its other fields; the missing one (U1) was created'
);
select is(
  (select count(*) from audit.log where action = 'notification.address_undeliverable' and entity_id in (:'u1', :'u2')), 2::bigint,
  'each mark is audited'
);
select is(pg_temp.ack('delivered', null, 'p1'), 'false', 'a delivery event after a bounce does not lower the result');
select is(pg_temp.ack('bounced_transient', (select n2 from t_ns)), 'false', 'nor does a milder bounce after a complaint');
select is((select delivery from public.notifications where id = (select n2 from t_ns)), 'complained', 'N2 still shows the complaint');
select is(pg_temp.ack('bounced_permanent', null, 'p1'), 'false', 'a repeated hard bounce changes nothing');
select is((select count(*) from audit.log where action = 'notification.address_undeliverable'), 2::bigint, 'and is not audited twice');
create temp table t_n6 as select pg_temp.queue(:'u1') as id;
select is(pg_temp.msgs(), '[]'::jsonb, 'a later email of any kind for U1 is not returned for sending');
select is(pg_temp.row_of((select id from t_n6)), '(suppressed,0,,,,f)', 'it ends as suppressed');
select is((select count(*) from pgmq.q_notifications), 0::bigint, 'and leaves the queue');
create temp table t_n7 as select pg_temp.queue(:'u3') as id;
select is(jsonb_array_length(pg_temp.msgs()), 1, 'U3 had a transient bounce only, so its next email is sent');
select pg_temp.ack('failed', (select id from t_n7), null, 1, 'x') as closed_n7 \gset
update auth.users set email = 'new-one@example.test' where id = :'u1';
select is(
  (select email_undeliverable_at is null from public.notification_preferences where user_id = :'u1'), true, 'a change of the address clears the mark'
);
select is(
  (select email_undeliverable_at is not null from public.notification_preferences where user_id = :'u2'), true, 'and only that of the user'
);
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"x": 1}' where id = :'u2';
select is(
  (select email_undeliverable_at is not null from public.notification_preferences where user_id = :'u2'), true, 'another change to the user leaves the mark'
);
create temp table t_n8 as select pg_temp.queue(:'u1') as id;
select is(pg_temp.msgs() -> 0 ->> 'recipient', 'new-one@example.test', 'the next email for U1 is sent, to the new address');

-- FR-I2 AC14: the retention period is a configuration value.
delete from public.notifications;
select pgmq.purge_queue('notifications');
delete from pgmq.a_notifications;
select pgmq.send('notifications', jsonb_build_object('kind', 'mfa_reset', 'user_id', :'u1'::uuid)) from generate_series(1, 4);
update public.notifications set created_at = now() - interval '395 days' where id = (select id from public.notifications order by id limit 1);
update public.notifications set created_at = now() - interval '397 days' where id = (select id from public.notifications order by id desc limit 1);
update public.notifications set created_at = now() - interval '20 days' where id = (select id from public.notifications where created_at > now() - interval '1 day' order by id limit 1);
select pgmq.archive('notifications', msg_id) from public.notifications;
update pgmq.a_notifications set archived_at = now() - interval '397 days' where msg_id = (select msg_id from public.notifications where created_at < now() - interval '396 days');
select is((select days from private.retention_policies where entity = 'notifications'), 396, 'AC14: 13 months is seeded as 396 days');
select private.apply_retention();
select is(
  (select count(*) from public.notifications where created_at < now() - interval '396 days'), 0::bigint, 'AC14: the row aged D+1 days is deleted'
);
select is((select count(*) from public.notifications where created_at < now() - interval '394 days'), 1::bigint, 'AC14: the row aged D-1 days stays');
select is((select count(*) from public.notifications), 3::bigint, 'AC14: and the others');
select is((select count(*) from pgmq.a_notifications), 3::bigint, 'AC14: the archived message of the deleted row goes too');
select is(
  (select metadata::text from audit.log where action = 'retention.run' and entity_id = 'notifications' order by id desc limit 1),
  '{"days": 396, "removed": 1}', 'AC14: the run is audited with the period and the count'
);
update private.retention_policies set days = 10 where entity = 'notifications';
select private.apply_retention();
select is((select count(*) from public.notifications), 1::bigint, 'AC14: with a shorter period the rows aged 20 and 395 days go, without a code change');
select is(
  (select metadata::text from audit.log where action = 'retention.run' and entity_id = 'notifications' order by id desc limit 1),
  '{"days": 10, "removed": 2}', 'AC14: and that run is audited with the new period'
);
select is((select count(*) from audit.log where action = 'retention.run' and entity_id = 'notifications'), 2::bigint, 'AC14: one audit row per run');

-- The scheduler call: nothing while no message is visible, a warning without the secrets, one request with them.
delete from public.notifications;
select pgmq.purge_queue('notifications');
select is((select private.run_notify()), null::bigint, 'no request is made while the queue is empty');
select pg_temp.queue(:'u1');
set local client_min_messages = error;
select is((select private.run_notify()), null::bigint, 'no request is made without the Vault secrets');
set local client_min_messages = notice;
select vault.create_secret('https://project.example.test/', 'project_url');
select vault.create_secret('anon-key-value', 'anon_key');
select vault.create_secret('shared-secret-value', 'edge_shared_secret');
update pgmq.q_notifications set vt = now() + interval '1 hour';
select is((select private.run_notify()), null::bigint, 'no request is made while every message is invisible');
select pg_temp.make_visible();
select is((select private.run_notify() is not null), true, 'with a visible message and the secrets one request is made');
select is(
  (select format('%s|%s|%s|%s|%s', count(*), min(method::text), min(url), min(headers ->> 'x-edge-secret'), min(headers ->> 'Authorization'))
   from net.http_request_queue),
  '1|POST|https://project.example.test/functions/v1/notify|shared-secret-value|Bearer anon-key-value',
  'it is a POST to notify with the shared secret and the project key'
);
select is(
  (select count(*) from cron.job where jobname = 'notify-run' and schedule = '* * * * *' and command = 'select private.run_notify()'), 1::bigint,
  'the call is scheduled every minute'
);
select ok(
  not has_function_privilege('authenticated', 'private.run_notify()', 'execute') and not has_function_privilege('service_role', 'private.run_notify()', 'execute')
  and not has_function_privilege('authenticated', 'private.call_edge_function(text)', 'execute')
  and not has_function_privilege('service_role', 'private.call_edge_function(text)', 'execute'),
  'no API role can run the scheduler call'
);

select * from finish();
rollback;
