-- Public employer company page (FR-K5; docs/phase-2/DATA_MODEL.md sections 1, 4, 7 Discovery and 10; decision 3.2;
-- NFR-S8, NFR-S11). An employer's owner or administrator at aal2 switches public_page_enabled on (off by default, V03), and
-- everyone then reads /[lang]/companies/[slug]: the display name, the based-in country, the industry, the website, the
-- description and the open, visible vacancies, never the legal name, the identifier, members, contact details or the
-- plan. get_company_page is the only public read of it. A page that is off, a suspended employer, a partner, an unknown
-- slug and every slug while release_partner_directories is false raise the same CHARA_NOT_FOUND. Named job orders join
-- the page with release 2b (V54); follow (FR-L4) comes with V24. Nothing is throttled here: the page shows what the
-- vacancy pages and Find Jobs already show to everyone.

-- The public companies by slug for the sitemap; the predicate is the one of get_company_page (the type is implied by
-- organizations_public_page_employer_only).
create index organizations_company_page_slug_idx on public.organizations (slug)
  where public_page_enabled and status = 'active';

-- The company page of one employer by its slug, for everyone (FR-K5 AC1, AC3, AC6). Vacancies are the open ones that
-- moderation has not hidden, newest first, at most 100 (open_vacancy_count tells the page how many there are).
-- viewer_role is the caller's own role in the company (Edit page and the switch instead of Report company, AC8); it says
-- nothing about anyone else.
create function public.get_company_page(p_slug text)
returns table (
  slug text,
  display_name text,
  based_in_country text,
  based_in_country_name text,
  industry_code text,
  industry_name text,
  website text,
  description text,
  open_vacancy_count integer,
  vacancies jsonb,
  viewer_role public.member_role
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.slug = p_slug and o.type = 'employer' and o.status = 'active' and o.public_page_enabled;
  if v_org is null then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select
    o.slug,
    o.display_name,
    o.based_in_country,
    bc.name,
    o.industry_code,
    i.name,
    o.website,
    o.description,
    (select count(*)::integer from public.jobs j
     where j.organization_id = o.id and j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible'),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'title', v.title, 'city', v.city, 'country_code', v.country_code, 'country', v.country,
        'employment_type', v.employment_type, 'salary_min', v.salary_min, 'salary_max', v.salary_max,
        'salary_currency', v.salary_currency, 'salary_period', v.salary_period, 'published_at', v.published_at
      ) order by v.published_at desc, v.id desc), '[]'::jsonb)
     from (
       select j.id, j.title, j.city, j.country_code, c.name as country, j.employment_type, j.salary_min, j.salary_max,
         j.salary_currency, j.salary_period, coalesce(j.published_at, j.created_at) as published_at
       from public.jobs j
       join public.countries c on c.code = j.country_code
       where j.organization_id = o.id and j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible'
       order by coalesce(j.published_at, j.created_at) desc, j.id desc
       limit 100
     ) v),
    (select m.role from public.organization_members m
     where v_uid is not null and m.organization_id = o.id and m.user_id = v_uid and m.accepted_at is not null)
  from public.organizations o
  join public.countries bc on bc.code = o.based_in_country
  left join public.industries i on i.code = o.industry_code
  where o.id = v_org;
end;
$$;

revoke all on function public.get_company_page(text) from public, anon, authenticated, service_role;
grant execute on function public.get_company_page(text) to anon, authenticated;

-- An owner or administrator at aal2 of an active employer turns the page on or off (FR-K5 AC2). The change takes effect
-- at the next request of the page and of every vacancy page; a call that changes nothing writes nothing. Returns the
-- stored state and the slug, so the switch can link to the page.
create function public.set_company_page_visibility(p_org uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from boolean;
  v_slug text;
begin
  -- Caller, active profile, owner or admin role, aal2 and an active organisation; locks the organisation row.
  perform private.assert_org_manager(p_org, 'admin');
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if private.org_type(p_org) <> 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'not_employer', errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_enabled';
  end if;

  select o.public_page_enabled, o.slug into v_from, v_slug from public.organizations o where o.id = p_org;
  if v_from is distinct from p_enabled then
    update public.organizations set public_page_enabled = p_enabled where id = p_org;
    perform audit.record(
      'organization.public_page_changed', 'organization', p_org::text,
      jsonb_build_object('from', v_from, 'to', p_enabled)
    );
  end if;
  return jsonb_build_object('enabled', p_enabled, 'slug', v_slug);
end;
$$;

revoke all on function public.set_company_page_visibility(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_company_page_visibility(uuid, boolean) to authenticated;

-- The public company pages for the sitemap (FR-K5 AC10), by slug, as one JSON array of {slug, updated_at} (the last
-- change of an open vacancy). A page without an open vacancy is left out: it holds nothing to find and is marked noindex.
-- Paged as list_sitemap_partners; empty while release_partner_directories is false.
create function public.list_sitemap_companies(p_after_slug text default null, p_limit integer default null)
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
       select o.slug, v.updated_at
       from public.organizations o
       cross join lateral (
         select max(j.updated_at) as updated_at
         from public.jobs j
         where j.organization_id = o.id and j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible'
       ) v
       where o.public_page_enabled and o.status = 'active' and o.type = 'employer'
         and v.updated_at is not null
         and (p_after_slug is null or o.slug > p_after_slug)
       order by o.slug
       limit v_limit
     ) r),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.list_sitemap_companies(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_sitemap_companies(text, integer) to anon, authenticated;

-- get_public_job of 20261110100000 with employer_company_slug added (FR-K5 AC5): the slug of the employer's company page
-- while the page is public, null otherwise, so the vacancy page links the name only while the page answers. Every other
-- column and the public predicate are unchanged.
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
  employer_company_slug text
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
    end
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
