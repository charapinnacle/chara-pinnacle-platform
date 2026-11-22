-- A Trust & Safety administrator could hide a reported message, suspend its organisation or dismiss the report before
-- reading it: the text opens only to the one who puts the report in review (NFR-C5). public.moderation_decide of
-- 20270213100100_moderation_messages.sql with one addition: a report on a message or a contact request is decided only
-- while it is in review by the deciding administrator (CHARA_INVALID_STATE not_in_review). Grants are kept.

create or replace function public.moderation_decide(
  p_decision text,
  p_reasons text,
  p_report bigint default null,
  p_target_type text default null,
  p_target_id uuid default null
) returns table (moderation_action_id bigint, report_status public.report_status)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reasons text;
  v_report public.reports;
  v_type text := p_target_type;
  v_target uuid := p_target_id;
  v_org uuid;
  v_action bigint;
  v_in_effect boolean := false;
  v_status public.report_status;
  v_items constant text[] := array['requirement', 'partner_response', 'candidate_submission', 'message', 'contact_request'];
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  v_reasons := private.statement_of_reasons(p_reasons);
  if p_decision is null or p_decision not in ('hide', 'unhide', 'suspend_organization', 'reinstate_organization', 'dismiss') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'decision';
  end if;

  if p_report is not null then
    if p_target_type is not null or p_target_id is not null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'target';
    end if;
    select * into v_report from public.reports r where r.id = p_report for no key update;
    if not found then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_org := coalesce(
      v_report.organization_id,
      (select j.organization_id from public.jobs j where j.id = v_report.job_id),
      (select a.organization_id from public.job_applications a where a.id = v_report.application_id),
      (select i.organization_id from private.moderated_item(v_report.target_type::text, private.report_item_id(v_report)) i)
    );
    if v_org is not null and private.is_own_organization(v_uid, v_org) then
      raise exception 'CHARA_FORBIDDEN' using detail = 'own_organization';
    end if;
    if v_report.status not in ('new', 'in_review') then
      raise exception 'CHARA_INVALID_STATE' using detail = v_report.status::text;
    end if;
    if v_report.target_type in ('message', 'contact_request')
       and (v_report.status <> 'in_review' or v_report.handled_by is distinct from v_uid) then
      raise exception 'CHARA_INVALID_STATE' using detail = 'not_in_review';
    end if;
    if p_decision = 'hide' and v_report.target_type in ('job', 'partner_profile') then
      v_type := v_report.target_type::text;
      v_target := case when v_report.target_type = 'job' then v_report.job_id else v_report.organization_id end;
    elsif p_decision = 'hide' and v_report.target_type::text = any (v_items) then
      v_type := v_report.target_type::text;
      v_target := private.report_item_id(v_report);
    elsif p_decision = 'suspend_organization'
      and (v_report.target_type in ('job', 'company', 'partner_profile') or v_report.target_type::text = any (v_items)) then
      if v_org is null and v_report.target_type = 'message'
         and exists (select 1 from public.messages m where m.id = v_report.message_id) then
        raise exception 'CHARA_INVALID_INPUT' using detail = 'decision';
      end if;
      if v_org is null then
        raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
      end if;
      v_type := 'organization';
      v_target := v_org;
    elsif p_decision <> 'dismiss' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'decision';
    end if;
  elsif p_decision = 'dismiss'
     or p_target_id is null
     or p_target_type is null
     or not (
       ((p_target_type in ('job', 'partner_profile') or p_target_type = any (v_items)) and p_decision in ('hide', 'unhide'))
       or (p_target_type = 'organization' and p_decision in ('suspend_organization', 'reinstate_organization'))
     ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = case when p_decision = 'dismiss' then 'decision' else 'target' end;
  else
    v_org := case
      when p_target_type = 'job' then (select j.organization_id from public.jobs j where j.id = p_target_id)
      when p_target_type = any (v_items) then (select i.organization_id from private.moderated_item(p_target_type, p_target_id) i)
      else p_target_id
    end;
    if v_org is not null and private.is_own_organization(v_uid, v_org) then
      raise exception 'CHARA_FORBIDDEN' using detail = 'own_organization';
    end if;
  end if;

  -- A report that asks for what is already in effect. The rows are locked in the order of the actions (the organisation,
  -- then the item), so the state read here holds until the report is closed. A worker's message has no organisation.
  if p_report is not null and p_decision in ('hide', 'suspend_organization') and (v_org is not null or v_type = any (v_items)) then
    if v_org is not null then
      perform 1 from public.organizations o where o.id = v_org for no key update;
    end if;
    v_in_effect := case
      when p_decision = 'suspend_organization' then (select o.status = 'suspended' from public.organizations o where o.id = v_org)
      when v_type = 'job' then (select j.moderation_state = 'hidden' from public.jobs j where j.id = v_target for no key update)
      when v_type = any (v_items) then private.lock_moderated_item(v_type, v_target) = 'hidden'
      else (select o.moderation_state = 'hidden' from public.organizations o where o.id = v_target)
    end;
    if v_in_effect then
      select a.id into v_action
      from public.moderation_actions a
      where a.target_type = v_type and a.target_id = v_target
        and a.action = case v_type when 'job' then 'job_hidden' when 'organization' then 'organization_suspended' else 'content_hidden' end
      order by a.id desc
      limit 1;
    end if;
  end if;

  if p_decision <> 'dismiss' and not coalesce(v_in_effect, false) then
    v_action := case
      when v_type = 'job' then private.set_job_moderation(v_target, p_decision = 'hide', v_reasons, p_report)
      when v_type = 'partner_profile' then private.set_partner_profile_moderation(v_target, p_decision = 'hide', v_reasons, p_report)
      when v_type = any (v_items) then private.set_item_moderation(v_type, v_target, p_decision = 'hide', v_reasons, p_report)
      when p_decision = 'suspend_organization' then private.suspend_organization_with(v_target, v_reasons, p_report)
      else private.reinstate_organization_with(v_target, v_reasons, p_report)
    end;
  end if;

  if p_report is not null then
    v_status := (case when p_decision = 'dismiss' then 'dismissed' else 'actioned' end)::public.report_status;
    update public.reports
    set status = v_status, handled_by = v_uid, handled_at = now(), resolution_note = v_reasons
    where id = p_report;
    perform private.audit_admin(
      'report.' || v_status::text, 'report', p_report::text, v_reasons,
      jsonb_strip_nulls(jsonb_build_object(
        'from', v_report.status, 'to', v_status, 'target_type', v_report.target_type, 'decision', p_decision,
        'moderation_action_id', v_action, 'already_in_effect', case when v_in_effect then true end
      ))
    );
    if v_report.reporter_user_id is not null
       and exists (select 1 from public.profiles p where p.id = v_report.reporter_user_id) then
      perform pgmq.send('notifications', jsonb_build_object(
        'kind', 'moderation_decision', 'user_id', v_report.reporter_user_id, 'mandatory', true, 'report_id', p_report,
        'outcome', v_status
      ));
    end if;
  end if;

  moderation_action_id := v_action;
  report_status := v_status;
  return next;
end;
$$;
