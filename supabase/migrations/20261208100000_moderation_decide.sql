-- Moderation decisions of Phase 2 (FR-S1 steps Decide, Inform and Effect, AC4, AC5, AC7, AC8, AC10, AC11; FR-J3 AC9,
-- AC10; NFR-C7, NFR-O5; decisions 2.7, 6.4, 7.2; docs/phase-2/DATA_MODEL.md sections 2, 4, 9 and 11.13). The Phase 1
-- moderation machinery is extended, not duplicated:
-- - moderation_decide: one call of a Trust & Safety Administrator at aal2 that hides or unhides an item, suspends or
--   reinstates an organisation, or dismisses a report, with a statement of reasons of 10 to 2,000 characters
--   (private.statement_of_reasons). With a report, the target is the report's and the report is closed in the same
--   transaction (actioned or dismissed, the reasons as its resolution note); without one, it is a decision on staff's own
--   finding. The report row is locked first, so of two decisions on one report the second finds it closed and is refused
--   with CHARA_INVALID_STATE and the status it now has.
-- - The bodies of moderate_job, suspend_organization and reinstate_organization move to private functions that take the
--   report, so the console and moderation_decide run the same code; the public functions keep their checks and results.
-- - Partner profiles are hidden and unhidden on organizations.moderation_state (target partner_profile, actions
--   content_hidden and content_unhidden). A suspension moves a visible partner profile to org_suspended with the
--   organisation's vacancies, and a reinstatement moves it back; a profile hidden by its own decision stays hidden. Its
--   listings, directory entries and the rows the public reads through private.public_partner_ids follow the profile.
-- - moderation_actions.report_id names the report a decision closed (no foreign key: closed reports are deleted by
--   retention, the record of the decision is kept).
-- - The notice moderation_decision (mandatory) carries the statement of reasons and the appeal route to the owners and
--   admins of a partner whose profile was hidden or unhidden, and the outcome (never the reasons or the reported party) to
--   a signed-in reporter. The Phase 1 notices stay what they are: vacancy_hidden for a vacancy, account_suspended and
--   account_reinstated for an organisation (DATA_MODEL section 2).
-- - reports.decision_due_at: the seven-day decision target of decision 7.2 (setting report_decision_target_days), fixed
--   when the report is stored, like due_at.
-- - Staff read every availability listing of a partner, stale ones and those of a suspended or hidden partner included,
--   through admin_get_partner_moderation (DATA_MODEL 11.13).
-- The partner parts answer only while release_partner_directories is on.

-- Decision target ---------------------------------------------------------------------------------------------------------

insert into private.settings (key, value) values ('report_decision_target_days', '7');

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('report_decision_target_days', 'integer', 1, 90, 'Target for a decision on a report (days)', null);

-- Calendar days, as decision 7.2 states the decision target. A setting that is missing or not a number falls back to 7.
create function private.report_decision_due_at(p_created_at timestamptz) returns timestamptz
language sql
stable
set search_path = ''
as $$
  select p_created_at + make_interval(days => coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,2}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'report_decision_target_days'),
    7))
$$;

revoke all on function private.report_decision_due_at(timestamptz) from public, anon, authenticated, service_role;

alter table public.reports add column decision_due_at timestamptz;
update public.reports set decision_due_at = private.report_decision_due_at(created_at);
alter table public.reports alter column decision_due_at set not null;

comment on column public.reports.decision_due_at is
  'The decision target of decision 7.2 when the report was stored: report_decision_target_days (7) calendar days after it.';

-- private.set_report_due_at of 20261207100100 with the decision target added.
create or replace function private.set_report_due_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.due_at := private.report_due_at(new.category, new.created_at);
  new.decision_due_at := private.report_decision_due_at(new.created_at);
  return new;
end;
$$;

-- Moderation actions -----------------------------------------------------------------------------------------------------

alter table public.moderation_actions add column report_id bigint;

comment on column public.moderation_actions.report_id is
  'The report the decision closed, when it was taken on one. No foreign key: retention deletes closed reports, the decision stays.';

create index moderation_actions_report_idx on public.moderation_actions (report_id) where report_id is not null;

alter table public.moderation_actions drop constraint moderation_actions_target_action_check;
alter table public.moderation_actions add constraint moderation_actions_target_action_check
  check ((target_type, action) in (
    ('profile', 'account_suspended'), ('profile', 'account_reinstated'),
    ('organization', 'organization_suspended'), ('organization', 'organization_reinstated'),
    ('job', 'job_hidden'), ('job', 'job_unhidden'),
    ('partner_profile', 'content_hidden'), ('partner_profile', 'content_unhidden')
  ));

comment on table public.moderation_actions is
  'Append-only record of the suspensions and reinstatements of users and organisations and of the hiding and unhiding of vacancies and partner profiles, each with its statement of reasons. actor_id, target_id and report_id have no foreign key: the record outlives an erased account and a deleted report.';

-- private.record_moderation of 20261102110000 with the report and the id of the new row: the report id joins the audit
-- metadata of the decision. The callers of Phase 1 pass five arguments and ignore the result, as before.
drop function private.record_moderation(text, uuid, text, text, text);

create function private.record_moderation(
  p_target_type text, p_target_id uuid, p_action text, p_audit_action text, p_reason text, p_report bigint default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id, report_id)
  values (p_target_type, p_target_id, p_action, p_reason, (select auth.uid()), p_report)
  returning id into v_id;
  perform private.audit_admin(
    p_audit_action, p_target_type, p_target_id::text, p_reason, jsonb_strip_nulls(jsonb_build_object('report_id', p_report))
  );
  return v_id;
end;
$$;

revoke all on function private.record_moderation(text, uuid, text, text, text, bigint) from public, anon, authenticated, service_role;

-- admin_list_moderation_actions of 20261103110000: the page of suspensions and reinstatements leaves out the partner
-- profiles as it leaves out the vacancies (both have their own history). Everything else is unchanged.
create or replace function public.admin_list_moderation_actions(p_limit integer default 25, p_after_id bigint default null)
returns table (
  id bigint, target_type text, target_id uuid, target_name text, action text, statement_of_reasons text,
  actor_id uuid, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);

  return query
  select
    a.id, a.target_type, a.target_id,
    case a.target_type
      when 'organization' then (select o.display_name from public.organizations o where o.id = a.target_id)
      else (select coalesce(p.display_name, u.email::text) from public.profiles p join auth.users u on u.id = p.id where p.id = a.target_id)
    end,
    a.action, a.statement_of_reasons, a.actor_id, a.created_at
  from public.moderation_actions a
  where a.target_type <> 'job' and a.target_type <> 'partner_profile' and (p_after_id is null or a.id < p_after_id)
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

-- The notice ---------------------------------------------------------------------------------------------------------------

insert into private.notification_kinds (kind, mandatory, default_email, audience, label) values
  ('moderation_decision', true, true, 'all', 'Moderation decisions');

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- The function of 20261205100000 with moderation_decision added. For the affected organisation: the target, its title (the
-- display name of the partner), the decision, the statement of reasons and the decision id that an appeal names (V28).
-- For a reporter: the reference of the report and its outcome only, never the reasons, the target or the reported party.
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
      'job_id', v_job_id, 'job_title', v_title, 'org_slug', v_slug, 'reasons', p_message -> 'reasons')
    when 'trial_ending' then jsonb_build_object(
      'org_slug', v_slug, 'trial_ends_at', p_message -> 'trial_ends_at', 'plan_code', p_message -> 'plan_code',
      'plan_name', p_message -> 'plan_name',
      'amount_minor', p_message -> 'amount_minor', 'currency', p_message -> 'currency')
    when 'payment_failed' then jsonb_build_object('org_slug', v_slug)
    when 'legal_version' then jsonb_build_object(
      'document_slug', p_message -> 'document_slug', 'version', p_message -> 'version',
      'change_summary', p_message -> 'change_summary')
    when 'account_suspended' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug)
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

-- Vacancies --------------------------------------------------------------------------------------------------------------

-- The body of moderate_job of 20261103110000 after its checks, with the report: the organisation is locked before the
-- vacancy (the order of the suspension), the state must be the one the action leaves, an unhidden vacancy of a suspended
-- organisation goes to org_suspended, and a hide queues the mandatory vacancy_hidden notice. Answers the decision id.
create function private.set_job_moderation(p_job uuid, p_hide boolean, p_reason text, p_report bigint default null)
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
    perform private.queue_organization_notice('vacancy_hidden', v_org, p_reason, jsonb_build_object('job_id', p_job));
  end if;
  return v_action;
end;
$$;

revoke all on function private.set_job_moderation(uuid, boolean, text, bigint) from public, anon, authenticated, service_role;

-- moderate_job of 20261103110000: the same checks in the same order, then the body above.
create or replace function public.moderate_job(p_job uuid, p_action text, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_action not in ('hide', 'unhide') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'action';
  end if;
  if p_job is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'job';
  end if;
  perform private.set_job_moderation(p_job, p_action = 'hide', v_reason);
end;
$$;

-- Organisations ----------------------------------------------------------------------------------------------------------

-- The body of suspend_organization of 20261102110000 after its checks, with the report and the partner profile: a visible
-- profile moves to org_suspended with the visible vacancies, each audited; a hidden profile stays hidden. Members are
-- signed out (not banned) and the owner and admins get the mandatory account_suspended notice with the reasons and the
-- appeal route. Answers the decision id.
create function private.suspend_organization_with(p_org uuid, p_reason text, p_report bigint default null) returns bigint
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
  perform private.queue_organization_notice('account_suspended', p_org, p_reason);
  return v_action;
end;
$$;

revoke all on function private.suspend_organization_with(uuid, text, bigint) from public, anon, authenticated, service_role;

-- The body of reinstate_organization of 20261102110000 after its checks, with the report and the partner profile: what
-- the suspension moved comes back, and what was hidden on its own stays hidden.
create function private.reinstate_organization_with(p_org uuid, p_reason text, p_report bigint default null) returns bigint
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
  if v_status <> 'suspended' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;

  update public.organizations set status = 'active' where id = p_org;
  v_action := private.record_moderation('organization', p_org, 'organization_reinstated', 'organization.reinstate', p_reason, p_report);
  with moved as (
    update public.jobs set moderation_state = 'visible'
    where organization_id = p_org and moderation_state = 'org_suspended'
    returning id
  )
  select array_agg(moved.id::text) into v_jobs from moved;
  perform private.audit_admin_each('job.org_reinstate', 'job', v_jobs, p_reason, jsonb_build_object('organization_id', p_org));
  update public.organizations set moderation_state = 'visible' where id = p_org and moderation_state = 'org_suspended';
  get diagnostics v_profile = row_count;
  if v_profile > 0 then
    perform private.audit_admin('partner_profile.org_reinstate', 'partner_profile', p_org::text, p_reason);
  end if;
  perform private.queue_organization_notice('account_reinstated', p_org, p_reason);
  return v_action;
end;
$$;

revoke all on function private.reinstate_organization_with(uuid, text, bigint) from public, anon, authenticated, service_role;

-- suspend_organization and reinstate_organization of 20261102110000: the same checks in the same order, then the bodies
-- above.
create or replace function public.suspend_organization(p_org uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_org is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'organization';
  end if;
  perform private.suspend_organization_with(p_org, v_reason);
end;
$$;

create or replace function public.reinstate_organization(p_org uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_org is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'organization';
  end if;
  perform private.reinstate_organization_with(p_org, v_reason);
end;
$$;

-- A partner that was suspended before this migration leaves the public with its profile state too, so that its
-- reinstatement brings the profile back like any other.
update public.organizations set moderation_state = 'org_suspended'
where type <> 'employer' and status = 'suspended' and moderation_state = 'visible';

-- Partner profiles -------------------------------------------------------------------------------------------------------

-- Hide or unhide the public profile of a partner. Hidden only while visible and unhidden only while hidden; an unhidden
-- profile of a suspended partner goes to org_suspended. The organisation row is locked, the order of the suspension, so a
-- hide and a suspension of the same partner cannot interleave. The owner and admins get the mandatory
-- moderation_decision notice with the reasons. Answers the decision id.
create function private.set_partner_profile_moderation(p_org uuid, p_hide boolean, p_reason text, p_report bigint default null)
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
  perform private.queue_organization_notice('moderation_decision', p_org, p_reason, jsonb_build_object(
    'target_type', 'partner_profile', 'target_id', p_org, 'decision', case when p_hide then 'hide' else 'unhide' end,
    'moderation_action_id', v_action
  ));
  return v_action;
end;
$$;

revoke all on function private.set_partner_profile_moderation(uuid, boolean, text, bigint) from public, anon, authenticated, service_role;

-- The public of a partner: listed, active and with a visible profile. private.public_partner_ids of 20261115100000 with the
-- profile state, so the rows the public reads with it (geographies, occupations, industries, languages, service types,
-- availability listings) leave with a hidden or suspended profile.
create or replace function private.public_partner_ids() returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id from public.organizations o
  where o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active' and o.moderation_state = 'visible'
$$;

-- The decision -----------------------------------------------------------------------------------------------------------

-- One moderation decision of a Trust & Safety Administrator at aal2.
--   p_decision       hide, unhide, suspend_organization, reinstate_organization or dismiss
--   p_reasons        the statement of reasons, 10 to 2,000 characters after trimming; sent to the affected party, and the
--                    resolution note a signed-in reporter reads when a report is closed
--   p_report         the report decided on; its target is the target: a vacancy (hide, or suspend its organisation), a
--                    company (suspend), a partner profile (hide, or suspend the partner); every report can be dismissed,
--                    and a report about a candidate or a page only that
--   p_target_type,   without a report, the target of staff's own finding: job or partner_profile (hide, unhide) or
--   p_target_id      organization (suspend_organization, reinstate_organization)
-- The report is closed actioned (dismissed for dismiss) in the same transaction, with handled_by, handled_at and the
-- reasons, and audited as report.actioned or report.dismissed; the target action writes its own moderation_actions and
-- audit rows, both naming the report. A signed-in reporter gets the moderation_decision notice with the outcome while
-- release 2a is on. A dismissal changes and notifies nothing of the reported party.
-- Answers the decision id (null for a dismissal) and the status the report now has (null without a report).
--   CHARA_FORBIDDEN (not Trust & Safety; detail aal2_required, release_off), CHARA_INVALID_INPUT (detail reason, decision,
--   target), CHARA_NOT_FOUND, CHARA_INVALID_STATE (detail the report status when the report is already closed, or the
--   state of the target: hidden, visible, org_suspended, active, suspended)
create function public.moderation_decide(
  p_decision text,
  p_reasons text,
  p_report bigint default null,
  p_target_type text default null,
  p_target_id uuid default null
) returns table (moderation_action_id bigint, report_status public.report_status)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reasons text := private.statement_of_reasons(p_reasons);
  v_report public.reports;
  v_type text := p_target_type;
  v_target uuid := p_target_id;
  v_org uuid;
  v_action bigint;
  v_status public.report_status;
begin
  if p_decision is null or p_decision not in ('hide', 'unhide', 'suspend_organization', 'reinstate_organization', 'dismiss') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'decision';
  end if;

  if p_report is not null then
    if p_target_type is not null or p_target_id is not null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'target';
    end if;
    select * into v_report from public.reports r where r.id = p_report for no key update;
    if not found then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_report.status not in ('new', 'in_review') then
      raise exception 'CHARA_INVALID_STATE' using detail = v_report.status::text;
    end if;
    v_org := coalesce(v_report.organization_id, (select j.organization_id from public.jobs j where j.id = v_report.job_id));
    if p_decision = 'hide' and v_report.target_type in ('job', 'partner_profile') then
      v_type := v_report.target_type::text;
      v_target := case when v_report.target_type = 'job' then v_report.job_id else v_report.organization_id end;
    elsif p_decision = 'suspend_organization' and v_report.target_type in ('job', 'company', 'partner_profile') then
      v_type := 'organization';
      v_target := v_org;
    elsif p_decision <> 'dismiss' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'decision';
    end if;
  elsif p_decision = 'dismiss'
     or p_target_id is null
     or p_target_type is null
     or not (
       (p_target_type in ('job', 'partner_profile') and p_decision in ('hide', 'unhide'))
       or (p_target_type = 'organization' and p_decision in ('suspend_organization', 'reinstate_organization'))
     ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = case when p_decision = 'dismiss' then 'decision' else 'target' end;
  end if;

  if p_decision <> 'dismiss' then
    v_action := case
      when v_type = 'job' then private.set_job_moderation(v_target, p_decision = 'hide', v_reasons, p_report)
      when v_type = 'partner_profile' then private.set_partner_profile_moderation(v_target, p_decision = 'hide', v_reasons, p_report)
      when p_decision = 'suspend_organization' then private.suspend_organization_with(v_target, v_reasons, p_report)
      else private.reinstate_organization_with(v_target, v_reasons, p_report)
    end;
  end if;

  if p_report is not null then
    v_status := (case when p_decision = 'dismiss' then 'dismissed' else 'actioned' end)::public.report_status;
    update public.reports
    set status = v_status, handled_by = v_uid, handled_at = now(), resolution_note = v_reasons
    where id = p_report;
    perform private.audit_admin(
      'report.' || v_status::text, 'report', p_report::text, v_reasons,
      jsonb_strip_nulls(jsonb_build_object(
        'from', v_report.status, 'to', v_status, 'target_type', v_report.target_type, 'decision', p_decision,
        'moderation_action_id', v_action
      ))
    );
    if v_report.reporter_user_id is not null and private.release_on('release_partner_directories')
       and exists (select 1 from public.profiles p where p.id = v_report.reporter_user_id) then
      perform pgmq.send('notifications', jsonb_build_object(
        'kind', 'moderation_decision', 'user_id', v_report.reporter_user_id, 'mandatory', true, 'report_id', p_report,
        'outcome', v_status
      ));
    end if;
  end if;

  moderation_action_id := v_action;
  report_status := v_status;
  return next;
end;
$$;

revoke all on function public.moderation_decide(text, text, bigint, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.moderation_decide(text, text, bigint, text, uuid) to authenticated;

-- admin_get_report -------------------------------------------------------------------------------------------------------

-- admin_get_report of 20261207100100 with the type and the profile state of the organisation (so the console offers the
-- decisions that fit), the decision target and the decision taken on the report. Everything else is unchanged: never a
-- name of a candidate or a document, a signed-in reporter is only "account".
drop function public.admin_get_report(bigint);

create function public.admin_get_report(p_id bigint) returns table (
  id bigint,
  reference text,
  target_type public.report_target_type,
  category public.report_category,
  details text,
  status public.report_status,
  reporter_kind text,
  reporter_email text,
  content_path text,
  job_id uuid,
  job_title text,
  job_status public.job_status,
  job_moderation_state public.job_moderation_state,
  organization_id uuid,
  organization_name text,
  organization_status public.organization_status,
  organization_slug text,
  resolution_note text,
  handled_at timestamptz,
  created_at timestamptz,
  priority smallint,
  due_at timestamptz,
  overdue boolean,
  organization_type public.organization_type,
  organization_moderation_state public.job_moderation_state,
  decision_due_at timestamptz,
  decision text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety', 'admin']::public.platform_role[]);
  if p_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'report';
  end if;

  return query
  select
    r.id, private.report_reference(r.id), r.target_type, r.category, r.details, r.status,
    case when r.reporter_user_id is not null then 'account' else 'visitor' end, r.reporter_email::text, r.content_path,
    j.id, j.title, j.status, j.moderation_state, o.id, o.display_name, o.status, o.slug, r.resolution_note, r.handled_at,
    r.created_at, r.priority, r.due_at, r.status in ('new', 'in_review') and r.due_at < now(),
    o.type, o.moderation_state, r.decision_due_at,
    (select a.action from public.moderation_actions a where a.report_id = r.id order by a.id desc limit 1)
  from public.reports r
  left join public.job_applications a on a.id = r.application_id
  left join public.jobs j on j.id = coalesce(r.job_id, a.job_id)
  left join public.organizations o on o.id = coalesce(r.organization_id, j.organization_id)
  where r.id = p_id;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_get_report(bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_report(bigint) to authenticated;

-- Staff read of a partner ------------------------------------------------------------------------------------------------

-- What staff need to decide on a partner: its state, every availability listing (stale ones and those of a suspended or
-- hidden partner included, each flagged stale when it is older than workforce_listing_stale_days) and the latest 20
-- decisions on its profile and on the organisation, each with the report it closed. Trust & Safety and, to read, the
-- Platform Administrator, at aal2. An employer or an unknown id is not found.
create function public.admin_get_partner_moderation(p_org uuid) returns table (
  organization_id uuid,
  organization_type public.organization_type,
  status public.organization_status,
  moderation_state public.job_moderation_state,
  listed boolean,
  listings jsonb,
  history jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety', 'admin']::public.platform_role[]);
  if p_org is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'organization';
  end if;

  return query
  select
    o.id, o.type, o.status, o.moderation_state, o.listed_at is not null and o.review_status <> 'declined',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'occupation', oc.label, 'source_country', c.name, 'available', w.available,
        'monthly_capacity', w.monthly_capacity, 'available_from', w.available_from, 'confirmed_at', w.confirmed_at,
        'stale', w.confirmed_at <= private.workforce_fresh_since()
      ) order by w.confirmed_at, w.id)
      from public.workforce_availability w
      join public.occupations oc on oc.code = w.occupation_id
      join public.countries c on c.code = w.source_country
      where w.organization_id = o.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'action', h.action, 'reasons', h.statement_of_reasons, 'at', h.created_at, 'report_id', h.report_id
      ) order by h.id desc)
      from (
        select a.id, a.action, a.statement_of_reasons, a.created_at, a.report_id
        from public.moderation_actions a
        where a.target_type in ('partner_profile', 'organization') and a.target_id = o.id
        order by a.id desc
        limit 20
      ) h
    ), '[]'::jsonb)
  from public.organizations o
  where o.id = p_org and o.type <> 'employer';
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_get_partner_moderation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_partner_moderation(uuid) to authenticated;

-- The affected partner reads the decision ---------------------------------------------------------------------------------

-- The moderation state of the caller's partner profile and, while it is hidden by a decision, that decision: its id (which
-- an appeal names, V28), the statement of reasons and the time. Every member reads it (FR-S1 AC12: the badge and the
-- reasons for everyone, the appeal for owner and admin). Release 2a only.
--   CHARA_FORBIDDEN (no session: 42501; not a member of the partner; detail release_off)
create function public.partner_profile_moderation(p_org uuid) returns table (
  moderation_state public.job_moderation_state,
  moderation_action_id bigint,
  reasons text,
  decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org) or private.org_type(p_org) = 'employer' then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;

  return query
  select o.moderation_state, d.id, d.statement_of_reasons, d.created_at
  from public.organizations o
  left join lateral (
    select a.id, a.statement_of_reasons, a.created_at
    from public.moderation_actions a
    where a.target_type = 'partner_profile' and a.target_id = o.id and a.action = 'content_hidden'
    order by a.id desc
    limit 1
  ) d on o.moderation_state = 'hidden'
  where o.id = p_org;
end;
$$;

revoke all on function public.partner_profile_moderation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.partner_profile_moderation(uuid) to authenticated;
