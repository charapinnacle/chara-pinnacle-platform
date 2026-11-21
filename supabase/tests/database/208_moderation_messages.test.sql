begin;
select plan(68);

\ir apply_fixture.inc

-- Moderation of messages and contact requests (V73, FR-S1 release 2c parts, FR-J3 2c parts, FR-Q3 AC11; NFR-C5, NFR-C7,
-- NFR-S8): the report target contact_request, moderation_decide on messages and contact requests, the notices, the
-- appeals of the sender and the effects on the conversation and the request lists. Acme (t.a: owner own1, admin adm,
-- member mem) and Beta (t.b: owner own2, admin adm2) are the employers of the fixture; wa (W1) and wb (W2) the
-- candidates; Rekrut (owner padm) and Second (owner u2), made below, the partner companies; t1 and t2 Trust & Safety
-- Administrators, a Platform Administrator and a Verification Reviewer.

\set padm '00000000-0000-0000-0000-0000000f7321'
\set u2 '00000000-0000-0000-0000-0000000f7323'
\set t1 '00000000-0000-0000-0000-0000000f7324'
\set t2 '00000000-0000-0000-0000-0000000f7325'
\set padmin '00000000-0000-0000-0000-0000000f7326'
\set reviewer '00000000-0000-0000-0000-0000000f7327'

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

create temp sequence key_seq;

-- submit_report of the target p_type (message or contact_request) p_id as p_user: 'R-nnnnnn|f', or the error.
create function pg_temp.report(p_user uuid, p_type text, p_id uuid, p_category text default 'fee_demanded_from_worker',
  p_aal text default 'aal1') returns text
language sql as $$
  select pg_temp.read_as(p_user, format($f$select r.reference || '|' || r.is_duplicate::text
    from public.submit_report(p_target_type => %L, p_category => %L,
      p_details => 'They asked me to pay a fee for the job.', p_good_faith => true, p_key => %L, %s => %L) r$f$,
    p_type, p_category, encode(sha256(('v73-' || nextval('pg_temp.key_seq'))::bytea), 'hex'),
    case p_type when 'message' then 'p_message' else 'p_contact_request' end, p_id), p_aal)
$$;

create function pg_temp.report_id(p_result text) returns bigint
language sql as $$ select substr(split_part(p_result, '|', 1), 3)::bigint $$;

create function pg_temp.decide(p_user uuid, p_decision text, p_reasons text, p_report bigint default null,
  p_type text default null, p_id uuid default null, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format($f$select coalesce(d.moderation_action_id::text, '-') || '|' || coalesce(d.report_status::text, '-')
    from public.moderation_decide(%L, %L, %L, %L, %L) d$f$, p_decision, p_reasons, p_report, p_type, p_id), p_aal)
$$;

-- The moderation_decision notices queued for p_user, as the bell and the email read them.
create function pg_temp.queued(p_user uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(private.notification_payload('moderation_decision', q.message) order by q.msg_id), '[]')
  from pgmq.q_notifications q where q.message ->> 'kind' = 'moderation_decision' and q.message ->> 'user_id' = p_user::text
$$;

create function pg_temp.writes() returns text
language sql as $$
  select format('%s|%s', (select count(*) from public.moderation_actions), (select count(*) from pgmq.q_notifications))
$$;

-- The fixture --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max',
  'rate_limit_message_max');
update private.settings set value = 'true'
where key in ('release_messaging', 'release_find_workers', 'release_partner_directories', 'release_job_orders');
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
select pg_temp.new_user(u) from unnest(array[:'padm', :'u2', :'t1', :'t2', :'padmin', :'reviewer']::uuid[]) u;
update public.profiles set account_kind = intended_account_kind where id in (:'padm', :'u2', :'t1', :'t2', :'padmin', :'reviewer');
insert into public.platform_staff (user_id, role) values
  (:'t1', 'trust_safety'), (:'t2', 'trust_safety'), (:'padmin', 'admin'), (:'reviewer', 'verification_reviewer');

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

select pg_temp.partner('rekrut-v73m', 'Rekrut', :'padm') as rek \gset
select pg_temp.partner('second-v73m', 'Second', :'u2') as sec \gset

select pg_temp.open_job('Welder Hamburg') as job \gset
select pg_temp.apply_as(:'wa', :'job') as applied \gset
select current_setting('t.app') as app \gset

select pg_temp.read_as(:'adm', format('select public.open_conversation(''application'', %L)::text', :'app')) as c_app \gset
select pg_temp.read_as(:'mem', format('select id::text from public.send_message(%L, %L)', :'c_app',
  'Please pay 500 euros for the visa before we continue.'), 'aal1') as fee_msg \gset
select pg_temp.read_as(:'wa', format('select id::text from public.send_message(%L, %L)', :'c_app', 'I will not pay, stop asking me.'),
  'aal1') as wa_msg \gset
select pg_temp.read_as(:'adm', format('select id::text from public.send_message(%L, %L)', :'c_app', 'When can you start?')) as adm_msg \gset

-- The member's message carries an invitation to apply (V71), whose connection hiding the message takes along.
insert into public.connections (kind, from_organization_id, to_user_id, conversation_id, job_id, created_by)
values ('invite_to_job', :'acme', :'wa', :'c_app', :'job', :'mem')
returning id as fee_conn \gset
update public.messages set connection_id = :'fee_conn' where id = :'fee_msg';

-- Contact requests: Acme to W1 (sent by the member), Beta to W2.
insert into public.contact_requests (organization_id, worker_user_id, card_id, sent_by, message, job_id, expires_at)
select :'acme', w.user_id, w.card_id, :'mem', 'Pay us 300 euros and the job is yours.', :'job', now() + interval '30 days'
from public.worker_profiles w where w.user_id = :'wa'
returning id as cr_a \gset
insert into public.contact_requests (organization_id, worker_user_id, card_id, sent_by, message, expires_at)
select :'beta', w.user_id, w.card_id, :'own2', 'We have a job for you in Germany.', now() + interval '30 days'
from public.worker_profiles w where w.user_id = :'wb'
returning id as cr_b \gset

-- Structure ------------------------------------------------------------------------------------------------------------------

select ok(
  'contact_request' = any (enum_range(null::public.report_target_type)::text[])
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reports'
                and column_name = 'contact_request_id')
    and not exists (select 1 from pg_constraint where conrelid = 'public.reports'::regclass and contype = 'f'
      and conkey @> array[(select attnum from pg_attribute where attrelid = 'public.reports'::regclass and attname = 'contact_request_id')]),
  'FR-S1 data: contact_request is a report target held in reports.contact_request_id, without a foreign key');
select ok(
  has_column_privilege('authenticated', 'public.messages', 'moderation_state', 'select')
    and has_column_privilege('authenticated', 'public.contact_requests', 'moderation_state', 'select')
    and not has_column_privilege('authenticated', 'public.messages', 'moderation_state', 'update')
    and not has_column_privilege('authenticated', 'public.contact_requests', 'moderation_state', 'update'),
  'FR-S1 data: moderation_state on messages and contact requests is read, never written, by the API roles');
select is(
  pg_temp.read_as(:'mem', format('update public.messages set moderation_state = ''visible'' where id = %L', :'fee_msg'), 'aal1'),
  '42501|permission denied for table messages|', 'FR-S1 AC5: a participant cannot set the state of a message directly');
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid)'::regprocedure)
    and has_function_privilege('anon', 'public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid)', 'execute')
    and not has_function_privilege('service_role', 'public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid)', 'execute'),
  'submit_report takes p_contact_request and stays a definer function for visitors and signed-in users');

-- FR-Q3 AC11: the worker reports a contact request -------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_find_workers';
select is(pg_temp.report(:'wa', 'contact_request', :'cr_a'), 'P0002|CHARA_NOT_FOUND|',
  'a contact request cannot be reported while release_find_workers is off');
update private.settings set value = 'true' where key = 'release_find_workers';

select pg_temp.report(:'wa', 'contact_request', :'cr_a') as cr_first \gset
select ok(:'cr_first' ~ '^R-\d{6,}\|false$', 'FR-Q3 AC11: W1 reports the request of Acme and gets a reference');
select pg_temp.report_id(:'cr_first') as cr_report \gset
select is(
  (select format('%s|%s|%s|%s|%s|%s', target_type, contact_request_id, reporter_user_id, status, organization_id is null,
     message_id is null) from public.reports where id = :cr_report),
  'contact_request|' || :'cr_a' || '|' || :'wa' || '|new|t|t',
  'FR-S1 AC1: one report row holding the request id only, nothing of its text or of the worker');
select is(pg_temp.report(:'wa', 'contact_request', :'cr_a'), split_part(:'cr_first', '|', 1) || '|true',
  'FR-S1 AC1: a repeat within 24 hours answers the same reference and stores nothing');
select is(
  pg_temp.report(:'wb', 'contact_request', :'cr_a') || ';' || pg_temp.report(:'mem', 'contact_request', :'cr_a') || ';'
    || pg_temp.report(:'own2', 'contact_request', :'cr_a', 'harassment', 'aal2') || ';'
    || pg_temp.report(:'padm', 'contact_request', :'cr_a', 'harassment', 'aal2') || ';'
    || pg_temp.report(:'wa', 'contact_request', :'cr_b') || ';' || pg_temp.report(:'wa', 'contact_request', gen_random_uuid()),
  'P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|',
  'FR-S1 AC2, NFR-S8: W2, the sending member, Beta, a partner, another worker''s request and a made-up id get the same CHARA_NOT_FOUND');
select is(pg_temp.report(null, 'contact_request', :'cr_a'), 'P0001|CHARA_FORBIDDEN|sign_in_required',
  'FR-S1 AC1: a visitor cannot report a contact request');
select is((select count(*)::integer from public.reports where contact_request_id is not null), 1,
  'FR-S1 AC2: no refused call wrote a report');
select is(
  (select count(*)::integer from audit.log where metadata::text like '%300 euros%' or metadata::text like '%500 euros%'),
  0, 'no text of a request or a message reaches audit.log');
select is(
  pg_temp.read_as(:'wa', format('select target_label from public.list_my_reports() where id = %s', :cr_report), 'aal1'),
  (select display_name from public.organizations where id = :'acme'),
  'the worker reads the own report by the organisation that sent the request');

-- FR-J3 (2c): fee demands from conversations and requests come first and are visible to Trust & Safety ------------------------

select pg_temp.report_id(pg_temp.report(:'mem', 'message', :'wa_msg', 'harassment')) as wa_report \gset
select pg_temp.report_id(pg_temp.report(:'wa', 'message', :'fee_msg')) as fee_report \gset
select is(
  pg_temp.read_as(:'t1', format($f$select string_agg(r.id::text, ',' order by r.ordinality)
    from public.admin_list_reports('open', null, 100) with ordinality r where r.id in (%s, %s, %s)$f$, :wa_report, :cr_report, :fee_report)),
  :cr_report || ',' || :fee_report || ',' || :wa_report,
  'FR-J3: the fee demands about the contact request and the message come before the older harassment report');
select is(
  pg_temp.read_as(:'padmin', format($f$select string_agg(r.target_label, ',' order by r.ordinality)
    from public.admin_list_reports('open', null, 100) with ordinality r where r.id in (%s, %s)$f$, :cr_report, :fee_report)),
  (select display_name from public.organizations where id = :'acme') || ',Message',
  'FR-J3, FR-S1 AC5: the Platform Administrator reads them in the queue, the request by its organisation, the message by its kind');
select is(
  pg_temp.read_as(:'t1', format($f$select format('%%s|%%s|%%s|%%s', organization_id = %L, item_moderation_state, item_context ? 'message',
    item_context ->> 'job_title') from public.admin_get_report(%s)$f$, :'acme', :cr_report)),
  't|visible|f|Welder Hamburg',
  'FR-S1 step Review: the report names Acme and the request''s vacancy, never its text');

-- NFR-C5: the text of a reported contact request, for the handler only ----------------------------------------------------------

select is(pg_temp.read_as(:'t1', format('select body from public.admin_get_reported_message(%s)', :cr_report)),
  '42501|CHARA_FORBIDDEN|', 'NFR-C5: nobody reads the request before the report is in review');
select is(pg_temp.read_as(:'t1', format($f$select 'ok' from public.admin_set_report_status(%s, 'in_review', 'Looking at the request now.')$f$, :cr_report)),
  'ok', 'T1 takes the report in review');
select is(
  pg_temp.read_as(:'t1', format($f$select format('%%s|%%s|%%s', body, sender_organization_name, reported) from public.admin_get_reported_message(%s)$f$, :cr_report)),
  'Pay us 300 euros and the job is yours.|' || (select display_name from public.organizations where id = :'acme') || '|t',
  'NFR-C5: the handler reads the request and its organisation');
select is(
  pg_temp.read_as(:'t2', format('select body from public.admin_get_reported_message(%s)', :cr_report)) || ';'
    || pg_temp.read_as(:'padmin', format('select body from public.admin_get_reported_message(%s)', :cr_report)) || ';'
    || pg_temp.read_as(:'t1', format('select body from public.admin_get_reported_message(%s)', :cr_report), 'aal1'),
  '42501|CHARA_FORBIDDEN|;P0001|CHARA_FORBIDDEN|;P0001|CHARA_FORBIDDEN|aal2_required',
  'NFR-C5: another Trust & Safety Administrator, the Platform Administrator and the handler at aal1 are refused');
select is(
  (select format('%s|%s|%s', count(*), min(actor_id::text), min(metadata ->> 'contact_request_id')) from audit.log
   where action = 'contact_request.context_opened' and entity_id = :'cr_report'::text),
  '1|' || :'t1' || '|' || :'cr_a', 'NFR-C5: one audit row contact_request.context_opened for the one opening, none for the refusals');
select is(pg_temp.read_as(:'t1', format('select sender_former::text from public.admin_get_reported_message(%s)', :cr_report)), 'false',
  'the member who sent the request is still a member, so staff do not call them a former member');
update public.contact_requests set sent_by = null where id = :'cr_a';
select is(pg_temp.read_as(:'t1', format('select sender_former::text from public.admin_get_reported_message(%s)', :cr_report)), 'true',
  'a request whose sender was erased is from a former member');
update public.contact_requests set sent_by = :'mem' where id = :'cr_a';

-- FR-S1 AC5: only Trust & Safety at aal2 decides on a message -------------------------------------------------------------------

select pg_temp.writes() as w0 \gset
select is(
  pg_temp.decide(:'padmin', 'hide', 'Fee demanded from a candidate.', :fee_report) || ';'
    || pg_temp.decide(:'reviewer', 'hide', 'Fee demanded from a candidate.', :fee_report) || ';'
    || pg_temp.decide(:'t1', 'hide', 'Fee demanded from a candidate.', :fee_report, null, null, 'aal1') || ';'
    || pg_temp.decide(:'own1', 'hide', 'Fee demanded from a candidate.', :fee_report) || ';'
    || pg_temp.decide(:'wa', 'hide', 'Fee demanded from a candidate.', :fee_report, null, null, 'aal1'),
  'P0001|CHARA_FORBIDDEN|;P0001|CHARA_FORBIDDEN|;P0001|CHARA_FORBIDDEN|aal2_required;P0001|CHARA_FORBIDDEN|;P0001|CHARA_FORBIDDEN|',
  'FR-S1 AC5: the Platform Administrator, a Verification Reviewer, T1 at aal1, the owner of Acme and the worker are refused');
select is(pg_temp.read_as(null, format($f$select 'x' from public.moderation_decide('hide', 'Fee demanded from a candidate.', %s)$f$, :fee_report)),
  '42501|permission denied for function moderation_decide|', 'FR-S1 AC5: an anonymous caller has no EXECUTE');
select is(pg_temp.decide(:'t1', 'hide', 'Too short', :fee_report), 'P0001|CHARA_INVALID_INPUT|reason',
  'FR-S1 AC4, NFR-C7: a statement of reasons of 9 characters is refused');
select is(pg_temp.writes(), :'w0', 'and nothing was written by a refused decision');

-- FR-S1 AC4, AC8: hide the member's message --------------------------------------------------------------------------------------

select is(pg_temp.decide(:'t1', 'hide', 'The message asks the candidate to pay a visa fee.', :fee_report), 'P0001|CHARA_INVALID_STATE|not_in_review',
  'NFR-C5: a report on a message is not decided before it is in review, as its text is unread until then');
select pg_temp.read_as(:'t1', format($f$select 'ok' from public.admin_set_report_status(%s, 'in_review', 'Reading the message now.')$f$, :fee_report)) as fee_review \gset
select is(pg_temp.decide(:'t2', 'hide', 'The message asks the candidate to pay a visa fee.', :fee_report), 'P0001|CHARA_INVALID_STATE|not_in_review',
  'NFR-C5: nor by a second administrator, who cannot read it while T1 has it in review');
select pg_temp.decide(:'t1', 'hide', 'The message asks the candidate to pay a visa fee.', :fee_report) as hid \gset
select ok(:'hid' ~ '^\d+\|actioned$', 'FR-S1 AC4: T1 hides the reported message and the report is actioned');
select split_part(:'hid', '|', 1)::bigint as act_fee \gset
select is(
  (select format('%s|%s|%s|%s', a.target_type, a.target_id, a.action, a.report_id) from public.moderation_actions a where a.id = :act_fee)
    || '|' || (select moderation_state from public.messages where id = :'fee_msg'),
  'message|' || :'fee_msg' || '|content_hidden|' || :fee_report || '|hidden',
  'FR-S1 data: one moderation_actions row (message, content_hidden) with the report, and the message is hidden');
select is(
  (select format('%s|%s', status, resolution_note) from public.reports where id = :fee_report),
  'actioned|The message asks the candidate to pay a visa fee.', 'FR-S1 AC4: the reasons close the report as its resolution note');
select is(
  (select string_agg(q.message ->> 'user_id', ',' order by q.message ->> 'user_id') from pgmq.q_notifications q
   where q.message ->> 'kind' = 'moderation_decision' and q.message ->> 'target_id' = :'fee_msg'),
  (select string_agg(u::text, ',' order by u::text) from unnest(array[:'own1', :'adm', :'mem']::uuid[]) u),
  'FR-S1 AC8: the owner and the admin of Acme and the member who sent the message are told');
select is(
  (select p - 'org_slug' from jsonb_array_elements(pg_temp.queued(:'mem')) p limit 1),
  jsonb_build_object('target_type', 'message', 'target_id', :'fee_msg', 'decision', 'hide',
    'reasons', 'The message asks the candidate to pay a visa fee.', 'moderation_action_id', :act_fee),
  'FR-S1 AC8: the notice holds the target, the decision, the reasons and the decision id, never the message text');
select ok(
  (select bool_and((q.message ->> 'mandatory')::boolean) from pgmq.q_notifications q
   where q.message ->> 'kind' = 'moderation_decision' and q.message ->> 'target_id' = :'fee_msg'),
  'FR-S1 AC8: every notice is mandatory');
select ok(
  exists (select 1 from jsonb_array_elements(pg_temp.queued(:'wa')) p where p ->> 'outcome' = 'actioned'),
  'FR-S1 step Inform: the reporting worker learns the outcome');

-- What hiding a message does ---------------------------------------------------------------------------------------------------

select is(
  pg_temp.read_as(:'wa', format('select string_agg(body, ''/'' order by created_at, id) from public.list_messages(%L)', :'c_app'), 'aal1'),
  'I will not pay, stop asking me./When can you start?', 'the other side no longer reads the hidden message');
select is(
  pg_temp.read_as(:'mem', format($f$select format('%%s|%%s', moderation_state, moderation_action_id) from public.list_messages(%L) where id = %L$f$,
    :'c_app', :'fee_msg'), 'aal1'),
  'hidden|' || :act_fee, 'the sending side reads it marked hidden with the decision it can appeal');
select is(
  pg_temp.read_as(:'wa', format('select count(*)::text from public.messages where conversation_id = %L', :'c_app'), 'aal1'),
  '2', 'a direct select of the other side leaves the hidden message out');
select is(
  pg_temp.read_as(:'wa', format('select coalesce(sum(unread), 0)::text from public.my_unread_counts() where conversation_id = %L', :'c_app'), 'aal1'),
  '1', 'the hidden message no longer counts as unread for the candidate');
select is(
  pg_temp.read_as(:'wa', format('select count(*)::text from public.list_conversation_connections(%L)', :'c_app'), 'aal1'),
  '0', 'the other side no longer reads the connection of the hidden message (V71)');
select is(
  pg_temp.read_as(:'mem', format('select id::text from public.list_conversation_connections(%L)', :'c_app'), 'aal1'),
  :'fee_conn', 'the sending side still reads the connection of its hidden message (V71)');
select is(pg_temp.report(:'wa', 'message', :'fee_msg', 'harassment'), 'P0002|CHARA_NOT_FOUND|',
  'a hidden message is not reported again');

-- Appeal of the organisation's message: the sender or the owners and admins, at aal2 ------------------------------------------

select is(
  pg_temp.read_as(:'mem', format('select format(''%%s|%%s'', title, can_appeal) from public.list_my_appeals(%s)', :act_fee), 'aal1'),
  'Message|t', 'FR-S1 step Appeal: the member who sent the message reads the decision and may appeal it');
select is(
  pg_temp.read_as(:'own2', format('select count(*)::text from public.list_my_appeals(%s)', :act_fee)) || ';'
    || pg_temp.read_as(:'wa', format('select count(*)::text from public.list_my_appeals(%s)', :act_fee), 'aal1'),
  '0;0', 'NFR-S8: Beta and the candidate read nothing of Acme''s decision');
select is(
  pg_temp.read_as(:'mem', format($f$select appeal_id::text from public.submit_appeal(%s, 'I only passed on what the agency asked for.')$f$, :act_fee), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'the member appeals at aal2, like an owner or admin');
select ok(
  pg_temp.read_as(:'mem', format($f$select appeal_id::text from public.submit_appeal(%s, 'I only passed on what the agency asked for.')$f$, :act_fee))
    ~ '^\d+$', 'FR-S1 AC9: the member who sent it appeals at aal2');
select is(
  (select format('%s|%s|%s', organization_id, appellant_user_id, status) from public.appeals where moderation_action_id = :act_fee),
  :'acme' || '|' || :'mem' || '|open', 'the appeal belongs to Acme and names the member as appellant');

-- A worker's message: hidden without a suspension, appealed by the worker ------------------------------------------------------

select pg_temp.read_as(:'t1', format($f$select 'ok' from public.admin_set_report_status(%s, 'in_review', 'Reading the message now.')$f$, :wa_report)) as wa_review \gset
select is(pg_temp.decide(:'t1', 'suspend_organization', 'The candidate sent an abusive message.', :wa_report),
  'P0001|CHARA_INVALID_INPUT|decision', 'a worker''s message has no organisation to suspend');
select pg_temp.decide(:'t1', 'hide', 'The message contains abusive language.', :wa_report) as hid_wa \gset
select split_part(:'hid_wa', '|', 1)::bigint as act_wa \gset
select is(
  (select string_agg(q.message ->> 'user_id' || '|' || coalesce(q.message ->> 'organization_id', '-'), ',') from pgmq.q_notifications q
   where q.message ->> 'kind' = 'moderation_decision' and q.message ->> 'target_id' = :'wa_msg'),
  :'wa' || '|-', 'FR-S1 AC8: the worker who sent the message is told, and no organisation');
select is(
  pg_temp.read_as(:'adm', format('select string_agg(body, ''/'' order by created_at, id) from public.list_messages(%L)', :'c_app')),
  'Please pay 500 euros for the visa before we continue./When can you start?',
  'Acme no longer reads the worker''s hidden message and still reads its own, hidden one');
select is(
  pg_temp.read_as(:'wa', format('select format(''%%s|%%s|%%s'', title, organization_id is null, can_appeal) from public.list_my_appeals(%s)', :act_wa), 'aal1'),
  'Message|t|t', 'the worker reads the decision on the own message and may appeal it');
select is(
  pg_temp.read_as(:'wb', format($f$select appeal_id::text from public.submit_appeal(%s, 'This was not abusive, please look again.')$f$, :act_wa), 'aal1')
    || ';' || pg_temp.read_as(:'own1', format($f$select appeal_id::text from public.submit_appeal(%s, 'This was not abusive, please look again.')$f$, :act_wa)),
  'P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|', 'NFR-S8: another worker and Acme''s owner cannot appeal it');
select ok(
  pg_temp.read_as(:'wa', format($f$select appeal_id::text from public.submit_appeal(%s, 'This was not abusive, please look again.')$f$, :act_wa), 'aal1')
    ~ '^\d+$', 'FR-S1 step Appeal: the worker appeals without a second step');
select id as wa_appeal from public.appeals where moderation_action_id = :act_wa \gset
select is((select format('%s|%s', organization_id is null, appellant_user_id) from public.appeals where id = :wa_appeal),
  't|' || :'wa', 'the appeal of a worker''s message has no organisation');
select is(pg_temp.read_as(:'t1', format($f$select status::text from public.decide_appeal(%s, 'restore', 'Looked again, the message was fair.')$f$, :wa_appeal)),
  'P0001|CHARA_FORBIDDEN|same_reviewer', 'FR-S1 AC9: the administrator who decided does not decide the appeal');
select is(
  pg_temp.read_as(:'padmin', format('select format(''%%s|%%s'', target_type, organization_id is null) from public.admin_list_appeals() where id = %s', :wa_appeal)),
  'message|t', 'staff list the worker''s appeal without an organisation');
select is(pg_temp.read_as(:'t2', format($f$select status::text || '|' || (reversal_action_id is not null)::text from public.decide_appeal(%s, 'restore', 'Looked again, the message was fair.')$f$, :wa_appeal)),
  'restored|true', 'FR-S1 AC9: a second administrator restores the message');
select is(
  (select moderation_state::text from public.messages where id = :'wa_msg')
    || '|' || (select a.action from public.moderation_actions a where a.target_type = 'message' and a.target_id = :'wa_msg' order by a.id desc limit 1),
  'visible|content_unhidden', 'the message is visible again through content_unhidden');
select is(
  (select p ->> 'appeal_outcome' from jsonb_array_elements(pg_temp.queued(:'wa')) p where p ? 'appeal_outcome'),
  'restored', 'FR-S1 AC9: the worker gets one notice with the outcome of the appeal');

-- Own findings and the release ---------------------------------------------------------------------------------------------

select ok(pg_temp.decide(:'t2', 'hide', 'Hidden on our own review of the thread.', null, 'message', :'adm_msg') ~ '^\d+\|-$',
  'FR-S1: Trust & Safety hides a message of its own finding');
select ok(pg_temp.decide(:'t2', 'unhide', 'Shown again after a second look.', null, 'message', :'adm_msg') ~ '^\d+\|-$',
  'and unhides it');
update private.settings set value = 'false' where key = 'release_messaging';
select is(pg_temp.decide(:'t2', 'hide', 'Hidden on our own review of the thread.', null, 'message', :'adm_msg'),
  'P0001|CHARA_FORBIDDEN|release_off', 'no decision on a message while release_messaging is off');
update private.settings set value = 'true' where key = 'release_messaging';

-- The contact request: hidden, then the sending organisation suspended --------------------------------------------------------

select pg_temp.decide(:'t1', 'hide', 'The request asks the worker to pay for the job.', :cr_report) as hid_cr \gset
select split_part(:'hid_cr', '|', 1)::bigint as act_cr \gset
select is(
  (select string_agg(q.message ->> 'user_id', ',' order by q.message ->> 'user_id') from pgmq.q_notifications q
   where q.message ->> 'kind' = 'moderation_decision' and q.message ->> 'target_id' = :'cr_a'),
  (select string_agg(u::text, ',' order by u::text) from unnest(array[:'own1', :'adm']::uuid[]) u),
  'FR-S1 AC8: the owner and the admin of Acme are told of the hidden request');
select is(
  pg_temp.read_as(:'wa', format('select count(*)::text from public.list_contact_requests_received() where id = %L', :'cr_a'), 'aal1')
    || ';' || pg_temp.read_as(:'wa', format('select count(*)::text from public.contact_requests where id = %L', :'cr_a'), 'aal1')
    || ';' || pg_temp.read_as(:'wa', format($f$select public.respond_to_contact_request(%L, 'accept')::text$f$, :'cr_a'), 'aal1'),
  '0;0;42501|CHARA_FORBIDDEN|', 'the worker no longer reads or answers the hidden request');
select is(
  pg_temp.read_as(:'adm', format($f$select format('%%s|%%s', moderation_state, moderation_action_id) from public.list_contact_requests_sent(%L) where id = %L$f$,
    :'acme', :'cr_a')),
  'hidden|' || :act_cr, 'Acme reads its request marked hidden with the decision');
select is(
  pg_temp.read_as(:'own1', format('select can_appeal::text from public.list_my_appeals(%s)', :act_cr)) || ';'
    || pg_temp.read_as(:'mem', format('select can_appeal::text from public.list_my_appeals(%s)', :act_cr)),
  'true;false', 'the owner may appeal the hidden request; the member who sent it reads it only');

select pg_temp.report_id(pg_temp.report(:'wb', 'contact_request', :'cr_b', 'misleading_or_fraud')) as crb_report \gset
select pg_temp.read_as(:'t1', format($f$select 'ok' from public.admin_set_report_status(%s, 'in_review', 'Reading the request now.')$f$, :crb_report)) as crb_review \gset
select pg_temp.decide(:'t1', 'suspend_organization', 'The organisation sends misleading job offers.', :crb_report) as sus_b \gset
select is(
  (select format('%s|%s|%s', a.target_type, a.target_id, a.action) from public.moderation_actions a where a.id = split_part(:'sus_b', '|', 1)::bigint)
    || '|' || (select status::text from public.organizations where id = :'beta'),
  'organization|' || :'beta' || '|organization_suspended|suspended',
  'FR-S1 AC7: a report about a contact request suspends the organisation that sent it');

select * from finish();
rollback;
