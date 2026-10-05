-- Candidate documents (FR-B2; ARCHITECTURE.md sections 5, 7; OPEN_QUESTIONS.md D42). A document is a metadata row first and
-- a private storage object second: the storage insert policy accepts an object only under the id of an existing, undeleted
-- row of the uploader, so no orphan object can appear. The candidate lists, renames and (through delete_worker_document)
-- deletes own documents; nobody else has a read path, third-party access arrives with the sharing units (FR-B3, FR-B5).

create type public.worker_document_type as enum ('cv', 'certificate');

-- Owner-changeable: how far ahead an expiry date may lie (FR-B2 data rules).
insert into private.settings (key, value) values ('worker_document_expiry_max_years', '50');

create table public.worker_documents (
  id uuid primary key default gen_random_uuid(),
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  type public.worker_document_type not null,
  title text not null check (title = btrim(title) and length(title) between 1 and 120 and title !~ '[[:cntrl:]]'),
  bucket_id text not null default 'passport-documents' check (bucket_id = 'passport-documents'),
  storage_path text not null,
  file_name text not null check (file_name ~ '^[A-Za-z0-9._-]{1,100}$'),
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes between 1 and 15728640),
  scan_status text not null default 'pending' check (scan_status in ('pending', 'skipped', 'clean', 'rejected')),
  expires_on date,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (storage_path = worker_user_id::text || '/' || id::text || '/' || file_name),
  check (expires_on is null or type = 'certificate')
);

comment on table public.worker_documents is
  'Candidate CVs and certificates. Soft delete: deleted_at is set only by delete_worker_document, which also queues the object removal.';
comment on column public.worker_documents.scan_status is
  'pending, then skipped (magic bytes valid, no scanning vendor yet), clean (vendor scan passed) or rejected; written only by document_set_scan_status.';

-- The list (newest first, keyset on created_at and id) and every policy test (worker_user_id, deleted_at) read this.
create index worker_documents_owner_created_idx
  on public.worker_documents (worker_user_id, created_at desc, id desc) where deleted_at is null;
-- The dashboard reminders.
create index worker_documents_owner_expiry_idx
  on public.worker_documents (worker_user_id, expires_on) where deleted_at is null and expires_on is not null;

alter table public.worker_documents enable row level security;
alter table public.worker_documents force row level security;

-- A candidate adds a row (with the id the storage path carries) and changes only the title and the expiry date; the
-- bucket, scan status and deletion time are set by the table defaults and the two RPCs below, and there is no delete grant.
grant select on public.worker_documents to authenticated;
grant insert (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes, expires_on)
  on public.worker_documents to authenticated;
grant update (title, expires_on) on public.worker_documents to authenticated;

create policy worker_documents_select_own on public.worker_documents
  for select to authenticated
  using (worker_user_id = (select auth.uid()) and deleted_at is null);
create policy worker_documents_insert_own on public.worker_documents
  for insert to authenticated
  with check (worker_user_id = (select auth.uid()) and (select private.account_kind()) = 'worker');
create policy worker_documents_update_own on public.worker_documents
  for update to authenticated
  using (worker_user_id = (select auth.uid()) and deleted_at is null)
  with check (worker_user_id = (select auth.uid()) and deleted_at is null);

-- Dates are UTC; checked when the date is set or changed, so an old row can still be renamed. Definer rights only to
-- read the setting, which the API roles cannot.
create function private.worker_documents_check_expiry() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_years integer := (select (value #>> '{}')::integer from private.settings where key = 'worker_document_expiry_max_years');
begin
  if tg_op = 'UPDATE' and new.expires_on is not distinct from old.expires_on then
    return new;
  end if;
  if new.expires_on is not null
     and new.expires_on > ((now() at time zone 'utc')::date + make_interval(years => coalesce(v_years, 0)))::date then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'expires_on';
  end if;
  return new;
end;
$$;

revoke all on function private.worker_documents_check_expiry() from public, anon, authenticated, service_role;

create trigger worker_documents_check_expiry
  before insert or update of expires_on on public.worker_documents
  for each row execute function private.worker_documents_check_expiry();

alter table public.worker_documents enable always trigger worker_documents_check_expiry;

-- The audit rows carry the document type, never the title or the file name (NFR-C1).
create function private.worker_documents_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform audit.record('document.created', 'worker_documents', new.id::text, jsonb_build_object('type', new.type));
    return null;
  end if;
  if new.title is distinct from old.title then
    perform audit.record('document.renamed', 'worker_documents', new.id::text, jsonb_build_object('type', new.type));
  end if;
  if old.deleted_at is null and new.deleted_at is not null then
    perform audit.record('document.deleted', 'worker_documents', new.id::text, jsonb_build_object('type', new.type));
  end if;
  if new.scan_status is distinct from old.scan_status then
    perform audit.record(
      'document.scanned', 'worker_documents', new.id::text,
      jsonb_build_object('type', new.type, 'scan_status', new.scan_status)
    );
  end if;
  return null;
end;
$$;

revoke all on function private.worker_documents_audit() from public, anon, authenticated, service_role;

create trigger worker_documents_audit
  after insert or update of title, deleted_at, scan_status on public.worker_documents
  for each row execute function private.worker_documents_audit();

alter table public.worker_documents enable always trigger worker_documents_audit;

-- Hides the row at once and queues the removal of the object for account-ops, which retries it through the Storage API
-- (a SQL delete on storage.objects would orphan the stored file). A second call finds nothing and queues nothing.
create function public.delete_worker_document(p_document_id uuid) returns void
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
  perform pgmq.send('account_ops', jsonb_build_object(
    'action', 'delete_object', 'user_id', v_uid, 'bucket_id', v_document.bucket_id, 'path', v_document.storage_path
  ));
end;
$$;

revoke all on function public.delete_worker_document(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_worker_document(uuid) to authenticated;

-- The scan-document function reports its verdict here. Only a pending row moves; a repeat of the same webhook (or any
-- later call) leaves the row as it is and returns the status it has. Returns that status.
create function public.document_set_scan_status(p_document_id uuid, p_status text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_status is null or p_status not in ('skipped', 'clean', 'rejected') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'status';
  end if;

  update public.worker_documents d set scan_status = p_status
  where d.id = p_document_id and d.scan_status = 'pending' and d.deleted_at is null
  returning d.scan_status into v_status;
  if found then
    return v_status;
  end if;

  select d.scan_status into v_status from public.worker_documents d where d.id = p_document_id;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_status;
end;
$$;

revoke all on function public.document_set_scan_status(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.document_set_scan_status(uuid, text) to service_role;

-- The private bucket (mirrored in supabase/config.toml). The first folder is the owner and the second the document id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('passport-documents', 'passport-documents', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy passport_docs_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'passport-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Metadata first: the document folder must belong to an undeleted row of the uploader. There is deliberately no policy
-- for update and none for any other role: an organisation or staff member never reads these objects directly.
create policy passport_docs_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'passport-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.worker_documents d
      where d.worker_user_id = (select auth.uid()) and d.deleted_at is null and d.id::text = (storage.foldername(name))[2]
    )
  );

create policy passport_docs_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'passport-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- The database webhook of ARCHITECTURE.md 7.3: every new object of the bucket is announced to scan-document. pg_net
-- queues the call and sends it after the commit, so an unreachable function never fails an upload. Nothing is sent while
-- the Vault secrets project_url and edge_shared_secret do not exist (a local stack, CI); one of them alone is a
-- misconfiguration and warns. Both are set by the deploy runbook (docs/runbooks/platform-staff.md).
create function private.scan_document_webhook() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select
    max(s.decrypted_secret) filter (where s.name = 'project_url'),
    max(s.decrypted_secret) filter (where s.name = 'edge_shared_secret')
  into v_url, v_secret
  from vault.decrypted_secrets s
  where s.name in ('project_url', 'edge_shared_secret');
  if v_url is null and v_secret is null then
    return null;
  end if;
  if v_url is null or v_secret is null then
    raise warning 'scan-document is not called: the Vault secrets project_url and edge_shared_secret are not both set';
    return null;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/scan-document',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-edge-secret', v_secret),
    body := jsonb_build_object(
      'type', 'INSERT', 'schema', 'storage', 'table', 'objects',
      'record', jsonb_build_object('id', new.id, 'bucket_id', new.bucket_id, 'name', new.name, 'metadata', new.metadata)
    ),
    timeout_milliseconds := 30000
  );
  return null;
end;
$$;

revoke all on function private.scan_document_webhook() from public, anon, authenticated, service_role;

create trigger passport_documents_scan
  after insert on storage.objects
  for each row when (new.bucket_id = 'passport-documents')
  execute function private.scan_document_webhook();
