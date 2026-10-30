-- Supporting documents of partner responses (FR-O2 step Attach, AC5, AC6, the documents of AC7; SOP P2-22 output "private
-- supporting documents"; decision 3.3; NFR-S8, NFR-S11, NFR-A4; docs/phase-2/DATA_MODEL.md sections 6 and 7; release 2b).
--
-- A partner attaches up to response_documents_max (5) PDFs of at most 15 MB to its response, through the path of the
-- licence evidence (FR-J2): register_response_document reserves one object name in the private bucket
-- partner-response-documents and document-url signs an upload URL for that name only; scan-document checks the first
-- bytes and records the verdict (response_document_set_scan_status); only a file scanned skipped or clean is ever opened,
-- through a 60-second link that document-url signs after response_document_access_grant, and every opening writes the
-- audit row response_document.opened. Before the partner responds, its files wait staged on the requirement (response_id
-- null) and respond_to_invitation (recreated) attaches them, refusing while one is still being checked
-- (CHARA_DOCUMENT_NOT_SCANNED); once the response exists, a new file belongs to it at once. The files belong to the
-- response, not to a version: adding or removing one is audited but writes no version. The partner removes a file while
-- its response is live (remove_response_document). The members of the partner read the metadata of its own files; the
-- members of the employer read the scanned files of the responses to their requirements; nobody else, and nothing names
-- the employer to the partner (NFR-S11). No storage policy opens the bucket. Every function a user calls refuses to run
-- while release_job_orders is false.

insert into private.settings (key, value) values ('response_documents_max', '5') on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('response_documents_max', 'integer', 1, 20, 'Supporting documents a partner attaches to one response, at most', null);

-- The documents ------------------------------------------------------------------------------------------------------------

create table public.partner_response_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  requirement_id uuid not null references public.workforce_requirements (id) on delete cascade,
  employer_organization_id uuid not null references public.organizations (id) on delete cascade,
  response_id uuid references public.partner_responses (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (
    file_name = btrim(file_name) and char_length(file_name) between 5 and 120 and file_name ~* '\.pdf$'
    and file_name !~ '[\x01-\x1f\x7f/\\]'
  ),
  size_bytes integer not null check (size_bytes between 1 and 15728640),
  scan_status text not null default 'pending' check (scan_status in ('pending', 'skipped', 'clean', 'rejected')),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  scanned_at timestamptz,
  check (storage_path ~ (
    '^' || organization_id::text || '/' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )),
  check ((scan_status = 'pending') = (scanned_at is null))
);

comment on table public.partner_response_documents is
  'Supporting PDFs of a partner response (FR-O2, decision 3.3), at most response_documents_max per response. Staged on the requirement (response_id null) until the partner responds. The partner''s members read its own rows; the employer''s members the scanned rows of responses to their requirements. Written only by register_response_document, respond_to_invitation, remove_response_document, response_document_set_scan_status and the daily clean-up.';
comment on column public.partner_response_documents.response_id is
  'The response the file belongs to; null while it waits for the partner to respond.';
comment on column public.partner_response_documents.employer_organization_id is
  'The employer of the requirement, for the employer''s policy. Not readable through the Data API (NFR-S11).';
comment on column public.partner_response_documents.storage_path is
  '<partner>/<document>/<uuid> in the bucket partner-response-documents. Not readable through the Data API: files open only through document-url.';
comment on column public.partner_response_documents.scan_status is
  'pending (reserved, then the file arrives), skipped, clean or rejected; written only by response_document_set_scan_status. Only skipped and clean files are opened.';
comment on column public.partner_response_documents.uploaded_by is
  'The partner member who added the file; cleared when the account is erased. Not readable through the Data API.';

create index partner_response_documents_partner_idx on public.partner_response_documents (organization_id, requirement_id);
create index partner_response_documents_employer_idx on public.partner_response_documents (employer_organization_id);
create index partner_response_documents_response_idx on public.partner_response_documents (response_id) where response_id is not null;
create index partner_response_documents_requirement_idx on public.partner_response_documents (requirement_id);
create index partner_response_documents_uploaded_by_idx on public.partner_response_documents (uploaded_by) where uploaded_by is not null;
create index partner_response_documents_pending_idx on public.partner_response_documents (created_at) where scan_status = 'pending';

alter table public.partner_response_documents enable row level security;
alter table public.partner_response_documents force row level security;
revoke all on table public.partner_response_documents from public, anon, authenticated, service_role;
grant select (id, organization_id, requirement_id, response_id, file_name, size_bytes, scan_status, created_at, scanned_at)
  on public.partner_response_documents to authenticated;

create policy partner_response_documents_select_member on public.partner_response_documents
  for select to authenticated
  using (
    organization_id in (select private.member_org_ids())
    or (
      employer_organization_id in (select private.member_org_ids())
      and response_id is not null and scan_status in ('skipped', 'clean')
    )
  );

-- What a file is never changes: its partner, requirement, employer, object, name, size and time; the response is set once
-- (when the partner responds); the scan status moves only from pending; the uploader only becomes null.
create function private.partner_response_documents_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
     or new.requirement_id is distinct from old.requirement_id
     or new.employer_organization_id is distinct from old.employer_organization_id
     or new.storage_path is distinct from old.storage_path or new.file_name is distinct from old.file_name
     or new.size_bytes is distinct from old.size_bytes or new.created_at is distinct from old.created_at
     or (old.response_id is not null and new.response_id is distinct from old.response_id)
     or (new.scan_status is distinct from old.scan_status and old.scan_status <> 'pending')
     or (new.uploaded_by is distinct from old.uploaded_by and new.uploaded_by is not null) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'document_immutable', errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.partner_response_documents_immutable() from public, anon, authenticated, service_role;

create trigger partner_response_documents_immutable
  before update on public.partner_response_documents
  for each row execute function private.partner_response_documents_immutable();

alter table public.partner_response_documents enable always trigger partner_response_documents_immutable;

-- Storage --------------------------------------------------------------------------------------------------------------------

-- The private bucket (mirrored in supabase/config.toml), shaped <partner>/<document>/<uuid>. There is no storage policy for
-- any API role: the files are written and read only through URLs signed by document-url.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-response-documents', 'partner-response-documents', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

-- Queues the removal of a file of the bucket for account-ops, which removes it through the Storage API.
create function private.queue_response_document_removal(p_org uuid, p_path text) returns void
language sql
security definer
set search_path = ''
as $$
  select pgmq.send('account_ops', jsonb_build_object(
    'action', 'delete_organization_object', 'organization_id', p_org, 'bucket_id', 'partner-response-documents',
    'path', p_path
  ))
$$;

revoke all on function private.queue_response_document_removal(uuid, text) from public, anon, authenticated, service_role;

-- Whatever deletes a row (the partner, the clean-up, the cascade of a response, requirement or organisation, the retention
-- of the responses from V58) queues the removal of its file; a rejected file was queued when it was rejected, and a
-- reservation whose file never arrived has nothing to remove (the reservation trigger holds the row while a file arrives,
-- so none can arrive once the row is gone).
create function private.partner_response_documents_removed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.scan_status <> 'pending' or exists (
    select 1 from storage.objects o where o.bucket_id = 'partner-response-documents' and o.name = old.storage_path
  ) then
    perform private.queue_response_document_removal(old.organization_id, old.storage_path);
  end if;
  return null;
end;
$$;

revoke all on function private.partner_response_documents_removed() from public, anon, authenticated, service_role;

create trigger partner_response_documents_removed
  after delete on public.partner_response_documents
  for each row when (old.scan_status <> 'rejected')
  execute function private.partner_response_documents_removed();

-- A signed upload URL may outlive its reservation: an object is accepted only at the name a pending row waits for, so a
-- removed or dropped row never gains a stray file.
create function private.partner_response_documents_reserved() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Held until the object is committed, so a delete of the row (removal, clean-up, a stranded reservation dropped by
  -- respond_to_invitation) waits and then sees the object.
  perform 1 from public.partner_response_documents d
  where d.storage_path = new.name and d.scan_status = 'pending'
  for share;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.partner_response_documents_reserved() from public, anon, authenticated, service_role;

create trigger partner_response_documents_reserved
  before insert on storage.objects
  for each row when (new.bucket_id = 'partner-response-documents')
  execute function private.partner_response_documents_reserved();

-- Every new file is announced to scan-document, as for candidate documents and licence evidence.
create trigger partner_response_documents_scan
  after insert on storage.objects
  for each row when (new.bucket_id = 'partner-response-documents')
  execute function private.scan_document_webhook();

-- private.rescan_pending_documents of 20261122100000 with the response documents added: a file still pending two minutes
-- after it arrived is announced again, for one day, and a response document for 30 days (the clean-up's limit for staged
-- files), because a pending file holds up its partner's response. At most 100 per run.
create or replace function private.rescan_pending_documents() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object storage.objects;
  v_sent integer := 0;
begin
  for v_object in
    select o.* from (
      select d.bucket_id, d.storage_path as name, d.created_at as since, interval '1 day' as horizon
      from public.worker_documents d
      where d.scan_status = 'pending' and d.deleted_at is null
      union all
      select 'partner-documents', l.evidence_path, null, interval '1 day'
      from public.partner_licences l
      where l.evidence_scan_status = 'pending'
      union all
      select 'partner-response-documents', r.storage_path, null, interval '30 days'
      from public.partner_response_documents r
      where r.scan_status = 'pending'
    ) p
    join storage.objects o on o.bucket_id = p.bucket_id and o.name = p.name
    where coalesce(p.since, o.created_at) < now() - interval '2 minutes'
      and coalesce(p.since, o.created_at) > now() - p.horizon
    order by coalesce(p.since, o.created_at)
    limit 100
  loop
    exit when not private.scan_document_post(v_object);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;

revoke all on function private.rescan_pending_documents() from public, anon, authenticated, service_role;

-- Whether the file of the document p has arrived in the bucket.
create function private.response_document_uploaded(p public.partner_response_documents) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from storage.objects o where o.bucket_id = 'partner-response-documents' and o.name = p.storage_path)
$$;

revoke all on function private.response_document_uploaded(public.partner_response_documents) from public, anon, authenticated, service_role;

-- Whether the document p is a stranded reservation: pending, reserved more than 10 minutes ago and still without its
-- file. It neither counts against the limit nor holds up a response, which drops it.
create function private.response_document_stranded(p public.partner_response_documents) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p.scan_status = 'pending' and p.created_at < now() - interval '10 minutes' and not private.response_document_uploaded(p)
$$;

revoke all on function private.response_document_stranded(public.partner_response_documents) from public, anon, authenticated, service_role;

-- Adding a file ----------------------------------------------------------------------------------------------------------------

-- Reserves the name of a new supporting document of the partner p_org for the requirement p_requirement (FR-O2 step
-- Attach, AC5), called by document-url with the caller's token, which then signs an upload URL for that name only. For an
-- accepted member of an active, listed, visible partner (private.assert_responding_partner); counted against the
-- document_access rate limit of the caller and the daily quota of audited writes. Refusals, each writing nothing:
-- CHARA_INVALID_INPUT file for a type other than application/pdf, a size outside 1 byte to 15 MB, or a name that is not
-- 5 to 120 characters ending in .pdf without control characters or slashes; without a response, the refusal a response
-- would raise now (private.response_refusal: the partner must be able to respond); with a response, CHARA_INVALID_STATE
-- with its status unless it is submitted or updated, and requirement_closed on a closed or filled requirement (a paused
-- one keeps its responses and their edits); CHARA_LIMIT_REACHED response_documents_max when the partner already has that
-- many files for the requirement that are neither rejected nor stranded reservations. The count runs under the advisory lock of the partner's
-- responses, so two uploads, or an upload and the response, never pass the limit together (NFR-A4).
-- Writes the row (pending; staged when there is no response yet, else on the response) and one audit row
-- response_document.added; answers the bucket, the object name, the file name and the id.
create function public.register_response_document(
  p_org uuid, p_requirement uuid, p_file_name text, p_mime text, p_size bigint
) returns table (bucket_id text, object_path text, file_name text, document_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
  v_response public.partner_responses;
  v_check record;
  v_name text := btrim(coalesce(p_file_name, ''));
  v_max integer := coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,6}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'response_documents_max'), 5);
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  perform private.assert_responding_partner(p_org);
  perform private.check_rate_limit('document_access', (select auth.uid()));
  if p_mime is distinct from 'application/pdf' or p_size is null or p_size not between 1 and 15728640
     or char_length(v_name) not between 5 and 120 or v_name !~* '\.pdf$' or v_name ~ '[\x01-\x1f\x7f/\\]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'file';
  end if;

  select * into v_row from public.workforce_requirements r where r.id = p_requirement for share;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('partner_responses:' || p_org::text, 0));

  select * into v_response from public.partner_responses p
  where p.requirement_id = v_row.id and p.organization_id = p_org
  for share;
  if v_response.id is null then
    select * into v_check from private.response_refusal(p_org, v_row);
    if v_check.message is not null then
      perform private.raise_response_refusal(v_check.message, v_check.detail);
    end if;
  else
    if v_response.status not in ('submitted', 'updated') then
      raise exception 'CHARA_INVALID_STATE' using detail = v_response.status::text;
    end if;
    if v_row.status in ('closed', 'filled') then
      raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_closed';
    end if;
  end if;

  if (select count(*) from public.partner_response_documents d
      where d.organization_id = p_org and d.requirement_id = v_row.id and d.scan_status <> 'rejected'
        and not private.response_document_stranded(d)) >= v_max then
    raise exception 'CHARA_LIMIT_REACHED' using detail = 'response_documents_max';
  end if;
  perform private.count_audited_write(p_org);

  v_path := p_org::text || '/' || v_id::text || '/' || gen_random_uuid()::text;
  insert into public.partner_response_documents (
    id, organization_id, requirement_id, employer_organization_id, response_id, storage_path, file_name, size_bytes,
    uploaded_by
  ) values (
    v_id, p_org, v_row.id, v_row.organization_id, v_response.id, v_path, v_name, p_size, (select auth.uid())
  );
  perform audit.record('response_document.added', 'partner_response_document', v_id::text,
    jsonb_strip_nulls(jsonb_build_object('organization_id', p_org, 'requirement_id', v_row.id,
      'response_id', v_response.id, 'size_bytes', p_size)));
  return query select 'partner-response-documents'::text, v_path, v_name, v_id;
end;
$$;

revoke all on function public.register_response_document(uuid, uuid, text, text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.register_response_document(uuid, uuid, text, text, bigint) to authenticated;

-- The scan-document verdict for a response document, as partner_document_set_scan_status for licence evidence: only the
-- pending row of that object moves, and a file whose stored type is not application/pdf or whose size is not the one
-- declared becomes rejected. A rejected file is queued for removal at once; its row stays (staged or on the response), so
-- the partner sees that the file was refused; it counts no more and the employer never reads it. A repeat leaves the row as it is and returns its status. Audited
-- response_document.scanned.
create function public.response_document_set_scan_status(
  p_document uuid, p_path text, p_status text, p_mime text, p_size bigint
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.partner_response_documents;
  v_status text;
begin
  if p_status is null or p_status not in ('skipped', 'clean', 'rejected') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'status';
  end if;
  select * into v_doc from public.partner_response_documents d
  where d.id = p_document and d.storage_path = p_path
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_doc.scan_status <> 'pending' then
    return v_doc.scan_status;
  end if;

  v_status := case
    when p_status = 'rejected' or p_mime is distinct from 'application/pdf' or p_size is distinct from v_doc.size_bytes
      then 'rejected'
    else p_status
  end;
  if v_status = 'rejected' then
    perform private.queue_response_document_removal(v_doc.organization_id, v_doc.storage_path);
  end if;
  update public.partner_response_documents d set scan_status = v_status, scanned_at = now() where d.id = v_doc.id;
  perform audit.record('response_document.scanned', 'partner_response_document', v_doc.id::text,
    jsonb_strip_nulls(jsonb_build_object('organization_id', v_doc.organization_id, 'response_id', v_doc.response_id,
      'scan_status', v_status)));
  return v_status;
end;
$$;

revoke all on function public.response_document_set_scan_status(uuid, text, text, text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.response_document_set_scan_status(uuid, text, text, text, bigint) to service_role;

-- Opening a file -----------------------------------------------------------------------------------------------------------------

-- The broker of the response documents, called by document-url with the caller's token, which then signs a 60-second
-- download link (FR-O2 AC6, step Attach). Counted against the document_access rate limit of the caller. The members of
-- the partner (any role, private.assert_invitation_partner) open any file of their own, staged or attached; the members of
-- the employer (any role, private.assert_invitation_employer) open the files of the responses to their requirements, of
-- whatever status. Everyone else, and an unknown id, gets CHARA_FORBIDDEN, so the answer tells an outsider nothing; a file
-- not scanned skipped or clean gets CHARA_DOCUMENT_NOT_SCANNED. Each grant writes one audit row response_document.opened
-- with the document, the partner organisation, the response and which side opened it (never the employer's id).
create function public.response_document_access_grant(p_document uuid)
returns table (bucket_id text, object_path text, file_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_doc public.partner_response_documents;
  v_side text;
begin
  if v_uid is null then
    raise exception 'CHARA_UNAUTHENTICATED' using errcode = '42501';
  end if;
  perform private.check_rate_limit('document_access', v_uid);
  select * into v_doc from public.partner_response_documents d where d.id = p_document;
  if v_doc.id is not null and private.is_org_member(v_doc.organization_id) then
    perform private.assert_invitation_partner(v_doc.organization_id);
    v_side := 'partner';
  elsif v_doc.id is not null and v_doc.response_id is not null and private.is_org_member(v_doc.employer_organization_id) then
    perform private.assert_invitation_employer(v_doc.employer_organization_id);
    v_side := 'employer';
  else
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if v_doc.scan_status not in ('skipped', 'clean') then
    raise exception 'CHARA_DOCUMENT_NOT_SCANNED';
  end if;
  perform audit.record('response_document.opened', 'partner_response_document', v_doc.id::text,
    jsonb_strip_nulls(jsonb_build_object('organization_id', v_doc.organization_id, 'response_id', v_doc.response_id,
      'side', v_side)));
  return query select 'partner-response-documents'::text, v_doc.storage_path, v_doc.file_name;
end;
$$;

revoke all on function public.response_document_access_grant(uuid) from public, anon, authenticated, service_role;
grant execute on function public.response_document_access_grant(uuid) to authenticated;

-- Removing a file ------------------------------------------------------------------------------------------------------------------

-- Removes the document p_document of the partner p_org (FR-O2 step Attach and Edit). For an accepted member of an active,
-- listed, visible partner, as an edit; counted against the daily quota of audited writes. A staged file is removed at any
-- time; a file of a response only while the response is submitted or updated and its requirement neither closed nor
-- filled (CHARA_INVALID_STATE with the response status or requirement_closed). Another partner's file or an unknown id,
-- CHARA_NOT_FOUND. The row goes, its file is queued for removal (trigger), one audit row response_document.removed.
create function public.remove_response_document(p_org uuid, p_document uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.partner_response_documents;
  v_response public.partner_responses;
begin
  perform private.assert_responding_partner(p_org);
  perform pg_advisory_xact_lock(hashtextextended('partner_responses:' || p_org::text, 0));
  select * into v_doc from public.partner_response_documents d
  where d.id = p_document and d.organization_id = p_org
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_doc.response_id is not null then
    select * into v_response from public.partner_responses p where p.id = v_doc.response_id for share;
    if v_response.status not in ('submitted', 'updated') then
      raise exception 'CHARA_INVALID_STATE' using detail = v_response.status::text;
    end if;
    if exists (select 1 from public.workforce_requirements r where r.id = v_doc.requirement_id and r.status in ('closed', 'filled')) then
      raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_closed';
    end if;
  end if;
  perform private.count_audited_write(p_org);
  delete from public.partner_response_documents d where d.id = v_doc.id;
  perform audit.record('response_document.removed', 'partner_response_document', v_doc.id::text,
    jsonb_strip_nulls(jsonb_build_object('organization_id', p_org, 'requirement_id', v_doc.requirement_id,
      'response_id', v_doc.response_id)));
end;
$$;

revoke all on function public.remove_response_document(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.remove_response_document(uuid, uuid) to authenticated;

-- The daily clean-up ---------------------------------------------------------------------------------------------------------------

-- Drops the reservations whose file never arrived (pending two hours after the reservation without an object: an upload
-- URL lives two hours, as for licence evidence) and the staged files that will never belong to a response (their
-- requirement is closed or filled, or they waited 30 days). A partner whose response lock is held (it is responding,
-- adding or removing a file) is skipped until the next run. Their files are queued for removal by the delete trigger;
-- one audit row response_document.dropped each. Returns the number dropped.
create function private.drop_stale_response_documents() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc record;
  v_dropped public.partner_response_documents;
  v_count integer := 0;
begin
  for v_doc in
    select d.id, d.organization_id from public.partner_response_documents d
    where (d.scan_status = 'pending' and d.created_at < now() - interval '2 hours') or d.response_id is null
  loop
    -- A partner responding, adding or removing a file holds this lock; its files wait for the next run.
    continue when not pg_try_advisory_xact_lock(hashtextextended('partner_responses:' || v_doc.organization_id::text, 0));
    delete from public.partner_response_documents d
    where d.id = v_doc.id
      and ((d.scan_status = 'pending' and d.created_at < now() - interval '2 hours'
            and not exists (select 1 from storage.objects o
                            where o.bucket_id = 'partner-response-documents' and o.name = d.storage_path))
        or (d.response_id is null and (
              d.created_at < now() - interval '30 days'
              or exists (select 1 from public.workforce_requirements r
                         where r.id = d.requirement_id and r.status in ('closed', 'filled')))))
    returning * into v_dropped;
    continue when v_dropped.id is null;
    perform audit.record('response_document.dropped', 'partner_response_document', v_dropped.id::text,
      jsonb_build_object('organization_id', v_dropped.organization_id, 'requirement_id', v_dropped.requirement_id,
        'scan_status', v_dropped.scan_status));
    v_count := v_count + 1;
    v_dropped := null;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.drop_stale_response_documents() from public, anon, authenticated, service_role;

select cron.schedule('response-documents-clean-up', '25 0 * * *', 'select private.drop_stale_response_documents()');

-- Responding with the staged files -----------------------------------------------------------------------------------------------

-- public.respond_to_invitation of 20261230100000_partner_responses.sql with the staged documents (FR-O2 AC5): after the
-- conditions and the proposal, the stranded reservations of the partner for the requirement (no file 10 minutes after
-- the reservation, private.response_document_stranded) are dropped; a staged file still being scanned refuses the
-- response with CHARA_DOCUMENT_NOT_SCANNED detail scanning, a younger reservation whose file has not arrived with detail
-- upload_missing, either writing nothing; the staged files scanned skipped or clean become the
-- response's, the rejected ones are deleted, and the audit row response.created counts the files attached. Everything else
-- unchanged.
create or replace function public.respond_to_invitation(
  p_org uuid,
  p_requirement uuid,
  p_capacity integer,
  p_available_from date,
  p_experience_note text,
  p_fee_model public.fee_model,
  p_fee_amount numeric default null,
  p_fee_currency text default null,
  p_timeline_note text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
  v_check record;
  v_proposal jsonb;
  v_id uuid;
  v_documents integer;
begin
  perform private.assert_responding_partner(p_org);

  select * into v_row from public.workforce_requirements r where r.id = p_requirement for share;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('partner_responses:' || p_org::text, 0));
  -- The invitation is held too, so a decline or withdrawal at the same time is either seen here or waits for this call.
  perform 1 from public.requirement_invitations i
  where i.requirement_id = v_row.id and i.organization_id = p_org
  for update;

  select * into v_check from private.response_refusal(p_org, v_row);
  if v_check.message is not null then
    perform private.raise_response_refusal(v_check.message, v_check.detail);
  end if;

  v_proposal := private.response_proposal(v_row, p_capacity, p_available_from, p_experience_note, p_fee_model, p_fee_amount,
    p_fee_currency, p_timeline_note, p_notes);
  delete from public.partner_response_documents d
  where d.organization_id = p_org and d.requirement_id = v_row.id and d.response_id is null
    and private.response_document_stranded(d);
  if exists (select 1 from public.partner_response_documents d
             where d.organization_id = p_org and d.requirement_id = v_row.id and d.response_id is null
               and d.scan_status = 'pending' and private.response_document_uploaded(d)) then
    raise exception 'CHARA_DOCUMENT_NOT_SCANNED' using detail = 'scanning';
  end if;
  if exists (select 1 from public.partner_response_documents d
             where d.organization_id = p_org and d.requirement_id = v_row.id and d.response_id is null
               and d.scan_status = 'pending') then
    raise exception 'CHARA_DOCUMENT_NOT_SCANNED' using detail = 'upload_missing';
  end if;
  perform private.count_audited_write(p_org);

  insert into public.partner_responses (
    requirement_id, organization_id, employer_organization_id, invitation_id, capacity, available_from, timeline_note,
    experience_note, fee_model, fee_amount, fee_currency, notes, created_by
  ) values (
    v_row.id, p_org, v_row.organization_id, v_check.invitation_id, (v_proposal ->> 'capacity')::integer,
    (v_proposal ->> 'available_from')::date, v_proposal ->> 'timeline_note', v_proposal ->> 'experience_note',
    (v_proposal ->> 'fee_model')::public.fee_model, (v_proposal ->> 'fee_amount')::numeric, v_proposal ->> 'fee_currency',
    v_proposal ->> 'notes', (select auth.uid())
  )
  returning id into v_id;

  insert into public.partner_response_versions (
    response_id, version, organization_id, employer_organization_id, payload, changed_fields, created_by
  )
  select p.id, 1, p.organization_id, p.employer_organization_id, private.response_payload(p), '{}', p.created_by
  from public.partner_responses p where p.id = v_id;

  delete from public.partner_response_documents d
  where d.organization_id = p_org and d.requirement_id = v_row.id and d.response_id is null and d.scan_status = 'rejected';
  update public.partner_response_documents d set response_id = v_id
  where d.organization_id = p_org and d.requirement_id = v_row.id and d.response_id is null;
  get diagnostics v_documents = row_count;

  if v_check.invitation_id is not null then
    update public.requirement_invitations i
    set status = 'responded', responded_at = now(), answered_at = coalesce(i.answered_at, now()),
        viewed_at = coalesce(i.viewed_at, now())
    where i.id = v_check.invitation_id;
  end if;

  perform audit.record('response.created', 'partner_response', v_id::text,
    jsonb_strip_nulls(jsonb_build_object('requirement_id', v_row.id, 'organization_id', p_org,
      'employer_organization_id', v_row.organization_id, 'invitation_id', v_check.invitation_id,
      'fee_model', p_fee_model, 'documents', v_documents)));
  perform private.queue_response_employer_event(v_id, 'response_received');
  return v_id;
end;
$$;

revoke all on function public.respond_to_invitation(
  uuid, uuid, integer, date, text, public.fee_model, numeric, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.respond_to_invitation(
  uuid, uuid, integer, date, text, public.fee_model, numeric, text, text, text
) to authenticated;
