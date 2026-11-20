-- Reporting a message and the reported context (FR-P3 AC6 and AC7, SOP P2-28 steps Report and Review; decision 5.5;
-- NFR-C5, NFR-S8, NFR-S10; docs/phase-2/DATA_MODEL.md sections 2 and 4; V66, release 2c).
--
-- - Report target message (20270206100000): a report holds the message id and nothing else (no foreign key: retention and
--   erasure delete messages, the report is kept). Only a participant of the conversation reports a message, and not one
--   of the own; anyone else, an unknown id and every message while release_messaging is off get the same CHARA_NOT_FOUND.
-- - admin_get_reported_message(report): the reported message and up to five messages before and five after it in its
--   conversation, for the Trust & Safety Administrator handling the report only (the staff member who put it in review,
--   reports.handled_by, at aal2, while it is in review). Every opening writes one audit row message.context_opened with
--   the report and the message ids, never a body. Nobody else on the staff reads a message: the tables stay closed to
--   them (V63). The moderation decisions on messages (hide, statement of reasons, appeal) are V73's (FR-S1).

alter table public.reports add column message_id uuid;

comment on column public.reports.message_id is
  'The message a report is about (FR-P3 AC6). No foreign key: retention and erasure delete messages, the report is kept.';

create index reports_message_idx on public.reports (message_id) where message_id is not null;

-- reports_target_check of 20270111100100 with the message: exactly the id of the item, nothing else.
alter table public.reports drop constraint reports_target_check;
alter table public.reports add constraint reports_target_check check (
  (target_type in ('requirement', 'partner_response', 'candidate_submission', 'message')
    or (requirement_id is null and partner_response_id is null and candidate_submission_id is null and message_id is null))
  and case target_type
    when 'job' then job_id is not null and organization_id is null and application_id is null and content_path is null
    when 'company' then organization_id is not null and application_id is null and content_path is null
    when 'profile' then application_id is not null and job_id is null and organization_id is null and content_path is null
      and reporter_user_id is not null
    when 'content' then content_path is not null and job_id is null and organization_id is null and application_id is null
    when 'partner_profile' then organization_id is not null and job_id is null and application_id is null and content_path is null
    else job_id is null and organization_id is null and application_id is null and content_path is null
      and reporter_user_id is not null
      and (requirement_id is not null)::integer + (partner_response_id is not null)::integer
        + (candidate_submission_id is not null)::integer + (message_id is not null)::integer = 1
      and case target_type
        when 'requirement' then requirement_id is not null
        when 'partner_response' then partner_response_id is not null
        when 'candidate_submission' then candidate_submission_id is not null
        else message_id is not null
      end
  end
);

-- Whether the caller may report p_message: a message of a conversation the caller takes part in
-- (private.accessible_conversation_ids: the candidate, or a member of a participating organisation, owners and admins at
-- aal2), not sent by the caller, while release_messaging is on.
create function private.reportable_message(p_message uuid, p_uid uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.release_on('release_messaging') and exists (
    select 1 from public.messages m
    where m.id = p_message and m.sender_user_id is distinct from p_uid
      and m.conversation_id in (select private.accessible_conversation_ids())
  )
$$;

revoke all on function private.reportable_message(uuid, uuid) from public, anon, authenticated, service_role;

-- submit_report of 20270111100100 with the target message (p_message): signed-in participants only
-- (private.reportable_message), the same CHARA_NOT_FOUND for a message that is not theirs to report, unknown, or while the
-- release is off. Everything else is unchanged: the checks of the input, the visitor throttle (action report) counted in
-- the transaction, the answer for a repeated report within 24 hours, the audit row without the text, the address or the
-- message body.
drop function public.submit_report(
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid
);

create function public.submit_report(
  p_target_type public.report_target_type,
  p_category public.report_category,
  p_details text,
  p_good_faith boolean,
  p_key text,
  p_job uuid default null,
  p_application uuid default null,
  p_path text default null,
  p_email text default null,
  p_proof text default null,
  p_partner text default null,
  p_requirement uuid default null,
  p_response uuid default null,
  p_submission uuid default null,
  p_message uuid default null
) returns table (reference text, is_duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_details text := btrim(p_details, E' \t\r\n');
  v_email text := case when (select auth.uid()) is null then lower(nullif(btrim(p_email), '')) end;
  v_job uuid;
  v_org uuid;
  v_app uuid;
  v_item uuid := case p_target_type
    when 'requirement' then p_requirement when 'partner_response' then p_response when 'candidate_submission' then p_submission
    when 'message' then p_message
  end;
  v_path text := btrim(p_path);
  v_allowed boolean;
  v_retry integer;
  v_existing bigint;
  v_id bigint;
begin
  if p_target_type is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'target_type';
  end if;
  if p_category is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'category';
  end if;
  if v_details is null or char_length(v_details) not between 20 and 2000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'details';
  end if;
  if p_good_faith is not true then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'good_faith';
  end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'email';
  end if;
  if p_target_type in ('profile', 'requirement', 'partner_response', 'candidate_submission', 'message') and v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'sign_in_required';
  end if;
  if p_target_type = 'content' and (v_path is null or v_path !~ '^/[A-Za-z0-9._~%/-]{1,255}$' or v_path ~ '//|\.\.') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'path';
  end if;
  if p_target_type in ('job', 'company') and p_job is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'job';
  end if;
  if p_target_type = 'profile' and p_application is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'application';
  end if;
  if p_target_type = 'partner_profile' and (p_partner is null or btrim(p_partner) = '') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'partner';
  end if;
  if p_target_type in ('requirement', 'partner_response', 'candidate_submission', 'message') and v_item is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = case p_target_type
      when 'requirement' then 'requirement' when 'partner_response' then 'response' when 'message' then 'message'
      else 'submission' end;
  end if;

  select a.allowed, a.retry_after_seconds into v_allowed, v_retry from public.rate_limit_attempt('report', p_key, p_proof) a;
  if not v_allowed then
    raise exception 'CHARA_RATE_LIMITED' using detail = v_retry::text;
  end if;

  if p_target_type in ('job', 'company') then
    select j.id, j.organization_id into v_job, v_org
    from public.jobs j
    where j.id = p_job and j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible';
    if not found then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif p_target_type = 'profile' then
    v_app := (private.member_application('submit_report', p_application)).id;
  elsif p_target_type = 'partner_profile' then
    -- The profiles that get_partner_profile shows, and only while release 2a is on.
    if private.release_on('release_partner_directories') then
      select o.id into v_org
      from public.organizations o
      where o.slug = p_partner and o.type <> 'employer' and o.moderation_state = 'visible' and private.is_listed_partner(o.id);
    end if;
    if v_org is null then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif p_target_type in ('requirement', 'partner_response', 'candidate_submission') then
    if not private.reportable_item(p_target_type::text, v_item, v_uid) then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif p_target_type = 'message' then
    if not private.reportable_message(v_item, v_uid) then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  if v_uid is not null or v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended('report:' || coalesce(v_uid::text, v_email), 0));
    select r.id into v_existing
    from public.reports r
    where r.target_type = p_target_type and r.category = p_category
      and r.created_at > now() - interval '24 hours'
      and case when v_uid is not null then r.reporter_user_id = v_uid else r.reporter_email = v_email end
      and case p_target_type
        when 'job' then r.job_id = v_job
        when 'company' then r.organization_id = v_org
        when 'partner_profile' then r.organization_id = v_org
        when 'profile' then r.application_id = v_app
        when 'requirement' then r.requirement_id = v_item
        when 'partner_response' then r.partner_response_id = v_item
        when 'candidate_submission' then r.candidate_submission_id = v_item
        when 'message' then r.message_id = v_item
        else r.content_path = v_path
      end
    order by r.id desc
    limit 1;
    if found then
      reference := private.report_reference(v_existing);
      is_duplicate := true;
      return next;
      return;
    end if;
  end if;

  insert into public.reports (
    target_type, job_id, organization_id, application_id, content_path, requirement_id, partner_response_id,
    candidate_submission_id, message_id, category, details, reporter_user_id, reporter_email, good_faith_confirmed
  ) values (
    p_target_type,
    case when p_target_type in ('job', 'company') then v_job end,
    case when p_target_type in ('company', 'partner_profile') then v_org end,
    v_app,
    case when p_target_type = 'content' then v_path end,
    case when p_target_type = 'requirement' then v_item end,
    case when p_target_type = 'partner_response' then v_item end,
    case when p_target_type = 'candidate_submission' then v_item end,
    case when p_target_type = 'message' then v_item end,
    p_category, v_details, v_uid, v_email, true
  ) returning id into v_id;

  perform audit.record(
    'report.submitted', 'report', v_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'target_type', p_target_type, 'category', p_category, 'job_id', v_job, 'organization_id', v_org,
      'application_id', v_app, 'requirement_id', case when p_target_type = 'requirement' then v_item end,
      'partner_response_id', case when p_target_type = 'partner_response' then v_item end,
      'candidate_submission_id', case when p_target_type = 'candidate_submission' then v_item end,
      'message_id', case when p_target_type = 'message' then v_item end,
      'request_id', private.request_id()
    ))
  );
  reference := private.report_reference(v_id);
  is_duplicate := false;
  return next;
end;
$$;

revoke all on function public.submit_report(
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.submit_report(
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid
) to anon, authenticated;

-- private.report_target_label of 20270111100100 with the message, which the lists name by its kind only: its text is
-- read through admin_get_reported_message, by the handler, audited.
create or replace function private.report_target_label(p_type public.report_target_type, p_job_title text, p_org_name text, p_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'job' then p_job_title
    when 'company' then p_org_name
    when 'partner_profile' then p_org_name
    when 'content' then p_path
    when 'requirement' then coalesce(p_job_title, 'Job order')
    when 'partner_response' then coalesce(p_org_name, 'Partner response')
    when 'candidate_submission' then coalesce(p_org_name, 'Candidate submission')
    when 'message' then 'Message'
    else 'Candidate profile'
  end
$$;

-- The reported message of the report p_report and up to five messages before and five after it in the same conversation,
-- oldest first (FR-P3 AC7, decision 5.5, NFR-C5): the time, the side, the sender as staff may know it (an organisation by
-- display name and the member by display name; a candidate as "Candidate", as staff never read candidates' names, FR-F3)
-- and the body; reported marks the reported message. Only the Trust & Safety Administrator handling the report: the one
-- who put it in review (reports.handled_by), at aal2, while it is in review. Refusals, each writing nothing: release_messaging
-- off, CHARA_FORBIDDEN release_off; anyone else on the staff, the handler at aal1 and every other caller, CHARA_FORBIDDEN; a report that is not about a message or
-- unknown, CHARA_NOT_FOUND; a report not in review, CHARA_INVALID_STATE (the status); a message deleted since (retention or
-- erasure), CHARA_NOT_FOUND message_gone. Every opening writes one audit row message.context_opened (the report, the
-- conversation and the message ids, never a body).
create function public.admin_get_reported_message(p_report bigint)
returns table (
  id uuid, created_at timestamptz, sender_kind text, sender_name text, sender_organization_name text, body text,
  reported boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_report public.reports;
  v_message public.messages;
  v_ids uuid[];
begin
  if not private.release_on('release_messaging') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  select * into v_report from public.reports r where r.id = p_report;
  if not found or v_report.target_type <> 'message' then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_report.handled_by is distinct from v_uid then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if v_report.status <> 'in_review' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_report.status::text;
  end if;
  select * into v_message from public.messages m where m.id = v_report.message_id;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using detail = 'message_gone', errcode = 'P0002';
  end if;

  select array_agg(w.id order by w.created_at, w.id) into v_ids
  from (
    (select m.id, m.created_at from public.messages m
     where m.conversation_id = v_message.conversation_id and (m.created_at, m.id) < (v_message.created_at, v_message.id)
     order by m.created_at desc, m.id desc limit 5)
    union all
    select v_message.id, v_message.created_at
    union all
    (select m.id, m.created_at from public.messages m
     where m.conversation_id = v_message.conversation_id and (m.created_at, m.id) > (v_message.created_at, v_message.id)
     order by m.created_at, m.id limit 5)
  ) w;

  perform audit.record('message.context_opened', 'report', v_report.id::text, jsonb_build_object(
    'conversation_id', v_message.conversation_id, 'message_id', v_message.id, 'message_ids', to_jsonb(v_ids),
    'request_id', private.request_id()));

  return query
  select m.id, m.created_at,
    case when m.sender_organization_id is null then 'worker' else 'organization' end,
    case when m.sender_organization_id is null then 'Candidate'
         else (select u.display_name from public.profiles u where u.id = m.sender_user_id) end,
    (select o.display_name from public.organizations o where o.id = m.sender_organization_id),
    m.body, m.id = v_message.id
  from unnest(v_ids) with ordinality u(message_id, n)
  join public.messages m on m.id = u.message_id
  order by u.n;
end;
$$;

revoke all on function public.admin_get_reported_message(bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_reported_message(bigint) to authenticated;
