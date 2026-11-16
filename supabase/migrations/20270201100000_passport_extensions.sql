-- Passport extensions (FR-Q4 AC1 to AC5 and AC7; SOP P2-33 steps Add sections, Validate, Weigh; decisions 1.3, 4.6;
-- NFR-S8, NFR-A4, NFR-M3, NFR-O5; DATA_MODEL.md sections 4 and 6; V61, release 2c). Four owner-only lists beside the
-- Phase 1 ones: training, employment history, preferred industries (ISIC sections of public.industries) and preferred
-- employment types (the public.employment_type list of vacancies and requirements). They follow worker_skills: the owner
-- reads and writes them through the Data API under row level security, list limits are settings enforced by
-- private.worker_list_limit, and they go with the passport (on delete cascade). Organisations never read them here; the
-- Find Workers card (V68) shows them only when the worker allows it, behind release_find_workers. Nothing here stores an
-- identity number, a date of birth, an age, a nationality or another attribute NFR-C1 forbids; dates are months and years.
-- The lists are editable whatever the release switches; only the completeness weights wait for release 2c (below).

insert into private.settings (key, value) values
  ('worker_training_max', '20'),
  ('worker_employment_history_max', '20'),
  ('worker_preferred_industries_max', '10');

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('worker_training_max', 'integer', 1, 100, 'Training entries per passport', null),
  ('worker_employment_history_max', 'integer', 1, 100, 'Employment history entries per passport', null),
  ('worker_preferred_industries_max', 'integer', 1, 21, 'Preferred industries per passport', null);

create table public.worker_training (
  id uuid primary key default gen_random_uuid(),
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  course text not null constraint worker_training_course_check check (
    course = btrim(course) and char_length(course) between 2 and 120 and course !~ '[[:cntrl:]]'
  ),
  provider text constraint worker_training_provider_check check (
    provider = btrim(provider) and char_length(provider) between 1 and 120 and provider !~ '[[:cntrl:]]'
  ),
  year_completed smallint not null constraint worker_training_year_completed_check check (year_completed >= 1960),
  created_at timestamptz not null default now()
);

comment on table public.worker_training is
  'Training of the candidate passport (FR-Q4): course, optional provider, year completed. Owner only.';
comment on column public.worker_training.year_completed is
  'From 1960 to the current year (UTC); the upper bound is checked by worker_training_normalize.';

create index worker_training_worker_idx on public.worker_training (worker_user_id, year_completed desc);

create table public.worker_employment_history (
  id uuid primary key default gen_random_uuid(),
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  role text not null constraint worker_employment_history_role_check check (
    role = btrim(role) and char_length(role) between 2 and 120 and role !~ '[[:cntrl:]]'
  ),
  employer_name text constraint worker_employment_history_employer_name_check check (
    employer_name = btrim(employer_name) and char_length(employer_name) between 1 and 120 and employer_name !~ '[[:cntrl:]]'
  ),
  country_code text not null references public.countries (code),
  from_month date not null constraint worker_employment_history_from_month_check check (extract(day from from_month) = 1),
  to_month date constraint worker_employment_history_to_month_check check (extract(day from to_month) = 1),
  created_at timestamptz not null default now(),
  constraint worker_employment_history_period_check check (to_month is null or to_month >= from_month)
);

comment on table public.worker_employment_history is
  'Employment history of the candidate passport (FR-Q4): role, optional employer name, country, months. Owner only.';
comment on column public.worker_employment_history.to_month is 'Null means the candidate still works there.';
comment on column public.worker_employment_history.employer_name is
  'Never shown on the Find Workers card (FR-Q1, FR-Q4 open point).';

create index worker_employment_history_worker_idx on public.worker_employment_history (worker_user_id, from_month desc);

create table public.worker_preferred_industries (
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  industry_code text not null references public.industries (code),
  primary key (worker_user_id, industry_code)
);

create table public.worker_preferred_employment_types (
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  employment_type public.employment_type not null,
  primary key (worker_user_id, employment_type)
);

comment on table public.worker_preferred_employment_types is
  'The employment types a candidate prefers, from the list of vacancies and requirements; the enum bounds the list at its five values.';

-- Free text is stored trimmed with an empty optional value as null, so a form that sends '' stores nothing. The bounds
-- that move with the calendar (the year completed and the start month, never in the future, UTC) are checked here
-- because a check constraint must not depend on the time; they raise the check_violation a constraint would.
create function private.worker_training_normalize() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if btrim(new.provider) = '' then
    new.provider := null;
  end if;
  if new.year_completed > extract(year from now() at time zone 'utc') then
    raise exception 'new row for relation "worker_training" violates check constraint "worker_training_year_completed_check"'
      using errcode = 'check_violation', table = 'worker_training', column = 'year_completed',
        constraint = 'worker_training_year_completed_check';
  end if;
  return new;
end;
$$;

revoke all on function private.worker_training_normalize() from public, anon, authenticated, service_role;

create function private.worker_employment_history_normalize() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if btrim(new.employer_name) = '' then
    new.employer_name := null;
  end if;
  if new.from_month > date_trunc('month', now() at time zone 'utc')::date then
    raise exception 'new row for relation "worker_employment_history" violates check constraint "worker_employment_history_from_month_check"'
      using errcode = 'check_violation', table = 'worker_employment_history', column = 'from_month',
        constraint = 'worker_employment_history_from_month_check';
  end if;
  return new;
end;
$$;

revoke all on function private.worker_employment_history_normalize() from public, anon, authenticated, service_role;

create trigger worker_training_normalize before insert or update on public.worker_training
  for each row execute function private.worker_training_normalize();
create trigger worker_employment_history_normalize before insert or update on public.worker_employment_history
  for each row execute function private.worker_employment_history_normalize();

alter table public.worker_training enable always trigger worker_training_normalize;
alter table public.worker_employment_history enable always trigger worker_employment_history_normalize;

create trigger worker_training_limit before insert on public.worker_training
  for each row execute function private.worker_list_limit('worker_training_max');
create trigger worker_employment_history_limit before insert on public.worker_employment_history
  for each row execute function private.worker_list_limit('worker_employment_history_max');
create trigger worker_preferred_industries_limit before insert on public.worker_preferred_industries
  for each row execute function private.worker_list_limit('worker_preferred_industries_max');

alter table public.worker_training enable always trigger worker_training_limit;
alter table public.worker_employment_history enable always trigger worker_employment_history_limit;
alter table public.worker_preferred_industries enable always trigger worker_preferred_industries_limit;

alter table public.worker_training enable row level security;
alter table public.worker_training force row level security;
alter table public.worker_employment_history enable row level security;
alter table public.worker_employment_history force row level security;
alter table public.worker_preferred_industries enable row level security;
alter table public.worker_preferred_industries force row level security;
alter table public.worker_preferred_employment_types enable row level security;
alter table public.worker_preferred_employment_types force row level security;

-- As on the Phase 1 lists: worker_user_id, id and created_at have no update grant, so a row never moves to another
-- candidate; anonymous callers have no grant at all.
grant select, insert, delete on public.worker_training, public.worker_employment_history,
  public.worker_preferred_industries, public.worker_preferred_employment_types to authenticated;
grant update (course, provider, year_completed) on public.worker_training to authenticated;
grant update (role, employer_name, country_code, from_month, to_month) on public.worker_employment_history to authenticated;
grant update (industry_code) on public.worker_preferred_industries to authenticated;
grant update (employment_type) on public.worker_preferred_employment_types to authenticated;

create policy worker_training_select_own on public.worker_training
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_training_insert_own on public.worker_training
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_training_update_own on public.worker_training
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_training_delete_own on public.worker_training
  for delete to authenticated using (worker_user_id = (select auth.uid()));

create policy worker_employment_history_select_own on public.worker_employment_history
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_employment_history_insert_own on public.worker_employment_history
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_employment_history_update_own on public.worker_employment_history
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_employment_history_delete_own on public.worker_employment_history
  for delete to authenticated using (worker_user_id = (select auth.uid()));

create policy worker_preferred_industries_select_own on public.worker_preferred_industries
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_preferred_industries_insert_own on public.worker_preferred_industries
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_preferred_industries_update_own on public.worker_preferred_industries
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_preferred_industries_delete_own on public.worker_preferred_industries
  for delete to authenticated using (worker_user_id = (select auth.uid()));

create policy worker_preferred_employment_types_select_own on public.worker_preferred_employment_types
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_preferred_employment_types_insert_own on public.worker_preferred_employment_types
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_preferred_employment_types_update_own on public.worker_preferred_employment_types
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_preferred_employment_types_delete_own on public.worker_preferred_employment_types
  for delete to authenticated using (worker_user_id = (select auth.uid()));

-- The weights follow release 2c, as apps/web/lib/passport/completeness.ts does. While release_find_workers is off (a
-- missing setting counts as off) they stay those of Phase 1 (20261027100000_applicant_list.sql), so no score changes
-- with this migration: names and country 10, headline 5, occupation 15, three skills 15, a language 10, years of
-- experience 10, availability 10, a valid work authorisation 10, a usable CV 15. Once it is on, those of FR-Q4 AC7:
-- three skills 10, years of experience 5, a training entry 5, an employment history entry 5, the others unchanged (a
-- passport complete under the Phase 1 rules then scores 90, open point 8 of DATA_MODEL.md). Preferred industries and
-- employment types carry no weight. A snapshot stored with an application keeps its number.
create or replace function private.passport_completeness(p_user uuid) returns integer
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
      + ((select count(*) from public.worker_skills s where s.worker_user_id = p.user_id) >= 3)::int
        * case when r.find_workers then 10 else 15 end
      + exists (select 1 from public.worker_languages l where l.worker_user_id = p.user_id)::int * 10
      + (p.years_experience is not null)::int * case when r.find_workers then 5 else 10 end
      + (p.availability is not null)::int * 10
      + exists (
        select 1 from public.worker_work_authorizations a
        where a.worker_user_id = p.user_id and (a.expires_on is null or a.expires_on >= (now() at time zone 'utc')::date)
      )::int * 10
      + exists (
        select 1 from public.worker_documents d
        where d.worker_user_id = p.user_id and d.type = 'cv' and d.deleted_at is null and d.scan_status in ('clean', 'skipped')
      )::int * 15
      + case when r.find_workers then
          exists (select 1 from public.worker_training t where t.worker_user_id = p.user_id)::int * 5
          + exists (select 1 from public.worker_employment_history h where h.worker_user_id = p.user_id)::int * 5
        else 0 end
    from public.worker_profiles p
    cross join (select private.release_on('release_find_workers') as find_workers) r
    where p.user_id = p_user
  ), 0)
$$;

-- The limits the forms quote, now with the three new lists (the return type changes, so the function is recreated).
drop function public.passport_limits();

create function public.passport_limits() returns table (
  skills_max integer,
  availability_window_months integer,
  work_authorization_expiry_max_years integer,
  training_max integer,
  employment_history_max integer,
  preferred_industries_max integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select (value #>> '{}')::integer from private.settings where key = 'worker_skills_max'),
    (select (value #>> '{}')::integer from private.settings where key = 'availability_window_months'),
    (select (value #>> '{}')::integer from private.settings where key = 'work_authorization_expiry_max_years'),
    (select (value #>> '{}')::integer from private.settings where key = 'worker_training_max'),
    (select (value #>> '{}')::integer from private.settings where key = 'worker_employment_history_max'),
    (select (value #>> '{}')::integer from private.settings where key = 'worker_preferred_industries_max')
  where (select auth.uid()) is not null;
$$;

revoke all on function public.passport_limits() from public, anon, authenticated, service_role;
grant execute on function public.passport_limits() to authenticated;

-- The user's copy (FR-S3, V29) is that of 20261210100000_data_export.sql with the four new lists in the passport section.
create or replace function public.account_ops_export_data(p_export uuid) returns jsonb
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
                                           from public.worker_work_authorizations a where a.worker_user_id = v_uid), '[]'),
          'training', coalesce((select jsonb_agg(jsonb_build_object('course', t.course, 'provider', t.provider, 'year_completed', t.year_completed)
                                                 order by t.year_completed desc, t.created_at, t.id)
                                from public.worker_training t where t.worker_user_id = v_uid), '[]'),
          'employment_history', coalesce((select jsonb_agg(jsonb_build_object(
                                            'role', h.role, 'employer_name', h.employer_name, 'country', h.country_code,
                                            'from_month', to_char(h.from_month, 'YYYY-MM'), 'to_month', to_char(h.to_month, 'YYYY-MM'))
                                            order by h.from_month desc, h.created_at, h.id)
                                          from public.worker_employment_history h where h.worker_user_id = v_uid), '[]'),
          'preferred_industries', coalesce((select jsonb_agg(i.name order by i.code)
                                            from public.worker_preferred_industries p join public.industries i on i.code = p.industry_code
                                            where p.worker_user_id = v_uid), '[]'),
          'preferred_employment_types', coalesce((select jsonb_agg(e.employment_type order by e.employment_type)
                                                  from public.worker_preferred_employment_types e where e.worker_user_id = v_uid), '[]'))
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

