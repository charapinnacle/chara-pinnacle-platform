-- Job order metrics of the network statistics (FR-S2 release 2b parts; SOP P2-42 steps Aggregate, Suppress, Show;
-- control counts only, small-count suppression, administrator role). V31 built admin_network_counts over the view
-- stats.network_events; the metrics of release 2b join it here, each an event with its time:
--   requirements  a workforce requirement published (published_at, the first Draft -> Open)
--   job_orders    a published requirement shown on the job order marketplace (its visibility now)
--   invitations   an invitation sent to a partner (invited_at)
--   responses     a partner response sent (created_at)
--   selections    a partner response selected (decided_at; selected is final)
--   submissions   a candidate request sent by a partner (created_at; the candidate's approval is a later step)
--   hires         a submitted candidate moved to hired (the submission event)
-- The first five count while release_job_orders is on, the last two while release_candidate_submissions is on too:
-- private.network_count_metrics lists them only then, so the console shows them only then. Every count below
-- private.stats_min_count is null, as for the partner metrics; nothing names an organisation, a person, a requirement
-- or a document. Retention deletes the rows of ended requirements after 730 days, so a range further back than the
-- periods counts less than happened (the range itself is at most 366 days, ending today at the latest).

-- The time column of each new branch, so that a range reads its index range only.
create index workforce_requirements_published_at_idx on public.workforce_requirements (published_at)
  where published_at is not null;
create index requirement_invitations_invited_at_idx on public.requirement_invitations (invited_at);
create index partner_responses_created_at_idx on public.partner_responses (created_at);
create index partner_responses_selected_at_idx on public.partner_responses (decided_at) where status = 'selected';
create index candidate_submissions_created_at_idx on public.candidate_submissions (created_at);
create index submission_events_hired_at_idx on public.submission_events (created_at) where to_status = 'hired';

-- stats.network_events of 20261212100000 with the job order branches added at the end.
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
where e.to_status = 'hired';

revoke all on table stats.network_events from public, anon, authenticated, service_role;

-- private.network_count_metrics of 20261212100000 with the job order metrics, each listed only while its release is on
-- (stable now: it reads the release settings).
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
    'requirements', 'job_orders', 'invitations', 'responses', 'selections', 'submissions', 'hires'
  ]) with ordinality m (metric, pos)
  where m.metric not in ('requirements', 'job_orders', 'invitations', 'responses', 'selections', 'submissions', 'hires')
    or (private.release_on('release_job_orders')
        and (m.metric not in ('submissions', 'hires') or private.release_on('release_candidate_submissions')))
$$;

revoke all on function private.network_count_metrics() from public, anon, authenticated, service_role;
