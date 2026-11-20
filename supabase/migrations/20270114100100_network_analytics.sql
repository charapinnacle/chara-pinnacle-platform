-- The network analytics of an organisation and their export (FR-R6 AC5 to AC10 and AC12, SOP P2-40 steps Aggregate,
-- Suppress and Show; NFR-S8; docs/phase-2/DATA_MODEL.md sections 6, 7 Moderation and compliance, and 10). V20 counts the
-- profile views; this migration adds the job order metrics, each counted for both organisations of the record, by the
-- country of the other organisation and by the occupations of the requirement:
--   invitations  an invitation sent (invited_at): received by the partner, sent by the employer
--   responses    a partner response sent (created_at): sent by the partner, received by the employer
--   selections   a response selected (decided_at; selected is final): the partner was selected, the employer selected
--   submissions  for the partner a candidate request sent (created_at); for the employer a submission it received, that
--                is one the candidate approved (worker_approved_at), as the employer sees nothing before
--   hires        a submitted candidate moved to hired (the submission event)
-- A day holds per organisation and metric one row per country (occupation empty) and one row per occupation (country
-- empty); a requirement with several occupations counts once in each, so the totals add up the country rows only. The
-- metrics are shown while their release is on (the first three with release_job_orders, the last two with
-- release_candidate_submissions too) and suppressed as the profile views are. export_org_analytics gives Enterprise the
-- aggregates of a period, audited (analytics.exported); get_org_analytics_access tells the page the level of the plan and
-- whether the organisation has any figure yet (AC12), which says no more than the dashboard's own "no view at all".

create index candidate_submissions_approved_at_idx on public.candidate_submissions (worker_approved_at)
  where worker_approved_at is not null;

-- Whether a metric is shown: the release of its records is on. The caller checks release_partner_directories.
create function private.analytics_metric_released(p_metric public.analytics_metric) returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_metric::text = 'profile_views' then true
    when p_metric::text in ('submissions', 'hires') then
      private.release_on('release_job_orders') and private.release_on('release_candidate_submissions')
    else private.release_on('release_job_orders')
  end
$$;

revoke all on function private.analytics_metric_released(public.analytics_metric) from public, anon, authenticated, service_role;

-- The daily job for the job order metrics ----------------------------------------------------------------------------------

-- Builds the job order counts of one past UTC day (the previous day by default) from the records themselves, which are
-- kept 730 days, so a day of the last 12 months can be built again; running it again replaces that day's counts with the
-- same rows. Runs one at a time, with the profile views. Returns the number of rows written.
create function private.aggregate_org_activity(p_day date default ((now() at time zone 'utc')::date - 1)) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_from timestamptz;
  v_to timestamptz;
  v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('aggregate_org_analytics'));
  if p_day is null or p_day >= v_today or p_day < v_today - 366 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_day';
  end if;
  v_from := p_day::timestamp at time zone 'utc';
  v_to := v_from + interval '1 day';

  delete from private.org_analytics_daily d where d.day = p_day and d.metric <> 'profile_views';
  insert into private.org_analytics_daily (organization_id, day, metric, country_code, occupation_id, value)
  with acts (metric, act_id, requirement_id, organization_id, other_id) as (
    select 'invitations'::public.analytics_metric, i.id::text, i.requirement_id, side.org, side.other
    from public.requirement_invitations i
    cross join lateral (values (i.organization_id, i.employer_organization_id), (i.employer_organization_id, i.organization_id)) side (org, other)
    where i.invited_at >= v_from and i.invited_at < v_to
    union all
    select 'responses'::public.analytics_metric, p.id::text, p.requirement_id, side.org, side.other
    from public.partner_responses p
    cross join lateral (values (p.organization_id, p.employer_organization_id), (p.employer_organization_id, p.organization_id)) side (org, other)
    where p.created_at >= v_from and p.created_at < v_to
    union all
    select 'selections'::public.analytics_metric, p.id::text, p.requirement_id, side.org, side.other
    from public.partner_responses p
    cross join lateral (values (p.organization_id, p.employer_organization_id), (p.employer_organization_id, p.organization_id)) side (org, other)
    where p.status = 'selected' and p.decided_at >= v_from and p.decided_at < v_to
    union all
    select 'submissions'::public.analytics_metric, s.id::text, s.requirement_id, s.organization_id, s.employer_organization_id
    from public.candidate_submissions s
    where s.created_at >= v_from and s.created_at < v_to
    union all
    select 'submissions'::public.analytics_metric, s.id::text, s.requirement_id, s.employer_organization_id, s.organization_id
    from public.candidate_submissions s
    where s.worker_approved_at >= v_from and s.worker_approved_at < v_to
    union all
    select 'hires'::public.analytics_metric, s.id::text, s.requirement_id, side.org, side.other
    from public.submission_events e
    join public.candidate_submissions s on s.id = e.submission_id
    cross join lateral (values (s.organization_id, s.employer_organization_id), (s.employer_organization_id, s.organization_id)) side (org, other)
    where e.to_status = 'hired' and e.created_at >= v_from and e.created_at < v_to
  )
  select a.organization_id, p_day, a.metric, o.based_in_country, null::text, count(distinct a.act_id)::integer
  from acts a
  join public.organizations o on o.id = a.other_id
  group by a.organization_id, a.metric, o.based_in_country
  union all
  select a.organization_id, p_day, a.metric, null::text, ro.occupation_id, count(distinct a.act_id)::integer
  from acts a
  join public.requirement_occupations ro on ro.requirement_id = a.requirement_id
  group by a.organization_id, a.metric, ro.occupation_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function private.aggregate_org_activity(date) from public, anon, authenticated, service_role;

-- private.aggregate_recent_org_analytics of 20261201100100 with the job order metrics: the previous UTC day and the day
-- before it. A day without view events keeps its view counts, as before; the job order counts are always rebuilt.
create or replace function private.aggregate_recent_org_analytics() returns integer
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
    v_rows := v_rows + private.aggregate_org_activity(v_day);
  end loop;
  return v_rows;
end;
$$;

-- The records of the last 12 months are counted once now, so every period starts complete.
select sum(private.aggregate_org_activity(d::date))
from generate_series((now() at time zone 'utc')::date - 366, (now() at time zone 'utc')::date - 1, interval '1 day') d;

-- The figures -------------------------------------------------------------------------------------------------------------

-- private.org_analytics_figures of 20261201100100 with two changes: a total adds up the rows without an occupation (each
-- event counts once there, by country), and only the metrics whose release is on are listed.
create or replace function private.org_analytics_figures(p_org uuid, p_period text, p_dimension text)
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
      on d.organization_id = p_org and d.metric = m.metric and d.day between b.s and b.e and d.occupation_id is null
    where p_dimension = 'total' and private.analytics_metric_released(m.metric)
    group by m.metric
    union all
    select d.metric, d.country_code, null, sum(d.value)::integer
    from private.org_analytics_daily d
    cross join bounds b
    where p_dimension = 'country' and d.organization_id = p_org and d.day between b.s and b.e and d.country_code is not null
      and private.analytics_metric_released(d.metric)
    group by d.metric, d.country_code
    union all
    select d.metric, null, d.occupation_id, sum(d.value)::integer
    from private.org_analytics_daily d
    cross join bounds b
    where p_dimension = 'occupation' and d.organization_id = p_org and d.day between b.s and b.e and d.occupation_id is not null
      and private.analytics_metric_released(d.metric)
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

-- What the analytics page needs before it reads figures (FR-R6 AC8, AC12): the level of the plan (0 none, 1 totals,
-- 2 breakdowns, 3 export), whether the organisation has any figure of a shown metric in the last 12 months, and the
-- threshold below which a count is hidden (private.stats_min_count, never below 5). Refusals as
-- get_org_analytics: CHARA_FORBIDDEN for a caller who is not a member and, detail release_off, while
-- release_partner_directories is false.
create function public.get_org_analytics_access(p_org uuid)
returns table (analytics_level integer, has_figures boolean, fewer_than integer)
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
  v_level := private.analytics_level(p_org);
  return query select v_level, v_level >= 1 and exists (
    select 1 from private.org_analytics_daily d
    where d.organization_id = p_org
      and d.day >= ((now() at time zone 'utc')::date - 1 - interval '12 months')::date + 1
      and private.analytics_metric_released(d.metric)
  ), private.stats_min_count();
end;
$$;

revoke all on function public.get_org_analytics_access(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_org_analytics_access(uuid) to authenticated;

-- The export of Enterprise (FR-R6 AC9, AC10): every figure of one period, the totals, then the cells by country and by
-- occupation, suppressed as on the page, for any member of an organisation whose plan has analytics_enterprise. Each call
-- writes one audit row analytics.exported with the period and no figure. Refusals as get_org_analytics, and
-- CHARA_FEATURE_NOT_IN_PLAN detail analytics_enterprise below that level.
create function public.export_org_analytics(p_org uuid, p_period text)
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
security definer
set search_path = ''
as $$
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
  if private.analytics_level(p_org) < 3 then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'analytics_enterprise';
  end if;

  perform audit.record('analytics.exported', 'organization', p_org::text, jsonb_build_object('period', p_period));
  return query
  select * from private.org_analytics_figures(p_org, p_period, 'total')
  union all
  select * from private.org_analytics_figures(p_org, p_period, 'country')
  union all
  select * from private.org_analytics_figures(p_org, p_period, 'occupation');
end;
$$;

revoke all on function public.export_org_analytics(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.export_org_analytics(uuid, text) to authenticated;
