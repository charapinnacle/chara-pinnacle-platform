-- Workforce requirements (FR-M1, SOP P2-15; docs/phase-2/DATA_MODEL.md sections 2, 5, 6, 7 and 10, release 2b). An
-- employer describes one need for a group of workers once: how many, where, in which industry, one to ten occupations
-- with quantities that add up to the number of workers, and the terms. A requirement is not a vacancy: no candidate reads
-- or applies to it [d3.1]. It is saved as a draft by an owner or admin at aal2 through save_requirement, the only writer;
-- members of the employer read it, partners only through the job order functions of V39 and V41, workers and anonymous
-- callers never. Occupations and destination countries are rows of their own, each a foreign key to its code list
-- (NFR-M3). Nothing here stores a gender, an age, a nationality or another characteristic of a person, and wording that
-- asks for one is refused against private.prohibited_terms. Publishing, the lifecycle and the reminders are V33, the
-- active_requirements limit at publish and several destinations V34, linked vacancies V35, partner suggestions V36,
-- versions and change notices V43, moderation V57. Everything here is refused while release_job_orders is false.

create type public.requirement_status as enum ('draft', 'open', 'paused', 'closed', 'filled');
-- The two publishing channels of decision 3.1: private means the partners the employer invites, and nobody else.
create type public.requirement_visibility as enum ('private', 'job_order_marketplace');
create type public.partner_need as enum ('none', 'recruitment', 'staffing', 'both');

create table public.workforce_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  title text not null check (title = btrim(title) and char_length(title) between 1 and 120 and title !~ '[[:cntrl:]]'),
  workers_needed integer not null check (workers_needed between 1 and 100000),
  country_code text not null references public.countries (code),
  city_region text not null check (
    city_region = btrim(city_region) and char_length(city_region) between 1 and 100 and city_region !~ '[[:cntrl:]]'
  ),
  industry_code text not null references public.industries (code),
  skills text check (
    skills = btrim(skills)
    and char_length(skills) between 1 and 1000
    and skills !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  ),
  experience_years smallint check (experience_years between 0 and 50),
  start_date date not null,
  duration_months smallint check (duration_months between 1 and 120),
  employment_type public.employment_type not null,
  salary_min numeric(12, 2) check (salary_min between 0 and 9999999.99),
  salary_max numeric(12, 2) check (salary_max between 0 and 9999999.99),
  salary_currency text references public.currencies (code),
  salary_period public.salary_period,
  accommodation boolean not null default false,
  work_permit_support boolean not null default false,
  visa_support boolean not null default false,
  recruitment_preference public.recruitment_preference not null,
  partner_need public.partner_need not null,
  status public.requirement_status not null default 'draft',
  visibility public.requirement_visibility,
  show_identity boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_requirements_salary_order check (salary_min <= salary_max),
  constraint workforce_requirements_salary_terms check (
    (salary_min is null and salary_max is null) or (salary_currency is not null and salary_period is not null)
  ),
  constraint workforce_requirements_draft_visibility check (status <> 'draft' or visibility is null)
);

comment on table public.workforce_requirements is
  'Workforce requirements of employers, FR-M1. Members of the employer read them; partners only through the job order functions; workers and anonymous callers never. Written only by save_requirement (and the lifecycle functions of V33).';
comment on column public.workforce_requirements.title is
  'Optional in the form; save_requirement writes one from the number of workers, the occupations and the place when it is empty.';
comment on column public.workforce_requirements.visibility is
  'Null while draft; private (invited partners only) or job_order_marketplace from publishing on (V33, decision 3.1).';
comment on column public.workforce_requirements.show_identity is
  'The employer name is shown on the job order board only when true; anonymous by default (decision 3.2, V39).';
comment on column public.workforce_requirements.created_by is
  'The member who created the requirement; set by the default, null after the account is erased. Not readable through the Data API.';

-- The member list (keyset on created_at, id) and the policy filter on organization_id; the count of open requirements of
-- the active_requirements limit; the erasure of a creator.
create index workforce_requirements_organization_created_idx
  on public.workforce_requirements (organization_id, created_at desc, id desc);
create index workforce_requirements_organization_status_idx on public.workforce_requirements (organization_id, status);
create index workforce_requirements_created_by_idx on public.workforce_requirements (created_by) where created_by is not null;

alter table public.workforce_requirements enable row level security;
alter table public.workforce_requirements force row level security;
revoke all on table public.workforce_requirements from public, anon, authenticated, service_role;
grant select (
  id, organization_id, title, workers_needed, country_code, city_region, industry_code, skills, experience_years,
  start_date, duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation,
  work_permit_support, visa_support, recruitment_preference, partner_need, status, visibility, show_identity, created_at,
  updated_at
) on public.workforce_requirements to authenticated;

create policy workforce_requirements_select_member on public.workforce_requirements
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- One row per occupation of a requirement; save_requirement checks that the quantities add up to workers_needed.
create table public.requirement_occupations (
  requirement_id uuid not null references public.workforce_requirements (id) on delete cascade,
  occupation_id text not null references public.occupations (code),
  quantity integer not null check (quantity between 1 and 100000),
  primary key (requirement_id, occupation_id)
);

comment on table public.requirement_occupations is
  'The ISCO-08 occupations of a requirement with their quantities (1 to 10 rows, summing to workers_needed). Read as the requirement.';

create index requirement_occupations_occupation_idx on public.requirement_occupations (occupation_id);

alter table public.requirement_occupations enable row level security;
alter table public.requirement_occupations force row level security;
revoke all on table public.requirement_occupations from public, anon, authenticated, service_role;
grant select on public.requirement_occupations to authenticated;

create policy requirement_occupations_select_member on public.requirement_occupations
  for select to authenticated
  using (requirement_id in (
    select r.id from public.workforce_requirements r where r.organization_id in (select private.member_org_ids())
  ));

-- The destination countries of a requirement: always the row of workforce_requirements.country_code, written with it;
-- further destinations need the feature multi_country_requirements and arrive with V34.
create table public.requirement_countries (
  requirement_id uuid not null references public.workforce_requirements (id) on delete cascade,
  country_code text not null references public.countries (code),
  primary key (requirement_id, country_code)
);

comment on table public.requirement_countries is
  'The destination countries of a requirement, the main one included. Read as the requirement.';

create index requirement_countries_country_idx on public.requirement_countries (country_code);

alter table public.requirement_countries enable row level security;
alter table public.requirement_countries force row level security;
revoke all on table public.requirement_countries from public, anon, authenticated, service_role;
grant select on public.requirement_countries to authenticated;

create policy requirement_countries_select_member on public.requirement_countries
  for select to authenticated
  using (requirement_id in (
    select r.id from public.workforce_requirements r where r.organization_id in (select private.member_org_ids())
  ));

-- Prohibited criteria ----------------------------------------------------------------------------------------------------

-- Wording that asks for a personal characteristic (FR-M1 AC7; SOP risk "discriminatory requirements"). Each pattern is
-- a POSIX regular expression matched against private.fold_text of the text, so it is written in lower case without
-- accents (the word-end escape \M aside). The last part of the check compiles the pattern, so a row that is not a valid expression is refused (2201B)
-- instead of breaking every later save. No API role reads the list; it complements moderation (FR-S1), it does not
-- replace it.
create table private.prohibited_terms (
  id smallint generated always as identity primary key,
  pattern text not null unique check (
    pattern = btrim(pattern) and char_length(pattern) between 1 and 300
    and replace(pattern, '\M', '') = private.fold_text(replace(pattern, '\M', ''))
    and ('' ~ pattern) is not null
  ),
  label text not null check (label ~ '^[a-z][a-z_]{1,39}$'),
  created_at timestamptz not null default now()
);

comment on table private.prohibited_terms is
  'Patterns of wording that asks for gender, age, nationality or another personal characteristic, refused in requirements (FR-M1 AC7). Maintained by Trust & Safety through migrations.';

alter table private.prohibited_terms enable row level security;
alter table private.prohibited_terms force row level security;
revoke all on table private.prohibited_terms from public, anon, authenticated, service_role;

insert into private.prohibited_terms (pattern, label) values
  ('\m(males?|females?|men|women|man|woman|ladies|gents)\s+only\M', 'gender'),
  ('\monly\s+(males?|females?|men|women|ladies)\M', 'gender'),
  ('\mno\s+(males?|females?|men|women|ladies)\M', 'gender'),
  ('\m(gender|sex)\M', 'gender'),
  ('\m(under|below|younger than|older than)\s+\d{1,2}\s*(years?|yrs?)\M', 'age'),
  ('\m\d{1,2}\s*(years?|yrs?)\s+(old|of age)\M', 'age'),
  ('\m(aged?|age limit|age:)\s*\d', 'age'),
  ('\m(young|younger|old|older)\s+(workers?|candidates?|people|persons?|applicants?|men|women)\M', 'age'),
  ('\mnationalit(y|ies)\M', 'nationality'),
  ('\m(citizens?|nationals)\s+only\M', 'nationality'),
  ('\m(religion|religious)\M', 'religion'),
  ('\m(muslims?|christians?|hindus?|jews|jewish|buddhists?|sikhs?)\M', 'religion'),
  ('\m(marital status|married|unmarried|divorced|widowed)\M', 'marital_status'),
  ('\m(ethnic|ethnicity|race|racial|skin colou?r|caste)\M', 'ethnicity'),
  ('\m(pregnant|pregnancy|childless|no children)\M', 'pregnancy'),
  ('\m(date of birth|birth date|dob)\M', 'date_of_birth'),
  ('\m(with|send|attach)\s+(an?\s+)?(photo|photograph|picture)\M', 'photo'),
  ('\m(photo|photograph|picture)\s+(required|needed|attached)\M', 'photo'),
  ('\m(id|identity|passport)\s+(card\s+)?number\M', 'identity_number'),
  ('\m(disabled|disability|handicapped)\M', 'disability');

-- The label of the first prohibited pattern the text matches, null when none does (or the text is null).
create function private.prohibited_criterion(p_text text) returns text
language sql
stable
set search_path = ''
as $$
  select t.label from private.prohibited_terms t
  where p_text is not null and private.fold_text(p_text) ~ t.pattern
  order by t.id
  limit 1
$$;

revoke all on function private.prohibited_criterion(text) from public, anon, authenticated, service_role;

-- Saving ------------------------------------------------------------------------------------------------------------------

-- An owner or admin at aal2 of an active employer, release 2b only. A recruitment or staffing company posts no
-- requirement (CHARA_FORBIDDEN employer_only).
create function private.assert_requirement_manager(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.release_on('release_job_orders') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  perform private.assert_org_manager(p_org, 'admin');
  if private.org_type(p_org) <> 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'employer_only';
  end if;
end;
$$;

revoke all on function private.assert_requirement_manager(uuid) from public, anon, authenticated, service_role;

-- Creates a draft (p_requirement null) or changes a requirement of p_org that is not closed or filled (FR-M1 AC1 to AC7).
-- The organisation comes from the caller; status, visibility, created_by and the dates are not parameters. Refusals:
-- a start date before today (UTC) or more than three years ahead, CHARA_INVALID_INPUT start_date (an unchanged start
-- date of an existing requirement is kept); occupations not an array of 1 to 10 distinct {occupation_id, quantity},
-- CHARA_INVALID_INPUT occupations; quantities that do not add up to workers_needed, CHARA_INVALID_INPUT
-- occupation_quantities; prohibited wording in the title, the skills or the city or region, CHARA_INVALID_INPUT
-- prohibited_criterion:<field>; values outside the column checks 23514 and codes outside the lists 23503, both named by
-- their constraint. Everything is written in one transaction with one audit row: requirement.created, or
-- requirement.updated with the names of the changed fields (never their values) when something changed. Each save counts
-- against the daily quota of audited writes (CHARA_RATE_LIMITED).
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
  p_salary_period public.salary_period default null
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
  v_old_occupations jsonb := '[]';
  v_new_occupations jsonb;
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
      raise exception 'CHARA_INVALID_TRANSITION' using detail = v_old.status::text;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('occupation_id', o.occupation_id, 'quantity', o.quantity)
             order by o.occupation_id), '[]')
    into v_old_occupations
    from public.requirement_occupations o where o.requirement_id = p_requirement;
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

  foreach v_field in array array['title', 'skills', 'city_region'] loop
    v_criterion := private.prohibited_criterion(case v_field when 'title' then v_title when 'skills' then v_skills else v_city end);
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
        recruitment_preference = p_recruitment_preference, partner_need = p_partner_need
    where r.id = p_requirement
    returning * into v_new;
    delete from public.requirement_occupations o where o.requirement_id = p_requirement;
    if v_old.country_code <> v_new.country_code then
      delete from public.requirement_countries c
      where c.requirement_id = p_requirement and c.country_code = v_old.country_code;
    end if;
  end if;

  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select v_new.id, e ->> 'occupation_id', (e ->> 'quantity')::integer
  from jsonb_array_elements(v_new_occupations) e;
  insert into public.requirement_countries (requirement_id, country_code) values (v_new.id, v_new.country_code)
  on conflict do nothing;

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
  if jsonb_array_length(v_changed) > 0 then
    update public.workforce_requirements r set updated_at = now() where r.id = v_new.id;
    perform audit.record('requirement.updated', 'requirement', v_new.id::text,
      jsonb_build_object('organization_id', p_org, 'changed_fields', v_changed));
  end if;
  return v_new.id;
end;
$$;

revoke all on function public.save_requirement(
  uuid, integer, text, text, text, jsonb, date, public.employment_type, public.recruitment_preference, public.partner_need,
  boolean, boolean, boolean, uuid, text, text, smallint, smallint, numeric, numeric, text, public.salary_period
) from public, anon, authenticated, service_role;
grant execute on function public.save_requirement(
  uuid, integer, text, text, text, jsonb, date, public.employment_type, public.recruitment_preference, public.partner_need,
  boolean, boolean, boolean, uuid, text, text, smallint, smallint, numeric, numeric, text, public.salary_period
) to authenticated;

-- Usage and reference data --------------------------------------------------------------------------------------------

-- 20261125100000_partner_usage_helpers.sql with one change: active_requirements counts the open requirements of the
-- organisation (hidden ones included once moderation exists, V57), as the publish check of V34 will count them.
create or replace function private.limit_usage(p_org uuid, p_limit_key text) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit_key = 'active_jobs' then
    return (select count(*)::integer from public.jobs j
            where j.organization_id = p_org and j.status = 'open' and j.deleted_at is null);
  elsif p_limit_key = 'members' then
    return private.team_size(p_org);
  elsif p_limit_key = 'markets' then
    return (select count(*)::integer from public.organization_geographies g
            where g.organization_id = p_org and g.scope = 'serves_market');
  elsif p_limit_key = 'listed_occupations' then
    return (select count(*)::integer from public.organization_occupations o where o.organization_id = p_org);
  elsif p_limit_key = 'workforce_listings' then
    return (select count(*)::integer from public.workforce_availability w where w.organization_id = p_org);
  elsif p_limit_key = 'active_requirements' then
    return (select count(*)::integer from public.workforce_requirements r
            where r.organization_id = p_org and r.status = 'open');
  end if;
  return private.monthly_usage(p_org, p_limit_key);
end;
$$;

revoke all on function private.limit_usage(uuid, text) from public, anon, authenticated, service_role;

-- The deployment check of 20261202100000 with the prohibited terms among the reference tables: without them the wording
-- check of save_requirement lets everything through.
create or replace function private.missing_reference_data()
returns table (kind text, name text)
language sql
stable
set search_path = ''
as $$
  select 'legal_document', d.slug
  from unnest(array[
    'terms-of-service', 'privacy-policy', 'cookie-policy', 'platform-rules', 'acceptable-use-policy',
    'subscription-and-billing-terms', 'employer-terms', 'worker-terms', 'complaints-and-dispute-process',
    'account-suspension-and-termination-rules', 'sharing-notice', 'age-18-plus',
    'partner-terms', 'recruitment-company-terms', 'staffing-company-terms', 'employer-pays-commitment', 'partner-dpa',
    'worker-visibility-consent', 'immigration-disclaimer'
  ]) as d (slug)
  where private.current_legal_version(d.slug) is null
  union all
  select 'reference_table', t.name
  from (values
    ('public.countries', not exists (select 1 from public.countries)),
    ('public.languages', not exists (select 1 from public.languages)),
    ('public.currencies', not exists (select 1 from public.currencies)),
    ('public.industries', not exists (select 1 from public.industries)),
    ('public.occupations', not exists (select 1 from public.occupations)),
    ('public.cities', not exists (select 1 from public.cities)),
    ('billing.plans', not exists (select 1 from billing.plans)),
    ('private.prohibited_terms', not exists (select 1 from private.prohibited_terms))
  ) as t (name, empty)
  where t.empty
  union all
  select 'setting', k.key
  from (
    select m[1] as key
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral regexp_matches(p.prosrc, '\mkey\s*=\s*''([a-z0-9_]*[a-z0-9])''', 'g') as m
    where n.nspname in ('public', 'private', 'billing', 'audit', 'stats')
    union
    select (regexp_match(encode(t.tgargs, 'escape'), '^([a-z0-9_]+)\\000'))[1]
    from pg_catalog.pg_trigger t
    where t.tgfoid = 'private.worker_list_limit()'::regprocedure
    union
    select 'rate_limit_' || a || s
    from unnest(array['signup', 'resend', 'login', 'forgot_password', 'reset_password', 'mfa_code', 'report', 'partner_profile',
                      'partner_search', 'document_access']) as a
    cross join unnest(array['_max', '_seconds']) as s
  ) as k
  where not exists (select 1 from private.settings st where st.key = k.key)
  union all
  select 'vault_secret', 'rate_limit_proof_key'
  where not exists (select 1 from vault.secrets v where v.name = 'rate_limit_proof_key')
  order by 1, 2
$$;
