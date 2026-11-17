begin;
select plan(26);

\ir apply_fixture.inc

-- Realtime for conversations (V64, FR-P1 AC5 and AC8, the badge signal of FR-P4 AC1; NFR-S8): the policy
-- conversation_topic_receive_participant on realtime.messages and the broadcasts of messages and read state. Acme (t.a:
-- owner own1, admin adm, member mem) and Beta (t.b: owner own2, admin adm2) are the employers of the fixture; wa and wb the
-- candidates; Rekrut and Second, made below, the partner companies. Who may join a topic is the policies' own expression
-- evaluated for a row of that topic, so it is checked where no partition of realtime.messages covers today (the local
-- stack and CI run without the Realtime service, which makes them); the checks of stored broadcasts are skipped there.

\set padm '00000000-0000-0000-0000-0000000f6411'
\set radm '00000000-0000-0000-0000-0000000f6412'
\set u2 '00000000-0000-0000-0000-0000000f6413'
\set st_admin '00000000-0000-0000-0000-0000000f6414'
\set st_ts '00000000-0000-0000-0000-0000000f6415'

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

create function pg_temp.open(p_user uuid, p_type text, p_id uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select public.open_conversation(%L, %L)::text', p_type, p_id), p_aal)
$$;

create function pg_temp.send(p_user uuid, p_conv uuid, p_body text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select id::text from public.send_message(%L, %L)', p_conv, p_body), p_aal)
$$;

-- Whether p_user at p_aal may join p_topic: the select policies of realtime.messages for authenticated, as RLS combines
-- them, evaluated as that user for a broadcast row of the topic while realtime.topic() names it, as the Realtime service
-- sets it on join.
create function pg_temp.may_join(p_user uuid, p_topic text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_quals text;
begin
  select string_agg('(' || pg_get_expr(p.polqual, p.polrelid) || ')', ' or ') into v_quals
  from pg_policy p
  where p.polrelid = 'realtime.messages'::regclass and p.polcmd in ('r', '*') and p.polpermissive
    and 'authenticated'::regrole = any (p.polroles);
  perform set_config('realtime.topic', p_topic, true);
  return pg_temp.read_as(p_user,
    format('select coalesce((%s), false)::text from (values (''broadcast''::text, %L::text)) messages(extension, topic)', v_quals, p_topic),
    p_aal);
end;
$$;

-- The partitions of realtime.messages are made by the Realtime service; where none covers today, realtime.send drops the
-- broadcast with a warning.
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

create function pg_temp.broadcasts(p_topic text, p_event text) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(m.payload - 'id' order by m.inserted_at, m.id), '[]')
  from realtime.messages m where m.topic = p_topic and m.event = p_event and m.private
$$;

-- The fixture --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max');
select current_setting('t.a') as acme \gset
select pg_temp.new_user(:'padm') as seeded \gset
select pg_temp.new_user(:'radm') as seeded \gset
select pg_temp.new_user(:'u2') as seeded \gset
select pg_temp.new_user(:'st_admin') as seeded \gset
select pg_temp.new_user(:'st_ts') as seeded \gset
update public.profiles set account_kind = intended_account_kind where id in (:'padm', :'radm', :'u2', :'st_admin', :'st_ts');
insert into public.platform_staff (user_id, role) values (:'st_admin', 'admin'), (:'st_ts', 'trust_safety');

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

select pg_temp.partner('rekrut-v64', 'Rekrut', :'padm') as rek \gset
select pg_temp.partner('second-v64', 'Second', :'u2') as sec \gset
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

select pg_temp.open_job('Welder Hamburg') as job \gset
select pg_temp.apply_as(:'wa', :'job') as applied \gset
select current_setting('t.app') as app \gset

update private.settings set value = 'true' where key = 'release_messaging';
select pg_temp.open(:'adm', 'application', :'app') as c_app \gset
select pg_temp.open(:'radm', 'requirement_invitation', :'inv_rek') as c_inv \gset

-- Structure ------------------------------------------------------------------------------------------------------------------

select is(
  (select count(*)::integer from pg_proc
   where pronamespace = 'private'::regnamespace
     and proname in ('conversation_recipients', 'broadcast_new_message', 'broadcast_conversation_read')
     and prosecdef and proconfig @> array['search_path=""']
     and not has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
     and not has_function_privilege('service_role', oid, 'execute')),
  3, 'the broadcast functions are security definer with an empty search path and callable by no API role');
select is(
  (select count(*) from pg_policy p where p.polrelid = 'realtime.messages'::regclass and p.polcmd in ('a', 'w', '*')), 0::bigint,
  'FR-P1 AC8: no policy on realtime.messages allows insert, update or all, so no client sends on a conversation topic');
select is(
  (select string_agg(tgname, ',' order by tgname) from pg_trigger
   where tgrelid in ('public.messages'::regclass, 'public.conversation_reads'::regclass) and not tgisinternal),
  'conversation_reads_broadcast,messages_broadcast', 'one broadcast trigger on messages and one on read state');

-- Who joins conversation:<id> (FR-P1 AC5, AC8; NFR-S8) --------------------------------------------------------------------

select is(
  pg_temp.may_join(:'own1', 'conversation:' || :'c_app') || ';' || pg_temp.may_join(:'adm', 'conversation:' || :'c_app') || ';'
    || pg_temp.may_join(:'mem', 'conversation:' || :'c_app', 'aal1') || ';' || pg_temp.may_join(:'wa', 'conversation:' || :'c_app', 'aal1'),
  'true;true;true;true', 'FR-P1 AC8: the owner, an admin and a member of Acme and the candidate join the conversation topic');
select is(
  pg_temp.may_join(:'radm', 'conversation:' || :'c_inv') || ';' || pg_temp.may_join(:'padm', 'conversation:' || :'c_inv'),
  'true;true', 'FR-P1 AC8: both members of the partner company join the topic of its conversation with Acme');
select is(
  pg_temp.may_join(:'adm2', 'conversation:' || :'c_app') || ';' || pg_temp.may_join(:'own2', 'conversation:' || :'c_app'),
  'false;false', 'FR-P1 AC8, NFR-S8: an admin and the owner of Beta, who know the id, are refused');
select is(
  pg_temp.may_join(:'radm', 'conversation:' || :'c_app') || ';' || pg_temp.may_join(:'u2', 'conversation:' || :'c_inv'),
  'false;false', 'NFR-S8: a partner company is refused the topic of another party''s conversation, and the second partner that of Rekrut');
select is(
  pg_temp.may_join(:'wb', 'conversation:' || :'c_app', 'aal1') || ';' || pg_temp.may_join(:'wa', 'conversation:' || :'c_inv', 'aal1'),
  'false;false', 'NFR-S8: another candidate is refused, and the candidate is refused a conversation between organisations');
select is(
  pg_temp.may_join(:'st_admin', 'conversation:' || :'c_app') || ';' || pg_temp.may_join(:'st_ts', 'conversation:' || :'c_app'),
  'false;false', 'FR-P1 AC4: a Platform Administrator and a Trust & Safety Administrator are refused');
select is(pg_temp.may_join(:'adm', 'conversation:' || :'c_app', 'aal1'), 'false',
  'an admin at aal1 is refused, as the conversation tables refuse applicant data to owners and admins below aal2');
select is(
  pg_temp.may_join(:'wa', 'conversation:' || :'c_app' || 'x', 'aal1') || ';' || pg_temp.may_join(:'wa', 'conversation:not-a-uuid', 'aal1')
    || ';' || pg_temp.may_join(:'wa', 'Conversation:' || :'c_app', 'aal1') || ';' || pg_temp.may_join(:'wa', 'conversation:', 'aal1'),
  'false;false;false;false', 'a topic that is not exactly conversation:<uuid> is refused without an error');
select is(pg_temp.may_join(:'wa', 'user:' || :'wa', 'aal1') || ';' || pg_temp.may_join(:'wa', 'user:' || :'wb', 'aal1'),
  'true;false', 'the own user topic of V02 is unchanged');
select set_config('realtime.topic', 'conversation:' || :'c_app', true);
select is(pg_temp.read_as(null, 'select count(*)::text from realtime.messages'), '0',
  'NFR-S8: an anonymous caller receives nothing on a conversation topic');

-- Broadcasts ------------------------------------------------------------------------------------------------------------------

select pg_temp.send(:'wa', :'c_app', 'Can I start in March?', 'aal1') as m1 \gset
select ok(:'m1' ~ '^[0-9a-f-]{36}$', 'the candidate sends a message');
select case when pg_temp.realtime_ready() then is(
  (select jsonb_agg(m.payload) from realtime.messages m where m.topic = 'conversation:' || :'c_app' and m.event = 'message' and m.private),
  jsonb_build_array(jsonb_build_object('id', :'m1', 'created_at', (select created_at from public.messages where id = :'m1'))),
  'FR-P1 AC8: the message is broadcast on its conversation topic with its id and time only, never the body or the sender'
) else skip('no partition of realtime.messages covers today') end;
select case when pg_temp.realtime_ready() then is(
  (select string_agg(u::text, ',' order by u) from unnest(array[:'own1', :'adm', :'mem']::uuid[]) u
   where pg_temp.broadcasts('user:' || u, 'messages_unread') = jsonb_build_array(jsonb_build_object('conversation_id', :'c_app'))),
  (select string_agg(u::text, ',' order by u) from unnest(array[:'own1', :'adm', :'mem']::uuid[]) u),
  'FR-P4 AC1: every member of Acme gets one messages_unread signal with the conversation id only'
) else skip('no partition of realtime.messages covers today') end;
select case when pg_temp.realtime_ready() then is(
  (select count(*)::integer from realtime.messages
   where event = 'messages_unread' and topic in ('user:' || :'wa', 'user:' || :'own2', 'user:' || :'adm2', 'user:' || :'radm')),
  0, 'the sender''s own side, Beta and Rekrut get no signal'
) else skip('no partition of realtime.messages covers today') end;

select pg_temp.send(:'mem', :'c_app', 'Yes, from 1 March', 'aal1') as m2 \gset
select case when pg_temp.realtime_ready() then is(
  jsonb_array_length(pg_temp.broadcasts('user:' || :'wa', 'messages_unread')) || ';'
    || jsonb_array_length(pg_temp.broadcasts('user:' || :'own1', 'messages_unread')),
  '1;1', 'a member''s message signals the candidate and none of Acme'
) else skip('no partition of realtime.messages covers today') end;

select pg_temp.send(:'radm', :'c_inv', 'We have ten welders', 'aal2') as m3 \gset
select case when pg_temp.realtime_ready() then is(
  jsonb_array_length(pg_temp.broadcasts('user:' || :'adm', 'messages_unread')) || ';'
    || jsonb_array_length(pg_temp.broadcasts('user:' || :'padm', 'messages_unread')) || ';'
    || jsonb_array_length(pg_temp.broadcasts('conversation:' || :'c_inv', 'message')),
  '2;0;1', 'between organisations, the other organisation''s members are signalled and the message is broadcast once'
) else skip('no partition of realtime.messages covers today') end;

select pg_temp.read_as(:'wa', format('select public.mark_conversation_read(%L)::text', :'c_app'), 'aal1') as read_at \gset
select case when pg_temp.realtime_ready() then is(
  jsonb_array_length(pg_temp.broadcasts('user:' || :'wa', 'messages_unread')) || ';'
    || (select count(*) from realtime.messages where topic = 'conversation:' || :'c_app' and event <> 'message'),
  '2;0', 'FR-P4 AC1: reading signals the reader''s own topic, so the badge of the other tabs drops; the other side learns nothing'
) else skip('no partition of realtime.messages covers today') end;

select set_config('realtime.topic', 'conversation:' || :'c_app', true);
select case when pg_temp.realtime_ready() then is(
  pg_temp.read_as(:'wa', 'select count(*)::text from realtime.messages', 'aal1') || ';'
    || pg_temp.read_as(:'adm2', 'select count(*)::text from realtime.messages'),
  '2;0', 'FR-P1 AC8: the candidate receives the two broadcasts of the topic, an admin of Beta none'
) else skip('no partition of realtime.messages covers today') end;
select set_config('realtime.topic', 'conversation:' || :'c_app', true);
select case when pg_temp.realtime_ready() then alike(
  pg_temp.read_as(:'wa', format($$insert into realtime.messages (topic, extension, event, payload, private)
    values ('conversation:%s', 'broadcast', 'message', '{}', true)$$, :'c_app'), 'aal1'),
  '42501|%', 'FR-P1 AC8: a participant cannot send on the conversation topic'
) else skip('no partition of realtime.messages covers today') end;

-- AC5: a removed member loses the topic at once ------------------------------------------------------------------------------

delete from public.organization_members where organization_id = :'acme' and user_id = :'mem';
select is(pg_temp.may_join(:'mem', 'conversation:' || :'c_app', 'aal1'), 'false',
  'FR-P1 AC5: once removed, the member is refused the conversation topic');
select pg_temp.send(:'wa', :'c_app', 'Thank you', 'aal1') as m4 \gset
select case when pg_temp.realtime_ready() then is(
  jsonb_array_length(pg_temp.broadcasts('user:' || :'mem', 'messages_unread')) || ';'
    || jsonb_array_length(pg_temp.broadcasts('user:' || :'own1', 'messages_unread')),
  '2;3', 'FR-P1 AC5: the removed member gets no further signal, the owner does'
) else skip('no partition of realtime.messages covers today') end;

-- The switch -------------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_messaging';
select set_config('t.before', (select count(*) from realtime.messages where topic like 'conversation:%' or event = 'messages_unread')::text, true);
insert into public.messages (conversation_id, sender_organization_id, sender_user_id, body) values (:'c_app', :'acme', :'adm', 'Off');
update public.conversation_reads set last_read_at = now() where user_id = :'wa';
select is(
  (select count(*) from realtime.messages where topic like 'conversation:%' or event = 'messages_unread')::text,
  current_setting('t.before'), 'nothing is broadcast while release_messaging is off');
select ok(:'m2' ~ '^[0-9a-f-]{36}$' and :'m3' ~ '^[0-9a-f-]{36}$' and :'m4' ~ '^[0-9a-f-]{36}$' and :'read_at' <> '',
  'the sends and the read of this test succeeded');

select * from finish();
rollback;
