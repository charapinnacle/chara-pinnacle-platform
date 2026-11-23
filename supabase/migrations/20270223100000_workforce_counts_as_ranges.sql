-- Worker counts leave the database as ranges (1–9, 10–24, 25–49, 50–99, 100–249, 250+), not exact numbers: agencies
-- publish which trades they supply from which countries and roughly how many, and give exact numbers on request, in a
-- response to an employer's requirement. Availability changes daily, competitors read the directory too, and an exact
-- count invites a commitment the partner has not made. The search filters still compare the exact numbers; only what is
-- returned is a range. A member of the company reads its own exact listings on its profile, and staff keep the exact
-- numbers in the moderation view.

-- A count as a range; null stays null and zero stays 0.
create function private.workforce_band(p_count integer) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_count is null then null
    when p_count <= 0 then '0'
    when p_count < 10 then '1–9'
    when p_count < 25 then '10–24'
    when p_count < 50 then '25–49'
    when p_count < 100 then '50–99'
    when p_count < 250 then '100–249'
    else '250+'
  end
$$;
revoke all on function private.workforce_band(integer) from public, anon, authenticated, service_role;

-- The listings of a partner profile with their worker count and monthly capacity as ranges.
create function private.banded_listings(p_listings jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_listings is null then null else coalesce((
    select jsonb_agg(l.value || jsonb_build_object(
        'available', private.workforce_band((l.value ->> 'available')::integer),
        'monthly_capacity', private.workforce_band((l.value ->> 'monthly_capacity')::integer))
      order by l.n)
    from jsonb_array_elements(p_listings) with ordinality l (value, n)), '[]'::jsonb) end
$$;
revoke all on function private.banded_listings(jsonb) from public, anon, authenticated, service_role;

-- get_partner_profile of 20261214200000: a reader outside the company reads its listings as ranges.
create or replace function public.get_partner_profile(p_slug text, p_key text DEFAULT NULL::text, p_proof text DEFAULT NULL::text)
 RETURNS TABLE(slug text, display_name text, organization_type organization_type, based_in_country text, based_in_country_name text, served_countries jsonb, source_countries jsonb, industries jsonb, occupations jsonb, languages jsonb, service_types partner_service_type[], recruitment_type recruitment_preference, workforce_size_band workforce_size_band, founded_year smallint, description text, website text, commitment_current boolean, profile_updated_at timestamp with time zone, listings jsonb, viewer_is_member boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_allowed boolean;
  v_retry integer;
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is null then
    select a.allowed, a.retry_after_seconds into v_allowed, v_retry
    from public.rate_limit_attempt('partner_profile', p_key, p_proof) a;
    if not v_allowed then
      raise exception 'CHARA_RATE_LIMITED' using detail = v_retry::text;
    end if;
  else
    perform private.check_rate_limit('partner_profile', v_uid);
  end if;

  select o.id into v_org
  from public.organizations o
  where o.slug = p_slug and o.type <> 'employer' and o.moderation_state = 'visible' and private.is_listed_partner(o.id);
  if v_org is null then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_uid is not null then
    perform public.record_profile_view(v_org);
  end if;

  return query
  select p.slug, p.display_name, p.organization_type, p.based_in_country, p.based_in_country_name, p.served_countries,
    p.source_countries, p.industries, p.occupations, p.languages, p.service_types, p.recruitment_type,
    p.workforce_size_band, p.founded_year, p.description, p.website, p.commitment_current, p.profile_updated_at,
    case when v_uid is null then null when private.is_org_member(v_org) then p.listings else private.banded_listings(p.listings) end,
    v_uid is not null and private.is_org_member(v_org)
  from private.partner_profile(v_org) p;
end;
$$;

-- search_partners of 20261214200000: the workers per occupation on a staffing card as a range.
create or replace function public.search_partners(p_kind text, p_destination text DEFAULT NULL::text, p_occupation text DEFAULT NULL::text, p_based_in text DEFAULT NULL::text, p_sources_from text[] DEFAULT NULL::text[], p_industry text DEFAULT NULL::text, p_language text DEFAULT NULL::text, p_recruitment_type recruitment_preference DEFAULT NULL::recruitment_preference, p_staffing_types text[] DEFAULT NULL::text[], p_workforce_size text DEFAULT NULL::text, p_capacity integer DEFAULT NULL::integer, p_within_days integer DEFAULT NULL::integer, p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer, p_key text DEFAULT NULL::text, p_proof text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, slug text, display_name text, organization_type organization_type, also_offers_staffing boolean, based_in_country text, served_countries jsonb, main_occupations jsonb, staffing_types partner_service_type[], available_workforce jsonb, capacity_confirmed_at timestamp with time zone, profile_updated_at timestamp with time zone, matched_filters text[], next_cursor text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_destination text := upper(p_destination);
  v_based_in text := upper(p_based_in);
  v_industry text := upper(p_industry);
  v_language text := lower(p_language);
  v_size text := lower(p_workforce_size);
  v_sources text[];
  v_staffing_types public.partner_service_type[];
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_fresh_since timestamptz := private.workforce_fresh_since();
  v_available_by date := (now() at time zone 'utc')::date + p_within_days;
  v_listing_filter boolean := p_capacity is not null or p_within_days is not null;
  v_allowed boolean;
  v_retry integer;
  v_cursor_count integer;
  v_cursor_updated timestamptz;
  v_cursor_id uuid;
  v_rows integer;
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is null then
    select a.allowed, a.retry_after_seconds into v_allowed, v_retry
    from public.rate_limit_attempt('partner_search', p_key, p_proof) a;
    if not v_allowed then
      raise exception 'CHARA_RATE_LIMITED' using detail = v_retry::text;
    end if;
  else
    perform private.check_rate_limit('partner_search', v_uid);
  end if;

  if p_kind is null or p_kind not in ('recruitment', 'staffing') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_kind';
  end if;
  if v_destination !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_destination';
  end if;
  if p_occupation !~ '^[0-9]{4}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_occupation';
  end if;
  if v_based_in !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_based_in';
  end if;
  if v_industry !~ '^[A-Z]$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_industry';
  end if;
  if v_language !~ '^[a-z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_language';
  end if;
  if p_recruitment_type = 'both' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_recruitment_type';
  end if;
  -- The staffing types are the service types without staffing itself, which only marks a recruitment company.
  if cardinality(p_staffing_types) > 10
     or exists (
       select 1 from unnest(p_staffing_types) t (code)
       where t.code is null or lower(t.code) not in ('temporary', 'contract', 'project', 'permanent')
     ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_staffing_types';
  end if;
  if v_size not in ('1_49', '50_249', '250_999', '1000_plus') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_workforce_size';
  end if;
  if p_capacity not between 1 and 100000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_capacity';
  end if;
  if p_within_days not between 1 and 365 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_within_days';
  end if;
  if cardinality(p_sources_from) > 20
     or exists (select 1 from unnest(p_sources_from) s (code) where s.code is null or upper(s.code) !~ '^[A-Z]{2}$') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_sources_from';
  end if;
  select nullif(array_agg(c.code order by c.pos), '{}') into v_sources
  from (
    select upper(s.code) as code, min(s.pos) as pos
    from unnest(p_sources_from) with ordinality s (code, pos)
    group by upper(s.code)
  ) c;
  select nullif(array_agg(distinct lower(t.code)::public.partner_service_type), '{}') into v_staffing_types
  from unnest(p_staffing_types) t (code);

  if v_listing_filter or cardinality(v_sources) > 1 then
    if v_uid is null then
      raise exception 'CHARA_UNAUTHENTICATED' using detail = 'advanced_partner_search';
    end if;
    if not exists (
      select 1 from private.member_org_ids() m (organization_id) where private.has_feature(m.organization_id, 'advanced_partner_search')
    ) then
      raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'advanced_partner_search';
    end if;
  end if;

  if p_cursor is not null then
    begin
      if p_cursor !~ '^[0-9]{1,2}\|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f-]{36}$' then
        raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
      end if;
      v_cursor_count := split_part(p_cursor, '|', 1)::integer;
      v_cursor_updated := split_part(p_cursor, '|', 2)::timestamptz;
      v_cursor_id := split_part(p_cursor, '|', 3)::uuid;
    exception when others then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end;
  end if;

  return query
  with matches as (
    select
      o.id, o.slug, o.display_name, o.type, o.based_in_country,
      o.workforce_profile_updated_at,
      coalesce(o.workforce_profile_updated_at, o.listed_at) as updated_at,
      o.type = 'recruitment_company' and exists (
        select 1 from public.organization_service_types st where st.organization_id = o.id and st.service = 'staffing'
      ) as also_offers_staffing,
      array_remove(array[
        case when v_destination is not null then 'destination' end,
        case when p_occupation is not null then 'occupation' end,
        case when o.based_in_country = v_based_in then 'based_in' end,
        case when v_sources is not null and exists (
          select 1 from public.organization_geographies g
          where g.organization_id = o.id and g.scope = 'sources_from' and g.country_code = any (v_sources)
        ) then 'sources_from' end,
        case when v_industry is not null and exists (
          select 1 from public.organization_industries i where i.organization_id = o.id and i.industry_code = v_industry
        ) then 'industry' end,
        case when v_language is not null and exists (
          select 1 from public.organization_languages l where l.organization_id = o.id and l.language_code = v_language
        ) then 'language' end,
        case when p_recruitment_type is not null and o.recruitment_type in ('both', p_recruitment_type) then 'recruitment_type' end,
        case when v_staffing_types is not null and exists (
          select 1 from public.organization_service_types st where st.organization_id = o.id and st.service = any (v_staffing_types)
        ) then 'staffing_type' end,
        case when o.workforce_size_band::text = v_size then 'workforce_size' end,
        case when p_capacity is not null and listing.found then 'capacity' end,
        case when p_within_days is not null and listing.found then 'timeframe' end
      ], null) as matched
    from public.organizations o
    -- One fresh listing (of the occupation, when one is asked for) must meet every listing filter given at once.
    left join lateral (
      select true as found
      from public.workforce_availability a
      where v_listing_filter and a.organization_id = o.id and a.confirmed_at > v_fresh_since
        and (p_occupation is null or a.occupation_id = p_occupation)
        and (p_capacity is null or a.available >= p_capacity)
        and (p_within_days is null or a.available_from <= v_available_by)
      limit 1
    ) listing on true
    where (
        (p_kind = 'recruitment' and o.type = 'recruitment_company')
        or (p_kind = 'staffing' and (o.type = 'staffing_company' or (o.type = 'recruitment_company' and exists (
          select 1 from public.organization_service_types st where st.organization_id = o.id and st.service = 'staffing'
        ))))
      )
      and o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active'
      and o.moderation_state = 'visible'
      and (v_destination is null or exists (
        select 1 from public.organization_geographies g
        where g.organization_id = o.id and g.scope = 'serves_market' and g.country_code = v_destination
      ))
      and (p_occupation is null or exists (
        select 1 from public.organization_occupations oo where oo.organization_id = o.id and oo.occupation_id = p_occupation
      ))
  ),
  page as (
    select m.*, cardinality(m.matched) as matched_count
    from matches m
    where v_cursor_id is null
       or cardinality(m.matched) < v_cursor_count
       or (cardinality(m.matched) = v_cursor_count
           and (m.updated_at < v_cursor_updated or (m.updated_at = v_cursor_updated and m.id > v_cursor_id)))
    order by cardinality(m.matched) desc, m.updated_at desc, m.id
    limit v_limit + 1
  ),
  numbered as (
    select p.*, row_number() over (order by p.matched_count desc, p.updated_at desc, p.id) as n
    from page p
  )
  select
    r.id,
    r.slug,
    r.display_name,
    r.type,
    r.also_offers_staffing,
    r.based_in_country,
    (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name) order by c.name, c.code), '[]'::jsonb)
     from public.organization_geographies g
     join public.countries c on c.code = g.country_code
     where g.organization_id = r.id and g.scope = 'serves_market'),
    -- The five occupations with the most workers in fresh listings, then by name; by name only for a visitor.
    (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.label) order by t.workers desc, t.label, t.code), '[]'::jsonb)
     from (
       select oc.code, oc.label, coalesce(sum(a.available), 0) as workers
       from public.organization_occupations oo
       join public.occupations oc on oc.code = oo.occupation_id
       left join public.workforce_availability a
         on v_uid is not null and a.organization_id = oo.organization_id and a.occupation_id = oo.occupation_id
           and a.confirmed_at > v_fresh_since
       where oo.organization_id = r.id
       group by oc.code, oc.label
       order by workers desc, oc.label, oc.code
       limit 5
     ) t),
    (select coalesce(array_agg(st.service order by st.service), '{}')
     from public.organization_service_types st
     where st.organization_id = r.id and st.service <> 'staffing'),
    -- The workers of fresh listings per occupation (summed over the source countries), the five largest first.
    case when v_uid is not null then (select coalesce(jsonb_agg(jsonb_build_object('code', w.code, 'name', w.label,
       'available', private.workforce_band(w.available::integer), 'confirmed_at', w.confirmed_at) order by w.available desc, w.label, w.code), '[]'::jsonb)
     from (
       select oc.code, oc.label, sum(a.available) as available, max(a.confirmed_at) as confirmed_at
       from public.workforce_availability a
       join public.occupations oc on oc.code = a.occupation_id
       where a.organization_id = r.id and a.confirmed_at > v_fresh_since
       group by oc.code, oc.label
       order by available desc, oc.label, oc.code
       limit 5
     ) w) end,
    (select max(a.confirmed_at) from public.workforce_availability a
     where v_uid is not null and a.organization_id = r.id and a.confirmed_at > v_fresh_since),
    r.workforce_profile_updated_at,
    r.matched,
    case
      when r.n = v_limit and exists (select 1 from numbered x where x.n > v_limit)
        then r.matched_count || '|' || to_char(r.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || r.id
    end
  from numbered r
  where r.n <= v_limit
  order by r.n;

  if p_cursor is null then
    get diagnostics v_rows = row_count;
    insert into stats.partner_searches (kind, filter_names, destination_country, result_count)
    values (
      p_kind,
      array_remove(array[
        case when v_destination is not null then 'destination' end,
        case when p_occupation is not null then 'occupation' end,
        case when v_based_in is not null then 'based_in' end,
        case when v_sources is not null then 'sources_from' end,
        case when v_industry is not null then 'industry' end,
        case when v_language is not null then 'language' end,
        case when p_recruitment_type is not null then 'recruitment_type' end,
        case when v_staffing_types is not null then 'staffing_type' end,
        case when v_size is not null then 'workforce_size' end,
        case when p_capacity is not null then 'capacity' end,
        case when p_within_days is not null then 'timeframe' end
      ], null),
      (select c.code from public.countries c where c.code = v_destination),
      v_rows
    );
  end if;
end;
$$;

-- suggest_partners of 20261220100000: the workers a suggested partner lists per occupation as a range.
create or replace function public.suggest_partners(p_org uuid, p_requirement uuid)
 RETURNS TABLE(organization_id uuid, slug text, display_name text, organization_type organization_type, also_offers_staffing boolean, criteria_met text[], criteria_not_met text[], served_destinations jsonb, matching_occupations jsonb, profile_updated_at timestamp with time zone, more_partners boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
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
            'available', private.workforce_band(f.available), 'available_from', f.available_from, 'confirmed_at', f.confirmed_at)
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

-- search_available_workforce of 20261203100100: what a partner can supply, now and within the timeframe, as ranges. The
-- employer asked for a number of workers, and every partner returned can supply at least that many.
drop function public.search_available_workforce(text, text, integer, integer, text, integer);
create function public.search_available_workforce(p_destination text, p_occupation text, p_workers_needed integer, p_within_days integer, p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, slug text, display_name text, organization_type organization_type, supply text, available_now text, listings jsonb, confirmed_at timestamp with time zone, next_cursor text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_destination text := upper(p_destination);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_fresh_since timestamptz := private.workforce_fresh_since();
  v_today date := (now() at time zone 'utc')::date;
  v_by date;
  v_cursor_covers integer;
  v_cursor_confirmed timestamptz;
  v_cursor_id uuid;
  v_rows integer;
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is null then
    raise exception 'CHARA_UNAUTHENTICATED' using errcode = '42501';
  end if;
  perform private.check_rate_limit('partner_search', v_uid);

  if not exists (
    select 1 from private.member_org_ids() m (organization_id)
    join public.organizations o on o.id = m.organization_id
    where o.type = 'employer' and o.status = 'active'
  ) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (
    select 1 from private.member_org_ids() m (organization_id)
    join public.organizations o on o.id = m.organization_id
    where o.type = 'employer' and o.status = 'active' and private.has_feature(o.id, 'available_workforce_search')
  ) then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'available_workforce_search';
  end if;

  if v_destination is null or v_destination !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_destination';
  end if;
  if p_occupation is null or p_occupation !~ '^[0-9]{4}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_occupation';
  end if;
  if p_workers_needed is null or p_workers_needed not between 1 and 100000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_workers_needed';
  end if;
  if p_within_days is null or p_within_days not between 1 and 365 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_within_days';
  end if;
  v_by := v_today + p_within_days;

  if p_cursor is not null then
    begin
      if p_cursor !~ '^[01]\|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f-]{36}$' then
        raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
      end if;
      v_cursor_covers := split_part(p_cursor, '|', 1)::integer;
      v_cursor_confirmed := split_part(p_cursor, '|', 2)::timestamptz;
      v_cursor_id := split_part(p_cursor, '|', 3)::uuid;
    exception when others then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end;
  end if;

  return query
  with counted as (
    select
      a.organization_id,
      a.source_country,
      a.available,
      a.monthly_capacity,
      a.available_from,
      a.confirmed_at,
      a.available + floor(a.monthly_capacity * (v_by - greatest(v_today, a.available_from))::numeric / 30)::integer as supply
    from public.workforce_availability a
    join public.organizations o on o.id = a.organization_id
    where a.occupation_id = p_occupation
      and a.confirmed_at > v_fresh_since
      and a.available_from <= v_by
      and o.type <> 'employer'
      and o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active'
      and o.moderation_state = 'visible'
      and exists (
        select 1 from public.organization_geographies g
        where g.organization_id = o.id and g.scope = 'serves_market' and g.country_code = v_destination
      )
  ),
  fits as (
    select
      c.organization_id,
      sum(c.supply)::integer as supply,
      (coalesce(sum(c.available) filter (where c.available_from <= v_today), 0))::integer as available_now,
      max(c.confirmed_at) as confirmed_at
    from counted c
    group by c.organization_id
    having sum(c.supply) >= p_workers_needed
  ),
  ranked as (
    select f.*, (f.available_now >= p_workers_needed)::integer as covers
    from fits f
  ),
  page as (
    select r.*
    from ranked r
    where v_cursor_id is null
       or r.covers < v_cursor_covers
       or (r.covers = v_cursor_covers
           and (r.confirmed_at < v_cursor_confirmed or (r.confirmed_at = v_cursor_confirmed and r.organization_id > v_cursor_id)))
    order by r.covers desc, r.confirmed_at desc, r.organization_id
    limit v_limit + 1
  ),
  numbered as (
    select p.*, row_number() over (order by p.covers desc, p.confirmed_at desc, p.organization_id) as n
    from page p
  )
  select
    o.id,
    o.slug,
    o.display_name,
    o.type,
    private.workforce_band(r.supply),
    private.workforce_band(r.available_now),
    (select jsonb_agg(jsonb_build_object(
        'source_country', c.source_country, 'source_country_name', co.name, 'available', private.workforce_band(c.available),
        'monthly_capacity', private.workforce_band(c.monthly_capacity), 'available_from', c.available_from, 'confirmed_at', c.confirmed_at
      ) order by co.name, c.source_country)
     from counted c
     join public.countries co on co.code = c.source_country
     where c.organization_id = r.organization_id),
    r.confirmed_at,
    case
      when r.n = v_limit and exists (select 1 from numbered x where x.n > v_limit)
        then r.covers || '|' || to_char(r.confirmed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || r.organization_id
    end
  from numbered r
  join public.organizations o on o.id = r.organization_id
  where r.n <= v_limit
  order by r.n;

  if p_cursor is null then
    get diagnostics v_rows = row_count;
    insert into stats.partner_searches (kind, filter_names, destination_country, result_count)
    values (
      'available_workforce',
      array['destination', 'occupation', 'capacity', 'timeframe'],
      (select c.code from public.countries c where c.code = v_destination),
      v_rows
    );
  end if;
end;
$$;
revoke all on function public.search_available_workforce(text, text, integer, integer, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_available_workforce(text, text, integer, integer, text, integer) to authenticated;
