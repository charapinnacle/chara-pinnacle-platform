-- admin_get_reported_message of 20270213100100_moderation_messages.sql with sender_former: the member who sent the
-- message or contact request is no longer a member of the organisation (removed, or the account erased, which leaves the
-- sender null). Staff then read "Former member"; a member without a display name is still a member. A candidate's
-- message is never former, as staff name every candidate "Candidate". Everything else is unchanged.
drop function public.admin_get_reported_message(bigint);

create function public.admin_get_reported_message(p_report bigint)
returns table (
  id uuid, created_at timestamptz, sender_kind text, sender_name text, sender_organization_name text, body text,
  reported boolean, sender_former boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_report public.reports;
  v_message public.messages;
  v_request public.contact_requests;
  v_ids uuid[];
begin
  select * into v_report from public.reports r where r.id = p_report;
  if not private.release_on(case when v_report.target_type = 'contact_request' then 'release_find_workers' else 'release_messaging' end) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if v_report.id is null or v_report.target_type not in ('message', 'contact_request') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_report.handled_by is distinct from v_uid then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if v_report.status <> 'in_review' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_report.status::text;
  end if;

  if v_report.target_type = 'contact_request' then
    select * into v_request from public.contact_requests c where c.id = v_report.contact_request_id;
    if not found then
      raise exception 'CHARA_NOT_FOUND' using detail = 'message_gone', errcode = 'P0002';
    end if;
    perform audit.record('contact_request.context_opened', 'report', v_report.id::text, jsonb_build_object(
      'contact_request_id', v_request.id, 'request_id', private.request_id()));
    return query
    select v_request.id, v_request.created_at, 'organization',
      (select u.display_name from public.profiles u where u.id = v_request.sent_by),
      (select o.display_name from public.organizations o where o.id = v_request.organization_id),
      v_request.message, true,
      not exists (select 1 from public.organization_members om
                  where om.organization_id = v_request.organization_id and om.user_id = v_request.sent_by);
    return;
  end if;

  select * into v_message from public.messages m where m.id = v_report.message_id;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using detail = 'message_gone', errcode = 'P0002';
  end if;

  select array_agg(w.id order by w.created_at, w.id) into v_ids
  from (
    (select m.id, m.created_at from public.messages m
     where m.conversation_id = v_message.conversation_id and (m.created_at, m.id) < (v_message.created_at, v_message.id)
     order by m.created_at desc, m.id desc limit 5)
    union all
    select v_message.id, v_message.created_at
    union all
    (select m.id, m.created_at from public.messages m
     where m.conversation_id = v_message.conversation_id and (m.created_at, m.id) > (v_message.created_at, v_message.id)
     order by m.created_at, m.id limit 5)
  ) w;

  perform audit.record('message.context_opened', 'report', v_report.id::text, jsonb_build_object(
    'conversation_id', v_message.conversation_id, 'message_id', v_message.id, 'message_ids', to_jsonb(v_ids),
    'request_id', private.request_id()));

  return query
  select m.id, m.created_at,
    case when m.sender_organization_id is null then 'worker' else 'organization' end,
    case when m.sender_organization_id is null then 'Candidate'
         else (select u.display_name from public.profiles u where u.id = m.sender_user_id) end,
    (select o.display_name from public.organizations o where o.id = m.sender_organization_id),
    m.body, m.id = v_message.id,
    m.sender_organization_id is not null and not exists (select 1 from public.organization_members om
      where om.organization_id = m.sender_organization_id and om.user_id = m.sender_user_id)
  from unnest(v_ids) with ordinality u(message_id, n)
  join public.messages m on m.id = u.message_id
  order by u.n;
end;
$$;

revoke all on function public.admin_get_reported_message(bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_reported_message(bigint) to authenticated;
