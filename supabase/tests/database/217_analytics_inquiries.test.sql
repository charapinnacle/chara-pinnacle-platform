begin;
select plan(28);

\ir organizations_fixture.inc

-- The inquiries of network analytics (V76, FR-R6 AC3, AC4, AC5, AC7, AC8 and AC10 for inquiries; SOP P2-40 steps Count,
-- Aggregate, Suppress and Show; NFR-S8 with two employers, two partners, two candidates, a Platform Administrator and
-- anonymous; DATA_MODEL.md sections 7 and 10): the metric inquiries of private.org_analytics_daily, counted by
-- private.aggregate_org_activity from the connections of kind inquiry for both organisations, released with
-- release_messaging. Recruitment company R (Philippines) and staffing company S (Nepal) receive the inquiries of
-- employers A (Germany) and B (Poland); recruitment company T (Enterprise) exports.

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_slug text, p_country text)
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

create function pg_temp.utc(p_days_ago integer) returns timestamptz
language sql as $$ select ((now() at time zone 'utc')::date - p_days_ago)::timestamp at time zone 'utc' + interval '10 hours' $$;

-- A connection of p_kind from p_from to p_to sent p_days_ago days ago, in a conversation of its own.
create function pg_temp.connect(p_from uuid, p_to uuid, p_days_ago integer, p_kind text default 'inquiry') returns void
language plpgsql as $$
declare
  v_conversation uuid;
begin
  insert into public.conversations (context_type, context_id, created_at, last_message_at)
  values ('inquiry', gen_random_uuid(), pg_temp.utc(p_days_ago), pg_temp.utc(p_days_ago))
  returning id into v_conversation;
  insert into public.connections (kind, from_organization_id, to_organization_id, conversation_id, created_at)
  values (p_kind::public.connection_kind, p_from, p_to, v_conversation, pg_temp.utc(p_days_ago));
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

-- The rows of the last call as 'metric:country:occupation=value' (x when suppressed), in the order returned.
create function pg_temp.shown() returns text
language sql as $$
  select coalesce(string_agg(format('%s:%s:%s=%s', r ->> 'metric', coalesce(r ->> 'country_code', ''),
      coalesce(r ->> 'occupation_id', ''), case when (r ->> 'suppressed')::boolean then 'x' else r ->> 'value' end), ','), '')
  from jsonb_array_elements(current_setting('t.result')::jsonb) r
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
    then (select format('%s|%s', r ->> 'analytics_level', r ->> 'has_figures') from jsonb_array_elements(current_setting('t.result')::jsonb) r)
    else v_state end;
end;
$$;

create function pg_temp.export(p_user uuid, p_org uuid) returns text
language plpgsql as $$
declare
  v_state text := pg_temp.run(p_user, format('select * from public.export_org_analytics(%L, %L)', p_org, '30d'));
begin
  return case when v_state = 'ok' then pg_temp.shown() else v_state end;
end;
$$;

-- The R rows of public.v_org_analytics that p_user reads.
create function pg_temp.view_rows(p_user uuid, p_org uuid) returns integer
language plpgsql as $$
declare
  v_state text := pg_temp.run(p_user, format('select * from public.v_org_analytics where organization_id = %L', p_org));
begin
  return case when v_state = 'ok' then jsonb_array_length(current_setting('t.result')::jsonb) else -1 end;
end;
$$;

\set rown '00000000-0000-0000-0000-000000217001'
\set rmem '00000000-0000-0000-0000-000000217002'
\set sown '00000000-0000-0000-0000-000000217003'
\set town '00000000-0000-0000-0000-000000217004'
\set aown '00000000-0000-0000-0000-000000217005'
\set bown '00000000-0000-0000-0000-000000217006'
\set staff '00000000-0000-0000-0000-000000217007'
\set cand1 '00000000-0000-0000-0000-000000217008'
\set cand2 '00000000-0000-0000-0000-000000217009'

select pg_temp.new_user(u) from unnest(array[:'rown', :'rmem', :'sown', :'town', :'aown', :'bown', :'staff']::uuid[]) u;
select pg_temp.new_user(u, 'worker') from unnest(array[:'cand1', :'cand2']::uuid[]) u;
update public.profiles set account_kind = intended_account_kind
where id in (:'rown', :'rmem', :'sown', :'town', :'aown', :'bown', :'staff', :'cand1', :'cand2');
insert into public.platform_staff (user_id, role) values (:'staff', 'admin');

select pg_temp.new_org(:'rown', 'recruitment_company', 'inquiry-analytics-recruiter', 'PH') as r \gset
select pg_temp.new_org(:'sown', 'staffing_company', 'inquiry-analytics-staffing', 'NP') as s \gset
select pg_temp.new_org(:'town', 'recruitment_company', 'inquiry-analytics-enterprise', 'PH') as t \gset
select pg_temp.new_org(:'aown', 'employer', 'inquiry-analytics-employer-de', 'DE') as a \gset
select pg_temp.new_org(:'bown', 'employer', 'inquiry-analytics-employer-pl', 'PL') as b \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'r', :'rmem', 'member', now());

delete from private.org_analytics_daily;

-- Shape -------------------------------------------------------------------------------------------------------------------
select ok(
  (enum_range(null::public.analytics_metric))[1:3] = array['profile_views', 'inquiries', 'invitations']::public.analytics_metric[],
  'FR-R6: inquiries follow the profile views, as the requirement lists the metrics'
);
select is(
  (select string_agg(f, ',' order by f) from unnest(array['private.aggregate_org_activity(date)',
     'private.analytics_metric_released(public.analytics_metric)']) f
   where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('service_role', f, 'execute')
      or has_function_privilege('anon', f, 'execute')),
  null, 'the aggregation and the release check still have no API grant'
);
select ok(
  (select indexdef ~ 'WHERE \(kind = ''inquiry''' from pg_indexes where schemaname = 'public' and indexname = 'connections_inquiry_created_at_idx'),
  'the daily job finds the inquiries of a day by an index of their own'
);

-- AC3: daily aggregation of inquiries ---------------------------------------------------------------------------------------
select pg_temp.connect(:'a', :'r', 1), pg_temp.connect(:'a', :'r', 1), pg_temp.connect(:'b', :'r', 1), pg_temp.connect(:'a', :'s', 1);
select pg_temp.connect(:'a', :'r', 0), pg_temp.connect(:'b', :'s', 2);
select pg_temp.connect(:'a', :'s', 1, 'request_workforce');

select ok(private.aggregate_org_activity() > 0, 'AC3: the job for the previous UTC day counts the inquiries');
select is(pg_temp.day_rows(:'r', 1), 'inquiries:DE:=2,inquiries:PL:=1',
  'AC3: the partner R counts the inquiries it received yesterday by the employer''s country, and none of today');
select is(pg_temp.day_rows(:'s', 1), 'inquiries:DE:=1',
  'S counts its inquiry of yesterday and not the workforce request, which is an invitation of its own');
select is(pg_temp.day_rows(:'a', 1), 'inquiries:NP:=1,inquiries:PH:=2',
  'AC3: the employer A counts the inquiries it sent by the partner''s country');
select is(pg_temp.day_rows(:'b', 1), 'inquiries:PH:=1', 'the employer B counts its own inquiry only');
select is(
  (select count(*)::integer from private.org_analytics_daily where metric = 'inquiries' and occupation_id is not null), 0,
  'an inquiry names no requirement, so it has no occupation row'
);
create temp table first_run as
  select organization_id, day, metric, country_code, occupation_id, value from private.org_analytics_daily;
select private.aggregate_org_activity();
select is(
  (select count(*)::integer from (
     (select organization_id, day, metric, country_code, occupation_id, value from private.org_analytics_daily
      except select * from first_run)
     union all
     (select * from first_run
      except select organization_id, day, metric, country_code, occupation_id, value from private.org_analytics_daily)) d),
  0, 'AC3: the second run leaves the same rows (no doubling)'
);
select private.aggregate_recent_org_analytics();
select is(concat_ws(' ', pg_temp.day_rows(:'s', 2), pg_temp.day_rows(:'b', 2)), 'inquiries:PL:=1 inquiries:NP:=1',
  'AC3: the scheduled run counts the inquiries of the day before too');

-- AC8: the release of the metric ----------------------------------------------------------------------------------------------
delete from private.org_analytics_daily;
select pg_temp.put(:'r', 'profile_views', 'DE', null, 9), pg_temp.put(:'r', 'inquiries', 'DE', null, 6),
  pg_temp.put(:'r', 'invitations', 'DE', null, 7);
update private.settings set value = 'true' where key = 'release_partner_directories';
update private.settings set value = 'false' where key in ('release_messaging', 'release_job_orders', 'release_candidate_submissions');
select is(pg_temp.figures(:'rown', :'r', '7d', 'total'), 'profile_views::=9', 'release 2c off: no inquiries');
select is(pg_temp.figures(:'rown', :'r', '7d', 'country'), 'profile_views:DE:=9', 'nor an inquiry cell by country');
update private.settings set value = 'true' where key = 'release_messaging';
select is(pg_temp.figures(:'rmem', :'r', '7d', 'total'), 'profile_views::=9,inquiries::=6',
  'AC8: with release_messaging on a member reads the inquiries after the profile views, the job order metrics still off');
update private.settings set value = 'true' where key = 'release_job_orders';
select is(pg_temp.figures(:'rown', :'r', '7d', 'total'), 'profile_views::=9,inquiries::=6,invitations::=7,responses::=x,selections::=x',
  'with release 2b on the job order metrics follow');

delete from private.org_analytics_daily;
select pg_temp.put(:'a', 'inquiries', 'PH', null, 6);
update private.settings set value = 'false' where key = 'release_messaging';
select is(pg_temp.access(:'aown', :'a'), '3|false', 'AC12: inquiries while release 2c is off are no figures yet');
update private.settings set value = 'true' where key = 'release_messaging';
select is(pg_temp.access(:'aown', :'a'), '3|true', 'and with it on the employer has figures');

-- AC4, AC5: suppression and complementary suppression -------------------------------------------------------------------------
delete from private.org_analytics_daily;
select pg_temp.put(:'s', 'inquiries', 'DE', null, 10), pg_temp.put(:'s', 'inquiries', 'PL', null, 6, 2),
  pg_temp.put(:'s', 'inquiries', 'AT', null, 3, 3), pg_temp.put(:'r', 'inquiries', 'DE', null, 4);
select is(pg_temp.figures(:'rown', :'r', '30d', 'total'), 'profile_views::=x,inquiries::=x,invitations::=x,responses::=x,selections::=x',
  'AC4: 4 inquiries read as fewer than the threshold');
select is(pg_temp.figures(:'sown', :'s', '30d', 'country'), 'inquiries:AT:=x,inquiries:DE:=10,inquiries:PL:=x',
  'AC5: AT (3) is hidden and PL (6), the smallest other cell, too; DE shows 10');
select is(pg_temp.figures(:'sown', :'s', '30d', 'total') like '%inquiries::=19%', true, 'AC5: the total of inquiries shows 19');
select is(pg_temp.figures(:'sown', :'s', '30d', 'occupation'), '', 'the breakdown by occupation has no inquiry cell');

-- AC6, AC10: the export of Enterprise -----------------------------------------------------------------------------------------
select pg_temp.put(:'t', 'inquiries', 'DE', null, 5), pg_temp.put(:'t', 'inquiries', 'PL', null, 5);
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (:'r', 'recruitment_partner', 'active', 'null'), (:'t', 'recruitment_enterprise', 'active', 'null');
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.figures(:'rown', :'r', '30d', 'country'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|analytics_advanced',
  'AC6: the Partner plan reads the total of inquiries but no breakdown');
select is(pg_temp.export(:'town', :'t'),
  'profile_views::=x,inquiries::=10,invitations::=x,responses::=x,selections::=x,inquiries:DE:=5,inquiries:PL:=5',
  'AC9, AC10: the Enterprise export has the inquiries in the totals and by country');
select is(
  (select count(*)::integer from audit.log where action = 'analytics.exported' and entity_id = :'t'::text), 1,
  'AC10: and writes one audit row'
);
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- AC7, NFR-S8: only members ----------------------------------------------------------------------------------------------------
select is(
  (select string_agg(x, ',') from unnest(array[
     pg_temp.figures(:'sown', :'r', '30d', 'total'), pg_temp.figures(:'town', :'r', '30d', 'total'),
     pg_temp.figures(:'aown', :'r', '30d', 'total'), pg_temp.figures(:'bown', :'r', '30d', 'total'),
     pg_temp.figures(:'staff', :'r', '30d', 'total'), pg_temp.figures(:'cand1', :'r', '30d', 'total'),
     pg_temp.figures(:'cand2', :'r', '30d', 'total')]) x),
  '42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|',
  'AC7: two other partners, the two employers that sent R inquiries, a Platform Administrator and two candidates are refused R''s figures'
);
select is(
  concat_ws(',', pg_temp.view_rows(:'sown', :'r'), pg_temp.view_rows(:'aown', :'r'), pg_temp.view_rows(:'bown', :'r'),
    pg_temp.view_rows(:'staff', :'r'), pg_temp.view_rows(:'cand1', :'r'), pg_temp.view_rows(:'cand2', :'r')),
  '0,0,0,0,0,0', 'AC7: and read no R row in public.v_org_analytics'
);
select is(pg_temp.view_rows(:'rmem', :'r') > 0, true, 'a member of R reads its rows there');
select matches(pg_temp.figures(null, :'r', '30d', 'total'), '^42501\|', 'AC7: the anonymous caller is refused');

select * from finish();
rollback;
