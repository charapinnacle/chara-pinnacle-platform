-- Response comparison and decisions (FR-O3, SOP P2-23; decisions 3.2, 3.4; NFR-S8, NFR-S11, NFR-A3; docs/phase-2/DATA_MODEL.md
-- sections 5, 6, 7 and 9; release 2b).
--
-- The employer compares the responses to one requirement on the same rows (compare_responses: capacity, earliest start,
-- fee model and amount, experience, served countries, response date and status) and decides each one (decide_response):
-- submitted or updated -> shortlisted, selected or declined; shortlisted -> selected or declined; selected and declined
-- are final, as withdrawn is. Only an owner or admin at aal2 of the requirement's employer decides, while the requirement
-- is open or paused, with an optional note (1 to 1,000 characters) that the partner of that response reads and no one
-- else. Shortlisting and selecting reveal the employer's name to that partner (private.record_requirement_reveal, the
-- first cause kept; the audit row requirement.employer_revealed is written once, the first time a read shows the partner
-- the name: the job order pages (V39), the invitation page (V41), and now list_my_responses and get_response, recreated
-- here to mark the reveal seen). A selected response opens candidate submissions for its partner (submissions_allowed, V48 reads
-- private.submissions_allowed_for); the employer may open them for a shortlisted partner too (set_submissions_allowed).
-- Every decision and permission is audited and tells the partner's owners and admins (response_decided, optional, email
-- on), naming only the partner's own result. No competing partner learns of another's decision or of a selection. The
-- agreement and any payment between employer and partner stay outside the platform (decision 3.4). Every function a user
-- calls refuses to run while release_job_orders is false.

-- Notification kind ----------------------------------------------------------------------------------------------------------

-- Optional, email on by default, for recruitment and staffing companies.
insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types) values
  ('response_decided', false, true, 'company', 'Decisions on your responses to workforce requirements',
    array['recruitment_company', 'staffing_company']::public.organization_type[]);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon', 'job_order_match', 'invitation_received',
  'invitation_withdrawn', 'requirement_changed', 'requirement_closed', 'response_received', 'response_withdrawn',
  'response_decided'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- Helpers ----------------------------------------------------------------------------------------------------------------------

-- Whether an employer may move a response from p_from to p_to (FR-O3 AC3, DATA_MODEL.md section 5): submitted or updated
-- to shortlisted, selected or declined; shortlisted to selected or declined. Everything else, including a decision a
-- response already has, is no move.
create function private.response_decision_allowed(p_from public.response_status, p_to public.response_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from in ('submitted', 'updated') and p_to in ('shortlisted', 'selected', 'declined'))
    or (p_from = 'shortlisted' and p_to in ('selected', 'declined'))
$$;

revoke all on function private.response_decision_allowed(public.response_status, public.response_status)
  from public, anon, authenticated, service_role;

-- Whether the partner p_partner may submit candidates to p_requirement by its response (FR-O3 step Open submissions,
-- FR-O4): its response is selected, or shortlisted with submissions allowed by the employer. The requirement's own state
-- is the caller's to check (V48).
create function private.submissions_allowed_for(p_requirement uuid, p_partner uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.partner_responses p
    where p.requirement_id = p_requirement and p.organization_id = p_partner and p.submissions_allowed
      and p.status in ('shortlisted', 'selected'))
$$;

revoke all on function private.submissions_allowed_for(uuid, uuid) from public, anon, authenticated, service_role;

-- One response_decided about the response p_response, p_decision (shortlisted, selected, declined, or
-- submissions_allowed when the employer opens submissions to a shortlisted partner), to each accepted owner and admin with
-- an active account of the responding partner while it is active, once per response and decision (FR-O3 AC7, FR-T1).
-- Answers the number queued, in the caller's transaction (NFR-A3).
create function private.queue_response_decision(p_response uuid, p_decision text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'response_decided:' || p_response || ':' || p_decision;
  v_messages jsonb[];
begin
  select array_agg(jsonb_build_object(
           'kind', 'response_decided', 'user_id', m.user_id, 'organization_id', p.organization_id, 'mandatory', k.mandatory,
           'dedupe_key', v_key, 'partner_response_id', p.id, 'decision', p_decision)
         order by m.user_id)
  into v_messages
  from public.partner_responses p
  join public.organizations o on o.id = p.organization_id and o.status = 'active'
  join public.organization_members m on m.organization_id = p.organization_id and m.role in ('owner', 'admin')
    and m.accepted_at is not null
  join public.profiles u on u.id = m.user_id and u.status = 'active'
  join private.notification_kinds k on k.kind = 'response_decided'
  where p.id = p_response
    and not exists (
      select 1 from public.notifications n where n.user_id = m.user_id and n.kind = 'response_decided' and n.dedupe_key = v_key);

  if v_messages is null then
    return 0;
  end if;
  perform pgmq.send_batch('notifications', v_messages);
  return cardinality(v_messages);
end;
$$;

revoke all on function private.queue_response_decision(uuid, text) from public, anon, authenticated, service_role;

-- The response p_response to a requirement of p_org, held for the change, after the checks every decision shares: an
-- owner or admin at aal2 of the active employer while release 2b is on (private.assert_requirement_manager:
-- CHARA_FORBIDDEN, aal2_required, release_off, employer_only); no such response to a requirement of p_org,
-- CHARA_NOT_FOUND (another employer's, an unknown id); a requirement that is not open or paused, CHARA_INVALID_STATE
-- requirement_not_open (FR-O3 AC9). The requirement is held against a close or fill until the transaction ends.
create function private.decided_response(p_org uuid, p_response uuid) returns public.partner_responses
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
  where p.id = p_response and p.employer_organization_id = p_org
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

revoke all on function private.decided_response(uuid, uuid) from public, anon, authenticated, service_role;

-- Deciding -----------------------------------------------------------------------------------------------------------------------

-- Shortlists, selects or declines the response p_response to a requirement of p_org (FR-O3 steps Decide, Reveal, Inform,
-- Open submissions; AC3 to AC9), with an optional note to the partner (trimmed, 1 to 1,000 characters, no control
-- characters other than tab and line breaks; empty is none) that replaces the note of an earlier decision. Refusals, in
-- this order, each writing nothing: those of private.decided_response; p_decision not shortlisted, selected or declined,
-- CHARA_INVALID_INPUT p_decision; a note out of bounds, CHARA_INVALID_INPUT p_note; a move private.response_decision_allowed
-- does not allow (a selected, declined or withdrawn response, or the decision it already has), CHARA_INVALID_TRANSITION
-- with the move; the daily quota of audited writes, CHARA_RATE_LIMITED. The decision sets decided_at and decided_by,
-- opens submissions on a selection and closes them on a decline, reveals the employer's name to the partner on a
-- shortlist or selection (cause shortlist or selection; an earlier reveal keeps its cause), writes one audit row
-- response.decided (from, to, whether a note was given) and queues response_decided to the partner's owners and admins.
-- Answers the new status.
create function public.decide_response(p_org uuid, p_response uuid, p_decision public.response_status, p_note text default null)
returns public.response_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_old public.partner_responses;
begin
  v_old := private.decided_response(p_org, p_response);
  if p_decision is null or p_decision not in ('shortlisted', 'selected', 'declined') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_decision';
  end if;
  if char_length(v_note) > 1000 or v_note ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_note';
  end if;
  if not private.response_decision_allowed(v_old.status, p_decision) then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = v_old.status || ' to ' || p_decision;
  end if;
  perform private.count_audited_write(p_org);

  update public.partner_responses p
  set status = p_decision, decided_at = now(), decided_by = (select auth.uid()), decision_note = v_note,
      submissions_allowed = case p_decision when 'selected' then true when 'declined' then false else p.submissions_allowed end
  where p.id = v_old.id;
  if p_decision in ('shortlisted', 'selected') then
    perform private.record_requirement_reveal(v_old.requirement_id, v_old.organization_id,
      case p_decision when 'shortlisted' then 'shortlist' else 'selection' end);
  end if;
  perform audit.record('response.decided', 'partner_response', v_old.id::text,
    jsonb_strip_nulls(jsonb_build_object('requirement_id', v_old.requirement_id, 'organization_id', v_old.organization_id,
      'employer_organization_id', p_org, 'from', v_old.status, 'to', p_decision,
      'with_note', case when v_note is not null then true end)));
  perform private.queue_response_decision(v_old.id, p_decision::text);
  return p_decision;
end;
$$;

revoke all on function public.decide_response(uuid, uuid, public.response_status, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_response(uuid, uuid, public.response_status, text) to authenticated;

-- Opens or closes candidate submissions for the shortlisted response p_response to a requirement of p_org (FR-O3 step Open
-- submissions, AC8; a selected response has them without this). Refusals, each writing nothing: those of
-- private.decided_response; p_allowed null, CHARA_INVALID_INPUT p_allowed; a response that is not shortlisted,
-- CHARA_INVALID_STATE with its status; the daily quota of audited writes, CHARA_RATE_LIMITED. A call with the current value
-- writes nothing and answers false; otherwise one audit row response.submissions_allowed (from, to) and, when opened, one
-- response_decided (submissions_allowed) to the partner's owners and admins; true.
create function public.set_submissions_allowed(p_org uuid, p_response uuid, p_allowed boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.partner_responses;
begin
  v_old := private.decided_response(p_org, p_response);
  if p_allowed is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_allowed';
  end if;
  if v_old.status <> 'shortlisted' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_old.status::text;
  end if;
  if v_old.submissions_allowed = p_allowed then
    return false;
  end if;
  perform private.count_audited_write(p_org);
  update public.partner_responses p set submissions_allowed = p_allowed where p.id = v_old.id;
  perform audit.record('response.submissions_allowed', 'partner_response', v_old.id::text,
    jsonb_build_object('requirement_id', v_old.requirement_id, 'organization_id', v_old.organization_id,
      'employer_organization_id', p_org, 'from', v_old.submissions_allowed, 'to', p_allowed));
  if p_allowed then
    perform private.queue_response_decision(v_old.id, 'submissions_allowed');
  end if;
  return true;
end;
$$;

revoke all on function public.set_submissions_allowed(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_submissions_allowed(uuid, uuid, boolean) to authenticated;

-- Comparing ----------------------------------------------------------------------------------------------------------------------

-- Every response to the requirement p_requirement of p_org, oldest first, with the same fields for each (FR-O3 step
-- Compare, AC1, AC2, AC11): the partner's display name, slug and type, the status and whether it changed since it was
-- last opened, the workers offered, the earliest start, the timeline, the experience, the fee model with amount and
-- currency, the countries the partner serves (organization_geographies serves_market), the dates, the decision with its
-- note and whether submissions are open. The page shows the responses that are not withdrawn as columns and lists the
-- withdrawn ones below. For any accepted member of the employer while release 2b is on (private.assert_invitation_employer;
-- members compare, owners and admins decide); another organisation's requirement or an unknown id, CHARA_NOT_FOUND. No
-- licence detail. Counted against rate_limit_job_orders_max like the other response reads.
create function public.compare_responses(p_org uuid, p_requirement uuid)
returns table (
  id uuid,
  organization_id uuid,
  partner_name text,
  partner_slug text,
  partner_type public.organization_type,
  invitation_id uuid,
  status public.response_status,
  version integer,
  updated_unseen boolean,
  capacity integer,
  available_from date,
  timeline_note text,
  experience_note text,
  fee_model public.fee_model,
  fee_amount numeric,
  fee_currency text,
  served_countries text[],
  created_at timestamptz,
  updated_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  submissions_allowed boolean,
  withdrawn_at timestamptz
)
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
  where p.requirement_id = p_requirement and p.employer_organization_id = p_org
  order by p.created_at, p.id;
end;
$$;

revoke all on function public.compare_responses(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.compare_responses(uuid, uuid) to authenticated;

-- private.notification_payload of 20261230100000_partner_responses.sql with response_decided added: the partner's own
-- decision (shortlisted, selected, declined, or submissions_allowed), the requirement's own title and the employer's name
-- only when the employer is named to that partner (a shortlist or selection reveals it; a declined marketplace response
-- keeps the generated title, NFR-S11), the response id for the link and the partner's own slug; never the note, another
-- partner or the number of responses (FR-O3 AC7). Every other branch is unchanged.
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
    when 'status_changed' then jsonb_build_object(
      'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name,
      'status', p_message -> 'status')
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
      ), '[]'::jsonb))
    when 'moderation_decision' then case
      when p_message ? 'report_id' then jsonb_build_object(
        'reference', private.report_reference((p_message ->> 'report_id')::bigint), 'outcome', p_message -> 'outcome')
      when p_message ? 'appeal_id' then jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case when p_message ->> 'target_type' = 'job' then v_title else v_org_name end,
        'org_slug', v_slug, 'appeal_id', p_message -> 'appeal_id', 'appeal_outcome', p_message -> 'appeal_outcome',
        'reasons', p_message -> 'reasons', 'moderation_action_id', p_message -> 'moderation_action_id')
      else jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case when p_message ->> 'target_type' = 'partner_profile' then v_org_name end,
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
    else '{}'::jsonb
  end);
end;
$$;


-- Reveals shown anywhere -----------------------------------------------------------------------------------------------------

-- Marks as seen the reveals of the partner p_org on the requirements p_requirements whose employer name a read has just
-- shown to it, so the first showing is audited once (requirement.employer_revealed, V39) wherever it happens: the job order
-- pages (V39), the invitation page (V41), and since V47 the partner's response list and response page. As get_job_order
-- does, a requirement whose employer shows its name to the partner anyway (show_identity on the marketplace while the
-- partner is eligible for the full job order) is left out: the reveal did not cause that showing.
create function private.mark_reveals_shown(p_org uuid, p_requirements uuid[]) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facts record;
begin
  if p_requirements is null or cardinality(p_requirements) = 0
     or not exists (select 1 from private.requirement_reveals rv
                    where rv.organization_id = p_org and rv.requirement_id = any (p_requirements) and rv.seen_at is null) then
    return;
  end if;
  select * into v_facts from private.job_order_partner_facts(p_org);
  perform private.mark_reveals_seen(p_org, array(
    select r.id from public.workforce_requirements r
    where r.id = any (p_requirements)
      and not (r.show_identity and r.visibility = 'job_order_marketplace'
        and cardinality(private.job_order_reasons(r.id, v_facts.paid, v_facts.served, v_facts.occupations)) = 0)));
end;
$$;

revoke all on function private.mark_reveals_shown(uuid, uuid[]) from public, anon, authenticated, service_role;

-- public.list_my_responses of 20261230100000_partner_responses.sql with one change: the reveals the page shows are marked
-- seen (private.mark_reveals_shown), so the first showing of the employer's name is audited. Everything else is unchanged.
create or replace function public.list_my_responses(p_org uuid, p_cursor uuid default null, p_limit integer default null)
returns table (
  id uuid,
  requirement_id uuid,
  invitation_id uuid,
  status public.response_status,
  version integer,
  capacity integer,
  available_from date,
  fee_model public.fee_model,
  fee_amount numeric,
  fee_currency text,
  created_at timestamptz,
  updated_at timestamptz,
  withdrawn_at timestamptz,
  decided_at timestamptz,
  requirement_status public.requirement_status,
  title text,
  country_code text,
  workers_needed integer,
  employer_name text,
  next_cursor uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_cursor public.partner_responses;
begin
  perform private.assert_invitation_partner(p_org);
  perform private.check_rate_limit('job_orders', (select auth.uid()));
  if p_cursor is not null then
    select * into v_cursor from public.partner_responses p where p.id = p_cursor and p.organization_id = p_org;
    if not found then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end if;
  end if;
  return query
  with page as (
    select p.*, row_number() over (order by p.created_at desc, p.id) as n
    from public.partner_responses p
    where p.organization_id = p_org
      and (p_cursor is null or p.created_at < v_cursor.created_at or (p.created_at = v_cursor.created_at and p.id > p_cursor))
    order by p.created_at desc, p.id
    limit v_limit + 1
  )
  select p.id, p.requirement_id, p.invitation_id, p.status, p.version, p.capacity, p.available_from, p.fee_model,
    p.fee_amount, p.fee_currency, p.created_at, p.updated_at, p.withdrawn_at, p.decided_at, r.status,
    case when nm.named then r.title else private.job_order_neutral_title(r.id) end,
    r.country_code, r.workers_needed,
    case when nm.named then e.display_name end,
    case when p.n = v_limit and exists (select 1 from page x where x.n = v_limit + 1) then p.id end
  from page p
  join public.workforce_requirements r on r.id = p.requirement_id
  join public.organizations e on e.id = r.organization_id
  cross join lateral (select private.requirement_named_to(r.id, p_org) as named) nm
  where p.n <= v_limit
  order by p.n;

  -- V47: the page names the employer of each requirement revealed to the partner; the first showing is audited.
  perform private.mark_reveals_shown(p_org, array(
    select p.requirement_id from public.partner_responses p
    where p.organization_id = p_org
      and (p_cursor is null or p.created_at < v_cursor.created_at or (p.created_at = v_cursor.created_at and p.id > p_cursor))
    order by p.created_at desc, p.id
    limit v_limit));
end;
$$;


-- public.get_response of 20261230100000_partner_responses.sql with one change: a partner reading its response with the
-- employer named through a reveal has the reveal marked seen (private.mark_reveals_shown). Everything else is unchanged.
create or replace function public.get_response(p_org uuid, p_response uuid)
returns table (
  id uuid,
  requirement_id uuid,
  invitation_id uuid,
  status public.response_status,
  version integer,
  capacity integer,
  available_from date,
  timeline_note text,
  experience_note text,
  fee_model public.fee_model,
  fee_amount numeric,
  fee_currency text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  submissions_allowed boolean,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  updated_unseen boolean,
  requirement_status public.requirement_status,
  title text,
  country_code text,
  workers_needed integer,
  max_capacity integer,
  employer_name text,
  partner_name text,
  partner_slug text
)
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
  where p.id = p_response and (case when v_employer then p.employer_organization_id else p.organization_id end) = p_org;
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

