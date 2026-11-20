begin;
select plan(46);

\ir organizations_fixture.inc

-- Network analytics (V60, FR-R6 AC3 for the job order metrics, AC4 to AC10 and AC12, SOP P2-40 steps Aggregate, Suppress
-- and Show; NFR-S8 with two employers, three partners, two candidates and anonymous; DATA_MODEL.md sections 7 and 10):
-- the job order metrics of private.org_analytics_daily and private.aggregate_org_activity, the release of each metric in
-- private.org_analytics_figures, public.get_org_analytics_access and public.export_org_analytics. Recruitment company R
-- (Partner plan), staffing company S (Professional, Nepal) and recruitment company T (Enterprise) receive the
-- invitations of employers A (Germany) and B (Poland); F is a staffing company on the free plan.

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_slug text, p_country text default 'PH')
returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), p_country);
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  if p_type <> 'employer' then
    update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
      submitted_at = now() - interval '31 days'
    where id = v_id;
  end if;
  return v_id;
end;
$$;

create function pg_temp.add_member(p_org uuid, p_user uuid, p_role public.member_role default 'member') returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

-- An open requirement of p_org for the occupations p_occupations.
create function pg_temp.req(p_org uuid, p_title text, p_occupations text[]) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on
  ) values (
    v_id, p_org, p_title, 10 * cardinality(p_occupations), 'DE', 'Hamburg', 'C', date '2027-06-01', 'full_time', 'both', 'both',
    'open', 'job_order_marketplace', true, now() - interval '20 days', date '2027-07-01'
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) select v_id, o, 10 from unnest(p_occupations) o;
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

create function pg_temp.utc(p_days_ago integer) returns timestamptz
language sql as $$ select ((now() at time zone 'utc')::date - p_days_ago)::timestamp at time zone 'utc' + interval '10 hours' $$;

create function pg_temp.invite(p_req uuid, p_partner uuid, p_days_ago integer) returns void
language sql as $$
  insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source, invited_at)
  select p_req, p_partner, r.organization_id, 'directory', pg_temp.utc(p_days_ago)
  from public.workforce_requirements r where r.id = p_req
$$;

create function pg_temp.respond(p_req uuid, p_partner uuid, p_status text, p_days_ago integer) returns uuid
language sql as $$
  insert into public.partner_responses (requirement_id, organization_id, employer_organization_id, status, capacity,
    available_from, experience_note, fee_model, decided_at, created_at)
  select p_req, p_partner, r.organization_id, p_status::public.response_status, 10, date '2027-05-01',
    'Twelve years of placing certified welders in Germany.', 'on_request',
    case when p_status in ('shortlisted', 'selected', 'declined') then pg_temp.utc(p_days_ago) end, pg_temp.utc(p_days_ago)
  from public.workforce_requirements r where r.id = p_req
  returning id
$$;

-- A candidate request of p_partner sent p_sent days ago; approved p_approved days ago and hired p_hired days ago when given.
create function pg_temp.submission(p_req uuid, p_partner uuid, p_sent integer, p_approved integer, p_hired integer) returns void
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.candidate_submissions (id, requirement_id, organization_id, employer_organization_id, invited_email,
    worker_user_id, status, decided_at, worker_approved_at, passport_share_id, profile_snapshot, created_at)
  select v_id, p_req, p_partner, r.organization_id, v_id || '@seed.test',
    case when p_approved is not null then gen_random_uuid() end,
    case when p_hired is not null then 'hired' when p_approved is not null then 'submitted' else 'awaiting_candidate' end::public.submission_status,
    pg_temp.utc(p_approved), pg_temp.utc(p_approved), case when p_approved is not null then gen_random_uuid() end,
    case when p_approved is not null then '{}'::jsonb end, pg_temp.utc(p_sent)
  from public.workforce_requirements r where r.id = p_req;
  if p_hired is not null then
    insert into public.submission_events (submission_id, from_status, to_status, created_at)
    values (v_id, 'offer', 'hired', pg_temp.utc(p_hired));
  end if;
end;
$$;

-- The counts of one day of p_org as 'metric:country:occupation=value', sorted.
create function pg_temp.day_rows(p_org uuid, p_days_ago integer) returns text
language sql as $$
  select coalesce(string_agg(format('%s:%s:%s=%s', d.metric, coalesce(d.country_code, ''), coalesce(d.occupation_id, ''), d.value), ','
    order by d.metric, d.country_code nulls last, d.occupation_id nulls last), '')
  from private.org_analytics_daily d
  where d.organization_id = p_org and d.day = (now() at time zone 'utc')::date - p_days_ago
$$;

create function pg_temp.put(p_org uuid, p_metric text, p_country text, p_occupation text, p_value integer, p_days_ago integer default 1)
returns void
language sql as $$
  insert into private.org_analytics_daily (organization_id, day, metric, country_code, occupation_id, value)
  values (p_org, (now() at time zone 'utc')::date - p_days_ago, p_metric::public.analytics_metric, p_country, p_occupation, p_value)
$$;

create function pg_temp.run(p_user uuid, p_sql text) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    'aal1')
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

-- The rows of the last call as 'metric:country:occupation=value' (x when suppressed), in the order returned.
create function pg_temp.shown() returns text
language sql as $$
  select coalesce(string_agg(format('%s:%s:%s=%s', r ->> 'metric', coalesce(r ->> 'country_code', ''),
      coalesce(r ->> 'occupation_id', ''), case when (r ->> 'suppressed')::boolean then 'x' else r ->> 'value' end), ','), '')
  from jsonb_array_elements(pg_temp.result()) r
$$;

create function pg_temp.figures(p_user uuid, p_org uuid, p_period text, p_dimension text) returns text
language plpgsql as $$
declare
  v_state text := pg_temp.run(p_user, format('select * from public.get_org_analytics(%L, %L, %L)', p_org, p_period, p_dimension));
begin
  return case when v_state = 'ok' then pg_temp.shown() else v_state end;
end;
$$;

create function pg_temp.access(p_user uuid, p_org uuid) returns text
language plpgsql as $$
declare
  v_state text := pg_temp.run(p_user, format('select * from public.get_org_analytics_access(%L)', p_org));
begin
  return case when v_state = 'ok'
    then (select format('%s|%s|%s', r ->> 'analytics_level', r ->> 'has_figures', r ->> 'fewer_than') from jsonb_array_elements(pg_temp.result()) r)
    else v_state end;
end;
$$;

create function pg_temp.export(p_user uuid, p_org uuid, p_period text default '90d') returns text
language sql as $$
  select pg_temp.run(p_user, format('select * from public.export_org_analytics(%L, %L)', p_org, p_period))
$$;

create function pg_temp.exports(p_org uuid) returns integer
language sql as $$
  select count(*)::integer from audit.log where action = 'analytics.exported' and entity_id = p_org::text
$$;

\set rown '00000000-0000-0000-0000-000000188001'
\set radm '00000000-0000-0000-0000-000000188002'
\set rmem '00000000-0000-0000-0000-000000188003'
\set sadm '00000000-0000-0000-0000-000000188004'
\set town '00000000-0000-0000-0000-000000188005'
\set tmem '00000000-0000-0000-0000-000000188006'
\set aown '00000000-0000-0000-0000-000000188007'
\set bown '00000000-0000-0000-0000-000000188008'
\set fown '00000000-0000-0000-0000-000000188009'
\set staff '00000000-0000-0000-0000-000000188010'
\set cand1 '00000000-0000-0000-0000-000000188011'
\set cand2 '00000000-0000-0000-0000-000000188012'

select pg_temp.new_user(u) from unnest(array[:'rown', :'radm', :'rmem', :'sadm', :'town', :'tmem', :'aown', :'bown', :'fown', :'staff']::uuid[]) u;
select pg_temp.new_user(u, 'worker') from unnest(array[:'cand1', :'cand2']::uuid[]) u;
update public.profiles set account_kind = intended_account_kind
where id in (:'rown', :'radm', :'rmem', :'sadm', :'town', :'tmem', :'aown', :'bown', :'fown', :'staff', :'cand1', :'cand2');
insert into public.platform_staff (user_id, role) values (:'staff', 'admin');

select pg_temp.new_org(:'rown', 'recruitment_company', 'analytics-recruiter') as r \gset
select pg_temp.new_org(:'sadm', 'staffing_company', 'analytics-staffing', 'NP') as s \gset
select pg_temp.new_org(:'town', 'recruitment_company', 'analytics-enterprise') as t \gset
select pg_temp.new_org(:'aown', 'employer', 'analytics-employer-de', 'DE') as a \gset
select pg_temp.new_org(:'bown', 'employer', 'analytics-employer-pl', 'PL') as b \gset
select pg_temp.new_org(:'fown', 'staffing_company', 'analytics-free') as f \gset
select pg_temp.add_member(:'r', :'radm', 'admin');
select pg_temp.add_member(:'r', :'rmem');
select pg_temp.add_member(:'t', :'tmem');

delete from private.org_analytics_daily;

-- Shape and grants --------------------------------------------------------------------------------------------------------
select is(
  enum_range(null::public.analytics_metric)::text,
  '{profile_views,invitations,responses,selections,submissions,hires}',
  'the metrics of FR-R6 in release 2b: profile views and the five job order metrics (inquiries come with V76)'
);
select ok(
  (select bool_and(not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute')
     and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = f::regprocedure))
   from unnest(array['public.get_org_analytics_access(uuid)', 'public.export_org_analytics(uuid,text)']) f),
  'get_org_analytics_access and export_org_analytics: signed-in callers only, security definer, empty search_path'
);
select is(
  (select string_agg(f, ',' order by f) from unnest(array['private.aggregate_org_activity(date)',
     'private.analytics_metric_released(public.analytics_metric)']) f
   where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('service_role', f, 'execute')
      or has_function_privilege('anon', f, 'execute')),
  null, 'the aggregation and the release check have no API grant'
);
select is(
  (select string_agg(r.parameter_name, ',' order by r.ordinal_position)
   from information_schema.parameters r join information_schema.routines p on p.specific_name = r.specific_name
   where p.routine_schema = 'public' and p.routine_name = 'export_org_analytics' and r.parameter_mode = 'OUT'),
  'organization_id,period_start,period_end,metric,country_code,occupation_id,value,suppressed',
  'AC2, AC9: the export has the columns of the view and no column naming a viewer'
);

-- AC3: daily aggregation of the job order metrics ---------------------------------------------------------------------------
select pg_temp.req(:'a', 'Welders and plumbers', array['7212', '7126']) as q1 \gset
select pg_temp.req(:'b', 'Welders for Gdansk', array['7212']) as q2 \gset
select pg_temp.invite(:'q1', :'r', 1), pg_temp.invite(:'q1', :'s', 1), pg_temp.invite(:'q2', :'r', 1);
select pg_temp.invite(:'q1', :'t', 0), pg_temp.invite(:'q2', :'s', 3);
select pg_temp.respond(:'q1', :'r', 'selected', 1), pg_temp.respond(:'q1', :'s', 'submitted', 1),
  pg_temp.respond(:'q2', :'r', 'declined', 1), pg_temp.respond(:'q2', :'s', 'selected', 3);
select pg_temp.submission(:'q1', :'r', 1, null, null);
select pg_temp.submission(:'q1', :'r', 3, 1, 1);
select pg_temp.submission(:'q2', :'s', 3, 2, null);

select is(private.aggregate_org_activity(), 44, 'AC3: the job for the previous UTC day writes one row per organisation, metric and dimension value');
select is(
  pg_temp.day_rows(:'r', 1),
  'invitations:DE:=1,invitations:PL:=1,invitations::7126=1,invitations::7212=2,'
  || 'responses:DE:=1,responses:PL:=1,responses::7126=1,responses::7212=2,'
  || 'selections:DE:=1,selections::7126=1,selections::7212=1,'
  || 'submissions:DE:=1,submissions::7126=1,submissions::7212=1,'
  || 'hires:DE:=1,hires::7126=1,hires::7212=1',
  'AC3: the partner R counts by the employer''s country and by occupation: invitations received, responses sent, its selection, the request it sent yesterday and the hire'
);
select is(
  pg_temp.day_rows(:'a', 1),
  'invitations:NP:=1,invitations:PH:=1,invitations::7126=2,invitations::7212=2,'
  || 'responses:NP:=1,responses:PH:=1,responses::7126=2,responses::7212=2,'
  || 'selections:PH:=1,selections::7126=1,selections::7212=1,'
  || 'submissions:PH:=1,submissions::7126=1,submissions::7212=1,'
  || 'hires:PH:=1,hires::7126=1,hires::7212=1',
  'AC3: the employer A counts by the partner''s country: invitations sent, responses received, its selection, the submission approved yesterday (not the request awaiting the candidate) and the hire'
);
select is(pg_temp.day_rows(:'s', 1), 'invitations:DE:=1,invitations::7126=1,invitations::7212=1,responses:DE:=1,responses::7126=1,responses::7212=1',
  'S counts its invitation and response of yesterday only');
create temp table first_run as select organization_id, day, metric, country_code, occupation_id, value from private.org_analytics_daily;
select is(private.aggregate_org_activity(), 44, 'a second run writes the same number of rows');
select is(
  (select count(*)::integer from (
     select organization_id, day, metric, country_code, occupation_id, value from private.org_analytics_daily
     except select * from first_run) d),
  0, 'AC3: the second run leaves the same rows (no doubling)'
);
select pg_temp.put(:'r', 'profile_views', 'DE', null, 3);
select private.aggregate_org_activity();
select is(pg_temp.day_rows(:'r', 1) like 'profile_views:DE:=3,%', true, 'the job order run keeps the profile views of the day');
select throws_ok($$select private.aggregate_org_activity((now() at time zone 'utc')::date)$$, 'CHARA_INVALID_INPUT',
  'today is not aggregated before it ends');
select throws_ok($$select private.aggregate_org_activity((now() at time zone 'utc')::date - 367)$$, 'CHARA_INVALID_INPUT',
  'a day before the 12-month period is refused, so counts whose records retention may have removed are not wiped');
select is(private.aggregate_recent_org_analytics(), 46,
  'the scheduled run counts the job order metrics of yesterday (44 rows) and of the day before (2)');
select is(pg_temp.day_rows(:'s', 2), '', 'the day before: S sent its request three days ago, so it counts nothing');
select is(pg_temp.day_rows(:'b', 2), 'submissions:NP:=1,submissions::7212=1', 'the employer B counts the submission approved two days ago');

-- The release of each metric ------------------------------------------------------------------------------------------------
delete from private.org_analytics_daily;
select pg_temp.put(:'r', 'profile_views', 'DE', null, 9);
select pg_temp.put(:'r', 'invitations', 'DE', null, 6), pg_temp.put(:'r', 'invitations', null, '7212', 6),
  pg_temp.put(:'r', 'invitations', null, '7126', 6);
select pg_temp.put(:'r', 'hires', 'DE', null, 7), pg_temp.put(:'r', 'hires', null, '7212', 7);

update private.settings set value = 'false' where key in ('release_partner_directories', 'release_job_orders', 'release_candidate_submissions');
select is(pg_temp.access(:'rown', :'r'), '42501|CHARA_FORBIDDEN|release_off', 'release 2a off: the access is refused');
select is(pg_temp.export(:'town', :'t'), '42501|CHARA_FORBIDDEN|release_off', 'release 2a off: the export is refused');
update private.settings set value = 'true' where key = 'release_partner_directories';
select is(pg_temp.figures(:'rown', :'r', '7d', 'total'), 'profile_views::=9', 'release 2b off: profile views only');
select is(pg_temp.figures(:'rown', :'r', '7d', 'occupation'), '', 'release 2b off: no occupation cell either');
update private.settings set value = 'true' where key = 'release_job_orders';
select is(pg_temp.figures(:'rown', :'r', '7d', 'total'),
  'profile_views::=9,invitations::=6,responses::=x,selections::=x',
  'release 2b on: the job order metrics join, nothing as fewer than the threshold; a total adds up the country rows only (6, not 18)');
select is(pg_temp.figures(:'rown', :'r', '7d', 'occupation'), 'invitations::7126=6,invitations::7212=6',
  'a requirement for two occupations counts once in each');
update private.settings set value = 'true' where key = 'release_candidate_submissions';
select is(pg_temp.figures(:'rown', :'r', '7d', 'total'),
  'profile_views::=9,invitations::=6,responses::=x,selections::=x,submissions::=x,hires::=7',
  'with candidate submissions released, submissions and hires join');

-- AC5: complementary suppression applies to the job order metrics ----------------------------------------------------------
delete from private.org_analytics_daily;
select pg_temp.put(:'s', 'responses', 'DE', null, 10), pg_temp.put(:'s', 'responses', 'DE', null, 8, 2),
  pg_temp.put(:'s', 'responses', 'PL', null, 8, 3), pg_temp.put(:'s', 'responses', 'AT', null, 4, 4);
select is(pg_temp.figures(:'sadm', :'s', '30d', 'country'), 'responses:AT:=x,responses:DE:=18,responses:PL:=x',
  'AC5: AT (4) is hidden and PL (8), the smallest other cell, too; DE shows 18');
select is(pg_temp.figures(:'sadm', :'s', '30d', 'total') like '%responses::=30%', true, 'AC5: the total of responses shows 30');

-- AC6, AC8, AC12: the level of the plan and whether there are figures --------------------------------------------------------
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (:'r', 'recruitment_partner', 'active', 'null'), (:'s', 'staffing_professional', 'active', 'null'),
       (:'t', 'recruitment_enterprise', 'active', 'null'), (:'a', 'employer_enterprise', 'active', 'null'),
       (:'f', 'free_staffing_company', 'active', 'null');
update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.put(:'t', 'profile_views', 'DE', null, 12), pg_temp.put(:'t', 'invitations', 'DE', null, 5),
  pg_temp.put(:'t', 'invitations', null, '9329', 5), pg_temp.put(:'a', 'invitations', 'PH', null, 6);
select is(
  concat_ws(' ', pg_temp.access(:'rmem', :'r'), pg_temp.access(:'sadm', :'s'), pg_temp.access(:'tmem', :'t'),
    pg_temp.access(:'aown', :'a'), pg_temp.access(:'fown', :'f')),
  '1|false|5 2|true|5 3|true|5 2|true|5 0|false|5',
  'AC6, AC12: Partner 1 without figures yet, Professional 2, Enterprise 3, employer Enterprise 2 (analytics_advanced), free 0'
);
select pg_temp.put(:'f', 'profile_views', 'DE', null, 20);
select is(pg_temp.access(:'fown', :'f'), '0|false|5', 'the free plan learns nothing of its figures');
update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.access(:'aown', :'a'), '2|false|5', 'figures of a metric whose release is off do not count as figures');
update private.settings set value = 'true' where key = 'release_job_orders';
update private.settings set value = '8' where key = 'stats_min_count';
select is(pg_temp.access(:'tmem', :'t'), '3|true|8', 'the threshold above 5 is passed on, so the page says fewer than 8');
update private.settings set value = '3' where key = 'stats_min_count';
select is(pg_temp.access(:'tmem', :'t'), '3|true|5', 'and never below 5');
update private.settings set value = '5' where key = 'stats_min_count';

-- AC10: the export is audited and limited to Enterprise -----------------------------------------------------------------------
select is(pg_temp.export(:'town', :'t'), 'ok', 'AC10: the owner of the Enterprise partner exports');
select is(
  pg_temp.shown(),
  'profile_views::=12,invitations::=5,responses::=x,selections::=x,submissions::=x,hires::=x,'
  || 'profile_views:DE:=12,invitations:DE:=5,invitations::9329=5',
  'AC9: the totals, then the cells by country and by occupation, suppressed as on the page'
);
select is(pg_temp.export(:'tmem', :'t', '7d'), 'ok', 'AC10: a member of the Enterprise partner exports too');
select is(
  (select string_agg(format('%s|%s|%s|%s', l.actor_id, l.entity_type, l.entity_id, l.metadata), ',' order by l.id)
   from audit.log l where l.action = 'analytics.exported'),
  format('%s|organization|%s|{"period": "90d"},%s|organization|%s|{"period": "7d"}', :'town', :'t', :'tmem', :'t'),
  'AC10: one audit row per call with the actor, the organisation and the period, and no figure'
);
select is(
  concat_ws(' ', pg_temp.export(:'sadm', :'s'), pg_temp.export(:'rown', :'r'), pg_temp.export(:'aown', :'a'), pg_temp.export(:'fown', :'f')),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|analytics_enterprise P0001|CHARA_FEATURE_NOT_IN_PLAN|analytics_enterprise '
  || 'P0001|CHARA_FEATURE_NOT_IN_PLAN|analytics_enterprise P0001|CHARA_FEATURE_NOT_IN_PLAN|analytics_enterprise',
  'AC6, AC10: Professional, Partner, the employer plans (no analytics_enterprise) and the free plan are refused the export'
);
select is(pg_temp.exports(:'s') + pg_temp.exports(:'r') + pg_temp.exports(:'a') + pg_temp.exports(:'f'), 0,
  'AC10: a refused export writes no audit row');
select is(pg_temp.export(:'town', :'t', '1y'), 'P0001|CHARA_INVALID_INPUT|p_period', 'an unknown period is refused');
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- AC7, NFR-S8: only members ------------------------------------------------------------------------------------------------
select is(
  concat_ws(' ', pg_temp.access(:'rown', :'r'), pg_temp.access(:'radm', :'r'), pg_temp.access(:'rmem', :'r')),
  '3|false|5 3|false|5 3|false|5', 'AC7: the owner, the admin and the member of R read its access (limits not enforced)'
);
select is(
  (select string_agg(x, ',') from unnest(array[
     pg_temp.access(:'sadm', :'r'), pg_temp.access(:'town', :'r'), pg_temp.access(:'aown', :'r'), pg_temp.access(:'bown', :'r'),
     pg_temp.access(:'staff', :'r'), pg_temp.access(:'cand1', :'r'), pg_temp.access(:'cand2', :'r')]) x),
  '42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|',
  'AC7: two other partners, two employers, a Platform Administrator and two candidates are refused the access of R'
);
select is(
  (select string_agg(x, ',') from unnest(array[
     pg_temp.export(:'rown', :'t'), pg_temp.export(:'sadm', :'t'), pg_temp.export(:'aown', :'t'), pg_temp.export(:'bown', :'t'),
     pg_temp.export(:'staff', :'t'), pg_temp.export(:'cand1', :'t'), pg_temp.export(:'cand2', :'t')]) x),
  '42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|',
  'AC7, AC10: nobody outside T exports its analytics'
);
select is(pg_temp.exports(:'t'), 2, 'and the refusals wrote no audit row');
select matches(pg_temp.access(null, :'r'), '^42501\|permission denied', 'AC7: the anonymous caller has no grant on the access');
select matches(pg_temp.export(null, :'t'), '^42501\|permission denied', 'nor on the export');
select is(
  (select string_agg(distinct v.organization_id::text, ',')
   from (select pg_temp.run(:'aown', 'select * from public.v_org_analytics')) x, jsonb_to_recordset(pg_temp.result()) as v (organization_id uuid)),
  :'a', 'NFR-S8: the employer A reads its own job order figures in the view and nothing of the partners it invited'
);
select is(
  (select string_agg(distinct v.metric, ',' order by v.metric)
   from (select pg_temp.run(:'bown', 'select * from public.v_org_analytics')) x, jsonb_to_recordset(pg_temp.result()) as v (metric text)),
  'hires,invitations,profile_views,responses,selections,submissions', 'the employer B, with no figure, reads its zero totals only'
);
select is(
  (select count(*)::integer from (select pg_temp.run(:'bown', 'select * from public.v_org_analytics')) x,
     jsonb_to_recordset(pg_temp.result()) as v (value integer, suppressed boolean) where not v.suppressed),
  0, 'and every one of them is hidden as below the threshold'
);

select * from finish();
rollback;
