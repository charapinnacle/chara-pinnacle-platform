-- Plan limits on open vacancies (FR-C6; ARCHITECTURE.md sections 5.6, 10.4; OPEN_QUESTIONS.md C9, C11, D48). The number
-- of Open vacancies of an organisation is capped by the active_jobs limit of its plan (billing.plan_limits, seeded by
-- FR-G1 and changed only by a reviewed migration). The trigger below counts on every change to Open, serialised per
-- organisation so that two publishes at the same moment cannot both pass. The helpers it calls (private.org_limit,
-- private.assert_within_limit) came with FR-G1: they decide whether the limit applies at all (the setting
-- entitlements_enforced, or an organisation that lapsed to the free plan), an unknown plan denies, a null limit is
-- unlimited. This migration adds the trigger, the read the upgrade prompt needs and the event the prompt writes.

-- The count of Open vacancies of one organisation (the trigger, the view and the prompt event read it).
create index jobs_organization_open_idx on public.jobs (organization_id) where status = 'open' and deleted_at is null;

-- Runs for a draft, paused or closed vacancy that becomes Open, and for a row inserted as Open (no API role can
-- insert a status; the database owner can). It sorts after jobs_guard_transition on purpose: the guard refuses a wrong
-- role or a change the table does not list first, so a member or a soft-deleted vacancy never reads as a limit.
-- The organisation row is locked FOR NO KEY UPDATE, which excludes a second publish of the same organisation but not
-- the foreign-key checks of unrelated inserts; the lock is taken in its own statement so that the count that follows
-- sees what the other transaction committed. Every Open vacancy counts, a hidden one too; a soft-deleted one does not.
create function private.jobs_enforce_limits() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'open' then
    return new;
  end if;

  perform 1 from public.organizations o where o.id = new.organization_id for no key update;
  perform private.assert_within_limit(
    new.organization_id, 'active_jobs',
    (select count(*)::integer from public.jobs j
     where j.organization_id = new.organization_id and j.status = 'open' and j.deleted_at is null and j.id <> new.id)
  );
  return new;
end;
$$;

revoke all on function private.jobs_enforce_limits() from public, anon, authenticated, service_role;

create trigger jobs_limit_check
  before insert or update of status on public.jobs
  for each row when (new.status = 'open')
  execute function private.jobs_enforce_limits();

alter table public.jobs enable always trigger jobs_limit_check;

-- The plan, its limit and the number of Open vacancies, for the members of an organisation: the upgrade prompt says
-- "3 of 3 open vacancies" and names the plan from billing.plans. Row level security of the invoker decides the rows: the
-- organisations the caller is a member of. The limit is the one of the plan whether or not it is enforced (null is
-- unlimited, and an unknown plan reads 0); it is only shown after a refusal, which only happens when it applies.
-- No API role can select the limit overrides or execute private.org_limit, so the view reads the limit through this
-- narrow definer function, which answers for the organisations of the caller only (null for any other).
create function private.member_org_job_limit(p_org uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$ select private.org_limit(p_org, 'active_jobs') where private.is_org_member(p_org) $$;

revoke all on function private.member_org_job_limit(uuid) from public, anon, authenticated, service_role;
grant execute on function private.member_org_job_limit(uuid) to authenticated;

create view public.v_org_limits with (security_invoker = true) as
select
  o.id as organization_id,
  p.code as plan_code,
  p.name as plan_name,
  private.member_org_job_limit(o.id) as active_jobs_limit,
  (select count(*)::integer from public.jobs j
   where j.organization_id = o.id and j.status = 'open' and j.deleted_at is null) as open_jobs
from public.organizations o
left join billing.plans p on p.code = private.org_plan_code(o.id);

revoke all on public.v_org_limits from public, anon, authenticated, service_role;
grant select on public.v_org_limits to authenticated;

-- The KPI "upgrade conversions from limit prompts" needs the prompts shown, and a refusal rolls its own audit row back.
-- The web tier reports each prompt it shows here. The function re-derives the facts: it records only when the
-- organisation really is at its limit (nothing the caller sends is stored), only for an owner or admin, and at most
-- the ceiling per user and hour, so the append-only audit log cannot be filled through it. Beyond the ceiling, or when
-- the organisation is not at its limit, the call does nothing.
insert into private.settings (key, value) values ('limit_prompt_per_hour_max', '30');

create index log_limit_prompt_actor_idx on audit.log (actor_id, created_at) where action = 'limit.prompt_shown';

create function public.record_job_limit_prompt(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'limit_prompt_per_hour_max');
  v_open integer;
begin
  if v_uid is null or not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if (select count(*) from audit.log l
      where l.action = 'limit.prompt_shown' and l.actor_id = v_uid and l.created_at > now() - interval '1 hour')
     >= coalesce(v_max, 0) then
    return;
  end if;

  v_open := (select count(*)::integer from public.jobs j
             where j.organization_id = p_org and j.status = 'open' and j.deleted_at is null);
  begin
    perform private.assert_within_limit(p_org, 'active_jobs', v_open);
    return;
  exception when raise_exception then
    if sqlerrm <> 'CHARA_LIMIT_REACHED' then
      return;
    end if;
  end;

  perform audit.record(
    'limit.prompt_shown', 'organization', p_org::text,
    jsonb_build_object(
      'limit_key', 'active_jobs', 'plan_code', private.org_plan_code(p_org),
      'limit', private.org_limit(p_org, 'active_jobs'), 'open_jobs', v_open
    )
  );
end;
$$;

revoke all on function public.record_job_limit_prompt(uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_job_limit_prompt(uuid) to authenticated;
