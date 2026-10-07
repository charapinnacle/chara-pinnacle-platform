-- Application status pipeline (FR-D2; ARCHITECTURE.md sections 4, 10.4; OPEN_QUESTIONS.md P13, P14, P17, C11, C16).
-- An application moves Applied -> Viewed -> Shortlisted -> Interview -> Offer -> Hired, or to Not selected (stored as
-- rejected) from any state before the final ones, or to Withdrawn (the candidate, FR-D4). Two RPCs make the moves of the
-- employer side: set_application_status (a member of the job's organisation picks the target) and mark_application_viewed
-- (the system's move on the first open). The trigger below judges every change of status, so the database owner has no
-- way around the table either; the RPCs add who may ask, the plan and the history.
-- Each change writes, in one transaction, the status, one event (the note is visible to the candidate), the audit row,
-- the share expiry for Hired and Not selected, and one queue message for the candidate (no message for Viewed). The
-- queue message is the email of FR-D6; notify and the notifications table come with FR-I2.

insert into private.settings (key, value) values ('application_status_note_max_chars', '1000');

-- Read-only past applicants (ARCHITECTURE.md section 10.4): a lapsed organisation, and any organisation on free_employer
-- once limits are enforced, cannot change application states. Candidates' own calls never come through here.
create function private.assert_org_writable(p_org uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.free_plan_restricted(p_org) then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'read_only_free_plan';
  end if;
end;
$$;

revoke all on function private.assert_org_writable(uuid) from public, anon, authenticated, service_role;

-- The transition table of ARCHITECTURE.md section 4 as one function, p_fn naming the function that asks (the value of
-- chara.actor_fn): Viewed only by mark_application_viewed, the employer's moves only by set_application_status, Withdrawn
-- only by withdraw_application. Hired, Not selected and Withdrawn have no way out; a move to the same state is no move.
create function private.application_transition_allowed(
  p_from public.application_status, p_to public.application_status, p_fn text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_fn
    when 'mark_application_viewed' then p_from = 'applied' and p_to = 'viewed'
    when 'set_application_status' then
      (p_from in ('applied', 'viewed') and p_to in ('shortlisted', 'interview', 'rejected'))
      or (p_from = 'shortlisted' and p_to in ('interview', 'offer', 'rejected'))
      or (p_from = 'interview' and p_to in ('offer', 'rejected'))
      or (p_from = 'offer' and p_to in ('hired', 'rejected'))
    when 'withdraw_application' then
      p_from in ('applied', 'viewed', 'shortlisted', 'interview', 'offer') and p_to = 'withdrawn'
  end, false)
$$;

revoke all on function private.application_transition_allowed(public.application_status, public.application_status, text)
  from public, anon, authenticated, service_role;

-- A refusal raises CHARA_INVALID_TRANSITION (the detail names both states, nothing else). The plan feature is checked
-- here too, so no path can shortlist for an organisation whose plan lacks it (ARCHITECTURE.md section 10.4).
create function private.applications_guard_transition() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.application_transition_allowed(old.status, new.status, current_setting('chara.actor_fn', true)) then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = old.status || ' to ' || new.status;
  end if;
  if new.status = 'shortlisted' and not private.has_feature(new.organization_id, 'shortlisting') then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'shortlisting';
  end if;
  return new;
end;
$$;

revoke all on function private.applications_guard_transition() from public, anon, authenticated, service_role;

create trigger applications_guard_transition
  before update of status on public.job_applications
  for each row when (old.status is distinct from new.status)
  execute function private.applications_guard_transition();

alter table public.job_applications enable always trigger applications_guard_transition;

-- The note of a stage change: trimmed, an empty note is no note, at most application_status_note_max_chars characters.
create function private.normalize_status_note(p_note text) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(regexp_replace(coalesce(p_note, ''), '^\s+|\s+$', '', 'g'), '');
  v_max integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'application_status_note_max_chars');
begin
  if v_max is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'application_status_note_max_chars';
  end if;
  if length(v_note) > v_max then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_note';
  end if;
  return v_note;
end;
$$;

revoke all on function private.normalize_status_note(text) from public, anon, authenticated, service_role;

-- The one place a status changes: the transition (checked here for the same-state case the trigger never sees, and again
-- by the trigger), the event, the share expiry, the audit row and the queue message. p_actor is the user the event names
-- (null for the system's Viewed). The caller has found the application, locked it and checked who may ask.
create function private.move_application(
  p_app public.job_applications, p_to public.application_status, p_fn text, p_actor uuid, p_note text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  if not private.application_transition_allowed(p_app.status, p_to, p_fn) then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = p_app.status || ' to ' || p_to;
  end if;
  if p_to in ('hired', 'rejected') then
    select (s.value #>> '{}')::integer into v_days from private.settings s where s.key = 'share_expiry_days_after_final';
    if v_days is null then
      raise exception 'CHARA_SETTING_MISSING' using detail = 'share_expiry_days_after_final';
    end if;
  end if;

  perform set_config('chara.actor_fn', p_fn, true);
  update public.job_applications set status = p_to where id = p_app.id;
  perform set_config('chara.actor_fn', '', true);

  insert into public.application_events (application_id, from_status, to_status, actor_id, note)
  values (p_app.id, p_app.status, p_to, p_actor, p_note);
  if p_to in ('hired', 'rejected') then
    update public.passport_shares s set expires_at = now() + make_interval(days => v_days)
    where s.application_id = p_app.id and s.revoked_at is null and s.expires_at is null;
  end if;
  perform audit.record(
    'application.status_changed', 'job_application', p_app.id::text,
    jsonb_build_object('organization_id', p_app.organization_id, 'from', p_app.status, 'to', p_to)
  );
  -- An erased candidate's application belongs to a pseudonym that has no profile: nobody to tell.
  if p_to <> 'viewed' and exists (select 1 from public.profiles p where p.id = p_app.worker_user_id) then
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'status_changed', 'user_id', p_app.worker_user_id, 'application_id', p_app.id, 'job_id', p_app.job_id,
      'status', p_to, 'mandatory', true
    ));
  end if;
end;
$$;

revoke all on function private.move_application(public.job_applications, public.application_status, text, uuid, text)
  from public, anon, authenticated, service_role;

-- One application for the caller as an accepted member of the job's organisation, locked for the move. An application
-- of another organisation is the same CHARA_NOT_FOUND as one that does not exist. The organisation must be active and
-- writable (CHARA_FEATURE_NOT_IN_PLAN, detail read_only_free_plan, from assert_org_writable). Shared by set_application_status
-- and bulk_set_application_status.
create function private.change_application_status(p_application_id uuid, p_status public.application_status, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.job_applications;
begin
  select a.* into v_app from public.job_applications a
  where a.id = p_application_id and a.organization_id in (select private.member_org_ids())
  for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.organizations o where o.id = v_app.organization_id and o.status <> 'active') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
  end if;
  perform private.assert_org_writable(v_app.organization_id);
  perform private.move_application(v_app, p_status, 'set_application_status', (select auth.uid()), p_note);
end;
$$;

revoke all on function private.change_application_status(uuid, public.application_status, text)
  from public, anon, authenticated, service_role;

-- A member of the job's organisation (owner, admin or member; owners and admins reach the page at aal2, which the page
-- checks) moves an application to p_status with an optional note that the candidate sees. Applied, Viewed and Withdrawn
-- are no targets for an employer. Errors: CHARA_FORBIDDEN (not a company account; detail organization_suspended),
-- CHARA_NOT_FOUND, CHARA_INVALID_INPUT (detail p_note), CHARA_INVALID_TRANSITION, CHARA_FEATURE_NOT_IN_PLAN (detail
-- shortlisting, or read_only_free_plan), CHARA_SETTING_MISSING.
create function public.set_application_status(
  p_application_id uuid, p_status public.application_status, p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  perform private.change_application_status(p_application_id, p_status, private.normalize_status_note(p_note));
end;
$$;

revoke all on function public.set_application_status(uuid, public.application_status, text) from public, anon, authenticated, service_role;
grant execute on function public.set_application_status(uuid, public.application_status, text) to authenticated;

-- The system's move Applied -> Viewed, the only path to Viewed: the first open by a member of the job's organisation. A
-- later open, an application in any other state, a suspended organisation and a restricted free plan change nothing and
-- raise nothing. The event has no actor (the system moved it) and no notification is queued.
create function public.mark_application_viewed(p_application_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.job_applications;
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  select a.* into v_app from public.job_applications a
  where a.id = p_application_id and a.organization_id in (select private.member_org_ids())
  for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_app.status <> 'applied'
     or exists (select 1 from public.organizations o where o.id = v_app.organization_id and o.status <> 'active')
     or private.free_plan_restricted(v_app.organization_id) then
    return;
  end if;
  perform private.move_application(v_app, 'viewed', 'mark_application_viewed', null, null);
end;
$$;

revoke all on function public.mark_application_viewed(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_application_viewed(uuid) to authenticated;
