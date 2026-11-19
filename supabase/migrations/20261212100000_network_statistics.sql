-- Network statistics for administrators, release 2a parts (FR-S2; SOP P2-42 steps Aggregate, Suppress, Show; control
-- counts only, small-count suppression, administrator role; docs/phase-2/DATA_MODEL.md section 7 Moderation and
-- compliance, admin_network_counts).
--
-- Follows the pattern of the live statistics (v_platform_counts): exact counts are made by definer functions over
-- objects the API roles cannot read, and every count below private.stats_min_count (floor 5) leaves the database as
-- null. Nothing names an organisation, a person, a message or a document.
--
-- stats.network_events is the view of SOP step Aggregate: one row per dated partner network event (a partner
-- organisation created, a review decision, a suspension or reinstatement of a partner, a hidden partner profile, a
-- partner profile report, an appeal lodged, decided or restored, a partner search, a saved partner, a follow of a
-- partner), with the metric it counts for and its time. admin_network_counts buckets it per UTC period; each branch of
-- the view has an index on its time column, so a range reads the index range of its days only.
--
-- Organisation states change in place, so the state at the end of a past period cannot be read back from the rows:
-- stats.partner_status_daily keeps, per day, the number of partner organisations of each type in each review state
-- (active organisations) and each organisation status, written shortly after midnight UTC by the job
-- snapshot-partner-statuses. A period that ends today or later reads the live counts; an earlier one the latest
-- snapshot on or before its last day. The table holds counts only.
--
-- The 2b and 2c metrics of FR-S2 (requirements, job orders, invitations, responses, submissions, contact requests,
-- messages) join the view with their tables in V58 and V74.

-- Indexes for the branches of the view that had none on their time column.
create index organizations_partner_created_at_idx on public.organizations (created_at)
  where type in ('recruitment_company', 'staffing_company');
create index moderation_actions_partner_created_at_idx on public.moderation_actions (created_at)
  where target_type in ('organization', 'partner_profile');
create index reports_partner_profile_created_at_idx on public.reports (created_at) where target_type = 'partner_profile';
create index appeals_lodged_at_idx on public.appeals (lodged_at);
create index saved_items_created_at_idx on public.saved_items (created_at);
create index follows_created_at_idx on public.follows (created_at);

-- The view of SOP step Aggregate ------------------------------------------------------------------------------------------

create view stats.network_events with (security_invoker = true) as
select o.type::text || '.new' as metric, o.created_at as occurred_at
from public.organizations o
where o.type in ('recruitment_company', 'staffing_company')
union all
select o.type::text || '.decision_' || d.decision, d.decided_at
from public.partner_review_decisions d
join public.organizations o on o.id = d.organization_id
union all
select case m.action when 'organization_suspended' then 'partner_suspensions' else 'partner_reinstatements' end, m.created_at
from public.moderation_actions m
join public.organizations o on o.id = m.target_id and o.type in ('recruitment_company', 'staffing_company')
where m.target_type = 'organization' and m.action in ('organization_suspended', 'organization_reinstated')
union all
select 'partner_profiles_hidden', m.created_at
from public.moderation_actions m
where m.target_type = 'partner_profile' and m.action = 'content_hidden'
union all
select 'partner_profile_reports', r.created_at
from public.reports r
where r.target_type = 'partner_profile'
union all
select 'appeals_lodged', a.lodged_at
from public.appeals a
union all
select 'appeals_decided', a.decided_at
from public.appeals a
where a.decided_at is not null
union all
select 'appeals_restored', a.decided_at
from public.appeals a
where a.decided_at is not null and a.reversal_action_id is not null
union all
select 'searches.' || s.kind, s.created_at
from stats.partner_searches s
union all
select 'partner_saves', i.created_at
from public.saved_items i
union all
select 'partner_follows', f.created_at
from public.follows f
join public.organizations o on o.id = f.organization_id and o.type in ('recruitment_company', 'staffing_company');

comment on view stats.network_events is
  'One row per dated partner network event (FR-S2 step Aggregate): metric and time only, no organisation, person or content. Read by admin_network_counts and admin_network_kpis; no API grant.';

revoke all on table stats.network_events from public, anon, authenticated, service_role;

-- Partner organisation states per day ------------------------------------------------------------------------------------

create table stats.partner_status_daily (
  day date not null,
  organization_type public.organization_type not null check (organization_type in ('recruitment_company', 'staffing_company')),
  status_key text not null check (status_key in (
    'onboarding', 'pending_review', 'info_requested', 're_review', 'listed', 'declined', 'active', 'suspended')),
  count integer not null check (count >= 0),
  primary key (day, organization_type, status_key)
);

comment on table stats.partner_status_daily is
  'Number of partner organisations per type in each review state (active organisations only) and each organisation status at the end of a UTC day (FR-S2 AC6), written by private.snapshot_partner_statuses. Counts only. Read through admin_network_counts; no API grant.';

alter table stats.partner_status_daily enable row level security;
alter table stats.partner_status_daily force row level security;
revoke all on table stats.partner_status_daily from public, anon, authenticated, service_role;

-- Every type and key, zero filled, so that a snapshot always holds the whole set and a missing row never means zero.
create function private.partner_status_counts()
returns table (organization_type public.organization_type, status_key text, count integer)
language sql
stable
security definer
set search_path = ''
as $$
  with keys (status_key, pos) as (
    values ('onboarding', 1), ('pending_review', 2), ('info_requested', 3), ('re_review', 4), ('listed', 5), ('declined', 6),
      ('active', 7), ('suspended', 8)
  ),
  types (organization_type) as (
    values ('recruitment_company'::public.organization_type), ('staffing_company'::public.organization_type)
  ),
  counted as (
    select o.type, o.review_status::text as status_key, count(*) as n
    from public.organizations o
    where o.type in ('recruitment_company', 'staffing_company') and o.status = 'active' and o.review_status is not null
    group by o.type, o.review_status
    union all
    select o.type, o.status::text, count(*)
    from public.organizations o
    where o.type in ('recruitment_company', 'staffing_company')
    group by o.type, o.status
  )
  select t.organization_type, k.status_key, coalesce(c.n, 0)::integer
  from types t
  cross join keys k
  left join counted c on c.type = t.organization_type and c.status_key = k.status_key
  order by t.organization_type, k.pos
$$;

revoke all on function private.partner_status_counts() from public, anon, authenticated, service_role;

-- Writes the counts of now as the state at the end of p_day (yesterday by default: the job runs just after midnight
-- UTC). Running it again for the same day replaces that day.
create function private.snapshot_partner_statuses(p_day date default null) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'utc')::date - 1);
  v_rows integer;
begin
  insert into stats.partner_status_daily (day, organization_type, status_key, count)
  select v_day, c.organization_type, c.status_key, c.count from private.partner_status_counts() c
  on conflict (day, organization_type, status_key) do update set count = excluded.count;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function private.snapshot_partner_statuses(date) from public, anon, authenticated, service_role;

select private.snapshot_partner_statuses();

select cron.schedule('snapshot-partner-statuses', '1 0 * * *', 'select private.snapshot_partner_statuses()');

-- The figures --------------------------------------------------------------------------------------------------------------

-- The metrics of admin_network_counts in the order the console shows them: every one appears for every period.
create function private.network_count_metrics() returns table (metric text, pos integer)
language sql
immutable
set search_path = ''
as $$
  select m.metric, m.pos::integer
  from unnest(array[
    'recruitment_company.new', 'recruitment_company.decision_approve', 'recruitment_company.decision_request_info',
    'recruitment_company.decision_decline', 'recruitment_company.onboarding', 'recruitment_company.pending_review',
    'recruitment_company.info_requested', 'recruitment_company.re_review', 'recruitment_company.listed',
    'recruitment_company.declined', 'recruitment_company.active', 'recruitment_company.suspended',
    'staffing_company.new', 'staffing_company.decision_approve', 'staffing_company.decision_request_info',
    'staffing_company.decision_decline', 'staffing_company.onboarding', 'staffing_company.pending_review',
    'staffing_company.info_requested', 'staffing_company.re_review', 'staffing_company.listed',
    'staffing_company.declined', 'staffing_company.active', 'staffing_company.suspended',
    'partner_suspensions', 'partner_reinstatements', 'partner_profiles_hidden', 'partner_profile_reports',
    'appeals_lodged', 'appeals_decided', 'appeals_restored',
    'searches.recruitment', 'searches.staffing', 'searches.available_workforce', 'partner_saves', 'partner_follows'
  ]) with ordinality m (metric, pos)
$$;

revoke all on function private.network_count_metrics() from public, anon, authenticated, service_role;

-- One row per metric and period (UTC calendar periods; weeks start on Monday) for p_from to p_to, both days included, at
-- most 366 days and not after today. The range is widened to whole periods (the period of p_from to the end of the
-- period of p_to): a period cut at a range edge would let two calls differ by a few days and expose a hidden count.
-- Events count in the period they happened in; states are those at the end of the period (the live state for a period
-- that ends today or later). A count below stats_min_count is null, and a state before the first snapshot is null too.
-- Refusals: CHARA_FORBIDDEN (detail aal2_required at aal1) for anyone but a Platform Administrator, CHARA_FORBIDDEN
-- detail release_off while release_partner_directories is false, CHARA_INVALID_INPUT detail range, future or p_period.
create function public.admin_network_counts(p_from date, p_to date, p_period text default 'month')
returns table (metric text, period_start date, count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_min integer;
  v_today date := (now() at time zone 'utc')::date;
  v_step interval;
  v_from date;
  v_to date;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'range';
  end if;
  if p_to > v_today then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'future';
  end if;
  if p_period is null or p_period not in ('week', 'month', 'quarter', 'year') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_period';
  end if;
  v_min := private.stats_min_count();
  v_step := case p_period when 'quarter' then interval '3 months' else ('1 ' || p_period)::interval end;
  v_from := date_trunc(p_period, p_from::timestamp)::date;
  v_to := (date_trunc(p_period, p_to::timestamp) + v_step)::date - 1;

  return query
  with periods as (
    select s::date as period_start, (s + v_step)::date - 1 as last_day
    from generate_series(v_from::timestamp, v_to::timestamp, v_step) s
    where s <= v_to::timestamp
  ),
  -- One pass over the range: bounds that are parameters, not join columns, reach the index of every branch of the view.
  events as (
    select date_trunc(p_period, e.occurred_at at time zone 'UTC')::date as period_start, e.metric, count(*) as n
    from stats.network_events e
    where e.occurred_at >= v_from::timestamp at time zone 'UTC' and e.occurred_at < (v_to + 1)::timestamp at time zone 'UTC'
    group by 1, 2
  ),
  live as (
    select c.organization_type, c.status_key, c.count from private.partner_status_counts() c
  ),
  states as (
    select p.period_start, l.organization_type::text || '.' || l.status_key as metric, l.count::bigint as n
    from periods p
    cross join live l
    where p.last_day >= v_today
    union all
    select p.period_start, d.organization_type::text || '.' || d.status_key, d.count::bigint
    from periods p
    join stats.partner_status_daily d
      on d.day = (select max(x.day) from stats.partner_status_daily x where x.day <= p.last_day)
    where p.last_day < v_today
  ),
  counted as (
    select * from events
    union all
    select * from states
  )
  select m.metric, p.period_start, case when c.n >= v_min then c.n::integer end
  from periods p
  cross join private.network_count_metrics() m
  left join counted c on c.period_start = p.period_start and c.metric = m.metric
  order by m.pos, p.period_start;
end;
$$;

comment on function public.admin_network_counts(date, date, text) is
  'Partner network counts per metric and UTC period for Platform Administrators (FR-S2, release 2a parts): metric, period_start, count; null below stats_min_count. Counts only.';

revoke all on function public.admin_network_counts(date, date, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_network_counts(date, date, text) to authenticated;

-- The key figures of the partner network, the KPIs that earlier units left to this page (FR-J4, FR-K1, FR-K2, FR-K4,
-- FR-L1, FR-L4, FR-S1 and FR-R1): value with the number of items it is computed from (base). Range figures cover p_from
-- to p_to (UTC days, at most 366, not after today); figures without range_figure are the state now. Units: count,
-- percent, hours, ratio, date.
--
-- Suppression, so that no figure gives back a count below stats_min_count (k):
--   count, hours and median rows are shown when the base is at least k;
--   a share (percent) is shown only when its part and the rest (base minus part) are both at least k: otherwise
--   share times base, or base minus a shown count, would give the hidden part (complementary suppression);
--   a ratio is shown when its numerator and its base are both at least k;
--   the rows over all listed partners (profile shares and medians) are shown only when the listed count of each type is
--   at least k, since their base minus the listed count of one type would give the other;
--   a hidden row hides its base too.
-- Listed means review_status listed and the organisation active, the rule of the state counts of admin_network_counts.
-- The first row, stats_min_count, is the threshold; the second, states_recorded_from, carries in label the first day of
-- stats.partner_status_daily (states of periods that end before it are unknown). label is the plan name for the plan
-- rows. Refusals as admin_network_counts.
create function public.admin_network_kpis(p_from date, p_to date)
returns table (metric text, label text, unit text, range_figure boolean, value numeric, base integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_min integer;
  v_lo timestamptz;
  v_hi timestamptz;
  v_today date := (now() at time zone 'utc')::date;
  v_fresh_since timestamptz := private.workforce_fresh_since();
  v_target integer := private.partner_review_target_days();
  v_licence_days integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'licence_expiry_reminder_days'), 30);
  v_listed_types_shown boolean;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'range';
  end if;
  if p_to > v_today then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'future';
  end if;
  v_min := private.stats_min_count();
  v_lo := p_from::timestamp at time zone 'UTC';
  v_hi := (p_to + 1)::timestamp at time zone 'UTC';
  select coalesce(bool_and(t.n >= v_min), false) into v_listed_types_shown
  from (
    select count(o.id) as n
    from (values ('recruitment_company'::public.organization_type), ('staffing_company'::public.organization_type)) t (type)
    left join public.organizations o on o.type = t.type and o.review_status = 'listed' and o.status = 'active'
    group by t.type
  ) t;

  return query
  with decisions as (
    select d.organization_id, d.decision, d.decided_at, d.submitted_at
    from public.partner_review_decisions d
    where d.decided_at >= v_lo and d.decided_at < v_hi
  ),
  listed as (
    select o.id, o.type
    from public.organizations o
    where o.type in ('recruitment_company', 'staffing_company') and o.review_status = 'listed' and o.status = 'active'
  ),
  profile as (
    select
      l.id,
      (select count(*) from public.organization_occupations c where c.organization_id = l.id) as occupations,
      exists (select 1 from public.organization_industries i where i.organization_id = l.id) as has_industry,
      exists (select 1 from public.organization_geographies g where g.organization_id = l.id and g.scope = 'sources_from') as has_source,
      (select count(*) from public.organization_geographies g where g.organization_id = l.id and g.scope = 'serves_market') as served,
      private.partner_profile_missing(l.id) is null as complete
    from listed l
  ),
  listings as (
    select a.confirmed_at
    from public.workforce_availability a
    join listed l on l.id = a.organization_id
  ),
  appeals as (
    select a.reversal_action_id
    from public.appeals a
    where a.decided_at >= v_lo and a.decided_at < v_hi
  ),
  range_events as (
    select e.metric, count(*) as n
    from stats.network_events e
    where e.occurred_at >= v_lo and e.occurred_at < v_hi
      and e.metric in ('searches.recruitment', 'searches.staffing', 'partner_saves', 'partner_follows')
    group by e.metric
  ),
  partner_plans as (
    select o.type, private.org_plan_code(o.id) as code
    from public.organizations o
    where o.type in ('recruitment_company', 'staffing_company') and o.status = 'active'
  ),
  employers as (
    select o.id, o.public_page_enabled
    from public.organizations o
    where o.type = 'employer' and o.status = 'active'
  ),
  -- kind: plain (base only), share (part and rest), ratio (numerator and base), listed_set (rows over all listed
  -- partners: the per-type rule on top of plain or share).
  figures (metric, label, unit, range_figure, value, base, part, kind, pos) as (
    select 'review_median_hours', null::text, 'hours', true,
      round((percentile_cont(0.5) within group (order by extract(epoch from d.decided_at - d.submitted_at)) / 3600)::numeric, 1),
      count(*), null::bigint, 'plain', 1
    from decisions d
    union all
    select 'review_on_target_share', null, 'percent', true,
      round(100.0 * count(*) filter (where d.decided_at <= private.add_working_days(d.submitted_at, v_target)) / nullif(count(*), 0), 1),
      count(*), count(*) filter (where d.decided_at <= private.add_working_days(d.submitted_at, v_target)), 'share', 2
    from decisions d
    union all
    select 'approval_share', null, 'percent', true,
      round(100.0 * count(*) filter (where d.decision = 'approve') / nullif(count(*), 0), 1), count(*),
      count(*) filter (where d.decision = 'approve'), 'share', 3
    from decisions d
    union all
    select 'approved_suspended_90d_share', null, 'percent', true,
      round(100.0 * count(*) filter (where s.suspended) / nullif(count(*), 0), 1), count(*), count(*) filter (where s.suspended), 'share', 4
    from decisions d
    cross join lateral (
      select exists (
        select 1 from public.moderation_actions m
        where m.target_type = 'organization' and m.target_id = d.organization_id and m.action = 'organization_suspended'
          and m.created_at >= d.decided_at and m.created_at < d.decided_at + interval '90 days'
      ) as suspended
    ) s
    where d.decision = 'approve'
    union all
    select 'appeal_reversal_share', null, 'percent', true,
      round(100.0 * count(*) filter (where a.reversal_action_id is not null) / nullif(count(*), 0), 1), count(*),
      count(*) filter (where a.reversal_action_id is not null), 'share', 5
    from appeals a
    union all
    select 'contacts_per_100_searches', null, 'ratio', true,
      round(100.0 * coalesce(sum(e.n) filter (where e.metric in ('partner_saves', 'partner_follows')), 0)
        / nullif(coalesce(sum(e.n) filter (where e.metric like 'searches.%'), 0), 0), 1),
      coalesce(sum(e.n) filter (where e.metric like 'searches.%'), 0),
      coalesce(sum(e.n) filter (where e.metric in ('partner_saves', 'partner_follows')), 0)::bigint, 'ratio', 6
    from range_events e
    union all
    select 'listed.' || t.type, null, 'count', false, count(l.id), count(l.id), null, 'plain',
      case t.type when 'recruitment_company' then 10 else 11 end
    from (values ('recruitment_company'::public.organization_type), ('staffing_company'::public.organization_type)) t (type)
    left join listed l on l.type = t.type
    group by t.type
    union all
    select 'profile_complete_share', null, 'percent', false,
      round(100.0 * count(*) filter (where p.complete) / nullif(count(*), 0), 1), count(*), count(*) filter (where p.complete),
      'listed_share', 12
    from profile p
    union all
    select 'occupation_and_industry_share', null, 'percent', false,
      round(100.0 * count(*) filter (where p.occupations > 0 and p.has_industry) / nullif(count(*), 0), 1), count(*),
      count(*) filter (where p.occupations > 0 and p.has_industry), 'listed_share', 13
    from profile p
    union all
    select 'occupations_median', null, 'ratio', false,
      percentile_cont(0.5) within group (order by p.occupations)::numeric, count(*), null, 'listed_set', 14
    from profile p
    union all
    select 'source_and_served_share', null, 'percent', false,
      round(100.0 * count(*) filter (where p.has_source and p.served > 0) / nullif(count(*), 0), 1), count(*),
      count(*) filter (where p.has_source and p.served > 0), 'listed_share', 15
    from profile p
    union all
    select 'served_countries_median', null, 'ratio', false,
      percentile_cont(0.5) within group (order by p.served)::numeric, count(*), null, 'listed_set', 16
    from profile p
    union all
    select 'stale_listings', null, 'count', false,
      count(*) filter (where s.confirmed_at <= v_fresh_since), count(*) filter (where s.confirmed_at <= v_fresh_since), null, 'plain', 17
    from listings s
    union all
    select 'stale_listings_share', null, 'percent', false,
      round(100.0 * count(*) filter (where s.confirmed_at <= v_fresh_since) / nullif(count(*), 0), 1), count(*),
      count(*) filter (where s.confirmed_at <= v_fresh_since), 'share', 18
    from listings s
    union all
    select 'licences_expiring', null, 'count', false, count(*), count(*), null, 'plain', 19
    from public.partner_licences x
    where x.status = 'current' and x.valid_until between v_today and v_today + v_licence_days
    union all
    select 'licences_expired', null, 'count', false, count(*), count(*), null, 'plain', 20
    from public.partner_licences x
    where x.status = 'expired'
    union all
    select 'partner_profiles_hidden_now', null, 'count', false, count(*), count(*), null, 'plain', 21
    from public.organizations o
    where o.type in ('recruitment_company', 'staffing_company') and o.moderation_state = 'hidden'
    union all
    select 'partner_profile_reports_open', null, 'count', false, count(*), count(*), null, 'plain', 22
    from public.reports r
    where r.target_type = 'partner_profile' and r.status in ('new', 'in_review')
    union all
    select 'appeals_open', null, 'count', false, count(*), count(*), null, 'plain', 23
    from public.appeals a
    where a.status = 'open'
    union all
    select 'appeals_overdue', null, 'count', false, count(*), count(*), null, 'plain', 24
    from public.appeals a
    where a.status = 'open' and a.due_at < now()
    union all
    select 'employers_with_saved_partner_share', null, 'percent', false,
      round(100.0 * count(*) filter (where exists (select 1 from public.saved_items i where i.organization_id = e.id))
        / nullif(count(*), 0), 1),
      count(*), count(*) filter (where exists (select 1 from public.saved_items i where i.organization_id = e.id)), 'share', 25
    from employers e
    union all
    select 'follows_per_company_page', null, 'ratio', false,
      round(f.n::numeric / nullif(count(*), 0), 2), count(*), max(f.n), 'ratio', 26
    from employers e
    cross join (select count(*) as n from public.follows f join employers x on x.id = f.organization_id and x.public_page_enabled) f
    where e.public_page_enabled
    group by f.n
    union all
    select 'plan.' || p.org_type || '.' || p.code, p.name, 'count', false, count(o.code), count(o.code), null, 'plain', 100 + p.sort
    from billing.plans p
    left join partner_plans o on o.type = p.org_type and o.code = p.code
    where p.org_type in ('recruitment_company', 'staffing_company')
    group by p.org_type, p.code, p.name, p.sort
  ),
  judged as (
    select f.*,
      f.base >= v_min
      and (f.kind not in ('share', 'listed_share') or (f.part >= v_min and f.base - f.part >= v_min))
      and (f.kind <> 'ratio' or f.part >= v_min)
      and (f.kind not in ('listed_share', 'listed_set') or v_listed_types_shown) as shown
    from figures f
  )
  select r.metric, r.label, r.unit, r.range_figure, r.value, r.base
  from (
    select 'stats_min_count' as metric, null::text as label, 'count' as unit, false as range_figure, v_min::numeric as value,
      v_min as base, -2 as pos
    union all
    select 'states_recorded_from', (select min(d.day)::text from stats.partner_status_daily d), 'date', false, null, null, -1
    union all
    select j.metric, j.label, j.unit, j.range_figure, case when j.shown then j.value end, case when j.shown then j.base::integer end, j.pos
    from judged j
  ) r
  order by r.pos;
end;
$$;

comment on function public.admin_network_kpis(date, date) is
  'Key figures of the partner network for Platform Administrators (FR-S2 with the KPIs of FR-J4, FR-K1, FR-K2, FR-K4, FR-L1, FR-L4, FR-S1, FR-R1): metric, label, unit, range_figure, value, base; complementary suppression below stats_min_count. Aggregates only.';

revoke all on function public.admin_network_kpis(date, date) from public, anon, authenticated, service_role;
grant execute on function public.admin_network_kpis(date, date) to authenticated;
