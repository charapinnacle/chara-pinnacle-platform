-- Organizations, members, invitations and the member RPCs (ARCHITECTURE.md sections 4, 5.2 to 5.5, 6.3;
-- OPEN_QUESTIONS.md D7, D8, D10, D14). Organizations and memberships are written only by the RPCs below, which re-check
-- the caller on every call. Member management needs aal2; reading one's own membership or organization never does (D8).

create type public.organization_type as enum ('employer', 'recruitment_company', 'staffing_company');
create type public.organization_status as enum ('active', 'suspended');
create type public.member_role as enum ('owner', 'admin', 'member');

create function private.role_rank(r public.member_role) returns integer
language sql
immutable
set search_path = ''
as $$ select case r when 'owner' then 3 when 'admin' then 2 else 1 end $$;

revoke all on function private.role_rank(public.member_role) from public, anon, authenticated, service_role;

-- Only the claims sub and aal are ever read from the token (ARCHITECTURE.md section 5.3).
create function private.is_aal2() returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false) $$;

revoke all on function private.is_aal2() from public, anon, authenticated, service_role;
grant execute on function private.is_aal2() to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  type public.organization_type not null,
  slug text not null unique check (length(slug) <= 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  legal_name text not null check (length(legal_name) between 2 and 200 and legal_name = btrim(legal_name)),
  display_name text not null check (length(display_name) between 1 and 200 and display_name = btrim(display_name)),
  based_in_country text not null references public.countries (code),
  website text check (website is null or (length(website) <= 2048 and website ~* '^https?://[^/?#[:space:]]+[^[:space:]]*$')),
  status public.organization_status not null default 'active',
  created_at timestamptz not null default now()
);

comment on table public.organizations is
  'Companies. Created only by create_organization; employer is the only type created in Phase 1 (D7).';
comment on column public.organizations.slug is
  'Lower case by constraint, so plain text equality is case-insensitive. Not citext: citext_eq is not leakproof, which keeps the planner from using the index under row level security.';

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null,
  invited_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  primary key (organization_id, user_id)
);

comment on table public.organization_members is
  'Membership of a user in an organization. Only company accounts can be members; exactly one owner per organization.';

create index organization_members_user_org
  on public.organization_members (user_id, organization_id) include (role, accepted_at);
create index organization_members_invited_by
  on public.organization_members (invited_by) where invited_by is not null;
create unique index organization_members_one_owner
  on public.organization_members (organization_id) where role = 'owner';

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email extensions.citext not null check (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role public.member_role not null check (role <> 'owner'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  check (expires_at > created_at)
);

comment on table public.organization_invitations is
  'Single-use invitations. Only the SHA-256 hash of the token is stored; the token is returned once by invite_member.';

create index organization_invitations_org on public.organization_invitations (organization_id);
create index organization_invitations_invited_by
  on public.organization_invitations (invited_by) where invited_by is not null;
create unique index organization_invitations_pending_email
  on public.organization_invitations (organization_id, email) where accepted_at is null;

alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;
alter table public.organization_invitations enable row level security;
alter table public.organization_invitations force row level security;

-- rows 5: the planner assumes 1000 rows for a set-returning function, which turns every tenant-table policy of the form
-- organization_id in (select private.member_org_ids()) into a hash join or scan. A user belongs to a handful of
-- organizations.
create function private.member_org_ids(p_min_role public.member_role default 'member')
returns setof uuid
language sql
stable
security definer
rows 5
set search_path = ''
as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = (select auth.uid())
    and m.accepted_at is not null
    and private.role_rank(m.role) >= private.role_rank(p_min_role)
$$;

create function private.is_org_member(p_org uuid, p_min_role public.member_role default 'member') returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from private.member_org_ids(p_min_role) o where o = p_org) $$;

create function private.org_type(p_org uuid) returns public.organization_type
language sql
stable
security definer
set search_path = ''
as $$ select o.type from public.organizations o where o.id = p_org $$;

revoke all on function private.member_org_ids(public.member_role) from public, anon, authenticated, service_role;
revoke all on function private.is_org_member(uuid, public.member_role) from public, anon, authenticated, service_role;
revoke all on function private.org_type(uuid) from public, anon, authenticated, service_role;
grant execute on function private.member_org_ids(public.member_role) to authenticated;
grant execute on function private.is_org_member(uuid, public.member_role) to authenticated;
grant execute on function private.org_type(uuid) to authenticated;

grant select on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant select (id, organization_id, email, role, invited_by, created_at, expires_at, accepted_at)
  on public.organization_invitations to authenticated;

create policy organizations_select_member on public.organizations
  for select to authenticated
  using (id in (select private.member_org_ids()));

create policy organization_members_select_own on public.organization_members
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy organization_members_select_member on public.organization_members
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

create policy organization_invitations_select_admin on public.organization_invitations
  for select to authenticated
  using (organization_id in (select private.member_org_ids('admin')));

create policy organization_invitations_requires_mfa on public.organization_invitations
  as restrictive for all to authenticated
  using ((select private.is_aal2()));

create function private.organization_members_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = new.user_id and p.account_kind = 'company'
  ) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'workers_cannot_join_organizations';
  end if;
  return new;
end;
$$;

revoke all on function private.organization_members_guard() from public, anon, authenticated, service_role;

create trigger organization_members_guard
  before insert or update of user_id on public.organization_members
  for each row execute function private.organization_members_guard();

alter table public.organization_members enable always trigger organization_members_guard;

-- Checked at commit so that a transfer, which demotes the owner before it promotes the next one, passes. Definer rights
-- because the commit runs as the API role, which row level security would show only part of the members.
create function private.check_one_owner() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (
    coalesce(to_jsonb(new), to_jsonb(old)) ->> case tg_table_name when 'organizations' then 'id' else 'organization_id' end
  )::uuid;
begin
  if exists (select 1 from public.organizations o where o.id = v_org)
     and (select count(*) from public.organization_members m where m.organization_id = v_org and m.role = 'owner') <> 1 then
    raise exception 'CHARA_FORBIDDEN' using detail = 'exactly_one_owner';
  end if;
  return null;
end;
$$;

revoke all on function private.check_one_owner() from public, anon, authenticated, service_role;

create constraint trigger organizations_one_owner
  after insert on public.organizations
  deferrable initially deferred
  for each row execute function private.check_one_owner();

create constraint trigger organization_members_one_owner
  after insert or update of role or delete on public.organization_members
  deferrable initially deferred
  for each row execute function private.check_one_owner();

alter table public.organizations enable always trigger organizations_one_owner;
alter table public.organization_members enable always trigger organization_members_one_owner;

-- Opening step of every member-management RPC: the caller must hold p_min_role, be at aal2, and the organization
-- must be active. The membership table has no write grants, so this check is the aal2 gate of member management. The
-- organization row stays locked until commit, so concurrent management calls of one organization run one after another;
-- no key update, because for update would also block the foreign key checks of unrelated child inserts. A caller
-- without the role is refused before any lock is taken.
create function private.assert_org_manager(p_org uuid, p_min_role public.member_role) returns public.member_role
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.member_role;
  v_status public.organization_status;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  select m.role into v_role
  from public.organization_members m
  where m.organization_id = p_org and m.user_id = v_uid and m.accepted_at is not null;
  if not found or private.role_rank(v_role) < private.role_rank(p_min_role) then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;

  select o.status into v_status from public.organizations o where o.id = p_org for no key update;
  select m.role into v_role
  from public.organization_members m
  where m.organization_id = p_org and m.user_id = v_uid and m.accepted_at is not null;
  if not found or private.role_rank(v_role) < private.role_rank(p_min_role) then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
  end if;
  return v_role;
end;
$$;

revoke all on function private.assert_org_manager(uuid, public.member_role) from public, anon, authenticated, service_role;

insert into private.settings (key, value) values ('organizations_per_user_max', '3');

-- Creates the organization and its owner membership in one transaction. Aal2 is not required: a new owner is still
-- at aal1 and must reach MFA enrolment (D8). Phase 1 creates employer organizations only (D7). Field rules live in the
-- table constraints. Calls of one user run one after another (lock on the profile row). A repeated call with the same
-- legal name within a minute, as a double click or a retried request makes, returns the organization already created;
-- beyond that a user owns at most organizations_per_user_max organizations. The slug comes from the display name; a
-- taken slug gets a short random suffix, and after four tries the first 8 characters of the id, so the loop is bounded.
create function public.create_organization(
  p_type public.organization_type,
  p_legal_name text,
  p_display_name text,
  p_based_in_country text,
  p_website text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_id uuid := gen_random_uuid();
  v_legal text := btrim(p_legal_name);
  v_display text := coalesce(nullif(btrim(p_display_name), ''), btrim(p_legal_name));
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_existing uuid;
  v_constraint text;
  v_column text;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid for no key update;
  if not found or v_profile.account_kind is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;
  if p_type is distinct from 'employer' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'organization_type_not_available';
  end if;

  select o.id into v_existing
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = v_uid and m.role = 'owner' and lower(o.legal_name) = lower(v_legal)
    and o.created_at > now() - interval '1 minute';
  if found then
    return v_existing;
  end if;
  if (select count(*) from public.organization_members m where m.user_id = v_uid and m.role = 'owner')
     >= (select (value #>> '{}')::integer from private.settings where key = 'organizations_per_user_max') then
    raise exception 'CHARA_LIMIT_REACHED' using detail = 'organizations';
  end if;

  v_base := btrim(left(btrim(regexp_replace(lower(extensions.unaccent(v_display)), '[^a-z0-9]+', '-', 'g'), '-'), 60), '-');
  if v_base = '' then
    v_base := 'org-' || left(v_id::text, 8);
  end if;

  loop
    v_slug := case when v_n = 1 then v_base
      else btrim(left(v_base, 51), '-') || '-' || case when v_n < 5 then substr(md5(random()::text), 1, 6) else left(v_id::text, 8) end
    end;
    begin
      insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, website)
      values (v_id, p_type, v_slug, v_legal, v_display, upper(btrim(p_based_in_country)), nullif(btrim(p_website), ''));
      exit;
    exception
      when unique_violation then
        if v_n >= 5 then
          raise exception 'CHARA_CONFLICT' using detail = 'slug';
        end if;
        v_n := v_n + 1;
      when check_violation or foreign_key_violation or not_null_violation then
        get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
        raise exception 'CHARA_INVALID_INPUT' using detail = coalesce(nullif(v_constraint, ''), v_column);
    end;
  end loop;

  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (v_id, v_uid, 'owner', now());

  perform audit.record(
    'organization_created', 'organization', v_id::text,
    jsonb_build_object('slug', v_slug, 'type', p_type)
  );
  return v_id;
end;
$$;

revoke all on function public.create_organization(public.organization_type, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_organization(public.organization_type, text, text, text, text)
  to authenticated;

-- Returns the invitation token once; only its SHA-256 hash is stored (D10). Inviting an address that already has a
-- pending invitation replaces it, so there is one live link per address.
create function public.invite_member(p_org uuid, p_email text, p_role public.member_role) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(p_email));
  v_token text;
  v_id uuid;
begin
  perform private.assert_org_manager(p_org, 'admin');

  if p_role is null or p_role = 'owner' then
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

  delete from public.organization_invitations i
  where i.organization_id = p_org and i.email = v_email::extensions.citext and i.accepted_at is null;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by)
  values (p_org, v_email, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_uid)
  returning id into v_id;

  perform audit.record(
    'member_invited', 'organization_invitation', v_id::text,
    jsonb_build_object('organization_id', p_org, 'role', p_role)
  );
  return v_token;
end;
$$;

revoke all on function public.invite_member(uuid, text, public.member_role) from public, anon, authenticated, service_role;
grant execute on function public.invite_member(uuid, text, public.member_role) to authenticated;

-- An unknown token, an expired or used invitation, an invitation for another address, an invitation of a suspended
-- organization and an invitation whose inviter is no longer an admin or owner there all answer alike. There is no
-- revoke action (FR-A5): removing or demoting the inviter, or inviting the address again, ends the old link.
create function public.accept_invitation(p_token text) returns uuid
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
  if not found or v_invitation.accepted_at is not null or v_invitation.expires_at <= now()
     or v_invitation.email <> v_email::extensions.citext
     or not exists (
       select 1 from public.organizations o where o.id = v_invitation.organization_id and o.status = 'active'
     )
     or not exists (
       select 1 from public.organization_members m
       where m.organization_id = v_invitation.organization_id and m.user_id = v_invitation.invited_by
         and m.accepted_at is not null and private.role_rank(m.role) >= private.role_rank('admin')
     ) then
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

revoke all on function public.accept_invitation(text) from public, anon, authenticated, service_role;
grant execute on function public.accept_invitation(text) to authenticated;

create function public.change_member_role(p_org uuid, p_user uuid, p_role public.member_role) returns void
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
    raise exception 'CHARA_INVALID_INPUT' using detail = 'not_a_member';
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

revoke all on function public.change_member_role(uuid, uuid, public.member_role) from public, anon, authenticated, service_role;
grant execute on function public.change_member_role(uuid, uuid, public.member_role) to authenticated;

-- The owner is never removed: ownership moves first (transfer_ownership), so an organization is never left without one.
create function public.remove_member(p_org uuid, p_user uuid) returns void
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
    raise exception 'CHARA_INVALID_INPUT' using detail = 'not_a_member';
  end if;
  if v_current = 'owner' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'cannot_remove_owner';
  end if;

  delete from public.organization_members where organization_id = p_org and user_id = p_user;
  perform audit.record(
    'member_removed', 'organization', p_org::text,
    jsonb_build_object('user_id', p_user, 'role', v_current)
  );
end;
$$;

revoke all on function public.remove_member(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- The owner hands the role to an accepted member and becomes an admin; the unique owner index is immediate, so the
-- old owner is demoted first and the one-owner rule is checked at commit.
create function public.transfer_ownership(p_org uuid, p_new_owner uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  perform private.assert_org_manager(p_org, 'owner');

  if p_new_owner is null or p_new_owner = v_uid
     or not exists (
       select 1 from public.organization_members m
       where m.organization_id = p_org and m.user_id = p_new_owner and m.accepted_at is not null
     ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'new_owner';
  end if;

  update public.organization_members set role = 'admin' where organization_id = p_org and user_id = v_uid;
  update public.organization_members set role = 'owner' where organization_id = p_org and user_id = p_new_owner;
  perform audit.record(
    'ownership_transferred', 'organization', p_org::text,
    jsonb_build_object('from', v_uid, 'to', p_new_owner)
  );
end;
$$;

revoke all on function public.transfer_ownership(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
