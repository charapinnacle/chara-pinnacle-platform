-- A Filled vacancy is final (FR-C2 "Filled — final; no further change"; OPEN_QUESTIONS.md D78). The transition guard
-- already refuses any change of its status; this trigger refuses a change of the content columns that owners and admins
-- may update, so the edit page and a direct Data API call stop at the same rule. Moderation, suspension and the soft
-- delete write other columns and are not affected.
create function private.jobs_guard_filled() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CHARA_INVALID_TRANSITION' using detail = 'filled';
end;
$$;

revoke all on function private.jobs_guard_filled() from public, anon, authenticated, service_role;

create trigger jobs_guard_filled
  before update of
    title, description, occupation_id, industry_code, country_code, city, employment_type, salary_min, salary_max,
    salary_currency, salary_period, accommodation, visa_support, recruitment_preference
  on public.jobs
  for each row when (old.status = 'filled')
  execute function private.jobs_guard_filled();

alter table public.jobs enable always trigger jobs_guard_filled;
