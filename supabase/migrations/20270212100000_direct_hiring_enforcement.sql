-- Direct-hiring rules enforced (FR-Q5 AC5, AC6, AC8, AC9; FR-K1 AC8; SOP P2-34 steps Enforce in search, Enforce in
-- applications, Partners; decisions 4.5, 6.1; NFR-C6; V72, release 2c). The rules of V37 are read through one function
-- wherever an organisation or a worker acts, under the gate V37 named: release_job_orders or release_find_workers.
--
-- private.direct_hiring_rule_for(org, source, destination) is the shared rule: the rule of the worker's current country
-- (never a nationality) for the destination and what it means for direct contact by p_org, through
-- private.worker_card_contact, the function Find Workers shapes its cards with and send_contact_request refuses with
-- (V69, V70); a recruitment or staffing company with a current licence for the destination is allowed where a licensed
-- partner is required, as in partner responses (V44). private.assert_direct_hiring_allowed(org, source, destination) is
-- the refusal of contact started by an organisation (invite to job, V71): CHARA_FORBIDDEN direct_hiring_blocked or
-- licensed_partner_required. apply_to_job refuses a blocked pair and carries the rule and notice of the others; a worker
-- applying where a licensed partner is required is allowed with the notice (FR-Q5 open point, pending the legal opinion
-- [d6.1]). The partner channel (responses, submissions) is never refused by a rule, and a rule added later leaves
-- existing applications, requests and conversations alone: only new actions read it.

create function private.direct_hiring_enforced() returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.release_on('release_job_orders') or private.release_on('release_find_workers') $$;

revoke all on function private.direct_hiring_enforced() from public, anon, authenticated, service_role;

-- Whether p_org may contact workers directly where a licensed partner is required for p_destination: a recruitment or
-- staffing company with a current licence entry for it (V69's reading); an employer, or no organisation, never.
create function private.org_licensed_for(p_org uuid, p_destination text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.type <> 'employer' from public.organizations o where o.id = p_org), false
  ) and private.holds_licence_for(p_org, p_destination)
$$;

revoke all on function private.org_licensed_for(uuid, text) from public, anon, authenticated, service_role;

create function private.direct_hiring_rule_for(p_org uuid, p_source text, p_destination text)
returns table (rule public.direct_hiring_rule_value, direct_contact text, notice text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.rule, c.direct_contact, c.notice
  from private.direct_hiring_rule(p_source, p_destination) d
  cross join private.worker_card_contact(p_source, p_destination, private.org_licensed_for(p_org, p_destination)) c
$$;

revoke all on function private.direct_hiring_rule_for(uuid, text, text) from public, anon, authenticated, service_role;

create function private.assert_direct_hiring_allowed(p_org uuid, p_source text, p_destination text) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact text;
begin
  if not private.direct_hiring_enforced() then
    return;
  end if;
  select d.direct_contact into v_contact from private.direct_hiring_rule_for(p_org, p_source, p_destination) d;
  if v_contact = 'blocked' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'direct_hiring_blocked', errcode = '42501';
  end if;
  if v_contact = 'partner_required' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'licensed_partner_required', errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_direct_hiring_allowed(uuid, text, text) from public, anon, authenticated, service_role;

-- Whether p_destination needs a licence p_org does not hold, as the licence check of partner responses reads it
-- (V44, private.response_licence_missing, DATA_MODEL.md section 11 item 6): the rule of one of the partner's source
-- countries to the destination is licensed_partner_required, or, for a partner listing no source, any such rule names the
-- destination.
create function private.destination_needs_licence(p_org uuid, p_destination text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with sources as (
    select g.country_code from public.organization_geographies g
    where g.organization_id = p_org and g.scope = 'sources_from'
  )
  select case
      when exists (select 1 from sources) then exists (
        select 1 from sources s cross join lateral private.direct_hiring_rule(s.country_code, p_destination) d
        where s.country_code <> p_destination and d.rule = 'licensed_partner_required')
      else exists (
        select 1 from public.direct_hiring_rules d
        where d.destination_country = p_destination and d.rule = 'licensed_partner_required')
    end
    and not private.holds_licence_for(p_org, p_destination)
$$;

revoke all on function private.destination_needs_licence(uuid, text) from public, anon, authenticated, service_role;

-- The served countries of p_org that need a licence it does not hold (FR-K1 AC8: the prompt after Where you serve is
-- saved), by code. Any accepted member; CHARA_FORBIDDEN otherwise; CHARA_NOT_FOUND while the gate is off.
create function public.licence_required_destinations(p_org uuid) returns table (country_code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.direct_hiring_enforced() then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  return query
  select g.country_code from public.organization_geographies g
  where g.organization_id = p_org and g.scope = 'serves_market' and private.destination_needs_licence(p_org, g.country_code)
  order by g.country_code;
end;
$$;

revoke all on function public.licence_required_destinations(uuid) from public, anon, authenticated, service_role;
grant execute on function public.licence_required_destinations(uuid) to authenticated;

-- apply_to_job (risky, DATA_MODEL.md section 4): the function of 20261111110000 with the direct-hiring rule of the
-- candidate's current country for the vacancy's country, checked once the passport is complete and only for a new
-- application (an earlier one is still answered existing). A blocked pair is refused with CHARA_FORBIDDEN
-- direct_hiring_blocked and writes nothing; otherwise the application is created and the answer carries the rule and its
-- notice for the page. While the gate is off both stay null and nothing is refused. The return shape changes, so the
-- function is dropped and created again with its grants.
drop function public.apply_to_job(uuid, text, uuid[]);

create function public.apply_to_job(p_job_id uuid, p_note text default null, p_document_ids uuid[] default null)
returns table (application_id uuid, outcome text, hiring_rule public.direct_hiring_rule_value, hiring_notice text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind public.account_kind;
  v_status public.profile_status;
  v_closing timestamptz;
  v_limits record;
  v_max integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'apply_rate_limit_max');
  v_window integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'apply_rate_limit_window_seconds');
  v_note text;
  v_ids uuid[];
  v_organization uuid;
  v_country text;
  v_existing uuid;
  v_profile public.worker_profiles;
  v_missing text[];
  v_rule public.direct_hiring_rule_value;
  v_notice text;
  v_version integer;
  v_consent bigint;
  v_app uuid := gen_random_uuid();
  v_share uuid := gen_random_uuid();
  v_recipients jsonb[];
  v_attempts bigint;
  v_oldest timestamptz;
begin
  select p.account_kind, p.status, p.deleted_at into v_kind, v_status, v_closing
  from public.profiles p where p.id = v_uid for no key update;
  if v_uid is null or not found or v_kind is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required';
  end if;
  if v_status <> 'active' or v_closing is not null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_not_active';
  end if;

  if v_max is null or v_window is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'apply_rate_limit';
  end if;
  select count(*) into v_attempts
  from audit.log l
  where l.actor_id = v_uid and l.action in ('application.submitted', 'application.duplicate_attempt')
    and l.created_at > now() - make_interval(secs => v_window);
  if v_attempts >= v_max then
    -- The count falls under the limit only when the v_max-th newest attempt leaves the window: the oldest one is not enough
    -- once the limit has been lowered below the count.
    select l.created_at into v_oldest
    from audit.log l
    where l.actor_id = v_uid and l.action in ('application.submitted', 'application.duplicate_attempt')
      and l.created_at > now() - make_interval(secs => v_window)
    order by l.created_at desc
    offset v_max - 1 limit 1;
    raise exception 'CHARA_RATE_LIMITED'
      using detail = greatest(1, ceil(extract(epoch from v_oldest + make_interval(secs => v_window) - now())))::integer::text;
  end if;

  select * into v_limits from public.apply_limits();
  v_note := nullif(regexp_replace(coalesce(p_note, ''), '^\s+|\s+$', '', 'g'), '');
  if length(v_note) > v_limits.cover_note_max_chars then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_note';
  end if;
  if exists (select 1 from unnest(coalesce(p_document_ids, '{}')) d where d is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_document_ids';
  end if;
  v_ids := array(select distinct d from unnest(coalesce(p_document_ids, '{}')) d order by d);
  if cardinality(v_ids) > v_limits.documents_max then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_document_ids';
  end if;

  select j.organization_id, j.country_code into v_organization, v_country from public.jobs j
  where j.id = p_job_id and j.status = 'open' and j.moderation_state = 'visible' and j.deleted_at is null;
  if not found then
    raise exception 'CHARA_JOB_NOT_OPEN';
  end if;

  select a.id into v_existing from public.job_applications a
  where a.job_id = p_job_id and a.worker_user_id = v_uid and a.status <> 'withdrawn';
  if found then
    perform audit.record('application.duplicate_attempt', 'job_application', v_existing::text, jsonb_build_object('job_id', p_job_id));
    application_id := v_existing;
    outcome := 'existing';
    return next;
    return;
  end if;

  select * into v_profile from public.worker_profiles w where w.user_id = v_uid;
  v_missing := array_remove(array[
    case when v_profile.first_name is null then 'first_name' end,
    case when v_profile.last_name is null then 'last_name' end,
    case when v_profile.current_country is null then 'current_country' end,
    case when v_profile.occupation_id is null then 'occupation_id' end
  ], null);
  if cardinality(v_missing) > 0 then
    raise exception 'CHARA_PROFILE_INCOMPLETE' using detail = array_to_string(v_missing, ', ');
  end if;

  if private.direct_hiring_enforced() then
    select d.rule, d.notice into v_rule, v_notice
    from private.direct_hiring_rule_for(null, v_profile.current_country, v_country) d;
    if v_rule = 'blocked' then
      raise exception 'CHARA_FORBIDDEN' using detail = 'direct_hiring_blocked', errcode = '42501';
    end if;
  end if;

  if (select count(*) from public.worker_documents d
      where d.id = any (v_ids) and d.worker_user_id = v_uid and d.deleted_at is null) <> cardinality(v_ids) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_version := private.current_legal_version('sharing-notice');
  if v_version is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'sharing-notice';
  end if;
  insert into public.consents (user_id, purpose, version, action)
  values (v_uid, 'share_passport:' || v_organization || ':' || v_app, v_version, 'granted')
  returning id into v_consent;

  insert into public.job_applications (id, job_id, organization_id, worker_user_id, cover_note, passport_share_id, profile_snapshot)
  values (
    v_app, p_job_id, v_organization, v_uid, v_note, v_share,
    private.profile_snapshot(v_uid)
  );
  insert into public.passport_shares (id, worker_user_id, organization_id, application_id, scope, consent_id)
  values (v_share, v_uid, v_organization, v_app, to_jsonb(v_ids), v_consent);
  insert into public.application_events (application_id, from_status, to_status, actor_id)
  values (v_app, null, 'applied', v_uid);
  perform audit.record(
    'application.submitted', 'job_application', v_app::text,
    jsonb_build_object('job_id', p_job_id, 'organization_id', v_organization, 'document_count', cardinality(v_ids))
  );

  select array_agg(jsonb_build_object(
    'kind', 'application_received', 'user_id', m.user_id, 'application_id', v_app, 'job_id', p_job_id, 'mandatory', false
  )) into v_recipients
  from public.organization_members m where m.organization_id = v_organization and m.accepted_at is not null;
  if v_recipients is not null then
    perform pgmq.send_batch('notifications', v_recipients);
  end if;

  application_id := v_app;
  outcome := 'created';
  hiring_rule := v_rule;
  hiring_notice := v_notice;
  return next;
end;
$$;

revoke all on function public.apply_to_job(uuid, text, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.apply_to_job(uuid, text, uuid[]) to authenticated;
