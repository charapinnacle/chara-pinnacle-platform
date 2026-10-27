-- Workforce requirement plan limits (FR-M4, SOP P2-18; decisions 2.2, 7.1; NFR-A4, NFR-O5; docs/phase-2/DATA_MODEL.md
-- sections 2, 4, 6 and 8; release 2b). The number of open requirements of an employer follows active_requirements of its
-- plan (Basic 3, Professional 15, Enterprise 50, free 0; an Enterprise override wins until it expires), and a requirement
-- with more than one destination country needs the plan feature multi_country_requirements (Professional and
-- Enterprise). Both are rows of billing.plan_limits and billing.plan_features that only the plan editor (V16) changes,
-- and both apply as every other limit does: while entitlements_enforced is on, or for an organisation that lapsed to its
-- free plan (private.assert_within_limit, private.has_feature). The checks sit on the tables, so every way a requirement
-- becomes open (publish_requirement, the reopen of set_requirement_status, and any later function) and every new
-- destination row is checked in the transaction of the change: a trigger on the status, serialised per organisation by
-- an advisory lock, and a trigger on requirement_countries. A lapse now pauses only the open requirements above the
-- limit of the free plan, newest first, and the paused ones can be reopened again once a plan allows it. Members read
-- the usage through org_usage, which release 2b now opens too, and the form asks requirement_multi_country whether it
-- may offer further destinations. Every function a user calls here refuses to run while release_job_orders is false.

-- The open-requirements limit -------------------------------------------------------------------------------------------

-- Runs when a requirement becomes open (draft or paused before), after the guard trigger (the names sort that way), so a
-- wrong role or a refused move is never reported as a limit. The advisory lock is taken in its own statement before
-- the count, so a second change of the same organisation waits for the first to commit and then counts its row; it
-- does not wait for anything of another organisation. The count is private.limit_usage, the one org_usage and the
-- billing page read: every open requirement of the organisation, a hidden one too once moderation exists (V57); the row
-- being opened is not counted yet. A requirement with more than one destination opens only with
-- multi_country_requirements, so a downgraded organisation reopens it once it has a single destination again.
-- CHARA_LIMIT_REACHED active_requirements, CHARA_FEATURE_NOT_IN_PLAN multi_country_requirements, CHARA_FORBIDDEN
-- unknown_plan (42501) for a plan code with no row.
create function private.requirements_enforce_limits() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('active_requirements:' || new.organization_id::text, 0));
  perform private.assert_within_limit(new.organization_id, 'active_requirements',
    private.limit_usage(new.organization_id, 'active_requirements'));
  if (select count(*) from public.requirement_countries c where c.requirement_id = new.id) > 1
     and not private.has_feature(new.organization_id, 'multi_country_requirements') then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'multi_country_requirements';
  end if;
  return new;
end;
$$;

revoke all on function private.requirements_enforce_limits() from public, anon, authenticated, service_role;

-- No API role inserts a requirement in another status than draft (save_requirement is the only writer), so only a
-- change of status is checked.
create trigger workforce_requirements_limit_check
  before update of status on public.workforce_requirements
  for each row when (new.status = 'open' and old.status is distinct from 'open')
  execute function private.requirements_enforce_limits();

alter table public.workforce_requirements enable always trigger workforce_requirements_limit_check;

-- Several destinations ----------------------------------------------------------------------------------------------------

-- A destination row added next to another one needs multi_country_requirements (CHARA_FEATURE_NOT_IN_PLAN, detail
-- multi_country_requirements), whatever the status of the requirement. A row that is already there is let through to
-- its conflict, so save_requirement can write the main country again without the feature; removing a destination never
-- needs it. The requirement row is locked by its writer, so two saves of one requirement cannot both pass.
create function private.requirement_countries_enforce_feature() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
       select 1 from public.requirement_countries c
       where c.requirement_id = new.requirement_id and c.country_code <> new.country_code
     )
     and not exists (
       select 1 from public.requirement_countries c
       where c.requirement_id = new.requirement_id and c.country_code = new.country_code
     )
     and not private.has_feature(
       (select r.organization_id from public.workforce_requirements r where r.id = new.requirement_id),
       'multi_country_requirements'
     ) then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'multi_country_requirements';
  end if;
  return new;
end;
$$;

revoke all on function private.requirement_countries_enforce_feature() from public, anon, authenticated, service_role;

create trigger requirement_countries_feature_check
  before insert on public.requirement_countries
  for each row execute function private.requirement_countries_enforce_feature();

alter table public.requirement_countries enable always trigger requirement_countries_feature_check;

comment on table public.requirement_countries is
  'The destination countries of a requirement, the main one included (up to 10). A second destination needs the plan feature multi_country_requirements. Read as the requirement.';

-- Whether the form of the requirements of p_org offers further destination countries: the plan has
-- multi_country_requirements, or the feature is not enforced for the organisation. Any accepted member of an employer
-- reads it, while release 2b is on; anybody else is refused (CHARA_FORBIDDEN, 42501).
create function public.requirement_multi_country(p_org uuid) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_job_orders') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if private.org_type(p_org) <> 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'employer_only', errcode = '42501';
  end if;
  return private.has_feature(p_org, 'multi_country_requirements');
end;
$$;

revoke all on function public.requirement_multi_country(uuid) from public, anon, authenticated, service_role;
grant execute on function public.requirement_multi_country(uuid) to authenticated;

-- public.save_requirement of 20261216100000_requirement_lifecycle.sql with the further destinations (FR-M4 AC4). The new
-- last parameter p_additional_countries lists the destinations next to the main country: null keeps the destinations
-- as they are (the main country follows p_country_code as before), an array replaces them. Up to 9 codes of two
-- letters (10 destinations with the main one), CHARA_INVALID_INPUT countries otherwise; the main country and repeated
-- codes are dropped, an unknown code is the foreign key's 23503. A destination added next to another one needs
-- multi_country_requirements (the trigger on requirement_countries, CHARA_FEATURE_NOT_IN_PLAN), so a downgraded
-- organisation keeps the destinations it has, may remove them and may change every other field, but adds none and does
-- not move the main country while others remain. requirement.updated names countries when the destinations changed.
-- Everything else is unchanged. The old signature is dropped, so no caller can reach the function without the check.
drop function public.save_requirement(
  uuid, integer, text, text, text, jsonb, date, public.employment_type, public.recruitment_preference, public.partner_need,
  boolean, boolean, boolean, uuid, text, text, smallint, smallint, numeric, numeric, text, public.salary_period, timestamptz
);

create function public.save_requirement(
  p_org uuid,
  p_workers_needed integer,
  p_country_code text,
  p_city_region text,
  p_industry_code text,
  p_occupations jsonb,
  p_start_date date,
  p_employment_type public.employment_type,
  p_recruitment_preference public.recruitment_preference,
  p_partner_need public.partner_need,
  p_accommodation boolean,
  p_work_permit_support boolean,
  p_visa_support boolean,
  p_requirement uuid default null,
  p_title text default null,
  p_skills text default null,
  p_experience_years smallint default null,
  p_duration_months smallint default null,
  p_salary_min numeric default null,
  p_salary_max numeric default null,
  p_salary_currency text default null,
  p_salary_period public.salary_period default null,
  p_expected_updated_at timestamptz default null,
  p_additional_countries text[] default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_skills text := nullif(btrim(coalesce(p_skills, '')), '');
  v_city text := btrim(p_city_region);
  v_country text := upper(btrim(p_country_code));
  v_industry text := upper(btrim(p_industry_code));
  v_currency text := upper(nullif(btrim(coalesce(p_salary_currency, '')), ''));
  v_old public.workforce_requirements;
  v_new public.workforce_requirements;
  v_old_occupations jsonb := '[]'::jsonb;
  v_new_occupations jsonb;
  v_old_countries text[] := '{}';
  v_new_countries text[];
  v_additional text[];
  v_changed jsonb;
  v_criterion text;
  v_field text;
begin
  perform private.assert_requirement_manager(p_org);

  if p_requirement is not null then
    select * into v_old from public.workforce_requirements r
    where r.id = p_requirement and r.organization_id = p_org
    for update;
    if not found then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_old.status in ('closed', 'filled') then
      raise exception 'CHARA_INVALID_STATE' using detail = v_old.status::text;
    end if;
    if p_expected_updated_at is distinct from v_old.updated_at then
      raise exception 'CHARA_CONFLICT' using detail = 'stale';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('occupation_id', o.occupation_id, 'quantity', o.quantity)
             order by o.occupation_id), '[]')
    into v_old_occupations
    from public.requirement_occupations o where o.requirement_id = p_requirement;
    select coalesce(array_agg(c.country_code order by c.country_code), '{}') into v_old_countries
    from public.requirement_countries c where c.requirement_id = p_requirement;
  end if;

  if p_start_date is null
     or (p_start_date is distinct from v_old.start_date
         and (p_start_date < v_today or p_start_date > (v_today + interval '3 years')::date)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'start_date';
  end if;

  if p_occupations is null or jsonb_typeof(p_occupations) <> 'array'
     or jsonb_array_length(p_occupations) not between 1 and 10
     or exists (
       select 1 from jsonb_array_elements(p_occupations) e
       where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'occupation_id') <> 'string'
          or jsonb_typeof(e -> 'quantity') <> 'number' or (e ->> 'quantity') !~ '^\d{1,6}$'
     )
     or (select count(distinct btrim(e ->> 'occupation_id')) from jsonb_array_elements(p_occupations) e)
        <> jsonb_array_length(p_occupations) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupations';
  end if;
  select jsonb_agg(jsonb_build_object('occupation_id', btrim(e ->> 'occupation_id'), 'quantity', (e ->> 'quantity')::integer)
           order by btrim(e ->> 'occupation_id'))
  into v_new_occupations
  from jsonb_array_elements(p_occupations) e;

  if p_additional_countries is not null then
    if cardinality(p_additional_countries) > 9
       or exists (select 1 from unnest(p_additional_countries) c where c is null or btrim(c) !~ '^[A-Za-z]{2}$') then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'countries';
    end if;
    select coalesce(array_agg(distinct upper(btrim(c))), '{}') into v_additional
    from unnest(p_additional_countries) c
    where upper(btrim(c)) is distinct from v_country;
  end if;

  foreach v_field in array array['title', 'skills', 'city_region'] loop
    v_criterion := private.prohibited_criterion(case v_field
      when 'title' then case when v_title is distinct from v_old.title then v_title end
      when 'skills' then v_skills
      else v_city end);
    if v_criterion is not null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'prohibited_criterion:' || v_field;
    end if;
  end loop;

  perform private.count_audited_write(p_org);

  if p_requirement is null then
    insert into public.workforce_requirements (
      organization_id, title, workers_needed, country_code, city_region, industry_code, skills, experience_years,
      start_date, duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation,
      work_permit_support, visa_support, recruitment_preference, partner_need
    ) values (
      p_org, coalesce(v_title, '-'), p_workers_needed, v_country, v_city, v_industry, v_skills, p_experience_years,
      p_start_date, p_duration_months, p_employment_type, p_salary_min, p_salary_max, v_currency, p_salary_period,
      coalesce(p_accommodation, false), coalesce(p_work_permit_support, false), coalesce(p_visa_support, false),
      p_recruitment_preference, p_partner_need
    )
    returning * into v_new;
  else
    update public.workforce_requirements r
    set title = coalesce(v_title, '-'), workers_needed = p_workers_needed, country_code = v_country,
        city_region = v_city, industry_code = v_industry, skills = v_skills, experience_years = p_experience_years,
        start_date = p_start_date, duration_months = p_duration_months, employment_type = p_employment_type,
        salary_min = p_salary_min, salary_max = p_salary_max, salary_currency = v_currency,
        salary_period = p_salary_period, accommodation = coalesce(p_accommodation, false),
        work_permit_support = coalesce(p_work_permit_support, false), visa_support = coalesce(p_visa_support, false),
        recruitment_preference = p_recruitment_preference, partner_need = p_partner_need,
        closes_on = case when r.closes_on is not null then greatest(r.closes_on, p_start_date) end
    where r.id = p_requirement
    returning * into v_new;
    delete from public.requirement_occupations o where o.requirement_id = p_requirement;
    if v_additional is not null then
      delete from public.requirement_countries c
      where c.requirement_id = p_requirement and c.country_code <> all (v_additional || v_new.country_code);
    elsif v_old.country_code <> v_new.country_code then
      delete from public.requirement_countries c
      where c.requirement_id = p_requirement and c.country_code = v_old.country_code;
    end if;
  end if;

  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select v_new.id, e ->> 'occupation_id', (e ->> 'quantity')::integer
  from jsonb_array_elements(v_new_occupations) e;
  insert into public.requirement_countries (requirement_id, country_code) values (v_new.id, v_new.country_code)
  on conflict do nothing;
  if v_additional is not null then
    insert into public.requirement_countries (requirement_id, country_code)
    select v_new.id, c from unnest(v_additional) c order by c
    on conflict do nothing;
  end if;

  if (select sum((e ->> 'quantity')::integer) from jsonb_array_elements(v_new_occupations) e) <> v_new.workers_needed then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupation_quantities';
  end if;

  -- The title an employer left empty: the number of workers, the occupations by quantity and the place, cut to 120.
  if v_title is null then
    update public.workforce_requirements r
    set title = left(format('%s workers: %s, %s', v_new.workers_needed,
          (select string_agg(oc.label, ', ' order by o.quantity desc, oc.label)
           from public.requirement_occupations o join public.occupations oc on oc.code = o.occupation_id
           where o.requirement_id = v_new.id),
          v_new.city_region), 120)
    where r.id = v_new.id
    returning * into v_new;
  end if;

  if p_requirement is null then
    perform audit.record('requirement.created', 'requirement', v_new.id::text,
      jsonb_build_object('organization_id', p_org, 'partner_need', v_new.partner_need));
    return v_new.id;
  end if;

  select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
  from jsonb_each(to_jsonb(v_new) - 'updated_at') n
  where n.value is distinct from (to_jsonb(v_old) -> n.key);
  if v_new_occupations is distinct from v_old_occupations then
    v_changed := v_changed || '["occupations"]'::jsonb;
  end if;
  select coalesce(array_agg(c.country_code order by c.country_code), '{}') into v_new_countries
  from public.requirement_countries c where c.requirement_id = v_new.id;
  if v_new_countries is distinct from v_old_countries then
    v_changed := v_changed || '["countries"]'::jsonb;
  end if;
  if jsonb_array_length(v_changed) > 0 then
    update public.workforce_requirements r set updated_at = now() where r.id = v_new.id;
    perform audit.record('requirement.updated', 'requirement', v_new.id::text,
      jsonb_build_object('organization_id', p_org, 'changed_fields', v_changed, 'status', v_new.status));
  end if;
  return v_new.id;
end;
$$;

revoke all on function public.save_requirement(
  uuid, integer, text, text, text, jsonb, date, public.employment_type, public.recruitment_preference, public.partner_need,
  boolean, boolean, boolean, uuid, text, text, smallint, smallint, numeric, numeric, text, public.salary_period, timestamptz,
  text[]
) from public, anon, authenticated, service_role;
grant execute on function public.save_requirement(
  uuid, integer, text, text, text, jsonb, date, public.employment_type, public.recruitment_preference, public.partner_need,
  boolean, boolean, boolean, uuid, text, text, smallint, smallint, numeric, numeric, text, public.salary_period, timestamptz,
  text[]
) to authenticated;

-- The lapse ------------------------------------------------------------------------------------------------------------------

-- private.pause_requirements_on_lapse of 20261216100000_requirement_lifecycle.sql, now with the limit of the plan the
-- organisation falls back to (FR-M4 AC7, SOP step Lapse): the open requirements beyond active_requirements are paused,
-- newest first (by published_at, then id), so the oldest ones stay open up to the limit; with the free plan's 0 every
-- open requirement is paused, as before, and a plan without a limit (null) pauses none. One audit row each with actor_fn
-- pause_requirements_on_lapse; drafts, paused, closed and filled rows are untouched and nothing is deleted. A paused
-- requirement is reopened by an owner or admin, which the limit check above refuses until a plan allows it. Called by
-- private.pause_jobs_on_lapse after the subscription is cancelled; a second run finds none above the limit.
create or replace function private.pause_requirements_on_lapse(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.org_limit(p_org, 'active_requirements');
begin
  if v_limit is null then
    return;
  end if;
  perform set_config('chara.actor_fn', 'pause_requirements_on_lapse', true);
  update public.workforce_requirements r
  set status = 'paused', updated_at = clock_timestamp()
  where r.id in (
    select x.id from public.workforce_requirements x
    where x.organization_id = p_org and x.status = 'open'
    order by x.published_at, x.id
    offset v_limit
  );
  perform set_config('chara.actor_fn', '', true);
end;
$$;

-- Usage ---------------------------------------------------------------------------------------------------------------------

-- public.org_usage of 20261125100000_partner_usage_helpers.sql with one change: it also answers while release 2b is on,
-- so the requirement pages and the employer dashboard of release 2b can say "2 of 3 open workforce requirements" before
-- or without release 2a. Everything else is unchanged.
create or replace function public.org_usage(p_org uuid, p_keys text[] default null)
returns table (
  limit_key text, used integer, limit_value integer, applies boolean, period_resets_at timestamptz, plan_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_applies boolean;
  v_plan_name text;
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not (private.release_on('release_partner_directories') or private.release_on('release_job_orders')) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;

  v_applies := coalesce((select (s.value #>> '{}')::boolean from private.settings s where s.key = 'entitlements_enforced'), false)
    or private.free_plan_restricted(p_org);
  v_plan_name := (select p.name from billing.plans p where p.code = private.org_plan_code(p_org));

  return query
  select
    k.key,
    private.limit_usage(p_org, k.key),
    private.org_limit(p_org, k.key),
    v_applies,
    case when l.period = 'month' then private.month_start(private.month_start() + interval '32 days') end,
    v_plan_name
  from private.org_usage_keys(p_org) k (key)
  join billing.limit_keys l on l.key = k.key
  where p_keys is null or k.key = any (p_keys)
  order by k.key;
end;
$$;
