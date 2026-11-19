-- The report queue of Phase 2 (FR-S1 step Receive and AC1, AC3; FR-J3 AC7; FR-K4 AC10; NFR-C6; NFR-O5; decisions 2.7,
-- 7.2; docs/phase-2/DATA_MODEL.md sections 2 and 4). The Phase 1 reports are extended, not duplicated:
-- - The target partner_profile: anyone, a visitor too, reports the public profile of a listed partner by its slug, as the
--   profile page names it. The report holds the organisation id and nothing else. While release 2a is off, and for a
--   partner that is not public, the answer is the same CHARA_NOT_FOUND as for a slug that does not exist.
-- - priority: 1 for a report of a fee demanded from a worker, 2 for every other category. Fee demands come first in the
--   queue (workers never pay, decision 2.7).
-- - due_at: the target of decision 7.2, set when the report is stored: one working day for a fee demand
--   (report_fee_demand_target_working_days), two for a first look at any other report
--   (report_first_look_target_working_days), Monday to Friday in Europe/Berlin without a holiday calendar
--   (private.add_working_days of V11). Both targets are settings of the settings editor (NFR-O5); a change applies to
--   the reports stored after it. A target is shown, never enforced: an open report past its due time is flagged overdue.
-- - admin_list_reports lists the open reports fee demands first, then by due time, then by id, in keyset pages of the
--   composite cursor (priority, due_at, id); the closed ones stay newest first by id.
-- The reporter stays unknown to the reported party: no function a partner may call reads public.reports.

-- Targets ----------------------------------------------------------------------------------------------------------------

insert into private.settings (key, value) values
  ('report_fee_demand_target_working_days', '1'),
  ('report_first_look_target_working_days', '2');

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('report_fee_demand_target_working_days', 'integer', 1, 20, 'Target for a fee-demand report (working days)', null),
  ('report_first_look_target_working_days', 'integer', 1, 20, 'Target for a first look at other reports (working days)', null);

-- The due time of a report of this category stored at this time. A setting that is missing or not a number falls back to
-- the target of decision 7.2.
create function private.report_due_at(p_category public.report_category, p_created_at timestamptz) returns timestamptz
language sql
stable
set search_path = ''
as $$
  select private.add_working_days(
    p_created_at,
    coalesce(
      (select case when s.value #>> '{}' ~ '^[0-9]{1,2}$' then (s.value #>> '{}')::integer end
       from private.settings s
       where s.key = case when p_category = 'fee_demanded_from_worker' then 'report_fee_demand_target_working_days'
                          else 'report_first_look_target_working_days' end),
      case when p_category = 'fee_demanded_from_worker' then 1 else 2 end
    )
  )
$$;

revoke all on function private.report_due_at(public.report_category, timestamptz) from public, anon, authenticated, service_role;

-- Columns ----------------------------------------------------------------------------------------------------------------

alter table public.reports
  add column priority smallint not null
    generated always as (case when category = 'fee_demanded_from_worker' then 1 else 2 end) stored,
  add column due_at timestamptz;

update public.reports set due_at = private.report_due_at(category, created_at);

alter table public.reports alter column due_at set not null;

comment on column public.reports.priority is
  'The place of the report in the queue: 1 for a fee demanded from a worker (handled first, decision 2.7), 2 otherwise.';
comment on column public.reports.due_at is
  'The target of decision 7.2 when the report was stored: one working day for a fee demand, two for a first look at other reports (settings report_*_target_working_days, Europe/Berlin, Monday to Friday).';

-- Every way a report is stored (submit_report, a seeded row) gets the due time of its category and creation time.
create function private.set_report_due_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.due_at := private.report_due_at(new.category, new.created_at);
  return new;
end;
$$;

revoke all on function private.set_report_due_at() from public, anon, authenticated, service_role;

create trigger reports_due_at
  before insert on public.reports
  for each row execute function private.set_report_due_at();

-- The target check of 20261110110000 with partner_profile: the organisation only. The old check has a generated name
-- (reports_check locally), so it is found by its definition; exactly one check names target_type.
do $$
declare
  v_name text;
begin
  select c.conname into strict v_name
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.reports'::regclass and c.contype = 'c' and pg_catalog.pg_get_constraintdef(c.oid) like '%target_type%';
  execute format('alter table public.reports drop constraint %I', v_name);
end;
$$;
alter table public.reports add constraint reports_target_check check (case target_type
  when 'job' then job_id is not null and organization_id is null and application_id is null and content_path is null
  when 'company' then organization_id is not null and application_id is null and content_path is null
  when 'profile' then application_id is not null and job_id is null and organization_id is null and content_path is null
    and reporter_user_id is not null
  when 'content' then content_path is not null and job_id is null and organization_id is null and application_id is null
  when 'partner_profile' then organization_id is not null and job_id is null and application_id is null and content_path is null
end);

-- The open queue in its order replaces the open index on the id alone.
drop index public.reports_open_idx;
create index reports_queue_idx on public.reports (priority, due_at, id) where status in ('new', 'in_review');

-- Labels -----------------------------------------------------------------------------------------------------------------

-- private.report_target_label of 20261110110000 with partner_profile: the display name of the partner.
create or replace function private.report_target_label(p_type public.report_target_type, p_job_title text, p_org_name text, p_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'job' then p_job_title
    when 'company' then p_org_name
    when 'partner_profile' then p_org_name
    when 'content' then p_path
    else 'Candidate profile'
  end
$$;

revoke all on function private.report_target_label(public.report_target_type, text, text, text) from public, anon, authenticated, service_role;

-- submit_report ----------------------------------------------------------------------------------------------------------

-- submit_report of 20261110110000 with the target partner_profile, named by p_partner, the slug of the profile. Everything
-- else is unchanged: the checks of the input, the visitor throttle (action report) counted in the transaction, the
-- answer for a repeated report within 24 hours, the audit row without the text or the address.
drop function public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text);

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
  p_proof text default null,
  p_partner text default null
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
  if p_target_type = 'partner_profile' and (p_partner is null or btrim(p_partner) = '') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'partner';
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
  elsif p_target_type = 'partner_profile' then
    -- The profiles that get_partner_profile shows, and only while release 2a is on.
    if private.release_on('release_partner_directories') then
      select o.id into v_org
      from public.organizations o
      where o.slug = p_partner and o.type <> 'employer' and o.moderation_state = 'visible' and private.is_listed_partner(o.id);
    end if;
    if v_org is null then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
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
        when 'partner_profile' then r.organization_id = v_org
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
    case when p_target_type in ('company', 'partner_profile') then v_org end,
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
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.submit_report(
  public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text, text
) to anon, authenticated;

-- admin_list_reports -----------------------------------------------------------------------------------------------------

-- admin_list_reports of 20261110110000 with the order of FR-S1 and the due time. p_status is open (new and in review, the
-- default), new, in_review, actioned, dismissed or all. The open lists are ordered by (priority, due_at, id): fee demands
-- first, then the earliest due, so that none waits behind newer ones; the next page starts after the whole cursor of the
-- last row. The closed lists stay newest first, paged on the id alone. Trust & Safety and, to read, the Platform
-- Administrator, at aal2.
drop function public.admin_list_reports(text, public.report_target_type, integer, bigint);

create function public.admin_list_reports(
  p_status text default 'open', p_type public.report_target_type default null, p_limit integer default 25,
  p_after_id bigint default null, p_after_priority smallint default null, p_after_due_at timestamptz default null
) returns table (
  id bigint,
  reference text,
  target_type public.report_target_type,
  target_label text,
  category public.report_category,
  status public.report_status,
  priority smallint,
  due_at timestamptz,
  overdue boolean,
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
    if (p_after_id is null) <> (p_after_priority is null) or (p_after_id is null) <> (p_after_due_at is null) then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'cursor';
    end if;
    return query
    select
      r.id, private.report_reference(r.id), r.target_type,
      private.report_target_label(r.target_type, j.title, o.display_name, r.content_path),
      r.category, r.status, r.priority, r.due_at, r.due_at < now(), r.created_at, r.handled_at
    from public.reports r
    left join public.jobs j on j.id = r.job_id
    left join public.organizations o on o.id = r.organization_id
    where case v_status when 'open' then r.status in ('new', 'in_review') else r.status = v_status::public.report_status end
      and (p_type is null or r.target_type = p_type)
      and (p_after_id is null or (r.priority, r.due_at, r.id) > (p_after_priority, p_after_due_at, p_after_id))
    order by r.priority, r.due_at, r.id
    limit v_limit;
  else
    if p_after_priority is not null or p_after_due_at is not null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'cursor';
    end if;
    return query
    select
      r.id, private.report_reference(r.id), r.target_type,
      private.report_target_label(r.target_type, j.title, o.display_name, r.content_path),
      r.category, r.status, r.priority, r.due_at, r.status in ('new', 'in_review') and r.due_at < now(), r.created_at,
      r.handled_at
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

revoke all on function public.admin_list_reports(text, public.report_target_type, integer, bigint, smallint, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_reports(text, public.report_target_type, integer, bigint, smallint, timestamptz)
  to authenticated;

-- admin_get_report -------------------------------------------------------------------------------------------------------

-- admin_get_report of 20261110110000 with the due time, whether it has passed, and the slug of the organisation, so that
-- staff open the public profile a partner_profile report is about. Everything else is unchanged: never a name of a
-- candidate or a document, a signed-in reporter is only "account".
drop function public.admin_get_report(bigint);

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
  organization_slug text,
  resolution_note text,
  handled_at timestamptz,
  created_at timestamptz,
  priority smallint,
  due_at timestamptz,
  overdue boolean
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
    j.id, j.title, j.status, j.moderation_state, o.id, o.display_name, o.status, o.slug, r.resolution_note, r.handled_at,
    r.created_at, r.priority, r.due_at, r.status in ('new', 'in_review') and r.due_at < now()
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
