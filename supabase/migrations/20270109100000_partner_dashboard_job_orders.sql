-- The figures of the recruitment and staffing company dashboards, release 2b parts (FR-R3 AC3 to AC6, AC9; FR-R4 AC3,
-- AC6, AC8, AC9; FR-O5 AC10; SOP P2-37 and P2-38 steps Blocks and Grow; NFR-S8, NFR-S11).
--
-- get_partner_dashboard (drop and recreate: the 2a columns, refusals and rules unchanged) gains the counts of release 2b,
-- each null while its release is off (FR-R3 AC6), so a page never shows a switched-off figure as zero:
--   while release_job_orders is on
--     fitting_job_orders: the open requirements of active employers that fit the partner (on the marketplace, one of its
--       destinations served and one of its occupations listed, as private.job_order_reasons tests a full row, whatever
--       the plan) plus those it was invited to and may still answer (invited, viewed, accepted). The recruitment
--       dashboard calls them fitting job orders, the staffing dashboard workforce requests (FR-R4 AC3).
--     matching_employers: the distinct employers of the fitting marketplace requirements; an invitation to a private
--       requirement adds none (FR-R4 AC9).
--     invitations_awaiting: invitations of the partner still invited or viewed, on open requirements (FR-R3 AC5).
--     responses_open (submitted or updated), responses_shortlisted, responses_selected (the projects of FR-R4 AC6) and
--       responses_declined: the partner's responses by the employer's decision; withdrawn ones are not counted.
--   while release_candidate_submissions and release_job_orders are on (the submission pages need both)
--     submission_stages: one count per submission status, every status present, each submission counted once;
--       awaiting_candidate is "waiting for the worker's agreement" (FR-R3 AC5).
-- Counts only: no employer, requirement, candidate or viewer is named (FR-R3 AC3, FR-R4 AC9).
--
-- list_partner_submission_outcomes (FR-O5 AC10, deferred by V50): per requirement the partner's approved submissions
-- with the hired and not selected (rejected) counts, the ten requirements with the latest change first. The title is the
-- one list_partner_submissions shows (the employer's title only once it was named to the partner, NFR-S11). Answers
-- as list_partner_submissions does (private.assert_invitation_partner, release_off while candidate submissions are off).

drop function public.get_partner_dashboard(uuid);

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
  profile_views_in_plan boolean,
  fitting_job_orders integer,
  matching_employers integer,
  invitations_awaiting integer,
  responses_open integer,
  responses_shortlisted integer,
  responses_selected integer,
  responses_declined integer,
  submission_stages jsonb
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
  v_job_orders boolean;
  v_submissions boolean;
  v_fitting integer;
  v_employers integer;
  v_awaiting integer;
  v_open integer;
  v_shortlisted integer;
  v_selected integer;
  v_declined integer;
  v_stages jsonb;
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
  v_job_orders := private.release_on('release_job_orders');
  v_submissions := v_job_orders and private.release_on('release_candidate_submissions');

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

  if v_job_orders then
    with profile as (
      select
        array(select g.country_code from public.organization_geographies g
              where g.organization_id = p_org and g.scope = 'serves_market') as served,
        array(select oo.occupation_id from public.organization_occupations oo where oo.organization_id = p_org) as occupations
    ),
    candidates as (
      select r.id, r.organization_id,
        r.visibility = 'job_order_marketplace'
          and exists (
            select 1 from public.requirement_countries rc where rc.requirement_id = r.id and rc.country_code = any (p.served))
          and exists (
            select 1 from public.requirement_occupations ro where ro.requirement_id = r.id and ro.occupation_id = any (p.occupations))
          as on_marketplace,
        exists (
          select 1 from public.requirement_invitations i
          where i.requirement_id = r.id and i.organization_id = p_org and i.status in ('invited', 'viewed', 'accepted')
        ) as invited
      from public.workforce_requirements r
      join public.organizations e on e.id = r.organization_id
      cross join profile p
      where r.status = 'open' and e.status = 'active'
        and (r.visibility = 'job_order_marketplace' or exists (
          select 1 from public.requirement_invitations i where i.requirement_id = r.id and i.organization_id = p_org))
    )
    select
      (count(*) filter (where c.on_marketplace or c.invited))::integer,
      (count(distinct c.organization_id) filter (where c.on_marketplace))::integer
    into v_fitting, v_employers
    from candidates c;

    select count(*)::integer into v_awaiting
    from public.requirement_invitations i
    join public.workforce_requirements r on r.id = i.requirement_id
    where i.organization_id = p_org and i.status in ('invited', 'viewed') and r.status = 'open';

    select
      (count(*) filter (where pr.status in ('submitted', 'updated')))::integer,
      (count(*) filter (where pr.status = 'shortlisted'))::integer,
      (count(*) filter (where pr.status = 'selected'))::integer,
      (count(*) filter (where pr.status = 'declined'))::integer
    into v_open, v_shortlisted, v_selected, v_declined
    from public.partner_responses pr
    where pr.organization_id = p_org;
  end if;

  if v_submissions then
    select jsonb_object_agg(st.status, coalesce(n.total, 0) order by st.ord) into v_stages
    from unnest(enum_range(null::public.submission_status)) with ordinality as st (status, ord)
    left join (
      select s.status, count(*)::integer as total
      from public.candidate_submissions s
      where s.organization_id = p_org
      group by s.status
    ) n on n.status = st.status;
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
    v_in_plan,
    v_fitting,
    v_employers,
    v_awaiting,
    v_open,
    v_shortlisted,
    v_selected,
    v_declined,
    v_stages
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
  'The figures of a recruitment or staffing company dashboard (FR-R3, FR-R4) for its members: review and listing state, missing profile part, listings by freshness, licences by expiry, 30-day profile views (suppressed); with release 2b fitting job orders, matching employers, invitations awaiting an answer, responses by decision and submissions by status (null while off). Counts, dates and states only.';

revoke all on function public.get_partner_dashboard(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_partner_dashboard(uuid) to authenticated;

-- The outcomes of the partner's submissions per requirement -------------------------------------------------------------------

create function public.list_partner_submission_outcomes(p_org uuid)
returns table (
  requirement_id uuid,
  title text,
  requirement_status public.requirement_status,
  submitted integer,
  in_progress integer,
  hired integer,
  not_selected integer,
  withdrawn integer,
  last_change_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_invitation_partner(p_org);
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  return query
  with approved as (
    select s.requirement_id, s.status,
      coalesce((select max(e.created_at) from public.submission_events e where e.submission_id = s.id), s.worker_approved_at)
        as changed_at
    from public.candidate_submissions s
    where s.organization_id = p_org and s.worker_approved_at is not null
  ),
  per_requirement as (
    select a.requirement_id,
      count(*)::integer as submitted,
      (count(*) filter (where a.status in ('submitted', 'viewed', 'shortlisted', 'interview', 'offer')))::integer as in_progress,
      (count(*) filter (where a.status = 'hired'))::integer as hired,
      (count(*) filter (where a.status = 'rejected'))::integer as not_selected,
      (count(*) filter (where a.status = 'withdrawn'))::integer as withdrawn,
      max(a.changed_at) as last_change_at
    from approved a
    group by a.requirement_id
    order by max(a.changed_at) desc, a.requirement_id
    limit 10
  )
  select p.requirement_id,
    case when private.requirement_named_to(r.id, p_org) then r.title else private.job_order_neutral_title(r.id) end,
    r.status, p.submitted, p.in_progress, p.hired, p.not_selected, p.withdrawn, p.last_change_at
  from per_requirement p
  join public.workforce_requirements r on r.id = p.requirement_id
  order by p.last_change_at desc, p.requirement_id;
end;
$$;

comment on function public.list_partner_submission_outcomes(uuid) is
  'The ten requirements with the latest change of the partner''s approved submissions (FR-O5 AC10, FR-R3): the title as the partner knows it and the counts submitted, in progress, hired, not selected and withdrawn. Members of the partner while release 2b''s submissions are on.';

revoke all on function public.list_partner_submission_outcomes(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_partner_submission_outcomes(uuid) to authenticated;
