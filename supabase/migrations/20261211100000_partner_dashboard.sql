-- The figures of the recruitment and staffing company dashboards, release 2a parts (FR-R3, FR-R4; SOP P2-37 and P2-38
-- steps Blocks and Grow; docs/phase-2/DATA_MODEL.md section 7 Moderation and compliance).
--
-- get_partner_dashboard reads, in one call, the figures that would otherwise take a round trip each: the review and
-- listing state of the company and the first part of its workforce profile still missing, its availability listings by
-- freshness, its licences by expiry, and its profile views of the last 30 days. Counts, dates and states only: no
-- employer, viewer, follower or worker is named. The plan and its usage are read through get_dashboard_plan and
-- org_usage, the listings themselves through the table (members read every row of their organisation) and the follower
-- count through follower_count, as before.
--
-- The blocks of release 2b and 2c (fitting job orders, invitations, submissions by stage, projects, partner requests,
-- matching employers, unread messages) join the result with their tables (V55, V75); until then the function has no
-- column for them.

-- Refusals: CHARA_FORBIDDEN without a session, detail company_account_required when the account is not a company
-- account (a candidate), without detail for a caller who is no member of p_org (staff included), detail wrong_org_type
-- for an employer organisation and detail release_off while release_partner_directories is false. Anonymous has no grant.
--
-- Listings follow the periods of the settings workforce_confirm_reminder_days (due) and workforce_listing_stale_days
-- (stale, the cut-off of private.workforce_fresh_since that hides a listing outside the company); licences are expiring
-- from licence_expiry_reminder_days before their valid-until date, as the reminder job counts. Profile views are the
-- 30-day total of private.org_analytics_figures (the 30 UTC days ending yesterday), suppressed as get_org_analytics
-- suppresses it (null with profile_views_suppressed and profile_views_fewer_than, the threshold as follower_count says
-- it, below stats_min_count) with one exception: no view at all is 0, not suppressed, so the dashboard can say what
-- brings views (FR-R3 AC7). get_org_analytics, and so the analytics page of V60, shows the same 30 days as hidden. A
-- plan without an analytics level gets null with profile_views_in_plan false (FR-R6 AC6).
create function public.get_partner_dashboard(p_org uuid)
returns table (
  organization_type public.organization_type,
  review_status public.partner_review_status,
  listed boolean,
  profile_hidden boolean,
  profile_missing text,
  profile_updated_at timestamptz,
  listings_total integer,
  listings_due integer,
  listings_stale integer,
  oldest_listing_confirmed_at timestamptz,
  licences_current integer,
  licences_expiring integer,
  licences_expired integer,
  next_licence_expiry date,
  profile_views_30d integer,
  profile_views_suppressed boolean,
  profile_views_fewer_than integer,
  profile_views_in_plan boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type public.organization_type;
  v_today date := (now() at time zone 'utc')::date;
  v_fresh_since timestamptz := private.workforce_fresh_since();
  v_due_since timestamptz := now() - make_interval(days => coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'workforce_confirm_reminder_days'), 30));
  v_licence_days integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'licence_expiry_reminder_days'), 30);
  v_in_plan boolean;
  v_views integer;
  v_suppressed boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required', errcode = '42501';
  end if;
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  v_type := private.org_type(p_org);
  if v_type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'wrong_org_type', errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;

  v_in_plan := private.analytics_level(p_org) >= 1;
  if v_in_plan then
    select f.value, f.suppressed into v_views, v_suppressed
    from private.org_analytics_figures(p_org, '30d', 'total') f
    where f.metric = 'profile_views';
    -- No view at all is 0, so the page can say what brings views (FR-R3 AC7); only 1 to stats_min_count - 1 is hidden.
    if v_suppressed and not exists (
      select 1 from private.org_analytics_daily d
      where d.organization_id = p_org and d.metric = 'profile_views' and d.day between v_today - 30 and v_today - 1
    ) then
      v_views := 0;
      v_suppressed := false;
    end if;
  end if;

  return query
  select
    o.type,
    o.review_status,
    private.is_listed_partner(o.id),
    o.moderation_state = 'hidden',
    private.partner_profile_missing(o.id),
    o.workforce_profile_updated_at,
    w.total,
    w.due,
    w.stale,
    w.oldest,
    l.current_count,
    l.expiring,
    l.expired,
    l.next_expiry,
    case when v_in_plan then v_views end,
    coalesce(v_in_plan and v_suppressed, false),
    case when v_in_plan and v_suppressed then private.stats_min_count() end,
    v_in_plan
  from public.organizations o
  cross join lateral (
    select
      count(*)::integer as total,
      (count(*) filter (where a.confirmed_at <= v_due_since and a.confirmed_at > v_fresh_since))::integer as due,
      (count(*) filter (where a.confirmed_at <= v_fresh_since))::integer as stale,
      min(a.confirmed_at) as oldest
    from public.workforce_availability a
    where a.organization_id = o.id
  ) w
  cross join lateral (
    select
      (count(*) filter (where x.status = 'current'))::integer as current_count,
      (count(*) filter (where x.status = 'current' and x.valid_until <= v_today + v_licence_days))::integer as expiring,
      (count(*) filter (where x.status = 'expired'))::integer as expired,
      min(x.valid_until) filter (where x.status = 'current') as next_expiry
    from public.partner_licences x
    where x.organization_id = o.id
  ) l
  where o.id = p_org;
end;
$$;

comment on function public.get_partner_dashboard(uuid) is
  'The 2a figures of a recruitment or staffing company dashboard (FR-R3, FR-R4) for its members: review and listing state, missing profile part, listings by freshness, licences by expiry, 30-day profile views (suppressed). Counts, dates and states only.';

revoke all on function public.get_partner_dashboard(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_partner_dashboard(uuid) to authenticated;
