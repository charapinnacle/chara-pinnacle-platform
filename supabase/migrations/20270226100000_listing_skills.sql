-- The skills of a staffing company's available workforce (research of November 2026): per listing, a language and its
-- CEFR level (usually the destination's), the minimum years of experience and a short line of certificates and tests,
-- for example "ISO 9606-1 welders, 3G and 6G, trade-tested". All optional, set by set_listing_skills beside the numbers
-- the existing functions keep, and shown with the listing on the partner profile and in the available workforce search.
alter table public.workforce_availability
  add column language_code text references public.languages (code),
  add column language_level text check (language_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  add column min_experience_years smallint check (min_experience_years between 0 and 50),
  add column certificates text check (char_length(certificates) between 1 and 300 and certificates !~ '[[:cntrl:]]'),
  add constraint workforce_availability_level_needs_language check (language_level is null or language_code is not null);

create index workforce_availability_language_idx on public.workforce_availability (language_code)
  where language_code is not null;

-- Sets the skills of a listing of the caller's organisation, with the checks of update_workforce_availability (release
-- 2a, an owner or admin at aal2 of a partner). Empty values clear a skill.
create function public.set_listing_skills(
  p_listing uuid,
  p_language_code text default null,
  p_language_level text default null,
  p_min_experience_years integer default null,
  p_certificates text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select w.organization_id into v_org from public.workforce_availability w where w.id = p_listing;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.assert_listing_manager(v_org);
  begin
    update public.workforce_availability
    set language_code = nullif(lower(btrim(p_language_code)), ''),
        language_level = nullif(upper(btrim(p_language_level)), ''),
        min_experience_years = p_min_experience_years,
        certificates = nullif(btrim(p_certificates), '')
    where id = p_listing;
  exception
    when check_violation or foreign_key_violation then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'listing_skills';
  end;
  update public.organizations set workforce_profile_updated_at = now() where id = v_org;
end;
$$;
revoke all on function public.set_listing_skills(uuid, text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.set_listing_skills(uuid, text, text, integer, text) to authenticated;

-- private.partner_profile of 20261129100000 with the skills of each fresh listing.
create or replace function private.partner_profile(p_org uuid) returns table (
  slug text,
  display_name text,
  organization_type public.organization_type,
  based_in_country text,
  based_in_country_name text,
  served_countries jsonb,
  source_countries jsonb,
  industries jsonb,
  occupations jsonb,
  languages jsonb,
  service_types public.partner_service_type[],
  recruitment_type public.recruitment_preference,
  workforce_size_band public.workforce_size_band,
  founded_year smallint,
  description text,
  website text,
  commitment_current boolean,
  profile_updated_at timestamptz,
  listings jsonb
)
language sql
stable
set search_path = ''
as $$
  select
    o.slug,
    o.display_name,
    o.type,
    o.based_in_country,
    bc.name,
    (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name) order by c.name, c.code), '[]'::jsonb)
     from public.organization_geographies g
     join public.countries c on c.code = g.country_code
     where g.organization_id = o.id and g.scope = 'serves_market'),
    (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name) order by c.name, c.code), '[]'::jsonb)
     from public.organization_geographies g
     join public.countries c on c.code = g.country_code
     where g.organization_id = o.id and g.scope = 'sources_from'),
    (select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'name', i.name) order by i.name, i.code), '[]'::jsonb)
     from public.organization_industries oi
     join public.industries i on i.code = oi.industry_code
     where oi.organization_id = o.id),
    (select coalesce(jsonb_agg(jsonb_build_object('code', oc.code, 'name', oc.label) order by oc.label, oc.code), '[]'::jsonb)
     from public.organization_occupations oo
     join public.occupations oc on oc.code = oo.occupation_id
     where oo.organization_id = o.id),
    (select coalesce(jsonb_agg(jsonb_build_object('code', l.code, 'name', l.name) order by l.name, l.code), '[]'::jsonb)
     from public.organization_languages ol
     join public.languages l on l.code = ol.language_code
     where ol.organization_id = o.id),
    (select coalesce(array_agg(s.service order by s.service), '{}')
     from public.organization_service_types s
     where s.organization_id = o.id),
    o.recruitment_type,
    o.workforce_size_band,
    o.founded_year,
    o.description,
    o.website,
    private.partner_commitment_current(o.id),
    o.workforce_profile_updated_at,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'occupation_code', a.occupation_id, 'occupation', oc.label, 'source_country', a.source_country,
        'source_country_name', c.name, 'available', a.available, 'monthly_capacity', a.monthly_capacity,
        'available_from', a.available_from, 'confirmed_at', a.confirmed_at,
        'language_code', a.language_code, 'language', lg.name, 'language_level', a.language_level,
        'min_experience_years', a.min_experience_years, 'certificates', a.certificates
      ) order by oc.label, c.name, a.id), '[]'::jsonb)
     from public.workforce_availability a
     join public.occupations oc on oc.code = a.occupation_id
     join public.countries c on c.code = a.source_country
     left join public.languages lg on lg.code = a.language_code
     where a.organization_id = o.id and a.confirmed_at > private.workforce_fresh_since())
  from public.organizations o
  join public.countries bc on bc.code = o.based_in_country
  where o.id = p_org
$$;

-- search_available_workforce of 20270223100000 with the skills of each listing.
create or replace function public.search_available_workforce(p_destination text, p_occupation text, p_workers_needed integer, p_within_days integer, p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer)
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
      a.language_code,
      a.language_level,
      a.min_experience_years,
      a.certificates,
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
        'monthly_capacity', private.workforce_band(c.monthly_capacity), 'available_from', c.available_from, 'confirmed_at', c.confirmed_at,
        'language', lg.name, 'language_level', c.language_level, 'min_experience_years', c.min_experience_years,
        'certificates', c.certificates
      ) order by co.name, c.source_country)
     from counted c
     join public.countries co on co.code = c.source_country
     left join public.languages lg on lg.code = c.language_code
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
