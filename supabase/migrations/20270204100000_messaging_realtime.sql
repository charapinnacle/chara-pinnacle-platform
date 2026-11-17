-- Realtime for conversations (FR-P1 AC5, AC8; FR-P4 AC1 badge signal; NFR-P4; docs/phase-2/DATA_MODEL.md section 6,
-- Realtime; ARCHITECTURE.md section 2: Broadcast on private channels, no postgres_changes). The pattern of V02
-- (20261114100100_notification_realtime.sql): the database broadcasts with realtime.send on private topics, a policy on
-- realtime.messages decides who receives, and no policy lets a client send.
--
-- Broadcasts carry signals, never a body or a user id: realtime.messages keeps its rows for days outside the reach of
-- retention and erasure (V74), and a socket that joined before its member was removed keeps receiving until it rejoins.
-- The client answers a signal by reading through list_messages and my_unread_counts, whose checks run on every call.
--   conversation:<id>  message          {id, created_at}   after every new message
--   user:<id>          messages_unread  {conversation_id}  to each user of the other side after a new message, and to
--                                                          the reader after mark_conversation_read
-- Nothing is broadcast while release_messaging is off.

-- The users of p_conversation outside the side p_side (null for the candidate): the candidate of the conversation, or the
-- accepted members of a participating organisation; the users whose unread count a message of that side changes.
create function private.conversation_recipients(p_conversation uuid, p_side uuid) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id from public.conversation_participants p
  where p.conversation_id = p_conversation and p.user_id is not null and p_side is not null
  union
  select m.user_id
  from public.conversation_participants p
  join public.organization_members m on m.organization_id = p.organization_id and m.accepted_at is not null
  where p.conversation_id = p_conversation and p.organization_id is distinct from p_side
$$;

revoke all on function private.conversation_recipients(uuid, uuid) from public, anon, authenticated, service_role;

create function private.broadcast_new_message() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not private.release_on('release_messaging') then
    return null;
  end if;
  perform realtime.send(
    jsonb_build_object('id', new.id, 'created_at', new.created_at), 'message', 'conversation:' || new.conversation_id, true
  );
  for v_user in select r from private.conversation_recipients(new.conversation_id, new.sender_organization_id) r loop
    perform realtime.send(
      jsonb_build_object('conversation_id', new.conversation_id), 'messages_unread', 'user:' || v_user, true
    );
  end loop;
  return null;
end;
$$;

revoke all on function private.broadcast_new_message() from public, anon, authenticated, service_role;

create trigger messages_broadcast after insert on public.messages
  for each row execute function private.broadcast_new_message();

-- The reader's own topic only: the other tabs and devices of the reader update the badge. The other side learns nothing
-- of who read what, as nothing in FR-P1 shows read receipts.
create function private.broadcast_conversation_read() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.release_on('release_messaging') then
    return null;
  end if;
  perform realtime.send(
    jsonb_build_object('conversation_id', new.conversation_id), 'messages_unread', 'user:' || new.user_id, true
  );
  return null;
end;
$$;

revoke all on function private.broadcast_conversation_read() from public, anon, authenticated, service_role;

create trigger conversation_reads_broadcast after insert or update of last_read_at on public.conversation_reads
  for each row execute function private.broadcast_conversation_read();

-- A signed-in user may join, and receive the broadcasts of, conversation:<id> while private.can_access_conversation(id)
-- holds: the participants as the tables' policies read them, so a removed member, an owner or admin at aal1, another
-- tenant and staff are refused (FR-P1 AC5, AC8). The case keeps a topic that is no uuid from failing the cast. As for
-- user:<id>, no insert policy: clients cannot send.
create policy conversation_topic_receive_participant on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.messages.topic = (select realtime.topic())
    and case
      when (select realtime.topic()) ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (select private.can_access_conversation(substr((select realtime.topic()), 14)::uuid))
      else false
    end
  );
