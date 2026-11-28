begin;
select plan(36);

\ir apply_fixture.inc

-- D91: inquiries between partner companies (decision 5.1 as extended; FR-P2 AC1, AC2, AC11 for partners; NFR-S8, NFR-A3,
-- NFR-O5): send_partner_inquiry, the conversation of context partner_inquiry, open_inquiry for an unordered pair, the
-- labels, the notice, the dashboard count and retention. Rekrut (owner urb, admin ra1, member rm1) and Plain (owner upl)
-- are listed recruitment companies, Staffit (owner ust) and Staffzwei (owner us2) listed staffing companies, all on a paid
-- plan; Pending (owner upe) awaits approval and Gratis (owner ugr) is a listed recruitment company without a plan. Acme
-- (t.a: admin adm) is the employer of the fixture.

\set urb '00000000-0000-0000-0000-0000000f9101'
\set ra1 '00000000-0000-0000-0000-0000000f9102'
\set rm1 '00000000-0000-0000-0000-0000000f9103'
\set upl '00000000-0000-0000-0000-0000000f9104'
\set ust '00000000-0000-0000-0000-0000000f9105'
\set us2 '00000000-0000-0000-0000-0000000f9106'
\set upe '00000000-0000-0000-0000-0000000f9107'
\set ugr '00000000-0000-0000-0000-0000000f9108'

update private.settings set value = 'true' where key in ('release_messaging', 'release_partner_directories');
update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max');
select current_setting('t.a') as acme \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'acme', 'employer_starter', 'active', 'null');

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
  if p_listed then
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

select pg_temp.org('d91-rekrut', 'Rekrut', :'urb', 'recruitment_company', 'recruitment_partner') as rek \gset
select pg_temp.org('d91-plain', 'Plain', :'upl', 'recruitment_company', 'recruitment_partner') as pla \gset
select pg_temp.org('d91-staffit', 'Staffit', :'ust', 'staffing_company', 'staffing_partner') as stf \gset
select pg_temp.org('d91-staffzwei', 'Staffzwei', :'us2', 'staffing_company', 'staffing_partner') as st2 \gset
select pg_temp.org('d91-pending', 'Pending', :'upe', 'recruitment_company', 'recruitment_partner', false) as pen \gset
select pg_temp.org('d91-gratis', 'Gratis', :'ugr', 'recruitment_company', null) as gra \gset
select pg_temp.new_user(:'ra1'), pg_temp.new_user(:'rm1') \gset
update public.profiles set account_kind = intended_account_kind where id in (:'ra1', :'rm1');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  (:'rek', :'ra1', 'admin', now()), (:'rek', :'rm1', 'member', now());

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

create function pg_temp.ask(p_user uuid, p_org uuid, p_partner uuid, p_body text default repeat('a', 30), p_aal text default 'aal2')
returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select public.send_partner_inquiry(%L, %L, %L)::text', p_org, p_partner, p_body), p_aal)
$$;

-- Shape -----------------------------------------------------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.send_partner_inquiry(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.send_partner_inquiry(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.assert_partner_inquiry_sender(uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'private.partner_inquiry_pair_allowed(public.organization_type, public.organization_type)', 'execute'),
  'the function is for signed-in users only; its helpers are for nobody of the API'
);
select is(
  (select label from private.notification_kinds where kind = 'inquiry_received'), 'Inquiries from employers and partners',
  'FR-T1: the inquiry notice is named for both senders'
);

-- The switches ------------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_messaging';
select is(pg_temp.ask(:'ra1', :'rek', :'pla'), 'P0002|CHARA_NOT_FOUND|', 'not found while release_messaging is off');
update private.settings set value = 'true' where key = 'release_messaging';
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.ask(:'ra1', :'rek', :'pla'), 'P0002|CHARA_NOT_FOUND|', 'not found while release_partner_directories is off');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- Recruitment to recruitment ------------------------------------------------------------------------------------------------------

select pg_temp.ask(:'ra1', :'rek', :'pla', rpad('Shared candidates for Hamburg', 200, '.')) as conv_rp \gset
select ok(:'conv_rp' ~ '^[0-9a-f-]{36}$', 'D91: an admin of Rekrut sends Plain an inquiry and gets its conversation');
select (select id from public.connections where from_organization_id = :'rek' and to_organization_id = :'pla') as con_rp \gset
select is(
  (select format('%s|%s|%s', kind, status, conversation_id = :'conv_rp') from public.connections where id = :'con_rp'),
  'inquiry|sent|t', 'D91: one connection of kind inquiry from Rekrut to Plain, sent'
);
select is(
  (select format('%s|%s|%s', context_type, context_id = :'con_rp',
     (select string_agg(organization_id::text, ',' order by organization_id::text) from public.conversation_participants p
      where p.conversation_id = c.id) = (select string_agg(x::text, ',' order by x::text) from unnest(array[:'rek', :'pla']::uuid[]) x))
   from public.conversations c where c.id = :'conv_rp'),
  'partner_inquiry|t|t', 'D91: one conversation of context partner_inquiry between the two companies, keyed by the first inquiry'
);
select is(
  (select format('%s|%s|%s', count(*), min(kind::text), min(connection_id::text) = :'con_rp') from public.messages
   where conversation_id = :'conv_rp'),
  '1|inquiry|t', 'D91: one typed message of kind inquiry carrying the connection'
);
select is(
  (select format('%s|%s|%s', count(*), min(metadata ->> 'context_type'), bool_or(metadata ? 'body'))
   from audit.log where action = 'connection.created' and entity_id = :'con_rp'),
  '1|partner_inquiry|f', 'D91: one audit row connection.created, never the body'
);
select is(
  (select string_agg(format('%s:%s:%s', n.user_id = :'upl', n.payload ->> 'org_name', n.payload ->> 'conversation_id' = :'conv_rp'), ',')
   from public.notifications n where n.kind = 'inquiry_received'),
  't:Rekrut:t', 'AC11, NFR-A3: inquiry_received is queued for Plain''s owner, naming Rekrut and the conversation'
);
select is(
  pg_temp.read_as(:'upl', format('select partner_inquiries::text from public.get_partner_dashboard(%L)', :'pla')), '1',
  'the partner dashboard of Plain counts the waiting inquiry of another partner'
);

-- The other pairs ---------------------------------------------------------------------------------------------------------------

select pg_temp.ask(:'rm1', :'rek', :'stf', repeat('b', 20), 'aal1') as conv_rs \gset
select ok(:'conv_rs' ~ '^[0-9a-f-]{36}$', 'D91: a member of a recruitment company writes to a staffing company');
select ok(pg_temp.ask(:'ust', :'stf', :'pla') ~ '^[0-9a-f-]{36}$', 'D91: a staffing company writes to a recruitment company');
select is(pg_temp.ask(:'ust', :'stf', :'st2'), '42501|CHARA_FORBIDDEN|partner_pair_not_allowed',
  'D91: a staffing company does not write to another staffing company');
select is(pg_temp.ask(:'ra1', :'rek', :'rek'), '42501|CHARA_FORBIDDEN|self', 'D91: a company does not write to itself');
select is(
  pg_temp.ask(:'ra1', :'rek', :'acme') || ';' || pg_temp.ask(:'ra1', :'rek', :'pen') || ';' || pg_temp.ask(:'ra1', :'rek', gen_random_uuid()),
  '42501|CHARA_FORBIDDEN|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|',
  'D91: an employer is no recipient; a partner awaiting approval is not found, as an unknown id'
);
select is(
  pg_temp.ask(:'upe', :'pen', :'rek') || ';' || pg_temp.ask(:'ugr', :'gra', :'rek'),
  '42501|CHARA_FORBIDDEN|not_listed;P0001|CHARA_FEATURE_NOT_IN_PLAN|connection_actions',
  'D91: a sender awaiting approval and a sender on the free plan are refused'
);
select is(
  pg_temp.ask(:'adm', :'acme', :'rek') || ';'
  || pg_temp.read_as(:'ra1', format('select public.send_inquiry(%L, %L, %L)::text', :'rek', :'stf', repeat('a', 30))),
  '42501|CHARA_FORBIDDEN|partner_only;42501|CHARA_FORBIDDEN|employer_only',
  'an employer keeps send_inquiry and a partner send_partner_inquiry'
);
select is(
  pg_temp.ask(:'adm', :'rek', :'stf') || ';' || pg_temp.ask(:'urb', :'rek', :'st2', repeat('a', 30), 'aal1') || ';'
  || pg_temp.ask(:'ra1', :'rek', :'st2', repeat('a', 19)),
  '42501|CHARA_FORBIDDEN|;P0001|CHARA_FORBIDDEN|aal2_required;22023|CHARA_INVALID_INPUT|p_body',
  'roles and input: an outsider may not send for Rekrut, an owner at aal1 verifies first, the body follows send_inquiry'
);

-- One waiting inquiry per pair, either direction ---------------------------------------------------------------------------------

select is(
  pg_temp.ask(:'ra1', :'rek', :'pla') || ';' || pg_temp.ask(:'upl', :'pla', :'rek'),
  'P0001|CHARA_CONFLICT|open_inquiry;P0001|CHARA_CONFLICT|open_inquiry',
  'D91: while Rekrut''s inquiry waits, neither Rekrut nor Plain opens a second one for the pair'
);
select is(
  pg_temp.read_as(:'upl', format('select conversation_id::text from public.open_inquiry(%L, %L)', :'pla', :'rek')) || ';'
  || pg_temp.read_as(:'rm1', format('select conversation_id::text from public.open_inquiry(%L, %L)', :'rek', :'pla'), 'aal1'),
  :'conv_rp' || ';' || :'conv_rp', 'AC2: both sides find the conversation of the waiting inquiry'
);
select pg_temp.read_as(:'upl', format($f$select 'ok' from public.send_message(%L, 'Happy to talk about it.')$f$, :'conv_rp')) as reply \gset
select is(:'reply' || ';' || (select status::text from public.connections where id = :'con_rp'), 'ok;answered',
  'the first reply of Plain answers the inquiry');
select is(pg_temp.ask(:'upl', :'pla', :'rek'), :'conv_rp',
  'D91: Plain''s inquiry back to Rekrut joins the conversation of the pair');
select is(
  (select count(*)::integer from public.conversations c join public.conversation_participants a on a.conversation_id = c.id
   join public.conversation_participants b on b.conversation_id = c.id
   where c.context_type = 'partner_inquiry' and a.organization_id = :'rek' and b.organization_id = :'pla'),
  1, 'D91: one conversation per pair of partner companies'
);

-- Limits ------------------------------------------------------------------------------------------------------------------------

update private.settings set value = '1' where key = 'rate_limit_inquiry_max';
select is(pg_temp.ask(:'ra1', :'rek', :'st2'), 'P0001|CHARA_RATE_LIMITED|',
  'AC2: past rate_limit_inquiry_max in the window the next inquiry is rate limited');
update private.settings set value = '10' where key = 'rate_limit_inquiry_max';
select is(private.monthly_usage(:'rek', 'messages_per_month'), 2,
  'FR-P3: each inquiry counts as one message of the sender against messages_per_month');
update billing.plan_limits set limit_value = 2 where plan_code = 'recruitment_partner' and limit_key = 'messages_per_month';
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.ask(:'ra1', :'rek', :'st2'), 'P0001|CHARA_LIMIT_REACHED|messages_per_month',
  'FR-P3: at the monthly message limit a partner inquiry is refused');
update billing.plan_limits set limit_value = 100 where plan_code = 'recruitment_partner' and limit_key = 'messages_per_month';
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- Who reads it ------------------------------------------------------------------------------------------------------------------

select is(
  pg_temp.read_as(:'rm1', format('select count(*)::text from public.messages where conversation_id = %L', :'conv_rp'), 'aal1') || ';'
  || pg_temp.read_as(:'upl', format('select count(*)::text from public.messages where conversation_id = %L', :'conv_rp')) || ';'
  || pg_temp.read_as(:'ust', format('select count(*)::text from public.messages where conversation_id = %L', :'conv_rp')) || ';'
  || pg_temp.read_as(:'adm', format('select count(*)::text from public.conversations where id = %L', :'conv_rp')),
  '3;3;0;0', 'NFR-S8: the members of the two companies read the conversation, another partner and an employer do not'
);
select is(
  pg_temp.read_as(:'ra1', format('select count(*)::text from public.connections where id = %L', :'con_rp')) || ';'
  || pg_temp.read_as(:'us2', format('select count(*)::text from public.connections where id = %L', :'con_rp')),
  '1;0', 'NFR-S8: the connection is read by the two companies only'
);
select is(
  pg_temp.read_as(:'ra1', format($f$select counterpart_name || '|' || context_type from public.get_conversation(%L)$f$, :'conv_rp'))
  || ';' || pg_temp.read_as(:'upl', format($f$select counterpart_name || '|' || context_type from public.get_conversation(%L)$f$, :'conv_rp')),
  'Plain|partner_inquiry;Rekrut|partner_inquiry', 'each side names the other company by display name'
);
select is(
  pg_temp.read_as(:'ra1', format($f$select count(*)::text from public.list_conversations(%L, null, null, 50, 'partner_inquiry')$f$, :'rek')),
  '2', 'the inbox filters Rekrut''s partner inquiries (Plain, Staffit)'
);
select is(
  pg_temp.read_as(:'ra1', format($f$select public.open_conversation('partner_inquiry', %L)::text$f$, :'con_rp')),
  '42501|CHARA_FORBIDDEN|', 'decision 5.1: open_conversation does not open a partner inquiry; only send_partner_inquiry does'
);

-- Blocks and suspension ---------------------------------------------------------------------------------------------------------

select pg_temp.read_as(:'ust', format($f$select 'ok' from public.send_message(%L, 'We have staff for this.')$f$, :'conv_rs')) as replied \gset
select pg_temp.read_as(:'ust', format($f$select 'ok' from public.block_conversation(%L)$f$, :'conv_rs')) as blocked \gset
select is(:'replied' || ';' || :'blocked' || ';' || pg_temp.ask(:'ra1', :'rek', :'stf'), 'ok;ok;42501|CHARA_FORBIDDEN|blocked',
  'FR-P3 AC8: once Staffit blocks the conversation, Rekrut sends no further inquiry into it');
update public.organizations set status = 'suspended' where id = :'pla';
select is(pg_temp.ask(:'ust', :'stf', :'pla'), 'P0002|CHARA_NOT_FOUND|', 'a suspended recipient is not found');
update public.organizations set status = 'active' where id = :'pla';

-- Retention ---------------------------------------------------------------------------------------------------------------------

update public.conversations set last_message_at = now() - interval '800 days' where id = :'conv_rp';
select private.apply_retention();
select is(
  (select count(*)::integer from public.conversations where id = :'conv_rp')
  + (select count(*)::integer from public.connections where conversation_id = :'conv_rp')
  + (select count(*)::integer from public.messages where conversation_id = :'conv_rp'),
  0, 'FR-P3 AC9: retention deletes a partner inquiry conversation with its connections and messages'
);
select is((select count(*)::integer from public.conversations where id = :'conv_rs'), 1,
  'FR-P3 AC9: a recent partner inquiry conversation stays');

select * from finish();
rollback;
