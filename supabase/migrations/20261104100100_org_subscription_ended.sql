-- Whether the subscription of an organisation has ended (FR-G4, ARCHITECTURE.md section 10.4): it has subscription rows and
-- every one of them is canceled, so it is on the fallback plan after a lapse and not simply a company that never subscribed.
-- The pages of the applicants and the vacancies tell a member so and say why the controls are off. Like the plan limit,
-- it is answered through a narrow definer function, because billing.subscriptions is readable by owners and
-- administrators at the second step only, and null for an organisation the caller is not a member of.
create function private.member_org_subscription_ended(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from billing.subscriptions s where s.organization_id = p_org)
    and not exists (select 1 from billing.subscriptions s where s.organization_id = p_org and s.status <> 'canceled')
  where private.is_org_member(p_org)
$$;

revoke all on function private.member_org_subscription_ended(uuid) from public, anon, authenticated, service_role;
grant execute on function private.member_org_subscription_ended(uuid) to authenticated;

create or replace view public.v_org_limits with (security_invoker = true) as
select
  o.id as organization_id,
  p.name as plan_name,
  private.member_org_job_limit(o.id) as active_jobs_limit,
  (select count(*)::integer from public.jobs j
   where j.organization_id = o.id and j.status = 'open' and j.deleted_at is null) as open_jobs,
  private.member_org_subscription_ended(o.id) as subscription_ended
from public.organizations o
left join billing.plans p on p.code = private.org_plan_code(o.id);
