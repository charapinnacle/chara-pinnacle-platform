-- A vacancy is not published without its city (FR-M1 AC10, NFR-S11; V39 review item 1). The draft vacancies copied from
-- an anonymous job order carry the city '-' (20261223100000_anonymous_vacancy_copies.sql): jobs.city is required, and
-- '-' is the nearest to empty its check accepts. Such a draft may be saved as it is, but it becomes Open (published,
-- reopened, or edited while open) only with a real city, so no public vacancy shows '-' and the employer has to choose
-- what the vacancy says instead of the job order's city. The refusal is CHARA_INVALID_INPUT with the detail city, which
-- the vacancy pages show as "Enter the city of the vacancy."
--
-- A trigger of its own beside private.jobs_guard_transition (20261017100000), which stays as it is: the guard decides
-- which status change is allowed and who may make it, and fires first (triggers fire in name order), so a caller who
-- may not change the status is still told so. Like the guard it fires whoever writes, the database owner included.

create function private.jobs_require_city() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'CHARA_INVALID_INPUT' using detail = 'city';
end;
$$;

revoke all on function private.jobs_require_city() from public, anon, authenticated, service_role;

-- An insert, and an update only when it changes the status or the city: an open vacancy that somehow kept '-' (written
-- before this migration) can still have its title or text corrected.
create trigger jobs_require_city_insert
  before insert on public.jobs
  for each row when (new.status = 'open' and new.city = '-')
  execute function private.jobs_require_city();

create trigger jobs_require_city
  before update of status, city on public.jobs
  for each row when (new.status = 'open' and new.city = '-'
    and (old.city is distinct from new.city or old.status is distinct from new.status))
  execute function private.jobs_require_city();

alter table public.jobs enable always trigger jobs_require_city_insert;
alter table public.jobs enable always trigger jobs_require_city;
