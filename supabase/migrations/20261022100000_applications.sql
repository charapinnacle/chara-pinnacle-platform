-- Applications (FR-D1, FR-D7; ARCHITECTURE.md sections 4, 7.3; OPEN_QUESTIONS.md D52): the tables job_applications and
-- application_events and the check of the consent purpose of a share. No API role has an insert, update or delete grant
-- on either table; apply_to_job (next migration) is the only writer, and the candidate reads the own rows.

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

-- A legal document that a consent refers to is never deleted or re-keyed: the foreign key this trigger replaced said so,
-- and the trigger on consents only checks at insert.
create function private.legal_documents_keep_consented() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.consents c
    where c.version = old.version
      and (c.purpose = old.slug or (old.slug = 'sharing-notice' and c.purpose like 'share\_passport:%'))
  ) then
    raise exception 'delete or update on table "legal_documents" violates foreign key constraint "consents_purpose_version_fkey" on table "consents"'
      using errcode = '23503';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.legal_documents_keep_consented() from public, anon, authenticated, service_role;

create trigger legal_documents_keep_consented
  before delete or update of slug, version on public.legal_documents
  for each row execute function private.legal_documents_keep_consented();

alter table public.legal_documents enable always trigger legal_documents_keep_consented;
