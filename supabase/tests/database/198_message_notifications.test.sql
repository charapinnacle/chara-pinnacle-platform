begin;
select plan(41);

\ir apply_fixture.inc

-- Message notifications (V67, FR-P4 AC2 to AC9, FR-T1 AC2, AC4 and AC5 for new_message; NFR-A3, NFR-O5, NFR-S8):
-- private.queue_message_emails, the new_message kind and payload, conversation_reads.last_emailed_at and the setting
-- message_email_delay_minutes. Acme (t.a: owner own1, admin adm, member mem, and below admin adm3 and member mem2) and
-- Beta (t.b: owner own2, admin adm2) are the employers of the fixture; wa (Amina Okafor) and wb the candidates; Rekrut
-- (owner padm, admin radm) and Second (owner u2) the partner companies. Times are minutes after t0, a minute two hours
-- ago, and every run of the job is given its time.

\set padm '00000000-0000-0000-0000-0000000f6711'
\set radm '00000000-0000-0000-0000-0000000f6712'
\set u2 '00000000-0000-0000-0000-0000000f6713'
\set adm3 '00000000-0000-0000-0000-0000000f6714'
\set mem2 '00000000-0000-0000-0000-0000000f6715'
\set st_admin '00000000-0000-0000-0000-0000000f6716'

-- p_sql as p_user (anonymous when null) at p_aal: the value of its single column, or 'sqlstate|message|detail'.
create function pg_temp.read_as(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text end, true);
  execute format('set local role %I', case when p_user is null then 'anon' else 'authenticated' end);
  begin
    execute p_sql into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

create function pg_temp.open(p_user uuid, p_type text, p_id uuid) returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select public.open_conversation(%L, %L)::text', p_type, p_id))
$$;

create function pg_temp.at(p_minutes integer) returns timestamptz
language sql as $$ select current_setting('t.t0')::timestamptz + make_interval(mins => p_minutes) $$;

-- A message of the side p_org (null for the candidate) by p_user at t0 + p_minutes, written as the database owner.
create function pg_temp.say(p_conv uuid, p_org uuid, p_user uuid, p_minutes integer, p_body text default 'Hello there')
returns void
language sql as $$
  insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body, created_at)
  values (p_conv, p_user, p_org, p_body, pg_temp.at(p_minutes));
  update public.conversations set last_message_at = greatest(last_message_at, pg_temp.at(p_minutes)) where id = p_conv;
$$;

create function pg_temp.read(p_conv uuid, p_user uuid, p_minutes integer) returns void
language sql as $$
  insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (p_conv, p_user, pg_temp.at(p_minutes))
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
$$;

create function pg_temp.run(p_minutes integer) returns integer
language sql as $$ select private.queue_message_emails(pg_temp.at(p_minutes)) $$;

-- new_message items of p_user about p_conv: all of them, and those queued with their pgmq message.
create function pg_temp.items(p_user uuid, p_conv uuid) returns bigint
language sql as $$
  select count(*) from public.notifications n
  where n.kind = 'new_message' and n.user_id = p_user and n.payload ->> 'conversation_id' = p_conv::text
$$;

create function pg_temp.queued(p_user uuid, p_conv uuid) returns bigint
language sql as $$
  select count(*) from public.notifications n join pgmq.q_notifications q on q.msg_id = n.msg_id
  where n.kind = 'new_message' and n.status = 'queued' and n.user_id = p_user and n.payload ->> 'conversation_id' = p_conv::text
$$;

create function pg_temp.reset() returns void
language sql as $$
  delete from pgmq.q_notifications where message ->> 'kind' = 'new_message';
  delete from public.notifications where kind = 'new_message';
  delete from public.conversation_blocks;
  delete from public.conversation_reads;
  delete from public.messages;
  update public.conversations set last_message_at = now() - interval '3 hours';
$$;

-- The fixture --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key in ('release_messaging', 'release_partner_directories');
select set_config('t.t0', (date_trunc('minute', now()) - interval '2 hours')::text, false) as t0 \gset
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
select pg_temp.new_user(u) from unnest(array[:'padm', :'radm', :'u2', :'adm3', :'mem2', :'st_admin']::uuid[]) u;
update public.profiles set account_kind = intended_account_kind where id in (:'padm', :'radm', :'u2', :'adm3', :'mem2', :'st_admin');
insert into public.platform_staff (user_id, role) values (:'st_admin', 'admin');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  (:'acme', :'adm3', 'admin', now()), (:'acme', :'mem2', 'member', now()), (:'acme', :'sus', 'admin', now()),
  (:'acme', :'gone', 'admin', now()), (:'acme', :'late', 'admin', now()), (:'acme', :'oth', 'admin', now());

create function pg_temp.partner(p_slug text, p_name text, p_owner uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'recruitment_company', p_slug, 'Legal ' || p_name || ' Ltd', p_name, 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  return v_id;
end;
$$;

select pg_temp.partner('rekrut-v67', 'Rekrut', :'padm') as rek \gset
select pg_temp.partner('second-v67', 'Second', :'u2') as sec \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'rek', :'radm', 'admin', now());

insert into public.workforce_requirements (
  organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
  recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on
) values (
  :'acme', 'Acme welders', 10, 'DE', 'Hamburg', 'C', current_date + 60, 'full_time', 'both', 'both', 'open',
  'job_order_marketplace', true, now() - interval '10 days', current_date + 90
) returning id as r \gset
insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (:'r', '7212', 10);
insert into public.requirement_countries (requirement_id, country_code) values (:'r', 'DE');
insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, status, source, answered_at)
values (:'r', :'rek', :'acme', 'accepted', 'directory', now()) returning id as inv_rek \gset
insert into public.partner_responses (
  requirement_id, organization_id, employer_organization_id, capacity, available_from, experience_note, fee_model
) values (:'r', :'sec', :'acme', 5, current_date + 60, 'Twenty welders placed in Hamburg last year.', 'on_request')
returning id as resp \gset

select pg_temp.open_job('Welder Hamburg') as job \gset
select pg_temp.open_job('Beta welder', :'beta') as bjob \gset
select pg_temp.apply_as(:'wa', :'job') as applied \gset
select current_setting('t.app') as app \gset
select pg_temp.apply_as(:'wb', :'bjob') as applied \gset
select current_setting('t.app') as app_beta \gset

-- Structure, setting and schedule (AC9, NFR-O5, NFR-S8) ---------------------------------------------------------------------

select is(
  (select string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text) from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname in ('queue_message_emails', 'new_message_payload', 'notification_payload')
     and p.prosecdef and p.proconfig @> array['search_path=""']
     and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute')),
  'private.new_message_payload(jsonb),private.notification_payload(text,jsonb),private.queue_message_emails(timestamp with time zone)',
  'the job and the payload are security definer with an empty search path and callable by no API role');
select is(
  (select format('%s|%s', k.mandatory, k.default_email) || '|' || k.audience || '|' || k.label || '|' || k.release_key
   from private.notification_kinds k where k.kind = 'new_message'),
  'f|t|all|New messages|release_messaging',
  'FR-T1: new_message is an optional kind, emailed by default, for workers and company users, behind release_messaging');
select is(
  (select r.value_type || ':' || r.min || '-' || r.max || ':' || s.value::text || ':' || r.editable
   from private.setting_rules r join private.settings s on s.key = r.key where r.key = 'message_email_delay_minutes'),
  'integer:5-1440:15:true', 'AC9, NFR-O5: the delay is a setting of the audited editor, 5 to 1,440 minutes, 15 by default');
select is(
  pg_temp.read_as(:'st_admin', $$select public.admin_set_setting('message_email_delay_minutes', '0', 'Send message emails at once')::text$$),
  'P0001|CHARA_INVALID_INPUT|value', 'AC9: 0 minutes is refused when the setting is written');
select is(
  (select count(*) from cron.job where jobname = 'queue-message-emails' and schedule = '* * * * *'
     and command = 'select private.queue_message_emails()'),
  1::bigint, 'AC9: a job runs the function every minute');
select is(
  (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
   where a.attrelid = 'public.conversation_reads'::regclass and a.attnum > 0 and not a.attisdropped
     and not has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')),
  'last_emailed_at', 'NFR-S8: when a user was emailed is not readable through the Data API');

-- The release switch ---------------------------------------------------------------------------------------------------------

update private.settings set value = 'true' where key = 'release_partner_directories';
select is(
  pg_temp.read_as(:'wa', $$select count(*)::text from public.notification_kind_catalogue() where kind = 'new_message'$$, 'aal1')
    || ';' || pg_temp.read_as(:'wa', $$select 'ok' from public.set_notification_preferences('{"new_message": false}'::jsonb)$$, 'aal1'),
  '0;P0001|CHARA_INVALID_INPUT|p_kinds',
  'V59: while release_messaging is off the kind is not offered and its switch is refused');
select is(private.queue_message_emails(now()), 0, 'nothing is queued while release_messaging is off');

update private.settings set value = 'true' where key = 'release_messaging';
select pg_temp.open(:'adm', 'application', :'app') as c_app \gset
select pg_temp.open(:'adm2', 'application', :'app_beta') as c_beta \gset
select pg_temp.open(:'radm', 'requirement_invitation', :'inv_rek') as c_inv \gset
select pg_temp.open(:'u2', 'partner_response', :'resp') as c_resp \gset
select set_config('t.c_app', :'c_app', false) as done \gset
select set_config('t.c_inv', :'c_inv', false) as done \gset
select pg_temp.reset() as done \gset

select is(
  pg_temp.read_as(:'wa', $$select label || ':' || email_enabled from public.notification_kind_catalogue() where kind = 'new_message'$$, 'aal1')
    || ';' || pg_temp.read_as(:'own1', $$select label || ':' || email_enabled from public.notification_kind_catalogue() where kind = 'new_message'$$, 'aal1')
    || ';' || pg_temp.read_as(:'padm', $$select label || ':' || email_enabled from public.notification_kind_catalogue() where kind = 'new_message'$$, 'aal1'),
  'New messages:true;New messages:true;New messages:true',
  'FR-T1 AC11, FR-P4 AC11: a worker, an employer and a partner company user each get the switch, on by default');

create temp table delay_rule as select * from private.setting_rules where key = 'message_email_delay_minutes';
delete from private.settings where key = 'message_email_delay_minutes';
select pg_temp.say(:'c_app', null, :'wa', 0) as done \gset
select throws_ok($$select private.queue_message_emails(pg_temp.at(30))$$, 'P0001', 'CHARA_SETTING_MISSING',
  'AC9: with the setting missing the job fails with CHARA_SETTING_MISSING');
select is((select count(*) from public.notifications where kind = 'new_message'), 0::bigint, 'AC9: and queues nothing');
insert into private.settings (key, value) values ('message_email_delay_minutes', '15');
insert into private.setting_rules select * from delay_rule;
select pg_temp.reset() as done \gset

-- AC3, AC5, AC7, AC8: one email after the delay, never before, to the right people -------------------------------------------

update public.profiles set deleted_at = now() where id = :'gone';
insert into public.notification_preferences (user_id, email_kinds) values (:'adm3', '{"new_message": false}')
on conflict (user_id) do update set email_kinds = excluded.email_kinds;
insert into public.notification_preferences (user_id, email_undeliverable_at) values (:'oth', now())
on conflict (user_id) do update set email_undeliverable_at = excluded.email_undeliverable_at;
insert into public.notification_preferences (user_id, digest) values (:'own1', true)
on conflict (user_id) do update set digest = true;

select pg_temp.say(:'c_app', :'acme', :'mem', -5, 'We look forward to your answer') as done \gset
select pg_temp.read(:'c_app', :'wa', 0) as done \gset
select pg_temp.say(:'c_app', null, :'wa', 0, 'Please pay 200 EUR for the visa') as done \gset
delete from public.organization_members where organization_id = :'acme' and user_id = :'late';

select is(pg_temp.run(14), 0, 'AC3: nothing is queued at 10:14');
select is(pg_temp.run(15), 5, 'AC3: at 10:15 the job queues for the owner, the admins and the member who wrote');
select is(
  pg_temp.items(:'own1', :'c_app') || ',' || pg_temp.queued(:'own1', :'c_app'), '1,1',
  'AC3: one notifications row of kind new_message and one pgmq message for the owner (the digest of FR-I3 does not delay it, AC6)');
select is(
  (select string_agg(n.user_id::text || ':' || n.status || ':' || coalesce(n.email_status, '-'), ',' order by n.user_id)
   from public.notifications n where n.kind = 'new_message'),
  (select string_agg(x.u::text || ':' || x.s, ',' order by x.u) from (values
    (:'own1'::uuid, 'queued:-'), (:'adm'::uuid, 'queued:-'), (:'mem'::uuid, 'queued:-'),
    (:'adm3'::uuid, 'suppressed:suppressed_by_preference'), (:'oth'::uuid, 'queued:-')) x(u, s)),
  'AC6, AC7, AC8: the owner, both admins with email and the writing member M1 are queued; the admin with message emails off keeps the in-app item only; nobody else (M2, the suspended, erased and removed admins, the candidate, Beta, Rekrut, Second)');
select is(pg_temp.queued(:'adm3', :'c_app'), 0::bigint, 'AC6: no pgmq message for the admin who turned message emails off');
select is(
  pg_temp.read_as(:'adm3', $$select string_agg(unread::text, ',') from public.my_unread_counts()$$),
  '1', 'AC6: the badge of that admin still counts the message');
select is(pg_temp.run(16), 0, 'AC3: 10:16 writes nothing more');
select is(pg_temp.run(40), 0, 'AC4: nor does a later run for the messages already covered');

select is(
  (select string_agg(k, ',' order by k) from public.notifications n, jsonb_object_keys(n.payload) k
   where n.kind = 'new_message' and n.user_id = :'own1'),
  'context_title,context_type,conversation_id,org_slug,sender_kind,sender_name,unread',
  'AC5, FR-T1 AC2: the payload holds the conversation, the sender and context labels, the count and the slug, nothing else');
select is(
  (select n.payload ->> 'conversation_id' || '|' || (n.payload ->> 'sender_name') || '|' || (n.payload ->> 'sender_kind') || '|'
     || (n.payload ->> 'context_type') || '|' || (n.payload ->> 'context_title') || '|' || (n.payload ->> 'unread') || '|'
     || (n.payload ->> 'org_slug')
   from public.notifications n where n.kind = 'new_message' and n.user_id = :'own1'),
  :'c_app' || '|Amina Okafor|worker|application|Welder Hamburg|1|' || (select slug from public.organizations where id = :'acme'),
  'AC5: the worker as Acme already sees her, the vacancy title, one unread message and the owner''s own organisation');
select is(
  (select count(*) from public.notifications n where n.kind = 'new_message' and n.payload::text ~ 'visa|EUR')
    + (select count(*) from pgmq.q_notifications q where q.message ->> 'kind' = 'new_message' and q.message::text ~ 'visa|EUR')
    + (select count(*) from audit.log l where l.metadata::text ~ 'Please pay'),
  0::bigint, 'AC5: no part of the body is in a notifications row, a pgmq message or audit.log');
select is(
  (select string_agg(r.user_id::text, ',' order by r.user_id) from public.conversation_reads r
   where r.conversation_id = :'c_app' and r.last_emailed_at = pg_temp.at(15) and r.last_read_at is null),
  (select string_agg(u::text, ',' order by u) from unnest(array[:'own1', :'adm', :'mem', :'adm3', :'oth']::uuid[]) u),
  'NFR-A3: the window of each recipient is written with the queue, and no read time is invented');

select is(
  (select public.notify_dequeue(100) is not null),
  true, 'the notify function reads the queue');
select is(
  (select n.status || ':' || n.email_status from public.notifications n where n.kind = 'new_message' and n.user_id = :'oth'),
  'suppressed:suppressed_undeliverable', 'AC8: the undeliverable address gets its row with status suppressed and no email');

-- AC3 second run: a recipient who read in time; AC7: a message to the candidate -------------------------------------------

select pg_temp.reset() as done \gset
select pg_temp.say(:'c_inv', :'rek', :'padm', 0) as done \gset
select pg_temp.read(:'c_inv', :'own1', 10) as done \gset
select pg_temp.say(:'c_app', :'acme', :'own1', 0) as done \gset
select pg_temp.run(15) as done \gset
select is(
  pg_temp.items(:'own1', :'c_inv') || ',' || pg_temp.items(:'adm', :'c_inv') || ',' || pg_temp.items(:'radm', :'c_inv')
    || ',' || pg_temp.items(:'padm', :'c_inv'),
  '0,1,0,0', 'AC3, AC7: the owner who opened the conversation at 10:10 gets nothing, the admin who did not does; the sending side nothing');
select is(
  (select string_agg(n.user_id::text, ',') from public.notifications n where n.kind = 'new_message' and n.payload ->> 'conversation_id' = :'c_app'),
  :'wa', 'AC7: for a message to a worker only the worker is the recipient');
select is(
  (select (n.payload ->> 'sender_name') || '|' || (n.payload ->> 'sender_kind') || '|' || coalesce(n.payload ->> 'org_slug', '-')
   from public.notifications n where n.kind = 'new_message' and n.user_id = :'wa'),
  'Acme Bau|organization|-', 'AC5: the worker reads the company''s display name, and the link is the worker''s own inbox');
select is(
  (select n.payload ->> 'sender_name' from public.notifications n where n.kind = 'new_message' and n.user_id = :'adm'),
  'Rekrut', 'AC5: an organisation names the sending organisation by display name');

-- AC4: one email per conversation and window -------------------------------------------------------------------------------

select pg_temp.reset() as done \gset
select count(*) as done from (select pg_temp.say(:'c_app', null, :'wa', m) from unnest(array[0, 3, 6, 9, 12, 40]) m) s \gset
select pg_temp.say(:'c_inv', :'rek', :'padm', 5) as done \gset
create temp table runs (id uuid primary key, minute integer);
do $$
begin
  for m in 0..60 loop
    perform pg_temp.run(m);
    insert into runs select n.id, m from public.notifications n where n.kind = 'new_message' and n.id not in (select id from runs);
  end loop;
end;
$$;
select is(
  (select string_agg(r.minute || ':' || case n.payload ->> 'conversation_id' when current_setting('t.c_app') then 'worker'
     else 'rekrut' end || ':' || (n.payload ->> 'unread'), ',' order by r.minute)
   from runs r join public.notifications n on n.id = r.id where n.user_id = :'own1'),
  '15:worker:5,20:rekrut:1,55:worker:6',
  'AC4: the owner is emailed at 10:15 for the first unread message, at 10:20 for Rekrut and at 10:55 for the 10:40 message, with the unread count');
select is(
  (select count(*) from runs r join public.notifications n on n.id = r.id
   where n.user_id = :'adm' and n.payload ->> 'conversation_id' = :'c_app'),
  2::bigint, 'AC4: no conversation makes two emails to one recipient inside one window');
select is(
  (select count(*) from public.notifications n where n.kind = 'new_message' and n.user_id in (:'own2', :'adm2', :'wb', :'u2', :'mem2')),
  0::bigint, 'NFR-S8: Beta, the other candidate, the other partner and the member who never wrote get nothing');
select is(private.queue_message_emails(pg_temp.at(60)), 0, 'a second run at the same time queues nothing');

-- AC2: unread counts from the database; a blocked conversation emails nobody ------------------------------------------------

select pg_temp.reset() as done \gset
select count(*) as done from (select pg_temp.say(:'c_app', null, :'wa', m) from unnest(array[0, 1, 2]) m) s \gset
select pg_temp.say(:'c_app', :'acme', :'adm', 3) as done \gset
select pg_temp.say(:'c_inv', :'rek', :'padm', 0) as done \gset
select pg_temp.say(:'c_beta', :'beta', :'adm2', 0) as done \gset
select pg_temp.read(:'c_app', :'own1', 1) as done \gset
select is(
  pg_temp.read_as(:'adm', $$select string_agg(case conversation_id when current_setting('t.c_app')::uuid then 'C1' else 'C2' end
    || '=' || unread, ',' order by unread desc) from public.my_unread_counts()$$),
  'C1=3,C2=1', 'AC2: A1 gets C1 3 and C2 1, a total of 4; own messages are never counted');
select is(
  pg_temp.read_as(:'adm', format('select ''ok'' from public.block_conversation(%L)', :'c_inv'))
    || ';' || pg_temp.read_as(:'adm', $$select sum(unread)::text from public.my_unread_counts()$$),
  'ok;4', 'AC2: C2 still counts after A1 blocked it');
select is(
  pg_temp.read_as(:'own1', $$select string_agg(unread::text, ',' order by unread) from public.my_unread_counts()$$),
  '1,1', 'AC2: A2 gets the counts of A2''s own read state');
select is(
  pg_temp.read_as(:'wa', $$select string_agg(unread::text, ',') from public.my_unread_counts()$$)
    || ';' || pg_temp.read_as(:'wb', $$select string_agg(unread::text, ',') from public.my_unread_counts()$$),
  '1;1', 'AC2: each candidate counts only the own conversations');
select is(
  pg_temp.read_as(:'adm2', format('select count(*)::text from public.my_unread_counts() where conversation_id in (%L, %L)', :'c_app', :'c_inv'))
    || ';' || pg_temp.read_as(:'radm', format('select count(*)::text from public.my_unread_counts() where conversation_id = %L', :'c_app'))
    || ';' || pg_temp.read_as(null, 'select count(*)::text from public.my_unread_counts()'),
  '0;0;42501|permission denied for function my_unread_counts|',
  'AC2: no row of a conversation reaches anyone outside it, and anonymous callers are refused');
select pg_temp.run(30) as done \gset
select is(
  (select count(*) from public.notifications n where n.kind = 'new_message' and n.payload ->> 'conversation_id' = :'c_inv'),
  0::bigint, 'a blocked conversation emails nobody');
select is(
  (select count(*) from public.notifications n where n.kind = 'new_message' and n.payload ->> 'conversation_id' = :'c_beta'
     and n.user_id = :'wb'),
  1::bigint, 'Beta''s message to its candidate is emailed to that candidate');

-- The preference switch -----------------------------------------------------------------------------------------------------

select pg_temp.read_as(:'wa', $$select 'ok' from public.set_notification_preferences('{"new_message": false}'::jsonb)$$, 'aal1')
  as saved \gset
select is(
  :'saved' || ';' || (select (email_kinds ->> 'new_message') from public.notification_preferences where user_id = :'wa')
    || ';' || (select count(*) from audit.log where action = 'notification_preferences.changed' and entity_id = :'wa'
                 and metadata -> 'kinds' -> 'new_message' = '{"from": true, "to": false}'::jsonb),
  'ok;false;1', 'FR-P4 AC11: a worker turns message emails off, and one audit row holds the old and new value');

select * from finish();
rollback;
