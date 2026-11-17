-- Moderation of messages and contact requests (FR-S1 release 2c parts: steps Receive, Review, Decide, Inform, Appeal and
-- Effect; FR-J3 2c parts; FR-Q3 AC11, the Report part deferred by V70; FR-P3 AC6 and AC7 as built by V66; NFR-C5, NFR-C7,
-- NFR-S8; DSA Art. 16, 17 and 20; docs/phase-2/DATA_MODEL.md sections 2 and 4; V73, release 2c). The moderation of V26
-- to V28 and V57 is extended, not duplicated:
-- - Report target contact_request (20270213100000): the addressed worker reports a request (any status), the report
--   holds its id and nothing else (no foreign key: erasure and retention delete requests, the report is kept). Anyone
--   else, an unknown id, a hidden request and every request while release_find_workers is off get the same
--   CHARA_NOT_FOUND. A message that is hidden can no longer be reported.
-- - moderation_state on messages and contact_requests (visible, hidden; the suspension of an organisation already closes
--   its conversations, V63, so neither moves to org_suspended). private.moderated_item names them (the sending
--   organisation, none for a worker's message), so moderation_decide hides and unhides them (content_hidden and
--   content_unhidden) and suspends the sending organisation of a report about one, as for the items of V57.
-- - What hiding does: a hidden message leaves the conversation for the other side (list_messages, the unread counts and
--   the direct select of its rows) and stays with the sender's side, marked hidden with the decision; a hidden contact
--   request leaves the worker's list and can no longer be answered, and the organisation reads it marked hidden.
-- - Inform: the mandatory moderation_decision goes to the owners and admins of the sending organisation and to the
--   member who sent the message, or to the worker who sent it; the reporter's outcome is V27's.
-- - Appeal (V28): the sender of a hidden message appeals it, a worker without an organisation too (appeals.organization_id
--   becomes null for that appeal), the owners and admins of the sending organisation as for any decision; a hidden
--   contact request is appealed by the owners and admins.
-- - The text of a reported contact request is read like a reported message (NFR-C5): only through
--   admin_get_reported_message by the Trust & Safety Administrator handling the report, each opening audited.

-- Columns ------------------------------------------------------------------------------------------------------------------

alter table public.reports add column contact_request_id uuid;

comment on column public.reports.contact_request_id is
  'The contact request a report is about (FR-Q3 AC11). No foreign key: erasure and retention delete requests, the report is kept.';

create index reports_contact_request_idx on public.reports (contact_request_id) where contact_request_id is not null;

-- reports_target_check of 20270206100200 with the contact request: exactly the id of the item, nothing else.
alter table public.reports drop constraint reports_target_check;
alter table public.reports add constraint reports_target_check check (
  (target_type in ('requirement', 'partner_response', 'candidate_submission', 'message', 'contact_request')
    or (requirement_id is null and partner_response_id is null and candidate_submission_id is null and message_id is null
      and contact_request_id is null))
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
        + (candidate_submission_id is not null)::integer + (message_id is not null)::integer
        + (contact_request_id is not null)::integer = 1
      and case target_type
        when 'requirement' then requirement_id is not null
        when 'partner_response' then partner_response_id is not null
        when 'candidate_submission' then candidate_submission_id is not null
        when 'message' then message_id is not null
        else contact_request_id is not null
      end
  end
);

alter table public.messages add column moderation_state public.job_moderation_state not null default 'visible'
  check (moderation_state <> 'org_suspended');
alter table public.contact_requests add column moderation_state public.job_moderation_state not null default 'visible'
  check (moderation_state <> 'org_suspended');

comment on column public.messages.moderation_state is
  'hidden by a moderation decision (FR-S1): out of the other side''s sight, kept for the sender''s side. Written only by private.set_item_moderation.';
comment on column public.contact_requests.moderation_state is
  'hidden by a moderation decision (FR-S1): out of the worker''s sight and no longer answerable. Written only by private.set_item_moderation.';

-- Participants read the state with the other columns; nobody may write it (no update grant exists).
grant select (moderation_state) on public.messages to authenticated;
grant select (moderation_state) on public.contact_requests to authenticated;

-- A participant's direct read leaves out hidden messages; the sender's side reads its own through list_messages.
drop policy messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (conversation_id in (select private.accessible_conversation_ids()) and moderation_state = 'visible');

drop policy contact_requests_select_worker on public.contact_requests;
create policy contact_requests_select_worker on public.contact_requests
  for select to authenticated
  using (worker_user_id = (select auth.uid()) and moderation_state = 'visible');

alter table public.moderation_actions drop constraint moderation_actions_target_action_check;
alter table public.moderation_actions add constraint moderation_actions_target_action_check
  check ((target_type, action) in (
    ('profile', 'account_suspended'), ('profile', 'account_reinstated'),
    ('organization', 'organization_suspended'), ('organization', 'organization_reinstated'),
    ('job', 'job_hidden'), ('job', 'job_unhidden'),
    ('partner_profile', 'content_hidden'), ('partner_profile', 'content_unhidden'),
    ('requirement', 'content_hidden'), ('requirement', 'content_unhidden'),
    ('partner_response', 'content_hidden'), ('partner_response', 'content_unhidden'),
    ('candidate_submission', 'content_hidden'), ('candidate_submission', 'content_unhidden'),
    ('message', 'content_hidden'), ('message', 'content_unhidden'),
    ('contact_request', 'content_hidden'), ('contact_request', 'content_unhidden')
  ));

create index moderation_actions_message_idx on public.moderation_actions (target_type, target_id)
  where target_type in ('message', 'contact_request');

-- Appeals of a worker's message have no organisation (V28 required one).
alter table public.appeals alter column organization_id drop not null;

comment on column public.appeals.organization_id is
  'The organisation the decision affected: the hidden partner profile, the owner of the hidden vacancy or item, the sending organisation of a message or contact request, or the suspended organisation; null for a worker''s own message (V73).';

-- The items ------------------------------------------------------------------------------------------------------------------

-- private.moderated_item of 20270111100100 with messages (the sending organisation, none for a worker; titled "Message",
-- never its text) and contact requests (the sending organisation; titled "Contact request", never the worker).
create or replace function private.moderated_item(p_type text, p_id uuid) returns table (
  organization_id uuid,
  title text,
  moderation_state public.job_moderation_state
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.organization_id, r.title, r.moderation_state
  from public.workforce_requirements r
  where p_type = 'requirement' and r.id = p_id
  union all
  select p.organization_id,
    case when private.requirement_named_to(r.id, p.organization_id) then r.title else private.job_order_neutral_title(r.id) end,
    p.moderation_state
  from public.partner_responses p join public.workforce_requirements r on r.id = p.requirement_id
  where p_type = 'partner_response' and p.id = p_id
  union all
  select s.organization_id,
    case when private.requirement_named_to(r.id, s.organization_id) then r.title else private.job_order_neutral_title(r.id) end,
    s.moderation_state
  from public.candidate_submissions s join public.workforce_requirements r on r.id = s.requirement_id
  where p_type = 'candidate_submission' and s.id = p_id
  union all
  select m.sender_organization_id, 'Message', m.moderation_state
  from public.messages m
  where p_type = 'message' and m.id = p_id
  union all
  select c.organization_id, 'Contact request', c.moderation_state
  from public.contact_requests c
  where p_type = 'contact_request' and c.id = p_id
$$;

-- private.lock_moderated_item of 20270111100100 with messages and contact requests.
create or replace function private.lock_moderated_item(p_type text, p_id uuid) returns public.job_moderation_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.job_moderation_state;
begin
  if p_type = 'requirement' then
    select r.moderation_state into v_state from public.workforce_requirements r where r.id = p_id for no key update;
  elsif p_type = 'partner_response' then
    select p.moderation_state into v_state from public.partner_responses p where p.id = p_id for no key update;
  elsif p_type = 'candidate_submission' then
    select s.moderation_state into v_state from public.candidate_submissions s where s.id = p_id for no key update;
  elsif p_type = 'message' then
    select m.moderation_state into v_state from public.messages m where m.id = p_id for no key update;
  elsif p_type = 'contact_request' then
    select c.moderation_state into v_state from public.contact_requests c where c.id = p_id for no key update;
  end if;
  return v_state;
end;
$$;

-- private.moderated_item_released of 20270111100100: messages follow release_messaging, contact requests
-- release_find_workers.
create or replace function private.moderated_item_released(p_type text) returns boolean
language sql
stable
set search_path = ''
as $$
  select private.release_on(case p_type
    when 'candidate_submission' then 'release_candidate_submissions'
    when 'message' then 'release_messaging'
    when 'contact_request' then 'release_find_workers'
    else 'release_job_orders'
  end)
$$;

-- private.set_item_moderation of 20270111100100 with messages and contact requests. A message or a request is hidden
-- only while visible and unhidden only while hidden, back to visible (the suspension does not move them). The notice:
-- the owners and admins of the sending organisation, and the member who sent a message while still a plain accepted
-- member of it; a worker's message, the worker. Everything else is unchanged.
--   CHARA_FORBIDDEN (detail release_off), CHARA_NOT_FOUND, CHARA_INVALID_STATE (detail the state)
create or replace function private.set_item_moderation(
  p_type text, p_id uuid, p_hide boolean, p_reason text, p_report bigint default null, p_notify boolean default true
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_title text;
  v_org_status public.organization_status;
  v_state public.job_moderation_state;
  v_to public.job_moderation_state;
  v_action bigint;
  v_sender uuid;
  v_notice jsonb;
begin
  if p_type is null or p_type not in ('requirement', 'partner_response', 'candidate_submission', 'message', 'contact_request') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not private.moderated_item_released(p_type) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  select i.organization_id, i.title into v_org, v_title from private.moderated_item(p_type, p_id) i;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_org is not null then
    select o.status into v_org_status from public.organizations o where o.id = v_org for share;
  end if;
  v_state := private.lock_moderated_item(p_type, p_id);
  if v_state is null then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_state <> (case when p_hide then 'visible' else 'hidden' end)::public.job_moderation_state then
    raise exception 'CHARA_INVALID_STATE' using detail = v_state::text;
  end if;

  v_to := (case
    when p_hide then 'hidden'
    when p_type not in ('message', 'contact_request') and v_org_status = 'suspended' then 'org_suspended'
    else 'visible'
  end)::public.job_moderation_state;
  if p_type = 'requirement' then
    update public.workforce_requirements set moderation_state = v_to where id = p_id;
  elsif p_type = 'partner_response' then
    update public.partner_responses set moderation_state = v_to where id = p_id;
  elsif p_type = 'candidate_submission' then
    update public.candidate_submissions set moderation_state = v_to where id = p_id;
  elsif p_type = 'message' then
    update public.messages set moderation_state = v_to where id = p_id returning sender_user_id into v_sender;
  else
    update public.contact_requests set moderation_state = v_to where id = p_id;
  end if;
  v_action := private.record_moderation(
    p_type, p_id, case when p_hide then 'content_hidden' else 'content_unhidden' end,
    p_type || case when p_hide then '.hide' else '.unhide' end, p_reason, p_report
  );
  if p_notify then
    v_notice := jsonb_build_object(
      'target_type', p_type, 'target_id', p_id, 'decision', case when p_hide then 'hide' else 'unhide' end,
      'moderation_action_id', v_action, 'title', v_title
    );
    if v_org is not null then
      perform private.queue_organization_notice('moderation_decision', v_org, p_reason, v_notice);
      perform pgmq.send('notifications', jsonb_build_object(
        'kind', 'moderation_decision', 'user_id', v_sender, 'mandatory', true, 'organization_id', v_org, 'reasons', p_reason
      ) || v_notice)
      where exists (
        select 1 from public.organization_members m
        where m.organization_id = v_org and m.user_id = v_sender and m.role = 'member' and m.accepted_at is not null);
    elsif exists (select 1 from public.profiles p where p.id = v_sender) then
      perform pgmq.send('notifications', jsonb_build_object(
        'kind', 'moderation_decision', 'user_id', v_sender, 'mandatory', true, 'reasons', p_reason
      ) || v_notice);
    end if;
  end if;
  return v_action;
end;
$$;

-- submit_report --------------------------------------------------------------------------------------------------------------

-- private.reportable_message of 20270206100200: a hidden message is no longer reported (the other side no longer sees it).
create or replace function private.reportable_message(p_message uuid, p_uid uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.release_on('release_messaging') and exists (
    select 1 from public.messages m
    where m.id = p_message and m.sender_user_id is distinct from p_uid and m.moderation_state = 'visible'
      and m.conversation_id in (select private.accessible_conversation_ids())
  )
$$;

-- Whether the caller may report the contact request p_request: the worker it was sent to, whatever its status, while it
-- is visible and release_find_workers is on (FR-Q3 AC11, SOP P2-32 step Report).
create function private.reportable_contact_request(p_request uuid, p_uid uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.release_on('release_find_workers') and exists (
    select 1 from public.contact_requests c
    where c.id = p_request and c.worker_user_id = p_uid and c.moderation_state = 'visible'
  )
$$;

revoke all on function private.reportable_contact_request(uuid, uuid) from public, anon, authenticated, service_role;

-- submit_report of 20270206100200 with the target contact_request (p_contact_request): the worker it was sent to
-- (private.reportable_contact_request), the same CHARA_NOT_FOUND for a request that is not theirs, hidden, unknown, or
-- while the release is off. Everything else is unchanged.
drop function public.submit_report(
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, uuid
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
  p_message uuid default null,
  p_contact_request uuid default null
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
    when 'message' then p_message when 'contact_request' then p_contact_request
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
  if p_target_type in ('profile', 'requirement', 'partner_response', 'candidate_submission', 'message', 'contact_request')
     and v_uid is null then
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
  if p_target_type in ('requirement', 'partner_response', 'candidate_submission', 'message', 'contact_request') and v_item is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = case p_target_type
      when 'requirement' then 'requirement' when 'partner_response' then 'response' when 'message' then 'message'
      when 'contact_request' then 'contact_request' else 'submission' end;
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
  elsif p_target_type = 'contact_request' then
    if not private.reportable_contact_request(v_item, v_uid) then
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
        when 'contact_request' then r.contact_request_id = v_item
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
    candidate_submission_id, message_id, contact_request_id, category, details, reporter_user_id, reporter_email,
    good_faith_confirmed
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
    case when p_target_type = 'contact_request' then v_item end,
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
      'contact_request_id', case when p_target_type = 'contact_request' then v_item end,
      'request_id', private.request_id()
    ))
  );
  reference := private.report_reference(v_id);
  is_duplicate := false;
  return next;
end;
$$;

revoke all on function public.submit_report(
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid,
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.submit_report(
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid,
  uuid, uuid
) to anon, authenticated;

-- Labels, lists and context ----------------------------------------------------------------------------------------------------

-- private.report_target_label of 20270206100200 with the contact request, named by its organisation like a response.
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
    when 'contact_request' then coalesce(p_org_name, 'Contact request')
    else 'Candidate profile'
  end
$$;

-- private.report_item_id of 20270111100100 with the message and the contact request.
create or replace function private.report_item_id(p_report public.reports) returns uuid
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_report.requirement_id, p_report.partner_response_id, p_report.candidate_submission_id, p_report.message_id,
    p_report.contact_request_id)
$$;

-- list_my_reports of 20270111100100: a worker reads a reported contact request by the organisation that sent it.
create or replace function public.list_my_reports(
  p_limit integer default 25, p_after_created timestamptz default null, p_after_id bigint default null
) returns table (
  id bigint,
  reference text,
  target_type public.report_target_type,
  target_label text,
  category public.report_category,
  status public.report_status,
  resolution_note text,
  handled_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if (p_after_created is null) <> (p_after_id is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_after';
  end if;

  return query
  select
    r.id, private.report_reference(r.id), r.target_type,
    private.report_target_label(
      r.target_type,
      case when r.target_type = 'requirement' then private.job_order_neutral_title(r.requirement_id) else j.title end,
      coalesce(o.display_name, io.display_name), r.content_path),
    r.category, r.status, r.resolution_note, r.handled_at, r.created_at
  from public.reports r
  left join public.jobs j on j.id = r.job_id
  left join public.organizations o on o.id = r.organization_id
  left join lateral (
    select x.display_name from public.organizations x
    where x.id = (select i.organization_id from private.moderated_item(r.target_type::text, private.report_item_id(r)) i)
  ) io on r.target_type in ('partner_response', 'candidate_submission', 'contact_request')
  where r.reporter_user_id = v_uid
    and (p_after_created is null or (r.created_at, r.id) < (p_after_created, p_after_id))
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

-- admin_list_reports of 20270111100100 with the contact request labelled by its organisation. The order (fee demands
-- first, FR-J3), the cursor and the rights are unchanged.
create or replace function public.admin_list_reports(
  p_status text default 'open', p_type public.report_target_type default null, p_limit integer default 25,
  p_after_id bigint default null, p_after_priority smallint default null, p_after_due_at timestamptz default null
) returns table (
  id bigint,
  reference text,
  target_type public.report_target_type,
  target_label text,
  category public.report_category,
  status public.report_status,
  priority smallint,
  due_at timestamptz,
  overdue boolean,
  created_at timestamptz,
  handled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
declare
  v_status text := coalesce(p_status, 'open');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  perform private.assert_staff(array['trust_safety', 'admin']::public.platform_role[]);
  if v_status not in ('open', 'new', 'in_review', 'actioned', 'dismissed', 'all') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'status';
  end if;

  if v_status in ('open', 'new', 'in_review') then
    if (p_after_id is null) <> (p_after_priority is null) or (p_after_id is null) <> (p_after_due_at is null) then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'cursor';
    end if;
    return query
    select
      r.id, private.report_reference(r.id), r.target_type,
      private.report_target_label(r.target_type, coalesce(j.title, q.title), coalesce(o.display_name, io.display_name), r.content_path),
      r.category, r.status, r.priority, r.due_at, r.due_at < now(), r.created_at, r.handled_at
    from public.reports r
    left join public.jobs j on j.id = r.job_id
    left join public.organizations o on o.id = r.organization_id
    left join public.workforce_requirements q on q.id = r.requirement_id
    left join lateral (
      select x.display_name from public.organizations x
      where x.id = (select i.organization_id from private.moderated_item(r.target_type::text, private.report_item_id(r)) i)
    ) io on r.target_type in ('partner_response', 'candidate_submission', 'contact_request')
    where case v_status when 'open' then r.status in ('new', 'in_review') else r.status = v_status::public.report_status end
      and (p_type is null or r.target_type = p_type)
      and (p_after_id is null or (r.priority, r.due_at, r.id) > (p_after_priority, p_after_due_at, p_after_id))
    order by r.priority, r.due_at, r.id
    limit v_limit;
  else
    if p_after_priority is not null or p_after_due_at is not null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'cursor';
    end if;
    return query
    select
      r.id, private.report_reference(r.id), r.target_type,
      private.report_target_label(r.target_type, coalesce(j.title, q.title), coalesce(o.display_name, io.display_name), r.content_path),
      r.category, r.status, r.priority, r.due_at, r.status in ('new', 'in_review') and r.due_at < now(), r.created_at,
      r.handled_at
    from public.reports r
    left join public.jobs j on j.id = r.job_id
    left join public.organizations o on o.id = r.organization_id
    left join public.workforce_requirements q on q.id = r.requirement_id
    left join lateral (
      select x.display_name from public.organizations x
      where x.id = (select i.organization_id from private.moderated_item(r.target_type::text, private.report_item_id(r)) i)
    ) io on r.target_type in ('partner_response', 'candidate_submission', 'contact_request')
    where case v_status when 'all' then true else r.status = v_status::public.report_status end
      and (p_type is null or r.target_type = p_type)
      and (p_after_id is null or r.id < p_after_id)
    order by r.id desc
    limit v_limit;
  end if;
end;
$$;

-- private.report_item_context of 20270111100100 with the contact request: its status, dates, vacancy and destination,
-- never its text (read through admin_get_reported_message, audited) or the worker. A message has none (V66).
create or replace function private.report_item_context(p_type text, p_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'requirement' then (
      select jsonb_build_object(
        'title', r.title, 'status', r.status, 'visibility', r.visibility, 'show_identity', r.show_identity,
        'workers_needed', r.workers_needed, 'country_code', r.country_code, 'city_region', r.city_region,
        'skills', r.skills, 'published_at', r.published_at)
      from public.workforce_requirements r where r.id = p_id)
    when 'partner_response' then (
      select jsonb_build_object(
        'requirement_id', r.id, 'requirement_title', r.title, 'status', p.status, 'version', p.version,
        'capacity', p.capacity, 'available_from', p.available_from, 'timeline_note', p.timeline_note,
        'experience_note', p.experience_note, 'fee_model', p.fee_model, 'fee_amount', p.fee_amount,
        'fee_currency', p.fee_currency, 'notes', p.notes, 'created_at', p.created_at)
      from public.partner_responses p join public.workforce_requirements r on r.id = p.requirement_id where p.id = p_id)
    when 'candidate_submission' then (
      select jsonb_build_object(
        'requirement_id', r.id, 'requirement_title', r.title, 'status', s.status, 'note', s.note,
        'created_at', s.created_at, 'worker_approved_at', s.worker_approved_at)
      from public.candidate_submissions s join public.workforce_requirements r on r.id = s.requirement_id where s.id = p_id)
    when 'contact_request' then (
      select jsonb_build_object(
        'status', private.contact_request_status_now(c.status, c.expires_at), 'created_at', c.created_at,
        'responded_at', c.responded_at, 'job_title', j.title, 'destination_country', c.destination_country)
      from public.contact_requests c left join public.jobs j on j.id = c.job_id where c.id = p_id)
  end
$$;

-- admin_get_reported_message of 20270206100200 with the reported contact request: its text, the organisation and the
-- member who sent it, as one row, under the same rule (the handler of the report at aal2 while it is in review; NFR-C5)
-- and audited contact_request.context_opened (the report and the request ids, never the text). A message report is
-- unchanged.
create or replace function public.admin_get_reported_message(p_report bigint)
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
  v_request public.contact_requests;
  v_ids uuid[];
begin
  select * into v_report from public.reports r where r.id = p_report;
  if not private.release_on(case when v_report.target_type = 'contact_request' then 'release_find_workers' else 'release_messaging' end) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if v_report.id is null or v_report.target_type not in ('message', 'contact_request') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_report.handled_by is distinct from v_uid then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if v_report.status <> 'in_review' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_report.status::text;
  end if;

  if v_report.target_type = 'contact_request' then
    select * into v_request from public.contact_requests c where c.id = v_report.contact_request_id;
    if not found then
      raise exception 'CHARA_NOT_FOUND' using detail = 'message_gone', errcode = 'P0002';
    end if;
    perform audit.record('contact_request.context_opened', 'report', v_report.id::text, jsonb_build_object(
      'contact_request_id', v_request.id, 'request_id', private.request_id()));
    return query
    select v_request.id, v_request.created_at, 'organization',
      (select u.display_name from public.profiles u where u.id = v_request.sent_by),
      (select o.display_name from public.organizations o where o.id = v_request.organization_id),
      v_request.message, true;
    return;
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

-- The decision -----------------------------------------------------------------------------------------------------------------

-- moderation_decide of 20270111100100 with messages and contact requests. With a report about one: hide it, suspend the
-- sending organisation (a worker's message has none: CHARA_INVALID_INPUT decision) or dismiss. Without a report: hide or
-- unhide one of staff's own finding (p_target_type message or contact_request). Everything else is unchanged.
--   CHARA_FORBIDDEN (not Trust & Safety; detail aal2_required, release_off, own_organization), CHARA_INVALID_INPUT (detail
--   reason, decision, target), CHARA_NOT_FOUND, CHARA_INVALID_STATE (detail the report status when the report is already
--   closed, or the state of the target: hidden, visible, org_suspended, active, suspended)
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

-- Appeals --------------------------------------------------------------------------------------------------------------------

-- private.appealable_decision of 20270112100000 with messages and contact requests: the sending organisation (none for
-- a worker's message) and the kind as title; in effect only while the message or request still exists. Everything else is
-- unchanged.
create or replace function private.appealable_decision(p_action bigint) returns table (
  moderation_action_id bigint,
  target_type text,
  target_id uuid,
  action text,
  organization_id uuid,
  title text,
  org_slug text,
  reasons text,
  actor_id uuid,
  decided_at timestamptz,
  in_effect boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.target_type, a.target_id, a.action, o.id,
    case
      when a.target_type = 'job' then j.title
      when a.target_type = 'message' then 'Message'
      when a.target_type = 'contact_request' then 'Contact request'
      when i.organization_id is not null then i.title
      else o.display_name
    end,
    o.slug, a.statement_of_reasons, a.actor_id, a.created_at,
    not exists (
      select 1 from public.moderation_actions b
      where b.target_type = a.target_type and b.target_id = a.target_id and b.id > a.id
    ) and (a.target_type <> 'job' or j.deleted_at is null)
      and case when a.target_type in ('message', 'contact_request') then i.present is true else i.present is distinct from false end
  from public.moderation_actions a
  left join public.jobs j on a.target_type = 'job' and j.id = a.target_id
  left join lateral private.moderated_item_owner(a.target_type, a.target_id) i on true
  left join public.organizations o on o.id = case
    when a.target_type = 'job' then j.organization_id
    when a.target_type in ('requirement', 'partner_response', 'candidate_submission', 'message', 'contact_request') then i.organization_id
    else a.target_id
  end
  where a.id = p_action and a.action in ('content_hidden', 'job_hidden', 'organization_suspended')
    and (o.id is not null or a.target_type in ('message', 'contact_request'))
$$;

-- Whether p_uid sent the hidden message p_message and may still speak for it: a worker, or a member of the sending
-- organisation while still an accepted member.
create function private.is_message_sender(p_message uuid, p_uid uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.messages m
    where m.id = p_message and m.sender_user_id = p_uid
      and (m.sender_organization_id is null or exists (
        select 1 from public.organization_members x
        where x.organization_id = m.sender_organization_id and x.user_id = p_uid and x.accepted_at is not null))
  )
$$;

revoke all on function private.is_message_sender(uuid, uuid) from public, anon, authenticated, service_role;

-- submit_appeal of 20261209100000 with the sender of a hidden message: a worker appeals the decision on their own message
-- (no organisation, no aal2: worker accounts have no second step), a member of the sending organisation at aal2 like an
-- owner or admin. Everyone else is as before: an owner or admin of the affected organisation at aal2. Everything else is
-- unchanged.
--   CHARA_FORBIDDEN (a member; detail release_off, aal2_required, profile_suspended), CHARA_INVALID_INPUT (detail
--   grounds), CHARA_NOT_FOUND, CHARA_INVALID_STATE (detail appeal_exists, appeal_window_closed, not_in_effect)
create or replace function public.submit_appeal(p_action bigint, p_grounds text) returns table (appeal_id bigint, due_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_grounds text := btrim(p_grounds, E' \t\r\n');
  v_decision record;
  v_role public.member_role;
  v_sender boolean;
  v_id bigint;
  v_due timestamptz;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if v_grounds is null or char_length(v_grounds) not between 20 and 2000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'grounds';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'suspended') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_suspended';
  end if;

  select * into v_decision from private.appealable_decision(p_action);
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_sender := v_decision.target_type = 'message' and private.is_message_sender(v_decision.target_id, v_uid);
  if v_decision.organization_id is null and not v_sender then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_decision.organization_id is not null then
    select m.role into v_role from public.organization_members m
    where m.organization_id = v_decision.organization_id and m.user_id = v_uid and m.accepted_at is not null;
    if not found then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_role not in ('owner', 'admin') and not v_sender then
      raise exception 'CHARA_FORBIDDEN';
    end if;
    if not private.is_aal2() then
      raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
    end if;
  end if;

  -- One appeal per decision: of two at the same moment, the second waits here and then finds the first.
  perform pg_advisory_xact_lock(hashtextextended('appeal:' || p_action::text, 0));
  if exists (select 1 from public.appeals a where a.moderation_action_id = p_action) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'appeal_exists';
  end if;
  if now() > v_decision.decided_at + make_interval(months => private.appeal_setting('appeal_window_months', 6)) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'appeal_window_closed';
  end if;
  if not v_decision.in_effect then
    raise exception 'CHARA_INVALID_STATE' using detail = 'not_in_effect';
  end if;

  v_due := now() + make_interval(days => private.appeal_setting('appeal_decision_target_days', 7));
  insert into public.appeals (moderation_action_id, organization_id, appellant_user_id, grounds, due_at)
  values (p_action, v_decision.organization_id, v_uid, v_grounds, v_due)
  returning id into v_id;
  perform audit.record('appeal.lodged', 'appeal', v_id::text, jsonb_strip_nulls(jsonb_build_object(
    'moderation_action_id', p_action, 'organization_id', v_decision.organization_id, 'target_type', v_decision.target_type,
    'request_id', private.request_id()
  )));

  appeal_id := v_id;
  due_at := v_due;
  return next;
end;
$$;

-- decide_appeal of 20270112100000 with messages and contact requests: a restore unhides them through
-- private.set_item_moderation without its own notice (target_deleted once they are gone), and the outcome of the appeal
-- of a worker's message goes to the worker. Everything else is unchanged.
create or replace function public.decide_appeal(p_appeal bigint, p_outcome text, p_reasons text) returns table (status public.appeal_status, reversal_action_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reasons text;
  v_appeal public.appeals;
  v_decision record;
  v_status public.appeal_status;
  v_reversal bigint;
  v_deleted boolean;
  v_recipients uuid[];
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  v_reasons := private.statement_of_reasons(p_reasons);
  if p_outcome is null or p_outcome not in ('uphold', 'restore') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'outcome';
  end if;

  select * into v_appeal from public.appeals a where a.id = p_appeal for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_decision from private.appealable_decision(v_appeal.moderation_action_id);
  if v_decision.actor_id = v_uid then
    raise exception 'CHARA_FORBIDDEN' using detail = 'same_reviewer';
  end if;
  if v_appeal.organization_id is not null and private.is_own_organization(v_uid, v_appeal.organization_id) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'own_organization';
  end if;
  if v_appeal.status <> 'open' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_appeal.status::text;
  end if;

  v_status := (case when p_outcome = 'restore' then 'restored' else 'upheld' end)::public.appeal_status;
  if p_outcome = 'restore' and v_decision.in_effect then
    v_reversal := case
      when v_decision.target_type = 'partner_profile' then
        private.set_partner_profile_moderation(v_decision.target_id, false, v_reasons, null, false)
      when v_decision.target_type = 'job' then private.set_job_moderation(v_decision.target_id, false, v_reasons)
      when v_decision.target_type in ('requirement', 'partner_response', 'candidate_submission', 'message', 'contact_request') then
        private.set_item_moderation(v_decision.target_type, v_decision.target_id, false, v_reasons, null, false)
      else private.reinstate_organization_with(v_decision.target_id, v_reasons)
    end;
  end if;

  -- Why a restore undid nothing: the vacancy or the item was deleted, or a later decision had already replaced the
  -- appealed one.
  v_deleted := (v_decision.target_type = 'job'
      and exists (select 1 from public.jobs j where j.id = v_decision.target_id and j.deleted_at is not null))
    or exists (select 1 from private.moderated_item_tombstones t
               where t.target_type = v_decision.target_type and t.target_id = v_decision.target_id)
    or (v_decision.target_type in ('message', 'contact_request')
      and not exists (select 1 from private.moderated_item(v_decision.target_type, v_decision.target_id)));

  update public.appeals
  set status = v_status, decided_by = v_uid, reasons = v_reasons, decided_at = now(), reversal_action_id = v_reversal
  where id = p_appeal;
  perform private.audit_admin('appeal.' || v_status::text, 'appeal', p_appeal::text, v_reasons, jsonb_strip_nulls(jsonb_build_object(
    'moderation_action_id', v_appeal.moderation_action_id, 'organization_id', v_appeal.organization_id,
    'target_type', v_decision.target_type, 'reversal_action_id', v_reversal,
    'target_deleted', case when p_outcome = 'restore' and not v_decision.in_effect and v_deleted then true end,
    'already_reversed', case when p_outcome = 'restore' and not v_decision.in_effect and not v_deleted then true end
  )));

  -- The outcome goes to the appellant while they are still an accepted member of the organisation (or, for a worker's
  -- message, while the account exists); one who left is replaced by the current owners and admins, so the organisation
  -- always learns the outcome.
  select case
    when v_appeal.organization_id is null then
      (select array_agg(p.id) from public.profiles p where p.id = v_appeal.appellant_user_id)
    when exists (select 1 from public.organization_members m
                 where m.organization_id = v_appeal.organization_id and m.user_id = v_appeal.appellant_user_id
                   and m.accepted_at is not null) then array[v_appeal.appellant_user_id]
    else (select array_agg(m.user_id order by m.user_id) from public.organization_members m
          where m.organization_id = v_appeal.organization_id and m.role in ('owner', 'admin') and m.accepted_at is not null)
  end into v_recipients;
  perform pgmq.send('notifications', jsonb_strip_nulls(jsonb_build_object(
    'kind', 'moderation_decision', 'user_id', r.user_id, 'mandatory', true,
    'organization_id', v_appeal.organization_id, 'appeal_id', p_appeal, 'appeal_outcome', v_status,
    'target_type', v_decision.target_type, 'target_id', v_decision.target_id,
    'job_id', case when v_decision.target_type = 'job' then v_decision.target_id end,
    'title', case when v_decision.target_type in ('requirement', 'partner_response', 'candidate_submission') then v_decision.title end,
    'reasons', v_reasons, 'moderation_action_id', v_appeal.moderation_action_id
  )))
  from unnest(coalesce(v_recipients, '{}'::uuid[])) as r (user_id);

  status := v_status;
  reversal_action_id := v_reversal;
  return next;
end;
$$;

-- list_my_appeals of 20270112100000 with the hidden messages and contact requests of the caller's organisations (the
-- member who sent a message may appeal it too) and the hidden messages the caller sent as a worker. Everything else is
-- unchanged.
create or replace function public.list_my_appeals(p_action bigint default null::bigint, p_job uuid default null::uuid) returns table (moderation_action_id bigint, target_type text, target_id uuid, action text, title text, organization_id uuid, organization_name text, org_slug text, reasons text, decided_at timestamp with time zone, appeal_until timestamp with time zone, in_effect boolean, can_appeal boolean, appeal_id bigint, appeal_status public.appeal_status, grounds text, lodged_at timestamp with time zone, due_at timestamp with time zone, appeal_reasons text, appeal_decided_at timestamp with time zone, target_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_window integer := private.appeal_setting('appeal_window_months', 6);
  v_target integer := private.appeal_setting('appeal_decision_target_days', 7);
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;

  return query
  select x.* from (
    select
      d.moderation_action_id, d.target_type, d.target_id, d.action, d.title, d.organization_id, o.display_name, d.org_slug,
      d.reasons, d.decided_at, d.decided_at + make_interval(months => v_window), d.in_effect,
      (m.role in ('owner', 'admin') or (d.target_type = 'message' and private.is_message_sender(d.target_id, v_uid)))
        and d.in_effect and ap.id is null and now() <= d.decided_at + make_interval(months => v_window),
      ap.id, ap.status, ap.grounds, ap.lodged_at, ap.due_at, ap.reasons, ap.decided_at, v_target
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    cross join lateral (
      select a.id from public.moderation_actions a
      where a.action in ('content_hidden', 'organization_suspended') and a.target_type in ('partner_profile', 'organization')
        and a.target_id = m.organization_id
        and (p_action is null or a.id = p_action) and p_job is null
      union all
      select a.id from public.moderation_actions a join public.jobs j on j.id = a.target_id
      where a.action = 'job_hidden' and j.organization_id = m.organization_id and (p_action is null or a.id = p_action)
        and (p_job is null or j.id = p_job)
      union all
      select a.id from public.moderation_actions a
      where a.action = 'content_hidden'
        and a.target_type in ('requirement', 'partner_response', 'candidate_submission', 'message', 'contact_request')
        and (select i.organization_id from private.moderated_item_owner(a.target_type, a.target_id) i) = m.organization_id
        and (p_action is null or a.id = p_action) and p_job is null
    ) c
    cross join lateral private.appealable_decision(c.id) d
    left join public.appeals ap on ap.moderation_action_id = d.moderation_action_id
    where m.user_id = v_uid and m.accepted_at is not null
      and (ap.id is not null or now() <= d.decided_at + make_interval(months => v_window))
    union all
    select
      d.moderation_action_id, d.target_type, d.target_id, d.action, d.title, null::uuid, null::text, null::text,
      d.reasons, d.decided_at, d.decided_at + make_interval(months => v_window), d.in_effect,
      d.in_effect and ap.id is null and now() <= d.decided_at + make_interval(months => v_window),
      ap.id, ap.status, ap.grounds, ap.lodged_at, ap.due_at, ap.reasons, ap.decided_at, v_target
    from public.messages msg
    join public.moderation_actions a on a.target_type = 'message' and a.target_id = msg.id and a.action = 'content_hidden'
    cross join lateral private.appealable_decision(a.id) d
    left join public.appeals ap on ap.moderation_action_id = d.moderation_action_id
    where msg.sender_user_id = v_uid and msg.sender_organization_id is null
      and (p_action is null or a.id = p_action) and p_job is null
      and (ap.id is not null or now() <= d.decided_at + make_interval(months => v_window))
  ) x
  order by x.moderation_action_id desc
  limit 100;
end;
$$;

-- admin_list_appeals of 20261209100000: an appeal of a worker's message has no organisation. Everything else is unchanged.
create or replace function public.admin_list_appeals(
  p_status text default 'open', p_limit integer default 25, p_after_id bigint default null, p_after_due_at timestamptz default null
) returns table (
  id bigint,
  moderation_action_id bigint,
  target_type text,
  title text,
  organization_id uuid,
  organization_name text,
  status public.appeal_status,
  lodged_at timestamptz,
  due_at timestamptz,
  overdue boolean,
  decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety', 'admin']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if p_status is null or p_status not in ('open', 'decided', 'all') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'status';
  end if;

  return query
  select a.id, a.moderation_action_id, d.target_type, d.title, a.organization_id, o.display_name, a.status, a.lodged_at,
    a.due_at, a.status = 'open' and a.due_at < now(), a.decided_at
  from public.appeals a
  left join public.organizations o on o.id = a.organization_id
  cross join lateral private.appealable_decision(a.moderation_action_id) d
  where case p_status
      when 'open' then a.status = 'open'
        and (p_after_id is null or (a.due_at, a.id) > (coalesce(p_after_due_at, '-infinity'::timestamptz), p_after_id))
      when 'decided' then a.status <> 'open' and (p_after_id is null or a.id < p_after_id)
      else p_after_id is null or a.id < p_after_id
    end
  order by
    case when p_status = 'open' then a.due_at end,
    case when p_status = 'open' then a.id end,
    case when p_status <> 'open' then a.id end desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

-- admin_get_appeal of 20261209100000: an appeal of a worker's message has no organisation. Everything else is unchanged.
create or replace function public.admin_get_appeal(p_id bigint) returns table (
  id bigint,
  moderation_action_id bigint,
  target_type text,
  target_id uuid,
  action text,
  title text,
  organization_id uuid,
  organization_name text,
  decision_reasons text,
  decided_on timestamptz,
  decision_report_id bigint,
  in_effect boolean,
  own_decision boolean,
  status public.appeal_status,
  grounds text,
  lodged_at timestamptz,
  due_at timestamptz,
  overdue boolean,
  reasons text,
  decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_staff(array['trust_safety', 'admin']::public.platform_role[]);
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if p_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'appeal';
  end if;

  return query
  select a.id, a.moderation_action_id, d.target_type, d.target_id, d.action, d.title, a.organization_id, o.display_name,
    d.reasons, d.decided_at, (select m.report_id from public.moderation_actions m where m.id = a.moderation_action_id),
    d.in_effect, d.actor_id is not distinct from v_uid, a.status, a.grounds, a.lodged_at, a.due_at,
    a.status = 'open' and a.due_at < now(), a.reasons, a.decided_at
  from public.appeals a
  left join public.organizations o on o.id = a.organization_id
  cross join lateral private.appealable_decision(a.moderation_action_id) d
  where a.id = p_id;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

-- Effects on messages ----------------------------------------------------------------------------------------------------------

-- private.conversation_unread of 20270203100000: a hidden message is no longer unread for the other side.
create or replace function private.conversation_unread(p_conversation uuid, p_side uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.messages m
  where m.conversation_id = p_conversation
    and m.moderation_state = 'visible'
    and m.created_at > coalesce(
      (select r.last_read_at from public.conversation_reads r
       where r.conversation_id = p_conversation and r.user_id = (select auth.uid())),
      '-infinity')
    and case when p_side is null then m.sender_organization_id is not null
             else m.sender_organization_id is distinct from p_side end
$$;

-- list_messages of 20270203100000 with the moderation of a message: a hidden message leaves the other side's page and
-- stays on the sender's side with moderation_state hidden and the decision (moderation_action_id) that the notice and
-- the appeal name. Everything else is unchanged.
drop function public.list_messages(uuid, timestamptz, uuid, integer);

create function public.list_messages(
  p_conversation uuid, p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 50
)
returns table (
  id uuid, kind public.message_kind, body text, created_at timestamptz, mine boolean, sender_kind text, sender_name text,
  sender_organization_name text, sender_erased boolean, moderation_state public.job_moderation_state,
  moderation_action_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.messaging_caller();
  v_row public.conversations;
  v_side uuid;
  v_labels record;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_limit', errcode = '22023';
  end if;
  v_row := private.participant_conversation(p_conversation);
  v_side := (select s.organization_id from private.conversation_side(p_conversation) s);
  select * into v_labels from private.conversation_labels(v_row, v_side);
  return query
  select m.id, m.kind, m.body, m.created_at, m.sender_user_id is not distinct from v_uid,
    case when m.sender_organization_id is null then 'worker' else 'organization' end,
    case
      when m.sender_organization_id is null then
        case when v_side is null then null else v_labels.counterpart_name end
      when m.sender_organization_id = v_side or v_labels.counterpart_named then
        (select u.display_name from public.profiles u where u.id = m.sender_user_id)
    end,
    case when m.sender_organization_id = v_side or (m.sender_organization_id is not null and v_labels.counterpart_named)
      then (select o.display_name from public.organizations o where o.id = m.sender_organization_id) end,
    m.sender_user_id is null,
    m.moderation_state,
    case when m.moderation_state = 'hidden' then (
      select a.id from public.moderation_actions a
      where a.target_type = 'message' and a.target_id = m.id and a.action = 'content_hidden'
      order by a.id desc limit 1) end
  from public.messages m
  where m.conversation_id = v_row.id
    and (m.moderation_state = 'visible' or m.sender_organization_id is not distinct from v_side)
    and (p_before_at is null or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff')))
  order by m.created_at desc, m.id desc
  limit p_limit;
end;
$$;

revoke all on function public.list_messages(uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_messages(uuid, timestamptz, uuid, integer) to authenticated;

-- list_conversation_connections of 20270211100000_connection_actions.sql with the moderation of its typed message: the
-- connection of a hidden message leaves the other side as the message does (its vacancy or requirement would otherwise
-- still be read there) and stays with the sending side. Everything else is unchanged.
create or replace function public.list_conversation_connections(p_conversation uuid)
returns table (
  id uuid, message_id uuid, kind public.connection_kind, status public.connection_status, created_at timestamptz,
  status_changed_at timestamptz, sent_by_me boolean, job_id uuid, job_title text, job_city text, job_country_code text,
  job_open boolean, requirement_id uuid, requirement_title text, occupation_id text, occupation_label text,
  quantity integer, destination_country text, start_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.connection_caller();
  v_row public.conversations := private.participant_conversation(p_conversation);
  v_side uuid := (select s.organization_id from private.conversation_side(p_conversation) s);
begin
  return query
  select c.id, m.id, c.kind, c.status, c.created_at, c.status_changed_at,
    v_side is not null and c.from_organization_id = v_side,
    j.id, j.title, j.city, j.country_code,
    coalesce(j.status = 'open' and j.moderation_state = 'visible' and j.deleted_at is null, false),
    r.id, r.title, o.occupation_id, oc.label, o.quantity, r.country_code, r.start_date
  from public.connections c
  left join public.messages m on m.connection_id = c.id
  left join public.jobs j on j.id = c.job_id
  left join public.workforce_requirements r on r.id = c.requirement_id
  left join lateral (
    select x.occupation_id, x.quantity from public.requirement_occupations x where x.requirement_id = r.id
    order by x.quantity desc, x.occupation_id limit 1
  ) o on true
  left join public.occupations oc on oc.code = o.occupation_id
  where c.conversation_id = v_row.id
    and (m.moderation_state is distinct from 'hidden' or c.from_organization_id is not distinct from v_side)
  order by c.created_at desc, c.id
  limit 100;
end;
$$;

revoke all on function public.list_conversation_connections(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_conversation_connections(uuid) to authenticated;

-- Effects on contact requests ----------------------------------------------------------------------------------------------

-- respond_to_contact_request of 20270210100000: a hidden request is no longer the worker's to answer (the same
-- CHARA_FORBIDDEN as a request that is not theirs). Everything else is unchanged.
create or replace function public.respond_to_contact_request(p_request uuid, p_decision text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.contact_request_caller();
  v_row public.contact_requests;
  v_status public.contact_request_status;
  v_sender_active boolean;
  v_decided text := case p_decision when 'accept' then 'accepted' when 'decline' then 'declined' end;
begin
  select * into v_row from public.contact_requests r
  where r.id = p_request and r.worker_user_id = v_uid and r.moderation_state = 'visible' for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if v_decided is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_decision';
  end if;
  v_status := private.contact_request_status_now(v_row.status, v_row.expires_at);
  if v_status <> 'pending' then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = v_status::text;
  end if;
  perform private.count_audited_write(null);

  update public.contact_requests r
  set status = v_decided::public.contact_request_status,
      responded_at = now()
  where r.id = v_row.id;
  perform audit.record(
    case when p_decision = 'accept' then 'contact_request.accepted' else 'contact_request.declined' end,
    'contact_request', v_row.id::text, jsonb_build_object('organization_id', v_row.organization_id));

  v_sender_active := exists (
    select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
    where m.organization_id = v_row.organization_id and m.user_id = v_row.sent_by and m.accepted_at is not null
      and o.status = 'active');
  if v_sender_active then
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'contact_request_decided', 'user_id', v_row.sent_by, 'organization_id', v_row.organization_id,
      'mandatory', false, 'contact_request_id', v_row.id, 'decision', v_decided,
      'dedupe_key', 'contact_request_decided:' || v_row.id));
  else
    perform private.queue_org_event(v_row.organization_id, 'contact_request_decided',
      jsonb_build_object('contact_request_id', v_row.id, 'decision', v_decided),
      'contact_request_decided:' || v_row.id);
  end if;

  if p_decision = 'accept' and private.release_on('release_messaging')
     and exists (select 1 from public.organizations o where o.id = v_row.organization_id and o.status = 'active') then
    return public.open_conversation('contact_request', v_row.id);
  end if;
  return null;
end;
$$;

-- list_contact_requests_received of 20270210100000: a hidden request leaves the worker's list. Everything else is unchanged.
create or replace function public.list_contact_requests_received(p_limit integer default 50)
returns table (
  id uuid, status public.contact_request_status, message text, organization_name text,
  organization_type public.organization_type, organization_country text, job_id uuid, job_title text, job_country text,
  destination_country text, created_at timestamptz, expires_at timestamptz, responded_at timestamptz,
  withdrawn_at timestamptz, conversation_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.contact_request_caller();
begin
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.account_kind = 'worker') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required', errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_limit', errcode = '22023';
  end if;
  return query
  select x.id, x.status_now, x.message, x.display_name, x.type, x.based_in_country, x.job_id, x.title, x.country_code,
    x.destination_country, x.created_at, x.expires_at, x.responded_at, x.withdrawn_at, x.conversation_id
  from (
    select r.id, private.contact_request_status_now(r.status, r.expires_at) as status_now, r.message, o.display_name, o.type,
      o.based_in_country, r.job_id, j.title, j.country_code, r.destination_country, r.created_at, r.expires_at,
      r.responded_at, r.withdrawn_at,
      case when r.status = 'accepted' then (
        select v.id from public.conversations v where v.context_type = 'contact_request' and v.context_id = r.id) end
        as conversation_id
    from public.contact_requests r
    join public.organizations o on o.id = r.organization_id
    left join public.jobs j on j.id = r.job_id
    where r.worker_user_id = v_uid and r.moderation_state = 'visible'
  ) x
  order by x.status_now <> 'pending', case when x.status_now = 'pending' then x.expires_at end, x.created_at desc, x.id desc
  limit p_limit;
end;
$$;

-- list_contact_requests_sent of 20270210100000 with the moderation of each request: moderation_state and, while hidden,
-- the decision (moderation_action_id) whose reasons and appeal the organisation reads. Everything else is unchanged.
drop function public.list_contact_requests_sent(uuid, text, timestamptz, uuid, integer);

create function public.list_contact_requests_sent(
  p_org uuid, p_status text default null, p_before_at timestamptz default null, p_before_id uuid default null,
  p_limit integer default 20
)
returns table (
  id uuid, card_id uuid, status public.contact_request_status, message text, job_id uuid, job_title text,
  destination_country text, created_at timestamptz, expires_at timestamptz, responded_at timestamptz,
  withdrawn_at timestamptz, sent_by_me boolean, card_listed boolean, headline text, occupation_id text,
  current_country text, worker_first_name text, worker_last_name text, conversation_id uuid,
  moderation_state public.job_moderation_state, moderation_action_id bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.contact_request_caller();
begin
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  perform private.assert_member_aal2(p_org);
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_limit', errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'accepted', 'declined', 'expired', 'withdrawn') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_status', errcode = '22023';
  end if;
  return query
  select r.id, r.card_id, private.contact_request_status_now(r.status, r.expires_at), r.message, r.job_id, j.title,
    r.destination_country, r.created_at, r.expires_at, r.responded_at, r.withdrawn_at, r.sent_by = v_uid,
    coalesce(c.listed, false),
    case when c.listed or r.status = 'accepted' then c.headline end,
    case when c.listed or r.status = 'accepted' then c.occupation_id end,
    case when c.listed or r.status = 'accepted' then c.current_country end,
    case when r.status = 'accepted' then w.first_name end,
    case when r.status = 'accepted' then w.last_name end,
    case when r.status = 'accepted' then (
      select v.id from public.conversations v where v.context_type = 'contact_request' and v.context_id = r.id) end,
    r.moderation_state,
    case when r.moderation_state = 'hidden' then (
      select a.id from public.moderation_actions a
      where a.target_type = 'contact_request' and a.target_id = r.id and a.action = 'content_hidden'
      order by a.id desc limit 1) end
  from public.contact_requests r
  left join public.jobs j on j.id = r.job_id
  left join private.worker_cards c on c.card_id = r.card_id
  left join public.worker_profiles w on w.user_id = r.worker_user_id
  where r.organization_id = p_org
    and (p_status is null or private.contact_request_status_now(r.status, r.expires_at)::text = p_status)
    and (p_before_at is null
      or (r.created_at, r.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff')))
  order by r.created_at desc, r.id desc
  limit p_limit;
end;
$$;

revoke all on function public.list_contact_requests_sent(uuid, text, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_contact_requests_sent(uuid, text, timestamptz, uuid, integer) to authenticated;
