-- Platform staff (ARCHITECTURE.md sections 4, 5.2, 5.4; OPEN_QUESTIONS.md D1, D11): a separate table so a profile
-- update can never escalate privilege. All three roles exist from the start; Phase 1 builds the admin console only.
-- A revocation sets revoked_at and a later grant is a new row; rows leave the table only when the profile is deleted,
-- after which audit.log is the record. There are no write grants; grant_platform_role and revoke_platform_role
-- arrive with the admin console, the first admin by an audited SQL insert.

create type public.platform_role as enum ('admin', 'verification_reviewer', 'trust_safety');

create table public.platform_staff (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.platform_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= granted_at)
);

create unique index platform_staff_active_role_idx
  on public.platform_staff (user_id, role)
  where revoked_at is null;

alter table public.platform_staff enable row level security;
alter table public.platform_staff force row level security;

-- The policy limits a staff member to their own active roles, so a whole-table grant leaves `select *` working
-- and everyone else sees no rows. Listing all staff is a later RPC.
grant select on public.platform_staff to authenticated;

create policy platform_staff_select_own on public.platform_staff
  for select to authenticated
  using (user_id = (select auth.uid()) and revoked_at is null);

create function private.has_platform_role(p_role public.platform_role) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_staff s
    where s.user_id = (select auth.uid()) and s.role = p_role and s.revoked_at is null
  )
$$;

revoke all on function private.has_platform_role(public.platform_role) from public, anon, authenticated, service_role;
grant execute on function private.has_platform_role(public.platform_role) to authenticated;

-- The reason of an administrative action travels in the transaction-local setting chara.audit_reason.
create function private.platform_staff_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(current_setting('chara.audit_reason', true), '');
begin
  if tg_op = 'INSERT' then
    perform audit.record(
      'platform_role_granted', 'platform_staff', new.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'user_id', new.user_id, 'role', new.role, 'granted_by', new.granted_by, 'reason', v_reason
      ))
    );
  elsif old.revoked_at is null and new.revoked_at is not null then
    perform audit.record(
      'platform_role_revoked', 'platform_staff', new.id::text,
      jsonb_strip_nulls(jsonb_build_object('user_id', new.user_id, 'role', new.role, 'reason', v_reason))
    );
  end if;
  return null;
end;
$$;

revoke all on function private.platform_staff_audit() from public, anon, authenticated, service_role;

create trigger platform_staff_audit
  after insert or update of revoked_at on public.platform_staff
  for each row execute function private.platform_staff_audit();

alter table public.platform_staff enable always trigger platform_staff_audit;

create function private.platform_staff_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.profiles p where p.id = old.user_id) then
      raise exception 'CHARA_FORBIDDEN' using detail = 'platform_staff rows are not deleted';
    end if;
    return old;
  end if;
  if new.user_id is distinct from old.user_id
     or new.role is distinct from old.role
     or new.granted_at is distinct from old.granted_at
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'a platform_staff grant is only ever revoked';
  end if;
  return new;
end;
$$;

revoke all on function private.platform_staff_guard() from public, anon, authenticated, service_role;

create trigger platform_staff_guard
  before update or delete on public.platform_staff
  for each row execute function private.platform_staff_guard();

alter table public.platform_staff enable always trigger platform_staff_guard;
