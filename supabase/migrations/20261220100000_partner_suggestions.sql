-- Partner suggestions for a workforce requirement (FR-M3, SOP P2-17; decisions 1.1, 3.6; NFR-C8, NFR-P3, NFR-S8, NFR-S11,
-- NFR-O5; docs/phase-2/DATA_MODEL.md sections 6 and 7; release 2b). suggest_partners lists, for one requirement of the
-- caller's employer, the listed partners of the types its partner need asks for that serve one of its destinations and
-- list one of its occupations, each with the ranking criteria it meets and does not meet and the facts behind them. It is
-- rule-based, not a match score (decision 1.1): the order is the number of criteria met, then the time the profile last
-- changed (the listing time before any change), then the id, as in Find Partners; nothing in a sort key, a column or a
-- tie-break reads billing.* (NFR-C8), and no column names a score, a rank, a plan or a verification. Two criteria use
-- availability listings, which a partner adds only within the workforce_listings allowance of its plan
-- (billing.plan_limits); the pages disclose that (P2B Regulation article 5(3)) instead of claiming plans play no part.
--
-- A suggestion is not an invitation: the call writes nothing a partner can read (no notification, no profile view, no
-- audit row), so no partner learns of a requirement by being suggested (invitations are V41 and V42). What it writes is
-- one row per open requirement in stats.requirement_suggestions with the number of suggestions shown (SOP KPI
-- "requirements with at least three suggestions").
--
-- The list size is the setting partner_suggestions_max (50, editable in the settings editor); the freshness of a listing
-- is workforce_listing_stale_days, as everywhere else. Calls are counted per user with the partner search allowance
-- (private.check_rate_limit 'partner_search', settings rate_limit_partner_search_max and _seconds), since the
-- suggestions are a search of the same partners. Everything refuses to run while release_job_orders or
-- release_partner_directories is false: suggested partners are shown with their public profile, which exists only in
-- release 2a.

insert into private.settings (key, value) values ('partner_suggestions_max', '50')
on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('partner_suggestions_max', 'integer', 10, 100, 'Partners suggested for one workforce requirement at most', null);

-- The KPI record ----------------------------------------------------------------------------------------------------------

-- One row per requirement whose suggestions were shown while it was open. Holds no person, no partner and no criteria; the
-- requirement's own retention (closed requirements, V58) removes it with the requirement.
create table stats.requirement_suggestions (
  requirement_id uuid primary key references public.workforce_requirements (id) on delete cascade,
  suggested_count integer not null check (suggested_count >= 0),
  max_suggested_count integer not null check (max_suggested_count >= suggested_count),
  first_shown_at timestamptz not null default now(),
  last_shown_at timestamptz not null default now()
);

comment on table stats.requirement_suggestions is
  'FR-M3 KPI "requirements with at least three suggestions": the number of partners suggest_partners showed for an open requirement the last time and at most (capped at partner_suggestions_max), with the first and last time. No user, partner or criteria. Written by suggest_partners only; no API role reads it; removed with the requirement.';

alter table stats.requirement_suggestions enable row level security;
alter table stats.requirement_suggestions force row level security;
revoke all on table stats.requirement_suggestions from public, anon, authenticated, service_role;

-- The suggestions ---------------------------------------------------------------------------------------------------------

-- The suggestions for the requirement p_requirement of p_org (FR-M3 AC1 to AC6, AC11), for any accepted member of the
-- active employer p_org while releases 2a and 2b are on. Refusals: a caller who is not a member of p_org, CHARA_FORBIDDEN
-- (42501); a release off, CHARA_FORBIDDEN release_off; over the partner search allowance, CHARA_RATE_LIMITED; a partner
-- organisation, CHARA_FORBIDDEN employer_only; a suspended employer, CHARA_FORBIDDEN organization_suspended; no such
-- requirement of p_org, CHARA_NOT_FOUND; a closed or filled requirement, CHARA_INVALID_STATE and its status; partner need
-- none, CHARA_INVALID_STATE partners_not_needed. A draft answers as a preview, a paused requirement as an open one.
--
-- Selected: listed, active, visible partners (as search_partners) of the types of the partner need (recruitment:
-- recruitment companies; staffing: staffing companies and recruitment companies with the service type staffing; both:
-- all of these, once each) serving one of the requirement's destinations and listing one of its occupations.
-- Criteria (each counts once): industry (the partner lists the requirement's industry), recruitment_type (the partner's
-- type equals the requirement's preference, or either is both), capacity (for every occupation of the requirement, the
-- partner's fresh listings of it, summed over its source countries, hold at least the quantity) and
-- available_before_start (for every occupation, the fresh listings available on or before the start date hold at least
-- the quantity). matching_occupations names, per requested occupation the partner lists, the quantity and the facts of
-- its fresh listings (workers summed, the latest available_from and confirmed_at among them; null without one).
-- profile_updated_at is the sort key: the last profile change, or the listing time before any change. At most
-- partner_suggestions_max rows; more_partners says that more partners were selected.
create function public.suggest_partners(p_org uuid, p_requirement uuid)
returns table (
  organization_id uuid,
  slug text,
  display_name text,
  organization_type public.organization_type,
  also_offers_staffing boolean,
  criteria_met text[],
  criteria_not_met text[],
  served_destinations jsonb,
  matching_occupations jsonb,
  profile_updated_at timestamptz,
  more_partners boolean
)
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.workforce_requirements;
  v_destinations text[];
  v_occupations text[];
  v_limit integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'partner_suggestions_max'), 50);
  v_fresh_since timestamptz := private.workforce_fresh_since();
  v_rows integer;
begin
  if v_uid is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_job_orders') or not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.check_rate_limit('partner_search', v_uid);
  if private.org_type(p_org) <> 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'employer_only', errcode = '42501';
  end if;
  if exists (select 1 from public.organizations o where o.id = p_org and o.status <> 'active') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended', errcode = '42501';
  end if;
  select * into v_row from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status in ('closed', 'filled') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_row.status::text;
  end if;
  if v_row.partner_need = 'none' then
    raise exception 'CHARA_INVALID_STATE' using detail = 'partners_not_needed';
  end if;
  -- The destinations and occupations as values, so that each call is planned for them and the lookups of the partners
  -- that serve and list them use the indexes of organization_geographies and organization_occupations (NFR-P3).
  v_destinations := array(select rc.country_code from public.requirement_countries rc where rc.requirement_id = v_row.id);
  v_occupations := array(select ro.occupation_id from public.requirement_occupations ro where ro.requirement_id = v_row.id);

  return query
  with occ as (
    select ro.occupation_id, ro.quantity, oc.label
    from public.requirement_occupations ro
    join public.occupations oc on oc.code = ro.occupation_id
    where ro.requirement_id = v_row.id
  ),
  selected as (
    select
      o.id, o.slug, o.display_name, o.type, o.recruitment_type,
      coalesce(o.workforce_profile_updated_at, o.listed_at) as updated_at,
      o.type = 'recruitment_company' and exists (
        select 1 from public.organization_service_types st where st.organization_id = o.id and st.service = 'staffing'
      ) as staffing_service
    from public.organizations o
    where o.type in ('recruitment_company', 'staffing_company')
      and o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active'
      and o.moderation_state = 'visible'
      and exists (
        select 1 from public.organization_geographies g
        where g.organization_id = o.id and g.scope = 'serves_market' and g.country_code = any (v_destinations)
      )
      and exists (
        select 1 from public.organization_occupations oo where oo.organization_id = o.id and oo.occupation_id = any (v_occupations)
      )
  ),
  typed as (
    select s.* from selected s
    where (v_row.partner_need in ('recruitment', 'both') and s.type = 'recruitment_company')
       or (v_row.partner_need in ('staffing', 'both') and (s.type = 'staffing_company' or s.staffing_service))
  ),
  judged as (
    select
      t.*, cov.facts,
      array_remove(array[
        case when exists (
          select 1 from public.organization_industries i where i.organization_id = t.id and i.industry_code = v_row.industry_code
        ) then 'industry' end,
        case when t.recruitment_type = 'both' or v_row.recruitment_preference = 'both'
          or t.recruitment_type = v_row.recruitment_preference then 'recruitment_type' end,
        case when cov.covered then 'capacity' end,
        case when cov.covered_by_start then 'available_before_start' end
      ], null) as met
    from typed t
    cross join lateral (
      select
        coalesce(jsonb_agg(jsonb_build_object('code', q.occupation_id, 'name', q.label, 'quantity', q.quantity,
            'available', f.available, 'available_from', f.available_from, 'confirmed_at', f.confirmed_at)
          order by q.quantity desc, q.label) filter (where f.listed), '[]'::jsonb) as facts,
        bool_and(coalesce(f.available, 0) >= q.quantity) as covered,
        bool_and(coalesce(f.available_by_start, 0) >= q.quantity) as covered_by_start
      from occ q
      cross join lateral (
        select
          exists (
            select 1 from public.organization_occupations oo where oo.organization_id = t.id and oo.occupation_id = q.occupation_id
          ) as listed,
          sum(a.available)::integer as available,
          (sum(a.available) filter (where a.available_from <= v_row.start_date))::integer as available_by_start,
          max(a.available_from) as available_from,
          max(a.confirmed_at) as confirmed_at
        from public.workforce_availability a
        where a.organization_id = t.id and a.occupation_id = q.occupation_id and a.confirmed_at > v_fresh_since
      ) f
    ) cov
  ),
  ranked as (
    select j.*, count(*) over () as total
    from judged j
    order by cardinality(j.met) desc, j.updated_at desc, j.id
    limit v_limit
  )
  select
    r.id,
    r.slug,
    r.display_name,
    r.type,
    r.staffing_service,
    r.met,
    array(
      select c.name from unnest(array['industry', 'recruitment_type', 'capacity', 'available_before_start'])
        with ordinality c (name, n)
      where c.name <> all (r.met) order by c.n
    ),
    (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name)
              order by c.code = v_row.country_code desc, c.name), '[]'::jsonb)
     from public.organization_geographies g
     join public.countries c on c.code = g.country_code
     where g.organization_id = r.id and g.scope = 'serves_market' and g.country_code = any (v_destinations)),
    r.facts,
    r.updated_at,
    r.total > v_limit
  from ranked r
  order by cardinality(r.met) desc, r.updated_at desc, r.id;

  get diagnostics v_rows = row_count;
  if v_row.status = 'open' then
    insert into stats.requirement_suggestions as s (requirement_id, suggested_count, max_suggested_count)
    values (v_row.id, v_rows, v_rows)
    on conflict (requirement_id) do update
      set suggested_count = excluded.suggested_count,
          max_suggested_count = greatest(s.max_suggested_count, excluded.suggested_count),
          last_shown_at = now();
  end if;
end;
$$;

revoke all on function public.suggest_partners(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.suggest_partners(uuid, uuid) to authenticated;
