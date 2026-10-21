-- City names for the City field of the home search. Before this, City suggested only the cities of open vacancies, so a
-- new site suggested almost nothing. public.cities holds the GeoNames cities of 15 000 people or more (CC BY 4.0, credited
-- in the site footer), from supabase/seeds/ref/cities.sql (scripts/gen-city-seed.mjs). Like the other reference tables of
-- 20261003100200_reference_data.sql it is readable by everyone and writable by nobody through the API. A vacancy keeps its
-- city as free text: this list only suggests, it never limits what a company or a visitor may type.

create table public.cities (
  id integer primary key,
  country_code text not null references public.countries (code),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
  population integer not null default 0
);

comment on table public.cities is 'GeoNames cities15000 (CC BY 4.0); id is the GeoNames geonameid, one row per name and country.';

alter table public.cities enable row level security;
alter table public.cities force row level security;

grant select on public.cities to anon, authenticated;

create policy cities_select on public.cities for select to anon, authenticated using (true);

-- The suggestions match the folded name (case and accents ignored, as the vacancy search compares cities) within one
-- country; text_pattern_ops lets a prefix LIKE use the index whatever the collation.
create index cities_country_fold_name_idx on public.cities (country_code, private.fold_text(name) text_pattern_ops);

-- Up to 10 city names of p_country for the typed p_query. A city with a public vacancy in that country comes first, as
-- that is where a search finds something; then names that start with the query, then names with a word that starts
-- with it, then names that contain it; then the larger city. A vacancy city that GeoNames lacks (a district, a small
-- town) is still suggested, spelled as the vacancy has it. An empty query gives the vacancy cities, then the largest
-- cities. A definer function, as search_jobs is: it applies the public predicate of jobs_select_public itself and
-- returns only names. plan_cache_mode: only a plan made for the pattern of the call can use the prefix index.
create function public.suggest_cities(p_country text, p_query text default null)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_country text := upper(p_country);
  v_query text := btrim(coalesce(p_query, ''));
  v_key text;
  v_prefix text;
  v_contains text;
  v_word text;
begin
  if v_country is null or v_country !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_country';
  end if;
  if char_length(v_query) > 100 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_query';
  end if;

  v_key := replace(replace(replace(private.fold_text(v_query), '\', '\\'), '%', '\%'), '_', '\_');
  v_prefix := v_key || '%';
  v_contains := '%' || v_key || '%';
  v_word := '% ' || v_key || '%';

  return query
  with vacancy as (
    select private.fold_text(j.city) as key, min(j.city) as name
    from public.jobs j
    where j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible'
      and j.country_code = v_country and private.fold_text(j.city) like v_contains
    group by 1
  ),
  starts as (
    select private.fold_text(c.name) as key, c.name, c.population
    from public.cities c
    where c.country_code = v_country and private.fold_text(c.name) like v_prefix
    order by c.population desc, c.name
    limit 10
  ),
  inside as (
    select private.fold_text(c.name) as key, c.name, c.population
    from public.cities c
    where c.country_code = v_country and v_key <> ''
      and private.fold_text(c.name) like v_contains and private.fold_text(c.name) not like v_prefix
    order by (' ' || regexp_replace(private.fold_text(c.name), '[^[:alnum:]]+', ' ', 'g')) like v_word desc,
      c.population desc, c.name
    limit 10
  ),
  reference as (
    select * from starts
    union all
    select * from inside
  ),
  merged as (
    select distinct on (coalesce(r.key, v.key))
      coalesce(r.key, v.key) as key,
      coalesce(r.name, v.name) as name,
      coalesce(r.population, 0) as population,
      v.key is not null as has_vacancy
    from vacancy v
    full join reference r on r.key = v.key
    order by coalesce(r.key, v.key), r.population desc nulls last
  )
  select m.name
  from merged m
  order by
    m.has_vacancy desc,
    case
      when m.key like v_prefix then 0
      when (' ' || regexp_replace(m.key, '[^[:alnum:]]+', ' ', 'g')) like v_word then 1
      else 2
    end,
    m.population desc,
    m.name
  limit 10;
end;
$$;

revoke all on function public.suggest_cities(text, text) from public, anon, authenticated, service_role;
grant execute on function public.suggest_cities(text, text) to anon, authenticated;

-- The deployment check of 20261111120000_reference_data_check.sql, unchanged but for public.cities in the list of
-- reference tables that the seed fills.
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
    'account-suspension-and-termination-rules', 'sharing-notice', 'age-18-plus'
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
    from unnest(array['signup', 'resend', 'login', 'forgot_password', 'reset_password', 'mfa_code', 'report', 'document_access']) as a
    cross join unnest(array['_max', '_seconds']) as s
  ) as k
  where not exists (select 1 from private.settings st where st.key = k.key)
  union all
  select 'vault_secret', 'rate_limit_proof_key'
  where not exists (select 1 from vault.secrets v where v.name = 'rate_limit_proof_key')
  order by 1, 2
$$;

revoke all on function private.missing_reference_data() from public, anon, authenticated, service_role;
