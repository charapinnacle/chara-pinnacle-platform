-- set_account_kind (OPEN_QUESTIONS.md D9; ARCHITECTURE.md section 6.3): commits the intended account kind once,
-- after email confirmation, and in the same transaction records the consents required for that kind.
-- The versions come from the sign-up entries in profiles.pending_consents; entries in p_consents (the current
-- versions the user accepted on the onboarding page) take precedence, which is how a superseded version is replaced.
-- A repeat call on a committed account returns the kind and writes nothing.

create function public.set_account_kind(p_consents jsonb default '[]') returns public.account_kind
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_entry jsonb;
  v_purpose text;
  v_version integer;
  v_accepted jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if v_profile.account_kind is not null then
    return v_profile.account_kind;
  end if;

  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'email_unconfirmed';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;

  if jsonb_typeof(p_consents) is distinct from 'array' or jsonb_array_length(p_consents) > 20 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_consents must be an array of at most 20 entries';
  end if;

  foreach v_purpose in array private.required_consents(v_profile.intended_account_kind) loop
    select e.entry into v_entry
    from jsonb_array_elements(p_consents || v_profile.pending_consents) with ordinality e(entry, n)
    where e.entry ->> 'purpose' = v_purpose
    order by e.n limit 1;
    if v_entry is null then
      raise exception 'CHARA_CONSENT_REQUIRED' using detail = v_purpose;
    end if;

    if (v_entry ->> 'version') !~ '^[0-9]{1,9}$' then
      raise exception 'CHARA_INVALID_INPUT' using detail = v_purpose;
    end if;
    v_version := (v_entry ->> 'version')::integer;
    if not exists (
      select 1 from public.legal_documents d
      where d.slug = v_purpose and d.version = v_version and d.published_at is not null
    ) then
      raise exception 'CHARA_INVALID_INPUT' using detail = v_purpose;
    end if;
    if v_version <> private.current_legal_version(v_purpose) then
      raise exception 'CHARA_CONSENT_REQUIRED' using detail = v_purpose;
    end if;

    v_accepted := v_accepted || jsonb_build_object('purpose', v_purpose, 'version', v_version);
  end loop;

  update public.profiles
  set account_kind = intended_account_kind, pending_consents = '[]'
  where id = v_uid;
  perform audit.record(
    'account_kind_set', 'profile', v_uid::text,
    jsonb_build_object('kind', v_profile.intended_account_kind)
  );
  perform public.accept_consents(v_accepted);

  return v_profile.intended_account_kind;
end;
$$;

revoke all on function public.set_account_kind(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_account_kind(jsonb) to authenticated;
