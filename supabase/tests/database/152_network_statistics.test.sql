begin;
select plan(82);

\ir organizations_fixture.inc

-- Network statistics for administrators, release 2a parts (V31, FR-S2 AC1 to AC6 and AC10; SOP P2-42 steps Aggregate,
-- Suppress, Show, risk "disclosure of individual activity through small counts", controls counts only, small-count
-- suppression, administrator role; NFR-S8): admin_network_counts over stats.network_events and
-- stats.partner_status_daily, the daily snapshot, and admin_network_kpis with the KPIs earlier units left to V31. The
-- 2b and 2c metrics (requirements, job orders, invitations, responses, submissions, contact requests, messages) are V58
-- and V74. The months of the criteria (2027) are moved to 2026 so that they lie in the past of the snapshots.

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_slug text, p_created timestamptz,
  p_review public.partner_review_status default null, p_status public.organization_status default 'active') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, review_status)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH', p_review);
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations set created_at = p_created, status = p_status,
    listed_at = case when p_review in ('listed', 're_review') then p_created end
  where id = v_id;
  return v_id;
end;
$$;

create function pg_temp.decide(p_org uuid, p_decision text, p_at timestamptz, p_hours numeric default 2) returns void
language sql as $$
  insert into public.partner_review_decisions (organization_id, decision, reason, info_step, from_status, to_status,
    submitted_at, decided_by, decided_at)
  values (p_org, p_decision, 'The reasons of the decision.', case when p_decision = 'request_info' then 'company' end,
    'pending_review', case p_decision when 'approve' then 'listed' when 'request_info' then 'info_requested' else 'declined' end::public.partner_review_status,
    p_at - make_interval(secs => p_hours * 3600), '00000000-0000-0000-0000-000000152009', p_at)
$$;

-- The rows of a call as p_user at p_aal, kept in t.result as one jsonb array; returns 'ok' or the refusal.
create function pg_temp.run(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    p_aal)
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

-- The count of one metric and period in the last result, as text ('null' when suppressed, 'missing' without a row).
create function pg_temp.n(p_metric text, p_period text) returns text
language sql as $$
  select coalesce((select coalesce(e ->> 'count', 'null') from jsonb_array_elements(pg_temp.result()) e
                   where e ->> 'metric' = p_metric and e ->> 'period_start' = p_period), 'missing')
$$;

-- value/base of one figure of the last admin_network_kpis result.
create function pg_temp.k(p_metric text) returns text
language sql as $$
  select coalesce((select coalesce(e ->> 'value', 'null') || '/' || coalesce(e ->> 'base', 'null')
                   from jsonb_array_elements(pg_temp.result()) e where e ->> 'metric' = p_metric), 'missing')
$$;

create function pg_temp.counts(p_from text, p_to text, p_period text default 'month') returns text
language sql as $$
  select pg_temp.run('00000000-0000-0000-0000-000000152001',
    format('select * from public.admin_network_counts(%L, %L, %L)', p_from, p_to, p_period))
$$;

create function pg_temp.explain_lines(p_sql text) returns setof text
language plpgsql as $$
declare
  v_line text;
begin
  for v_line in execute 'explain ' || p_sql loop
    return next v_line;
  end loop;
end;
$$;

\set adm '00000000-0000-0000-0000-000000152001'
\set tns '00000000-0000-0000-0000-000000152002'
\set ver '00000000-0000-0000-0000-000000152003'
\set emp '00000000-0000-0000-0000-000000152004'
\set prt '00000000-0000-0000-0000-000000152005'
\set wrk '00000000-0000-0000-0000-000000152006'
\set fan '00000000-0000-0000-0000-000000152007'
\set own '00000000-0000-0000-0000-000000152008'
\set dec '00000000-0000-0000-0000-000000152009'

select pg_temp.new_user(u) from unnest(array[:'adm', :'tns', :'ver', :'emp', :'prt', :'own', :'dec']::uuid[]) u;
select pg_temp.new_user(:'wrk', 'worker');
select pg_temp.new_user(:'fan', 'worker');
update public.profiles set account_kind = intended_account_kind
where id in (:'adm', :'tns', :'ver', :'emp', :'prt', :'wrk', :'fan', :'own', :'dec');
insert into public.platform_staff (user_id, role) values (:'adm', 'admin'), (:'tns', 'trust_safety'), (:'ver', 'verification_reviewer');

select is((select count(*)::integer from public.organizations where type <> 'employer'), 0,
  'precondition: the database holds no other partner organisation');

-- AC4: grants and roles ----------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.admin_network_counts(date, date, text)', 'execute'),
  'AC4: anon cannot execute admin_network_counts');
select ok(not has_function_privilege('anon', 'public.admin_network_kpis(date, date)', 'execute'),
  'AC4: anon cannot execute admin_network_kpis');
select is(pg_temp.call_as(null, 'anon', $$select * from public.admin_network_counts('2026-03-01', '2026-03-31', 'month')$$),
  '42501|permission denied for function admin_network_counts|', 'AC4: the anonymous call is refused for lack of EXECUTE');
select is(pg_temp.call_as(null, 'anon', 'select * from stats.network_events'),
  '42501|permission denied for schema stats|', 'AC4: anon cannot select from the view');
select is(pg_temp.call_as(:'adm', 'authenticated', 'select * from stats.network_events'),
  '42501|permission denied for schema stats|', 'AC4: a Platform Administrator cannot select from the view directly');
select is(pg_temp.call_as(:'adm', 'authenticated', 'select * from stats.partner_status_daily'),
  '42501|permission denied for schema stats|', 'AC4: nor from the daily states');
select ok(
  not has_table_privilege('authenticated', 'stats.network_events', 'select')
  and not has_table_privilege('anon', 'stats.partner_status_daily', 'select')
  and not has_table_privilege('authenticated', 'stats.partner_status_daily', 'select'),
  'NFR-S8: neither the view nor the daily states have an API grant');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'stats.partner_status_daily'::regclass),
  'NFR-S8: the daily states have RLS enabled and forced');
select ok((select coalesce(reloptions, '{}') @> array['security_invoker=true'] from pg_class where oid = 'stats.network_events'::regclass),
  'the view is security_invoker');
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_proc p where p.oid in ('public.admin_network_counts(date, date, text)'::regprocedure, 'public.admin_network_kpis(date, date)'::regprocedure)),
  'both functions are security definer with an empty search_path');

select is(pg_temp.counts('2026-03-01', '2026-03-31'), '42501|CHARA_FORBIDDEN|release_off',
  'release 2a off: the counts are refused');
select is(pg_temp.run(:'adm', $$select * from public.admin_network_kpis('2026-03-01', '2026-03-31')$$), '42501|CHARA_FORBIDDEN|release_off',
  'release 2a off: the key figures are refused');
update private.settings set value = 'true' where key = 'release_partner_directories';

select is(pg_temp.run(:'adm', $$select * from public.admin_network_counts('2026-03-01', '2026-03-31')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'AC4: a Platform Administrator at aal1 is sent to two-step verification');
select is(pg_temp.run(:'tns', $$select * from public.admin_network_counts('2026-03-01', '2026-03-31')$$),
  'P0001|CHARA_FORBIDDEN|', 'AC4: a Trust & Safety Administrator is refused');
select is(pg_temp.run(:'ver', $$select * from public.admin_network_counts('2026-03-01', '2026-03-31')$$),
  'P0001|CHARA_FORBIDDEN|', 'AC4: a Verification Reviewer is refused');
select is(pg_temp.run(:'tns', $$select * from public.admin_network_kpis('2026-03-01', '2026-03-31')$$),
  'P0001|CHARA_FORBIDDEN|', 'AC4: the key figures refuse a Trust & Safety Administrator');

-- The data of AC1 (March and April 2026) -----------------------------------------------------------------------------------
select pg_temp.new_org(:'emp', 'employer', 'stats-saver', '2026-01-05 09:00+00') as saver \gset
select pg_temp.new_org(:'emp', 'employer', 'stats-page', '2026-01-05 09:00+00') as page_org \gset
update public.organizations set public_page_enabled = true where id = :'page_org';

create temp table rc (id uuid, n integer);
create temp table sc (id uuid, n integer);
insert into rc
select pg_temp.new_org(:'prt', 'recruitment_company', 'stats-rc-' || g, '2026-03-02 10:00+00'::timestamptz + make_interval(days => g),
  case when g <= 10 then 'listed' else 'pending_review' end::public.partner_review_status,
  case when g = 10 then 'suspended' else 'active' end::public.organization_status), g
from generate_series(1, 12) g;
insert into sc
select pg_temp.new_org(:'prt', 'staffing_company', 'stats-sc-' || g, '2026-03-03 10:00+00'::timestamptz + make_interval(days => g), 'listed'), g
from generate_series(1, 7) g;

-- 17 approvals on Tuesday 10 March, 1 to 15 hours after the submission and two after 30 and 40 hours (late for the
-- target of one working day).
select pg_temp.decide(x.id, 'approve', '2026-03-10 08:00+00'::timestamptz + make_interval(hours => x.i::integer),
  case when x.i = 16 then 30 when x.i = 17 then 40 else x.i end)
from (select id, row_number() over (order by n) as i from (select id, n from rc where n <= 10 union all select id, 10 + n from sc) a) x;

-- The suspended company was suspended on 20 March; five employers too, which no partner metric counts.
insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id, created_at)
select 'organization', id, 'organization_suspended', 'Suspended for the statistics test.', :'adm', '2026-03-20 12:00+00'
from rc where n = 10;
insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id, created_at)
select 'organization', pg_temp.new_org(:'emp', 'employer', 'stats-suspended-' || g, '2026-01-05 09:00+00', null, 'suspended'),
  'organization_suspended', 'Suspended for the statistics test.', :'adm', '2026-03-20 12:00+00'
from generate_series(1, 5) g;

-- Five hidden staffing profiles, each appealed in March; two restored.
create temp table hides (id bigint, n integer);
create temp table reversals (id bigint, n integer);
with m as (
  insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id, created_at)
  select 'partner_profile', s.id, 'content_hidden', 'Hidden for the statistics test.', :'adm', '2026-03-11 12:00+00'
  from sc s where s.n <= 5
  returning id, target_id
)
insert into hides select m.id, s.n from m join sc s on s.id = m.target_id;
with m as (
  insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id, created_at)
  select 'partner_profile', s.id, 'content_unhidden', 'Shown again after the appeal.', :'adm', '2026-03-16 12:00+00'
  from sc s where s.n <= 2
  returning id, target_id
)
insert into reversals select m.id, s.n from m join sc s on s.id = m.target_id;
insert into public.appeals (moderation_action_id, organization_id, grounds, status, decided_by, reasons, lodged_at, due_at, decided_at,
  reversal_action_id)
select h.id, s.id, 'The profile was correct and should be shown.', case when r.id is not null then 'restored' else 'upheld' end::public.appeal_status,
  :'adm', 'The reasons of the appeal decision.', '2026-03-12 12:00+00', '2026-03-19 12:00+00', '2026-03-16 12:00+00', r.id
from hides h join sc s on s.n = h.n left join reversals r on r.n = h.n;

-- 240 recruitment searches in March and 60 in April, nine saved partners and six follows of partners in March; five
-- follows of an employer's company page, which the partner follows do not count.
insert into stats.partner_searches (kind, filter_names, destination_country, result_count, created_at)
select 'recruitment', '{destination}', 'DE', g % 3, '2026-03-01 00:00+00'::timestamptz + make_interval(mins => g * 150)
from generate_series(0, 239) g;
insert into stats.partner_searches (kind, filter_names, destination_country, result_count, created_at)
select 'recruitment', '{destination}', 'DE', 1, '2026-04-01 00:00+00'::timestamptz + make_interval(mins => g * 600)
from generate_series(0, 59) g;
insert into public.saved_items (organization_id, target_organization_id, kind, saved_by, created_at)
select :'saver', id, 'partner', :'emp', '2026-03-25 10:00+00' from rc where n <= 9;
insert into public.follows (user_id, organization_id, created_at)
select :'fan', id, '2026-03-26 10:00+00' from rc where n between 1 and 6;
insert into public.follows (user_id, organization_id, created_at)
select u, :'page_org', '2026-03-26 10:00+00' from unnest(array[:'wrk', :'emp', :'prt', :'own', :'dec']::uuid[]) u;

-- The state at the end of March, then three recruitment companies that start in April.
select is(private.snapshot_partner_statuses('2026-03-31'), 16, 'the snapshot writes every type and key, zero filled');
select pg_temp.new_org(:'prt', 'recruitment_company', 'stats-april-' || g, '2026-04-10 10:00+00') from generate_series(1, 3) g;
select private.snapshot_partner_statuses('2026-04-30');

-- AC1 ----------------------------------------------------------------------------------------------------------------------
select is(pg_temp.counts('2026-03-01', '2026-04-30'), 'ok', 'AC1: a Platform Administrator at aal2 reads the counts');
select is(jsonb_array_length(pg_temp.result()), 2 * (select count(*)::integer from private.network_count_metrics()),
  'AC1: one row per metric and month, no gap');
select is(pg_temp.n('recruitment_company.new', '2026-03-01') || ',' || pg_temp.n('recruitment_company.listed', '2026-03-01')
  || ',' || pg_temp.n('recruitment_company.active', '2026-03-01') || ',' || pg_temp.n('recruitment_company.decision_approve', '2026-03-01'),
  '12,9,11,10', 'AC1: March recruitment companies: 12 new, 9 listed, 11 active, 10 approved');
select is(pg_temp.n('staffing_company.new', '2026-03-01') || ',' || pg_temp.n('staffing_company.listed', '2026-03-01')
  || ',' || pg_temp.n('staffing_company.decision_approve', '2026-03-01'), '7,7,7', 'AC1: March staffing companies: 7 new, 7 listed, 7 approved');
select is(pg_temp.n('searches.recruitment', '2026-03-01') || ',' || pg_temp.n('searches.recruitment', '2026-04-01'), '240,60',
  'AC1: recruitment searches 240 in March and 60 in April');
select is(pg_temp.n('partner_saves', '2026-03-01') || ',' || pg_temp.n('partner_follows', '2026-03-01'), '9,6',
  'AC1: nine saved partners and six follows of partners (the five follows of a company page are not counted)');
select is(pg_temp.n('partner_profiles_hidden', '2026-03-01') || ',' || pg_temp.n('appeals_lodged', '2026-03-01')
  || ',' || pg_temp.n('appeals_decided', '2026-03-01') || ',' || pg_temp.n('appeals_restored', '2026-03-01'), '5,5,5,null',
  'AC1: five hidden partner profiles, five appeals lodged and decided; two restored is suppressed');
select is(pg_temp.n('recruitment_company.listed', '2026-04-01') || ',' || pg_temp.n('recruitment_company.new', '2026-04-01')
  || ',' || pg_temp.n('recruitment_company.onboarding', '2026-04-01'), '9,null,null',
  'AC1: April keeps the nine listed; three new (onboarding) is suppressed');

-- AC2 ----------------------------------------------------------------------------------------------------------------------
select is(pg_temp.n('recruitment_company.pending_review', '2026-03-01') || ',' || pg_temp.n('recruitment_company.suspended', '2026-03-01')
  || ',' || pg_temp.n('partner_suspensions', '2026-03-01') || ',' || pg_temp.n('partner_reinstatements', '2026-03-01'),
  'null,null,null,null', 'AC2: 2 pending, 1 suspended, 1 partner suspension (employers not counted) and 0 are null at 5');
select ok(not exists (
    select 1 from jsonb_array_elements(pg_temp.result()) e where (e ->> 'count')::integer < 5),
  'AC2: no row carries a value below 5');
delete from private.settings where key = 'stats_min_count';
select is(pg_temp.counts('2026-03-01', '2026-04-30'), 'ok', 'AC2: the key absent');
select is(pg_temp.n('recruitment_company.pending_review', '2026-03-01') || ',' || pg_temp.n('staffing_company.listed', '2026-03-01'),
  'null,7', 'AC2: with the key absent the floor 5 applies');
insert into private.settings (key, value) values ('stats_min_count', '8');
select pg_temp.counts('2026-03-01', '2026-04-30') = 'ok' as ran;
select is(pg_temp.n('staffing_company.listed', '2026-03-01') || ',' || pg_temp.n('recruitment_company.listed', '2026-03-01')
  || ',' || pg_temp.n('partner_follows', '2026-03-01'), 'null,9,null', 'AC2: at 8 the value 7 (and 6) is null too, 9 is shown');
update private.settings set value = '2' where key = 'stats_min_count';
select pg_temp.counts('2026-03-01', '2026-04-30') = 'ok' as ran;
select is(pg_temp.n('recruitment_company.pending_review', '2026-03-01') || ',' || pg_temp.n('partner_follows', '2026-03-01'),
  'null,6', 'AC2: at 2 the floor of 5 still applies');
update private.settings set value = '5' where key = 'stats_min_count';

-- AC3 ----------------------------------------------------------------------------------------------------------------------
select is(
  (select array_agg(n order by o) from unnest(
    (select proargnames from pg_proc where oid = 'public.admin_network_counts(date, date, text)'::regprocedure)) with ordinality a (n, o)
   where o > 3),
  array['metric', 'period_start', 'count']::text[], 'AC3: the result has exactly the columns metric, period_start and count');
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute where attrelid = 'stats.network_events'::regclass and attnum > 0),
  array['metric', 'occurred_at']::text[], 'AC3: the view carries a metric and a time only, no id, name or content');
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute where attrelid = 'stats.partner_status_daily'::regclass and attnum > 0
     and not attisdropped),
  array['day', 'organization_type', 'status_key', 'count']::text[], 'AC3: the daily states hold counts only');
select ok(
  (select prosrc from pg_proc where oid = 'public.admin_network_counts(date, date, text)'::regprocedure)
    !~* '(display_name|legal_name|slug|worker_documents|reporter|statement_of_reasons|grounds)',
  'AC3: the function reads no name, document, report text or reason');

-- AC5 ----------------------------------------------------------------------------------------------------------------------
select is(pg_temp.counts('2026-04-02', '2026-04-01'), 'P0001|CHARA_INVALID_INPUT|range', 'AC5: from after to is refused');
select is(pg_temp.counts('2025-03-01', '2026-03-02'), 'P0001|CHARA_INVALID_INPUT|range', 'AC5: 367 days are refused');
select is(pg_temp.counts('2025-03-02', '2026-03-02'), 'ok', 'AC5: 366 days are accepted');
select is(pg_temp.run(:'adm', $$select * from public.admin_network_counts(null, '2026-03-02', 'month')$$),
  'P0001|CHARA_INVALID_INPUT|range', 'AC5: a null from is refused');
select is(pg_temp.counts('2026-03-01', '2026-03-31', 'day'), 'P0001|CHARA_INVALID_INPUT|p_period', 'AC5: the period day is refused');
select is(pg_temp.run(:'adm', $$select * from public.admin_network_counts('2026-03-01', '2026-03-31')$$), 'ok', 'AC5: the period defaults to month');
select is((select string_agg(distinct e ->> 'period_start', ',') from jsonb_array_elements(pg_temp.result()) e), '2026-03-01',
  'AC5: one month');
select is(pg_temp.counts('2026-03-04', '2026-03-20', 'week'), 'ok', 'AC5: week is accepted');
select is((select string_agg(distinct e ->> 'period_start', ',' order by e ->> 'period_start') from jsonb_array_elements(pg_temp.result()) e),
  '2026-03-02,2026-03-09,2026-03-16', 'AC5: weeks start on Monday (UTC)');
select is(pg_temp.counts('2026-02-15', '2026-05-01', 'quarter'), 'ok', 'AC5: quarter is accepted');
select is((select string_agg(distinct e ->> 'period_start', ',' order by e ->> 'period_start') from jsonb_array_elements(pg_temp.result()) e),
  '2026-01-01,2026-04-01', 'AC5: quarters follow the calendar');
select is(pg_temp.n('recruitment_company.new', '2026-01-01'), '12', 'AC5: the first quarter is cut to the range and holds March');
select is(pg_temp.counts('2025-12-01', '2026-03-31', 'year'), 'ok', 'AC5: year is accepted');
select is((select string_agg(distinct e ->> 'period_start', ',' order by e ->> 'period_start') from jsonb_array_elements(pg_temp.result()) e),
  '2025-01-01,2026-01-01', 'AC5: years follow the calendar');

-- AC6: states at the end of each period (May 2026; 4 May is a Monday) -------------------------------------------------------
create temp table ac6 (id uuid, n integer);
insert into ac6
select pg_temp.new_org(:'prt', 'recruitment_company', 'stats-may-' || g, '2026-05-04 10:00+00', 'pending_review'), g
from generate_series(1, 10) g;
select pg_temp.new_org(:'emp', 'employer', 'stats-may-employer-' || g, '2026-05-05 10:00+00') from generate_series(1, 6) g;
select private.snapshot_partner_statuses('2026-05-10');
update public.organizations set review_status = 'info_requested' where id in (select id from ac6 where n <= 5);
select pg_temp.decide(id, 'request_info', '2026-05-12 10:00+00') from ac6 where n <= 5;
select private.snapshot_partner_statuses('2026-05-12');
update public.organizations set review_status = 'listed', listed_at = '2026-05-15 10:00+00' where id in (select id from ac6 where n <= 5);
select pg_temp.decide(id, 'approve', '2026-05-15 10:00+00') from ac6 where n <= 5;
select private.snapshot_partner_statuses('2026-05-15');
update public.organizations set review_status = 'declined' where id in (select id from ac6 where n > 5);
select pg_temp.decide(id, 'decline', '2026-05-20 10:00+00') from ac6 where n > 5;
select private.snapshot_partner_statuses('2026-05-20');
select private.snapshot_partner_statuses('2026-05-31');

select is(pg_temp.counts('2026-05-01', '2026-05-31'), 'ok', 'AC6: the May counts');
select is(pg_temp.n('recruitment_company.listed', '2026-05-01') || ',' || pg_temp.n('recruitment_company.declined', '2026-05-01')
  || ',' || pg_temp.n('recruitment_company.pending_review', '2026-05-01') || ',' || pg_temp.n('recruitment_company.info_requested', '2026-05-01'),
  '14,5,null,null', 'AC6: at the end of May 5 more are listed (14 with March), 5 declined, none pending or asked for information');
select is(pg_temp.n('recruitment_company.new', '2026-05-01'), '10', 'AC6: ten new recruitment companies, each counted once');
select is(pg_temp.n('recruitment_company.decision_approve', '2026-05-01') || ',' || pg_temp.n('recruitment_company.decision_request_info', '2026-05-01')
  || ',' || pg_temp.n('recruitment_company.decision_decline', '2026-05-01'), '5,5,5', 'AC6: five decisions of each kind');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.result()) e where e ->> 'metric' ~ 'employer'),
  'AC6: the six employers appear in no partner organisation metric');
select is(pg_temp.counts('2026-05-04', '2026-05-24', 'week'), 'ok', 'AC6: the May weeks');
select is(pg_temp.n('recruitment_company.pending_review', '2026-05-04') || ',' || pg_temp.n('recruitment_company.info_requested', '2026-05-04'),
  '12,null', 'AC6: at the end of the first week (10 May) the ten wait for review (with the two of March)');
select is(pg_temp.n('recruitment_company.listed', '2026-05-11') || ',' || pg_temp.n('recruitment_company.pending_review', '2026-05-11')
  || ',' || pg_temp.n('recruitment_company.info_requested', '2026-05-11'), '14,7,null',
  'AC6: at the end of the second week (latest state 15 May) five are listed, the other five (and the two of March) still wait');
select is(pg_temp.n('recruitment_company.declined', '2026-05-18'), '5', 'AC6: at the end of the third week five are declined');

-- The current period reads the live state; a repeated snapshot replaces its day.
select is(pg_temp.counts(((now() at time zone 'utc')::date - 3)::text, ((now() at time zone 'utc')::date)::text), 'ok', 'the current month');
select is(pg_temp.n('recruitment_company.listed', date_trunc('month', now() at time zone 'utc')::date::text), '14',
  'a period that ends today reads the live state');
select private.snapshot_partner_statuses('2026-05-31');
select is((select count(*)::integer from stats.partner_status_daily where day = '2026-05-31'), 16, 'a repeated snapshot replaces the day');
select ok(exists (select 1 from cron.job where jobname = 'snapshot-partner-statuses' and command = 'select private.snapshot_partner_statuses()'),
  'the daily job writes the snapshot');

-- Key figures (the KPIs left to V31) -------------------------------------------------------------------------------------
select is(pg_temp.run(:'adm', $$select * from public.admin_network_kpis('2026-03-01', '2026-03-31')$$), 'ok',
  'a Platform Administrator reads the key figures');
select is(pg_temp.k('stats_min_count'), '5/5', 'the first row is the threshold the values are hidden below');
select is(pg_temp.k('review_median_hours') || ' ' || pg_temp.k('review_on_target_share'), '9.0/17 88.2/17',
  'FR-J4 KPIs: median time to decision 9 hours, 15 of 17 within the target of one working day');
select is(pg_temp.k('approval_share'), '100.0/17', 'FR-J4 KPI: approval rate');
select is(pg_temp.k('approved_suspended_90d_share'), '5.9/17', 'FR-J4 KPI: approved partners suspended within 90 days (1 of 17)');
select is(pg_temp.k('appeal_reversal_share'), '40.0/5', 'FR-S1 KPI: decisions reversed on appeal (2 of 5)');
select is(pg_temp.k('contacts_per_100_searches'), '6.3/240', 'FR-L1 KPI: saves and follows per 100 searches (15 per 240)');
select is(pg_temp.k('listed.recruitment_company') || ' ' || pg_temp.k('listed.staffing_company'), '14/14 7/7', 'listed partners now');
select is(pg_temp.k('plan.recruitment_company.free_recruitment_company') || ' ' || pg_temp.k('plan.recruitment_company.recruitment_professional'),
  '24/24 null/null', 'FR-R1: active recruitment companies by plan; an empty plan is suppressed');
select is(pg_temp.k('employers_with_saved_partner_share') || ' ' || pg_temp.k('follows_per_company_page'), '12.5/8 null/null',
  'FR-L4 KPIs: one of eight active employers saved a partner; one company page is below the threshold');
select is(pg_temp.k('profile_complete_share') || ' ' || pg_temp.k('occupation_and_industry_share'), '0.0/21 0.0/21',
  'FR-K4 and FR-K2 KPIs over the 21 listed partners');

insert into public.organization_occupations (organization_id, occupation_id) select id, '7212' from rc where n <= 6;
insert into public.organization_geographies (organization_id, scope, country_code) select id, 'sources_from', 'PH' from rc where n <= 6;
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity, available_from)
select id, '7212', 'PH', 10, 2, current_date from rc where n <= 6;
update public.workforce_availability set confirmed_at = now() - interval '61 days'
where organization_id in (select id from rc where n <= 5);
insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until, confirmed_at,
  partner_terms_version, status)
select id, 'PH', 'Department of Migrant Workers', 'LIC-' || n, current_date + 10, now(), 1, 'current' from rc where n <= 5;
select pg_temp.run(:'adm', $$select * from public.admin_network_kpis('2026-03-01', '2026-03-31')$$) = 'ok' as ran;
select is(pg_temp.k('stale_listings') || ' ' || pg_temp.k('stale_listings_share'), '5/5 83.3/6',
  'FR-K3 KPI: five of six listings of listed partners are stale');
select is(pg_temp.k('licences_expiring'), '5/5', 'FR-J2: five licences expire within the reminder period');
select is(pg_temp.k('occupations_median') || ' ' || pg_temp.k('served_countries_median') || ' ' || pg_temp.k('source_and_served_share'),
  '0/21 0/21 0.0/21', 'FR-K2 and FR-K1 KPIs: medians and shares over the 21 listed partners (six with one occupation)');
select ok(not exists (
    select 1 from jsonb_array_elements(pg_temp.result()) e where (e ->> 'base')::integer < 5 or (e ->> 'value' is not null and e ->> 'base' is null)),
  'no figure has a base below 5, and no value is shown without its base');

-- AC10: the reads use indexes and stay fast at volume ----------------------------------------------------------------------
insert into stats.partner_searches (kind, filter_names, destination_country, result_count, created_at)
select (array['recruitment', 'staffing', 'available_workforce'])[1 + g % 3], '{destination}', 'DE', g % 4,
  now() - make_interval(mins => g * 10)
from generate_series(1, 50000) g;
create temp table bulk (id uuid);
insert into bulk
select pg_temp.new_org(:'prt', (array['recruitment_company', 'staffing_company'])[1 + g % 2]::public.organization_type, 'stats-bulk-' || g,
  now() - make_interval(hours => g), 'listed')
from generate_series(1, 5000) g;
insert into public.saved_items (organization_id, target_organization_id, kind, saved_by, created_at)
select e.id, b.id, 'partner', :'emp', now() - make_interval(mins => (random() * 500000)::integer)
from bulk b cross join (select :'saver'::uuid as id union all select :'page_org'::uuid) e;
analyze public.organizations;
analyze public.saved_items;
analyze stats.partner_searches;
analyze public.follows;

select ok(
  (select string_agg(l, ' ') from pg_temp.explain_lines($$select metric, count(*) from stats.network_events
     where occurred_at >= now() - interval '7 days' and occurred_at < now() group by metric$$) l)
    ~ 'partner_searches_created_at_idx.*' and
  (select string_agg(l, ' ') from pg_temp.explain_lines($$select metric, count(*) from stats.network_events
     where occurred_at >= now() - interval '7 days' and occurred_at < now() group by metric$$) l)
    ~ 'saved_items_created_at_idx' and
  (select string_agg(l, ' ') from pg_temp.explain_lines($$select metric, count(*) from stats.network_events
     where occurred_at >= now() - interval '7 days' and occurred_at < now() group by metric$$) l)
    ~ 'organizations_partner_created_at_idx',
  'AC10: a week of the view reads the time indexes of the searches, saved partners and partner organisations');
select ok(
  (select string_agg(l, ' ') from pg_temp.explain_lines($$select metric, count(*) from stats.network_events
     where occurred_at >= now() - interval '7 days' and occurred_at < now() group by metric$$) l)
    !~ 'Seq Scan on (partner_searches|saved_items)',
  'AC10: and scans neither table in full');

create function pg_temp.elapsed_ms(p_user uuid, p_sql text) returns numeric
language plpgsql as $$
declare
  v_start timestamptz := clock_timestamp();
begin
  perform pg_temp.run(p_user, p_sql);
  return extract(epoch from clock_timestamp() - v_start) * 1000;
end;
$$;
select cmp_ok(pg_temp.elapsed_ms(:'adm', format('select * from public.admin_network_counts(%L, %L, ''month'')',
    (now() at time zone 'utc')::date - 365, (now() at time zone 'utc')::date)), '<', 2000::numeric,
  'AC10: 366 days by month over 50,000 searches, 5,000 partners and 10,000 saved partners within 2 seconds');
select cmp_ok(pg_temp.elapsed_ms(:'adm', format('select * from public.admin_network_kpis(%L, %L)',
    (now() at time zone 'utc')::date - 365, (now() at time zone 'utc')::date)), '<', 2000::numeric,
  'AC10: the key figures over the same volume within 2 seconds');

select * from finish();
rollback;
