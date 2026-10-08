-- Employer dashboard (FR-E5; ARCHITECTURE.md sections 5.1, 10.1, 10.4). The dashboard stores nothing: every number is read
-- again on each load. The open vacancies and the existence of a vacancy are read from public.jobs with the row policy of
-- the member (the partial index jobs_organization_open_idx and jobs_organization_created_idx serve them); the two
-- functions below are the reads that no table or view offers.

-- The applications of an organisation by stage, and how many of each were made in the last 7 x 24 hours (any stage now).
-- It runs with the rights of the caller, so the row policy of FR-D5 decides what is counted: a member of the
-- organisation gets its applications, anybody else gets no row. A stage with no application has no row.
create function public.get_dashboard_applications(p_organization_id uuid) returns table (
  status public.application_status,
  total bigint,
  recent bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.status, count(*), count(*) filter (where a.created_at >= now() - interval '7 days')
  from public.job_applications a
  where a.organization_id = p_organization_id
  group by a.status
$$;

revoke all on function public.get_dashboard_applications(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_dashboard_applications(uuid) to authenticated;

-- The plan and subscription status a member of the organisation sees on the dashboard: the plan name of the plan the
-- organisation is on (private.org_plan_code), the status of its live subscription (trialing, active, past_due) or free,
-- the dates the status needs, and whether the organisation has subscription rows and all of them are canceled (it is
-- lapsed, C11).
-- billing.subscriptions is readable by owners and admins at aal2 only, and a plain member must see the status too, so this
-- function reads it for them and returns neither the provider nor a reference. Owners and admins are held to aal2 here as
-- the policy holds them. No row for an organisation the caller is not a member of. Errors: CHARA_FORBIDDEN (detail
-- company_account_required, aal2_required).
create function public.get_dashboard_plan(p_organization_id uuid) returns table (
  plan_name text,
  status text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  past_due_since timestamptz,
  subscription_ended boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  if private.is_org_member(p_organization_id, 'admin') and not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;
  return query
  select
    p.name,
    coalesce(s.status, 'free'),
    s.trial_ends_at,
    s.current_period_end,
    s.past_due_since,
    (select coalesce(bool_and(e.status = 'canceled'), false) from billing.subscriptions e where e.organization_id = o.id)
  from public.organizations o
  join billing.plans p on p.code = private.org_plan_code(o.id)
  -- The live statuses and the order are those of private.org_plan_code, so that the name and the status agree.
  left join lateral (
    select x.status, x.trial_ends_at, x.current_period_end, x.past_due_since
    from billing.subscriptions x
    where x.organization_id = o.id and x.status in ('trialing', 'active', 'past_due')
    order by x.created_at desc
    limit 1
  ) s on true
  where o.id = p_organization_id and o.id in (select private.member_org_ids());
end;
$$;

revoke all on function public.get_dashboard_plan(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_dashboard_plan(uuid) to authenticated;
