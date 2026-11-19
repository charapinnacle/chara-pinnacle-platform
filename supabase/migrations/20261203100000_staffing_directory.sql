-- Find staffing partners (FR-L2, SOP P2-11; docs/phase-2/DATA_MODEL.md sections 2, 6, 7 Discovery and 10; decisions 1.1,
-- 2.2, 2.4; NFR-C8, NFR-P3, NFR-S8). search_partners of 20261202100000 answers p_kind 'staffing' too: the directory of
-- listed staffing companies and of listed recruitment companies that offer the service type staffing [d2.4], marked as
-- such (also_offers_staffing). Everything else of the recruitment directory applies unchanged: the same listed and visible
-- predicate, the same rate limit, the same advanced filters behind advanced_partner_search, the same order (matched
-- filters, then the profile time, then the id; nothing reads billing.*, decision 1.1) and the same search log.
--
-- Two ranking filters are added for both directories: staffing types (temporary, contract, project, permanent; matched
-- when the partner offers one of them) and the workforce size band. Four columns are added to the result, all of them
-- public on the partner's profile already: the organisation type, whether a recruitment company also offers staffing, its
-- staffing types, and its available workforce per occupation from fresh listings (the five occupations with the most
-- workers, each with the sum of workers available and the latest confirmation). The parameters and the result change,
-- so the function is dropped and created again.

alter table stats.partner_searches drop constraint partner_searches_filter_names_check;
alter table stats.partner_searches add constraint partner_searches_filter_names_check check (
  filter_names <@ array['destination', 'occupation', 'based_in', 'sources_from', 'industry', 'language', 'recruitment_type',
                        'staffing_type', 'workforce_size', 'capacity', 'timeframe']
);

drop function public.search_partners(
  text, text, text, text, text[], text, text, public.recruitment_preference, integer, integer, text, integer, text, text
);

-- The directory of recruitment companies (FR-L1 AC1 to AC6, AC11, AC12) and of staffing partners (FR-L2 AC1 to AC3, AC5,
-- AC7, AC11). Codes are checked for their shape only: an unknown country or occupation answers 0 rows. An anonymous
-- caller passes the visitor key and proof of the web tier; over the limit the call raises CHARA_RATE_LIMITED with the
-- seconds to wait as detail (none for a signed-in caller). Pages of 20 by default, at most 50, with an opaque cursor over
-- (matched filter count, profile time, id) on the last row of a page that has a next one. profile_updated_at is the time
-- the profile last changed, null before any change; the sort and the cursor use the listing time in its place. Only the
-- first page of a search is logged, so paging does not count as searching again.
create function public.search_partners(
  p_kind text,
  p_destination text default null,
  p_occupation text default null,
  p_based_in text default null,
  p_sources_from text[] default null,
  p_industry text default null,
  p_language text default null,
  p_recruitment_type public.recruitment_preference default null,
  p_staffing_types text[] default null,
  p_workforce_size text default null,
  p_capacity integer default null,
  p_within_days integer default null,
  p_cursor text default null,
  p_limit integer default null,
  p_key text default null,
  p_proof text default null
) returns table (
  id uuid,
  slug text,
  display_name text,
  organization_type public.organization_type,
  also_offers_staffing boolean,
  based_in_country text,
  served_countries jsonb,
  main_occupations jsonb,
  staffing_types public.partner_service_type[],
  available_workforce jsonb,
  capacity_confirmed_at timestamptz,
  profile_updated_at timestamptz,
  matched_filters text[],
  next_cursor text
)
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
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
    if v_uid is null or not exists (
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
    -- The five occupations with the most workers in fresh listings, then by name.
    (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.label) order by t.workers desc, t.label, t.code), '[]'::jsonb)
     from (
       select oc.code, oc.label, coalesce(sum(a.available), 0) as workers
       from public.organization_occupations oo
       join public.occupations oc on oc.code = oo.occupation_id
       left join public.workforce_availability a
         on a.organization_id = oo.organization_id and a.occupation_id = oo.occupation_id and a.confirmed_at > v_fresh_since
       where oo.organization_id = r.id
       group by oc.code, oc.label
       order by workers desc, oc.label, oc.code
       limit 5
     ) t),
    (select coalesce(array_agg(st.service order by st.service), '{}')
     from public.organization_service_types st
     where st.organization_id = r.id and st.service <> 'staffing'),
    -- The workers of fresh listings per occupation (summed over the source countries), the five largest first.
    (select coalesce(jsonb_agg(jsonb_build_object('code', w.code, 'name', w.label, 'available', w.available,
       'confirmed_at', w.confirmed_at) order by w.available desc, w.label, w.code), '[]'::jsonb)
     from (
       select oc.code, oc.label, sum(a.available) as available, max(a.confirmed_at) as confirmed_at
       from public.workforce_availability a
       join public.occupations oc on oc.code = a.occupation_id
       where a.organization_id = r.id and a.confirmed_at > v_fresh_since
       group by oc.code, oc.label
       order by available desc, oc.label, oc.code
       limit 5
     ) w),
    (select max(a.confirmed_at) from public.workforce_availability a
     where a.organization_id = r.id and a.confirmed_at > v_fresh_since),
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

revoke all on function public.search_partners(
  text, text, text, text, text[], text, text, public.recruitment_preference, text[], text, integer, integer, text, integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.search_partners(
  text, text, text, text, text[], text, text, public.recruitment_preference, text[], text, integer, integer, text, integer, text, text
) to anon, authenticated;
