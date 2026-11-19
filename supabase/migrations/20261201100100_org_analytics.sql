-- Daily analytics of an organisation (FR-R6 AC2 to AC7, SOP P2-40 steps Aggregate and Suppress; docs/phase-2/DATA_MODEL.md
-- sections 2, 6, 7 Moderation and compliance, and 10). The daily job private.aggregate_org_analytics counts, for the
-- previous UTC day, the profile views of each organisation by the country of the viewing organisation into
-- private.org_analytics_daily. A row holds a count and never a viewer. The other metrics of FR-R6 (inquiries,
-- invitations, responses) are added to public.analytics_metric and to the job with their tables (V60, V76).
--
-- Members read the figures of their organisation through get_org_analytics and public.v_org_analytics, for the periods
-- of the last 7, 30 and 90 days and 12 months, each ending with the previous UTC day. A value below
-- private.stats_min_count (never below 5) is null with suppressed true; a breakdown also hides the cells hidden in a
-- shorter period and, when its hidden cells are one cell or add up to less than the threshold, the smallest shown cell,
-- so neither the total nor another period reveals a hidden cell (AC5; see org_analytics_figures). The plan sets the
-- level (AC6): totals with analytics_basic, breakdowns by country and occupation with analytics_advanced (a higher level
-- includes the lower ones). Staff, other organisations, candidates and visitors read nothing (AC7). The analytics page
-- and the export of Enterprise are V60.

create type public.analytics_metric as enum ('profile_views');

create table private.org_analytics_daily (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  metric public.analytics_metric not null,
  country_code text references public.countries (code),
  occupation_id text references public.occupations (code),
  value integer not null check (value > 0),
  aggregated_at timestamptz not null default now(),
  constraint org_analytics_daily_key unique nulls not distinct (organization_id, day, metric, country_code, occupation_id)
);

comment on table private.org_analytics_daily is
  'Daily counts per organisation, metric and dimension (FR-R6), built by private.aggregate_org_analytics. Counts only, never a viewer. Read through get_org_analytics and public.v_org_analytics; removed after the retention period org_analytics.';

create index org_analytics_daily_day_idx on private.org_analytics_daily (day);
create index org_analytics_daily_country_idx on private.org_analytics_daily (country_code) where country_code is not null;
create index org_analytics_daily_occupation_idx on private.org_analytics_daily (occupation_id) where occupation_id is not null;

alter table private.org_analytics_daily enable row level security;
alter table private.org_analytics_daily force row level security;
revoke all on table private.org_analytics_daily from public, anon, authenticated, service_role;

-- The daily job -----------------------------------------------------------------------------------------------------------

-- Builds the counts of one past UTC day (the previous day by default) from the view events. Running it again for the same
-- day replaces that day's counts with the same rows (AC3). It refuses a day whose events the retention period has
-- removed, and a day that has counts but no events (for example after the period was raised again), so a late run never
-- wipes counts it can no longer rebuild. Runs one at a time. Returns the number of rows written.
create function private.aggregate_org_analytics(p_day date default ((now() at time zone 'utc')::date - 1)) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_kept integer := coalesce((select p.days from private.retention_policies p where p.entity = 'profile_view_events'), 35);
  v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('aggregate_org_analytics'));
  if p_day is null or p_day >= v_today or p_day < v_today - v_kept then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_day';
  end if;
  if not exists (select 1 from private.profile_view_events e where e.viewed_on = p_day)
     and exists (select 1 from private.org_analytics_daily d where d.day = p_day and d.metric = 'profile_views') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_day';
  end if;

  delete from private.org_analytics_daily d where d.day = p_day and d.metric = 'profile_views';
  insert into private.org_analytics_daily (organization_id, day, metric, country_code, value)
  select e.viewed_organization_id, p_day, 'profile_views', o.based_in_country, count(*)::integer
  from private.profile_view_events e
  join public.organizations o on o.id = e.viewer_organization_id
  where e.viewed_on = p_day
  group by e.viewed_organization_id, o.based_in_country;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function private.aggregate_org_analytics(date) from public, anon, authenticated, service_role;

-- The scheduled run: the previous UTC day, and again the day before it, so a run that was missed or a view recorded
-- around midnight is caught the next day. A day without events is skipped: it has nothing to count, and its counts, if
-- any, are kept.
create function private.aggregate_recent_org_analytics() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_day date;
  v_rows integer := 0;
begin
  foreach v_day in array array[v_today - 1, v_today - 2] loop
    if exists (select 1 from private.profile_view_events e where e.viewed_on = v_day) then
      v_rows := v_rows + private.aggregate_org_analytics(v_day);
    end if;
  end loop;
  return v_rows;
end;
$$;

revoke all on function private.aggregate_recent_org_analytics() from public, anon, authenticated, service_role;

select cron.schedule('aggregate-org-analytics', '5 0 * * *', 'select private.aggregate_recent_org_analytics()');

-- The figures -------------------------------------------------------------------------------------------------------------

-- The highest analytics level of the organisation's plan: 0 none, 1 totals, 2 breakdowns, 3 export.
create function private.analytics_level(p_org uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.has_feature(p_org, 'analytics_enterprise') then 3
    when private.has_feature(p_org, 'analytics_advanced') then 2
    when private.has_feature(p_org, 'analytics_basic') then 1
    else 0
  end
$$;

revoke all on function private.analytics_level(uuid) from public, anon, authenticated, service_role;

-- The figures of one organisation for one period ('7d', '30d', '90d', '12m') and dimension ('total', 'country',
-- 'occupation'), suppressed. Totals list every metric, with 0 when nothing happened; a breakdown lists the cells that
-- exist. Checks nothing: called by get_org_analytics and private.my_org_analytics only.
--
-- A breakdown cell is hidden when it is below the threshold, or when it is hidden in the next shorter standard period
-- (7 days inside 30, 30 inside 90, 90 inside 12 months, all ending yesterday), so comparing two periods does not reveal
-- a cell the shorter one hides. Then, when the hidden cells of a metric are a single cell or add up to less than the
-- threshold, the smallest shown cell is hidden too, so the total minus the shown cells reveals nothing (AC5). Totals
-- follow the threshold only.
create function private.org_analytics_figures(p_org uuid, p_period text, p_dimension text)
returns table (
  organization_id uuid,
  period_start date,
  period_end date,
  metric public.analytics_metric,
  country_code text,
  occupation_id text,
  value integer,
  suppressed boolean
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_shorter text := case when p_dimension = 'total' then null
                         else case p_period when '30d' then '7d' when '90d' then '30d' when '12m' then '90d' end end;
begin
  return query
  with bounds as (
    select case p_period
             when '7d' then e - 6
             when '30d' then e - 29
             when '90d' then e - 89
             when '12m' then (e - interval '12 months')::date + 1
           end as s,
           e
    from (select (now() at time zone 'utc')::date - 1 as e) t
  ),
  inherited as (
    select f.metric, f.country_code, f.occupation_id
    from private.org_analytics_figures(p_org, v_shorter, p_dimension) f
    where v_shorter is not null and f.suppressed
  ),
  cells as (
    select m.metric, null::text as country_code, null::text as occupation_id, coalesce(sum(d.value), 0)::integer as v
    from unnest(enum_range(null::public.analytics_metric)) as m (metric)
    cross join bounds b
    left join private.org_analytics_daily d
      on d.organization_id = p_org and d.metric = m.metric and d.day between b.s and b.e
    where p_dimension = 'total'
    group by m.metric
    union all
    select d.metric, d.country_code, null, sum(d.value)::integer
    from private.org_analytics_daily d
    cross join bounds b
    where p_dimension = 'country' and d.organization_id = p_org and d.day between b.s and b.e and d.country_code is not null
    group by d.metric, d.country_code
    union all
    select d.metric, null, d.occupation_id, sum(d.value)::integer
    from private.org_analytics_daily d
    cross join bounds b
    where p_dimension = 'occupation' and d.organization_id = p_org and d.day between b.s and b.e and d.occupation_id is not null
    group by d.metric, d.occupation_id
  ),
  primary_hidden as (
    select c.*, k.k,
      c.v < k.k or exists (
        select 1 from inherited i
        where i.metric = c.metric and i.country_code is not distinct from c.country_code
          and i.occupation_id is not distinct from c.occupation_id
      ) as hidden
    from cells c
    cross join (select private.stats_min_count() as k) k
  ),
  ranked as (
    select h.*,
      count(*) filter (where h.hidden) over (partition by h.metric) as hidden_cells,
      coalesce(sum(h.v) filter (where h.hidden) over (partition by h.metric), 0) as hidden_sum,
      row_number() over (partition by h.metric, h.hidden order by h.v, h.country_code, h.occupation_id) as rank_in_group
    from primary_hidden h
  )
  select p_org, b.s, b.e, r.metric, r.country_code, r.occupation_id,
    case when x.hidden then null else r.v end, x.hidden
  from ranked r
  cross join bounds b
  cross join lateral (
    select r.hidden or (
      p_dimension <> 'total' and r.rank_in_group = 1 and r.hidden_cells >= 1 and (r.hidden_cells = 1 or r.hidden_sum < r.k)
    ) as hidden
  ) x
  order by r.metric, r.country_code, r.occupation_id;
end;
$$;

revoke all on function private.org_analytics_figures(uuid, text, text) from public, anon, authenticated, service_role;

-- The figures of an organisation for a member (FR-R6 AC4 to AC7). Refusals: CHARA_FORBIDDEN for a caller who is not a
-- member (staff included) and, detail release_off, while release_partner_directories is false; CHARA_INVALID_INPUT for
-- an unknown period or dimension; CHARA_FEATURE_NOT_IN_PLAN detail analytics_basic for totals and analytics_advanced for
-- a breakdown when the plan lacks the level.
create function public.get_org_analytics(p_org uuid, p_period text default '30d', p_dimension text default 'total')
returns table (
  organization_id uuid,
  period_start date,
  period_end date,
  metric public.analytics_metric,
  country_code text,
  occupation_id text,
  value integer,
  suppressed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level integer;
begin
  if (select auth.uid()) is null or p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if p_period is null or p_period not in ('7d', '30d', '90d', '12m') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_period';
  end if;
  if p_dimension is null or p_dimension not in ('total', 'country', 'occupation') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_dimension';
  end if;
  v_level := private.analytics_level(p_org);
  if v_level < 1 then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'analytics_basic';
  end if;
  if p_dimension <> 'total' and v_level < 2 then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'analytics_advanced';
  end if;

  return query select * from private.org_analytics_figures(p_org, p_period, p_dimension);
end;
$$;

revoke all on function public.get_org_analytics(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.get_org_analytics(uuid, text, text) to authenticated;

-- Every figure the caller may read: for each organisation they are a member of, every period, the totals at level 1 and
-- the breakdowns at level 2. A total row has neither a country nor an occupation; a country row has a country (the
-- country of an organisation is never empty), an occupation row an occupation.
create function private.my_org_analytics()
returns table (
  organization_id uuid,
  period_start date,
  period_end date,
  metric public.analytics_metric,
  country_code text,
  occupation_id text,
  value integer,
  suppressed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.*
  from private.member_org_ids() o
  cross join lateral (select private.analytics_level(o) as level) l
  cross join unnest(array['7d', '30d', '90d', '12m']) as p (period)
  cross join unnest(array['total', 'country', 'occupation']) as d (dimension)
  cross join lateral private.org_analytics_figures(o, p.period, d.dimension) f
  where private.release_on('release_partner_directories')
    and l.level >= case when d.dimension = 'total' then 1 else 2 end
$$;

revoke all on function private.my_org_analytics() from public, anon, authenticated, service_role;
grant execute on function private.my_org_analytics() to authenticated;

create view public.v_org_analytics with (security_invoker = true) as
select organization_id, period_start, period_end, metric, country_code, occupation_id, value, suppressed
from private.my_org_analytics();

comment on view public.v_org_analytics is
  'The analytics of the caller''s organisations at the level of each plan (FR-R6): counts per period, metric and country or occupation, null with suppressed true below stats_min_count. Never names a viewer.';

revoke all on table public.v_org_analytics from public, anon, authenticated, service_role;
grant select on table public.v_org_analytics to authenticated;
