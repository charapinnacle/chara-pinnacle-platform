-- Vacancies belong to employers (FR-C1, FR-J1; docs/phase-2/DATA_MODEL.md section 3). Partner organisations reuse
-- public.organizations, so the insert policy of public.jobs (any organisation where the caller is an admin) would let a
-- recruitment or staffing company publish vacancies; the partner features of later units are job orders and workforce
-- listings, not vacancies. This trigger refuses a vacancy of any organisation that is not an employer, whatever function
-- or role writes it.
create function private.jobs_employer_only() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organizations o where o.id = new.organization_id and o.type = 'employer'
  ) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_not_employer';
  end if;
  return new;
end;
$$;

revoke all on function private.jobs_employer_only() from public, anon, authenticated, service_role;

create trigger jobs_employer_only
  before insert or update of organization_id on public.jobs
  for each row execute function private.jobs_employer_only();

alter table public.jobs enable always trigger jobs_employer_only;
