-- The company description and the Employer filter of Find Jobs (FR-A2, FR-C3, FR-C4; OPEN_QUESTIONS.md D82). An owner or
-- administrator writes up to 2000 characters about the company in the company profile, and the vacancy page shows them in
-- the employer block as plain text. The public search gets the filter "Employer" of the specification (section 11 of the
-- website content): part of the display name of the organisation, which is the only name a visitor sees.

alter table public.organizations
  add column description text
  constraint organizations_description_check
  check (description is null or (description = btrim(description, E' \t\r\n') and char_length(description) between 1 and 2000));

comment on column public.organizations.description is
  'What the company tells candidates about itself, plain text with its line breaks (at most 2000 characters, trimmed). Public on the vacancy page; the audit row of a change names the field, never the text.';

-- The match of the filter is a substring of the display name ignoring case and accents, like the city: a trigram index on
-- the folded name answers it from three characters on, and a table of organisations is small next to the vacancies.
create index organizations_display_name_fold_trgm_idx
  on public.organizations using gin (private.fold_text(display_name) extensions.gin_trgm_ops);

-- update_organization_profile of 20261108100000 with the description added. The description replaces the stored one, an
-- empty value clears it, and only the name of the field enters the audit row.
drop function public.update_organization_profile(uuid, text, text, text, text, text);

create function public.update_organization_profile(
  p_org uuid,
  p_legal_name text,
  p_display_name text,
  p_based_in_country text,
  p_industry_code text,
  p_website text default null,
  p_description text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.organizations;
  v_new public.organizations;
  v_legal text := nullif(btrim(p_legal_name), '');
  v_changed jsonb;
  v_duplicate boolean := false;
  v_constraint text;
  v_column text;
begin
  -- Caller, active profile, owner or admin role, aal2 and an active organisation; locks the organisation row.
  perform private.assert_org_manager(p_org, 'admin');
  if v_legal is null or nullif(btrim(p_industry_code), '') is null or nullif(btrim(p_based_in_country), '') is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = case
      when v_legal is null then 'legal_name'
      when nullif(btrim(p_industry_code), '') is null then 'industry_code'
      else 'based_in_country' end;
  end if;

  select * into v_old from public.organizations o where o.id = p_org;
  if v_legal is distinct from v_old.legal_name and private.legal_entity_locked(p_org) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'legal_name_locked';
  end if;

  begin
    update public.organizations
    set legal_name = v_legal,
        display_name = coalesce(nullif(btrim(p_display_name), ''), v_legal),
        based_in_country = upper(btrim(p_based_in_country)),
        industry_code = upper(btrim(p_industry_code)),
        website = nullif(btrim(p_website), ''),
        description = nullif(btrim(p_description, E' \t\r\n'), '')
    where id = p_org
    returning * into v_new;
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
      raise exception 'CHARA_INVALID_INPUT' using detail = coalesce(nullif(v_constraint, ''), v_column);
  end;

  select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
  from jsonb_each(to_jsonb(v_new)) n
  where n.key in ('legal_name', 'display_name', 'based_in_country', 'industry_code', 'website', 'description')
    and n.value is distinct from to_jsonb(v_old) -> n.key;
  -- The stored display name is returned because an empty one becomes the legal name, and the form shows what is stored.
  if jsonb_array_length(v_changed) = 0 then
    return jsonb_build_object('display_name', v_new.display_name, 'duplicate_legal_name', false);
  end if;

  -- As at registration (FR-A2 AC5): a name another organisation already uses is reported, never refused, and nothing
  -- about the other organisation is returned.
  if v_changed ? 'legal_name' then
    v_duplicate := exists (
      select 1 from public.organizations o
      where private.legal_name_key(o.legal_name) = private.legal_name_key(v_legal) and o.id <> p_org
    );
  end if;
  perform audit.record(
    'organization.updated', 'organization', p_org::text,
    jsonb_build_object('changed_fields', v_changed, 'duplicate_legal_name', v_duplicate)
  );
  return jsonb_build_object('display_name', v_new.display_name, 'duplicate_legal_name', v_duplicate);
end;
$$;

revoke all on function public.update_organization_profile(uuid, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_organization_profile(uuid, text, text, text, text, text, text) to authenticated;

-- get_public_job of 20261106110000 with the description of the employer added.
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
  employer_description text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    j.id, j.title, j.description, o.label, i.name, j.country_code, c.name, j.city, j.employment_type, j.salary_min,
    j.salary_max, j.salary_currency, j.salary_period, j.accommodation, j.visa_support, j.recruitment_preference,
    coalesce(j.published_at, j.created_at), j.created_at, g.display_name, gc.name, gi.name, g.website, g.description
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

-- search_jobs of 20261019100000 with p_employer added after p_recruitment: part of the display name of the organisation
-- (2 to 100 characters after trimming, any case, accents ignored). The characters of LIKE are escaped, so a visitor's
-- % or _ is text. An empty value is no filter.
drop function public.search_jobs(
  text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean,
  public.recruitment_preference, text, integer
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
  public.recruitment_preference, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.search_jobs(
  text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean,
  public.recruitment_preference, text, text, integer
) to anon, authenticated;
