-- Privacy by default (FR-B3; ARCHITECTURE.md sections 4, 5.6, 7.3; OPEN_QUESTIONS.md D18, D43). No employer reads a candidate
-- table or storage object: the worker tables and worker_documents are owner-only, and the one door for a third party is
-- document_access_grant, which needs an active share made for an application, a granted and not withdrawn consent, a
-- member of the organisation that owns the job, and a document whose id is in the share scope. A share is created by
-- apply_to_job, revoked by withdraw_application and given its expiry by set_application_status (later units); this
-- migration holds what they write to and what everything else reads.

-- Owner-changeable: how long a share stays valid once its application is Hired or Not selected (P13).
insert into private.settings (key, value) values ('share_expiry_days_after_final', '30');

-- scope holds document ids, never types, so a document uploaded after the application is not readable (D18).
-- application_id gets its foreign key with apply_to_job. consent_id has no foreign key: a reference would make TRUNCATE
-- on the consent ledger fail on the key before its append-only trigger refuses it; the grant joins the consent on the
-- candidate, so a missing or foreign row grants nothing.
create table public.passport_shares (
  id uuid primary key default gen_random_uuid(),
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  application_id uuid not null,
  scope jsonb not null check (
    scope::text ~ '^\[("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"(, "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")*)?\]$'
  ),
  consent_id bigint not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.passport_shares is
  'What a candidate shares with the organisation that owns a job, for one application. Written only by the application RPCs; employers never read it.';
comment on column public.passport_shares.scope is
  'jsonb array of the ids of the selected worker_documents rows, never document types.';

-- The owner's policy column, and the lookup of document_access_grant by candidate and organisation.
create index passport_shares_worker_org_idx on public.passport_shares (worker_user_id, organization_id);
create index passport_shares_org_idx on public.passport_shares (organization_id);
create unique index passport_shares_application_key on public.passport_shares (application_id);

alter table public.passport_shares enable row level security;
alter table public.passport_shares force row level security;

-- The candidate reads the own shares; nobody writes through the API (the RPCs of the application units are definers).
grant select on public.passport_shares to authenticated;

create policy passport_shares_select_own on public.passport_shares
  for select to authenticated
  using (worker_user_id = (select auth.uid()));

create function private.passport_shares_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.worker_user_id, new.organization_id, new.application_id, new.scope, new.consent_id, new.created_at)
       is distinct from
     (old.id, old.worker_user_id, old.organization_id, old.application_id, old.scope, old.consent_id, old.created_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.expires_at is not null and new.expires_at is distinct from old.expires_at) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'share_is_fixed';
  end if;
  return new;
end;
$$;

revoke all on function private.passport_shares_guard() from public, anon, authenticated, service_role;

create trigger passport_shares_guard
  before update on public.passport_shares
  for each row execute function private.passport_shares_guard();

alter table public.passport_shares enable always trigger passport_shares_guard;

-- NFR-C1: the audit rows name the organisation and the application, never a document or a person.
create function private.passport_shares_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb := jsonb_build_object('organization_id', new.organization_id, 'application_id', new.application_id);
begin
  if tg_op = 'INSERT' then
    perform audit.record('share.created', 'passport_shares', new.id::text, v_metadata);
    return null;
  end if;
  if old.revoked_at is null and new.revoked_at is not null then
    perform audit.record('share.revoked', 'passport_shares', new.id::text, v_metadata);
  end if;
  if old.expires_at is null and new.expires_at is not null then
    perform audit.record('share.expiry_set', 'passport_shares', new.id::text, v_metadata);
  end if;
  return null;
end;
$$;

revoke all on function private.passport_shares_audit() from public, anon, authenticated, service_role;

create trigger passport_shares_audit
  after insert or update of revoked_at, expires_at on public.passport_shares
  for each row execute function private.passport_shares_audit();

alter table public.passport_shares enable always trigger passport_shares_audit;

-- The ids carry no foreign key, so the evidence outlives the share, the document and the account.
create table audit.document_access_log (
  id bigint generated always as identity primary key,
  share_id uuid,
  document_id uuid not null,
  worker_user_id uuid not null,
  organization_id uuid,
  accessed_by uuid not null,
  purpose text not null check (purpose in ('application_review', 'owner_download')),
  accessed_at timestamptz not null default now()
);

alter table audit.document_access_log enable row level security;
alter table audit.document_access_log force row level security;
revoke all on table audit.document_access_log from public, anon, authenticated, service_role;

-- The caller is authorised before the scan state is read, so a stranger cannot tell a pending file from a missing share.
-- The consent ledger is compared by id because created_at is the transaction time and ties.
create function public.document_access_grant(p_document_id uuid, p_purpose text)
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
begin
  if v_uid is null then
    raise exception 'CHARA_UNAUTHENTICATED' using errcode = '42501';
  end if;

  select * into v_document from public.worker_documents d where d.id = p_document_id and d.deleted_at is null;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_document.worker_user_id <> v_uid then
    select s.id, s.organization_id into v_share, v_org
    from public.passport_shares s
    join public.consents c on c.id = s.consent_id and c.user_id = s.worker_user_id and c.action = 'granted'
    where s.worker_user_id = v_document.worker_user_id
      and s.organization_id in (select private.member_org_ids())
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
      and s.scope ? v_document.id::text
      and not exists (
        select 1 from public.consents w
        where w.user_id = c.user_id and w.purpose = c.purpose and w.action = 'withdrawn' and w.id > c.id
      )
      and exists (select 1 from public.profiles p where p.id = s.worker_user_id and p.status = 'active')
      and exists (select 1 from public.organizations o where o.id = s.organization_id and o.status = 'active')
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

  insert into audit.document_access_log (share_id, document_id, worker_user_id, organization_id, accessed_by, purpose)
  values (v_share, v_document.id, v_document.worker_user_id, v_org, v_uid, p_purpose);

  return query select v_document.bucket_id, v_document.storage_path, v_document.file_name;
end;
$$;

revoke all on function public.document_access_grant(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.document_access_grant(uuid, text) to authenticated;

-- The whole share is revoked, not just the one document: the candidate was warned by the delete dialog.
create or replace function public.delete_worker_document(p_document_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_document public.worker_documents;
begin
  if v_uid is null or private.account_kind() is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required';
  end if;

  select * into v_document from public.worker_documents d
  where d.id = p_document_id and d.worker_user_id = v_uid and d.deleted_at is null
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.worker_documents set deleted_at = now() where id = v_document.id;
  update public.passport_shares s set revoked_at = now()
  where s.worker_user_id = v_uid and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
    and s.scope ? v_document.id::text;
  perform pgmq.send('account_ops', jsonb_build_object(
    'action', 'delete_object', 'user_id', v_uid, 'bucket_id', v_document.bucket_id, 'path', v_document.storage_path
  ));
end;
$$;
