-- The company behind a public profile or page, for Save partner and Follow (FR-L4 AC9, FR-K5 AC8). get_partner_profile
-- and get_company_page return what a visitor reads and no id; the buttons of a signed-in viewer need the id and the type
-- to call toggle_saved_partner and toggle_follow. Answers one row for a public partner or an employer whose page is on,
-- none otherwise; the id of a public company is no secret (search_partners returns it to everyone).
create function public.connection_target(p_slug text)
returns table (organization_id uuid, organization_type public.organization_type)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    return;
  end if;
  return query
  select o.id, o.type from public.organizations o where o.slug = p_slug and private.is_followable(o.id);
end;
$$;

revoke all on function public.connection_target(text) from public, anon, authenticated, service_role;
grant execute on function public.connection_target(text) to authenticated;
