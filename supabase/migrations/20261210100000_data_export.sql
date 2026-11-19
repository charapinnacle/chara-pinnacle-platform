-- The export of a user's own data (FR-S3 AC7, AC8, SOP P2-43 step Export and output "export covering Phase 2 data";
-- GDPR Art. 15 and 20; docs/phase-2/DATA_MODEL.md sections 6, 7, 9 and 10; ARCHITECTURE.md section 7.1). Phase 1 has no
-- export, so this closes that gap for the data of Phase 1 and of the Phase 2 tables built so far; the 2b and 2c files
-- (submissions, messages, contact requests) join with their tables (V58, V74).
-- - request_data_export: any signed-in user asks for a copy of their data, one request per data_export_interval_hours
--   (24). A second request while one is being prepared, or within the interval, is refused; the per-user lock makes two
--   requests at the same moment queue one job. The request is audited as data_export.requested and queues one
--   build_data_export job for account-ops.
-- - account-ops reads the data through account_ops_export_data (service role), writes one zip of UTF-8 JSON files and the
--   user's own document files to the private bucket dsar-exports at <user>/<request>.zip, and marks the request ready
--   through account_ops_export_ready, which queues the mandatory data_export_ready notice (email and in-app) linking to
--   the export page. The file is kept for the data_exports retention period (7 days), then removed by account-ops and
--   the request deleted.
-- - data_export_access_grant: the owner opens a ready, unexpired export through document-url, which signs a 10-minute
--   link; every opening is audited as data_export.downloaded. No storage policy exists for any API role.
-- Every user-facing function answers only while release_data_export is on (false by default): a switch of its own, so
-- that CHARA can put the export of Phase 1 data live before release 2a. It needs no partner legal document, so it names
-- no release feature; the settings editor lists it with the releases by its release_ key.

-- Settings -----------------------------------------------------------------------------------------------------------------

insert into private.settings (key, value) values ('data_export_interval_hours', '24'), ('release_data_export', 'false');

-- The switch label avoids the word "download": the console's Change button carries it, and a Download button on a staff page
-- reads as a way to a user's file (FR-F3 AC8, tests/e2e/staff-document-denial.spec.ts).
insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('data_export_interval_hours', 'integer', 1, 168, 'Time between two data exports of one user (hours)', null),
  ('release_data_export', 'boolean', null, null, 'Data export: a user exports a copy of their own data', null);

-- The public settings of 20261206100000_release_settings.sql with release_data_export, so the settings pages show their
-- link to the export page from it.
create or replace function public.get_public_settings() returns table (key text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.value #>> '{}'
  from private.settings s
  where s.key = any (array[
    'legal_entity_name', 'legal_entity_address', 'legal_entity_registration_number', 'legal_entity_vat_id',
    'legal_entity_email', 'privacy_contact', 'data_protection_contact', 'release_partner_directories',
    'partner_review_target_working_days', 'licence_number_patterns', 'licence_valid_until_max_years',
    'workforce_listing_stale_days', 'workforce_confirm_reminder_days', 'workforce_available_from_max_days',
    'release_job_orders', 'release_candidate_submissions', 'release_messaging', 'release_find_workers',
    'release_data_export'
  ])
$$;

-- The table ----------------------------------------------------------------------------------------------------------------

create type public.data_export_status as enum ('queued', 'ready');

create table public.data_export_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.data_export_status not null default 'queued',
  requested_at timestamptz not null default now(),
  ready_at timestamptz,
  expires_at timestamptz,
  storage_path text,
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  files_left_out integer check (files_left_out is null or files_left_out >= 0),
  check ((status = 'ready') = (ready_at is not null)),
  check ((status = 'ready') = (expires_at is not null)),
  check ((status = 'ready') = (storage_path is not null)),
  check (storage_path is null or storage_path = user_id::text || '/' || id::text || '.zip')
);

comment on table public.data_export_requests is
  'Requests for a copy of a user''s own data (FR-S3, GDPR Art. 15 and 20). Read and written through RPCs and account-ops only; the file lives in the private bucket dsar-exports until expires_at and the row is deleted by the data_exports retention rule.';

create index data_export_requests_user_idx on public.data_export_requests (user_id, requested_at desc);
create index data_export_requests_expires_idx on public.data_export_requests (expires_at) where status = 'ready';
create index data_export_requests_queued_idx on public.data_export_requests (requested_at) where status = 'queued';

alter table public.data_export_requests enable row level security;
alter table public.data_export_requests force row level security;
revoke all on table public.data_export_requests from public, anon, authenticated, service_role;

-- The hours between two requests; a setting that is missing or not a number falls back to the default of the data model.
create function private.data_export_interval() returns interval
language sql
stable
set search_path = ''
as $$
  select make_interval(hours => coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,3}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'data_export_interval_hours'),
    24))
$$;

revoke all on function private.data_export_interval() from public, anon, authenticated, service_role;

-- The user ----------------------------------------------------------------------------------------------------------------

-- Asks for a copy of the caller's data (FR-S3 AC8). Refused while a request of the caller is being prepared
-- (CHARA_RATE_LIMITED detail export_pending) or when the last one is younger than data_export_interval_hours
-- (detail export_recent, hint the time from which a new request is accepted). A request that stayed queued for longer
-- than the interval (its job was abandoned) no longer blocks. Audited as data_export.requested; queues the job.
--   CHARA_FORBIDDEN (detail release_off), CHARA_RATE_LIMITED (detail export_pending, export_recent)
create function public.request_data_export() returns table (export_id uuid, requested_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_last public.data_export_requests;
  v_id uuid;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_data_export') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;

  -- One request at a time per user: of two at the same moment, the second waits here and then finds the first.
  perform pg_advisory_xact_lock(hashtextextended('data_export:' || v_uid::text, 0));
  select * into v_last from public.data_export_requests r
  where r.user_id = v_uid order by r.requested_at desc limit 1;
  if found and v_last.requested_at > now() - private.data_export_interval() then
    if v_last.status = 'queued' then
      raise exception 'CHARA_RATE_LIMITED' using detail = 'export_pending';
    end if;
    raise exception 'CHARA_RATE_LIMITED' using detail = 'export_recent',
      hint = (v_last.requested_at + private.data_export_interval())::text;
  end if;

  insert into public.data_export_requests (user_id) values (v_uid) returning id, requested_at into v_id, v_at;
  perform pgmq.send('account_ops', jsonb_build_object('action', 'build_data_export', 'user_id', v_uid, 'export_id', v_id));
  perform audit.record('data_export.requested', 'data_export', v_id::text, jsonb_build_object('request_id', private.request_id()));

  export_id := v_id;
  requested_at := v_at;
  return next;
end;
$$;

revoke all on function public.request_data_export() from public, anon, authenticated, service_role;
grant execute on function public.request_data_export() to authenticated;

-- The caller's requests, newest first, without the storage path (DATA_MODEL.md section 6). state: preparing (queued
-- within the interval), failed (queued for longer: the job was abandoned), ready, expired (ready but past expires_at and
-- not yet removed by the retention job). next_request_at: when a new request is accepted, null when it is now.
--   CHARA_FORBIDDEN (detail release_off)
create function public.list_my_data_exports() returns table (
  id uuid,
  state text,
  requested_at timestamptz,
  ready_at timestamptz,
  expires_at timestamptz,
  size_bytes bigint,
  files_left_out integer,
  next_request_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_next timestamptz;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_data_export') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  select max(r.requested_at) + private.data_export_interval() into v_next
  from public.data_export_requests r where r.user_id = v_uid;
  if v_next <= now() then
    v_next := null;
  end if;

  return query
  select r.id,
    case
      when r.status = 'ready' and r.expires_at > now() then 'ready'
      when r.status = 'ready' then 'expired'
      when r.requested_at > now() - private.data_export_interval() then 'preparing'
      else 'failed'
    end,
    r.requested_at, r.ready_at, r.expires_at, r.size_bytes, r.files_left_out,
    case when r.status = 'queued' and r.requested_at > now() - private.data_export_interval() then null else v_next end
  from public.data_export_requests r
  where r.user_id = v_uid
  order by r.requested_at desc
  limit 10;
end;
$$;

revoke all on function public.list_my_data_exports() from public, anon, authenticated, service_role;
grant execute on function public.list_my_data_exports() to authenticated;

-- The owner opens a ready export that has not expired: document-url signs a 10-minute link to the object this returns.
-- Every opening is audited as data_export.downloaded. Anybody else, an unknown request, one still being prepared and an
-- expired one get CHARA_NOT_FOUND.
--   CHARA_UNAUTHENTICATED, CHARA_RATE_LIMITED (the document_access allowance), CHARA_NOT_FOUND
create function public.data_export_access_grant(p_export uuid) returns table (bucket_id text, object_path text, file_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_export public.data_export_requests;
begin
  if v_uid is null then
    raise exception 'CHARA_UNAUTHENTICATED' using errcode = '42501';
  end if;
  perform private.check_rate_limit('document_access', v_uid);
  if not private.release_on('release_data_export') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_export from public.data_export_requests r
  where r.id = p_export and r.user_id = v_uid and r.status = 'ready' and r.expires_at > now();
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform audit.record('data_export.downloaded', 'data_export', p_export::text, jsonb_build_object('request_id', private.request_id()));
  return query select 'dsar-exports'::text, v_export.storage_path,
    'chara-pinnacle-data-' || to_char(v_export.ready_at at time zone 'utc', 'YYYY-MM-DD') || '.zip';
end;
$$;

revoke all on function public.data_export_access_grant(uuid) from public, anon, authenticated, service_role;
grant execute on function public.data_export_access_grant(uuid) to authenticated;

-- account-ops ---------------------------------------------------------------------------------------------------------------

-- The data of a queued request as one object: each key becomes <key>.json in the zip (FR-S3 AC7: UTF-8 JSON with
-- readable keys), and files lists the user's own document files to add (bucket, object, name in the zip): only those that
-- passed their check (scan status clean or skipped); the others are listed in documents with a note and no file. Null when the
-- request is not queued any more (built, deleted, or its account erased), so a job read again builds nothing.
-- Only the user's own data: another person appears by the display name of an organisation at most, never by a user id,
-- a name or an address; no staff member is named (the decider of a report or an appeal, the granter of a role), and the
-- internal notes of an employer and of staff (application notes, report resolution notes) are left out. Every table of
-- the personal-data catalogue (test 140) is either read here or listed there with the reason why not.
create function public.account_ops_export_data(p_export uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  select r.user_id into v_uid from public.data_export_requests r where r.id = p_export and r.status = 'queued';
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'user_id', v_uid,
    'sections', jsonb_build_object(
      'account', (
        select jsonb_build_object(
          'user_id', p.id, 'email', u.email, 'display_name', p.display_name, 'account_kind', p.account_kind,
          'preferred_language', p.preferred_lang, 'status', p.status, 'created_at', p.created_at,
          'deletion_requested_at', p.deleted_at, 'last_sign_in_at', u.last_sign_in_at)
        from public.profiles p left join auth.users u on u.id = p.id
        where p.id = v_uid),
      'passport', (
        select jsonb_build_object(
          'first_name', w.first_name, 'last_name', w.last_name, 'headline', w.headline,
          'current_country', w.current_country, 'occupation', o.label, 'years_experience', w.years_experience,
          'availability', w.availability, 'available_from', w.available_from, 'searchable', w.searchable,
          'created_at', w.created_at,
          'skills', coalesce((select jsonb_agg(s.skill order by s.skill) from public.worker_skills s where s.worker_user_id = v_uid), '[]'),
          'languages', coalesce((select jsonb_agg(jsonb_build_object('language', l.language_code, 'level', l.cefr_level) order by l.language_code)
                                 from public.worker_languages l where l.worker_user_id = v_uid), '[]'),
          'preferred_countries', coalesce((select jsonb_agg(c.country_code order by c.country_code)
                                           from public.worker_preferred_countries c where c.worker_user_id = v_uid), '[]'),
          'work_authorizations', coalesce((select jsonb_agg(jsonb_build_object('country', a.country_code, 'expires_on', a.expires_on) order by a.country_code)
                                           from public.worker_work_authorizations a where a.worker_user_id = v_uid), '[]'))
        from public.worker_profiles w left join public.occupations o on o.code = w.occupation_id
        where w.user_id = v_uid),
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'title', d.title, 'type', d.type, 'file_name', d.file_name, 'mime', d.mime, 'size_bytes', d.size_bytes,
          'expires_on', d.expires_on, 'uploaded_at', d.created_at,
          'file', case when d.scan_status in ('clean', 'skipped') then 'documents/' || d.id::text || '/' || d.file_name end)
          || case when d.scan_status in ('clean', 'skipped') then '{}'::jsonb
               else jsonb_build_object('note', 'Not included because the file has not passed its check.') end
          order by d.created_at, d.id)
        from public.worker_documents d where d.worker_user_id = v_uid and d.deleted_at is null), '[]'),
      'applications', coalesce((
        select jsonb_agg(jsonb_build_object(
          'vacancy', j.title, 'employer', o.display_name, 'status', a.status, 'cover_note', a.cover_note,
          'applied_at', a.created_at,
          'history', coalesce((select jsonb_agg(jsonb_build_object('from', e.from_status, 'to', e.to_status, 'at', e.created_at) order by e.created_at, e.id)
                               from public.application_events e where e.application_id = a.id), '[]')) order by a.created_at, a.id)
        from public.job_applications a
        join public.jobs j on j.id = a.job_id
        join public.organizations o on o.id = a.organization_id
        where a.worker_user_id = v_uid), '[]'),
      'passport_shares', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name, 'shared_at', s.created_at, 'expires_at', s.expires_at, 'revoked_at', s.revoked_at,
          'scope', s.scope) order by s.created_at, s.id)
        from public.passport_shares s join public.organizations o on o.id = s.organization_id
        where s.worker_user_id = v_uid), '[]'),
      'document_access', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name, 'document', d.title, 'purpose', l.purpose, 'accessed_at', l.accessed_at)
          order by l.accessed_at, l.id)
        from audit.document_access_log l
        left join public.organizations o on o.id = l.organization_id
        left join public.worker_documents d on d.id = l.document_id
        where l.worker_user_id = v_uid and l.organization_id is not null), '[]'),
      'saved_vacancies', coalesce((
        select jsonb_agg(jsonb_build_object('vacancy', j.title, 'employer', o.display_name, 'saved_at', s.created_at)
          order by s.created_at, s.job_id)
        from public.saved_jobs s
        join public.jobs j on j.id = s.job_id
        join public.organizations o on o.id = j.organization_id
        where s.worker_user_id = v_uid), '[]'),
      'followed_companies', coalesce((
        select jsonb_agg(jsonb_build_object('company', o.display_name, 'followed_at', f.created_at)
          order by f.created_at, f.organization_id)
        from public.follows f join public.organizations o on o.id = f.organization_id
        where f.user_id = v_uid), '[]'),
      'consents', coalesce((
        select jsonb_agg(jsonb_build_object('purpose', c.purpose, 'version', c.version, 'action', c.action, 'at', c.created_at)
          order by c.created_at, c.id)
        from public.consents c where c.user_id = v_uid), '[]'),
      'notifications', coalesce((
        select jsonb_agg(jsonb_build_object('kind', n.kind, 'created_at', n.created_at, 'emailed_at', n.sent_at, 'read_at', n.read_at)
          order by n.created_at, n.id)
        from public.notifications n where n.user_id = v_uid), '[]'),
      'notification_preferences', (
        select jsonb_build_object('application_digest', np.digest, 'email_kinds', np.email_kinds)
        from public.notification_preferences np where np.user_id = v_uid),
      'organization_memberships', coalesce((
        select jsonb_agg(jsonb_build_object('organization', o.display_name, 'role', m.role, 'accepted_at', m.accepted_at)
          order by o.display_name)
        from public.organization_members m join public.organizations o on o.id = m.organization_id
        where m.user_id = v_uid), '[]'),
      'organization_invitations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name, 'role', i.role, 'invited_at', i.created_at, 'expires_at', i.expires_at,
          'accepted_at', i.accepted_at) order by i.created_at, i.id)
        from public.organization_invitations i
        join public.organizations o on o.id = i.organization_id
        join auth.users u on u.id = v_uid
        where lower(i.email::text) = lower(u.email)), '[]'),
      'ownership_transfers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name, 'direction', case when t.from_user_id = v_uid then 'given' else 'received' end,
          'created_at', t.created_at, 'accepted_at', t.accepted_at, 'cancelled_at', t.cancelled_at) order by t.created_at, t.id)
        from public.organization_ownership_transfers t join public.organizations o on o.id = t.organization_id
        where t.from_user_id = v_uid or t.to_user_id = v_uid), '[]'),
      'reports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'reference', private.report_reference(r.id), 'about', r.target_type, 'category', r.category, 'details', r.details,
          'status', r.status, 'reported_at', r.created_at, 'closed_at', r.handled_at) order by r.created_at, r.id)
        from public.reports r where r.reporter_user_id = v_uid), '[]'),
      'appeals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name, 'grounds', a.grounds, 'status', a.status, 'reasons', a.reasons,
          'lodged_at', a.lodged_at, 'decided_at', a.decided_at) order by a.lodged_at, a.id)
        from public.appeals a join public.organizations o on o.id = a.organization_id
        where a.appellant_user_id = v_uid), '[]'),
      'platform_roles', coalesce((
        select jsonb_agg(jsonb_build_object('role', s.role, 'granted_at', s.granted_at, 'revoked_at', s.revoked_at)
          order by s.granted_at, s.id)
        from public.platform_staff s where s.user_id = v_uid), '[]'),
      'activity', coalesce((
        select jsonb_agg(jsonb_build_object('action', l.action, 'about', l.entity_type, 'at', l.created_at, 'ip', host(l.ip))
          order by l.created_at, l.id)
        from audit.log l where l.actor_id = v_uid), '[]'),
      'data_exports', coalesce((
        select jsonb_agg(jsonb_build_object('requested_at', r.requested_at, 'ready_at', r.ready_at, 'expires_at', r.expires_at)
          order by r.requested_at, r.id)
        from public.data_export_requests r where r.user_id = v_uid), '[]')
    ),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucket_id', d.bucket_id, 'path', d.storage_path, 'name', 'documents/' || d.id::text || '/' || d.file_name,
        'size_bytes', d.size_bytes) order by d.created_at, d.id)
      from public.worker_documents d
      where d.worker_user_id = v_uid and d.deleted_at is null and d.scan_status in ('clean', 'skipped')), '[]')
  );
end;
$$;

revoke all on function public.account_ops_export_data(uuid) from public, anon, authenticated, service_role;
grant execute on function public.account_ops_export_data(uuid) to service_role;

-- The zip of a queued request is in the bucket: the request is ready, kept for the data_exports retention period
-- (7 days), and the user gets the mandatory data_export_ready notice. p_files_left_out: the documents listed without
-- their file, which the export page names. False when the request is not queued any more (account-ops then removes the
-- file it wrote).
create function public.account_ops_export_ready(p_export uuid, p_size bigint, p_files_left_out integer default 0)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.data_export_requests;
  v_days integer := coalesce((select p.days from private.retention_policies p where p.entity = 'data_exports'), 7);
begin
  update public.data_export_requests r
  set status = 'ready', ready_at = now(), expires_at = now() + make_interval(days => v_days),
      storage_path = r.user_id::text || '/' || r.id::text || '.zip', size_bytes = p_size,
      files_left_out = greatest(coalesce(p_files_left_out, 0), 0)
  where r.id = p_export and r.status = 'queued'
  returning * into v_export;
  if not found then
    return false;
  end if;
  perform private.record_as(v_export.user_id, 'data_export.ready', 'data_export', p_export::text,
    jsonb_build_object('size_bytes', p_size, 'files_left_out', v_export.files_left_out, 'expires_at', v_export.expires_at));
  perform pgmq.send('notifications', jsonb_build_object(
    'kind', 'data_export_ready', 'user_id', v_export.user_id, 'mandatory', true, 'export_id', p_export,
    'expires_at', v_export.expires_at
  ));
  return true;
end;
$$;

revoke all on function public.account_ops_export_ready(uuid, bigint, integer) from public, anon, authenticated, service_role;
grant execute on function public.account_ops_export_ready(uuid, bigint, integer) to service_role;

-- Storage ---------------------------------------------------------------------------------------------------------------

-- The private bucket (mirrored in supabase/config.toml), shaped <user>/<request>.zip. There is no storage policy for any
-- API role: account-ops writes the file and document-url signs the owner's link, so every download is audited. The
-- limit is 50 MB, the largest object the project's global upload limit accepts (account-ops keeps the document files
-- of one export within 40 MB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dsar-exports', 'dsar-exports', false, 52428800, array['application/zip'])
on conflict (id) do nothing;

-- A file is accepted, or renamed, only at the name of a request that is being prepared.
create function private.dsar_exports_reserved() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.data_export_requests r
    where r.status = 'queued' and new.name = r.user_id::text || '/' || r.id::text || '.zip'
  ) then
    raise exception 'CHARA_NOT_FOUND' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.dsar_exports_reserved() from public, anon, authenticated, service_role;

create trigger dsar_exports_reserved
  before insert or update of bucket_id, name on storage.objects
  for each row when (new.bucket_id = 'dsar-exports')
  execute function private.dsar_exports_reserved();

-- The notice ---------------------------------------------------------------------------------------------------------------

insert into private.notification_kinds (kind, mandatory, default_email, audience, label) values
  ('data_export_ready', true, true, 'all', 'Data exports');

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- private.notification_payload of 20261209100000_moderation_appeals.sql with data_export_ready added: the request and
-- the time until which its file can be downloaded. Every other branch is unchanged.
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
    when 'data_export_ready' then jsonb_build_object('export_id', p_message -> 'export_id', 'expires_at', p_message -> 'expires_at')
    else '{}'::jsonb
  end);
end;
$$;
