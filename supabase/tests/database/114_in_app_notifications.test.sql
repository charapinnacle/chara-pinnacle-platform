begin;
select plan(91);

\ir organizations_fixture.inc

-- own1, adm, own2: company users; wkr: a worker; nul: an account whose kind is not chosen yet.
select pgmq.purge_queue('notifications');
delete from public.notifications;
update private.settings set value = 'true' where key = 'release_partner_directories';

create function pg_temp.send(p_user uuid, p_kind text, p_extra jsonb default '{}') returns bigint
language sql as $$
  select pgmq.send('notifications', jsonb_build_object('kind', p_kind, 'user_id', p_user, 'mandatory', true) || p_extra)
$$;
create function pg_temp.row_of(p_msg bigint, p_user uuid, p_kind text) returns text
language sql as $$
  select row(n.status, n.mandatory, n.email_status, n.msg_id is not null, exists (select 1 from pgmq.q_notifications q where q.msg_id = p_msg))::text
  from public.notifications n where n.user_id = p_user and n.kind = p_kind order by n.created_at desc, n.id desc limit 1
$$;
create function pg_temp.json_as(p_user uuid, p_sql text) returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text end, true);
  if p_user is null then set local role anon; else set local role authenticated; end if;
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(s)), ''[]'') from (%s) s', p_sql) into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := to_jsonb(format('%s|%s|%s', v_state, v_message, coalesce(v_detail, '')));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;
create function pg_temp.prefs_as(p_user uuid, p_kinds jsonb) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.set_notification_preferences(%L::jsonb)', p_kinds), 'aal1')
$$;
create function pg_temp.dequeue() returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  select public.notify_dequeue(100) into v;
  reset role;
  return v;
end;
$$;
create function pg_temp.broadcasts(p_user uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg((m.payload -> 'unread') order by m.inserted_at, m.id), '[]')
  from realtime.messages m where m.topic = 'user:' || p_user and m.event = 'unread_count'
$$;

-- The catalogue (DATA_MODEL.md section 9): one row per kind of the check of public.notifications, and only those; the
-- Vitest test emails.test.ts holds the same list against the email templates.
select set_eq(
  $$select kind from private.notification_kinds$$,
  $$select (regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g'))[1]
    from pg_constraint c where c.conname = 'notifications_kind_check' and c.conrelid = 'public.notifications'::regclass$$,
  'catalogue: the kinds of private.notification_kinds are exactly those of the notifications kind check'
);
select set_eq(
  $$select kind from private.notification_kinds where not mandatory$$,
  $$values ('application_received')$$,
  'catalogue: of the Phase 1 kinds only application_received is optional, as Phase 1 treats it'
);
select is(
  (select count(*) from private.notification_kinds where not default_email and mandatory), 0::bigint,
  'catalogue: no mandatory kind defaults to no email'
);
select throws_ok(
  $$insert into private.notification_kinds (kind, mandatory, default_email, audience, label) values ('x_kind', true, false, 'all', 'X')$$,
  '23514', null, 'catalogue: the check refuses a mandatory kind without email'
);
select is(
  (select row(relrowsecurity, relforcerowsecurity)::text from pg_class where oid = 'private.notification_kinds'::regclass), '(t,t)',
  'catalogue: RLS is enabled and forced'
);
select ok(
  not has_table_privilege('authenticated', 'private.notification_kinds', 'select')
    and not has_table_privilege('anon', 'private.notification_kinds', 'select')
    and not has_table_privilege('service_role', 'private.notification_kinds', 'select'),
  'catalogue: no API role reads the table; notification_kind_catalogue() is the way'
);
select throws_ok(
  format($$insert into public.notifications (user_id, kind, email_status) values (%L, 'mfa_reset', 'bounced')$$, :'own1'), '23514', null,
  'email_status: only suppressed_by_preference and suppressed_undeliverable are values'
);

-- AC4 and the enqueue trigger: mandatory kinds are emailed whatever the preference; optional ones follow it.
insert into public.notification_preferences (user_id, email_kinds) values (:'own1', '{"application_received": false}');
select pg_temp.send(:'own1', 'vacancy_hidden') as m1 \gset
select is(pg_temp.row_of(:m1, :'own1', 'vacancy_hidden'), '(queued,t,,t,t)', 'AC4: a mandatory kind is queued with mandatory true and its message');
select pg_temp.send(:'own1', 'application_received', '{"mandatory": false}') as m2 \gset
select is(
  pg_temp.row_of(:m2, :'own1', 'application_received'), '(suppressed,f,suppressed_by_preference,f,f)',
  'AC4: an optional kind turned off keeps its in-app row, suppressed_by_preference, without a message'
);
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'own1' and message ->> 'kind' = 'application_received'), 0::bigint,
  'AC4: no email is queued for the kind that is off'
);
select pg_temp.send(:'adm', 'application_received', '{"mandatory": false}') as m3 \gset
select is(pg_temp.row_of(:m3, :'adm', 'application_received'), '(queued,f,,t,t)', 'AC4: a recipient who never chose gets the default, an email');
update public.notification_preferences set email_kinds = '{"application_received": true}', digest = true where user_id = :'own1';
delete from public.notifications where user_id = :'own1' and kind = 'application_received';
select pg_temp.send(:'own1', 'application_received', '{"mandatory": false}') as m4 \gset
select is(
  pg_temp.row_of(:m4, :'own1', 'application_received'), '(queued,f,,f,f)',
  'digest: with the email on, the daily summary still holds the application as a row without a message'
);
update public.notification_preferences set email_kinds = '{"application_received": false}' where user_id = :'own1';
delete from public.notifications where user_id = :'own1' and kind = 'application_received';
select pg_temp.send(:'own1', 'application_received', '{"mandatory": false, "vacancies": [], "total": 0}') as m5 \gset
select is(
  pg_temp.row_of(:m5, :'own1', 'application_received'), '(suppressed,f,suppressed_by_preference,f,f)',
  'digest: a summary to a recipient who turned the kind off is suppressed as well'
);
select is(
  (select mandatory from public.notifications where msg_id = :m1), true, 'mandatory comes from the catalogue, not from the message'
);

-- dedupe_key: a producer that runs twice for one event queues it once per recipient and kind.
select pg_temp.send(:'adm', 'legal_version', '{"dedupe_key": "legal:worker-terms:3"}') as d1 \gset
select pg_temp.send(:'adm', 'legal_version', '{"dedupe_key": "legal:worker-terms:3"}') as d2 \gset
select is(
  (select count(*) from public.notifications where user_id = :'adm' and dedupe_key = 'legal:worker-terms:3'), 1::bigint,
  'dedupe: the second message with the same key writes no row'
);
select is(
  (select count(*) from pgmq.q_notifications where msg_id in (:d1, :d2)), 1::bigint, 'dedupe: and its message is dropped, so one email'
);
select pg_temp.send(:'own2', 'legal_version', '{"dedupe_key": "legal:worker-terms:3"}') as d3 \gset
select pg_temp.send(:'adm', 'mfa_reset', '{"dedupe_key": "legal:worker-terms:3"}') as d4 \gset
select is(
  (select count(*) from public.notifications where dedupe_key = 'legal:worker-terms:3'), 3::bigint,
  'dedupe: the key is per recipient and kind'
);
select pg_temp.send(:'adm', 'legal_version') as d5 \gset
select pg_temp.send(:'adm', 'legal_version') as d6 \gset
select is(
  (select count(*) from public.notifications where user_id = :'adm' and kind = 'legal_version' and dedupe_key is null), 2::bigint,
  'dedupe: messages without a key are never merged'
);

-- NFR-A3: the row and the message exist only with the change that queued them.
savepoint before_send;
select pg_temp.send(:'own2', 'mfa_reset');
rollback to savepoint before_send;
select is(
  (select count(*) from public.notifications where user_id = :'own2' and kind = 'mfa_reset'), 0::bigint,
  'NFR-A3: a rolled-back change leaves no notification row'
);

-- AC12: an undeliverable address gets no email, mandatory or not, and the in-app items stay.
select pgmq.purge_queue('notifications');
delete from public.notifications;
insert into public.notification_preferences (user_id, email_undeliverable_at) values (:'own2', now());
select pg_temp.send(:'own2', 'application_received', '{"mandatory": false}') as u1 \gset
select pg_temp.send(:'own2', 'vacancy_hidden') as u2 \gset
select pg_temp.send(:'adm', 'mfa_reset') as u3 \gset
select is(
  (select jsonb_agg(m ->> 'kind') from jsonb_array_elements(pg_temp.dequeue() -> 'messages') m), '["mfa_reset"]'::jsonb,
  'AC12: notify gets only the email of the deliverable address'
);
select is(
  (select array_agg(row(status, email_status)::text order by kind) from public.notifications where user_id = :'own2'),
  array['(suppressed,suppressed_undeliverable)', '(suppressed,suppressed_undeliverable)'],
  'AC12: the optional and the mandatory email are both suppressed_undeliverable'
);
select is(
  (select jsonb_array_length(pg_temp.json_as(:'own2', 'select * from public.list_my_notifications()'))), 2,
  'AC12: and both are still items of the in-app list'
);
select is(
  (select count(*) from pgmq.q_notifications where msg_id in (:u1, :u2)), 0::bigint, 'AC12: their messages left the queue'
);

-- set_notification_preferences(p_kinds) (DATA_MODEL.md section 4).
select pgmq.purge_queue('notifications');
delete from public.notifications;
delete from public.notification_preferences;
select is(pg_temp.prefs_as(:'adm', '{"application_received": false}'), 'ok', 'preferences: a company user turns an optional kind off');
select is(
  (select email_kinds from public.notification_preferences where user_id = :'adm'), '{"application_received": false}'::jsonb,
  'preferences: the choice is stored'
);
select is(
  (select metadata from audit.log where action = 'notification_preferences.changed' and actor_id = :'adm' order by id desc limit 1),
  '{"kinds": {"application_received": {"to": false, "from": true}}}'::jsonb,
  'preferences: the change is audited with the old and the new value'
);
select is(pg_temp.prefs_as(:'adm', '{"application_received": false}'), 'ok', 'preferences: saving the same choice again is accepted');
select is(
  (select count(*) from audit.log where action = 'notification_preferences.changed' and actor_id = :'adm'), 1::bigint,
  'preferences: and writes no second audit row'
);
select alike(
  pg_temp.prefs_as(:'adm', '{"vacancy_hidden": false}'), 'P0001|CHARA_INVALID_INPUT|mandatory_kind',
  'AC4: turning a mandatory kind off is refused with mandatory_kind'
);
select alike(
  pg_temp.prefs_as(:'adm', '{"vacancy_hidden": true, "application_received": true}'), 'P0001|CHARA_INVALID_INPUT|mandatory_kind',
  'AC4: a mandatory kind is refused in any save, and nothing of that save is stored'
);
select is(
  (select email_kinds from public.notification_preferences where user_id = :'adm'), '{"application_received": false}'::jsonb,
  'AC4: the refused save changed nothing'
);
select alike(pg_temp.prefs_as(:'wkr', '{"status_changed": false}'), 'P0001|CHARA_INVALID_INPUT|mandatory_kind', 'AC4: a worker cannot turn off status emails');
select alike(pg_temp.prefs_as(:'wkr', '{"application_received": false}'), 'P0001|CHARA_INVALID_INPUT|p_kinds', 'preferences: a worker cannot choose a company kind');
select alike(pg_temp.prefs_as(:'adm', '{"newsletter": false}'), 'P0001|CHARA_INVALID_INPUT|p_kinds', 'preferences: an unknown kind is refused');
select alike(pg_temp.prefs_as(:'adm', '{"application_received": "no"}'), 'P0001|CHARA_INVALID_INPUT|p_kinds', 'preferences: a value that is not a boolean is refused');
select alike(pg_temp.prefs_as(:'adm', '{}'), 'P0001|CHARA_INVALID_INPUT|p_kinds', 'preferences: an empty choice is refused');
select alike(pg_temp.prefs_as(:'adm', '[]'), 'P0001|CHARA_INVALID_INPUT|p_kinds', 'preferences: an array is refused');
select alike(pg_temp.prefs_as(:'nul', '{"application_received": false}'), 'P0001|CHARA_FORBIDDEN|account_kind_required', 'preferences: an account without a kind is refused');
select alike(
  pg_temp.call_as(null, 'anon', $$select public.set_notification_preferences('{"application_received": false}'::jsonb)$$),
  '42501|%', 'preferences: a visitor cannot call it'
);
-- The digest switch of Phase 1 keeps working next to the per-kind choice.
select is(pg_temp.call_as(:'adm', 'authenticated', 'select public.set_notification_preferences(true)', 'aal1'), 'ok', 'digest: the Phase 1 switch still works');
select is(
  (select row(digest, email_kinds)::text from public.notification_preferences where user_id = :'adm'), '(t,"{""application_received"": false}")',
  'digest: it leaves the per-kind choice alone'
);
select is(pg_temp.prefs_as(:'adm', '{"application_received": true}'), 'ok', 'preferences: the kind is turned on again');
select is((select digest from public.notification_preferences where user_id = :'adm'), true, 'digest: and the per-kind save leaves the digest alone');

-- notification_kind_catalogue(): the kinds of the caller's audience, with the email state.
select is(
  (select jsonb_agg(c ->> 'kind' order by c ->> 'kind') from jsonb_array_elements(pg_temp.json_as(:'adm', 'select * from public.notification_kind_catalogue()')) c),
  (select jsonb_agg(kind order by kind) from private.notification_kinds where audience in ('company', 'all')),
  'catalogue: a company user sees the company kinds and those of all users'
);
select is(
  (select jsonb_agg(c ->> 'kind' order by c ->> 'kind') from jsonb_array_elements(pg_temp.json_as(:'wkr', 'select * from public.notification_kind_catalogue()')) c),
  (select jsonb_agg(kind order by kind) from private.notification_kinds where audience in ('worker', 'all')),
  'catalogue: a worker sees the worker kinds and those of all users, never erasure_paused'
);
select pg_temp.prefs_as(:'own1', '{"application_received": false}') as setup_own1 \gset
select is(
  (select c -> 'email_enabled' from jsonb_array_elements(pg_temp.json_as(:'own1', 'select * from public.notification_kind_catalogue()')) c where c ->> 'kind' = 'application_received'),
  'false'::jsonb, 'catalogue: email_enabled shows the choice of the caller'
);
select is(
  (select bool_and((c ->> 'email_enabled')::boolean) from jsonb_array_elements(pg_temp.json_as(:'own1', 'select * from public.notification_kind_catalogue()')) c where (c ->> 'mandatory')::boolean),
  true, 'catalogue: mandatory kinds are always emailed'
);

-- NFR-S8 and AC10: the list, the count and the marks are the caller's own.
select pgmq.purge_queue('notifications');
delete from public.notifications;
delete from public.notification_preferences;
-- own1: 7 items, of which 3 are read below; adm: 2 items; plus a summary row and an erasure notice the list never shows.
select pg_temp.send(:'own1', 'vacancy_hidden') from generate_series(1, 7);
select pg_temp.send(:'adm', 'payment_failed') from generate_series(1, 2);
select pg_temp.send(:'own1', 'application_received', '{"mandatory": false, "vacancies": [], "total": 0}');
select pg_temp.send(:'own1', 'erasure_paused');
update public.notifications set created_at = now() - make_interval(mins => n.rn::integer)
from (select id, row_number() over (order by msg_id) as rn from public.notifications) n where n.id = public.notifications.id;
update public.notifications set read_at = now()
where id in (select id from public.notifications where user_id = :'own1' and kind = 'vacancy_hidden' order by created_at limit 3);

select is(pg_temp.val_as(:'own1', 'aal1', 'select public.unread_notification_count()'), '4', 'AC9: 4 of the 7 items are unread');
select is(pg_temp.val_as(:'adm', 'aal1', 'select public.unread_notification_count()'), '2', 'NFR-S8: another user counts only their own');
select is(
  (select jsonb_agg(r ->> 'kind') from jsonb_array_elements(pg_temp.json_as(:'own1', 'select * from public.list_my_notifications()')) r),
  '["vacancy_hidden","vacancy_hidden","vacancy_hidden","vacancy_hidden","vacancy_hidden","vacancy_hidden","vacancy_hidden"]'::jsonb,
  'AC9: the list holds the 7 items and not the summary or the erasure notice'
);
select ok(
  (select bool_and((a ->> 'created_at')::timestamptz >= (b ->> 'created_at')::timestamptz)
   from (select r as a, lead(r) over (order by ord) as b from jsonb_array_elements(pg_temp.json_as(:'own1', 'select * from public.list_my_notifications()')) with ordinality as t(r, ord)) x
   where b is not null),
  'AC9: newest first'
);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.json_as(:'own1', 'select * from public.list_my_notifications()')) r where r ->> 'read_at' is null), 4::bigint,
  'AC9: the unread items have no read_at'
);
select set_eq(
  format($$select (r ->> 'user_id')::uuid from jsonb_array_elements(pg_temp.json_as(%L, 'select user_id from public.notifications')) r$$, :'own1'),
  format($$values (%L::uuid)$$, :'own1'),
  'AC10: a direct select returns only the caller''s rows (notifications_select_own)'
);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.json_as(:'own1', 'select id from public.notifications')) r), 8::bigint,
  'AC10: the caller reads their 7 items and the summary row, never the erasure notice'
);
select is(
  pg_temp.json_as(null, 'select id from public.notifications') #>> '{}' like '42501|%', true, 'AC10: a visitor''s select is refused (42501)'
);
select is(
  pg_temp.call_as(null, 'anon', 'select public.list_my_notifications()') like '42501|%', true, 'NFR-S8: a visitor cannot call the list'
);
select is(
  pg_temp.call_as(null, 'anon', 'select public.unread_notification_count()') like '42501|%', true, 'NFR-S8: nor the count'
);
select is(
  pg_temp.call_as(null, 'anon', 'select public.mark_notifications_read()') like '42501|%', true, 'NFR-S8: nor the mark'
);

create temp table t_snap as
  select id, kind, payload, status, mandatory, email_status, user_id from public.notifications where user_id = :'own1';
create temp table t_ids as
  select (select id from public.notifications where user_id = :'adm' order by created_at desc limit 1) as other,
         (select id from public.notifications where user_id = :'own1' and read_at is null and kind = 'vacancy_hidden' order by created_at desc limit 1) as mine;
grant select on t_ids to authenticated;
select is(
  pg_temp.val_as(:'own1', 'aal1', format('select public.mark_notifications_read(array[%L]::uuid[])', (select other from t_ids))), '0',
  'AC10: marking another user''s id changes nothing and raises nothing'
);
select is(
  (select read_at from public.notifications where id = (select other from t_ids)), null, 'AC10: the other user''s item is still unread'
);
select is(
  pg_temp.val_as(:'own1', 'aal1', format('select public.mark_notifications_read(array[%L, %L]::uuid[])', (select mine from t_ids), gen_random_uuid())), '1',
  'AC9: opening one item marks it read; an id that does not exist is not reported'
);
select is(pg_temp.val_as(:'own1', 'aal1', 'select public.unread_notification_count()'), '3', 'AC9: the count drops to 3');
select alike(
  pg_temp.call_as(:'own1', 'authenticated', format('update public.notifications set payload = %L where id = %L', '{"x": 1}', (select mine from t_ids)), 'aal1'),
  '42501|%', 'AC10: a direct update of the payload is refused (42501)'
);
select alike(
  pg_temp.call_as(:'own1', 'authenticated', format('update public.notifications set read_at = null where id = %L', (select mine from t_ids)), 'aal1'),
  '42501|%', 'AC10: a direct update of read_at is refused too'
);
select alike(
  pg_temp.call_as(:'own1', 'authenticated', format('delete from public.notifications where id = %L', (select mine from t_ids)), 'aal1'),
  '42501|%', 'AC10: and a direct delete'
);
select is(pg_temp.val_as(:'own1', 'aal1', 'select public.mark_notifications_read()'), '3', 'AC9: Mark all as read marks the 3 left');
select is(pg_temp.val_as(:'own1', 'aal1', 'select public.unread_notification_count()'), '0', 'AC9: the count is 0');
select is(pg_temp.val_as(:'own1', 'aal1', 'select public.mark_notifications_read()'), '0', 'AC9: a second Mark all changes nothing');
select is(pg_temp.val_as(:'adm', 'aal1', 'select public.unread_notification_count()'), '2', 'NFR-S8: and the other user still has 2 unread');
select set_eq(
  format($$select id, kind, payload, status, mandatory, email_status, user_id from public.notifications where user_id = %L$$, :'own1'),
  'select * from t_snap',
  'AC10: only read_at changed through mark_notifications_read'
);
select alike(
  pg_temp.call_as(:'own1', 'authenticated', format('select public.mark_notifications_read(%L::uuid[])', (select array_agg(gen_random_uuid()) from generate_series(1, 101))), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|p_ids', 'mark: more than 100 ids are refused'
);

-- Keyset pages.
delete from realtime.messages where topic = 'user:' || :'own2';
select pg_temp.send(:'own2', 'mfa_reset') from generate_series(1, 25);
select is(jsonb_array_length(pg_temp.json_as(:'own2', 'select * from public.list_my_notifications(null, 20)')), 20, 'pages: the first page holds 20');
select ok(
  (pg_temp.json_as(:'own2', 'select * from public.list_my_notifications(null, 20)') -> 19 ->> 'next_cursor') is not null
    and (pg_temp.json_as(:'own2', 'select * from public.list_my_notifications(null, 20)') -> 18 ->> 'next_cursor') is null,
  'pages: only the last row of a full page carries the cursor'
);
select set_config('t.cursor', pg_temp.json_as(:'own2', 'select * from public.list_my_notifications(null, 20)') -> 19 ->> 'next_cursor', true);
select is(
  jsonb_array_length(pg_temp.json_as(:'own2', format('select * from public.list_my_notifications(%L, 20)', current_setting('t.cursor')))), 5,
  'pages: the second page holds the other 5'
);
select is(
  (select count(*) from (
    select r ->> 'id' from jsonb_array_elements(pg_temp.json_as(:'own2', 'select * from public.list_my_notifications(null, 20)')) r
    union
    select r ->> 'id' from jsonb_array_elements(pg_temp.json_as(:'own2', format('select * from public.list_my_notifications(%L, 20)', current_setting('t.cursor')))) r
  ) ids), 25::bigint,
  'pages: the two pages hold all 25 items once'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.list_my_notifications('nonsense')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|p_cursor', 'pages: a cursor that is not one is refused'
);

-- Realtime (AC9): every change of the unread count is broadcast on user:<id> with the count and nothing else. The
-- partitions of realtime.messages are made by the Realtime service; where none covers today, realtime.send drops the
-- broadcast with a warning and the checks that need a stored broadcast are skipped.
create function pg_temp.realtime_ready() returns boolean
language plpgsql as $$
begin
  begin
    insert into realtime.messages (topic, extension, event, payload, private) values ('probe', 'broadcast', 'probe', '{}', true);
    raise exception 'probe_done';
  exception when others then
    return sqlerrm = 'probe_done';
  end;
end;
$$;
select pg_temp.val_as(:'own2', 'aal1', 'select public.mark_notifications_read()');
select case when pg_temp.realtime_ready() then is(
  (select jsonb_agg(c order by c) from jsonb_array_elements(pg_temp.broadcasts(:'own2')) c), (select jsonb_agg(n) from generate_series(0, 25) n),
  'realtime: each insert broadcast the new count, and Mark all as read broadcast 0'
) else skip('no partition of realtime.messages covers today') end;
select case when pg_temp.realtime_ready() then is(
  (select count(*) from realtime.messages where topic = 'user:' || :'own2' and (payload - 'id' - 'unread') = '{}'::jsonb and private), 26::bigint,
  'realtime: a broadcast is private and holds the count only, no kind or payload'
) else skip('no partition of realtime.messages covers today') end;
select set_config('realtime.topic', 'user:' || :'own2', true);
select case when pg_temp.realtime_ready() then is(
  jsonb_array_length(pg_temp.json_as(:'own2', 'select m.payload from realtime.messages m')), 26,
  'realtime: a user receives the broadcasts of their own topic'
) else skip('no partition of realtime.messages covers today') end;
select set_config('realtime.topic', 'user:' || :'own2', true);
select is(jsonb_array_length(pg_temp.json_as(:'own1', 'select m.payload from realtime.messages m')), 0, 'NFR-S8: another user joining that topic receives nothing');
select set_config('realtime.topic', 'user:' || :'own2', true);
select is(pg_temp.json_as(null, 'select m.payload from realtime.messages m'), '[]'::jsonb, 'NFR-S8: a visitor receives nothing');
select set_config('realtime.topic', 'user:' || :'own2', true);
select case when pg_temp.realtime_ready() then alike(
  pg_temp.call_as(:'own2', 'authenticated', format($$insert into realtime.messages (topic, extension, event, payload, private) values ('user:%s', 'broadcast', 'unread_count', '{"unread": 99}', true)$$, :'own2'), 'aal1'),
  '42501|%', 'realtime: a client cannot send on a topic, even its own'
) else skip('no partition of realtime.messages covers today') end;
select is(
  (select count(*) from pg_policy p where p.polrelid = 'realtime.messages'::regclass and p.polcmd in ('a', 'w', '*')), 0::bigint,
  'realtime: no policy on realtime.messages allows insert, update or all, so no client sends'
);
-- A topic that only starts with the user's own is another topic.
select realtime.send('{"unread": 7}'::jsonb, 'unread_count', 'user:' || :'own2' || 'x', true);
select set_config('realtime.topic', 'user:' || :'own2' || 'x', true);
select case when pg_temp.realtime_ready() then is(
  (select count(*)::int from realtime.messages where topic = 'user:' || :'own2' || 'x') * 10
    + jsonb_array_length(pg_temp.json_as(:'own2', 'select m.payload from realtime.messages m')),
  10, 'NFR-S8: a broadcast on user:<id>x exists and the user <id> receives none of it'
) else skip('no partition of realtime.messages covers today') end;
update private.settings set value = 'false' where key = 'release_partner_directories';
select set_config('t.before', (select count(*) from realtime.messages where topic = 'user:' || :'adm')::text, true);
select pg_temp.send(:'adm', 'mfa_reset');
select is(
  (select count(*) from realtime.messages where topic = 'user:' || :'adm')::text, current_setting('t.before'),
  'release: nothing is broadcast while the release is off'
);

-- Release switch: the new RPCs answer only when release_partner_directories is on.
select is(pg_temp.call_as(:'adm', 'authenticated', 'select public.list_my_notifications()', 'aal1'), 'P0001|CHARA_FORBIDDEN|release_off', 'release: the list is off');
select is(pg_temp.call_as(:'adm', 'authenticated', 'select public.unread_notification_count()', 'aal1'), 'P0001|CHARA_FORBIDDEN|release_off', 'release: the count is off');
select is(pg_temp.call_as(:'adm', 'authenticated', 'select public.mark_notifications_read()', 'aal1'), 'P0001|CHARA_FORBIDDEN|release_off', 'release: the mark is off');
select is(pg_temp.call_as(:'adm', 'authenticated', 'select public.notification_kind_catalogue()', 'aal1'), 'P0001|CHARA_FORBIDDEN|release_off', 'release: the catalogue is off');
select is(pg_temp.prefs_as(:'adm', '{"application_received": false}'), 'P0001|CHARA_FORBIDDEN|release_off', 'release: the per-kind preferences are off');
select is(
  (select value from public.get_public_settings() where key = 'release_partner_directories'), 'false',
  'release: the pages read the switch from the public settings'
);

select * from finish();
rollback;
