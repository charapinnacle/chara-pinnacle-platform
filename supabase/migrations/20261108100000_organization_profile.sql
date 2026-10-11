-- The organisation profile after registration (FR-A2, FR-A5; OPEN_QUESTIONS.md D78). An owner or administrator corrects the
-- legal name, the display name, the country, the industry and the website through this function; the table keeps no
-- update grant, so it is the only way to change them. The legal name follows the lock of the legal-entity identifier
-- (private.legal_entity_locked): once a billing customer or a subscription exists it is the name the payment was started
-- for. The identifier itself keeps its own owner-only function. The slug never changes, so the addresses of the
-- organisation and of its vacancies stay valid.

create function public.update_organization_profile(
  p_org uuid,
  p_legal_name text,
  p_display_name text,
  p_based_in_country text,
  p_industry_code text,
  p_website text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.organizations;
  v_new public.organizations;
  v_legal text := nullif(btrim(p_legal_name), '');
  v_changed jsonb;
  v_duplicate boolean := false;
  v_constraint text;
  v_column text;
begin
  -- Caller, active profile, owner or admin role, aal2 and an active organisation; locks the organisation row.
  perform private.assert_org_manager(p_org, 'admin');
  if v_legal is null or nullif(btrim(p_industry_code), '') is null or nullif(btrim(p_based_in_country), '') is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = case
      when v_legal is null then 'legal_name'
      when nullif(btrim(p_industry_code), '') is null then 'industry_code'
      else 'based_in_country' end;
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
        industry_code = upper(btrim(p_industry_code)),
        website = nullif(btrim(p_website), '')
    where id = p_org
    returning * into v_new;
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
      raise exception 'CHARA_INVALID_INPUT' using detail = coalesce(nullif(v_constraint, ''), v_column);
  end;

  select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
  from jsonb_each(to_jsonb(v_new)) n
  where n.key in ('legal_name', 'display_name', 'based_in_country', 'industry_code', 'website')
    and n.value is distinct from to_jsonb(v_old) -> n.key;
  if jsonb_array_length(v_changed) = 0 then
    return jsonb_build_object('changed_fields', v_changed, 'duplicate_legal_name', false);
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
  return jsonb_build_object('changed_fields', v_changed, 'duplicate_legal_name', v_duplicate);
end;
$$;

revoke all on function public.update_organization_profile(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_organization_profile(uuid, text, text, text, text, text) to authenticated;
