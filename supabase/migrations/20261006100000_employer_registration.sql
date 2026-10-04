-- Employer registration (FR-A2; OPEN_QUESTIONS.md D4, D7, C14). The organization gets an industry and an optional
-- legal-entity identifier (company registration number, VAT number or another unique legal-entity identifier), which
-- decides later whether the legal entity may have a free trial. create_organization now reports whether the legal name
-- is already in use, and the owner can set the identifier afterwards until billing records exist for the organization.

alter table public.organizations
  add column industry_code text references public.industries (code),
  add column legal_entity_identifier text check (legal_entity_identifier ~ '^[A-Z0-9]{4,32}$'),
  add column legal_entity_identifier_kind text check (
    legal_entity_identifier_kind in ('registration_number', 'vat_number', 'other')
  ),
  add constraint organizations_legal_entity_identifier_has_kind check (
    (legal_entity_identifier is null) = (legal_entity_identifier_kind is null)
  );

comment on column public.organizations.legal_entity_identifier is
  'Upper case letters and digits only (spaces, dots, hyphens and slashes removed). Not unique: several organizations may name one legal entity, and the trial rule looks them up by this value (FR-G2).';

create function private.legal_name_key(p_name text) returns text
language sql
immutable
set search_path = ''
as $$ select lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g')) $$;

revoke all on function private.legal_name_key(text) from public, anon, authenticated, service_role;

create index organizations_legal_name_key on public.organizations (private.legal_name_key(legal_name));
create index organizations_legal_entity_identifier
  on public.organizations (legal_entity_identifier) where legal_entity_identifier is not null;
create index organizations_industry_code on public.organizations (industry_code) where industry_code is not null;

-- The billing schema does not exist yet (plans and subscriptions come with FR-G1, checkout with FR-G2), so no trial
-- has been granted and no billing record can exist: both answers are false until the billing migration replaces
-- these two functions with lookups of billing.subscriptions (trial_ends_at) and billing.customers.
create function private.legal_entity_trial_used(p_identifier text) returns boolean
language sql
stable
set search_path = ''
as $$ select false $$;

create function private.legal_entity_locked(p_org uuid) returns boolean
language sql
stable
set search_path = ''
as $$ select false $$;

revoke all on function private.legal_entity_trial_used(text) from public, anon, authenticated, service_role;
revoke all on function private.legal_entity_locked(uuid) from public, anon, authenticated, service_role;

-- Normalises an identifier and checks it with its kind; null for an empty value. Which identifier is mandatory per
-- country and how it is validated is open (C14), so the rule is the same for every country.
create function private.legal_entity_identifier(p_identifier text, p_kind text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_identifier text := nullif(upper(regexp_replace(coalesce(p_identifier, ''), '[\s.\-/]', '', 'g')), '');
begin
  if v_identifier is null then
    return null;
  end if;
  if p_kind is null or p_kind not in ('registration_number', 'vat_number', 'other') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'legal_entity_identifier_kind';
  end if;
  if v_identifier !~ '^[A-Z0-9]{4,32}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'legal_entity_identifier';
  end if;
  return v_identifier;
end;
$$;

revoke all on function private.legal_entity_identifier(text, text) from public, anon, authenticated, service_role;

-- Replaces the version of the organizations migration: the industry and the identifier join the input, the result
-- says whether the legal name was already in use (and only that, nothing about the other organization), an unknown
-- country or industry fails as a foreign-key violation (23503), and a type other than employer is a refusal
-- (CHARA_FORBIDDEN). No subscription is created; the organization stays on the free plan until checkout (D4).
drop function public.create_organization(public.organization_type, text, text, text, text);

create function public.create_organization(
  p_type public.organization_type,
  p_legal_name text,
  p_display_name text,
  p_based_in_country text,
  p_industry_code text,
  p_website text default null,
  p_identifier text default null,
  p_identifier_kind text default null
) returns jsonb
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
  v_identifier text;
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_existing public.organizations;
  v_duplicate boolean;
  v_trial_used boolean;
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
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_type_not_available';
  end if;
  if v_legal is null or p_industry_code is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = case when v_legal is null then 'legal_name' else 'industry_code' end;
  end if;
  v_identifier := private.legal_entity_identifier(p_identifier, p_identifier_kind);

  select o.* into v_existing
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = v_uid and m.role = 'owner'
    and private.legal_name_key(o.legal_name) = private.legal_name_key(v_legal)
    and o.created_at > now() - interval '1 minute';
  if found then
    return jsonb_build_object('organization_id', v_existing.id, 'slug', v_existing.slug, 'duplicate_legal_name', false);
  end if;
  if (select count(*) from public.organization_members m where m.user_id = v_uid and m.role = 'owner')
     >= (select (value #>> '{}')::integer from private.settings where key = 'organizations_per_user_max') then
    raise exception 'CHARA_LIMIT_REACHED' using detail = 'organizations';
  end if;

  v_duplicate := exists (
    select 1 from public.organizations o where private.legal_name_key(o.legal_name) = private.legal_name_key(v_legal)
  );
  v_trial_used := private.legal_entity_trial_used(v_identifier);

  v_base := btrim(left(btrim(regexp_replace(lower(extensions.unaccent(v_display)), '[^a-z0-9]+', '-', 'g'), '-'), 60), '-');
  if v_base = '' then
    v_base := 'org-' || left(v_id::text, 8);
  end if;

  loop
    v_slug := case when v_n = 1 then v_base
      else btrim(left(v_base, 51), '-') || '-' || case when v_n < 5 then substr(md5(random()::text), 1, 6) else left(v_id::text, 8) end
    end;
    begin
      insert into public.organizations (
        id, type, slug, legal_name, display_name, based_in_country, industry_code, website,
        legal_entity_identifier, legal_entity_identifier_kind
      )
      values (
        v_id, p_type, v_slug, v_legal, v_display, upper(btrim(p_based_in_country)), upper(btrim(p_industry_code)),
        nullif(btrim(p_website), ''), v_identifier, case when v_identifier is not null then p_identifier_kind end
      );
      exit;
    exception
      when unique_violation then
        if v_n >= 5 then
          raise exception 'CHARA_CONFLICT' using detail = 'slug';
        end if;
        v_n := v_n + 1;
      when check_violation or not_null_violation then
        get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
        raise exception 'CHARA_INVALID_INPUT' using detail = coalesce(nullif(v_constraint, ''), v_column);
    end;
  end loop;

  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (v_id, v_uid, 'owner', now());

  perform audit.record(
    'organization_created', 'organization', v_id::text,
    jsonb_build_object(
      'slug', v_slug, 'type', p_type, 'duplicate_legal_name', v_duplicate, 'legal_entity_trial_used', v_trial_used
    )
  );
  return jsonb_build_object('organization_id', v_id, 'slug', v_slug, 'duplicate_legal_name', v_duplicate);
end;
$$;

revoke all on function public.create_organization(
  public.organization_type, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_organization(
  public.organization_type, text, text, text, text, text, text, text
) to authenticated;

-- The owner sets or corrects the identifier at aal2 until a billing customer or subscription exists, so that the
-- identifier a trial was granted for cannot be swapped for another one afterwards.
create function public.set_legal_entity_identifier(p_org uuid, p_identifier text, p_kind text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identifier text;
begin
  perform private.assert_org_manager(p_org, 'owner');

  if private.legal_entity_locked(p_org) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'legal_entity_identifier_locked';
  end if;
  v_identifier := private.legal_entity_identifier(p_identifier, p_kind);
  if v_identifier is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'legal_entity_identifier';
  end if;

  update public.organizations
  set legal_entity_identifier = v_identifier, legal_entity_identifier_kind = p_kind
  where id = p_org;

  perform audit.record(
    'legal_entity_identifier_set', 'organization', p_org::text,
    jsonb_build_object('kind', p_kind, 'legal_entity_trial_used', private.legal_entity_trial_used(v_identifier))
  );
end;
$$;

revoke all on function public.set_legal_entity_identifier(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.set_legal_entity_identifier(uuid, text, text) to authenticated;
