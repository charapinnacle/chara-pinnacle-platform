-- The unread count on the private Realtime channel user:<id> (FR-T1 AC9; docs/phase-2/DATA_MODEL.md section 6, Realtime;
-- ARCHITECTURE.md section 2: Broadcast on private channels, no postgres_changes). The first use of Realtime: after every
-- statement that adds notifications or changes read_at, each recipient concerned gets one broadcast unread_count with the
-- new count, and nothing else (no kind, no payload). The web shows it in the header bell and polls when the channel
-- cannot connect. Nothing is broadcast while release_partner_directories is off.

create function private.broadcast_unread_counts() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_users uuid[];
  v_user uuid;
begin
  if not private.release_on('release_partner_directories') then
    return null;
  end if;
  -- Each branch names only the transition tables its trigger declares.
  if tg_op = 'INSERT' then
    select array_agg(distinct c.user_id) into v_users from changed c where c.user_id is not null;
  else
    select array_agg(distinct c.user_id) into v_users
    from changed c join previous p on p.id = c.id
    where c.user_id is not null and p.read_at is distinct from c.read_at;
  end if;
  foreach v_user in array coalesce(v_users, '{}') loop
    perform realtime.send(
      jsonb_build_object('unread', private.unread_notifications(v_user)), 'unread_count', 'user:' || v_user, true
    );
  end loop;
  return null;
end;
$$;

revoke all on function private.broadcast_unread_counts() from public, anon, authenticated, service_role;

create trigger notifications_broadcast_insert after insert on public.notifications
  referencing new table as changed
  for each statement execute function private.broadcast_unread_counts();

create trigger notifications_broadcast_update after update on public.notifications
  referencing old table as previous new table as changed
  for each statement execute function private.broadcast_unread_counts();

-- A signed-in user may join, and receive the broadcasts of, the topic of their own id only. There is no insert policy:
-- clients cannot send on any topic.
create policy user_topic_receive_own on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.messages.topic = (select realtime.topic())
    and (select realtime.topic()) = 'user:' || (select auth.uid())::text
  );
