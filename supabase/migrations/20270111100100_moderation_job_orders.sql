-- Moderation of the job order network (FR-S1 steps Receive, Review, Decide, Inform, Appeal and Effect, release 2b parts;
-- FR-J3 AC7 and AC8 (a fee demand reported from a submission, deferred by V54); NFR-C7, NFR-S8; DSA Art. 16, 17 and 20;
-- docs/phase-2/DATA_MODEL.md sections 2 and 4). The moderation of V26 to V28 is extended, not duplicated:
-- - Report targets requirement, partner_response and candidate_submission (20270111100000). Each report holds the id of
--   its item and nothing else (no foreign key: retention deletes these rows, the report outlives them). Only a
--   participant reports: a member of a partner the job order is shown to (a published marketplace job order while the
--   partner is listed, active and visible, or any requirement the partner was invited to), a member of the employer a
--   response was sent to, and the candidate of a submission (the worker's "Report a fee demand"). A visitor is refused
--   with sign_in_required; anyone else, an unknown id and every item while its release is off get the same
--   CHARA_NOT_FOUND, with nothing written.
-- - moderation_state (visible, hidden, org_suspended; the type of the vacancies) on workforce_requirements,
--   partner_responses and candidate_submissions, granted for reading and written only by private.set_item_moderation and
--   the suspension. moderation_decide hides and unhides these items (content_hidden and content_unhidden, as for a
--   partner profile) and suspends the organisation of a report about one: the employer of a requirement, the partner of a
--   response or a submission. The organisation's owners and admins get the mandatory moderation_decision notice with
--   the title as they know it, the statement of reasons and the decision id an appeal names.
-- - What hiding does: a hidden or suspended requirement leaves the job order list, its page says it is no longer open,
--   and nobody responds to it, submits to it or approves a submission for it; a hidden or suspended response or
--   submission leaves the employer's lists, comparison, page and decisions. The affected organisation still reads its
--   own item with the decision (item_moderation) and may appeal it (V28).
-- - suspend_organization and reinstate_organization (risky, the most-called admin RPCs; their full pgTAP suites run with
--   this unit) cascade to the organisation's requirements, responses and submissions as they already do to its
--   vacancies and partner profile: visible -> org_suspended and back, each row audited, an item hidden by its own
--   decision staying hidden.

-- Columns ------------------------------------------------------------------------------------------------------------------

alter table public.reports
  add column requirement_id uuid,
  add column partner_response_id uuid,
  add column candidate_submission_id uuid;

comment on column public.reports.requirement_id is 'The requirement (job order) a report is about. No foreign key: retention deletes requirements, the report is kept.';
comment on column public.reports.partner_response_id is 'The partner response a report is about. No foreign key, as requirement_id.';
comment on column public.reports.candidate_submission_id is 'The candidate submission a report is about. No foreign key, as requirement_id; never the candidate.';

create index reports_requirement_idx on public.reports (requirement_id) where requirement_id is not null;
create index reports_partner_response_idx on public.reports (partner_response_id) where partner_response_id is not null;
create index reports_candidate_submission_idx on public.reports (candidate_submission_id) where candidate_submission_id is not null;

-- reports_target_check of 20261207100100 with the three targets: exactly the id of the item, nothing else.
alter table public.reports drop constraint reports_target_check;
alter table public.reports add constraint reports_target_check check (
  (target_type in ('requirement', 'partner_response', 'candidate_submission')
    or (requirement_id is null and partner_response_id is null and candidate_submission_id is null))
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
        + (candidate_submission_id is not null)::integer = 1
      and case target_type
        when 'requirement' then requirement_id is not null
        when 'partner_response' then partner_response_id is not null
        else candidate_submission_id is not null
      end
  end
);

alter table public.workforce_requirements add column moderation_state public.job_moderation_state not null default 'visible';
alter table public.partner_responses add column moderation_state public.job_moderation_state not null default 'visible';
alter table public.candidate_submissions add column moderation_state public.job_moderation_state not null default 'visible';

comment on column public.workforce_requirements.moderation_state is
  'hidden by a moderation decision, org_suspended while the employer is suspended (FR-S1). Written only by private.set_item_moderation and the suspension.';
comment on column public.partner_responses.moderation_state is
  'hidden by a moderation decision, org_suspended while the partner is suspended (FR-S1). Written only by private.set_item_moderation and the suspension.';
comment on column public.candidate_submissions.moderation_state is
  'hidden by a moderation decision, org_suspended while the partner is suspended (FR-S1). Written only by private.set_item_moderation and the suspension.';

-- Members read the state of their items with the other columns; nobody may write it (no update grant exists).
grant select (moderation_state) on public.workforce_requirements to authenticated;
grant select (moderation_state) on public.partner_responses to authenticated;
grant select (moderation_state) on public.candidate_submissions to authenticated;

-- An organisation suspended before this migration has its items out of sight like one suspended after it, so that its
-- reinstatement brings them back like any other.
update public.workforce_requirements r set moderation_state = 'org_suspended'
from public.organizations o where o.id = r.organization_id and o.status = 'suspended';
update public.partner_responses p set moderation_state = 'org_suspended'
from public.organizations o where o.id = p.organization_id and o.status = 'suspended';
update public.candidate_submissions s set moderation_state = 'org_suspended'
from public.organizations o where o.id = s.organization_id and o.status = 'suspended';

alter table public.moderation_actions drop constraint moderation_actions_target_action_check;
alter table public.moderation_actions add constraint moderation_actions_target_action_check
  check ((target_type, action) in (
    ('profile', 'account_suspended'), ('profile', 'account_reinstated'),
    ('organization', 'organization_suspended'), ('organization', 'organization_reinstated'),
    ('job', 'job_hidden'), ('job', 'job_unhidden'),
    ('partner_profile', 'content_hidden'), ('partner_profile', 'content_unhidden'),
    ('requirement', 'content_hidden'), ('requirement', 'content_unhidden'),
    ('partner_response', 'content_hidden'), ('partner_response', 'content_unhidden'),
    ('candidate_submission', 'content_hidden'), ('candidate_submission', 'content_unhidden')
  ));

create index moderation_actions_item_idx on public.moderation_actions (target_type, target_id)
  where target_type in ('requirement', 'partner_response', 'candidate_submission');

-- The items ------------------------------------------------------------------------------------------------------------------

-- A moderated item of the job order network: the organisation it belongs to (the employer of a requirement, the partner
-- of a response or a submission), its title as that organisation knows it (the employer's own title; for a partner the
-- title only when the employer is named to it, private.requirement_named_to, otherwise the generated title of the job
-- order) and its moderation state. No row for another type or an unknown id. Never the candidate.
create function private.moderated_item(p_type text, p_id uuid) returns table (
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
$$;

revoke all on function private.moderated_item(text, uuid) from public, anon, authenticated, service_role;

-- Lock the row of a moderated item (after its organisation, the order of the suspension) and answer its state; null when
-- it does not exist.
create function private.lock_moderated_item(p_type text, p_id uuid) returns public.job_moderation_state
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
  end if;
  return v_state;
end;
$$;

revoke all on function private.lock_moderated_item(text, uuid) from public, anon, authenticated, service_role;

-- The release a moderated item belongs to: candidate submissions have their own switch (go-live waits for the DPIA).
create function private.moderated_item_released(p_type text) returns boolean
language sql
stable
set search_path = ''
as $$
  select private.release_on(case when p_type = 'candidate_submission' then 'release_candidate_submissions' else 'release_job_orders' end)
$$;

revoke all on function private.moderated_item_released(text) from public, anon, authenticated, service_role;

-- Hide or unhide a requirement, partner response or candidate submission. Hidden only while visible and unhidden only
-- while hidden; an unhidden item of a suspended organisation goes to org_suspended. The organisation is held (for
-- share) before the item, so a hide and a suspension of the same organisation cannot interleave. The owners and admins
-- of the organisation get the mandatory moderation_decision notice with the title as they know it and the reasons,
-- unless p_notify is false (a restore on appeal tells the appellant instead). Answers the decision id.
--   CHARA_FORBIDDEN (detail release_off), CHARA_NOT_FOUND, CHARA_INVALID_STATE (detail the state)
create function private.set_item_moderation(
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
begin
  if p_type is null or p_type not in ('requirement', 'partner_response', 'candidate_submission') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not private.moderated_item_released(p_type) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  select i.organization_id, i.title into v_org, v_title from private.moderated_item(p_type, p_id) i;
  if v_org is null then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select o.status into v_org_status from public.organizations o where o.id = v_org for share;
  v_state := private.lock_moderated_item(p_type, p_id);
  if v_state is null then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_state <> (case when p_hide then 'visible' else 'hidden' end)::public.job_moderation_state then
    raise exception 'CHARA_INVALID_STATE' using detail = v_state::text;
  end if;

  v_to := (case when p_hide then 'hidden' when v_org_status = 'suspended' then 'org_suspended' else 'visible' end)::public.job_moderation_state;
  if p_type = 'requirement' then
    update public.workforce_requirements set moderation_state = v_to where id = p_id;
  elsif p_type = 'partner_response' then
    update public.partner_responses set moderation_state = v_to where id = p_id;
  else
    update public.candidate_submissions set moderation_state = v_to where id = p_id;
  end if;
  v_action := private.record_moderation(
    p_type, p_id, case when p_hide then 'content_hidden' else 'content_unhidden' end,
    p_type || case when p_hide then '.hide' else '.unhide' end, p_reason, p_report
  );
  if p_notify then
    perform private.queue_organization_notice('moderation_decision', v_org, p_reason, jsonb_build_object(
      'target_type', p_type, 'target_id', p_id, 'decision', case when p_hide then 'hide' else 'unhide' end,
      'moderation_action_id', v_action, 'title', v_title
    ));
  end if;
  return v_action;
end;
$$;

revoke all on function private.set_item_moderation(text, uuid, boolean, text, bigint, boolean) from public, anon, authenticated, service_role;

-- submit_report --------------------------------------------------------------------------------------------------------------

-- Whether the caller takes part in the item and may report it. A requirement: a member of an active recruitment or
-- staffing company that sees it, a published marketplace job order of an active employer while the partner is listed and
-- its profile visible, or a requirement the partner was invited to. A response: a member of the active employer it was
-- sent to. A submission: its candidate. The item must be visible (a hidden one is out of the participant's sight) and
-- its release on. Never the item's own organisation reporting itself.
create function private.reportable_item(p_type text, p_id uuid, p_uid uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.moderated_item_released(p_type) and case p_type
    when 'requirement' then exists (
      select 1
      from public.workforce_requirements r
      join public.organizations e on e.id = r.organization_id
      cross join public.organizations p
      where r.id = p_id and r.moderation_state = 'visible' and r.status <> 'draft'
        and p.type in ('recruitment_company', 'staffing_company') and p.status = 'active'
        and p.id in (select private.member_org_ids())
        and (
          (r.visibility = 'job_order_marketplace' and r.status = 'open' and e.status = 'active'
            and private.is_listed_partner(p.id) and p.moderation_state = 'visible')
          or exists (select 1 from public.requirement_invitations i where i.requirement_id = r.id and i.organization_id = p.id)
        )
    )
    when 'partner_response' then exists (
      select 1
      from public.partner_responses x
      join public.organizations e on e.id = x.employer_organization_id
      where x.id = p_id and x.moderation_state = 'visible' and e.status = 'active'
        and x.employer_organization_id in (select private.member_org_ids())
    )
    when 'candidate_submission' then exists (
      select 1 from public.candidate_submissions s
      where s.id = p_id and s.worker_user_id = p_uid and s.moderation_state = 'visible'
    )
    else false
  end
$$;

revoke all on function private.reportable_item(text, uuid, uuid) from public, anon, authenticated, service_role;

-- submit_report of 20261207100100 with the targets requirement (p_requirement), partner_response (p_response) and
-- candidate_submission (p_submission): signed-in participants only (private.reportable_item), the same CHARA_NOT_FOUND for
-- an item that is not theirs, hidden, of a release that is off or unknown. Everything else is unchanged: the checks of
-- the input, the visitor throttle (action report) counted in the transaction, the answer for a repeated report within 24
-- hours, the audit row without the text or the address.
drop function public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text);

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
  p_submission uuid default null
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
  if p_target_type in ('profile', 'requirement', 'partner_response', 'candidate_submission') and v_uid is null then
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
  if p_target_type in ('requirement', 'partner_response', 'candidate_submission') and v_item is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = case p_target_type
      when 'requirement' then 'requirement' when 'partner_response' then 'response' else 'submission' end;
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
    candidate_submission_id, category, details, reporter_user_id, reporter_email, good_faith_confirmed
  ) values (
    p_target_type,
    case when p_target_type in ('job', 'company') then v_job end,
    case when p_target_type in ('company', 'partner_profile') then v_org end,
    v_app,
    case when p_target_type = 'content' then v_path end,
    case when p_target_type = 'requirement' then v_item end,
    case when p_target_type = 'partner_response' then v_item end,
    case when p_target_type = 'candidate_submission' then v_item end,
    p_category, v_details, v_uid, v_email, true
  ) returning id into v_id;

  perform audit.record(
    'report.submitted', 'report', v_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'target_type', p_target_type, 'category', p_category, 'job_id', v_job, 'organization_id', v_org,
      'application_id', v_app, 'requirement_id', case when p_target_type = 'requirement' then v_item end,
      'partner_response_id', case when p_target_type = 'partner_response' then v_item end,
      'candidate_submission_id', case when p_target_type = 'candidate_submission' then v_item end,
      'request_id', private.request_id()
    ))
  );
  reference := private.report_reference(v_id);
  is_duplicate := false;
  return next;
end;
$$;

revoke all on function public.submit_report(
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.submit_report(
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid
) to anon, authenticated;

-- Labels and lists -----------------------------------------------------------------------------------------------------------

-- private.report_target_label of 20261207100100 with the three items: the title of a requirement, the partner of a
-- response or a submission (never the candidate), or the kind when the item is gone.
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
    else 'Candidate profile'
  end
$$;

-- The item of a report: its type and id, null for the targets of Phase 1 and partner profiles.
create function private.report_item_id(p_report public.reports) returns uuid
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_report.requirement_id, p_report.partner_response_id, p_report.candidate_submission_id)
$$;

revoke all on function private.report_item_id(public.reports) from public, anon, authenticated, service_role;

-- list_my_reports of 20261110110000 with the three items. A reporter reads a requirement by its generated title (the
-- partner may never have been told the employer) and a response or submission by its partner.
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
  ) io on r.target_type in ('partner_response', 'candidate_submission')
  where r.reporter_user_id = v_uid
    and (p_after_created is null or (r.created_at, r.id) < (p_after_created, p_after_id))
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

-- admin_list_reports of 20261207100100 with the label of the three items (the requirement's own title, the partner of a
-- response or a submission). The order, the cursor and the rights are unchanged.
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
    ) io on r.target_type in ('partner_response', 'candidate_submission')
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
    ) io on r.target_type in ('partner_response', 'candidate_submission')
    where case v_status when 'all' then true else r.status = v_status::public.report_status end
      and (p_type is null or r.target_type = p_type)
      and (p_after_id is null or r.id < p_after_id)
    order by r.id desc
    limit v_limit;
  end if;
end;
$$;

-- What staff read of the item of a report to decide on it (FR-S1 step Review): a requirement as its employer wrote it, a
-- response with its proposal, a submission with the partner's note and its stage. Never the candidate's name, address,
-- profile or documents (FR-F3), and nothing for the other targets.
create function private.report_item_context(p_type text, p_id uuid) returns jsonb
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
  end
$$;

revoke all on function private.report_item_context(text, uuid) from public, anon, authenticated, service_role;

-- admin_get_report of 20261208100000 with the item of a report (its id, moderation state and context) and, as its
-- organisation, the employer of a requirement or the partner of a response or a submission. Everything else is
-- unchanged.
drop function public.admin_get_report(bigint);

create function public.admin_get_report(p_id bigint) returns table (
  id bigint,
  reference text,
  target_type public.report_target_type,
  category public.report_category,
  details text,
  status public.report_status,
  reporter_kind text,
  reporter_email text,
  content_path text,
  job_id uuid,
  job_title text,
  job_status public.job_status,
  job_moderation_state public.job_moderation_state,
  organization_id uuid,
  organization_name text,
  organization_status public.organization_status,
  organization_slug text,
  resolution_note text,
  handled_at timestamptz,
  created_at timestamptz,
  priority smallint,
  due_at timestamptz,
  overdue boolean,
  organization_type public.organization_type,
  organization_moderation_state public.job_moderation_state,
  decision_due_at timestamptz,
  decision text,
  item_id uuid,
  item_moderation_state public.job_moderation_state,
  item_context jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety', 'admin']::public.platform_role[]);
  if p_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'report';
  end if;

  return query
  select
    r.id, private.report_reference(r.id), r.target_type, r.category, r.details, r.status,
    case when r.reporter_user_id is not null then 'account' else 'visitor' end, r.reporter_email::text, r.content_path,
    j.id, j.title, j.status, j.moderation_state, o.id, o.display_name, o.status, o.slug, r.resolution_note, r.handled_at,
    r.created_at, r.priority, r.due_at, r.status in ('new', 'in_review') and r.due_at < now(),
    o.type, o.moderation_state, r.decision_due_at,
    (select a.action from public.moderation_actions a where a.report_id = r.id order by a.id desc limit 1),
    private.report_item_id(r), i.moderation_state,
    private.report_item_context(r.target_type::text, private.report_item_id(r))
  from public.reports r
  left join public.job_applications a on a.id = r.application_id
  left join public.jobs j on j.id = coalesce(r.job_id, a.job_id)
  left join lateral private.moderated_item(r.target_type::text, private.report_item_id(r)) i on true
  left join public.organizations o on o.id = coalesce(r.organization_id, j.organization_id, i.organization_id)
  where r.id = p_id;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_get_report(bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_report(bigint) to authenticated;

-- The decision -----------------------------------------------------------------------------------------------------------------

-- moderation_decide of 20261208100000 with the three items. With a report about a requirement, a response or a
-- submission: hide the item, suspend its organisation (the employer of a requirement, the partner of a response or a
-- submission) or dismiss. Without a report: hide or unhide an item of staff's own finding (p_target_type requirement,
-- partner_response or candidate_submission). Nobody decides on the organisation of the item. Everything else is
-- unchanged: Trust & Safety at aal2 while release 2a is on, the report locked first and closed in the same transaction, a
-- decision already in effect closing the report without acting again, the outcome to a signed-in reporter.
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
  v_items constant text[] := array['requirement', 'partner_response', 'candidate_submission'];
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
  -- then the item), so the state read here holds until the report is closed.
  if p_report is not null and p_decision in ('hide', 'suspend_organization') and v_org is not null then
    perform 1 from public.organizations o where o.id = v_org for no key update;
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

-- Suspension cascade ---------------------------------------------------------------------------------------------------------

-- Move the requirements, responses and submissions of an organisation between visible and org_suspended, one statement
-- per table (an organisation can have thousands), each moved row audited with the reasons. Answers nothing.
create function private.cascade_item_suspension(p_org uuid, p_suspend boolean, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.job_moderation_state := (case when p_suspend then 'visible' else 'org_suspended' end)::public.job_moderation_state;
  v_to public.job_moderation_state := (case when p_suspend then 'org_suspended' else 'visible' end)::public.job_moderation_state;
  v_suffix text := case when p_suspend then '.org_suspend' else '.org_reinstate' end;
  v_ids text[];
begin
  with moved as (
    update public.workforce_requirements set moderation_state = v_to
    where organization_id = p_org and moderation_state = v_from
    returning id
  )
  select array_agg(moved.id::text) into v_ids from moved;
  perform private.audit_admin_each('requirement' || v_suffix, 'requirement', v_ids, p_reason, jsonb_build_object('organization_id', p_org));

  with moved as (
    update public.partner_responses set moderation_state = v_to
    where organization_id = p_org and moderation_state = v_from
    returning id
  )
  select array_agg(moved.id::text) into v_ids from moved;
  perform private.audit_admin_each('partner_response' || v_suffix, 'partner_response', v_ids, p_reason, jsonb_build_object('organization_id', p_org));

  with moved as (
    update public.candidate_submissions set moderation_state = v_to
    where organization_id = p_org and moderation_state = v_from
    returning id
  )
  select array_agg(moved.id::text) into v_ids from moved;
  perform private.audit_admin_each('candidate_submission' || v_suffix, 'candidate_submission', v_ids, p_reason, jsonb_build_object('organization_id', p_org));
end;
$$;

revoke all on function private.cascade_item_suspension(uuid, boolean, text) from public, anon, authenticated, service_role;

-- private.suspend_organization_with of 20261209100000 with the requirements, responses and submissions of the
-- organisation (private.cascade_item_suspension). Everything else is unchanged.
create or replace function private.suspend_organization_with(p_org uuid, p_reason text, p_report bigint default null) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.organization_status;
  v_jobs text[];
  v_action bigint;
  v_profile integer;
begin
  select o.status into v_status from public.organizations o where o.id = p_org for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;

  update public.organizations set status = 'suspended' where id = p_org;
  v_action := private.record_moderation('organization', p_org, 'organization_suspended', 'organization.suspend', p_reason, p_report);
  -- One statement for all vacancies: an organisation can have thousands.
  with moved as (
    update public.jobs set moderation_state = 'org_suspended'
    where organization_id = p_org and moderation_state = 'visible' and deleted_at is null
    returning id
  )
  select array_agg(moved.id::text) into v_jobs from moved;
  perform private.audit_admin_each('job.org_suspend', 'job', v_jobs, p_reason, jsonb_build_object('organization_id', p_org));
  update public.organizations set moderation_state = 'org_suspended' where id = p_org and moderation_state = 'visible';
  get diagnostics v_profile = row_count;
  if v_profile > 0 then
    perform private.audit_admin('partner_profile.org_suspend', 'partner_profile', p_org::text, p_reason);
  end if;
  perform private.cascade_item_suspension(p_org, true, p_reason);
  perform private.queue_account_op(jsonb_build_object('action', 'sign_out_organization', 'organization_id', p_org));
  perform private.queue_organization_notice('account_suspended', p_org, p_reason, private.appeal_link(v_action));
  return v_action;
end;
$$;

-- private.reinstate_organization_with of 20261208100000 with the requirements, responses and submissions of the
-- organisation: what the suspension moved comes back, an item hidden by its own decision stays hidden. Everything else
-- is unchanged.
create or replace function private.reinstate_organization_with(p_org uuid, p_reason text, p_report bigint default null) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.organization_status;
  v_jobs text[];
  v_action bigint;
  v_profile integer;
begin
  select o.status into v_status from public.organizations o where o.id = p_org for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'suspended' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;

  update public.organizations set status = 'active' where id = p_org;
  v_action := private.record_moderation('organization', p_org, 'organization_reinstated', 'organization.reinstate', p_reason, p_report);
  with moved as (
    update public.jobs set moderation_state = 'visible'
    where organization_id = p_org and moderation_state = 'org_suspended'
    returning id
  )
  select array_agg(moved.id::text) into v_jobs from moved;
  perform private.audit_admin_each('job.org_reinstate', 'job', v_jobs, p_reason, jsonb_build_object('organization_id', p_org));
  update public.organizations set moderation_state = 'visible' where id = p_org and moderation_state = 'org_suspended';
  get diagnostics v_profile = row_count;
  if v_profile > 0 then
    perform private.audit_admin('partner_profile.org_reinstate', 'partner_profile', p_org::text, p_reason);
  end if;
  perform private.cascade_item_suspension(p_org, false, p_reason);
  perform private.queue_organization_notice('account_reinstated', p_org, p_reason);
  return v_action;
end;
$$;

-- admin_list_moderation_actions of 20261208100000: the page of suspensions and reinstatements leaves out the items of
-- the job order network as it leaves out vacancies and partner profiles. Everything else is unchanged.
create or replace function public.admin_list_moderation_actions(p_limit integer default 25, p_after_id bigint default null)
returns table (
  id bigint, target_type text, target_id uuid, target_name text, action text, statement_of_reasons text,
  actor_id uuid, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);

  return query
  select
    a.id, a.target_type, a.target_id,
    case a.target_type
      when 'organization' then (select o.display_name from public.organizations o where o.id = a.target_id)
      else (select coalesce(p.display_name, u.email::text) from public.profiles p join auth.users u on u.id = p.id where p.id = a.target_id)
    end,
    a.action, a.statement_of_reasons, a.actor_id, a.created_at
  from public.moderation_actions a
  where a.target_type in ('organization', 'profile') and (p_after_id is null or a.id < p_after_id)
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

-- Appeals --------------------------------------------------------------------------------------------------------------------

-- private.appealable_decision of 20261209100000 with the hiding of a requirement, response or submission: the
-- organisation of the item and its title as that organisation knows it (private.moderated_item). An item that no longer
-- exists has no row, like a decision that cannot be appealed. Everything else is unchanged.
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
    case when a.target_type = 'job' then j.title when i.organization_id is not null then i.title else o.display_name end,
    o.slug, a.statement_of_reasons, a.actor_id, a.created_at,
    not exists (
      select 1 from public.moderation_actions b
      where b.target_type = a.target_type and b.target_id = a.target_id and b.id > a.id
    ) and (a.target_type <> 'job' or j.deleted_at is null)
  from public.moderation_actions a
  left join public.jobs j on a.target_type = 'job' and j.id = a.target_id
  left join lateral private.moderated_item(a.target_type, a.target_id) i on true
  join public.organizations o on o.id = case
    when a.target_type = 'job' then j.organization_id
    when a.target_type in ('requirement', 'partner_response', 'candidate_submission') then i.organization_id
    else a.target_id
  end
  where a.id = p_action and a.action in ('content_hidden', 'job_hidden', 'organization_suspended')
$$;

-- decide_appeal of 20261209100000: a restore of a hidden requirement, response or submission unhides it through
-- private.set_item_moderation without its own notice, and the appellant's notice carries the title of the item as the
-- organisation knows it. Everything else is unchanged.
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
  if private.is_own_organization(v_uid, v_appeal.organization_id) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'own_organization';
  end if;
  if v_appeal.status <> 'open' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_appeal.status::text;
  end if;

  v_status := (case when p_outcome = 'restore' then 'restored' else 'upheld' end)::public.appeal_status;
  if p_outcome = 'restore' and v_decision.in_effect then
    v_reversal := case v_decision.target_type
      when 'partner_profile' then private.set_partner_profile_moderation(v_decision.target_id, false, v_reasons, null, false)
      when 'job' then private.set_job_moderation(v_decision.target_id, false, v_reasons)
      when 'requirement' then private.set_item_moderation(v_decision.target_type, v_decision.target_id, false, v_reasons, null, false)
      when 'partner_response' then private.set_item_moderation(v_decision.target_type, v_decision.target_id, false, v_reasons, null, false)
      when 'candidate_submission' then private.set_item_moderation(v_decision.target_type, v_decision.target_id, false, v_reasons, null, false)
      else private.reinstate_organization_with(v_decision.target_id, v_reasons)
    end;
  end if;

  -- Why a restore undid nothing: the vacancy was deleted, or a later decision had already replaced the appealed one.
  v_deleted := v_decision.target_type = 'job'
    and exists (select 1 from public.jobs j where j.id = v_decision.target_id and j.deleted_at is not null);

  update public.appeals
  set status = v_status, decided_by = v_uid, reasons = v_reasons, decided_at = now(), reversal_action_id = v_reversal
  where id = p_appeal;
  perform private.audit_admin('appeal.' || v_status::text, 'appeal', p_appeal::text, v_reasons, jsonb_strip_nulls(jsonb_build_object(
    'moderation_action_id', v_appeal.moderation_action_id, 'organization_id', v_appeal.organization_id,
    'target_type', v_decision.target_type, 'reversal_action_id', v_reversal,
    'target_deleted', case when p_outcome = 'restore' and not v_decision.in_effect and v_deleted then true end,
    'already_reversed', case when p_outcome = 'restore' and not v_decision.in_effect and not v_deleted then true end
  )));

  -- The outcome goes to the appellant while they are still an accepted member of the organisation; one who left (or whose
  -- account is gone) is replaced by the current owners and admins, so the organisation always learns the outcome.
  select case
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

-- list_my_appeals of 20261209100000 with the hidden requirements, responses and submissions of the caller's
-- organisations. Everything else is unchanged.
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
  select
    d.moderation_action_id, d.target_type, d.target_id, d.action, d.title, d.organization_id, o.display_name, d.org_slug,
    d.reasons, d.decided_at, d.decided_at + make_interval(months => v_window), d.in_effect,
    m.role in ('owner', 'admin') and d.in_effect and ap.id is null and now() <= d.decided_at + make_interval(months => v_window),
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
    where a.action = 'content_hidden' and a.target_type in ('requirement', 'partner_response', 'candidate_submission')
      and (select i.organization_id from private.moderated_item(a.target_type, a.target_id) i) = m.organization_id
      and (p_action is null or a.id = p_action) and p_job is null
  ) c
  cross join lateral private.appealable_decision(c.id) d
  left join public.appeals ap on ap.moderation_action_id = d.moderation_action_id
  where m.user_id = v_uid and m.accepted_at is not null
    and (ap.id is not null or now() <= d.decided_at + make_interval(months => v_window))
  order by d.moderation_action_id desc
  limit 100;
end;
$$;

-- Effects ----------------------------------------------------------------------------------------------------------------------
-- Each function below is the latest version unchanged except for the moderation state of the item it reads.

-- list_job_orders of 20261222100000: a hidden or suspended requirement is no job order (V39 left this condition to V57).
create or replace function public.list_job_orders(p_org uuid, p_destination text default null::text, p_source text default null::text, p_occupation text default null::text, p_industry text default null::text, p_workers_min integer default null::integer, p_workers_max integer default null::integer, p_start_from date default null::date, p_start_to date default null::date, p_recruitment public.recruitment_preference default null::public.recruitment_preference, p_cursor uuid default null::uuid, p_limit integer default null::integer) returns table (id uuid, eligible boolean, reasons text[], title text, country_code text, workers_needed integer, countries text[], city_region text, industry_code text, occupations jsonb, start_date date, employment_type public.employment_type, recruitment_preference public.recruitment_preference, published_on date, response_count integer, responses_fewer_than integer, employer_name text, employer_company_slug text, next_cursor uuid)
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_destination text := upper(p_destination);
  v_source text := upper(p_source);
  v_industry text := upper(p_industry);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_count_min integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'job_order_response_count_min'), 5);
  v_reduced_filtered boolean := p_source is not null or p_occupation is not null or p_industry is not null
    or p_start_from is not null or p_start_to is not null or p_recruitment is not null;
  v_facts record;
  v_cursor_published timestamptz;
  v_ids uuid[];
  v_more boolean;
begin
  perform private.assert_job_order_partner(p_org);

  if v_destination !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_destination';
  end if;
  if v_source !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_source';
  end if;
  if p_occupation !~ '^[0-9]{4}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_occupation';
  end if;
  if v_industry !~ '^[A-Z]$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_industry';
  end if;
  if p_workers_min not between 1 and 100000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_workers_min';
  end if;
  if p_workers_max not between 1 and 100000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_workers_max';
  end if;
  if p_workers_min > p_workers_max then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_workers_min';
  end if;
  if p_start_from > p_start_to then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_start_from';
  end if;
  if p_recruitment = 'both' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_recruitment';
  end if;
  if p_cursor is not null then
    select r.published_at into v_cursor_published
    from public.workforce_requirements r
    where r.id = p_cursor and r.visibility = 'job_order_marketplace';
    if v_cursor_published is null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end if;
  end if;

  select * into v_facts from private.job_order_partner_facts(p_org);

  select coalesce(array_agg(j.id order by j.published_at desc, j.id), '{}') into v_ids
  from (
    select r.id, r.published_at
    from public.workforce_requirements r
    join public.organizations e on e.id = r.organization_id
    where r.status = 'open' and r.visibility = 'job_order_marketplace' and e.status = 'active' and r.moderation_state = 'visible'
      and (p_cursor is null or r.published_at < v_cursor_published or (r.published_at = v_cursor_published and r.id > p_cursor))
      and (p_workers_min is null or r.workers_needed >= p_workers_min)
      and (p_workers_max is null or r.workers_needed <= p_workers_max)
      and (v_destination is null or exists (
        select 1 from public.requirement_countries rc where rc.requirement_id = r.id and rc.country_code = v_destination
      ))
      and (p_occupation is null or exists (
        select 1 from public.requirement_occupations ro where ro.requirement_id = r.id and ro.occupation_id = p_occupation
      ))
      and (v_industry is null or r.industry_code = v_industry)
      and (p_start_from is null or r.start_date >= p_start_from)
      and (p_start_to is null or r.start_date <= p_start_to)
      and (p_recruitment is null or r.recruitment_preference in ('both', p_recruitment))
      and (v_source is null or r.recruitment_preference <> 'local' or exists (
        select 1 from public.requirement_countries rc where rc.requirement_id = r.id and rc.country_code = v_source
      ))
      and case
        when not v_reduced_filtered and (v_destination is null or r.country_code = v_destination) then true
        else cardinality(private.job_order_reasons(r.id, v_facts.paid, v_facts.served, v_facts.occupations)) = 0
      end
    order by r.published_at desc, r.id
    limit v_limit + 1
  ) j;

  v_more := cardinality(v_ids) > v_limit;
  v_ids := v_ids[1:v_limit];

  return query
  with page as (
    select
      u.n, r.*, e.display_name, e.slug, e.public_page_enabled,
      private.job_order_reasons(r.id, v_facts.paid, v_facts.served, v_facts.occupations) as why,
      exists (
        select 1 from private.requirement_reveals rv where rv.requirement_id = r.id and rv.organization_id = p_org
      ) as revealed
    from unnest(v_ids) with ordinality u (id, n)
    join public.workforce_requirements r on r.id = u.id
    join public.organizations e on e.id = r.organization_id
  ),
  shown as (
    select p.*, cardinality(p.why) = 0 as full_row,
      p.revealed or (cardinality(p.why) = 0 and p.show_identity) as named
    from page p
  )
  select
    s.id,
    s.full_row,
    s.why,
    case when s.named then s.title else private.job_order_neutral_title(s.id) end,
    s.country_code,
    s.workers_needed,
    case when s.full_row then array(
      select rc.country_code from public.requirement_countries rc where rc.requirement_id = s.id
      order by rc.country_code <> s.country_code, rc.country_code) end,
    case when s.full_row and (s.named or not private.city_names_organization(s.city_region, s.organization_id))
      then s.city_region end,
    case when s.full_row then s.industry_code end,
    case when s.full_row then (
      select jsonb_agg(jsonb_build_object('code', ro.occupation_id, 'name', oc.label, 'quantity', ro.quantity)
        order by ro.quantity desc, oc.label)
      from public.requirement_occupations ro join public.occupations oc on oc.code = ro.occupation_id
      where ro.requirement_id = s.id) end,
    case when s.full_row then s.start_date end,
    case when s.full_row then s.employment_type end,
    case when s.full_row then s.recruitment_preference end,
    case when s.full_row then (s.published_at at time zone 'utc')::date end,
    case when s.full_row and private.requirement_response_count(s.id) >= v_count_min
      then private.requirement_response_count(s.id) end,
    case when s.full_row and private.requirement_response_count(s.id) < v_count_min then v_count_min end,
    case when s.named then s.display_name end,
    case when s.named and s.public_page_enabled then s.slug end,
    case when v_more and s.n = v_limit then s.id end
  from shown s
  order by s.n;

  -- The reveals whose name was shown: every page row but the eligible ones the employer names anyway.
  perform private.mark_reveals_seen(p_org, array(
    select r.id from public.workforce_requirements r
    where r.id = any (v_ids)
      and not (r.show_identity
        and cardinality(private.job_order_reasons(r.id, v_facts.paid, v_facts.served, v_facts.occupations)) = 0)));
end;
$$;

-- get_job_order of 20261222100000: a hidden or suspended requirement answers as one that is no longer open.
create or replace function public.get_job_order(p_org uuid, p_requirement uuid) returns table (id uuid, open boolean, eligible boolean, reasons text[], title text, country_code text, workers_needed integer, countries text[], city_region text, industry_code text, occupations jsonb, skills text, experience_years smallint, start_date date, duration_months smallint, employment_type public.employment_type, salary_min numeric, salary_max numeric, salary_currency text, salary_period public.salary_period, accommodation boolean, work_permit_support boolean, visa_support boolean, recruitment_preference public.recruitment_preference, partner_need public.partner_need, published_on date, closes_on date, response_count integer, responses_fewer_than integer, employer_name text, employer_company_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
  v_employer public.organizations;
  v_facts record;
  v_why text[];
  v_full boolean;
  v_named boolean;
  v_revealed boolean;
  v_count integer;
  v_count_min integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'job_order_response_count_min'), 5);
begin
  perform private.assert_job_order_partner(p_org);

  select * into v_row from public.workforce_requirements r
  where r.id = p_requirement and r.visibility = 'job_order_marketplace';
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_employer from public.organizations o where o.id = v_row.organization_id;
  if v_row.status <> 'open' or v_employer.status <> 'active' or v_row.moderation_state <> 'visible' then
    return query select v_row.id, false, null::boolean, null::text[], null::text, null::text, null::integer, null::text[],
      null::text, null::text, null::jsonb, null::text, null::smallint, null::date, null::smallint, null::public.employment_type,
      null::numeric, null::numeric, null::text, null::public.salary_period, null::boolean, null::boolean, null::boolean,
      null::public.recruitment_preference, null::public.partner_need, null::date, null::date, null::integer, null::integer,
      null::text, null::text;
    return;
  end if;

  select * into v_facts from private.job_order_partner_facts(p_org);
  v_why := private.job_order_reasons(v_row.id, v_facts.paid, v_facts.served, v_facts.occupations);
  v_full := cardinality(v_why) = 0;
  v_revealed := exists (
    select 1 from private.requirement_reveals rv where rv.requirement_id = v_row.id and rv.organization_id = p_org);
  v_named := v_revealed or (v_full and v_row.show_identity);
  v_count := private.requirement_response_count(v_row.id);

  return query select
    v_row.id,
    true,
    v_full,
    v_why,
    case when v_named then v_row.title else private.job_order_neutral_title(v_row.id) end,
    v_row.country_code,
    v_row.workers_needed,
    case when v_full then array(
      select rc.country_code from public.requirement_countries rc where rc.requirement_id = v_row.id
      order by rc.country_code <> v_row.country_code, rc.country_code) end,
    case when v_full and (v_named or not private.city_names_organization(v_row.city_region, v_row.organization_id))
      then v_row.city_region end,
    case when v_full then v_row.industry_code end,
    case when v_full then (
      select jsonb_agg(jsonb_build_object('code', ro.occupation_id, 'name', oc.label, 'quantity', ro.quantity)
        order by ro.quantity desc, oc.label)
      from public.requirement_occupations ro join public.occupations oc on oc.code = ro.occupation_id
      where ro.requirement_id = v_row.id) end,
    case when v_full and v_named then v_row.skills end,
    case when v_full then v_row.experience_years end,
    case when v_full then v_row.start_date end,
    case when v_full then v_row.duration_months end,
    case when v_full then v_row.employment_type end,
    case when v_full then v_row.salary_min end,
    case when v_full then v_row.salary_max end,
    case when v_full then v_row.salary_currency end,
    case when v_full then v_row.salary_period end,
    case when v_full then v_row.accommodation end,
    case when v_full then v_row.work_permit_support end,
    case when v_full then v_row.visa_support end,
    case when v_full then v_row.recruitment_preference end,
    case when v_full then v_row.partner_need end,
    case when v_full then (v_row.published_at at time zone 'utc')::date end,
    case when v_full then v_row.closes_on end,
    case when v_full and v_count >= v_count_min then v_count end,
    case when v_full and v_count < v_count_min then v_count_min end,
    case when v_named then v_employer.display_name end,
    case when v_named and v_employer.public_page_enabled then v_employer.slug end;

  if v_revealed and not (v_full and v_row.show_identity) then
    perform private.mark_reveals_seen(p_org, array[v_row.id]);
  end if;
end;
$$;

-- private.response_refusal of 20261230100000: nobody responds to a hidden or suspended requirement
-- (requirement_not_open).
create or replace function private.response_refusal(p_org uuid, p_row public.workforce_requirements) returns table (message text, detail text, invitation_id uuid, used integer, limit_value integer, applies boolean, licence_missing text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invitation uuid;
  v_facts record;
  v_reasons text[];
  v_used integer := private.monthly_usage(p_org, 'job_order_responses_per_month');
  v_limit integer := private.org_limit(p_org, 'job_order_responses_per_month');
  v_applies boolean := coalesce(
    (select (s.value #>> '{}')::boolean from private.settings s where s.key = 'entitlements_enforced'), false)
    or private.free_plan_restricted(p_org);
  v_missing text[];
begin
  select i.id into v_invitation from public.requirement_invitations i
  where i.requirement_id = p_row.id and i.organization_id = p_org and i.status in ('invited', 'viewed', 'accepted', 'responded');

  if v_invitation is null and (p_row.visibility is distinct from 'job_order_marketplace' or p_row.published_at is null) then
    return query select 'CHARA_NOT_FOUND'::text, null::text, null::uuid, v_used, v_limit, v_applies, null::text[];
    return;
  end if;
  if p_row.status <> 'open' or p_row.moderation_state <> 'visible'
     or not exists (select 1 from public.organizations e where e.id = p_row.organization_id and e.status = 'active') then
    return query select 'CHARA_INVALID_STATE'::text, 'requirement_not_open'::text, v_invitation, v_used, v_limit, v_applies,
      null::text[];
    return;
  end if;
  if exists (select 1 from public.partner_responses p where p.requirement_id = p_row.id and p.organization_id = p_org) then
    return query select 'CHARA_CONFLICT'::text, 'already_responded'::text, v_invitation, v_used, v_limit, v_applies,
      null::text[];
    return;
  end if;
  select * into v_facts from private.job_order_partner_facts(p_org);
  if not v_facts.paid then
    if private.partner_lapsed(p_org) and v_limit is not null and v_used >= v_limit then
      return query select 'CHARA_LIMIT_REACHED'::text, 'job_order_responses_per_month'::text, v_invitation, v_used, v_limit,
        v_applies, null::text[];
      return;
    end if;
    return query select 'CHARA_FEATURE_NOT_IN_PLAN'::text, 'job_order_access'::text, v_invitation, v_used, v_limit,
      v_applies, null::text[];
    return;
  end if;
  if v_invitation is null then
    v_reasons := private.job_order_reasons(p_row.id, v_facts.paid, v_facts.served, v_facts.occupations);
    if cardinality(v_reasons) > 0 then
      return query select 'CHARA_FORBIDDEN'::text, v_reasons[1], v_invitation, v_used, v_limit, v_applies, null::text[];
      return;
    end if;
  end if;
  if not private.partner_commitment_current(p_org) then
    return query select 'CHARA_CONSENT_REQUIRED'::text, 'employer-pays-commitment'::text, v_invitation, v_used, v_limit,
      v_applies, null::text[];
    return;
  end if;
  v_missing := private.response_licence_missing(p_row.id, p_org);
  if cardinality(v_missing) > 0 then
    return query select 'CHARA_LICENCE_REQUIRED'::text, v_missing[1], v_invitation, v_used, v_limit, v_applies, v_missing;
    return;
  end if;
  if v_applies and v_limit is not null and v_used >= v_limit then
    return query select 'CHARA_LIMIT_REACHED'::text, 'job_order_responses_per_month'::text, v_invitation, v_used, v_limit,
      v_applies, null::text[];
    return;
  end if;
  return query select null::text, null::text, v_invitation, v_used, v_limit, v_applies, null::text[];
end;
$$;

-- submit_candidate of 20270103100000: nobody submits to a hidden or suspended requirement (requirement_not_open).
create or replace function public.submit_candidate(p_org uuid, p_requirement uuid, p_email text, p_note text default null::text) returns table (id uuid, status public.submission_status, existing boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.workforce_requirements;
  v_response uuid;
  v_existing public.candidate_submissions;
  v_used integer;
  v_limit integer;
  v_applies boolean;
  v_worker uuid;
  v_interval integer := (select (s.value #>> '{}')::integer from private.settings s
                         where s.key = 'submission_signup_email_interval_days');
  v_invite boolean := false;
  v_id uuid := gen_random_uuid();
begin
  perform private.assert_submitting_partner(p_org);
  if v_email = '' or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_email';
  end if;
  if char_length(v_note) > 1000 or v_note ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_note';
  end if;

  select * into v_row from public.workforce_requirements r where r.id = p_requirement for share;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('candidate_submissions:' || p_org::text, 0));
  -- The response is held too, so a decision that closes submissions at the same time is seen here or waits for this call.
  select p.id into v_response from public.partner_responses p
  where p.requirement_id = v_row.id and p.organization_id = p_org
  for share;
  if not private.submissions_allowed_for(v_row.id, p_org) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'submissions_not_open', errcode = '42501';
  end if;
  if v_row.status <> 'open' or v_row.moderation_state <> 'visible'
     or not exists (select 1 from public.organizations e where e.id = v_row.organization_id and e.status = 'active') then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_not_open';
  end if;
  if not (select f.paid from private.job_order_partner_facts(p_org) f) then
    if private.partner_lapsed(p_org)
       and private.monthly_usage(p_org, 'candidate_submissions_per_month')
         >= private.org_limit(p_org, 'candidate_submissions_per_month') then
      raise exception 'CHARA_LIMIT_REACHED' using detail = 'candidate_submissions_per_month';
    end if;
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'job_order_access';
  end if;
  if not private.partner_commitment_current(p_org) then
    raise exception 'CHARA_CONSENT_REQUIRED' using detail = 'employer-pays-commitment';
  end if;

  select * into v_existing from public.candidate_submissions s
  where s.requirement_id = v_row.id and s.organization_id = p_org and s.invited_email = v_email
    and s.status not in ('declined_by_candidate', 'expired', 'withdrawn');
  if found then
    return query select v_existing.id, v_existing.status, true;
    return;
  end if;

  v_used := private.monthly_usage(p_org, 'candidate_submissions_per_month');
  v_limit := private.org_limit(p_org, 'candidate_submissions_per_month');
  v_applies := coalesce((select (s.value #>> '{}')::boolean from private.settings s where s.key = 'entitlements_enforced'), false)
    or private.free_plan_restricted(p_org);
  if v_applies and v_limit is not null and v_used >= v_limit then
    raise exception 'CHARA_LIMIT_REACHED' using detail = 'candidate_submissions_per_month';
  end if;
  perform private.count_audited_write(p_org);

  v_worker := private.submission_worker_for(v_email);
  if v_worker is null and not exists (select 1 from auth.users u where u.email = v_email and u.is_sso_user = false) then
    -- One invitation per address and interval, whichever partner asks: the address is locked for the check.
    perform pg_advisory_xact_lock(hashtextextended('submission_signup:' || v_email, 0));
    v_invite := not exists (
      select 1 from public.candidate_submissions s
      where s.invited_email = v_email
        and s.invitation_emailed_at > now() - make_interval(days => coalesce(v_interval, 7)));
  end if;

  insert into public.candidate_submissions (
    id, requirement_id, organization_id, employer_organization_id, response_id, invited_email, worker_user_id, submitted_by,
    note, invitation_emailed_at
  ) values (
    v_id, v_row.id, p_org, v_row.organization_id, v_response, v_email, v_worker, (select auth.uid()), v_note,
    case when v_invite then now() end
  );
  insert into public.submission_events (submission_id, from_status, to_status, actor_id)
  values (v_id, null, 'awaiting_candidate', (select auth.uid()));
  perform audit.record('submission.requested', 'candidate_submission', v_id::text,
    jsonb_strip_nulls(jsonb_build_object('requirement_id', v_row.id, 'organization_id', p_org,
      'employer_organization_id', v_row.organization_id, 'with_note', case when v_note is not null then true end)));

  if v_worker is not null then
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'submission_request', 'user_id', v_worker, 'mandatory', true,
      'dedupe_key', 'submission_request:' || v_id, 'submission_id', v_id));
  elsif v_invite then
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'submission_request_signup', 'email', v_email, 'mandatory', true,
      'dedupe_key', 'submission_request_signup:' || v_id, 'submission_id', v_id));
  end if;

  return query select v_id, 'awaiting_candidate'::public.submission_status, false;
end;
$$;

-- approve_submission of 20270103100000: a candidate does not approve a submission to a hidden or suspended requirement
-- (requirement_not_open).
create or replace function public.approve_submission(p_submission uuid, p_document_ids uuid[] default null::uuid[]) returns public.submission_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.submission_caller();
  v_sub public.candidate_submissions;
  v_profile public.worker_profiles;
  v_missing text[];
  v_ids uuid[];
  v_max integer := (select l.documents_max from public.apply_limits() l);
  v_version integer;
  v_consent bigint;
  v_share uuid := gen_random_uuid();
begin
  v_sub := private.pending_submission(v_uid, p_submission);
  if exists (select 1 from public.profiles p where p.id = v_uid and (p.status <> 'active' or p.deleted_at is not null)) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_not_active', errcode = '42501';
  end if;
  if not exists (
    select 1 from public.workforce_requirements r join public.organizations e on e.id = r.organization_id
    where r.id = v_sub.requirement_id and r.status = 'open' and e.status = 'active' and r.moderation_state = 'visible'
  ) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_not_open';
  end if;
  if exists (
    select 1 from public.candidate_submissions s
    where s.requirement_id = v_sub.requirement_id and s.worker_user_id = v_uid and s.id <> v_sub.id
      and s.status not in ('awaiting_candidate', 'declined_by_candidate', 'expired', 'withdrawn')
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'already_submitted';
  end if;

  select * into v_profile from public.worker_profiles w where w.user_id = v_uid;
  v_missing := array_remove(array[
    case when v_profile.first_name is null then 'first_name' end,
    case when v_profile.last_name is null then 'last_name' end,
    case when v_profile.current_country is null then 'current_country' end,
    case when v_profile.occupation_id is null then 'occupation_id' end
  ], null);
  if cardinality(v_missing) > 0 then
    raise exception 'CHARA_PROFILE_INCOMPLETE' using detail = array_to_string(v_missing, ', ');
  end if;

  if exists (select 1 from unnest(coalesce(p_document_ids, '{}')) d where d is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_document_ids';
  end if;
  v_ids := array(select distinct d from unnest(coalesce(p_document_ids, '{}')) d order by d);
  if cardinality(v_ids) > v_max then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_document_ids';
  end if;
  if (select count(*) from public.worker_documents d
      where d.id = any (v_ids) and d.worker_user_id = v_uid and d.deleted_at is null) <> cardinality(v_ids) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.worker_documents d where d.id = any (v_ids) and d.scan_status not in ('clean', 'skipped')) then
    raise exception 'CHARA_DOCUMENT_NOT_SCANNED';
  end if;

  v_version := private.current_legal_version('sharing-notice');
  if v_version is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'sharing-notice';
  end if;
  insert into public.consents (user_id, purpose, version, action)
  values (v_uid, 'share_passport:' || v_sub.employer_organization_id || ':submission:' || v_sub.id, v_version, 'granted')
  returning id into v_consent;
  insert into public.passport_shares (id, worker_user_id, organization_id, submission_id, scope, consent_id)
  values (v_share, v_uid, v_sub.employer_organization_id, v_sub.id, to_jsonb(v_ids), v_consent);

  update public.candidate_submissions s
  set status = 'submitted', decided_at = now(), worker_approved_at = now(), passport_share_id = v_share,
      profile_snapshot = private.profile_snapshot(v_uid), updated_at = now()
  where s.id = v_sub.id;
  insert into public.submission_events (submission_id, from_status, to_status, actor_id)
  values (v_sub.id, 'awaiting_candidate', 'submitted', v_uid);
  perform audit.record('submission.approved', 'candidate_submission', v_sub.id::text,
    jsonb_build_object('requirement_id', v_sub.requirement_id, 'organization_id', v_sub.organization_id,
      'employer_organization_id', v_sub.employer_organization_id, 'document_count', cardinality(v_ids)));
  perform private.queue_submission_event(v_sub.id, 'submission_approved');
  return 'submitted'::public.submission_status;
end;
$$;

-- list_requirement_responses and compare_responses of 20261230100000 and 20270102100000: a hidden response, or one of a
-- suspended partner, leaves the employer's list and comparison (FR-S1 AC7).
create or replace function public.list_requirement_responses(p_org uuid, p_requirement uuid) returns table (id uuid, organization_id uuid, partner_name text, partner_slug text, invitation_id uuid, status public.response_status, version integer, updated_unseen boolean, capacity integer, available_from date, fee_model public.fee_model, fee_amount numeric, fee_currency text, created_at timestamp with time zone, updated_at timestamp with time zone, decided_at timestamp with time zone, withdrawn_at timestamp with time zone, withdrawal_reason text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_invitation_employer(p_org);
  perform private.check_rate_limit('job_orders', (select auth.uid()));
  if not exists (select 1 from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
  select p.id, p.organization_id, o.display_name, o.slug, p.invitation_id, p.status, p.version,
    p.status = 'updated' and p.employer_seen_version < p.version,
    p.capacity, p.available_from, p.fee_model, p.fee_amount, p.fee_currency, p.created_at, p.updated_at, p.decided_at,
    p.withdrawn_at, p.withdrawal_reason
  from public.partner_responses p
  join public.organizations o on o.id = p.organization_id
  where p.requirement_id = p_requirement and p.employer_organization_id = p_org and p.moderation_state = 'visible'
  order by p.created_at, p.id;
end;
$$;

create or replace function public.compare_responses(p_org uuid, p_requirement uuid) returns table (id uuid, organization_id uuid, partner_name text, partner_slug text, partner_type public.organization_type, invitation_id uuid, status public.response_status, version integer, updated_unseen boolean, capacity integer, available_from date, timeline_note text, experience_note text, fee_model public.fee_model, fee_amount numeric, fee_currency text, served_countries text[], created_at timestamp with time zone, updated_at timestamp with time zone, decided_at timestamp with time zone, decision_note text, submissions_allowed boolean, withdrawn_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_invitation_employer(p_org);
  perform private.check_rate_limit('job_orders', (select auth.uid()));
  if not exists (select 1 from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
  select p.id, p.organization_id, o.display_name, o.slug, o.type, p.invitation_id, p.status, p.version,
    p.status = 'updated' and p.employer_seen_version < p.version,
    p.capacity, p.available_from, p.timeline_note, p.experience_note, p.fee_model, p.fee_amount, p.fee_currency,
    array(select g.country_code from public.organization_geographies g
          where g.organization_id = p.organization_id and g.scope = 'serves_market' order by g.country_code),
    p.created_at, p.updated_at, p.decided_at, p.decision_note, p.submissions_allowed, p.withdrawn_at
  from public.partner_responses p
  join public.organizations o on o.id = p.organization_id
  where p.requirement_id = p_requirement and p.employer_organization_id = p_org and p.moderation_state = 'visible'
  order by p.created_at, p.id;
end;
$$;

-- get_response of 20270102100000: the employer no longer opens such a response; the partner still reads its own (the
-- page shows the decision through item_moderation).
create or replace function public.get_response(p_org uuid, p_response uuid) returns table (id uuid, requirement_id uuid, invitation_id uuid, status public.response_status, version integer, capacity integer, available_from date, timeline_note text, experience_note text, fee_model public.fee_model, fee_amount numeric, fee_currency text, notes text, created_at timestamp with time zone, updated_at timestamp with time zone, decided_at timestamp with time zone, decision_note text, submissions_allowed boolean, withdrawn_at timestamp with time zone, withdrawal_reason text, updated_unseen boolean, requirement_status public.requirement_status, title text, country_code text, workers_needed integer, max_capacity integer, employer_name text, partner_name text, partner_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resp public.partner_responses;
  v_row public.workforce_requirements;
  v_employer boolean;
  v_named boolean;
  v_unseen boolean;
begin
  if private.org_type(p_org) = 'employer' then
    perform private.assert_invitation_employer(p_org);
    v_employer := true;
  else
    perform private.assert_invitation_partner(p_org);
    v_employer := false;
  end if;
  perform private.check_rate_limit('job_orders', (select auth.uid()));
  select * into v_resp from public.partner_responses p
  where p.id = p_response and (case when v_employer then p.employer_organization_id else p.organization_id end) = p_org
    and (not v_employer or p.moderation_state = 'visible');
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_row from public.workforce_requirements r where r.id = v_resp.requirement_id;
  v_named := v_employer or private.requirement_named_to(v_row.id, v_resp.organization_id);
  v_unseen := v_resp.status = 'updated' and v_resp.employer_seen_version < v_resp.version;
  -- V47: a partner shown the employer's name through a reveal has the first showing audited, as on the job order page.
  if not v_employer and v_named then
    perform private.mark_reveals_shown(p_org, array[v_row.id]);
  end if;
  if v_employer and v_resp.employer_seen_version < v_resp.version then
    update public.partner_responses p set employer_seen_version = p.version where p.id = v_resp.id;
  end if;

  return query select
    v_resp.id, v_resp.requirement_id, v_resp.invitation_id, v_resp.status, v_resp.version, v_resp.capacity,
    v_resp.available_from, v_resp.timeline_note, v_resp.experience_note, v_resp.fee_model, v_resp.fee_amount,
    v_resp.fee_currency, v_resp.notes, v_resp.created_at, v_resp.updated_at, v_resp.decided_at, v_resp.decision_note,
    v_resp.submissions_allowed, v_resp.withdrawn_at, v_resp.withdrawal_reason,
    case when v_employer then v_unseen end,
    v_row.status,
    case when v_named then v_row.title else private.job_order_neutral_title(v_row.id) end,
    v_row.country_code,
    v_row.workers_needed,
    private.response_capacity_max(v_row),
    case when v_named and not v_employer then (select e.display_name from public.organizations e where e.id = v_row.organization_id) end,
    case when v_employer then (select o.display_name from public.organizations o where o.id = v_resp.organization_id) end,
    case when v_employer then (select o.slug from public.organizations o where o.id = v_resp.organization_id) end;
end;
$$;

-- private.decided_response of 20270102100000: the employer no longer decides on such a response.
create or replace function private.decided_response(p_org uuid, p_response uuid) returns public.partner_responses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.requirement_status;
  v_response public.partner_responses;
begin
  perform private.assert_requirement_manager(p_org);
  select r.status into v_status from public.workforce_requirements r
  where r.id = (select p.requirement_id from public.partner_responses p where p.id = p_response)
    and r.organization_id = p_org
  for share;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_response from public.partner_responses p
  where p.id = p_response and p.employer_organization_id = p_org and p.moderation_state = 'visible'
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status not in ('open', 'paused') then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_not_open';
  end if;
  return v_response;
end;
$$;

-- private.employer_submission, list_requirement_submissions and list_employer_submissions of 20270103100000 and
-- 20270104100000: a hidden submission, or one of a suspended partner, leaves the employer's lists, page and pipeline.
create or replace function private.employer_submission(p_fn text, p_submission uuid, p_lock boolean) returns public.candidate_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.candidate_submissions;
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required', errcode = '42501';
  end if;
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.assert_member_aal2(
    (select s.employer_organization_id from public.candidate_submissions s where s.id = p_submission));
  if p_lock then
    select s.* into v_sub from public.candidate_submissions s
    where s.id = p_submission and s.worker_approved_at is not null and s.moderation_state = 'visible'
      and s.employer_organization_id in (select private.member_org_ids())
    for no key update;
  else
    select s.* into v_sub from public.candidate_submissions s
    where s.id = p_submission and s.worker_approved_at is not null and s.moderation_state = 'visible'
      and s.employer_organization_id in (select private.active_member_org_ids());
  end if;
  if not found then
    if exists (
      select 1 from public.candidate_submissions s
      where s.id = p_submission and s.worker_user_id is distinct from (select auth.uid())
        and s.employer_organization_id not in (select private.member_org_ids())
        and s.organization_id not in (select private.member_org_ids())
    ) then
      raise log 'CHARA_CROSS_TENANT caller=% function=% submission=%', (select auth.uid()), p_fn, p_submission;
    end if;
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_lock then
    if exists (select 1 from public.organizations o where o.id = v_sub.employer_organization_id and o.status <> 'active') then
      raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
    end if;
  end if;
  return v_sub;
end;
$$;

create or replace function public.list_requirement_submissions(p_org uuid, p_requirement uuid) returns table (id uuid, partner_organization_id uuid, partner_name text, partner_slug text, status public.submission_status, candidate_name text, profile_snapshot jsonb, note text, created_at timestamp with time zone, worker_approved_at timestamp with time zone, withdrawn_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_invitation_employer(p_org);
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.assert_member_aal2(p_org);
  perform private.check_rate_limit('job_orders', (select auth.uid()));
  if not exists (select 1 from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
  select s.id, s.organization_id, o.display_name, o.slug, s.status,
    nullif(concat_ws(' ', s.profile_snapshot ->> 'first_name', s.profile_snapshot ->> 'last_name'), ''),
    case when s.status <> 'withdrawn' then s.profile_snapshot end,
    s.note, s.created_at, s.worker_approved_at, s.withdrawn_at
  from public.candidate_submissions s
  join public.organizations o on o.id = s.organization_id
  where s.requirement_id = p_requirement and s.employer_organization_id = p_org and s.worker_approved_at is not null
    and s.moderation_state = 'visible'
  order by s.worker_approved_at, s.id;
end;
$$;

create or replace function public.list_employer_submissions(p_org uuid, p_requirement uuid default null::uuid, p_stage public.submission_status default null::public.submission_status, p_limit integer default null::integer, p_offset integer default null::integer) returns table (id uuid, requirement_id uuid, requirement_title text, partner_name text, partner_slug text, status public.submission_status, candidate_name text, worker_approved_at timestamp with time zone, stage_changed_at timestamp with time zone, total_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.assert_invitation_employer(p_org);
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.assert_member_aal2(p_org);
  perform private.check_rate_limit('job_orders', (select auth.uid()));
  if p_requirement is not null
     and not exists (select 1 from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
  select s.id, s.requirement_id, r.title, o.display_name, o.slug, s.status,
    nullif(concat_ws(' ', s.profile_snapshot ->> 'first_name', s.profile_snapshot ->> 'last_name'), ''),
    s.worker_approved_at,
    (select max(e.created_at) from public.submission_events e where e.submission_id = s.id),
    count(*) over ()
  from public.candidate_submissions s
  join public.organizations o on o.id = s.organization_id
  join public.workforce_requirements r on r.id = s.requirement_id
  where s.employer_organization_id = p_org and s.worker_approved_at is not null and s.moderation_state = 'visible'
    and s.employer_organization_id in (select private.active_member_org_ids())
    and (p_requirement is null or s.requirement_id = p_requirement)
    and (p_stage is null or s.status = p_stage)
  order by s.worker_approved_at, s.id
  limit v_limit offset v_offset;
end;
$$;

-- The notice ---------------------------------------------------------------------------------------------------------------------

-- private.notification_payload of 20270109200000: moderation_decision names a requirement, response or submission by the
-- title its message carries (the title as the organisation knows it, never the candidate). Every other branch is
-- unchanged.
create or replace function private.notification_payload(p_kind text, p_message jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_title text;
  v_slug text;
  v_org_name text;
  v_invitation_id uuid;
  v_role public.member_role;
  v_expires timestamptz;
  v_org_type public.organization_type;
  v_decision public.partner_review_decisions;
  v_licence_id uuid;
  v_country_code text;
  v_country_name text;
  v_valid_until date;
begin
  if p_message ->> 'job_id' is not null then
    select j.id, j.title, o.slug, o.display_name into v_job_id, v_title, v_slug, v_org_name
    from public.jobs j join public.organizations o on o.id = j.organization_id
    where j.id = (p_message ->> 'job_id')::uuid;
  end if;
  if p_message ->> 'organization_id' is not null then
    select o.slug, o.display_name into v_slug, v_org_name
    from public.organizations o where o.id = (p_message ->> 'organization_id')::uuid;
  end if;
  if p_message ->> 'invitation_id' is not null then
    select i.id, i.role, i.expires_at, o.display_name, o.type into v_invitation_id, v_role, v_expires, v_org_name, v_org_type
    from public.organization_invitations i join public.organizations o on o.id = i.organization_id
    where i.id = (p_message ->> 'invitation_id')::uuid;
  end if;
  if p_message ->> 'decision_id' is not null then
    select * into v_decision from public.partner_review_decisions d where d.id = (p_message ->> 'decision_id')::bigint;
  end if;
  if p_message ->> 'licence_id' is not null then
    select l.id, l.country_code, c.name, l.valid_until into v_licence_id, v_country_code, v_country_name, v_valid_until
    from public.partner_licences l join public.countries c on c.code = l.country_code
    where l.id = (p_message ->> 'licence_id')::uuid;
  end if;

  return jsonb_strip_nulls(case p_kind
    when 'application_received' then case
      when p_message ? 'vacancies' then jsonb_build_object(
        'total', p_message -> 'total',
        'vacancies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'job_id', j.id, 'job_title', j.title, 'org_name', o.display_name, 'org_slug', o.slug, 'count', v.item -> 'count'
          ) order by v.position)
          from jsonb_array_elements(p_message -> 'vacancies') with ordinality as v(item, position)
          join public.jobs j on j.id = (v.item ->> 'job_id')::uuid
          join public.organizations o on o.id = j.organization_id
        ), '[]'::jsonb))
      else jsonb_build_object(
        'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name, 'org_slug', v_slug)
    end
    -- V50: a submission's stage names the requirement as the candidate may read it, the partner that proposed the
    -- candidate and the employer only when it shows its name; never the note (FR-O5 AC9).
    when 'status_changed' then case
      when p_message ? 'submission_id' then coalesce((
        select jsonb_build_object('submission_id', s.id, 'job_title', private.submission_candidate_title(r),
          'org_name', case when r.show_identity then e.display_name end, 'partner_name', o.display_name,
          'status', p_message -> 'status')
        from public.candidate_submissions s
        join public.organizations o on o.id = s.organization_id
        join public.workforce_requirements r on r.id = s.requirement_id
        join public.organizations e on e.id = r.organization_id
        where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
      else jsonb_build_object(
        'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name,
        'status', p_message -> 'status')
    end
    when 'vacancy_hidden' then jsonb_build_object(
      'job_id', v_job_id, 'job_title', v_title, 'org_slug', v_slug, 'reasons', p_message -> 'reasons',
      'moderation_action_id', p_message -> 'moderation_action_id')
    when 'trial_ending' then jsonb_build_object(
      'org_slug', v_slug, 'trial_ends_at', p_message -> 'trial_ends_at', 'plan_code', p_message -> 'plan_code',
      'plan_name', p_message -> 'plan_name',
      'amount_minor', p_message -> 'amount_minor', 'currency', p_message -> 'currency')
    when 'payment_failed' then jsonb_build_object('org_slug', v_slug)
    when 'legal_version' then jsonb_build_object(
      'document_slug', p_message -> 'document_slug', 'version', p_message -> 'version',
      'change_summary', p_message -> 'change_summary')
    when 'account_suspended' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug,
      'moderation_action_id', p_message -> 'moderation_action_id')
    when 'account_reinstated' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug)
    when 'member_invitation' then jsonb_build_object(
      'invitation_id', v_invitation_id, 'org_name', v_org_name, 'role', v_role, 'expires_at', v_expires, 'org_type', v_org_type)
    when 'deletion_requested' then jsonb_build_object('erases_on', p_message -> 'erases_on')
    when 'erasure_paused' then jsonb_build_object('account_id', p_message -> 'user_id')
    -- The reason of an approval stays in the staff record, as in partner_review_outcome.
    when 'partner_approved' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at)
    when 'partner_info_requested' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at,
      'info_step', v_decision.info_step, 'reason', v_decision.reason)
    when 'partner_declined' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at,
      'reason', v_decision.reason)
    when 'licence_expiring' then jsonb_build_object(
      'licence_id', v_licence_id, 'country_code', v_country_code, 'country_name', v_country_name,
      'valid_until', v_valid_until, 'org_name', v_org_name, 'org_slug', v_slug)
    when 'partner_licence_expired' then jsonb_build_object(
      'licence_id', v_licence_id, 'country_code', v_country_code, 'country_name', v_country_name,
      'valid_until', v_valid_until, 'org_name', v_org_name, 'org_slug', v_slug)
    -- The ten listings confirmed longest ago are named; total says how many are due.
    when 'listing_confirmation_due' then jsonb_build_object(
      'org_name', v_org_name, 'org_slug', v_slug,
      'total', jsonb_array_length(coalesce(p_message -> 'listing_ids', '[]'::jsonb)),
      'stale_days', (select (s.value #>> '{}')::integer from private.settings s where s.key = 'workforce_listing_stale_days'),
      'listings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'listing_id', x.id, 'occupation', x.label, 'country_name', x.name, 'confirmed_at', x.confirmed_at
        ) order by x.confirmed_at, x.id)
        from (
          select w.id, oc.label, c.name, w.confirmed_at
          from jsonb_array_elements_text(coalesce(p_message -> 'listing_ids', '[]'::jsonb)) e(id)
          join public.workforce_availability w on w.id = e.id::uuid
          join public.occupations oc on oc.code = w.occupation_id
          join public.countries c on c.code = w.source_country
          order by w.confirmed_at, w.id
          limit 10
        ) x
      ), '[]'::jsonb))
    -- V54: the named job orders of the digest follow the vacancies, by their current title, the ten oldest with how many
    -- there are; a partner follower's items carry the requirement id and the slug of the follower's own company for the
    -- link, a candidate's the title only (decision 3.1). Absent when the digest holds no job order.
    when 'followed_company_activity' then jsonb_build_object(
      'organization_id', p_message -> 'organization_id', 'org_name', v_org_name, 'org_slug', v_slug,
      'total', jsonb_array_length(coalesce(p_message -> 'job_ids', '[]'::jsonb)),
      'vacancies', coalesce((
        select jsonb_agg(jsonb_build_object('job_id', x.id, 'job_title', x.title) order by x.position)
        from (
          select j.id, j.title, e.position
          from jsonb_array_elements_text(coalesce(p_message -> 'job_ids', '[]'::jsonb)) with ordinality e(id, position)
          join public.jobs j on j.id = e.id::uuid
          order by e.position
          limit 10
        ) x
      ), '[]'::jsonb),
      'job_order_total', case when p_message ? 'requirement_ids' then jsonb_array_length(p_message -> 'requirement_ids') end,
      'partner_slug', (select o.slug from public.organizations o where o.id = (p_message ->> 'partner_id')::uuid),
      'job_orders', case when p_message ? 'requirement_ids' then coalesce((
        select jsonb_agg(jsonb_build_object(
          'requirement_id', case when p_message ? 'partner_id' then x.id end, 'title', x.title) order by x.position)
        from (
          select r.id, r.title, e.position
          from jsonb_array_elements_text(p_message -> 'requirement_ids') with ordinality e(id, position)
          join public.workforce_requirements r on r.id = e.id::uuid
          order by e.position
          limit 10
        ) x
      ), '[]'::jsonb) end)
    when 'moderation_decision' then case
      when p_message ? 'report_id' then jsonb_build_object(
        'reference', private.report_reference((p_message ->> 'report_id')::bigint), 'outcome', p_message -> 'outcome')
      when p_message ? 'appeal_id' then jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case
          when p_message ->> 'target_type' = 'job' then v_title
          when p_message ->> 'target_type' in ('requirement', 'partner_response', 'candidate_submission') then p_message ->> 'title'
          else v_org_name
        end,
        'org_slug', v_slug, 'appeal_id', p_message -> 'appeal_id', 'appeal_outcome', p_message -> 'appeal_outcome',
        'reasons', p_message -> 'reasons', 'moderation_action_id', p_message -> 'moderation_action_id')
      else jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case
          when p_message ->> 'target_type' = 'partner_profile' then v_org_name
          when p_message ->> 'target_type' in ('requirement', 'partner_response', 'candidate_submission') then p_message ->> 'title'
        end,
        'org_slug', v_slug, 'decision', p_message -> 'decision', 'reasons', p_message -> 'reasons',
        'moderation_action_id', p_message -> 'moderation_action_id')
    end
    when 'data_export_ready' then jsonb_build_object('export_id', p_message -> 'export_id', 'expires_at', p_message -> 'expires_at')
    -- The recipient's own organisation names the link; never the employer to a partner. A partner's reminder (V43) names
    -- its invitation for the link to its invitation page.
    when 'requirement_closing_soon' then case
      when p_message ? 'requirement_invitation_id' then coalesce((
        select jsonb_build_object('requirement_id', r.id, 'invitation_id', i.id, 'title', r.title, 'closes_on', r.closes_on,
          'org_slug', v_slug)
        from public.requirement_invitations i join public.workforce_requirements r on r.id = i.requirement_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
      -- V44: a marketplace responder, which the requirement's own title names only when the employer is named to it.
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('requirement_id', r.id, 'response_id', p.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'closes_on', r.closes_on, 'org_slug', v_slug)
        from public.partner_responses p join public.workforce_requirements r on r.id = p.requirement_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('requirement_id', r.id, 'title', r.title, 'closes_on', r.closes_on, 'org_slug', v_slug)
        from public.workforce_requirements r where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    end
    -- NFR-S11: the generated title and the destination only, whatever the employer chose to show; the slug is the
    -- recipient partner's own, for the link to its job order page.
    when 'job_order_match' then coalesce((
      select jsonb_build_object('requirement_id', r.id, 'title', private.job_order_neutral_title(r.id),
        'country_code', r.country_code, 'country_name', c.name, 'org_slug', v_slug)
      from public.workforce_requirements r join public.countries c on c.code = r.country_code
      where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    -- An invitation reveals the employer to the invited partner (decision 3.2; NFR-S11 protects the partners that are
    -- not invited or selected), so the item and the email name the requirement's own title and the employer (FR-O1
    -- AC7, AC11), and nothing else of the employer: no member, no address. The slug is the recipient partner's own.
    when 'invitation_received' then coalesce((
      select jsonb_build_object('invitation_id', i.id, 'title', r.title,
        'country_code', r.country_code, 'country_name', c.name, 'workers_needed', r.workers_needed,
        'start_date', r.start_date, 'employer_name', e.display_name, 'org_slug', v_slug)
      from public.requirement_invitations i
      join public.workforce_requirements r on r.id = i.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    when 'invitation_withdrawn' then coalesce((
      select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name, 'org_slug', v_slug)
      from public.requirement_invitations i
      join public.workforce_requirements r on r.id = i.requirement_id
      join public.organizations e on e.id = r.organization_id
      where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    -- V43: the invitation reveals the requirement's own title and the employer to the invited partner (as
    -- invitation_received); the change notice names the fields changed in the versions from_version to to_version, in
    -- the order of the form, never their values, who changed them or anything the invitation did not show.
    when 'requirement_changed' then case
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
          'changed_fields', (
            select coalesce(jsonb_agg(f.name order by f.position), '[]')
            from unnest(private.requirement_change_fields()) with ordinality f(name, position)
            where exists (
              select 1 from public.requirement_versions v
              where v.requirement_id = r.id and f.name = any (v.changed_fields)
                and v.version between (p_message ->> 'from_version')::integer and (p_message ->> 'to_version')::integer)),
          'from_version', (p_message ->> 'from_version')::integer, 'to_version', (p_message ->> 'to_version')::integer,
          'org_slug', v_slug)
        from public.partner_responses p
        join public.workforce_requirements r on r.id = p.requirement_id
        join public.organizations e on e.id = r.organization_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name,
          'changed_fields', (
            select coalesce(jsonb_agg(f.name order by f.position), '[]')
            from unnest(private.requirement_change_fields()) with ordinality f(name, position)
            where exists (
              select 1 from public.requirement_versions v
              where v.requirement_id = r.id and f.name = any (v.changed_fields)
                and v.version between (p_message ->> 'from_version')::integer and (p_message ->> 'to_version')::integer)),
          'from_version', (p_message ->> 'from_version')::integer, 'to_version', (p_message ->> 'to_version')::integer,
          'org_slug', v_slug)
        from public.requirement_invitations i
        join public.workforce_requirements r on r.id = i.requirement_id
        join public.organizations e on e.id = r.organization_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    end
    when 'requirement_closed' then case
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
          'close_reason', r.close_reason, 'org_slug', v_slug)
        from public.partner_responses p
        join public.workforce_requirements r on r.id = p.requirement_id
        join public.organizations e on e.id = r.organization_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name,
          'close_reason', r.close_reason, 'org_slug', v_slug)
        from public.requirement_invitations i
        join public.workforce_requirements r on r.id = i.requirement_id
        join public.organizations e on e.id = r.organization_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    end
    -- V44: to the employer's owners and admins, the requirement's own title and the partner's display name; never the
    -- statement, the fee or the withdrawal reason of the response (FR-T1 AC2). The slug is the employer's own.
    when 'response_received' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id, 'title', r.title,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations o on o.id = p.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
    when 'response_withdrawn' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id, 'title', r.title,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations o on o.id = p.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
    -- V47: to the partner's owners and admins, its own decision only; the requirement's own title and the employer's name
    -- once the employer is named to the partner, the generated title otherwise (NFR-S11). Never the note or anything of
    -- another partner (FR-O3 AC7). The slug is the partner's own.
    when 'response_decided' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
        'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
        'decision', p_message ->> 'decision', 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations e on e.id = r.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid
        and p_message ->> 'decision' in ('shortlisted', 'selected', 'declined', 'submissions_allowed')), '{}'::jsonb)
    -- V48: to the candidate, the partner and the requirement as the candidate may read it (the employer's own title and
    -- name only when the employer shows its name, NFR-S11), destination and start date, for the request page; to an
    -- address without an account the same without the id (the page needs an account). Never the address or another
    -- partner (FR-O4 AC1, AC2, AC10).
    when 'submission_request' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'partner_name', o.display_name,
        'title', private.submission_candidate_title(r), 'country_code', r.country_code, 'country_name', c.name,
        'start_date', r.start_date, 'employer_name', case when r.show_identity then e.display_name end)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    when 'submission_request_signup' then coalesce((
      select jsonb_build_object('partner_name', o.display_name, 'title', private.submission_candidate_title(r),
        'country_code', r.country_code, 'country_name', c.name, 'start_date', r.start_date,
        'employer_name', case when r.show_identity then e.display_name end)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    -- V48: to the owners and admins of the partner and of the employer, the requirement as the recipient knows it (the
    -- generated title to a partner the employer is not named to) and the partner's name; never the candidate, the address
    -- or the documents (FR-O4 AC5, AC9). The slug is the recipient's own.
    when 'submission_approved' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when (p_message ->> 'organization_id')::uuid = s.employer_organization_id
                        or private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'partner_name', o.display_name, 'org_slug', v_slug,
        'to_partner', (p_message ->> 'organization_id')::uuid = s.organization_id)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    when 'submission_withdrawn' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when (p_message ->> 'organization_id')::uuid = s.employer_organization_id
                        or private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'partner_name', o.display_name, 'org_slug', v_slug,
        'to_partner', (p_message ->> 'organization_id')::uuid = s.organization_id)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    -- V50: to the partner's owners and admins, the stage its candidate reached and the requirement as the partner knows it
    -- (the generated title until the employer is named to it); never the candidate's name, the note or the reason (FR-O5
    -- AC5, AC10). The slug is the partner's own.
    when 'submission_stage_changed' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'status', p_message ->> 'status', 'org_slug', v_slug)
      from public.candidate_submissions s
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid
        and p_message ->> 'status' in ('shortlisted', 'interview', 'offer', 'hired', 'rejected')), '{}'::jsonb)
    else '{}'::jsonb
  end);
end;
$$;

-- The affected organisation reads the decision ---------------------------------------------------------------------------------

-- The moderation state of one of the organisation's own requirements, responses or submissions and, while it is hidden
-- by a decision, that decision: its id (which an appeal names), the statement of reasons and the time (FR-S1 AC12: every
-- member reads the badge and the reasons; the appeal is the owner's and the admins', list_my_appeals). While its release
-- is off, for an item of another organisation and for an unknown id the answer is the same CHARA_NOT_FOUND.
--   CHARA_FORBIDDEN (no session: 42501), CHARA_INVALID_INPUT (detail target), CHARA_NOT_FOUND
create function public.item_moderation(p_org uuid, p_target_type text, p_target_id uuid) returns table (
  moderation_state public.job_moderation_state,
  moderation_action_id bigint,
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
  v_state public.job_moderation_state;
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if p_target_type is null or p_target_type not in ('requirement', 'partner_response', 'candidate_submission') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'target';
  end if;
  if private.moderated_item_released(p_target_type) and p_org in (select private.member_org_ids()) then
    select i.moderation_state into v_state from private.moderated_item(p_target_type, p_target_id) i where i.organization_id = p_org;
  end if;
  if v_state is null then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select v_state, d.id, d.statement_of_reasons, d.created_at
  from (select 1) s
  left join lateral (
    select a.id, a.statement_of_reasons, a.created_at
    from public.moderation_actions a
    where a.target_type = p_target_type and a.target_id = p_target_id and a.action = 'content_hidden'
    order by a.id desc
    limit 1
  ) d on v_state = 'hidden';
end;
$$;

revoke all on function public.item_moderation(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.item_moderation(uuid, text, uuid) to authenticated;
