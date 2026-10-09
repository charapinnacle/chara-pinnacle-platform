-- Usage against limits for the billing page (FR-G5; ARCHITECTURE.md sections 10.1, 10.4). The subscription view and the
-- portal came with FR-G1 and FR-G2; the limits are read through private.org_limit, which no API role can execute.
-- Open vacancies are counted as the limit check counts them (status open, not deleted: jobs_organization_open_idx) and
-- team members as the member limit counts them: private.team_size, the accepted members including the owner (C12) plus
-- the invitations that can still be accepted. The limit is the one of the plan whether or not it is enforced; null is
-- unlimited. Owners and admins at aal2 only, through the same gate as the portal.
create function public.billing_usage(p_org uuid) returns table (limit_key text, used integer, limit_value integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  perform private.assert_billing_manager(p_org);

  return query
  select 'active_jobs'::text,
         (select count(*)::integer from public.jobs j
          where j.organization_id = p_org and j.status = 'open' and j.deleted_at is null),
         private.org_limit(p_org, 'active_jobs')
  union all
  select 'members'::text,
         private.team_size(p_org),
         private.org_limit(p_org, 'members');
end;
$$;

revoke all on function public.billing_usage(uuid) from public, anon, authenticated, service_role;
grant execute on function public.billing_usage(uuid) to authenticated;
