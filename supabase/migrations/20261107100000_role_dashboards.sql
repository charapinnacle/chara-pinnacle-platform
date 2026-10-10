-- The reads of the role dashboards (U59: FR-B4 and FR-D3 on the candidate dashboard, FR-E5 on the employer dashboard,
-- FR-F1 on the console landing). Every function only counts: no name, text or document leaves it. Nothing is stored; each
-- dashboard load reads again. Each function checks the caller itself and has an explicit grant (default deny).

-- The applications of the calling candidate by stage, every stage present (zero filled), so that the dashboard shows the
-- whole pipeline. job_applications_worker_created_idx serves the filter. Errors: CHARA_FORBIDDEN for anybody who is not a
-- signed-in candidate.
create function public.my_application_stage_counts() returns table (status public.application_status, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or private.account_kind() is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  return query
  select s.status, coalesce(c.n, 0)
  from unnest(enum_range(null::public.application_status)) with ordinality as s (status, pos)
  left join (
    select a.status, count(*) as n from public.job_applications a where a.worker_user_id = v_uid group by a.status
  ) c on c.status = s.status
  order by s.pos;
end;
$$;

revoke all on function public.my_application_stage_counts() from public, anon, authenticated, service_role;
grant execute on function public.my_application_stage_counts() to authenticated;

-- The first steps of an organisation, from what the database holds: a vacancy that has left draft (it was published at
-- least once), a member other than the first or an invitation sent, and a live subscription (the statuses of
-- private.org_plan_code). Three yes/no facts and no billing or applicant data, so a member and an owner at aal1 read them
-- too: the owner at aal1 sees the checklist that leads to two-step verification. No row for an organisation the caller is
-- not an accepted member of (a suspended user is a member of nothing). The lookups use jobs_organization_created_idx,
-- organization_invitations_org, the primary key of organization_members and subscriptions_organization_idx. Errors:
-- CHARA_FORBIDDEN (detail company_account_required).
create function public.get_dashboard_first_steps(p_organization_id uuid) returns table (
  vacancy_published boolean,
  team_invited boolean,
  plan_chosen boolean
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
  if not private.is_org_member(p_organization_id) then
    return;
  end if;

  return query
  select
    exists (
      select 1 from public.jobs j
      where j.organization_id = p_organization_id and j.deleted_at is null and (j.published_at is not null or j.status <> 'draft')
    ),
    exists (select 1 from public.organization_invitations i where i.organization_id = p_organization_id)
      or (select count(*) from public.organization_members m where m.organization_id = p_organization_id) > 1,
    exists (
      select 1 from billing.subscriptions s
      where s.organization_id = p_organization_id and s.status in ('trialing', 'active', 'past_due')
    );
end;
$$;

revoke all on function public.get_dashboard_first_steps(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_dashboard_first_steps(uuid) to authenticated;

-- The console landing of a Platform Administrator: the platform staff roles that are active now. platform_staff is a
-- table of a few rows. Errors: CHARA_FORBIDDEN (not an administrator at aal2, private.assert_staff).
create function public.admin_staff_count() returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  return (select count(*) from public.platform_staff s where s.revoked_at is null);
end;
$$;

revoke all on function public.admin_staff_count() from public, anon, authenticated, service_role;
grant execute on function public.admin_staff_count() to authenticated;

-- The console landing of a Trust & Safety Administrator: what is suspended or hidden now. Each count reads a partial index
-- that holds only those rows, so it stays small however many accounts and vacancies there are. Errors: CHARA_FORBIDDEN
-- (not a Trust & Safety Administrator at aal2).
create index profiles_suspended_idx on public.profiles (id) where status = 'suspended';
create index organizations_suspended_idx on public.organizations (id) where status = 'suspended';
create index jobs_moderation_hidden_idx on public.jobs (id) where moderation_state = 'hidden';

create function public.admin_moderation_counts() returns table (
  suspended_users bigint,
  suspended_organizations bigint,
  hidden_vacancies bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  return query
  select
    (select count(*) from public.profiles p where p.status = 'suspended'),
    (select count(*) from public.organizations o where o.status = 'suspended'),
    (select count(*) from public.jobs j where j.moderation_state = 'hidden');
end;
$$;

revoke all on function public.admin_moderation_counts() from public, anon, authenticated, service_role;
grant execute on function public.admin_moderation_counts() to authenticated;
