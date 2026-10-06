-- Vacancies (FR-C1; ARCHITECTURE.md sections 4, 5.6; OPEN_QUESTIONS.md D44). One public.jobs row per vacancy. A vacancy
-- is created in Draft by an owner or admin of the organisation straight through the Data API under row level security:
-- the column grants leave out everything the server owns (status, moderation_state, deleted_at, created_by, the
-- hiring-on-behalf organisation), so a client can neither choose nor change them. Reference values (occupation,
-- industry, country, currency) are foreign keys to the controlled lists, and nothing here stores a gender, an age, a
-- nationality or any other attribute of a person (NFR-C1, NFR-M1). The lifecycle (FR-C2), the plan limits (FR-C6) and
-- moderation (FR-C7) write status and moderation_state in later units; the public read policy is here so that a draft
-- is never visible to the public from the first row.

create type public.employment_type as enum ('full_time', 'part_time', 'contract', 'temporary', 'seasonal');
create type public.salary_period as enum ('hour', 'month', 'year');
create type public.recruitment_preference as enum ('local', 'international', 'both');
create type public.job_status as enum ('draft', 'open', 'paused', 'closed', 'filled');
create type public.job_moderation_state as enum ('visible', 'hidden', 'org_suspended');

-- unaccent is stable, not immutable, because its dictionary can change; a generated column needs an immutable
-- expression, and the stock dictionary of this project does not change.
create function private.search_text(p_title text, p_description text) returns tsvector
language sql
immutable
set search_path = ''
as $$ select to_tsvector('simple', extensions.unaccent('extensions.unaccent'::regdictionary, p_title || ' ' || p_description)) $$;

revoke all on function private.search_text(text, text) from public, anon, authenticated, service_role;
grant execute on function private.search_text(text, text) to authenticated;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  posted_on_behalf_of_organization_id uuid references public.organizations (id),
  title text not null check (title = btrim(title) and length(title) between 5 and 120 and title !~ '[[:cntrl:]]'),
  description text not null check (
    description = btrim(description)
    and length(description) between 50 and 10000
    and description !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  ),
  occupation_id text not null references public.occupations (code),
  industry_code text not null references public.industries (code),
  country_code text not null references public.countries (code),
  city text not null check (city = btrim(city) and length(city) between 1 and 100 and city !~ '[[:cntrl:]]'),
  employment_type public.employment_type not null,
  salary_min numeric(12, 2) check (salary_min between 0 and 9999999.99),
  salary_max numeric(12, 2) check (salary_max between 0 and 9999999.99),
  salary_currency text references public.currencies (code),
  salary_period public.salary_period,
  accommodation boolean not null default false,
  visa_support boolean not null default false,
  recruitment_preference public.recruitment_preference not null,
  status public.job_status not null default 'draft',
  moderation_state public.job_moderation_state not null default 'visible',
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (private.search_text(title, description)) stored,
  constraint jobs_salary_order check (salary_min <= salary_max),
  constraint jobs_salary_terms check (
    (salary_min is null and salary_max is null) or (salary_currency is not null and salary_period is not null)
  )
);

comment on table public.jobs is
  'Vacancies. Created in draft by an owner or admin; status, moderation_state, deleted_at and created_by are not client-writable.';
comment on column public.jobs.occupation_id is 'ISCO-08 unit group code (public.occupations); no free-text occupation.';
comment on column public.jobs.industry_code is 'ISIC Rev.4 section (public.industries), as for organizations.';
comment on column public.jobs.posted_on_behalf_of_organization_id is
  'Always null in Phase 1; a recruitment or staffing company names the hiring organization here in a later phase.';
comment on column public.jobs.created_by is
  'The user who created the vacancy; set by the default, null after the account is erased. Not readable through the Data API.';

-- The member read, the owner's list (keyset on created_at, id) and every policy filter on organization_id.
create index jobs_organization_created_idx on public.jobs (organization_id, created_at desc, id desc);
-- The rows the public policy shows, newest first.
create index jobs_public_created_idx on public.jobs (created_at desc, id desc)
  where status = 'open' and deleted_at is null and moderation_state = 'visible';
create index jobs_search_vector_idx on public.jobs using gin (search_vector);

alter table public.jobs enable row level security;
alter table public.jobs force row level security;

-- created_by and search_vector are not readable through the API: the first would name a person on a public page, the
-- second is read by the search function of FR-C3. posted_on_behalf_of_organization_id is not insertable (Phase 1).
grant select (
  id, organization_id, posted_on_behalf_of_organization_id, title, description, occupation_id, industry_code,
  country_code, city, employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation,
  visa_support, recruitment_preference, status, moderation_state, deleted_at, created_at
) on public.jobs to anon, authenticated;
grant insert (
  organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type,
  salary_min, salary_max, salary_currency, salary_period, accommodation, visa_support, recruitment_preference
) on public.jobs to authenticated;
grant update (
  title, description, occupation_id, industry_code, country_code, city, employment_type, salary_min, salary_max,
  salary_currency, salary_period, accommodation, visa_support, recruitment_preference
) on public.jobs to authenticated;
grant delete on public.jobs to authenticated;

create policy jobs_select_public on public.jobs
  for select to anon, authenticated
  using (status = 'open' and deleted_at is null and moderation_state = 'visible');

create policy jobs_select_member on public.jobs
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

create policy jobs_insert_admin on public.jobs
  for insert to authenticated
  with check (organization_id in (select private.member_org_ids('admin')));

create policy jobs_update_admin on public.jobs
  for update to authenticated
  using (organization_id in (select private.member_org_ids('admin')))
  with check (organization_id in (select private.member_org_ids('admin')));

create policy jobs_delete_owner on public.jobs
  for delete to authenticated
  using (organization_id in (select private.member_org_ids('owner')));

-- One audit row per created or deleted vacancy and per update that changes a column. An update records the names of the
-- changed columns, never the text, and for a status change the old and the new status, which is what the KPI
-- "vacancies published within 1 day of creation" reads. Definer rights: audit.record is not executable by API roles.
create function private.jobs_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb;
begin
  if tg_op = 'INSERT' then
    perform audit.record('job.created', 'job', new.id::text, jsonb_build_object('organization_id', new.organization_id));
  elsif tg_op = 'DELETE' then
    perform audit.record('job.deleted', 'job', old.id::text, jsonb_build_object('organization_id', old.organization_id));
  else
    v_old := to_jsonb(old) - 'search_vector';
    v_new := to_jsonb(new) - 'search_vector';
    select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from v_old -> n.key;
    if jsonb_array_length(v_changed) > 0 then
      perform audit.record(
        'job.updated', 'job', new.id::text,
        jsonb_build_object('organization_id', new.organization_id, 'changed_fields', v_changed)
          || case when new.status <> old.status
               then jsonb_build_object('status_from', old.status, 'status_to', new.status)
               else '{}'::jsonb end
      );
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.jobs_audit() from public, anon, authenticated, service_role;

create trigger jobs_audit
  after insert or update or delete on public.jobs
  for each row execute function private.jobs_audit();

alter table public.jobs enable always trigger jobs_audit;

-- The KPI "validation error rate" (FR-C1) is the share of submitted forms that were refused. The web tier reports each
-- refused submission here, with the names of the fields at fault and nothing they held; the accepted ones are the
-- job.created rows. Only an owner or admin of the organisation can report, and the ceiling per user and hour is a
-- setting, so the audit log cannot be filled through this function. Beyond the ceiling the call does nothing.
insert into private.settings (key, value) values ('job_form_invalid_per_hour_max', '120');

create index log_job_form_invalid_actor_idx on audit.log (actor_id, created_at) where action = 'job.form_invalid';

create function public.record_job_form_invalid(p_org uuid, p_fields text[]) returns void
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
     or exists (select 1 from unnest(p_fields) f where f is null or f !~ '^[A-Za-z]{1,40}$') then
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

revoke all on function public.record_job_form_invalid(uuid, text[]) from public, anon, authenticated, service_role;
grant execute on function public.record_job_form_invalid(uuid, text[]) to authenticated;
