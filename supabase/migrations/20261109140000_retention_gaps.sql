-- Retention for the personal-data tables and logs that had none (security review SA-13; NFR-C1 "retention schedule with
-- periods stored as configuration"; OPEN_QUESTIONS.md L6, D79). The periods are rows of private.retention_policies,
-- defaults to be confirmed by CHARA with L6:
--   organization_invitations   90 days after an invitation was accepted or expired (it holds the invitee's address;
--                              the membership is the lasting record)
--   deleted_worker_documents   30 days after a candidate deleted a document, and only once its file is gone from
--                              Storage, so the reconciliation of docs/runbooks/platform-staff.md never loses a path
--   login_failures             30 days after the last failure window (the counter needs 15 minutes)
--   cron_job_run_details       30 days of scheduler history (no personal data; it grows by about 20,000 rows a day)
--   account_ops_archive        90 days of dead letters (20261109130000); every one is also an audit row
--   inactive_worker_data       730 days, the L6 default "inactive worker data 24 months": a candidate without a
--                              sign-in, a session refresh, an application or a stage change of an application for that
--                              long gets a deletion request, and the account-closure pipeline (20261016100000) erases the
--                              account after its cooling-off period unless the candidate signs in and cancels, the
--                              account is under a legal hold, or the candidate holds a platform role
-- The document access log keeps its 730 days (D44, D79).
insert into private.retention_policies (entity, days) values
  ('organization_invitations', 90),
  ('deleted_worker_documents', 30),
  ('login_failures', 30),
  ('cron_job_run_details', 30),
  ('account_ops_archive', 90),
  ('inactive_worker_data', 730);

-- The deletes below read these. cron.job_run_details belongs to the extension and has no index on end_time; its daily
-- delete reads the 30 days it keeps, about 600,000 rows. login_failures has one row per user and its window is rewritten
-- on every failed login, so it gets no index: a daily scan of a table the size of the user count is cheaper than
-- turning those updates into non-HOT ones. The inactive candidates are found from the oldest accounts that have no
-- deletion request (only an account older than the period can be inactive for it), and then by the indexes of
-- auth.sessions, job_applications and application_events on the user and the application.
create index organization_invitations_closed_at_idx on public.organization_invitations ((coalesce(accepted_at, expires_at)));
create index worker_documents_deleted_at_idx on public.worker_documents (deleted_at) where deleted_at is not null;
create index profiles_worker_created_at_idx on public.profiles (created_at)
  where account_kind = 'worker' and deleted_at is null and not legal_hold;

create function private.record_retention(p_entity text, p_days integer, p_removed bigint) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform audit.record('retention.run', 'retention_policies', p_entity, jsonb_build_object('days', p_days, 'removed', p_removed));
end;
$$;

revoke all on function private.record_retention(text, integer, bigint) from public, anon, authenticated, service_role;

-- A deletion request on behalf of the retention rule, at most 1000 accounts a run (the next run takes the rest): the
-- request of request_account_deletion without its email, whose text says the candidate asked. The audit row names the
-- reason; the candidate sees the request on the settings page and can cancel it during the cooling-off period.
create function private.request_inactive_erasures(p_days integer) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_days);
  v_id uuid;
  v_requested bigint := 0;
begin
  for v_id in
    select p.id
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.account_kind = 'worker' and p.deleted_at is null and not p.legal_hold
      and p.created_at < v_cutoff
      and coalesce(u.last_sign_in_at, u.created_at) < v_cutoff
      and not exists (
        select 1 from auth.sessions s
        where s.user_id = p.id and (s.updated_at >= v_cutoff or s.refreshed_at >= v_cutoff at time zone 'UTC')
      )
      and not exists (select 1 from public.job_applications a where a.worker_user_id = p.id and a.created_at >= v_cutoff)
      and not exists (
        select 1 from public.job_applications a join public.application_events e on e.application_id = a.id
        where a.worker_user_id = p.id and e.created_at >= v_cutoff
      )
      and not exists (select 1 from public.platform_staff s where s.user_id = p.id and s.revoked_at is null)
    order by p.created_at
    limit 1000
    for no key update of p skip locked
  loop
    update public.profiles set deleted_at = now() where id = v_id;
    perform audit.record('account.deletion_requested', 'profile', v_id::text, jsonb_build_object('reason', 'inactivity', 'days', p_days));
    v_requested := v_requested + 1;
  end loop;
  return v_requested;
end;
$$;

revoke all on function private.request_inactive_erasures(integer) from public, anon, authenticated, service_role;

-- private.apply_retention of 20261103120000 with the entities above added. Every rule is optional (a missing row skips
-- it), idempotent, and audited with its period and count.
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

  select p.days into v_days from private.retention_policies p where p.entity = 'inactive_worker_data';
  if found then
    perform private.record_retention('inactive_worker_data', v_days, private.request_inactive_erasures(v_days));
  end if;
end;
$$;
