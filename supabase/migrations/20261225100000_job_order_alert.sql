-- The new job order alert (FR-N1 step Alert, AC10; FR-T1 kind job_order_match; NFR-S11; DATA_MODEL.md section 9;
-- release 2b). When an employer publishes a requirement to the job order marketplace, the owners and admins of every
-- partner that is eligible for it (private.job_order_partner_facts and private.job_order_reasons of V39: listed, active,
-- visible, a paid plan with job_order_access, one destination served and one occupation listed) and who switched the
-- alert on are notified, once per job order. The alert is opt-in: job_order_match is optional with default_email false,
-- and its switch on the notification settings page (notification_preferences.email_kinds) decides who receives it at
-- all; a recipient with it off, or who never chose, gets no row, not even an in-app item (FR-N1 AC10 "none for P3"), so
-- partners who did not ask are not sent an item per job order. Members, pending invitees, partners that are not eligible
-- and private or invited-only requirements get nothing; a pause and reopen does not alert again (only the first
-- publication, Draft -> Open, and a dedupe key per job order). Each recipient gets at most job_order_match_daily_max
-- (10, 1..100 in the settings editor) alerts a UTC day; further job orders that day are not alerted, as the marketplace
-- lists them anyway. Nothing is sent while release_job_orders is off.
--
-- The payload holds the requirement id, the generated title (private.job_order_neutral_title, never the employer's own
-- title or name, even when the employer shows it), the destination and the recipient partner's own slug for the link:
-- an alert never names a hidden employer, and an email leaves the platform. The rows go through the notifications queue
-- like every organisation event (the message shape of private.queue_org_event, in the publishing transaction); the
-- delivery, the suppression of undeliverable addresses and the in-app list are those of FR-T1.

insert into private.settings (key, value) values ('job_order_match_daily_max', '10') on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('job_order_match_daily_max', 'integer', 1, 100, 'New job order alerts per person and day, at most', null);

-- Optional, off by default, for recruitment and staffing companies.
insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types) values
  ('job_order_match', false, false, 'company', 'New job orders that fit',
    array['recruitment_company', 'staffing_company']::public.organization_type[]);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon', 'job_order_match'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- The cap and the dedupe count only the alerts of one recipient.
create index notifications_job_order_match_idx on public.notifications (user_id, created_at) where kind = 'job_order_match';

-- private.notification_payload of 20261216100000_requirement_lifecycle.sql with job_order_match added. Every other
-- branch is unchanged.
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
    -- NFR-S11: the generated title and the destination only, whatever the employer chose to show; the slug is the
    -- recipient partner's own, for the link to its job order page.
    when 'job_order_match' then coalesce((
      select jsonb_build_object('requirement_id', r.id, 'title', private.job_order_neutral_title(r.id),
        'country_code', r.country_code, 'country_name', c.name, 'org_slug', v_slug)
      from public.workforce_requirements r join public.countries c on c.code = r.country_code
      where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    else '{}'::jsonb
  end);
end;
$$;


-- The partners eligible for the open marketplace requirement p_requirement, as list_job_orders judges them, and the
-- accepted owners and admins of each who switched the alert on, are below their daily cap and were not alerted for it
-- yet: one message each (a person in two such partners gets one, for the first). Answers the number queued; nothing
-- while release 2b is off, for a requirement that is not an open job order of an active employer.
create function private.queue_job_order_matches(p_requirement uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'job_order_match:' || p_requirement;
  v_max integer := coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,4}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'job_order_match_daily_max'), 10);
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_messages jsonb[];
begin
  if not private.release_on('release_job_orders') or not exists (
    select 1 from public.workforce_requirements r join public.organizations e on e.id = r.organization_id
    where r.id = p_requirement and r.status = 'open' and r.visibility = 'job_order_marketplace' and e.status = 'active'
  ) then
    return 0;
  end if;

  with partners as materialized (
    select o.id
    from public.organizations o
    where o.type in ('recruitment_company', 'staffing_company') and o.status = 'active' and o.moderation_state = 'visible'
      and private.is_listed_partner(o.id)
      and exists (
        select 1 from public.organization_geographies g
        join public.requirement_countries rc on rc.country_code = g.country_code and rc.requirement_id = p_requirement
        where g.organization_id = o.id and g.scope = 'serves_market')
      and exists (
        select 1 from public.organization_occupations oo
        join public.requirement_occupations ro on ro.occupation_id = oo.occupation_id and ro.requirement_id = p_requirement
        where oo.organization_id = o.id)
  ),
  eligible as materialized (
    select pa.id
    from partners pa cross join lateral private.job_order_partner_facts(pa.id) f
    where cardinality(private.job_order_reasons(p_requirement, f.paid, f.served, f.occupations)) = 0
  )
  select array_agg(x.message order by x.user_id)
  into v_messages
  from (
    select distinct on (m.user_id) m.user_id, jsonb_build_object(
      'kind', 'job_order_match', 'user_id', m.user_id, 'organization_id', m.organization_id, 'mandatory', false,
      'dedupe_key', v_key, 'requirement_id', p_requirement) as message
    from eligible e
    join public.organization_members m on m.organization_id = e.id and m.role in ('owner', 'admin') and m.accepted_at is not null
    join public.notification_preferences p on p.user_id = m.user_id and p.email_kinds -> 'job_order_match' = 'true'::jsonb
    where not exists (
        select 1 from public.notifications n where n.user_id = m.user_id and n.kind = 'job_order_match' and n.dedupe_key = v_key)
      and (select count(*) from public.notifications n
           where n.user_id = m.user_id and n.kind = 'job_order_match' and n.created_at >= v_day) < v_max
    order by m.user_id, e.id
  ) x;

  if v_messages is null then
    return 0;
  end if;
  perform pgmq.send_batch('notifications', v_messages);
  return cardinality(v_messages);
end;
$$;

revoke all on function private.queue_job_order_matches(uuid) from public, anon, authenticated, service_role;

-- The first publication of a requirement to the marketplace (publish_requirement: Draft -> Open with the visibility
-- job_order_marketplace) alerts in the publishing transaction; reopening a paused one does not.
create function private.requirements_job_order_alert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.queue_job_order_matches(new.id);
  return null;
end;
$$;

revoke all on function private.requirements_job_order_alert() from public, anon, authenticated, service_role;

create trigger workforce_requirements_job_order_alert
  after update of status on public.workforce_requirements
  for each row when (old.status = 'draft' and new.status = 'open' and new.visibility = 'job_order_marketplace')
  execute function private.requirements_job_order_alert();
