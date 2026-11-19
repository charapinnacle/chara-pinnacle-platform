-- The directory addresses /[lang]/partners/recruitment (FR-L1) and /[lang]/partners/staffing (FR-L2) share their path
-- with the public profiles /[lang]/partners/[slug] (FR-K4), and the directory wins, so no organisation may take one of
-- the two slugs. The refusal is a unique_violation, the error create_organization already answers with the next slug
-- (a short random suffix), so a company called "Recruitment" still signs up, as recruitment-1a2b3c.

create function private.organizations_reserved_slug() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug in ('recruitment', 'staffing') then
    raise exception 'CHARA_CONFLICT' using errcode = 'unique_violation', detail = 'slug';
  end if;
  return new;
end;
$$;

revoke all on function private.organizations_reserved_slug() from public, anon, authenticated, service_role;

create trigger organizations_reserved_slug
  before insert or update of slug on public.organizations
  for each row execute function private.organizations_reserved_slug();
alter table public.organizations enable always trigger organizations_reserved_slug;
