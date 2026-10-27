-- Vacancy copies of an anonymous job order without its city and salary (V39 review, NFR-S11; FR-M1 AC10). A partner sees
-- the city and the salary of an anonymous job order (list_job_orders, get_job_order); a published vacancy shows the
-- employer's name with its city and salary, so a copy carrying them would let a partner match the vacancy to the job
-- order. For an anonymous requirement (job_order_marketplace without show_identity) the copies therefore leave the
-- salary empty and the city as '-' (public.jobs.city is required, 1 to 100 characters, so '-' is the nearest to empty
-- the table accepts, as save_requirement writes '-' for a title it fills in later); the description no longer names the
-- city either. The employer enters both in each draft; the requirement page says that the job order's city and salary
-- would let partners link the vacancy to it. Both functions are those of 20261219100000 with these changes only.

-- For an anonymous job order the city is left out of the first sentence as well (only the country remains).
create or replace function private.requirement_vacancy_description(
  p_row public.workforce_requirements,
  p_label text,
  p_quantity integer,
  p_country text
) returns text
language sql
stable
set search_path = ''
as $$
  with r as (
    select p_row.visibility = 'job_order_marketplace' and not p_row.show_identity as anonymous
  )
  select concat_ws(E'\n\n',
    case when r.anonymous
      then format('%s: workers needed in %s from %s.', p_label, p_country, to_char(p_row.start_date, 'FMMonth YYYY'))
      else format('%s: %s %s needed in %s, %s, from %s.', p_label, p_quantity,
             case when p_quantity = 1 then 'worker' else 'workers' end, p_row.city_region, p_country,
             to_char(p_row.start_date, 'FMDD FMMonth YYYY')) end,
    case when p_row.duration_months is null then 'Permanent or open-ended position.'
         else format('Project duration: %s %s.', p_row.duration_months,
                     case when p_row.duration_months = 1 then 'month' else 'months' end) end,
    case when p_row.experience_years = 0 then 'No experience required.'
         when p_row.experience_years is not null then format('Experience: %s %s.', p_row.experience_years,
                     case when p_row.experience_years = 1 then 'year' else 'years' end) end,
    case when p_row.skills is not null and not r.anonymous then 'Skills: ' || p_row.skills end,
    nullif(concat_ws(' ',
      case when p_row.accommodation then 'Accommodation is provided.' end,
      case when p_row.work_permit_support then 'Work permit support is provided.' end,
      case when p_row.visa_support then 'Visa support is provided.' end), '')
  )
  from r
$$;

revoke all on function private.requirement_vacancy_description(public.workforce_requirements, text, integer, text)
  from public, anon, authenticated, service_role;

-- An anonymous requirement is copied with the city '-' and no salary.
create or replace function public.create_vacancies_from_requirement(
  p_org uuid,
  p_requirement uuid,
  p_expected_updated_at timestamptz,
  p_expected_linked integer
) returns table (id uuid, title text, occupation_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
  v_anonymous boolean;
begin
  v_row := private.lock_requirement(p_org, p_requirement, p_expected_updated_at);
  if v_row.status <> 'open' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_row.status::text;
  end if;
  if p_expected_linked is distinct from (
    select count(*)::integer from public.jobs j where j.requirement_id = v_row.id and j.deleted_at is null
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'stale';
  end if;
  v_anonymous := v_row.visibility = 'job_order_marketplace' and not v_row.show_identity;

  return query
  with source as (
    select o.occupation_id, o.quantity, oc.label
    from public.requirement_occupations o
    join public.occupations oc on oc.code = o.occupation_id
    where o.requirement_id = v_row.id
    order by o.quantity desc, oc.label
  ), inserted as (
    insert into public.jobs (
      organization_id, requirement_id, title, description, occupation_id, industry_code, country_code, city,
      employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation, visa_support,
      recruitment_preference, created_by
    )
    select v_row.organization_id, v_row.id, s.label,
      private.requirement_vacancy_description(v_row, s.label, s.quantity,
        (select c.name from public.countries c where c.code = v_row.country_code)),
      s.occupation_id, v_row.industry_code, v_row.country_code,
      case when v_anonymous then '-' else v_row.city_region end, v_row.employment_type,
      case when not v_anonymous then v_row.salary_min end, case when not v_anonymous then v_row.salary_max end,
      case when not v_anonymous then v_row.salary_currency end, case when not v_anonymous then v_row.salary_period end,
      v_row.accommodation,
      v_row.visa_support, v_row.recruitment_preference, (select auth.uid())
    from source s
    returning public.jobs.id, public.jobs.title, public.jobs.occupation_id
  )
  select i.id, i.title, i.occupation_id
  from inserted i
  join source s on s.occupation_id = i.occupation_id
  order by s.quantity desc, s.label;
end;
$$;

revoke all on function public.create_vacancies_from_requirement(uuid, uuid, timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.create_vacancies_from_requirement(uuid, uuid, timestamptz, integer) to authenticated;
