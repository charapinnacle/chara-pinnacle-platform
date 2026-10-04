-- Two-step verification (FR-A4; ARCHITECTURE.md sections 5.5, 6.1, 8; OPEN_QUESTIONS.md D8, D17, D37). The aal2 gate of
-- invitations and of the member-management RPCs exists since the organizations migration; this one adds the gate on
-- platform_staff, the status lists, the administrator's MFA reset and the two queues it writes to.

create extension pgmq;

-- Written by reset_mfa. account_ops is read by the account-ops function (FR-A7), notifications by notify (FR-I2);
-- neither exists yet, so the messages wait. No API role has a grant on the queue tables.
select pgmq.create('account_ops');
select pgmq.create('notifications');

-- Staff must be at aal2 to read their own rows, so the page guard asks a function: it needs the role to tell a user
-- who must still enrol (staff at aal1) from one who has no business on the page (revoked or never staff).
create policy platform_staff_requires_mfa on public.platform_staff
  as restrictive for all to authenticated
  using ((select private.is_aal2()));

create function public.my_platform_roles() returns setof public.platform_role
language sql
stable
security definer
set search_path = ''
as $$
  select s.role
  from public.platform_staff s
  where s.user_id = (select auth.uid()) and s.revoked_at is null
  order by s.role
$$;

revoke all on function public.my_platform_roles() from public, anon, authenticated, service_role;
grant execute on function public.my_platform_roles() to authenticated;

-- mfa_enrolled is a boolean only: no factor id, secret or name leaves auth.mfa_factors. It is null for a plain member,
-- who is not required to enrol (FR-A4 roles). The result is bounded by the API row limit.
create function public.list_organization_members(p_org uuid)
returns table (user_id uuid, role public.member_role, accepted_at timestamptz, mfa_enrolled boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;

  return query
  select
    m.user_id,
    m.role,
    m.accepted_at,
    case when m.role = 'member' then null else exists (
      select 1 from auth.mfa_factors f
      where f.user_id = m.user_id and f.factor_type = 'totp' and f.status = 'verified'
    ) end
  from public.organization_members m
  where m.organization_id = p_org and m.accepted_at is not null
  order by private.role_rank(m.role) desc, m.accepted_at, m.user_id
  limit 100;
end;
$$;

revoke all on function public.list_organization_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_organization_members(uuid) to authenticated;

create function public.list_platform_staff()
returns table (id bigint, user_id uuid, role public.platform_role, granted_at timestamptz, mfa_enrolled boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_platform_role('admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;

  return query
  select
    s.id,
    s.user_id,
    s.role,
    s.granted_at,
    exists (
      select 1 from auth.mfa_factors f
      where f.user_id = s.user_id and f.factor_type = 'totp' and f.status = 'verified'
    )
  from public.platform_staff s
  where s.revoked_at is null
  order by s.granted_at, s.id
  limit 100;
end;
$$;

revoke all on function public.list_platform_staff() from public, anon, authenticated, service_role;
grant execute on function public.list_platform_staff() to authenticated;

-- A lost device without a backup factor (D17). The factors are deleted and the user signed out by the account-ops
-- function, which reads the job; nothing is deleted here. The job is idempotent, so a second call for the same user
-- only queues a second harmless job.
create function public.reset_mfa(p_user_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(p_reason, E' \t\r\n');
begin
  if v_uid is null or not private.has_platform_role('admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;
  if p_user_id = v_uid then
    raise exception 'CHARA_FORBIDDEN' using detail = 'own_account';
  end if;
  if v_reason is null or char_length(v_reason) not between 10 and 500 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'reason';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'user';
  end if;

  perform audit.record('mfa_reset', 'user', p_user_id::text, jsonb_build_object('reason', v_reason));
  perform pgmq.send('account_ops', jsonb_build_object('action', 'reset_mfa', 'user_id', p_user_id));
  perform pgmq.send('notifications', jsonb_build_object('kind', 'mfa_reset', 'user_id', p_user_id, 'mandatory', true));
end;
$$;

revoke all on function public.reset_mfa(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.reset_mfa(uuid, text) to authenticated;
