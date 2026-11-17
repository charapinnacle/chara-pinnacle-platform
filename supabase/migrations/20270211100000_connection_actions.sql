-- Structured connection actions (FR-P2 AC1 to AC4, AC7, AC8, AC11; SOP P2-27 steps Send inquiry, Request workforce,
-- Invite to job, Track; decisions 5.1, 5.3; NFR-S8, NFR-S9, NFR-A3, NFR-A4, NFR-O5, NFR-M3, NFR-U4; DATA_MODEL.md
-- sections 5, 6, 7 and 9; V71, release 2c).
--
-- Each contact action writes one public.connections row and one typed message (messages.kind and messages.connection_id)
-- in a conversation, and notifies the receiving side in the same transaction (NFR-A3):
--   send_inquiry       a member of an employer to a listed recruitment or staffing company: the conversation of context
--                      inquiry between the two organisations (one per pair, keyed by the first inquiry), inquiry_received
--                      to the partner's owners and admins;
--   request_workforce  an owner or admin at aal2 of an employer to a staffing company, or a recruitment company listing the
--                      staffing service: a private draft requirement (save_requirement of FR-M1) with the one occupation,
--                      an invitation to it (FR-O1) and the conversation of that invitation, workforce_request_received;
--   invite_to_job      a member of an organisation in a conversation with a worker (an application, a submission or an
--                      accepted contact request): an invitation to apply to one of its open vacancies, job_invitation to
--                      the worker. The direct-hiring rule of the worker's country for the vacancy's country shapes it as
--                      Find Workers shows it (V69, private.worker_card_contact).
-- Submit candidate stays FR-O4's form (V49): the pages offer it where the partner may submit, and nothing reaches the
-- employer before the candidate approves, so no message is written for it here. Save partner and Follow company (V24)
-- write no message and no connection.
--
-- Every typed message is a message of the sending organisation, so it counts against messages_per_month (FR-P3, V66)
-- under the organisation's lock messages:<org>; inquiries are also counted per user against rate_limit_inquiry_max per
-- rate_limit_inquiry_seconds, and an organisation keeps at most one inquiry waiting for an answer per partner
-- (CHARA_CONFLICT open_inquiry). Employers on a free plan, a lapsed subscription included, send neither inquiries nor
-- workforce requests (CHARA_FEATURE_NOT_IN_PLAN connection_actions).
--
-- Status (sent -> answered, accepted or declined, then final): an inquiry is answered at the partner's first text reply,
-- a workforce request accepted when the partner responds to the requirement (FR-O2), a job invitation accepted when the
-- worker applies to the vacancy (FR-D1); the receiving side declines through set_connection_status. Each change writes
-- connection.status_changed. Every function a user calls answers CHARA_NOT_FOUND while release_messaging is off
-- (request_workforce also while release_job_orders is off).

insert into private.settings (key, value) values
  ('inquiry_body_min_chars', '20'),
  ('inquiry_body_max_chars', '2000'),
  ('rate_limit_inquiry_max', '10'),
  ('rate_limit_inquiry_seconds', '86400')
on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('inquiry_body_min_chars', 'integer', 1, 2000, 'Fewest characters in an inquiry to a partner', null),
  ('inquiry_body_max_chars', 'integer', 20, 4000, 'Most characters in an inquiry to a partner', null),
  ('rate_limit_inquiry_max', 'integer', 1, 1000, 'Inquiries one person may send in the inquiry window', null),
  ('rate_limit_inquiry_seconds', 'integer', 60, 604800, 'Seconds of the inquiry window', null);

create type public.connection_kind as enum ('inquiry', 'request_workforce', 'invite_to_job', 'submit_candidate');
create type public.connection_status as enum ('sent', 'answered', 'accepted', 'declined');

-- The connections ---------------------------------------------------------------------------------------------------------

-- One contact action: from an organisation to an organisation (inquiry, request_workforce) or to a worker
-- (invite_to_job), in one conversation. to_user_id goes with the profile (erasure); created_by is set null.
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  kind public.connection_kind not null,
  from_organization_id uuid not null references public.organizations (id) on delete cascade,
  to_organization_id uuid references public.organizations (id) on delete cascade,
  to_user_id uuid references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  requirement_id uuid references public.workforce_requirements (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  status public.connection_status not null default 'sent',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  status_changed_at timestamptz,
  constraint connections_one_recipient check (num_nonnulls(to_organization_id, to_user_id) = 1),
  constraint connections_kind_recipient check ((kind = 'invite_to_job') = (to_user_id is not null)),
  constraint connections_status_changed check ((status = 'sent') = (status_changed_at is null)),
  constraint connections_not_self check (to_organization_id is distinct from from_organization_id)
);

comment on table public.connections is
  'Structured contact actions of FR-P2 (inquiry, workforce request, invitation to apply), each with its typed message. Written only by send_inquiry, request_workforce, invite_to_job, set_connection_status and the status triggers. Members of either organisation and the addressed worker read them.';
comment on column public.connections.to_user_id is
  'The worker invited to apply. Not readable through the Data API; the organisation knows the worker through the conversation only.';
comment on column public.connections.created_by is
  'The member who sent the action. Not readable through the Data API.';

create index connections_from_idx on public.connections (from_organization_id, created_at desc);
create index connections_to_organization_idx on public.connections (to_organization_id, created_at desc)
  where to_organization_id is not null;
create index connections_to_user_idx on public.connections (to_user_id, job_id) where to_user_id is not null;
create index connections_conversation_idx on public.connections (conversation_id);
create index connections_requirement_idx on public.connections (requirement_id) where requirement_id is not null;
create index connections_job_idx on public.connections (job_id) where job_id is not null;
create index connections_created_by_idx on public.connections (created_by) where created_by is not null;
create index connections_open_inquiry_idx on public.connections (from_organization_id, to_organization_id)
  where kind = 'inquiry' and status = 'sent';

alter table public.connections enable row level security;
alter table public.connections force row level security;
revoke all on table public.connections from public, anon, authenticated, service_role;
grant select (id, kind, from_organization_id, to_organization_id, conversation_id, requirement_id, job_id, status, created_at,
  status_changed_at) on public.connections to authenticated;

create policy connections_select_member on public.connections
  for select to authenticated
  using (from_organization_id in (select private.member_org_ids()) or to_organization_id in (select private.member_org_ids()));

create policy connections_select_worker on public.connections
  for select to authenticated
  using (to_user_id = (select auth.uid()));

-- The typed message of a connection (V63 left the column to this unit).
alter table public.messages add column connection_id uuid references public.connections (id) on delete set null;
create index messages_connection_idx on public.messages (connection_id) where connection_id is not null;
grant select (connection_id) on public.messages to authenticated;
comment on column public.messages.connection_id is
  'The connection a typed message (kind other than text) carries (FR-P2, V71); null for a text message.';

-- Helpers ------------------------------------------------------------------------------------------------------------------

-- An integer setting of this unit; CHARA_SETTING_MISSING when it is missing or not a whole number.
create function private.connection_setting(p_key text) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value integer := (
    select case when s.value #>> '{}' ~ '^[0-9]{1,6}$' then (s.value #>> '{}')::integer end
    from private.settings s where s.key = p_key);
begin
  if v_value is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = p_key;
  end if;
  return v_value;
end;
$$;

revoke all on function private.connection_setting(text) from public, anon, authenticated, service_role;

-- A signed-in caller while release_messaging is on, answered with the user id: CHARA_NOT_FOUND while the release is off,
-- CHARA_FORBIDDEN (42501) without a session.
create function private.connection_caller() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not private.release_on('release_messaging') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

revoke all on function private.connection_caller() from public, anon, authenticated, service_role;

-- p_org for an accepted member who may contact partners for it: CHARA_FORBIDDEN for anyone else, employer_only for a
-- recruitment or staffing company (FR-P2 roles: employer to partner only), aal2_required for an owner or admin at aal1
-- (the conversation is read at aal2, as applicant data), organization_suspended; CHARA_FEATURE_NOT_IN_PLAN
-- connection_actions on a free plan, which a lapsed or canceled subscription falls back to (FR-P2 AC2).
create function private.assert_connection_employer(p_org uuid) returns public.organizations
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
  if v_org.type <> 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'employer_only', errcode = '42501';
  end if;
  perform private.assert_member_aal2(p_org);
  if v_org.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended', errcode = '42501';
  end if;
  if private.org_plan_code(p_org) like 'free\_%' then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'connection_actions';
  end if;
  return v_org;
end;
$$;

revoke all on function private.assert_connection_employer(uuid) from public, anon, authenticated, service_role;

-- The partner p_partner an employer may address: an employer (or the employer itself), CHARA_FORBIDDEN (employer to partner
-- only); anything that is not a listed, visible, active recruitment or staffing company (awaiting approval, declined,
-- hidden, suspended, unknown), CHARA_NOT_FOUND, one answer (FR-P2 AC1).
create function private.assert_connection_partner(p_partner uuid) returns public.organizations
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_partner public.organizations;
begin
  select * into v_partner from public.organizations o where o.id = p_partner;
  if found and v_partner.type = 'employer' then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not found or not private.invitable_partner(p_partner) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_partner;
end;
$$;

revoke all on function private.assert_connection_partner(uuid) from public, anon, authenticated, service_role;

-- A body of a typed message: CR LF as line feed, trimmed of spaces, tabs and line feeds; CHARA_INVALID_INPUT p_body for
-- fewer than p_min or more than p_max characters or a control character other than line feed and tab. Null stays null.
create function private.connection_body(p_body text, p_min integer, p_max integer) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body text := nullif(btrim(replace(coalesce(p_body, ''), E'\r\n', E'\n'), E' \t\n'), '');
begin
  if char_length(coalesce(v_body, '')) not between p_min and p_max or v_body ~ '[\x01-\x08\x0b-\x1f\x7f]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_body', errcode = '22023';
  end if;
  return v_body;
end;
$$;

revoke all on function private.connection_body(text, integer, integer) from public, anon, authenticated, service_role;

-- Counts one typed message of p_org against messages_per_month under the organisation's lock messages:<org> (V66), so a
-- typed message and a text message of the same organisation never pass the limit together.
create function private.lock_organization_messages(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('messages:' || p_org::text, 0));
  perform private.assert_within_limit(p_org, 'messages_per_month', private.monthly_usage(p_org, 'messages_per_month'));
end;
$$;

revoke all on function private.lock_organization_messages(uuid) from public, anon, authenticated, service_role;

-- Writes the typed message of p_connection in p_conversation from p_org and moves the conversation to the top of the
-- lists; the time is taken after the locks, as send_message takes it.
create function private.write_typed_message(
  p_conversation uuid, p_org uuid, p_kind public.message_kind, p_body text, p_connection uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := clock_timestamp();
  v_id uuid;
begin
  insert into public.messages (conversation_id, sender_user_id, sender_organization_id, kind, body, connection_id, created_at)
  values (p_conversation, (select auth.uid()), p_org, p_kind, p_body, p_connection, v_at)
  returning id into v_id;
  update public.conversations c set last_message_at = v_at where c.id = p_conversation;
  return v_id;
end;
$$;

revoke all on function private.write_typed_message(uuid, uuid, public.message_kind, text, uuid)
  from public, anon, authenticated, service_role;

-- Opens a conversation of p_type p_context between the employer p_org and the partner p_partner without the checks of
-- open_conversation, which the calling function made: one audit row conversation.opened, as open_conversation writes.
create function private.open_organization_conversation(
  p_type public.conversation_context, p_context uuid, p_requirement uuid, p_org uuid, p_partner uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.conversations (context_type, context_id, requirement_id, opened_by)
  values (p_type, p_context, p_requirement, (select auth.uid()))
  returning id into v_id;
  insert into public.conversation_participants (conversation_id, organization_id) values (v_id, p_org), (v_id, p_partner);
  perform audit.record('conversation.opened', 'conversations', v_id::text, jsonb_strip_nulls(jsonb_build_object(
    'context_type', p_type, 'context_id', p_context, 'requirement_id', p_requirement, 'organization_id', p_org)));
  return v_id;
end;
$$;

revoke all on function private.open_organization_conversation(public.conversation_context, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- Send inquiry (AC1, AC2, AC11) --------------------------------------------------------------------------------------------

-- An inquiry from the employer p_org to the partner p_partner (SOP step Send inquiry). Refusals in order, each writing
-- nothing: CHARA_NOT_FOUND while release_messaging is off; private.assert_connection_employer; a body outside
-- inquiry_body_min_chars to inquiry_body_max_chars (20 to 2,000) or with a control character, CHARA_INVALID_INPUT p_body;
-- private.assert_connection_partner; the caller's inquiries over rate_limit_inquiry_max per rate_limit_inquiry_seconds,
-- CHARA_RATE_LIMITED; under the lock messages:<org>, an inquiry of p_org to p_partner still waiting for an answer,
-- CHARA_CONFLICT open_inquiry (the page then points to its conversation), the monthly message limit
-- (CHARA_LIMIT_REACHED messages_per_month), a blocked conversation of the pair (CHARA_FORBIDDEN blocked) and the daily
-- quota of audited writes. Writes the connection (sent), the conversation of context inquiry of the pair when it has
-- none yet (its context id is the first inquiry), the typed message, one audit row connection.created (never the body)
-- and inquiry_received to the partner's owners and admins. Answers the conversation id.
create function public.send_inquiry(p_org uuid, p_partner uuid, p_body text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.connection_caller();
  v_org public.organizations := private.assert_connection_employer(p_org);
  v_body text := private.connection_body(p_body, private.connection_setting('inquiry_body_min_chars'),
    private.connection_setting('inquiry_body_max_chars'));
  v_partner public.organizations := private.assert_connection_partner(p_partner);
  v_conversation public.conversations;
  v_id uuid := gen_random_uuid();
  v_reason text;
begin
  perform private.check_rate_limit('inquiry', v_uid);
  perform private.lock_organization_messages(p_org);
  if exists (
    select 1 from public.connections c
    where c.from_organization_id = p_org and c.to_organization_id = p_partner and c.kind = 'inquiry' and c.status = 'sent'
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'open_inquiry';
  end if;

  select v.* into v_conversation
  from public.conversations v join public.connections c on c.id = v.context_id
  where v.context_type = 'inquiry' and c.from_organization_id = p_org and c.to_organization_id = p_partner;
  if found then
    v_reason := private.conversation_closed_reason(v_conversation);
    if v_reason is not null then
      raise exception 'CHARA_FORBIDDEN' using detail = v_reason, errcode = '42501';
    end if;
  end if;
  perform private.count_audited_write(p_org);

  if v_conversation.id is null then
    v_conversation.id := private.open_organization_conversation('inquiry', v_id, null, p_org, p_partner);
  end if;
  insert into public.connections (id, kind, from_organization_id, to_organization_id, conversation_id, created_by)
  values (v_id, 'inquiry', p_org, v_partner.id, v_conversation.id, v_uid);
  perform private.write_typed_message(v_conversation.id, p_org, 'inquiry', v_body, v_id);
  perform audit.record('connection.created', 'connection', v_id::text, jsonb_build_object(
    'kind', 'inquiry', 'organization_id', p_org, 'to_organization_id', p_partner, 'conversation_id', v_conversation.id));
  perform private.queue_org_event(p_partner, 'inquiry_received', jsonb_build_object('connection_id', v_id),
    'inquiry_received:' || v_id);
  return v_conversation.id;
end;
$$;

revoke all on function public.send_inquiry(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.send_inquiry(uuid, uuid, text) to authenticated;

-- Request workforce (AC3, AC11) ---------------------------------------------------------------------------------------------

-- A workforce request from the employer p_org to the partner p_partner (SOP step Request workforce): p_quantity (1 to
-- 10,000) workers of the occupation p_occupation for p_destination, city or region p_city_region, from p_start_date (today
-- in UTC or later), in the industry p_industry (the employer's own when null) and employment p_employment_type
-- (temporary when null), with an optional p_body of up to 2,000 characters. Refusals in order, each writing nothing:
-- CHARA_NOT_FOUND while release_messaging or release_job_orders is off; private.assert_connection_employer; an owner or
-- admin at aal2 only (CHARA_FORBIDDEN, aal2_required at aal1, as FR-M1); private.assert_connection_partner; a recruitment
-- company that does not list the staffing service, CHARA_INVALID_INPUT not_staffing; CHARA_INVALID_INPUT p_quantity,
-- p_occupation, p_destination, p_start_date, p_city_region, p_industry or p_body; then save_requirement's own checks
-- (prohibited wording, the start date's horizon). Writes the private draft requirement through save_requirement (its
-- audit row requirement.created; visibility stays null until publication, as for every draft) with the one occupation,
-- the invitation (invited, source profile; the employer's name is revealed to the partner) under the employer's
-- invitations lock against partner_invitations_per_requirement and partner_invitations_per_day_max, the conversation of
-- the invitation, the typed message under the lock messages:<org>, one audit row connection.created and
-- workforce_request_received to the partner's owners and admins (not invitation_received). Answers the conversation id.
-- The partner replies in the conversation and responds formally once the requirement is published (FR-P2 open point).
create function public.request_workforce(
  p_org uuid, p_partner uuid, p_occupation text, p_quantity integer, p_destination text, p_start_date date,
  p_city_region text, p_body text default null, p_industry text default null,
  p_employment_type public.employment_type default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.connection_caller();
  v_org public.organizations;
  v_partner public.organizations;
  v_body text;
  v_city text := btrim(coalesce(p_city_region, ''));
  v_destination text := upper(btrim(p_destination));
  v_industry text;
  v_requirement uuid;
  v_invitation uuid;
  v_conversation uuid;
  v_id uuid;
  v_label text;
  v_day_max integer := private.connection_setting('partner_invitations_per_day_max');
begin
  if not private.release_on('release_job_orders') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_org := private.assert_connection_employer(p_org);
  perform private.assert_org_manager(p_org, 'admin');
  v_partner := private.assert_connection_partner(p_partner);
  if v_partner.type = 'recruitment_company' and not exists (
    select 1 from public.organization_service_types s where s.organization_id = p_partner and s.service = 'staffing'
  ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'not_staffing', errcode = '22023';
  end if;

  if p_quantity is null or p_quantity not between 1 and 10000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_quantity', errcode = '22023';
  end if;
  select o.label into v_label from public.occupations o where o.code = p_occupation;
  if not found then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_occupation', errcode = '22023';
  end if;
  if not exists (select 1 from public.countries c where c.code = v_destination) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_destination', errcode = '22023';
  end if;
  if p_start_date is null or p_start_date < (now() at time zone 'utc')::date then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_start_date', errcode = '22023';
  end if;
  if char_length(v_city) not between 1 and 100 or v_city ~ '[[:cntrl:]]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_city_region', errcode = '22023';
  end if;
  v_industry := coalesce(p_industry, v_org.industry_code);
  if v_industry is null or not exists (select 1 from public.industries i where i.code = v_industry) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_industry', errcode = '22023';
  end if;
  v_body := coalesce(
    private.connection_body(p_body, 0, 2000),
    format('Workforce request: %s × %s in %s, %s, from %s.', p_quantity, v_label, v_city, v_destination,
      to_char(p_start_date, 'YYYY-MM-DD')));

  v_requirement := public.save_requirement(
    p_org, p_quantity, v_destination, v_city, v_industry,
    jsonb_build_array(jsonb_build_object('occupation_id', p_occupation, 'quantity', p_quantity)),
    p_start_date, coalesce(p_employment_type, 'temporary'), 'both', 'staffing', false, false, false);

  perform pg_advisory_xact_lock(hashtextextended('partner_invitations:' || p_org::text, 0));
  perform private.assert_within_limit(p_org, 'partner_invitations_per_requirement', 0);
  if (select count(*) from public.requirement_invitations i
      where i.employer_organization_id = p_org and i.invited_at > now() - interval '24 hours') >= v_day_max then
    raise exception 'CHARA_RATE_LIMITED' using detail = 'partner_invitations_per_day';
  end if;
  insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source, invited_by)
  values (v_requirement, p_partner, p_org, 'profile', v_uid)
  returning id into v_invitation;
  perform audit.record('requirement.invitation_sent', 'requirement_invitation', v_invitation::text,
    jsonb_build_object('requirement_id', v_requirement, 'organization_id', p_partner, 'employer_organization_id', p_org,
      'source', 'profile'));
  perform private.record_requirement_reveal(v_requirement, p_partner, 'invitation');

  perform private.lock_organization_messages(p_org);
  v_conversation := private.open_organization_conversation('requirement_invitation', v_invitation, v_requirement, p_org,
    p_partner);
  insert into public.connections (kind, from_organization_id, to_organization_id, conversation_id, requirement_id, created_by)
  values ('request_workforce', p_org, p_partner, v_conversation, v_requirement, v_uid)
  returning id into v_id;
  perform private.write_typed_message(v_conversation, p_org, 'request_workforce', v_body, v_id);
  perform audit.record('connection.created', 'connection', v_id::text, jsonb_build_object(
    'kind', 'request_workforce', 'organization_id', p_org, 'to_organization_id', p_partner,
    'conversation_id', v_conversation, 'requirement_id', v_requirement));
  perform private.queue_org_event(p_partner, 'workforce_request_received', jsonb_build_object('connection_id', v_id),
    'workforce_request_received:' || v_id);
  return v_conversation;
end;
$$;

revoke all on function public.request_workforce(uuid, uuid, text, integer, text, date, text, text, text, public.employment_type)
  from public, anon, authenticated, service_role;
grant execute on function public.request_workforce(uuid, uuid, text, integer, text, date, text, text, text, public.employment_type)
  to authenticated;

-- Invite to job (AC4, AC11) -------------------------------------------------------------------------------------------------

-- An invitation to apply to the vacancy p_job, sent in p_conversation by a member of the organisation side to the worker of
-- the other side (SOP step Invite to job), with an optional p_body of up to 2,000 characters. Refusals in order, each
-- writing nothing: CHARA_NOT_FOUND while release_messaging is off; private.participant_conversation (no party, an
-- unknown or made-up id: CHARA_FORBIDDEN; aal2_required); the worker's own side or a conversation without a worker,
-- CHARA_FORBIDDEN; a conversation closed for messages, CHARA_FORBIDDEN with its reason; another organisation's vacancy,
-- CHARA_FORBIDDEN; a vacancy of the organisation that is not open and visible (draft, paused, closed, hidden, deleted) or
-- unknown, CHARA_JOB_NOT_OPEN; CHARA_INVALID_INPUT p_body; the direct-hiring rule of the worker's current country for the
-- vacancy's country (private.worker_card_contact of V69): blocked, CHARA_FORBIDDEN direct_hiring_blocked; a licensed
-- partner required that the organisation is not, CHARA_FORBIDDEN licensed_partner_required; an application of the worker
-- to the vacancy, CHARA_CONFLICT already_applied; an invitation to it still waiting, CHARA_CONFLICT open_invitation; the
-- message throttle; the monthly message limit. Writes the connection, the typed message, connection.created (never the
-- worker or the body) and job_invitation to the worker. Answers the connection id.
create function public.invite_to_job(p_conversation uuid, p_job uuid, p_body text default null) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.connection_caller();
  v_row public.conversations;
  v_side uuid;
  v_worker uuid;
  v_org public.organizations;
  v_job public.jobs;
  v_body text;
  v_reason text;
  v_contact text;
  v_id uuid;
begin
  v_row := private.participant_conversation(p_conversation, true);
  v_side := (select s.organization_id from private.conversation_side(p_conversation) s);
  select p.user_id into v_worker from public.conversation_participants p
  where p.conversation_id = v_row.id and p.user_id is not null;
  if v_side is null or v_worker is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  v_reason := private.conversation_closed_reason(v_row);
  if v_reason is not null then
    raise exception 'CHARA_FORBIDDEN' using detail = v_reason, errcode = '42501';
  end if;
  select * into v_job from public.jobs j where j.id = p_job;
  if found and v_job.organization_id <> v_side then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not found or v_job.status <> 'open' or v_job.moderation_state <> 'visible' or v_job.deleted_at is not null then
    raise exception 'CHARA_JOB_NOT_OPEN';
  end if;
  v_body := coalesce(private.connection_body(p_body, 0, 2000), format('Invitation to apply: %s', v_job.title));

  select * into v_org from public.organizations o where o.id = v_side;
  select d.direct_contact into v_contact
  from public.worker_profiles w
  cross join lateral private.worker_card_contact(
    w.current_country, v_job.country_code,
    v_org.type <> 'employer' and private.holds_licence_for(v_side, v_job.country_code)) d
  where w.user_id = v_worker;
  if v_contact = 'blocked' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'direct_hiring_blocked', errcode = '42501';
  end if;
  if v_contact = 'partner_required' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'licensed_partner_required', errcode = '42501';
  end if;

  if exists (select 1 from public.job_applications a where a.job_id = v_job.id and a.worker_user_id = v_worker) then
    raise exception 'CHARA_CONFLICT' using detail = 'already_applied';
  end if;
  perform private.check_rate_limit('message', v_uid);
  perform private.lock_organization_messages(v_side);
  if exists (
    select 1 from public.connections c
    where c.to_user_id = v_worker and c.job_id = v_job.id and c.kind = 'invite_to_job' and c.status = 'sent'
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'open_invitation';
  end if;

  insert into public.connections (kind, from_organization_id, to_user_id, conversation_id, job_id, created_by)
  values ('invite_to_job', v_side, v_worker, v_row.id, v_job.id, v_uid)
  returning id into v_id;
  perform private.write_typed_message(v_row.id, v_side, 'invite_to_job', v_body, v_id);
  perform audit.record('connection.created', 'connection', v_id::text, jsonb_build_object(
    'kind', 'invite_to_job', 'organization_id', v_side, 'conversation_id', v_row.id, 'job_id', v_job.id));
  perform pgmq.send('notifications', jsonb_build_object(
    'kind', 'job_invitation', 'user_id', v_worker, 'mandatory', false, 'connection_id', v_id,
    'dedupe_key', 'job_invitation:' || v_id));
  return v_id;
end;
$$;

revoke all on function public.invite_to_job(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.invite_to_job(uuid, uuid, text) to authenticated;

-- Status (AC7) ------------------------------------------------------------------------------------------------------------

-- Moves p_connection from status to p_to with one audit row connection.status_changed {from, to}; nothing when it is not in
-- status sent any more (a second answer at the same time).
create function private.change_connection_status(p_connection uuid, p_to public.connection_status) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.connection_kind;
  v_org uuid;
begin
  update public.connections c set status = p_to, status_changed_at = now()
  where c.id = p_connection and c.status = 'sent'
  returning c.kind, c.from_organization_id into v_kind, v_org;
  if not found then
    return false;
  end if;
  perform audit.record('connection.status_changed', 'connection', p_connection::text, jsonb_build_object(
    'kind', v_kind, 'organization_id', v_org, 'from', 'sent', 'to', p_to));
  return true;
end;
$$;

revoke all on function private.change_connection_status(uuid, public.connection_status)
  from public, anon, authenticated, service_role;

-- The receiving side's answer to p_connection (SOP step Track): 'declined' while it is sent. The sender's side and every
-- other status, CHARA_INVALID_TRANSITION (answered, accepted follow the reply, the response and the application);
-- CHARA_INVALID_INPUT p_status for a value that is no status; CHARA_NOT_FOUND while release_messaging is off; a caller who
-- is no party, or an unknown id, CHARA_FORBIDDEN; aal2_required for an owner or admin at aal1. A declined workforce
-- request also declines its invitation while that is still waiting.
create function public.set_connection_status(p_connection uuid, p_status text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.connection_caller();
  v_row public.connections;
  v_recipient boolean;
begin
  select * into v_row from public.connections c
  where c.id = p_connection
    and (c.to_user_id = v_uid or private.is_org_member(c.to_organization_id) or private.is_org_member(c.from_organization_id))
  for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('sent', 'answered', 'accepted', 'declined') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_status', errcode = '22023';
  end if;
  perform private.assert_member_aal2(v_row.to_organization_id);
  perform private.assert_member_aal2(v_row.from_organization_id);
  v_recipient := v_row.to_user_id is not distinct from v_uid or coalesce(private.is_org_member(v_row.to_organization_id), false);
  if not v_recipient or p_status <> 'declined' or v_row.status <> 'sent' then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = v_row.status::text || ' to ' || p_status;
  end if;
  perform private.count_audited_write(v_row.to_organization_id);
  perform private.change_connection_status(v_row.id, 'declined');
  if v_row.kind = 'request_workforce' then
    update public.requirement_invitations i set status = 'declined', answered_at = now()
    where i.requirement_id = v_row.requirement_id and i.organization_id = v_row.to_organization_id
      and i.status in ('invited', 'viewed');
  end if;
end;
$$;

revoke all on function public.set_connection_status(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_connection_status(uuid, text) to authenticated;

-- An inquiry is answered at the first text message of the partner in its conversation.
create function private.messages_answer_inquiry() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.change_connection_status(c.id, 'answered')
  from public.connections c
  where c.conversation_id = new.conversation_id and c.kind = 'inquiry' and c.status = 'sent'
    and c.to_organization_id = new.sender_organization_id;
  return null;
end;
$$;

revoke all on function private.messages_answer_inquiry() from public, anon, authenticated, service_role;

create trigger messages_answer_inquiry
  after insert on public.messages
  for each row when (new.kind = 'text' and new.sender_organization_id is not null)
  execute function private.messages_answer_inquiry();

-- A workforce request is accepted when the partner responds to its requirement (FR-O2).
create function private.partner_responses_accept_request() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.change_connection_status(c.id, 'accepted')
  from public.connections c
  where c.requirement_id = new.requirement_id and c.to_organization_id = new.organization_id
    and c.kind = 'request_workforce' and c.status = 'sent';
  return null;
end;
$$;

revoke all on function private.partner_responses_accept_request() from public, anon, authenticated, service_role;

create trigger partner_responses_accept_request
  after insert on public.partner_responses
  for each row execute function private.partner_responses_accept_request();

-- An invitation to apply is accepted when the worker applies to its vacancy (FR-D1), with the rules of a direct
-- application: apply_to_job itself is unchanged.
create function private.job_applications_accept_invitation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.change_connection_status(c.id, 'accepted')
  from public.connections c
  where c.to_user_id = new.worker_user_id and c.job_id = new.job_id and c.kind = 'invite_to_job' and c.status = 'sent';
  return null;
end;
$$;

revoke all on function private.job_applications_accept_invitation() from public, anon, authenticated, service_role;

create trigger job_applications_accept_invitation
  after insert on public.job_applications
  for each row execute function private.job_applications_accept_invitation();

-- Reading (AC5, AC10) ------------------------------------------------------------------------------------------------------

-- The connections of p_conversation with what each typed message's card shows (SOP step Track): the status both sides
-- read, whether the reader's side sent it, the vacancy of an invitation to apply (title, city, country, whether it still
-- takes applications) and the requirement of a workforce request (title, the occupation and quantity, destination,
-- start). Refusals as private.participant_conversation, CHARA_NOT_FOUND while release_messaging is off.
create function public.list_conversation_connections(p_conversation uuid)
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
  order by c.created_at desc, c.id
  limit 100;
end;
$$;

revoke all on function public.list_conversation_connections(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_conversation_connections(uuid) to authenticated;

-- The open inquiry of p_org to p_partner and its conversation, for the page that points a second inquiry to the first
-- (AC2). Any member of p_org; nothing for anyone else.
create function public.open_inquiry(p_org uuid, p_partner uuid) returns table (connection_id uuid, conversation_id uuid)
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
  where c.from_organization_id = p_org and c.to_organization_id = p_partner and c.kind = 'inquiry' and c.status = 'sent'
  order by c.created_at desc
  limit 1;
end;
$$;

revoke all on function public.open_inquiry(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.open_inquiry(uuid, uuid) to authenticated;

-- Conversations (decision 5.1) ----------------------------------------------------------------------------------------------

-- private.conversation_context_parties of 20270210100000_contact_requests.sql with the branch of an inquiry (the hook V63
-- left): the employer and the partner of the first inquiry of the pair, whose conversation every later inquiry joins.
create or replace function private.conversation_context_parties(p_type public.conversation_context, p_id uuid)
returns table (employer_id uuid, partner_id uuid, worker_user_id uuid, requirement_id uuid, allows_contact boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.organization_id, null::uuid, a.worker_user_id, null::uuid,
    a.status <> 'withdrawn' and exists (select 1 from public.profiles u where u.id = a.worker_user_id and u.deleted_at is null)
  from public.job_applications a
  where p_type = 'application' and a.id = p_id
  union all
  select s.employer_organization_id, null, s.worker_user_id, s.requirement_id,
    s.status <> 'withdrawn'
      and exists (select 1 from public.profiles u where u.id = s.worker_user_id and u.deleted_at is null)
  from public.candidate_submissions s
  where p_type = 'candidate_submission' and s.id = p_id and s.worker_approved_at is not null
  union all
  select i.employer_organization_id, i.organization_id, null, i.requirement_id, i.status in ('accepted', 'responded')
  from public.requirement_invitations i
  where p_type = 'requirement_invitation' and i.id = p_id
  union all
  select r.employer_organization_id, r.organization_id, null, r.requirement_id, r.status <> 'withdrawn'
  from public.partner_responses r
  where p_type = 'partner_response' and r.id = p_id
  union all
  select c.organization_id, null, c.worker_user_id, null,
    exists (select 1 from public.profiles u where u.id = c.worker_user_id and u.deleted_at is null)
  from public.contact_requests c
  where p_type = 'contact_request' and c.id = p_id and c.status = 'accepted'
  union all
  select k.from_organization_id, k.to_organization_id, null, null, true
  from public.connections k
  where p_type = 'inquiry' and k.id = p_id and k.kind = 'inquiry'
$$;

revoke all on function private.conversation_context_parties(public.conversation_context, uuid)
  from public, anon, authenticated, service_role;

-- private.conversation_labels of 20270210100000_contact_requests.sql with the branch of an inquiry: each organisation names
-- the other by display name (the employer chose to contact the partner, so nothing hides it); no context title.
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
  -- V71: the two organisations of an inquiry.
  if p_conversation.context_type = 'inquiry' then
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

-- Notices (FR-T1, AC11) ----------------------------------------------------------------------------------------------------

insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types, release_key) values
  ('inquiry_received', false, true, 'company', 'Inquiries from employers', null, 'release_messaging'),
  ('workforce_request_received', false, true, 'company', 'Workforce requests from employers', null, 'release_messaging'),
  ('job_invitation', false, true, 'worker', 'Invitations to apply', null, 'release_messaging');

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon', 'job_order_match', 'invitation_received',
  'invitation_withdrawn', 'requirement_changed', 'requirement_closed', 'response_received', 'response_withdrawn',
  'response_decided', 'submission_request', 'submission_request_signup', 'submission_approved', 'submission_withdrawn',
  'submission_stage_changed', 'new_message', 'visibility_confirmation', 'contact_request_received', 'contact_request_decided',
  'inquiry_received', 'workforce_request_received', 'job_invitation'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- notification_payload_core of 20270210100000_contact_requests.sql with the branches of the three connection kinds.
-- The wrapper private.notification_payload of V67 keeps answering new_message.
create or replace function private.notification_payload_core(p_kind text, p_message jsonb) returns jsonb
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
    -- V68: to the worker, the end of the answer period of the yearly confirmation only; the card, the name and the
    -- consent stay out (NFR-S9).
    when 'visibility_confirmation' then jsonb_build_object('respond_by', p_message -> 'respond_by')
    -- V70: to the worker, the organisation that asks (display name, type, based-in country) and the vacancy offered, never
    -- the message or the member who sent it; to the organisation, the answer and the slug for the link, never the worker's
    -- name or anything of the passport (NFR-S9).
    when 'contact_request_received' then coalesce((
      select jsonb_build_object('contact_request_id', r.id, 'org_name', o.display_name, 'org_type', o.type,
        'country_code', o.based_in_country, 'country_name', c.name, 'job_title', j.title)
      from public.contact_requests r
      join public.organizations o on o.id = r.organization_id
      left join public.countries c on c.code = o.based_in_country
      left join public.jobs j on j.id = r.job_id
      where r.id = (p_message ->> 'contact_request_id')::uuid), '{}'::jsonb)
    when 'contact_request_decided' then coalesce((
      select jsonb_build_object('contact_request_id', r.id, 'decision', p_message ->> 'decision', 'org_slug', v_slug)
      from public.contact_requests r
      where r.id = (p_message ->> 'contact_request_id')::uuid
        and p_message ->> 'decision' in ('accepted', 'declined')), '{}'::jsonb)
    -- V71: to the partner's owners and admins, the employer that asks by display name, the conversation for the link and,
    -- for a workforce request, the occupation, quantity, destination and start; never the body (FR-P2 AC11). The slug is
    -- the recipient's own.
    when 'inquiry_received' then coalesce((
      select jsonb_build_object('connection_id', c.id, 'conversation_id', c.conversation_id, 'org_name', o.display_name,
        'org_slug', v_slug)
      from public.connections c join public.organizations o on o.id = c.from_organization_id
      where c.id = (p_message ->> 'connection_id')::uuid and c.kind = 'inquiry'), '{}'::jsonb)
    when 'workforce_request_received' then coalesce((
      select jsonb_build_object('connection_id', c.id, 'conversation_id', c.conversation_id, 'org_name', o.display_name,
        'requirement_id', r.id, 'occupation', oc.label, 'quantity', r.workers_needed, 'country_code', r.country_code,
        'country_name', n.name, 'start_date', r.start_date, 'org_slug', v_slug)
      from public.connections c
      join public.organizations o on o.id = c.from_organization_id
      join public.workforce_requirements r on r.id = c.requirement_id
      join public.countries n on n.code = r.country_code
      left join lateral (
        select x.occupation_id from public.requirement_occupations x where x.requirement_id = r.id
        order by x.quantity desc, x.occupation_id limit 1
      ) q on true
      left join public.occupations oc on oc.code = q.occupation_id
      where c.id = (p_message ->> 'connection_id')::uuid and c.kind = 'request_workforce'), '{}'::jsonb)
    -- V71: to the worker, the organisation that invites and the vacancy (title, city, country); never the body or the member.
    when 'job_invitation' then coalesce((
      select jsonb_build_object('connection_id', c.id, 'conversation_id', c.conversation_id, 'org_name', o.display_name,
        'job_id', j.id, 'job_title', j.title, 'city', j.city, 'country_code', j.country_code, 'country_name', n.name)
      from public.connections c
      join public.organizations o on o.id = c.from_organization_id
      join public.jobs j on j.id = c.job_id
      left join public.countries n on n.code = j.country_code
      where c.id = (p_message ->> 'connection_id')::uuid and c.kind = 'invite_to_job'), '{}'::jsonb)
    else '{}'::jsonb
  end);
end;

$$;
