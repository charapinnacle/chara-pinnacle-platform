-- A worker who accepted a contact request was taken to an empty conversation; the employer's message stayed on the request
-- page, while an inquiry is the first message of its conversation. respond_to_contact_request of
-- 20270213100100_moderation_messages.sql with one change: on accept, the request's message becomes the first message of
-- the conversation, from the member and organisation that sent it, dated when it was sent; the conversation sorts by the
-- acceptance. The copy follows the request's moderation (private.sync_contact_request_copy). Grants are kept.

create or replace function public.respond_to_contact_request(p_request uuid, p_decision text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.contact_request_caller();
  v_row public.contact_requests;
  v_status public.contact_request_status;
  v_sender_active boolean;
  v_decided text := case p_decision when 'accept' then 'accepted' when 'decline' then 'declined' end;
  v_conversation uuid;
begin
  select * into v_row from public.contact_requests r
  where r.id = p_request and r.worker_user_id = v_uid and r.moderation_state = 'visible' for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if v_decided is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_decision';
  end if;
  v_status := private.contact_request_status_now(v_row.status, v_row.expires_at);
  if v_status <> 'pending' then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = v_status::text;
  end if;
  perform private.count_audited_write(null);

  update public.contact_requests r
  set status = v_decided::public.contact_request_status,
      responded_at = now()
  where r.id = v_row.id;
  perform audit.record(
    case when p_decision = 'accept' then 'contact_request.accepted' else 'contact_request.declined' end,
    'contact_request', v_row.id::text, jsonb_build_object('organization_id', v_row.organization_id));

  v_sender_active := exists (
    select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
    where m.organization_id = v_row.organization_id and m.user_id = v_row.sent_by and m.accepted_at is not null
      and o.status = 'active');
  if v_sender_active then
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'contact_request_decided', 'user_id', v_row.sent_by, 'organization_id', v_row.organization_id,
      'mandatory', false, 'contact_request_id', v_row.id, 'decision', v_decided,
      'dedupe_key', 'contact_request_decided:' || v_row.id));
  else
    perform private.queue_org_event(v_row.organization_id, 'contact_request_decided',
      jsonb_build_object('contact_request_id', v_row.id, 'decision', v_decided),
      'contact_request_decided:' || v_row.id);
  end if;

  if p_decision = 'accept' and private.release_on('release_messaging')
     and exists (select 1 from public.organizations o where o.id = v_row.organization_id and o.status = 'active') then
    v_conversation := public.open_conversation('contact_request', v_row.id);
    if not exists (select 1 from public.messages m where m.conversation_id = v_conversation) then
      insert into public.messages (conversation_id, sender_user_id, sender_organization_id, kind, body, created_at)
      values (v_conversation, v_row.sent_by, v_row.organization_id, 'text', v_row.message, v_row.created_at);
      update public.conversations c set last_message_at = now() where c.id = v_conversation;
    end if;
    return v_conversation;
  end if;
  return null;
end;
$$;

-- The first message copied from a contact request is hidden and shown again with the request, so hiding a reported request
-- also hides its text in the conversation, and a reversed decision brings both back.
create function private.sync_contact_request_copy() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages m
  set moderation_state = new.moderation_state
  from public.conversations c
  where c.context_type = 'contact_request' and c.context_id = new.id and m.conversation_id = c.id
    and m.sender_organization_id = new.organization_id and m.created_at = new.created_at and m.body = new.message;
  return null;
end;
$$;

revoke all on function private.sync_contact_request_copy() from public, anon, authenticated, service_role;

create trigger contact_requests_sync_copy
after update of moderation_state on public.contact_requests
for each row when (old.moderation_state is distinct from new.moderation_state)
execute function private.sync_contact_request_copy();
