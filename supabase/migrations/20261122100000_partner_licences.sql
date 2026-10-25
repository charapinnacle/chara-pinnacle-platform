-- Partner licences (FR-J2; docs/phase-2/DATA_MODEL.md sections 6 Release 2a, 7 Licences and 10; decisions 2.6, 4.5). A
-- recruitment or staffing company records, per country, the licence or registration it holds, with an optional evidence
-- file in the private bucket partner-documents. The entries are kept for staff review and for the Licence Verified badge
-- of Phase 3: until then they are shown to the partner's own members and to platform staff only, never to the public or
-- to employers, and nothing calls them licensed or verified [d2.6]. Writes are the owner's or an admin's at aal2, through
-- the RPCs below; the evidence goes through the document-url and scan-document Edge Functions like candidate documents,
-- and every opening by staff is logged in audit.partner_document_access_log. The daily job partner-licence-expiry marks
-- an entry expired the day after its valid-until date; the reminder 30 days before and the expiry notice are queued by
-- that job once V14 adds their kinds and email templates. Everything here belongs to release 2a and is refused while
-- release_partner_directories is false.

-- Number formats per country, {"PH": "^DMW-[0-9A-Z-]{6,30}$"}: empty at launch, staff add them after legal review.
insert into private.settings (key, value) values ('licence_number_patterns', '{}') on conflict (key) do nothing;
-- How far ahead a valid-until date may lie when it is entered (an assumed default of FR-J2).
insert into private.settings (key, value) values ('licence_valid_until_max_years', '20') on conflict (key) do nothing;

-- The licence form checks the same formats and the same date bound before it sends anything.
create or replace function public.get_public_settings() returns table (key text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.value #>> '{}'
  from private.settings s
  where s.key = any (array[
    'legal_entity_name', 'legal_entity_address', 'legal_entity_registration_number', 'legal_entity_vat_id',
    'legal_entity_email', 'privacy_contact', 'data_protection_contact', 'release_partner_directories',
    'partner_review_target_working_days', 'licence_number_patterns', 'licence_valid_until_max_years'
  ])
$$;

create table public.partner_licences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  country_code text not null references public.countries (code),
  issuing_authority text not null check (
    issuing_authority = btrim(issuing_authority) and length(issuing_authority) between 2 and 200
    and issuing_authority !~ '[[:cntrl:]]'
  ),
  licence_number text not null check (
    licence_number = btrim(licence_number) and length(licence_number) between 3 and 64 and licence_number !~ '[[:cntrl:]]'
  ),
  valid_until date not null,
  evidence_path text,
  evidence_mime text check (evidence_mime in ('application/pdf', 'image/jpeg', 'image/png')),
  evidence_size_bytes integer check (evidence_size_bytes between 1 and 15728640),
  evidence_scan_status text check (evidence_scan_status in ('pending', 'skipped', 'clean', 'rejected')),
  confirmed_at timestamptz not null,
  partner_terms_version integer not null,
  status text not null default 'current' check (status in ('current', 'expired')),
  expiry_notified_on date,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_licences_number_key unique (organization_id, country_code, licence_number),
  check (
    (evidence_path is null and evidence_mime is null and evidence_size_bytes is null and evidence_scan_status is null)
    or (evidence_path is not null and evidence_mime is not null and evidence_size_bytes is not null
        and evidence_scan_status is not null)
  ),
  check (evidence_path is null or evidence_path ~ (
    '^' || organization_id::text || '/' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ))
);

comment on table public.partner_licences is
  'Licences and registrations a partner declares per country, FR-J2. Members read them without the evidence path; staff through admin_list_partner_licences; never public or shown to employers [d2.6]. Written only by the partner licence RPCs and the expiry job.';
comment on column public.partner_licences.evidence_scan_status is
  'pending (reserved by partner_document_access_grant, then the file arrives), skipped, clean or rejected; written only by partner_document_set_scan_status.';
comment on column public.partner_licences.status is
  'current while valid_until is today or later (UTC), expired afterwards: set by the RPCs and the daily job partner-licence-expiry.';
comment on column public.partner_licences.expiry_notified_on is
  'The day the expiry reminder was queued, so it is queued once (the reminder comes with the notification kinds of V14).';

-- The unique key leads with organization_id and serves the member policy and the list. The storage guard, the scan
-- result and the rescan look an entry up by its object name; the daily job reads the current entries by date.
create unique index partner_licences_evidence_path_key on public.partner_licences (evidence_path) where evidence_path is not null;
create index partner_licences_current_valid_until_idx on public.partner_licences (valid_until) where status = 'current';
create index partner_licences_created_by_idx on public.partner_licences (created_by);

alter table public.partner_licences enable row level security;
alter table public.partner_licences force row level security;
revoke all on table public.partner_licences from public, anon, authenticated, service_role;
-- Every column but the evidence path: the path is the staff's way to the file, and staff read through document-url.
grant select (
  id, organization_id, country_code, issuing_authority, licence_number, valid_until, evidence_mime, evidence_size_bytes,
  evidence_scan_status, confirmed_at, partner_terms_version, status, expiry_notified_on, created_by, created_at, updated_at
) on public.partner_licences to authenticated;

create policy partner_licences_select_member on public.partner_licences
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- Who opened which evidence file, as which staff role and why (FR-J2 AC6). No foreign key: the log outlives the entry.
create table audit.partner_document_access_log (
  id bigint generated always as identity primary key,
  licence_id uuid not null,
  organization_id uuid not null,
  accessed_by uuid not null,
  staff_role public.platform_role not null,
  purpose text not null check (purpose in ('partner_review')),
  accessed_at timestamptz not null default now()
);

comment on table audit.partner_document_access_log is
  'Append-only log of evidence openings by staff, FR-J2. Written only by partner_document_access_grant; nobody reads it through the API.';

create index partner_document_access_log_licence_idx on audit.partner_document_access_log (licence_id, accessed_at desc);
create index partner_document_access_log_accessed_at_idx on audit.partner_document_access_log (accessed_at);

alter table audit.partner_document_access_log enable row level security;
alter table audit.partner_document_access_log force row level security;
revoke all on table audit.partner_document_access_log from public, anon, authenticated, service_role;

-- Append-only like audit.document_access_log: the retention job (V19) may delete with the setting of its transaction.
create function audit.partner_document_access_log_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('chara.retention_run', true), '') = 'on' then
    return old;
  end if;
  raise exception 'audit.partner_document_access_log is append-only' using errcode = '42501';
end;
$$;

revoke all on function audit.partner_document_access_log_guard() from public, anon, authenticated, service_role;

create trigger partner_document_access_log_append_only
  before update or delete on audit.partner_document_access_log
  for each row execute function audit.partner_document_access_log_guard();

create trigger partner_document_access_log_no_truncate
  before truncate on audit.partner_document_access_log
  for each statement execute function audit.partner_document_access_log_guard();

alter table audit.partner_document_access_log enable always trigger partner_document_access_log_append_only;
alter table audit.partner_document_access_log enable always trigger partner_document_access_log_no_truncate;

-- Helpers ---------------------------------------------------------------------------------------------------------------

-- The checks every partner write shares: release 2a on, an owner or admin at aal2 of an active partner organisation
-- (private.assert_org_manager raises CHARA_FORBIDDEN, detail aal2_required or organization_suspended where it applies).
create function private.assert_licence_manager(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  perform private.assert_org_manager(p_org, 'admin');
  if private.org_type(p_org) not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'partner_only';
  end if;
end;
$$;

revoke all on function private.assert_licence_manager(uuid) from public, anon, authenticated, service_role;

-- The field rules the table cannot express: the accuracy statement, the date bound at entry and the number format of
-- the country. Dates are UTC.
create function private.check_licence_input(
  p_country_code text, p_licence_number text, p_valid_until date, p_confirmed boolean, p_check_date boolean
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_years integer := (select (value #>> '{}')::integer from private.settings where key = 'licence_valid_until_max_years');
  v_pattern text := (select value ->> p_country_code from private.settings where key = 'licence_number_patterns');
begin
  if p_confirmed is distinct from true then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'confirmation';
  end if;
  if p_check_date and p_valid_until is not null
     and (p_valid_until < v_today or p_valid_until > (v_today + make_interval(years => coalesce(v_years, 0)))::date) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'valid_until';
  end if;
  if v_pattern is not null and p_licence_number is not null and p_licence_number !~ v_pattern then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'licence_number';
  end if;
end;
$$;

revoke all on function private.check_licence_input(text, text, date, boolean, boolean) from public, anon, authenticated, service_role;

-- Queues the removal of an evidence file for account-ops, which removes it through the Storage API.
create function private.queue_evidence_removal(p_org uuid, p_path text) returns void
language sql
security definer
set search_path = ''
as $$
  select pgmq.send('account_ops', jsonb_build_object(
    'action', 'delete_organization_object', 'organization_id', p_org, 'bucket_id', 'partner-documents', 'path', p_path
  ))
$$;

revoke all on function private.queue_evidence_removal(uuid, text) from public, anon, authenticated, service_role;

-- Partner writes --------------------------------------------------------------------------------------------------------

-- Adds a licence entry (FR-J2 AC1, AC3, AC4). Text is trimmed and the country upper-cased; an unknown country fails on
-- its foreign key (23503), a missing date on not null (23502) and an authority or number out of bounds on its check
-- (23514). The same country and number twice raises CHARA_CONFLICT detail licence_number. The statement is stored with
-- the current Partner Terms version. The audit row names the country, never the number.
create function public.add_partner_licence(
  p_org uuid, p_country_code text, p_issuing_authority text, p_licence_number text, p_valid_until date, p_confirmed boolean
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_country text := upper(btrim(p_country_code));
  v_number text := btrim(p_licence_number);
  v_id uuid;
begin
  perform private.assert_licence_manager(p_org);
  perform private.check_licence_input(v_country, v_number, p_valid_until, p_confirmed, true);

  begin
    insert into public.partner_licences (
      organization_id, country_code, issuing_authority, licence_number, valid_until, confirmed_at, partner_terms_version
    ) values (
      p_org, v_country, btrim(p_issuing_authority), v_number, p_valid_until, now(),
      private.current_legal_version('partner-terms')
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'CHARA_CONFLICT' using detail = 'licence_number';
  end;

  perform audit.record('partner_licence.created', 'partner_licence', v_id::text,
    jsonb_build_object('organization_id', p_org, 'country_code', v_country));
  return v_id;
end;
$$;

revoke all on function public.add_partner_licence(uuid, text, text, text, date, boolean) from public, anon, authenticated, service_role;
grant execute on function public.add_partner_licence(uuid, text, text, text, date, boolean) to authenticated;

-- Changes a licence entry with a new statement (FR-J2 AC4, the transition Expired -> Current). The date bound applies
-- when the date changes, so an old entry can still be corrected; the status follows the date. An unknown id raises
-- CHARA_NOT_FOUND; an entry of an organisation the caller does not manage, CHARA_FORBIDDEN. The audit row names the
-- fields that changed, never the number.
create function public.update_partner_licence(
  p_licence uuid, p_country_code text, p_issuing_authority text, p_licence_number text, p_valid_until date, p_confirmed boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.partner_licences;
  v_country text := upper(btrim(p_country_code));
  v_authority text := btrim(p_issuing_authority);
  v_number text := btrim(p_licence_number);
  v_changed text[];
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  select * into v_old from public.partner_licences l where l.id = p_licence;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.assert_licence_manager(v_old.organization_id);
  select * into v_old from public.partner_licences l where l.id = p_licence for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.check_licence_input(
    v_country, v_number, p_valid_until, p_confirmed, p_valid_until is distinct from v_old.valid_until);

  v_changed := array_remove(array[
    case when v_country is distinct from v_old.country_code then 'country_code' end,
    case when v_authority is distinct from v_old.issuing_authority then 'issuing_authority' end,
    case when v_number is distinct from v_old.licence_number then 'licence_number' end,
    case when p_valid_until is distinct from v_old.valid_until then 'valid_until' end
  ], null);

  begin
    update public.partner_licences
    set country_code = v_country,
        issuing_authority = v_authority,
        licence_number = v_number,
        valid_until = p_valid_until,
        status = case when p_valid_until < (now() at time zone 'utc')::date then 'expired' else 'current' end,
        expiry_notified_on = case when p_valid_until is distinct from v_old.valid_until then null else expiry_notified_on end,
        confirmed_at = now(),
        partner_terms_version = private.current_legal_version('partner-terms'),
        updated_at = now()
    where id = p_licence;
  exception when unique_violation then
    raise exception 'CHARA_CONFLICT' using detail = 'licence_number';
  end;

  perform audit.record('partner_licence.updated', 'partner_licence', p_licence::text,
    jsonb_build_object('organization_id', v_old.organization_id, 'country_code', v_country, 'changed', to_jsonb(v_changed)));
end;
$$;

revoke all on function public.update_partner_licence(uuid, text, text, text, date, boolean) from public, anon, authenticated, service_role;
grant execute on function public.update_partner_licence(uuid, text, text, text, date, boolean) to authenticated;

-- Deletes a licence entry and queues the removal of its evidence file (the Any -> Deleted transition of FR-J2). A second
-- call finds nothing (CHARA_NOT_FOUND) and queues nothing.
create function public.delete_partner_licence(p_licence uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.partner_licences;
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  select * into v_old from public.partner_licences l where l.id = p_licence;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.assert_licence_manager(v_old.organization_id);
  delete from public.partner_licences l where l.id = p_licence returning * into v_old;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_old.evidence_path is not null then
    perform private.queue_evidence_removal(v_old.organization_id, v_old.evidence_path);
  end if;
  perform audit.record('partner_licence.deleted', 'partner_licence', p_licence::text,
    jsonb_build_object('organization_id', v_old.organization_id, 'country_code', v_old.country_code));
end;
$$;

revoke all on function public.delete_partner_licence(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_partner_licence(uuid) to authenticated;

-- Evidence --------------------------------------------------------------------------------------------------------------

-- The broker of the evidence files, called by document-url with the caller's token (FR-J2 AC5, AC6).
--   evidence_upload: the owner or an admin at aal2 reserves a new object name for a PDF, JPEG or PNG of at most 15 MB
--     (anything else raises CHARA_INVALID_INPUT detail file). The entry points to the new name with scan status pending
--     and a file it had before is queued for removal; the function signs an upload URL for that name only.
--   partner_review: a Verification Reviewer or Trust & Safety Administrator at aal2 opens a scanned file; each grant
--     writes one row of audit.partner_document_access_log. A file not yet scanned (or rejected) raises
--     CHARA_DOCUMENT_NOT_SCANNED.
-- Everyone else, an unknown entry and an entry without a file get CHARA_NOT_FOUND, so nothing tells an outsider that an
-- entry exists; a member below admin gets CHARA_FORBIDDEN.
create function public.partner_document_access_grant(
  p_licence uuid, p_purpose text, p_mime text default null, p_size bigint default null
) returns table (bucket_id text, object_path text, file_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_licence public.partner_licences;
  v_role public.platform_role;
  v_path text;
begin
  if v_uid is null then
    raise exception 'CHARA_UNAUTHENTICATED' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_purpose = 'evidence_upload' then
    select * into v_licence from public.partner_licences l where l.id = p_licence;
    if not found or not private.is_org_member(v_licence.organization_id) then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    perform private.assert_licence_manager(v_licence.organization_id);
    if p_mime is null or p_mime not in ('application/pdf', 'image/jpeg', 'image/png')
       or p_size is null or p_size not between 1 and 15728640 then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'file';
    end if;
    select * into v_licence from public.partner_licences l where l.id = p_licence for update;
    if v_licence.evidence_path is not null then
      perform private.queue_evidence_removal(v_licence.organization_id, v_licence.evidence_path);
    end if;
    v_path := v_licence.organization_id::text || '/' || v_licence.id::text || '/' || gen_random_uuid()::text;
    update public.partner_licences
    set evidence_path = v_path, evidence_mime = p_mime, evidence_size_bytes = p_size, evidence_scan_status = 'pending',
        updated_at = now()
    where id = p_licence;
    perform audit.record('partner_licence.evidence_requested', 'partner_licence', p_licence::text,
      jsonb_build_object('organization_id', v_licence.organization_id, 'mime', p_mime, 'size_bytes', p_size,
        'replaced', v_licence.evidence_path is not null));
    return query select 'partner-documents'::text, v_path, null::text;
    return;
  end if;

  if p_purpose = 'partner_review' then
    select s.role into v_role from public.platform_staff s
    where s.user_id = v_uid and s.revoked_at is null and s.role in ('verification_reviewer', 'trust_safety')
    order by s.role = 'verification_reviewer' desc
    limit 1;
    if not found then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    if not private.is_aal2() then
      raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
    end if;
    select * into v_licence from public.partner_licences l where l.id = p_licence;
    if not found or v_licence.evidence_path is null then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_licence.evidence_scan_status not in ('skipped', 'clean') then
      raise exception 'CHARA_DOCUMENT_NOT_SCANNED';
    end if;
    insert into audit.partner_document_access_log (licence_id, organization_id, accessed_by, staff_role, purpose)
    values (v_licence.id, v_licence.organization_id, v_uid, v_role, p_purpose);
    return query select 'partner-documents'::text, v_licence.evidence_path,
      'licence-' || lower(v_licence.country_code) || case v_licence.evidence_mime
        when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' else '.png' end;
    return;
  end if;

  raise exception 'CHARA_INVALID_INPUT' using detail = 'purpose';
end;
$$;

revoke all on function public.partner_document_access_grant(uuid, text, text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.partner_document_access_grant(uuid, text, text, bigint) to authenticated;

-- The scan-document verdict for an evidence file, as document_set_scan_status for candidate documents: only the pending
-- entry of that object moves, a file whose stored type or size is not what was declared becomes rejected, and a repeat
-- leaves the entry as it is and returns its status.
create function public.partner_document_set_scan_status(
  p_licence uuid, p_path text, p_status text, p_mime text, p_size bigint
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_org uuid;
begin
  if p_status is null or p_status not in ('skipped', 'clean', 'rejected') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'status';
  end if;

  update public.partner_licences l
  set evidence_scan_status = case
    when p_status = 'rejected' or l.evidence_mime is distinct from p_mime or l.evidence_size_bytes is distinct from p_size
      then 'rejected'
    else p_status
  end
  where l.id = p_licence and l.evidence_path = p_path and l.evidence_scan_status = 'pending'
  returning l.evidence_scan_status, l.organization_id into v_status, v_org;
  if found then
    perform audit.record('partner_licence.evidence_scanned', 'partner_licence', p_licence::text,
      jsonb_build_object('organization_id', v_org, 'scan_status', v_status));
    return v_status;
  end if;

  select l.evidence_scan_status into v_status from public.partner_licences l
  where l.id = p_licence and l.evidence_path = p_path;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_status;
end;
$$;

revoke all on function public.partner_document_set_scan_status(uuid, text, text, text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.partner_document_set_scan_status(uuid, text, text, text, bigint) to service_role;

-- Staff read ------------------------------------------------------------------------------------------------------------

-- The entries of a partner for staff (FR-J2 AC6; the review page of V11): Platform Administrator, Verification Reviewer
-- or Trust & Safety Administrator at aal2. Expired entries stay listed. The evidence is described, never located: the
-- file opens only through document-url, for the two reviewer roles.
create function public.admin_list_partner_licences(p_org uuid)
returns table (
  id uuid, country_code text, issuing_authority text, licence_number text, valid_until date, status text,
  confirmed_at timestamptz, partner_terms_version integer, evidence_mime text, evidence_size_bytes integer,
  evidence_scan_status text, created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin', 'verification_reviewer', 'trust_safety']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  return query
  select l.id, l.country_code, l.issuing_authority, l.licence_number, l.valid_until, l.status, l.confirmed_at,
    l.partner_terms_version, l.evidence_mime, l.evidence_size_bytes, l.evidence_scan_status, l.created_at, l.updated_at
  from public.partner_licences l
  where l.organization_id = p_org
  order by l.country_code, l.valid_until, l.id;
end;
$$;

revoke all on function public.admin_list_partner_licences(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_partner_licences(uuid) to authenticated;

-- Expiry ----------------------------------------------------------------------------------------------------------------

-- Marks expired every current entry whose valid-until date has passed (UTC); an entry valid until today stays current. A
-- second run on the same day finds nothing. Audited per entry. Returns the number of entries marked.
create function private.expire_partner_licences() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence record;
  v_count integer := 0;
begin
  for v_licence in
    update public.partner_licences l
    set status = 'expired', updated_at = now()
    where l.status = 'current' and l.valid_until < (now() at time zone 'utc')::date
    returning l.id, l.organization_id, l.country_code
  loop
    perform audit.record('partner_licence.expired', 'partner_licence', v_licence.id::text,
      jsonb_build_object('organization_id', v_licence.organization_id, 'country_code', v_licence.country_code));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.expire_partner_licences() from public, anon, authenticated, service_role;

select cron.schedule('partner-licence-expiry', '15 0 * * *', 'select private.expire_partner_licences()');

-- Storage ---------------------------------------------------------------------------------------------------------------

-- The private bucket (mirrored in supabase/config.toml), shaped <organisation>/<licence>/<uuid>. There is no storage
-- policy for any API role: the files are written and read only through URLs signed by document-url.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-documents', 'partner-documents', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- A signed upload URL lives longer than the reservation it was made for: an object is accepted only at the name an entry
-- is waiting for, so an entry that was deleted, or whose file was replaced since, never gains a stray file.
create function private.partner_documents_reserved() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.partner_licences l where l.evidence_path = new.name and l.evidence_scan_status = 'pending'
  ) then
    raise exception 'CHARA_NOT_FOUND' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.partner_documents_reserved() from public, anon, authenticated, service_role;

create trigger partner_documents_reserved
  before insert on storage.objects
  for each row when (new.bucket_id = 'partner-documents')
  execute function private.partner_documents_reserved();

-- Every new evidence file is announced to scan-document, as for candidate documents.
create trigger partner_documents_scan
  after insert on storage.objects
  for each row when (new.bucket_id = 'partner-documents')
  execute function private.scan_document_webhook();

-- The rescan of 20261012100000 with the evidence files added: an entry still pending two minutes after its file arrived
-- (and for one day) is announced again. At most 100 per run.
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
      select d.bucket_id, d.storage_path as name, d.created_at as since
      from public.worker_documents d
      where d.scan_status = 'pending' and d.deleted_at is null
      union all
      select 'partner-documents', l.evidence_path, null
      from public.partner_licences l
      where l.evidence_scan_status = 'pending'
    ) p
    join storage.objects o on o.bucket_id = p.bucket_id and o.name = p.name
    where coalesce(p.since, o.created_at) < now() - interval '2 minutes'
      and coalesce(p.since, o.created_at) > now() - interval '1 day'
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
