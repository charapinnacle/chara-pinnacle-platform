-- The unread counts at 10,000 conversations (NFR-P4, V80; docs/perf/release-2c.md). The inbox reads my_unread_counts
-- beside the page of list_conversations, and the header badge reads it on every page and every poll. The load test of
-- V80 found it at 150 to 210 ms at the median for an organisation with 10,000 conversations, the slowest call of the
-- inbox: it called private.conversation_unread twice for every conversation of the caller (once to keep the row, once
-- for the count), each a lookup of the read row and of the messages after it. It now counts every conversation's
-- messages in one join: the same rows and counts as private.conversation_unread of 20270213100100 (visible messages of
-- the other side after the caller's last read, a missing or empty read as never), the same callers.

-- public.my_unread_counts of 20270203100000. The caller's unread messages per conversation, the side (organisation, null
-- for the candidate) and the count, only where there is one (FR-P1 AC7, the badges of FR-P4). An owner or admin at aal1
-- counts only the conversations of the organisations where the caller is a plain member, as private.messaging_org_ids.
create or replace function public.my_unread_counts() returns table (conversation_id uuid, organization_id uuid, unread integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.messaging_caller();
  return query
  select p.conversation_id, p.organization_id, count(*)::integer
  from public.conversation_participants p
  left join public.conversation_reads r on r.conversation_id = p.conversation_id and r.user_id = (select auth.uid())
  join public.messages m on m.conversation_id = p.conversation_id
    and m.moderation_state = 'visible'
    and m.created_at > coalesce(r.last_read_at, '-infinity')
    and case when p.organization_id is null then m.sender_organization_id is not null
             else m.sender_organization_id is distinct from p.organization_id end
  where p.user_id = (select auth.uid()) or p.organization_id in (select private.messaging_org_ids())
  group by p.conversation_id, p.organization_id
  order by p.conversation_id;
end;
$$;

revoke all on function public.my_unread_counts() from public, anon, authenticated, service_role;
grant execute on function public.my_unread_counts() to authenticated;
