-- Search engine readiness (FR-H5; ARCHITECTURE.md section 9; docs/phase-1/acceptance-criteria H, FR-H5). The sitemap is
-- generated from live data, so it needs three things the database did not give yet: the date a vacancy last changed
-- (jobs.updated_at, the lastmod of its entry), the public vacancies in pages that a crawler-sized list can be read in,
-- and the creation time on the public vacancy read (datePosted of the markup). Nothing here stores a person or a new
-- fact about a vacancy.

alter table public.jobs add column updated_at timestamptz not null default now();

comment on column public.jobs.updated_at is
  'When the row last changed (the creation time until then); set by a trigger, the lastmod of the vacancy in the sitemap. Not readable through the Data API.';

-- 20261101110100 with one change: updated_at is stamped by the trigger below on every update, so it names no field that
-- somebody edited and job.updated does not list it (an update that changes nothing else writes no audit row).
create or replace function private.jobs_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb;
  v_actor_fn text := coalesce(current_setting('chara.actor_fn', true), '');
begin
  if tg_op = 'INSERT' then
    perform audit.record('job.created', 'job', new.id::text, jsonb_build_object('organization_id', new.organization_id));
  elsif tg_op = 'DELETE' then
    perform audit.record('job.deleted', 'job', old.id::text, jsonb_build_object('organization_id', old.organization_id));
  else
    if new.status <> old.status then
      perform audit.record(
        'job.status_changed', 'job', new.id::text,
        jsonb_build_object('organization_id', new.organization_id, 'from', old.status, 'to', new.status)
          || case when v_actor_fn <> '' then jsonb_build_object('actor_fn', v_actor_fn) else '{}'::jsonb end
      );
    end if;
    v_old := to_jsonb(old) - 'search_vector';
    v_new := to_jsonb(new) - 'search_vector';
    select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from v_old -> n.key
      and n.key not in ('status', 'status_changed_at', 'published_at', 'moderation_state', 'updated_at');
    if jsonb_array_length(v_changed) > 0 then
      perform audit.record(
        'job.updated', 'job', new.id::text,
        jsonb_build_object('organization_id', new.organization_id, 'changed_fields', v_changed)
      );
    end if;
  end if;
  return null;
end;
$$;

-- The rows that exist now were not all changed today: the date of their last change is the later of their creation and
-- their last status change, so the lastmod of an old vacancy is not the date of the deployment. It runs after the audit
-- function above (an update of this column alone writes no audit row) and before the trigger below (which would stamp it).
update public.jobs set updated_at = greatest(created_at, status_changed_at);

-- Every update stamps the row, whoever makes it and whichever column it changes: a status, a moderation decision and an
-- edit of the text all change what a crawler sees.
create function private.jobs_touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.jobs_touch_updated_at() from public, anon, authenticated, service_role;

create trigger jobs_touch_updated_at
  before update on public.jobs
  for each row execute function private.jobs_touch_updated_at();

alter table public.jobs enable always trigger jobs_touch_updated_at;

-- The public vacancies for the sitemap, newest first, as one JSON array of {id, created_at, updated_at}. The rows come
-- from the partial index jobs_public_newest_idx (the public predicate, then the order of the list), so a page costs what
-- it returns whatever the table holds. The Data API cuts a set of rows at max_rows (100), which a sitemap of thousands
-- of entries cannot live with; a single JSON value is not cut, and the page size is the limit (at most 5000, 5000 when
-- missing). The next page starts after the created_at and id of the last entry of this one. Definer rights: updated_at
-- is no column of the Data API. The where clause is the public predicate: it must stay what the policy jobs_select_public
-- shows an anonymous caller (the test 094 compares the two).
create function public.list_sitemap_jobs(
  p_after_created timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5000), 1), 5000);
begin
  if (p_after_created is null) <> (p_after_id is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_after';
  end if;
  return coalesce(
    (select jsonb_agg(
        jsonb_build_object('id', r.id, 'created_at', r.created_at, 'updated_at', r.updated_at)
        order by r.created_at desc, r.id desc)
     from (
       select j.id, j.created_at, j.updated_at
       from public.jobs j
       where j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible'
         and (p_after_created is null or (j.created_at, j.id) < (p_after_created, p_after_id))
       order by j.created_at desc, j.id desc
       limit v_limit
     ) r),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.list_sitemap_jobs(timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_sitemap_jobs(timestamptz, uuid, integer) to anon, authenticated;

-- The public vacancy read of 20261020100000 with the creation time added: datePosted of the JobPosting markup is the
-- date of created_at (FR-H5), while published_at (the first change to Open, or the creation time when there is none)
-- stays the date the page shows (FR-C4).
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
    coalesce(j.published_at, j.created_at), j.created_at, g.display_name, gc.name, gi.name, g.website
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
