-- Retention, erasure and export of messaging and Find Workers (FR-P3 AC9, AC10; FR-S3 AC1, AC2, AC4 to AC7, AC9; SOP
-- P2-28 step Retain and P2-43 steps Apply, Erase, Export, Check; decision 5.4; NFR-C5, NFR-O5, NFR-S8; DATA_MODEL.md
-- section 10; release 2c). V19 seeded the periods of conversations (730 days after the last message, the agreed period)
-- and contact requests (365); this migration applies them and closes what V63, V66, V68, V69 and V70 left to it:
-- - private.apply_retention deletes the conversations whose last message is older than conversations, with their
--   participants, messages, read rows and block, unless a message of the conversation is under a report that is new or
--   in review; the contact requests answered, withdrawn or expired (pending ones from their sending) longer than
--   contact_requests ago, an accepted one only once its conversation is gone; declined requests after
--   contact_request_declines (90), never before the decline block of FR-Q3 ends; and the saved Find Workers cards that
--   have not been listed for saved_worker_cards (365) days. Neither request period goes below the block settings of V70,
--   so a shortened period never lets an organisation ask again early. The Find Workers search log keeps its 90 days (V69).
-- - A deleted message or contact request named by a moderation decision leaves its tombstone (V58), so the decision and
--   its appeal stay listed.
-- - erase_user deletes the worker's contact requests and the messages the worker sent, and replaces the worker's
--   participant rows by the pseudonym (DATA_MODEL.md section 10), so the conversation stays with the company, closed for
--   messages. A company member's messages stay with the organisation: the profile's deletion clears sender_user_id and
--   list_messages labels them as from a former member (V63).
-- - account_ops_export_data writes conversations.json, messages.json (the messages the user sent) and
--   contact_requests.json, and passport.json gains the worker's Find Workers choices.

update private.retention_policies p
set description = v.description
from (values
  ('conversations',
   'Days a conversation, with its messages, is kept after its last message (24 months, decision 5.4). A conversation with a message under an open report waits for the report.'),
  ('contact_requests',
   'Days a contact request is kept after it was accepted, withdrawn or expired, or after it was sent while it is pending. An accepted request stays while its conversation does. Never less than the days in which the company may not ask again.')
) as v (entity, description)
where p.entity = v.entity;

insert into private.retention_policies (entity, days, label, description) values
  ('contact_request_declines', 90, 'Declined contact requests',
   'Days a declined contact request is kept after the worker''s answer. Never less than the days in which the company may not ask again.'),
  ('saved_worker_cards', 365, 'Saved Find Workers cards',
   'Days a card an organisation saved is kept once the worker no longer shows it in Find Workers, counted from the saving or from the worker hiding the card, whichever is later.');

-- The worker's participant row is pseudonymised at erasure rather than deleted with the profile, as the worker ids of
-- job_applications and passport_shares; nothing else writes the column, and the conversation's own delete takes the row.
alter table public.conversation_participants drop constraint conversation_participants_user_id_fkey;

comment on column public.conversation_participants.user_id is
  'The candidate''s account, or after its erasure the pseudonym of private.erasure_pseudonym (no foreign key). Not readable through the Data API.';

-- Moderated messages and contact requests that no longer exist ----------------------------------------------------------------

alter table private.moderated_item_tombstones drop constraint moderated_item_tombstones_target_type_check;
alter table private.moderated_item_tombstones add constraint moderated_item_tombstones_target_type_check
  check (target_type in ('requirement', 'partner_response', 'candidate_submission', 'message', 'contact_request'));

-- private.keep_moderated_item of 20270112100000_network_retention_submissions.sql with messages and contact requests: a
-- message's organisation is the side that sent it, so a candidate's message (no organisation, no appeal) keeps nothing.
-- The title is what private.moderated_item answers for the item, as for the job order network.
create or replace function private.keep_moderated_item() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := case tg_table_name
    when 'workforce_requirements' then 'requirement'
    when 'partner_responses' then 'partner_response'
    when 'candidate_submissions' then 'candidate_submission'
    when 'messages' then 'message'
    else 'contact_request'
  end;
  v_org uuid;
begin
  if exists (select 1 from public.moderation_actions a where a.target_type = v_type and a.target_id = old.id) then
    v_org := (to_jsonb(old) ->> case when v_type = 'message' then 'sender_organization_id' else 'organization_id' end)::uuid;
    if exists (select 1 from public.organizations o where o.id = v_org) then
      insert into private.moderated_item_tombstones (target_type, target_id, organization_id, title)
      values (v_type, old.id, v_org, (select i.title from private.moderated_item(v_type, old.id) i))
      on conflict do nothing;
    end if;
  end if;
  return old;
end;
$$;

revoke all on function private.keep_moderated_item() from public, anon, authenticated, service_role;

create trigger messages_keep_moderated
  before delete on public.messages
  for each row execute function private.keep_moderated_item();
create trigger contact_requests_keep_moderated
  before delete on public.contact_requests
  for each row execute function private.keep_moderated_item();

alter table public.messages enable always trigger messages_keep_moderated;
alter table public.contact_requests enable always trigger contact_requests_keep_moderated;

-- Retention ----------------------------------------------------------------------------------------------------------------

-- private.apply_retention of 20270209100000_find_workers_search.sql with the rules of messaging and Find Workers added
-- before the inactive accounts: conversations first, so an accepted contact request whose conversation goes in the same run
-- goes with it.
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
  v_floor integer;
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

  select p.days into v_days from private.retention_policies p where p.entity = 'worker_search_log';
  if found then
    delete from private.worker_search_log s where s.created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('worker_search_log', v_days, v_removed);
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

  select p.days into v_days from private.retention_policies p where p.entity = 'conversations';
  if found then
    delete from public.conversations c
    where c.last_message_at < now() - make_interval(days => v_days)
      and not exists (
        select 1 from public.reports x join public.messages m on m.id = x.message_id
        where x.status in ('new', 'in_review') and m.conversation_id = c.id
      );
    get diagnostics v_removed = row_count;
    perform private.record_retention('conversations', v_days, v_removed);
  end if;

  -- An earlier request blocks the next one for contact_request_repeat_days, a decline for contact_request_decline_days
  -- (V70): the rows are kept at least that long whatever the period says.
  select p.days into v_days from private.retention_policies p where p.entity = 'contact_requests';
  if found then
    v_floor := greatest(v_days, coalesce((
      select case when s.value #>> '{}' ~ '^[0-9]{1,5}$' then (s.value #>> '{}')::integer end
      from private.settings s where s.key = 'contact_request_repeat_days'), 0));
    delete from public.contact_requests r
    where r.status <> 'declined'
      and coalesce(r.responded_at, r.withdrawn_at, case when r.status = 'expired' then r.expires_at end, r.created_at)
        < now() - make_interval(days => v_floor)
      and not (r.status = 'accepted'
               and exists (select 1 from public.conversations c where c.context_type = 'contact_request' and c.context_id = r.id));
    get diagnostics v_removed = row_count;
    perform private.record_retention('contact_requests', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'contact_request_declines';
  if found then
    v_floor := greatest(v_days, coalesce((
      select case when s.value #>> '{}' ~ '^[0-9]{1,5}$' then (s.value #>> '{}')::integer end
      from private.settings s where s.key = 'contact_request_decline_days'), 0));
    delete from public.contact_requests r
    where r.status = 'declined' and r.responded_at < now() - make_interval(days => v_floor);
    get diagnostics v_removed = row_count;
    perform private.record_retention('contact_request_declines', v_days, v_removed);
  end if;

  -- A saved card whose worker no longer shows it (hidden, suspended or closing): counted from the saving or from the
  -- worker's last withdrawal of the visibility consent, whichever is later.
  select p.days into v_days from private.retention_policies p where p.entity = 'saved_worker_cards';
  if found then
    delete from public.saved_worker_cards s
    using public.worker_profiles w
    where w.card_id = s.card_id
      and s.created_at < now() - make_interval(days => v_days)
      and not (w.searchable
               and exists (select 1 from public.profiles u where u.id = w.user_id and u.status = 'active' and u.deleted_at is null))
      and not exists (
        select 1 from public.consents c
        where c.user_id = w.user_id and c.purpose = 'worker-visibility-consent' and c.action = 'withdrawn'
          and c.created_at >= now() - make_interval(days => v_days)
      );
    get diagnostics v_removed = row_count;
    perform private.record_retention('saved_worker_cards', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'inactive_worker_data';
  if found then
    perform private.record_retention('inactive_worker_data', v_days, private.request_inactive_erasures(v_days));
  end if;
end;
$$;

revoke all on function private.apply_retention() from public, anon, authenticated, service_role;

-- Erasure ------------------------------------------------------------------------------------------------------------------

-- erase_user of 20270208200000_worker_visibility.sql with the worker's messaging and Find Workers data (FR-S3 AC5, AC6;
-- FR-P3 AC10 as DATA_MODEL.md section 10 decides it): the contact requests and the messages the worker sent are deleted
-- and the participant rows carry the pseudonym, before the profile goes; account.erased counts them.
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
  v_contact_requests bigint;
  v_messages bigint;
  v_participants bigint;
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
  delete from public.contact_requests where worker_user_id = p_user_id;
  get diagnostics v_contact_requests = row_count;
  delete from public.messages where sender_user_id = p_user_id and sender_organization_id is null;
  get diagnostics v_messages = row_count;
  update public.conversation_participants set user_id = v_pseudonym where user_id = p_user_id;
  get diagnostics v_participants = row_count;
  update public.passport_shares
  set worker_user_id = v_pseudonym, scope = '[]', revoked_at = coalesce(revoked_at, now())
  where worker_user_id = p_user_id;
  update public.job_applications a
  set worker_user_id = v_pseudonym, cover_note = null,
      profile_snapshot = a.profile_snapshot - 'first_name' - 'last_name' - 'headline'
  where a.worker_user_id = p_user_id;
  update public.application_events set actor_id = v_pseudonym where actor_id = p_user_id;
  perform private.hide_worker_card(p_user_id, 'erased');
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
      'deleted', jsonb_build_object('candidate_submissions', v_submissions, 'submission_passport_shares', v_shares,
        'contact_requests', v_contact_requests, 'messages', v_messages),
      'pseudonymised', jsonb_build_object('conversation_participants', v_participants))
  );
  -- The auth user is deleted next, so the address travels in the message; notify deletes it after sending.
  if v_email is not null then
    perform pgmq.send('notifications', jsonb_build_object('kind', 'deletion_completed', 'email', v_email, 'mandatory', true));
  end if;
  return true;
end;
$$;

-- Export -------------------------------------------------------------------------------------------------------------------

-- account_ops_export_data of 20270201100000_passport_extensions.sql (V58's sections and V61's passport lists) with three
-- sections (FR-S3 AC7): conversations (the candidate's own, and those a member wrote in for an organisation, each with the
-- other party as conversation_labels names it to that side, never a candidate to a member), messages (the messages the
-- user sent) and contact_requests (those the worker received, and those a member sent, never the worker); the passport
-- gains the worker's Find Workers choices (find_workers), whose consent history is in consents.json.
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
                                           from public.worker_work_authorizations a where a.worker_user_id = v_uid), '[]'),
          'training', coalesce((select jsonb_agg(jsonb_build_object('course', t.course, 'provider', t.provider, 'year_completed', t.year_completed)
                                                 order by t.year_completed desc, t.created_at, t.id)
                                from public.worker_training t where t.worker_user_id = v_uid), '[]'),
          'employment_history', coalesce((select jsonb_agg(jsonb_build_object(
                                            'role', h.role, 'employer_name', h.employer_name, 'country', h.country_code,
                                            'from_month', to_char(h.from_month, 'YYYY-MM'), 'to_month', to_char(h.to_month, 'YYYY-MM'))
                                            order by h.from_month desc, h.created_at, h.id)
                                          from public.worker_employment_history h where h.worker_user_id = v_uid), '[]'),
          'preferred_industries', coalesce((select jsonb_agg(i.name order by i.code)
                                            from public.worker_preferred_industries p join public.industries i on i.code = p.industry_code
                                            where p.worker_user_id = v_uid), '[]'),
          'preferred_employment_types', coalesce((select jsonb_agg(e.employment_type order by e.employment_type)
                                                  from public.worker_preferred_employment_types e where e.worker_user_id = v_uid), '[]'),
          'find_workers', jsonb_build_object(
            'visible', w.searchable, 'show_training', w.card_show_training,
            'show_employment_history', w.card_show_employment_history, 'show_industries', w.card_show_industries,
            'confirmation_requested_at', w.visibility_reminded_at))
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
      'conversations', coalesce((
        select jsonb_agg(x.item order by x.at, x.id)
        from (
          select c.created_at as at, c.id, jsonb_build_object(
            'conversation_id', c.id, 'side', 'candidate', 'context', c.context_type, 'with', l.counterpart_name,
            'about', l.context_title, 'opened_at', c.created_at, 'last_message_at', c.last_message_at) as item
          from public.conversation_participants p
          join public.conversations c on c.id = p.conversation_id
          cross join lateral private.conversation_labels(c, null) l
          where p.user_id = v_uid
          union all
          select c.created_at, c.id, jsonb_build_object(
            'conversation_id', c.id, 'side', 'organization', 'organization', o.display_name, 'context', c.context_type,
            'with', case when l.counterpart_kind = 'organization' then l.counterpart_name end,
            'about', l.context_title, 'opened_at', c.created_at, 'last_message_at', c.last_message_at)
          from (select distinct m.conversation_id, m.sender_organization_id from public.messages m
                where m.sender_user_id = v_uid and m.sender_organization_id is not null) s
          join public.conversations c on c.id = s.conversation_id
          join public.organizations o on o.id = s.sender_organization_id
          cross join lateral private.conversation_labels(c, s.sender_organization_id) l
        ) x), '[]'),
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'conversation_id', m.conversation_id, 'organization', o.display_name, 'kind', m.kind, 'text', m.body,
          'sent_at', m.created_at) order by m.created_at, m.id)
        from public.messages m left join public.organizations o on o.id = m.sender_organization_id
        where m.sender_user_id = v_uid), '[]'),
      'contact_requests', coalesce((
        select jsonb_agg(x.item order by x.at, x.id)
        from (
          select r.created_at as at, r.id, jsonb_build_object(
            'side', 'worker', 'organization', o.display_name, 'organization_type', o.type, 'based_in', o.based_in_country,
            'message', r.message, 'vacancy', j.title, 'destination', r.destination_country,
            'status', private.contact_request_status_now(r.status, r.expires_at), 'sent_at', r.created_at,
            'expires_at', r.expires_at, 'answered_at', r.responded_at, 'withdrawn_at', r.withdrawn_at) as item
          from public.contact_requests r
          join public.organizations o on o.id = r.organization_id
          left join public.jobs j on j.id = r.job_id
          where r.worker_user_id = v_uid
          union all
          select r.created_at, r.id, jsonb_build_object(
            'side', 'organization', 'organization', o.display_name, 'message', r.message, 'vacancy', j.title,
            'destination', r.destination_country, 'status', private.contact_request_status_now(r.status, r.expires_at),
            'sent_at', r.created_at, 'answered_at', r.responded_at, 'withdrawn_at', r.withdrawn_at)
          from public.contact_requests r
          join public.organizations o on o.id = r.organization_id
          left join public.jobs j on j.id = r.job_id
          where r.sent_by = v_uid
        ) x), '[]'),
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
