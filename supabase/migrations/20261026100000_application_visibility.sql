-- Application visibility (FR-D5; ARCHITECTURE.md sections 4, 5; OPEN_QUESTIONS.md D56). A candidate reads the own
-- applications and their events, an accepted member of the organisation reads those of its vacancies, and nobody else reads
-- either table. Internal notes (application_notes) belong to the organisation: a candidate has no policy on them. Nothing
-- writes to the applications and their events except the RPCs; a note is the one direct insert, by a member.
-- An attempt on an application of another organisation through one of the RPCs is logged by the database (RAISE LOG).

-- The policies are named <table>_<command>_<audience>.
alter policy job_applications_select_own on public.job_applications rename to job_applications_select_worker;
alter policy application_events_select_own on public.application_events rename to application_events_select_worker;

-- Accepted members only, any role: member_org_ids lists the organisations of the caller whose invitation is accepted, so a
-- removed member and a pending invitation see nothing from the next query on. The organisation's status is not looked at:
-- the pages refuse a suspended organisation, and past applicants of a lapsed one stay readable (OPEN_QUESTIONS.md C11).
-- The two policies of a table are OR-ed. "= any (array(select ...))" keeps both arms index conditions (a bitmap OR of the
-- worker and the organisation index), where "in (select ...)" would turn the OR into a scan of the whole table for a
-- query without a filter. The events are checked row by row against the application, so that one event lookup costs one
-- index probe and not the build of the hash of all the applications of a large organisation.
create policy job_applications_select_member on public.job_applications
  for select to authenticated
  using (organization_id = any (array(select private.member_org_ids())));

create policy application_events_select_member on public.application_events
  for select to authenticated
  using (exists (
    select 1 from public.job_applications a
    where a.id = application_events.application_id and a.organization_id = any (array(select private.member_org_ids()))
  ));

-- The timeline stays the candidate's reading (FR-D3): with the member policy above, the policy of the events alone no
-- longer limits it to the candidate's own applications.
create or replace view public.v_my_application_timeline with (security_invoker = true) as
select
  e.application_id,
  e.created_at,
  e.from_status,
  e.to_status,
  e.note,
  private.application_event_actor_role(e.id) as actor_role
from public.application_events e
join public.job_applications a on a.id = e.application_id
where a.worker_user_id = (select auth.uid());

-- A note names the organisation of the application, and the pair is a foreign key, so a note cannot sit under another
-- organisation whatever the policy says.
alter table public.job_applications add constraint job_applications_id_organization_key unique (id, organization_id);

create table public.application_notes (
  id bigint generated always as identity primary key,
  application_id uuid not null,
  organization_id uuid not null references public.organizations (id),
  author_id uuid not null default auth.uid() references public.profiles (id),
  body text not null check (body = btrim(body) and length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (application_id, organization_id) references public.job_applications (id, organization_id)
);

comment on table public.application_notes is
  'Internal notes of an organisation on an application. Never visible to the candidate; append-only (no update or delete grant).';

-- The notes of one application, newest first (FR-E2), and the policy columns.
create index application_notes_application_idx on public.application_notes (application_id, created_at desc, id desc);
create index application_notes_organization_idx on public.application_notes (organization_id);
create index application_notes_author_idx on public.application_notes (author_id);

alter table public.application_notes enable row level security;
alter table public.application_notes force row level security;

grant select on public.application_notes to authenticated;
grant insert (application_id, organization_id, author_id, body) on public.application_notes to authenticated;

create policy application_notes_select_member on public.application_notes
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

create policy application_notes_insert_member on public.application_notes
  for insert to authenticated
  with check (organization_id in (select private.member_org_ids()) and author_id = (select auth.uid()));

-- A suspended organisation and a lapsed one (read-only past applicants, C11) cannot add notes. The check runs for members
-- only, so the answer never tells an outsider anything about the plan or the status of an organisation.
create function private.application_notes_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id in (select private.member_org_ids()) then
    if exists (select 1 from public.organizations o where o.id = new.organization_id and o.status <> 'active') then
      raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
    end if;
    perform private.assert_org_writable(new.organization_id);
  end if;
  return new;
end;
$$;

revoke all on function private.application_notes_guard() from public, anon, authenticated, service_role;

create trigger application_notes_guard
  before insert on public.application_notes
  for each row execute function private.application_notes_guard();

alter table public.application_notes enable always trigger application_notes_guard;

-- One line in the database log for an attempt on an application of somebody else: the caller, the function and the
-- application, never a name or a note. It is written only for an application that exists and is neither the caller's own
-- nor one of the caller's organisations, so a guess at an id leaves no trace, and the caller gets the answer it gets for an
-- unknown id. A RAISE LOG stays when the failing call rolls back.
create function private.log_cross_tenant(p_fn text, p_application_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.job_applications a
    where a.id = p_application_id
      and a.worker_user_id is distinct from (select auth.uid())
      and a.organization_id not in (select private.member_org_ids())
  ) then
    raise log 'CHARA_CROSS_TENANT caller=% function=% application=%', (select auth.uid()), p_fn, p_application_id;
  end if;
end;
$$;

revoke all on function private.log_cross_tenant(text, uuid) from public, anon, authenticated, service_role;

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
  if v_app.status <> 'applied'
     or exists (select 1 from public.organizations o where o.id = v_app.organization_id and o.status <> 'active')
     or private.free_plan_restricted(v_app.organization_id) then
    return;
  end if;
  perform private.move_application(v_app, 'viewed', 'mark_application_viewed', null, null);
end;
$$;

create or replace function public.withdraw_application(p_application_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_app public.job_applications;
begin
  select a.* into v_app from public.job_applications a
  where a.id = p_application_id and a.worker_user_id = v_uid
  for no key update;
  if not found then
    perform private.log_cross_tenant('withdraw_application', p_application_id);
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform private.move_application(v_app, 'withdrawn', 'withdraw_application', v_uid, null);

  update public.passport_shares s set revoked_at = now()
  where s.application_id = v_app.id and s.revoked_at is null;
  insert into public.consents (user_id, purpose, version, action)
  select c.user_id, c.purpose, c.version, 'withdrawn'
  from public.passport_shares s
  join public.consents c on c.id = s.consent_id and c.user_id = v_uid
  where s.application_id = v_app.id;
end;
$$;

-- The two reads of the applicant page return no row for an application the caller cannot see (the page answers it as an
-- unknown id); the attempt is logged all the same, which makes them volatile.
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
  return query
  select
    a.id, a.organization_id, a.job_id, j.title,
    nullif(btrim(concat_ws(' ', a.profile_snapshot ->> 'first_name', a.profile_snapshot ->> 'last_name')), ''),
    a.status, a.created_at,
    private.has_feature(a.organization_id, 'shortlisting'),
    case
      when o.status <> 'active' then 'organization_suspended'
      when private.free_plan_restricted(a.organization_id) then 'read_only_free_plan'
    end,
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'application_status_note_max_chars')
  from public.job_applications a
  join public.jobs j on j.id = a.job_id
  join public.organizations o on o.id = a.organization_id
  where a.id = p_application_id and a.organization_id in (select private.member_org_ids());
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
  return query
  select
    e.id, e.from_status, e.to_status,
    case when e.actor_id is null then 'system' when e.actor_id = a.worker_user_id then 'candidate' else 'employer' end,
    case when e.actor_id is distinct from a.worker_user_id then p.display_name end,
    e.note, e.created_at
  from public.job_applications a
  join public.application_events e on e.application_id = a.id
  left join public.profiles p on p.id = e.actor_id
  where a.id = p_application_id and a.organization_id in (select private.member_org_ids())
  order by e.created_at, e.id
  limit 100;
  if not found then
    perform private.log_cross_tenant('list_applicant_events', p_application_id);
  end if;
end;
$$;
