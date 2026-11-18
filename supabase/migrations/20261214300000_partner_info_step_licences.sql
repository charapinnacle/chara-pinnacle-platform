-- Staff may ask a recruitment or staffing company for more information about its licences (FR-J4, FR-J2): Ready says
-- staff check the licences a partner declares, so the request-information step list names them too. The licences are not
-- an onboarding step: the request leads to the Licences section of the workforce profile, and Ready links there.

alter table public.organizations drop constraint organizations_info_step_check;
alter table public.organizations add constraint organizations_info_step_check
  check (info_step in ('company', 'where_you_serve', 'commitments', 'licences'));
comment on column public.organizations.info_step is
  'Onboarding step that staff reopened with a request for information: company, where_you_serve, commitments or licences.';

alter table public.partner_review_decisions drop constraint partner_review_decisions_info_step_check;
alter table public.partner_review_decisions add constraint partner_review_decisions_info_step_check
  check (info_step in ('company', 'where_you_serve', 'commitments', 'licences'));

-- admin_decide_partner of 20261208100000 with licences among the steps a request for information may name; everything
-- else is unchanged.
create or replace function public.admin_decide_partner(
  p_org uuid, p_decision text, p_reason text, p_info_step text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_reason text;
  v_org public.organizations;
  v_to public.partner_review_status;
  v_decision_id bigint;
begin
  v_uid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if p_decision is null or p_decision not in ('approve', 'request_info', 'decline') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'decision';
  end if;
  v_reason := private.statement_of_reasons(p_reason);
  if (p_decision = 'request_info') <> (p_info_step is not null)
     or (p_info_step is not null and p_info_step not in ('company', 'where_you_serve', 'commitments', 'licences')) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'info_step';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('partner_review_submission:' || p_org::text, 0));
  select * into v_org from public.organizations o where o.id = p_org for update;
  if not found or v_org.type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if private.is_own_organization(v_uid, p_org) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'own_organization';
  end if;
  if v_org.review_status not in ('pending_review', 're_review') then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = v_org.review_status::text;
  end if;

  v_to := case p_decision when 'approve' then 'listed' when 'request_info' then 'info_requested' else 'declined'
    end::public.partner_review_status;
  update public.organizations
  set review_status = v_to,
      listed_at = case when p_decision = 'approve' then coalesce(listed_at, now()) else listed_at end,
      info_step = p_info_step
  where id = p_org;

  insert into public.partner_review_decisions (
    organization_id, decision, reason, info_step, from_status, to_status, submitted_at, decided_by
  )
  values (p_org, p_decision, v_reason, p_info_step, v_org.review_status, v_to, v_org.submitted_at, v_uid)
  returning id into v_decision_id;

  perform private.audit_admin('partner.review_decided', 'organization', p_org::text, v_reason,
    jsonb_build_object('decision', p_decision, 'from', v_org.review_status, 'to', v_to, 'info_step', p_info_step));

  perform private.queue_org_event(
    p_org,
    case p_decision when 'approve' then 'partner_approved' when 'request_info' then 'partner_info_requested'
      else 'partner_declined' end,
    jsonb_build_object('decision_id', v_decision_id),
    'partner_review_decision:' || v_decision_id
  );

  return jsonb_build_object(
    'review_status', v_to,
    'listed_at', case when p_decision = 'approve' then coalesce(v_org.listed_at, now()) else v_org.listed_at end
  );
end;
$$;
