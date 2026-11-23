-- A recruitment or staffing company has no industry of its own: the industries it serves are asked in What you offer
-- (organization_industries), so the Company step and the company profile no longer ask for one, and it is stored as null.
-- Its description is required instead, at least 50 characters, as employers and staff read it to know the company.
-- Employers keep the required industry and the optional description.
create or replace function public.create_organization(p_type organization_type, p_legal_name text, p_display_name text, p_based_in_country text, p_industry_code text, p_website text DEFAULT NULL::text, p_identifier text DEFAULT NULL::text, p_identifier_kind text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_id uuid := gen_random_uuid();
  v_legal text := btrim(p_legal_name);
  v_display text := coalesce(nullif(btrim(p_display_name), ''), btrim(p_legal_name));
  v_partner boolean := p_type in ('recruitment_company', 'staffing_company');
  v_identifier text;
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_existing public.organizations;
  v_duplicate boolean;
  v_same_type boolean;
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
  if p_type is null or (v_partner and not private.release_on('release_partner_directories')) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_type_not_available';
  end if;
  if p_type <> coalesce(v_profile.intended_organization_type, 'employer') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_type_mismatch';
  end if;
  if v_legal is null or (not v_partner and p_industry_code is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = case when v_legal is null then 'legal_name' else 'industry_code' end;
  end if;
  v_identifier := private.legal_entity_identifier(p_identifier, p_identifier_kind);
  if v_partner and v_identifier is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'legal_entity_identifier';
  end if;
  if v_partner and char_length(btrim(coalesce(p_description, ''), E' \t\r\n')) < 50 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'description';
  end if;

  select o.* into v_existing
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = v_uid and m.role = 'owner'
    and private.legal_name_key(o.legal_name) = private.legal_name_key(v_legal)
    and o.created_at > now() - interval '1 minute';
  if found then
    return jsonb_build_object(
      'organization_id', v_existing.id, 'slug', v_existing.slug,
      'duplicate_legal_name', exists (
        select 1 from public.organizations o
        where private.legal_name_key(o.legal_name) = private.legal_name_key(v_legal) and o.id <> v_existing.id
      )
    );
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
        legal_entity_identifier, legal_entity_identifier_kind, description
      )
      values (
        v_id, p_type, v_slug, v_legal, v_display, upper(btrim(p_based_in_country)), case when v_partner then null else upper(btrim(p_industry_code)) end,
        nullif(btrim(p_website), ''), v_identifier, case when v_identifier is not null then p_identifier_kind end,
        nullif(btrim(p_description, E' \t\r\n'), '')
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

  -- The links were written by the trigger organizations_identifier_links.
  v_same_type := exists (
    select 1 from private.organization_identifier_links l where l.organization_id = v_id and l.same_type
  );

  perform audit.record(
    'organization_created', 'organization', v_id::text,
    jsonb_build_object(
      'slug', v_slug, 'type', p_type, 'duplicate_legal_name', v_duplicate, 'legal_entity_trial_used', v_trial_used
    ) || case when v_partner then jsonb_build_object('duplicate_identifier_same_type', v_same_type) else '{}'::jsonb end
  );
  return jsonb_build_object('organization_id', v_id, 'slug', v_slug, 'duplicate_legal_name', v_duplicate);
end;
$function$;

create or replace function public.update_organization_profile(p_org uuid, p_legal_name text, p_display_name text, p_based_in_country text, p_industry_code text, p_website text, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old public.organizations;
  v_new public.organizations;
  v_legal text := nullif(btrim(p_legal_name), '');
  v_changed jsonb;
  v_duplicate boolean := false;
  v_constraint text;
  v_column text;
  v_partner boolean;
begin
  -- Caller, active profile, owner or admin role, aal2 and an active organisation; locks the organisation row.
  perform private.assert_org_manager(p_org, 'admin');
  v_partner := (select o.type in ('recruitment_company', 'staffing_company') from public.organizations o where o.id = p_org);
  if v_legal is null or (not v_partner and nullif(btrim(p_industry_code), '') is null) or nullif(btrim(p_based_in_country), '') is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = case
      when v_legal is null then 'legal_name'
      when nullif(btrim(p_industry_code), '') is null then 'industry_code'
      else 'based_in_country' end;
  end if;
  if v_partner and char_length(btrim(coalesce(p_description, ''), E' \t\r\n')) < 50 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'description';
  end if;

  select * into v_old from public.organizations o where o.id = p_org;
  if v_legal is distinct from v_old.legal_name and private.legal_entity_locked(p_org) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'legal_name_locked';
  end if;

  begin
    update public.organizations
    set legal_name = v_legal,
        display_name = coalesce(nullif(btrim(p_display_name), ''), v_legal),
        based_in_country = upper(btrim(p_based_in_country)),
        industry_code = case when v_partner then null else upper(btrim(p_industry_code)) end,
        website = nullif(btrim(p_website), ''),
        description = nullif(btrim(p_description, E' \t\r\n'), '')
    where id = p_org
    returning * into v_new;
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
      raise exception 'CHARA_INVALID_INPUT' using detail = coalesce(nullif(v_constraint, ''), v_column);
  end;

  select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
  from jsonb_each(to_jsonb(v_new)) n
  where n.key in ('legal_name', 'display_name', 'based_in_country', 'industry_code', 'website', 'description')
    and n.value is distinct from to_jsonb(v_old) -> n.key;
  -- The stored display name is returned because an empty one becomes the legal name, and the form shows what is stored.
  if jsonb_array_length(v_changed) = 0 then
    return jsonb_build_object('display_name', v_new.display_name, 'duplicate_legal_name', false);
  end if;

  -- As at registration (FR-A2 AC5): a name another organisation already uses is reported, never refused, and nothing
  -- about the other organisation is returned.
  if v_changed ? 'legal_name' then
    v_duplicate := exists (
      select 1 from public.organizations o
      where private.legal_name_key(o.legal_name) = private.legal_name_key(v_legal) and o.id <> p_org
    );
  end if;
  perform audit.record(
    'organization.updated', 'organization', p_org::text,
    jsonb_build_object('changed_fields', v_changed, 'duplicate_legal_name', v_duplicate)
  );
  return jsonb_build_object('display_name', v_new.display_name, 'duplicate_legal_name', v_duplicate);
end;
$function$;
