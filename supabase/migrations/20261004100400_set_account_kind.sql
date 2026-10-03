-- set_account_kind (OPEN_QUESTIONS.md D9; ARCHITECTURE.md section 6.3): commits the intended account kind once,
-- after email confirmation, and in the same transaction records the consents required for that kind through
-- accept_consents. Entries in p_consents (the current versions accepted on the onboarding page) take precedence
-- over the sign-up entries in profiles.pending_consents, which is how a superseded version is replaced.

create function public.set_account_kind(p_consents jsonb default '[]') returns public.account_kind
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_required text[];
  v_entry jsonb;
  v_purpose text;
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

  if jsonb_typeof(p_consents) is distinct from 'array'
     or jsonb_array_length(p_consents) > private.max_consent_entries() then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_consents must be an array of at most 20 entries';
  end if;

  v_required := private.required_consents(v_profile.intended_account_kind);
  if cardinality(v_required) = 0 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'no required consents are configured';
  end if;

  foreach v_purpose in array v_required loop
    select e.entry into v_entry
    from jsonb_array_elements(p_consents || v_profile.pending_consents) with ordinality e(entry, n)
    where e.entry ->> 'purpose' = v_purpose
    order by e.n limit 1;
    if v_entry is null then
      raise exception 'CHARA_CONSENT_REQUIRED' using detail = v_purpose;
    end if;
    v_accepted := v_accepted || v_entry;
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
