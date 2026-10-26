-- Appeals against moderation decisions (FR-S1 step Appeal, output "Appeals and outcomes", KPI "Decisions reversed on
-- appeal", control "second-person appeal review", AC9, AC11, AC12; DSA Art. 20; decisions 6.4, 7.2; docs/phase-2/DATA_MODEL.md
-- sections 6, 7, 10 and 11.9). The moderation machinery of V27 is reused, not duplicated:
-- - The decisions that take something away from an organisation can be appealed: a partner profile hidden
--   (content_hidden), a vacancy hidden (job_hidden) and an organisation suspended (organization_suspended). An owner or
--   admin of the affected organisation (aal2) lodges one appeal per decision with grounds of 20 to 2,000 characters,
--   within appeal_window_months (6) of the decision and while the decision is still in effect; a suspended organisation
--   can appeal its suspension. Every member reads the decision and its appeal (list_my_appeals).
-- - A Trust & Safety Administrator at aal2 other than the one who took the decision, and not of the organisation
--   (private.is_own_organization), upholds it or restores, with a statement of reasons. A restore undoes the decision
--   through the private bodies of V27 (unhide the profile or the vacancy, reinstate the organisation), which write their
--   own moderation_actions and audit rows. The appellant is sent one mandatory moderation_decision notice with the outcome
--   and the reasons. The target is appeal_decision_target_days (7) after lodging, shown and not enforced.
-- - The notices of a decision that can be appealed carry its id (vacancy_hidden, account_suspended of an organisation,
--   moderation_decision), so the email and the notification list link to the appeal; vacancy_hidden and
--   account_suspended carry it only while release 2a is on, so that before it they stay as in Phase 1 (the Complaints and
--   Dispute Process).
-- - Decided appeals are deleted closed_appeals (365) days after the decision.
-- Every appeal RPC answers only while release_partner_directories is on.

-- Settings -----------------------------------------------------------------------------------------------------------------

insert into private.settings (key, value) values ('appeal_window_months', '6'), ('appeal_decision_target_days', '7');

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('appeal_window_months', 'integer', 1, 24, 'Time to appeal a moderation decision (months)', null),
  ('appeal_decision_target_days', 'integer', 1, 90, 'Target for a decision on an appeal (days)', null);

-- An integer setting of the appeals; a setting that is missing or not a number falls back to the default of the data model.
create function private.appeal_setting(p_key text, p_default integer) returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,2}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = p_key),
    p_default)
$$;

revoke all on function private.appeal_setting(text, integer) from public, anon, authenticated, service_role;

-- The table ------------------------------------------------------------------------------------------------------------------

create type public.appeal_status as enum ('open', 'upheld', 'restored');

create table public.appeals (
  id bigint generated always as identity primary key,
  moderation_action_id bigint not null unique references public.moderation_actions (id),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  appellant_user_id uuid references public.profiles (id) on delete set null,
  grounds text not null check (grounds = btrim(grounds, E' \t\r\n') and char_length(grounds) between 20 and 2000),
  status public.appeal_status not null default 'open',
  decided_by uuid references public.profiles (id) on delete set null,
  reasons text check (reasons is null or (reasons = btrim(reasons, E' \t\r\n') and char_length(reasons) between 10 and 2000)),
  lodged_at timestamptz not null default now(),
  due_at timestamptz not null,
  decided_at timestamptz,
  check ((status = 'open') = (decided_at is null)),
  check ((status = 'open') = (reasons is null))
);

comment on table public.appeals is
  'Appeals against moderation decisions (FR-S1, DSA Art. 20): one per decision, lodged by an owner or admin of the affected organisation, decided by a second Trust & Safety Administrator. Read and written through RPCs only.';
comment on column public.appeals.organization_id is
  'The organisation the decision affected: the hidden partner profile, the owner of the hidden vacancy, or the suspended organisation.';

create index appeals_organization_idx on public.appeals (organization_id);
create index appeals_open_idx on public.appeals (due_at, id) where status = 'open';
create index appeals_appellant_idx on public.appeals (appellant_user_id) where appellant_user_id is not null;
create index appeals_decided_by_idx on public.appeals (decided_by) where decided_by is not null;
create index appeals_decided_at_idx on public.appeals (decided_at) where decided_at is not null;

alter table public.appeals enable row level security;
alter table public.appeals force row level security;
revoke all on table public.appeals from public, anon, authenticated, service_role;

-- The decision behind an appeal ------------------------------------------------------------------------------------------------

-- A decision that can be appealed, with the organisation it affected and what it is about (the display name of the
-- partner or the organisation, or the title of the vacancy). in_effect: no later decision on the same target has
-- undone or replaced it (and a hidden vacancy still exists). No row for any other decision.
create function private.appealable_decision(p_action bigint) returns table (
  moderation_action_id bigint,
  target_type text,
  target_id uuid,
  action text,
  organization_id uuid,
  title text,
  org_slug text,
  reasons text,
  actor_id uuid,
  decided_at timestamptz,
  in_effect boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.target_type, a.target_id, a.action, o.id,
    case when a.target_type = 'job' then j.title else o.display_name end, o.slug, a.statement_of_reasons, a.actor_id,
    a.created_at,
    not exists (
      select 1 from public.moderation_actions b
      where b.target_type = a.target_type and b.target_id = a.target_id and b.id > a.id
    ) and (a.target_type <> 'job' or j.deleted_at is null)
  from public.moderation_actions a
  left join public.jobs j on a.target_type = 'job' and j.id = a.target_id
  join public.organizations o on o.id = case when a.target_type = 'job' then j.organization_id else a.target_id end
  where a.id = p_action and a.action in ('content_hidden', 'job_hidden', 'organization_suspended')
$$;

revoke all on function private.appealable_decision(bigint) from public, anon, authenticated, service_role;

-- What the notices of a decision add so that they link to its appeal: the decision id, while release 2a is on.
create function private.appeal_link(p_action bigint) returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when private.release_on('release_partner_directories') then jsonb_build_object('moderation_action_id', p_action)
    else '{}'::jsonb end
$$;

revoke all on function private.appeal_link(bigint) from public, anon, authenticated, service_role;

-- The notices link to the appeal -------------------------------------------------------------------------------------------

-- private.set_job_moderation of 20261208100000 with the decision id in the vacancy_hidden notice (private.appeal_link).
-- Everything else is unchanged.
create or replace function private.set_job_moderation(p_job uuid, p_hide boolean, p_reason text, p_report bigint default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.job_moderation_state;
  v_org uuid;
  v_org_status public.organization_status;
  v_action bigint;
begin
  select j.organization_id into v_org from public.jobs j where j.id = p_job and j.deleted_at is null;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select o.status into v_org_status from public.organizations o where o.id = v_org for share;
  select j.moderation_state into v_state
  from public.jobs j where j.id = p_job and j.deleted_at is null and j.organization_id = v_org for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_state <> (case when p_hide then 'visible' else 'hidden' end)::public.job_moderation_state then
    raise exception 'CHARA_INVALID_STATE' using detail = v_state::text;
  end if;

  update public.jobs
  set moderation_state = (case
    when p_hide then 'hidden'
    when v_org_status = 'suspended' then 'org_suspended'
    else 'visible'
  end)::public.job_moderation_state
  where id = p_job;
  v_action := private.record_moderation(
    'job', p_job, case when p_hide then 'job_hidden' else 'job_unhidden' end, case when p_hide then 'job.hide' else 'job.unhide' end,
    p_reason, p_report
  );

  if p_hide then
    perform private.queue_organization_notice(
      'vacancy_hidden', v_org, p_reason, jsonb_build_object('job_id', p_job) || private.appeal_link(v_action)
    );
  end if;
  return v_action;
end;
$$;

-- private.suspend_organization_with of 20261208100000 with the decision id in the account_suspended notice
-- (private.appeal_link). Everything else is unchanged.
create or replace function private.suspend_organization_with(p_org uuid, p_reason text, p_report bigint default null) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.organization_status;
  v_jobs text[];
  v_action bigint;
  v_profile integer;
begin
  select o.status into v_status from public.organizations o where o.id = p_org for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;

  update public.organizations set status = 'suspended' where id = p_org;
  v_action := private.record_moderation('organization', p_org, 'organization_suspended', 'organization.suspend', p_reason, p_report);
  -- One statement for all vacancies: an organisation can have thousands.
  with moved as (
    update public.jobs set moderation_state = 'org_suspended'
    where organization_id = p_org and moderation_state = 'visible' and deleted_at is null
    returning id
  )
  select array_agg(moved.id::text) into v_jobs from moved;
  perform private.audit_admin_each('job.org_suspend', 'job', v_jobs, p_reason, jsonb_build_object('organization_id', p_org));
  update public.organizations set moderation_state = 'org_suspended' where id = p_org and moderation_state = 'visible';
  get diagnostics v_profile = row_count;
  if v_profile > 0 then
    perform private.audit_admin('partner_profile.org_suspend', 'partner_profile', p_org::text, p_reason);
  end if;
  perform private.queue_account_op(jsonb_build_object('action', 'sign_out_organization', 'organization_id', p_org));
  perform private.queue_organization_notice('account_suspended', p_org, p_reason, private.appeal_link(v_action));
  return v_action;
end;
$$;

-- private.set_partner_profile_moderation of 20261208100000 with p_notify: a restore on appeal tells the appellant with
-- the outcome of the appeal instead (one notice, FR-S1 AC9). Everything else is unchanged.
drop function private.set_partner_profile_moderation(uuid, boolean, text, bigint);

create function private.set_partner_profile_moderation(
  p_org uuid, p_hide boolean, p_reason text, p_report bigint default null, p_notify boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.organization_type;
  v_status public.organization_status;
  v_state public.job_moderation_state;
  v_action bigint;
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  select o.type, o.status, o.moderation_state into v_type, v_status, v_state
  from public.organizations o where o.id = p_org for no key update;
  if not found or v_type = 'employer' then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_state <> (case when p_hide then 'visible' else 'hidden' end)::public.job_moderation_state then
    raise exception 'CHARA_INVALID_STATE' using detail = v_state::text;
  end if;

  update public.organizations
  set moderation_state = (case
    when p_hide then 'hidden'
    when v_status = 'suspended' then 'org_suspended'
    else 'visible'
  end)::public.job_moderation_state
  where id = p_org;
  v_action := private.record_moderation(
    'partner_profile', p_org, case when p_hide then 'content_hidden' else 'content_unhidden' end,
    case when p_hide then 'partner_profile.hide' else 'partner_profile.unhide' end, p_reason, p_report
  );
  if p_notify then
    perform private.queue_organization_notice('moderation_decision', p_org, p_reason, jsonb_build_object(
      'target_type', 'partner_profile', 'target_id', p_org, 'decision', case when p_hide then 'hide' else 'unhide' end,
      'moderation_action_id', v_action
    ));
  end if;
  return v_action;
end;
$$;

revoke all on function private.set_partner_profile_moderation(uuid, boolean, text, bigint, boolean) from public, anon, authenticated, service_role;

-- private.notification_payload of 20261208100000: vacancy_hidden and account_suspended pass the decision id on when the
-- notice carries one, and moderation_decision has a third reader, the appellant, who reads the outcome of the appeal with
-- its reasons. Every other branch is unchanged.
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
    select i.id, i.role, i.expires_at, o.display_name into v_invitation_id, v_role, v_expires, v_org_name
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
      'invitation_id', v_invitation_id, 'org_name', v_org_name, 'role', v_role, 'expires_at', v_expires)
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
    else '{}'::jsonb
  end);
end;
$$;

-- The affected organisation ------------------------------------------------------------------------------------------------

-- The decisions on the caller's organisations that can be appealed and their appeals, newest first: every decision of the
-- appeal window and every decision with an appeal (p_action: that decision only). Every accepted member reads them
-- (FR-S1 AC12: the state and the reasons for everyone); can_appeal is true for an owner or admin while the window is open,
-- the decision is in effect and no appeal was lodged; target_days is the decision target an appeal lodged now gets (the
-- appeal form states it). Never who decided. A suspended organisation reads its own. Release
-- 2a only.
--   CHARA_FORBIDDEN (detail release_off)
create function public.list_my_appeals(p_action bigint default null) returns table (
  moderation_action_id bigint,
  target_type text,
  target_id uuid,
  action text,
  title text,
  organization_id uuid,
  organization_name text,
  org_slug text,
  reasons text,
  decided_at timestamptz,
  appeal_until timestamptz,
  in_effect boolean,
  can_appeal boolean,
  appeal_id bigint,
  appeal_status public.appeal_status,
  grounds text,
  lodged_at timestamptz,
  due_at timestamptz,
  appeal_reasons text,
  appeal_decided_at timestamptz,
  target_days integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_window integer := private.appeal_setting('appeal_window_months', 6);
  v_target integer := private.appeal_setting('appeal_decision_target_days', 7);
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;

  return query
  select
    d.moderation_action_id, d.target_type, d.target_id, d.action, d.title, d.organization_id, o.display_name, d.org_slug,
    d.reasons, d.decided_at, d.decided_at + make_interval(months => v_window), d.in_effect,
    m.role in ('owner', 'admin') and d.in_effect and ap.id is null and now() <= d.decided_at + make_interval(months => v_window),
    ap.id, ap.status, ap.grounds, ap.lodged_at, ap.due_at, ap.reasons, ap.decided_at, v_target
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  cross join lateral (
    select a.id from public.moderation_actions a
    where a.action in ('content_hidden', 'organization_suspended') and a.target_id = m.organization_id
      and (p_action is null or a.id = p_action)
    union all
    select a.id from public.moderation_actions a join public.jobs j on j.id = a.target_id
    where a.action = 'job_hidden' and j.organization_id = m.organization_id and (p_action is null or a.id = p_action)
  ) c
  cross join lateral private.appealable_decision(c.id) d
  left join public.appeals ap on ap.moderation_action_id = d.moderation_action_id
  where m.user_id = v_uid and m.accepted_at is not null
    and (ap.id is not null or now() <= d.decided_at + make_interval(months => v_window))
  order by d.moderation_action_id desc
  limit 100;
end;
$$;

revoke all on function public.list_my_appeals(bigint) from public, anon, authenticated, service_role;
grant execute on function public.list_my_appeals(bigint) to authenticated;

-- An owner or admin of the affected organisation (accepted, at aal2, account not suspended) appeals a decision with
-- grounds of 20 to 2,000 characters after trimming: one appeal per decision, within appeal_window_months of it and while
-- it is in effect. The organisation may be suspended (the decision may be its suspension). The appeal is due
-- appeal_decision_target_days after it is lodged. A decision that cannot be appealed, does not exist or is about another
-- organisation is not found. Audited as appeal.lodged.
--   CHARA_FORBIDDEN (a member; detail release_off, aal2_required, profile_suspended), CHARA_INVALID_INPUT (detail
--   grounds), CHARA_NOT_FOUND, CHARA_INVALID_STATE (detail appeal_exists, appeal_window_closed, not_in_effect)
create function public.submit_appeal(p_action bigint, p_grounds text) returns table (appeal_id bigint, due_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_grounds text := btrim(p_grounds, E' \t\r\n');
  v_decision record;
  v_role public.member_role;
  v_id bigint;
  v_due timestamptz;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if v_grounds is null or char_length(v_grounds) not between 20 and 2000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'grounds';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'suspended') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_suspended';
  end if;

  select * into v_decision from private.appealable_decision(p_action);
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select m.role into v_role from public.organization_members m
  where m.organization_id = v_decision.organization_id and m.user_id = v_uid and m.accepted_at is not null;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;

  -- One appeal per decision: of two at the same moment, the second waits here and then finds the first.
  perform pg_advisory_xact_lock(hashtextextended('appeal:' || p_action::text, 0));
  if exists (select 1 from public.appeals a where a.moderation_action_id = p_action) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'appeal_exists';
  end if;
  if now() > v_decision.decided_at + make_interval(months => private.appeal_setting('appeal_window_months', 6)) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'appeal_window_closed';
  end if;
  if not v_decision.in_effect then
    raise exception 'CHARA_INVALID_STATE' using detail = 'not_in_effect';
  end if;

  v_due := now() + make_interval(days => private.appeal_setting('appeal_decision_target_days', 7));
  insert into public.appeals (moderation_action_id, organization_id, appellant_user_id, grounds, due_at)
  values (p_action, v_decision.organization_id, v_uid, v_grounds, v_due)
  returning id into v_id;
  perform audit.record('appeal.lodged', 'appeal', v_id::text, jsonb_build_object(
    'moderation_action_id', p_action, 'organization_id', v_decision.organization_id, 'target_type', v_decision.target_type,
    'request_id', private.request_id()
  ));

  appeal_id := v_id;
  due_at := v_due;
  return next;
end;
$$;

revoke all on function public.submit_appeal(bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.submit_appeal(bigint, text) to authenticated;

-- Staff ------------------------------------------------------------------------------------------------------------------------

-- A Trust & Safety Administrator at aal2 decides an open appeal: uphold (nothing changes) or restore (the decision is
-- undone through the private bodies of V27: the partner profile or the vacancy is unhidden, the organisation reinstated),
-- with a statement of reasons of 10 to 2,000 characters. Nobody decides an appeal against their own decision
-- (same_reviewer) or about their own organisation (own_organization). A restore of a decision that is no longer in effect
-- records the outcome without acting again. The appeal row is locked, so of two decisions the second finds it decided.
-- Audited as appeal.upheld or appeal.restored (with the decision and the reversal); the appellant gets one mandatory
-- moderation_decision notice with the outcome and the reasons. Answers the outcome and the id of the reversal (null when
-- nothing was undone).
--   CHARA_FORBIDDEN (not Trust & Safety; detail aal2_required, release_off, same_reviewer, own_organization),
--   CHARA_INVALID_INPUT (detail reason, outcome), CHARA_NOT_FOUND, CHARA_INVALID_STATE (detail the status of a decided
--   appeal)
create function public.decide_appeal(p_appeal bigint, p_outcome text, p_reasons text)
returns table (status public.appeal_status, reversal_action_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reasons text;
  v_appeal public.appeals;
  v_decision record;
  v_status public.appeal_status;
  v_reversal bigint;
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  v_reasons := private.statement_of_reasons(p_reasons);
  if p_outcome is null or p_outcome not in ('uphold', 'restore') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'outcome';
  end if;

  select * into v_appeal from public.appeals a where a.id = p_appeal for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_decision from private.appealable_decision(v_appeal.moderation_action_id);
  if v_decision.actor_id = v_uid then
    raise exception 'CHARA_FORBIDDEN' using detail = 'same_reviewer';
  end if;
  if private.is_own_organization(v_uid, v_appeal.organization_id) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'own_organization';
  end if;
  if v_appeal.status <> 'open' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_appeal.status::text;
  end if;

  v_status := (case when p_outcome = 'restore' then 'restored' else 'upheld' end)::public.appeal_status;
  if p_outcome = 'restore' and v_decision.in_effect then
    v_reversal := case v_decision.target_type
      when 'partner_profile' then private.set_partner_profile_moderation(v_decision.target_id, false, v_reasons, null, false)
      when 'job' then private.set_job_moderation(v_decision.target_id, false, v_reasons)
      else private.reinstate_organization_with(v_decision.target_id, v_reasons)
    end;
  end if;

  update public.appeals
  set status = v_status, decided_by = v_uid, reasons = v_reasons, decided_at = now()
  where id = p_appeal;
  perform private.audit_admin('appeal.' || v_status::text, 'appeal', p_appeal::text, v_reasons, jsonb_strip_nulls(jsonb_build_object(
    'moderation_action_id', v_appeal.moderation_action_id, 'organization_id', v_appeal.organization_id,
    'target_type', v_decision.target_type, 'reversal_action_id', v_reversal,
    'already_reversed', case when p_outcome = 'restore' and not v_decision.in_effect then true end
  )));

  if v_appeal.appellant_user_id is not null then
    perform pgmq.send('notifications', jsonb_strip_nulls(jsonb_build_object(
      'kind', 'moderation_decision', 'user_id', v_appeal.appellant_user_id, 'mandatory', true,
      'organization_id', v_appeal.organization_id, 'appeal_id', p_appeal, 'appeal_outcome', v_status,
      'target_type', v_decision.target_type, 'target_id', v_decision.target_id,
      'job_id', case when v_decision.target_type = 'job' then v_decision.target_id end,
      'reasons', v_reasons, 'moderation_action_id', v_appeal.moderation_action_id
    )));
  end if;

  status := v_status;
  reversal_action_id := v_reversal;
  return next;
end;
$$;

revoke all on function public.decide_appeal(bigint, text, text) from public, anon, authenticated, service_role;
grant execute on function public.decide_appeal(bigint, text, text) to authenticated;

-- The appeals for Trust & Safety and, to read, the Platform Administrator, at aal2 (FR-S1 AC11). Open ones by due time
-- (then id), continued after the last row's (due_at, id); decided ones newest first after the last row's id.
--   p_status  open, decided or all (all: newest first, like decided)
--   CHARA_FORBIDDEN (detail aal2_required, release_off), CHARA_INVALID_INPUT (detail status)
create function public.admin_list_appeals(
  p_status text default 'open', p_limit integer default 25, p_after_id bigint default null, p_after_due_at timestamptz default null
) returns table (
  id bigint,
  moderation_action_id bigint,
  target_type text,
  title text,
  organization_id uuid,
  organization_name text,
  status public.appeal_status,
  lodged_at timestamptz,
  due_at timestamptz,
  overdue boolean,
  decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety', 'admin']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if p_status is null or p_status not in ('open', 'decided', 'all') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'status';
  end if;

  return query
  select a.id, a.moderation_action_id, d.target_type, d.title, a.organization_id, o.display_name, a.status, a.lodged_at,
    a.due_at, a.status = 'open' and a.due_at < now(), a.decided_at
  from public.appeals a
  join public.organizations o on o.id = a.organization_id
  cross join lateral private.appealable_decision(a.moderation_action_id) d
  where case p_status
      when 'open' then a.status = 'open'
        and (p_after_id is null or (a.due_at, a.id) > (coalesce(p_after_due_at, '-infinity'::timestamptz), p_after_id))
      when 'decided' then a.status <> 'open' and (p_after_id is null or a.id < p_after_id)
      else p_after_id is null or a.id < p_after_id
    end
  order by
    case when p_status = 'open' then a.due_at end,
    case when p_status = 'open' then a.id end,
    case when p_status <> 'open' then a.id end desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

revoke all on function public.admin_list_appeals(text, integer, bigint, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_appeals(text, integer, bigint, timestamptz) to authenticated;

-- One appeal with the decision it is about, for the same staff. own_decision: the caller took the decision, so another
-- administrator decides the appeal. Never the name of the appellant.
--   CHARA_FORBIDDEN (detail aal2_required, release_off), CHARA_INVALID_INPUT (detail appeal), CHARA_NOT_FOUND
create function public.admin_get_appeal(p_id bigint) returns table (
  id bigint,
  moderation_action_id bigint,
  target_type text,
  target_id uuid,
  action text,
  title text,
  organization_id uuid,
  organization_name text,
  decision_reasons text,
  decided_on timestamptz,
  decision_report_id bigint,
  in_effect boolean,
  own_decision boolean,
  status public.appeal_status,
  grounds text,
  lodged_at timestamptz,
  due_at timestamptz,
  overdue boolean,
  reasons text,
  decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_staff(array['trust_safety', 'admin']::public.platform_role[]);
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if p_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'appeal';
  end if;

  return query
  select a.id, a.moderation_action_id, d.target_type, d.target_id, d.action, d.title, a.organization_id, o.display_name,
    d.reasons, d.decided_at, (select m.report_id from public.moderation_actions m where m.id = a.moderation_action_id),
    d.in_effect, d.actor_id is not distinct from v_uid, a.status, a.grounds, a.lodged_at, a.due_at,
    a.status = 'open' and a.due_at < now(), a.reasons, a.decided_at
  from public.appeals a
  join public.organizations o on o.id = a.organization_id
  cross join lateral private.appealable_decision(a.moderation_action_id) d
  where a.id = p_id;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_get_appeal(bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_appeal(bigint) to authenticated;

-- The KPI "Decisions reversed on appeal" (FR-S1): of the appeals decided within the last p_days (closed appeals are kept
-- closed_appeals days), how many restored; with the open ones and how many of those are overdue.
create function public.admin_appeal_stats(p_days integer default 365) returns table (
  decided bigint, restored bigint, open bigint, overdue bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety', 'admin']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if p_days is null or p_days not between 1 and 3650 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'days';
  end if;

  return query
  select
    count(*) filter (where a.status <> 'open' and a.decided_at >= now() - make_interval(days => p_days)),
    count(*) filter (where a.status = 'restored' and a.decided_at >= now() - make_interval(days => p_days)),
    count(*) filter (where a.status = 'open'),
    count(*) filter (where a.status = 'open' and a.due_at < now())
  from public.appeals a;
end;
$$;

revoke all on function public.admin_appeal_stats(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_appeal_stats(integer) to authenticated;
