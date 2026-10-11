-- Reporting of vacancies, companies, candidate profiles and content (FR-F4 proposed, FR-F1, FR-C7, FR-F3;
-- OPEN_QUESTIONS.md D82; the notice route that a hosting platform is likely to need under the EU Digital Services Act,
-- Art. 16, which the legal adviser of CHARA confirms). A visitor or a signed-in user reports a public vacancy, a company
-- (found through one of its public vacancies) or a page of the site; a member of an organisation reports one of its
-- applicants. The report is a row of public.reports that only definer functions touch: the table has no grant and no
-- policy. A Trust & Safety Administrator works the queue and a Platform Administrator reads it. A report about a
-- candidate holds the application id and nothing else of the candidate, and no staff function reads a candidate's name or
-- documents (FR-F3), so a report cannot become a way to read personal data.

create type public.report_target_type as enum ('job', 'company', 'profile', 'content');
create type public.report_category as enum (
  'illegal_content', 'misleading_or_fraud', 'discrimination', 'fee_demanded_from_worker', 'harassment',
  'privacy_violation', 'other'
);
create type public.report_status as enum ('new', 'in_review', 'actioned', 'dismissed');

-- job: the vacancy. company: the organisation, with the vacancy it was found through. profile: the application id of an
-- applicant of the reporter's organisation. content: the path of a public page of the site, without query or fragment.
-- reporter_user_id has no foreign key: erase_user replaces it by a pseudonym, as in the other records that outlive an
-- account. reporter_email is the optional contact of a visitor; a signed-in reporter is known by the account.
create table public.reports (
  id bigint generated always as identity primary key,
  target_type public.report_target_type not null,
  job_id uuid references public.jobs (id),
  organization_id uuid references public.organizations (id),
  application_id uuid references public.job_applications (id),
  content_path text check (content_path ~ '^/[A-Za-z0-9._~%/-]{1,255}$' and content_path !~ '//|\.\.'),
  category public.report_category not null,
  details text not null check (details = btrim(details, E' \t\r\n') and char_length(details) between 20 and 2000),
  reporter_user_id uuid,
  reporter_email text check (length(reporter_email) <= 254 and reporter_email = lower(reporter_email) and reporter_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  good_faith_confirmed boolean not null check (good_faith_confirmed),
  status public.report_status not null default 'new',
  handled_by uuid,
  handled_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) between 10 and 2000),
  created_at timestamptz not null default now(),
  check (case target_type
    when 'job' then job_id is not null and organization_id is null and application_id is null and content_path is null
    when 'company' then organization_id is not null and application_id is null and content_path is null
    when 'profile' then application_id is not null and job_id is null and organization_id is null and content_path is null
      and reporter_user_id is not null
    when 'content' then content_path is not null and job_id is null and organization_id is null and application_id is null
  end),
  check (reporter_user_id is null or reporter_email is null),
  check (case status
    when 'new' then handled_by is null and handled_at is null and resolution_note is null
    when 'in_review' then handled_by is not null and handled_at is not null and resolution_note is null
    else handled_by is not null and handled_at is not null and resolution_note is not null
  end)
);

comment on table public.reports is
  'Reports of vacancies, companies, candidate profiles and content (FR-F4, proposed). Written and read only by definer functions: the table has no grant. A report about a candidate holds the application id only.';
comment on column public.reports.handled_by is
  'The Trust & Safety Administrator who last moved the report: put it in review, or closed it. No foreign key, the record outlives the account.';
comment on column public.reports.resolution_note is
  'The note of the closing, shown to a signed-in reporter with the outcome. Required to close, 10 to 2000 characters.';

-- The queue (oldest open report first) and the lists by status, the reporter's own list and the check for a repeated
-- report, the check for a repeated report of a visitor who gave an address (and the erasure of that address), and the
-- retention of closed reports.
create index reports_open_idx on public.reports (id) where status in ('new', 'in_review');
create index reports_status_idx on public.reports (status, id desc);
create index reports_reporter_idx on public.reports (reporter_user_id, created_at desc, id desc) where reporter_user_id is not null;
create index reports_email_idx on public.reports (reporter_email, created_at desc) where reporter_email is not null;
create index reports_closed_idx on public.reports (handled_at) where status in ('actioned', 'dismissed');
-- The foreign keys: a delete or a key change of a vacancy, an organisation or an application finds its reports without a
-- scan of the table, and the reports about one vacancy are one lookup.
create index reports_job_idx on public.reports (job_id) where job_id is not null;
create index reports_organization_idx on public.reports (organization_id) where organization_id is not null;
create index reports_application_idx on public.reports (application_id) where application_id is not null;

alter table public.reports enable row level security;
alter table public.reports force row level security;
revoke all on table public.reports from public, anon, authenticated, service_role;

-- The limits of the visitor throttle for the action 'report': ten reports per visitor and hour (to be confirmed by CHARA).
-- Closed reports are kept for a year after the closing (to be confirmed by CHARA with the other retention periods).
insert into private.settings (key, value) values ('rate_limit_report_max', '10'), ('rate_limit_report_seconds', '3600');
insert into private.retention_policies (entity, days) values ('closed_reports', 365);

-- rate_limit_attempt of 20261109100000 with the action 'report' on the list of the actions the web tier may count.
create or replace function public.rate_limit_attempt(p_action text, p_key text, p_proof text default null)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_max');
  v_seconds integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_seconds');
  v_buckets integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_buckets');
  v_keys_max integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_visitor_keys_max');
  v_proof_key text := (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'rate_limit_proof_key');
  v_minute bigint := floor(extract(epoch from now()) / 60)::bigint;
  v_counter integer;
  v_own boolean := true;
  v_new_visitors integer;
  v_hits integer;
  v_expires timestamptz;
begin
  if p_action is null or p_action not in ('signup', 'resend', 'login', 'forgot_password', 'reset_password', 'mfa_code', 'report')
     or v_max is null or v_seconds is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_action';
  end if;
  if v_buckets is null or v_buckets < 1 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'rate_limit_buckets';
  end if;
  if v_keys_max is null or v_keys_max < 1 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'rate_limit_visitor_keys_max';
  end if;
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_key';
  end if;
  if v_proof_key is not null and not exists (
    select 1 from generate_series(v_minute - 1, v_minute + 1) m
    where encode(extensions.hmac(p_action || '|' || p_key || '|' || m, v_proof_key, 'sha256'), 'hex') = p_proof
  ) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501', detail = 'p_proof';
  end if;

  v_counter := (('x' || left(p_key, 8))::bit(32)::bigint & 2147483647)::integer;
  if not exists (select 1 from private.rate_limit_hits h where h.action = p_action and h.bucket = v_counter) then
    select h.hits into v_new_visitors
    from private.rate_limit_hits h
    where h.action = 'keys:' || p_action and h.bucket = 0 and h.expires_at > now();
    v_own := coalesce(v_new_visitors, 0) < v_keys_max;
    if v_own then
      perform private.rate_limit_hit('keys:' || p_action, 0, v_keys_max, v_seconds);
    end if;
  end if;

  if v_own then
    select r.hit_count, r.window_end into v_hits, v_expires
    from private.rate_limit_hit(p_action, v_counter, v_max, v_seconds) r;
  else
    select r.hit_count, r.window_end into v_hits, v_expires
    from private.rate_limit_hit('shared:' || p_action, (('x' || left(p_key, 8))::bit(32)::bigint % v_buckets)::integer, v_max, v_seconds) r;
  end if;

  allowed := v_hits <= v_max;
  retry_after_seconds := case when allowed then 0 else greatest(1, ceil(extract(epoch from v_expires - now()))::integer) end;
  return next;
end;
$$;

create function private.report_reference(p_id bigint) returns text
language sql
immutable
set search_path = ''
as $$ select 'R-' || case when p_id < 1000000 then lpad(p_id::text, 6, '0') else p_id::text end $$;

revoke all on function private.report_reference(bigint) from public, anon, authenticated, service_role;

-- What a list shows of the target of a report, without any personal data: the title of the vacancy, the display name of
-- the company, the path of the page, and for a candidate only the words "Candidate profile".
create function private.report_target_label(p_type public.report_target_type, p_job_title text, p_org_name text, p_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'job' then p_job_title
    when 'company' then p_org_name
    when 'content' then p_path
    else 'Candidate profile'
  end
$$;

revoke all on function private.report_target_label(public.report_target_type, text, text, text) from public, anon, authenticated, service_role;

-- A report, by a visitor (anon) or a signed-in user. The caller names the target by the parameter that fits its type:
-- p_job for job and company (a company is reported through one of its public vacancies, which is how a visitor can
-- name it), p_application for profile, p_path for content. A vacancy that is not public, an application that is not one
-- of an organisation the caller belongs to, and an unknown vacancy give the same CHARA_NOT_FOUND or CHARA_FORBIDDEN as
-- any other function: nothing is said about what exists. p_key and p_proof are those of the visitor throttle (action
-- report); the throttle is counted here, in the transaction, so that a direct call of the Data API cannot skip it. A
-- refused call rolls its count back with the rest, which is harmless: only a stored report is a cost.
-- The same reporter (the account, or the address of a visitor who gave one) reporting the same target in the same
-- category within 24 hours gets the reference of the first report back, is_duplicate true, and nothing is stored.
-- A visitor who gave no address cannot be told apart, and the throttle is the limit. The text of the report and the
-- address never enter the audit row.
create function public.submit_report(
  p_target_type public.report_target_type,
  p_category public.report_category,
  p_details text,
  p_good_faith boolean,
  p_key text,
  p_job uuid default null,
  p_application uuid default null,
  p_path text default null,
  p_email text default null,
  p_proof text default null
) returns table (reference text, is_duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_details text := btrim(p_details, E' \t\r\n');
  v_email text := case when (select auth.uid()) is null then lower(nullif(btrim(p_email), '')) end;
  v_job uuid;
  v_org uuid;
  v_app uuid;
  v_path text := btrim(p_path);
  v_allowed boolean;
  v_retry integer;
  v_existing bigint;
  v_id bigint;
begin
  if p_target_type is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'target_type';
  end if;
  if p_category is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'category';
  end if;
  if v_details is null or char_length(v_details) not between 20 and 2000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'details';
  end if;
  if p_good_faith is not true then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'good_faith';
  end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'email';
  end if;
  if p_target_type = 'profile' and v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'sign_in_required';
  end if;
  if p_target_type = 'content' and (v_path is null or v_path !~ '^/[A-Za-z0-9._~%/-]{1,255}$' or v_path ~ '//|\.\.') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'path';
  end if;
  if p_target_type in ('job', 'company') and p_job is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'job';
  end if;
  if p_target_type = 'profile' and p_application is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'application';
  end if;

  select a.allowed, a.retry_after_seconds into v_allowed, v_retry from public.rate_limit_attempt('report', p_key, p_proof) a;
  if not v_allowed then
    raise exception 'CHARA_RATE_LIMITED' using detail = v_retry::text;
  end if;

  if p_target_type in ('job', 'company') then
    select j.id, j.organization_id into v_job, v_org
    from public.jobs j
    where j.id = p_job and j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible';
    if not found then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif p_target_type = 'profile' then
    v_app := (private.member_application('submit_report', p_application)).id;
  end if;

  if v_uid is not null or v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended('report:' || coalesce(v_uid::text, v_email), 0));
    select r.id into v_existing
    from public.reports r
    where r.target_type = p_target_type and r.category = p_category
      and r.created_at > now() - interval '24 hours'
      and case when v_uid is not null then r.reporter_user_id = v_uid else r.reporter_email = v_email end
      and case p_target_type
        when 'job' then r.job_id = v_job
        when 'company' then r.organization_id = v_org
        when 'profile' then r.application_id = v_app
        else r.content_path = v_path
      end
    order by r.id desc
    limit 1;
    if found then
      reference := private.report_reference(v_existing);
      is_duplicate := true;
      return next;
      return;
    end if;
  end if;

  insert into public.reports (
    target_type, job_id, organization_id, application_id, content_path, category, details, reporter_user_id,
    reporter_email, good_faith_confirmed
  ) values (
    p_target_type,
    case when p_target_type in ('job', 'company') then v_job end,
    case when p_target_type = 'company' then v_org end,
    v_app,
    case when p_target_type = 'content' then v_path end,
    p_category, v_details, v_uid, v_email, true
  ) returning id into v_id;

  perform audit.record(
    'report.submitted', 'report', v_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'target_type', p_target_type, 'category', p_category, 'job_id', v_job, 'organization_id', v_org,
      'application_id', v_app, 'request_id', private.request_id()
    ))
  );
  reference := private.report_reference(v_id);
  is_duplicate := false;
  return next;
end;
$$;

revoke all on function public.submit_report(
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.submit_report(
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text
) to anon, authenticated;

-- The reports of the caller, newest first in keyset pages of (created_at, id), with the status and, once closed, the
-- outcome and the note: this is how a signed-in reporter is told that the report was closed. The text of the report and
-- the staff member are not returned.
create function public.list_my_reports(
  p_limit integer default 25, p_after_created timestamptz default null, p_after_id bigint default null
) returns table (
  id bigint,
  reference text,
  target_type public.report_target_type,
  target_label text,
  category public.report_category,
  status public.report_status,
  resolution_note text,
  handled_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if (p_after_created is null) <> (p_after_id is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_after';
  end if;

  return query
  select
    r.id, private.report_reference(r.id), r.target_type,
    private.report_target_label(r.target_type, j.title, o.display_name, r.content_path),
    r.category, r.status, r.resolution_note, r.handled_at, r.created_at
  from public.reports r
  left join public.jobs j on j.id = r.job_id
  left join public.organizations o on o.id = r.organization_id
  where r.reporter_user_id = v_uid
    and (p_after_created is null or (r.created_at, r.id) < (p_after_created, p_after_id))
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

revoke all on function public.list_my_reports(integer, timestamptz, bigint) from public, anon, authenticated, service_role;
grant execute on function public.list_my_reports(integer, timestamptz, bigint) to authenticated;

-- The queue for Trust & Safety and, to read, the Platform Administrator. p_status is open (new and in review, the
-- default), new, in_review, actioned, dismissed or all. The open reports are listed oldest first so that none waits
-- behind newer ones; the closed ones newest first. Keyset pages on the id: p_after_id is the id of the last row.
create function public.admin_list_reports(
  p_status text default 'open', p_type public.report_target_type default null, p_limit integer default 25,
  p_after_id bigint default null
) returns table (
  id bigint,
  reference text,
  target_type public.report_target_type,
  target_label text,
  category public.report_category,
  status public.report_status,
  created_at timestamptz,
  handled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
declare
  v_status text := coalesce(p_status, 'open');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  perform private.assert_staff(array['trust_safety', 'admin']::public.platform_role[]);
  if v_status not in ('open', 'new', 'in_review', 'actioned', 'dismissed', 'all') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'status';
  end if;

  if v_status in ('open', 'new', 'in_review') then
    return query
    select
      r.id, private.report_reference(r.id), r.target_type,
      private.report_target_label(r.target_type, j.title, o.display_name, r.content_path),
      r.category, r.status, r.created_at, r.handled_at
    from public.reports r
    left join public.jobs j on j.id = r.job_id
    left join public.organizations o on o.id = r.organization_id
    where case v_status when 'open' then r.status in ('new', 'in_review') else r.status = v_status::public.report_status end
      and (p_type is null or r.target_type = p_type)
      and (p_after_id is null or r.id > p_after_id)
    order by r.id
    limit v_limit;
  else
    return query
    select
      r.id, private.report_reference(r.id), r.target_type,
      private.report_target_label(r.target_type, j.title, o.display_name, r.content_path),
      r.category, r.status, r.created_at, r.handled_at
    from public.reports r
    left join public.jobs j on j.id = r.job_id
    left join public.organizations o on o.id = r.organization_id
    where case v_status when 'all' then true else r.status = v_status::public.report_status end
      and (p_type is null or r.target_type = p_type)
      and (p_after_id is null or r.id < p_after_id)
    order by r.id desc
    limit v_limit;
  end if;
end;
$$;

revoke all on function public.admin_list_reports(text, public.report_target_type, integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_reports(text, public.report_target_type, integer, bigint) to authenticated;

-- One report with its target in context: the vacancy (title, status, visibility) and the organisation (name, status)
-- the report is about or was found through, and for a candidate profile only the vacancy applied to and the organisation.
-- Never a name of a candidate or a document. A visitor's address is shown, as the way to ask them; a signed-in reporter
-- is only "account".
create function public.admin_get_report(p_id bigint) returns table (
  id bigint,
  reference text,
  target_type public.report_target_type,
  category public.report_category,
  details text,
  status public.report_status,
  reporter_kind text,
  reporter_email text,
  content_path text,
  job_id uuid,
  job_title text,
  job_status public.job_status,
  job_moderation_state public.job_moderation_state,
  organization_id uuid,
  organization_name text,
  organization_status public.organization_status,
  resolution_note text,
  handled_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety', 'admin']::public.platform_role[]);
  if p_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'report';
  end if;

  return query
  select
    r.id, private.report_reference(r.id), r.target_type, r.category, r.details, r.status,
    case when r.reporter_user_id is not null then 'account' else 'visitor' end, r.reporter_email::text, r.content_path,
    j.id, j.title, j.status, j.moderation_state, o.id, o.display_name, o.status, r.resolution_note, r.handled_at,
    r.created_at
  from public.reports r
  left join public.job_applications a on a.id = r.application_id
  left join public.jobs j on j.id = coalesce(r.job_id, a.job_id)
  left join public.organizations o on o.id = coalesce(r.organization_id, j.organization_id)
  where r.id = p_id;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_get_report(bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_report(bigint) to authenticated;

-- A Trust & Safety Administrator at aal2 puts a new report in review, or closes a new or in-review report as actioned or
-- dismissed. Every move takes a reason of 10 to 2000 characters (FR-F1) that the audit row records; the reason of a
-- closing is also the note that a signed-in reporter reads, and the move to review keeps no note on the report. A closed
-- report does not change again. Acting on the target (hiding the vacancy, suspending the organisation) is done with moderate_job and
-- suspend_organization, which this function does not repeat. The row is locked, so of two simultaneous calls one finds
-- the new state and is refused.
create function public.admin_set_report_status(p_id bigint, p_status public.report_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_note text;
  v_old public.report_status;
  v_type public.report_target_type;
begin
  if p_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'report';
  end if;
  if p_status is null or p_status = 'new' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'status';
  end if;
  v_note := private.statement_of_reasons(p_note);

  select r.status, r.target_type into v_old, v_type from public.reports r where r.id = p_id for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old in ('actioned', 'dismissed') or v_old = p_status then
    raise exception 'CHARA_INVALID_STATE' using detail = v_old::text;
  end if;

  update public.reports
  set status = p_status, handled_by = v_uid, handled_at = now(),
      resolution_note = case when p_status = 'in_review' then null else v_note end
  where id = p_id;
  perform private.audit_admin(
    'report.' || p_status::text, 'report', p_id::text, v_note,
    jsonb_build_object('from', v_old, 'to', p_status, 'target_type', v_type)
  );
end;
$$;

revoke all on function public.admin_set_report_status(bigint, public.report_status, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_report_status(bigint, public.report_status, text) to authenticated;

-- erase_user of 20261109130000 with one statement added: the reports of the erased candidate (as a signed-in reporter) lose
-- the account (a pseudonym takes its place, as in the other records that outlive an account), and an address that
-- the candidate gave as a visitor is cleared. The text of a closed report is kept for its retention period.
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
  from public.profiles p where p.id = p_user_id for no key update;
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

  delete from public.application_notes n using public.job_applications a
  where a.id = n.application_id and a.worker_user_id = p_user_id;
  update public.passport_shares
  set worker_user_id = v_pseudonym, scope = '[]', revoked_at = coalesce(revoked_at, now())
  where worker_user_id = p_user_id;
  update public.job_applications a
  set worker_user_id = v_pseudonym, cover_note = null,
      profile_snapshot = a.profile_snapshot - 'first_name' - 'last_name' - 'headline'
  where a.worker_user_id = p_user_id;
  update public.application_events set actor_id = v_pseudonym where actor_id = p_user_id;
  update public.consents set user_id = v_pseudonym where user_id = p_user_id;
  update public.reports
  set reporter_user_id = case when reporter_user_id = p_user_id then v_pseudonym else reporter_user_id end,
      reporter_email = null
  where reporter_user_id = p_user_id or reporter_email = lower(v_email);
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
  perform pgmq.delete('notifications', array(select n.msg_id from public.notifications n where n.user_id = p_user_id and n.msg_id is not null));
  delete from pgmq.a_notifications a where a.msg_id = any (array(select n.msg_id from public.notifications n where n.user_id = p_user_id and n.msg_id is not null));
  delete from public.notifications where user_id = p_user_id;
  delete from public.notification_preferences where user_id = p_user_id;
  delete from pgmq.a_account_ops a where a.message ->> 'user_id' = v_subject;

  perform set_config('chara.erasure_user', '', true);
  perform set_config('chara.erasure_pseudonym', '', true);

  perform audit.record(
    'account.erased', 'profile', v_pseudonym::text,
    jsonb_build_object('requested_at', v_requested, 'completed_at', now())
  );
  -- The auth user is deleted next, so the address travels in the message; notify deletes it after sending.
  if v_email is not null then
    perform pgmq.send('notifications', jsonb_build_object('kind', 'deletion_completed', 'email', v_email, 'mandatory', true));
  end if;
  return true;
end;
$$;

revoke all on function public.erase_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.erase_user(uuid) to service_role;

-- private.apply_retention of 20261109140000 with the rule for closed reports added: 365 days after the closing, a
-- default for CHARA to confirm with the other periods. Open reports are never removed.
create or replace function private.apply_retention() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_removed bigint;
begin
  select p.days into v_days from private.retention_policies p where p.entity = 'document_access_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.document_access_log where accessed_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform private.record_retention('document_access_log', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'notifications';
  if found then
    delete from pgmq.a_notifications where archived_at < now() - make_interval(days => v_days);
    delete from public.notifications where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('notifications', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'billing_provider_events';
  if found then
    delete from billing.provider_events where received_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('billing_provider_events', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'security_events';
  if found then
    delete from private.security_events where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('security_events', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'audit_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.log where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform private.record_retention('audit_log', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'organization_invitations';
  if found then
    delete from public.organization_invitations i where coalesce(i.accepted_at, i.expires_at) < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('organization_invitations', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'deleted_worker_documents';
  if found then
    delete from public.worker_documents d
    where d.deleted_at < now() - make_interval(days => v_days)
      and not exists (select 1 from storage.objects o where o.bucket_id = d.bucket_id and o.name = d.storage_path);
    get diagnostics v_removed = row_count;
    perform private.record_retention('deleted_worker_documents', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'login_failures';
  if found then
    delete from private.login_failures f where f.window_started_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('login_failures', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'cron_job_run_details';
  if found then
    delete from cron.job_run_details r where r.end_time < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('cron_job_run_details', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'account_ops_archive';
  if found then
    delete from pgmq.a_account_ops a where a.archived_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('account_ops_archive', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'closed_reports';
  if found then
    delete from public.reports r where r.status in ('actioned', 'dismissed') and r.handled_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('closed_reports', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'inactive_worker_data';
  if found then
    perform private.record_retention('inactive_worker_data', v_days, private.request_inactive_erasures(v_days));
  end if;
end;
$$;

