-- The neutral title of a job order names each occupation with its own quantity: "Germany, 30 Welders and flame cutters,
-- 20 Building and related electricians", not all the workers against the largest occupation.
create or replace function private.job_order_neutral_title(p_requirement uuid) returns text
language sql
stable
set search_path = ''
as $$
  select left(c.name || ', ' || coalesce((
      select string_agg(ro.quantity || ' ' || oc.label, ', ' order by ro.quantity desc, oc.label)
      from public.requirement_occupations ro join public.occupations oc on oc.code = ro.occupation_id
      where ro.requirement_id = r.id), r.workers_needed::text), 120)
  from public.workforce_requirements r
  join public.countries c on c.code = r.country_code
  where r.id = p_requirement
$$;
