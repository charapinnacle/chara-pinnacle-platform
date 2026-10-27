-- Workforce requirement lifecycle (FR-M2, SOP P2-16; decision 3.5; NFR-O5; docs/phase-2/DATA_MODEL.md sections 2, 4, 6,
-- 7 and 9; release 2b). A requirement moves Draft -> Open -> Paused <-> Open; Open or Paused -> Closed (with a reason)
-- or Open -> Filled; Closed and Filled are final, and a paused requirement is not filled (DATA_MODEL section 11.3).
-- An owner or admin at aal2 publishes a draft (publish_requirement: private or job order marketplace, the employer name
-- shown or not), changes the status (set_requirement_status) and extends the closing date (extend_requirement). The
-- trigger below is the only judge of which change is allowed, and two system changes pass it: close_expired_requirements
-- (Open -> Closed, reason expired, daily) and pause_requirements_on_lapse (Open -> Paused when the subscription lapses,
-- through private.pause_jobs_on_lapse as the vacancies are). Every change is one audit row requirement.status_changed.
-- An open requirement closes at the later of its start date and requirement_open_days (90) after publication unless it
-- is extended by requirement_extension_days (30); requirement_closing_reminder_days (7) before, the employer's owners
-- and admins get requirement_closing_soon. The durations are settings of the settings editor, not constants.
-- Later units: the active_requirements limit at publish and reopen V34, the job order board V39, invitations (and their
-- expiry on close) V41, responses held while paused V44, versions, change notices and the closing reminder to partners
-- V43, moderation V57, retention of closed requirements V58. Every function here refuses to run while
-- release_job_orders is false, except the two system changes, which keep the data right whatever the switch says.

create type public.requirement_close_reason as enum ('filled', 'cancelled', 'expired');

alter table public.workforce_requirements
  add column published_at timestamptz,
  add column closes_on date,
  add column close_reason public.requirement_close_reason,
  add column status_changed_at timestamptz not null default now(),
  add column closing_reminder_for date,
  add constraint workforce_requirements_published check (
    status = 'draft' or (visibility is not null and published_at is not null and closes_on is not null)
  ),
  add constraint workforce_requirements_close_reason check (
    case status
      when 'filled' then close_reason is not distinct from 'filled'
      when 'closed' then coalesce(close_reason in ('cancelled', 'expired'), false)
      else close_reason is null
    end
  );

comment on column public.workforce_requirements.published_at is
  'When the requirement first became Open; set once by the guard trigger and kept on Paused -> Open.';
comment on column public.workforce_requirements.closes_on is
  'The UTC day after which the daily job closes an open requirement: set at the first Draft -> Open to the later of the start date and requirement_open_days after publication, moved by extend_requirement and by a later start date.';
comment on column public.workforce_requirements.close_reason is
  'Why the requirement ended: filled (status filled), cancelled (closed by the employer) or expired (closed by the daily job).';
comment on column public.workforce_requirements.status_changed_at is
  'When the status last changed (the creation time while it is still Draft); set by the guard trigger.';
comment on column public.workforce_requirements.closing_reminder_for is
  'The closes_on for which requirement_closing_soon was last queued, so each closing date is reminded once; an extension reminds again. Not readable through the Data API.';

grant select (published_at, closes_on, close_reason, status_changed_at) on public.workforce_requirements to authenticated;

-- The daily jobs read the open requirements by their closing date.
create index workforce_requirements_open_closes_on_idx on public.workforce_requirements (closes_on) where status = 'open';

-- Durations (NFR-O5) ----------------------------------------------------------------------------------------------------

insert into private.settings (key, value) values
  ('requirement_open_days', '90'),
  ('requirement_extension_days', '30'),
  ('requirement_closing_reminder_days', '7'),
  ('requirement_extension_horizon_days', '365')
on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('requirement_open_days', 'integer', 30, 365, 'Days a published workforce requirement stays open at least', null),
  ('requirement_extension_days', 'integer', 7, 90, 'Days one extension of a workforce requirement adds', null),
  ('requirement_closing_reminder_days', 'integer', 1, 30, 'Days before closing that the employer is reminded', null),
  ('requirement_extension_horizon_days', 'integer', 30, 1095,
    'Latest closing date an extension may reach (days after the start date or today)', null);

-- The closing date of a requirement published on p_published that starts on p_start: the later of the start date and
-- requirement_open_days after publication (decision 3.5). The web form shows the same rule (lib/requirements/lifecycle.ts).
-- A setting that is missing or not a number falls back to the 90 days of the decision.
create function private.requirement_closes_on(p_published date, p_start date) returns date
language sql
stable
set search_path = ''
as $$
  select greatest(p_start, p_published + coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,4}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'requirement_open_days'), 90))
$$;

revoke all on function private.requirement_closes_on(date, date) from public, anon, authenticated, service_role;

-- The guard ---------------------------------------------------------------------------------------------------------------

-- CHARA_INVALID_TRANSITION for a change the table does not list (the detail names both statuses); CHARA_FORBIDDEN
-- (42501) for a change without a system function that is not made by an owner or admin of the organisation. A system
-- function names itself in the transaction-local chara.actor_fn and may make only its one change. A change to the status
-- the requirement already has does not fire the trigger. Sets status_changed_at, at the first Draft -> Open published_at
-- and closes_on, and the reason a system close or a fill implies.
create function private.requirements_guard_transition() returns trigger
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
  ) or (v_actor_fn = 'close_expired_requirements' and not (old.status = 'open' and new.status = 'closed'))
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

revoke all on function private.requirements_guard_transition() from public, anon, authenticated, service_role;

create trigger workforce_requirements_guard_transition
  before update of status on public.workforce_requirements
  for each row when (old.status is distinct from new.status)
  execute function private.requirements_guard_transition();

alter table public.workforce_requirements enable always trigger workforce_requirements_guard_transition;

-- One audit row per change of status, with both statuses, the reason of a close or fill and, for a system change, the
-- function that made it (the KPIs "share closed as filled", "closed by expiry" and "median days open" read these rows
-- with published_at and status_changed_at).
create function private.requirements_status_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_fn text := coalesce(current_setting('chara.actor_fn', true), '');
begin
  perform audit.record('requirement.status_changed', 'requirement', new.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'organization_id', new.organization_id, 'from', old.status, 'to', new.status, 'close_reason', new.close_reason,
      'actor_fn', nullif(v_actor_fn, '')
    )));
  return null;
end;
$$;

revoke all on function private.requirements_status_audit() from public, anon, authenticated, service_role;

create trigger workforce_requirements_status_audit
  after update of status on public.workforce_requirements
  for each row when (old.status is distinct from new.status)
  execute function private.requirements_status_audit();

-- The employer's actions --------------------------------------------------------------------------------------------------

-- The requirement p_requirement of p_org, locked, for an owner or admin at aal2 of the active employer while release 2b is
-- on (private.assert_requirement_manager). CHARA_NOT_FOUND when p_org has no such requirement; CHARA_CONFLICT stale when
-- it changed since the caller read it (p_expected_updated_at is its updated_at then; none counts as stale).
create function private.lock_requirement(p_org uuid, p_requirement uuid, p_expected_updated_at timestamptz)
returns public.workforce_requirements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
begin
  perform private.assert_requirement_manager(p_org);
  select * into v_row from public.workforce_requirements r
  where r.id = p_requirement and r.organization_id = p_org
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_expected_updated_at is distinct from v_row.updated_at then
    raise exception 'CHARA_CONFLICT' using detail = 'stale';
  end if;
  return v_row;
end;
$$;

revoke all on function private.lock_requirement(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;

-- What the pages need after a change: the status, the closing date and the new version for the next change.
create function private.requirement_state(p_row public.workforce_requirements) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('status', p_row.status, 'closes_on', p_row.closes_on, 'close_reason', p_row.close_reason,
    'updated_at', p_row.updated_at)
$$;

revoke all on function private.requirement_state(public.workforce_requirements) from public, anon, authenticated, service_role;

-- Publishes a draft (FR-M1 step Publish, FR-M2 Draft -> Open; decisions 3.1, 3.2): private (only the partners the
-- employer invites) or job_order_marketplace, with the employer name shown only when p_show_identity is true on the
-- marketplace (a private requirement is never shown with a name). The guard sets published_at and closes_on. Refusals:
-- not a draft, CHARA_INVALID_TRANSITION (the guard's detail); a start date that has passed (the draft is older than
-- its start), CHARA_INVALID_INPUT start_date; quantities that no longer add up, CHARA_INVALID_INPUT
-- occupation_quantities; no visibility, CHARA_INVALID_INPUT visibility. Counts against the daily quota of audited
-- writes. The active_requirements limit is checked here from V34.
create function public.publish_requirement(
  p_org uuid,
  p_requirement uuid,
  p_visibility public.requirement_visibility,
  p_show_identity boolean,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
begin
  v_row := private.lock_requirement(p_org, p_requirement, p_expected_updated_at);
  if p_visibility is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'visibility';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = v_row.status || ' to open';
  end if;
  if v_row.start_date < (now() at time zone 'utc')::date then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'start_date';
  end if;
  if (select coalesce(sum(o.quantity), 0) from public.requirement_occupations o where o.requirement_id = v_row.id)
     <> v_row.workers_needed then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupation_quantities';
  end if;
  perform private.count_audited_write(p_org);

  update public.workforce_requirements r
  set status = 'open', visibility = p_visibility,
      show_identity = p_visibility = 'job_order_marketplace' and coalesce(p_show_identity, false),
      updated_at = clock_timestamp()
  where r.id = v_row.id
  returning * into v_row;
  return private.requirement_state(v_row);
end;
$$;

revoke all on function public.publish_requirement(uuid, uuid, public.requirement_visibility, boolean, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_requirement(uuid, uuid, public.requirement_visibility, boolean, timestamptz)
  to authenticated;

-- Pauses, reopens, closes or fills a published requirement (FR-M2 AC1 to AC3, AC10). Closing needs the reason cancelled
-- (expired is the daily job's, filled is the status filled), CHARA_INVALID_INPUT close_reason otherwise; another reason
-- than filled for filled is refused the same way. The status it already has is a no-op without an audit row. A draft is
-- opened by publish_requirement (CHARA_INVALID_INPUT publish_required). A paused requirement whose closing date has
-- passed is extended before it reopens (CHARA_INVALID_STATE closes_on_passed). Every other change outside the table is
-- the guard's CHARA_INVALID_TRANSITION. Counts against the daily quota of audited writes.
create function public.set_requirement_status(
  p_org uuid,
  p_requirement uuid,
  p_status public.requirement_status,
  p_expected_updated_at timestamptz,
  p_close_reason public.requirement_close_reason default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
begin
  v_row := private.lock_requirement(p_org, p_requirement, p_expected_updated_at);
  if p_status is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'status';
  end if;
  if (p_status = 'closed' and p_close_reason is distinct from 'cancelled')
     or (p_status <> 'closed' and p_close_reason is not null and not (p_status = 'filled' and p_close_reason = 'filled')) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'close_reason';
  end if;
  if v_row.status = p_status then
    return private.requirement_state(v_row);
  end if;
  if v_row.status = 'draft' and p_status = 'open' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'publish_required';
  end if;
  if v_row.status = 'paused' and p_status = 'open' and v_row.closes_on < (now() at time zone 'utc')::date then
    raise exception 'CHARA_INVALID_STATE' using detail = 'closes_on_passed';
  end if;
  perform private.count_audited_write(p_org);

  update public.workforce_requirements r
  set status = p_status, close_reason = case when p_status = 'closed' then p_close_reason end, updated_at = clock_timestamp()
  where r.id = v_row.id
  returning * into v_row;
  return private.requirement_state(v_row);
end;
$$;

revoke all on function public.set_requirement_status(
  uuid, uuid, public.requirement_status, timestamptz, public.requirement_close_reason
) from public, anon, authenticated, service_role;
grant execute on function public.set_requirement_status(
  uuid, uuid, public.requirement_status, timestamptz, public.requirement_close_reason
) to authenticated;

-- Moves the closing date of an open or paused requirement by requirement_extension_days, counted from today when the
-- date has already passed (FR-M2 AC7: "never earlier than today after an extension"). The new date may not pass
-- requirement_extension_horizon_days after the later of the start date and today (CHARA_INVALID_STATE extension_limit),
-- so a requirement is not kept open for ever. A draft, closed or filled requirement is refused (CHARA_INVALID_STATE and
-- its status). One audit row requirement.extended with both dates per call; counts against the daily quota.
create function public.extend_requirement(p_org uuid, p_requirement uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_row public.workforce_requirements;
  v_to date;
begin
  v_row := private.lock_requirement(p_org, p_requirement, p_expected_updated_at);
  if v_row.status not in ('open', 'paused') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_row.status::text;
  end if;
  v_to := greatest(v_row.closes_on, v_today) + coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,4}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'requirement_extension_days'), 30);
  if v_to > greatest(v_row.start_date, v_today) + coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,4}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'requirement_extension_horizon_days'), 365) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'extension_limit';
  end if;
  perform private.count_audited_write(p_org);

  update public.workforce_requirements r set closes_on = v_to, updated_at = clock_timestamp()
  where r.id = v_row.id;
  perform audit.record('requirement.extended', 'requirement', v_row.id::text,
    jsonb_build_object('organization_id', p_org, 'from', v_row.closes_on, 'to', v_to));
  select * into v_row from public.workforce_requirements r where r.id = v_row.id;
  return private.requirement_state(v_row);
end;
$$;

revoke all on function public.extend_requirement(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.extend_requirement(uuid, uuid, timestamptz) to authenticated;

-- System changes ------------------------------------------------------------------------------------------------------------

-- Daily (close-expired-requirements): closes every open requirement whose closing date (a UTC day) is before today with
-- the reason expired, one audit row each with actor_fn close_expired_requirements and no actor. A paused requirement is
-- not closed (it closes once it is reopened and the date has passed; reopening needs an extension first). A second run
-- finds nothing. Runs whatever release_job_orders says, so a switch turned off again leaves no requirement open past its
-- date. Returns the number closed.
create function private.close_expired_requirements() returns integer
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
  where r.status = 'open' and r.closes_on < (now() at time zone 'utc')::date;
  get diagnostics v_count = row_count;
  perform set_config('chara.actor_fn', '', true);
  return v_count;
end;
$$;

revoke all on function private.close_expired_requirements() from public, anon, authenticated, service_role;

-- Daily (remind-closing-requirements), while release 2b is on: every open requirement of an active employer that closes
-- within requirement_closing_reminder_days (today included) and has not been reminded for that date queues one
-- requirement_closing_soon to its owners and admins (private.queue_org_event, in this transaction) and is stamped with
-- the date. An extension changes the date, so the new date is reminded again; a second run the same day queues nothing.
-- The partners with an invitation or a response are told from V43, when invitations and responses exist. Returns the
-- number of requirements reminded.
create function private.remind_closing_requirements() returns integer
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
    where r.status = 'open' and r.closes_on between v_today and v_today + v_days
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

revoke all on function private.remind_closing_requirements() from public, anon, authenticated, service_role;

select cron.schedule('close-expired-requirements', '10 0 * * *', 'select private.close_expired_requirements()');
select cron.schedule('remind-closing-requirements', '20 0 * * *', 'select private.remind_closing_requirements()');

-- The lapse of a subscription (FR-G4, FR-M2 step Lapse): pauses every open requirement of the organisation, one audit row
-- each with actor_fn pause_requirements_on_lapse; drafts, paused, closed and filled rows are untouched and nothing is
-- deleted. The free employer plan allows no open requirement (active_requirements 0), so every open one is over the
-- limit of FR-M4. An owner or admin reopens them (FR-M2 Paused -> Open; the limit check is V34's). Called by
-- private.pause_jobs_on_lapse, so billing_apply_event stays as the billing unit left it; a second run finds none.
create function private.pause_requirements_on_lapse(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('chara.actor_fn', 'pause_requirements_on_lapse', true);
  update public.workforce_requirements r
  set status = 'paused', updated_at = clock_timestamp()
  where r.organization_id = p_org and r.status = 'open';
  perform set_config('chara.actor_fn', '', true);
end;
$$;

revoke all on function private.pause_requirements_on_lapse(uuid) from public, anon, authenticated, service_role;

-- private.pause_jobs_on_lapse of 20261017100000_vacancy_lifecycle.sql with one addition (DATA_MODEL section 4): after the
-- vacancies, the open requirements of the organisation are paused. The vacancy part is unchanged.
create or replace function private.pause_jobs_on_lapse(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('chara.actor_fn', 'pause_jobs_on_lapse', true);
  update public.jobs set status = 'paused' where organization_id = p_org and status = 'open' and deleted_at is null;
  perform set_config('chara.actor_fn', '', true);
  perform private.pause_requirements_on_lapse(p_org);
end;
$$;

-- The closing reminder ------------------------------------------------------------------------------------------------------

-- Optional, email on by default, for every company type: the employer's owners and admins now, the partners involved
-- from V43.
insert into private.notification_kinds (kind, mandatory, default_email, audience, label) values
  ('requirement_closing_soon', false, true, 'company', 'Workforce requirement closing reminders');

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- private.notification_payload of 20261213100000_partner_team.sql with requirement_closing_soon added: the requirement
-- id, its title and closing date, and the slug of the recipient's organisation for the link. Every other branch is
-- unchanged.
create or replace function private.notification_payload(p_kind text, p_message jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_title text;
  v_slug text;
  v_org_name text;
  v_invitation_id uuid;
  v_role public.member_role;
  v_expires timestamptz;
  v_org_type public.organization_type;
  v_decision public.partner_review_decisions;
  v_licence_id uuid;
  v_country_code text;
  v_country_name text;
  v_valid_until date;
begin
  if p_message ->> 'job_id' is not null then
    select j.id, j.title, o.slug, o.display_name into v_job_id, v_title, v_slug, v_org_name
    from public.jobs j join public.organizations o on o.id = j.organization_id
    where j.id = (p_message ->> 'job_id')::uuid;
  end if;
  if p_message ->> 'organization_id' is not null then
    select o.slug, o.display_name into v_slug, v_org_name
    from public.organizations o where o.id = (p_message ->> 'organization_id')::uuid;
  end if;
  if p_message ->> 'invitation_id' is not null then
    select i.id, i.role, i.expires_at, o.display_name, o.type into v_invitation_id, v_role, v_expires, v_org_name, v_org_type
    from public.organization_invitations i join public.organizations o on o.id = i.organization_id
    where i.id = (p_message ->> 'invitation_id')::uuid;
  end if;
  if p_message ->> 'decision_id' is not null then
    select * into v_decision from public.partner_review_decisions d where d.id = (p_message ->> 'decision_id')::bigint;
  end if;
  if p_message ->> 'licence_id' is not null then
    select l.id, l.country_code, c.name, l.valid_until into v_licence_id, v_country_code, v_country_name, v_valid_until
    from public.partner_licences l join public.countries c on c.code = l.country_code
    where l.id = (p_message ->> 'licence_id')::uuid;
  end if;

  return jsonb_strip_nulls(case p_kind
    when 'application_received' then case
      when p_message ? 'vacancies' then jsonb_build_object(
        'total', p_message -> 'total',
        'vacancies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'job_id', j.id, 'job_title', j.title, 'org_name', o.display_name, 'org_slug', o.slug, 'count', v.item -> 'count'
          ) order by v.position)
          from jsonb_array_elements(p_message -> 'vacancies') with ordinality as v(item, position)
          join public.jobs j on j.id = (v.item ->> 'job_id')::uuid
          join public.organizations o on o.id = j.organization_id
        ), '[]'::jsonb))
      else jsonb_build_object(
        'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name, 'org_slug', v_slug)
    end
    when 'status_changed' then jsonb_build_object(
      'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name,
      'status', p_message -> 'status')
    when 'vacancy_hidden' then jsonb_build_object(
      'job_id', v_job_id, 'job_title', v_title, 'org_slug', v_slug, 'reasons', p_message -> 'reasons',
      'moderation_action_id', p_message -> 'moderation_action_id')
    when 'trial_ending' then jsonb_build_object(
      'org_slug', v_slug, 'trial_ends_at', p_message -> 'trial_ends_at', 'plan_code', p_message -> 'plan_code',
      'plan_name', p_message -> 'plan_name',
      'amount_minor', p_message -> 'amount_minor', 'currency', p_message -> 'currency')
    when 'payment_failed' then jsonb_build_object('org_slug', v_slug)
    when 'legal_version' then jsonb_build_object(
      'document_slug', p_message -> 'document_slug', 'version', p_message -> 'version',
      'change_summary', p_message -> 'change_summary')
    when 'account_suspended' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug,
      'moderation_action_id', p_message -> 'moderation_action_id')
    when 'account_reinstated' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug)
    when 'member_invitation' then jsonb_build_object(
      'invitation_id', v_invitation_id, 'org_name', v_org_name, 'role', v_role, 'expires_at', v_expires, 'org_type', v_org_type)
    when 'deletion_requested' then jsonb_build_object('erases_on', p_message -> 'erases_on')
    when 'erasure_paused' then jsonb_build_object('account_id', p_message -> 'user_id')
    -- The reason of an approval stays in the staff record, as in partner_review_outcome.
    when 'partner_approved' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at)
    when 'partner_info_requested' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at,
      'info_step', v_decision.info_step, 'reason', v_decision.reason)
    when 'partner_declined' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at,
      'reason', v_decision.reason)
    when 'licence_expiring' then jsonb_build_object(
      'licence_id', v_licence_id, 'country_code', v_country_code, 'country_name', v_country_name,
      'valid_until', v_valid_until, 'org_name', v_org_name, 'org_slug', v_slug)
    when 'partner_licence_expired' then jsonb_build_object(
      'licence_id', v_licence_id, 'country_code', v_country_code, 'country_name', v_country_name,
      'valid_until', v_valid_until, 'org_name', v_org_name, 'org_slug', v_slug)
    -- The ten listings confirmed longest ago are named; total says how many are due.
    when 'listing_confirmation_due' then jsonb_build_object(
      'org_name', v_org_name, 'org_slug', v_slug,
      'total', jsonb_array_length(coalesce(p_message -> 'listing_ids', '[]'::jsonb)),
      'stale_days', (select (s.value #>> '{}')::integer from private.settings s where s.key = 'workforce_listing_stale_days'),
      'listings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'listing_id', x.id, 'occupation', x.label, 'country_name', x.name, 'confirmed_at', x.confirmed_at
        ) order by x.confirmed_at, x.id)
        from (
          select w.id, oc.label, c.name, w.confirmed_at
          from jsonb_array_elements_text(coalesce(p_message -> 'listing_ids', '[]'::jsonb)) e(id)
          join public.workforce_availability w on w.id = e.id::uuid
          join public.occupations oc on oc.code = w.occupation_id
          join public.countries c on c.code = w.source_country
          order by w.confirmed_at, w.id
          limit 10
        ) x
      ), '[]'::jsonb))
    when 'followed_company_activity' then jsonb_build_object(
      'organization_id', p_message -> 'organization_id', 'org_name', v_org_name, 'org_slug', v_slug,
      'total', jsonb_array_length(coalesce(p_message -> 'job_ids', '[]'::jsonb)),
      'vacancies', coalesce((
        select jsonb_agg(jsonb_build_object('job_id', x.id, 'job_title', x.title) order by x.position)
        from (
          select j.id, j.title, e.position
          from jsonb_array_elements_text(coalesce(p_message -> 'job_ids', '[]'::jsonb)) with ordinality e(id, position)
          join public.jobs j on j.id = e.id::uuid
          order by e.position
          limit 10
        ) x
      ), '[]'::jsonb))
    when 'moderation_decision' then case
      when p_message ? 'report_id' then jsonb_build_object(
        'reference', private.report_reference((p_message ->> 'report_id')::bigint), 'outcome', p_message -> 'outcome')
      when p_message ? 'appeal_id' then jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case when p_message ->> 'target_type' = 'job' then v_title else v_org_name end,
        'org_slug', v_slug, 'appeal_id', p_message -> 'appeal_id', 'appeal_outcome', p_message -> 'appeal_outcome',
        'reasons', p_message -> 'reasons', 'moderation_action_id', p_message -> 'moderation_action_id')
      else jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case when p_message ->> 'target_type' = 'partner_profile' then v_org_name end,
        'org_slug', v_slug, 'decision', p_message -> 'decision', 'reasons', p_message -> 'reasons',
        'moderation_action_id', p_message -> 'moderation_action_id')
    end
    when 'data_export_ready' then jsonb_build_object('export_id', p_message -> 'export_id', 'expires_at', p_message -> 'expires_at')
    -- The recipient's own organisation names the link; never the employer to a partner (V43).
    when 'requirement_closing_soon' then coalesce((
      select jsonb_build_object('requirement_id', r.id, 'title', r.title, 'closes_on', r.closes_on, 'org_slug', v_slug)
      from public.workforce_requirements r where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    else '{}'::jsonb
  end);
end;
$$;

-- public.save_requirement of 20261215100000_workforce_requirements.sql with two changes for the lifecycle (FR-M2 AC8):
-- an edit of a published requirement that moves the start date past its closing date moves the closing date with it
-- (an open requirement closes at the later of its start date and requirement_open_days after publication), and the
-- audit row requirement.updated names the status the requirement was edited in, so the edits of open requirements can
-- be told apart until versions and change notices arrive (V43). Drafts, open and paused requirements stay editable,
-- Closed and Filled refuse with CHARA_INVALID_STATE, a change names the version it was made from
-- (p_expected_updated_at, CHARA_CONFLICT stale otherwise; a status change or an extension is a new version), and the
-- status, visibility, dates and close reason are still no parameters. Everything else is unchanged.
create or replace function public.save_requirement(
  p_org uuid,
  p_workers_needed integer,
  p_country_code text,
  p_city_region text,
  p_industry_code text,
  p_occupations jsonb,
  p_start_date date,
  p_employment_type public.employment_type,
  p_recruitment_preference public.recruitment_preference,
  p_partner_need public.partner_need,
  p_accommodation boolean,
  p_work_permit_support boolean,
  p_visa_support boolean,
  p_requirement uuid default null,
  p_title text default null,
  p_skills text default null,
  p_experience_years smallint default null,
  p_duration_months smallint default null,
  p_salary_min numeric default null,
  p_salary_max numeric default null,
  p_salary_currency text default null,
  p_salary_period public.salary_period default null,
  p_expected_updated_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_skills text := nullif(btrim(coalesce(p_skills, '')), '');
  v_city text := btrim(p_city_region);
  v_country text := upper(btrim(p_country_code));
  v_industry text := upper(btrim(p_industry_code));
  v_currency text := upper(nullif(btrim(coalesce(p_salary_currency, '')), ''));
  v_old public.workforce_requirements;
  v_new public.workforce_requirements;
  v_old_occupations jsonb := '[]'::jsonb;
  v_new_occupations jsonb;
  v_changed jsonb;
  v_criterion text;
  v_field text;
begin
  perform private.assert_requirement_manager(p_org);

  if p_requirement is not null then
    select * into v_old from public.workforce_requirements r
    where r.id = p_requirement and r.organization_id = p_org
    for update;
    if not found then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_old.status in ('closed', 'filled') then
      raise exception 'CHARA_INVALID_STATE' using detail = v_old.status::text;
    end if;
    if p_expected_updated_at is distinct from v_old.updated_at then
      raise exception 'CHARA_CONFLICT' using detail = 'stale';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('occupation_id', o.occupation_id, 'quantity', o.quantity)
             order by o.occupation_id), '[]')
    into v_old_occupations
    from public.requirement_occupations o where o.requirement_id = p_requirement;
  end if;

  if p_start_date is null
     or (p_start_date is distinct from v_old.start_date
         and (p_start_date < v_today or p_start_date > (v_today + interval '3 years')::date)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'start_date';
  end if;

  if p_occupations is null or jsonb_typeof(p_occupations) <> 'array'
     or jsonb_array_length(p_occupations) not between 1 and 10
     or exists (
       select 1 from jsonb_array_elements(p_occupations) e
       where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'occupation_id') <> 'string'
          or jsonb_typeof(e -> 'quantity') <> 'number' or (e ->> 'quantity') !~ '^\d{1,6}$'
     )
     or (select count(distinct btrim(e ->> 'occupation_id')) from jsonb_array_elements(p_occupations) e)
        <> jsonb_array_length(p_occupations) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupations';
  end if;
  select jsonb_agg(jsonb_build_object('occupation_id', btrim(e ->> 'occupation_id'), 'quantity', (e ->> 'quantity')::integer)
           order by btrim(e ->> 'occupation_id'))
  into v_new_occupations
  from jsonb_array_elements(p_occupations) e;

  foreach v_field in array array['title', 'skills', 'city_region'] loop
    v_criterion := private.prohibited_criterion(case v_field
      when 'title' then case when v_title is distinct from v_old.title then v_title end
      when 'skills' then v_skills
      else v_city end);
    if v_criterion is not null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'prohibited_criterion:' || v_field;
    end if;
  end loop;

  perform private.count_audited_write(p_org);

  if p_requirement is null then
    insert into public.workforce_requirements (
      organization_id, title, workers_needed, country_code, city_region, industry_code, skills, experience_years,
      start_date, duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation,
      work_permit_support, visa_support, recruitment_preference, partner_need
    ) values (
      p_org, coalesce(v_title, '-'), p_workers_needed, v_country, v_city, v_industry, v_skills, p_experience_years,
      p_start_date, p_duration_months, p_employment_type, p_salary_min, p_salary_max, v_currency, p_salary_period,
      coalesce(p_accommodation, false), coalesce(p_work_permit_support, false), coalesce(p_visa_support, false),
      p_recruitment_preference, p_partner_need
    )
    returning * into v_new;
  else
    update public.workforce_requirements r
    set title = coalesce(v_title, '-'), workers_needed = p_workers_needed, country_code = v_country,
        city_region = v_city, industry_code = v_industry, skills = v_skills, experience_years = p_experience_years,
        start_date = p_start_date, duration_months = p_duration_months, employment_type = p_employment_type,
        salary_min = p_salary_min, salary_max = p_salary_max, salary_currency = v_currency,
        salary_period = p_salary_period, accommodation = coalesce(p_accommodation, false),
        work_permit_support = coalesce(p_work_permit_support, false), visa_support = coalesce(p_visa_support, false),
        recruitment_preference = p_recruitment_preference, partner_need = p_partner_need,
        closes_on = case when r.closes_on is not null then greatest(r.closes_on, p_start_date) end
    where r.id = p_requirement
    returning * into v_new;
    delete from public.requirement_occupations o where o.requirement_id = p_requirement;
    if v_old.country_code <> v_new.country_code then
      delete from public.requirement_countries c
      where c.requirement_id = p_requirement and c.country_code = v_old.country_code;
    end if;
  end if;

  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select v_new.id, e ->> 'occupation_id', (e ->> 'quantity')::integer
  from jsonb_array_elements(v_new_occupations) e;
  insert into public.requirement_countries (requirement_id, country_code) values (v_new.id, v_new.country_code)
  on conflict do nothing;

  if (select sum((e ->> 'quantity')::integer) from jsonb_array_elements(v_new_occupations) e) <> v_new.workers_needed then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupation_quantities';
  end if;

  -- The title an employer left empty: the number of workers, the occupations by quantity and the place, cut to 120.
  if v_title is null then
    update public.workforce_requirements r
    set title = left(format('%s workers: %s, %s', v_new.workers_needed,
          (select string_agg(oc.label, ', ' order by o.quantity desc, oc.label)
           from public.requirement_occupations o join public.occupations oc on oc.code = o.occupation_id
           where o.requirement_id = v_new.id),
          v_new.city_region), 120)
    where r.id = v_new.id
    returning * into v_new;
  end if;

  if p_requirement is null then
    perform audit.record('requirement.created', 'requirement', v_new.id::text,
      jsonb_build_object('organization_id', p_org, 'partner_need', v_new.partner_need));
    return v_new.id;
  end if;

  select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
  from jsonb_each(to_jsonb(v_new) - 'updated_at') n
  where n.value is distinct from (to_jsonb(v_old) -> n.key);
  if v_new_occupations is distinct from v_old_occupations then
    v_changed := v_changed || '["occupations"]'::jsonb;
  end if;
  if jsonb_array_length(v_changed) > 0 then
    update public.workforce_requirements r set updated_at = now() where r.id = v_new.id;
    perform audit.record('requirement.updated', 'requirement', v_new.id::text,
      jsonb_build_object('organization_id', p_org, 'changed_fields', v_changed, 'status', v_new.status));
  end if;
  return v_new.id;
end;
$$;

-- The public settings of 20261210100000_data_export.sql with the requirement durations, which the requirement
-- pages name ("Extend by 30 days", the closing date a publish sets).
create or replace function public.get_public_settings() returns table (key text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.value #>> '{}'
  from private.settings s
  where s.key = any (array[
    'legal_entity_name', 'legal_entity_address', 'legal_entity_registration_number', 'legal_entity_vat_id',
    'legal_entity_email', 'privacy_contact', 'data_protection_contact', 'release_partner_directories',
    'partner_review_target_working_days', 'licence_number_patterns', 'licence_valid_until_max_years',
    'workforce_listing_stale_days', 'workforce_confirm_reminder_days', 'workforce_available_from_max_days',
    'release_job_orders', 'release_candidate_submissions', 'release_messaging', 'release_find_workers',
    'release_data_export', 'requirement_open_days', 'requirement_extension_days', 'requirement_closing_reminder_days'
  ])
$$;
