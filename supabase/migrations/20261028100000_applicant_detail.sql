-- Applicant detail (FR-E2; ARCHITECTURE.md sections 4, 5, 7.3; OPEN_QUESTIONS.md C11, D58). The member reads the profile as
-- submitted, learns whether the live profile differs, lists the documents of the share and opens them through
-- document_access_grant, and reads the internal notes. The notes table, the member policies and mark_application_viewed
-- (the open of this unit) came with FR-D5 and FR-D2.

-- The profile as an application stores it, built from the live passport. apply_to_job writes it into
-- job_applications.profile_snapshot and application_profile_changed compares with it, so one expression serves both and
-- the two cannot drift. It holds the fields the employer sees and none of the attributes NFR-C1 forbids.
create function private.profile_snapshot(p_user uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'first_name', w.first_name,
    'last_name', w.last_name,
    'headline', w.headline,
    'current_country', w.current_country,
    'occupation_id', w.occupation_id,
    'occupation', (select o.label from public.occupations o where o.code = w.occupation_id),
    'years_experience', w.years_experience,
    'availability', w.availability,
    'available_from', w.available_from,
    'skills', coalesce((select jsonb_agg(s.skill order by lower(s.skill)) from public.worker_skills s where s.worker_user_id = p_user), '[]'),
    'languages', coalesce((
      select jsonb_agg(jsonb_build_object('code', l.language_code, 'level', l.cefr_level) order by l.language_code)
      from public.worker_languages l where l.worker_user_id = p_user), '[]'),
    'preferred_countries', coalesce((
      select jsonb_agg(c.country_code order by c.country_code) from public.worker_preferred_countries c where c.worker_user_id = p_user), '[]'),
    'work_authorizations', coalesce((
      select jsonb_agg(jsonb_build_object('country', a.country_code, 'expires_on', a.expires_on) order by a.country_code)
      from public.worker_work_authorizations a where a.worker_user_id = p_user), '[]')
  )
  from public.worker_profiles w where w.user_id = p_user
$$;

revoke all on function private.profile_snapshot(uuid) from public, anon, authenticated, service_role;

-- apply_to_job is that of 20261025100000 with one change: the snapshot comes from private.profile_snapshot.
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

-- The conditions under which a share still lets the organisation see anything: it is not revoked or expired, the
-- consent behind it is granted and not withdrawn, the candidate's account is active and not closing, and the
-- organisation is active. document_access_grant, application_documents and application_profile_changed ask here, so
-- the three answer alike.
create function private.share_valid(p_share_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.passport_shares s
    join public.consents c on c.id = s.consent_id and c.user_id = s.worker_user_id and c.action = 'granted'
    where s.id = p_share_id
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
      and not exists (
        select 1 from public.consents w
        where w.user_id = c.user_id and w.purpose = c.purpose and w.action = 'withdrawn' and w.id > c.id
      )
      and exists (
        select 1 from public.profiles p where p.id = s.worker_user_id and p.status = 'active' and p.deleted_at is null
      )
      and exists (select 1 from public.organizations o where o.id = s.organization_id and o.status = 'active')
  )
$$;

revoke all on function private.share_valid(uuid) from public, anon, authenticated, service_role;

-- The counter of rate_limit_attempt (20261004120000), moved into one function so that the web tier's counters and the
-- per-person counters below are the same code: a window starts with the first hit, a later hit starts a new window in
-- the same row, and the count never passes max + 1.
create function private.rate_limit_hit(p_action text, p_bucket integer, p_max integer, p_seconds integer)
returns table (hit_count integer, window_end timestamptz)
language sql
security definer
set search_path = ''
as $$
  insert into private.rate_limit_hits as h (action, bucket, hits, expires_at)
  values (p_action, p_bucket, 1, now() + make_interval(secs => p_seconds))
  on conflict (action, bucket) do update set
    hits = case when h.expires_at <= now() then 1 else least(h.hits + 1, p_max + 1) end,
    expires_at = case when h.expires_at <= now() then now() + make_interval(secs => p_seconds) else h.expires_at end
  returning h.hits, h.expires_at
$$;

revoke all on function private.rate_limit_hit(text, integer, integer, integer) from public, anon, authenticated, service_role;

create or replace function public.rate_limit_attempt(p_action text, p_key text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_max');
  v_seconds integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_seconds');
  v_buckets integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_buckets');
  v_hits integer;
  v_expires timestamptz;
begin
  if v_max is null or v_seconds is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_action';
  end if;
  if v_buckets is null or v_buckets < 1 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'rate_limit_buckets';
  end if;
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_key';
  end if;

  select r.hit_count, r.window_end into v_hits, v_expires
  from private.rate_limit_hit(p_action, (('x' || left(p_key, 8))::bit(32)::bigint % v_buckets)::integer, v_max, v_seconds) r;

  allowed := v_hits <= v_max;
  retry_after_seconds := case when allowed then 0 else greatest(1, ceil(extract(epoch from v_expires - now()))::integer) end;
  return next;
end;
$$;

-- Opening documents: at most 30 requests per person in 60 seconds (NFR-S6, abuse-prone operations). The counter is a
-- row of private.rate_limit_hits (the table of D20, bounded by actions x buckets and purged every five minutes). Its
-- action is 'user:document_access', a name rate_limit_attempt cannot reach because no setting 'rate_limit_user:...'
-- exists, so a caller of that public function cannot fill the bucket of a known user id. The bucket is the hash of the
-- user id in a space of its own (rate_limit_user_buckets, to be raised with the number of members, see the runbook), so
-- two people share a bucket, and then the allowance, only by chance. A refused call raises, so the increment of a
-- refused call is rolled back with it and the count stays at the limit.
insert into private.settings (key, value) values
  ('rate_limit_document_access_max', '30'),
  ('rate_limit_document_access_seconds', '60'),
  ('rate_limit_user_buckets', '1048576');

create function private.check_rate_limit(p_action text, p_subject uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_max');
  v_seconds integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_seconds');
  v_buckets integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_user_buckets');
begin
  if v_max is null or v_seconds is null or v_buckets is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'rate_limit_' || p_action;
  end if;
  if (select r.hit_count from private.rate_limit_hit(
        'user:' || p_action, ((hashtextextended(p_subject::text, 0) & 2147483647) % v_buckets)::integer, v_max, v_seconds) r) > v_max then
    raise exception 'CHARA_RATE_LIMITED';
  end if;
end;
$$;

revoke all on function private.check_rate_limit(text, uuid) from public, anon, authenticated, service_role;

-- document_access_grant is that of 20261016100000 with two changes: the share conditions are private.share_valid, and
-- the caller is counted against the allowance above before anything else is looked at.
create or replace function public.document_access_grant(p_document_id uuid, p_purpose text)
returns table (bucket_id text, object_path text, file_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_document public.worker_documents;
  v_share uuid;
  v_org uuid;
  v_repeat integer := (select (value #>> '{}')::integer from private.settings where key = 'document_access_repeat_seconds');
begin
  if v_uid is null then
    raise exception 'CHARA_UNAUTHENTICATED' using errcode = '42501';
  end if;
  perform private.check_rate_limit('document_access', v_uid);

  select * into v_document from public.worker_documents d where d.id = p_document_id and d.deleted_at is null;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_document.worker_user_id <> v_uid then
    select s.id, s.organization_id into v_share, v_org
    from public.passport_shares s
    where s.worker_user_id = v_document.worker_user_id
      and s.organization_id in (select private.member_org_ids())
      and s.scope ? v_document.id::text
      and private.share_valid(s.id)
    order by s.created_at desc
    limit 1;
    if v_org is null then
      raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  if p_purpose is distinct from (case when v_document.worker_user_id = v_uid then 'owner_download' else 'application_review' end) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501', detail = 'purpose_mismatch';
  end if;

  if v_document.scan_status not in ('clean', 'skipped') then
    raise exception 'CHARA_DOCUMENT_NOT_SCANNED';
  end if;

  if not exists (
    select 1 from audit.document_access_log l
    where l.accessed_at > now() - make_interval(secs => coalesce(v_repeat, 0))
      and l.accessed_by = v_uid and l.document_id = v_document.id and l.purpose = p_purpose
  ) then
    insert into audit.document_access_log (share_id, document_id, worker_user_id, organization_id, accessed_by, purpose)
    values (v_share, v_document.id, v_document.worker_user_id, v_org, v_uid, p_purpose);
  end if;

  return query select v_document.bucket_id, v_document.storage_path, v_document.file_name;
end;
$$;

-- The application of an active organisation the caller is an accepted member of, for the three reads below. A candidate
-- or a user without an account kind is refused (company_account_required); an unknown id, another organisation's
-- application, a suspended organisation's and a platform administrator who is no member are one answer, CHARA_NOT_FOUND,
-- and an attempt on another organisation's application is logged (FR-D5). The reads are volatile because of the log line.
create function private.member_application(p_fn text, p_application_id uuid) returns public.job_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.job_applications;
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  select a.* into v_app from public.job_applications a
  where a.id = p_application_id and a.organization_id in (select private.active_member_org_ids());
  if not found then
    perform private.log_cross_tenant(p_fn, p_application_id);
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_app;
end;
$$;

revoke all on function private.member_application(text, uuid) from public, anon, authenticated, service_role;

-- The documents a member may open: those in the scope of the application's share while the share is valid, never a
-- deleted or rejected one, and never a bucket or a storage path (the file is reached through document-url only). available
-- says whether the file has passed its checks, so the page can say "being checked" instead of offering a link that is refused.
create function public.application_documents(p_application_id uuid) returns table (
  id uuid,
  title text,
  type public.worker_document_type,
  file_name text,
  size_bytes integer,
  expires_on date,
  available boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.job_applications := private.member_application('application_documents', p_application_id);
begin
  if not private.share_valid(v_app.passport_share_id) then
    return;
  end if;
  return query
  select d.id, d.title, d.type, d.file_name, d.size_bytes, d.expires_on, d.scan_status in ('clean', 'skipped')
  from public.passport_shares s
  join public.worker_documents d
    on d.id = any (array(select jsonb_array_elements_text(s.scope)::uuid))
   and d.worker_user_id = s.worker_user_id and d.deleted_at is null and d.scan_status <> 'rejected'
  where s.id = v_app.passport_share_id
  order by d.created_at, d.id
  limit 100;
end;
$$;

revoke all on function public.application_documents(uuid) from public, anon, authenticated, service_role;
grant execute on function public.application_documents(uuid) to authenticated;

-- Whether the live profile differs in content from the snapshot, for a share that is valid; null for a share that is
-- not (the live profile is then not read at all). It says nothing about what changed. The completeness
-- percentage is not content of the profile, and the occupation label is read from the reference data, so both are left
-- out of the comparison; occupation_id stays in.
create function public.application_profile_changed(p_application_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.job_applications := private.member_application('application_profile_changed', p_application_id);
begin
  if not private.share_valid(v_app.passport_share_id) then
    return null;
  end if;
  return (private.profile_snapshot(v_app.worker_user_id) - 'completeness' - 'occupation') is distinct from (v_app.profile_snapshot - 'completeness' - 'occupation');
end;
$$;

revoke all on function public.application_profile_changed(uuid) from public, anon, authenticated, service_role;
grant execute on function public.application_profile_changed(uuid) to authenticated;

-- The internal notes of an application, newest first, 50 to a page, with the display name of the author. p_before_id is
-- the id of the last note of the page before (keyset on application_notes_application_idx); has_more says that older
-- notes exist. A lapsed organisation reads its notes, only writing is refused.
create function public.list_application_notes(p_application_id uuid, p_before_id bigint default null) returns table (
  id bigint,
  author_name text,
  body text,
  created_at timestamptz,
  has_more boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.job_applications := private.member_application('list_application_notes', p_application_id);
begin
  return query
  with page as (
    select n.id, n.author_id, n.body, n.created_at
    from public.application_notes n
    where n.application_id = v_app.id
      and (p_before_id is null or (n.created_at, n.id) < (
        select b.created_at, b.id from public.application_notes b where b.id = p_before_id and b.application_id = v_app.id))
    order by n.created_at desc, n.id desc
    limit 51
  ),
  numbered as (
    select page.*, row_number() over (order by page.created_at desc, page.id desc) as rn, count(*) over () as total from page
  )
  select numbered.id, p.display_name, numbered.body, numbered.created_at, numbered.total > 50
  from numbered
  left join public.profiles p on p.id = numbered.author_id
  where numbered.rn <= 50
  order by numbered.rn;
end;
$$;

revoke all on function public.list_application_notes(uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.list_application_notes(uuid, bigint) to authenticated;
