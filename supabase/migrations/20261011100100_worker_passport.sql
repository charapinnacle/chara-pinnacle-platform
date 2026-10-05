-- Candidate profile, the CHARA Passport (FR-B1; ARCHITECTURE.md sections 4, 5; OPEN_QUESTIONS.md D13). One worker_profiles
-- row per candidate, created only by create_worker_passport and private by default; the owner reads and edits it and its
-- four child tables through the Data API under row level security. Nothing here stores an identity number, a date of
-- birth, an age, a nationality, a gender, a religion or a marital status: work authorisation is a country and an optional
-- expiry date (NFR-C1). Employers see a candidate only through the application snapshot (FR-B3, a later unit), staff and
-- service_role have no path to these tables.

create type public.worker_availability as enum ('now', 'from_date', 'unavailable');
create type public.cefr_level as enum ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- Proposed defaults, owner-changeable data: the list limits and the date windows (FR-B1 open points).
insert into private.settings (key, value) values
  ('worker_skills_max', '30'),
  ('worker_languages_max', '15'),
  ('worker_preferred_countries_max', '20'),
  ('availability_window_months', '24'),
  ('work_authorization_expiry_max_years', '50');

-- A name is trimmed and made of letters, combining marks, spaces, hyphens, apostrophes and full stops, starting with a
-- letter or a mark. The letters and marks are explicit code point ranges (Latin, Greek, Cyrillic, Hebrew, Arabic, the
-- Indic and South-East Asian scripts, kana, Han, Hangul and the supplementary planes without emoji) rather than a POSIX
-- class, so the rule does not depend on the locale of the database. The web tier applies the same rule with Unicode
-- property classes.
create function private.is_person_name(p_name text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name = btrim(p_name) and length(p_name) between 1 and 80
    and p_name ~ '^[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u1fff\u2c00-\u2dff\u3005-\u3007\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ud7ff\uf900-\ufdff\ufe20-\ufe2f\ufe70-\ufeff\uff21-\uff3a\uff41-\uff5a\uff66-\uffdc\U00010000-\U0001efff\U00020000-\U0003ffff][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u1fff\u2c00-\u2dff\u3005-\u3007\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ud7ff\uf900-\ufdff\ufe20-\ufe2f\ufe70-\ufeff\uff21-\uff3a\uff41-\uff5a\uff66-\uffdc\U00010000-\U0001efff\U00020000-\U0003ffff ''’.-]*$'
$$;

revoke all on function private.is_person_name(text) from public, anon, authenticated, service_role;
grant execute on function private.is_person_name(text) to authenticated;

create table public.worker_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  first_name text not null check (private.is_person_name(first_name)),
  last_name text not null check (private.is_person_name(last_name)),
  headline text check (
    headline = btrim(headline) and length(headline) between 1 and 120 and headline !~ '[[:cntrl:]]'
  ),
  current_country text not null references public.countries (code),
  occupation_id text references public.occupations (code),
  years_experience smallint check (years_experience between 0 and 60),
  availability public.worker_availability,
  available_from date,
  searchable boolean not null default false check (not searchable),
  created_at timestamptz not null default now(),
  check (coalesce(availability = 'from_date', false) = (available_from is not null))
);

comment on table public.worker_profiles is
  'The candidate passport. Created only by create_worker_passport; searchable stays false in Phase 1.';
comment on column public.worker_profiles.occupation_id is 'ISCO-08 unit group code; no free-text occupation.';
comment on column public.worker_profiles.available_from is
  'Set exactly when availability is from_date; checked against the availability window when either column changes.';

create table public.worker_skills (
  id uuid primary key default gen_random_uuid(),
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  skill text not null check (skill = btrim(skill) and length(skill) between 1 and 50 and skill !~ '[[:cntrl:]]')
);

create unique index worker_skills_candidate_skill on public.worker_skills (worker_user_id, lower(skill));

create table public.worker_languages (
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  language_code text not null references public.languages (code),
  cefr_level public.cefr_level not null,
  primary key (worker_user_id, language_code)
);

create table public.worker_preferred_countries (
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  country_code text not null references public.countries (code),
  primary key (worker_user_id, country_code)
);

create table public.worker_work_authorizations (
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  country_code text not null references public.countries (code),
  expires_on date,
  primary key (worker_user_id, country_code)
);

comment on column public.worker_work_authorizations.expires_on is 'Null means the right to work does not expire.';

-- Definer rights: the count must see all of the candidate's rows and the lock must not depend on the caller's policies.
-- Locking the profile row serialises concurrent inserts of one candidate, so the limit cannot be passed by a race.
create function private.worker_list_limit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = tg_argv[0]);
  v_count integer;
begin
  perform 1 from public.worker_profiles p where p.user_id = new.worker_user_id for no key update;
  execute format('select count(*) from %I.%I where worker_user_id = $1', tg_table_schema, tg_table_name)
    into v_count using new.worker_user_id;
  if v_count >= v_max then
    raise exception 'CHARA_LIMIT_REACHED' using detail = tg_table_name;
  end if;
  return new;
end;
$$;

revoke all on function private.worker_list_limit() from public, anon, authenticated, service_role;

create trigger worker_skills_limit before insert on public.worker_skills
  for each row execute function private.worker_list_limit('worker_skills_max');
create trigger worker_languages_limit before insert on public.worker_languages
  for each row execute function private.worker_list_limit('worker_languages_max');
create trigger worker_preferred_countries_limit before insert on public.worker_preferred_countries
  for each row execute function private.worker_list_limit('worker_preferred_countries_max');

alter table public.worker_skills enable always trigger worker_skills_limit;
alter table public.worker_languages enable always trigger worker_languages_limit;
alter table public.worker_preferred_countries enable always trigger worker_preferred_countries_limit;

-- The window is checked when the date or the availability changes, never for an unrelated edit of a profile whose date has
-- since passed. Dates are UTC. Definer rights only to read the settings, which the API roles cannot.
create function private.worker_profiles_check_available_from() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_months integer := (select (value #>> '{}')::integer from private.settings where key = 'availability_window_months');
begin
  if tg_op = 'UPDATE'
     and new.availability is not distinct from old.availability
     and new.available_from is not distinct from old.available_from then
    return new;
  end if;
  if new.available_from is not null
     and new.available_from not between v_today and (v_today + make_interval(months => v_months))::date then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'available_from';
  end if;
  return new;
end;
$$;

revoke all on function private.worker_profiles_check_available_from() from public, anon, authenticated, service_role;

create trigger worker_profiles_check_available_from
  before insert or update of availability, available_from on public.worker_profiles
  for each row execute function private.worker_profiles_check_available_from();

alter table public.worker_profiles enable always trigger worker_profiles_check_available_from;

create function private.worker_authorizations_check_expiry() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_years integer := (select (value #>> '{}')::integer from private.settings where key = 'work_authorization_expiry_max_years');
begin
  if tg_op = 'UPDATE' and new.expires_on is not distinct from old.expires_on then
    return new;
  end if;
  if new.expires_on is not null
     and new.expires_on not between v_today and (v_today + make_interval(years => v_years))::date then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'expires_on';
  end if;
  return new;
end;
$$;

revoke all on function private.worker_authorizations_check_expiry() from public, anon, authenticated, service_role;

create trigger worker_authorizations_check_expiry
  before insert or update of expires_on on public.worker_work_authorizations
  for each row execute function private.worker_authorizations_check_expiry();

alter table public.worker_work_authorizations enable always trigger worker_authorizations_check_expiry;

alter table public.worker_profiles enable row level security;
alter table public.worker_profiles force row level security;
alter table public.worker_skills enable row level security;
alter table public.worker_skills force row level security;
alter table public.worker_languages enable row level security;
alter table public.worker_languages force row level security;
alter table public.worker_preferred_countries enable row level security;
alter table public.worker_preferred_countries force row level security;
alter table public.worker_work_authorizations enable row level security;
alter table public.worker_work_authorizations force row level security;

-- user_id, searchable and created_at have no update grant, and nobody can insert or delete a profile row: it is created by
-- create_worker_passport and removed with the account. Delete is granted but no policy allows it, so an attempt reaches no
-- row instead of failing, the same answer an update of another candidate's row gets. A child row can never be moved to another candidate: worker_user_id
-- has no update grant either.
grant select, delete on public.worker_profiles to authenticated;
grant update (first_name, last_name, headline, current_country, occupation_id, years_experience, availability, available_from)
  on public.worker_profiles to authenticated;
grant select, insert, delete on public.worker_skills, public.worker_languages,
  public.worker_preferred_countries, public.worker_work_authorizations to authenticated;
grant update (skill) on public.worker_skills to authenticated;
grant update (language_code, cefr_level) on public.worker_languages to authenticated;
grant update (country_code) on public.worker_preferred_countries to authenticated;
grant update (country_code, expires_on) on public.worker_work_authorizations to authenticated;

create policy worker_profiles_select_own on public.worker_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy worker_profiles_update_own on public.worker_profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy worker_skills_select_own on public.worker_skills
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_skills_insert_own on public.worker_skills
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_skills_update_own on public.worker_skills
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_skills_delete_own on public.worker_skills
  for delete to authenticated using (worker_user_id = (select auth.uid()));

create policy worker_languages_select_own on public.worker_languages
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_languages_insert_own on public.worker_languages
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_languages_update_own on public.worker_languages
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_languages_delete_own on public.worker_languages
  for delete to authenticated using (worker_user_id = (select auth.uid()));

create policy worker_preferred_countries_select_own on public.worker_preferred_countries
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_preferred_countries_insert_own on public.worker_preferred_countries
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_preferred_countries_update_own on public.worker_preferred_countries
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_preferred_countries_delete_own on public.worker_preferred_countries
  for delete to authenticated using (worker_user_id = (select auth.uid()));

create policy worker_work_authorizations_select_own on public.worker_work_authorizations
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_work_authorizations_insert_own on public.worker_work_authorizations
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_work_authorizations_update_own on public.worker_work_authorizations
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_work_authorizations_delete_own on public.worker_work_authorizations
  for delete to authenticated using (worker_user_id = (select auth.uid()));

-- Creates the caller's passport once: the caller must hold an active worker account. A second call fails on the primary
-- key (unique_violation). English is the only interface language in Phase 1. The audit row carries no name.
create function public.create_worker_passport(
  p_first_name text,
  p_last_name text,
  p_current_country text,
  p_preferred_lang text default 'en'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid for no key update;
  if not found or v_profile.account_kind is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;
  if p_preferred_lang is distinct from 'en' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'preferred_lang';
  end if;

  insert into public.worker_profiles (user_id, first_name, last_name, current_country)
  values (v_uid, btrim(p_first_name), btrim(p_last_name), p_current_country);
  update public.profiles set preferred_lang = p_preferred_lang where id = v_uid;

  perform audit.record('passport.created', 'worker_profiles', v_uid::text);
end;
$$;

revoke all on function public.create_worker_passport(text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_worker_passport(text, text, text, text) to authenticated;
