-- A company whose message was hidden read "Message: Message" on its decision and appeal pages and could not tell which
-- message it was. The title of a decision on a message now names when it was sent and the other side of its
-- conversation, as the sending side reads it in its inbox (private.conversation_labels), never its text; a contact
-- request is named by when it was sent. private.appealable_decision of 20270213100100_moderation_messages.sql with these
-- two titles; everything else is unchanged.

create function private.moderated_message_title(p_message uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select format('Sent on %s in the conversation with %s',
    to_char(m.created_at at time zone 'UTC', 'FMDD FMMonth YYYY "at" HH24:MI "UTC"'),
    coalesce(l.counterpart_name, 'the other side'))
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  left join lateral private.conversation_labels(c, m.sender_organization_id) l on true
  where m.id = p_message
  limit 1
$$;

revoke all on function private.moderated_message_title(uuid) from public, anon, authenticated, service_role;

create or replace function private.appealable_decision(p_action bigint) returns table (
  moderation_action_id bigint,
  target_type text,
  target_id uuid,
  action text,
  organization_id uuid,
  title text,
  org_slug text,
  reasons text,
  actor_id uuid,
  decided_at timestamptz,
  in_effect boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.target_type, a.target_id, a.action, o.id,
    case
      when a.target_type = 'job' then j.title
      when a.target_type = 'message' then coalesce(private.moderated_message_title(a.target_id), 'Message')
      when a.target_type = 'contact_request' then coalesce(
        (select format('Sent on %s', to_char(r.created_at at time zone 'UTC', 'FMDD FMMonth YYYY "at" HH24:MI "UTC"'))
         from public.contact_requests r where r.id = a.target_id), 'Contact request')
      when i.organization_id is not null then i.title
      else o.display_name
    end,
    o.slug, a.statement_of_reasons, a.actor_id, a.created_at,
    not exists (
      select 1 from public.moderation_actions b
      where b.target_type = a.target_type and b.target_id = a.target_id and b.id > a.id
    ) and (a.target_type <> 'job' or j.deleted_at is null)
      and case when a.target_type in ('message', 'contact_request') then i.present is true else i.present is distinct from false end
  from public.moderation_actions a
  left join public.jobs j on a.target_type = 'job' and j.id = a.target_id
  left join lateral private.moderated_item_owner(a.target_type, a.target_id) i on true
  left join public.organizations o on o.id = case
    when a.target_type = 'job' then j.organization_id
    when a.target_type in ('requirement', 'partner_response', 'candidate_submission', 'message', 'contact_request') then i.organization_id
    else a.target_id
  end
  where a.id = p_action and a.action in ('content_hidden', 'job_hidden', 'organization_suspended')
    and (o.id is not null or a.target_type in ('message', 'contact_request'))
$$;
