-- Named job orders on the company page and in the follower digest (FR-K5 AC3, AC4; FR-L4 AC7; SOP P2-09 step Compose,
-- P2-13 step Notify; decisions 3.1, 3.2; NFR-S8, NFR-S11; docs/phase-2/DATA_MODEL.md sections 7 Discovery and 9; release
-- 2b). A named job order is an open requirement of an active employer with the visibility job_order_marketplace and
-- show_identity, which publish_requirement fixes for good. An anonymous job order (show_identity false) or a private
-- requirement never reaches the company page, the outbox or a digest, whoever the partner it was revealed to.
--
-- get_company_page adds the company's named job orders while release_job_orders is on: title, destination, workers and
-- the publication date, for everyone who may read the page (FR-K5 AC3, AC9), with the requirement id only for a member of
-- a listed, active, visible partner, which also gets the slug of its own company to link the job order page (FR-L4 AC7:
-- no link to a job order for anyone else, decision 3.1). The details stay behind get_job_order and its eligibility.
--
-- The first publication of a named job order of a followed company enters private.follow_activity_outbox as
-- entity_type job_order; the hourly follower digest lists it after the company's vacancies, in the same one message per
-- follower, company and UTC day, while it is still open and named and release_job_orders is on.

-- The outbox takes job orders --------------------------------------------------------------------------------------------

alter table private.follow_activity_outbox drop constraint follow_activity_outbox_entity_type_check;
alter table private.follow_activity_outbox add constraint follow_activity_outbox_entity_type_check
  check (entity_type in ('vacancy', 'job_order'));

-- The first publication (Draft -> Open, published_at newly set by the lifecycle guard) of a named job order of a company
-- with at least one follower goes to the outbox; reopening a paused requirement does not (FR-L4 AC7).
create function private.requirements_follow_activity() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.release_on('release_partner_directories') and private.release_on('release_job_orders')
     and exists (select 1 from public.follows f where f.organization_id = new.organization_id) then
    insert into private.follow_activity_outbox (organization_id, entity_type, entity_id, title)
    values (new.organization_id, 'job_order', new.id, new.title)
    on conflict (entity_type, entity_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function private.requirements_follow_activity() from public, anon, authenticated, service_role;

create trigger workforce_requirements_follow_activity
  after update of status on public.workforce_requirements
  for each row when (
    old.published_at is null and new.published_at is not null
    and new.visibility = 'job_order_marketplace' and new.show_identity
  )
  execute function private.requirements_follow_activity();

alter table public.workforce_requirements enable always trigger workforce_requirements_follow_activity;

-- The member's partner company for the job order links: the first by slug of the listed, active, visible recruitment or
-- staffing companies p_user is an accepted member of; null for everyone else.
create function private.job_order_partner_of(p_user uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = p_user and m.accepted_at is not null
    and o.type in ('recruitment_company', 'staffing_company') and o.status = 'active' and o.moderation_state = 'visible'
    and private.is_listed_partner(o.id)
  order by o.slug
  limit 1
$$;

revoke all on function private.job_order_partner_of(uuid) from public, anon, authenticated, service_role;

-- The follower digest ----------------------------------------------------------------------------------------------------

-- private.queue_follower_digests of 20261205100000_save_partner_follow.sql with the named job orders: the job orders of
-- the outbox in the follower's window that are still open, on the marketplace and named go in requirement_ids, read only
-- while release_job_orders is on; a follower who is a member of a listed partner gets that partner as partner_id for the
-- links. A follower with neither a vacancy nor a job order left gets nothing. Everything else is unchanged.
create or replace function private.queue_follower_digests(p_now timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bound timestamptz := p_now - interval '5 minutes';
  v_day date := (v_bound at time zone 'utc')::date;
  v_job_orders boolean := private.release_on('release_job_orders');
  v_digest record;
  v_partner uuid;
  v_message jsonb;
  v_count integer := 0;
begin
  if not private.release_on('release_partner_directories') then
    return 0;
  end if;
  delete from private.follow_activity_outbox x where x.created_at < p_now - interval '2 days';

  for v_digest in
    select f.user_id, f.organization_id,
           (select jsonb_agg(x.entity_id order by x.created_at, x.id)
            from private.follow_activity_outbox x
            join public.jobs j on j.id = x.entity_id
            where x.organization_id = f.organization_id and x.entity_type = 'vacancy'
              and x.created_at > coalesce(f.last_digest_at, f.created_at) and x.created_at <= v_bound
              and j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible') as job_ids,
           (select jsonb_agg(x.entity_id order by x.created_at, x.id)
            from private.follow_activity_outbox x
            join public.workforce_requirements r on r.id = x.entity_id
            where v_job_orders and x.organization_id = f.organization_id and x.entity_type = 'job_order'
              and x.created_at > coalesce(f.last_digest_at, f.created_at) and x.created_at <= v_bound
              and r.status = 'open' and r.visibility = 'job_order_marketplace' and r.show_identity) as requirement_ids
    from public.follows f
    join public.profiles p on p.id = f.user_id
    where (f.last_digest_at is null or (f.last_digest_at at time zone 'utc')::date < v_day)
      and p.status = 'active'
      and exists (
        select 1 from private.follow_activity_outbox x
        where x.organization_id = f.organization_id and x.created_at > coalesce(f.last_digest_at, f.created_at)
          and x.created_at <= v_bound
      )
      and private.is_followable(f.organization_id)
      and not exists (
        select 1 from public.organization_members m
        where m.organization_id = f.organization_id and m.user_id = f.user_id and m.accepted_at is not null
      )
    order by f.organization_id, f.user_id
    for update of f skip locked
  loop
    if v_digest.job_ids is null and v_digest.requirement_ids is null then
      continue;
    end if;
    update public.follows set last_digest_at = v_bound where user_id = v_digest.user_id and organization_id = v_digest.organization_id;
    v_message := jsonb_build_object(
      'kind', 'followed_company_activity', 'user_id', v_digest.user_id, 'organization_id', v_digest.organization_id,
      'job_ids', coalesce(v_digest.job_ids, '[]'::jsonb), 'mandatory', false,
      'dedupe_key', 'followed_company_activity:' || v_digest.organization_id || ':' || v_day
    );
    if v_digest.requirement_ids is not null then
      v_message := v_message || jsonb_build_object('requirement_ids', v_digest.requirement_ids);
      v_partner := private.job_order_partner_of(v_digest.user_id);
      if v_partner is not null then
        v_message := v_message || jsonb_build_object('partner_id', v_partner);
      end if;
    end if;
    perform pgmq.send('notifications', v_message);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- The payload ------------------------------------------------------------------------------------------------------------

-- private.notification_payload of 20270104100000_submission_pipeline.sql with the job orders of followed_company_activity.
-- Every other branch is unchanged.
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
    -- V50: a submission's stage names the requirement as the candidate may read it, the partner that proposed the
    -- candidate and the employer only when it shows its name; never the note (FR-O5 AC9).
    when 'status_changed' then case
      when p_message ? 'submission_id' then coalesce((
        select jsonb_build_object('submission_id', s.id, 'job_title', private.submission_candidate_title(r),
          'org_name', case when r.show_identity then e.display_name end, 'partner_name', o.display_name,
          'status', p_message -> 'status')
        from public.candidate_submissions s
        join public.organizations o on o.id = s.organization_id
        join public.workforce_requirements r on r.id = s.requirement_id
        join public.organizations e on e.id = r.organization_id
        where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
      else jsonb_build_object(
        'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name,
        'status', p_message -> 'status')
    end
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
    -- V54: the named job orders of the digest follow the vacancies, by their current title, the ten oldest with how many
    -- there are; a partner follower's items carry the requirement id and the slug of the follower's own company for the
    -- link, a candidate's the title only (decision 3.1). Absent when the digest holds no job order.
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
      ), '[]'::jsonb),
      'job_order_total', case when p_message ? 'requirement_ids' then jsonb_array_length(p_message -> 'requirement_ids') end,
      'partner_slug', (select o.slug from public.organizations o where o.id = (p_message ->> 'partner_id')::uuid),
      'job_orders', case when p_message ? 'requirement_ids' then coalesce((
        select jsonb_agg(jsonb_build_object(
          'requirement_id', case when p_message ? 'partner_id' then x.id end, 'title', x.title) order by x.position)
        from (
          select r.id, r.title, e.position
          from jsonb_array_elements_text(p_message -> 'requirement_ids') with ordinality e(id, position)
          join public.workforce_requirements r on r.id = e.id::uuid
          order by e.position
          limit 10
        ) x
      ), '[]'::jsonb) end)
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
    -- The recipient's own organisation names the link; never the employer to a partner. A partner's reminder (V43) names
    -- its invitation for the link to its invitation page.
    when 'requirement_closing_soon' then case
      when p_message ? 'requirement_invitation_id' then coalesce((
        select jsonb_build_object('requirement_id', r.id, 'invitation_id', i.id, 'title', r.title, 'closes_on', r.closes_on,
          'org_slug', v_slug)
        from public.requirement_invitations i join public.workforce_requirements r on r.id = i.requirement_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
      -- V44: a marketplace responder, which the requirement's own title names only when the employer is named to it.
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('requirement_id', r.id, 'response_id', p.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'closes_on', r.closes_on, 'org_slug', v_slug)
        from public.partner_responses p join public.workforce_requirements r on r.id = p.requirement_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('requirement_id', r.id, 'title', r.title, 'closes_on', r.closes_on, 'org_slug', v_slug)
        from public.workforce_requirements r where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    end
    -- NFR-S11: the generated title and the destination only, whatever the employer chose to show; the slug is the
    -- recipient partner's own, for the link to its job order page.
    when 'job_order_match' then coalesce((
      select jsonb_build_object('requirement_id', r.id, 'title', private.job_order_neutral_title(r.id),
        'country_code', r.country_code, 'country_name', c.name, 'org_slug', v_slug)
      from public.workforce_requirements r join public.countries c on c.code = r.country_code
      where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    -- An invitation reveals the employer to the invited partner (decision 3.2; NFR-S11 protects the partners that are
    -- not invited or selected), so the item and the email name the requirement's own title and the employer (FR-O1
    -- AC7, AC11), and nothing else of the employer: no member, no address. The slug is the recipient partner's own.
    when 'invitation_received' then coalesce((
      select jsonb_build_object('invitation_id', i.id, 'title', r.title,
        'country_code', r.country_code, 'country_name', c.name, 'workers_needed', r.workers_needed,
        'start_date', r.start_date, 'employer_name', e.display_name, 'org_slug', v_slug)
      from public.requirement_invitations i
      join public.workforce_requirements r on r.id = i.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    when 'invitation_withdrawn' then coalesce((
      select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name, 'org_slug', v_slug)
      from public.requirement_invitations i
      join public.workforce_requirements r on r.id = i.requirement_id
      join public.organizations e on e.id = r.organization_id
      where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    -- V43: the invitation reveals the requirement's own title and the employer to the invited partner (as
    -- invitation_received); the change notice names the fields changed in the versions from_version to to_version, in
    -- the order of the form, never their values, who changed them or anything the invitation did not show.
    when 'requirement_changed' then case
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
          'changed_fields', (
            select coalesce(jsonb_agg(f.name order by f.position), '[]')
            from unnest(private.requirement_change_fields()) with ordinality f(name, position)
            where exists (
              select 1 from public.requirement_versions v
              where v.requirement_id = r.id and f.name = any (v.changed_fields)
                and v.version between (p_message ->> 'from_version')::integer and (p_message ->> 'to_version')::integer)),
          'from_version', (p_message ->> 'from_version')::integer, 'to_version', (p_message ->> 'to_version')::integer,
          'org_slug', v_slug)
        from public.partner_responses p
        join public.workforce_requirements r on r.id = p.requirement_id
        join public.organizations e on e.id = r.organization_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name,
          'changed_fields', (
            select coalesce(jsonb_agg(f.name order by f.position), '[]')
            from unnest(private.requirement_change_fields()) with ordinality f(name, position)
            where exists (
              select 1 from public.requirement_versions v
              where v.requirement_id = r.id and f.name = any (v.changed_fields)
                and v.version between (p_message ->> 'from_version')::integer and (p_message ->> 'to_version')::integer)),
          'from_version', (p_message ->> 'from_version')::integer, 'to_version', (p_message ->> 'to_version')::integer,
          'org_slug', v_slug)
        from public.requirement_invitations i
        join public.workforce_requirements r on r.id = i.requirement_id
        join public.organizations e on e.id = r.organization_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    end
    when 'requirement_closed' then case
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
          'close_reason', r.close_reason, 'org_slug', v_slug)
        from public.partner_responses p
        join public.workforce_requirements r on r.id = p.requirement_id
        join public.organizations e on e.id = r.organization_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name,
          'close_reason', r.close_reason, 'org_slug', v_slug)
        from public.requirement_invitations i
        join public.workforce_requirements r on r.id = i.requirement_id
        join public.organizations e on e.id = r.organization_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    end
    -- V44: to the employer's owners and admins, the requirement's own title and the partner's display name; never the
    -- statement, the fee or the withdrawal reason of the response (FR-T1 AC2). The slug is the employer's own.
    when 'response_received' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id, 'title', r.title,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations o on o.id = p.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
    when 'response_withdrawn' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id, 'title', r.title,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations o on o.id = p.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
    -- V47: to the partner's owners and admins, its own decision only; the requirement's own title and the employer's name
    -- once the employer is named to the partner, the generated title otherwise (NFR-S11). Never the note or anything of
    -- another partner (FR-O3 AC7). The slug is the partner's own.
    when 'response_decided' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
        'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
        'decision', p_message ->> 'decision', 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations e on e.id = r.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid
        and p_message ->> 'decision' in ('shortlisted', 'selected', 'declined', 'submissions_allowed')), '{}'::jsonb)
    -- V48: to the candidate, the partner and the requirement as the candidate may read it (the employer's own title and
    -- name only when the employer shows its name, NFR-S11), destination and start date, for the request page; to an
    -- address without an account the same without the id (the page needs an account). Never the address or another
    -- partner (FR-O4 AC1, AC2, AC10).
    when 'submission_request' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'partner_name', o.display_name,
        'title', private.submission_candidate_title(r), 'country_code', r.country_code, 'country_name', c.name,
        'start_date', r.start_date, 'employer_name', case when r.show_identity then e.display_name end)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    when 'submission_request_signup' then coalesce((
      select jsonb_build_object('partner_name', o.display_name, 'title', private.submission_candidate_title(r),
        'country_code', r.country_code, 'country_name', c.name, 'start_date', r.start_date,
        'employer_name', case when r.show_identity then e.display_name end)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    -- V48: to the owners and admins of the partner and of the employer, the requirement as the recipient knows it (the
    -- generated title to a partner the employer is not named to) and the partner's name; never the candidate, the address
    -- or the documents (FR-O4 AC5, AC9). The slug is the recipient's own.
    when 'submission_approved' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when (p_message ->> 'organization_id')::uuid = s.employer_organization_id
                        or private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    when 'submission_withdrawn' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when (p_message ->> 'organization_id')::uuid = s.employer_organization_id
                        or private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    -- V50: to the partner's owners and admins, the stage its candidate reached and the requirement as the partner knows it
    -- (the generated title until the employer is named to it); never the candidate's name, the note or the reason (FR-O5
    -- AC5, AC10). The slug is the partner's own.
    when 'submission_stage_changed' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'status', p_message ->> 'status', 'org_slug', v_slug)
      from public.candidate_submissions s
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid
        and p_message ->> 'status' in ('shortlisted', 'interview', 'offer', 'hired', 'rejected')), '{}'::jsonb)
    else '{}'::jsonb
  end);
end;
$$;

-- The company page -------------------------------------------------------------------------------------------------------

-- get_company_page of 20261204100000_company_page.sql with the named job orders (FR-K5 AC3, AC4): job_order_count and at
-- most the 100 newest as job_orders (title, destination, workers, publication date, and the id only for a partner
-- member), and viewer_partner_slug, the caller's own listed partner for the links; an empty list, a count of 0 and no
-- slug while release_job_orders is off. Every other column and the public predicate are unchanged (return type change:
-- drop and recreate).
drop function public.get_company_page(text);

create function public.get_company_page(p_slug text)
returns table (
  slug text,
  display_name text,
  based_in_country text,
  based_in_country_name text,
  industry_code text,
  industry_name text,
  website text,
  description text,
  open_vacancy_count integer,
  vacancies jsonb,
  viewer_role public.member_role,
  job_order_count integer,
  job_orders jsonb,
  viewer_partner_slug text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_job_orders boolean := private.release_on('release_job_orders');
  v_partner uuid;
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.slug = p_slug and o.type = 'employer' and o.status = 'active' and o.public_page_enabled;
  if v_org is null then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_job_orders and v_uid is not null then
    v_partner := private.job_order_partner_of(v_uid);
  end if;

  return query
  select
    o.slug,
    o.display_name,
    o.based_in_country,
    bc.name,
    o.industry_code,
    i.name,
    o.website,
    o.description,
    (select count(*)::integer from public.jobs j
     where j.organization_id = o.id and j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible'),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'title', v.title, 'city', v.city, 'country_code', v.country_code, 'country', v.country,
        'employment_type', v.employment_type, 'salary_min', v.salary_min, 'salary_max', v.salary_max,
        'salary_currency', v.salary_currency, 'salary_period', v.salary_period, 'published_at', v.published_at
      ) order by v.published_at desc, v.id desc), '[]'::jsonb)
     from (
       select j.id, j.title, j.city, j.country_code, c.name as country, j.employment_type, j.salary_min, j.salary_max,
         j.salary_currency, j.salary_period, coalesce(j.published_at, j.created_at) as published_at
       from public.jobs j
       join public.countries c on c.code = j.country_code
       where j.organization_id = o.id and j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible'
       order by coalesce(j.published_at, j.created_at) desc, j.id desc
       limit 100
     ) v),
    (select m.role from public.organization_members m
     where v_uid is not null and m.organization_id = o.id and m.user_id = v_uid and m.accepted_at is not null),
    (select count(*)::integer from public.workforce_requirements r
     where v_job_orders and r.organization_id = o.id and r.status = 'open' and r.visibility = 'job_order_marketplace'
       and r.show_identity),
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', case when v_partner is not null then r.id end, 'title', r.title, 'country_code', r.country_code,
        'country', r.country, 'workers_needed', r.workers_needed, 'published_on', r.published_on
      )) order by r.published_at desc, r.id), '[]'::jsonb)
     from (
       select w.id, w.title, w.country_code, c.name as country, w.workers_needed, w.published_at,
         (w.published_at at time zone 'utc')::date as published_on
       from public.workforce_requirements w
       join public.countries c on c.code = w.country_code
       where v_job_orders and w.organization_id = o.id and w.status = 'open' and w.visibility = 'job_order_marketplace'
         and w.show_identity
       order by w.published_at desc, w.id
       limit 100
     ) r),
    (select p.slug from public.organizations p where p.id = v_partner)
  from public.organizations o
  join public.countries bc on bc.code = o.based_in_country
  left join public.industries i on i.code = o.industry_code
  where o.id = v_org;
end;
$$;

revoke all on function public.get_company_page(text) from public, anon, authenticated, service_role;
grant execute on function public.get_company_page(text) to anon, authenticated;
