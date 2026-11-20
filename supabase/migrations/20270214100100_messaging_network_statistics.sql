-- Messaging and Find Workers metrics of the network statistics (FR-S2 release 2c parts; SOP P2-42 steps Aggregate,
-- Suppress, Show; control counts only, small-count suppression, administrator role). The metrics join V31's
-- stats.network_events, each an event with its time:
--   conversations              a conversation opened (created_at)
--   messages                   a message sent (created_at; the view reads no other column of messages, FR-S2 AC3)
--   worker_searches            a Find Workers search, first page (private.worker_search_log, created_at)
--   contact_requests           a contact request sent (created_at)
--   contact_requests_accepted  a contact request the worker accepted (responded_at)
-- The first two count while release_messaging is on, the last three while release_find_workers is on:
-- private.network_count_metrics lists them only then. Every count below private.stats_min_count is null; nothing names
-- an organisation, a person or a message. Retention and erasure delete conversations, messages and requests (V74) and the
-- search log keeps 90 days, so a range further back than those periods counts less than happened.

-- The time column of each new branch, so that a range reads its index range only (FR-S2 AC10).
create index conversations_created_at_idx on public.conversations (created_at);
create index messages_created_at_idx on public.messages (created_at);
create index contact_requests_created_at_idx on public.contact_requests (created_at);
create index contact_requests_accepted_at_idx on public.contact_requests (responded_at) where status = 'accepted';

-- stats.network_events of 20270112100100_job_order_network_statistics.sql with the release 2c branches added at the end.
create or replace view stats.network_events with (security_invoker = true) as
select o.type::text || '.new' as metric, o.created_at as occurred_at
from public.organizations o
where o.type in ('recruitment_company', 'staffing_company')
union all
select o.type::text || '.decision_' || d.decision, d.decided_at
from public.partner_review_decisions d
join public.organizations o on o.id = d.organization_id
union all
select case m.action when 'organization_suspended' then 'partner_suspensions' else 'partner_reinstatements' end, m.created_at
from public.moderation_actions m
join public.organizations o on o.id = m.target_id and o.type in ('recruitment_company', 'staffing_company')
where m.target_type = 'organization' and m.action in ('organization_suspended', 'organization_reinstated')
union all
select 'partner_profiles_hidden', m.created_at
from public.moderation_actions m
where m.target_type = 'partner_profile' and m.action = 'content_hidden'
union all
select 'partner_profile_reports', r.created_at
from public.reports r
where r.target_type = 'partner_profile'
union all
select 'appeals_lodged', a.lodged_at
from public.appeals a
union all
select 'appeals_decided', a.decided_at
from public.appeals a
where a.decided_at is not null
union all
select 'appeals_restored', a.decided_at
from public.appeals a
where a.decided_at is not null and a.reversal_action_id is not null
union all
select 'searches.' || s.kind, s.created_at
from stats.partner_searches s
union all
select 'partner_saves', i.created_at
from public.saved_items i
union all
select 'partner_follows', f.created_at
from public.follows f
join public.organizations o on o.id = f.organization_id and o.type in ('recruitment_company', 'staffing_company')
union all
select 'requirements', r.published_at
from public.workforce_requirements r
where r.published_at is not null
union all
select 'job_orders', r.published_at
from public.workforce_requirements r
where r.published_at is not null and r.visibility = 'job_order_marketplace'
union all
select 'invitations', i.invited_at
from public.requirement_invitations i
union all
select 'responses', p.created_at
from public.partner_responses p
union all
select 'selections', p.decided_at
from public.partner_responses p
where p.status = 'selected'
union all
select 'submissions', s.created_at
from public.candidate_submissions s
union all
select 'hires', e.created_at
from public.submission_events e
where e.to_status = 'hired'
union all
select 'conversations', c.created_at
from public.conversations c
union all
select 'messages', m.created_at
from public.messages m
union all
select 'worker_searches', l.created_at
from private.worker_search_log l
union all
select 'contact_requests', r.created_at
from public.contact_requests r
union all
select 'contact_requests_accepted', r.responded_at
from public.contact_requests r
where r.status = 'accepted';

revoke all on table stats.network_events from public, anon, authenticated, service_role;

-- private.network_count_metrics of 20270112100100_job_order_network_statistics.sql with the release 2c metrics, each
-- listed only while its release is on.
create or replace function private.network_count_metrics() returns table (metric text, pos integer)
language sql
stable
set search_path = ''
as $$
  select m.metric, m.pos::integer
  from unnest(array[
    'recruitment_company.new', 'recruitment_company.decision_approve', 'recruitment_company.decision_request_info',
    'recruitment_company.decision_decline', 'recruitment_company.onboarding', 'recruitment_company.pending_review',
    'recruitment_company.info_requested', 'recruitment_company.re_review', 'recruitment_company.listed',
    'recruitment_company.declined', 'recruitment_company.active', 'recruitment_company.suspended',
    'staffing_company.new', 'staffing_company.decision_approve', 'staffing_company.decision_request_info',
    'staffing_company.decision_decline', 'staffing_company.onboarding', 'staffing_company.pending_review',
    'staffing_company.info_requested', 'staffing_company.re_review', 'staffing_company.listed',
    'staffing_company.declined', 'staffing_company.active', 'staffing_company.suspended',
    'partner_suspensions', 'partner_reinstatements', 'partner_profiles_hidden', 'partner_profile_reports',
    'appeals_lodged', 'appeals_decided', 'appeals_restored',
    'searches.recruitment', 'searches.staffing', 'searches.available_workforce', 'partner_saves', 'partner_follows',
    'requirements', 'job_orders', 'invitations', 'responses', 'selections', 'submissions', 'hires',
    'conversations', 'messages', 'worker_searches', 'contact_requests', 'contact_requests_accepted'
  ]) with ordinality m (metric, pos)
  where case
    when m.metric in ('requirements', 'job_orders', 'invitations', 'responses', 'selections') then
      private.release_on('release_job_orders')
    when m.metric in ('submissions', 'hires') then
      private.release_on('release_job_orders') and private.release_on('release_candidate_submissions')
    when m.metric in ('conversations', 'messages') then private.release_on('release_messaging')
    when m.metric in ('worker_searches', 'contact_requests', 'contact_requests_accepted') then
      private.release_on('release_find_workers')
    else true
  end
$$;

revoke all on function private.network_count_metrics() from public, anon, authenticated, service_role;
