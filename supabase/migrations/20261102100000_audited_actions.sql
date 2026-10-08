-- Audited actions (FR-F2; ARCHITECTURE.md sections 8, 12; OPEN_QUESTIONS.md D67). Every administrative function writes
-- one complete audit row in the transaction of its change: actor, action, entity, the reason of 10 to 2000 characters
-- and a request id that is never empty. Work done outside the database is recorded against the same request through
-- audit_record_external; the log is kept for the period of retention_policies and exported every month.

-- The export and the retention delete read a month and a day range by time; the page of the audit search sorts by
-- (created_at, id), so one index serves all three. A step of an account-ops job is written once per job: the unique
-- index is the guard (metadata.job_id of other rows is a vacancy).
drop index audit.log_created_at_idx;
create index log_created_at_id_idx on audit.log (created_at, id);
create unique index log_job_step_idx on audit.log (action, (metadata ->> 'job_id'))
  where action like 'account_ops.%' and metadata ->> 'job_id' is not null;

-- The one insert. The actor is a parameter here and nowhere that an API role can reach: audit.record passes the caller,
-- audit_record_external the actor an Edge Function carries from the job.
create function audit.record_as(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb, p_ip inet default null
) returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into audit.log (actor_id, action, entity_type, entity_id, metadata, ip)
  values (p_actor, p_action, p_entity_type, p_entity_id, p_metadata, p_ip)
  returning id
$$;

revoke all on function audit.record_as(uuid, text, text, text, jsonb, inet) from public, anon, authenticated, service_role;

create or replace function audit.record(
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_metadata jsonb default '{}'
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip inet;
begin
  -- The leftmost x-forwarded-for entry is client-supplied: ip is context, not evidence.
  begin
    v_ip := nullif(btrim(split_part(
      nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ',', 1
    )), '')::inet;
  exception when invalid_text_representation then
    v_ip := null;
  end;

  return audit.record_as((select auth.uid()), p_action, p_entity_type, p_entity_id, p_metadata, v_ip);
end;
$$;

-- 20261016100000 with one more case: the retention job deletes rows past their period and says so with a setting that
-- lives for its transaction (private.apply_retention alone sets it). Updates and truncates stay refused for every role.
create or replace function audit.refuse_change() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_subject uuid := private.erasure_subject();
  v_pseudonym uuid := private.erasure_pseudonym();
begin
  if tg_op = 'DELETE' and coalesce(current_setting('chara.retention_run', true), '') = 'on' then
    return old;
  end if;
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

-- The id the web tier sends with each request (header x-request-id) so an audit row can be matched to the request that
-- caused it. A missing or malformed header gets one generated id for the transaction, so every row of a call, a
-- suspended organisation and its vacancies included, carries the same non-empty id.
create or replace function private.request_id() returns text
language plpgsql
set search_path = ''
as $$
declare
  v_header text := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id';
  v_id text;
begin
  if v_header ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return lower(v_header);
  end if;
  v_id := nullif(current_setting('chara.request_id', true), '');
  if v_id is null then
    v_id := gen_random_uuid()::text;
    perform set_config('chara.request_id', v_id, true);
  end if;
  return v_id;
end;
$$;

-- The audit row of an administrative action: the reason and the request id are always in the metadata, whatever else the
-- action adds. Every function that is gated on a platform role writes its row here or through audit.record.
create function private.audit_admin(
  p_action text, p_entity_type text, p_entity_id text, p_reason text, p_extra jsonb default '{}'
) returns bigint
language sql
set search_path = ''
as $$
  select audit.record(
    p_action, p_entity_type, p_entity_id,
    jsonb_strip_nulls(p_extra || jsonb_build_object('reason', p_reason, 'request_id', private.request_id()))
  )
$$;

revoke all on function private.audit_admin(text, text, text, text, jsonb) from public, anon, authenticated, service_role;

-- An account-ops job queued by an administrator carries who asked and for which request, so that account-ops can record
-- what it did against both.
create function private.queue_account_op(p_message jsonb) returns void
language sql
set search_path = ''
as $$
  select pgmq.send('account_ops', p_message || jsonb_build_object('actor_id', (select auth.uid()), 'request_id', private.request_id()))
$$;

revoke all on function private.queue_account_op(jsonb) from public, anon, authenticated, service_role;

-- The reason of every administrative function is the statement of reasons: 10 to 2000 characters after trimming.
drop function private.platform_reason(text);

create or replace function private.record_moderation(
  p_target_type text, p_target_id uuid, p_action text, p_audit_action text, p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id)
  values (p_target_type, p_target_id, p_action, p_reason, (select auth.uid()));
  perform private.audit_admin(p_audit_action, p_target_type, p_target_id::text, p_reason);
end;
$$;

-- The audit row of a staff role: the entity is the person the role was granted to or taken from, the staff row is in the
-- metadata. The reason travels in chara.audit_reason (the bootstrap insert of the runbook sets it from its ticket).
create or replace function private.platform_staff_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(current_setting('chara.audit_reason', true), '');
begin
  if tg_op = 'INSERT' then
    perform private.audit_admin(
      'platform_role.grant', 'platform_staff', new.user_id::text, v_reason,
      jsonb_build_object('staff_id', new.id, 'user_id', new.user_id, 'role', new.role, 'granted_by', new.granted_by)
    );
  elsif old.revoked_at is null and new.revoked_at is not null then
    perform private.audit_admin(
      'platform_role.revoke', 'platform_staff', new.user_id::text, v_reason,
      jsonb_build_object('staff_id', new.id, 'user_id', new.user_id, 'role', new.role)
    );
  end if;
  return null;
end;
$$;

create or replace function public.grant_platform_role(p_user_id uuid, p_role text, p_reason text) returns void
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
  v_reason := private.statement_of_reasons(p_reason);
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
  perform private.queue_account_op(jsonb_build_object(
    'action', 'sign_out', 'user_id', p_user_id, 'reason', 'platform_role_granted'
  ));
end;
$$;

create or replace function public.revoke_platform_role(p_user_id uuid, p_role text, p_reason text) returns void
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
  v_reason := private.statement_of_reasons(p_reason);
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
  perform private.queue_account_op(jsonb_build_object(
    'action', 'sign_out', 'user_id', p_user_id, 'reason', 'platform_role_revoked'
  ));
end;
$$;

create or replace function public.reset_mfa(p_user_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_platform_admin();
  v_reason text;
begin
  if p_user_id = v_uid then
    raise exception 'CHARA_FORBIDDEN' using detail = 'own_account';
  end if;
  v_reason := private.statement_of_reasons(p_reason);
  if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'user';
  end if;

  perform private.audit_admin('mfa.reset', 'profile', p_user_id::text, v_reason);
  perform pg_advisory_xact_lock(hashtextextended('reset_mfa:' || p_user_id::text, 0));
  if not exists (select 1 from pgmq.q_account_ops q where q.message ->> 'action' = 'reset_mfa' and q.message ->> 'user_id' = p_user_id::text) then
    perform private.queue_account_op(jsonb_build_object('action', 'reset_mfa', 'user_id', p_user_id));
    perform pgmq.send('notifications', jsonb_build_object('kind', 'mfa_reset', 'user_id', p_user_id, 'mandatory', true));
  end if;
end;
$$;

create or replace function public.suspend_user(p_user_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_status public.profile_status;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_user_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'user';
  end if;

  select p.status into v_status from public.profiles p where p.id = p_user_id for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;
  if exists (select 1 from public.platform_staff s where s.user_id = p_user_id and s.revoked_at is null) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'staff_account';
  end if;

  update public.profiles set status = 'suspended' where id = p_user_id;
  perform private.record_moderation('profile', p_user_id, 'account_suspended', 'user.suspend', v_reason);
  perform private.queue_account_op(jsonb_build_object('action', 'suspend_user', 'user_id', p_user_id));
  perform pgmq.send('notifications', jsonb_build_object(
    'kind', 'account_suspended', 'user_id', p_user_id, 'mandatory', true, 'reasons', v_reason
  ));
end;
$$;

create or replace function public.reinstate_user(p_user_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_status public.profile_status;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_user_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'user';
  end if;

  select p.status into v_status from public.profiles p where p.id = p_user_id for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'suspended' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;

  update public.profiles set status = 'active' where id = p_user_id;
  perform private.record_moderation('profile', p_user_id, 'account_reinstated', 'user.reinstate', v_reason);
  perform private.queue_account_op(jsonb_build_object('action', 'reinstate_user', 'user_id', p_user_id));
  perform pgmq.send('notifications', jsonb_build_object(
    'kind', 'account_reinstated', 'user_id', p_user_id, 'mandatory', true, 'reasons', v_reason
  ));
end;
$$;

create or replace function public.suspend_organization(p_org uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_status public.organization_status;
  v_job uuid;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_org is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'organization';
  end if;

  select o.status into v_status from public.organizations o where o.id = p_org for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;

  update public.organizations set status = 'suspended' where id = p_org;
  perform private.record_moderation('organization', p_org, 'organization_suspended', 'organization.suspend', v_reason);
  for v_job in
    update public.jobs set moderation_state = 'org_suspended'
    where organization_id = p_org and moderation_state = 'visible' and deleted_at is null
    returning id
  loop
    perform private.audit_admin('job.org_suspend', 'job', v_job::text, v_reason, jsonb_build_object('organization_id', p_org));
  end loop;
  perform private.queue_account_op(jsonb_build_object('action', 'sign_out_organization', 'organization_id', p_org));
  perform private.queue_organization_notice('account_suspended', p_org, v_reason);
end;
$$;

create or replace function public.reinstate_organization(p_org uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_status public.organization_status;
  v_job uuid;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_org is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'organization';
  end if;

  select o.status into v_status from public.organizations o where o.id = p_org for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'suspended' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;

  update public.organizations set status = 'active' where id = p_org;
  perform private.record_moderation('organization', p_org, 'organization_reinstated', 'organization.reinstate', v_reason);
  for v_job in
    update public.jobs set moderation_state = 'visible'
    where organization_id = p_org and moderation_state = 'org_suspended'
    returning id
  loop
    perform private.audit_admin('job.org_reinstate', 'job', v_job::text, v_reason, jsonb_build_object('organization_id', p_org));
  end loop;
  perform private.queue_organization_notice('account_reinstated', p_org, v_reason);
end;
$$;

create or replace function public.publish_legal_document(p_slug text, p_title text, p_body text, p_change_summary text, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(p_title, E' \t\r\n');
  v_summary text := btrim(p_change_summary, E' \t\r\n');
  v_version integer;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if p_slug is null or char_length(p_slug) not between 3 and 60 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'slug';
  end if;
  if v_title is null or char_length(v_title) not between 3 and 200 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'title';
  end if;
  if p_body is null or btrim(p_body, E' \t\r\n') = '' or char_length(p_body) > 200000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'body';
  end if;
  if v_summary is null or char_length(v_summary) not between 10 and 1000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'change_summary';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'expected_version';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('legal_document:' || p_slug, 0));
  select coalesce(max(d.version), 0) into v_version from public.legal_documents d where d.slug = p_slug;
  if v_version <> p_expected_version then
    raise exception 'CHARA_CONFLICT' using detail = 'version';
  end if;
  v_version := v_version + 1;
  insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
  values (p_slug, v_version, v_title, p_body, v_summary, now());
  perform private.audit_admin('legal_document.publish', 'legal_document', p_slug || ':' || v_version, v_summary);
  perform private.queue_account_op(jsonb_build_object('action', 'fan_out_legal_version', 'document_slug', p_slug, 'version', v_version));
  return v_version;
end;
$$;

-- The audit search returns the whole row (the Platform Administrator is the only reader), newest first in keyset pages
-- of (created_at, id). The filters are exact matches combined with AND; the dates are days in UTC, both inclusive.
drop function public.admin_search_audit(uuid, text, text, text, date, date, integer, timestamptz, bigint);

create function public.admin_search_audit(
  p_actor uuid default null, p_action text default null, p_entity_type text default null, p_entity_id text default null,
  p_from date default null, p_to date default null,
  p_limit integer default 25, p_after_at timestamptz default null, p_after_id bigint default null
) returns table (
  id bigint, actor_id uuid, action text, entity_type text, entity_id text, metadata jsonb, ip inet, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if p_from > p_to
     or char_length(p_action) > 100 or char_length(p_entity_type) > 100 or char_length(p_entity_id) > 200 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'filter';
  end if;

  return query
  select l.id, l.actor_id, l.action, l.entity_type, l.entity_id, l.metadata, l.ip, l.created_at
  from audit.log l
  where (p_actor is null or l.actor_id = p_actor)
    and (p_action is null or l.action = p_action)
    and (p_entity_type is null or l.entity_type = p_entity_type)
    and (p_entity_id is null or l.entity_id = p_entity_id)
    and (p_from is null or l.created_at >= p_from::timestamp at time zone 'UTC')
    and (p_to is null or l.created_at < (p_to + 1)::timestamp at time zone 'UTC')
    and (p_after_id is null or (l.created_at, l.id) < (p_after_at, p_after_id))
  order by l.created_at desc, l.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

revoke all on function public.admin_search_audit(uuid, text, text, text, date, date, integer, timestamptz, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_audit(uuid, text, text, text, date, date, integer, timestamptz, bigint) to authenticated;

-- An action that happened outside the database, appended by an Edge Function. The actor is the person the job carries,
-- kept only while their profile exists. A row with a job id is written once per action and job: a job that is read
-- again after a crash finds its row and adds none (false).
create function public.audit_record_external(
  p_action text, p_entity_type text, p_entity_id text, p_actor_id uuid default null, p_metadata jsonb default '{}'
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action is null or char_length(p_action) > 100 or p_action !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'action';
  end if;
  if p_entity_type is null or char_length(p_entity_type) not between 1 and 100 or char_length(p_entity_id) > 200 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'entity';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'metadata';
  end if;

  perform audit.record_as(
    (select p.id from public.profiles p where p.id = p_actor_id), p_action, p_entity_type, p_entity_id, p_metadata
  );
  return true;
exception when unique_violation then
  return false;
end;
$$;

revoke all on function public.audit_record_external(text, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.audit_record_external(text, text, text, uuid, jsonb) to service_role;

-- The monthly export: the rows of one finished calendar month (UTC) in pages of (created_at, id), as one jsonb so that
-- the API row limit does not cut a page. The count lets the export check its file against the table.
create function private.export_month(p_month text) returns tstzrange
language plpgsql
stable
set search_path = ''
as $$
declare
  v_start timestamptz;
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'month';
  end if;
  v_start := (p_month || '-01')::date::timestamp at time zone 'UTC';
  if v_start + interval '1 month' > now() then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'month_not_ended';
  end if;
  return tstzrange(v_start, v_start + interval '1 month', '[)');
end;
$$;

revoke all on function private.export_month(text) from public, anon, authenticated, service_role;

create function public.audit_export_month(
  p_month text, p_after_at timestamptz default null, p_after_id bigint default null, p_limit integer default 1000
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_range tstzrange := private.export_month(p_month);
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb) into v_rows
  from (
    select l.id, l.actor_id, l.action, l.entity_type, l.entity_id, l.metadata, l.ip, l.created_at
    from audit.log l
    where l.created_at >= lower(v_range) and l.created_at < upper(v_range)
      and (p_after_id is null or (l.created_at, l.id) > (p_after_at, p_after_id))
    order by l.created_at, l.id
    limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
  ) r;
  return v_rows;
end;
$$;

revoke all on function public.audit_export_month(text, timestamptz, bigint, integer) from public, anon, authenticated, service_role;
grant execute on function public.audit_export_month(text, timestamptz, bigint, integer) to service_role;

create function public.audit_export_count(p_month text) returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_range tstzrange := private.export_month(p_month);
begin
  return (select count(*) from audit.log l where l.created_at >= lower(v_range) and l.created_at < upper(v_range));
end;
$$;

revoke all on function public.audit_export_count(text) from public, anon, authenticated, service_role;
grant execute on function public.audit_export_count(text) to service_role;

-- The first of each month at 03:00 UTC, as the criteria say; nothing is called while the Vault secrets are not set.
select cron.schedule('audit-export-monthly', '0 3 1 * *', $$select private.call_edge_function('audit-export')$$);

-- Six years of 365 days and the leap days between (2191), kept as data like every retention period (OPEN_QUESTIONS.md L6):
-- the owner changes it by migration. private.apply_retention is the function of 20261030100000 with the audit log added.
insert into private.retention_policies (entity, days) values ('audit_log', 2191);

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

  select p.days into v_days from private.retention_policies p where p.entity = 'audit_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.log where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform audit.record(
      'retention.run', 'retention_policies', 'audit_log',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;
end;
$$;
