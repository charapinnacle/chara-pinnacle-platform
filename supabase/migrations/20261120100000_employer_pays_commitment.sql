-- The employer-pays commitment (FR-J3; docs/phase-2/DATA_MODEL.md sections 4, 7, 10 and 11 point 2; decision 2.7;
-- NFR-C6). Every recruitment and staffing company commits that it charges workers no recruitment fees or related costs.
-- The commitment is the organisation-level legal document employer-pays-commitment (seeded by V04 as the draft version
-- 0, which counts as published until counsel's text is); the accepted owner of the organisation accepts its current
-- version, recorded as a consents row of the owner (purpose employer-pays-commitment) and audited as
-- partner.commitment_accepted. private.org_consent_current decides whether the organisation holds a current acceptance:
-- an admin's or a member's row never counts, a new version needs a new acceptance and after a transfer of ownership the
-- new owner must accept again. Everything here belongs to release 2a and is refused while release_partner_directories is
-- false.

-- Whether the partner holds an acceptance of the current version of the commitment. The job order response (V44) and
-- candidate submission (V48) RPCs refuse with CHARA_CONSENT_REQUIRED detail employer-pays-commitment while it is false
-- (V52).
create function private.partner_commitment_current(p_org uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select private.org_consent_current(p_org, 'employer-pays-commitment')
$$;

revoke all on function private.partner_commitment_current(uuid) from public, anon, authenticated, service_role;

-- The commitment state of a partner for its members: the current version (and whether it is still the draft), whether
-- the organisation holds an acceptance of it, and the version its owner last accepted, so that a page can tell a
-- commitment never accepted from an outdated one. Any accepted member reads it; the owner alone accepts.
create function public.partner_commitment_status(p_org uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version integer := private.current_legal_version('employer-pays-commitment');
  v_accepted_version integer;
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if private.org_type(p_org) not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'partner_only';
  end if;

  select latest.version into v_accepted_version
  from public.organization_members m
  cross join lateral (
    select c.action, c.version
    from public.consents c
    where c.user_id = m.user_id and c.purpose = 'employer-pays-commitment'
    order by c.id desc
    limit 1
  ) latest
  where m.organization_id = p_org and m.role = 'owner' and m.accepted_at is not null and latest.action = 'granted';

  return jsonb_build_object(
    'version', v_version,
    'is_draft', coalesce((
      select d.is_draft from public.legal_documents d where d.slug = 'employer-pays-commitment' and d.version = v_version
    ), true),
    'accepted', private.partner_commitment_current(p_org),
    'accepted_version', v_accepted_version
  );
end;
$$;

revoke all on function public.partner_commitment_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.partner_commitment_status(uuid) to authenticated;

-- The owner accepts the current version of the commitment for the organisation (FR-J3 AC1, AC2). Only the accepted owner
-- of an active recruitment or staffing company, at aal1 (onboarding comes before the Security step, FR-J1 AC9); an admin,
-- a member, any other user and anonymous get CHARA_FORBIDDEN. p_version must be the current published version (the page
-- sends the version it showed): an older, a newer or an unpublished version raises CHARA_INVALID_INPUT detail version,
-- so nobody accepts a text they were not shown. Calls for one organisation are serialised by an advisory lock, so two
-- calls at the same moment record one row; a repeated call for a version already accepted records nothing and says so.
create function public.accept_employer_pays_commitment(p_org uuid, p_version integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'suspended') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_suspended';
  end if;
  if not private.is_org_member(p_org, 'owner') then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('employer_pays_commitment:' || p_org::text, 0));

  select * into v_org from public.organizations o where o.id = p_org;
  if v_org.type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'partner_only';
  end if;
  if v_org.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
  end if;
  if p_version is null or p_version is distinct from private.current_legal_version('employer-pays-commitment') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'version';
  end if;

  if private.partner_commitment_current(p_org) then
    return jsonb_build_object('version', p_version, 'changed', false);
  end if;

  insert into public.consents (user_id, purpose, version, action)
  values (v_uid, 'employer-pays-commitment', p_version, 'granted');
  perform audit.record('partner.commitment_accepted', 'organization', p_org::text, jsonb_build_object('version', p_version));
  return jsonb_build_object('version', p_version, 'changed', true);
end;
$$;

revoke all on function public.accept_employer_pays_commitment(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.accept_employer_pays_commitment(uuid, integer) to authenticated;

-- accept_consents (20261115100100) refuses the organisation-level documents: they are accepted by the owner for the
-- organisation through their own RPC (accept_employer_pays_commitment), never by any user for themselves, or an admin's
-- row would count once that admin became owner and an owner's acceptance would escape the audit of the organisation.
create or replace function public.accept_consents(p_consents jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status public.profile_status;
  v_kind public.account_kind;
  v_org_type public.organization_type;
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
  select p.status, coalesce(p.account_kind, p.intended_account_kind), p.intended_organization_type
  into v_status, v_kind, v_org_type
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
  v_own := private.required_consents(v_kind, v_org_type);
  v_other := private.other_consents(v_kind, v_org_type) || array['employer-pays-commitment', 'partner-dpa'];

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
