-- Find recruitment partners (FR-L1, SOP P2-10; docs/phase-2/DATA_MODEL.md sections 2, 6, 7 Discovery and 10; decisions
-- 1.1, 2.2, 2.5, 2.6; NFR-C8, NFR-P3, NFR-S8). search_partners is the one search of the directory of listed recruitment
-- companies, for everyone. It returns the partners that are public on their profile page (private.is_listed_partner and a
-- visible profile, as get_partner_profile) and nothing else: no legal name, identifier, licence, review state, plan,
-- member or stale listing.
--
-- Filters: destination (a served market) and occupation narrow the results; based-in country, source countries,
-- industry, language, recruitment type and the capacity and timeframe of a fresh availability listing only rank them and
-- are named on the card as matched_filters. The order is the number of matched filters, then the time the profile last
-- changed (the listing time before any change), then the id; nothing in a sort key, a column or a tie-break reads
-- billing.* (decision 1.1: paying never raises a partner, NFR-C8). Advanced filters (capacity, timeframe, several source
-- countries) need the feature advanced_partner_search of an organisation of the caller (private.has_feature, so they are
-- open to every organisation while entitlements_enforced is false); a visitor or a candidate has no plan and never gets
-- them.
--
-- Scrapers (the risk of the SOP): an anonymous search is counted per visitor by rate_limit_attempt (action
-- partner_search, 60 per 60 seconds, settings rate_limit_partner_search_max and _seconds) with the visitor proof of the
-- web tier; a signed-in search is counted per user by private.check_rate_limit with the same settings.
--
-- The search log (KPIs: searches with at least one result, zero-result searches by destination) is
-- stats.partner_searches: kind, the names of the filters used, the destination when it is a known country, the number of
-- results on the first page and the time. No user, organisation, address, session or free text. Read by staff through
-- admin_partner_search_stats. Everything answers only while release_partner_directories is true.

insert into private.settings (key, value) values
  ('rate_limit_partner_search_max', '60'),
  ('rate_limit_partner_search_seconds', '60')
on conflict (key) do nothing;

-- rate_limit_attempt of 20261129100000 with the action 'partner_search' on the list of the actions the web tier may
-- count.
create or replace function public.rate_limit_attempt(p_action text, p_key text, p_proof text default null)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_max');
  v_seconds integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_seconds');
  v_buckets integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_buckets');
  v_keys_max integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_visitor_keys_max');
  v_proof_key text := (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'rate_limit_proof_key');
  v_minute bigint := floor(extract(epoch from now()) / 60)::bigint;
  v_counter integer;
  v_own boolean := true;
  v_new_visitors integer;
  v_hits integer;
  v_expires timestamptz;
begin
  if p_action is null or p_action not in ('signup', 'resend', 'login', 'forgot_password', 'reset_password', 'mfa_code', 'report',
                         'partner_profile', 'partner_search')
     or v_max is null or v_seconds is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_action';
  end if;
  if v_buckets is null or v_buckets < 1 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'rate_limit_buckets';
  end if;
  if v_keys_max is null or v_keys_max < 1 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'rate_limit_visitor_keys_max';
  end if;
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_key';
  end if;
  if v_proof_key is not null and not exists (
    select 1 from generate_series(v_minute - 1, v_minute + 1) m
    where encode(extensions.hmac(p_action || '|' || p_key || '|' || m, v_proof_key, 'sha256'), 'hex') = p_proof
  ) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501', detail = 'p_proof';
  end if;

  v_counter := (('x' || left(p_key, 8))::bit(32)::bigint & 2147483647)::integer;
  if not exists (select 1 from private.rate_limit_hits h where h.action = p_action and h.bucket = v_counter) then
    select h.hits into v_new_visitors
    from private.rate_limit_hits h
    where h.action = 'keys:' || p_action and h.bucket = 0 and h.expires_at > now();
    v_own := coalesce(v_new_visitors, 0) < v_keys_max;
    if v_own then
      perform private.rate_limit_hit('keys:' || p_action, 0, v_keys_max, v_seconds);
    end if;
  end if;

  if v_own then
    select r.hit_count, r.window_end into v_hits, v_expires
    from private.rate_limit_hit(p_action, v_counter, v_max, v_seconds) r;
  else
    select r.hit_count, r.window_end into v_hits, v_expires
    from private.rate_limit_hit('shared:' || p_action, (('x' || left(p_key, 8))::bit(32)::bigint % v_buckets)::integer, v_max, v_seconds) r;
  end if;

  allowed := v_hits <= v_max;
  retry_after_seconds := case when allowed then 0 else greatest(1, ceil(extract(epoch from v_expires - now()))::integer) end;
  return next;
end;
$$;

-- The deployment check of 20261129100000 with the throttle settings of partner_search among the required settings.
create or replace function private.missing_reference_data()
returns table (kind text, name text)
language sql
stable
set search_path = ''
as $$
  select 'legal_document', d.slug
  from unnest(array[
    'terms-of-service', 'privacy-policy', 'cookie-policy', 'platform-rules', 'acceptable-use-policy',
    'subscription-and-billing-terms', 'employer-terms', 'worker-terms', 'complaints-and-dispute-process',
    'account-suspension-and-termination-rules', 'sharing-notice', 'age-18-plus',
    'partner-terms', 'recruitment-company-terms', 'staffing-company-terms', 'employer-pays-commitment', 'partner-dpa',
    'worker-visibility-consent', 'immigration-disclaimer'
  ]) as d (slug)
  where private.current_legal_version(d.slug) is null
  union all
  select 'reference_table', t.name
  from (values
    ('public.countries', not exists (select 1 from public.countries)),
    ('public.languages', not exists (select 1 from public.languages)),
    ('public.currencies', not exists (select 1 from public.currencies)),
    ('public.industries', not exists (select 1 from public.industries)),
    ('public.occupations', not exists (select 1 from public.occupations)),
    ('public.cities', not exists (select 1 from public.cities)),
    ('billing.plans', not exists (select 1 from billing.plans))
  ) as t (name, empty)
  where t.empty
  union all
  select 'setting', k.key
  from (
    select m[1] as key
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral regexp_matches(p.prosrc, '\mkey\s*=\s*''([a-z0-9_]*[a-z0-9])''', 'g') as m
    where n.nspname in ('public', 'private', 'billing', 'audit', 'stats')
    union
    select (regexp_match(encode(t.tgargs, 'escape'), '^([a-z0-9_]+)\\000'))[1]
    from pg_catalog.pg_trigger t
    where t.tgfoid = 'private.worker_list_limit()'::regprocedure
    union
    select 'rate_limit_' || a || s
    from unnest(array['signup', 'resend', 'login', 'forgot_password', 'reset_password', 'mfa_code', 'report', 'partner_profile',
                      'partner_search', 'document_access']) as a
    cross join unnest(array['_max', '_seconds']) as s
  ) as k
  where not exists (select 1 from private.settings st where st.key = k.key)
  union all
  select 'vault_secret', 'rate_limit_proof_key'
  where not exists (select 1 from vault.secrets v where v.name = 'rate_limit_proof_key')
  order by 1, 2
$$;

-- The search log ---------------------------------------------------------------------------------------------------------

create table stats.partner_searches (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('recruitment', 'staffing')),
  filter_names text[] not null check (
    filter_names <@ array['destination', 'occupation', 'based_in', 'sources_from', 'industry', 'language', 'recruitment_type',
                          'capacity', 'timeframe']
  ),
  destination_country text references public.countries (code),
  result_count integer not null check (result_count between 0 and 50),
  created_at timestamptz not null default now()
);

comment on table stats.partner_searches is
  'One row per first page of a Find Partners search (FR-L1 KPIs: share of searches with at least one result, zero-result searches by destination). Holds no user, organisation, address, session or free text. result_count is the number of results on the first page (at most the page size), so it tells zero from some. Written by search_partners, read through admin_partner_search_stats, kept for partner_searches days.';

create index partner_searches_created_at_idx on stats.partner_searches (created_at);

alter table stats.partner_searches enable row level security;
alter table stats.partner_searches force row level security;
revoke all on table stats.partner_searches from public, anon, authenticated, service_role;

-- The search -------------------------------------------------------------------------------------------------------------

-- The directory of recruitment companies (FR-L1 AC1 to AC6, AC11, AC12). p_kind is 'recruitment' (the staffing directory
-- arrives with V22). Codes are checked for their shape only: an unknown country or occupation answers 0 rows. An anonymous
-- caller passes the visitor key and proof of the web tier; over the limit the call raises CHARA_RATE_LIMITED with the
-- seconds to wait as detail (none for a signed-in caller). Pages of 20 by default, at most 50, with an opaque cursor over
-- (matched filter count, profile time, id) on the last row of a page that has a next one. Only the first page of a search
-- is logged, so paging does not count as searching again.
create function public.search_partners(
  p_kind text,
  p_destination text default null,
  p_occupation text default null,
  p_based_in text default null,
  p_sources_from text[] default null,
  p_industry text default null,
  p_language text default null,
  p_recruitment_type public.recruitment_preference default null,
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
  based_in_country text,
  served_countries jsonb,
  main_occupations jsonb,
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
  v_sources text[];
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

  if p_kind is distinct from 'recruitment' then
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
      o.id, o.slug, o.display_name, o.based_in_country,
      coalesce(o.workforce_profile_updated_at, o.listed_at) as updated_at,
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
    where o.type = 'recruitment_company'
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
    (select max(a.confirmed_at) from public.workforce_availability a
     where a.organization_id = r.id and a.confirmed_at > v_fresh_since),
    r.updated_at,
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
  text, text, text, text, text[], text, text, public.recruitment_preference, integer, integer, text, integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.search_partners(
  text, text, text, text, text[], text, text, public.recruitment_preference, integer, integer, text, integer, text, text
) to anon, authenticated;

-- The search statistics ----------------------------------------------------------------------------------------------------

-- The searches of one directory from the start of the first day to the end of the last day (UTC), at most 366 days, for
-- a Platform Administrator (FR-L1 KPIs): how many, how many had at least one result, how many had none, and the ten
-- destinations with the most zero-result searches. The counts describe searches, never a person or a partner, so no
-- small-count suppression applies; partners never see them.
create function public.admin_partner_search_stats(p_kind text, p_from date, p_to date)
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
  if p_kind is null or p_kind not in ('recruitment', 'staffing') then
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
