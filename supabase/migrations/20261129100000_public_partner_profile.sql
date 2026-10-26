-- Public partner profile (FR-K4; docs/phase-2/DATA_MODEL.md sections 2, 6, 7 Discovery and 10; decisions 1.1, 2.5, 2.6;
-- NFR-C8, NFR-P3, NFR-S8). Every listed recruitment or staffing company has a public profile at /[lang]/partners/[slug]:
-- the structured fields of its workforce profile and nothing else. get_partner_profile is the only public read of it. It
-- returns the fields of section 10 that may be public (display name, slug, type, based-in country, served and source
-- countries, industries, occupations, languages, the fresh availability listings with their confirmation time,
-- recruitment type, service types, size band, founded year, description, website, whether the employer-pays commitment
-- is current, and the time the profile last changed), never the legal name, the identifier, identifier links, licences,
-- the review state or decisions, the plan, member data, view counts, followers or stale listings. A partner that is not
-- listed (private.is_listed_partner), whose profile is hidden by moderation, an employer and an unknown slug all raise
-- the same CHARA_NOT_FOUND, and so does every slug while release_partner_directories is false. Nothing is ranked here.
--
-- Scrapers (the risk of the SOP): an anonymous read is counted per visitor by rate_limit_attempt (action
-- partner_profile, 120 per 60 seconds, settings rate_limit_partner_profile_max and _seconds) with the visitor proof of
-- the web tier, so a direct caller of the Data API without the proof is refused while the Vault secret is set; a
-- signed-in read is counted per user by private.check_rate_limit with the same settings. Profile views are counted by
-- V20 (record_profile_view); nothing is recorded here.

insert into private.settings (key, value) values
  ('rate_limit_partner_profile_max', '120'),
  ('rate_limit_partner_profile_seconds', '60')
on conflict (key) do nothing;

-- rate_limit_attempt of 20261110110000 with the action 'partner_profile' on the list of the actions the web tier may
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
                         'partner_profile')
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

-- The deployment check of 20261116100000 with the throttle settings of partner_profile among the required settings.
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
    from unnest(array['signup', 'resend', 'login', 'forgot_password', 'reset_password', 'mfa_code', 'report', 'partner_profile', 'document_access']) as a
    cross join unnest(array['_max', '_seconds']) as s
  ) as k
  where not exists (select 1 from private.settings st where st.key = k.key)
  union all
  select 'vault_secret', 'rate_limit_proof_key'
  where not exists (select 1 from vault.secrets v where v.name = 'rate_limit_proof_key')
  order by 1, 2
$$;

-- The sitemap reads the listed, visible partners by slug, and the profile and the sitemap ask for the time the profile
-- last changed: one partial index covers both. Its predicate is that of private.is_listed_partner and the moderation
-- state, so it holds only the partners that are public.
create index organizations_public_profile_slug_idx on public.organizations (slug)
  include (workforce_profile_updated_at, listed_at)
  where status = 'active' and listed_at is not null and review_status <> 'declined' and moderation_state = 'visible';

-- The profile of one partner as the public sees it: names come from the code lists in alphabetical order, listings
-- only when confirmed within workforce_listing_stale_days. Called by the two definer functions below only; it checks
-- nothing itself.
create function private.partner_profile(p_org uuid) returns table (
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
  workforce_profile_updated_at timestamptz,
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
        'available_from', a.available_from, 'confirmed_at', a.confirmed_at
      ) order by oc.label, c.name, a.id), '[]'::jsonb)
     from public.workforce_availability a
     join public.occupations oc on oc.code = a.occupation_id
     join public.countries c on c.code = a.source_country
     where a.organization_id = o.id and a.confirmed_at > private.workforce_fresh_since())
  from public.organizations o
  join public.countries bc on bc.code = o.based_in_country
  where o.id = p_org
$$;

revoke all on function private.partner_profile(uuid) from public, anon, authenticated, service_role;

-- The public profile of a listed partner by its slug, for everyone (FR-K4 AC1, AC3, AC6, AC9). An anonymous caller
-- passes the visitor key and proof of the web tier (lib/dal/rate-limit.ts); over the limit the call raises
-- CHARA_RATE_LIMITED with the seconds to wait as detail. viewer_is_member tells the page that the caller belongs to the
-- partner (Edit profile instead of Report company); it says nothing about anyone else.
create function public.get_partner_profile(p_slug text, p_key text default null, p_proof text default null)
returns table (
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
  workforce_profile_updated_at timestamptz,
  listings jsonb,
  viewer_is_member boolean
)
language plpgsql
security definer
set search_path = ''
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

  return query
  select p.*, v_uid is not null and private.is_org_member(v_org)
  from private.partner_profile(v_org) p;
end;
$$;

revoke all on function public.get_partner_profile(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.get_partner_profile(text, text, text) to anon, authenticated;

-- The same profile for a member of the partner, whether or not it is public (FR-K4 AC2: the preview of
-- org/[slug]/workforce-profile/preview). is_public says whether everyone sees it now.
create function public.preview_partner_profile(p_org uuid)
returns table (
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
  workforce_profile_updated_at timestamptz,
  listings jsonb,
  is_public boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org) or private.org_type(p_org) = 'employer' then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;

  return query
  select p.*, private.is_listed_partner(p_org)
    and (select o.moderation_state = 'visible' from public.organizations o where o.id = p_org)
  from private.partner_profile(p_org) p;
end;
$$;

revoke all on function public.preview_partner_profile(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_partner_profile(uuid) to authenticated;

-- The public partner profiles for the sitemap (FR-K4 AC7), by slug, as one JSON array of {slug, updated_at} (the time the
-- profile last changed, or the listing time before any change), read from the partial index above. Paged as
-- list_sitemap_jobs: at most 5000 per call, the next page after the slug of the last entry. Empty while
-- release_partner_directories is false, so no profile enters the sitemap before go-live.
create function public.list_sitemap_partners(p_after_slug text default null, p_limit integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5000), 1), 5000);
begin
  if not private.release_on('release_partner_directories') then
    return '[]'::jsonb;
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object('slug', r.slug, 'updated_at', r.updated_at) order by r.slug)
     from (
       select o.slug, coalesce(o.workforce_profile_updated_at, o.listed_at) as updated_at
       from public.organizations o
       where o.status = 'active' and o.listed_at is not null and o.review_status <> 'declined'
         and o.moderation_state = 'visible'
         and (p_after_slug is null or o.slug > p_after_slug)
       order by o.slug
       limit v_limit
     ) r),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.list_sitemap_partners(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_sitemap_partners(text, integer) to anon, authenticated;
