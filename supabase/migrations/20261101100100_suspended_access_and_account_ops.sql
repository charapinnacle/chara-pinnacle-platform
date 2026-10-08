-- What a suspension changes for the people and the organisation it names (FR-F1; OPEN_QUESTIONS.md D45, D65). The token of
-- a suspended user stays valid for up to 30 minutes, so the database refuses the user on its own: a suspended user is a
-- member of no organisation, and the vacancies of a suspended organisation take no insert or update. The account-ops
-- jobs of the suspension (the sign-in ban, the sign-out of every member) read what they need through the two service
-- functions below.

-- 20261005100000 with one more condition: a suspended user is no member of anything, which reaches every policy and
-- helper that asks for the organisations of the caller.
create or replace function private.member_org_ids(p_min_role public.member_role default 'member')
returns setof uuid
language sql
stable
security definer
rows 5
set search_path = ''
as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = (select auth.uid())
    and m.accepted_at is not null
    and private.role_rank(m.role) >= private.role_rank(p_min_role)
    and not exists (select 1 from public.profiles p where p.id = m.user_id and p.status = 'suspended')
$$;

create function private.active_org_ids(p_min_role public.member_role default 'member') returns setof uuid
language sql
stable
security definer
rows 5
set search_path = ''
as $$
  select o from private.member_org_ids(p_min_role) o
  where exists (select 1 from public.organizations x where x.id = o and x.status = 'active')
$$;

revoke all on function private.active_org_ids(public.member_role) from public, anon, authenticated, service_role;
grant execute on function private.active_org_ids(public.member_role) to authenticated;

drop policy jobs_insert_admin on public.jobs;
drop policy jobs_update_admin on public.jobs;

create policy jobs_insert_admin on public.jobs
  for insert to authenticated
  with check (organization_id in (select private.active_org_ids('admin')));

create policy jobs_update_admin on public.jobs
  for update to authenticated
  using (organization_id in (select private.active_org_ids('admin')))
  with check (organization_id in (select private.active_org_ids('admin')));

-- 20261005100000 with one more refusal: a suspended user manages no organisation, whatever the token still says.
create or replace function private.assert_org_manager(p_org uuid, p_min_role public.member_role) returns public.member_role
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.member_role;
  v_status public.organization_status;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'suspended') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_suspended';
  end if;

  select m.role into v_role
  from public.organization_members m
  where m.organization_id = p_org and m.user_id = v_uid and m.accepted_at is not null;
  if not found or private.role_rank(v_role) < private.role_rank(p_min_role) then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;

  select o.status into v_status from public.organizations o where o.id = p_org for no key update;
  select m.role into v_role
  from public.organization_members m
  where m.organization_id = p_org and m.user_id = v_uid and m.accepted_at is not null;
  if not found or private.role_rank(v_role) < private.role_rank(p_min_role) then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
  end if;
  return v_role;
end;
$$;

-- 20261017100000 with one change: moderation_state is no field of the vacancy that its organisation edits; it changes with
-- a suspension or a moderation decision, which are audited as such, so job.updated no longer names it.
create or replace function private.jobs_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb;
  v_actor_fn text := coalesce(current_setting('chara.actor_fn', true), '');
begin
  if tg_op = 'INSERT' then
    perform audit.record('job.created', 'job', new.id::text, jsonb_build_object('organization_id', new.organization_id));
  elsif tg_op = 'DELETE' then
    perform audit.record('job.deleted', 'job', old.id::text, jsonb_build_object('organization_id', old.organization_id));
  else
    if new.status <> old.status then
      perform audit.record(
        'job.status_changed', 'job', new.id::text,
        jsonb_build_object('organization_id', new.organization_id, 'from', old.status, 'to', new.status)
          || case when v_actor_fn <> '' then jsonb_build_object('actor_fn', v_actor_fn) else '{}'::jsonb end
      );
    end if;
    v_old := to_jsonb(old) - 'search_vector';
    v_new := to_jsonb(new) - 'search_vector';
    select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from v_old -> n.key
      and n.key not in ('status', 'status_changed_at', 'published_at', 'moderation_state');
    if jsonb_array_length(v_changed) > 0 then
      perform audit.record(
        'job.updated', 'job', new.id::text,
        jsonb_build_object('organization_id', new.organization_id, 'changed_fields', v_changed)
      );
    end if;
  end if;
  return null;
end;
$$;

-- What the audit row of a job names: the organisation (the sign-out of its members), the legal document version (the
-- fan-out of its email) or the user, as long as the profile exists, so a job after an erasure writes the old id nowhere.
create function private.account_ops_entity(p_message jsonb, out entity_type text, out entity_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when p_message ? 'organization_id' then 'organization' when p_message ? 'document_slug' then 'legal_document' else 'user' end,
    case
      when p_message ? 'organization_id' then p_message ->> 'organization_id'
      when p_message ? 'document_slug' then (p_message ->> 'document_slug') || ':' || (p_message ->> 'version')
      else (select p.id::text from public.profiles p where p.id::text = p_message ->> 'user_id')
    end
$$;

revoke all on function private.account_ops_entity(jsonb) from public, anon, authenticated, service_role;

-- 20261016100000 with one change: the audit row names what the job acts on (private.account_ops_entity).
create or replace function public.account_ops_ack(p_msg_id bigint, p_result jsonb default '{}') returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message jsonb;
  v_type text;
  v_entity text;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'result';
  end if;
  select q.message into v_message from pgmq.q_account_ops q where q.msg_id = p_msg_id;
  if v_message is null or not pgmq.delete('account_ops', p_msg_id) then
    return false;
  end if;
  select e.entity_type, e.entity_id into v_type, v_entity from private.account_ops_entity(v_message) e;
  perform audit.record(
    'account_ops_done', v_type, v_entity,
    jsonb_build_object('action', v_message ->> 'action', 'msg_id', p_msg_id) || p_result
  );
  return true;
end;
$$;

-- 20261016100000 with the same change.
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
      perform pgmq.delete('account_ops', v_job.msg_id);
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

-- The status a suspend_user or reinstate_user job acts on, read when the job runs; null for an account that is gone.
create function public.account_ops_user_status(p_user_id uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.status::text from public.profiles p where p.id = p_user_id
$$;

revoke all on function public.account_ops_user_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.account_ops_user_status(uuid) to service_role;

-- The members of an organisation, for the sign-out of all of them.
create function public.account_ops_organization_members(p_org uuid) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id from public.organization_members m where m.organization_id = p_org and m.accepted_at is not null
$$;

revoke all on function public.account_ops_organization_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.account_ops_organization_members(uuid) to service_role;
