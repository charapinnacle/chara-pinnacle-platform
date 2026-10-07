-- Apply to a vacancy (FR-D1, FR-D7; ARCHITECTURE.md sections 4, 7.3; OPEN_QUESTIONS.md D52). A candidate applies to an
-- Open, visible vacancy once, with an optional cover note and a selection of their own documents. apply_to_job writes,
-- in one transaction, the consent, the share (scoped to the selected document ids), the application, its first event,
-- the audit row and one queue message per member of the employer; nothing else writes to these tables, and no API role
-- has an insert, update or delete grant on them. A second call for the same vacancy returns the existing application
-- and counts a duplicate attempt (FR-D7); the number of calls per candidate and hour is capped by a setting.

insert into private.settings (key, value) values
  ('apply_cover_note_max_chars', '2000'),
  ('apply_documents_max', '10'),
  ('apply_rate_limit_max', '60'),
  ('apply_rate_limit_window_seconds', '3600');

create type public.application_status as enum (
  'applied', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'
);

-- worker_user_id and actor_id carry no foreign key to the profile: erase_user replaces the user id by a pseudonym and the
-- application outlives the account. organization_id is the tenant of the vacancy, copied by apply_to_job. The share and
-- the application name each other: passport_shares.application_id has the foreign key (and is unique), and
-- passport_share_id, the way back, has none, because each row would have to exist before the other.
create table public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  organization_id uuid not null references public.organizations (id),
  worker_user_id uuid not null,
  status public.application_status not null default 'applied',
  cover_note text check (cover_note is null or (cover_note = btrim(cover_note) and length(cover_note) between 1 and 10000)),
  passport_share_id uuid not null,
  profile_snapshot jsonb not null check (jsonb_typeof(profile_snapshot) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.job_applications is
  'One application of a candidate to a vacancy. Written only by apply_to_job; the candidate reads the own rows.';
comment on column public.job_applications.profile_snapshot is
  'The passport as it was when the candidate applied: no email, date of birth, storage path or file name. Never updated.';

-- At most one non-withdrawn application per candidate and vacancy (FR-D7).
create unique index job_applications_one_active_per_job_worker
  on public.job_applications (job_id, worker_user_id) where status <> 'withdrawn';
-- The candidate's own list (keyset on created_at and id) and the policy column.
create index job_applications_worker_created_idx on public.job_applications (worker_user_id, created_at desc, id desc);
-- The applicant list of a vacancy (FR-E1) and the foreign key to jobs, which the partial unique index cannot serve.
create index job_applications_job_status_idx on public.job_applications (job_id, status);
create index job_applications_organization_idx on public.job_applications (organization_id);

alter table public.job_applications enable row level security;
alter table public.job_applications force row level security;

grant select on public.job_applications to authenticated;

create policy job_applications_select_own on public.job_applications
  for select to authenticated
  using (worker_user_id = (select auth.uid()));

alter table public.passport_shares
  add constraint passport_shares_application_id_fkey foreign key (application_id) references public.job_applications (id);

create table public.application_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.job_applications (id),
  from_status public.application_status,
  to_status public.application_status not null,
  actor_id uuid,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.application_events is
  'Append-only history of an application. Written only by the application RPCs; the candidate reads it without actor_id.';

create index application_events_application_idx on public.application_events (application_id, created_at, id);
-- erase_user finds the events a candidate caused.
create index application_events_actor_idx on public.application_events (actor_id) where actor_id is not null;

alter table public.application_events enable row level security;
alter table public.application_events force row level security;

-- actor_id is left out: it names the employer member who moved an application.
grant select (id, application_id, from_status, to_status, note, created_at) on public.application_events to authenticated;

create policy application_events_select_own on public.application_events
  for select to authenticated
  using (application_id in (select a.id from public.job_applications a where a.worker_user_id = (select auth.uid())));

-- Append-only, except that erase_user may put a pseudonym where the candidate's id was and change nothing else.
create function private.application_events_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and private.erasure_subject() is not null
     and (new.id, new.application_id, new.from_status, new.to_status, new.note, new.created_at)
           is not distinct from (old.id, old.application_id, old.from_status, old.to_status, old.note, old.created_at)
     and new.actor_id is not distinct from
           (case when old.actor_id = private.erasure_subject() then private.erasure_pseudonym() else old.actor_id end) then
    return new;
  end if;
  raise exception 'application_events is append-only' using errcode = '42501';
end;
$$;

revoke all on function private.application_events_guard() from public, anon, authenticated, service_role;

create trigger application_events_append_only
  before update or delete on public.application_events
  for each row execute function private.application_events_guard();
create trigger application_events_no_truncate
  before truncate on public.application_events
  for each statement execute function private.refuse_change();

alter table public.application_events enable always trigger application_events_append_only;
alter table public.application_events enable always trigger application_events_no_truncate;

-- A consent for sharing names the organisation, so withdrawing it later withdraws the shares of that organisation only
-- (document_access_grant compares user and purpose). The purpose is then not the slug of a legal document: the version
-- still refers to the sharing notice, and this trigger keeps the check the foreign key made.
alter table public.consents drop constraint consents_purpose_version_fkey;

create function private.consents_check_document() returns trigger
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
      and d.slug = (case when new.purpose ~ '^share_passport:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         then 'sharing-notice' else new.purpose end)
  ) then
    raise exception 'insert or update on table "consents" violates foreign key constraint "consents_purpose_version_fkey"'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function private.consents_check_document() from public, anon, authenticated, service_role;

create trigger consents_check_document
  before insert on public.consents
  for each row execute function private.consents_check_document();

alter table public.consents enable always trigger consents_check_document;

-- The limits the form quotes and the function enforces.
create function public.apply_limits() returns table (cover_note_max_chars integer, documents_max integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  select (s.value #>> '{}')::integer into cover_note_max_chars from private.settings s where s.key = 'apply_cover_note_max_chars';
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
-- the hourly count is exact.
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
  from public.profiles p where p.id = v_uid for update;
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

-- The erasure of a candidate (FR-B6) also moves their applications to the pseudonym, empties the cover note and removes
-- the name and the headline from the snapshot, and moves the events they caused; every pseudonym is new, so two erased
-- candidates of one vacancy do not meet at the unique index.
create or replace function public.erase_user(p_user_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.account_kind;
  v_requested timestamptz;
  v_hold boolean;
  v_email text;
  v_pseudonym uuid := gen_random_uuid();
  v_subject text := p_user_id::text;
begin
  select p.account_kind, p.deleted_at, p.legal_hold into v_kind, v_requested, v_hold
  from public.profiles p where p.id = p_user_id for update;
  if not found then
    return false;
  end if;
  if v_kind is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required';
  end if;
  if v_requested is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'deletion_not_requested';
  end if;
  if now() < private.cooling_off_ends_at(v_requested) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'cooling_off_not_ended';
  end if;
  if v_hold then
    raise exception 'CHARA_FORBIDDEN' using detail = 'legal_hold';
  end if;
  if exists (select 1 from public.platform_staff s where s.user_id = p_user_id and s.revoked_at is null) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'platform_staff';
  end if;

  select u.email into v_email from auth.users u where u.id = p_user_id;
  perform set_config('chara.erasure_user', v_subject, true);
  perform set_config('chara.erasure_pseudonym', v_pseudonym::text, true);

  update public.passport_shares
  set worker_user_id = v_pseudonym, scope = '[]', revoked_at = coalesce(revoked_at, now())
  where worker_user_id = p_user_id;
  update public.job_applications a
  set worker_user_id = v_pseudonym, cover_note = null,
      profile_snapshot = a.profile_snapshot - 'first_name' - 'last_name' - 'headline'
  where a.worker_user_id = p_user_id;
  update public.application_events set actor_id = v_pseudonym where actor_id = p_user_id;
  update public.consents set user_id = v_pseudonym where user_id = p_user_id;
  update audit.document_access_log
  set worker_user_id = v_pseudonym, accessed_by = case when accessed_by = p_user_id then v_pseudonym else accessed_by end
  where worker_user_id = p_user_id;
  update audit.log
  set actor_id = case when actor_id = p_user_id then v_pseudonym else actor_id end,
      entity_id = case when entity_id = v_subject then v_pseudonym::text else entity_id end,
      ip = case when actor_id = p_user_id then null else ip end,
      metadata = replace(metadata::text, v_subject, v_pseudonym::text)::jsonb
  where actor_id = p_user_id or entity_id = v_subject
     or (entity_type = 'platform_staff'
         and entity_id = any (array(select s.id::text from public.platform_staff s where s.user_id = p_user_id)));

  delete from public.worker_documents where worker_user_id = p_user_id;
  delete from public.worker_profiles where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;
  perform pgmq.delete('notifications', array(select n.msg_id from pgmq.q_notifications n where n.message ->> 'user_id' = v_subject));

  perform set_config('chara.erasure_user', '', true);
  perform set_config('chara.erasure_pseudonym', '', true);

  perform audit.record(
    'account.erased', 'profile', v_pseudonym::text,
    jsonb_build_object('requested_at', v_requested, 'completed_at', now())
  );
  -- The auth user is deleted next, so the address travels in the message; notify must not archive it.
  if v_email is not null then
    perform pgmq.send('notifications', jsonb_build_object('kind', 'deletion_completed', 'email', v_email, 'mandatory', true));
  end if;
  return true;
end;
$$;

revoke all on function public.erase_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.erase_user(uuid) to service_role;
