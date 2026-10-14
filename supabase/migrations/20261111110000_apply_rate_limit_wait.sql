-- The refusal of an application for too many attempts says how long to wait (FR-D1, FR-D7 AC8; OPEN_QUESTIONS.md D89):
-- CHARA_RATE_LIMITED carries in its detail the seconds until the oldest attempt of the window leaves it, as submit_report
-- does. The function is the one of 20261028100000 with only that change; its grants are unchanged.
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
  select count(*), min(l.created_at) into v_attempts, v_oldest
  from audit.log l
  where l.actor_id = v_uid and l.action in ('application.submitted', 'application.duplicate_attempt')
    and l.created_at > now() - make_interval(secs => v_window);
  if v_attempts >= v_max then
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
  return next;
end;
$$;
