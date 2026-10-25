-- Submission of a partner for staff review (FR-J1 AC10, the Ready step; docs/phase-2/DATA_MODEL.md sections 4, 5 and 7).
-- The owner or an admin of a recruitment or staffing company, at aal2 (the Security step comes before Ready), submits
-- the organisation once its profile is complete: the legal-entity identifier, a country it sources from, a country it
-- serves, an occupation, the recruitment type, the staffing types its type requires [d2.4] and a current acceptance of
-- the employer-pays commitment (V08). The organisation moves from onboarding, or from info_requested after staff asked
-- for more information (V11), to pending_review, or to re_review when it was listed before; submitted_at is the time it
-- joined the queue. The review target shown to the partner is the setting partner_review_target_working_days
-- (decision 7.2: one working day), public because the Ready screen and the pending dashboard state show it. Everything
-- here belongs to release 2a and is refused while release_partner_directories is false.

insert into private.settings (key, value) values ('partner_review_target_working_days', '1')
on conflict (key) do nothing;

create or replace function public.get_public_settings() returns table (key text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.value #>> '{}'
  from private.settings s
  where s.key = any (array[
    'legal_entity_name', 'legal_entity_address', 'legal_entity_registration_number', 'legal_entity_vat_id',
    'legal_entity_email', 'privacy_contact', 'data_protection_contact', 'release_partner_directories',
    'partner_review_target_working_days'
  ])
$$;

-- The first field a partner still has to complete before it may be submitted, in the order of the onboarding steps, or
-- null when the profile is complete. The names are the details of CHARA_PROFILE_INCOMPLETE, which the Ready step maps to
-- the step that completes them.
create function private.partner_profile_missing(p_org uuid) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when o.legal_entity_identifier is null then 'legal_entity_identifier'
    when not exists (
      select 1 from public.organization_geographies g where g.organization_id = o.id and g.scope = 'sources_from'
    ) then 'sources_from'
    when not exists (
      select 1 from public.organization_geographies g where g.organization_id = o.id and g.scope = 'serves_market'
    ) then 'serves_market'
    when not exists (select 1 from public.organization_occupations c where c.organization_id = o.id) then 'occupations'
    when o.recruitment_type is null then 'recruitment_type'
    -- A staffing company names a staffing type; a recruitment company that adds the service staffing names one too.
    when (o.type = 'staffing_company' or exists (
      select 1 from public.organization_service_types s where s.organization_id = o.id and s.service = 'staffing'
    )) and not exists (
      select 1 from public.organization_service_types s where s.organization_id = o.id and s.service <> 'staffing'
    ) then 'staffing_types'
    when not private.partner_commitment_current(o.id) then 'employer_pays_commitment'
  end
  from public.organizations o
  where o.id = p_org
$$;

revoke all on function private.partner_profile_missing(uuid) from public, anon, authenticated, service_role;

-- Submits the partner for review (FR-J1 AC10, FR-J4 AC7 resubmission). Owner or admin of an active partner at aal2; a
-- member, any other user and the owner at aal1 get CHARA_FORBIDDEN (detail aal2_required for the last), anonymous has no
-- grant. An advisory lock serialises submissions of one organisation, so a double click audits once. A partner already in
-- the queue (pending_review, re_review) gets its state back with changed false and nothing is written; a listed or
-- declined partner has nothing to submit (CHARA_INVALID_TRANSITION). An incomplete profile raises
-- CHARA_PROFILE_INCOMPLETE naming the first missing field. The submission clears info_step: the step staff reopened has
-- been answered.
create function public.submit_partner_for_review(p_org uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
  v_missing text;
  v_status public.partner_review_status;
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
  if not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('partner_review_submission:' || p_org::text, 0));

  select * into v_org from public.organizations o where o.id = p_org;
  if v_org.type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'partner_only';
  end if;
  if v_org.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
  end if;
  if v_org.review_status in ('pending_review', 're_review') then
    return jsonb_build_object('review_status', v_org.review_status, 'submitted_at', v_org.submitted_at, 'changed', false);
  end if;
  if v_org.review_status not in ('onboarding', 'info_requested') then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = v_org.review_status::text;
  end if;

  v_missing := private.partner_profile_missing(p_org);
  if v_missing is not null then
    raise exception 'CHARA_PROFILE_INCOMPLETE' using detail = v_missing;
  end if;

  v_status := case when v_org.listed_at is null then 'pending_review' else 're_review' end::public.partner_review_status;
  update public.organizations
  set review_status = v_status, submitted_at = now(), info_step = null
  where id = p_org;

  perform audit.record('partner.submitted_for_review', 'organization', p_org::text,
    jsonb_build_object('from', v_org.review_status, 'to', v_status, 'info_step', v_org.info_step));
  return jsonb_build_object('review_status', v_status, 'submitted_at', now(), 'changed', true);
end;
$$;

revoke all on function public.submit_partner_for_review(uuid) from public, anon, authenticated, service_role;
grant execute on function public.submit_partner_for_review(uuid) to authenticated;
