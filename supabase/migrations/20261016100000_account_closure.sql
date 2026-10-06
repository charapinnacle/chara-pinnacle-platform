-- Account closure (FR-B6; ARCHITECTURE.md sections 4, 11, 12; OPEN_QUESTIONS.md D46). A candidate asks for deletion
-- (profiles.deleted_at is the request time), has 30 days to cancel, and then the daily job queues the erasure for
-- account-ops, which calls erase_user, purges the storage prefix and deletes the auth user. erase_user deletes the
-- candidate's rows and replaces the user id in the rows that must outlive the account (audit log, consent ledger,
-- document access log, shares) by one random pseudonym whose mapping is never stored.

insert into private.settings (key, value) values
  ('account_deletion_cooling_off_days', '30'),
  ('account_deletion_requests_per_day_max', '5'),
  ('privacy_contact_email', '""');

comment on column public.profiles.deleted_at is
  'When the candidate asked for deletion; null when no request is pending. Erasure is due once the cooling-off period has passed.';

-- Set by a Platform Administrator through a ticketed, audited SQL statement (there is no screen in Phase 1). The
-- candidate cannot read it: the select grant below leaves the column out.
alter table public.profiles add column legal_hold boolean not null default false;

revoke select on public.profiles from authenticated;
grant select (id, account_kind, intended_account_kind, pending_consents, display_name, preferred_lang, status, deleted_at, created_at)
  on public.profiles to authenticated;

-- The daily job reads the requests whose cooling-off period is over, oldest first: the accounts to erase (no hold) and
-- the held ones apart, so a long list of holds never takes the place of an account that is due.
create index profiles_deletion_requested_idx on public.profiles (legal_hold, deleted_at) where deleted_at is not null;

-- erase_user finds the rows of one user in these tables; the existing indexes either exclude the rows it needs or lead
-- with other columns.
create index log_actor_idx on audit.log (actor_id) where actor_id is not null;
create index log_entity_idx on audit.log (entity_id, action);
create index document_access_log_worker_idx on audit.document_access_log (worker_user_id);
create index worker_documents_worker_idx on public.worker_documents (worker_user_id);

-- A share outlives the candidate's passport, pseudonymised, so it no longer follows the passport row.
alter table public.passport_shares drop constraint passport_shares_worker_user_id_fkey;

-- The transaction settings chara.erasure_user and chara.erasure_pseudonym are set by erase_user alone, for its own
-- transaction. The append-only triggers below accept an update that does nothing but put the pseudonym where the user
-- id was, and refuse every other change as before.
create function private.erasure_subject() returns uuid
language sql
stable
set search_path = ''
as $$ select nullif(current_setting('chara.erasure_user', true), '')::uuid $$;

create function private.erasure_pseudonym() returns uuid
language sql
stable
set search_path = ''
as $$ select nullif(current_setting('chara.erasure_pseudonym', true), '')::uuid $$;

create function private.is_pseudonymised(p_old uuid, p_new uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select p_old is not null and p_old = private.erasure_subject() and p_new is not distinct from private.erasure_pseudonym()
$$;

revoke all on function private.erasure_subject() from public, anon, authenticated, service_role;
revoke all on function private.erasure_pseudonym() from public, anon, authenticated, service_role;
revoke all on function private.is_pseudonymised(uuid, uuid) from public, anon, authenticated, service_role;

-- Audit rows name the user as actor, as entity and inside the metadata text. The address the actor connected from is
-- personal data too, so it goes with the id on the user's own rows.
create or replace function audit.refuse_change() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_subject uuid := private.erasure_subject();
  v_pseudonym uuid := private.erasure_pseudonym();
begin
  if tg_op = 'UPDATE' and v_subject is not null then
    if (new.id, new.action, new.entity_type, new.created_at) = (old.id, old.action, old.entity_type, old.created_at)
       and new.actor_id is not distinct from (case when old.actor_id = v_subject then v_pseudonym else old.actor_id end)
       and new.entity_id is not distinct from (case when old.entity_id = v_subject::text then v_pseudonym::text else old.entity_id end)
       and new.ip is not distinct from (case when old.actor_id = v_subject then null else old.ip end)
       and new.metadata = replace(old.metadata::text, v_subject::text, v_pseudonym::text)::jsonb then
      return new;
    end if;
  end if;
  raise exception 'audit.log is append-only' using errcode = '42501';
end;
$$;

create function private.consents_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.purpose, new.version, new.action, new.created_at) = (old.id, old.purpose, old.version, old.action, old.created_at)
       and private.is_pseudonymised(old.user_id, new.user_id) then
      return new;
    end if;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

revoke all on function private.consents_guard() from public, anon, authenticated, service_role;

drop trigger consents_append_only on public.consents;
create trigger consents_append_only
  before update or delete on public.consents
  for each row execute function private.consents_guard();
alter table public.consents enable always trigger consents_append_only;

create or replace function audit.document_access_log_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('chara.retention_run', true), '') = 'on' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.share_id, new.document_id, new.organization_id, new.purpose, new.accessed_at)
         is not distinct from (old.id, old.share_id, old.document_id, old.organization_id, old.purpose, old.accessed_at)
       and private.is_pseudonymised(old.worker_user_id, new.worker_user_id)
       and new.accessed_by = (case when old.accessed_by = private.erasure_subject() then private.erasure_pseudonym() else old.accessed_by end) then
      return new;
    end if;
  end if;
  raise exception 'audit.document_access_log is append-only' using errcode = '42501';
end;
$$;

-- The erasure revokes the share, empties its scope and moves it to the pseudonym; nothing else about a share changes.
create or replace function private.passport_shares_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_pseudonymised(old.worker_user_id, new.worker_user_id)
     and (new.id, new.organization_id, new.application_id, new.consent_id, new.created_at, new.expires_at)
           is not distinct from (old.id, old.organization_id, old.application_id, old.consent_id, old.created_at, old.expires_at)
     and new.scope = '[]'::jsonb
     and new.revoked_at is not null
     and (old.revoked_at is null or new.revoked_at = old.revoked_at) then
    return new;
  end if;
  if (new.id, new.worker_user_id, new.organization_id, new.application_id, new.scope, new.consent_id, new.created_at)
       is distinct from
     (old.id, old.worker_user_id, old.organization_id, old.application_id, old.scope, old.consent_id, old.created_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.expires_at is not null and new.expires_at is distinct from old.expires_at) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'share_is_fixed';
  end if;
  return new;
end;
$$;

-- document_access_grant (document access log migration) with one change: a candidate whose deletion is requested gives
-- no access to anyone else, although the profile stays active so the candidate can still sign in and read their data.
create or replace function public.document_access_grant(p_document_id uuid, p_purpose text)
returns table (bucket_id text, object_path text, file_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_document public.worker_documents;
  v_share uuid;
  v_org uuid;
  v_repeat integer := (select (value #>> '{}')::integer from private.settings where key = 'document_access_repeat_seconds');
begin
  if v_uid is null then
    raise exception 'CHARA_UNAUTHENTICATED' using errcode = '42501';
  end if;

  select * into v_document from public.worker_documents d where d.id = p_document_id and d.deleted_at is null;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_document.worker_user_id <> v_uid then
    select s.id, s.organization_id into v_share, v_org
    from public.passport_shares s
    join public.consents c on c.id = s.consent_id and c.user_id = s.worker_user_id and c.action = 'granted'
    where s.worker_user_id = v_document.worker_user_id
      and s.organization_id in (select private.member_org_ids())
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
      and s.scope ? v_document.id::text
      and not exists (
        select 1 from public.consents w
        where w.user_id = c.user_id and w.purpose = c.purpose and w.action = 'withdrawn' and w.id > c.id
      )
      and exists (
        select 1 from public.profiles p where p.id = s.worker_user_id and p.status = 'active' and p.deleted_at is null
      )
      and exists (select 1 from public.organizations o where o.id = s.organization_id and o.status = 'active')
    order by s.created_at desc
    limit 1;
    if v_org is null then
      raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  if p_purpose is distinct from (case when v_document.worker_user_id = v_uid then 'owner_download' else 'application_review' end) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501', detail = 'purpose_mismatch';
  end if;

  if v_document.scan_status not in ('clean', 'skipped') then
    raise exception 'CHARA_DOCUMENT_NOT_SCANNED';
  end if;

  if not exists (
    select 1 from audit.document_access_log l
    where l.accessed_at > now() - make_interval(secs => coalesce(v_repeat, 0))
      and l.accessed_by = v_uid and l.document_id = v_document.id and l.purpose = p_purpose
  ) then
    insert into audit.document_access_log (share_id, document_id, worker_user_id, organization_id, accessed_by, purpose)
    values (v_share, v_document.id, v_document.worker_user_id, v_org, v_uid, p_purpose);
  end if;

  return query select v_document.bucket_id, v_document.storage_path, v_document.file_name;
end;
$$;

create function private.cooling_off_days() returns integer
language sql
stable
set search_path = ''
as $$
  select (s.value #>> '{}')::integer from private.settings s where s.key = 'account_deletion_cooling_off_days'
$$;

create function private.cooling_off_ends_at(p_requested_at timestamptz) returns timestamptz
language sql
stable
set search_path = ''
as $$ select p_requested_at + make_interval(days => private.cooling_off_days()) $$;

revoke all on function private.cooling_off_days() from public, anon, authenticated, service_role;
revoke all on function private.cooling_off_ends_at(timestamptz) from public, anon, authenticated, service_role;

-- What the settings page shows: the request time, when the data will be erased, whether the request can still be
-- cancelled and the length of the period (the dialog states it).
create function public.account_deletion_status()
returns table (requested_at timestamptz, erases_on timestamptz, can_cancel boolean, cooling_off_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind public.account_kind;
  v_requested timestamptz;
begin
  select p.account_kind, p.deleted_at into v_kind, v_requested from public.profiles p where p.id = v_uid;
  if v_uid is null or v_kind is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required';
  end if;
  requested_at := v_requested;
  erases_on := private.cooling_off_ends_at(v_requested);
  can_cancel := v_requested is not null and now() < erases_on;
  cooling_off_days := private.cooling_off_days();
  return next;
end;
$$;

revoke all on function public.account_deletion_status() from public, anon, authenticated, service_role;
grant execute on function public.account_deletion_status() to authenticated;

-- The request takes effect at once and a repeat changes nothing, so a double click or a retried request writes one audit
-- row and queues one email. Platform staff must give up their role first: erasing the last administrator is refused.
-- Requesting and cancelling in turn writes audit rows and queues an email each time, so the requests of one candidate
-- in 24 hours are capped by a setting (rate_limited beyond it).
create function public.request_account_deletion() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind public.account_kind;
  v_requested timestamptz;
  v_max integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'account_deletion_requests_per_day_max');
begin
  select p.account_kind, p.deleted_at into v_kind, v_requested from public.profiles p where p.id = v_uid for update;
  if v_uid is null or v_kind is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required';
  end if;
  if v_requested is not null then
    return;
  end if;
  if exists (select 1 from public.platform_staff s where s.user_id = v_uid and s.revoked_at is null) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'platform_staff';
  end if;
  if (select count(*) from audit.log l
      where l.entity_id = v_uid::text and l.action = 'account.deletion_requested' and l.created_at > now() - interval '24 hours')
     >= coalesce(v_max, 0) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'rate_limited';
  end if;

  update public.profiles set deleted_at = now() where id = v_uid;
  perform audit.record('account.deletion_requested', 'profile', v_uid::text);
  perform pgmq.send('notifications', jsonb_build_object(
    'kind', 'deletion_requested', 'user_id', v_uid, 'erases_on', private.cooling_off_ends_at(now()), 'mandatory', true
  ));
end;
$$;

revoke all on function public.request_account_deletion() from public, anon, authenticated, service_role;
grant execute on function public.request_account_deletion() to authenticated;

-- Cancelling when nothing is pending is a no-op. The profile row is locked, so a cancel and an erasure cannot both win.
create function public.cancel_account_deletion() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind public.account_kind;
  v_requested timestamptz;
begin
  select p.account_kind, p.deleted_at into v_kind, v_requested from public.profiles p where p.id = v_uid for update;
  if v_uid is null or v_kind is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required';
  end if;
  if v_requested is null then
    return;
  end if;
  if now() >= private.cooling_off_ends_at(v_requested) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'cooling_off_ended';
  end if;

  update public.profiles set deleted_at = null where id = v_uid;
  perform audit.record('account.deletion_cancelled', 'profile', v_uid::text);
end;
$$;

revoke all on function public.cancel_account_deletion() from public, anon, authenticated, service_role;
grant execute on function public.cancel_account_deletion() to authenticated;

-- The database part of the erasure, in one transaction. Returns false when no profile exists any more (a retry after
-- the first run), so a second call changes nothing and writes nothing. The storage prefix and the auth user are
-- removed by account-ops afterwards, each step safe to repeat.
create function public.erase_user(p_user_id uuid) returns boolean
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
  from public.profiles p where p.id = p_user_id for update;
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

  update public.passport_shares
  set worker_user_id = v_pseudonym, scope = '[]', revoked_at = coalesce(revoked_at, now())
  where worker_user_id = p_user_id;
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
  perform pgmq.delete('notifications', array(select n.msg_id from pgmq.q_notifications n where n.message ->> 'user_id' = v_subject));

  perform set_config('chara.erasure_user', '', true);
  perform set_config('chara.erasure_pseudonym', '', true);

  perform audit.record(
    'account.erased', 'profile', v_pseudonym::text,
    jsonb_build_object('requested_at', v_requested, 'completed_at', now())
  );
  -- The auth user is deleted next, so the address travels in the message; notify must not archive it.
  if v_email is not null then
    perform pgmq.send('notifications', jsonb_build_object('kind', 'deletion_completed', 'email', v_email, 'mandatory', true));
  end if;
  return true;
end;
$$;

revoke all on function public.erase_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.erase_user(uuid) to service_role;

-- Runs daily, in three bounded passes of at most 1000 accounts each (the next run takes the rest). An account whose
-- cooling-off period is over gets one erasure job for account-ops, unless a job is already waiting. One under a legal
-- hold stays as it is and the privacy contact hears of it once (the audit row marks that it did); the held accounts are
-- selected apart, so they never take a place in the batch of the accounts that are due. The last pass repairs an
-- erasure that stopped after the database step (its jobs abandoned while Storage or Auth was down): an auth user
-- without a profile gets a job again, and erase_user then only purges the files and deletes the user.
create function private.queue_account_erasures() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_contact text := (select s.value #>> '{}' from private.settings s where s.key = 'privacy_contact_email');
  v_queued integer := 0;
begin
  for v_id in
    select p.id
    from public.profiles p
    where p.deleted_at is not null and p.legal_hold
      and p.deleted_at <= now() - make_interval(days => private.cooling_off_days())
      and not exists (
        select 1 from audit.log l
        where l.entity_id = p.id::text and l.action = 'account.erasure_paused' and l.created_at >= p.deleted_at
      )
    order by p.deleted_at
    limit 1000
  loop
    perform audit.record('account.erasure_paused', 'profile', v_id::text);
    if coalesce(v_contact, '') <> '' then
      perform pgmq.send('notifications', jsonb_build_object(
        'kind', 'erasure_paused', 'email', v_contact, 'user_id', v_id, 'mandatory', true
      ));
    end if;
  end loop;

  for v_id in
    select p.id
    from public.profiles p
    where p.deleted_at is not null and not p.legal_hold
      and p.deleted_at <= now() - make_interval(days => private.cooling_off_days())
      and not exists (
        select 1 from pgmq.q_account_ops q where q.message ->> 'action' = 'erase_user' and q.message ->> 'user_id' = p.id::text
      )
    order by p.deleted_at
    limit 1000
  loop
    perform pgmq.send('account_ops', jsonb_build_object('action', 'erase_user', 'user_id', v_id));
    v_queued := v_queued + 1;
  end loop;

  for v_id in
    select u.id
    from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
      and not exists (
        select 1 from pgmq.q_account_ops q where q.message ->> 'action' = 'erase_user' and q.message ->> 'user_id' = u.id::text
      )
    limit 1000
  loop
    perform pgmq.send('account_ops', jsonb_build_object('action', 'erase_user', 'user_id', v_id));
    v_queued := v_queued + 1;
  end loop;
  return v_queued;
end;
$$;

revoke all on function private.queue_account_erasures() from public, anon, authenticated, service_role;

select cron.schedule('queue-account-erasures', '30 2 * * *', 'select private.queue_account_erasures()');

-- account_ops_ack (platform staff roles migration) with one change: the audit row of a job names the user only while the
-- user still has a profile. A job acknowledged after the erasure (the erase job itself, or a file removal that was
-- still queued) would otherwise write the old user id back into the audit log, next to the pseudonymised rows.
create or replace function public.account_ops_ack(p_msg_id bigint, p_result jsonb default '{}') returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message jsonb;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'result';
  end if;
  select q.message into v_message from pgmq.q_account_ops q where q.msg_id = p_msg_id;
  if v_message is null or not pgmq.delete('account_ops', p_msg_id) then
    return false;
  end if;
  perform audit.record(
    'account_ops_done', 'user',
    (select p.id::text from public.profiles p where p.id::text = v_message ->> 'user_id'),
    jsonb_build_object('action', v_message ->> 'action', 'msg_id', p_msg_id) || p_result
  );
  return true;
end;
$$;

-- account_ops_dequeue (platform staff roles migration) with the same change as account_ops_ack: an abandoned job of a user
-- whose profile is gone (the erasure stopped after the database step) must not write the old user id back into the audit
-- log. The daily job queues such an account again.
create or replace function public.account_ops_dequeue(p_limit integer default 25) returns table (msg_id bigint, message jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'account_ops_max_attempts');
  v_job pgmq.message_record;
begin
  for v_job in select * from pgmq.read('account_ops', 60, least(greatest(coalesce(p_limit, 25), 1), 100)) loop
    if v_job.read_ct > v_max then
      perform pgmq.delete('account_ops', v_job.msg_id);
      perform audit.record(
        'account_ops_abandoned', 'user',
        (select p.id::text from public.profiles p where p.id::text = v_job.message ->> 'user_id'),
        jsonb_build_object('action', v_job.message ->> 'action', 'msg_id', v_job.msg_id)
      );
    else
      if v_job.read_ct > 1 then
        perform pgmq.set_vt('account_ops', v_job.msg_id, 60 * v_job.read_ct);
      end if;
      msg_id := v_job.msg_id;
      message := v_job.message;
      return next;
    end if;
  end loop;
end;
$$;

-- A Platform Administrator sets or clears the hold by a ticketed SQL statement (no screen in Phase 1); the trigger makes it
-- audited. The ticket and reason travel in the transaction setting chara.audit_reason, as for the platform roles; a
-- change without one is refused.
create function private.profiles_legal_hold_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(current_setting('chara.audit_reason', true), '');
begin
  if v_reason is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'reason';
  end if;
  perform audit.record(
    case when new.legal_hold then 'account.legal_hold_set' else 'account.legal_hold_cleared' end,
    'profile', new.id::text,
    jsonb_build_object('reason', v_reason)
  );
  return null;
end;
$$;

revoke all on function private.profiles_legal_hold_audit() from public, anon, authenticated, service_role;

create trigger profiles_legal_hold_audit
  after update of legal_hold on public.profiles
  for each row when (old.legal_hold is distinct from new.legal_hold)
  execute function private.profiles_legal_hold_audit();

alter table public.profiles enable always trigger profiles_legal_hold_audit;
