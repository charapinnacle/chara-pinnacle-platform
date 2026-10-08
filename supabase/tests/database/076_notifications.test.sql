begin;
select plan(63);

\ir status_fixture.inc

select pg_temp.doc(:'d1', :'wa');

create function pg_temp.keys(p_payload jsonb) returns text[]
language sql as $$ select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_payload) k $$;
create function pg_temp.rows_of(p_kind text, p_user uuid) returns bigint
language sql as $$ select count(*) from public.notifications where kind = p_kind and user_id = p_user $$;
create function pg_temp.sent_mail_counts() returns text
language sql as $$ select (select count(*) from public.notifications) || ',' || (select count(*) from pgmq.q_notifications) $$;

-- FR-I2 AC1: one row and one message for each accepted member, in the transaction of apply_to_job.
create temp table t_job as select pg_temp.open_job('Welder MIG/MAG') as id;
select is(
  pg_temp.apply_as(:'wa', (select id from t_job), 'Private cover note about my illness', array[:'d1']::uuid[]), 'ok',
  'AC1: the candidate applies'
);
select set_eq(
  $$select user_id from public.notifications where kind = 'application_received'$$,
  format($$values (%L::uuid), (%L::uuid), (%L::uuid)$$, :'own1', :'adm', :'mem'),
  'AC1: the owner, the admin and the member each have a row'
);
select is(
  (select count(*) from public.notifications where user_id in (:'pending', :'own2', :'adm2', :'wa')), 0::bigint,
  'AC1: the invitee who has not accepted, the members of another organisation and the candidate have none'
);
select is(
  (select count(*) from public.notifications where status = 'queued' and channel = 'email' and msg_id is not null and sent_at is null and attempts = 0),
  3::bigint, 'AC1: each row is queued on the email channel, with its message and nothing sent'
);
select is(
  (select count(*) from public.notifications n join pgmq.q_notifications q on q.msg_id = n.msg_id and q.message ->> 'user_id' = n.user_id::text),
  3::bigint, 'AC1: each row has exactly one message of its own'
);
select is(
  (select pg_temp.keys(payload) from public.notifications where user_id = :'own1'),
  array['application_id', 'job_id', 'job_title', 'org_slug'], 'AC1: the payload holds the application, the vacancy and its title and nothing else'
);
select is(
  (select payload ->> 'job_title' from public.notifications where user_id = :'own1'), 'Welder MIG/MAG', 'AC1: the title is the vacancy title'
);
select is(
  (select count(*) from public.notifications n
   where n.payload::text ~* 'cover|illness|cv\.pdf|example\.test' or n.payload::text like '%' || :'d1' || '%'),
  0::bigint, 'AC1: no cover note, document or address is in a payload'
);
select is(
  (select count(*) from public.notifications where payload ->> 'application_id' = current_setting('t.app')), 3::bigint,
  'AC1: the payload names the application'
);

-- The preference applies to application_received only: a digest recipient keeps the row and gets no message (FR-I3).
insert into public.notification_preferences (user_id, digest) values (:'adm', true);
select is(pg_temp.apply_as(:'wb', pg_temp.open_job('Second vacancy'), null, null), 'ok', 'a second application is made');
select is(
  (select row(count(*), count(msg_id))::text from public.notifications where kind = 'application_received' and payload ->> 'application_id' = current_setting('t.app')),
  '(3,2)', 'digest: three rows, two messages'
);
select is(
  (select row(status, msg_id is null)::text from public.notifications where user_id = :'adm' and payload ->> 'application_id' = current_setting('t.app')),
  '(queued,t)', 'digest: the row of the digest member waits as queued, without a message'
);
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'adm' and message ->> 'application_id' = current_setting('t.app')), 0::bigint,
  'digest: and no message is in the queue for that member'
);
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'adm' and message ->> 'kind' = 'application_received'), 1::bigint,
  'digest: the first application, made before the preference, still has its message'
);

-- FR-I2 AC3: a status email to the candidate for every move except Viewed.
create temp table t_apps as
  select pg_temp.seed_app('applied') as a1, pg_temp.seed_app('interview') as a2, pg_temp.seed_app('shortlisted') as a3;
select is(pg_temp.viewed_as(:'mem', (select a1 from t_apps)), 'ok', 'AC3: A1 is opened (Viewed)');
select is(pg_temp.rows_of('status_changed', :'wa'), 0::bigint, 'AC3: Viewed creates no row');
select is(pg_temp.set_as(:'mem', (select a1 from t_apps), 'shortlisted', 'Internal remark one'), 'ok', 'AC3: A1 is shortlisted');
select is(pg_temp.set_as(:'mem', (select a1 from t_apps), 'interview', 'Internal remark two'), 'ok', 'AC3: then interview');
select is(pg_temp.set_as(:'mem', (select a1 from t_apps), 'offer'), 'ok', 'AC3: then offer');
select is(pg_temp.set_as(:'mem', (select a1 from t_apps), 'hired'), 'ok', 'AC3: then hired');
select is(pg_temp.set_as(:'mem', (select a2 from t_apps), 'rejected', 'We chose someone with a German licence'), 'ok', 'AC3: A2 is declined');
select is(pg_temp.call_as(:'wa', 'authenticated', format('select public.withdraw_application(%L)', (select a3 from t_apps)), 'aal1'), 'ok', 'AC3: the candidate withdraws A3');
select is(pg_temp.rows_of('status_changed', :'wa'), 6::bigint, 'AC3: six status_changed rows for the candidate');
select is(
  (select array_agg(payload ->> 'status' order by payload ->> 'status') from public.notifications where kind = 'status_changed'),
  array['hired', 'interview', 'offer', 'rejected', 'shortlisted', 'withdrawn'], 'AC3: with the new state of each move'
);
select is(
  (select count(*) from public.notifications where kind = 'status_changed' and status = 'queued' and msg_id is not null and payload ->> 'job_title' = 'Status vacancy'),
  6::bigint, 'AC3: each is queued with the vacancy title'
);
select is(
  (select count(*) from public.notifications where kind = 'status_changed'
     and (pg_temp.keys(payload) <> array['application_id', 'job_id', 'job_title', 'status']::text[]
          or payload::text ~* 'remark|licence|someone')),
  0::bigint, 'AC3: no payload carries a note or a decline reason'
);
select is(
  (select count(*) from public.notifications where kind = 'status_changed' and user_id in (:'own1', :'adm', :'mem')), 0::bigint,
  'AC3: nothing goes to the employer members, on withdrawal or otherwise'
);
create temp table t_before as select pg_temp.sent_mail_counts() as c;
select is(pg_temp.set_as(:'mem', (select a1 from t_apps), 'interview'), 'P0001|CHARA_INVALID_TRANSITION|hired to interview', 'AC3: a move out of Hired is refused');
select is(
  pg_temp.set_as(pg_temp.member_of(pg_temp.org_on('employer_starter', 'canceled')), (select a1 from t_apps), 'interview'),
  'P0002|CHARA_NOT_FOUND|', 'AC3: and so is a move by another organisation'
);
create temp table t_lapsed as select pg_temp.org_on('employer_starter', 'canceled') as org;
select is(
  pg_temp.set_as(pg_temp.member_of((select org from t_lapsed)), pg_temp.seed_app('applied', (select org from t_lapsed)), 'interview'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC3: and so is a move in a lapsed organisation'
);
select is(pg_temp.sent_mail_counts(), (select c from t_before), 'AC3: the refused moves created no row and no message');

-- FR-I2 AC4: a bulk change creates one row per accepted application.
create temp table t_bulk as
  select pg_temp.seed_app('applied') as a, pg_temp.seed_app('applied', null, :'wb') as b,
         pg_temp.seed_app('applied') as c, pg_temp.seed_app('applied', null, :'wb') as d, pg_temp.seed_app('hired') as e;
create temp table t_status_before as select count(*) as n from public.notifications where kind = 'status_changed';
select is(
  (select count(*) from jsonb_array_elements(pg_temp.bulk_as(:'mem', array[(select a from t_bulk), (select b from t_bulk), (select c from t_bulk), (select d from t_bulk), (select e from t_bulk)], 'interview')) r where r ->> 'ok' = 'true'),
  4::bigint, 'AC4: four of the five are accepted'
);
select is(
  (select count(*) from public.notifications where kind = 'status_changed') - (select n from t_status_before), 4::bigint,
  'AC4: four rows are added'
);
select is(
  (select array_agg(user_id::text || ':' || cnt order by user_id) from (
     select user_id, count(*) as cnt from public.notifications
     where kind = 'status_changed' and payload ->> 'application_id' in (select a::text from t_bulk union all select b::text from t_bulk union all select c::text from t_bulk union all select d::text from t_bulk union all select e::text from t_bulk)
     group by user_id) x),
  array[:'wa' || ':2', :'wb' || ':2'], 'AC4: two for each candidate'
);
select is(
  (select count(*) from public.notifications where payload ->> 'application_id' = (select e::text from t_bulk)), 0::bigint,
  'AC4: none for the refused application'
);

-- Messages of the other kinds: what a payload may carry.
create temp table t_msgs as
  select pgmq.send('notifications', jsonb_build_object(
    'kind', 'vacancy_hidden', 'user_id', :'own1'::uuid, 'job_id', (select id from t_job), 'reasons', 'Misleading salary claim',
    'cover_note', 'must not travel', 'mandatory', true)) as hidden,
  pgmq.send('notifications', jsonb_build_object(
    'kind', 'trial_ending', 'user_id', :'own1'::uuid, 'organization_id', current_setting('t.a')::uuid, 'trial_ends_at', '2026-11-01',
    'plan_code', 'employer_starter', 'amount_minor', 3900, 'currency', 'EUR', 'secret', 'x')) as trial,
  pgmq.send('notifications', jsonb_build_object('kind', 'payment_failed', 'user_id', :'own1'::uuid, 'organization_id', current_setting('t.a')::uuid)) as failed,
  pgmq.send('notifications', jsonb_build_object('kind', 'legal_version', 'user_id', :'wa'::uuid, 'document_slug', 'worker-terms', 'version', 3, 'body', 'x')) as legal,
  pgmq.send('notifications', jsonb_build_object('kind', 'mfa_reset', 'user_id', :'wa'::uuid, 'mandatory', true)) as mfa,
  pgmq.send('notifications', jsonb_build_object('kind', 'deletion_requested', 'user_id', :'wa'::uuid, 'erases_on', '2026-11-02T08:00:00+00:00')) as del_req,
  pgmq.send('notifications', jsonb_build_object('kind', 'deletion_completed', 'email', 'gone@example.test')) as del_done,
  pgmq.send('notifications', jsonb_build_object('kind', 'erasure_paused', 'email', 'privacy@example.test', 'user_id', :'wb'::uuid)) as paused;
select is(
  (select payload from public.notifications where msg_id = (select hidden from t_msgs)),
  jsonb_build_object('job_id', (select id from t_job), 'job_title', 'Welder MIG/MAG', 'org_slug', (select slug from public.organizations where id = current_setting('t.a')::uuid), 'reasons', 'Misleading salary claim'),
  'vacancy_hidden: the title, the organisation, the statement of reasons, and not the extra key'
);
select is(
  (select payload from public.notifications where msg_id = (select trial from t_msgs)),
  jsonb_build_object('org_slug', (select slug from public.organizations where id = current_setting('t.a')::uuid), 'trial_ends_at', '2026-11-01', 'plan_code', 'employer_starter', 'amount_minor', 3900, 'currency', 'EUR'),
  'trial_ending: the end date, the plan and the price, and not the extra key'
);
select is(
  (select payload from public.notifications where msg_id = (select failed from t_msgs)),
  jsonb_build_object('org_slug', (select slug from public.organizations where id = current_setting('t.a')::uuid)), 'payment_failed: the organisation only'
);
select is(
  (select payload from public.notifications where msg_id = (select legal from t_msgs)), '{"version": 3, "document_slug": "worker-terms"}'::jsonb,
  'legal_version: the document and its version, not the text'
);
select is((select payload from public.notifications where msg_id = (select mfa from t_msgs)), '{}'::jsonb, 'mfa_reset: no payload');
select is(
  (select payload from public.notifications where msg_id = (select del_req from t_msgs)), '{"erases_on": "2026-11-02T08:00:00+00:00"}'::jsonb,
  'deletion_requested: the erasure date'
);
select is(
  (select row(user_id is null, payload)::text from public.notifications where msg_id = (select del_done from t_msgs)), '(t,{})',
  'deletion_completed: no user and no payload, so the address stays in the message'
);
select is(
  (select count(*) from public.notifications n where to_jsonb(n)::text like '%gone@example.test%' or to_jsonb(n)::text like '%privacy@example.test%'),
  0::bigint, 'and no row holds an address that travels in a message'
);
select is(
  (select row(user_id, payload)::text from public.notifications where msg_id = (select paused from t_msgs)), format('(%s,"{""account_id"": ""%s""}")', :'wb', :'wb'),
  'erasure_paused: the account concerned, as the user and in the payload'
);
select is((select count(*) from public.notifications where kind in ('vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version') and status = 'queued'), 4::bigint, 'every message made a queued row');

-- The row and the message are one transaction.
savepoint before_rollback;
select pgmq.send('notifications', jsonb_build_object('kind', 'mfa_reset', 'user_id', :'wb'::uuid));
rollback to savepoint before_rollback;
select is(
  (select count(*) from public.notifications where user_id = :'wb' and kind = 'mfa_reset'), 0::bigint, 'a rolled-back message leaves no row'
);
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'wb' and message ->> 'kind' = 'mfa_reset'), 0::bigint, 'and no message'
);
select throws_ok(
  $$select pgmq.send('notifications', '{"kind": "newsletter", "user_id": "00000000-0000-0000-0000-00000000a001"}')$$, '23514', null,
  'a kind outside the catalogue is refused'
);
select throws_ok(
  $$select pgmq.send('notifications', '{"kind": "mfa_reset"}')$$, '23514', null, 'a message without a recipient is refused, except the completion of an erasure'
);

-- FR-I2 AC15: the rows are private.
select is(
  pg_temp.val_as(:'own1', 'aal1', $$select count(*)::text from public.notifications where user_id <> (select auth.uid())$$), '0',
  'AC15: a company user sees no row of another user'
);
select is(
  pg_temp.val_as(:'own1', 'aal1', $$select count(*)::text from public.notifications$$),
  (select count(*)::text from public.notifications where user_id = :'own1'), 'AC15: and sees all their own'
);
select is(
  pg_temp.val_as(:'wa', 'aal1', $$select count(*)::text from public.notifications$$),
  (select count(*)::text from public.notifications where user_id = :'wa'), 'AC15: a candidate sees their own rows'
);
select is(
  pg_temp.val_as(:'st_admin', 'aal2', $$select count(*)::text from public.notifications$$), '0',
  'AC15: a Platform Administrator sees no row of anyone else'
);
select is(
  pg_temp.call_as(null, 'anon', $$select count(*) from public.notifications$$), '42501|permission denied for table notifications|',
  'AC15: anonymous is refused'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$insert into public.notifications (user_id, kind) values (%L, 'mfa_reset')$$, :'own1')),
  '42501|permission denied for table notifications|', 'AC15: a user cannot insert'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$update public.notifications set status = 'sent'$$), '42501|permission denied for table notifications|',
  'AC15: or update'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$delete from public.notifications$$), '42501|permission denied for table notifications|',
  'AC15: or delete'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select msg_id from public.notifications$$), '42501|permission denied for table notifications|',
  'AC15: the queue message, the provider reference and the error stay hidden even from the owner of a row'
);
select is(
  (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r (role)
   where has_table_privilege(r.role, 'public.notifications', 'insert, update, delete, truncate')
      or has_table_privilege(r.role, 'public.notification_preferences', 'insert, update, delete, truncate')
      or (r.role <> 'authenticated' and (has_table_privilege(r.role, 'public.notifications', 'select') or has_any_column_privilege(r.role, 'public.notifications', 'select')))),
  0::bigint, 'AC15: no API role writes either table, and only authenticated reads (service_role has no table grant)'
);
select is(
  pg_temp.val_as(:'adm', 'aal1', $$select digest::text from public.notification_preferences$$), 'true',
  'a user reads their own preference row'
);
select is(
  pg_temp.val_as(:'own1', 'aal1', $$select count(*)::text from public.notification_preferences$$), '0',
  'and not that of anybody else'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', $$update public.notification_preferences set digest = false$$), '42501|permission denied for table notification_preferences|',
  'a user cannot change it here (FR-I3 adds the RPC)'
);
select is(
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'notifications' and indexdef like '%(user_id, created_at DESC)%'), 1::bigint,
  'the column of the read policy is indexed'
);

select * from finish();
rollback;
