-- Quotas on the authenticated writes that fan out to storage and to the immutable audit log (security review SA-06;
-- NFR-S6 "rate limits on abuse-prone operations"; OPEN_QUESTIONS.md D79). A candidate keeps at most worker_documents_max
-- documents (each one may receive a 15 MiB object and writes audit rows that are archived for good), and a user and an
-- organisation make at most a daily number of the writes below. The counters are rows of private.rate_limit_hits under
-- user:audited_write and user:org_audited_write (private.check_rate_limit), so a refusal raises CHARA_RATE_LIMITED and
-- rolls the write back. Only a user's writes to the own tenant count: the candidate's own documents, a member's vacancies
-- and notes. Platform staff (moderation, suspension), billing events and scheduled jobs are never counted, so an
-- exhausted quota cannot stop a control.
insert into private.settings (key, value) values
  ('worker_documents_max', '50'),
  ('rate_limit_audited_write_max', '500'),
  ('rate_limit_audited_write_seconds', '86400'),
  ('rate_limit_org_audited_write_max', '2000'),
  ('rate_limit_org_audited_write_seconds', '86400');

-- Counts one write against the caller and, when p_org is given, against the organisation.
create function private.count_audited_write(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_rate_limit('audited_write', (select auth.uid()));
  if p_org is not null then
    perform private.check_rate_limit('org_audited_write', p_org);
  end if;
end;
$$;

revoke all on function private.count_audited_write(uuid) from public, anon, authenticated, service_role;

-- A new document (audit row document.created, then an object) and a rename (document.renamed). Deleting goes through
-- delete_worker_document and needs a document first, so it is bounded by the inserts. The count of live documents reads
-- worker_documents_owner_created_idx; the profile row lock makes two parallel inserts wait for each other, as for the
-- passport lists (worker_list_limit).
create function private.worker_documents_quota() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'worker_documents_max');
begin
  if new.worker_user_id is distinct from (select auth.uid()) or (tg_op = 'UPDATE' and new.title is not distinct from old.title) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform 1 from public.worker_profiles p where p.user_id = new.worker_user_id for no key update;
    if (select count(*) from public.worker_documents d where d.worker_user_id = new.worker_user_id and d.deleted_at is null) >= coalesce(v_max, 0) then
      raise exception 'CHARA_LIMIT_REACHED' using detail = 'worker_documents';
    end if;
  end if;
  perform private.count_audited_write(null);
  return new;
end;
$$;

revoke all on function private.worker_documents_quota() from public, anon, authenticated, service_role;

create trigger worker_documents_quota
  before insert or update of title on public.worker_documents
  for each row execute function private.worker_documents_quota();

alter table public.worker_documents enable always trigger worker_documents_quota;

-- Every insert or update of a vacancy by a member of its organisation writes job.created, job.updated or
-- job.status_changed.
create function private.jobs_quota() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id in (select private.member_org_ids()) then
    perform private.count_audited_write(new.organization_id);
  end if;
  return new;
end;
$$;

revoke all on function private.jobs_quota() from public, anon, authenticated, service_role;

create trigger jobs_quota
  before insert or update on public.jobs
  for each row execute function private.jobs_quota();

alter table public.jobs enable always trigger jobs_quota;

-- Notes have no count limit of their own; application_notes_guard of 20261109110000 with the quota added.
create or replace function private.application_notes_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id in (select private.member_org_ids()) then
    perform private.assert_member_aal2(new.organization_id);
    if exists (select 1 from public.organizations o where o.id = new.organization_id and o.status <> 'active') then
      raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
    end if;
    perform private.assert_org_writable(new.organization_id);
    perform private.count_audited_write(new.organization_id);
  end if;
  return new;
end;
$$;
