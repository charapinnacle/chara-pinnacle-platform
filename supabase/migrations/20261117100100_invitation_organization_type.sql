-- Partners join only organisations of their own type (FR-J1, FR-A5; docs/phase-2/DATA_MODEL.md section 4). A company
-- account that signed up as a recruitment or staffing company has no employer onboarding and no employer pages, and an
-- employer account has no partner onboarding: accepting an invitation of the other type would leave the account between
-- the two journeys. accept_invitation (20261008100000) therefore refuses an invitation whose organisation type differs
-- from the intended organisation type of the account (null meaning employer), with the detail organization_type_mismatch.
create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_email text;
  v_invitation public.organization_invitations;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid;
  if not found or v_profile.account_kind is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if v_profile.account_kind <> 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'workers_cannot_join_organizations';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'email_unconfirmed';
  end if;

  select * into v_invitation
  from public.organization_invitations i
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  for update;
  if not found or not private.invitation_is_open(v_invitation) or v_invitation.email <> v_email::extensions.citext then
    raise exception 'CHARA_INVITATION_INVALID';
  end if;
  if (select o.type from public.organizations o where o.id = v_invitation.organization_id)
     <> coalesce(v_profile.intended_organization_type, 'employer') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_type_mismatch';
  end if;
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = v_invitation.organization_id and m.user_id = v_uid
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'already_a_member';
  end if;

  insert into public.organization_members (organization_id, user_id, role, invited_by, accepted_at)
  values (v_invitation.organization_id, v_uid, v_invitation.role, v_invitation.invited_by, now());
  update public.organization_invitations set accepted_at = now() where id = v_invitation.id;

  perform audit.record(
    'invitation_accepted', 'organization_invitation', v_invitation.id::text,
    jsonb_build_object('organization_id', v_invitation.organization_id, 'role', v_invitation.role)
  );
  return v_invitation.organization_id;
end;
$$;
