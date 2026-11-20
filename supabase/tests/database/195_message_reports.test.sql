begin;
select plan(30);

\ir apply_fixture.inc

-- Reporting a message and the reported context (V66, FR-P3 AC6 and AC7; SOP P2-28 steps Report and Review; decision 5.5;
-- NFR-C5, NFR-S8): the report target message, submit_report with p_message and admin_get_reported_message. Acme (t.a:
-- owner own1, admin adm, member mem) and Beta (t.b: owner own2, admin adm2) are the employers of the fixture; wa (W1) and
-- wb (W2) the candidates; Rekrut (owner padm, admin radm) and Second (owner u2), made below, the partner companies; t1 and
-- t2 Trust & Safety Administrators, a Platform Administrator and a Verification Reviewer.

\set padm '00000000-0000-0000-0000-0000000f6621'
\set radm '00000000-0000-0000-0000-0000000f6622'
\set u2 '00000000-0000-0000-0000-0000000f6623'
\set t1 '00000000-0000-0000-0000-0000000f6624'
\set t2 '00000000-0000-0000-0000-0000000f6625'
\set padmin '00000000-0000-0000-0000-0000000f6626'
\set reviewer '00000000-0000-0000-0000-0000000f6627'

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

-- submit_report of the message p_message as p_user: the reference and the duplicate flag as 'R-nnnnnn|f', or the error.
create function pg_temp.report(p_user uuid, p_message uuid, p_category text default 'fee_demanded_from_worker',
  p_aal text default 'aal1') returns text
language sql as $$
  select pg_temp.read_as(p_user, format($f$select r.reference || '|' || r.is_duplicate::text
    from public.submit_report(p_target_type => 'message', p_category => %L,
      p_details => 'They asked me to pay a fee for the job.', p_good_faith => true, p_key => %L, p_message => %L) r$f$,
    p_category, encode(sha256(('v66-' || nextval('pg_temp.key_seq'))::bytea), 'hex'), p_message), p_aal)
$$;

create function pg_temp.context(p_user uuid, p_report bigint, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format($f$select string_agg(body || case when reported then '*' else '' end, ',' order by created_at, id)
    from public.admin_get_reported_message(%s)$f$, p_report), p_aal)
$$;

create function pg_temp.review(p_report bigint, p_user uuid) returns text
language sql as $$
  select pg_temp.read_as(p_user, format($f$select 'ok' from public.admin_set_report_status(%s, 'in_review', 'Looking at the reported message.')$f$, p_report))
$$;

-- The fixture --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max',
  'rate_limit_message_max');
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
update public.profiles set display_name = 'Mia Member' where id = :'mem';
select pg_temp.new_user(u) from unnest(array[:'padm', :'radm', :'u2', :'t1', :'t2', :'padmin', :'reviewer']::uuid[]) u;
update public.profiles set display_name = 'Paul Partner' where id = :'padm';
update public.profiles set account_kind = intended_account_kind
where id in (:'padm', :'radm', :'u2', :'t1', :'t2', :'padmin', :'reviewer');
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

select pg_temp.partner('rekrut-v66r', 'Rekrut', :'padm') as rek \gset
select pg_temp.partner('second-v66r', 'Second', :'u2') as sec \gset
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
select pg_temp.read_as(:'adm', format('select public.open_conversation(''application'', %L)::text', :'app')) as c_app \gset
select pg_temp.read_as(:'radm', format('select public.open_conversation(''requirement_invitation'', %L)::text', :'inv_rek')) as c_inv \gset
select pg_temp.read_as(:'mem', format('select id::text from public.send_message(%L, %L)', :'c_app',
  'Please pay 500 euros for the visa before we continue.'), 'aal1') as x \gset
select pg_temp.read_as(:'wa', format('select id::text from public.send_message(%L, %L)', :'c_app', 'Why should I pay?'), 'aal1') as wa_msg \gset

-- Structure ------------------------------------------------------------------------------------------------------------------

select ok(
  'message' = any (enum_range(null::public.report_target_type)::text[])
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reports' and column_name = 'message_id'),
  'FR-P3 data: message is a report target and reports.message_id holds the message');
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.admin_get_reported_message(bigint)'::regprocedure)
    and has_function_privilege('authenticated', 'public.admin_get_reported_message(bigint)', 'execute')
    and not has_function_privilege('anon', 'public.admin_get_reported_message(bigint)', 'execute')
    and not has_function_privilege('service_role', 'public.admin_get_reported_message(bigint)', 'execute'),
  'admin_get_reported_message is a definer function with an empty search path, for authenticated callers only');
select is(
  (select count(*)::integer from pg_constraint where conrelid = 'public.reports'::regclass and contype = 'f'
     and conkey @> array[(select attnum from pg_attribute where attrelid = 'public.reports'::regclass and attname = 'message_id')]),
  0, 'FR-P3 data: no foreign key, so the report outlives a deleted message');

-- AC6: a participant reports a message -----------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_messaging';
select is(pg_temp.report(:'wa', :'x'), 'P0002|CHARA_NOT_FOUND|', 'a message cannot be reported while release_messaging is off');
update private.settings set value = 'true' where key = 'release_messaging';

select pg_temp.report(:'wa', :'x') as first_report \gset
select ok(:'first_report' ~ '^R-\d{6,}\|false$', 'FR-P3 AC6: W1 reports message X and gets the reference R-nnnnnn');
select substr(split_part(:'first_report', '|', 1), 3)::bigint as fee_report \gset
select is(
  (select format('%s|%s|%s|%s', target_type, message_id, reporter_user_id, status) from public.reports where id = :fee_report),
  'message|' || :'x' || '|' || :'wa' || '|new', 'FR-P3 AC6: one report row with the message id, the reporter W1 and status new');
select is(pg_temp.report(:'wa', :'x'), split_part(:'first_report', '|', 1) || '|true',
  'FR-P3 AC6: a repeat within 24 hours answers the same reference');
select is((select count(*)::integer from public.reports where message_id = :'x'), 1, 'FR-P3 AC6: and writes no second row');
select is(
  pg_temp.report(:'wb', :'x') || ';' || pg_temp.report(:'adm2', :'x', 'harassment', 'aal2') || ';'
    || pg_temp.report(:'padm', :'x', 'harassment', 'aal2') || ';' || pg_temp.report(:'u2', :'x', 'harassment', 'aal2') || ';'
    || pg_temp.report(:'wa', gen_random_uuid()),
  'P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|',
  'FR-P3 AC6, NFR-S8: W2, a Beta member, both partners and a made-up id get the same CHARA_NOT_FOUND');
select is(pg_temp.report(:'wa', :'wa_msg'), 'P0002|CHARA_NOT_FOUND|', 'FR-P3 AC6: a participant does not report an own message');
select is(pg_temp.report(null, :'x'), 'P0001|CHARA_FORBIDDEN|sign_in_required', 'a visitor is asked to sign in to report a message');
select pg_temp.report(:'mem', :'wa_msg', 'harassment') as member_report \gset
select ok(:'member_report' ~ '^R-\d{6,}\|false$', 'FR-P3 AC6: a member of the organisation reports a message of the candidate');
select substr(split_part(:'member_report', '|', 1), 3)::bigint as harassment_report \gset
select is(
  (select format('%s|%s|%s', metadata ->> 'target_type', metadata ->> 'category', metadata ->> 'message_id')
   from audit.log where action = 'report.submitted' and entity_id = :'fee_report'::text),
  'message|fee_demanded_from_worker|' || :'x', 'FR-P3 AC6: one audit row report.submitted with the kind, the category and the id');
select is(
  (select count(*)::integer from audit.log where metadata::text like '%500 euros%' or metadata::text like '%Why should I pay%'),
  0, 'FR-P3 AC6: no message body reaches audit.log');
select is(
  pg_temp.read_as(:'t1', format($f$select string_agg(r.id::text, ',' order by r.ordinality)
    from public.admin_list_reports('open', null, 100) with ordinality r where r.id in (%s, %s)$f$, :fee_report, :harassment_report)),
  :fee_report || ',' || :harassment_report, 'FR-P3 AC6: a fee demand from a message is listed before the other reports in the queue');
select is(
  pg_temp.read_as(:'t1', format('select target_label from public.admin_list_reports() where id = %s', :fee_report)),
  'Message', 'the queue names the item by its kind, never its text');

-- AC7: only the handler opens the context, every opening audited ------------------------------------------------------------

insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body, created_at)
select :'c_inv', case when g % 2 = 0 then :'mem'::uuid else :'padm'::uuid end, case when g % 2 = 0 then :'acme'::uuid else :'rek'::uuid end,
  'Message ' || g, now() - make_interval(mins => 31 - g)
from generate_series(1, 30) g;
select id as x12 from public.messages where conversation_id = :'c_inv' and body = 'Message 12' \gset
select id as x2 from public.messages where conversation_id = :'c_inv' and body = 'Message 2' \gset
select substr(split_part(pg_temp.report(:'radm', :'x12', 'harassment', 'aal2'), '|', 1), 3)::bigint as ctx_report \gset
select substr(split_part(pg_temp.report(:'radm', :'x2', 'harassment', 'aal2'), '|', 1), 3)::bigint as start_report \gset

select is(pg_temp.context(:'t1', :ctx_report), '42501|CHARA_FORBIDDEN|',
  'FR-P3 AC7: the context of a report nobody has put in review stays closed');
select is(pg_temp.review(:ctx_report, :'t1') || ';' || pg_temp.review(:start_report, :'t1'), 'ok;ok',
  'FR-P3 AC7: T1 takes the reports in review through admin_set_report_status');
select is(pg_temp.context(:'t1', :ctx_report),
  'Message 7,Message 8,Message 9,Message 10,Message 11,Message 12*,Message 13,Message 14,Message 15,Message 16,Message 17',
  'FR-P3 AC7: T1 at aal2 receives X (the 12th) and the five messages before and the five after it, nothing else');
select is(pg_temp.context(:'t1', :ctx_report),
  'Message 7,Message 8,Message 9,Message 10,Message 11,Message 12*,Message 13,Message 14,Message 15,Message 16,Message 17',
  'FR-P3 AC7: and again on a second opening');
select is(
  pg_temp.read_as(:'t1', format($f$select string_agg(concat_ws('|', sender_kind, sender_name, sender_organization_name), ',' order by created_at)
    from public.admin_get_reported_message(%s) where body in ('Message 11', 'Message 12')$f$, :ctx_report)),
  'organization|Paul Partner|Rekrut,organization|Mia Member|Acme Bau', 'FR-P3 AC7: each with the sender as staff may know it');
select is(
  (select format('%s|%s|%s|%s', count(*), min(actor_id::text), max(jsonb_array_length(metadata -> 'message_ids')),
     max(metadata ->> 'message_id'))
   from audit.log where action = 'message.context_opened' and entity_id = :'ctx_report'::text),
  '3|' || :'t1' || '|11|' || :'x12',
  'FR-P3 AC7, NFR-C5: one audit row message.context_opened per opening (three above) with the actor, the report and the message ids');
select is(
  (select count(*)::integer from audit.log where action = 'message.context_opened' and metadata::text like '%Message 1%'),
  0, 'FR-P3 AC7: the audit rows hold no body');
select is(pg_temp.context(:'t1', :start_report), 'Message 1,Message 2*,Message 3,Message 4,Message 5,Message 6,Message 7',
  'FR-P3 AC7: fewer messages around one at the start of the conversation');
select is(
  pg_temp.context(:'t2', :ctx_report) || ';' || pg_temp.context(:'padmin', :ctx_report) || ';'
    || pg_temp.context(:'reviewer', :ctx_report) || ';' || pg_temp.context(:'t1', :ctx_report, 'aal1') || ';'
    || pg_temp.context(:'own1', :ctx_report) || ';' || pg_temp.context(:'radm', :ctx_report),
  '42501|CHARA_FORBIDDEN|;P0001|CHARA_FORBIDDEN|;P0001|CHARA_FORBIDDEN|;P0001|CHARA_FORBIDDEN|aal2_required;P0001|CHARA_FORBIDDEN|;P0001|CHARA_FORBIDDEN|',
  'FR-P3 AC7: T2 (not assigned), a Platform Administrator, a Verification Reviewer, T1 at aal1, an Acme owner and the reporter are refused');
select is(
  split_part(pg_temp.context(null, :ctx_report), '|', 1) || ';'
    || (select count(*) from audit.log where action = 'message.context_opened' and entity_id = :'ctx_report'::text),
  '42501;3', 'FR-P3 AC7: an anonymous caller is refused, and no refusal wrote an audit row');
select is(pg_temp.read_as(:'t1', format('select count(*)::text from public.messages where conversation_id = %L', :'c_inv')), '0',
  'FR-P3 AC7: T1 still reads no row of public.messages directly');
update public.profiles set display_name = null where id = :'mem';
select is(
  pg_temp.read_as(:'t1', format($f$select string_agg(concat_ws('|', coalesce(sender_name, '-'), sender_former), ',' order by created_at)
    from public.admin_get_reported_message(%s) where body in ('Message 11', 'Message 12')$f$, :ctx_report)),
  'Paul Partner|f,-|f', 'a member without a display name is still a member, not a former one');
delete from public.organization_members where organization_id = :'rek' and user_id = :'radm';
update public.messages set sender_user_id = :'radm' where conversation_id = :'c_inv' and body = 'Message 13';
update public.messages set sender_user_id = null where conversation_id = :'c_inv' and body = 'Message 14';
select is(
  pg_temp.read_as(:'t1', format($f$select string_agg(concat_ws('|', coalesce(sender_name, '-'), sender_former), ',' order by created_at)
    from public.admin_get_reported_message(%s) where body in ('Message 11', 'Message 13', 'Message 14')$f$, :ctx_report)),
  'Paul Partner|f,-|t,-|t', 'a sender removed from the organisation and an erased one are former members');
update private.settings set value = 'false' where key = 'release_messaging';
select is(pg_temp.context(:'t1', :ctx_report), '42501|CHARA_FORBIDDEN|release_off',
  'the context is not opened while release_messaging is off');

select * from finish();
rollback;
