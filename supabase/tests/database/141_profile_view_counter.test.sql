begin;
select plan(95);

\ir organizations_fixture.inc

-- Profile view counter (V20, FR-R6 AC1 to AC7 and AC11, SOP P2-40 steps Count, Aggregate and Suppress; FR-K4 AC8;
-- NFR-S8, NFR-O5; DATA_MODEL.md sections 2, 6 and 10): private.profile_view_events, record_profile_view and its call
-- from get_partner_profile, private.aggregate_org_analytics and its schedule, private.org_analytics_daily,
-- get_org_analytics, public.v_org_analytics, and the retention of events and counts.

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_slug text, p_country text default 'PH')
returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), p_country);
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.add_member(p_org uuid, p_user uuid, p_role public.member_role default 'member') returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

create function pg_temp.list(p_org uuid) returns void
language sql as $$
  update public.organizations set review_status = 'listed', listed_at = now() - interval '3 days', submitted_at = now() - interval '4 days'
  where id = p_org
$$;

create function pg_temp.run(p_user uuid, p_sql text) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    'aal1')
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

create function pg_temp.view_as(p_user uuid, p_slug text) returns text
language sql as $$
  select pg_temp.run(p_user, format('select slug from public.get_partner_profile(%L, %L)', p_slug, repeat('b', 64)))
$$;

create function pg_temp.events(p_org uuid) returns text
language sql as $$
  select coalesce(string_agg(o.slug || '@' || (current_date - e.viewed_on), ',' order by e.viewed_on, o.slug), '')
  from private.profile_view_events e join public.organizations o on o.id = e.viewer_organization_id
  where e.viewed_organization_id = p_org
$$;

-- Figures as 'metric:country:occupation=value' (value 'x' when suppressed), in the order returned.
create function pg_temp.figures(p_user uuid, p_org uuid, p_period text, p_dimension text) returns text
language plpgsql as $$
declare
  v_state text := pg_temp.run(p_user, format('select * from public.get_org_analytics(%L, %L, %L)', p_org, p_period, p_dimension));
begin
  if v_state <> 'ok' then
    return v_state;
  end if;
  return coalesce((select string_agg(format('%s:%s:%s=%s', r ->> 'metric', coalesce(r ->> 'country_code', ''),
      coalesce(r ->> 'occupation_id', ''), case when (r ->> 'suppressed')::boolean then 'x' else r ->> 'value' end), ',')
    from jsonb_array_elements(pg_temp.result()) r), '');
end;
$$;

create function pg_temp.daily(p_org uuid, p_days_ago integer, p_country text, p_value integer) returns void
language sql as $$
  insert into private.org_analytics_daily (organization_id, day, metric, country_code, value)
  values (p_org, (now() at time zone 'utc')::date - p_days_ago, 'profile_views', p_country, p_value)
$$;

\set pow '00000000-0000-0000-0000-000000141001'
\set padm '00000000-0000-0000-0000-000000141002'
\set pmem '00000000-0000-0000-0000-000000141003'
\set a1 '00000000-0000-0000-0000-000000141004'
\set a2 '00000000-0000-0000-0000-000000141005'
\set b1 '00000000-0000-0000-0000-000000141006'
\set sadm '00000000-0000-0000-0000-000000141007'
\set cand1 '00000000-0000-0000-0000-000000141008'
\set cand2 '00000000-0000-0000-0000-000000141009'
\set two '00000000-0000-0000-0000-000000141010'
\set susp '00000000-0000-0000-0000-000000141011'
\set staff '00000000-0000-0000-0000-000000141012'
\set dusr '00000000-0000-0000-0000-000000141013'
\set xusr '00000000-0000-0000-0000-000000141014'

select pg_temp.new_user(u) from unnest(array[:'pow', :'padm', :'pmem', :'a1', :'a2', :'b1', :'sadm', :'two', :'susp',
  :'staff', :'dusr', :'xusr']::uuid[]) u;
select pg_temp.new_user(:'cand1', 'worker');
select pg_temp.new_user(:'cand2', 'worker');
update public.profiles set account_kind = intended_account_kind
where id in (:'pow', :'padm', :'pmem', :'a1', :'a2', :'b1', :'sadm', :'cand1', :'cand2', :'two', :'susp', :'staff', :'dusr', :'xusr');
insert into public.platform_staff (user_id, role) values (:'staff', 'admin');

select pg_temp.new_org(:'pow', 'recruitment_company', 'viewed-recruiter') as r \gset
select pg_temp.new_org(:'sadm', 'staffing_company', 'viewed-staffing', 'NP') as s \gset
select pg_temp.new_org(:'a1', 'employer', 'acme-viewer', 'DE') as a \gset
select pg_temp.new_org(:'b1', 'employer', 'berlin-viewer', 'DE') as b \gset
select pg_temp.new_org(:'two', 'employer', 'polish-viewer', 'PL') as c \gset
select pg_temp.new_org(:'dusr', 'employer', 'dutch-viewer', 'NL') as d \gset
select pg_temp.new_org(:'xusr', 'employer', 'closed-viewer', 'AT') as x \gset
select pg_temp.add_member(:'r', :'padm', 'admin');
select pg_temp.add_member(:'r', :'pmem');
select pg_temp.add_member(:'a', :'a2');
select pg_temp.add_member(:'b', :'two');
select pg_temp.add_member(:'a', :'susp');
update public.profiles set status = 'suspended' where id = :'susp';
select pg_temp.list(:'r');
select pg_temp.list(:'s');
update public.organizations set status = 'suspended' where id = :'x';

-- Grants and shape ------------------------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.record_profile_view(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.record_profile_view(uuid)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=""'] and prorettype = 'void'::regtype
       from pg_proc where oid = 'public.record_profile_view(uuid)'::regprocedure),
  'record_profile_view: signed-in callers only, security definer, empty search_path, returns nothing'
);
select ok(
  not has_function_privilege('anon', 'public.get_org_analytics(uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_org_analytics(uuid, text, text)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.get_org_analytics(uuid, text, text)'::regprocedure),
  'get_org_analytics: signed-in callers only, security definer, empty search_path'
);
select is(
  (select string_agg(f, ',' order by f) from unnest(array['private.aggregate_org_analytics(date)', 'private.org_analytics_figures(uuid,text,text)',
     'private.analytics_level(uuid)', 'private.aggregate_recent_org_analytics()']) f
   where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
      or has_function_privilege('service_role', f, 'execute')),
  null, 'the job, the inner figures and the level are not executable by any API role'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.profile_view_events'::regclass)
  and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.org_analytics_daily'::regclass),
  'NFR-S8: both tables have RLS enabled and forced'
);
select is(
  (select string_agg(t || ':' || r, ',' order by t, r)
   from unnest(array['private.profile_view_events', 'private.org_analytics_daily']) t
   cross join unnest(array['anon', 'authenticated', 'service_role']) r
   where has_table_privilege(r, t, 'select, insert, update, delete, truncate, references, trigger')),
  null, 'AC2: no API role has any privilege on the events or the daily counts'
);
select ok(
  (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.v_org_analytics'::regclass)
  and has_table_privilege('authenticated', 'public.v_org_analytics', 'select')
  and not has_table_privilege('anon', 'public.v_org_analytics', 'select'),
  'v_org_analytics is security_invoker and readable by signed-in callers only'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'v_org_analytics'),
  array['organization_id', 'period_start', 'period_end', 'metric', 'country_code', 'occupation_id', 'value', 'suppressed'],
  'AC2: the view has exactly the aggregate columns and none naming a viewing organisation or user'
);
select is(
  (select array_agg(p.parameter_name::text order by p.ordinal_position) from information_schema.parameters p
   join information_schema.routines r on r.specific_name = p.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'get_org_analytics' and p.parameter_mode = 'OUT'),
  array['organization_id', 'period_start', 'period_end', 'metric', 'country_code', 'occupation_id', 'value', 'suppressed'],
  'AC2: get_org_analytics returns the same columns'
);

-- Release off ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.view_as(:'a1', 'viewed-recruiter'), 'P0002|CHARA_NOT_FOUND|', 'release off: the profile is not found');
select is(pg_temp.run(:'a1', format('select public.record_profile_view(%L)', :'r')), 'ok', 'release off: a direct call does not fail');
select is(pg_temp.events(:'r'), '', 'release off: nothing is recorded');
select is(pg_temp.figures(:'pow', :'r', '30d', 'total'), '42501|CHARA_FORBIDDEN|release_off', 'release off: analytics are refused');

update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC1, FR-K4 AC8: once per viewing organisation per day ---------------------------------------------------------------------
select is(pg_temp.view_as(:'a1', 'viewed-recruiter'), 'ok', 'a member of employer A reads the profile');
select is(pg_temp.view_as(:'a1', 'viewed-recruiter'), 'ok', 'a second time');
select is(pg_temp.view_as(:'a1', 'viewed-recruiter'), 'ok', 'a third time');
select is(pg_temp.view_as(:'a2', 'viewed-recruiter'), 'ok', 'the second member of A reads it once');
select is(pg_temp.events(:'r'), 'acme-viewer@0', 'AC1: one event for A today, whoever of its members read and how often');
select is(pg_temp.view_as(:'pmem', 'viewed-recruiter'), 'ok', 'a member of R reads its own profile');
select is(pg_temp.view_as(:'pow', 'viewed-recruiter'), 'ok', 'the owner of R reads its own profile');
select is(pg_temp.run(:'pow', format('select slug from public.preview_partner_profile(%L)', :'r')), 'ok', 'the owner previews it');
select is(pg_temp.view_as(:'cand1', 'viewed-recruiter'), 'ok', 'a candidate reads it');
select is(pg_temp.view_as(null, 'viewed-recruiter'), 'ok', 'an anonymous visitor reads it');
select is(pg_temp.view_as(:'susp', 'viewed-recruiter'), 'ok', 'a suspended member of A reads it');
select is(pg_temp.events(:'r'), 'acme-viewer@0',
  'AC1: the own organisation, the preview, the candidate, the visitor and the suspended user store nothing');
select is(pg_temp.result(), '[{"slug": "viewed-recruiter"}]'::jsonb, 'the profile answer carries nothing about the count');

update private.profile_view_events set viewed_on = viewed_on - 1 where viewed_organization_id = :'r';
select is(pg_temp.view_as(:'a1', 'viewed-recruiter'), 'ok', 'the next day the member of A reads it again');
select is(pg_temp.events(:'r'), 'acme-viewer@1,acme-viewer@0', 'AC1: exactly 2 events for R: A on day 1 and A on day 2');

select is(pg_temp.view_as(:'two', 'viewed-recruiter'), 'ok', 'a user who belongs to B and C reads it');
select is(pg_temp.events(:'r'), 'acme-viewer@1,acme-viewer@0,berlin-viewer@0,polish-viewer@0',
  'each organisation of that user viewed the profile once');
select is(pg_temp.view_as(:'sadm', 'viewed-recruiter'), 'ok', 'an admin of competing partner S reads it');
select is(pg_temp.events(:'r'), 'acme-viewer@1,acme-viewer@0,berlin-viewer@0,polish-viewer@0,viewed-staffing@0',
  'another partner organisation is a viewer like an employer');
select is(pg_temp.view_as(:'xusr', 'viewed-recruiter'), 'ok', 'the owner of a suspended employer reads it');
select is(pg_temp.events(:'r'), 'acme-viewer@1,acme-viewer@0,berlin-viewer@0,polish-viewer@0,viewed-staffing@0',
  'a suspended organisation is not counted');

select is(pg_temp.view_as(:'dusr', 'no-such-partner'), 'P0002|CHARA_NOT_FOUND|', 'an unknown slug is not found');
select is(pg_temp.run(:'dusr', format('select public.record_profile_view(%L)', :'a')), 'ok', 'a direct call for an employer does not fail');
update public.organizations set moderation_state = 'hidden' where id = :'s';
select is(pg_temp.run(:'dusr', format('select public.record_profile_view(%L)', :'s')), 'ok', 'nor one for a hidden partner');
update public.organizations set moderation_state = 'visible' where id = :'s';
select is((select count(*)::integer from private.profile_view_events where viewer_organization_id = :'d'), 0,
  'not found, an employer and a hidden partner count nothing');

update private.settings set value = '0' where key = 'rate_limit_partner_profile_max';
select is(pg_temp.view_as(:'dusr', 'viewed-recruiter'), 'P0001|CHARA_RATE_LIMITED|', 'over the read limit the profile is refused');
update private.settings set value = '120' where key = 'rate_limit_partner_profile_max';
select is((select count(*)::integer from private.profile_view_events where viewer_organization_id = :'d'), 0,
  'and the refused read is not counted');

select is(pg_temp.run(:'dusr', format('select public.record_profile_view(%L)', :'r')), 'ok', 'a direct call for a public profile');
select is(pg_temp.result(), '[{"record_profile_view": ""}]'::jsonb, 'AC1: returns nothing to the caller');
select is(pg_temp.run(:'dusr', format('select public.record_profile_view(%L)', :'r')), 'ok', 'and a repeated direct call');
select is((select count(*)::integer from private.profile_view_events where viewer_organization_id = :'d'), 1,
  'the direct call counts the organisation once a day too, so calling it cannot raise the count');

-- AC2: no path from analytics to a viewer -----------------------------------------------------------------------------------
select is(
  (select string_agg(coalesce(x.r, '?'), ',')
   from (values (null::uuid, 'anon'), (:'a1'::uuid, 'authenticated'), (:'pow'::uuid, 'authenticated'), (:'staff'::uuid, 'authenticated'),
                (null::uuid, 'service_role')) v (uid, db_role)
   cross join lateral (select split_part(pg_temp.call_as(v.uid, v.db_role, 'select * from private.profile_view_events'), '|', 1) as r) x),
  '42501,42501,42501,42501,42501',
  'AC2: anon, an employer, the viewed partner, a Platform Administrator and service_role are refused the events'
);

-- AC3: daily aggregation -----------------------------------------------------------------------------------------------------
delete from private.profile_view_events where viewed_organization_id = :'r';
insert into private.profile_view_events (viewed_organization_id, viewer_organization_id, viewed_on)
select :'r', o, (now() at time zone 'utc')::date - 1
from unnest(array[:'a', :'b', :'c', :'d', :'s', :'x']::uuid[]) o;
insert into private.profile_view_events (viewed_organization_id, viewer_organization_id, viewed_on)
values (:'s', :'a', (now() at time zone 'utc')::date - 1), (:'r', :'a', (now() at time zone 'utc')::date);

select is(private.aggregate_org_analytics(), 6, 'AC3: the job for the previous UTC day writes one row per organisation and country');
create temp table first_run as select organization_id, day, metric, country_code, occupation_id, value from private.org_analytics_daily;
select is(private.aggregate_org_analytics(), 6, 'a second run writes the same number of rows');
select is(
  (select string_agg(format('%s:%s=%s', o.slug, d.country_code, d.value), ',' order by o.slug, d.country_code)
   from private.org_analytics_daily d join public.organizations o on o.id = d.organization_id
   where d.day = (now() at time zone 'utc')::date - 1 and d.metric = 'profile_views' and d.occupation_id is null),
  'viewed-recruiter:AT=1,viewed-recruiter:DE=2,viewed-recruiter:NL=1,viewed-recruiter:NP=1,viewed-recruiter:PL=1,viewed-staffing:DE=1',
  'AC3: R has 6 views by the country of the viewer (counted from the events, today''s view not yet), S has 1'
);
select is(
  (select count(*)::integer from (
     select organization_id, day, metric, country_code, occupation_id, value from private.org_analytics_daily
     except select * from first_run) d),
  0, 'AC3: the second run leaves the same rows (no doubling)'
);
select throws_ok($$select private.aggregate_org_analytics((now() at time zone 'utc')::date)$$, 'CHARA_INVALID_INPUT',
  'today is not aggregated before it ends');
select throws_ok($$select private.aggregate_org_analytics((now() at time zone 'utc')::date - 36)$$, 'CHARA_INVALID_INPUT',
  'a day whose events are past the retention period is refused, so its counts are not wiped');
select pg_temp.daily(:'r', 3, 'DE', 7);
select throws_ok($$select private.aggregate_org_analytics((now() at time zone 'utc')::date - 3)$$, 'CHARA_INVALID_INPUT',
  'a day that has counts but no events (the period was raised after its events were removed) is refused');
select is((select value from private.org_analytics_daily where organization_id = :'r' and day = (now() at time zone 'utc')::date - 3),
  7, 'and its counts are kept');
delete from private.org_analytics_daily where day = (now() at time zone 'utc')::date - 3;

-- The scheduled run counts yesterday and again the day before.
insert into private.profile_view_events (viewed_organization_id, viewer_organization_id, viewed_on)
values (:'r', :'b', (now() at time zone 'utc')::date - 2), (:'r', :'c', (now() at time zone 'utc')::date - 2);
select is(private.aggregate_recent_org_analytics(), 8, 'the scheduled run writes the 6 rows of yesterday and the 2 of the day before');
insert into private.profile_view_events (viewed_organization_id, viewer_organization_id, viewed_on)
values (:'r', :'d', (now() at time zone 'utc')::date - 2);
select is(private.aggregate_recent_org_analytics(), 9, 'run again after a late view, it rebuilds both days');
select is(
  (select string_agg(format('%s:%s=%s', current_date - d.day, d.country_code, d.value), ',' order by d.day desc, d.country_code)
   from private.org_analytics_daily d where d.organization_id = :'r'),
  '1:AT=1,1:DE=2,1:NL=1,1:NP=1,1:PL=1,2:DE=1,2:NL=1,2:PL=1',
  'both days hold their counts once, the late view included'
);
select is(
  (select schedule || ' ' || command from cron.job where jobname = 'aggregate-org-analytics'),
  '5 0 * * * select private.aggregate_recent_org_analytics()',
  'AC3: a pg_cron job runs the aggregation daily for the previous UTC day (and the day before it), before apply-retention'
);
select ok(
  (select schedule from cron.job where jobname = 'apply-retention') = '17 3 * * *',
  'the retention job runs later in the day'
);

-- AC4: small counts are suppressed in the database ----------------------------------------------------------------------------
delete from private.org_analytics_daily;
select pg_temp.daily(:'r', 1, 'DE', 1);
select pg_temp.daily(:'s', 1, 'DE', 4);
select pg_temp.daily(:'a', 1, 'DE', 5);
select pg_temp.daily(:'b', 1, 'DE', 3), pg_temp.daily(:'b', 2, 'PL', 3);
select is(
  pg_temp.figures(:'dusr', :'d', '30d', 'total') || ' ' || pg_temp.figures(:'pow', :'r', '30d', 'total') || ' '
    || pg_temp.figures(:'sadm', :'s', '30d', 'total') || ' ' || pg_temp.figures(:'a1', :'a', '30d', 'total') || ' '
    || pg_temp.figures(:'b1', :'b', '30d', 'total'),
  'profile_views::=x profile_views::=x profile_views::=x profile_views::=5 profile_views::=6',
  'AC4: 0, 1 and 4 views are suppressed (value null), 5 and 6 are shown'
);
select is(
  (select jsonb_agg(jsonb_build_object('v', r -> 'value', 's', r -> 'suppressed'))
   from (select pg_temp.run(:'pow', format('select * from public.get_org_analytics(%L)', :'r'))) t, jsonb_array_elements(pg_temp.result()) r),
  '[{"s": true, "v": null}]'::jsonb, 'a suppressed value is null with suppressed true, for the default period of 30 days'
);
update private.settings set value = '3' where key = 'stats_min_count';
select is(
  pg_temp.figures(:'pow', :'r', '30d', 'total') || ' ' || pg_temp.figures(:'sadm', :'s', '30d', 'total') || ' '
    || pg_temp.figures(:'a1', :'a', '30d', 'total'),
  'profile_views::=x profile_views::=x profile_views::=5',
  'AC4: with stats_min_count 3 the result is the same: the threshold is never below 5'
);
update private.settings set value = '8' where key = 'stats_min_count';
select is(pg_temp.figures(:'b1', :'b', '30d', 'total'), 'profile_views::=x', 'a threshold above 5 is applied (6 is now suppressed)');
update private.settings set value = '5' where key = 'stats_min_count';

-- Periods end with the previous UTC day.
select is(
  pg_temp.figures(:'b1', :'b', '7d', 'total') || ' ' || (pg_temp.result() -> 0 ->> 'period_start') || ' ' || (pg_temp.result() -> 0 ->> 'period_end'),
  'profile_views::=6 ' || ((now() at time zone 'utc')::date - 7)::text || ' ' || ((now() at time zone 'utc')::date - 1)::text,
  'the 7-day period runs from 7 days ago to yesterday'
);
select pg_temp.daily(:'b', 8, 'PL', 10), pg_temp.daily(:'b', 0, 'PL', 50), pg_temp.daily(:'b', 91, 'PL', 100),
  pg_temp.daily(:'b', 300, 'PL', 1000);
select is(
  pg_temp.figures(:'b1', :'b', '7d', 'total') || ' ' || pg_temp.figures(:'b1', :'b', '30d', 'total') || ' '
    || pg_temp.figures(:'b1', :'b', '90d', 'total') || ' ' || pg_temp.figures(:'b1', :'b', '12m', 'total'),
  'profile_views::=6 profile_views::=16 profile_views::=16 profile_views::=1116',
  'the periods 7, 30 and 90 days and 12 months add the days inside them; today is never counted'
);
select is(
  (pg_temp.result() -> 0 ->> 'period_start'),
  (((now() at time zone 'utc')::date - 1 - interval '12 months')::date + 1)::text,
  'the 12-month period starts the day after the same date a year before yesterday'
);
select is(pg_temp.figures(:'b1', :'b', '1y', 'total'), 'P0001|CHARA_INVALID_INPUT|p_period', 'an unknown period is refused');
select is(pg_temp.figures(:'b1', :'b', '30d', 'viewer'), 'P0001|CHARA_INVALID_INPUT|p_dimension', 'an unknown dimension is refused');

-- AC5: complementary suppression in breakdowns ---------------------------------------------------------------------------------
delete from private.org_analytics_daily;
select pg_temp.daily(:'r', 1, 'DE', 10), pg_temp.daily(:'r', 2, 'DE', 8), pg_temp.daily(:'r', 3, 'PL', 8), pg_temp.daily(:'r', 4, 'AT', 4);
select is(pg_temp.figures(:'pow', :'r', '30d', 'country'), 'profile_views:AT:=x,profile_views:DE:=18,profile_views:PL:=x',
  'AC5: AT (4) is suppressed and PL (8), the smallest other cell, too; DE shows 18');
select is(pg_temp.figures(:'pow', :'r', '30d', 'total'), 'profile_views::=30', 'AC5: the total shows 30');
delete from private.org_analytics_daily where country_code = 'AT';
select is(pg_temp.figures(:'pow', :'r', '30d', 'country'), 'profile_views:DE:=18,profile_views:PL:=8',
  'AC5: a breakdown where no cell is below 5 suppresses nothing');
select pg_temp.daily(:'r', 5, 'AT', 2), pg_temp.daily(:'r', 5, 'NL', 1);
select is(pg_temp.figures(:'pow', :'r', '30d', 'country'), 'profile_views:AT:=x,profile_views:DE:=18,profile_views:NL:=x,profile_views:PL:=x',
  'AC5: two suppressed cells adding up to less than 5 also hide the smallest shown cell (PL)');
select is(pg_temp.figures(:'pow', :'r', '30d', 'occupation'), '', 'profile views have no occupation, so that breakdown is empty');

select pg_temp.daily(:'c', 1, 'DE', 18), pg_temp.daily(:'c', 1, 'AT', 1), pg_temp.daily(:'c', 1, 'NL', 1);
select is(pg_temp.figures(:'two', :'c', '30d', 'country') || ' ' || pg_temp.figures(:'two', :'c', '30d', 'total'),
  'profile_views:AT:=x,profile_views:DE:=x,profile_views:NL:=x profile_views::=20',
  'AC5: DE 18, AT 1, NL 1: the total 20 minus DE would give AT and NL, so DE is hidden too');
delete from private.org_analytics_daily where organization_id = :'c';

-- A cell hidden in a shorter period stays hidden in the longer ones, so comparing them reveals nothing.
select pg_temp.daily(:'c', 1, 'DE', 18), pg_temp.daily(:'c', 2, 'PL', 8), pg_temp.daily(:'c', 3, 'AT', 4), pg_temp.daily(:'c', 20, 'FR', 6);
select is(pg_temp.figures(:'two', :'c', '7d', 'country'), 'profile_views:AT:=x,profile_views:DE:=18,profile_views:PL:=x',
  '7 days: AT (4) and PL (8, complementary) are hidden');
select is(pg_temp.figures(:'two', :'c', '30d', 'country'), 'profile_views:AT:=x,profile_views:DE:=18,profile_views:FR:=6,profile_views:PL:=x',
  '30 days: PL stays hidden, else 30-day PL with the 7-day total would give AT');
select is(pg_temp.figures(:'two', :'c', '12m', 'country'), 'profile_views:AT:=x,profile_views:DE:=18,profile_views:FR:=6,profile_views:PL:=x',
  'the rule carries through 90 days to 12 months');
delete from private.org_analytics_daily where organization_id = :'c';

-- AC6: the plan sets the level --------------------------------------------------------------------------------------------------
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (:'r', 'recruitment_partner', 'active', 'null'), (:'s', 'staffing_professional', 'active', 'null'),
       (:'a', 'employer_enterprise', 'active', 'null'), (:'d', 'free_staffing_company', 'active', 'null');
update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.daily(:'s', 1, 'DE', 9), pg_temp.daily(:'a', 1, 'PL', 9);
select is(
  pg_temp.figures(:'pow', :'r', '30d', 'total') || ' | ' || pg_temp.figures(:'pow', :'r', '30d', 'country'),
  'profile_views::=29 | P0001|CHARA_FEATURE_NOT_IN_PLAN|analytics_advanced',
  'AC6: Partner (analytics_basic) gets totals and is refused breakdowns with analytics_advanced'
);
select is(
  pg_temp.figures(:'sadm', :'s', '30d', 'total') || ' | ' || pg_temp.figures(:'sadm', :'s', '30d', 'country'),
  'profile_views::=9 | profile_views:DE:=9',
  'AC6: Professional gets totals and breakdowns'
);
select is(
  pg_temp.figures(:'a1', :'a', '30d', 'total') || ' | ' || pg_temp.figures(:'a1', :'a', '30d', 'country'),
  'profile_views::=9 | profile_views:PL:=9',
  'AC6: employer Enterprise (analytics_advanced) gets totals and breakdowns'
);
select is(
  pg_temp.figures(:'dusr', :'d', '30d', 'total') || ' | ' || pg_temp.figures(:'dusr', :'d', '30d', 'country'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|analytics_basic | P0001|CHARA_FEATURE_NOT_IN_PLAN|analytics_basic',
  'AC6: the free plan is refused everything'
);
select is(
  (select string_agg(distinct case when v.country_code is null then 'total' else 'country' end, ',')
   from (select pg_temp.run(:'pow', 'select * from public.v_org_analytics')) t,
        jsonb_to_recordset(pg_temp.result()) as v (organization_id uuid, country_code text)),
  'total', 'the view gives the Partner plan totals only'
);
select is(
  (select string_agg(distinct (v.period_end - v.period_start + 1)::text || ':' || case when v.country_code is null then 'total' else 'country' end, ','
     order by (v.period_end - v.period_start + 1)::text || ':' || case when v.country_code is null then 'total' else 'country' end)
   from (select pg_temp.run(:'sadm', 'select * from public.v_org_analytics')) t,
        jsonb_to_recordset(pg_temp.result()) as v (organization_id uuid, period_start date, period_end date, country_code text)),
  '30:country,30:total,365:country,365:total,7:country,7:total,90:country,90:total',
  'the view gives Professional totals and breakdowns for the four periods'
);
select is(
  (select count(*)::integer from (select pg_temp.run(:'dusr', 'select * from public.v_org_analytics')) t, jsonb_array_elements(pg_temp.result())),
  0, 'the view gives the free plan nothing'
);
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- AC7, NFR-S8: only members read an organisation's analytics ----------------------------------------------------------------------
select is(
  pg_temp.figures(:'pow', :'r', '30d', 'total') || ' ' || pg_temp.figures(:'padm', :'r', '30d', 'total') || ' '
    || pg_temp.figures(:'pmem', :'r', '30d', 'total'),
  'profile_views::=29 profile_views::=29 profile_views::=29', 'AC7: the owner, the admin and the member of R read its figures'
);
select is(
  (select string_agg(x, ',') from unnest(array[
     pg_temp.figures(:'sadm', :'r', '30d', 'total'), pg_temp.figures(:'a1', :'r', '30d', 'total'), pg_temp.figures(:'b1', :'r', '30d', 'total'),
     pg_temp.figures(:'staff', :'r', '30d', 'total'), pg_temp.figures(:'cand1', :'r', '30d', 'total'),
     pg_temp.figures(:'cand2', :'r', '30d', 'total'), pg_temp.figures(:'susp', :'a', '30d', 'total')]) x),
  '42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|',
  'AC7: the competing partner, two employers, a Platform Administrator, two candidates and a suspended member are refused'
);
select matches(pg_temp.figures(null, :'r', '30d', 'total'), '^42501\|permission denied', 'AC7: the anonymous caller has no grant');
select matches(pg_temp.run(null, 'select * from public.v_org_analytics'), '^42501\|permission denied', 'nor on the view');
select is(
  (select string_agg(distinct v.organization_id::text, ',')
   from (select pg_temp.run(:'pmem', 'select * from public.v_org_analytics')) t, jsonb_to_recordset(pg_temp.result()) as v (organization_id uuid)),
  :'r', 'NFR-S8: a member of R reads the rows of R only'
);
select is(
  (select string_agg(distinct v.organization_id::text, ',')
   from (select pg_temp.run(:'sadm', 'select * from public.v_org_analytics')) t, jsonb_to_recordset(pg_temp.result()) as v (organization_id uuid)),
  :'s', 'NFR-S8: the admin of S reads the rows of S only'
);
select is(
  (select string_agg(coalesce(v.organization_id::text, '-'), ',')
   from unnest(array[:'staff', :'cand1', :'cand2']::uuid[]) u
   cross join lateral (select pg_temp.run(u, 'select * from public.v_org_analytics')) t
   left join lateral jsonb_to_recordset(pg_temp.result()) as v (organization_id uuid) on true),
  '-,-,-', 'AC7: the view returns nothing to a Platform Administrator and to candidates'
);
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(
  (select count(*)::integer from (select pg_temp.run(:'pow', 'select * from public.v_org_analytics')) t, jsonb_array_elements(pg_temp.result())),
  0, 'release off: the view is empty'
);
update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC11, FR-S3: retention of events and counts ------------------------------------------------------------------------------------
select is(
  (select string_agg(entity || ':' || days || ':' || editable, ',' order by entity) from private.retention_policies
   where entity in ('profile_view_events', 'org_analytics')),
  'org_analytics:730:true,profile_view_events:35:true',
  'AC11: raw events 35 days and daily counts 730 days, both editable in the retention editor'
);
delete from private.profile_view_events;
delete from private.org_analytics_daily;
insert into private.profile_view_events (viewed_organization_id, viewer_organization_id, viewed_on)
values (:'r', :'a', (now() at time zone 'utc')::date - 34), (:'r', :'b', (now() at time zone 'utc')::date - 35),
       (:'r', :'c', (now() at time zone 'utc')::date - 36);
select pg_temp.daily(:'r', 729, 'DE', 1), pg_temp.daily(:'r', 730, 'PL', 1), pg_temp.daily(:'r', 731, 'AT', 1);
select private.apply_retention();
select is(pg_temp.events(:'r'), 'berlin-viewer@35,acme-viewer@34', 'AC11: the 36-day-old event is deleted, the 34- and 35-day-old kept');
select is(
  (select string_agg(country_code, ',' order by day) from private.org_analytics_daily where organization_id = :'r'),
  'PL,DE', 'AC11: the count older than 730 days is deleted, the others kept'
);
select is(
  (select string_agg(m.entity_id, ',' order by m.entity_id) from audit.log m
   where m.action = 'retention.run' and m.entity_id in ('profile_view_events', 'org_analytics')),
  'org_analytics,profile_view_events', 'each rule writes its retention run audit row'
);
update private.retention_policies set days = 30 where entity = 'profile_view_events';
select private.apply_retention();
select is(pg_temp.events(:'r'), '', 'a shorter period set in the editor applies at the next run');

select * from finish();
rollback;
