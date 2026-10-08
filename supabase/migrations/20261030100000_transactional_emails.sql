-- Transactional emails (FR-I2, FR-D6; ARCHITECTURE.md sections 4, 8; OPEN_QUESTIONS.md D52, D46). Every message that a
-- unit puts in the pgmq queue notifications becomes one notifications row in the same transaction, so a rolled-back
-- change leaves neither. The notify function reads the queue through notify_dequeue, sends, and records the result and
-- the delivery events of the provider through notify_ack; those two are the only database surface it has.
--
-- The message contract is the one the producers already follow: {kind, user_id, mandatory, ...ids}. The row keeps the
-- minimal payload built from it (private.notification_payload), never a document, note, address or token.

insert into private.settings (key, value) values
  ('notify_visibility_seconds', '120'),
  ('notify_max_reads', '8'),
  ('notify_retry_delays_seconds', '"2,6,18"'),
  ('notify_backlog_threshold', '500');

-- 13 months, as days (OPEN_QUESTIONS.md L6).
insert into private.retention_policies (entity, days) values ('notifications', 396);

create table public.notification_preferences (
  user_id uuid primary key,
  digest boolean not null default false,
  email_undeliverable_at timestamptz
);

alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;
revoke all on table public.notification_preferences from public, anon, authenticated, service_role;
grant select (user_id, digest, email_undeliverable_at) on public.notification_preferences to authenticated;

create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));

-- user_id is the person the email concerns and, for most kinds, the recipient; it is null only for the completion
-- notice of an erasure, whose address lives in the queue message alone until it is sent. There is no foreign key to the
-- profile because erase_user deletes these rows itself. status changes only through the notify RPCs.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  kind text not null check (kind in (
    'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
    'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused'
  )),
  channel text not null default 'email' check (channel = 'email'),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'suppressed')),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  msg_id bigint,
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text check (length(provider_message_id) between 1 and 200),
  last_error text check (length(last_error) <= 200),
  delivery text check (delivery in ('delivered', 'bounced_transient', 'bounced_permanent', 'complained')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check (user_id is not null or kind = 'deletion_completed')
);

comment on column public.notifications.msg_id is
  'The message in the pgmq queue notifications; null for an application_received held for the daily summary (FR-I3).';
comment on column public.notifications.last_error is
  'A short code of the last failure (for example resend_http_422), never the provider text, which can name the address.';

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create unique index notifications_msg_idx on public.notifications (msg_id) where msg_id is not null;
create unique index notifications_provider_message_idx on public.notifications (provider_message_id) where provider_message_id is not null;
create index notifications_created_idx on public.notifications (created_at);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;
revoke all on table public.notifications from public, anon, authenticated, service_role;
grant select (id, user_id, kind, payload, channel, status, sent_at, created_at) on public.notifications to authenticated;

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

-- What an email may carry, per kind, built from the queue message. Titles and slugs are looked up here so the producers
-- send ids only; anything else in the message is dropped.
create function private.notification_payload(p_kind text, p_message jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_title text;
  v_slug text;
begin
  if p_message ->> 'job_id' is not null then
    select j.id, j.title, o.slug into v_job_id, v_title, v_slug
    from public.jobs j join public.organizations o on o.id = j.organization_id
    where j.id = (p_message ->> 'job_id')::uuid;
  end if;
  if p_message ->> 'organization_id' is not null then
    select o.slug into v_slug from public.organizations o where o.id = (p_message ->> 'organization_id')::uuid;
  end if;

  return jsonb_strip_nulls(case p_kind
    when 'application_received' then jsonb_build_object(
      'application_id', p_message -> 'application_id', 'job_id', v_job_id, 'job_title', v_title, 'org_slug', v_slug)
    when 'status_changed' then jsonb_build_object(
      'application_id', p_message -> 'application_id', 'job_id', v_job_id, 'job_title', v_title,
      'status', p_message -> 'status')
    when 'vacancy_hidden' then jsonb_build_object(
      'job_id', v_job_id, 'job_title', v_title, 'org_slug', v_slug, 'reasons', p_message -> 'reasons')
    when 'trial_ending' then jsonb_build_object(
      'org_slug', v_slug, 'trial_ends_at', p_message -> 'trial_ends_at', 'plan_code', p_message -> 'plan_code',
      'amount_minor', p_message -> 'amount_minor', 'currency', p_message -> 'currency')
    when 'payment_failed' then jsonb_build_object('org_slug', v_slug)
    when 'legal_version' then jsonb_build_object(
      'document_slug', p_message -> 'document_slug', 'version', p_message -> 'version')
    when 'deletion_requested' then jsonb_build_object('erases_on', p_message -> 'erases_on')
    when 'erasure_paused' then jsonb_build_object('account_id', p_message -> 'user_id')
    else '{}'::jsonb
  end);
end;
$$;

revoke all on function private.notification_payload(text, jsonb) from public, anon, authenticated, service_role;

-- The preference applies to application_received only: a recipient of the daily summary gets the row but no message, and
-- the summary (FR-I3) sends the rows that wait. Every other kind is mandatory.
create function private.notification_enqueued() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := new.message ->> 'kind';
  v_user uuid := nullif(new.message ->> 'user_id', '')::uuid;
  v_digest boolean := v_kind = 'application_received'
    and coalesce((select p.digest from public.notification_preferences p where p.user_id = v_user), false);
begin
  insert into public.notifications (user_id, kind, payload, msg_id)
  values (v_user, v_kind, private.notification_payload(v_kind, new.message), case when v_digest then null else new.msg_id end);
  if v_digest then
    perform pgmq.delete('notifications', new.msg_id);
  end if;
  return null;
end;
$$;

revoke all on function private.notification_enqueued() from public, anon, authenticated, service_role;

create trigger notifications_enqueue after insert on pgmq.q_notifications
  for each row execute function private.notification_enqueued();

insert into public.notifications (user_id, kind, payload, msg_id)
select nullif(q.message ->> 'user_id', '')::uuid, q.message ->> 'kind', private.notification_payload(q.message ->> 'kind', q.message), q.msg_id
from pgmq.q_notifications q;

-- A change of the address clears the mark of the old one.
create function private.clear_email_undeliverable() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_preferences set email_undeliverable_at = null
  where user_id = new.id and email_undeliverable_at is not null;
  return null;
end;
$$;

revoke all on function private.clear_email_undeliverable() from public, anon, authenticated, service_role;

create trigger clear_email_undeliverable after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function private.clear_email_undeliverable();

-- A message that carries an address (the completion of an erasure, the pause notice to the privacy contact) is deleted
-- when it is finished, not archived, so the address does not outlive the send.
create function private.close_notification_message(p_msg_id bigint) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_msg_id is null then
    return;
  end if;
  if exists (select 1 from pgmq.q_notifications q where q.msg_id = p_msg_id and q.message ? 'email') then
    perform pgmq.delete('notifications', p_msg_id);
  else
    perform pgmq.archive('notifications', p_msg_id);
  end if;
end;
$$;

revoke all on function private.close_notification_message(bigint) from public, anon, authenticated, service_role;

-- Reads up to p_limit messages (1 to 100, 25 when missing), invisible for notify_visibility_seconds, and answers one
-- document: the messages to send, the queue depth and the two settings the function needs (backlog threshold and the
-- seconds between the attempts). A message whose row is no longer queued is archived and not returned; a recipient
-- marked undeliverable is recorded as suppressed; a message read more than notify_max_reads times (a crash loop) or
-- without an address is recorded as failed. Each of these leaves the queue.
create function public.notify_dequeue(p_limit integer default 25) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vt integer;
  v_max integer;
  v_delays text;
  v_threshold integer;
  v_msg pgmq.message_record;
  v_row public.notifications;
  v_to text;
  v_out jsonb := '[]'::jsonb;
begin
  select
    max(s.value #>> '{}') filter (where s.key = 'notify_visibility_seconds')::integer,
    max(s.value #>> '{}') filter (where s.key = 'notify_max_reads')::integer,
    max(s.value #>> '{}') filter (where s.key = 'notify_retry_delays_seconds'),
    max(s.value #>> '{}') filter (where s.key = 'notify_backlog_threshold')::integer
  into v_vt, v_max, v_delays, v_threshold
  from private.settings s
  where s.key in ('notify_visibility_seconds', 'notify_max_reads', 'notify_retry_delays_seconds', 'notify_backlog_threshold');
  if v_vt is null or v_max is null or v_delays is null or v_threshold is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'notify';
  end if;

  for v_msg in select * from pgmq.read('notifications', v_vt, least(greatest(coalesce(p_limit, 25), 1), 100)) loop
    select * into v_row from public.notifications n where n.msg_id = v_msg.msg_id for update;
    if not found then
      perform pgmq.delete('notifications', v_msg.msg_id);
      continue;
    end if;
    if v_row.status <> 'queued' then
      perform private.close_notification_message(v_msg.msg_id);
      continue;
    end if;

    v_to := v_msg.message ->> 'email';
    if v_to is null then
      select u.email into v_to from auth.users u where u.id = v_row.user_id;
      if exists (
        select 1 from public.notification_preferences p where p.user_id = v_row.user_id and p.email_undeliverable_at is not null
      ) then
        update public.notifications set status = 'suppressed' where id = v_row.id;
        perform private.close_notification_message(v_msg.msg_id);
        continue;
      end if;
    end if;

    if v_msg.read_ct > v_max or v_to is null then
      update public.notifications
      set status = 'failed', last_error = case when v_to is null then 'no_recipient' else 'abandoned' end
      where id = v_row.id;
      perform private.close_notification_message(v_msg.msg_id);
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'notification_id', v_row.id, 'kind', v_row.kind, 'payload', v_row.payload, 'recipient', v_to, 'attempt', v_msg.read_ct
    );
  end loop;

  return jsonb_build_object(
    'queue_depth', (select count(*) from pgmq.q_notifications q where q.vt <= clock_timestamp()),
    'backlog_threshold', v_threshold,
    'retry_delays', to_jsonb(string_to_array(v_delays, ',')::integer[]),
    'messages', v_out
  );
end;
$$;

revoke all on function public.notify_dequeue(integer) from public, anon, authenticated, service_role;
grant execute on function public.notify_dequeue(integer) to service_role;

-- Records one outcome and returns whether anything changed, so a repeat is harmless and false.
--   sent                              the provider accepted it: needs p_notification_id and p_provider_message_id
--   failed                            the attempts are used up: needs p_notification_id; p_error is a short code
--   delivered, bounced_transient,
--   bounced_permanent, complained     a delivery event of the provider, found by p_provider_message_id (or the id);
--                                     never lowers what is recorded (delivered < transient bounce < permanent bounce
--                                     < complaint)
-- An unknown notification is CHARA_NOT_FOUND (P0002); for an event this lets the provider redeliver it, which also
-- covers an event that arrives before the send was recorded. A permanent bounce or a complaint marks the recipient's
-- address undeliverable (the preference row is created when missing), which is audited.
create function public.notify_ack(
  p_outcome text,
  p_notification_id uuid default null,
  p_provider_message_id text default null,
  p_attempts integer default null,
  p_error text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.notifications;
  v_rank integer;
  v_old integer;
begin
  if p_outcome is null or p_outcome not in ('sent', 'failed', 'delivered', 'bounced_transient', 'bounced_permanent', 'complained') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'outcome';
  end if;
  if p_outcome in ('sent', 'failed') and p_notification_id is null
     or p_outcome = 'sent' and coalesce(p_provider_message_id, '') = ''
     or p_notification_id is null and coalesce(p_provider_message_id, '') = '' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'notification';
  end if;

  select * into v_row from public.notifications n
  where n.id = p_notification_id or n.provider_message_id = p_provider_message_id
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_outcome in ('sent', 'failed') then
    if v_row.status <> 'queued' then
      return false;
    end if;
    update public.notifications
    set status = p_outcome, attempts = coalesce(p_attempts, attempts + 1),
        provider_message_id = case when p_outcome = 'sent' then p_provider_message_id end,
        sent_at = case when p_outcome = 'sent' then now() end,
        last_error = case when p_outcome = 'failed' then left(coalesce(p_error, 'unknown'), 200) end
    where id = v_row.id;
    perform private.close_notification_message(v_row.msg_id);
    return true;
  end if;

  if v_row.status <> 'sent' then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_rank := array_position(array['delivered', 'bounced_transient', 'bounced_permanent', 'complained'], p_outcome);
  v_old := coalesce(array_position(array['delivered', 'bounced_transient', 'bounced_permanent', 'complained'], v_row.delivery), 0);
  if v_rank <= v_old then
    return false;
  end if;
  update public.notifications set delivery = p_outcome where id = v_row.id;
  if p_outcome in ('bounced_permanent', 'complained') and v_row.user_id is not null then
    insert into public.notification_preferences (user_id, email_undeliverable_at) values (v_row.user_id, now())
    on conflict (user_id) do update set email_undeliverable_at = coalesce(public.notification_preferences.email_undeliverable_at, now());
    perform audit.record(
      'notification.address_undeliverable', 'profile', v_row.user_id::text,
      jsonb_build_object('notification_id', v_row.id, 'reason', p_outcome)
    );
  end if;
  return true;
end;
$$;

revoke all on function public.notify_ack(text, uuid, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.notify_ack(text, uuid, text, integer, text) to service_role;

-- The scheduler call, shared with account-ops: nothing is called, and nothing is logged, while none of the three Vault
-- secrets exists (a local stack, CI); a partial set is a misconfiguration and warns. They are set by the deploy
-- runbook: project_url, anon_key (a public key, only for the platform's JWT check) and edge_shared_secret (the same
-- value as the function's EDGE_SHARED_SECRET, which the function checks itself).
create function private.call_edge_function(p_function text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_anon text;
  v_secret text;
begin
  select
    max(s.decrypted_secret) filter (where s.name = 'project_url'),
    max(s.decrypted_secret) filter (where s.name = 'anon_key'),
    max(s.decrypted_secret) filter (where s.name = 'edge_shared_secret')
  into v_url, v_anon, v_secret
  from vault.decrypted_secrets s
  where s.name in ('project_url', 'anon_key', 'edge_shared_secret');
  if v_url is null and v_anon is null and v_secret is null then
    return null;
  end if;
  if v_url is null or v_anon is null or v_secret is null then
    raise warning '% is not called: the Vault secrets project_url, anon_key and edge_shared_secret are not all set', p_function;
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/' || p_function,
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon, 'x-edge-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function private.call_edge_function(text) from public, anon, authenticated, service_role;

create or replace function private.run_account_ops() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from pgmq.q_account_ops q where q.vt <= now()) then
    return null;
  end if;
  return private.call_edge_function('account-ops');
end;
$$;

create function private.run_notify() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from pgmq.q_notifications q where q.vt <= now()) then
    return null;
  end if;
  return private.call_edge_function('notify');
end;
$$;

revoke all on function private.run_notify() from public, anon, authenticated, service_role;

select cron.schedule('notify-run', '* * * * *', 'select private.run_notify()');

-- apply_retention keeps its rule for the document access log and adds the notifications and their archived messages.
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
end;
$$;

-- The erasure of a candidate (FR-B6) also deletes their notifications, the delivery marks of their address and the
-- messages that were queued or archived for them (found through the rows, by index). The function is that of
-- 20261026100000 with this one change in place of the scan of the queue.
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
  update public.passport_shares
  set worker_user_id = v_pseudonym, scope = '[]', revoked_at = coalesce(revoked_at, now())
  where worker_user_id = p_user_id;
  update public.job_applications a
  set worker_user_id = v_pseudonym, cover_note = null,
      profile_snapshot = a.profile_snapshot - 'first_name' - 'last_name' - 'headline'
  where a.worker_user_id = p_user_id;
  update public.application_events set actor_id = v_pseudonym where actor_id = p_user_id;
  update public.consents set user_id = v_pseudonym where user_id = p_user_id;
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

  perform set_config('chara.erasure_user', '', true);
  perform set_config('chara.erasure_pseudonym', '', true);

  perform audit.record(
    'account.erased', 'profile', v_pseudonym::text,
    jsonb_build_object('requested_at', v_requested, 'completed_at', now())
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
