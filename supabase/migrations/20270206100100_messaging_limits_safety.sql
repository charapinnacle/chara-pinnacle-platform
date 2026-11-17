-- Messaging limits and blocks (FR-P3 AC1 to AC5 and AC8, SOP P2-28 steps Limit, Throttle and Block; decision 5.3; NFR-A4,
-- NFR-S8, NFR-S10, NFR-O5; docs/phase-2/DATA_MODEL.md sections 2, 4, 6 and 8; V66, release 2c).
--
-- - The monthly limit messages_per_month of the organisation's plan: private.monthly_usage counts the messages its members
--   sent in the calendar month (UTC, as every monthly key), and send_message refuses the message past the limit with
--   CHARA_LIMIT_REACHED messages_per_month. The count and the write run under one advisory lock per organisation, so
--   members sending at the same time never pass the limit together. The candidate's side is never counted or limited.
-- - The throttle: every sender, the candidate too, is counted against rate_limit_message_max messages per
--   rate_limit_message_seconds (settings with the audited editor of V16); a refused message is stored and counted nowhere.
-- - Blocks: a participant blocks the conversation and nobody can send in it, on either side, until the same user unblocks
--   it. The other side reads that the conversation is closed for messages, never who closed it; no notice is sent.

insert into private.settings (key, value) values
  ('rate_limit_message_max', '20'),
  ('rate_limit_message_seconds', '60')
on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('rate_limit_message_max', 'integer', 1, 1000, 'Most messages one person may send in the throttle window', null),
  ('rate_limit_message_seconds', 'integer', 1, 3600, 'Seconds of the message throttle window', null);

-- Usage: the monthly key messages_per_month counts the organisation's messages -----------------------------------------------

-- private.monthly_usage of 20270103100000_candidate_submissions.sql with the messages counted: every message a member sent
-- for the organisation since the start of the calendar month in UTC. The candidate's messages have no organisation and
-- are never counted (decision 5.3).
create or replace function private.monthly_usage(p_org uuid, p_limit_key text) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null or not exists (select 1 from billing.limit_keys k where k.key = p_limit_key and k.period = 'month') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'limit_key', errcode = '22023';
  end if;
  if p_limit_key = 'job_order_responses_per_month' then
    return (select count(*)::integer from public.partner_responses p
            where p.organization_id = p_org and p.created_at >= private.month_start());
  end if;
  if p_limit_key = 'candidate_submissions_per_month' then
    return (select count(*)::integer from public.candidate_submissions s
            where s.organization_id = p_org and s.created_at >= private.month_start());
  end if;
  if p_limit_key = 'messages_per_month' then
    return (select count(*)::integer from public.messages m
            where m.sender_organization_id = p_org and m.created_at >= private.month_start());
  end if;
  return 0;
end;
$$;

-- Blocks ------------------------------------------------------------------------------------------------------------------

-- One block per conversation. blocked_by_user_id is the only user who may lift it; blocked_by_organization_id is the side
-- (null for the candidate). Neither is readable through the Data API: the participants learn that the conversation is
-- closed for messages, not who closed it.
create table public.conversation_blocks (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  blocked_by_user_id uuid not null references public.profiles (id) on delete cascade,
  blocked_by_organization_id uuid references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.conversation_blocks is
  'A conversation a participant blocked (FR-P3 AC8): nobody sends in it until the same user unblocks it. Written only by block_conversation and unblock_conversation; the participants read that it is blocked, not who blocked it.';

create index conversation_blocks_user_idx on public.conversation_blocks (blocked_by_user_id);
create index conversation_blocks_organization_idx on public.conversation_blocks (blocked_by_organization_id)
  where blocked_by_organization_id is not null;

alter table public.conversation_blocks enable row level security;
alter table public.conversation_blocks force row level security;
revoke all on table public.conversation_blocks from public, anon, authenticated, service_role;
grant select (conversation_id, created_at) on public.conversation_blocks to authenticated;

create policy conversation_blocks_select on public.conversation_blocks
  for select to authenticated
  using (conversation_id in (select private.accessible_conversation_ids()));

-- private.conversation_closed_reason of 20270203100000_messaging_core.sql with the block: a blocked conversation is closed
-- for messages (blocked) for both sides until the blocker unblocks it. A suspension or the end of the context is named
-- first, as unblocking does not lift it.
create or replace function private.conversation_closed_reason(p_conversation public.conversations) returns text
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
    when exists (select 1 from public.conversation_blocks b where b.conversation_id = p_conversation.id) then 'blocked'
  end
$$;

-- Blocks p_conversation for both sides (FR-P3 AC8, SOP step Block). Refusals as private.participant_conversation; a
-- conversation already blocked, by anyone, CHARA_INVALID_STATE blocked; the daily quota of audited writes,
-- CHARA_RATE_LIMITED. The conversation is locked, so a message in progress is stored first. One audit row
-- conversation.blocked with the blocker's side; no notice to the other side.
create function public.block_conversation(p_conversation uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.messaging_caller();
  v_row public.conversations;
  v_side uuid;
begin
  v_row := private.participant_conversation(p_conversation, true);
  v_side := (select s.organization_id from private.conversation_side(p_conversation) s);
  if exists (select 1 from public.conversation_blocks b where b.conversation_id = v_row.id) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'blocked';
  end if;
  perform private.count_audited_write(v_side);
  insert into public.conversation_blocks (conversation_id, blocked_by_user_id, blocked_by_organization_id)
  values (v_row.id, v_uid, v_side);
  perform audit.record('conversation.blocked', 'conversations', v_row.id::text,
    jsonb_strip_nulls(jsonb_build_object('organization_id', v_side, 'request_id', private.request_id())));
end;
$$;

revoke all on function public.block_conversation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.block_conversation(uuid) to authenticated;

-- Lifts the block of p_conversation (FR-P3 AC8). Only the user who blocked it: anyone else, a member of the same side too,
-- CHARA_FORBIDDEN; a conversation that is not blocked, CHARA_INVALID_STATE not_blocked. Refusals as
-- private.participant_conversation before that. One audit row conversation.unblocked.
create function public.unblock_conversation(p_conversation uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.messaging_caller();
  v_row public.conversations;
  v_block public.conversation_blocks;
begin
  v_row := private.participant_conversation(p_conversation, true);
  select * into v_block from public.conversation_blocks b where b.conversation_id = v_row.id;
  if not found then
    raise exception 'CHARA_INVALID_STATE' using detail = 'not_blocked';
  end if;
  if v_block.blocked_by_user_id <> v_uid then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.conversation_blocks b where b.conversation_id = v_row.id;
  perform audit.record('conversation.unblocked', 'conversations', v_row.id::text,
    jsonb_strip_nulls(jsonb_build_object('organization_id', v_block.blocked_by_organization_id, 'request_id', private.request_id())));
end;
$$;

revoke all on function public.unblock_conversation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.unblock_conversation(uuid) to authenticated;

-- Sending ------------------------------------------------------------------------------------------------------------------

-- send_message of 20270203100000_messaging_core.sql with the throttle and the monthly limit. After the checks of V63 (a
-- blocked conversation is now closed, CHARA_FORBIDDEN blocked): every sender is counted against the throttle
-- (CHARA_RATE_LIMITED; a missing setting, CHARA_SETTING_MISSING rate_limit_message); a member's message is counted
-- against the organisation's messages_per_month under the organisation's advisory lock (CHARA_LIMIT_REACHED
-- messages_per_month while entitlements are enforced or the organisation lapsed to a free plan; a plan without a limit
-- never refuses). The candidate is never counted against a plan (decision 5.3). A refused message is not stored.
create or replace function public.send_message(p_conversation uuid, p_body text)
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
  v_at timestamptz;
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

  perform private.check_rate_limit('message', v_uid);
  if v_side is not null then
    perform pg_advisory_xact_lock(hashtextextended('messages:' || v_side::text, 0));
    perform private.assert_within_limit(v_side, 'messages_per_month', private.monthly_usage(v_side, 'messages_per_month'));
  end if;

  -- Taken after the locks, so a message stored later never carries an earlier time than one counted before it.
  v_at := clock_timestamp();
  insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body, created_at)
  values (v_row.id, v_uid, v_side, v_body, v_at)
  returning messages.id into v_id;
  update public.conversations c set last_message_at = v_at where c.id = v_row.id;
  return query select v_id, v_at;
end;
$$;

-- get_conversation of 20270203100000_messaging_core.sql with blocked_by_me: whether the caller blocked the conversation
-- and so may unblock it. Nothing tells anyone else who blocked it.
drop function public.get_conversation(uuid);

create function public.get_conversation(p_conversation uuid)
returns table (
  id uuid, context_type public.conversation_context, context_id uuid, requirement_id uuid, organization_id uuid,
  counterpart_kind text, counterpart_name text, context_title text, last_message_at timestamptz, unread integer,
  read_only_reason text, blocked_by_me boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.messaging_caller();
  v_row public.conversations;
  v_side uuid;
begin
  v_row := private.participant_conversation(p_conversation);
  v_side := (select s.organization_id from private.conversation_side(p_conversation) s);
  return query
  select v_row.id, v_row.context_type, v_row.context_id, v_row.requirement_id, v_side, l.counterpart_kind,
    l.counterpart_name, l.context_title, v_row.last_message_at, private.conversation_unread(v_row.id, v_side),
    private.conversation_closed_reason(v_row),
    exists (select 1 from public.conversation_blocks b where b.conversation_id = v_row.id and b.blocked_by_user_id = v_uid)
  from private.conversation_labels(v_row, v_side) l;
end;
$$;

revoke all on function public.get_conversation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_conversation(uuid) to authenticated;
