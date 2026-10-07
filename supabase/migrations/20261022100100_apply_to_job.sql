-- Apply to a vacancy (FR-D1, FR-D7; ARCHITECTURE.md sections 4, 7.3; OPEN_QUESTIONS.md D52). A candidate applies to an
-- Open, visible vacancy once, with an optional cover note and a selection of their own documents. apply_to_job writes,
-- in one transaction, the consent, the share (scoped to the selected document ids), the application, its first event,
-- the audit row and one queue message per member of the employer. A second call for the same vacancy returns the
-- existing application and counts a duplicate attempt (FR-D7); the number of calls per candidate and hour is capped by
-- a setting. list_my_applications and get_my_application are the candidate's reads.

insert into private.settings (key, value) values
  ('apply_cover_note_max_chars', '2000'),
  ('apply_documents_max', '10'),
  ('apply_rate_limit_max', '60'),
  ('apply_rate_limit_window_seconds', '3600');

-- The limits the form quotes and the function enforces. The note is capped at 10,000 characters, the check of the column,
-- whatever the setting says.
create function public.apply_limits() returns table (cover_note_max_chars integer, documents_max integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  select least((s.value #>> '{}')::integer, 10000) into cover_note_max_chars from private.settings s where s.key = 'apply_cover_note_max_chars';
  select (s.value #>> '{}')::integer into documents_max from private.settings s where s.key = 'apply_documents_max';
  if cover_note_max_chars is null or documents_max is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'apply_limits';
  end if;
  return next;
end;
$$;

revoke all on function public.apply_limits() from public, anon, authenticated, service_role;
grant execute on function public.apply_limits() to authenticated;

-- The calls that count towards the hourly cap are the ones that leave an audit row (a created application or a duplicate
-- attempt); a refused call writes nothing, so it cannot be counted.
create index log_apply_actor_idx on audit.log (actor_id, created_at)
  where action in ('application.submitted', 'application.duplicate_attempt');

-- p_note is trimmed (an empty note is stored as null); p_document_ids is deduplicated. The profile row is locked for the
-- whole call, so two calls of one candidate run one after the other: the second finds the application of the first and
-- the hourly count is exact. The lock is NO KEY UPDATE, which does not block the foreign key checks of the candidate's
-- other inserts (a document, a saved vacancy, a consent).
-- Errors: CHARA_FORBIDDEN (not an active candidate), CHARA_RATE_LIMITED, CHARA_INVALID_INPUT (detail p_note or
-- p_document_ids), CHARA_JOB_NOT_OPEN (one code for a vacancy that is not open and visible, deleted or unknown),
-- CHARA_PROFILE_INCOMPLETE (detail: the missing fields), CHARA_NOT_FOUND (a document that is not the caller's own or is
-- deleted), CHARA_SETTING_MISSING.
create function public.apply_to_job(p_job_id uuid, p_note text default null, p_document_ids uuid[] default null)
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
  values (v_uid, 'share_passport:' || v_organization, v_version, 'granted')
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

revoke all on function public.apply_to_job(uuid, text, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.apply_to_job(uuid, text, uuid[]) to authenticated;

-- The candidate's applications, newest first, in keyset pages. The title and the employer name come from the vacancy
-- whatever its state is now: a candidate keeps seeing what they applied to after it was paused, closed or hidden.
--   p_cursor  the next_cursor of the last row of the previous page
--   p_limit   1 to 50, 20 when missing
create function public.list_my_applications(p_cursor text default null, p_limit integer default null) returns table (
  id uuid,
  job_id uuid,
  job_title text,
  employer_display_name text,
  status public.application_status,
  applied_at timestamptz,
  next_cursor text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_cursor_created timestamptz;
  v_cursor_id uuid;
begin
  if v_uid is null or private.account_kind() is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  if p_cursor is not null then
    begin
      if p_cursor !~ '^[0-9T:.Z-]+\|[0-9a-f-]{36}$' then
        raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
      end if;
      v_cursor_created := split_part(p_cursor, '|', 1)::timestamptz;
      v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end;
  end if;

  return query
  with page as (
    select a.id, a.job_id, a.status, a.created_at, row_number() over (order by a.created_at desc, a.id desc) as n
    from public.job_applications a
    where a.worker_user_id = v_uid
      and (v_cursor_id is null or (a.created_at, a.id) < (v_cursor_created, v_cursor_id))
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  )
  select
    p.id, p.job_id, j.title, o.display_name, p.status, p.created_at,
    case
      when p.n = v_limit and exists (select 1 from page x where x.n > v_limit)
        then to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p.id
    end
  from page p
  join public.jobs j on j.id = p.job_id
  join public.organizations o on o.id = j.organization_id
  where p.n <= v_limit
  order by p.n;
end;
$$;

revoke all on function public.list_my_applications(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_my_applications(text, integer) to authenticated;

-- One application of the caller, with the vacancy it is for and whether that vacancy can still be opened by the public.
-- No row for an application of somebody else.
create function public.get_my_application(p_id uuid) returns table (
  id uuid,
  job_id uuid,
  job_title text,
  employer_display_name text,
  vacancy_is_open boolean,
  status public.application_status,
  cover_note text,
  applied_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  return query
  select
    a.id, a.job_id, j.title, o.display_name,
    j.status = 'open' and j.moderation_state = 'visible' and j.deleted_at is null,
    a.status, a.cover_note, a.created_at
  from public.job_applications a
  join public.jobs j on j.id = a.job_id
  join public.organizations o on o.id = j.organization_id
  where a.id = p_id and a.worker_user_id = (select auth.uid());
end;
$$;

revoke all on function public.get_my_application(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_application(uuid) to authenticated;
