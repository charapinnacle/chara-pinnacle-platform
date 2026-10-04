-- Team membership (FR-A5; ARCHITECTURE.md sections 4, 5.5, 6.3, 8, 10.4; OPEN_QUESTIONS.md D10, D38). Completes the member RPCs
-- of the organizations migration: invitations are rate limited and counted against the member limit, ownership moves in
-- two steps (the owner designates, the designated member confirms), removing a member queues the sign-out, and the team
-- page gets names, a preview of an invitation for the invitee and the member allowance.

insert into private.settings (key, value) values
  ('entitlements_enforced', 'false'),
  ('invitations_per_hour_max', '20');

-- The billing schema does not exist yet (FR-G1). Until its migration replaces the two functions below with lookups of
-- billing.plan_limits and the organization's plan, no subscription can exist, so every organization is on the fallback
-- plan, whose member limit counts the owner (OPEN_QUESTIONS.md C11, C12): 1. The billing migration must insert
-- entitlements_enforced with on conflict do nothing.
create function private.org_limit(p_org uuid, p_key text) returns integer
language sql
stable
set search_path = ''
as $$ select case p_key when 'members' then 1 end $$;

create function private.assert_within_limit(p_org uuid, p_key text, p_current integer) returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if not coalesce((select (value #>> '{}')::boolean from private.settings where key = 'entitlements_enforced'), false) then
    return;
  end if;
  v_limit := private.org_limit(p_org, p_key);
  if v_limit is not null and p_current >= v_limit then
    raise exception 'CHARA_LIMIT_REACHED' using detail = p_key;
  end if;
end;
$$;

revoke all on function private.org_limit(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.assert_within_limit(uuid, text, integer) from public, anon, authenticated, service_role;


-- The invitations per hour are counted in the audit log, which keeps a row for an invitation that a re-invitation has
-- replaced; the partial index keeps the count to the rows of one organization within the hour.
create index log_member_invited_org_idx on audit.log ((metadata ->> 'organization_id'), created_at)
  where action = 'member_invited';

-- An invitation can be accepted while it is unused, unexpired, its organization is active and the person who issued it
-- still is an owner or admin there: removing or demoting the inviter ends the link (there is no revoke action).
create function private.invitation_is_open(p_invitation public.organization_invitations) returns boolean
language sql
stable
set search_path = ''
as $$
  select p_invitation.accepted_at is null
    and p_invitation.expires_at > now()
    and exists (select 1 from public.organizations o where o.id = p_invitation.organization_id and o.status = 'active')
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = p_invitation.organization_id and m.user_id = p_invitation.invited_by
        and m.accepted_at is not null and private.role_rank(m.role) >= private.role_rank('admin')
    )
$$;

revoke all on function private.invitation_is_open(public.organization_invitations) from public, anon, authenticated, service_role;

-- Accepted members including the owner plus the invitations that can still be accepted: what the member limit counts.
-- An invitation that its inviter's removal has ended no longer holds a seat.
create function private.team_size(p_org uuid) returns integer
language sql
stable
set search_path = ''
as $$
  select (select count(*) from public.organization_members m where m.organization_id = p_org and m.accepted_at is not null)::integer
       + (select count(*) from public.organization_invitations i
          where i.organization_id = p_org and private.invitation_is_open(i))::integer
$$;

revoke all on function private.team_size(uuid) from public, anon, authenticated, service_role;

-- Replaces the version of the organizations migration: at most invitations_per_hour_max invitations per organization
-- and hour (CHARA_RATE_LIMITED, counting re-invitations), and the member limit (CHARA_LIMIT_REACHED, detail 'members').
-- The earlier invitation of the address is removed before the count, so a re-invitation counts once, and the removal is
-- undone when the limit refuses the call. The organization row is locked by assert_org_manager until commit, so
-- concurrent invitations of one organization cannot pass the limit together. The role is taken as text so that any
-- role but 'admin' and 'member' answers CHARA_INVALID_INPUT (FR-A5 AC2) instead of the enum's own error, and the
-- expiry is returned with the token, which is shown once.
drop function public.invite_member(uuid, text, public.member_role);

create function public.invite_member(p_org uuid, p_email text, p_role text)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(p_email));
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  perform private.assert_org_manager(p_org, 'admin');

  if p_role is null or p_role not in ('admin', 'member') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'role';
  end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'email';
  end if;
  if exists (
    select 1
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_org and lower(u.email) = v_email
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'already_a_member';
  end if;
  if (
    select count(*) from audit.log l
    where l.action = 'member_invited' and l.metadata ->> 'organization_id' = p_org::text
      and l.created_at > now() - interval '1 hour'
  ) >= (select (value #>> '{}')::integer from private.settings where key = 'invitations_per_hour_max') then
    raise exception 'CHARA_RATE_LIMITED';
  end if;

  delete from public.organization_invitations i
  where i.organization_id = p_org and i.email = v_email::extensions.citext and i.accepted_at is null;
  perform private.assert_within_limit(p_org, 'members', private.team_size(p_org));

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.organization_invitations as i (organization_id, email, role, token_hash, invited_by)
  values (p_org, v_email, p_role::public.member_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_uid)
  returning i.id, i.expires_at into v_id, v_expires;

  perform audit.record(
    'member_invited', 'organization_invitation', v_id::text,
    jsonb_build_object('organization_id', p_org, 'role', p_role)
  );
  return query select v_token, v_expires;
end;
$$;

revoke all on function public.invite_member(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.invite_member(uuid, text, text) to authenticated;

-- Same behaviour as before, with the open-invitation test shared with invitation_preview.
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

-- What the invitation page shows the person who opens the link, signed in or not. The token is 256 random bits and the
-- answer is the same empty result for every kind of invalid link, so nothing is learned without holding the link.
create function public.invitation_preview(p_token text)
returns table (organization_name text, role public.member_role, email text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.display_name, i.role, i.email::text, i.expires_at
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    and private.invitation_is_open(i)
$$;

revoke all on function public.invitation_preview(text) from public, anon, authenticated, service_role;
grant execute on function public.invitation_preview(text) to anon, authenticated;

-- What a role change or removal of a person outside the organization answers (FR-A5 AC6): CHARA_FORBIDDEN for a user
-- of the platform, CHARA_INVALID_INPUT for an id that belongs to nobody.
create function private.refuse_non_member(p_user uuid) returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'not_a_member';
  end if;
  raise exception 'CHARA_INVALID_INPUT' using detail = 'user';
end;
$$;

revoke all on function private.refuse_non_member(uuid) from public, anon, authenticated, service_role;

-- Same behaviour as before, with refuse_non_member for a person outside the organization.
create or replace function public.change_member_role(p_org uuid, p_user uuid, p_role public.member_role) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.member_role;
begin
  perform private.assert_org_manager(p_org, 'admin');

  if p_role is null or p_role = 'owner' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'role';
  end if;
  select m.role into v_current
  from public.organization_members m
  where m.organization_id = p_org and m.user_id = p_user and m.accepted_at is not null;
  if not found then
    perform private.refuse_non_member(p_user);
  end if;
  if v_current = 'owner' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'use_transfer_ownership';
  end if;
  if v_current = p_role then
    return;
  end if;

  update public.organization_members set role = p_role where organization_id = p_org and user_id = p_user;
  perform audit.record(
    'member_role_changed', 'organization', p_org::text,
    jsonb_build_object('user_id', p_user, 'from', v_current, 'to', p_role)
  );
end;
$$;

-- The sign-out of the removed member is queued, not done here (ARCHITECTURE.md section 8); the membership is gone at
-- once, so the member's next request is refused whether or not the job has run. A transfer waiting for the removed
-- member is cancelled, so that inviting the person again cannot revive it.
create or replace function public.remove_member(p_org uuid, p_user uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.member_role;
begin
  perform private.assert_org_manager(p_org, 'admin');

  select m.role into v_current
  from public.organization_members m
  where m.organization_id = p_org and m.user_id = p_user and m.accepted_at is not null;
  if not found then
    perform private.refuse_non_member(p_user);
  end if;
  if v_current = 'owner' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'cannot_remove_owner';
  end if;

  delete from public.organization_members where organization_id = p_org and user_id = p_user;
  update public.organization_ownership_transfers t set cancelled_at = now()
  where t.organization_id = p_org and t.to_user_id = p_user and t.accepted_at is null and t.cancelled_at is null;
  perform audit.record(
    'member_removed', 'organization', p_org::text,
    jsonb_build_object('user_id', p_user, 'role', v_current)
  );
  perform pgmq.send('account_ops', jsonb_build_object(
    'action', 'sign_out', 'user_id', p_user, 'reason', 'member_removed', 'organization_id', p_org
  ));
end;
$$;

create table public.organization_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  to_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  cancelled_at timestamptz,
  check (from_user_id <> to_user_id),
  check (expires_at > created_at),
  check (accepted_at is null or cancelled_at is null)
);

comment on table public.organization_ownership_transfers is
  'Two-step ownership transfer: the owner designates a member, the member confirms. Open while neither accepted_at nor cancelled_at is set; an open row past expires_at is expired. At most one open row per organization.';

create unique index organization_ownership_transfers_open
  on public.organization_ownership_transfers (organization_id) where accepted_at is null and cancelled_at is null;
create index organization_ownership_transfers_org on public.organization_ownership_transfers (organization_id);
create index organization_ownership_transfers_to_user on public.organization_ownership_transfers (to_user_id);
create index organization_ownership_transfers_from_user on public.organization_ownership_transfers (from_user_id);

alter table public.organization_ownership_transfers enable row level security;
alter table public.organization_ownership_transfers force row level security;

grant select on public.organization_ownership_transfers to authenticated;

create policy organization_ownership_transfers_select_owner on public.organization_ownership_transfers
  for select to authenticated
  using (organization_id in (select private.member_org_ids('owner')));

create policy organization_ownership_transfers_select_target on public.organization_ownership_transfers
  for select to authenticated
  using (to_user_id = (select auth.uid()));

-- Replaces the one-step version of the organizations migration. Nothing changes until the designated member confirms.
-- A new request replaces the open one, so there is one pending transfer per organization. No email is sent (FR-A5).
create or replace function public.transfer_ownership(p_org uuid, p_new_owner uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_replaced public.organization_ownership_transfers;
  v_id uuid;
begin
  perform private.assert_org_manager(p_org, 'owner');

  if p_new_owner is null or p_new_owner = v_uid
     or not exists (
       select 1 from public.organization_members m
       where m.organization_id = p_org and m.user_id = p_new_owner and m.accepted_at is not null
     ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'new_owner';
  end if;

  for v_replaced in
    update public.organization_ownership_transfers t set cancelled_at = now()
    where t.organization_id = p_org and t.accepted_at is null and t.cancelled_at is null
    returning t.*
  loop
    perform audit.record(
      'ownership_transfer_cancelled', 'organization', p_org::text,
      jsonb_build_object('from', v_replaced.from_user_id, 'to', v_replaced.to_user_id, 'reason', 'replaced')
    );
  end loop;

  insert into public.organization_ownership_transfers (organization_id, from_user_id, to_user_id)
  values (p_org, v_uid, p_new_owner)
  returning id into v_id;
  perform audit.record(
    'ownership_transfer_requested', 'organization', p_org::text,
    jsonb_build_object('from', v_uid, 'to', p_new_owner, 'transfer_id', v_id)
  );
end;
$$;

create function public.cancel_ownership_transfer(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.organization_ownership_transfers;
begin
  perform private.assert_org_manager(p_org, 'owner');

  update public.organization_ownership_transfers t set cancelled_at = now()
  where t.organization_id = p_org and t.accepted_at is null and t.cancelled_at is null
  returning t.* into v_transfer;
  if not found then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'no_pending_transfer';
  end if;
  perform audit.record(
    'ownership_transfer_cancelled', 'organization', p_org::text,
    jsonb_build_object('from', v_transfer.from_user_id, 'to', v_transfer.to_user_id, 'reason', 'cancelled')
  );
end;
$$;

-- The designated member confirms, at aal2 (they become an owner). In one transaction the owner becomes an admin and
-- the member the owner: the old owner is demoted first because the unique owner index is immediate, and the one-owner
-- rule is checked at commit. An expired, cancelled, replaced or foreign transfer all answer no_pending_transfer.
create function public.accept_ownership_transfer(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status public.organization_status;
  v_transfer public.organization_ownership_transfers;
begin
  if v_uid is null
     or not exists (
       select 1 from public.organization_members m
       where m.organization_id = p_org and m.user_id = v_uid and m.accepted_at is not null
     ) then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;

  select o.status into v_status from public.organizations o where o.id = p_org for no key update;
  select * into v_transfer
  from public.organization_ownership_transfers t
  where t.organization_id = p_org and t.accepted_at is null and t.cancelled_at is null
  for update;
  if not found or v_transfer.to_user_id <> v_uid or v_transfer.expires_at <= now()
     or not exists (
       select 1 from public.organization_members m
       where m.organization_id = p_org and m.user_id = v_uid and m.accepted_at is not null
     ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'no_pending_transfer';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
  end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = v_transfer.from_user_id and m.role = 'owner'
  ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'no_pending_transfer';
  end if;

  update public.organization_members set role = 'admin' where organization_id = p_org and user_id = v_transfer.from_user_id;
  update public.organization_members set role = 'owner' where organization_id = p_org and user_id = v_uid;
  update public.organization_ownership_transfers set accepted_at = now() where id = v_transfer.id;
  perform audit.record(
    'ownership_transferred', 'organization', p_org::text,
    jsonb_build_object('from', v_transfer.from_user_id, 'to', v_uid)
  );
end;
$$;

revoke all on function public.cancel_ownership_transfer(uuid) from public, anon, authenticated, service_role;
revoke all on function public.accept_ownership_transfer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_ownership_transfer(uuid) to authenticated;
grant execute on function public.accept_ownership_transfer(uuid) to authenticated;

-- Replaces the version of the two-step verification migration, which listed owners and admins only and had no names.
-- Every member of the organization may list it and sees names and roles; the email address and mfa_enrolled (a boolean
-- only, null for a plain member row) go to owners and admins at aal2, who are asked for aal2 as on every other team
-- action. Keyset pages in primary-key order: pass the last user_id of a page as p_after_user for the next one; p_limit
-- is capped at 100. Role order is the caller's to apply. A profile without a display name has no name.
drop function public.list_organization_members(uuid, integer, uuid);

create function public.list_organization_members(p_org uuid, p_limit integer default 50, p_after_user uuid default null)
returns table (
  user_id uuid, display_name text, email text, role public.member_role, accepted_at timestamptz, mfa_enrolled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_manager boolean;
begin
  select private.role_rank(m.role) >= private.role_rank('admin') into v_manager
  from public.organization_members m
  where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.accepted_at is not null;
  if v_manager is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if v_manager and not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;

  return query
  select
    m.user_id,
    p.display_name,
    case when v_manager then u.email::text end,
    m.role,
    m.accepted_at,
    case when v_manager and m.role <> 'member' then exists (
      select 1 from auth.mfa_factors f
      where f.user_id = m.user_id and f.factor_type = 'totp' and f.status = 'verified'
    ) end
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_org and m.accepted_at is not null
    and (p_after_user is null or m.user_id > p_after_user)
  order by m.user_id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.list_organization_members(uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_organization_members(uuid, integer, uuid) to authenticated;

-- What the invite dialog shows before anything is sent: the limit that applies now (null when none) and the size the
-- limit counts. The invitation itself is checked again, under lock, by invite_member.
create function public.team_member_allowance(p_org uuid) returns table (member_limit integer, used integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;

  return query
  select
    case when coalesce((select (value #>> '{}')::boolean from private.settings where key = 'entitlements_enforced'), false)
      then private.org_limit(p_org, 'members') end,
    private.team_size(p_org);
end;
$$;

revoke all on function public.team_member_allowance(uuid) from public, anon, authenticated, service_role;
grant execute on function public.team_member_allowance(uuid) to authenticated;

-- The invitations of the team page, newest first, with whether each can still be accepted: an invitation past its
-- expiry or whose inviter was removed or demoted cannot (private.invitation_is_open), and the page offers to send it
-- again. Owners and admins at aal2 only, as for every team action.
create index organization_invitations_org_created
  on public.organization_invitations (organization_id, created_at desc) where accepted_at is null;

create function public.list_organization_invitations(p_org uuid, p_limit integer default 50)
returns table (id uuid, email text, role public.member_role, expires_at timestamptz, is_open boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;

  return query
  select i.id, i.email::text, i.role, i.expires_at, private.invitation_is_open(i)
  from public.organization_invitations i
  where i.organization_id = p_org and i.accepted_at is null
  order by i.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.list_organization_invitations(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_organization_invitations(uuid, integer) to authenticated;
