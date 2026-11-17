-- Retention, erasure and export of the job order network (FR-S3 AC3, AC5, AC7, AC9; SOP P2-43 steps Apply, Erase,
-- Export and Check; decision 6.3; NFR-O5; docs/phase-2/DATA_MODEL.md section 10; release 2b). V19 seeded the periods
-- (partner responses, candidate submissions and closed requirements 730 days each, editable in the retention editor);
-- this migration applies them, adds the job order metrics period and closes what V48, V50 and V57 left to it:
-- - private.apply_retention deletes, in this order, the candidate submissions (with their passport shares and history)
--   whose requirement was closed or filled longer than candidate_submissions ago, or that were withdrawn, declined or
--   expired that long ago; the partner responses (with their versions and supporting documents, whose files the delete
--   trigger of V45 queues for account-ops) whose requirement was closed or filled longer than partner_responses ago; and
--   the requirements closed or filled longer than closed_requirements ago, with whatever they still hold (invitations,
--   versions, reveals, suggestion and refusal records; vacancies copied from them lose the link only). An open
--   requirement is kept whatever its age. An item under a report that is still new or in review waits for the report
--   (FR-S3: not under an open report), and a requirement waits for the reports on its responses and submissions too.
-- - job_order_metrics (730 days): the weekly active partner record (stats.job_order_partner_weeks, V39) and the
--   eligibility refusals (stats.job_order_response_refusals, V44), counts without a user.
-- - When retention or erasure deletes a requirement, response or submission that a moderation decision names, the
--   decision must stay in the appeal lists (FR-S1; V57): private.moderated_item_tombstones keeps the organisation and the
--   title as it knew the item, and the appeal functions read it where the item is gone (the decision is then no longer
--   in effect, so it cannot be appealed, and a restore records target_deleted).
-- - erase_user deletes the candidate's submissions, their passport shares (on delete cascade) and their history, and the
--   requests still waiting for the candidate's address; the audit row counts them (FR-S3 AC5; DATA_MODEL.md section 10).
-- - account_ops_export_data adds the candidate's submissions to submissions.json (FR-S3 AC7) and, for a company member,
--   the requirements, responses and candidate requests the member wrote for the company.
-- Saved searches (V53) keep no period, as DATA_MODEL.md says: organisation data kept until a member deletes the search.

update private.retention_policies p
set description = v.description
from (values
  ('partner_responses',
   'Days a partner response, with its versions and supporting documents, is kept after its requirement was closed or filled.'),
  ('candidate_submissions',
   'Days a candidate submission, with its passport share and history, is kept after its requirement was closed or filled, or after it was withdrawn, declined or expired.'),
  ('closed_requirements',
   'Days a workforce requirement, with its invitations, responses and submissions, is kept after it was closed or filled.')
) as v (entity, description)
where p.entity = v.entity;

insert into private.retention_policies (entity, days, label, description) values
  ('job_order_metrics', 730, 'Job order statistics',
   'Days the weekly record of partners using the job orders and of refused responses (counts per company; nothing personal) is kept.');

-- The rows each rule looks for, in their time order.
create index workforce_requirements_ended_idx on public.workforce_requirements (status_changed_at)
  where status in ('closed', 'filled');
create index candidate_submissions_requirement_idx on public.candidate_submissions (requirement_id);
create index candidate_submissions_withdrawn_idx on public.candidate_submissions (withdrawn_at) where status = 'withdrawn';
create index candidate_submissions_unanswered_idx on public.candidate_submissions (decided_at)
  where status in ('declined_by_candidate', 'expired');
create index job_order_partner_weeks_week_idx on stats.job_order_partner_weeks (week_start);
create index job_order_response_refusals_last_seen_idx on stats.job_order_response_refusals (last_seen_at);

-- Moderated items that no longer exist -------------------------------------------------------------------------------------

-- The organisation of a deleted requirement, response or submission that a moderation decision names, and its title as
-- that organisation knew it, so that the decision and its appeal stay listed. No user, no content beyond the title.
create table private.moderated_item_tombstones (
  target_type text not null check (target_type in ('requirement', 'partner_response', 'candidate_submission')),
  target_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text,
  deleted_at timestamptz not null default now(),
  primary key (target_type, target_id)
);

comment on table private.moderated_item_tombstones is
  'A deleted requirement, partner response or candidate submission named by a moderation decision: its organisation and title, read by the appeal functions (FR-S1, V58). Written by the delete trigger private.keep_moderated_item; no API role reads it.';

create index moderated_item_tombstones_organization_idx on private.moderated_item_tombstones (organization_id);

alter table private.moderated_item_tombstones enable row level security;
alter table private.moderated_item_tombstones force row level security;
revoke all on table private.moderated_item_tombstones from public, anon, authenticated, service_role;

-- Before the row goes: a decision on it keeps its organisation and title. Inside the cascade of an organisation's own
-- deletion the organisation is no longer visible and nothing is kept (the decisions' appeals go with it).
create function private.keep_moderated_item() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := case tg_table_name
    when 'workforce_requirements' then 'requirement'
    when 'partner_responses' then 'partner_response'
    else 'candidate_submission'
  end;
begin
  if exists (select 1 from public.moderation_actions a where a.target_type = v_type and a.target_id = old.id)
     and exists (select 1 from public.organizations o where o.id = old.organization_id) then
    insert into private.moderated_item_tombstones (target_type, target_id, organization_id, title)
    values (v_type, old.id, old.organization_id, (select i.title from private.moderated_item(v_type, old.id) i))
    on conflict do nothing;
  end if;
  return old;
end;
$$;

revoke all on function private.keep_moderated_item() from public, anon, authenticated, service_role;

create trigger workforce_requirements_keep_moderated
  before delete on public.workforce_requirements
  for each row execute function private.keep_moderated_item();
create trigger partner_responses_keep_moderated
  before delete on public.partner_responses
  for each row execute function private.keep_moderated_item();
create trigger candidate_submissions_keep_moderated
  before delete on public.candidate_submissions
  for each row execute function private.keep_moderated_item();

alter table public.workforce_requirements enable always trigger workforce_requirements_keep_moderated;
alter table public.partner_responses enable always trigger partner_responses_keep_moderated;
alter table public.candidate_submissions enable always trigger candidate_submissions_keep_moderated;

-- The organisation and title of a moderated item, present (private.moderated_item) or deleted (its tombstone).
create function private.moderated_item_owner(p_type text, p_id uuid) returns table (
  organization_id uuid,
  title text,
  present boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.organization_id, i.title, true from private.moderated_item(p_type, p_id) i
  union all
  select t.organization_id, t.title, false from private.moderated_item_tombstones t
  where t.target_type = p_type and t.target_id = p_id
$$;

revoke all on function private.moderated_item_owner(text, uuid) from public, anon, authenticated, service_role;

-- Retention ----------------------------------------------------------------------------------------------------------------

-- private.apply_retention of 20261210100100 with the rules of the job order network added before the inactive accounts.
create or replace function private.apply_retention() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_removed bigint;
  v_file record;
  v_req_days integer;
  v_requirements uuid[] := '{}'::uuid[];
  v_more bigint;
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

  -- The job order network. The submissions and responses of an ended requirement go before it, so that a decision on one
  -- of them keeps its title (private.keep_moderated_item); an item under a report that is not closed waits for it.
  select p.days into v_req_days from private.retention_policies p where p.entity = 'closed_requirements';
  if v_req_days is not null then
    select coalesce(array_agg(r.id), '{}') into v_requirements
    from public.workforce_requirements r
    where r.status in ('closed', 'filled') and r.status_changed_at < now() - make_interval(days => v_req_days)
      and not exists (
        select 1 from public.reports x
        where x.status in ('new', 'in_review')
          and (x.requirement_id = r.id
            or x.partner_response_id in (select pr.id from public.partner_responses pr where pr.requirement_id = r.id)
            or x.candidate_submission_id in (select cs.id from public.candidate_submissions cs where cs.requirement_id = r.id))
      );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'candidate_submissions';
  if found then
    delete from public.candidate_submissions s
    where (s.requirement_id = any (v_requirements)
        or (s.status = 'withdrawn' and s.withdrawn_at < now() - make_interval(days => v_days))
        or (s.status in ('declined_by_candidate', 'expired') and s.decided_at < now() - make_interval(days => v_days))
        or exists (select 1 from public.workforce_requirements r
                   where r.id = s.requirement_id and r.status in ('closed', 'filled')
                     and r.status_changed_at < now() - make_interval(days => v_days)))
      and not exists (select 1 from public.reports x
                      where x.candidate_submission_id = s.id and x.status in ('new', 'in_review'));
    get diagnostics v_removed = row_count;
    perform private.record_retention('candidate_submissions', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'partner_responses';
  if found then
    delete from public.partner_responses pr
    where (pr.requirement_id = any (v_requirements)
        or exists (select 1 from public.workforce_requirements r
                   where r.id = pr.requirement_id and r.status in ('closed', 'filled')
                     and r.status_changed_at < now() - make_interval(days => v_days)))
      and not exists (select 1 from public.reports x
                      where x.partner_response_id = pr.id and x.status in ('new', 'in_review'));
    get diagnostics v_removed = row_count;
    perform private.record_retention('partner_responses', v_days, v_removed);
  end if;

  if v_req_days is not null then
    delete from public.workforce_requirements r where r.id = any (v_requirements);
    get diagnostics v_removed = row_count;
    perform private.record_retention('closed_requirements', v_req_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'job_order_metrics';
  if found then
    delete from stats.job_order_partner_weeks w where w.week_start < (now() at time zone 'utc')::date - v_days;
    get diagnostics v_removed = row_count;
    delete from stats.job_order_response_refusals f where f.last_seen_at < now() - make_interval(days => v_days);
    get diagnostics v_more = row_count;
    perform private.record_retention('job_order_metrics', v_days, v_removed + v_more);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'inactive_worker_data';
  if found then
    perform private.record_retention('inactive_worker_data', v_days, private.request_inactive_erasures(v_days));
  end if;
end;
$$;


revoke all on function private.apply_retention() from public, anon, authenticated, service_role;


-- Erasure --------------------------------------------------------------------------------------------------------------------

-- erase_user of 20261110110000 with the candidate's submissions deleted before the shares are pseudonymised, and their
-- counts in the audit row. Everything else is unchanged.

create or replace function public.erase_user(p_user_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.account_kind;
  v_requested timestamptz;
  v_hold boolean;
  v_email text;
  v_pseudonym uuid := gen_random_uuid();
  v_subject text := p_user_id::text;
  v_submissions bigint;
  v_shares bigint;
begin
  select p.account_kind, p.deleted_at, p.legal_hold into v_kind, v_requested, v_hold
  from public.profiles p where p.id = p_user_id for no key update;
  if not found then
    return false;
  end if;
  if v_kind is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required';
  end if;
  if v_requested is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'deletion_not_requested';
  end if;
  if now() < private.cooling_off_ends_at(v_requested) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'cooling_off_not_ended';
  end if;
  if v_hold then
    raise exception 'CHARA_FORBIDDEN' using detail = 'legal_hold';
  end if;
  if exists (select 1 from public.platform_staff s where s.user_id = p_user_id and s.revoked_at is null) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'platform_staff';
  end if;

  select u.email into v_email from auth.users u where u.id = p_user_id;
  perform set_config('chara.erasure_user', v_subject, true);
  perform set_config('chara.erasure_pseudonym', v_pseudonym::text, true);

  delete from public.application_notes n using public.job_applications a
  where a.id = n.application_id and a.worker_user_id = p_user_id;
  -- The submissions go with their shares (on delete cascade) and history; so do the requests that still wait for the
  -- address, whose partner never learns whether an account had it.
  with gone as (
    delete from public.candidate_submissions s
    where s.worker_user_id = p_user_id or (s.worker_user_id is null and s.invited_email = lower(v_email))
    returning s.passport_share_id
  )
  select count(*), count(gone.passport_share_id) into v_submissions, v_shares from gone;
  update public.passport_shares
  set worker_user_id = v_pseudonym, scope = '[]', revoked_at = coalesce(revoked_at, now())
  where worker_user_id = p_user_id;
  update public.job_applications a
  set worker_user_id = v_pseudonym, cover_note = null,
      profile_snapshot = a.profile_snapshot - 'first_name' - 'last_name' - 'headline'
  where a.worker_user_id = p_user_id;
  update public.application_events set actor_id = v_pseudonym where actor_id = p_user_id;
  update public.consents set user_id = v_pseudonym where user_id = p_user_id;
  update public.reports
  set reporter_user_id = case when reporter_user_id = p_user_id then v_pseudonym else reporter_user_id end,
      reporter_email = null
  where reporter_user_id = p_user_id or reporter_email = lower(v_email);
  update audit.document_access_log
  set worker_user_id = v_pseudonym, accessed_by = case when accessed_by = p_user_id then v_pseudonym else accessed_by end
  where worker_user_id = p_user_id;
  update audit.log
  set actor_id = case when actor_id = p_user_id then v_pseudonym else actor_id end,
      entity_id = case when entity_id = v_subject then v_pseudonym::text else entity_id end,
      ip = case when actor_id = p_user_id then null else ip end,
      metadata = replace(metadata::text, v_subject, v_pseudonym::text)::jsonb
  where actor_id = p_user_id or entity_id = v_subject
     or (entity_type = 'platform_staff'
         and entity_id = any (array(select s.id::text from public.platform_staff s where s.user_id = p_user_id)));

  delete from public.worker_documents where worker_user_id = p_user_id;
  delete from public.worker_profiles where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;
  perform pgmq.delete('notifications', array(select n.msg_id from public.notifications n where n.user_id = p_user_id and n.msg_id is not null));
  delete from pgmq.a_notifications a where a.msg_id = any (array(select n.msg_id from public.notifications n where n.user_id = p_user_id and n.msg_id is not null));
  delete from public.notifications where user_id = p_user_id;
  delete from public.notification_preferences where user_id = p_user_id;
  delete from pgmq.a_account_ops a where a.message ->> 'user_id' = v_subject;

  perform set_config('chara.erasure_user', '', true);
  perform set_config('chara.erasure_pseudonym', '', true);

  perform audit.record(
    'account.erased', 'profile', v_pseudonym::text,
    jsonb_build_object('requested_at', v_requested, 'completed_at', now(),
      'deleted', jsonb_build_object('candidate_submissions', v_submissions, 'submission_passport_shares', v_shares))
  );
  -- The auth user is deleted next, so the address travels in the message; notify deletes it after sending.
  if v_email is not null then
    perform pgmq.send('notifications', jsonb_build_object('kind', 'deletion_completed', 'email', v_email, 'mandatory', true));
  end if;
  return true;
end;
$$;


revoke all on function public.erase_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.erase_user(uuid) to service_role;


-- Export ---------------------------------------------------------------------------------------------------------------------

-- account_ops_export_data of 20261210100000 with three sections of the job order network:
--   submissions        the candidate's own submissions (side candidate: the job order as the candidate may read it, the
--                      partner, the status, the partner's note, the names of the shared documents, the dates and the
--                      history with the notes the candidate reads), and the candidate requests the member sent for a
--                      company (side partner: the company, the job order as the company knows it, the status and the
--                      dates; never the candidate's address, account or name)
--   requirements       the workforce requirements the member wrote, with the company
--   partner_responses  the responses the member sent for a company, with the job order as the company knows it
-- Everything else is unchanged.

create or replace function public.account_ops_export_data(p_export uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  select r.user_id into v_uid from public.data_export_requests r where r.id = p_export and r.status = 'queued';
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'user_id', v_uid,
    'sections', jsonb_build_object(
      'account', (
        select jsonb_build_object(
          'user_id', p.id, 'email', u.email, 'display_name', p.display_name, 'account_kind', p.account_kind,
          'preferred_language', p.preferred_lang, 'status', p.status, 'created_at', p.created_at,
          'deletion_requested_at', p.deleted_at, 'last_sign_in_at', u.last_sign_in_at)
        from public.profiles p left join auth.users u on u.id = p.id
        where p.id = v_uid),
      'passport', (
        select jsonb_build_object(
          'first_name', w.first_name, 'last_name', w.last_name, 'headline', w.headline,
          'current_country', w.current_country, 'occupation', o.label, 'years_experience', w.years_experience,
          'availability', w.availability, 'available_from', w.available_from, 'searchable', w.searchable,
          'created_at', w.created_at,
          'skills', coalesce((select jsonb_agg(s.skill order by s.skill) from public.worker_skills s where s.worker_user_id = v_uid), '[]'),
          'languages', coalesce((select jsonb_agg(jsonb_build_object('language', l.language_code, 'level', l.cefr_level) order by l.language_code)
                                 from public.worker_languages l where l.worker_user_id = v_uid), '[]'),
          'preferred_countries', coalesce((select jsonb_agg(c.country_code order by c.country_code)
                                           from public.worker_preferred_countries c where c.worker_user_id = v_uid), '[]'),
          'work_authorizations', coalesce((select jsonb_agg(jsonb_build_object('country', a.country_code, 'expires_on', a.expires_on) order by a.country_code)
                                           from public.worker_work_authorizations a where a.worker_user_id = v_uid), '[]'))
        from public.worker_profiles w left join public.occupations o on o.code = w.occupation_id
        where w.user_id = v_uid),
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'title', d.title, 'type', d.type, 'file_name', d.file_name, 'mime', d.mime, 'size_bytes', d.size_bytes,
          'expires_on', d.expires_on, 'uploaded_at', d.created_at,
          'file', case when d.scan_status in ('clean', 'skipped') then 'documents/' || d.id::text || '/' || d.file_name end)
          || case when d.scan_status in ('clean', 'skipped') then '{}'::jsonb
               else jsonb_build_object('note', 'Not included because the file has not passed its check.') end
          order by d.created_at, d.id)
        from public.worker_documents d where d.worker_user_id = v_uid and d.deleted_at is null), '[]'),
      'applications', coalesce((
        select jsonb_agg(jsonb_build_object(
          'vacancy', j.title, 'employer', o.display_name, 'status', a.status, 'cover_note', a.cover_note,
          'applied_at', a.created_at,
          'history', coalesce((select jsonb_agg(jsonb_build_object('from', e.from_status, 'to', e.to_status, 'at', e.created_at) order by e.created_at, e.id)
                               from public.application_events e where e.application_id = a.id), '[]')) order by a.created_at, a.id)
        from public.job_applications a
        join public.jobs j on j.id = a.job_id
        join public.organizations o on o.id = a.organization_id
        where a.worker_user_id = v_uid), '[]'),
      'passport_shares', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name, 'shared_at', s.created_at, 'expires_at', s.expires_at, 'revoked_at', s.revoked_at,
          'scope', s.scope) order by s.created_at, s.id)
        from public.passport_shares s join public.organizations o on o.id = s.organization_id
        where s.worker_user_id = v_uid), '[]'),
      'document_access', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name, 'document', d.title, 'purpose', l.purpose, 'accessed_at', l.accessed_at)
          order by l.accessed_at, l.id)
        from audit.document_access_log l
        left join public.organizations o on o.id = l.organization_id
        left join public.worker_documents d on d.id = l.document_id
        where l.worker_user_id = v_uid and l.organization_id is not null), '[]'),
      'saved_vacancies', coalesce((
        select jsonb_agg(jsonb_build_object('vacancy', j.title, 'employer', o.display_name, 'saved_at', s.created_at)
          order by s.created_at, s.job_id)
        from public.saved_jobs s
        join public.jobs j on j.id = s.job_id
        join public.organizations o on o.id = j.organization_id
        where s.worker_user_id = v_uid), '[]'),
      'followed_companies', coalesce((
        select jsonb_agg(jsonb_build_object('company', o.display_name, 'followed_at', f.created_at)
          order by f.created_at, f.organization_id)
        from public.follows f join public.organizations o on o.id = f.organization_id
        where f.user_id = v_uid), '[]'),
      'consents', coalesce((
        select jsonb_agg(jsonb_build_object('purpose', c.purpose, 'version', c.version, 'action', c.action, 'at', c.created_at)
          order by c.created_at, c.id)
        from public.consents c where c.user_id = v_uid), '[]'),
      'notifications', coalesce((
        select jsonb_agg(jsonb_build_object('kind', n.kind, 'created_at', n.created_at, 'emailed_at', n.sent_at, 'read_at', n.read_at)
          order by n.created_at, n.id)
        from public.notifications n where n.user_id = v_uid), '[]'),
      'notification_preferences', (
        select jsonb_build_object('application_digest', np.digest, 'email_kinds', np.email_kinds)
        from public.notification_preferences np where np.user_id = v_uid),
      'organization_memberships', coalesce((
        select jsonb_agg(jsonb_build_object('organization', o.display_name, 'role', m.role, 'accepted_at', m.accepted_at)
          order by o.display_name)
        from public.organization_members m join public.organizations o on o.id = m.organization_id
        where m.user_id = v_uid), '[]'),
      'organization_invitations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name, 'role', i.role, 'invited_at', i.created_at, 'expires_at', i.expires_at,
          'accepted_at', i.accepted_at) order by i.created_at, i.id)
        from public.organization_invitations i
        join public.organizations o on o.id = i.organization_id
        join auth.users u on u.id = v_uid
        where lower(i.email::text) = lower(u.email)), '[]'),
      'ownership_transfers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name, 'direction', case when t.from_user_id = v_uid then 'given' else 'received' end,
          'created_at', t.created_at, 'accepted_at', t.accepted_at, 'cancelled_at', t.cancelled_at) order by t.created_at, t.id)
        from public.organization_ownership_transfers t join public.organizations o on o.id = t.organization_id
        where t.from_user_id = v_uid or t.to_user_id = v_uid), '[]'),
      'reports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'reference', private.report_reference(r.id), 'about', r.target_type, 'category', r.category, 'details', r.details,
          'status', r.status, 'reported_at', r.created_at, 'closed_at', r.handled_at) order by r.created_at, r.id)
        from public.reports r where r.reporter_user_id = v_uid), '[]'),
      'appeals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name, 'grounds', a.grounds, 'status', a.status, 'reasons', a.reasons,
          'lodged_at', a.lodged_at, 'decided_at', a.decided_at) order by a.lodged_at, a.id)
        from public.appeals a join public.organizations o on o.id = a.organization_id
        where a.appellant_user_id = v_uid), '[]'),
      'platform_roles', coalesce((
        select jsonb_agg(jsonb_build_object('role', s.role, 'granted_at', s.granted_at, 'revoked_at', s.revoked_at)
          order by s.granted_at, s.id)
        from public.platform_staff s where s.user_id = v_uid), '[]'),
      'activity', coalesce((
        select jsonb_agg(jsonb_build_object('action', l.action, 'about', l.entity_type, 'at', l.created_at, 'ip', host(l.ip))
          order by l.created_at, l.id)
        from audit.log l where l.actor_id = v_uid), '[]'),
      'submissions', coalesce((
        select jsonb_agg(x.item order by x.at, x.id)
        from (
          select s.created_at as at, s.id, jsonb_build_object(
            'side', 'candidate', 'job_order', private.submission_candidate_title(r), 'destination', r.country_code,
            'partner', o.display_name, 'status', s.status, 'partner_note', s.note, 'requested_at', s.created_at,
            'answered_at', s.decided_at, 'approved_at', s.worker_approved_at, 'withdrawn_at', s.withdrawn_at,
            'shared_documents', coalesce((
              select jsonb_agg(d.title order by d.title)
              from public.passport_shares sh
              join public.worker_documents d on d.worker_user_id = v_uid and sh.scope ? d.id::text
              where sh.id = s.passport_share_id), '[]'),
            'history', coalesce((
              select jsonb_agg(jsonb_build_object('from', e.from_status, 'to', e.to_status, 'note', e.note, 'at', e.created_at)
                order by e.created_at, e.id)
              from public.submission_events e where e.submission_id = s.id), '[]')) as item
          from public.candidate_submissions s
          join public.workforce_requirements r on r.id = s.requirement_id
          join public.organizations o on o.id = s.organization_id
          where s.worker_user_id = v_uid
          union all
          select s.created_at, s.id, jsonb_build_object(
            'side', 'partner', 'organization', o.display_name,
            'job_order', case when private.requirement_named_to(r.id, s.organization_id) then r.title
                              else private.job_order_neutral_title(r.id) end,
            'status', s.status, 'sent_at', s.created_at, 'answered_at', s.decided_at, 'withdrawn_at', s.withdrawn_at)
          from public.candidate_submissions s
          join public.workforce_requirements r on r.id = s.requirement_id
          join public.organizations o on o.id = s.organization_id
          where s.submitted_by = v_uid
        ) x), '[]'),
      'requirements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name, 'title', r.title, 'destination', r.country_code,
          'workers_needed', r.workers_needed, 'status', r.status, 'created_at', r.created_at, 'published_at', r.published_at,
          'status_changed_at', r.status_changed_at) order by r.created_at, r.id)
        from public.workforce_requirements r join public.organizations o on o.id = r.organization_id
        where r.created_by = v_uid), '[]'),
      'partner_responses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization', o.display_name,
          'job_order', case when private.requirement_named_to(r.id, p.organization_id) then r.title
                            else private.job_order_neutral_title(r.id) end,
          'status', p.status, 'version', p.version, 'sent_at', p.created_at, 'decided_at', p.decided_at,
          'withdrawn_at', p.withdrawn_at) order by p.created_at, p.id)
        from public.partner_responses p
        join public.workforce_requirements r on r.id = p.requirement_id
        join public.organizations o on o.id = p.organization_id
        where p.created_by = v_uid), '[]'),
      'data_exports', coalesce((
        select jsonb_agg(jsonb_build_object('requested_at', r.requested_at, 'ready_at', r.ready_at, 'expires_at', r.expires_at)
          order by r.requested_at, r.id)
        from public.data_export_requests r where r.user_id = v_uid), '[]')
    ),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucket_id', d.bucket_id, 'path', d.storage_path, 'name', 'documents/' || d.id::text || '/' || d.file_name,
        'size_bytes', d.size_bytes) order by d.created_at, d.id)
      from public.worker_documents d
      where d.worker_user_id = v_uid and d.deleted_at is null and d.scan_status in ('clean', 'skipped')), '[]')
  );
end;
$$;


revoke all on function public.account_ops_export_data(uuid) from public, anon, authenticated, service_role;
grant execute on function public.account_ops_export_data(uuid) to service_role;


-- Appeals of decisions on deleted items --------------------------------------------------------------------------------------

-- private.appealable_decision of 20270111100100: a decision on a requirement, response or submission that retention or
-- erasure deleted keeps its organisation and title (private.moderated_item_owner) and is no longer in effect, so the
-- organisation still reads it and its appeal, and nothing is left to appeal or restore. Everything else is unchanged.

create or replace function private.appealable_decision(p_action bigint) returns table (
  moderation_action_id bigint,
  target_type text,
  target_id uuid,
  action text,
  organization_id uuid,
  title text,
  org_slug text,
  reasons text,
  actor_id uuid,
  decided_at timestamptz,
  in_effect boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.target_type, a.target_id, a.action, o.id,
    case when a.target_type = 'job' then j.title when i.organization_id is not null then i.title else o.display_name end,
    o.slug, a.statement_of_reasons, a.actor_id, a.created_at,
    not exists (
      select 1 from public.moderation_actions b
      where b.target_type = a.target_type and b.target_id = a.target_id and b.id > a.id
    ) and (a.target_type <> 'job' or j.deleted_at is null) and i.present is distinct from false
  from public.moderation_actions a
  left join public.jobs j on a.target_type = 'job' and j.id = a.target_id
  left join lateral private.moderated_item_owner(a.target_type, a.target_id) i on true
  join public.organizations o on o.id = case
    when a.target_type = 'job' then j.organization_id
    when a.target_type in ('requirement', 'partner_response', 'candidate_submission') then i.organization_id
    else a.target_id
  end
  where a.id = p_action and a.action in ('content_hidden', 'job_hidden', 'organization_suspended')
$$;


revoke all on function private.appealable_decision(bigint) from public, anon, authenticated, service_role;

-- decide_appeal of 20270111100100: a restore of a decision whose item retention or erasure deleted is recorded with
-- target_deleted, as for a deleted vacancy. Everything else is unchanged.

create or replace function public.decide_appeal(p_appeal bigint, p_outcome text, p_reasons text) returns table (status public.appeal_status, reversal_action_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reasons text;
  v_appeal public.appeals;
  v_decision record;
  v_status public.appeal_status;
  v_reversal bigint;
  v_deleted boolean;
  v_recipients uuid[];
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  v_reasons := private.statement_of_reasons(p_reasons);
  if p_outcome is null or p_outcome not in ('uphold', 'restore') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'outcome';
  end if;

  select * into v_appeal from public.appeals a where a.id = p_appeal for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_decision from private.appealable_decision(v_appeal.moderation_action_id);
  if v_decision.actor_id = v_uid then
    raise exception 'CHARA_FORBIDDEN' using detail = 'same_reviewer';
  end if;
  if private.is_own_organization(v_uid, v_appeal.organization_id) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'own_organization';
  end if;
  if v_appeal.status <> 'open' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_appeal.status::text;
  end if;

  v_status := (case when p_outcome = 'restore' then 'restored' else 'upheld' end)::public.appeal_status;
  if p_outcome = 'restore' and v_decision.in_effect then
    v_reversal := case v_decision.target_type
      when 'partner_profile' then private.set_partner_profile_moderation(v_decision.target_id, false, v_reasons, null, false)
      when 'job' then private.set_job_moderation(v_decision.target_id, false, v_reasons)
      when 'requirement' then private.set_item_moderation(v_decision.target_type, v_decision.target_id, false, v_reasons, null, false)
      when 'partner_response' then private.set_item_moderation(v_decision.target_type, v_decision.target_id, false, v_reasons, null, false)
      when 'candidate_submission' then private.set_item_moderation(v_decision.target_type, v_decision.target_id, false, v_reasons, null, false)
      else private.reinstate_organization_with(v_decision.target_id, v_reasons)
    end;
  end if;

  -- Why a restore undid nothing: the vacancy or the item was deleted, or a later decision had already replaced the
  -- appealed one.
  v_deleted := (v_decision.target_type = 'job'
      and exists (select 1 from public.jobs j where j.id = v_decision.target_id and j.deleted_at is not null))
    or exists (select 1 from private.moderated_item_tombstones t
               where t.target_type = v_decision.target_type and t.target_id = v_decision.target_id);

  update public.appeals
  set status = v_status, decided_by = v_uid, reasons = v_reasons, decided_at = now(), reversal_action_id = v_reversal
  where id = p_appeal;
  perform private.audit_admin('appeal.' || v_status::text, 'appeal', p_appeal::text, v_reasons, jsonb_strip_nulls(jsonb_build_object(
    'moderation_action_id', v_appeal.moderation_action_id, 'organization_id', v_appeal.organization_id,
    'target_type', v_decision.target_type, 'reversal_action_id', v_reversal,
    'target_deleted', case when p_outcome = 'restore' and not v_decision.in_effect and v_deleted then true end,
    'already_reversed', case when p_outcome = 'restore' and not v_decision.in_effect and not v_deleted then true end
  )));

  -- The outcome goes to the appellant while they are still an accepted member of the organisation; one who left (or whose
  -- account is gone) is replaced by the current owners and admins, so the organisation always learns the outcome.
  select case
    when exists (select 1 from public.organization_members m
                 where m.organization_id = v_appeal.organization_id and m.user_id = v_appeal.appellant_user_id
                   and m.accepted_at is not null) then array[v_appeal.appellant_user_id]
    else (select array_agg(m.user_id order by m.user_id) from public.organization_members m
          where m.organization_id = v_appeal.organization_id and m.role in ('owner', 'admin') and m.accepted_at is not null)
  end into v_recipients;
  perform pgmq.send('notifications', jsonb_strip_nulls(jsonb_build_object(
    'kind', 'moderation_decision', 'user_id', r.user_id, 'mandatory', true,
    'organization_id', v_appeal.organization_id, 'appeal_id', p_appeal, 'appeal_outcome', v_status,
    'target_type', v_decision.target_type, 'target_id', v_decision.target_id,
    'job_id', case when v_decision.target_type = 'job' then v_decision.target_id end,
    'title', case when v_decision.target_type in ('requirement', 'partner_response', 'candidate_submission') then v_decision.title end,
    'reasons', v_reasons, 'moderation_action_id', v_appeal.moderation_action_id
  )))
  from unnest(coalesce(v_recipients, '{}'::uuid[])) as r (user_id);

  status := v_status;
  reversal_action_id := v_reversal;
  return next;
end;
$$;


-- list_my_appeals of 20270111100100: the decisions on deleted items stay listed for their organisation. Everything else
-- is unchanged.

create or replace function public.list_my_appeals(p_action bigint default null::bigint, p_job uuid default null::uuid) returns table (moderation_action_id bigint, target_type text, target_id uuid, action text, title text, organization_id uuid, organization_name text, org_slug text, reasons text, decided_at timestamp with time zone, appeal_until timestamp with time zone, in_effect boolean, can_appeal boolean, appeal_id bigint, appeal_status public.appeal_status, grounds text, lodged_at timestamp with time zone, due_at timestamp with time zone, appeal_reasons text, appeal_decided_at timestamp with time zone, target_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_window integer := private.appeal_setting('appeal_window_months', 6);
  v_target integer := private.appeal_setting('appeal_decision_target_days', 7);
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;

  return query
  select
    d.moderation_action_id, d.target_type, d.target_id, d.action, d.title, d.organization_id, o.display_name, d.org_slug,
    d.reasons, d.decided_at, d.decided_at + make_interval(months => v_window), d.in_effect,
    m.role in ('owner', 'admin') and d.in_effect and ap.id is null and now() <= d.decided_at + make_interval(months => v_window),
    ap.id, ap.status, ap.grounds, ap.lodged_at, ap.due_at, ap.reasons, ap.decided_at, v_target
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  cross join lateral (
    select a.id from public.moderation_actions a
    where a.action in ('content_hidden', 'organization_suspended') and a.target_type in ('partner_profile', 'organization')
      and a.target_id = m.organization_id
      and (p_action is null or a.id = p_action) and p_job is null
    union all
    select a.id from public.moderation_actions a join public.jobs j on j.id = a.target_id
    where a.action = 'job_hidden' and j.organization_id = m.organization_id and (p_action is null or a.id = p_action)
      and (p_job is null or j.id = p_job)
    union all
    select a.id from public.moderation_actions a
    where a.action = 'content_hidden' and a.target_type in ('requirement', 'partner_response', 'candidate_submission')
      and (select i.organization_id from private.moderated_item_owner(a.target_type, a.target_id) i) = m.organization_id
      and (p_action is null or a.id = p_action) and p_job is null
  ) c
  cross join lateral private.appealable_decision(c.id) d
  left join public.appeals ap on ap.moderation_action_id = d.moderation_action_id
  where m.user_id = v_uid and m.accepted_at is not null
    and (ap.id is not null or now() <= d.decided_at + make_interval(months => v_window))
  order by d.moderation_action_id desc
  limit 100;
end;
$$;


