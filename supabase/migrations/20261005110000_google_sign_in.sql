-- Continue with Google (OPEN_QUESTIONS.md D31 to D35; FR-A1, FR-A3, FR-A6, FR-A8, FR-A9).
-- An OAuth sign-up carries no form, so it cannot bring the intended account kind or the consents in the user metadata.
-- Its profile starts with no intended kind; the user chooses worker or employer at onboarding, once, and
-- choose_account_kind records the choice and commits it through set_account_kind in the same transaction, so the
-- consents (and the age attestation for workers) are written before the kind is committed, exactly as for an
-- email sign-up. The trigger does not look at the provider: Auth writes app_metadata after the insert for users created
-- through its admin API, so only the absence of a kind can mark an account that has to choose one.

alter table public.profiles alter column intended_account_kind drop not null;

-- The column was NOT NULL, which made "a committed kind is the intended kind" implicit; it is now stated.
alter table public.profiles
  add constraint profiles_kind_matches_intended
  check (account_kind is null or (intended_account_kind is not null and account_kind = intended_account_kind));

comment on column public.profiles.intended_account_kind is
  'Kind named at sign-up. Null only for an OAuth sign-up until choose_account_kind sets it, once; then never changes.';

-- The kind may be set once from null (OAuth) and committed from the intended kind; every other change stays refused.
create or replace function private.profiles_guard_account_kind() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.intended_account_kind is distinct from old.intended_account_kind
     and old.intended_account_kind is not null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'intended_account_kind cannot be changed';
  end if;
  if new.account_kind is distinct from old.account_kind
     and not coalesce(old.account_kind is null and new.account_kind = new.intended_account_kind, false) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind is committed once from the intended kind';
  end if;
  return new;
end;
$$;

-- A sign-up that names no kind (an OAuth sign-up, or one made directly against Auth) gets a profile without one and
-- without pending consents; it can do nothing until choose_account_kind commits a kind with consents. A kind that is
-- named must still be worker or company. user_metadata of such a sign-up is never trusted for consents.
create or replace function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := new.raw_user_meta_data ->> 'intended_account_kind';
begin
  if v_kind is not null and v_kind not in ('worker', 'company') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'intended_account_kind must be worker or company';
  end if;

  insert into public.profiles (id, intended_account_kind, pending_consents)
  values (
    new.id,
    v_kind::public.account_kind,
    case when v_kind is null then '[]'::jsonb else coalesce(new.raw_user_meta_data -> 'pending_consents', '[]') end
  );
  return new;
end;
$$;

-- Chooses the account kind of a user who has none yet and commits it with the consents. A user who named the kind at
-- sign-up may repeat that kind and nothing else; a committed kind is returned unchanged for the same kind (a double
-- submit) and refused for another. The whole call is one transaction: a missing consent or an unconfirmed email
-- leaves the profile without an intended kind.
create function public.choose_account_kind(p_kind public.account_kind, p_consents jsonb default '[]')
returns public.account_kind
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if p_kind is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_kind is required';
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  if v_profile.account_kind is not null then
    if v_profile.account_kind <> p_kind then
      raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind is committed';
    end if;
    return v_profile.account_kind;
  end if;
  if v_profile.intended_account_kind is not null and v_profile.intended_account_kind <> p_kind then
    raise exception 'CHARA_FORBIDDEN' using detail = 'intended_account_kind cannot be changed';
  end if;

  if v_profile.intended_account_kind is null then
    update public.profiles set intended_account_kind = p_kind where id = v_uid;
  end if;
  return public.set_account_kind(p_consents);
end;
$$;

revoke all on function public.choose_account_kind(public.account_kind, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.choose_account_kind(public.account_kind, jsonb) to authenticated;

-- accept_consents (20261004100300) with one addition: a user with no kind yet has no list of documents to accept, so
-- the call is refused instead of recording a row for a document of a kind the user may never choose.
create or replace function public.accept_consents(p_consents jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status public.profile_status;
  v_kind public.account_kind;
  v_own text[];
  v_other text[];
  v_entry jsonb;
  v_purpose text;
  v_version integer;
  v_recorded jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  -- The row lock serialises concurrent calls of one user, so the idempotency check below cannot race.
  select p.status, coalesce(p.account_kind, p.intended_account_kind) into v_status, v_kind
  from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;
  if v_kind is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind_not_chosen';
  end if;
  v_own := private.required_consents(v_kind);
  v_other := private.required_consents((case v_kind when 'worker' then 'company' else 'worker' end)::public.account_kind);

  if jsonb_typeof(p_consents) is distinct from 'array'
     or jsonb_array_length(p_consents) > private.max_consent_entries() then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_consents must be an array of at most 20 entries';
  end if;

  for v_entry in select e from jsonb_array_elements(p_consents) e loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or jsonb_typeof(v_entry -> 'purpose') is distinct from 'string'
       or (v_entry ->> 'version') !~ '^[0-9]{1,9}$' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'each entry needs a purpose and an integer version';
    end if;
    v_purpose := v_entry ->> 'purpose';
    v_version := (v_entry ->> 'version')::integer;

    if v_purpose = any (v_other) and v_purpose <> all (v_own) then
      raise exception 'CHARA_INVALID_INPUT' using detail = v_purpose;
    end if;
    if v_version is distinct from private.current_legal_version(v_purpose) then
      if exists (
        select 1 from public.legal_documents d
        where d.slug = v_purpose and d.version = v_version and d.published_at <= now()
      ) then
        raise exception 'CHARA_CONSENT_REQUIRED' using detail = v_purpose;
      end if;
      raise exception 'CHARA_INVALID_INPUT' using detail = v_purpose;
    end if;

    if exists (
      select 1 from (
        select c.action, c.version from public.consents c
        where c.user_id = v_uid and c.purpose = v_purpose
        order by c.id desc limit 1
      ) latest
      where latest.action = 'granted' and latest.version = v_version
    ) then
      continue;
    end if;

    insert into public.consents (user_id, purpose, version, action)
    values (v_uid, v_purpose, v_version, 'granted');
    v_recorded := v_recorded || jsonb_build_object('purpose', v_purpose, 'version', v_version);
  end loop;

  if jsonb_array_length(v_recorded) > 0 then
    perform audit.record('consents_accepted', 'profile', v_uid::text, jsonb_build_object('consents', v_recorded));
  end if;
end;
$$;
