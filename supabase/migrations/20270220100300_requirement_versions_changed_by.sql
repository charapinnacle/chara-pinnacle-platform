-- The change history of a requirement read "by A member of your company" whenever the member had no display name, which
-- is most accounts. Owners and admins at aal2 already see their colleagues' email addresses on the team page, so they now
-- see the email of a current member without a name; anyone else still reads the neutral text. list_requirement_versions
-- of 20261229100100_requirement_versions.sql with that one change; grants are kept.
create or replace function public.list_requirement_versions(p_org uuid, p_requirement uuid)
returns table (
  version integer,
  created_at timestamptz,
  status public.requirement_status,
  changed_fields text[],
  old_values jsonb,
  new_values jsonb,
  changed_by_member boolean,
  changed_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_manager boolean;
begin
  perform private.assert_invitation_employer(p_org);
  if not exists (select 1 from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_manager := private.is_org_member(p_org, 'admin') and private.is_aal2();
  return query
  select v.version, v.created_at, v.status, v.changed_fields, v.old_values, v.new_values, v.changed_by is not null,
    coalesce(nullif(btrim(p.display_name), ''), case when v_manager and exists (
      select 1 from public.organization_members m
      where m.organization_id = p_org and m.user_id = v.changed_by and m.accepted_at is not null
    ) then u.email::text end)
  from public.requirement_versions v
  left join public.profiles p on p.id = v.changed_by
  left join auth.users u on u.id = v.changed_by
  where v.requirement_id = p_requirement and v.organization_id = p_org
  order by v.version desc;
end;
$$;
