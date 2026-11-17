-- Message notifications (FR-P4, FR-T1 new_message; SOP P2-29 steps Wait, Email and Respect; NFR-A3, NFR-O5;
-- docs/phase-2/DATA_MODEL.md sections 5 and 9; release 2c). The unread badge reads my_unread_counts after the
-- messages_unread signal of V64; this migration adds the delayed email.
--
-- private.queue_message_emails(p_now), every minute: a recipient who has not read a message of the other side within
-- message_email_delay_minutes (setting, 5 to 1,440, 15) gets one new_message for the conversation, from the oldest unread
-- message after the last one emailed to that recipient, so one conversation makes at most one email per recipient and
-- window (FR-P4 AC3, AC4). The recipients are the candidate, or the owners and admins of the organisation and the members
-- who wrote in the conversation for it (FR-P4 AC7), with an active account and an active organisation (AC8); a blocked
-- conversation emails nobody. conversation_reads.last_emailed_at (per user, as last_read_at) is written in the
-- transaction that queues the message (NFR-A3). The payload names the conversation, the other party, the context and the
-- unread count, never a body (FR-P4 AC5, FR-T1 AC2). The preference is the per-kind switch of V02 (email_kinds
-- new_message), so the enqueue trigger keeps a suppressed in-app item for a recipient who turned it off (FR-T1 AC4, AC5).

insert into private.settings (key, value) values ('message_email_delay_minutes', '15') on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('message_email_delay_minutes', 'integer', 5, 1440, 'Minutes a message stays unread before its email', null);

insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types, release_key) values
  ('new_message', false, true, 'all', 'New messages', null, 'release_messaging');

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon', 'job_order_match', 'invitation_received',
  'invitation_withdrawn', 'requirement_changed', 'requirement_closed', 'response_received', 'response_withdrawn',
  'response_decided', 'submission_request', 'submission_request_signup', 'submission_approved', 'submission_withdrawn',
  'submission_stage_changed', 'new_message'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- A recipient who never opened the conversation gets a row when first emailed, so last_read_at may be empty; an empty
-- read time reads as never, as a missing row does.
alter table public.conversation_reads
  alter column last_read_at drop not null,
  add column last_emailed_at timestamptz;

comment on column public.conversation_reads.last_emailed_at is
  'When the user was last sent new_message for the conversation (FR-P4): the messages up to it are covered. Written only by private.queue_message_emails; not readable through the Data API.';

-- The trigger of 20270204100000 fires only for a read: the row the email job writes is no read.
drop trigger conversation_reads_broadcast on public.conversation_reads;
create trigger conversation_reads_broadcast after insert or update of last_read_at on public.conversation_reads
  for each row when (new.last_read_at is not null) execute function private.broadcast_conversation_read();

-- The payload of new_message, for the side the recipient takes part on (organization_id, null for the candidate): the
-- other party and the context as private.conversation_labels names them to that side, the unread count, and the slug of
-- the recipient's organisation for the link.
create function private.new_message_payload(p_message jsonb) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
      'conversation_id', c.id, 'context_type', c.context_type, 'sender_kind', l.counterpart_kind,
      'sender_name', l.counterpart_name, 'context_title', l.context_title,
      'unread', case when p_message ->> 'unread' ~ '^[0-9]{1,6}$' then (p_message ->> 'unread')::integer end,
      'org_slug', o.slug))
    from public.conversations c
    cross join lateral private.conversation_labels(c, (p_message ->> 'organization_id')::uuid) l
    left join public.organizations o on o.id = (p_message ->> 'organization_id')::uuid
    where c.id = (p_message ->> 'conversation_id')::uuid
  ), '{}'::jsonb)
$$;

revoke all on function private.new_message_payload(jsonb) from public, anon, authenticated, service_role;

-- new_message is added beside the function of the earlier units rather than by copying it, so a unit that changes another
-- branch of that function at the same time stays unaffected.
alter function private.notification_payload(text, jsonb) rename to notification_payload_core;

create function private.notification_payload(p_kind text, p_message jsonb) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_kind = 'new_message' then private.new_message_payload(p_message)
    else private.notification_payload_core(p_kind, p_message) end
$$;

revoke all on function private.notification_payload(text, jsonb) from public, anon, authenticated, service_role;

-- Queues new_message for every recipient whose oldest unread message of the other side, after the last one emailed to
-- the recipient, is at least message_email_delay_minutes old at p_now; answers the number queued. Nothing while
-- release_messaging is off; CHARA_SETTING_MISSING when the delay is missing. Conversations without a message in the day
-- before the delay are not looked at, so the job reads the recent conversations only. One run at a time.
create function private.queue_message_emails(p_now timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delay integer := (
    select case when s.value #>> '{}' ~ '^[0-9]{1,4}$' then (s.value #>> '{}')::integer end
    from private.settings s where s.key = 'message_email_delay_minutes');
  v_due timestamptz;
  v_messages jsonb[];
begin
  if v_delay is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'message_email_delay_minutes';
  end if;
  if not private.release_on('release_messaging') then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('queue_message_emails', 0));
  v_due := p_now - make_interval(mins => v_delay);

  with recent as (
    select c.id from public.conversations c
    where c.last_message_at > v_due - interval '1 day'
      and not exists (select 1 from public.conversation_blocks b where b.conversation_id = c.id)
  ),
  recipients as (
    select p.conversation_id, null::uuid as side, p.user_id
    from public.conversation_participants p
    where p.conversation_id in (select id from recent) and p.user_id is not null
    union
    select p.conversation_id, p.organization_id, m.user_id
    from public.conversation_participants p
    join public.organizations o on o.id = p.organization_id and o.status = 'active'
    join public.organization_members m on m.organization_id = p.organization_id and m.accepted_at is not null
    where p.conversation_id in (select id from recent)
      and (m.role in ('owner', 'admin') or exists (
        select 1 from public.messages w
        where w.conversation_id = p.conversation_id and w.sender_user_id = m.user_id
          and w.sender_organization_id = p.organization_id))
  ),
  pending as (
    select r.conversation_id, r.side, r.user_id, f.id as first_id,
      (select count(*) from public.messages x
       where x.conversation_id = r.conversation_id and x.created_at <= p_now
         and x.created_at > coalesce(cr.last_read_at, '-infinity')
         and case when r.side is null then x.sender_organization_id is not null
                  else x.sender_organization_id is distinct from r.side end) as unread
    from recipients r
    join public.profiles u on u.id = r.user_id and u.status = 'active' and u.deleted_at is null
    left join public.conversation_reads cr on cr.conversation_id = r.conversation_id and cr.user_id = r.user_id
    cross join lateral (
      select m.id, m.created_at from public.messages m
      where m.conversation_id = r.conversation_id and m.created_at <= p_now
        and m.created_at > coalesce(cr.last_read_at, '-infinity')
        and m.created_at > coalesce(cr.last_emailed_at, '-infinity')
        and case when r.side is null then m.sender_organization_id is not null
                 else m.sender_organization_id is distinct from r.side end
      order by m.created_at, m.id
      limit 1
    ) f
    where f.created_at <= v_due
  ),
  covered as (
    insert into public.conversation_reads (conversation_id, user_id, last_emailed_at)
    select distinct q.conversation_id, q.user_id, p_now from pending q
    on conflict (conversation_id, user_id) do update set last_emailed_at = excluded.last_emailed_at
  )
  select array_agg(jsonb_strip_nulls(jsonb_build_object(
           'kind', 'new_message', 'user_id', q.user_id, 'organization_id', q.side, 'conversation_id', q.conversation_id,
           'unread', q.unread, 'dedupe_key', 'new_message:' || q.conversation_id || ':' || q.first_id))
         order by q.conversation_id, q.user_id)
  into v_messages
  from pending q;

  if v_messages is null then
    return 0;
  end if;
  perform pgmq.send_batch('notifications', v_messages);
  return cardinality(v_messages);
end;
$$;

revoke all on function private.queue_message_emails(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('queue-message-emails', '* * * * *', 'select private.queue_message_emails()');
