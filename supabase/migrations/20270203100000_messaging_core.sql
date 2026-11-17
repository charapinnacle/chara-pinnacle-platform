-- Conversations and messages, data (FR-P1, SOP P2-26; decisions 5.1, 5.2; NFR-S8, NFR-S10, NFR-O5;
-- docs/phase-2/DATA_MODEL.md sections 5, 6, 7 and 10; release 2c).
--
-- A conversation belongs to one context of decision 5.1 and is opened once per context (open_conversation): an
-- application (the employer and the candidate), an approved candidate submission (the employer and the candidate), an
-- accepted or answered invitation to a requirement and a partner response (the employer and the partner company). The
-- contexts contact_request (V70) and inquiry (V71) are in the enum but open nothing until their units add them to
-- private.conversation_context_parties. Each side is one conversation_participants row: an organisation, whose members
-- share the conversation (every role; owners and admins at aal2, as for applicant data), or the candidate's account.
--
-- Messages are plain text of 1 to message_body_max_chars characters (setting, at most 4,000), trimmed, with no control
-- character other than line feed and tab; nothing renders them here, and the body never reaches audit.log. Sending stops
-- while a participating organisation is suspended (org_suspended) and for good once the context ends contact: the
-- candidate withdrew the application or the submission, or the candidate's account is gone (context_closed); the history
-- stays readable. Read state is per user (conversation_reads); a message of the reader's own side is never unread.
--
-- Nobody but the participants reads anything: no staff role, no other tenant, nobody anonymous. Every function refuses to
-- run while release_messaging is false. Not here: Realtime (V64), pages (V65), the monthly limit, the throttle, blocks and
-- reports (V66, workers are never limited), message emails (V67), retention, erasure and export (V74).

insert into private.settings (key, value) values ('message_body_max_chars', '4000') on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('message_body_max_chars', 'integer', 1, 4000, 'Most characters in one message', null);

-- The contexts and kinds of DATA_MODEL.md section 5. Only text is sent here; the typed kinds come with V71.
create type public.conversation_context as enum (
  'application', 'contact_request', 'candidate_submission', 'requirement_invitation', 'partner_response', 'inquiry'
);
create type public.message_kind as enum ('text', 'inquiry', 'request_workforce', 'invite_to_job', 'submit_candidate');

-- The tables ------------------------------------------------------------------------------------------------------------------

-- context_id carries no foreign key: it names a row of a different table for each context type. last_message_at is the
-- time of the last message, or of the opening while there is none, so the list orders and retention ages on one column.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  context_type public.conversation_context not null,
  context_id uuid not null,
  requirement_id uuid references public.workforce_requirements (id) on delete set null,
  opened_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint conversations_context_key unique (context_type, context_id)
);

comment on table public.conversations is
  'One conversation per context of decision 5.1 (FR-P1). Written only by the messaging functions; its participants read it.';
comment on column public.conversations.opened_by is
  'The user who opened the conversation. Not readable through the Data API.';
comment on column public.conversations.last_message_at is
  'The time of the last message, or of the opening while there is none: the order of the conversation list and the age for retention (V74).';

create index conversations_last_message_idx on public.conversations (last_message_at desc, id desc);
create index conversations_requirement_idx on public.conversations (requirement_id) where requirement_id is not null;
create index conversations_opened_by_idx on public.conversations (opened_by) where opened_by is not null;

create table public.conversation_participants (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint conversation_participants_one_party check (num_nonnulls(organization_id, user_id) = 1),
  constraint conversation_participants_organization_key unique (conversation_id, organization_id),
  constraint conversation_participants_user_key unique (conversation_id, user_id)
);

comment on table public.conversation_participants is
  'The two sides of a conversation: an organisation, whose members share it, or a candidate''s account. Written only by open_conversation; the candidate''s user id is not readable through the Data API.';

-- The policies' lookups by organisation and by user; the unique keys serve the lookups by conversation.
create index conversation_participants_organization_idx on public.conversation_participants (organization_id, conversation_id)
  where organization_id is not null;
create index conversation_participants_user_idx on public.conversation_participants (user_id, conversation_id)
  where user_id is not null;

-- sender_user_id is cleared with the profile: the message stays with its side (sender_organization_id, null for the
-- candidate), shown as from a former member or a deleted user.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_user_id uuid references public.profiles (id) on delete set null,
  sender_organization_id uuid references public.organizations (id) on delete cascade,
  kind public.message_kind not null default 'text',
  body text not null check (
    body = btrim(body, E' \t\n') and char_length(body) between 1 and 4000 and body !~ '[\x01-\x08\x0b-\x1f\x7f]'
  ),
  created_at timestamptz not null default now()
);

comment on table public.messages is
  'A plain-text message of a conversation (FR-P1, decision 5.2). Written only by send_message; the participants read it. The body never reaches audit.log, logs or notification payloads; the sender''s user id is not readable through the Data API.';

create index messages_conversation_idx on public.messages (conversation_id, created_at desc, id desc);
create index messages_sender_user_idx on public.messages (sender_user_id) where sender_user_id is not null;
create index messages_sender_organization_idx on public.messages (sender_organization_id, created_at)
  where sender_organization_id is not null;

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (conversation_id, user_id)
);

comment on table public.conversation_reads is
  'When a user last read a conversation (FR-P1 AC7): per user, not per organisation. Written only by mark_conversation_read; each user reads the own rows.';

create index conversation_reads_user_idx on public.conversation_reads (user_id);

-- Who reads what -------------------------------------------------------------------------------------------------------------

-- The organisations whose conversations the caller shares: every accepted membership, an owner's or admin's only at aal2
-- (as applicant data, D79). A suspended organisation's members keep reading its history.
create function private.messaging_org_ids() returns setof uuid
language sql
stable
security definer
rows 5
set search_path = ''
as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = (select auth.uid()) and m.accepted_at is not null
    and (m.role = 'member' or private.is_aal2())
$$;

revoke all on function private.messaging_org_ids() from public, anon, authenticated, service_role;
grant execute on function private.messaging_org_ids() to authenticated;

-- The conversations the caller takes part in, as the candidate or through an organisation of private.messaging_org_ids.
-- A member removed from the organisation loses them at once (FR-P1 AC5).
create function private.accessible_conversation_ids() returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.conversation_id from public.conversation_participants p where p.user_id = (select auth.uid())
  union
  select p.conversation_id from public.conversation_participants p
  where p.organization_id in (select private.messaging_org_ids())
$$;

revoke all on function private.accessible_conversation_ids() from public, anon, authenticated, service_role;
grant execute on function private.accessible_conversation_ids() to authenticated;

create function private.can_access_conversation(p_conversation uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.accessible_conversation_ids() c where c = p_conversation)
$$;

revoke all on function private.can_access_conversation(uuid) from public, anon, authenticated, service_role;
grant execute on function private.can_access_conversation(uuid) to authenticated;

alter table public.conversations enable row level security;
alter table public.conversations force row level security;
revoke all on table public.conversations from public, anon, authenticated, service_role;
grant select (id, context_type, context_id, requirement_id, created_at, last_message_at) on public.conversations to authenticated;

create policy conversations_select on public.conversations
  for select to authenticated
  using (id in (select private.accessible_conversation_ids()));

alter table public.conversation_participants enable row level security;
alter table public.conversation_participants force row level security;
revoke all on table public.conversation_participants from public, anon, authenticated, service_role;
grant select (id, conversation_id, organization_id, created_at) on public.conversation_participants to authenticated;

create policy conversation_participants_select on public.conversation_participants
  for select to authenticated
  using (conversation_id in (select private.accessible_conversation_ids()));

alter table public.messages enable row level security;
alter table public.messages force row level security;
revoke all on table public.messages from public, anon, authenticated, service_role;
grant select (id, conversation_id, sender_organization_id, kind, body, created_at) on public.messages to authenticated;

create policy messages_select on public.messages
  for select to authenticated
  using (conversation_id in (select private.accessible_conversation_ids()));

alter table public.conversation_reads enable row level security;
alter table public.conversation_reads force row level security;
revoke all on table public.conversation_reads from public, anon, authenticated, service_role;
grant select (conversation_id, user_id, last_read_at) on public.conversation_reads to authenticated;

create policy conversation_reads_select on public.conversation_reads
  for select to authenticated
  using (user_id = (select auth.uid()));

-- The contact rules of decision 5.1 ---------------------------------------------------------------------------------------------

-- The parties of the context p_type p_id: the employer (employer_id), the partner company of an invitation or a response
-- (partner_id) or the candidate (worker_user_id), the requirement, and whether the context allows a conversation to be
-- opened now: an application or an approved submission not withdrawn, whose candidate still has an account; an
-- invitation the partner accepted or answered with a response; a response not withdrawn. No row for an unknown context,
-- nor for a submission the candidate has not approved (nothing of it reaches the employer before, FR-O4).
-- V70 adds contact_request (an accepted request: the organisation and the worker) and V71 inquiry here.
create function private.conversation_context_parties(p_type public.conversation_context, p_id uuid)
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
$$;

revoke all on function private.conversation_context_parties(public.conversation_context, uuid)
  from public, anon, authenticated, service_role;

-- Why nobody may send in p_conversation now, or null: a participating organisation is suspended (org_suspended, until it
-- is reinstated); the candidate withdrew the application or the submission, or the candidate's account is gone
-- (context_closed, for good). A closed requirement, an expired or withdrawn invitation or a decided response ends nothing
-- (FR-P1 AC6).
create function private.conversation_closed_reason(p_conversation public.conversations) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.conversation_participants p join public.organizations o on o.id = p.organization_id
      where p.conversation_id = p_conversation.id and o.status <> 'active'
    ) then 'org_suspended'
    when p_conversation.context_type in ('application', 'candidate_submission') and (
      not exists (
        select 1 from public.conversation_participants p
        join public.profiles u on u.id = p.user_id and u.deleted_at is null
        where p.conversation_id = p_conversation.id
      )
      or exists (
        select 1 from public.job_applications a
        where p_conversation.context_type = 'application' and a.id = p_conversation.context_id and a.status = 'withdrawn'
      )
      or exists (
        select 1 from public.candidate_submissions s
        where p_conversation.context_type = 'candidate_submission' and s.id = p_conversation.context_id
          and s.status = 'withdrawn'
      )
    ) then 'context_closed'
  end
$$;

revoke all on function private.conversation_closed_reason(public.conversations) from public, anon, authenticated, service_role;

-- The caller's side of p_conversation: the organisation through which the caller takes part, or null for the candidate.
-- Answers nothing when the caller takes no part.
create function private.conversation_side(p_conversation uuid) returns table (organization_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id from public.conversation_participants p
  where p.conversation_id = p_conversation
    and (p.user_id = (select auth.uid()) or p.organization_id in (select private.messaging_org_ids()))
  order by p.organization_id nulls first
  limit 1
$$;

revoke all on function private.conversation_side(uuid) from public, anon, authenticated, service_role;

-- A signed-in caller while release_messaging is on, answered with the user id; CHARA_FORBIDDEN otherwise.
create function private.messaging_caller() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_messaging') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  return v_uid;
end;
$$;

revoke all on function private.messaging_caller() from public, anon, authenticated, service_role;

-- p_conversation for a caller who takes part in it, locked for update when p_lock. An owner or admin at aal1 of a
-- participating organisation, CHARA_FORBIDDEN aal2_required; anybody else who takes no part, and an unknown id,
-- CHARA_FORBIDDEN without detail (FR-P1 AC4). The caller's side is private.conversation_side.
create function private.participant_conversation(p_conversation uuid, p_lock boolean default false)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.conversations;
begin
  perform private.assert_member_aal2(p.organization_id)
  from public.conversation_participants p
  where p.conversation_id = p_conversation and p.organization_id is not null;
  if not private.can_access_conversation(p_conversation) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if p_lock then
    select * into v_row from public.conversations c where c.id = p_conversation for update;
  else
    select * into v_row from public.conversations c where c.id = p_conversation;
  end if;
  return v_row;
end;
$$;

revoke all on function private.participant_conversation(uuid, boolean) from public, anon, authenticated, service_role;

-- The messages of p_conversation the side p_side has not read for the caller: those of the other side created after the
-- caller's last read (FR-P1 AC7). A message of the own side, the caller's or another member's, is never unread.
create function private.conversation_unread(p_conversation uuid, p_side uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.messages m
  where m.conversation_id = p_conversation
    and m.created_at > coalesce(
      (select r.last_read_at from public.conversation_reads r
       where r.conversation_id = p_conversation and r.user_id = (select auth.uid())),
      '-infinity')
    and case when p_side is null then m.sender_organization_id is not null
             else m.sender_organization_id is distinct from p_side end
$$;

revoke all on function private.conversation_unread(uuid, uuid) from public, anon, authenticated, service_role;

-- How the side p_side (null for the candidate) sees p_conversation: the other party and the context, never a member's
-- address or a legal name (FR-P1 AC11). The candidate is named from the snapshot of the application or the submission,
-- an organisation by its display name; the employer of a requirement is named to a partner only where the job order
-- functions name it (private.requirement_named_to), and the partner then reads the generated title (NFR-S11); the
-- candidate of a submission reads the employer and its title only when the requirement shows the employer's identity.
create function private.conversation_labels(p_conversation public.conversations, p_side uuid)
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

-- Opening ----------------------------------------------------------------------------------------------------------------------

-- The conversation of the context p_context_type p_context_id, opened by a party to it (FR-P1 AC1, AC2; SOP step Open):
-- the candidate of the context or an accepted member (any role) of a participating organisation. Refusals, each writing
-- nothing: no session or release_messaging off, CHARA_FORBIDDEN (release_off); an unknown context, a context type no unit
-- opens yet (contact_request, inquiry), or a caller who is no party to it, CHARA_FORBIDDEN without detail; an owner or
-- admin at aal1, CHARA_FORBIDDEN aal2_required. A conversation that exists is answered as it is, however the context
-- stands now. Otherwise: a context that does not allow contact (above), CHARA_FORBIDDEN context_closed; a participating
-- organisation suspended, CHARA_FORBIDDEN org_suspended; the daily quota of audited writes, CHARA_RATE_LIMITED. Writes the
-- conversation, its two participants and one audit row conversation.opened (context type and id, never a message). Calls
-- at the same time for one context get the one conversation: the unique key makes the later insert wait and do nothing.
create function public.open_conversation(p_context_type public.conversation_context, p_context_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.messaging_caller();
  v_party record;
  v_id uuid;
  v_side uuid;
begin
  select * into v_party from private.conversation_context_parties(p_context_type, p_context_id);
  if not found
     or not (v_party.worker_user_id is not distinct from v_uid
             or private.is_org_member(v_party.employer_id) or private.is_org_member(v_party.partner_id)) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  perform private.assert_member_aal2(v_party.employer_id);
  perform private.assert_member_aal2(v_party.partner_id);

  select c.id into v_id from public.conversations c
  where c.context_type = p_context_type and c.context_id = p_context_id;
  if found then
    return v_id;
  end if;

  if not v_party.allows_contact then
    raise exception 'CHARA_FORBIDDEN' using detail = 'context_closed', errcode = '42501';
  end if;
  if exists (
    select 1 from public.organizations o where o.id in (v_party.employer_id, v_party.partner_id) and o.status <> 'active'
  ) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'org_suspended', errcode = '42501';
  end if;

  v_side := case when v_party.worker_user_id is not distinct from v_uid then null
                 when private.is_org_member(v_party.employer_id) then v_party.employer_id
                 else v_party.partner_id end;
  perform private.count_audited_write(v_side);

  insert into public.conversations (context_type, context_id, requirement_id, opened_by)
  values (p_context_type, p_context_id, v_party.requirement_id, v_uid)
  on conflict (context_type, context_id) do nothing
  returning id into v_id;
  if v_id is null then
    select c.id into v_id from public.conversations c
    where c.context_type = p_context_type and c.context_id = p_context_id;
    return v_id;
  end if;

  insert into public.conversation_participants (conversation_id, organization_id, user_id)
  values (v_id, v_party.employer_id, null),
         (v_id, v_party.partner_id, v_party.worker_user_id);
  perform audit.record('conversation.opened', 'conversations', v_id::text, jsonb_strip_nulls(jsonb_build_object(
    'context_type', p_context_type, 'context_id', p_context_id, 'requirement_id', v_party.requirement_id,
    'organization_id', v_side)));
  return v_id;
end;
$$;

revoke all on function public.open_conversation(public.conversation_context, uuid) from public, anon, authenticated, service_role;
grant execute on function public.open_conversation(public.conversation_context, uuid) to authenticated;

-- Sending and reading ----------------------------------------------------------------------------------------------------------

-- A text message from the caller in p_conversation (FR-P1 AC3, AC4, AC6; SOP steps Allow and Send). The body is taken
-- with CR LF as line feed and trimmed of spaces, tabs and line feeds at both ends. Refusals, each storing nothing:
-- private.participant_conversation; a body empty after trimming, longer than message_body_max_chars or with a control
-- character other than line feed and tab, CHARA_INVALID_INPUT p_body (a missing setting, CHARA_SETTING_MISSING); a
-- conversation closed for messages, CHARA_FORBIDDEN with private.conversation_closed_reason. The conversation is locked,
-- so its messages take the order they are stored in. A member sends for the organisation, the candidate for nobody
-- else. Not audited: the body never reaches audit.log, and the message is its own record.
create function public.send_message(p_conversation uuid, p_body text)
returns table (id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.messaging_caller();
  v_max integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'message_body_max_chars');
  v_row public.conversations;
  v_side uuid;
  v_reason text;
  v_body text := btrim(replace(p_body, E'\r\n', E'\n'), E' \t\n');
  v_id uuid;
  v_at timestamptz := clock_timestamp();
begin
  v_row := private.participant_conversation(p_conversation, true);
  v_side := (select s.organization_id from private.conversation_side(p_conversation) s);
  if v_max is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'message_body_max_chars';
  end if;
  if v_body is null or char_length(v_body) not between 1 and v_max or v_body ~ '[\x01-\x08\x0b-\x1f\x7f]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_body', errcode = '22023';
  end if;
  v_reason := private.conversation_closed_reason(v_row);
  if v_reason is not null then
    raise exception 'CHARA_FORBIDDEN' using detail = v_reason, errcode = '42501';
  end if;

  insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body, created_at)
  values (v_row.id, v_uid, v_side, v_body, v_at)
  returning messages.id into v_id;
  update public.conversations c set last_message_at = v_at where c.id = v_row.id;
  return query select v_id, v_at;
end;
$$;

revoke all on function public.send_message(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.send_message(uuid, text) to authenticated;

-- Marks p_conversation read for the caller up to now (FR-P1 AC7, SOP step Read) and answers the time; the other members
-- of the organisation keep their own state. Refusals as private.participant_conversation; a closed conversation is
-- still read.
create function public.mark_conversation_read(p_conversation uuid) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.messaging_caller();
  v_at timestamptz := clock_timestamp();
begin
  perform private.participant_conversation(p_conversation);
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation, v_uid, v_at)
  on conflict (conversation_id, user_id) do update set last_read_at = greatest(conversation_reads.last_read_at, excluded.last_read_at);
  return v_at;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- The caller's unread messages per conversation, the side (organisation, null for the candidate) and the count, only
-- where there is one (FR-P1 AC7, the badges of FR-P4). An owner or admin at aal1 counts only the conversations of the
-- organisations where the caller is a plain member, as private.messaging_org_ids.
create function public.my_unread_counts() returns table (conversation_id uuid, organization_id uuid, unread integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.messaging_caller();
  return query
  select p.conversation_id, p.organization_id, private.conversation_unread(p.conversation_id, p.organization_id)
  from public.conversation_participants p
  where (p.user_id = (select auth.uid()) or p.organization_id in (select private.messaging_org_ids()))
    and private.conversation_unread(p.conversation_id, p.organization_id) > 0
  order by p.conversation_id;
end;
$$;

revoke all on function public.my_unread_counts() from public, anon, authenticated, service_role;
grant execute on function public.my_unread_counts() to authenticated;

-- The conversations of the organisation p_org, or the caller's own as a candidate when p_org is null, latest message
-- first, keyset (p_before_at, p_before_id) over (last_message_at, id), p_limit 1 to 50 (20). Each row names the other
-- party and the context as private.conversation_labels, the caller's unread count and why it is closed for messages, if
-- it is. Refusals: private.messaging_caller; p_limit out of range, CHARA_INVALID_INPUT p_limit; a p_org the caller is no
-- accepted member of, CHARA_FORBIDDEN; an owner or admin of p_org at aal1, CHARA_FORBIDDEN aal2_required.
create function public.list_conversations(
  p_org uuid default null, p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 20
)
returns table (
  id uuid, context_type public.conversation_context, context_id uuid, requirement_id uuid, organization_id uuid,
  counterpart_kind text, counterpart_name text, context_title text, last_message_at timestamptz, unread integer,
  read_only_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.messaging_caller();
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_limit', errcode = '22023';
  end if;
  if p_org is not null then
    if not private.is_org_member(p_org) then
      raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
    end if;
    perform private.assert_member_aal2(p_org);
  end if;
  return query
  select c.id, c.context_type, c.context_id, c.requirement_id, p.organization_id, l.counterpart_kind, l.counterpart_name,
    l.context_title, c.last_message_at, private.conversation_unread(c.id, p.organization_id),
    private.conversation_closed_reason(c)
  from public.conversation_participants p
  join public.conversations c on c.id = p.conversation_id
  cross join lateral private.conversation_labels(c, p.organization_id) l
  where (case when p_org is null then p.user_id = v_uid else p.organization_id = p_org end)
    and (p_before_at is null or (c.last_message_at, c.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff')))
  order by c.last_message_at desc, c.id desc
  limit p_limit;
end;
$$;

revoke all on function public.list_conversations(uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_conversations(uuid, timestamptz, uuid, integer) to authenticated;

-- One conversation as list_conversations shows it, from the caller's side: the header of the thread (FR-P1 AC11).
-- Refusals as private.participant_conversation.
create function public.get_conversation(p_conversation uuid)
returns table (
  id uuid, context_type public.conversation_context, context_id uuid, requirement_id uuid, organization_id uuid,
  counterpart_kind text, counterpart_name text, context_title text, last_message_at timestamptz, unread integer,
  read_only_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.conversations;
  v_side uuid;
begin
  perform private.messaging_caller();
  v_row := private.participant_conversation(p_conversation);
  v_side := (select s.organization_id from private.conversation_side(p_conversation) s);
  return query
  select v_row.id, v_row.context_type, v_row.context_id, v_row.requirement_id, v_side, l.counterpart_kind,
    l.counterpart_name, l.context_title, v_row.last_message_at, private.conversation_unread(v_row.id, v_side),
    private.conversation_closed_reason(v_row)
  from private.conversation_labels(v_row, v_side) l;
end;
$$;

revoke all on function public.get_conversation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_conversation(uuid) to authenticated;

-- The messages of p_conversation, newest first, keyset (p_before_at, p_before_id) over (created_at, id), p_limit 1 to 100
-- (50). Each with whether the caller sent it, the side (organization or worker) and how the caller names the sender: a
-- member of an organisation by display name, also after leaving it (FR-P1 AC5), the organisation by display name where
-- the caller may know it (as private.conversation_labels), the candidate as named to the organisation; sender_erased when
-- the sender's account is gone ("Former member", "Deleted user"). Refusals as private.participant_conversation and
-- CHARA_INVALID_INPUT p_limit.
create function public.list_messages(
  p_conversation uuid, p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 50
)
returns table (
  id uuid, kind public.message_kind, body text, created_at timestamptz, mine boolean, sender_kind text, sender_name text,
  sender_organization_name text, sender_erased boolean
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
    m.sender_user_id is null
  from public.messages m
  where m.conversation_id = v_row.id
    and (p_before_at is null or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff')))
  order by m.created_at desc, m.id desc
  limit p_limit;
end;
$$;

revoke all on function public.list_messages(uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_messages(uuid, timestamptz, uuid, integer) to authenticated;
