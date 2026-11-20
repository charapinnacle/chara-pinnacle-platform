-- The messaging pages (FR-P1 AC10, AC11; NFR-P4, NFR-O5; V65, release 2c): what the inbox and the composer need and the
-- functions of V63 do not answer.
--
-- The inbox filters by context (all, applications, submissions, invitations, responses), so list_conversations takes
-- p_context_type. It also reads the page first and names only its rows: the V63 form named the other party and counted the
-- unread messages of every conversation of the organisation before it sorted and cut the page, which grows with the
-- organisation's conversations, and NFR-P4 asks for the list within 500 ms at 10,000 conversations. The page is the keyset
-- over (last_message_at, id) of the caller's participant rows; labels, unread counts and the read-only reason are computed
-- for at most p_limit rows.
--
-- The composer counts the characters against message_body_max_chars (an administrator setting of V63), so it joins the
-- public settings.

-- The public settings of 20270101100000_response_pages.sql with the length of a message.
create or replace function public.get_public_settings() returns table (key text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.value #>> '{}'
  from private.settings s
  where s.key = any (array[
    'legal_entity_name', 'legal_entity_address', 'legal_entity_registration_number', 'legal_entity_vat_id',
    'legal_entity_email', 'privacy_contact', 'data_protection_contact', 'release_partner_directories',
    'partner_review_target_working_days', 'licence_number_patterns', 'licence_valid_until_max_years',
    'workforce_listing_stale_days', 'workforce_confirm_reminder_days', 'workforce_available_from_max_days',
    'release_job_orders', 'release_candidate_submissions', 'release_messaging', 'release_find_workers',
    'release_data_export', 'requirement_open_days', 'requirement_extension_days', 'requirement_closing_reminder_days',
    'response_documents_max', 'message_body_max_chars'
  ])
$$;

drop function public.list_conversations(uuid, timestamptz, uuid, integer);

-- The conversations of the organisation p_org, or the caller's own as a candidate when p_org is null, of the context
-- p_context_type when given, latest message first, keyset (p_before_at, p_before_id) over (last_message_at, id), p_limit
-- 1 to 50 (20). Each row names the other party and the context as private.conversation_labels, the caller's unread count
-- and why it is closed for messages, if it is. Refusals: private.messaging_caller; p_limit out of range,
-- CHARA_INVALID_INPUT p_limit; a p_org the caller is no accepted member of, CHARA_FORBIDDEN; an owner or admin of p_org at
-- aal1, CHARA_FORBIDDEN aal2_required.
create function public.list_conversations(
  p_org uuid default null, p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 20,
  p_context_type public.conversation_context default null
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
  v_page uuid[];
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_limit', errcode = '22023';
  end if;
  if p_org is not null then
    if not private.is_org_member(p_org) then
      raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
    end if;
    perform private.assert_member_aal2(p_org);
    select array_agg(x.id order by x.last_message_at desc, x.id desc) into v_page
    from (
      select c.id, c.last_message_at
      from public.conversation_participants p
      join public.conversations c on c.id = p.conversation_id
      where p.organization_id = p_org
        and (p_context_type is null or c.context_type = p_context_type)
        and (p_before_at is null or (c.last_message_at, c.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff')))
      order by c.last_message_at desc, c.id desc
      limit p_limit
    ) x;
  else
    select array_agg(x.id order by x.last_message_at desc, x.id desc) into v_page
    from (
      select c.id, c.last_message_at
      from public.conversation_participants p
      join public.conversations c on c.id = p.conversation_id
      where p.user_id = v_uid
        and (p_context_type is null or c.context_type = p_context_type)
        and (p_before_at is null or (c.last_message_at, c.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff')))
      order by c.last_message_at desc, c.id desc
      limit p_limit
    ) x;
  end if;

  return query
  select c.id, c.context_type, c.context_id, c.requirement_id, p_org, l.counterpart_kind, l.counterpart_name,
    l.context_title, c.last_message_at, private.conversation_unread(c.id, p_org), private.conversation_closed_reason(c)
  from unnest(v_page) with ordinality u(conversation_id, n)
  join public.conversations c on c.id = u.conversation_id
  cross join lateral private.conversation_labels(c, p_org) l
  order by u.n;
end;
$$;

revoke all on function public.list_conversations(uuid, timestamptz, uuid, integer, public.conversation_context)
  from public, anon, authenticated, service_role;
grant execute on function public.list_conversations(uuid, timestamptz, uuid, integer, public.conversation_context) to authenticated;
