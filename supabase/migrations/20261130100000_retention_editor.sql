-- The retention editor and the Phase 2 retention periods (FR-S3, SOP P2-43; docs/phase-2/DATA_MODEL.md sections 4, 7
-- and 10; decision 5.4; NFR-O5; OPEN_QUESTIONS.md L6). The periods stay rows of private.retention_policies read by the
-- daily private.apply_retention; a Platform Administrator at aal2 now changes them in the console with a statement of
-- reasons (admin_set_retention_policy, audited as retention_policy.updated with the value before and after), within 1 to
-- 3,650 days. Two periods are changed by a reviewed migration only (editable false): the audit log, whose six years are
-- legal record keeping, and inactive candidate accounts, where a short period would put every candidate account up for
-- deletion at the next run. Like the plan and settings editor, the retention editor is not behind a release
-- switch: it governs Phase 1 data as much as Phase 2 data.
--
-- The Phase 2 periods are seeded now, as proposed in DATA_MODEL.md section 10 (only the message period is agreed, the
-- rest are defaults for CHARA to confirm): conversations 730 days after the last message, partner responses, candidate
-- submissions and closed requirements 730, contact requests 365, replaced licence evidence 30. The rules that delete
-- responses, submissions and requirements arrive with their tables in V58, conversations and contact requests in V74;
-- until then their rows are periods without a rule, which their descriptions say. Licence evidence is applied by the
-- next migration.

alter table private.retention_policies
  add column label text,
  add column description text,
  add column editable boolean not null default true,
  add constraint retention_policies_days_max check (days <= 3650);

update private.retention_policies p
set label = v.label, description = v.description, editable = v.editable
from (values
  ('document_access_log', 'Document access log', 'Days a record of who opened a candidate document is kept.', true),
  ('notifications', 'Notifications', 'Days a notification and its email record are kept after they were created.', true),
  ('billing_provider_events', 'Payment provider events', 'Days the messages received from the payment provider are kept.', true),
  ('security_events', 'Security events', 'Days a security event, such as a refused request, is kept.', true),
  ('audit_log', 'Audit log', 'Days an audit record is kept: six years of legal record keeping, changed by a reviewed migration only.', false),
  ('organization_invitations', 'Company invitations', 'Days an invitation is kept after it was accepted or expired.', true),
  ('deleted_worker_documents', 'Deleted candidate documents', 'Days the record of a document a candidate deleted is kept once its file is gone.', true),
  ('login_failures', 'Failed sign-in counters', 'Days a failed sign-in counter is kept after its last failure.', true),
  ('cron_job_run_details', 'Scheduler history', 'Days the history of the scheduled jobs is kept.', true),
  ('account_ops_archive', 'Failed account jobs', 'Days a failed account job is kept for review.', true),
  ('closed_reports', 'Closed reports', 'Days a report is kept after it was actioned or dismissed.', true),
  ('inactive_worker_data', 'Inactive candidate accounts', 'Days without activity after which a candidate account is put up for deletion: changed by a reviewed migration only.', false),
  ('saved_jobs', 'Saved vacancies', 'Days a saved vacancy is kept after the vacancy was closed, filled or deleted.', true)
) as v (entity, label, description, editable)
where p.entity = v.entity;

insert into private.retention_policies (entity, days, label, description) values
  ('conversations', 730, 'Conversations',
   'Days a conversation is kept after its last message. Applies with messaging (release 2c).'),
  ('partner_responses', 730, 'Partner responses',
   'Days a partner response is kept after its requirement was closed or filled. Applies with job orders (release 2b).'),
  ('candidate_submissions', 730, 'Candidate submissions',
   'Days a candidate submission is kept after its requirement was closed or filled, or after it was withdrawn. Applies with submissions (release 2b).'),
  ('closed_requirements', 730, 'Closed requirements',
   'Days a workforce requirement is kept after it was closed or filled. Applies with requirements (release 2b).'),
  ('contact_requests', 365, 'Contact requests',
   'Days a contact request is kept after it was decided, or after it was sent while it is pending. Applies with Find Workers (release 2c).'),
  ('licence_evidence', 30, 'Replaced licence evidence',
   'Days a licence evidence file is kept after it was replaced or its entry was removed.');

-- Every later row names itself for the editor.
alter table private.retention_policies
  alter column label set not null,
  alter column description set not null,
  add constraint retention_policies_label_check check (
    label = btrim(label) and char_length(label) between 1 and 80 and label !~ '[[:cntrl:]]'
  ),
  add constraint retention_policies_description_check check (
    description = btrim(description) and char_length(description) between 1 and 300 and description !~ '[[:cntrl:]]'
  );

comment on table private.retention_policies is
  'Retention periods in days, one row per entity, read by private.apply_retention (and the saved vacancies cleanup). Changed by a Platform Administrator through admin_set_retention_policy within 1 to 3,650 days; a row with editable false (audit_log, inactive_worker_data) only by a reviewed migration.';

-- The editor ------------------------------------------------------------------------------------------------------------

-- Every period with its label and description, editable ones first; the console shows the others read-only.
create function public.admin_list_retention_policies()
returns table (entity text, label text, description text, days integer, editable boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  return query
  select p.entity, p.label, p.description, p.days, p.editable
  from private.retention_policies p
  order by not p.editable, p.label;
end;
$$;

revoke all on function public.admin_list_retention_policies() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_retention_policies() to authenticated;

-- One period, 1 to 3,650 days, with a statement of reasons of 10 to 500 characters (FR-S3 AC1, AC10). Below one day the
-- table refuses it (23514); above 3,650 days or without a value it is CHARA_INVALID_INPUT detail days. An unknown or
-- migration-only entity is refused without saying which. The new period is read by the next daily run. Returns whether
-- the period changed; the same value writes nothing.
create function public.admin_set_retention_policy(p_entity text, p_days integer, p_reason text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_old integer;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  v_reason := private.plan_editor_reason(p_reason);
  perform set_config('chara.audit_reason', '', true);
  select p.days into v_old from private.retention_policies p where p.entity = p_entity and p.editable for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN' using detail = 'retention_not_editable';
  end if;
  if p_days is null or p_days > 3650 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'days';
  end if;
  if p_days = v_old then
    return false;
  end if;
  update private.retention_policies set days = p_days where entity = p_entity;
  perform private.audit_admin('retention_policy.updated', 'retention_policy', p_entity, v_reason,
    jsonb_build_object('before', v_old, 'after', p_days));
  return true;
end;
$$;

revoke all on function public.admin_set_retention_policy(text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_retention_policy(text, integer, text) to authenticated;
