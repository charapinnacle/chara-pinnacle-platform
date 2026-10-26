-- Partner review, licence and listing-confirmation notifications (FR-T1; FR-J4 AC6, FR-J2 AC8, FR-K3 AC5;
-- docs/phase-2/DATA_MODEL.md sections 2 and 9; NFR-A3). Six kinds join the catalogue, the kind check of notifications and
-- the email templates together:
--   partner_approved, partner_info_requested, partner_declined  mandatory: the staff decisions of admin_decide_partner
--   licence_expiring, partner_licence_expired                   optional: the daily job partner-licence-expiry
--   listing_confirmation_due                                    optional: the daily job workforce-availability-confirm
-- Every one is an organisation event, queued through private.queue_org_event in the transaction of its change, so it goes
-- to the accepted owners and admins of an active organisation only. The payloads hold ids, display names, dates and, for a
-- request for information or a decline, the staff reason written for the partner; never the staff member.
--
-- The kinds concern partners only: the catalogue gains organization_types, and the preferences page and RPC of a user who
-- neither belongs to nor signed up for a recruitment or staffing company do not offer them.
--
-- The producers queue only while release_partner_directories is on: admin_decide_partner refuses to run otherwise, the
-- confirmation job does nothing, and the licence job still marks entries expired but queues and stamps nothing.

-- organization_types: the organisation types a company user must belong to (or have signed up for) to be offered the
-- kind; null for every type.
alter table private.notification_kinds
  add column organization_types public.organization_type[]
    check (organization_types is null or (audience = 'company' and cardinality(organization_types) > 0));

insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types) values
  ('partner_approved', true, true, 'company', 'Company listed after review',
    array['recruitment_company', 'staffing_company']::public.organization_type[]),
  ('partner_info_requested', true, true, 'company', 'More information requested for the review',
    array['recruitment_company', 'staffing_company']::public.organization_type[]),
  ('partner_declined', true, true, 'company', 'Company not listed after review',
    array['recruitment_company', 'staffing_company']::public.organization_type[]),
  ('licence_expiring', false, true, 'company', 'Licence expiry reminders',
    array['recruitment_company', 'staffing_company']::public.organization_type[]),
  ('partner_licence_expired', false, true, 'company', 'Expired licences',
    array['recruitment_company', 'staffing_company']::public.organization_type[]),
  ('listing_confirmation_due', false, true, 'company', 'Availability confirmation reminders',
    array['recruitment_company', 'staffing_company']::public.organization_type[]);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- How many days before its valid-until date a licence entry is due for the reminder (FR-J2 AC8, FR-T1 data).
insert into private.settings (key, value) values ('licence_expiry_reminder_days', '30') on conflict (key) do nothing;

-- The function of 20261110120000 with the six kinds added: a decision, a licence entry or the listings due are looked up
-- by the ids of the message, in the transaction that queued it.
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
    else '{}'::jsonb
  end);
end;
$$;

-- The function of 20261123100000 with one change: the decision row's id is kept and the matching kind is queued to the
-- partner's owners and admins in the same transaction, once per decision row (NFR-A3; FR-J4 AC6).
create or replace function public.admin_decide_partner(
  p_org uuid, p_decision text, p_reason text, p_info_step text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_reason text;
  v_org public.organizations;
  v_to public.partner_review_status;
  v_decision_id bigint;
begin
  v_uid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if p_decision is null or p_decision not in ('approve', 'request_info', 'decline') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'decision';
  end if;
  v_reason := private.statement_of_reasons(p_reason);
  if (p_decision = 'request_info') <> (p_info_step is not null)
     or (p_info_step is not null and p_info_step not in ('company', 'where_you_serve', 'commitments')) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'info_step';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('partner_review_submission:' || p_org::text, 0));
  select * into v_org from public.organizations o where o.id = p_org for update;
  if not found or v_org.type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = v_uid)
     or exists (
       select 1 from public.organization_invitations i join auth.users u on u.id = v_uid
       where i.organization_id = p_org and i.accepted_at is null and i.expires_at > now()
         and lower(i.email::text) = lower(u.email::text)
     )
     or exists (
       select 1 from private.organization_identifier_links l
       join public.organization_members m
         on m.organization_id = case when l.organization_id = p_org then l.other_organization_id else l.organization_id end
       where (l.organization_id = p_org or l.other_organization_id = p_org) and m.user_id = v_uid
     ) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'own_organization';
  end if;
  if v_org.review_status not in ('pending_review', 're_review') then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = v_org.review_status::text;
  end if;

  v_to := case p_decision when 'approve' then 'listed' when 'request_info' then 'info_requested' else 'declined'
    end::public.partner_review_status;
  update public.organizations
  set review_status = v_to,
      listed_at = case when p_decision = 'approve' then coalesce(listed_at, now()) else listed_at end,
      info_step = p_info_step
  where id = p_org;

  insert into public.partner_review_decisions (
    organization_id, decision, reason, info_step, from_status, to_status, submitted_at, decided_by
  )
  values (p_org, p_decision, v_reason, p_info_step, v_org.review_status, v_to, v_org.submitted_at, v_uid)
  returning id into v_decision_id;

  perform private.audit_admin('partner.review_decided', 'organization', p_org::text, v_reason,
    jsonb_build_object('decision', p_decision, 'from', v_org.review_status, 'to', v_to, 'info_step', p_info_step));

  perform private.queue_org_event(
    p_org,
    case p_decision when 'approve' then 'partner_approved' when 'request_info' then 'partner_info_requested'
      else 'partner_declined' end,
    jsonb_build_object('decision_id', v_decision_id),
    'partner_review_decision:' || v_decision_id
  );

  return jsonb_build_object(
    'review_status', v_to,
    'listed_at', case when p_decision = 'approve' then coalesce(v_org.listed_at, now()) else v_org.listed_at end
  );
end;
$$;

revoke all on function public.admin_decide_partner(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_decide_partner(uuid, text, text, text) to authenticated;

-- The function of 20261122100000 with the notices added, while release 2a is on (FR-J2 AC8):
--   an entry marked expired queues partner_licence_expired once (the transition happens once; the key holds the date)
--   and stamps expiry_notified_on;
--   a current entry of an active organisation valid until today plus licence_expiry_reminder_days or earlier, not yet
--   stamped, queues licence_expiring and is stamped today. A new valid-until date clears the stamp
--   (update_partner_licence), so a renewed entry is reminded again.
-- A second run on the same day finds nothing to mark or remind. Returns the number of entries marked expired.
create or replace function private.expire_partner_licences() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release boolean := private.release_on('release_partner_directories');
  v_today date := (now() at time zone 'utc')::date;
  v_days integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'licence_expiry_reminder_days'), 30);
  v_licence record;
  v_count integer := 0;
begin
  for v_licence in
    select l.id, l.organization_id from public.partner_licences l
    where l.evidence_scan_status = 'pending' and l.evidence_requested_at < now() - interval '2 hours'
      and not exists (select 1 from storage.objects o where o.bucket_id = 'partner-documents' and o.name = l.evidence_path)
    for update
  loop
    perform private.restore_previous_evidence(v_licence.id);
    perform audit.record('partner_licence.evidence_abandoned', 'partner_licence', v_licence.id::text,
      jsonb_build_object('organization_id', v_licence.organization_id));
  end loop;

  for v_licence in
    update public.partner_licences l
    set status = 'expired', updated_at = now(),
        expiry_notified_on = case when v_release then v_today else l.expiry_notified_on end
    where l.status = 'current' and l.valid_until < v_today
    returning l.id, l.organization_id, l.country_code, l.valid_until
  loop
    perform audit.record('partner_licence.expired', 'partner_licence', v_licence.id::text,
      jsonb_build_object('organization_id', v_licence.organization_id, 'country_code', v_licence.country_code));
    if v_release then
      perform private.queue_org_event(v_licence.organization_id, 'partner_licence_expired',
        jsonb_build_object('licence_id', v_licence.id), 'partner_licence_expired:' || v_licence.id || ':' || v_licence.valid_until);
    end if;
    v_count := v_count + 1;
  end loop;

  if v_release then
    for v_licence in
      update public.partner_licences l
      set expiry_notified_on = v_today
      where l.status = 'current' and l.expiry_notified_on is null and l.valid_until <= v_today + v_days
        and exists (select 1 from public.organizations o where o.id = l.organization_id and o.status = 'active')
      returning l.id, l.organization_id, l.valid_until
    loop
      perform private.queue_org_event(v_licence.organization_id, 'licence_expiring',
        jsonb_build_object('licence_id', v_licence.id), 'licence_expiring:' || v_licence.id || ':' || v_licence.valid_until);
    end loop;
  end if;
  return v_count;
end;
$$;

revoke all on function private.expire_partner_licences() from public, anon, authenticated, service_role;

-- The function of 20261124100000 with the reminder added (FR-K3 AC5): the listings stamped in a run are grouped per
-- organisation and each organisation gets one listing_confirmation_due naming them, at most once a day (the key holds the
-- organisation and the day). Returns the number of listings stamped.
create or replace function private.mark_workforce_confirmations_due() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due timestamptz := now() - make_interval(days => coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'workforce_confirm_reminder_days'), 30));
  v_today date := (now() at time zone 'utc')::date;
  v_groups jsonb;
  v_group jsonb;
  v_count integer := 0;
begin
  if not private.release_on('release_partner_directories') then
    return 0;
  end if;
  with due as (
    update public.workforce_availability w
    set reminded_at = now()
    where w.confirmed_at <= v_due
      and (w.reminded_at is null or w.reminded_at <= v_due)
      and exists (select 1 from public.organizations o where o.id = w.organization_id and o.status = 'active')
    returning w.id, w.organization_id, w.confirmed_at
  )
  select jsonb_agg(jsonb_build_object('organization_id', g.organization_id, 'listing_ids', g.ids))
  into v_groups
  from (select d.organization_id, jsonb_agg(d.id order by d.confirmed_at, d.id) as ids from due d group by d.organization_id) g;

  for v_group in select value from jsonb_array_elements(coalesce(v_groups, '[]'::jsonb)) loop
    perform private.queue_org_event((v_group ->> 'organization_id')::uuid, 'listing_confirmation_due',
      jsonb_build_object('listing_ids', v_group -> 'listing_ids'),
      'listing_confirmation_due:' || (v_group ->> 'organization_id') || ':' || v_today);
    v_count := v_count + jsonb_array_length(v_group -> 'listing_ids');
  end loop;
  return v_count;
end;
$$;

revoke all on function private.mark_workforce_confirmations_due() from public, anon, authenticated, service_role;

comment on column public.partner_licences.expiry_notified_on is
  'The day the last expiry notice (licence_expiring or partner_licence_expired) was queued, so each is queued once; cleared when valid_until changes.';
comment on column public.workforce_availability.reminded_at is
  'When the daily job workforce-availability-confirm last found the listing due for confirmation (workforce_confirm_reminder_days) and queued listing_confirmation_due for its organisation.';

-- The organisation types of the user: those of the organisations they are an accepted member of, and the one they signed
-- up for while they have no organisation yet.
create function private.user_organization_types(p_user uuid) returns public.organization_type[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct t.type), '{}')
  from (
    select o.type from public.organization_members m join public.organizations o on o.id = m.organization_id
    where m.user_id = p_user and m.accepted_at is not null
    union all
    select p.intended_organization_type from public.profiles p where p.id = p_user and p.intended_organization_type is not null
  ) t
$$;

revoke all on function private.user_organization_types(uuid) from public, anon, authenticated, service_role;

-- The function of 20261114100000 with one change: a kind limited to some organisation types is listed only for a user of
-- one of them.
create or replace function public.notification_kind_catalogue() returns table (
  kind text,
  mandatory boolean,
  default_email boolean,
  audience text,
  label text,
  email_enabled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_notifications_release();
  v_kind text := private.account_kind()::text;
  v_types public.organization_type[] := private.user_organization_types(v_uid);
  v_choices jsonb := coalesce((select p.email_kinds from public.notification_preferences p where p.user_id = v_uid), '{}');
begin
  return query
  select k.kind, k.mandatory, k.default_email, k.audience, k.label,
         k.mandatory or coalesce(case when jsonb_typeof(v_choices -> k.kind) = 'boolean' then (v_choices ->> k.kind)::boolean end, k.default_email)
  from private.notification_kinds k
  where (k.audience = 'all' or k.audience = v_kind) and (k.organization_types is null or k.organization_types && v_types)
  order by k.mandatory, k.label;
end;
$$;

revoke all on function public.notification_kind_catalogue() from public, anon, authenticated, service_role;
grant execute on function public.notification_kind_catalogue() to authenticated;

-- The function of 20261114100000 with one change: a kind limited to organisation types the caller has none of is refused
-- like a kind of another audience.
create or replace function public.set_notification_preferences(p_kinds jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_notifications_release();
  v_account text := private.account_kind()::text;
  v_types public.organization_type[] := private.user_organization_types(v_uid);
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb;
begin
  if v_account is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind_required';
  end if;
  if p_kinds is null or jsonb_typeof(p_kinds) <> 'object' or p_kinds = '{}'::jsonb then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_kinds';
  end if;
  if exists (
    select 1 from jsonb_each(p_kinds) e join private.notification_kinds k on k.kind = e.key where k.mandatory
  ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'mandatory_kind';
  end if;
  if exists (
    select 1 from jsonb_each(p_kinds) e
    left join private.notification_kinds k on k.kind = e.key and k.audience in ('all', v_account)
      and (k.organization_types is null or k.organization_types && v_types)
    where k.kind is null or jsonb_typeof(e.value) <> 'boolean'
  ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_kinds';
  end if;

  -- The row exists before it is locked, so two first saves at once queue on the lock instead of one failing.
  insert into public.notification_preferences (user_id) values (v_uid) on conflict (user_id) do nothing;
  select p.email_kinds into v_old from public.notification_preferences p where p.user_id = v_uid for update;
  select jsonb_object_agg(e.key, jsonb_build_object(
           'from', coalesce(case when jsonb_typeof(v_old -> e.key) = 'boolean' then v_old -> e.key end, to_jsonb(k.default_email)),
           'to', e.value))
  into v_changes
  from jsonb_each(p_kinds) e
  join private.notification_kinds k on k.kind = e.key
  where coalesce(case when jsonb_typeof(v_old -> e.key) = 'boolean' then v_old -> e.key end, to_jsonb(k.default_email)) <> e.value;

  v_new := v_old || p_kinds;
  if v_new = v_old then
    return;
  end if;
  update public.notification_preferences set email_kinds = v_new where user_id = v_uid;
  if v_changes is not null then
    perform audit.record(
      'notification_preferences.changed', 'notification_preferences', v_uid::text, jsonb_build_object('kinds', v_changes)
    );
  end if;
end;
$$;

revoke all on function public.set_notification_preferences(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_notification_preferences(jsonb) to authenticated;
