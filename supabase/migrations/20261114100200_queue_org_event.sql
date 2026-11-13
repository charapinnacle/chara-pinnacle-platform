-- Organisation events (FR-T1; docs/phase-2/DATA_MODEL.md sections 7 and 9): the one way a Phase 2 producer notifies an
-- organisation. Each accepted owner and admin of an active organisation gets one message of the kind, in the transaction of
-- the caller (NFR-A3); members, invitees who have not accepted and suspended organisations get nothing. With a dedupe key,
-- a recipient who already has the event for the kind is skipped, and the unique index of notifications drops a message
-- that two concurrent calls queue at once. Answers the number of messages queued.
--   CHARA_INVALID_INPUT (detail p_org, p_kind: not in private.notification_kinds, p_message: not an object, p_dedupe_key)
create function private.queue_org_event(p_org uuid, p_kind text, p_message jsonb, p_dedupe_key text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages jsonb[];
begin
  if p_org is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_org';
  end if;
  if not exists (select 1 from private.notification_kinds k where k.kind = p_kind) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_kind';
  end if;
  if p_message is null or jsonb_typeof(p_message) <> 'object' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_message';
  end if;
  if p_dedupe_key is not null and length(p_dedupe_key) not between 1 and 200 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_dedupe_key';
  end if;

  select array_agg(
           p_message || jsonb_strip_nulls(jsonb_build_object(
             'kind', p_kind, 'user_id', m.user_id, 'organization_id', p_org, 'mandatory', k.mandatory, 'dedupe_key', p_dedupe_key
           ))
           order by m.user_id)
  into v_messages
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  join private.notification_kinds k on k.kind = p_kind
  where m.organization_id = p_org and m.role in ('owner', 'admin') and m.accepted_at is not null and o.status = 'active'
    and (p_dedupe_key is null or not exists (
      select 1 from public.notifications n where n.user_id = m.user_id and n.kind = p_kind and n.dedupe_key = p_dedupe_key
    ));

  if v_messages is null then
    return 0;
  end if;
  perform pgmq.send_batch('notifications', v_messages);
  return cardinality(v_messages);
end;
$$;

revoke all on function private.queue_org_event(uuid, text, jsonb, text) from public, anon, authenticated, service_role;
