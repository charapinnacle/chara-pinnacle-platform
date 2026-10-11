-- Two-step verification for owners and administrators on applicant data, enforced by the database (security review
-- SA-04; FR-A4; OPEN_QUESTIONS.md D79, which widens D8). Until now only the page guard asked owners and administrators
-- for aal2 before the applicant pages, so an aal1 session of such an account could read applicants, notes, events and
-- documents and export them by calling the Data API directly. A plain member still uses applicant data at aal1 (FR-A4),
-- and nothing here touches reading one's own membership or organisation, invitations to it or vacancies (D8, FR-A4 AC3).

-- The check of get_dashboard_plan and the billing reads, by organisation: an owner or administrator of p_org at aal1 is
-- refused. Anybody else passes, so the answer says nothing about an organisation the caller does not manage.
create function private.assert_member_aal2(p_org uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_aal2() and private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;
end;
$$;

revoke all on function private.assert_member_aal2(uuid) from public, anon, authenticated, service_role;

-- The organisations whose applicants the caller reads: the policies of job_applications, application_events and
-- application_notes, v_job_applicants (and so get_board_counts and get_dashboard_applications) and the applicant
-- functions go through it. An organisation the caller manages is left out until the session is at aal2.
create or replace function private.active_member_org_ids() returns setof uuid
language sql
stable
security definer
rows 5
set search_path = ''
as $$
  select o.id
  from public.organizations o
  where o.id in (select private.member_org_ids()) and o.status = 'active'
    and (private.is_aal2() or o.id not in (select private.member_org_ids('admin')))
$$;

-- The functions below are those of 20261023100000 to 20261028100000 with the check added before anything is read, so an
-- owner or administrator at aal1 gets CHARA_FORBIDDEN with detail aal2_required instead of a row or CHARA_NOT_FOUND.
create or replace function private.member_application(p_fn text, p_application_id uuid) returns public.job_applications
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
  perform private.assert_member_aal2((select a.organization_id from public.job_applications a where a.id = p_application_id));
  select a.* into v_app from public.job_applications a
  where a.id = p_application_id and a.organization_id in (select private.active_member_org_ids());
  if not found then
    perform private.log_cross_tenant(p_fn, p_application_id);
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_app;
end;
$$;

create or replace function public.get_applicant(p_application_id uuid) returns table (
  id uuid,
  organization_id uuid,
  job_id uuid,
  job_title text,
  applicant_name text,
  status public.application_status,
  applied_at timestamptz,
  shortlisting_available boolean,
  stage_change_blocked text,
  note_max_chars integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  perform private.assert_member_aal2((select a.organization_id from public.job_applications a where a.id = p_application_id));
  return query
  select
    a.id, a.organization_id, a.job_id, j.title,
    nullif(btrim(concat_ws(' ', a.profile_snapshot ->> 'first_name', a.profile_snapshot ->> 'last_name')), ''),
    a.status, a.created_at,
    private.has_feature(a.organization_id, 'shortlisting'),
    case when private.free_plan_restricted(a.organization_id) then 'read_only_free_plan' end,
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'application_status_note_max_chars')
  from public.job_applications a
  join public.jobs j on j.id = a.job_id
  where a.id = p_application_id and a.organization_id in (select private.active_member_org_ids());
  if not found then
    perform private.log_cross_tenant('get_applicant', p_application_id);
  end if;
end;
$$;

create or replace function public.list_applicant_events(p_application_id uuid) returns table (
  id bigint,
  from_status public.application_status,
  to_status public.application_status,
  actor_kind text,
  actor_name text,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  perform private.assert_member_aal2((select a.organization_id from public.job_applications a where a.id = p_application_id));
  return query
  select
    e.id, e.from_status, e.to_status,
    case when e.actor_id is null then 'system' when e.actor_id = a.worker_user_id then 'candidate' else 'employer' end,
    case when e.actor_id is distinct from a.worker_user_id then p.display_name end,
    e.note, e.created_at
  from public.job_applications a
  join public.application_events e on e.application_id = a.id
  left join public.profiles p on p.id = e.actor_id
  where a.id = p_application_id and a.organization_id in (select private.active_member_org_ids())
  order by e.created_at, e.id
  limit 100;
  if not found then
    perform private.log_cross_tenant('list_applicant_events', p_application_id);
  end if;
end;
$$;

create or replace function public.get_applicant_access(p_organization_id uuid) returns table (
  stage_change_blocked text,
  shortlisting_available boolean,
  csv_export_available boolean,
  note_max_chars integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  perform private.assert_member_aal2(p_organization_id);
  return query
  select
    case when private.free_plan_restricted(o.id) then 'read_only_free_plan' end,
    private.has_feature(o.id, 'shortlisting'),
    not private.free_plan_restricted(o.id) and private.has_feature(o.id, 'csv_export'),
    (select (st.value #>> '{}')::integer from private.settings st where st.key = 'application_status_note_max_chars')
  from public.organizations o
  where o.id = p_organization_id and o.id in (select private.active_member_org_ids());
end;
$$;

create or replace function public.export_applicants(p_job_id uuid, p_stage public.application_status default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'applicant_export_max_rows');
  v_org uuid;
  v_rows jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_UNAUTHENTICATED' using errcode = '42501';
  end if;
  if private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  if p_job_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_job_id';
  end if;
  perform private.assert_member_aal2((select j.organization_id from public.jobs j where j.id = p_job_id));
  select j.organization_id into v_org from public.jobs j
  where j.id = p_job_id and j.deleted_at is null and j.organization_id in (select private.active_member_org_ids());
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if private.free_plan_restricted(v_org) then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'read_only_free_plan';
  end if;
  if not private.has_feature(v_org, 'csv_export') then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'csv_export';
  end if;
  if v_max is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'applicant_export_max_rows';
  end if;

  -- One more row than the limit is read, so that a larger filter is refused and the audited count is the one exported.
  select coalesce(jsonb_agg(jsonb_build_object(
    'candidate_name', v.candidate_name, 'status', v.status, 'applied_at', v.applied_at,
    'completeness', v.completeness, 'documents', v.documents
  ) order by v.applied_at desc, v.id desc), '[]')
  into v_rows
  from (
    select * from public.v_job_applicants x
    where x.job_id = p_job_id and (p_stage is null or x.status = p_stage)
    order by x.applied_at desc, x.id desc
    limit v_max + 1
  ) v;
  if jsonb_array_length(v_rows) > v_max then
    raise exception 'CHARA_LIMIT_REACHED' using detail = 'applicant_export_max_rows';
  end if;

  perform audit.record(
    'applicants_exported', 'job', p_job_id::text,
    jsonb_build_object('organization_id', v_org, 'stage', p_stage, 'rows', jsonb_array_length(v_rows))
  );
  return v_rows;
end;
$$;

-- set_application_status and every row of bulk_set_application_status go through this function; a refused row of a
-- bulk call is reported with CHARA_FORBIDDEN like the other refusals there.
create or replace function private.change_application_status(p_application_id uuid, p_status public.application_status, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.job_applications;
begin
  select a.* into v_app from public.job_applications a
  where a.id = p_application_id and a.organization_id in (select private.member_org_ids())
  for no key update;
  if not found then
    perform private.log_cross_tenant('set_application_status', p_application_id);
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.assert_member_aal2(v_app.organization_id);
  if exists (select 1 from public.organizations o where o.id = v_app.organization_id and o.status <> 'active') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
  end if;
  perform private.assert_org_writable(v_app.organization_id);
  perform private.move_application(v_app, p_status, 'set_application_status', (select auth.uid()), p_note);
end;
$$;

create or replace function public.mark_application_viewed(p_application_id uuid) returns void
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
  where a.id = p_application_id and a.organization_id in (select private.member_org_ids())
  for no key update;
  if not found then
    perform private.log_cross_tenant('mark_application_viewed', p_application_id);
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.assert_member_aal2(v_app.organization_id);
  if v_app.status <> 'applied'
     or exists (select 1 from public.organizations o where o.id = v_app.organization_id and o.status <> 'active')
     or private.free_plan_restricted(v_app.organization_id) then
    return;
  end if;
  perform private.move_application(v_app, 'viewed', 'mark_application_viewed', null, null);
end;
$$;

-- document_access_grant of 20261028100000: a third party's share is checked as before, then an owner or administrator
-- of the sharing organisation must be at aal2. Among several valid shares the one the caller may use at the current aal
-- comes first, so a plain member of one organisation who administers another is not refused because the other's share
-- is newer. document-url runs the grant with the caller's own token, so its links follow. The owner's own download is
-- unchanged.
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
    order by (not private.is_aal2() and s.organization_id in (select private.member_org_ids('admin'))), s.created_at desc
    limit 1;
    if v_org is null then
      raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
    end if;
    perform private.assert_member_aal2(v_org);
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

-- A note is applicant data too: an owner or administrator at aal1 cannot add one (application_notes_guard of
-- 20261026100000 with the check).
create or replace function private.application_notes_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id in (select private.member_org_ids()) then
    perform private.assert_member_aal2(new.organization_id);
    if exists (select 1 from public.organizations o where o.id = new.organization_id and o.status <> 'active') then
      raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
    end if;
    perform private.assert_org_writable(new.organization_id);
  end if;
  return new;
end;
$$;

-- The number of applications of a vacancy that still wait for a decision, for the dialogs that close or fill it
-- (FR-C2 AC9). Vacancy pages are open to owners and administrators at aal1 (FR-A4 AC3) and a count names nobody, so it
-- stays readable there now that the applications are not. Any member of the vacancy's organisation while it is active,
-- as under the policy the count replaces; 0 for anybody else. The open stages are those of openStages in
-- apps/web/lib/applications/stage-machine.ts: every stage but the decisions and a withdrawal.
create function public.count_applications_in_progress(p_job_id uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.job_applications a
  where a.job_id = p_job_id
    and a.organization_id in (
      select o.id from public.organizations o where o.id in (select private.member_org_ids()) and o.status = 'active'
    )
    and a.status not in ('hired', 'rejected', 'withdrawn')
$$;

revoke all on function public.count_applications_in_progress(uuid) from public, anon, authenticated, service_role;
grant execute on function public.count_applications_in_progress(uuid) to authenticated;
