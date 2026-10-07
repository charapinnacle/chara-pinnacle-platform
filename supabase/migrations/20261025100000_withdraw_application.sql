-- Withdraw an application (FR-D4; ARCHITECTURE.md sections 4, 7.3; OPEN_QUESTIONS.md D55). The candidate who owns an
-- application ends it from any state before the final ones. withdraw_application writes, in one transaction, the status
-- (judged by the guard of FR-D2), the event, the audit row, the revocation of the share, the withdrawn consent row and the
-- queue message for the candidate. It is never blocked by the vacancy, the organisation or the plan, and it does not call
-- private.assert_org_writable.
--
-- The consent of a share now names the application as well as the organisation (share_passport:<organisation>:<application>).
-- document_access_grant cancels a share when a later withdrawn row has the same user and purpose; with the organisation
-- alone, withdrawing one application of an organisation would have cancelled the candidate's other shares to it (FR-D4 AC11).
-- The grant is not changed. Only the per-application form is accepted: nothing is deployed that holds the old form. The
-- withdrawn row copies the purpose and the version of the granted row that the share points at.

-- The purpose ends in the application id.
create or replace function private.consents_check_document() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.purpose is null or new.version is null then
    return new;
  end if;
  if not exists (
    select 1 from public.legal_documents d
    where d.version = new.version
      and d.slug = (case when new.purpose ~ '^share_passport:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         then 'sharing-notice' else new.purpose end)
  ) then
    raise exception 'insert or update on table "consents" violates foreign key constraint "consents_purpose_version_fkey"'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

-- apply_to_job is replaced with one change: the purpose of the consent ends in the id of the application it creates.
create or replace function public.apply_to_job(p_job_id uuid, p_note text default null, p_document_ids uuid[] default null)
returns table (application_id uuid, outcome text)
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
  v_existing uuid;
  v_profile public.worker_profiles;
  v_missing text[];
  v_version integer;
  v_consent bigint;
  v_app uuid := gen_random_uuid();
  v_share uuid := gen_random_uuid();
  v_recipients jsonb[];
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
  if (select count(*) from audit.log l
      where l.actor_id = v_uid and l.action in ('application.submitted', 'application.duplicate_attempt')
        and l.created_at > now() - make_interval(secs => v_window)) >= v_max then
    raise exception 'CHARA_RATE_LIMITED';
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

  select j.organization_id into v_organization from public.jobs j
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
    jsonb_build_object(
      'first_name', v_profile.first_name,
      'last_name', v_profile.last_name,
      'headline', v_profile.headline,
      'current_country', v_profile.current_country,
      'occupation_id', v_profile.occupation_id,
      'occupation', (select o.label from public.occupations o where o.code = v_profile.occupation_id),
      'years_experience', v_profile.years_experience,
      'availability', v_profile.availability,
      'available_from', v_profile.available_from,
      'skills', coalesce((select jsonb_agg(s.skill order by lower(s.skill)) from public.worker_skills s where s.worker_user_id = v_uid), '[]'),
      'languages', coalesce((
        select jsonb_agg(jsonb_build_object('code', l.language_code, 'level', l.cefr_level) order by l.language_code)
        from public.worker_languages l where l.worker_user_id = v_uid), '[]'),
      'preferred_countries', coalesce((
        select jsonb_agg(c.country_code order by c.country_code) from public.worker_preferred_countries c where c.worker_user_id = v_uid), '[]'),
      'work_authorizations', coalesce((
        select jsonb_agg(jsonb_build_object('country', a.country_code, 'expires_on', a.expires_on) order by a.country_code)
        from public.worker_work_authorizations a where a.worker_user_id = v_uid), '[]')
    )
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
  return next;
end;
$$;

-- private.move_application is replaced with one change: the audit action of a move to Withdrawn is application.withdrawn
-- (every other move stays application.status_changed).
create or replace function private.move_application(
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
    case p_to when 'withdrawn' then 'application.withdrawn' else 'application.status_changed' end, 'job_application', p_app.id::text,
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

-- The owner of the application withdraws it. Errors: CHARA_NOT_FOUND (P0002) for an unknown id, an application of somebody
-- else, an employer member, platform staff and a caller who is not signed in; CHARA_INVALID_TRANSITION for an application
-- that is Hired, Not selected or already Withdrawn, so a second call changes nothing. No note is taken: the event has none.
-- The row is locked FOR NO KEY UPDATE like the employer's moves, so a withdrawal and a stage change at once make one move
-- and the other gets CHARA_INVALID_TRANSITION.
create function public.withdraw_application(p_application_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_app public.job_applications;
begin
  select a.* into v_app from public.job_applications a
  where a.id = p_application_id and a.worker_user_id = v_uid
  for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform private.move_application(v_app, 'withdrawn', 'withdraw_application', v_uid, null);

  update public.passport_shares s set revoked_at = now()
  where s.application_id = v_app.id and s.revoked_at is null;
  insert into public.consents (user_id, purpose, version, action)
  select c.user_id, c.purpose, c.version, 'withdrawn'
  from public.passport_shares s
  join public.consents c on c.id = s.consent_id and c.user_id = v_uid
  where s.application_id = v_app.id;
end;
$$;

revoke all on function public.withdraw_application(uuid) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_application(uuid) to authenticated;
