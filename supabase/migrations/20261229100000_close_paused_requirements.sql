-- A paused workforce requirement closes at its closing date too (FR-M2 step Expire; decision 3.5; docs/phase-2/DATA_MODEL.md
-- sections 6 and 7; release 2b). V33 let the daily job close open requirements only, so a requirement paused by the
-- employer or by a lapse (pause_requirements_on_lapse) stayed paused past its closes_on for ever, and its pending
-- invitations never expired (the V41 expiry runs on close or fill). Decision 3.5 closes a requirement at its date "unless
-- the employer extends it", without an exception for a pause, and a paused requirement can already be extended (FR-M2 AC7)
-- but not reopened once its date has passed (closes_on_passed). So the daily job now closes paused requirements past
-- their date as it closes open ones (reason expired, one audit row each, the invitations expired by the V41 trigger), and
-- the employer's closing reminder goes out for a paused requirement too, so the Extend offer comes before the close.
-- This departs from the assumed default of FR-M2 AC5 ("a paused requirement is not closed by the daily job").

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

-- private.close_expired_requirements of 20261216100000_requirement_lifecycle.sql with one change: paused requirements
-- whose closing date has passed are closed too. Daily (close-expired-requirements): every open or paused requirement whose
-- closing date (a UTC day) is before today closes with the reason expired, one audit row each with actor_fn
-- close_expired_requirements and no actor; a second run finds nothing. Runs whatever release_job_orders says. Returns the
-- number closed.
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
  where r.status in ('open', 'paused') and r.closes_on < (now() at time zone 'utc')::date;
  get diagnostics v_count = row_count;
  perform set_config('chara.actor_fn', '', true);
  return v_count;
end;
$$;

-- private.remind_closing_requirements of 20261216100000_requirement_lifecycle.sql with one change: a paused requirement
-- is reminded as an open one is, since it now closes at its date too. Everything else is unchanged.
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
    where r.status in ('open', 'paused') and r.closes_on between v_today and v_today + v_days
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

comment on column public.workforce_requirements.closes_on is
  'The UTC day after which the daily job closes an open or paused requirement: set at the first Draft -> Open to the later of the start date and requirement_open_days after publication, moved by extend_requirement and by a later start date.';
