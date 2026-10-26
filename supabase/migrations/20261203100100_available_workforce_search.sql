-- Search available workforce (FR-K3 step Search, FR-L2 AC4; SOP P2-07 and P2-11; docs/phase-2/DATA_MODEL.md sections 2,
-- 7 Discovery and 11 open point 1; decisions 1.1, 2.2; NFR-C8, NFR-S8). An employer asks who can supply a number of
-- workers of one occupation for one destination within a number of days ("100 welders for Germany within 60 days").
-- search_available_workforce answers with the listed, visible partners that serve the destination and whose fresh
-- availability listings of the occupation (confirmed within workforce_listing_stale_days) add up to the number in time.
--
-- Supply of one listing within N days: 0 when it is available later than today + N, otherwise the workers available plus
-- floor(monthly capacity x (today + N - max(today, available from)) / 30); a partner fits when the sum over its listings
-- of the occupation (all source countries) is at least the number (FR-K3 data and validation, DATA_MODEL section 11.1).
--
-- Order: the partners whose workers available now already cover the number first (relevance), then the most recently
-- confirmed (freshness), then the id. Nothing in a sort key, a column or a tie-break reads billing.* (decision 1.1).
-- Only an employer may search, signed in, through an employer organisation that is active and has the feature
-- available_workforce_search (every paid employer plan; open to every employer while entitlements_enforced is false). A
-- partner does not search other partners' capacity in Phase 2, a candidate never, a visitor is refused at the grant.
--
-- Each first page is logged in stats.partner_searches as kind available_workforce (KPI: available-workforce searches
-- with at least one result), with nothing personal; admin_partner_search_stats reads that kind too.

alter table stats.partner_searches drop constraint partner_searches_kind_check;
alter table stats.partner_searches add constraint partner_searches_kind_check
  check (kind in ('recruitment', 'staffing', 'available_workforce'));

comment on table stats.partner_searches is
  'One row per first page of a Find Partners search (FR-L1, FR-L2 KPIs: share of searches with at least one result, zero-result searches by destination) or of an available-workforce search (FR-K3 KPI: searches with at least one result). Holds no user, organisation, address, session or free text. result_count is the number of results on the first page (at most the page size), so it tells zero from some. Written by search_partners and search_available_workforce, read through admin_partner_search_stats, kept for partner_searches days.';

-- Pages of 20 by default, at most 50, with an opaque cursor over (covers now, latest confirmation, id) on the last row of a
-- page that has a next one. Every row carries the listings that count, each with its confirmation time.
create function public.search_available_workforce(
  p_destination text,
  p_occupation text,
  p_workers_needed integer,
  p_within_days integer,
  p_cursor text default null,
  p_limit integer default null
) returns table (
  id uuid,
  slug text,
  display_name text,
  organization_type public.organization_type,
  supply integer,
  available_now integer,
  listings jsonb,
  confirmed_at timestamptz,
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
    r.supply,
    r.available_now,
    (select jsonb_agg(jsonb_build_object(
        'source_country', c.source_country, 'source_country_name', co.name, 'available', c.available,
        'monthly_capacity', c.monthly_capacity, 'available_from', c.available_from, 'confirmed_at', c.confirmed_at
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

-- admin_partner_search_stats of 20261202100000 with the kind available_workforce among the kinds it reads.
create or replace function public.admin_partner_search_stats(p_kind text, p_from date, p_to date)
returns table (searches bigint, with_results bigint, zero_results bigint, zero_by_destination jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('recruitment', 'staffing', 'available_workforce') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_kind';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'range';
  end if;

  return query
  with period as (
    select s.destination_country, s.result_count
    from stats.partner_searches s
    where s.kind = p_kind
      and s.created_at >= p_from::timestamp at time zone 'UTC' and s.created_at < (p_to + 1)::timestamp at time zone 'UTC'
  )
  select
    count(*),
    count(*) filter (where p.result_count > 0),
    count(*) filter (where p.result_count = 0),
    (select coalesce(jsonb_agg(jsonb_build_object('code', z.code, 'name', z.name, 'searches', z.n) order by z.n desc, z.name), '[]'::jsonb)
     from (
       select c.code, c.name, count(*) as n
       from period q
       join public.countries c on c.code = q.destination_country
       where q.result_count = 0
       group by c.code, c.name
       order by n desc, c.name
       limit 10
     ) z)
  from period p;
end;
$$;

revoke all on function public.admin_partner_search_stats(text, date, date) from public, anon, authenticated, service_role;
grant execute on function public.admin_partner_search_stats(text, date, date) to authenticated;
