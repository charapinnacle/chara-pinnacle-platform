-- The public vacancy page (FR-C4; ARCHITECTURE.md sections 5.6 and 9; OPEN_QUESTIONS.md D50). One function, get_public_job,
-- answers the page for every visitor, candidate and company user alike: it applies the public predicate itself (Open,
-- visible, not deleted), because jobs_select_member would otherwise show a member their own drafts, and it reads the
-- employer's public profile from public.organizations, which an anonymous caller cannot select. It is therefore a
-- definer function with a fixed list of result columns that holds no person and no private company data: no created_by,
-- no legal name, no member, no subscription. A vacancy that is not public gives no row, whatever the reason, so the
-- page cannot tell a draft from a hidden or an unknown vacancy. Nothing is stored by a page view.

-- published_at is set by the guard trigger of the lifecycle at the first change to Open; a vacancy that was written as
-- Open by the database owner has none, and datePosted of the page is never empty, so it falls back to the creation time.
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
  employer_display_name text,
  employer_country text,
  employer_industry text,
  employer_website text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    j.id, j.title, j.description, o.label, i.name, j.country_code, c.name, j.city, j.employment_type, j.salary_min,
    j.salary_max, j.salary_currency, j.salary_period, j.accommodation, j.visa_support, j.recruitment_preference,
    coalesce(j.published_at, j.created_at), g.display_name, gc.name, gi.name, g.website
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
