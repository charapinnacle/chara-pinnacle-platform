-- The release 2c blocks of the dashboards (FR-R3, FR-R4, FR-R5 release 2c parts; FR-Q1 AC10, deferred by V68 and V70;
-- SOP P2-37, P2-38 and P2-39 step Blocks; NFR-S8, NFR-S9, NFR-U4).
--
-- get_partner_dashboard and get_employer_network_dashboard (drop and recreate: every earlier column, refusal and rule
-- unchanged) gain the counts of release 2c after their earlier columns, each null while its release is off, so a page
-- never shows a switched-off figure as zero (FR-R3 AC6, FR-R5 AC7):
--   while release_messaging is on
--     get_partner_dashboard.partner_requests: the inquiries and workforce requests (connections of V71) addressed to the
--       partner and not answered yet (status sent), a workforce request only while its requirement is not closed or
--       filled (FR-R4 AC6); partner_inquiries is the inquiry share of it.
--     get_employer_network_dashboard.partner_requests_waiting / partner_requests_answered: the employer's own inquiries
--       and workforce requests still waiting for the partner (sent; a workforce request only while its requirement is
--       not closed or filled), and those answered or accepted.
--   while release_find_workers is on (private.dashboard_matching_workers, both functions)
--     matching_workers: the listed Find Workers cards (private.worker_cards, the rule of FR-Q1 AC7) whose occupation is
--       one the organisation needs and whose preferred countries include a country it needs it in: for an employer
--       the occupations and countries of its open, visible workforce requirements and of its open, visible vacancies;
--       for a recruitment or staffing company the occupations it lists and the countries it serves. A count only:
--       never a card id or any card field (FR-R5 AC5, NFR-S9). 1 to private.stats_min_count() - 1 is null with
--       matching_workers_suppressed and matching_workers_fewer_than; none at all is 0, so the page can say what fills it.
--     matching_workers_reason: why there is no count for an organisation that cannot search (V69's
--       private.assert_worker_searcher, read without raising): feature_not_in_plan (a free plan code, which a lapsed
--       subscription falls back to, or a plan without worker_search), not_listed or profile_hidden (a partner not
--       approved or hidden by moderation), organization_suspended.
--
-- my_contact_request_counts() is the worker's own count of contact requests for the Find Workers card of the dashboard
-- (FR-Q1 AC10): pending (waiting for the answer, as contact_request_status_now reads them) and received (all of them).
-- The refusals of list_contact_requests_received: CHARA_NOT_FOUND while release_find_workers is off, CHARA_FORBIDDEN
-- without a session, worker_account_required for a company account; anonymous has no EXECUTE.

-- Matching workers -------------------------------------------------------------------------------------------------------------

create function private.dashboard_matching_workers(p_org uuid)
returns table (matching_workers integer, suppressed boolean, fewer_than integer, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_reason text;
  v_count integer;
  v_min integer := private.stats_min_count();
begin
  if not private.release_on('release_find_workers') then
    return query select null::integer, false, null::integer, null::text;
    return;
  end if;
  select * into v_org from public.organizations o where o.id = p_org;
  v_reason := case
    when v_org.status <> 'active' then 'organization_suspended'
    when v_org.type <> 'employer' and not private.is_listed_partner(p_org) then 'not_listed'
    when v_org.type <> 'employer' and v_org.moderation_state <> 'visible' then 'profile_hidden'
    when private.org_plan_code(p_org) like 'free\_%' or not private.has_feature(p_org, 'worker_search') then 'feature_not_in_plan'
  end;
  if v_reason is not null then
    return query select null::integer, false, null::integer, v_reason;
    return;
  end if;

  with needs as (
    select ro.occupation_id, rc.country_code
    from public.workforce_requirements r
    join public.requirement_occupations ro on ro.requirement_id = r.id
    join public.requirement_countries rc on rc.requirement_id = r.id
    where v_org.type = 'employer' and r.organization_id = p_org and r.status = 'open' and r.moderation_state = 'visible'
    union
    select j.occupation_id, j.country_code
    from public.jobs j
    where v_org.type = 'employer' and j.organization_id = p_org and j.status = 'open' and j.moderation_state = 'visible'
      and j.deleted_at is null
    union
    select oo.occupation_id, g.country_code
    from public.organization_occupations oo
    join public.organization_geographies g on g.organization_id = oo.organization_id and g.scope = 'serves_market'
    where v_org.type <> 'employer' and oo.organization_id = p_org
  )
  select count(*)::integer into v_count
  from private.worker_cards c
  where c.listed and exists (
    select 1 from needs n
    join public.worker_preferred_countries pc on pc.worker_user_id = c.user_id and pc.country_code = n.country_code
    where n.occupation_id = c.occupation_id);

  if v_count > 0 and v_count < v_min then
    return query select null::integer, true, v_min, null::text;
  else
    return query select v_count, false, null::integer, null::text;
  end if;
end;
$$;

revoke all on function private.dashboard_matching_workers(uuid) from public, anon, authenticated, service_role;

-- The partner dashboards ------------------------------------------------------------------------------------------------------

drop function public.get_partner_dashboard(uuid);

create function public.get_partner_dashboard(p_org uuid) returns table (organization_type public.organization_type, review_status partner_review_status, listed boolean, profile_hidden boolean, profile_missing text, profile_updated_at timestamptz, listings_total integer, listings_due integer, listings_stale integer, oldest_listing_confirmed_at timestamptz, licences_current integer, licences_expiring integer, licences_expired integer, next_licence_expiry date, profile_views_30d integer, profile_views_suppressed boolean, profile_views_fewer_than integer, profile_views_in_plan boolean, fitting_job_orders integer, matching_employers integer, invitations_awaiting integer, responses_open integer, responses_shortlisted integer, responses_selected integer, responses_declined integer, submission_stages jsonb, partner_requests integer, partner_inquiries integer, matching_workers integer, matching_workers_suppressed boolean, matching_workers_fewer_than integer, matching_workers_reason text)
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
  v_requests integer;
  v_inquiries integer;
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
      where r.status = 'open' and e.status = 'active' and r.moderation_state = 'visible'
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
    where i.organization_id = p_org and i.status in ('invited', 'viewed') and r.status = 'open' and r.moderation_state = 'visible';

    select
      (count(*) filter (where pr.status in ('submitted', 'updated')))::integer,
      (count(*) filter (where pr.status = 'shortlisted'))::integer,
      (count(*) filter (where pr.status = 'selected'))::integer,
      (count(*) filter (where pr.status = 'declined'))::integer
    into v_open, v_shortlisted, v_selected, v_declined
    from public.partner_responses pr
    where pr.organization_id = p_org and pr.moderation_state = 'visible';
  end if;

  if v_submissions then
    select jsonb_object_agg(st.status, coalesce(n.total, 0) order by st.ord) into v_stages
    from unnest(enum_range(null::public.submission_status)) with ordinality as st (status, ord)
    left join (
      select s.status, count(*)::integer as total
      from public.candidate_submissions s
      where s.organization_id = p_org and s.moderation_state = 'visible'
      group by s.status
    ) n on n.status = st.status;
  end if;

  if private.release_on('release_messaging') then
    select count(*)::integer, (count(*) filter (where c.kind = 'inquiry'))::integer into v_requests, v_inquiries
    from public.connections c
    where c.to_organization_id = p_org and c.status = 'sent'
      and (c.kind = 'inquiry' or (c.kind = 'request_workforce' and exists (
        select 1 from public.workforce_requirements r
        where r.id = c.requirement_id and r.status in ('draft', 'open', 'paused'))));
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
    v_stages,
    v_requests,
    v_inquiries,
    m.matching_workers,
    m.suppressed,
    m.fewer_than,
    m.reason
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
  cross join lateral private.dashboard_matching_workers(o.id) m
  where o.id = p_org;
end;
$$;


comment on function public.get_partner_dashboard(uuid) is
  'The figures of a recruitment or staffing company dashboard (FR-R3, FR-R4) for its members: review and listing state, missing profile part, listings by freshness, licences by expiry, 30-day profile views (suppressed); with release 2b fitting job orders, matching employers, invitations awaiting an answer, responses by decision and submissions by status; with release 2c the partner requests waiting for an answer and the matching Find Workers cards (suppressed, or the reason there is no count); null while off. Counts, dates and states only.';

revoke all on function public.get_partner_dashboard(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_partner_dashboard(uuid) to authenticated;

-- The employer dashboard ------------------------------------------------------------------------------------------------------

drop function public.get_employer_network_dashboard(uuid);

create function public.get_employer_network_dashboard(p_org uuid)
returns table (
  saved_partners integer,
  followed_companies integer,
  open_requirements integer,
  paused_requirements integer,
  draft_requirements integer,
  requirements jsonb,
  invited_partners integer,
  invited_recruitment integer,
  invited_staffing integer,
  invitations_waiting integer,
  invitations_accepted integer,
  invitations_responded integer,
  invitations_declined integer,
  responses_waiting integer,
  responses_updated integer,
  responses_shortlisted integer,
  selected_partners integer,
  submission_stages jsonb,
  partner_requests_waiting integer,
  partner_requests_answered integer,
  matching_workers integer,
  matching_workers_suppressed boolean,
  matching_workers_fewer_than integer,
  matching_workers_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_job_orders boolean;
  v_submissions boolean;
  v_saved integer;
  v_followed integer;
  v_open integer;
  v_paused integer;
  v_draft integer;
  v_requirements jsonb;
  v_invited integer;
  v_invited_recruitment integer;
  v_invited_staffing integer;
  v_waiting integer;
  v_accepted integer;
  v_responded integer;
  v_declined integer;
  v_responses_waiting integer;
  v_responses_updated integer;
  v_shortlisted integer;
  v_selected integer;
  v_stages jsonb;
  v_requests_waiting integer;
  v_requests_answered integer;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required', errcode = '42501';
  end if;
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if private.org_type(p_org) <> 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'employer_only', errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.assert_member_aal2(p_org);
  v_job_orders := private.release_on('release_job_orders');
  v_submissions := v_job_orders and private.release_on('release_candidate_submissions');

  select count(*)::integer into v_saved
  from public.saved_items s
  where s.organization_id = p_org and private.is_public_partner(s.target_organization_id);

  select count(*)::integer into v_followed
  from public.follows f
  where f.user_id = v_uid and private.is_followable(f.organization_id);

  if v_job_orders then
    select
      (count(*) filter (where r.status = 'open'))::integer,
      (count(*) filter (where r.status = 'paused'))::integer,
      (count(*) filter (where r.status = 'draft'))::integer
    into v_open, v_paused, v_draft
    from public.workforce_requirements r
    where r.organization_id = p_org and r.moderation_state = 'visible';

    select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb) into v_requirements
    from (
      select
        row_number() over (order by r.published_at desc nulls last, r.id) as ord,
        r.id, r.title, r.status, r.closes_on,
        (select count(*) from public.partner_responses p
         where p.requirement_id = r.id and p.status <> 'withdrawn' and p.moderation_state = 'visible')::integer
          as responses,
        (select count(*) from public.partner_responses p
         where p.requirement_id = r.id and p.status = 'selected' and p.moderation_state = 'visible')::integer
          as selected,
        (select count(*) from public.partner_responses p
         where p.requirement_id = r.id and p.status in ('submitted', 'updated') and p.moderation_state = 'visible')::integer
          as awaiting_decision,
        (select count(*) from public.partner_responses p
         where p.requirement_id = r.id and p.status = 'updated' and p.employer_seen_version < p.version
           and p.moderation_state = 'visible')::integer
          as updated_unseen,
        (select count(*) from public.requirement_invitations i
         where i.requirement_id = r.id and i.status in ('invited', 'viewed'))::integer as invitations_waiting
      from public.workforce_requirements r
      where r.organization_id = p_org and r.status in ('open', 'paused') and r.moderation_state = 'visible'
      order by r.published_at desc nulls last, r.id
      limit 10
    ) x;

    select
      (count(distinct i.organization_id))::integer,
      (count(distinct i.organization_id) filter (where o.type = 'recruitment_company'))::integer,
      (count(distinct i.organization_id) filter (where o.type = 'staffing_company'))::integer,
      (count(*) filter (where i.status in ('invited', 'viewed')))::integer,
      (count(*) filter (where i.status = 'accepted'))::integer,
      (count(*) filter (where i.status = 'responded'))::integer,
      (count(*) filter (where i.status = 'declined'))::integer
    into v_invited, v_invited_recruitment, v_invited_staffing, v_waiting, v_accepted, v_responded, v_declined
    from public.requirement_invitations i
    join public.workforce_requirements r on r.id = i.requirement_id
    join public.organizations o on o.id = i.organization_id
    where r.organization_id = p_org and r.status in ('open', 'paused') and r.moderation_state = 'visible'
      and i.status not in ('withdrawn', 'expired');

    select
      (count(*) filter (where p.status in ('submitted', 'updated') and r.status in ('open', 'paused')))::integer,
      (count(*) filter (where p.status = 'updated' and p.employer_seen_version < p.version and r.status in ('open', 'paused')))::integer,
      (count(*) filter (where p.status = 'shortlisted' and r.status in ('open', 'paused')))::integer,
      (count(distinct p.organization_id) filter (where p.status = 'selected'))::integer
    into v_responses_waiting, v_responses_updated, v_shortlisted, v_selected
    from public.partner_responses p
    join public.workforce_requirements r on r.id = p.requirement_id
    where r.organization_id = p_org and r.status in ('open', 'paused', 'filled') and r.moderation_state = 'visible'
      and p.moderation_state = 'visible';
  end if;

  if v_submissions then
    select jsonb_object_agg(st.status, coalesce(n.total, 0) order by st.ord) into v_stages
    from unnest(array['submitted', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']::public.submission_status[])
      with ordinality as st (status, ord)
    left join (
      select s.status, count(*)::integer as total
      from public.candidate_submissions s
      where s.employer_organization_id = p_org and s.worker_approved_at is not null and s.moderation_state = 'visible'
      group by s.status
    ) n on n.status = st.status;
  end if;

  if private.release_on('release_messaging') then
    select
      (count(*) filter (where c.status = 'sent' and (c.kind = 'inquiry' or exists (
        select 1 from public.workforce_requirements r
        where r.id = c.requirement_id and r.status in ('draft', 'open', 'paused')))))::integer,
      (count(*) filter (where c.status in ('answered', 'accepted')))::integer
    into v_requests_waiting, v_requests_answered
    from public.connections c
    where c.from_organization_id = p_org and c.kind in ('inquiry', 'request_workforce');
  end if;

  return query
  select v_saved, v_followed, v_open, v_paused, v_draft, v_requirements, v_invited, v_invited_recruitment, v_invited_staffing,
    v_waiting, v_accepted, v_responded, v_declined, v_responses_waiting, v_responses_updated, v_shortlisted, v_selected,
    v_stages, v_requests_waiting, v_requests_answered, m.matching_workers, m.suppressed, m.fewer_than, m.reason
  from private.dashboard_matching_workers(p_org) m;
end;
$$;


comment on function public.get_employer_network_dashboard(uuid) is
  'The partner network figures of an employer dashboard (FR-R5) for its members: saved partners and followed companies; with release 2b the requirements by state with the open and paused ones listed (own titles, response, selected, waiting and Updated counts), partners invited and their answers, responses waiting for a decision, selected partners, and approved submissions by pipeline stage; with release 2c the inquiries and workforce requests waiting or answered and the matching Find Workers cards (suppressed, or the reason there is no count); null while off. No partner, candidate or worker is named.';

revoke all on function public.get_employer_network_dashboard(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_employer_network_dashboard(uuid) to authenticated;

-- The worker's contact requests -------------------------------------------------------------------------------------------------

create function public.my_contact_request_counts() returns table (pending integer, received integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.contact_request_caller();
begin
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.account_kind = 'worker') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required', errcode = '42501';
  end if;
  return query
  select
    (count(*) filter (where private.contact_request_status_now(r.status, r.expires_at) = 'pending'))::integer,
    count(*)::integer
  from public.contact_requests r
  where r.worker_user_id = v_uid;
end;
$$;

comment on function public.my_contact_request_counts() is
  'The calling worker''s contact requests for the Find Workers card of the dashboard (FR-Q1 AC10): waiting for an answer, and received in all. Counts only.';

revoke all on function public.my_contact_request_counts() from public, anon, authenticated, service_role;
grant execute on function public.my_contact_request_counts() to authenticated;
