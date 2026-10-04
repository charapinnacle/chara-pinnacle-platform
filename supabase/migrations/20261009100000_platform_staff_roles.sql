-- Platform staff roles (FR-A7; ARCHITECTURE.md sections 5.4, 6.3, 8; OPEN_QUESTIONS.md D1, D11, D39). Staff are never
-- self-service: only an administrator at aal2 grants or revokes a role, for another person and with a reason, and the
-- row trigger of platform_staff (20261004100100) writes the audit entry from the reason passed in chara.audit_reason.
-- The sign-out of the affected user is a job in the pgmq queue account_ops, executed by the account-ops function
-- through the service RPCs below, which are the only database surface granted to service_role.

create extension pg_net;

insert into private.settings (key, value) values ('account_ops_max_attempts', '5');

create function private.assert_platform_admin() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.has_platform_role('admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;
  return v_uid;
end;
$$;

revoke all on function private.assert_platform_admin() from public, anon, authenticated, service_role;

create function private.platform_reason(p_reason text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reason text := btrim(p_reason, E' \t\r\n');
begin
  if v_reason is null or char_length(v_reason) not between 10 and 500 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'reason';
  end if;
  return v_reason;
end;
$$;

revoke all on function private.platform_reason(text) from public, anon, authenticated, service_role;

-- p_role is text so that a value outside the enum is CHARA_INVALID_INPUT like every other bad argument, not a cast error.
create function private.platform_role_from_text(p_role text) returns public.platform_role
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_role is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'role';
  end if;
  return p_role::public.platform_role;
exception when invalid_text_representation then
  raise exception 'CHARA_INVALID_INPUT' using detail = 'role';
end;
$$;

revoke all on function private.platform_role_from_text(text) from public, anon, authenticated, service_role;

create function public.grant_platform_role(p_user_id uuid, p_role text, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_platform_admin();
  v_reason text;
  v_role public.platform_role;
begin
  if p_user_id = v_uid then
    raise exception 'CHARA_FORBIDDEN' using detail = 'own_account';
  end if;
  v_reason := private.platform_reason(p_reason);
  v_role := private.platform_role_from_text(p_role);
  if p_user_id is null or not exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = p_user_id and p.status = 'active' and u.email_confirmed_at is not null
  ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('platform_role:' || p_user_id::text, 0));
  if exists (
    select 1 from public.platform_staff s
    where s.user_id = p_user_id and s.role = v_role and s.revoked_at is null
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'role_active';
  end if;

  perform set_config('chara.audit_reason', v_reason, true);
  insert into public.platform_staff (user_id, role, granted_by) values (p_user_id, v_role, v_uid);
  perform set_config('chara.audit_reason', '', true);
  perform pgmq.send('account_ops', jsonb_build_object(
    'action', 'sign_out', 'user_id', p_user_id, 'reason', 'platform_role_granted'
  ));
end;
$$;

revoke all on function public.grant_platform_role(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.grant_platform_role(uuid, text, text) to authenticated;

-- The sole active administrator cannot be revoked (also enforced at commit by platform_staff_keep_admin). An administrator
-- may revoke their own admin role while another remains; a revoked row stays as history.
create function public.revoke_platform_role(p_user_id uuid, p_role text, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_role public.platform_role;
  v_row_id bigint;
begin
  perform private.assert_platform_admin();
  v_reason := private.platform_reason(p_reason);
  v_role := private.platform_role_from_text(p_role);
  if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('platform_role:' || p_user_id::text, 0));
  select s.id into v_row_id
  from public.platform_staff s
  where s.user_id = p_user_id and s.role = v_role and s.revoked_at is null
  for update;
  if v_row_id is null then
    if exists (select 1 from public.platform_staff s where s.user_id = p_user_id and s.role = v_role) then
      raise exception 'CHARA_CONFLICT' using detail = 'role_revoked';
    end if;
    raise exception 'CHARA_INVALID_INPUT' using detail = 'role';
  end if;

  if v_role = 'admin' then
    perform pg_advisory_xact_lock(hashtextextended('platform_admins', 0));
    if not exists (
      select 1 from public.platform_staff s where s.role = 'admin' and s.revoked_at is null and s.id <> v_row_id
    ) then
      raise exception 'CHARA_FORBIDDEN' using detail = 'last_administrator';
    end if;
  end if;

  perform set_config('chara.audit_reason', v_reason, true);
  update public.platform_staff set revoked_at = now() where id = v_row_id;
  perform set_config('chara.audit_reason', '', true);
  perform pgmq.send('account_ops', jsonb_build_object(
    'action', 'sign_out', 'user_id', p_user_id, 'reason', 'platform_role_revoked'
  ));
end;
$$;

revoke all on function public.revoke_platform_role(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.revoke_platform_role(uuid, text, text) to authenticated;

-- Backstop for any other writer (the table owner in a runbook step, a later RPC): a transaction that leaves no active
-- administrator fails at commit. Deleting a profile is not covered; the erasure that does so must refuse the last one.
create function private.platform_staff_keep_admin() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.platform_staff s where s.role = 'admin' and s.revoked_at is null) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'last_administrator';
  end if;
  return null;
end;
$$;

revoke all on function private.platform_staff_keep_admin() from public, anon, authenticated, service_role;

create constraint trigger platform_staff_keep_admin
  after update of revoked_at on public.platform_staff
  deferrable initially deferred
  for each row
  when (old.role = 'admin' and old.revoked_at is null and new.revoked_at is not null)
  execute function private.platform_staff_keep_admin();

alter table public.platform_staff enable always trigger platform_staff_keep_admin;

-- Service RPCs of the account-ops function. A message is invisible for 120 seconds once read, so a crashed run is
-- retried by a later one and two overlapping runs never share a message; after account_ops_max_attempts reads a message
-- is archived and audited instead of retried for ever.
create function public.account_ops_dequeue(p_limit integer default 25) returns table (msg_id bigint, message jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'account_ops_max_attempts');
  v_job pgmq.message_record;
begin
  for v_job in select * from pgmq.read('account_ops', 120, least(greatest(coalesce(p_limit, 25), 1), 100)) loop
    if v_job.read_ct > v_max then
      perform pgmq.archive('account_ops', v_job.msg_id);
      perform audit.record(
        'account_ops_abandoned', 'user', v_job.message ->> 'user_id',
        jsonb_build_object('action', v_job.message ->> 'action', 'msg_id', v_job.msg_id)
      );
    else
      msg_id := v_job.msg_id;
      message := v_job.message;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.account_ops_dequeue(integer) from public, anon, authenticated, service_role;
grant execute on function public.account_ops_dequeue(integer) to service_role;

-- Returns the number of sessions ended. Deleting the session rows ends their refresh tokens by cascade; the Auth admin
-- API ends sessions only with the user's own token, so this is the one place the database does it.
create function public.account_ops_end_sessions(p_user_id uuid) returns integer
language sql
security definer
set search_path = ''
as $$
  with ended as (
    delete from auth.sessions s where s.user_id = p_user_id returning 1
  )
  select count(*)::integer from ended
$$;

revoke all on function public.account_ops_end_sessions(uuid) from public, anon, authenticated, service_role;
grant execute on function public.account_ops_end_sessions(uuid) to service_role;

-- Archives a finished job and audits what was done. A job that is no longer queued (a second ack) returns false and
-- writes nothing.
create function public.account_ops_ack(p_msg_id bigint, p_result jsonb default '{}') returns boolean
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
  if v_message is null or not pgmq.archive('account_ops', p_msg_id) then
    return false;
  end if;
  perform audit.record(
    'account_ops_done', 'user', v_message ->> 'user_id',
    jsonb_build_object('action', v_message ->> 'action', 'msg_id', p_msg_id) || p_result
  );
  return true;
end;
$$;

revoke all on function public.account_ops_ack(bigint, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.account_ops_ack(bigint, jsonb) to service_role;

-- Calls account-ops once a minute while a job is visible. The three Vault secrets are set by the deploy runbook:
-- project_url, anon_key (a public key, only for the platform's JWT check) and edge_shared_secret (the same value as the
-- function's EDGE_SHARED_SECRET, which the function checks itself).
create function private.run_account_ops() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_anon text;
  v_secret text;
begin
  if not exists (select 1 from pgmq.q_account_ops q where q.vt <= now()) then
    return null;
  end if;
  select
    max(s.decrypted_secret) filter (where s.name = 'project_url'),
    max(s.decrypted_secret) filter (where s.name = 'anon_key'),
    max(s.decrypted_secret) filter (where s.name = 'edge_shared_secret')
  into v_url, v_anon, v_secret
  from vault.decrypted_secrets s
  where s.name in ('project_url', 'anon_key', 'edge_shared_secret');
  if v_url is null or v_anon is null or v_secret is null then
    raise warning 'account-ops is not called: the Vault secrets project_url, anon_key and edge_shared_secret are not all set';
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/account-ops',
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon, 'x-edge-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function private.run_account_ops() from public, anon, authenticated, service_role;

select cron.schedule('account-ops-run', '* * * * *', 'select private.run_account_ops()');
