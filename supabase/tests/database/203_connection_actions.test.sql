begin;
select plan(70);

\ir apply_fixture.inc

-- Structured connection actions (V71; FR-P2 AC1 to AC4, AC7, AC8, AC11; NFR-S8, NFR-S9, NFR-A3, NFR-O5): public.connections,
-- messages.connection_id, send_inquiry, request_workforce, invite_to_job, set_connection_status,
-- list_conversation_connections, open_inquiry, the status triggers, the inquiry conversation and the three notices. Acme
-- (t.a: owner own1, admin adm, member mem) is on Starter and Beta (t.b: owner own2, admin adm2) on Professional; Rekrut
-- (owner, two admins, two members, lists the staffing service), Staffit (a staffing company), Plain and Extra (recruitment
-- companies without it) are listed partners on a paid plan, Pending awaits approval; Free has no plan and Lapsed a
-- canceled subscription. The candidates wa (NG) and wb (PH) of the fixture accepted contact requests of Acme; a direct
-- hiring rule blocks PH to DE. The parallel sends at the monthly limit are in 204.

\set urb '00000000-0000-0000-0000-0000000f7101'
\set ra1 '00000000-0000-0000-0000-0000000f7102'
\set ra2 '00000000-0000-0000-0000-0000000f7103'
\set rm1 '00000000-0000-0000-0000-0000000f7104'
\set rm2 '00000000-0000-0000-0000-0000000f7105'
\set ust '00000000-0000-0000-0000-0000000f7106'
\set upl '00000000-0000-0000-0000-0000000f7107'
\set uex '00000000-0000-0000-0000-0000000f7108'
\set upe '00000000-0000-0000-0000-0000000f7109'
\set ufe '00000000-0000-0000-0000-0000000f7110'
\set ula '00000000-0000-0000-0000-0000000f7111'

update private.settings set value = 'true' where key in ('release_messaging', 'release_job_orders', 'release_find_workers');
update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max');
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (:'acme', 'employer_starter', 'active', 'null'), (:'beta', 'employer_professional', 'active', 'null');

create function pg_temp.org(p_slug text, p_name text, p_owner uuid, p_type text, p_plan text, p_listed boolean default true)
returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, industry_code)
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_name, p_name, 'DE', 'C');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  if p_type <> 'employer' and p_listed then
    update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
      submitted_at = now() - interval '31 days'
    where id = v_id;
  end if;
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  end if;
  return v_id;
end;
$$;

select pg_temp.org('v71-rekrut', 'Rekrut', :'urb', 'recruitment_company', 'recruitment_partner') as rek \gset
select pg_temp.org('v71-staffit', 'Staffit', :'ust', 'staffing_company', 'staffing_partner') as stf \gset
select pg_temp.org('v71-plain', 'Plain', :'upl', 'recruitment_company', 'recruitment_partner') as pla \gset
select pg_temp.org('v71-extra', 'Extra', :'uex', 'recruitment_company', 'recruitment_partner') as ext \gset
select pg_temp.org('v71-pending', 'Pending', :'upe', 'recruitment_company', 'recruitment_partner', false) as pen \gset
select pg_temp.org('v71-free', 'Free', :'ufe', 'employer', null) as fre \gset
select pg_temp.org('v71-lapsed', 'Lapsed', :'ula', 'employer', null) as lap \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'lap', 'employer_starter', 'canceled', 'null');
insert into public.organization_service_types (organization_id, service) values (:'rek', 'staffing'), (:'pla', 'permanent');
select pg_temp.new_user(:'ra1'), pg_temp.new_user(:'ra2'), pg_temp.new_user(:'rm1'), pg_temp.new_user(:'rm2') \gset
update public.profiles set account_kind = intended_account_kind where id in (:'ra1', :'ra2', :'rm1', :'rm2');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  (:'rek', :'ra1', 'admin', now()), (:'rek', :'ra2', 'admin', now()), (:'rek', :'rm1', 'member', now()),
  (:'rek', :'rm2', 'member', now());
insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref) values
  ('PH', 'DE', 'blocked', 'Direct hiring from the Philippines to Germany is not allowed.', 'LO-1');

select pg_temp.open_job('Welder MIG/MAG') as j_open \gset
select pg_temp.seed_job('{"title": "Draft welder", "status": "draft"}') as j_draft \gset
select pg_temp.seed_job('{"title": "Paused welder", "status": "paused"}') as j_paused \gset
select pg_temp.open_job('Hidden welder', null, '{"moderation_state": "hidden"}') as j_hidden \gset
select pg_temp.open_job('Beta welder', :'beta') as j_beta \gset

-- Accepted contact requests of Acme to wa and wb, and their conversations opened by the workers.
insert into public.contact_requests (organization_id, worker_user_id, card_id, message, status, expires_at, responded_at)
select :'acme', w.user_id, w.card_id, 'Welding work in Hamburg.', 'accepted', now() + interval '30 days', now()
from public.worker_profiles w where w.user_id in (:'wa', :'wb');
select pg_temp.call_as(:'wa', 'authenticated', format($f$select set_config('t.cwa', public.open_conversation('contact_request', %L)::text, true)$f$,
  (select id from public.contact_requests where worker_user_id = :'wa')), 'aal1') as opened \gset
select pg_temp.call_as(:'wb', 'authenticated', format($f$select set_config('t.cwb', public.open_conversation('contact_request', %L)::text, true)$f$,
  (select id from public.contact_requests where worker_user_id = :'wb')), 'aal1') as opened \gset
select current_setting('t.cwa') as cwa \gset
select current_setting('t.cwb') as cwb \gset

-- p_sql as p_user at p_aal: the value of its single column, or 'sqlstate|message|detail'.
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

create function pg_temp.inquiry(p_user uuid, p_org uuid, p_partner uuid, p_body text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select public.send_inquiry(%L, %L, %L)::text', p_org, p_partner, p_body), p_aal)
$$;

create function pg_temp.request(
  p_user uuid, p_partner uuid, p_quantity integer default 25, p_occupation text default '7212',
  p_start date default current_date + 60, p_aal text default 'aal2', p_org uuid default null
) returns text
language sql as $$
  select pg_temp.read_as(p_user, format(
    'select public.request_workforce(%L, %L, %L, %s, %L, %L, %L)::text',
    coalesce(p_org, current_setting('t.a')::uuid), p_partner, p_occupation, p_quantity, 'DE', p_start, 'Hamburg'), p_aal)
$$;

create function pg_temp.invite(p_user uuid, p_conv uuid, p_job uuid, p_aal text default 'aal1') returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select public.invite_to_job(%L, %L)::text', p_conv, p_job), p_aal)
$$;

create function pg_temp.answer(p_user uuid, p_connection uuid, p_status text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format($f$select 'ok' from public.set_connection_status(%L, %L)$f$, p_connection, p_status), p_aal)
$$;

-- Shape -----------------------------------------------------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.send_inquiry(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.send_inquiry(uuid, uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.request_workforce(uuid, uuid, text, integer, text, date, text, text, text, public.employment_type)', 'execute')
  and not has_function_privilege('anon', 'public.request_workforce(uuid, uuid, text, integer, text, date, text, text, text, public.employment_type)', 'execute')
  and has_function_privilege('authenticated', 'public.invite_to_job(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.invite_to_job(uuid, uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_connection_status(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.set_connection_status(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.list_conversation_connections(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.list_conversation_connections(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.open_inquiry(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.open_inquiry(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.change_connection_status(uuid, public.connection_status)', 'execute'),
  'the functions are for signed-in users only; the status helper is for nobody of the API'
);
select is(
  (select row(relrowsecurity, relforcerowsecurity)::text from pg_class where oid = 'public.connections'::regclass), '(t,t)',
  'NFR-S8: row-level security is on and forced on connections'
);
select ok(
  not has_column_privilege('authenticated', 'public.connections', 'to_user_id', 'select')
  and not has_column_privilege('authenticated', 'public.connections', 'created_by', 'select')
  and has_column_privilege('authenticated', 'public.connections', 'status', 'select')
  and not has_table_privilege('anon', 'public.connections', 'select')
  and not has_table_privilege('authenticated', 'public.connections', 'insert')
  and not has_table_privilege('authenticated', 'public.connections', 'update')
  and not has_table_privilege('authenticated', 'public.connections', 'delete')
  and has_column_privilege('authenticated', 'public.messages', 'connection_id', 'select'),
  'NFR-S9: the worker and the sender are not granted; nothing is writable; messages.connection_id is readable'
);
select results_eq(
  $$select key, value #>> '{}' from private.settings
    where key in ('inquiry_body_min_chars', 'inquiry_body_max_chars', 'rate_limit_inquiry_max', 'rate_limit_inquiry_seconds')
    order by key$$,
  $$values ('inquiry_body_max_chars', '2000'), ('inquiry_body_min_chars', '20'), ('rate_limit_inquiry_max', '10'),
           ('rate_limit_inquiry_seconds', '86400')$$,
  'NFR-O5: the inquiry length and rate are settings with the defaults of FR-P2'
);
select is(
  (select count(*)::integer from private.setting_rules
   where key in ('inquiry_body_min_chars', 'inquiry_body_max_chars', 'rate_limit_inquiry_max', 'rate_limit_inquiry_seconds')),
  4, 'NFR-O5: each has a rule of the settings editor'
);
select results_eq(
  $$select kind, mandatory, default_email, audience, release_key from private.notification_kinds
    where kind in ('inquiry_received', 'workforce_request_received', 'job_invitation') order by kind$$,
  $$values ('inquiry_received', false, true, 'company', 'release_messaging'),
           ('job_invitation', false, true, 'worker', 'release_messaging'),
           ('workforce_request_received', false, true, 'company', 'release_messaging')$$,
  'FR-T1: the three kinds are optional, emailed by default and released with messaging'
);

-- The switch --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_messaging';
select is(
  pg_temp.inquiry(:'adm', :'acme', :'rek', repeat('a', 200)) || ';' || pg_temp.invite(:'mem', :'cwa', :'j_open') || ';'
  || pg_temp.answer(:'adm', gen_random_uuid(), 'declined') || ';'
  || pg_temp.read_as(:'adm', format('select count(*)::text from public.list_conversation_connections(%L)', :'cwa')),
  'P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|',
  'every function answers not found while release_messaging is off'
);
update private.settings set value = 'false' where key = 'release_job_orders';
update private.settings set value = 'true' where key = 'release_messaging';
select is(pg_temp.request(:'own1', :'stf'), 'P0002|CHARA_NOT_FOUND|',
  'request_workforce also answers not found while release_job_orders is off');
update private.settings set value = 'true' where key = 'release_job_orders';

-- AC1: Send inquiry ---------------------------------------------------------------------------------------------------------

select pg_temp.inquiry(:'adm', :'acme', :'rek', rpad('Welders for Hamburg', 200, '.')) as conv_in \gset
select ok(:'conv_in' ~ '^[0-9a-f-]{36}$', 'AC1: an admin of Acme sends Rekrut a 200-character inquiry and gets its conversation');
select (select id from public.connections where kind = 'inquiry' and to_organization_id = :'rek') as con_in \gset
select is(
  (select format('%s|%s|%s|%s', kind, from_organization_id = :'acme', status, conversation_id = :'conv_in')
   from public.connections where to_organization_id = :'rek'),
  'inquiry|t|sent|t', 'AC1: one connection, kind inquiry, from Acme to Rekrut, status sent'
);
select is(
  (select format('%s|%s|%s', context_type, context_id = :'con_in',
     (select string_agg(organization_id::text, ',' order by organization_id::text) from public.conversation_participants p
      where p.conversation_id = c.id) = (select string_agg(x::text, ',' order by x::text) from unnest(array[:'acme', :'rek']::uuid[]) x))
   from public.conversations c where c.id = :'conv_in'),
  'inquiry|t|t', 'AC1: one conversation of context inquiry between Acme and Rekrut, keyed by the first inquiry'
);
select is(
  (select format('%s|%s|%s|%s', count(*), min(kind::text), min(connection_id::text) = :'con_in', min(char_length(body)))
   from public.messages where conversation_id = :'conv_in'),
  '1|inquiry|t|200', 'AC1: one typed message of kind inquiry carrying the connection'
);
select is(
  (select format('%s|%s|%s', count(*), min(metadata ->> 'kind'), bool_or(metadata ? 'body'))
   from audit.log where action = 'connection.created' and entity_id = :'con_in'),
  '1|inquiry|f', 'AC1: one audit row connection.created, never the body'
);
select is(
  pg_temp.inquiry(:'adm', :'acme', :'pen', repeat('a', 30)) || ';' || pg_temp.inquiry(:'adm', :'acme', gen_random_uuid(), repeat('a', 30)),
  'P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|',
  'AC1: a partner awaiting approval is not found, the same answer as an unknown id'
);
select is(
  pg_temp.inquiry(:'adm', :'acme', :'beta', repeat('a', 30)) || ';' || pg_temp.inquiry(:'ra1', :'rek', :'acme', repeat('a', 30), 'aal2'),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|employer_only',
  'AC1: an inquiry to an employer and an inquiry from a partner are refused (employer to partner only)'
);
select is(
  pg_temp.inquiry(:'adm2', :'acme', :'stf', repeat('a', 30)) || ';' || pg_temp.inquiry(:'wa', :'acme', :'stf', repeat('a', 30))
  || ';' || pg_temp.inquiry(:'own1', :'acme', :'stf', repeat('a', 30), 'aal1'),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;P0001|CHARA_FORBIDDEN|aal2_required',
  'roles: another employer''s admin and a worker may not send for Acme; an owner at aal1 is asked for two-step verification'
);

-- AC11 for the inquiry: the owners and admins of Rekrut, once.
select is(
  (select string_agg(n.user_id::text || ':' || n.status, ',' order by n.user_id) from public.notifications n where n.kind = 'inquiry_received'),
  (select string_agg(x::text || ':queued', ',' order by x) from unnest(array[:'urb', :'ra1', :'ra2']::uuid[]) x),
  'AC11, NFR-A3: inquiry_received is queued for the owner and both admins of Rekrut, not its members'
);
select is(
  (select format('%s|%s|%s|%s', n.payload ->> 'org_name', n.payload ->> 'conversation_id' = :'conv_in', n.payload ->> 'org_slug',
     n.payload ? 'body') from public.notifications n where n.kind = 'inquiry_received' and n.user_id = :'urb'),
  'Acme Bau|t|v71-rekrut|f', 'AC11: the payload names Acme and the conversation, never the body'
);
select is(
  (select count(*)::integer from pgmq.q_notifications where message ->> 'kind' = 'inquiry_received'), 3,
  'NFR-A3: one queue message per recipient in the same transaction'
);

-- AC2: input, plan and rate limits ------------------------------------------------------------------------------------------

select is(
  pg_temp.inquiry(:'adm', :'acme', :'stf', repeat('a', 19)) || ';' || pg_temp.inquiry(:'adm', :'acme', :'stf', repeat('a', 2001))
  || ';' || pg_temp.inquiry(:'adm', :'acme', :'stf', E'Twenty characters \x01 here'),
  '22023|CHARA_INVALID_INPUT|p_body;22023|CHARA_INVALID_INPUT|p_body;22023|CHARA_INVALID_INPUT|p_body',
  'AC2: 19 and 2,001 characters and a control character are refused'
);
select ok(
  pg_temp.inquiry(:'adm', :'acme', :'stf', repeat('a', 20)) ~ '^[0-9a-f-]{36}$'
  and pg_temp.inquiry(:'mem', :'acme', :'pla', repeat('b', 2000)) ~ '^[0-9a-f-]{36}$',
  'AC2: 20 and 2,000 characters are accepted; a member sends too'
);
select is(pg_temp.inquiry(:'adm', :'acme', :'rek', repeat('Another question. ', 3)), 'P0001|CHARA_CONFLICT|open_inquiry',
  'AC2: a second inquiry to Rekrut while the first waits for an answer is a conflict');
select is(pg_temp.read_as(:'mem', format('select conversation_id::text from public.open_inquiry(%L, %L)', :'acme', :'rek'), 'aal1'),
  :'conv_in', 'AC2: the page finds the conversation of the waiting inquiry to point to');
select is(
  pg_temp.inquiry(:'ufe', :'fre', :'stf', repeat('a', 30)) || ';' || pg_temp.inquiry(:'ula', :'lap', :'stf', repeat('a', 30), 'aal2'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|connection_actions;P0001|CHARA_FEATURE_NOT_IN_PLAN|connection_actions',
  'AC2: an employer on the free plan and one whose subscription lapsed send no inquiry'
);
update private.settings set value = '2' where key = 'rate_limit_inquiry_max';
select is(pg_temp.inquiry(:'adm', :'acme', :'ext', repeat('a', 30)), 'P0001|CHARA_RATE_LIMITED|',
  'AC2: past rate_limit_inquiry_max in the window (lowered here from 10 to 2) the next inquiry is rate limited');
update private.settings set value = '10' where key = 'rate_limit_inquiry_max';
select is(private.monthly_usage(:'acme', 'messages_per_month'), 3,
  'AC2, FR-P3: every accepted inquiry counts as one message against messages_per_month');
update billing.plan_limits set limit_value = 3 where plan_code = 'employer_starter' and limit_key = 'messages_per_month';
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.inquiry(:'mem', :'acme', :'ext', repeat('a', 30)), 'P0001|CHARA_LIMIT_REACHED|messages_per_month',
  'FR-P3: at the monthly message limit an inquiry is refused');
update billing.plan_limits set limit_value = 100 where plan_code = 'employer_starter' and limit_key = 'messages_per_month';
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- AC3: Request workforce ----------------------------------------------------------------------------------------------------

select pg_temp.request(:'own1', :'stf') as conv_rw \gset
select ok(:'conv_rw' ~ '^[0-9a-f-]{36}$', 'AC3: an owner at aal2 requests 25 welders from Staffit and gets the conversation');
select (select id from public.connections where kind = 'request_workforce' and to_organization_id = :'stf') as con_rw \gset
select (select requirement_id from public.connections where id = :'con_rw') as req_rw \gset
select is(
  (select format('%s|%s|%s|%s|%s|%s', r.status, coalesce(r.visibility::text, 'none'), r.organization_id = :'acme', r.workers_needed,
     r.partner_need, (select string_agg(o.occupation_id || ':' || o.quantity, ',') from public.requirement_occupations o where o.requirement_id = r.id))
   from public.workforce_requirements r where r.id = :'req_rw'),
  'draft|none|t|25|staffing|7212:25',
  'AC3: a draft requirement of Acme (private once published) with the one occupation and quantity'
);
select is(
  (select format('%s|%s|%s', i.status, i.source, (select count(*) from public.conversations c
     where c.id = :'conv_rw' and c.context_type = 'requirement_invitation' and c.context_id = i.id))
   from public.requirement_invitations i where i.requirement_id = :'req_rw' and i.organization_id = :'stf'),
  'invited|profile|1', 'AC3: Staffit is invited to it, and the conversation is the invitation''s'
);
select is(
  (select format('%s|%s', m.kind, c.status) from public.messages m join public.connections c on c.id = m.connection_id
   where m.conversation_id = :'conv_rw'),
  'request_workforce|sent', 'AC3: one typed message of kind request_workforce, status sent'
);
select is(
  (select count(*)::integer from private.requirement_reveals where requirement_id = :'req_rw' and organization_id = :'stf' and cause = 'invitation'),
  1, 'AC3: the invitation names Acme to Staffit, as every invitation does'
);
select ok(pg_temp.request(:'own1', :'rek') ~ '^[0-9a-f-]{36}$', 'AC3: Rekrut, which lists the staffing service, is accepted');
select is(pg_temp.request(:'own1', :'pla'), '22023|CHARA_INVALID_INPUT|not_staffing',
  'AC3: Plain, which does not list it, is refused');
select is(
  pg_temp.request(:'own1', :'stf', 0) || ';' || pg_temp.request(:'own1', :'stf', 10001) || ';'
  || pg_temp.request(:'own1', :'stf', 25, '7212', current_date - 1) || ';' || pg_temp.request(:'own1', :'stf', 25, 'xxxx'),
  '22023|CHARA_INVALID_INPUT|p_quantity;22023|CHARA_INVALID_INPUT|p_quantity;22023|CHARA_INVALID_INPUT|p_start_date;22023|CHARA_INVALID_INPUT|p_occupation',
  'AC3: quantities 0 and 10,001, a start yesterday and an unknown occupation are refused'
);
select is(
  pg_temp.request(:'own1', :'stf', 25, '7212', current_date + 60, 'aal1') || ';' || pg_temp.request(:'mem', :'stf') || ';'
  || pg_temp.request(:'ufe', :'stf', 25, '7212', current_date + 60, 'aal2', :'fre'),
  'P0001|CHARA_FORBIDDEN|aal2_required;P0001|CHARA_FORBIDDEN|;P0001|CHARA_FEATURE_NOT_IN_PLAN|connection_actions',
  'AC3: an owner at aal1 is sent to two-step verification, a member may not request, a free employer has no such feature'
);
update billing.plan_limits set limit_value = 0
where plan_code = 'employer_starter' and limit_key = 'partner_invitations_per_requirement';
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.request(:'own1', :'stf'), 'P0001|CHARA_LIMIT_REACHED|partner_invitations_per_requirement',
  'AC3: the partner_invitations_per_requirement limit of the plan applies');
update billing.plan_limits set limit_value = 3
where plan_code = 'employer_starter' and limit_key = 'partner_invitations_per_requirement';
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(
  (select format('%s|%s|%s|%s|%s|%s', n.user_id = :'ust', n.payload ->> 'org_name', n.payload ->> 'occupation',
     n.payload ->> 'quantity', n.payload ->> 'country_name', n.payload ? 'body')
   from public.notifications n where n.kind = 'workforce_request_received' and n.payload ->> 'connection_id' = :'con_rw'),
  't|Acme Bau|Welders and flame cutters|25|Germany|f',
  'AC11: workforce_request_received names Acme, the occupation, quantity and destination, never the body'
);
select is(
  (select count(*)::integer from public.notifications where kind = 'invitation_received' and user_id in (:'ust', :'urb', :'ra1', :'ra2')), 0,
  'AC11: a workforce request is notified once, as workforce_request_received, not also as invitation_received'
);

-- AC4: Invite to job --------------------------------------------------------------------------------------------------------

select pg_temp.invite(:'mem', :'cwa', :'j_open') as con_job \gset
select ok(:'con_job' ~ '^[0-9a-f-]{36}$', 'AC4: an Acme member invites wa to apply to the open vacancy');
select is(
  (select format('%s|%s|%s|%s', c.kind, c.job_id = :'j_open', c.status, m.kind) from public.connections c
   join public.messages m on m.connection_id = c.id where c.id = :'con_job'),
  'invite_to_job|t|sent|invite_to_job', 'AC4: one connection and one typed message of kind invite_to_job with the vacancy'
);
select is(
  pg_temp.invite(:'mem', :'cwa', :'j_draft') || ';' || pg_temp.invite(:'mem', :'cwa', :'j_paused') || ';'
  || pg_temp.invite(:'mem', :'cwa', :'j_hidden') || ';' || pg_temp.invite(:'mem', :'cwa', gen_random_uuid()),
  'P0001|CHARA_JOB_NOT_OPEN|;P0001|CHARA_JOB_NOT_OPEN|;P0001|CHARA_JOB_NOT_OPEN|;P0001|CHARA_JOB_NOT_OPEN|',
  'AC4: draft, paused, hidden and unknown vacancies are refused'
);
select is(pg_temp.invite(:'mem', :'cwa', :'j_beta'), '42501|CHARA_FORBIDDEN|', 'AC4: Beta''s vacancy is refused');
select is(
  pg_temp.invite(:'mem', gen_random_uuid(), :'j_open') || ';' || pg_temp.invite(:'adm2', :'cwa', :'j_beta', 'aal2') || ';'
  || pg_temp.invite(:'wa', :'cwa', :'j_open'),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|',
  'AC4: a made-up conversation, another employer and the worker of the conversation are refused'
);
select is(pg_temp.invite(:'mem', :'cwb', :'j_open'), '42501|CHARA_FORBIDDEN|direct_hiring_blocked',
  'AC4, FR-Q5: a worker whose country has a blocked rule for the vacancy''s country is not invited');
select is(pg_temp.invite(:'adm', :'cwa', :'j_open', 'aal2'), 'P0001|CHARA_CONFLICT|open_invitation',
  'a second invitation to the same vacancy while the first waits is a conflict');
select is(
  (select format('%s|%s|%s|%s|%s', n.status, n.payload ->> 'org_name', n.payload ->> 'job_title', n.payload ->> 'city', n.payload ? 'body')
   from public.notifications n where n.kind = 'job_invitation' and n.user_id = :'wa'),
  'queued|Acme Bau|Welder MIG/MAG|Hamburg|f', 'AC11: wa gets one job_invitation with Acme and the vacancy, never the body'
);

-- AC7: guarded transitions --------------------------------------------------------------------------------------------------

select pg_temp.read_as(:'ra1', format($f$select 'ok' from public.send_message(%L, 'Yes, we can help.')$f$, :'conv_in')) as replied \gset
select is((select status::text from public.connections where id = :'con_in'), 'answered',
  'AC7: the inquiry becomes answered at Rekrut''s first reply');
select is(pg_temp.answer(:'ust', :'con_rw', 'declined'), 'ok', 'AC7: Staffit declines the workforce request');
select is(
  (select format('%s|%s', c.status, i.status) from public.connections c
   join public.requirement_invitations i on i.requirement_id = c.requirement_id and i.organization_id = c.to_organization_id
   where c.id = :'con_rw'),
  'declined|declined', 'AC7: the request and its invitation are declined'
);
select is(pg_temp.apply_as(:'wa', :'j_open'), 'ok', 'AC5: wa applies to the vacancy as to any other');
select is((select status::text from public.connections where id = :'con_job'), 'accepted',
  'AC7: the invitation to apply becomes accepted when the worker applies');
select is(
  pg_temp.answer(:'own1', :'con_job', 'accepted') || ';' || pg_temp.answer(:'ust', :'con_rw', 'accepted') || ';'
  || pg_temp.answer(:'own1', (select id::text from public.connections where to_organization_id = :'stf' and kind = 'inquiry')::uuid, 'declined'),
  'P0001|CHARA_INVALID_TRANSITION|accepted to accepted;P0001|CHARA_INVALID_TRANSITION|declined to accepted;P0001|CHARA_INVALID_TRANSITION|sent to declined',
  'AC7: the sender may not set its own action, and a declined action stays declined'
);
select is(
  pg_temp.answer(:'adm2', :'con_in', 'declined') || ';' || pg_temp.answer(:'adm2', :'con_job', 'declined') || ';'
  || (select count(*)::text from public.connections where kind = 'inquiry' and to_organization_id = :'stf' and status <> 'sent'),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;0', 'AC7: a member of Beta changes nothing'
);
select is(pg_temp.answer(:'ust', (select id from public.connections where kind = 'inquiry' and to_organization_id = :'stf'), 'answer'),
  '22023|CHARA_INVALID_INPUT|p_status', 'AC7: a value that is no status is refused');
select results_eq(
  $$select action, metadata ->> 'from', metadata ->> 'to' from audit.log where action = 'connection.status_changed'
    order by id$$,
  $$values ('connection.status_changed', 'sent', 'answered'), ('connection.status_changed', 'sent', 'declined'),
           ('connection.status_changed', 'sent', 'accepted')$$,
  'AC7: each change writes one audit row connection.status_changed with from and to'
);
select is(
  pg_temp.read_as(:'adm', format('select string_agg(kind || '':'' || status || '':'' || sent_by_me, '','') from public.list_conversation_connections(%L)', :'conv_in'))
  || ';' || pg_temp.read_as(:'rm1', format('select string_agg(kind || '':'' || status || '':'' || sent_by_me, '','') from public.list_conversation_connections(%L)', :'conv_in'), 'aal1'),
  'inquiry:answered:true;inquiry:answered:false', 'AC7: both sides read the same status'
);
select is(
  pg_temp.read_as(:'wa', format($f$select format('%%s|%%s|%%s|%%s|%%s', kind, status, job_title, job_city, job_open) from public.list_conversation_connections(%L)$f$, :'cwa'), 'aal1'),
  'invite_to_job|accepted|Welder MIG/MAG|Hamburg|t', 'AC5: the worker reads the invitation card with the vacancy'
);
select is(
  pg_temp.read_as(:'adm2', format('select count(*)::text from public.list_conversation_connections(%L)', :'conv_in')),
  '42501|CHARA_FORBIDDEN|', 'NFR-S8: Beta reads no card of a conversation it takes no part in'
);

-- A response of Rekrut to its requested requirement accepts that request (FR-O2).
select (select id from public.connections where kind = 'request_workforce' and to_organization_id = :'rek') as con_rk \gset
insert into public.partner_responses (requirement_id, organization_id, employer_organization_id, capacity, available_from,
  experience_note, fee_model)
select requirement_id, :'rek', :'acme', 25, current_date + 60, 'Twenty welders placed last year.', 'on_request'
from public.connections where id = :'con_rk';
select is((select status::text from public.connections where id = :'con_rk'), 'accepted',
  'AC7: a workforce request becomes accepted when the partner responds to its requirement');

-- AC8: Save partner and Follow company create no message ------------------------------------------------------------------

select (select count(*) from public.conversations) + (select count(*) from public.messages) + (select count(*) from public.connections)
  as before_saves \gset
select pg_temp.read_as(:'mem', format('select public.toggle_saved_partner(%L, %L, true)::text', :'rek', :'acme'), 'aal1') as s1 \gset
select pg_temp.read_as(:'mem', format('select public.toggle_saved_partner(%L, %L, true)::text', :'rek', :'acme'), 'aal1') as s2 \gset
select pg_temp.read_as(:'wa', format('select public.toggle_follow(%L, true)::text', :'rek'), 'aal1') as f1 \gset
select pg_temp.read_as(:'wa', format('select public.toggle_follow(%L, true)::text', :'rek'), 'aal1') as f2 \gset
select is(
  format('%s|%s', (select count(*) from public.saved_items where organization_id = :'acme' and target_organization_id = :'rek'),
    (select count(*) from public.follows where user_id = :'wa' and organization_id = :'rek'))
  || '|' || ((select count(*) from public.conversations) + (select count(*) from public.messages)
     + (select count(*) from public.connections) = :before_saves),
  '1|1|true', 'AC8: saving and following twice leaves one row each and creates no conversation, message or connection'
);
select is(pg_temp.read_as(:'wa', format('select public.toggle_saved_partner(%L)::text', :'rek'), 'aal1'), 'P0001|CHARA_FORBIDDEN|',
  'AC8: a worker saves no partner (only employers do, FR-L4)');

-- NFR-S8: who reads which connection ----------------------------------------------------------------------------------------

select is(
  pg_temp.read_as(:'mem', 'select count(*)::text from public.connections', 'aal1') || ';'
  || pg_temp.read_as(:'rm1', 'select string_agg(kind::text, '','' order by kind) from public.connections', 'aal1') || ';'
  || pg_temp.read_as(:'upl', 'select count(*)::text from public.connections', 'aal1') || ';'
  || pg_temp.read_as(:'adm2', 'select count(*)::text from public.connections') || ';'
  || pg_temp.read_as(:'own2', 'select count(*)::text from public.connections') || ';'
  || pg_temp.read_as(:'wa', 'select string_agg(kind::text, '','') from public.connections', 'aal1') || ';'
  || pg_temp.read_as(:'wb', 'select count(*)::text from public.connections', 'aal1') || ';'
  || pg_temp.read_as(null, 'select count(*)::text from public.connections'),
  '6;inquiry,request_workforce;1;0;0;invite_to_job;0;42501|permission denied for table connections|',
  'NFR-S8: Acme reads its six, Rekrut and Plain only their own, Beta none, wa the own invitation, wb none, anonymous nothing'
);
select is(
  pg_temp.read_as(:'rm1', 'select count(*)::text from public.messages where connection_id is not null', 'aal1') || ';'
  || pg_temp.read_as(:'ust', 'select count(*)::text from public.messages where connection_id is not null'),
  '2;2', 'NFR-S8: each partner reads the typed messages of its own conversations only'
);

-- The inquiry conversation in the lists and the header --------------------------------------------------------------------------

select is(
  pg_temp.read_as(:'adm', format($f$select counterpart_name || '|' || context_type from public.get_conversation(%L)$f$, :'conv_in'))
  || ';' || pg_temp.read_as(:'rm1', format($f$select counterpart_name || '|' || context_type from public.get_conversation(%L)$f$, :'conv_in'), 'aal1'),
  'Rekrut|inquiry;Acme Bau|inquiry', 'each side of an inquiry names the other organisation by display name'
);
select is(
  pg_temp.read_as(:'adm', format($f$select count(*)::text from public.list_conversations(%L, null, null, 50, 'inquiry')$f$, :'acme')),
  '3', 'the inbox filters Acme''s inquiry conversations (Rekrut, Staffit, Plain)'
);
select is(pg_temp.inquiry(:'adm', :'acme', :'rek', repeat('A follow-up question. ', 3)), :'conv_in',
  'a later inquiry to Rekrut, once the first is answered, joins the same conversation');
select is(
  (select count(*)::integer from public.conversations where context_type = 'inquiry'), 3,
  'one inquiry conversation per pair of organisations'
);
select is(
  pg_temp.read_as(:'mem', format($f$select public.open_conversation('inquiry', %L)::text$f$, :'con_in'), 'aal1') || ';'
  || pg_temp.read_as(:'adm2', format($f$select public.open_conversation('inquiry', %L)::text$f$, :'con_in')),
  :'conv_in' || ';42501|CHARA_FORBIDDEN|', 'decision 5.1: the parties open the inquiry conversation, nobody else'
);

-- Erasure: the worker's invitations go with the profile.
delete from public.profiles where id = :'wa';
select is((select count(*)::integer from public.connections where kind = 'invite_to_job'), 0,
  'erasure: the invitations to apply of an erased worker go with the profile');

select * from finish();
rollback;
