-- Append-only audit log (FR-F2, NFR-C3). Rows are written only by audit.record();
-- reason and request id of an administrative action travel in metadata.

create table audit.log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null check (action <> ''),
  entity_type text not null check (entity_type <> ''),
  entity_id text,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  ip inet,
  created_at timestamptz not null default now()
);

create index log_created_at_idx on audit.log (created_at);

alter table audit.log enable row level security;
alter table audit.log force row level security;
revoke all on table audit.log from public, anon, authenticated, service_role;

create function audit.refuse_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit.log is append-only' using errcode = '42501';
end;
$$;

create trigger log_append_only
  before update or delete on audit.log
  for each row execute function audit.refuse_change();

create trigger log_no_truncate
  before truncate on audit.log
  for each statement execute function audit.refuse_change();

-- ENABLE ALWAYS so session_replication_role = replica (pg_restore --disable-triggers,
-- logical replication apply) does not bypass the append-only control.
alter table audit.log enable always trigger log_append_only;
alter table audit.log enable always trigger log_no_truncate;

create function audit.record(
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
  v_id bigint;
begin
  -- The leftmost x-forwarded-for entry is client-supplied: ip is context, not evidence.
  begin
    v_ip := nullif(btrim(split_part(
      nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ',', 1
    )), '')::inet;
  exception when invalid_text_representation then
    v_ip := null;
  end;

  insert into audit.log (actor_id, action, entity_type, entity_id, metadata, ip)
  values ((select auth.uid()), p_action, p_entity_type, p_entity_id, p_metadata, v_ip)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function audit.record(text, text, text, jsonb) from public, anon, authenticated, service_role;
