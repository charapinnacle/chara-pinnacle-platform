-- The retention of replaced licence evidence and of the evidence access log (FR-S3 AC4, SOP P2-43 steps Configure and
-- Apply; DATA_MODEL.md section 10). A scanned evidence file that a newer file supersedes, or whose entry the partner
-- removes, is kept for the period licence_evidence (30 days) before its removal is queued for account-ops; until now it
-- was queued at once. The access log of the evidence keeps 730 days, like the access log of candidate documents.

insert into private.retention_policies (entity, days, label, description) values
  ('partner_document_access_log', 730, 'Licence evidence access log',
   'Days a record of who opened the licence evidence of a partner is kept.');

-- Replaced licence evidence ---------------------------------------------------------------------------------------------

-- A scanned evidence file that a newer file superseded, or whose entry the partner removed, waits here for the period
-- licence_evidence before its removal is queued for account-ops. Nobody opens it in that time: document-url reaches only
-- the files an entry points to. No foreign keys: the row outlives the entry, like the access log. Files that were never
-- scanned clean (pending or rejected) are still removed at once.
create table private.retired_licence_evidence (
  id bigint generated always as identity primary key,
  licence_id uuid not null,
  organization_id uuid not null,
  storage_path text not null unique check (storage_path ~ (
    '^' || organization_id::text || '/' || licence_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )),
  cause text not null check (cause in ('replaced', 'removed')),
  retired_at timestamptz not null default now()
);

comment on table private.retired_licence_evidence is
  'Superseded or removed licence evidence files kept for the retention period licence_evidence (FR-S3), then queued for removal from partner-documents by private.apply_retention. Organisation data; no API access.';

create index retired_licence_evidence_retired_at_idx on private.retired_licence_evidence (retired_at);

alter table private.retired_licence_evidence enable row level security;
alter table private.retired_licence_evidence force row level security;
revoke all on table private.retired_licence_evidence from public, anon, authenticated, service_role;

create function private.retire_licence_evidence(p_licence uuid, p_org uuid, p_path text, p_cause text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.retired_licence_evidence (licence_id, organization_id, storage_path, cause)
  values (p_licence, p_org, p_path, p_cause)
  on conflict (storage_path) do nothing
$$;

revoke all on function private.retire_licence_evidence(uuid, uuid, text, text) from public, anon, authenticated, service_role;

-- public.delete_partner_licence of 20261122100000: a scanned file of the entry (the current one when skipped or clean,
-- and a previous one) is retired for the retention period; a pending or rejected file is still removed at once.
create or replace function public.delete_partner_licence(p_licence uuid) returns void
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

  if v_old.evidence_scan_status in ('skipped', 'clean') then
    perform private.retire_licence_evidence(v_old.id, v_old.organization_id, v_old.evidence_path, 'removed');
  elsif v_old.evidence_path is not null then
    perform private.queue_evidence_removal(v_old.organization_id, v_old.evidence_path);
  end if;
  if v_old.previous_evidence_path is not null then
    perform private.retire_licence_evidence(v_old.id, v_old.organization_id, v_old.previous_evidence_path, 'removed');
  end if;
  perform audit.record('partner_licence.deleted', 'partner_licence', p_licence::text,
    jsonb_build_object('organization_id', v_old.organization_id, 'country_code', v_old.country_code));
end;
$$;

revoke all on function public.delete_partner_licence(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_partner_licence(uuid) to authenticated;

-- public.partner_document_set_scan_status of 20261122100000: the previous file that a file scanned skipped or clean
-- supersedes is retired for the retention period instead of being removed at once. A rejected file is still removed at
-- once and the previous one restored.
create or replace function public.partner_document_set_scan_status(
  p_licence uuid, p_path text, p_status text, p_mime text, p_size bigint
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence public.partner_licences;
  v_status text;
begin
  if p_status is null or p_status not in ('skipped', 'clean', 'rejected') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'status';
  end if;

  select * into v_licence from public.partner_licences l
  where l.id = p_licence and l.evidence_path = p_path
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_licence.evidence_scan_status <> 'pending' then
    return v_licence.evidence_scan_status;
  end if;

  v_status := case
    when p_status = 'rejected' or v_licence.evidence_mime is distinct from p_mime
      or v_licence.evidence_size_bytes is distinct from p_size then 'rejected'
    else p_status
  end;
  if v_status = 'rejected' and v_licence.previous_evidence_path is not null then
    perform private.queue_evidence_removal(v_licence.organization_id, p_path);
    perform private.restore_previous_evidence(p_licence);
  else
    if v_licence.previous_evidence_path is not null then
      perform private.retire_licence_evidence(v_licence.id, v_licence.organization_id, v_licence.previous_evidence_path, 'replaced');
    end if;
    update public.partner_licences
    set evidence_scan_status = v_status,
        previous_evidence_path = null, previous_evidence_mime = null, previous_evidence_size_bytes = null,
        previous_evidence_scan_status = null
    where id = p_licence;
  end if;
  perform audit.record('partner_licence.evidence_scanned', 'partner_licence', p_licence::text,
    jsonb_build_object('organization_id', v_licence.organization_id, 'scan_status', v_status,
      'previous_restored', v_status = 'rejected' and v_licence.previous_evidence_path is not null));
  return v_status;
end;
$$;

revoke all on function public.partner_document_set_scan_status(uuid, text, text, text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.partner_document_set_scan_status(uuid, text, text, text, bigint) to service_role;

-- The daily job ---------------------------------------------------------------------------------------------------------

-- private.apply_retention of 20261110110000 with two rules added: the access log of licence evidence (append-only like
-- the access log of candidate documents, so the delete runs with chara.retention_run), and retired licence evidence,
-- whose removal from the private bucket is queued for account-ops (object deletion always goes through the Storage API).
create or replace function private.apply_retention() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_removed bigint;
  v_file record;
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

  select p.days into v_days from private.retention_policies p where p.entity = 'partner_document_access_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.partner_document_access_log where accessed_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform private.record_retention('partner_document_access_log', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'licence_evidence';
  if found then
    v_removed := 0;
    for v_file in
      delete from private.retired_licence_evidence r where r.retired_at < now() - make_interval(days => v_days)
      returning r.organization_id, r.storage_path
    loop
      perform private.queue_evidence_removal(v_file.organization_id, v_file.storage_path);
      v_removed := v_removed + 1;
    end loop;
    perform private.record_retention('licence_evidence', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'inactive_worker_data';
  if found then
    perform private.record_retention('inactive_worker_data', v_days, private.request_inactive_erasures(v_days));
  end if;
end;
$$;

revoke all on function private.apply_retention() from public, anon, authenticated, service_role;
