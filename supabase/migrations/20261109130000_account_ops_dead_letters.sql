-- Abandoned account-ops jobs are kept as dead letters (security review SA-14; ARCHITECTURE.md section 13 "archive as
-- dead-letter"). Until now a job read more than account_ops_max_attempts times was deleted and only its action and
-- message id were audited, so an abandoned delete_object lost the bucket and the path of the object it was to remove.
-- The message now moves to pgmq.a_account_ops, where the operator finds it by the msg_id of the account_ops_abandoned
-- row and queues it again (docs/runbooks/platform-staff.md). The audit row stays as it was: the path holds the file name,
-- which audit rows never carry (NFR-C1, private.worker_documents_audit), and audit rows are archived for good. The dead
-- letters are kept for the period of the retention row account_ops_archive (20261109140000).
create or replace function public.account_ops_dequeue(p_limit integer default 25) returns table (msg_id bigint, message jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'account_ops_max_attempts');
  v_job pgmq.message_record;
  v_type text;
  v_entity text;
begin
  for v_job in select * from pgmq.read('account_ops', 60, least(greatest(coalesce(p_limit, 25), 1), 100)) loop
    if v_job.read_ct > v_max then
      perform pgmq.archive('account_ops', v_job.msg_id);
      select e.entity_type, e.entity_id into v_type, v_entity from private.account_ops_entity(v_job.message) e;
      perform audit.record(
        'account_ops_abandoned', v_type, v_entity,
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

-- A dead letter names its user and, for delete_object, a path with the file name, so the erasure of a candidate (FR-B6,
-- NFR-C1) deletes the candidate's dead letters as it deletes the archived notifications; the files they pointed at go
-- with the storage prefix that account-ops purges after this step. The archive holds abandoned jobs only and is kept
-- for 90 days, so the scan by message is small. erase_user of 20261030100000 with that one line added.
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
  delete from pgmq.a_account_ops a where a.message ->> 'user_id' = v_subject;

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
