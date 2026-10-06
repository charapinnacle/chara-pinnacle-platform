-- Document access log (FR-B5; ARCHITECTURE.md sections 7.3, 14; OPEN_QUESTIONS.md D16, D43, D44). The log table and the one
-- function that writes it came with FR-B3. This migration makes the log tamper-proof, lets the candidate read their own
-- entries through a view, indexes what the page and the retention job read, and adds the retention rule.

create index document_access_log_owner_idx on audit.document_access_log (worker_user_id, accessed_at desc, id desc);
create index document_access_log_share_idx on audit.document_access_log (share_id) where share_id is not null;
create index document_access_log_accessed_at_idx on audit.document_access_log (accessed_at);

-- Append-only like audit.log, with one exception: the retention job deletes expired rows and says so with a setting that
-- lives for its transaction. Updates and truncates are refused for every role, the table owner included.
create function audit.document_access_log_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('chara.retention_run', true), '') = 'on' then
    return old;
  end if;
  raise exception 'audit.document_access_log is append-only' using errcode = '42501';
end;
$$;

revoke all on function audit.document_access_log_guard() from public, anon, authenticated, service_role;

create trigger document_access_log_append_only
  before update or delete on audit.document_access_log
  for each row execute function audit.document_access_log_guard();

create trigger document_access_log_no_truncate
  before truncate on audit.document_access_log
  for each statement execute function audit.document_access_log_guard();

alter table audit.document_access_log enable always trigger document_access_log_append_only;
alter table audit.document_access_log enable always trigger document_access_log_no_truncate;

-- The candidate reads the own rows, and never accessed_by, the person at the organisation who opened the file. Nobody
-- can write: there is no insert grant, so only document_access_grant (a definer) adds rows.
grant usage on schema audit to authenticated;
grant select (id, document_id, worker_user_id, organization_id, purpose, accessed_at)
  on audit.document_access_log to authenticated;

create policy document_access_log_select_own on audit.document_access_log
  for select to authenticated
  using (worker_user_id = (select auth.uid()));

-- The organisation is read by the id of a log row the caller owns: organizations is readable by members only, and this
-- names nothing but the organisations that opened the caller's own documents.
create function private.access_log_organization_name(p_log_id bigint) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.display_name
  from audit.document_access_log l
  join public.organizations o on o.id = l.organization_id
  where l.id = p_log_id and l.worker_user_id = (select auth.uid())
$$;

revoke all on function private.access_log_organization_name(bigint) from public, anon, authenticated, service_role;
grant execute on function private.access_log_organization_name(bigint) to authenticated;

-- Openings by other people only: the owner's own downloads are logged but not listed. A deleted document is not readable
-- under the owner's policy, so its title is null. id is the keyset cursor of the page.
create view public.v_my_document_access_log with (security_invoker = true) as
select
  l.id,
  private.access_log_organization_name(l.id) as organization_name,
  d.title as document_title,
  l.accessed_at,
  l.purpose
from audit.document_access_log l
left join public.worker_documents d on d.id = l.document_id
where l.organization_id is not null;

revoke all on public.v_my_document_access_log from public, anon, authenticated, service_role;
grant select on public.v_my_document_access_log to authenticated;

-- Retention periods in days, one row per entity; the owner changes a period by migration until an administrator page
-- exists (OPEN_QUESTIONS.md L6). 730 days is 24 months.
create table private.retention_policies (
  entity text primary key check (entity <> ''),
  days integer not null check (days >= 1)
);

alter table private.retention_policies enable row level security;
alter table private.retention_policies force row level security;
revoke all on table private.retention_policies from public, anon, authenticated, service_role;

insert into private.retention_policies (entity, days) values ('document_access_log', 730);

-- Idempotent: a second run the same day finds nothing to remove. Each run is audited with the period and the count.
create function private.apply_retention() returns void
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
end;
$$;

revoke all on function private.apply_retention() from public, anon, authenticated, service_role;

select cron.schedule('apply-retention', '17 3 * * *', 'select private.apply_retention()');
