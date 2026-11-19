begin;
select plan(160);

\ir apply_fixture.inc
\ir billing_events_fixture.inc

-- Workforce requirement lifecycle (V33, FR-M2 AC1 to AC8, AC10 to AC12 database parts, FR-T1 AC6 employer part; SOP
-- P2-16; decision 3.5; NFR-O5, NFR-A3, NFR-S8; DATA_MODEL.md sections 2, 4, 6, 7, 9 and 11): the guard trigger,
-- publish_requirement, set_requirement_status, extend_requirement, the daily close and reminder jobs, the pause on a
-- lapse and the edit rules of save_requirement. Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner own2,
-- admin adm2) are employers of the fixture; wa and wb are candidates. A recruitment company Delta is made below.

\set dadm '00000000-0000-0000-0000-0000000f3301'
\set delta '00000000-0000-0000-0000-0000000f3311'
\set zown '00000000-0000-0000-0000-0000000f3302'
\set zeta '00000000-0000-0000-0000-0000000f3312'

select pg_temp.new_user(:'dadm');
update public.profiles set account_kind = intended_account_kind where id = :'dadm';
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
values (:'delta', 'recruitment_company', 'delta-recruit-157', 'Delta Recruit Ltd', 'Delta Recruit', 'PH');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'delta', :'dadm', 'owner', now());
update public.organizations set review_status = 'listed', submitted_at = now(), listed_at = now() where id = :'delta';
select pg_temp.new_user(:'zown');
update public.profiles set account_kind = intended_account_kind where id = :'zown';
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, status)
values (:'zeta', 'employer', 'zeta-works-157', 'Zeta Works GmbH', 'Zeta Works', 'DE', 'suspended');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'zeta', :'zown', 'owner', now());

create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'utc')::date $$;

-- A requirement of p_org in p_status written as the database owner (an insert passes no guard), as the lifecycle
-- functions leave it: published 10 days ago and closing in 80 days unless p_over says otherwise; its status changed a
-- day ago, so a change made now is seen. One occupation row covers the workers.
create function pg_temp.seed_req(p_org uuid, p_status text, p_over jsonb default '{}') returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_published boolean := p_status <> 'draft';
begin
  insert into public.workforce_requirements (
    organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on, close_reason, status_changed_at,
    updated_at
  ) values (
    p_org, coalesce(p_over ->> 'title', 'Welders ' || p_status), 10, 'DE', 'Hamburg', 'C',
    coalesce((p_over ->> 'start')::date, pg_temp.today() + 30), 'full_time', 'international', 'both',
    p_status::public.requirement_status,
    case when v_published then coalesce(p_over ->> 'visibility', 'private')::public.requirement_visibility end,
    case when v_published then now() - interval '10 days' end,
    case when v_published then coalesce((p_over ->> 'closes_on')::date, pg_temp.today() + 80) end,
    case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason,
    now() - interval '1 day', now() - interval '1 day'
  ) returning id into v_id;
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

create function pg_temp.version(p_req uuid) returns timestamptz
language sql as $$ select updated_at from public.workforce_requirements where id = p_req $$;

-- The three actions as a user (anonymous when null), with the requirement's current version unless one is given:
-- 'ok' or 'sqlstate|message|detail'.
create function pg_temp.st(
  p_user uuid, p_req uuid, p_status text, p_reason text default null, p_aal text default 'aal2', p_org uuid default null,
  p_version timestamptz default null
) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    'select public.set_requirement_status(%L, %L, %L::public.requirement_status, %L::timestamptz, %L::public.requirement_close_reason)',
    coalesce(p_org, current_setting('t.a')::uuid), p_req, p_status, coalesce(p_version, pg_temp.version(p_req)), p_reason), p_aal)
$$;

create function pg_temp.pub(
  p_user uuid, p_req uuid, p_visibility text default 'private', p_show boolean default false, p_org uuid default null
) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    'select public.publish_requirement(%L, %L, %L::public.requirement_visibility, %L, %L::timestamptz)',
    coalesce(p_org, current_setting('t.a')::uuid), p_req, p_visibility, p_show, pg_temp.version(p_req)))
$$;

create function pg_temp.ext(p_user uuid, p_req uuid, p_org uuid default null) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.extend_requirement(%L, %L, %L::timestamptz)',
    coalesce(p_org, current_setting('t.a')::uuid), p_req, pg_temp.version(p_req)))
$$;

create function pg_temp.state(p_req uuid) returns text
language sql as $$
  select status || coalesce(':' || close_reason, '') from public.workforce_requirements where id = p_req
$$;

create function pg_temp.audits(p_req uuid, p_action text default 'requirement.status_changed') returns integer
language sql as $$ select count(*)::integer from audit.log where entity_type = 'requirement' and entity_id = p_req::text and action = p_action $$;

-- A query run as the user: its single value, or 'sqlstate|message' when refused.
create function pg_temp.read_as(p_user uuid, p_sql text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
  begin
    execute p_sql into v_result;
  exception when others then
    v_result := sqlstate || '|' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- The rows of requirement_closing_soon per recipient, as position:status, ordered by the users given.
create function pg_temp.reminders(p_users uuid[]) returns text
language sql as $$
  select coalesce(string_agg(u.ord || ':' || n.status, ',' order by u.ord), '')
  from unnest(p_users) with ordinality u (id, ord)
  join public.notifications n on n.user_id = u.id and n.kind = 'requirement_closing_soon'
$$;

-- Schema --------------------------------------------------------------------------------------------------------------

select enum_has_labels('public', 'requirement_close_reason', array['filled', 'cancelled', 'expired'], 'requirement_close_reason');
select columns_are('public', 'workforce_requirements', array[
  'id', 'organization_id', 'title', 'workers_needed', 'country_code', 'city_region', 'industry_code', 'skills',
  'experience_years', 'start_date', 'duration_months', 'employment_type', 'salary_min', 'salary_max', 'salary_currency',
  'salary_period', 'accommodation', 'work_permit_support', 'visa_support', 'recruitment_preference', 'partner_need', 'status',
  'visibility', 'show_identity', 'created_by', 'created_at', 'updated_at', 'published_at', 'closes_on', 'close_reason',
  'status_changed_at', 'closing_reminder_for', 'max_capacity_over_percent'
], 'the lifecycle columns of DATA_MODEL section 6 are added (moderation_state V57; max_capacity_over_percent came with V44)');
select has_trigger('public', 'workforce_requirements', 'workforce_requirements_guard_transition', 'the guard trigger exists');
select is((select tgenabled::text from pg_trigger where tgname = 'workforce_requirements_guard_transition'), 'A',
  'the guard fires always, also for a replica session');
select is(
  (select string_agg(jobname || ' ' || schedule, ',' order by jobname) from cron.job
   where jobname in ('close-expired-requirements', 'remind-closing-requirements')),
  'close-expired-requirements 10 0 * * *,remind-closing-requirements 20 0 * * *',
  'the two daily jobs are scheduled (pg_cron runs in UTC), closing before reminding');
select is(
  (select string_agg(r.key || '=' || (s.value #>> '{}') || ' ' || r.min || '..' || r.max, ',' order by r.key)
   from private.setting_rules r join private.settings s using (key) where r.key like 'requirement\_%'),
  'requirement_change_notice_minutes=15 0..1440,requirement_closing_reminder_days=7 1..30,requirement_extension_days=30 7..90,requirement_extension_horizon_days=365 30..1095,requirement_open_days=90 30..365',
  'NFR-O5: the durations (and the V43 change notice delay) are settings of the settings editor with their bounds');
select is((select count(*)::integer from private.missing_reference_data() where kind = 'setting'), 0,
  'the deployment check finds every setting the functions read');
select is((select organization_types::text from private.notification_kinds where kind = 'requirement_closing_soon'),
  '{employer,recruitment_company,staffing_company}', 'requirement_closing_soon is offered to employers and (V43) to partners');
select is((select count(*)::integer from private.notification_kinds where kind = 'requirement_closing_soon' and not mandatory and default_email), 1,
  'requirement_closing_soon is optional and emailed by default');
select alike(pg_temp.read_as(:'own1', 'select closing_reminder_for from public.workforce_requirements limit 1'), '42501|%',
  'closing_reminder_for is not readable through the Data API');

-- Release switch ------------------------------------------------------------------------------------------------------

select pg_temp.seed_req(current_setting('t.a')::uuid, 'draft') as r_off \gset
select is(pg_temp.pub(:'own1', :'r_off'), 'P0001|CHARA_FORBIDDEN|release_off', 'release 2b off: publishing is refused');
select is(pg_temp.st(:'own1', :'r_off', 'paused'), 'P0001|CHARA_FORBIDDEN|release_off', 'release 2b off: a status change is refused');
select is(pg_temp.ext(:'own1', :'r_off'), 'P0001|CHARA_FORBIDDEN|release_off', 'release 2b off: an extension is refused');
update private.settings set value = 'true' where key = 'release_job_orders';

-- AC1: the allowed changes, by the owner and by the admin ------------------------------------------------------------

create temp table t_ac1 (who text, change text, req uuid, result text);
insert into t_ac1 (who, change, req)
select w, c, pg_temp.seed_req(current_setting('t.a')::uuid, split_part(c, '>', 1))
from unnest(array['owner', 'admin']) w
cross join unnest(array['draft>open', 'open>paused', 'open>closed', 'open>filled', 'paused>open', 'paused>closed']) c;
update t_ac1 set result = case
  when change = 'draft>open' then pg_temp.pub(case who when 'owner' then :'own1'::uuid else :'adm'::uuid end, req)
  else pg_temp.st(case who when 'owner' then :'own1'::uuid else :'adm'::uuid end, req, split_part(change, '>', 2),
         case when change like '%>closed' then 'cancelled' end)
end;
select is(string_agg(who || ' ' || change || ' ' || result, ', ' order by who, change), (
  select string_agg(w || ' ' || c || ' ok', ', ' order by w, c)
  from unnest(array['owner', 'admin']) w
  cross join unnest(array['draft>open', 'open>paused', 'open>closed', 'open>filled', 'paused>open', 'paused>closed']) c),
  'AC1: every allowed change succeeds for the owner and for the admin at aal2') from t_ac1;
select is(
  (select count(*)::integer from t_ac1 t join public.workforce_requirements r on r.id = t.req
   where r.status::text = split_part(t.change, '>', 2) and r.status_changed_at = now()),
  12, 'AC1: each requirement has its new status and status_changed_at is set on every change');
select is(
  (select count(*)::integer from t_ac1 t join audit.log l on l.entity_id = t.req::text and l.entity_type = 'requirement'
   where l.action = 'requirement.status_changed'
     and l.actor_id = case t.who when 'owner' then :'own1'::uuid else :'adm'::uuid end
     and l.metadata ->> 'from' = split_part(t.change, '>', 1) and l.metadata ->> 'to' = split_part(t.change, '>', 2)
     and l.metadata ->> 'organization_id' = current_setting('t.a')),
  12, 'AC1: exactly one audit row requirement.status_changed per change, with the user and both statuses');
select is((select count(*)::integer from t_ac1 t join audit.log l on l.entity_id = t.req::text and l.action like 'requirement.%'),
  12, 'AC1: and no other requirement audit row');
select is(
  (select string_agg(split_part(t.change, '>', 2) || ':' || coalesce(r.close_reason::text, '-'), ',' order by t.change)
   from t_ac1 t join public.workforce_requirements r on r.id = t.req where t.who = 'owner'),
  'open:-,closed:cancelled,filled:filled,paused:-,closed:cancelled,open:-',
  'AC10: a close records the reason cancelled, a fill the reason filled, the other changes none');
select is(
  (select format('%s|%s|%s|%s', r.published_at = now(), r.closes_on = private.requirement_closes_on(pg_temp.today(), r.start_date),
     r.closes_on, r.visibility)
   from t_ac1 t join public.workforce_requirements r on r.id = t.req where t.who = 'owner' and t.change = 'draft>open'),
  format('t|t|%s|private', pg_temp.today() + 90),
  'AC1: the first publication sets published_at and closes_on (start in 30 days, so 90 days after publication)');
select is(
  (select metadata ->> 'close_reason' from audit.log l join t_ac1 t on l.entity_id = t.req::text
   where t.who = 'admin' and t.change = 'open>closed' and l.action = 'requirement.status_changed'),
  'cancelled', 'the audit row of a close names its reason');

-- AC1 and AC4: the end date of decision 3.5 and its paused round trip
select is(private.requirement_closes_on('2027-01-10', '2027-03-01'), '2027-04-10'::date,
  'AC4: published 10 January 2027, start 1 March 2027: closes on 10 April 2027');
select is(private.requirement_closes_on('2027-01-10', '2027-06-01'), '2027-06-01'::date,
  'AC4: published 10 January 2027, start 1 June 2027: closes on 1 June 2027');
select is(private.requirement_closes_on('2027-01-10', '2027-04-10'), '2027-04-10'::date,
  'AC4: published 10 January 2027, start 10 April 2027: closes on 10 April 2027');
update private.settings set value = '120' where key = 'requirement_open_days';
select is(private.requirement_closes_on('2027-01-10', '2027-03-01'), '2027-05-10'::date,
  'NFR-O5: the period follows requirement_open_days, not a constant');
update private.settings set value = '90' where key = 'requirement_open_days';
select pg_temp.seed_req(current_setting('t.a')::uuid, 'draft', jsonb_build_object('start', pg_temp.today() + 200)) as r_late \gset
select is(pg_temp.pub(:'adm', :'r_late', 'job_order_marketplace', true), 'ok', 'a draft starting in 200 days is published on the marketplace');
select is(
  (select format('%s|%s|%s', closes_on, visibility, show_identity) from public.workforce_requirements where id = :'r_late'),
  format('%s|job_order_marketplace|t', pg_temp.today() + 200),
  'AC1: it closes on its start date, the later one, and shows the company name as chosen (decision 3.2)');
update public.workforce_requirements
set published_at = now() - interval '30 days', closes_on = pg_temp.today() + 60 where id = :'r_late';
select is(pg_temp.st(:'adm', :'r_late', 'paused'), 'ok', 'AC1: open -> paused');
select is(pg_temp.st(:'adm', :'r_late', 'open'), 'ok', 'AC1: paused -> open');
select is(
  (select format('%s|%s', published_at = now() - interval '30 days', closes_on) from public.workforce_requirements where id = :'r_late'),
  format('t|%s', pg_temp.today() + 60), 'AC1: paused -> open keeps published_at and does not reset closes_on');
select pg_temp.seed_req(current_setting('t.a')::uuid, 'draft') as r_priv \gset
select is(pg_temp.pub(:'own1', :'r_priv', 'private', true), 'ok', 'a private publication');
select is((select show_identity from public.workforce_requirements where id = :'r_priv'), false,
  'a private requirement never shows the company name, whatever was asked');

-- Publishing refusals
select pg_temp.seed_req(current_setting('t.a')::uuid, 'draft', jsonb_build_object('start', pg_temp.today() - 1)) as r_past \gset
select is(pg_temp.pub(:'own1', :'r_past'), 'P0001|CHARA_INVALID_INPUT|start_date',
  'a draft whose start date has passed is edited before it is published');
select is(pg_temp.pub(:'own1', :'r_priv'), 'P0001|CHARA_INVALID_TRANSITION|open to open', 'an open requirement is not published again');
select is(pg_temp.call_as(:'own1', 'authenticated', format(
    'select public.publish_requirement(%L, %L, null, false, %L::timestamptz)', current_setting('t.a'), :'r_off', pg_temp.version(:'r_off'))),
  'P0001|CHARA_INVALID_INPUT|visibility', 'publishing needs a channel');
update public.requirement_occupations set quantity = 9 where requirement_id = :'r_off';
select is(pg_temp.pub(:'own1', :'r_off'), 'P0001|CHARA_INVALID_INPUT|occupation_quantities',
  'the quantities are checked again at publish');
update public.requirement_occupations set quantity = 10 where requirement_id = :'r_off';
select is(pg_temp.st(:'own1', :'r_off', 'open'), 'P0001|CHARA_INVALID_INPUT|publish_required',
  'a draft opens through publish_requirement only');
select is(pg_temp.state(:'r_off') || '|' || pg_temp.audits(:'r_off'), 'draft|0', 'and the refusals changed nothing');

-- AC2: the fourteen refused changes ------------------------------------------------------------------------------------

create temp table t_ac2 (change text, req uuid, result text);
insert into t_ac2 (change, req)
select c, pg_temp.seed_req(current_setting('t.a')::uuid, split_part(c, '>', 1))
from unnest(array['draft>paused', 'draft>closed', 'draft>filled', 'open>draft', 'paused>draft', 'paused>filled',
                  'closed>draft', 'closed>open', 'closed>paused', 'closed>filled', 'filled>draft', 'filled>open',
                  'filled>paused', 'filled>closed']) c;
update t_ac2 set result = pg_temp.st(:'own1', req, split_part(change, '>', 2), case when change like '%>closed' then 'cancelled' end);
select is(result, 'P0001|CHARA_INVALID_TRANSITION|' || replace(change, '>', ' to '), format('AC2: %s is refused', change))
from t_ac2 order by change;
select is(
  (select count(*)::integer from t_ac2 t join public.workforce_requirements r on r.id = t.req
   where r.status::text = split_part(t.change, '>', 1)),
  14, 'AC2: every row keeps its status');
select is((select count(*)::integer from t_ac2 t join audit.log l on l.entity_id = t.req::text), 0, 'AC2: and no audit row is written');
select pg_temp.seed_req(current_setting('t.a')::uuid, 'filled') as r_fill_null \gset
select pg_temp.seed_req(current_setting('t.a')::uuid, 'draft') as r_draft_null \gset
select is(pg_temp.st(:'own1', :'r_fill_null', 'closed') || ',' || pg_temp.st(:'own1', :'r_draft_null', 'closed'),
  'P0001|CHARA_INVALID_TRANSITION|filled to closed,P0001|CHARA_INVALID_TRANSITION|draft to closed',
  'AC2: a refused move without a reason is refused as a transition, not for its reason');
select pg_temp.seed_req(current_setting('t.a')::uuid, 'open') as r_same \gset
select pg_temp.seed_req(current_setting('t.a')::uuid, 'filled') as r_fill \gset
select is(pg_temp.st(:'own1', :'r_same', 'open') || '|' || pg_temp.st(:'own1', :'r_fill', 'filled'), 'ok|ok',
  'AC2: setting the status a requirement already has succeeds');
select is(pg_temp.audits(:'r_same') + pg_temp.audits(:'r_fill'), 0, 'AC2: as a no-op without an audit row');
select is(pg_temp.version(:'r_same'), now() - interval '1 day', 'and without a new version');

-- AC3: who may change the status --------------------------------------------------------------------------------------

select pg_temp.seed_req(current_setting('t.a')::uuid, 'open') as r_who \gset
select is(pg_temp.st(:'adm', :'r_who', 'paused', null, 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'AC3: an admin at aal1 is refused (aal2_required)');
select is(pg_temp.st(:'mem', :'r_who', 'paused'), 'P0001|CHARA_FORBIDDEN|', 'AC3: a member is refused');
select is(pg_temp.st(:'adm2', :'r_who', 'paused'), 'P0001|CHARA_FORBIDDEN|', 'AC3: an admin of Beta is refused for Acme');
select is(pg_temp.st(:'adm2', :'r_who', 'paused', null, 'aal2', current_setting('t.b')::uuid), 'P0002|CHARA_NOT_FOUND|',
  'AC3: and finds no requirement of Acme through Beta');
select is(pg_temp.st(:'dadm', :'r_who', 'paused'), 'P0001|CHARA_FORBIDDEN|', 'AC3: the owner of a recruitment company is refused');
select is(pg_temp.st(:'wa', :'r_who', 'paused'), 'P0001|CHARA_FORBIDDEN|', 'AC3: a candidate is refused');
select alike(pg_temp.st(null, :'r_who', 'paused'), '42501|%', 'AC3: an anonymous caller has no execute grant (42501)');
select alike(pg_temp.call_as(:'adm', 'authenticated', format(
    $$update public.workforce_requirements set status = 'paused' where id = %L$$, :'r_who')), '42501|%',
  'AC3: a direct update is refused (42501)');
select is(pg_temp.ext(:'mem', :'r_who'), 'P0001|CHARA_FORBIDDEN|', 'AC7: a member cannot extend');
select is(pg_temp.pub(:'mem', :'r_off'), 'P0001|CHARA_FORBIDDEN|', 'a member cannot publish');
select is(pg_temp.state(:'r_who') || '|' || pg_temp.audits(:'r_who'), 'open|0', 'AC3: the requirement stays open without an audit row');
select pg_temp.seed_req(:'zeta', 'open') as r_zeta \gset
select is(pg_temp.st(:'zown', :'r_zeta', 'paused', null, 'aal2', :'zeta'), 'P0001|CHARA_FORBIDDEN|organization_suspended',
  'the owner of a suspended employer is refused');

-- AC10: the reasons of a close ----------------------------------------------------------------------------------------

select is(pg_temp.st(:'own1', :'r_who', 'closed'), 'P0001|CHARA_INVALID_INPUT|close_reason', 'AC10: closing needs a reason');
select is(pg_temp.st(:'own1', :'r_who', 'closed', 'expired'), 'P0001|CHARA_INVALID_INPUT|close_reason',
  'expired is the reason of the daily job only');
select is(pg_temp.st(:'own1', :'r_who', 'closed', 'filled'), 'P0001|CHARA_INVALID_INPUT|close_reason',
  'filled is the status filled, not a reason of a close');
select is(pg_temp.st(:'own1', :'r_who', 'paused', 'cancelled'), 'P0001|CHARA_INVALID_INPUT|close_reason',
  'a pause takes no reason');
select is(pg_temp.st(:'own1', :'r_who', 'filled', 'filled'), 'ok', 'a fill may name the reason filled');
select is(pg_temp.read_as(:'mem', format('select status || '':'' || close_reason from public.workforce_requirements where id = %L', :'r_who')),
  'filled:filled', 'AC10: the filled requirement stays readable for the employer');
select throws_ok(
  format($$update public.workforce_requirements set close_reason = null where id = %L$$, :'r_who'), '23514', null,
  'a filled requirement always has the reason filled');
select throws_ok(
  format($$update public.workforce_requirements set close_reason = null where id = %L$$,
    (select req from t_ac1 where who = 'owner' and change = 'open>closed')), '23514', null,
  'a closed requirement always has a reason');

-- AC12 (database part): a change made from a page that is out of date ----------------------------------------------------

select pg_temp.seed_req(current_setting('t.a')::uuid, 'open') as r_stale \gset
select pg_temp.version(:'r_stale') as v_stale \gset
select is(pg_temp.st(:'adm', :'r_stale', 'filled', null, 'aal2', null, :'v_stale'), 'ok', 'AC12: admin A marks the requirement filled');
select is(pg_temp.st(:'own1', :'r_stale', 'paused', null, 'aal2', null, :'v_stale'), 'P0001|CHARA_CONFLICT|stale',
  'AC12: admin B, whose page shows the version before, is refused as stale');
select is(pg_temp.state(:'r_stale'), 'filled:filled', 'AC12: and it stays filled');
select is(pg_temp.call_as(:'own1', 'authenticated', format(
    'select public.set_requirement_status(%L, %L, %L, null)', current_setting('t.a'), :'r_who', 'paused')),
  'P0001|CHARA_CONFLICT|stale', 'a change that names no version is refused as stale');
select pg_temp.seed_req(current_setting('t.a')::uuid, 'open') as r_chain \gset
select is(
  pg_temp.call_as(:'own1', 'authenticated', format(
    $$select set_config('t.state', public.set_requirement_status(%L, %L, 'paused', %L::timestamptz)::text, true)$$,
    current_setting('t.a'), :'r_chain', pg_temp.version(:'r_chain'))),
  'ok', 'a pause answers the new state');
select is(
  (current_setting('t.state')::jsonb - 'updated_at')
    || jsonb_build_object('fresh', (current_setting('t.state')::jsonb ->> 'updated_at')::timestamptz = pg_temp.version(:'r_chain')),
  jsonb_build_object('status', 'paused', 'closes_on', pg_temp.today() + 80, 'close_reason', null, 'fresh', true),
  'with the status, the closing date and the version the next change names');

-- AC7: extending ------------------------------------------------------------------------------------------------------

select pg_temp.seed_req(current_setting('t.a')::uuid, 'open', jsonb_build_object('closes_on', pg_temp.today() + 5)) as r_ext \gset
select pg_temp.seed_req(current_setting('t.a')::uuid, 'paused') as r_extp \gset
select pg_temp.seed_req(current_setting('t.a')::uuid, 'closed') as r_extc \gset
select is(pg_temp.ext(:'adm', :'r_ext') || '|' || pg_temp.ext(:'adm', :'r_ext'), 'ok|ok', 'AC7: the admin extends the open requirement twice');
select is((select closes_on from public.workforce_requirements where id = :'r_ext'), pg_temp.today() + 65,
  'AC7: each call moves closes_on by 30 days (60 in total)');
select is(
  (select string_agg((metadata ->> 'from') || '>' || (metadata ->> 'to') || ' ' || (actor_id = :'adm'), ',' order by (metadata ->> 'to'))
   from audit.log where action = 'requirement.extended' and entity_id = :'r_ext'),
  format('%s>%s true,%s>%s true', pg_temp.today() + 5, pg_temp.today() + 35, pg_temp.today() + 35, pg_temp.today() + 65),
  'AC7: one audit row requirement.extended per call with the old and the new date');
select is(pg_temp.audits(:'r_ext'), 0, 'an extension is no change of status');
select is(pg_temp.ext(:'own1', :'r_extp'), 'ok', 'AC7: the owner extends the paused requirement');
select is((select closes_on from public.workforce_requirements where id = :'r_extp'), pg_temp.today() + 110, 'AC7: by 30 days too');
select is(pg_temp.ext(:'adm', :'r_extc'), 'P0001|CHARA_INVALID_STATE|closed', 'AC7: a closed requirement is not extended');
select is(pg_temp.ext(:'adm', :'r_fill'), 'P0001|CHARA_INVALID_STATE|filled', 'a filled requirement is not extended');
select is(pg_temp.ext(:'adm', :'r_off'), 'P0001|CHARA_INVALID_STATE|draft', 'a draft has no closing date to extend');
update private.settings set value = '14' where key = 'requirement_extension_days';
select is(pg_temp.ext(:'adm', :'r_ext'), 'ok', 'NFR-O5: an extension with requirement_extension_days 14');
select is((select closes_on from public.workforce_requirements where id = :'r_ext'), pg_temp.today() + 79, 'adds 14 days');
update private.settings set value = '30' where key = 'requirement_extension_days';
update public.workforce_requirements set closes_on = pg_temp.today() + 380 where id = :'r_ext';
select is(pg_temp.ext(:'adm', :'r_ext'), 'P0001|CHARA_INVALID_STATE|extension_limit',
  'an extension past requirement_extension_horizon_days (365) after the start or today is refused');
select is((select closes_on from public.workforce_requirements where id = :'r_ext'), pg_temp.today() + 380, 'and moves nothing');
select pg_temp.seed_req(current_setting('t.a')::uuid, 'paused', jsonb_build_object('closes_on', pg_temp.today() - 1)) as r_lapsed \gset
select is(pg_temp.st(:'own1', :'r_lapsed', 'open'), 'P0001|CHARA_INVALID_STATE|closes_on_passed',
  'a paused requirement whose closing date has passed does not reopen');
select is(pg_temp.ext(:'own1', :'r_lapsed'), 'ok', 'it is extended first');
select is((select closes_on from public.workforce_requirements where id = :'r_lapsed'), pg_temp.today() + 30,
  'AC7: counted from today, so never earlier than today after an extension');
select is(pg_temp.st(:'own1', :'r_lapsed', 'open'), 'ok', 'and then reopens');

-- AC8 (V33 part): the edit rules --------------------------------------------------------------------------------------

create function pg_temp.edit(p_user uuid, p_req uuid, p_start date, p_version timestamptz default null) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select public.save_requirement(
      p_org => %L, p_requirement => %L, p_workers_needed => 10, p_country_code => 'DE', p_city_region => 'Hamburg',
      p_industry_code => 'C', p_occupations => '[{"occupation_id": "7212", "quantity": 10}]'::jsonb, p_start_date => %L::date,
      p_employment_type => 'full_time', p_recruitment_preference => 'international', p_partner_need => 'both',
      p_accommodation => false, p_work_permit_support => false, p_visa_support => false, p_title => 'Welders edited',
      p_expected_updated_at => %L::timestamptz)$f$,
    current_setting('t.a'), p_req, p_start, coalesce(p_version, pg_temp.version(p_req))))
$$;

select pg_temp.seed_req(current_setting('t.a')::uuid, 'open') as r_edit \gset
select is(pg_temp.edit(:'adm', :'r_edit', pg_temp.today() + 30), 'ok', 'AC8: the admin edits an open requirement');
select is(
  (select metadata from audit.log where action = 'requirement.updated' and entity_id = :'r_edit'),
  jsonb_build_object('organization_id', current_setting('t.a'), 'changed_fields', '["title"]'::jsonb, 'status', 'open'),
  'AC8: requirement.updated names the changed fields and the status it was edited in (versions and notices V43)');
select is(pg_temp.state(:'r_edit') || '|' || pg_temp.audits(:'r_edit'), 'open|0', 'the edit keeps the status');
select is(pg_temp.edit(:'adm', :'r_edit', pg_temp.today() + 150), 'ok', 'AC8: the start date moves past the closing date');
select is((select closes_on from public.workforce_requirements where id = :'r_edit'), pg_temp.today() + 150,
  'the closing date moves with it (the later of the start date and 90 days after publication)');
select is(pg_temp.edit(:'adm', :'r_edit', pg_temp.today() + 40), 'ok', 'the start date moves back');
select is((select closes_on from public.workforce_requirements where id = :'r_edit'), pg_temp.today() + 150,
  'the closing date is never brought forward by an edit');
select pg_temp.version(:'r_edit') as v_edit \gset
select is(pg_temp.st(:'own1', :'r_edit', 'paused'), 'ok', 'the owner pauses it');
select is(pg_temp.edit(:'adm', :'r_edit', pg_temp.today() + 40, :'v_edit'), 'P0001|CHARA_CONFLICT|stale',
  'AC12: an edit loaded before a status change is refused as stale (the change is a new version)');
select is(pg_temp.edit(:'adm', :'r_edit', pg_temp.today() + 41), 'ok', 'a paused requirement is edited');
select is(pg_temp.edit(:'adm', :'r_off', pg_temp.today() + 41), 'ok', 'a draft is edited');
select is((select closes_on from public.workforce_requirements where id = :'r_off'), null::date, 'a draft gets no closing date from an edit');
select is(pg_temp.edit(:'adm', :'r_fill', pg_temp.today() + 41), 'P0001|CHARA_INVALID_STATE|filled',
  'AC8: editing a filled requirement fails with CHARA_INVALID_STATE');
select is(pg_temp.edit(:'adm', :'r_extc', pg_temp.today() + 41), 'P0001|CHARA_INVALID_STATE|closed',
  'AC8: editing a closed requirement fails with CHARA_INVALID_STATE');

-- AC5: the daily close --------------------------------------------------------------------------------------------------

select pg_temp.seed_req(current_setting('t.b')::uuid, 'open', jsonb_build_object('closes_on', pg_temp.today() - 1)) as r_y \gset
select pg_temp.seed_req(current_setting('t.b')::uuid, 'open', jsonb_build_object('closes_on', pg_temp.today())) as r_t \gset
select pg_temp.seed_req(current_setting('t.b')::uuid, 'open', jsonb_build_object('closes_on', pg_temp.today() + 1)) as r_tm \gset
select pg_temp.seed_req(current_setting('t.b')::uuid, 'paused', jsonb_build_object('closes_on', pg_temp.today() - 1)) as r_py \gset
select is(private.close_expired_requirements(), 2, 'AC5 (V43): the daily job closes two requirements');
select is(
  pg_temp.state(:'r_y') || ',' || pg_temp.state(:'r_t') || ',' || pg_temp.state(:'r_tm') || ',' || pg_temp.state(:'r_py'),
  'closed:expired,open,open,closed:expired',
  'AC5 (V43): the open and the paused requirement whose closing date was yesterday close with the reason expired');
select is(
  (select format('%s|%s|%s|%s', count(*), bool_and(actor_id is null), min(metadata ->> 'from'), min(metadata ->> 'actor_fn'))
   from audit.log where action = 'requirement.status_changed' and entity_id = :'r_py'),
  '1|t|paused|close_expired_requirements', 'AC5 (V43): the paused one gets one audit row from paused, made by the job');
select is(
  (select format('%s|%s|%s|%s', count(*), bool_and(actor_id is null), min(metadata ->> 'actor_fn'), min(metadata ->> 'close_reason'))
   from audit.log where action = 'requirement.status_changed' and entity_id = :'r_y'),
  '1|t|close_expired_requirements|expired', 'AC5: one audit row without an actor, made by close_expired_requirements');
select is(private.close_expired_requirements(), 0, 'AC5: a second run the same day changes nothing');
select pg_temp.seed_req(current_setting('t.b')::uuid, 'paused', jsonb_build_object('closes_on', pg_temp.today() - 1)) as r_pinv \gset
insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source, status, viewed_at)
values (:'r_pinv', :'delta', current_setting('t.b')::uuid, 'profile', 'viewed', now());
select is(private.close_expired_requirements(), 1, 'V43 carry-over: a paused requirement past its date with an invitation is closed');
select is(
  (select format('%s|%s', i.status, i.expired_at is not null) from public.requirement_invitations i where i.requirement_id = :'r_pinv'),
  'expired|t', 'V43 carry-over: and its pending invitation expires with it (the V41 trigger)');
select is(pg_temp.audits(:'r_y'), 1, 'AC5: and writes no audit row');
select is((select current_setting('chara.actor_fn', true)), '', 'the job clears chara.actor_fn behind it');
select set_config('chara.actor_fn', 'close_expired_requirements', true) as actor \gset
select pg_temp.seed_req(current_setting('t.b')::uuid, 'paused') as r_p2 \gset
select lives_ok(format($$update public.workforce_requirements set status = 'closed' where id = %L$$, :'r_p2'),
  'AC5 (V43): with chara.actor_fn close_expired_requirements paused -> closed is accepted');
select is(pg_temp.state(:'r_p2'), 'closed:expired', 'with the reason expired');
select throws_ok(format($$update public.workforce_requirements set status = 'paused' where id = %L$$, :'r_t'),
  'P0001', 'CHARA_INVALID_TRANSITION', 'AC5: and so is open -> paused');
select lives_ok(format($$update public.workforce_requirements set status = 'closed' where id = %L$$, :'r_t'),
  'AC5: open -> closed is accepted');
select is(pg_temp.state(:'r_t'), 'closed:expired', 'with the reason expired');
select set_config('chara.actor_fn', 'something_else', true) as actor \gset
select throws_ok(format($$update public.workforce_requirements set status = 'closed', close_reason = 'cancelled' where id = %L$$, :'r_tm'),
  'P0001', 'CHARA_INVALID_TRANSITION', 'a function the guard does not know changes nothing');
select set_config('chara.actor_fn', '', true) as actor \gset
update public.workforce_requirements set closes_on = pg_temp.today() + 20 where id = :'r_tm';

-- AC6 and FR-T1 AC6 (employer part): the closing reminder -------------------------------------------------------------

select pg_temp.seed_req(current_setting('t.a')::uuid, 'open', jsonb_build_object('closes_on', pg_temp.today() + 7, 'title', 'Closing soon')) as r_rem \gset
select pg_temp.seed_req(current_setting('t.a')::uuid, 'open', jsonb_build_object('closes_on', pg_temp.today() + 8)) as r_rem8 \gset
select pg_temp.seed_req(current_setting('t.a')::uuid, 'paused', jsonb_build_object('closes_on', pg_temp.today() + 3)) as r_remp \gset
select pg_temp.seed_req(:'zeta', 'open', jsonb_build_object('closes_on', pg_temp.today() + 2)) as r_remz \gset
delete from public.notifications where kind = 'requirement_closing_soon';
update private.settings set value = 'false' where key = 'release_job_orders';
select is(private.remind_closing_requirements(), 0, 'release 2b off: the reminder job queues nothing');
update private.settings set value = 'true' where key = 'release_job_orders';
select is(private.remind_closing_requirements(), 2, 'AC6: the reminder job finds the requirements closing in 7 and (paused, V43) 3 days');
select is(pg_temp.reminders(array[:'own1', :'adm', :'mem']::uuid[]), '1:queued,1:queued,2:queued,2:queued',
  'AC6: requirement_closing_soon is queued for the owner and the admin of Acme, not the member');
select is((select count(*)::integer from pgmq.q_notifications where message ->> 'kind' = 'requirement_closing_soon'
             and message ->> 'requirement_id' = :'r_rem'), 2,
  'NFR-A3: one message each in the notifications queue, in the transaction of the job');
select is(
  (select payload from public.notifications where kind = 'requirement_closing_soon' and user_id = :'own1' and payload ->> 'requirement_id' = :'r_rem'),
  jsonb_build_object('requirement_id', :'r_rem', 'title', 'Closing soon', 'closes_on', pg_temp.today() + 7,
    'org_slug', (select slug from public.organizations where id = current_setting('t.a')::uuid)),
  'AC6: the payload holds the requirement id, its title, the closing date and the slug of the link to Extend');
select is((select count(*)::integer from public.notifications where kind = 'requirement_closing_soon'
             and payload ->> 'requirement_id' = :'r_remp'), 2,
  'V43: the paused requirement, which now closes at its date too, is reminded to the owner and the admin');
select is((select count(*)::integer from public.notifications where kind = 'requirement_closing_soon'), 4,
  'the requirement closing in 8 days and the one of a suspended employer get nothing');
select is(private.remind_closing_requirements(), 0, 'AC6: a second run the same day queues nothing');
select is((select count(*)::integer from public.notifications where kind = 'requirement_closing_soon'), 4, 'AC6: no new row');
select is(pg_temp.ext(:'adm', :'r_rem'), 'ok', 'the admin extends after the reminder');
update public.workforce_requirements set closes_on = pg_temp.today() + 6 where id = :'r_rem';
select is(private.remind_closing_requirements(), 1, 'a new closing date is reminded again');
select is((select count(*)::integer from public.notifications where kind = 'requirement_closing_soon' and user_id = :'own1'), 3,
  'once more for each recipient');
update private.settings set value = '8' where key = 'requirement_closing_reminder_days';
select is(private.remind_closing_requirements(), 1, 'NFR-O5: requirement_closing_reminder_days 8 reaches the requirement closing in 8 days');
update private.settings set value = '7' where key = 'requirement_closing_reminder_days';

-- AC11: the pause on a lapse ------------------------------------------------------------------------------------------

select pg_temp.new_org(:'own1') as o11 \gset
select pg_temp.deliver('act_o11', 'subscription.activated', pg_temp.sub_event(:'o11', 'employer_starter', 'active', 'sub_o11'),
  '2026-11-01T00:00:00Z') as ignored \gset
select pg_temp.seed_req(:'o11', 'open', '{"title": "L open 1"}') as l_o1 \gset
select pg_temp.seed_req(:'o11', 'open', '{"title": "L open 2"}') as l_o2 \gset
select pg_temp.seed_req(:'o11', 'draft', '{"title": "L draft"}') as l_d \gset
select pg_temp.seed_req(:'o11', 'paused', '{"title": "L paused"}') as l_p \gset
select pg_temp.seed_req(:'o11', 'closed', '{"title": "L closed"}') as l_c \gset
select pg_temp.open_job('L vacancy', :'o11') as l_job \gset
create function pg_temp.lapse_states(p_org uuid) returns text
language sql as $$
  select string_agg(title || ':' || status, ',' order by title) from public.workforce_requirements where organization_id = p_org
$$;
select is(
  pg_temp.deliver('del_o11', 'subscription.canceled', pg_temp.sub_event(:'o11', 'employer_starter', 'canceled', 'sub_o11'),
    '2026-11-05T00:00:00Z'),
  'applied', 'AC11: billing_apply_event applies the lapse');
select is(pg_temp.lapse_states(:'o11'), 'L closed:closed,L draft:draft,L open 1:paused,L open 2:paused,L paused:paused',
  'AC11: the two open requirements are paused; draft, paused and closed are untouched');
select is((select status::text from public.jobs where id = :'l_job'), 'paused', 'the vacancies are still paused as before (FR-C2)');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.status_changed'
     and entity_id in (:'l_o1', :'l_o2') and actor_id is null and metadata ->> 'actor_fn' = 'pause_requirements_on_lapse'
     and metadata ->> 'from' = 'open' and metadata ->> 'to' = 'paused'),
  2, 'AC11: one audit row each, without an actor, made by pause_requirements_on_lapse');
select lives_ok(format('select private.pause_requirements_on_lapse(%L)', :'o11'), 'AC11: a second run');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.status_changed' and entity_id in (:'l_o1', :'l_o2', :'l_d', :'l_p', :'l_c')),
  2, 'AC11: changes nothing');
select is((select count(*)::integer from public.workforce_requirements where organization_id = :'o11'), 5, 'AC11: nothing is deleted');
select pg_temp.seed_req(:'o11', 'open', '{"title": "L open 3"}') as l_o3 \gset
select throws_ok(format($$update public.workforce_requirements set status = 'paused' where id = %L$$, :'l_o3'),
  '42501', 'CHARA_FORBIDDEN', 'AC11: open -> paused with no user and no chara.actor_fn is refused');
select set_config('chara.actor_fn', 'pause_requirements_on_lapse', true) as actor \gset
select throws_ok(format($$update public.workforce_requirements set status = 'open', visibility = 'private' where id = %L$$, :'l_d'),
  'P0001', 'CHARA_INVALID_TRANSITION', 'AC11: the setting does not allow draft -> open');
select set_config('chara.actor_fn', '', true) as actor \gset
select is(private.limit_usage(:'o11', 'active_requirements'), 1, 'only the requirement opened after the lapse counts as open');

-- NFR-S8: who reads the lifecycle columns -------------------------------------------------------------------------------

select is(pg_temp.read_as(:'mem', format(
    'select format(''%%s|%%s|%%s'', closes_on is not null, published_at is not null, status_changed_at is not null) from public.workforce_requirements where id = %L',
    :'r_late')), 't|t|t', 'a member of Acme reads the closing date, the publication and the last status change');
select is(pg_temp.read_as(:'own2', format('select count(*) from public.workforce_requirements where id = %L', :'r_late')), '0',
  'NFR-S8: the owner of Beta reads no requirement of Acme');
select is(pg_temp.read_as(:'dadm', 'select count(*) from public.workforce_requirements'), '0',
  'NFR-S8: a recruitment company reads no requirement (job orders V39)');
select is(pg_temp.read_as(:'wa', 'select count(*) from public.workforce_requirements'), '0', 'NFR-S8: a candidate reads none');
select alike(pg_temp.call_as(null, 'anon', 'select count(*) from public.workforce_requirements'), '42501|%',
  'NFR-S8: anonymous callers are refused');

-- Quota ---------------------------------------------------------------------------------------------------------------

select pg_temp.seed_req(current_setting('t.a')::uuid, 'open') as r_quota \gset
update private.settings set value = '0' where key = 'rate_limit_org_audited_write_max';
select is(pg_temp.st(:'own1', :'r_quota', 'paused'), 'P0001|CHARA_RATE_LIMITED|', 'a status change counts against the daily quota');
select is(pg_temp.ext(:'own1', :'r_quota'), 'P0001|CHARA_RATE_LIMITED|', 'so does an extension');
select is(pg_temp.pub(:'own1', :'r_off'), 'P0001|CHARA_RATE_LIMITED|', 'and a publication');
update private.settings set value = '2000' where key = 'rate_limit_org_audited_write_max';

select * from finish();
rollback;
