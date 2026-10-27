-- Draft vacancies from a workforce requirement (FR-M1 step Next steps and AC10, SOP P2-15; decision 3.1; NFR-S8, NFR-S11;
-- docs/phase-2/DATA_MODEL.md sections 4 and 7; release 2b). A requirement is not a vacancy and candidates never apply to
-- it; for direct applications an owner or admin at aal2 copies an open requirement into draft vacancies in one step, one
-- per occupation, linked by public.jobs.requirement_id. The drafts are ordinary Phase 1 vacancies from then on: the
-- employer edits and publishes each one, and the open-vacancies limit (jobs_limit_check, active_jobs) judges each publish
-- as it judges every other one, whether entitlements_enforced is on or off. A draft counts against no limit, so creating
-- them is checked only as any vacancy write is (the daily quota of audited writes, through jobs_quota per row). Each
-- call creates further drafts (the page asks first when linked vacancies exist); the requirement itself is not changed.
-- Every function here refuses to run while release_job_orders is false. The link itself is no change of the vacancy:
-- when retention removes a requirement and the link is set to null, the vacancy keeps its updated_at (the sitemap's
-- lastmod) and gets no job.updated row.

-- Set only by create_vacancies_from_requirement. No API role reads, inserts or updates it: a public vacancy carrying the
-- id of its requirement would let a partner who sees the anonymous job order (V39) find the employer's name on the
-- public vacancy (NFR-S11), so the members read the link through requirement_vacancies only. A requirement removed by
-- retention (V58) leaves its vacancies in place, unlinked.
alter table public.jobs add column requirement_id uuid references public.workforce_requirements (id) on delete set null;

comment on column public.jobs.requirement_id is
  'The workforce requirement this vacancy was copied from (create_vacancies_from_requirement); not readable through the Data API.';

-- The members' read of one requirement's vacancies, and the set null of a requirement removed by retention.
create index jobs_requirement_idx on public.jobs (requirement_id, created_at desc) where requirement_id is not null;

-- The description of a vacancy copied from p_row for one occupation (p_label, p_quantity) in the country p_country: the
-- facts of the requirement that public.jobs has no column for, in plain sentences the employer edits before publishing.
-- A published vacancy shows the employer's name and its text is searched in full, so for an anonymous job order
-- (job_order_marketplace without show_identity) the facts a partner could match against the job order are left out
-- (NFR-S11): the exact quantity, the exact start date (only month and year remain) and the skills text. Always longer
-- than the 50 characters jobs_description_check asks for (the duration sentence is always there), and far below 10,000
-- (skills hold up to 1,000).
create function private.requirement_vacancy_description(
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
      then format('%s: workers needed in %s, %s, from %s.', p_label, p_row.city_region, p_country,
             to_char(p_row.start_date, 'FMMonth YYYY'))
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

-- Copies the open requirement p_requirement of p_org into draft vacancies (FR-M1 AC10): one per occupation, with the
-- occupation's label as title, the country, city or region, industry, employment type, salary, accommodation, visa
-- support and recruitment preference of the requirement, the other facts in the description, created_by the caller
-- and requirement_id set. An owner or admin at aal2 of the active employer while release 2b is on, naming the
-- updated_at the page was drawn with (private.lock_requirement: CHARA_FORBIDDEN release_off, aal2_required,
-- organization_suspended, employer_only; CHARA_NOT_FOUND; CHARA_CONFLICT stale) and the number of linked vacancies it
-- showed (p_expected_linked), counted under the row lock so that a confirmation given for a list another admin has
-- since added to is refused too (CHARA_CONFLICT stale). Only an open requirement is copied: a
-- draft is published first, and a paused, closed or filled one is not recruiting (CHARA_INVALID_STATE and its status).
-- One audit row job.created per vacancy (jobs_audit) and one audited write per vacancy (jobs_quota); the requirement
-- row is not written. Answers the new vacancies, largest quantity first.
create function public.create_vacancies_from_requirement(
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
      s.occupation_id, v_row.industry_code, v_row.country_code, v_row.city_region, v_row.employment_type,
      v_row.salary_min, v_row.salary_max, v_row.salary_currency, v_row.salary_period, v_row.accommodation,
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

-- The vacancies copied from the requirement p_requirement of p_org that are not deleted, the newest call first and by
-- title within it, for any accepted member of the employer while release 2b is on (the requirement page lists them and
-- asks before copying again).
-- Anybody else is refused (CHARA_FORBIDDEN, 42501); a requirement of another organisation has none.
create function public.requirement_vacancies(p_org uuid, p_requirement uuid)
returns table (id uuid, title text, status public.job_status, moderation_state public.job_moderation_state, created_at timestamptz)
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
  return query
  select j.id, j.title, j.status, j.moderation_state, j.created_at
  from public.jobs j
  where j.requirement_id = p_requirement and j.organization_id = p_org and j.deleted_at is null
  order by j.created_at desc, j.title, j.id;
end;
$$;

revoke all on function public.requirement_vacancies(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.requirement_vacancies(uuid, uuid) to authenticated;

-- private.jobs_audit of 20261106110000_search_engine_readiness.sql with requirement_id among the keys that are no
-- job.updated change: it is set at insert only and set to null when retention removes the requirement. Everything else
-- is identical.
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
      and n.key not in ('status', 'status_changed_at', 'published_at', 'moderation_state', 'updated_at', 'requirement_id');
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

-- private.jobs_touch_updated_at of 20261106110000_search_engine_readiness.sql: an update that changes requirement_id
-- and nothing else keeps updated_at. search_vector is generated after the before triggers, so it is left out of the
-- comparison. Every other update still sets updated_at to now().
create or replace function private.jobs_touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.requirement_id is distinct from old.requirement_id
     and to_jsonb(new) - array['requirement_id', 'search_vector', 'updated_at']
       = to_jsonb(old) - array['requirement_id', 'search_vector', 'updated_at'] then
    return new;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
