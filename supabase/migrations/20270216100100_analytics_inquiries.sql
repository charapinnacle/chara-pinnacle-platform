-- The inquiries of company analytics (FR-R6 AC3 and AC8 for inquiries, SOP P2-40 steps Count, Aggregate, Suppress and
-- Show; docs/phase-2/DATA_MODEL.md sections 7 and 10). An inquiry is a connection of kind inquiry (V71), counted on the
-- day it was sent for both organisations: received by the partner, sent by the employer, by the country of the other
-- organisation. An inquiry names no requirement, so it has no occupation row and the breakdown by occupation has no
-- inquiry cell. The metric is shown while release_messaging is on, as send_inquiry answers only then, and is suppressed
-- as every other metric (V20, V60).

create index connections_inquiry_created_at_idx on public.connections (created_at) where kind = 'inquiry';

-- private.analytics_metric_released of 20270114100100 with inquiries, released with messaging.
create or replace function private.analytics_metric_released(p_metric public.analytics_metric) returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_metric::text = 'profile_views' then true
    when p_metric::text = 'inquiries' then private.release_on('release_messaging')
    when p_metric::text in ('submissions', 'hires') then
      private.release_on('release_job_orders') and private.release_on('release_candidate_submissions')
    else private.release_on('release_job_orders')
  end
$$;

-- private.aggregate_org_activity of 20270114100100 with the inquiries sent that day.
create or replace function private.aggregate_org_activity(p_day date default ((now() at time zone 'utc')::date - 1)) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_from timestamptz;
  v_to timestamptz;
  v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('aggregate_org_analytics'));
  if p_day is null or p_day >= v_today or p_day < v_today - 366 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_day';
  end if;
  v_from := p_day::timestamp at time zone 'utc';
  v_to := v_from + interval '1 day';

  delete from private.org_analytics_daily d where d.day = p_day and d.metric <> 'profile_views';
  insert into private.org_analytics_daily (organization_id, day, metric, country_code, occupation_id, value)
  with acts (metric, act_id, requirement_id, organization_id, other_id) as (
    select 'inquiries'::public.analytics_metric, c.id::text, null::uuid, side.org, side.other
    from public.connections c
    cross join lateral (values (c.to_organization_id, c.from_organization_id), (c.from_organization_id, c.to_organization_id)) side (org, other)
    where c.kind = 'inquiry' and c.created_at >= v_from and c.created_at < v_to
    union all
    select 'invitations'::public.analytics_metric, i.id::text, i.requirement_id, side.org, side.other
    from public.requirement_invitations i
    cross join lateral (values (i.organization_id, i.employer_organization_id), (i.employer_organization_id, i.organization_id)) side (org, other)
    where i.invited_at >= v_from and i.invited_at < v_to
    union all
    select 'responses'::public.analytics_metric, p.id::text, p.requirement_id, side.org, side.other
    from public.partner_responses p
    cross join lateral (values (p.organization_id, p.employer_organization_id), (p.employer_organization_id, p.organization_id)) side (org, other)
    where p.created_at >= v_from and p.created_at < v_to
    union all
    select 'selections'::public.analytics_metric, p.id::text, p.requirement_id, side.org, side.other
    from public.partner_responses p
    cross join lateral (values (p.organization_id, p.employer_organization_id), (p.employer_organization_id, p.organization_id)) side (org, other)
    where p.status = 'selected' and p.decided_at >= v_from and p.decided_at < v_to
    union all
    select 'submissions'::public.analytics_metric, s.id::text, s.requirement_id, s.organization_id, s.employer_organization_id
    from public.candidate_submissions s
    where s.created_at >= v_from and s.created_at < v_to
    union all
    select 'submissions'::public.analytics_metric, s.id::text, s.requirement_id, s.employer_organization_id, s.organization_id
    from public.candidate_submissions s
    where s.worker_approved_at >= v_from and s.worker_approved_at < v_to
    union all
    select 'hires'::public.analytics_metric, s.id::text, s.requirement_id, side.org, side.other
    from public.submission_events e
    join public.candidate_submissions s on s.id = e.submission_id
    cross join lateral (values (s.organization_id, s.employer_organization_id), (s.employer_organization_id, s.organization_id)) side (org, other)
    where e.to_status = 'hired' and e.created_at >= v_from and e.created_at < v_to
  )
  select a.organization_id, p_day, a.metric, o.based_in_country, null::text, count(distinct a.act_id)::integer
  from acts a
  join public.organizations o on o.id = a.other_id
  group by a.organization_id, a.metric, o.based_in_country
  union all
  select a.organization_id, p_day, a.metric, null::text, ro.occupation_id, count(distinct a.act_id)::integer
  from acts a
  join public.requirement_occupations ro on ro.requirement_id = a.requirement_id
  group by a.organization_id, a.metric, ro.occupation_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- The inquiries of the last 12 months are counted once now, so every period starts complete.
select sum(private.aggregate_org_activity(d::date))
from generate_series((now() at time zone 'utc')::date - 366, (now() at time zone 'utc')::date - 1, interval '1 day') d;
