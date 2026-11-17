-- Required experience on vacancies and the Experience filter of Find Jobs (FR-Q4 AC9 to AC11; V62). An owner or admin
-- states the years of experience a vacancy needs (none, or 0 to 40); the vacancy page shows it and a visitor who gives
-- their own years finds the vacancies that need no more than that, and those that state nothing. Not behind a release
-- switch: it extends the Phase 1 vacancy and search, which are live, and adds no screen and no function of its own.

alter table public.jobs
  add column required_experience_years smallint
  constraint jobs_required_experience_years_check check (required_experience_years between 0 and 40);

comment on column public.jobs.required_experience_years is
  'The years of experience the vacancy needs, 0 to 40; null states none. Public on the vacancy page; search_jobs p_experience matches it.';

-- The policies jobs_insert_admin and jobs_update_admin already confine the writes to owners and admins; a member, another
-- organisation or a visitor writes no row. jobs_audit names the column in job.updated like every other content column.
grant insert (required_experience_years), update (required_experience_years) on public.jobs to authenticated;

-- As the other indexes of the public search (20261019100000): the public vacancies only, ending with the order of the
-- results. A vacancy without a requirement always matches, so the filter is an OR over this range and the null rows.
create index jobs_public_required_experience_idx on public.jobs (required_experience_years, created_at desc, id desc)
  where status = 'open' and deleted_at is null and moderation_state = 'visible';

-- get_public_job of 20261204100000 with required_experience_years added at the end. Every other column and the public
-- predicate are unchanged.
drop function public.get_public_job(uuid);

create function public.get_public_job(p_id uuid) returns table (
  id uuid,
  title text,
  description text,
  occupation text,
  industry text,
  country_code text,
  country text,
  city text,
  employment_type public.employment_type,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_period public.salary_period,
  accommodation boolean,
  visa_support boolean,
  recruitment_preference public.recruitment_preference,
  published_at timestamptz,
  created_at timestamptz,
  employer_display_name text,
  employer_country text,
  employer_industry text,
  employer_website text,
  employer_description text,
  employer_company_slug text,
  required_experience_years smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    j.id, j.title, j.description, o.label, i.name, j.country_code, c.name, j.city, j.employment_type, j.salary_min,
    j.salary_max, j.salary_currency, j.salary_period, j.accommodation, j.visa_support, j.recruitment_preference,
    coalesce(j.published_at, j.created_at), j.created_at, g.display_name, gc.name, gi.name, g.website, g.description,
    case
      when g.type = 'employer' and g.status = 'active' and g.public_page_enabled
        and private.release_on('release_partner_directories')
      then g.slug
    end,
    j.required_experience_years
  from public.jobs j
  join public.organizations g on g.id = j.organization_id
  join public.occupations o on o.code = j.occupation_id
  join public.industries i on i.code = j.industry_code
  join public.countries c on c.code = j.country_code
  join public.countries gc on gc.code = g.based_in_country
  left join public.industries gi on gi.code = g.industry_code
  where j.id = p_id and j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible'
$$;

revoke all on function public.get_public_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_public_job(uuid) to anon, authenticated;

-- search_jobs of 20261110100000 with p_experience added after p_employer: the visitor's own years of experience, 0 to
-- 40 (CHARA_INVALID_INPUT otherwise). It keeps the vacancies that need no more than that and those that state no
-- requirement, because a vacancy without one is open to everybody. The result columns are unchanged. An integer, not a
-- smallint, so that 41 or a large number reaches the range check and is refused by name rather than by a cast.
drop function public.search_jobs(
  text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean,
  public.recruitment_preference, text, text, integer
);

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
  p_employer text default null,
  p_experience integer default null,
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
  v_employer text := nullif(btrim(p_employer), '');
  v_currency text := upper(p_salary_currency);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_tsq tsquery;
  v_city_key text;
  v_employer_like text;
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
  if char_length(v_employer) not between 2 and 100 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_employer';
  end if;
  if p_experience not between 0 and 40 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_experience';
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
  if v_employer is not null then
    v_employer_like := '%' || replace(replace(replace(private.fold_text(v_employer), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

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
      and (v_employer_like is null or private.fold_text(o.display_name) like v_employer_like)
      and (p_experience is null or j.required_experience_years is null or j.required_experience_years <= p_experience)
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
  public.recruitment_preference, text, integer, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.search_jobs(
  text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean,
  public.recruitment_preference, text, integer, text, integer
) to anon, authenticated;

-- record_job_form_invalid of 20261015100000 with the new field of the vacancy form, requiredExperience, among the names
-- it accepts, so a refused form that names it still counts towards the validation error rate of FR-C1.
create or replace function public.record_job_form_invalid(p_org uuid, p_fields text[]) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'job_form_invalid_per_hour_max');
begin
  if v_uid is null or not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if p_fields is null
     or cardinality(p_fields) not between 1 and 20
     or not (p_fields <@ array[
       'title', 'description', 'occupation', 'industry', 'country', 'city', 'employmentType', 'salaryMin', 'salaryMax',
       'salaryCurrency', 'salaryPeriod', 'accommodation', 'visaSupport', 'recruitmentPreference', 'requiredExperience'
     ]) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_fields';
  end if;
  if (select count(*) from audit.log l
      where l.action = 'job.form_invalid' and l.actor_id = v_uid and l.created_at > now() - interval '1 hour')
     >= coalesce(v_max, 0) then
    return;
  end if;
  perform audit.record('job.form_invalid', 'organization', p_org::text, jsonb_build_object('fields', to_jsonb(p_fields)));
end;
$$;
