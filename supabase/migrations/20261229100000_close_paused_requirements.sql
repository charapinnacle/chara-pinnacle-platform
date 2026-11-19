-- A paused workforce requirement closes at its closing date too, unless the pause came from a lapsed subscription (FR-M2
-- step Expire; decision 3.5; docs/phase-2/DATA_MODEL.md sections 6 and 7; release 2b). V33 let the daily job close open
-- requirements only, so a requirement paused by the employer stayed paused past its closes_on for ever, and its pending
-- invitations never expired (the V41 expiry runs on close or fill). Decision 3.5 closes a requirement at its date "unless
-- the employer extends it", and a paused requirement can already be extended (FR-M2 AC7) but not reopened once its date
-- has passed (closes_on_passed). So the daily job now closes a requirement the employer paused once its date has passed,
-- as it closes an open one (reason expired, one audit row, the invitations expired by the V41 trigger), and the closing
-- reminder covers it, so the Extend offer comes first. A requirement paused by pause_requirements_on_lapse is left alone:
-- the employer did not choose the pause and extends or reopens it after subscribing again. Which pause it was is read from
-- the newest requirement.status_changed audit row of the requirement (actor_fn pause_requirements_on_lapse), which every
-- status change writes; no column repeats it. The paused requirements already past their date when this ships are moved
-- to today plus requirement_closing_reminder_days, so each is reminded before it closes. This departs from FR-M2 AC5,
-- whose text keeps every paused requirement open (the AC open point "A paused requirement is not closed by the daily
-- job. Assumed."); decided (user delegated), for the client's sign-off.

-- Whether the requirement p_requirement is paused because its organisation's subscription lapsed: its newest status
-- change was made by pause_requirements_on_lapse. A requirement without such a row (or whose rows retention removed after
-- six years) counts as paused by the employer.
create function private.requirement_paused_by_lapse(p_requirement uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select l.metadata ->> 'actor_fn' = 'pause_requirements_on_lapse'
    from audit.log l
    where l.entity_id = p_requirement::text and l.action = 'requirement.status_changed'
    order by l.id desc
    limit 1), false)
$$;

revoke all on function private.requirement_paused_by_lapse(uuid) from public, anon, authenticated, service_role;

-- private.requirements_guard_transition of 20261216100000_requirement_lifecycle.sql with one change: with chara.actor_fn
-- close_expired_requirements the move Paused -> Closed is accepted next to Open -> Closed (reason expired). Every other
-- rule is unchanged.
create or replace function private.requirements_guard_transition() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_fn text := coalesce(current_setting('chara.actor_fn', true), '');
begin
  if not (
    (old.status = 'draft' and new.status = 'open')
    or (old.status = 'open' and new.status in ('paused', 'closed', 'filled'))
    or (old.status = 'paused' and new.status in ('open', 'closed'))
  ) or (v_actor_fn = 'close_expired_requirements' and not (old.status in ('open', 'paused') and new.status = 'closed'))
    or (v_actor_fn = 'pause_requirements_on_lapse' and not (old.status = 'open' and new.status = 'paused'))
    or v_actor_fn not in ('', 'close_expired_requirements', 'pause_requirements_on_lapse') then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = old.status || ' to ' || new.status;
  end if;

  if v_actor_fn = ''
     and ((select auth.uid()) is null or not private.is_org_member(new.organization_id, 'admin')) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;

  new.status_changed_at := now();
  if old.status = 'draft' then
    new.published_at := coalesce(old.published_at, now());
    new.closes_on := coalesce(old.closes_on, private.requirement_closes_on((now() at time zone 'utc')::date, new.start_date));
  end if;
  if new.status = 'filled' then
    new.close_reason := 'filled';
  elsif v_actor_fn = 'close_expired_requirements' then
    new.close_reason := 'expired';
  end if;
  return new;
end;
$$;

-- The daily jobs read the open and the paused requirements by their closing date.
create index workforce_requirements_live_closes_on_idx on public.workforce_requirements (closes_on)
  where status in ('open', 'paused');
drop index public.workforce_requirements_open_closes_on_idx;

-- private.close_expired_requirements of 20261216100000_requirement_lifecycle.sql with one change: requirements the
-- employer paused whose closing date has passed are closed too; those paused by a lapse are not. Daily
-- (close-expired-requirements): every such requirement whose closing date (a UTC day) is before today closes with the
-- reason expired, one audit row each with actor_fn close_expired_requirements and no actor; a second run finds nothing.
-- Runs whatever release_job_orders says. Returns the number closed.
create or replace function private.close_expired_requirements() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform set_config('chara.actor_fn', 'close_expired_requirements', true);
  update public.workforce_requirements r
  set status = 'closed', updated_at = clock_timestamp()
  where r.closes_on < (now() at time zone 'utc')::date
    and (r.status = 'open' or (r.status = 'paused' and not private.requirement_paused_by_lapse(r.id)));
  get diagnostics v_count = row_count;
  perform set_config('chara.actor_fn', '', true);
  return v_count;
end;
$$;

-- private.remind_closing_requirements of 20261216100000_requirement_lifecycle.sql with one change: a requirement the
-- employer paused is reminded as an open one is, since it now closes at its date too (one paused by a lapse does not
-- close and is not reminded). Everything else is unchanged.
create or replace function private.remind_closing_requirements() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_days integer := coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,4}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'requirement_closing_reminder_days'), 7);
  v_row record;
  v_count integer := 0;
begin
  if not private.release_on('release_job_orders') then
    return 0;
  end if;
  for v_row in
    update public.workforce_requirements r
    set closing_reminder_for = r.closes_on
    where r.closes_on between v_today and v_today + v_days
      and (r.status = 'open' or (r.status = 'paused' and not private.requirement_paused_by_lapse(r.id)))
      and r.closing_reminder_for is distinct from r.closes_on
      and exists (select 1 from public.organizations o where o.id = r.organization_id and o.status = 'active')
    returning r.id, r.organization_id, r.closes_on
  loop
    perform private.queue_org_event(v_row.organization_id, 'requirement_closing_soon',
      jsonb_build_object('requirement_id', v_row.id), 'requirement_closing_soon:' || v_row.id || ':' || v_row.closes_on);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- The backlog when this ships: every requirement the employer paused whose closing date has passed moves to today plus
-- requirement_closing_reminder_days, with one audit row requirement.extended each (no actor, reason
-- paused_close_introduced), so the reminder reaches the employer and the partners before the daily job closes it.
-- Answers the number moved; run once below.
create function private.shift_paused_close_backlog() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to date := (now() at time zone 'utc')::date + coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,4}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'requirement_closing_reminder_days'), 7);
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select r.id, r.organization_id, r.closes_on from public.workforce_requirements r
    where r.status = 'paused' and r.closes_on < (now() at time zone 'utc')::date
      and not private.requirement_paused_by_lapse(r.id)
    for update
  loop
    update public.workforce_requirements r set closes_on = v_to, updated_at = clock_timestamp() where r.id = v_row.id;
    perform audit.record('requirement.extended', 'requirement', v_row.id::text,
      jsonb_build_object('organization_id', v_row.organization_id, 'from', v_row.closes_on, 'to', v_to,
        'reason', 'paused_close_introduced'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.shift_paused_close_backlog() from public, anon, authenticated, service_role;

select private.shift_paused_close_backlog();

comment on column public.workforce_requirements.closes_on is
  'The UTC day after which the daily job closes an open requirement, or one the employer paused (not one paused by a lapse): set at the first Draft -> Open to the later of the start date and requirement_open_days after publication, moved by extend_requirement and by a later start date.';
