-- Public vacancy search (FR-C3; ARCHITECTURE.md sections 9.1 and 9.2; OPEN_QUESTIONS.md D49). One function, search_jobs,
-- answers every visitor, candidate and company user alike: it applies the public predicate itself (Open, visible, not
-- deleted), because jobs_select_member would otherwise show a member their own drafts, and it reads the employer's
-- display name and slug from public.organizations, which an anonymous caller cannot select. It is therefore a definer
-- function with a fixed list of result columns that holds no person: no created_by, no legal name, no member data.
-- Nothing is stored by a search. The indexes of this migration serve every filter and the order of the results; the
-- jobs insert path pays for them only for the columns they hold.

-- A vacancy is searched by city as a whole value, ignoring case and accents. unaccent is stable, not immutable (see
-- private.search_text), and an index expression needs an immutable function; the stock dictionary does not change.
create function private.fold_text(p_text text) returns text
language sql
immutable
set search_path = ''
as $$ select lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_text)) $$;

revoke all on function private.fold_text(text) from public, anon, authenticated, service_role;
grant execute on function private.fold_text(text) to authenticated;

-- The indexes of ARCHITECTURE 9.1: the filter columns with the creation time, the organisation and status, the full
-- text vector and the trigram index on the title.
create index jobs_status_country_occupation_idx on public.jobs (status, country_code, occupation_id, created_at desc);
create index jobs_organization_status_idx on public.jobs (organization_id, status);
create index jobs_search_vector_idx on public.jobs using gin (search_vector);
create index jobs_title_trgm_idx on public.jobs using gin (title extensions.gin_trgm_ops);

-- The proposed indexes. Each holds only the public vacancies (the predicate of jobs_select_public, which is how the
-- policy columns status, moderation_state and deleted_at are covered) and ends with the order of the results, so a
-- filter that selects many rows reads them newest first and stops after one page. Drafts and closed vacancies, which
-- are the bulk of the rows over time, cost these indexes nothing.
create index jobs_public_newest_idx on public.jobs (created_at desc, id desc)
  where status = 'open' and deleted_at is null and moderation_state = 'visible';
create index jobs_public_industry_idx on public.jobs (industry_code, created_at desc, id desc)
  where status = 'open' and deleted_at is null and moderation_state = 'visible';
create index jobs_public_employment_type_idx on public.jobs (employment_type, created_at desc, id desc)
  where status = 'open' and deleted_at is null and moderation_state = 'visible';
create index jobs_public_city_idx on public.jobs (private.fold_text(city), created_at desc, id desc)
  where status = 'open' and deleted_at is null and moderation_state = 'visible';
create index jobs_public_salary_idx on public.jobs (salary_currency, salary_period, salary_max)
  where status = 'open' and deleted_at is null and moderation_state = 'visible';

-- The filters are optional parameters; a parameter that is null does not filter. The error code is the stable message
-- of the other functions: CHARA_INVALID_INPUT with the parameter in the detail.
--   p_q            whole words of the title and description, all of which must match, without stemming
--   p_city         the whole value of the city
--   p_salary_min   needs p_salary_currency and p_salary_period; matches the top of the range of a vacancy with the
--                  same currency and period, without any conversion
--   p_accommodation, p_visa_support
--                  only true filters
--   p_recruitment  local or international; a vacancy that recruits both matches either
--   p_cursor       the next_cursor of the last row of the previous page
--   p_limit        1 to 50, 20 when missing
-- The results are ordered by relevance, then newest first, then by id; without a keyword every vacancy has the same
-- relevance. The page is a keyset page over (relevance, created_at, id), so a vacancy created between two pages cannot
-- shift the second. next_cursor is set on the last row of a page that has a successor and is null otherwise. A plan
-- has no effect on the order: this function never reads billing.
-- plan_cache_mode: the optional filters are written as "p is null or column = p"; only a plan made for the values of
-- the call reduces that to the filters that are set, so the index of each can be used. extra_float_digits: the
-- relevance travels in the cursor as text, and only the full digits of a real read back as the same number.
create function public.search_jobs(
  p_q text default null,
  p_country text default null,
  p_city text default null,
  p_occupation text default null,
  p_industry text default null,
  p_employment_type public.employment_type default null,
  p_salary_min numeric default null,
  p_salary_currency text default null,
  p_salary_period public.salary_period default null,
  p_accommodation boolean default null,
  p_visa_support boolean default null,
  p_recruitment public.recruitment_preference default null,
  p_cursor text default null,
  p_limit integer default null
) returns table (
  id uuid,
  title text,
  employer_display_name text,
  employer_slug text,
  country_code text,
  city text,
  employment_type public.employment_type,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_period public.salary_period,
  accommodation boolean,
  visa_support boolean,
  recruitment_preference public.recruitment_preference,
  created_at timestamptz,
  next_cursor text
)
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
set extra_float_digits = 3
as $$
declare
  v_q text := nullif(btrim(p_q), '');
  v_country text := upper(p_country);
  v_city text := nullif(btrim(p_city), '');
  v_currency text := upper(p_salary_currency);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_tsq tsquery;
  v_city_key text;
  v_cursor_rank real;
  v_cursor_created timestamptz;
  v_cursor_id uuid;
begin
  if char_length(v_q) > 100 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_q';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_country';
  end if;
  if char_length(v_city) > 100 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_city';
  end if;
  if char_length(p_occupation) > 10 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_occupation';
  end if;
  if char_length(p_industry) > 10 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_industry';
  end if;
  if p_recruitment = 'both' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_recruitment';
  end if;
  if p_salary_min is not null then
    if p_salary_min <= 0 or p_salary_min > 9999999.99 then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_salary_min';
    end if;
    if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_salary_currency';
    end if;
    if p_salary_period is null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_salary_period';
    end if;
  end if;

  if p_cursor is not null then
    begin
      if p_cursor !~ '^[0-9]+(\.[0-9]+)?(e[+-][0-9]+)?\|[0-9T:.Z-]+\|[0-9a-f-]{36}$' then
        raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
      end if;
      v_cursor_rank := split_part(p_cursor, '|', 1)::real;
      v_cursor_created := split_part(p_cursor, '|', 2)::timestamptz;
      v_cursor_id := split_part(p_cursor, '|', 3)::uuid;
    exception when others then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end;
  end if;

  if v_q is not null then
    v_tsq := plainto_tsquery('simple', extensions.unaccent('extensions.unaccent'::regdictionary, v_q));
  end if;
  v_city_key := private.fold_text(v_city);

  return query
  with hits as (
    select
      j.id, j.title, o.display_name, o.slug, j.country_code, j.city, j.employment_type, j.salary_min, j.salary_max,
      j.salary_currency, j.salary_period, j.accommodation, j.visa_support, j.recruitment_preference, j.created_at,
      r.rank
    from public.jobs j
    join public.organizations o on o.id = j.organization_id
    cross join lateral (
      select case when v_tsq is null then 0::real else ts_rank(j.search_vector, v_tsq) end as rank
    ) r
    where j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible'
      and (v_tsq is null or j.search_vector @@ v_tsq)
      and (v_country is null or j.country_code = v_country)
      and (v_city_key is null or private.fold_text(j.city) = v_city_key)
      and (p_occupation is null or j.occupation_id = p_occupation)
      and (p_industry is null or j.industry_code = p_industry)
      and (p_employment_type is null or j.employment_type = p_employment_type)
      and (p_salary_min is null
           or (j.salary_currency = v_currency and j.salary_period = p_salary_period and j.salary_max >= p_salary_min))
      and (p_accommodation is not true or j.accommodation)
      and (p_visa_support is not true or j.visa_support)
      and (p_recruitment is null or j.recruitment_preference in ('both', p_recruitment))
      and (v_cursor_id is null
           or (v_tsq is null and (j.created_at, j.id) < (v_cursor_created, v_cursor_id))
           or (v_tsq is not null and (r.rank, j.created_at, j.id) < (v_cursor_rank, v_cursor_created, v_cursor_id)))
    order by r.rank desc, j.created_at desc, j.id desc
    limit v_limit + 1
  ),
  numbered as (
    select h.*, row_number() over (order by h.rank desc, h.created_at desc, h.id desc) as n
    from hits h
  )
  select
    p.id, p.title, p.display_name, p.slug, p.country_code, p.city, p.employment_type, p.salary_min, p.salary_max,
    p.salary_currency, p.salary_period, p.accommodation, p.visa_support, p.recruitment_preference, p.created_at,
    case
      when p.n = v_limit and exists (select 1 from numbered x where x.n > v_limit)
        then p.rank::text || '|' || to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p.id
    end
  from numbered p
  where p.n <= v_limit
  order by p.n;
end;
$$;

revoke all on function public.search_jobs(
  text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean,
  public.recruitment_preference, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.search_jobs(
  text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean,
  public.recruitment_preference, text, integer
) to anon, authenticated;
