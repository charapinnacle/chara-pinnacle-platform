-- Retention for the personal-data tables and logs that had none (security review SA-13; NFR-C1 "retention schedule with
-- periods stored as configuration"; OPEN_QUESTIONS.md L6, D79). The periods are rows of private.retention_policies,
-- defaults to be confirmed by CHARA with L6: the legal table names none of these entities, so each is the shortest
-- period the system needs.
--   organization_invitations   90 days after an invitation was accepted or expired (it holds the invitee's address;
--                              the membership is the lasting record)
--   deleted_worker_documents   30 days after a candidate deleted a document, and only once its file is gone from
--                              Storage, so the reconciliation of docs/runbooks/platform-staff.md never loses a path
--   login_failures             30 days after the last failure window (the counter needs 15 minutes)
--   cron_job_run_details       30 days of scheduler history (no personal data; it grows by about 20,000 rows a day)
--   account_ops_archive        90 days of dead letters (20261109130000); every one is also an audit row
-- The document access log keeps its 730 days (D44, D79). Applications and their notes of candidates who stay inactive
-- are not purged: L6 does not say what makes a candidate inactive, and an employer's record of a hiring decision has a
-- legal period of its own; that rule waits for the owner (D79).
insert into private.retention_policies (entity, days) values
  ('organization_invitations', 90),
  ('deleted_worker_documents', 30),
  ('login_failures', 30),
  ('cron_job_run_details', 30),
  ('account_ops_archive', 90);

-- The deletes below read these. cron.job_run_details belongs to the extension and has no index on end_time; its daily
-- delete reads the 30 days it keeps, about 600,000 rows.
create index organization_invitations_closed_at_idx on public.organization_invitations ((coalesce(accepted_at, expires_at)));
create index worker_documents_deleted_at_idx on public.worker_documents (deleted_at) where deleted_at is not null;
create index login_failures_window_started_at_idx on private.login_failures (window_started_at);

-- private.apply_retention of 20261103120000 with the five entities above added. Every rule is optional (a missing row
-- skips it), idempotent, and audited with its period and count.
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
    perform audit.record(
      'retention.run', 'retention_policies', 'document_access_log',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'notifications';
  if found then
    delete from pgmq.a_notifications where archived_at < now() - make_interval(days => v_days);
    delete from public.notifications where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform audit.record(
      'retention.run', 'retention_policies', 'notifications',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'billing_provider_events';
  if found then
    delete from billing.provider_events where received_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform audit.record(
      'retention.run', 'retention_policies', 'billing_provider_events',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'security_events';
  if found then
    delete from private.security_events where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform audit.record(
      'retention.run', 'retention_policies', 'security_events',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'audit_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.log where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform audit.record(
      'retention.run', 'retention_policies', 'audit_log',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'organization_invitations';
  if found then
    delete from public.organization_invitations i where coalesce(i.accepted_at, i.expires_at) < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform audit.record(
      'retention.run', 'retention_policies', 'organization_invitations',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'deleted_worker_documents';
  if found then
    delete from public.worker_documents d
    where d.deleted_at < now() - make_interval(days => v_days)
      and not exists (select 1 from storage.objects o where o.bucket_id = d.bucket_id and o.name = d.storage_path);
    get diagnostics v_removed = row_count;
    perform audit.record(
      'retention.run', 'retention_policies', 'deleted_worker_documents',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'login_failures';
  if found then
    delete from private.login_failures f where f.window_started_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform audit.record(
      'retention.run', 'retention_policies', 'login_failures',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'cron_job_run_details';
  if found then
    delete from cron.job_run_details r where r.end_time < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform audit.record(
      'retention.run', 'retention_policies', 'cron_job_run_details',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'account_ops_archive';
  if found then
    delete from pgmq.a_account_ops a where a.archived_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform audit.record(
      'retention.run', 'retention_policies', 'account_ops_archive',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;
end;
$$;
