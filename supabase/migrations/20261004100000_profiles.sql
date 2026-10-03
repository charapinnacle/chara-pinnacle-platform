-- Profiles (ARCHITECTURE.md sections 4, 5.2, 6.3; OPEN_QUESTIONS.md D9): one row per auth user, created by trigger.
-- No email and no password hash live in public. The account kind is chosen at sign-up (intended_account_kind),
-- committed once after email confirmation by set_account_kind (next migrations) and immutable afterwards.
-- Errors raised by triggers and RPCs carry a stable code as the message (CHARA_FORBIDDEN, CHARA_INVALID_INPUT, ...).

create type public.account_kind as enum ('worker', 'company');
create type public.profile_status as enum ('active', 'suspended', 'deletion_pending');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  account_kind public.account_kind,
  intended_account_kind public.account_kind not null,
  pending_consents jsonb not null default '[]'
    check (jsonb_typeof(pending_consents) = 'array' and jsonb_array_length(pending_consents) <= 20),
  display_name text check (display_name is null or length(display_name) between 1 and 100),
  preferred_lang text not null default 'en' references public.languages (code),
  status public.profile_status not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. account_kind is null until set_account_kind commits intended_account_kind, then never changes.';
comment on column public.profiles.pending_consents is
  'Sign-up consent entries [{purpose, version}] held until set_account_kind writes them to public.consents.';

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- Writes go through RPCs and triggers only; a user may read their own row.
grant select on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := new.raw_user_meta_data ->> 'intended_account_kind';
begin
  if v_kind is null or v_kind not in ('worker', 'company') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'intended_account_kind must be worker or company';
  end if;

  insert into public.profiles (id, intended_account_kind, pending_consents)
  values (
    new.id,
    v_kind::public.account_kind,
    coalesce(new.raw_user_meta_data -> 'pending_consents', '[]')
  );
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated, service_role;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.profiles_guard_account_kind() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.intended_account_kind is distinct from old.intended_account_kind then
    raise exception 'CHARA_FORBIDDEN' using detail = 'intended_account_kind cannot be changed';
  end if;
  if new.account_kind is distinct from old.account_kind
     and not (old.account_kind is null and new.account_kind = old.intended_account_kind) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind is committed once from the intended kind';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_account_kind
  before update of account_kind, intended_account_kind on public.profiles
  for each row execute function private.profiles_guard_account_kind();

-- ENABLE ALWAYS so session_replication_role = replica does not bypass the immutability rule.
alter table public.profiles enable always trigger profiles_guard_account_kind;

create function private.account_kind() returns public.account_kind
language sql
stable
security definer
set search_path = ''
as $$
  select p.account_kind from public.profiles p where p.id = (select auth.uid())
$$;

revoke all on function private.account_kind() from public, anon, authenticated, service_role;
grant execute on function private.account_kind() to authenticated;
