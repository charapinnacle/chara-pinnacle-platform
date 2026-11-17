begin;
select plan(79);

\ir status_fixture.inc

-- V26: the report queue of Phase 2 (FR-S1 step Receive, AC1, AC2 and AC3 for the partner_profile target; FR-J3 AC7;
-- FR-K4 AC10; NFR-C6, NFR-O5; decisions 2.7, 7.2): the target partner_profile of submit_report, reports.priority and
-- reports.due_at, and admin_list_reports fee demands first with the composite cursor (priority, due_at, id).

\set pow '00000000-0000-0000-0000-0000000f2601'
\set rvl '00000000-0000-0000-0000-0000000f2602'
\set gone_trust '00000000-0000-0000-0000-0000000f2603'
select pg_temp.new_user(:'pow', 'company', 'maria.santos@alpha-recruit.example');
select pg_temp.new_user(:'rvl');
select pg_temp.new_user(:'gone_trust');
update public.profiles set account_kind = intended_account_kind where id in (:'pow', :'rvl', :'gone_trust');
insert into public.platform_staff (user_id, role, revoked_at) values (:'gone_trust', 'trust_safety', now());

create temp sequence key_seq;
create function pg_temp.nextkey() returns text language sql as $$ select encode(sha256(('v26-' || nextval('pg_temp.key_seq'))::bytea), 'hex') $$;

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_slug text, p_listed boolean default true) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  if p_listed then
    update public.organizations set review_status = 'listed', listed_at = now() - interval '3 days', submitted_at = now() - interval '4 days'
    where id = v_id;
  end if;
  return v_id;
end;
$$;

-- submit_report for the partner profile p_slug as p_user (anonymous when null): 'ok' with the reference and the duplicate
-- flag in t.ref and t.dup, or 'sqlstate|message|detail'.
create function pg_temp.report_partner(
  p_user uuid, p_slug text, p_category text default 'misleading_or_fraud',
  p_details text default 'This company claims placements that it never made at all.', p_email text default null,
  p_key text default null
) returns text
language sql as $$
  select pg_temp.call_as(
    p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format(
      $f$select set_config('t.ref', r.reference, true), set_config('t.dup', r.is_duplicate::text, true)
         from public.submit_report(p_target_type => 'partner_profile', p_category => %L, p_details => %L, p_good_faith => true,
                                   p_key => %L, p_partner => %L, p_email => %L) r$f$,
      p_category, p_details, coalesce(p_key, pg_temp.nextkey()), p_slug, p_email),
    'aal1')
$$;

create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.reports) || ',' || (select count(*) from audit.log) || ',' || (select count(*) from pgmq.q_notifications)
$$;

-- The ids of a query's rows as one text in the order returned, or the refusal as 'sqlstate|message|detail'.
create function pg_temp.ids_as(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v jsonb := pg_temp.json_as(p_user, p_sql, p_aal);
begin
  return case when jsonb_typeof(v) = 'string' then v #>> '{}'
    else (select coalesce(string_agg(e ->> 'id', ',' order by o), '') from jsonb_array_elements(v) with ordinality t (e, o)) end;
end;
$$;

create function pg_temp.seed_report(
  p_type text, p_category text, p_at timestamptz, p_org uuid default null, p_job uuid default null, p_path text default null
) returns bigint
language sql as $$
  insert into public.reports (target_type, job_id, organization_id, content_path, category, details, good_faith_confirmed, created_at)
  values (p_type::public.report_target_type, p_job, p_org, p_path, p_category::public.report_category,
          'Seeded text of the report, long enough.', true, p_at)
  returning id
$$;

-- The cursor of a report as the arguments that follow p_limit: p_after_id, p_after_priority, p_after_due_at.
create function pg_temp.cursor_of(p_id bigint) returns text
language sql as $$
  select format('%s, %s::smallint, %L::timestamptz', r.id, r.priority, r.due_at) from public.reports r where r.id = p_id
$$;

select pg_temp.new_org(:'pow', 'recruitment_company', 'alpha-recruit') as alpha \gset
select pg_temp.new_org(:'rvl', 'staffing_company', 'rival-staffing') as rival \gset
select pg_temp.new_org(:'rvl', 'recruitment_company', 'pending-recruit', false) as pending_org \gset
select pg_temp.new_org(:'rvl', 'recruitment_company', 'declined-recruit') as declined \gset
select pg_temp.new_org(:'rvl', 'staffing_company', 'suspended-staffing') as suspended \gset
select pg_temp.new_org(:'rvl', 'staffing_company', 'hidden-staffing') as hidden \gset
update public.organizations set review_status = 'pending_review', submitted_at = now() where id = :'pending_org';
update public.organizations set review_status = 'declined' where id = :'declined';
update public.organizations set status = 'suspended' where id = :'suspended';
update public.organizations set moderation_state = 'hidden' where id = :'hidden';
select slug as acme_slug from public.organizations where id = current_setting('t.a')::uuid \gset
update private.settings set value = 'true' where key = 'release_partner_directories';

-- Structure and privileges ----------------------------------------------------------------------------------------------

select ok(
  'partner_profile' = any (enum_range(null::public.report_target_type)::text[]), 'AC1: partner_profile is a report target'
);
select is(
  (select format('%s|%s|%s', a.attgenerated, format_type(a.atttypid, a.atttypmod), a.attnotnull) from pg_attribute a
   where a.attrelid = 'public.reports'::regclass and a.attname = 'priority'),
  's|smallint|t', 'reports.priority is a stored generated column, never null'
);
select col_not_null('public', 'reports', 'due_at', 'reports.due_at is never null');
select is(
  (select string_agg(key || '=' || (value #>> '{}'), ',' order by key) from private.settings where key like 'report\_%target_working_days'),
  'report_fee_demand_target_working_days=1,report_first_look_target_working_days=2',
  'decision 7.2: the targets are settings, one working day for fee demands and two for a first look'
);
select is(
  (select string_agg(format('%s:%s:%s:%s', key, value_type, min, max), ',' order by key) from private.setting_rules where key like 'report\_%target_working_days'),
  'report_fee_demand_target_working_days:integer:1:20,report_first_look_target_working_days:integer:1:20',
  'NFR-O5: both are in the settings editor, 1 to 20 working days'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
   where oid = 'public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid)'::regprocedure)
  and has_function_privilege('anon', 'public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid)', 'execute'),
  'submit_report with p_partner is a definer function with an empty search_path, open to visitors and signed-in users only'
);
select is(
  (select count(*) from pg_proc where proname in ('submit_report', 'admin_list_reports', 'admin_get_report') and pronamespace = 'public'::regnamespace),
  3::bigint, 'the earlier signatures of submit_report and admin_list_reports are gone, no overload is left'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.admin_list_reports(text, public.report_target_type, integer, bigint, smallint, timestamptz)'::regprocedure)
  and has_function_privilege('authenticated', 'public.admin_list_reports(text, public.report_target_type, integer, bigint, smallint, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.admin_list_reports(text, public.report_target_type, integer, bigint, smallint, timestamptz)', 'execute'),
  'admin_list_reports is a definer function for signed-in callers only'
);
select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'reports_queue_idx'),
  'CREATE INDEX reports_queue_idx ON public.reports USING btree (priority, due_at, id) WHERE (status = ANY (ARRAY[''new''::report_status, ''in_review''::report_status]))',
  'the open queue is read in its order from one index'
);
select throws_ok(
  format($$insert into public.reports (target_type, organization_id, job_id, category, details, good_faith_confirmed)
           values ('partner_profile', %L, %L, 'other', 'Twenty characters or more of text.', true)$$, :'alpha', pg_temp.open_job('Check vacancy')),
  '23514', null, 'a partner_profile report holds the organisation only: no vacancy'
);
select throws_ok(
  $$insert into public.reports (target_type, category, details, good_faith_confirmed)
    values ('partner_profile', 'other', 'Twenty characters or more of text.', true)$$,
  '23514', null, 'and never no organisation'
);

-- Reporting a partner profile -------------------------------------------------------------------------------------------

select pg_temp.writes() as w0 \gset
select is(pg_temp.report_partner(null, 'alpha-recruit', p_email => 'visitor@example.test'), 'ok', 'AC1, FR-K4 AC10: a visitor reports a public partner profile');
select matches(current_setting('t.ref'), '^R-[0-9]{6}$', 'and gets a reference of the form R-000123');
select is(current_setting('t.dup'), 'false', 'which is not a duplicate');
select substr(current_setting('t.ref'), 3)::bigint as r_visitor \gset
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s', target_type, organization_id = :'alpha', job_id is null, application_id is null,
          content_path is null, status, category, reporter_user_id is null)
   from public.reports where id = :'r_visitor'),
  'partner_profile|t|t|t|t|new|misleading_or_fraud|t',
  'AC1: one new report holds only the id of the organisation, no vacancy, application or path'
);
select is(
  (select format('%s|%s|%s', metadata ->> 'target_type', metadata ->> 'organization_id' = :'alpha', metadata ? 'details')
   from audit.log where action = 'report.submitted' and entity_id = :'r_visitor'::text),
  'partner_profile|t|f', 'one audit row names the target and the organisation, without the text of the report'
);
select is(pg_temp.report_partner(null, 'alpha-recruit', p_email => 'visitor@example.test'), 'ok', 'the same visitor address reports it again');
select is(current_setting('t.dup') || '|' || current_setting('t.ref'), 'true|R-' || lpad(:'r_visitor', 6, '0'), 'AC1: and gets the first reference back as a duplicate');

select is(pg_temp.report_partner(:'wa', 'alpha-recruit', 'fee_demanded_from_worker', 'They asked me for 900 euros.'), 'ok', 'FR-J3 AC7: a worker reports a fee demand on the profile');
select substr(current_setting('t.ref'), 3)::bigint as r_fee \gset
select is(
  (select format('%s|%s|%s', priority, due_at = private.add_working_days(created_at, 1), reporter_user_id = :'wa') from public.reports where id = :'r_fee'),
  '1|t|t', 'FR-J3 AC7: with priority 1 and due one working day after it was made'
);
select is(pg_temp.report_partner(:'wa', 'alpha-recruit', 'fee_demanded_from_worker', 'They asked me again for 900 euros.'), 'ok', 'within 24 hours the same worker, target and category');
select is(current_setting('t.dup') || '|' || current_setting('t.ref'), 'true|R-' || lpad(:'r_fee', 6, '0'), 'AC1: gets the first reference back');
select is(pg_temp.report_partner(:'wa', 'alpha-recruit', 'harassment'), 'ok', 'another category is another report');
select substr(current_setting('t.ref'), 3)::bigint as r_other \gset
select is(
  (select format('%s|%s', priority, due_at = private.add_working_days(created_at, 2)) from public.reports where id = :'r_other'),
  '2|t', 'decision 7.2: priority 2, due two working days after it was made'
);
select is(pg_temp.writes(), format('%s,%s,%s', split_part(:'w0', ',', 1)::int + 3, split_part(:'w0', ',', 2)::int + 3, split_part(:'w0', ',', 3)),
  'three reports and three audit rows, nothing for the duplicates, and no notification is queued');
select is(pg_temp.report_partner(:'wa', 'alpha-recruit', 'other', 'Too short text 19ch'), 'P0001|CHARA_INVALID_INPUT|details', 'FR-J3 AC7: details of 19 characters are refused');
select throws_ok(
  format($$insert into public.reports (target_type, organization_id, category, details, good_faith_confirmed)
           values ('partner_profile', %L, 'fee_demanded_from_worker', 'Too short text 19ch', true)$$, :'alpha'),
  '23514', null, 'FR-J3 AC7: and the table refuses them with check_violation'
);

-- AC2: nothing says what exists
select pg_temp.writes() as w1 \gset
select is(pg_temp.report_partner(:'wa', 'no-such-partner'), 'P0002|CHARA_NOT_FOUND|', 'AC2: a slug that does not exist is not found');
select is(pg_temp.report_partner(:'wa', 'pending-recruit'), 'P0002|CHARA_NOT_FOUND|', 'and a partner waiting for review gets the same answer');
select is(pg_temp.report_partner(null, 'declined-recruit'), 'P0002|CHARA_NOT_FOUND|', 'and a declined partner');
select is(pg_temp.report_partner(null, 'suspended-staffing'), 'P0002|CHARA_NOT_FOUND|', 'and a suspended partner');
select is(pg_temp.report_partner(null, 'hidden-staffing'), 'P0002|CHARA_NOT_FOUND|', 'and a profile hidden by moderation');
select is(pg_temp.report_partner(null, :'acme_slug'), 'P0002|CHARA_NOT_FOUND|', 'and an employer, which has no partner profile');
select is(pg_temp.report_partner(:'wa', null), 'P0001|CHARA_INVALID_INPUT|partner', 'a missing slug is refused');
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.report_partner(null, 'alpha-recruit', 'other'), 'P0002|CHARA_NOT_FOUND|', 'while release 2a is off a listed profile is not found either');
update private.settings set value = 'true' where key = 'release_partner_directories';
select is(pg_temp.writes(), :'w1', 'AC2: the refused calls wrote no report and no audit row');

-- The visitor throttle of the action report still counts these reports
delete from private.rate_limit_hits;
update private.settings set value = '2' where key = 'rate_limit_report_max';
select is(
  pg_temp.report_partner(null, 'alpha-recruit', 'other', p_key => repeat('7', 64)) || ',' || pg_temp.report_partner(null, 'alpha-recruit', 'illegal_content', p_key => repeat('7', 64)),
  'ok,ok', 'two reports of one visitor are within a limit of two'
);
select matches(pg_temp.report_partner(null, 'alpha-recruit', 'discrimination', p_key => repeat('7', 64)), '^P0001\|CHARA_RATE_LIMITED\|[0-9]+$', 'the third is refused by the throttle');
update private.settings set value = '10' where key = 'rate_limit_report_max';

-- Reporter privacy: the reported partner reads nothing of the reports
select is(pg_temp.ids_as(:'pow', 'select * from public.admin_list_reports()'), 'P0001|CHARA_FORBIDDEN|', 'the owner of the reported partner cannot read the queue');
select is(pg_temp.call_as(:'pow', 'authenticated', format('select * from public.admin_get_report(%s)', :'r_fee')), 'P0001|CHARA_FORBIDDEN|', 'nor the report');
select is(pg_temp.ids_as(:'pow', 'select * from public.list_my_reports()', 'aal1'), '', 'and its own list holds only what it reported itself: nothing');
select is(pg_temp.call_as(:'pow', 'authenticated', 'select * from public.reports', 'aal1'), '42501|permission denied for table reports|', 'nor can it read the table');
select is(pg_temp.ids_as(:'rvl', 'select * from public.admin_list_reports()'), 'P0001|CHARA_FORBIDDEN|', 'nor can a competing partner');
select is(
  pg_temp.json_as(:'wa', format('select target_type, target_label from public.list_my_reports() where id = %s', :'r_fee'), 'aal1'),
  '[{"target_type": "partner_profile", "target_label": "Alpha Recruit"}]'::jsonb,
  'the reporter lists the report with the display name of the partner'
);

-- Due times (decision 7.2: working days Monday to Friday in Europe/Berlin, no holidays) ---------------------------------

select is(
  private.report_due_at('fee_demanded_from_worker', '2026-01-05 10:00 Europe/Berlin') || '|' || private.report_due_at('other', '2026-01-05 10:00 Europe/Berlin'),
  ('2026-01-06 10:00 Europe/Berlin'::timestamptz)::text || '|' || ('2026-01-07 10:00 Europe/Berlin'::timestamptz)::text,
  'AC3: made on a Monday, a fee demand is due on Tuesday and any other report on Wednesday at the same time'
);
select is(
  private.report_due_at('fee_demanded_from_worker', '2026-01-09 15:00 Europe/Berlin') || '|' || private.report_due_at('harassment', '2026-01-09 15:00 Europe/Berlin'),
  ('2026-01-12 15:00 Europe/Berlin'::timestamptz)::text || '|' || ('2026-01-13 15:00 Europe/Berlin'::timestamptz)::text,
  'made on a Friday, Monday and Tuesday: the weekend does not count'
);
select is(
  private.report_due_at('fee_demanded_from_worker', '2026-01-10 11:00 Europe/Berlin') || '|' || private.report_due_at('other', '2026-01-11 23:00 Europe/Berlin'),
  ('2026-01-13 00:00 Europe/Berlin'::timestamptz)::text || '|' || ('2026-01-14 00:00 Europe/Berlin'::timestamptz)::text,
  'made on a weekend, the count starts on the Monday after it'
);
select is(
  private.report_due_at('other', '2026-03-27 10:00 Europe/Berlin'), '2026-03-31 10:00 Europe/Berlin'::timestamptz,
  'in Berlin time: across the change to summer time the due time stays 10:00 local'
);
select is(
  pg_temp.call_as(:'st_admin', 'authenticated', $$select public.admin_set_setting('report_fee_demand_target_working_days', '3', 'Fee targets are three days for now.')$$),
  'ok', 'NFR-O5: a Platform Administrator at aal2 changes the fee-demand target in the settings editor'
);
select is(
  (select format('%s|%s', metadata -> 'before', metadata -> 'after') from audit.log where action = 'setting.changed' and entity_id = 'report_fee_demand_target_working_days'),
  '1|3', 'and the change is audited with the value before and after'
);
select is(
  private.report_due_at('fee_demanded_from_worker', '2026-01-05 10:00 Europe/Berlin'), '2026-01-08 10:00 Europe/Berlin'::timestamptz,
  'the next fee-demand report is due three working days after it was made, without a deployment'
);
select is(
  pg_temp.call_as(:'st_admin', 'authenticated', $$select public.admin_set_setting('report_first_look_target_working_days', '0', 'A target of nothing at all.')$$),
  'P0001|CHARA_INVALID_INPUT|value', 'a target outside 1 to 20 working days is refused'
);
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', $$select public.admin_set_setting('report_first_look_target_working_days', '4', 'Trust and Safety tries it.')$$),
  'P0001|CHARA_FORBIDDEN|', 'and Trust & Safety cannot change a target'
);
delete from private.settings where key = 'report_fee_demand_target_working_days';
select is(
  private.report_due_at('fee_demanded_from_worker', '2026-01-05 10:00 Europe/Berlin'), '2026-01-06 10:00 Europe/Berlin'::timestamptz,
  'a missing setting falls back to the target of decision 7.2'
);
insert into private.settings (key, value) values ('report_fee_demand_target_working_days', '1');
select pg_temp.seed_report('content', 'other', '2026-01-05 10:00 Europe/Berlin', p_path => '/en/jobs') as seeded \gset
select is(
  (select due_at from public.reports where id = :'seeded'),
  '2026-01-07 10:00 Europe/Berlin'::timestamptz, 'a row written straight into the table gets its due time too'
);

-- The queue: fee demands first, then by due time (AC3, FR-J3 AC7) ------------------------------------------------------

delete from public.reports;
select pg_temp.open_job('Queue welder') as qjob \gset
select pg_temp.seed_report('job', 'misleading_or_fraud', '2026-01-05 09:00 Europe/Berlin', p_job => :'qjob') as day1 \gset
select pg_temp.seed_report('partner_profile', 'fee_demanded_from_worker', '2026-01-07 09:00 Europe/Berlin', p_org => :'alpha') as day3 \gset
select pg_temp.seed_report('content', 'discrimination', '2026-01-06 09:00 Europe/Berlin', p_path => '/en/partners/alpha-recruit') as day2 \gset
select pg_temp.seed_report('company', 'fee_demanded_from_worker', '2026-01-08 09:00 Europe/Berlin', p_org => current_setting('t.a')::uuid, p_job => :'qjob') as day4 \gset
select pg_temp.seed_report('partner_profile', 'harassment', now(), p_org => :'rival') as fresh \gset

select is(
  pg_temp.ids_as(:'st_trust', $$select * from public.admin_list_reports('open')$$), format('%s,%s,%s,%s,%s', :'day3', :'day4', :'day1', :'day2', :'fresh'),
  'AC3: the two fee-demand reports first, oldest first, then the others by due time'
);
select is(
  pg_temp.ids_as(:'st_admin', 'select * from public.admin_list_reports()'), format('%s,%s,%s,%s,%s', :'day3', :'day4', :'day1', :'day2', :'fresh'),
  'AC3: in the same order for the Platform Administrator, who reads'
);
select is(
  pg_temp.json_as(:'st_trust', format('select priority, due_at = %L::timestamptz as due, overdue from public.admin_list_reports() where id = %s', '2026-01-08 09:00 Europe/Berlin', :'day3'), 'aal2'),
  '[{"due": true, "overdue": true, "priority": 1}]'::jsonb,
  'AC3: each row carries its due time, one working day for a fee demand, and a report past it is flagged overdue'
);
select is(
  pg_temp.json_as(:'st_trust', format('select priority, due_at = %L::timestamptz as due, overdue from public.admin_list_reports() where id = %s', '2026-01-07 09:00 Europe/Berlin', :'day1'), 'aal2'),
  '[{"due": true, "overdue": true, "priority": 2}]'::jsonb, 'two working days for a first look at another report'
);
select is(
  pg_temp.json_as(:'st_trust', format('select overdue from public.admin_list_reports() where id = %s', :'fresh'), 'aal2'),
  '[{"overdue": false}]'::jsonb, 'a report made now is not overdue'
);

-- Keyset pages of the composite cursor
select is(pg_temp.ids_as(:'st_trust', $$select * from public.admin_list_reports('open', null, 2)$$), format('%s,%s', :'day3', :'day4'), 'a page of two');
select is(
  pg_temp.ids_as(:'st_trust', format($$select * from public.admin_list_reports('open', null, 2, %s)$$, pg_temp.cursor_of(:'day4'))),
  format('%s,%s', :'day1', :'day2'), 'the next page starts after the cursor of the last row, across the fee-demand group'
);
select is(
  pg_temp.ids_as(:'st_trust', format($$select * from public.admin_list_reports('open', null, 2, %s)$$, pg_temp.cursor_of(:'day2'))),
  :'fresh'::text, 'and the last page ends the queue'
);
select is(
  pg_temp.ids_as(:'st_trust', format($$select * from public.admin_list_reports('open', null, 25, %s)$$, :'day3')), 'P0001|CHARA_INVALID_INPUT|cursor',
  'an id without the rest of the cursor is refused for the open queue'
);
select is(
  pg_temp.ids_as(:'st_trust', $$select * from public.admin_list_reports('actioned', null, 25, null, 1::smallint, null)$$), 'P0001|CHARA_INVALID_INPUT|cursor',
  'and a priority is refused for a closed list, which pages on the id'
);

-- Two reports with the same due time keep the order of their ids
select pg_temp.seed_report('content', 'other', '2026-01-10 12:00 Europe/Berlin', p_path => '/en/a') as sat \gset
select pg_temp.seed_report('content', 'other', '2026-01-11 08:00 Europe/Berlin', p_path => '/en/b') as sun \gset
select is((select count(distinct due_at) from public.reports where id in (:'sat', :'sun')), 1::bigint, 'a Saturday and a Sunday report are due at the same time');
select is(
  pg_temp.ids_as(:'st_trust', $$select * from public.admin_list_reports('open', 'content')$$), format('%s,%s,%s', :'day2', :'sat', :'sun'),
  'and are listed in the order they were made; the kind filter keeps the order'
);
select is(
  pg_temp.ids_as(:'st_trust', format($$select * from public.admin_list_reports('open', 'content', 1, %s)$$, pg_temp.cursor_of(:'sat'))), :'sun'::text,
  'the cursor separates them by id'
);
select is(
  pg_temp.ids_as(:'st_trust', $$select * from public.admin_list_reports('open', 'partner_profile')$$), format('%s,%s', :'day3', :'fresh'),
  'the queue filters by the kind partner_profile'
);

-- A report in review keeps its place; a closed one leaves the queue
select is(pg_temp.call_as(:'st_trust', 'authenticated', format($$select public.admin_set_report_status(%s, 'in_review', 'Reading the fee report.')$$, :'day4')), 'ok', 'Trust & Safety puts a fee-demand report in review');
select is(
  pg_temp.ids_as(:'st_trust', $$select * from public.admin_list_reports('open', null, 3)$$), format('%s,%s,%s', :'day3', :'day4', :'day1'), 'it keeps its place in the open queue'
);
select is(pg_temp.ids_as(:'st_trust', $$select * from public.admin_list_reports('in_review')$$), :'day4'::text, 'and is the one of the filter in review');
select is(pg_temp.call_as(:'st_trust', 'authenticated', format($$select public.admin_set_report_status(%s, 'dismissed', 'Nothing in it breaks the rules.')$$, :'day3')), 'ok', 'a report is closed');
select is(
  pg_temp.json_as(:'st_trust', format($$select id, overdue from public.admin_list_reports('all') where id = %s$$, :'day3'), 'aal2') -> 0 -> 'overdue',
  'false'::jsonb, 'a closed report is never overdue'
);
select is(
  pg_temp.ids_as(:'st_trust', $$select * from public.admin_list_reports('dismissed')$$), :'day3'::text, 'and is listed with its status, newest first as before'
);

-- The report in context
select is(
  (pg_temp.json_as(:'st_trust', format('select due_at from public.admin_get_report(%s)', :'fresh'), 'aal2') -> 0 ->> 'due_at')::timestamptz,
  (select due_at from public.reports where id = :'fresh'), 'the report in context carries its due time'
);
select is(
  pg_temp.json_as(:'st_admin', format('select target_type, organization_name, organization_slug, organization_status, job_id, priority, overdue, reporter_kind from public.admin_get_report(%s)', :'fresh'), 'aal2'),
  '[{"job_id": null, "overdue": false, "priority": 2, "target_type": "partner_profile", "reporter_kind": "visitor", "organization_name": "Rival Staffing", "organization_slug": "rival-staffing", "organization_status": "active"}]'::jsonb,
  'AC1: a partner_profile report shows the partner, its slug and status, the priority and whether it is overdue'
);

-- Retention: the closed_reports rule of Phase 1 removes a whole row, the new columns with it
update public.reports set status = 'dismissed', handled_by = :'st_trust', handled_at = now() - interval '366 days',
  resolution_note = 'Closed long ago for the retention test.'
where id = :'day2';
select private.apply_retention();
select is((select count(*) from public.reports where id = :'day2'), 0::bigint, 'retention: a closed report past the period of closed_reports is removed with its priority and due time');
select is((select count(*) from public.reports where id in (:'fresh', :'day1')), 2::bigint, 'and open reports are kept, however overdue');

select * from finish();
rollback;
