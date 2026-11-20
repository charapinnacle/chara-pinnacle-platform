begin;
select plan(46);

\ir apply_fixture.inc

-- Messaging limits and blocks (V66, FR-P3 AC1 to AC3, AC5 and AC8; SOP P2-28 steps Limit, Throttle and Block; decision
-- 5.3; NFR-A4, NFR-S8, NFR-S10, NFR-O5): messages_per_month in private.monthly_usage and send_message, the throttle
-- rate_limit_message_*, public.conversation_blocks, block_conversation, unblock_conversation and the blocked state of
-- get_conversation. Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner own2, admin adm2) are the employers
-- of the fixture; wa and wb the candidates; Rekrut (owner padm, admin radm) and Second (owner u2), made below, the
-- partner companies. The sends at the same time at the limit are in 196 (dblink), the reports in 195.

\set padm '00000000-0000-0000-0000-0000000f6611'
\set radm '00000000-0000-0000-0000-0000000f6612'
\set u2 '00000000-0000-0000-0000-0000000f6613'
\set st_admin '00000000-0000-0000-0000-0000000f6614'
\set st_ts '00000000-0000-0000-0000-0000000f6615'

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

create function pg_temp.send(p_user uuid, p_conv uuid, p_body text default 'Hello there', p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select ''ok'' from public.send_message(%L, %L)', p_conv, p_body), p_aal)
$$;

create function pg_temp.block(p_user uuid, p_conv uuid, p_unblock boolean default false, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select ''ok'' from public.%s(%L)',
    case when p_unblock then 'unblock_conversation' else 'block_conversation' end, p_conv), p_aal)
$$;

-- p_count messages of the side p_org in p_conv, written as the database owner, p_ago before now.
create function pg_temp.fill(p_conv uuid, p_org uuid, p_user uuid, p_count integer, p_ago interval default '1 second')
returns void
language sql as $$
  insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body, created_at)
  select p_conv, p_user, p_org, 'Earlier message ' || g, now() - p_ago from generate_series(1, p_count) g
$$;

create function pg_temp.used(p_org uuid) returns integer
language sql as $$ select private.monthly_usage(p_org, 'messages_per_month') $$;

create function pg_temp.subscribe(p_org uuid, p_plan text) returns void
language sql as $$
  delete from billing.subscriptions where organization_id = p_org;
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (p_org, p_plan, 'active', 'null');
$$;

-- The fixture --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max');
update private.settings set value = '100000' where key = 'rate_limit_message_max';
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
select pg_temp.new_user(u) from unnest(array[:'padm', :'radm', :'u2', :'st_admin', :'st_ts']::uuid[]) u;
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

select pg_temp.partner('rekrut-v66', 'Rekrut', :'padm') as rek \gset
select pg_temp.partner('second-v66', 'Second', :'u2') as sec \gset
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
select pg_temp.apply_as(:'wa', :'bjob') as applied \gset
select current_setting('t.app') as app_beta \gset

-- Structure ------------------------------------------------------------------------------------------------------------------

select is(
  (select array_agg(proname::text order by proname) from pg_proc
   where pronamespace = 'public'::regnamespace and proname in ('block_conversation', 'unblock_conversation', 'get_conversation')
     and prosecdef and proconfig @> array['search_path=""']
     and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
     and not has_function_privilege('service_role', oid, 'execute')),
  array['block_conversation', 'get_conversation', 'unblock_conversation'],
  'the block functions and get_conversation are security definer with an empty search path, for authenticated callers only');
select is(
  (select format('%s|%s', c.relrowsecurity, c.relforcerowsecurity) from pg_class c where c.oid = 'public.conversation_blocks'::regclass)
    || '|' || (has_table_privilege('authenticated', 'public.conversation_blocks', 'insert, update, delete, truncate')
      or has_any_column_privilege('authenticated', 'public.conversation_blocks', 'insert, update')
      or has_any_column_privilege('anon', 'public.conversation_blocks', 'select, insert, update'))::text,
  't|t|false', 'NFR-S8: conversation_blocks has forced RLS, no write grant and nothing for anonymous callers');
select is(
  (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
   where a.attrelid = 'public.conversation_blocks'::regclass and a.attnum > 0 and not a.attisdropped
     and not has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')),
  'blocked_by_organization_id,blocked_by_user_id', 'FR-P3 AC8: who blocked is not readable through the Data API');
select is(
  (select string_agg(r.key || ':' || s.value::text || ':' || r.min || '-' || r.max, ',' order by r.key)
   from private.setting_rules r join private.settings s on s.key = r.key
   where r.key in ('rate_limit_message_max', 'rate_limit_message_seconds') and r.editable),
  'rate_limit_message_max:100000:1-1000,rate_limit_message_seconds:60:1-3600',
  'NFR-O5: the throttle is two settings of the audited settings editor (20 messages per 60 seconds by default)');
select is(
  (select string_agg(plan_code || ':' || coalesce(limit_value::text, 'none'), ',' order by plan_code) from billing.plan_limits
   where limit_key = 'messages_per_month' and plan_code in ('employer_starter', 'employer_professional', 'employer_enterprise',
     'recruitment_partner', 'staffing_professional')),
  'employer_enterprise:2000,employer_professional:500,employer_starter:100,recruitment_partner:100,staffing_professional:500',
  'FR-P3 data: the limits are read from billing.plan_limits messages_per_month');
update private.settings set value = 'false' where key = 'release_messaging';
select is(pg_temp.block(:'adm', gen_random_uuid()), '42501|CHARA_FORBIDDEN|release_off',
  'the block functions refuse to run while release_messaging is off');

update private.settings set value = 'true' where key = 'release_messaging';

select pg_temp.open(:'adm', 'application', :'app') as c_app \gset
select pg_temp.open(:'adm2', 'application', :'app_beta') as c_beta \gset
select pg_temp.open(:'radm', 'requirement_invitation', :'inv_rek') as c_inv \gset
select pg_temp.open(:'u2', 'partner_response', :'resp') as c_resp \gset

-- AC1: the monthly limit at the boundary -----------------------------------------------------------------------------------

select pg_temp.subscribe(:'acme', 'employer_starter') as done \gset
select pg_temp.subscribe(:'beta', 'employer_professional') as done \gset
select pg_temp.subscribe(:'rek', 'recruitment_partner') as done \gset
select pg_temp.subscribe(:'sec', 'recruitment_professional') as done \gset
select pg_temp.fill(:'c_app', :'acme', :'own1', 40) as done \gset
select pg_temp.fill(:'c_inv', :'acme', :'adm', 30) as done \gset
select pg_temp.fill(:'c_resp', :'acme', :'mem', 29) as done \gset
select pg_temp.fill(:'c_beta', :'beta', :'adm2', 499) as done \gset
select pg_temp.fill(:'c_inv', :'rek', :'padm', 99) as done \gset
select pg_temp.fill(:'c_resp', :'sec', :'u2', 499) as done \gset
select pg_temp.fill(:'c_app', null, :'wa', 7) as done \gset

select is(
  pg_temp.used(:'acme') || ',' || pg_temp.used(:'beta') || ',' || pg_temp.used(:'rek') || ',' || pg_temp.used(:'sec'),
  '99,499,99,499', 'FR-P3 data: the usage counts the messages of the organisation''s members in every conversation, never the candidate''s');
select is(
  pg_temp.send(:'mem', :'c_app') || ';' || pg_temp.send(:'adm2', :'c_beta') || ';' || pg_temp.send(:'radm', :'c_inv')
    || ';' || pg_temp.send(:'u2', :'c_resp'),
  'ok;ok;ok;ok', 'FR-P3 AC1: with entitlements_enforced false nothing is blocked');
delete from public.messages where body = 'Hello there';

update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(
  pg_temp.send(:'mem', :'c_app') || ';' || pg_temp.send(:'adm2', :'c_beta') || ';' || pg_temp.send(:'radm', :'c_inv')
    || ';' || pg_temp.send(:'u2', :'c_resp'),
  'ok;ok;ok;ok', 'FR-P3 AC1: the first message of each organisation is stored, reaching 100, 500, 100 and 500');
select is(
  pg_temp.send(:'mem', :'c_app') || ';' || pg_temp.send(:'adm2', :'c_beta') || ';' || pg_temp.send(:'radm', :'c_inv')
    || ';' || pg_temp.send(:'u2', :'c_resp'),
  'P0001|CHARA_LIMIT_REACHED|messages_per_month;P0001|CHARA_LIMIT_REACHED|messages_per_month;P0001|CHARA_LIMIT_REACHED|messages_per_month;P0001|CHARA_LIMIT_REACHED|messages_per_month',
  'FR-P3 AC1: the second fails with CHARA_LIMIT_REACHED messages_per_month');
select is(
  pg_temp.used(:'acme') || ',' || pg_temp.used(:'beta') || ',' || pg_temp.used(:'rek') || ',' || pg_temp.used(:'sec')
    || '|' || (select count(*) from public.messages where body = 'Hello there'),
  '100,500,100,500|4', 'FR-P3 AC1: the refused messages are not stored');
select is(
  pg_temp.send(:'own1', :'c_inv') || ';' || pg_temp.send(:'adm', :'c_resp'),
  'P0001|CHARA_LIMIT_REACHED|messages_per_month;P0001|CHARA_LIMIT_REACHED|messages_per_month',
  'FR-P3 AC1: the limit is the organisation''s, for every member and every conversation');

select pg_temp.subscribe(:'beta', 'employer_enterprise') as done \gset
select pg_temp.fill(:'c_beta', :'beta', :'adm2', 1499) as done \gset
select is(pg_temp.send(:'own2', :'c_beta') || ';' || pg_temp.send(:'adm2', :'c_beta'),
  'ok;P0001|CHARA_LIMIT_REACHED|messages_per_month', 'FR-P3 AC1: Enterprise stores the 2,000th message and refuses the next');
update billing.plan_limits set limit_value = null where plan_code = 'employer_enterprise' and limit_key = 'messages_per_month';
select is(pg_temp.send(:'adm2', :'c_beta'), 'ok', 'FR-P3 AC1: a plan with a null limit value never blocks');
update billing.plan_limits set limit_value = 2000 where plan_code = 'employer_enterprise' and limit_key = 'messages_per_month';

update private.settings set value = 'true' where key = 'release_partner_directories';
select is(
  pg_temp.read_as(:'mem', format($$select concat_ws('|', used, limit_value, applies, plan_name)
    from public.org_usage(%L, array['messages_per_month'])$$, :'acme'), 'aal1'),
  '100|100|t|Basic', 'FR-P3 AC4 data: a member reads the usage, the limit and the plan name the composer prompt shows');

-- AC2: workers are never counted or limited ----------------------------------------------------------------------------

select is(
  pg_temp.send(:'wa', :'c_app', 'One', 'aal1') || ';' || pg_temp.send(:'wa', :'c_app', 'Two', 'aal1') || ';'
    || pg_temp.send(:'wa', :'c_app', 'Three', 'aal1') || ';' || pg_temp.send(:'wa', :'c_app', 'Four', 'aal1') || ';'
    || pg_temp.send(:'wa', :'c_app', 'Five', 'aal1'),
  'ok;ok;ok;ok;ok', 'FR-P3 AC2: the candidate sends 5 messages to Acme at 100 of 100');
select is(
  pg_temp.used(:'acme') || '|' || pg_temp.send(:'mem', :'c_app'),
  '100|P0001|CHARA_LIMIT_REACHED|messages_per_month', 'FR-P3 AC2: Acme''s usage stays 100 and its members are still refused');
select is(
  pg_temp.send(:'wa', :'c_beta', 'Still free', 'aal1'), 'ok',
  'FR-P3 AC2: the candidate is not limited by Beta''s plan either');

-- AC3: the calendar month ------------------------------------------------------------------------------------------------

delete from public.messages where sender_organization_id = :'acme';
select pg_temp.fill(:'c_app', :'acme', :'own1', 100, now() - private.month_start() + interval '1 minute') as done \gset
select pg_temp.fill(:'c_app', :'acme', :'own1', 99, now() - private.month_start()) as done \gset
select is(pg_temp.used(:'acme'), 99,
  'FR-P3 AC3: the messages of the previous month are not counted, those from the first instant of the month are');
select is(pg_temp.send(:'mem', :'c_app') || ';' || pg_temp.send(:'mem', :'c_app'), 'ok;P0001|CHARA_LIMIT_REACHED|messages_per_month',
  'FR-P3 AC3: the month''s 100th message is stored and the next refused, whatever the month before sent');

update private.settings set value = 'false' where key = 'entitlements_enforced';

-- AC5: the per-user throttle -------------------------------------------------------------------------------------------

update private.settings set value = '20' where key = 'rate_limit_message_max';
delete from private.rate_limit_hits where action = 'user:message';
select is(
  (select string_agg(pg_temp.send(:'mem', :'c_resp', 'Throttle ' || g), ';') from generate_series(1, 20) g),
  (select string_agg('ok', ';') from generate_series(1, 20)), 'FR-P3 AC5: a member sends 20 messages within the window');
select is(pg_temp.send(:'mem', :'c_resp', 'Throttle 21'), 'P0001|CHARA_RATE_LIMITED|', 'FR-P3 AC5: the 21st is refused');
select is(
  (select string_agg(pg_temp.send(:'wa', :'c_app', 'Worker ' || g, 'aal1'), ';') from generate_series(1, 21) g),
  (select string_agg('ok', ';') from generate_series(1, 20)) || ';P0001|CHARA_RATE_LIMITED|',
  'FR-P3 AC5: the throttle applies to the candidate too');
select is(
  (select count(*) from public.messages where body in ('Throttle 21', 'Worker 21')) || '|'
    || (select count(*) from public.messages where body like 'Throttle %' and sender_organization_id = :'acme'),
  '0|20', 'FR-P3 AC5: a throttled message is not stored, so it is not counted against the monthly limit');
select is(pg_temp.send(:'adm', :'c_resp', 'Another member'), 'ok', 'FR-P3 AC5: the throttle is per user, not per organisation');
update private.rate_limit_hits set expires_at = now() - interval '1 second' where action = 'user:message';
select is(pg_temp.send(:'mem', :'c_resp', 'After the window') || ';' || pg_temp.send(:'wa', :'c_app', 'After the window', 'aal1'),
  'ok;ok', 'FR-P3 AC5: after the window has passed, both send again');
delete from private.settings where key = 'rate_limit_message_max';
select is(pg_temp.send(:'mem', :'c_resp', 'No setting'), 'P0001|CHARA_SETTING_MISSING|rate_limit_message',
  'FR-P3 AC5: a missing setting refuses the message rather than lifting the throttle');
insert into private.settings (key, value) values ('rate_limit_message_max', '100000');
insert into private.setting_rules (key, value_type, min, max, label) values
  ('rate_limit_message_max', 'integer', 1, 1000, 'Most messages one person may send in the throttle window') on conflict (key) do nothing;

-- AC8: blocking a conversation --------------------------------------------------------------------------------------------

create function pg_temp.state(p_user uuid, p_conv uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select concat_ws(''|'', coalesce(read_only_reason, ''-''), blocked_by_me) from public.get_conversation(%L)', p_conv), p_aal)
$$;

select (select count(*) from public.notifications) + (select count(*) from pgmq.q_notifications) as notes_before \gset
select is(pg_temp.block(:'wa', :'c_app', false, 'aal1'), 'ok', 'FR-P3 AC8: the candidate blocks the conversation');
select is(
  pg_temp.send(:'mem', :'c_app', 'Hi', 'aal1') || ';' || pg_temp.send(:'wa', :'c_app', 'Hi', 'aal1'),
  '42501|CHARA_FORBIDDEN|blocked;42501|CHARA_FORBIDDEN|blocked', 'FR-P3 AC8: neither side can send, the blocker included');
select is(
  pg_temp.state(:'wa', :'c_app', 'aal1') || ';' || pg_temp.state(:'mem', :'c_app', 'aal1') || ';' || pg_temp.state(:'adm', :'c_app'),
  'blocked|t;blocked|f;blocked|f', 'FR-P3 AC8: both sides read that it is closed for messages; only the blocker that it was them');
select is(
  pg_temp.read_as(:'mem', format('select (count(*) > 0)::text from public.list_messages(%L)', :'c_app'), 'aal1') || ';'
    || pg_temp.read_as(:'wa', format('select (count(*) > 0)::text from public.list_messages(%L)', :'c_app'), 'aal1'),
  'true;true', 'FR-P3 AC8: both sides keep reading the history');
select is(
  pg_temp.read_as(:'adm', format('select read_only_reason from public.list_conversations(%L) where id = %L', :'acme', :'c_app')),
  'blocked', 'FR-P3 AC8: the inbox shows it closed for messages');
select is(
  pg_temp.block(:'adm', :'c_app', true) || ';' || pg_temp.block(:'own1', :'c_app', true),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|', 'FR-P3 AC8: the other side cannot unblock it');
select is(
  pg_temp.block(:'mem', :'c_app', false, 'aal1') || ';' || pg_temp.block(:'wa', :'c_app', false, 'aal1'),
  'P0001|CHARA_INVALID_STATE|blocked;P0001|CHARA_INVALID_STATE|blocked', 'FR-P3 AC8: a blocked conversation is not blocked twice');
select is(
  pg_temp.read_as(:'own1', format('select count(*)::text from public.conversation_blocks where conversation_id = %L', :'c_app'))
    || ';' || pg_temp.read_as(:'mem', format('select count(*)::text from public.conversation_blocks where conversation_id = %L', :'c_app'), 'aal1')
    || ';' || pg_temp.read_as(:'wa', format('select count(*)::text from public.conversation_blocks where conversation_id = %L', :'c_app'), 'aal1'),
  '1;1;1', 'FR-P3 AC8: the participants read the block');
select is(
  pg_temp.read_as(:'adm2', 'select count(*)::text from public.conversation_blocks') || ';'
    || pg_temp.read_as(:'own2', 'select count(*)::text from public.conversation_blocks') || ';'
    || pg_temp.read_as(:'wb', 'select count(*)::text from public.conversation_blocks', 'aal1') || ';'
    || pg_temp.read_as(:'padm', 'select count(*)::text from public.conversation_blocks') || ';'
    || pg_temp.read_as(:'u2', 'select count(*)::text from public.conversation_blocks') || ';'
    || pg_temp.read_as(:'st_ts', 'select count(*)::text from public.conversation_blocks') || ';'
    || pg_temp.read_as(:'st_admin', 'select count(*)::text from public.conversation_blocks') || ';'
    || split_part(pg_temp.read_as(null, 'select count(*)::text from public.conversation_blocks'), '|', 1),
  '0;0;0;0;0;0;0;42501',
  'NFR-S8: the other employer, the other candidate, both partners and staff read no block; an anonymous caller is refused');
select is(
  split_part(pg_temp.read_as(:'wa', 'select blocked_by_user_id::text from public.conversation_blocks', 'aal1'), '|', 1) || ';'
    || split_part(pg_temp.read_as(:'wa', format('insert into public.conversation_blocks (conversation_id, blocked_by_user_id) values (%L, %L) returning 1', :'c_beta', :'wa'), 'aal1'), '|', 1)
    || ';' || split_part(pg_temp.read_as(:'wa', 'delete from public.conversation_blocks returning 1', 'aal1'), '|', 1),
  '42501;42501;42501', 'FR-P3 AC8: who blocked is not selectable, and a block is not written or removed directly');
select is(
  pg_temp.block(:'adm2', :'c_app') || ';' || pg_temp.block(:'wb', :'c_app', false, 'aal1') || ';' || pg_temp.block(:'padm', :'c_app')
    || ';' || pg_temp.block(:'st_ts', :'c_app') || ';' || pg_temp.block(:'adm2', :'c_app', true),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|',
  'NFR-S8: another employer, another candidate, a partner and staff neither block nor unblock');
select is(
  split_part(pg_temp.read_as(null, format('select public.block_conversation(%L)', :'c_inv')), '|', 1)
    || ';' || pg_temp.block(:'own1', :'c_inv', false, 'aal1'),
  '42501;P0001|CHARA_FORBIDDEN|aal2_required', 'an anonymous caller is refused, an owner at aal1 is sent to two-step verification');
select is(pg_temp.block(:'wa', :'c_app', true, 'aal1'), 'ok', 'FR-P3 AC8: the blocker unblocks');
select is(
  pg_temp.send(:'mem', :'c_app', 'Hi again', 'aal1') || ';' || pg_temp.state(:'mem', :'c_app', 'aal1') || ';'
    || pg_temp.block(:'wa', :'c_app', true, 'aal1'),
  'ok;-|f;P0001|CHARA_INVALID_STATE|not_blocked', 'FR-P3 AC8: sending works again; a second unblock finds nothing to lift');

select is(pg_temp.block(:'mem', :'c_inv', false, 'aal1'), 'ok', 'FR-P3 AC8: a member blocks for the organisation''s side');
select is(
  pg_temp.block(:'adm', :'c_inv', true) || ';' || pg_temp.block(:'radm', :'c_inv', true) || ';'
    || pg_temp.send(:'radm', :'c_inv', 'Hi'),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|blocked',
  'FR-P3 AC8: only the blocking user unblocks, not another member of the same side; the partner cannot send');
select is(pg_temp.block(:'mem', :'c_inv', true, 'aal1'), 'ok', 'FR-P3 AC8: the member who blocked unblocks');
select is(
  (select string_agg(action || ':' || coalesce(metadata ->> 'organization_id', 'candidate'), ',' order by id) from audit.log
   where action in ('conversation.blocked', 'conversation.unblocked') and entity_id in (:'c_app', :'c_inv')),
  'conversation.blocked:candidate,conversation.unblocked:candidate,conversation.blocked:' || :'acme' || ',conversation.unblocked:' || :'acme',
  'FR-P3 AC8: each block and unblock writes one audit row');
select is(
  (select count(*) from public.notifications) + (select count(*) from pgmq.q_notifications),
  :'notes_before'::bigint, 'FR-P3 AC8: no notice is queued for the other side');

select * from finish();
rollback;
