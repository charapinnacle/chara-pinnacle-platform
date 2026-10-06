-- Vacancy lifecycle (FR-C2; ARCHITECTURE.md section 5.6; OPEN_QUESTIONS.md D47). A vacancy moves Draft -> Open -> Paused
-- -> Closed or Filled, and only an Open, visible, undeleted vacancy is public (the policy jobs_select_public of FR-C1).
-- The owner or an admin of the organisation changes the status straight through the Data API under row level security;
-- the trigger below is the only judge of which change is allowed, so no caller has another path. The one change the
-- system makes is Open -> Paused when an organisation lapses to the free plan, through private.pause_jobs_on_lapse.
-- The active_jobs limit check on Draft -> Open, Paused -> Open and Closed -> Open is FR-C6.

alter table public.jobs
  add column status_changed_at timestamptz not null default now(),
  add column published_at timestamptz;

comment on column public.jobs.status_changed_at is
  'When the status last changed (the creation time while it is still Draft); set by the guard trigger, read by the stale flag.';
comment on column public.jobs.published_at is
  'When the vacancy first became Open; set once by the guard trigger, the datePosted of the vacancy page.';

grant select (status_changed_at, published_at) on public.jobs to anon, authenticated;
grant update (status) on public.jobs to authenticated;

-- The error codes are the stable messages of the other functions: CHARA_INVALID_TRANSITION for a change the table does
-- not list (the detail names both statuses, nothing else), CHARA_FORBIDDEN for a caller who is not an owner or admin
-- of the organisation. A change to the status the vacancy already has does not fire the trigger: it is a no-op.
create function private.jobs_guard_transition() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system boolean := coalesce(current_setting('chara.actor_fn', true), '') = 'pause_jobs_on_lapse';
begin
  if not (
    (old.status = 'draft' and new.status = 'open')
    or (old.status = 'open' and new.status in ('paused', 'closed', 'filled'))
    or (old.status = 'paused' and new.status in ('open', 'closed', 'filled'))
    or (old.status = 'closed' and new.status = 'open')
  ) or (v_system and not (old.status = 'open' and new.status = 'paused')) then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = old.status || ' to ' || new.status;
  end if;

  if not v_system
     and ((select auth.uid()) is null or not private.is_org_member(new.organization_id, 'admin')) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;

  new.status_changed_at := now();
  if new.status = 'open' then
    new.published_at := coalesce(old.published_at, now());
  end if;
  return new;
end;
$$;

revoke all on function private.jobs_guard_transition() from public, anon, authenticated, service_role;

create trigger jobs_guard_transition
  before update of status on public.jobs
  for each row when (old.status is distinct from new.status)
  execute function private.jobs_guard_transition();

alter table public.jobs enable always trigger jobs_guard_transition;

-- The lapse of a subscription (FR-G4) calls this in the same transaction. It sets the only setting the guard accepts for
-- a change without a signed-in user, pauses every Open vacancy of the organisation (a second run finds none) and clears
-- the setting, so nothing later in the transaction inherits it. Called by billing_apply_event (U47); until then no role
-- but billing_owner may execute it, and billing_owner needs usage on schema private, which that unit grants.
create function private.pause_jobs_on_lapse(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('chara.actor_fn', 'pause_jobs_on_lapse', true);
  update public.jobs set status = 'paused' where organization_id = p_org and status = 'open';
  perform set_config('chara.actor_fn', '', true);
end;
$$;

revoke all on function private.pause_jobs_on_lapse(uuid) from public, anon, authenticated, service_role;
grant execute on function private.pause_jobs_on_lapse(uuid) to billing_owner;

-- Replaces the audit trigger function of FR-C1: a status change is now its own action, job.status_changed, with the old
-- and the new status (what the KPI "average time open" reads) and, for the system change, the function that made it;
-- job.updated keeps naming the other columns that changed and no longer carries the status.
create or replace function private.jobs_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb;
  v_actor_fn text := coalesce(current_setting('chara.actor_fn', true), '');
begin
  if tg_op = 'INSERT' then
    perform audit.record('job.created', 'job', new.id::text, jsonb_build_object('organization_id', new.organization_id));
  elsif tg_op = 'DELETE' then
    perform audit.record('job.deleted', 'job', old.id::text, jsonb_build_object('organization_id', old.organization_id));
  else
    if new.status <> old.status then
      perform audit.record(
        'job.status_changed', 'job', new.id::text,
        jsonb_build_object('organization_id', new.organization_id, 'from', old.status, 'to', new.status)
          || case when v_actor_fn <> '' then jsonb_build_object('actor_fn', v_actor_fn) else '{}'::jsonb end
      );
    end if;
    v_old := to_jsonb(old) - 'search_vector';
    v_new := to_jsonb(new) - 'search_vector';
    select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from v_old -> n.key
      and n.key not in ('status', 'status_changed_at', 'published_at');
    if jsonb_array_length(v_changed) > 0 then
      perform audit.record(
        'job.updated', 'job', new.id::text,
        jsonb_build_object('organization_id', new.organization_id, 'changed_fields', v_changed)
      );
    end if;
  end if;
  return null;
end;
$$;
