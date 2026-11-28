-- Inquiries between partner companies (decision 5.1 as extended by the owner, D91 in docs/OPEN_QUESTIONS.md; FR-P2 AC1,
-- AC2 and AC11 applied to partners; NFR-S8, NFR-A3, NFR-O5; DATA_MODEL.md sections 5 and 7; release 2c with 2a).
--
-- A member of a listed recruitment company writes to a listed recruitment or staffing company, and a member of a listed
-- staffing company to a listed recruitment company (send_partner_inquiry); staffing to staffing is refused
-- (CHARA_FORBIDDEN partner_pair_not_allowed), and so is an organisation writing to itself. Employer to partner
-- (send_inquiry) is unchanged. The inquiry is a connection of kind inquiry from the sender to the recipient, as an
-- employer's is, so its typed message, the answer at the recipient's first reply, the decline, the partner dashboard's
-- waiting inquiries and the inquiries of company analytics need nothing new. Its conversation has a context of its own,
-- partner_inquiry, keyed by the first inquiry of the pair: neither organisation is the employer side of
-- private.conversation_context_parties, which has no branch for it, so open_conversation does not open it and only
-- send_partner_inquiry does.
--
-- The pair is unordered: one conversation per pair, and one inquiry waiting for an answer per pair whichever side sent it
-- (CHARA_CONFLICT open_inquiry), under an advisory lock on the pair so that two crossing inquiries cannot both pass. The
-- sender's limits are an employer's: the per-user inquiry rate, messages_per_month under messages:<org>, no free plan
-- (CHARA_FEATURE_NOT_IN_PLAN connection_actions), owners and admins at aal2, blocks and suspensions of the conversation.
-- inquiry_received goes to the recipient's owners and admins. Retention, erasure, export, blocks and reports read every
-- conversation whatever its context, so they cover this one as they are.

-- Whether an organisation of type p_from may send an inquiry to one of type p_to: recruitment to recruitment or staffing,
-- staffing to recruitment (D91).
create function private.partner_inquiry_pair_allowed(p_from public.organization_type, p_to public.organization_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from = 'recruitment_company' and p_to in ('recruitment_company', 'staffing_company'))
    or (p_from = 'staffing_company' and p_to = 'recruitment_company')
$$;

revoke all on function private.partner_inquiry_pair_allowed(public.organization_type, public.organization_type)
  from public, anon, authenticated, service_role;

-- p_org for an accepted member who may write to other partners for it: CHARA_FORBIDDEN for anyone else, partner_only for
-- an employer (which sends through send_inquiry), aal2_required for an owner or admin at aal1, organization_suspended,
-- not_listed while the company is not listed and visible in the directories; CHARA_FEATURE_NOT_IN_PLAN
-- connection_actions on a free plan, a lapsed or canceled subscription included, as private.assert_connection_employer.
create function private.assert_partner_inquiry_sender(p_org uuid) returns public.organizations
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_org from public.organizations o where o.id = p_org;
  if v_org.type = 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'partner_only', errcode = '42501';
  end if;
  perform private.assert_member_aal2(p_org);
  if v_org.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended', errcode = '42501';
  end if;
  if not private.invitable_partner(p_org) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'not_listed', errcode = '42501';
  end if;
  if private.org_plan_code(p_org) like 'free\_%' then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'connection_actions';
  end if;
  return v_org;
end;
$$;

revoke all on function private.assert_partner_inquiry_sender(uuid) from public, anon, authenticated, service_role;

-- An inquiry from the partner p_org to the partner p_partner. Refusals in order, each writing nothing: CHARA_NOT_FOUND
-- while release_messaging or release_partner_directories is off; private.assert_partner_inquiry_sender; a body as
-- send_inquiry's, CHARA_INVALID_INPUT p_body; p_partner = p_org, CHARA_FORBIDDEN self; private.assert_connection_partner
-- (an employer CHARA_FORBIDDEN, anything not listed and visible CHARA_NOT_FOUND); a pair D91 does not allow,
-- CHARA_FORBIDDEN partner_pair_not_allowed; the caller's inquiries over rate_limit_inquiry_max per
-- rate_limit_inquiry_seconds, CHARA_RATE_LIMITED; under the pair's lock and messages:<org>, an inquiry of the pair in
-- either direction still waiting for an answer, CHARA_CONFLICT open_inquiry, the monthly message limit
-- (CHARA_LIMIT_REACHED messages_per_month), a closed conversation of the pair (CHARA_FORBIDDEN blocked or org_suspended)
-- and the daily quota of audited writes. Writes the connection (sent), the conversation of context partner_inquiry of the
-- pair when it has none yet, the typed message, one audit row connection.created (never the body) and inquiry_received
-- to the recipient's owners and admins. Answers the conversation id.
create function public.send_partner_inquiry(p_org uuid, p_partner uuid, p_body text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.connection_caller();
  v_org public.organizations;
  v_body text;
  v_partner public.organizations;
  v_conversation public.conversations;
  v_id uuid := gen_random_uuid();
  v_reason text;
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_org := private.assert_partner_inquiry_sender(p_org);
  v_body := private.connection_body(p_body, private.connection_setting('inquiry_body_min_chars'),
    private.connection_setting('inquiry_body_max_chars'));
  if p_partner = p_org then
    raise exception 'CHARA_FORBIDDEN' using detail = 'self', errcode = '42501';
  end if;
  v_partner := private.assert_connection_partner(p_partner);
  if not private.partner_inquiry_pair_allowed(v_org.type, v_partner.type) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'partner_pair_not_allowed', errcode = '42501';
  end if;

  perform private.check_rate_limit('inquiry', v_uid);
  perform pg_advisory_xact_lock(hashtextextended(
    'partner_inquiry:' || least(p_org, p_partner)::text || ':' || greatest(p_org, p_partner)::text, 0));
  perform private.lock_organization_messages(p_org);
  if exists (
    select 1 from public.connections c
    where c.kind = 'inquiry' and c.status = 'sent'
      and ((c.from_organization_id = p_org and c.to_organization_id = p_partner)
        or (c.from_organization_id = p_partner and c.to_organization_id = p_org))
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'open_inquiry';
  end if;

  select v.* into v_conversation
  from public.conversations v join public.connections c on c.id = v.context_id
  where v.context_type = 'partner_inquiry'
    and ((c.from_organization_id = p_org and c.to_organization_id = p_partner)
      or (c.from_organization_id = p_partner and c.to_organization_id = p_org));
  if found then
    v_reason := private.conversation_closed_reason(v_conversation);
    if v_reason is not null then
      raise exception 'CHARA_FORBIDDEN' using detail = v_reason, errcode = '42501';
    end if;
  end if;
  perform private.count_audited_write(p_org);

  if v_conversation.id is null then
    v_conversation.id := private.open_organization_conversation('partner_inquiry', v_id, null, p_org, p_partner);
  end if;
  insert into public.connections (id, kind, from_organization_id, to_organization_id, conversation_id, created_by)
  values (v_id, 'inquiry', p_org, v_partner.id, v_conversation.id, v_uid);
  perform private.write_typed_message(v_conversation.id, p_org, 'inquiry', v_body, v_id);
  perform audit.record('connection.created', 'connection', v_id::text, jsonb_build_object(
    'kind', 'inquiry', 'organization_id', p_org, 'to_organization_id', p_partner, 'conversation_id', v_conversation.id,
    'context_type', 'partner_inquiry'));
  perform private.queue_org_event(p_partner, 'inquiry_received', jsonb_build_object('connection_id', v_id),
    'inquiry_received:' || v_id);
  return v_conversation.id;
end;
$$;

revoke all on function public.send_partner_inquiry(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.send_partner_inquiry(uuid, uuid, text) to authenticated;

-- open_inquiry of 20270211100000_connection_actions.sql for an unordered pair: the waiting inquiry between p_org and
-- p_partner, whichever sent it, and its conversation, for the page that points a refused inquiry to it (AC2, D91). An
-- employer's pair answers as before, as a partner never sends to an employer. Any member of p_org; nothing for anyone
-- else.
create or replace function public.open_inquiry(p_org uuid, p_partner uuid) returns table (connection_id uuid, conversation_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.connection_caller();
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  return query
  select c.id, c.conversation_id from public.connections c
  where c.kind = 'inquiry' and c.status = 'sent'
    and ((c.from_organization_id = p_org and c.to_organization_id = p_partner)
      or (c.from_organization_id = p_partner and c.to_organization_id = p_org))
  order by c.created_at desc
  limit 1;
end;
$$;

-- private.conversation_labels of 20270211100000_connection_actions.sql with partner_inquiry beside inquiry: each
-- organisation names the other by display name; no context title.
create or replace function private.conversation_labels(p_conversation public.conversations, p_side uuid)
returns table (counterpart_kind text, counterpart_name text, context_title text, counterpart_named boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_org uuid;
  v_title text;
  v_requirement public.workforce_requirements;
  v_named boolean := true;
begin
  -- V71, D91: the two organisations of an inquiry, an employer's or a partner's.
  if p_conversation.context_type in ('inquiry', 'partner_inquiry') then
    return query
    select 'organization'::text, o.display_name, null::text, true
    from public.conversation_participants p join public.organizations o on o.id = p.organization_id
    where p.conversation_id = p_conversation.id and p.organization_id is distinct from p_side
    limit 1;
    return;
  end if;

  -- V70: the worker of an accepted contact request is named to the organisation by the passport's first and last name
  -- (the reveal of FR-Q3), the organisation to the worker by its display name; the vacancy of the request is the title.
  if p_conversation.context_type = 'contact_request' then
    return query
    select case when p_side is null then 'organization' else 'worker' end,
      case when p_side is null then o.display_name
           else nullif(btrim(concat_ws(' ', w.first_name, w.last_name)), '') end,
      j.title, true
    from public.contact_requests r
    join public.organizations o on o.id = r.organization_id
    left join public.worker_profiles w on w.user_id = r.worker_user_id and r.status = 'accepted'
    left join public.jobs j on j.id = r.job_id
    where r.id = p_conversation.context_id;
    if not found then
      return query select case when p_side is null then 'organization' else 'worker' end, null::text, null::text, true;
    end if;
    return;
  end if;

  if p_conversation.context_type = 'application' then
    select a.profile_snapshot, a.organization_id, j.title into v_snapshot, v_org, v_title
    from public.job_applications a join public.jobs j on j.id = a.job_id
    where a.id = p_conversation.context_id;
  elsif p_conversation.context_type = 'candidate_submission' then
    select s.profile_snapshot, s.employer_organization_id into v_snapshot, v_org
    from public.candidate_submissions s where s.id = p_conversation.context_id;
    select * into v_requirement from public.workforce_requirements r where r.id = p_conversation.requirement_id;
    if p_side is null then
      v_named := coalesce(v_requirement.show_identity, false);
      v_title := private.submission_candidate_title(v_requirement);
    else
      v_title := v_requirement.title;
    end if;
  else
    select * into v_requirement from public.workforce_requirements r where r.id = p_conversation.requirement_id;
    if p_side = v_requirement.organization_id then
      select p.organization_id into v_org from public.conversation_participants p
      where p.conversation_id = p_conversation.id and p.organization_id <> p_side;
      v_title := v_requirement.title;
    else
      v_org := v_requirement.organization_id;
      v_named := private.requirement_named_to(v_requirement.id, p_side);
      v_title := case when v_named then v_requirement.title else private.job_order_neutral_title(v_requirement.id) end;
    end if;
  end if;

  if p_side is not null and p_conversation.context_type in ('application', 'candidate_submission') then
    return query select 'worker'::text,
      nullif(btrim(concat_ws(' ', v_snapshot ->> 'first_name', v_snapshot ->> 'last_name')), ''), v_title, true;
  else
    return query select 'organization'::text,
      case when v_named then (select o.display_name from public.organizations o where o.id = v_org) end, v_title, v_named;
  end if;
end;
$$;

revoke all on function private.conversation_labels(public.conversations, uuid) from public, anon, authenticated, service_role;

-- The notice now also reaches a partner asked by another partner (D91).
update private.notification_kinds set label = 'Inquiries from employers and partners' where kind = 'inquiry_received';
