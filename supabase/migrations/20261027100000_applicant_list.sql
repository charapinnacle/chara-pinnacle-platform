-- Applicant list and pipeline board (FR-E1; ARCHITECTURE.md sections 4, 5, 10.4; OPEN_QUESTIONS.md C11, C16, D57).
-- The list and the board read public.v_job_applicants, a security_invoker view over the applications: the row policy of
-- FR-D5 decides which applications a member sees, so the view adds no rule of its own. The CSV export is a function
-- because it writes an audit row and is gated by a plan feature.

-- CSV export is part of every paid plan (C16, to be confirmed by CHARA). Existing rows are never overwritten; a
-- rebuilt database gets the rows from supabase/seeds/ref/plans.sql, and this statement adds them to a database whose
-- plans exist already.
insert into billing.plan_features (plan_code, feature_key)
select p.code, 'csv_export' from billing.plans p
where p.code in ('employer_starter', 'employer_professional', 'employer_enterprise')
on conflict (plan_code, feature_key) do nothing;

-- The most rows one export may hold. The Data API returns at most 100 rows, so the export is one document and needs its own limit.
insert into private.settings (key, value) values ('applicant_export_max_rows', '10000');

-- The completeness of a passport (FR-B4) as the web tier shows it, in the weights of apps/web/lib/passport/completeness.ts:
-- name and country 10, headline 5, occupation 15, three skills 15, a language 10, years of experience 10, availability 10,
-- a valid work authorisation 10, a usable CV 15. The application stores it in its snapshot when it is made (below).
create function private.passport_completeness(p_user uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      10
      + (btrim(coalesce(p.headline, '')) <> '')::int * 5
      + (p.occupation_id is not null)::int * 15
      + ((select count(*) from public.worker_skills s where s.worker_user_id = p.user_id) >= 3)::int * 15
      + exists (select 1 from public.worker_languages l where l.worker_user_id = p.user_id)::int * 10
      + (p.years_experience is not null)::int * 10
      + (p.availability is not null)::int * 10
      + exists (
        select 1 from public.worker_work_authorizations a
        where a.worker_user_id = p.user_id and (a.expires_on is null or a.expires_on >= (now() at time zone 'utc')::date)
      )::int * 10
      + exists (
        select 1 from public.worker_documents d
        where d.worker_user_id = p.user_id and d.type = 'cv' and d.deleted_at is null and d.scan_status in ('clean', 'skipped')
      )::int * 15
    from public.worker_profiles p where p.user_id = p_user
  ), 0)
$$;

revoke all on function private.passport_completeness(uuid) from public, anon, authenticated, service_role;

-- apply_to_job and the fixtures of the tests insert the application with a snapshot that has no completeness: the
-- percentage of the candidate's passport at that moment is added. A snapshot that carries one is left as it is.
create function private.job_applications_snapshot_completeness() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.profile_snapshot := new.profile_snapshot || jsonb_build_object('completeness', private.passport_completeness(new.worker_user_id));
  return new;
end;
$$;

revoke all on function private.job_applications_snapshot_completeness() from public, anon, authenticated, service_role;

create trigger job_applications_snapshot_completeness
  before insert on public.job_applications
  for each row when (not (new.profile_snapshot ? 'completeness'))
  execute function private.job_applications_snapshot_completeness();

alter table public.job_applications enable always trigger job_applications_snapshot_completeness;

-- The number of documents the employer can open for an application: the ids in the scope of its share, none once the
-- share is revoked or has expired. The share is not readable by an employer, so the count comes from here, and only for
-- the share of an organisation the caller belongs to. The membership is looked up inside, not through
-- private.active_member_org_ids(), because a sort by this column calls the function once per application (20,000 rows of
-- one vacancy: 3.3 s with that helper, 0.27 s with the lookup).
create function private.application_document_count(p_share_id uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.revoked_at is null and (s.expires_at is null or s.expires_at > now()) then jsonb_array_length(s.scope) else 0 end
  from public.passport_shares s
  where s.id = p_share_id
    and exists (
      select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
      where m.organization_id = s.organization_id and m.user_id = (select auth.uid()) and m.accepted_at is not null and o.status = 'active'
    )
$$;

revoke all on function private.application_document_count(uuid) from public, anon, authenticated, service_role;
grant execute on function private.application_document_count(uuid) to authenticated;

-- Candidate name from the snapshot (null once the candidate is erased), stage, applied time, completeness at the time of
-- applying (0 for an application made before the snapshot held it) and document count. Pipeline order is the order of the
-- enum, so sorting by status sorts by stage.
create view public.v_job_applicants with (security_invoker = true) as
select
  a.id,
  a.job_id,
  a.organization_id,
  (select j.title from public.jobs j where j.id = a.job_id) as job_title,
  nullif(btrim(concat_ws(' ', a.profile_snapshot ->> 'first_name', a.profile_snapshot ->> 'last_name')), '') as candidate_name,
  a.status,
  a.created_at as applied_at,
  coalesce((a.profile_snapshot ->> 'completeness')::integer, 0) as completeness,
  private.application_document_count(a.passport_share_id) as documents
from public.job_applications a;

revoke all on public.v_job_applicants from public, anon, authenticated, service_role;
grant select on public.v_job_applicants to authenticated;

-- The list of one vacancy (newest first, any stage) and of the whole organisation, which is sorted by applied date or by
-- stage only (completeness and documents are not columns, so they would sort every application of the organisation). The
-- index of the organisation alone is a prefix of the second, so it goes.
create index job_applications_job_created_idx on public.job_applications (job_id, created_at desc, id desc);
create index job_applications_organization_created_idx on public.job_applications (organization_id, created_at desc, id desc);
create index job_applications_organization_status_idx on public.job_applications (organization_id, status, created_at desc, id desc);
drop index public.job_applications_organization_idx;

-- What the applicant pages of an organisation offer: the stage change is blocked for a lapsed organisation (or any on
-- the free plan once limits are enforced), shortlisting and the export depend on the plan, and note_max_chars is the
-- limit set_application_status enforces, for the decline dialog to quote. No row for an organisation the caller is not an
-- active member of.
create function public.get_applicant_access(p_organization_id uuid) returns table (
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

revoke all on function public.get_applicant_access(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_applicant_access(uuid) to authenticated;

-- The applicants of one vacancy, optionally of one stage, for the CSV file: a json array of
-- {candidate_name, status, applied_at, completeness, documents}, newest first, the rows the list shows and nothing else.
-- It is one value because the Data API cuts a set of rows at 100. One audit row records who exported which vacancy and
-- how many rows, never a candidate. Errors: CHARA_UNAUTHENTICATED, CHARA_FORBIDDEN (company_account_required),
-- CHARA_INVALID_INPUT (p_job_id), CHARA_NOT_FOUND (a vacancy of another organisation is the same as one that does not
-- exist), CHARA_FEATURE_NOT_IN_PLAN (detail read_only_free_plan, or csv_export when the plan lacks it),
-- CHARA_LIMIT_REACHED (detail applicant_export_max_rows), CHARA_SETTING_MISSING.
create function public.export_applicants(p_job_id uuid, p_stage public.application_status default null) returns jsonb
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

revoke all on function public.export_applicants(uuid, public.application_status) from public, anon, authenticated, service_role;
grant execute on function public.export_applicants(uuid, public.application_status) to authenticated;

-- The number of applications of a vacancy in each stage, for the board to poll: one request instead of the eight column
-- reads. It runs with the rights of the caller, so the row policy of FR-D5 decides what is counted; a stage with no
-- application has no row.
create function public.get_board_counts(p_job_id uuid) returns table (status public.application_status, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.status, count(*) from public.job_applications a where a.job_id = p_job_id group by a.status
$$;

revoke all on function public.get_board_counts(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_board_counts(uuid) to authenticated;
