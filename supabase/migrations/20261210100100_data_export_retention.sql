-- The retention of data exports (FR-S3 AC8 "the zip is deleted after 7 days", SOP P2-43 step Apply; DATA_MODEL.md
-- section 10: data exports 7 days, a proposal editable in the retention editor). The period is fixed on each request
-- when it becomes ready (expires_at), so a change applies to the exports made after it. Once expires_at has passed, the
-- request is deleted and the removal of its file from dsar-exports is queued for account-ops (delete_object, the job
-- of the candidate's own files); a request whose build never finished is deleted that many days after it was made.

insert into private.retention_policies (entity, days, label, description) values
  ('data_exports', 7, 'Data exports',
   'Days a copy of a user''s data stays downloadable after it is ready; the file and the request are then deleted.');

-- private.apply_retention of 20261209100100 with one rule added: data exports, by their expiry.
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

  select p.days into v_days from private.retention_policies p where p.entity = 'profile_view_events';
  if found then
    delete from private.profile_view_events e where e.viewed_on < (now() at time zone 'utc')::date - v_days;
    get diagnostics v_removed = row_count;
    perform private.record_retention('profile_view_events', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'org_analytics';
  if found then
    delete from private.org_analytics_daily d where d.day < (now() at time zone 'utc')::date - v_days;
    get diagnostics v_removed = row_count;
    perform private.record_retention('org_analytics', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'partner_searches';
  if found then
    delete from stats.partner_searches s where s.created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('partner_searches', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'closed_appeals';
  if found then
    -- The decision must also be older than the longest appeal window the settings editor allows (24 months), so that a
    -- shortened period never deletes an appeal whose decision could be appealed again once its row is gone.
    delete from public.appeals a
    where a.status <> 'open' and a.decided_at < now() - make_interval(days => v_days)
      and exists (select 1 from public.moderation_actions m
                  where m.id = a.moderation_action_id and m.created_at < now() - make_interval(months => 24));
    get diagnostics v_removed = row_count;
    perform private.record_retention('closed_appeals', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'data_exports';
  if found then
    v_removed := 0;
    for v_file in
      delete from public.data_export_requests r
      where (r.status = 'ready' and r.expires_at <= now())
         or (r.status = 'queued' and r.requested_at < now() - make_interval(days => v_days))
      returning r.user_id, r.storage_path
    loop
      if v_file.storage_path is not null then
        perform pgmq.send('account_ops', jsonb_build_object(
          'action', 'delete_object', 'user_id', v_file.user_id, 'bucket_id', 'dsar-exports', 'path', v_file.storage_path
        ));
      end if;
      v_removed := v_removed + 1;
    end loop;
    perform private.record_retention('data_exports', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'inactive_worker_data';
  if found then
    perform private.record_retention('inactive_worker_data', v_days, private.request_inactive_erasures(v_days));
  end if;
end;
$$;

revoke all on function private.apply_retention() from public, anon, authenticated, service_role;
