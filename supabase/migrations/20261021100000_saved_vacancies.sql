-- Saved vacancies (FR-C5; ARCHITECTURE.md section 4; OPEN_QUESTIONS.md D51). A candidate keeps a shortlist of vacancies
-- in public.saved_jobs, one row per (candidate, vacancy). The candidate saves and unsaves straight through the Data API
-- under row level security: the policies let only a worker account touch its own rows and only an Open, visible,
-- undeleted vacancy be saved. The list is read through list_saved_jobs, a definer function, because a vacancy that was
-- saved while public can later be paused, closed, filled, hidden by moderation, suspended with its organisation or
-- deleted, and the list must say which without disclosing what moderation withdrew. A daily job removes the rows of
-- vacancies that have been Closed, Filled or deleted for more than the days of the retention policy 'saved_jobs' (90).

insert into private.retention_policies (entity, days) values ('saved_jobs', 90);

-- worker_user_id follows the profile, so erase_user (FR-B6) removes the rows with it, and job_id follows the vacancy.
create table public.saved_jobs (
  worker_user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (worker_user_id, job_id)
);

comment on table public.saved_jobs is
  'A candidate''s shortlist of vacancies. Written by the candidate through the Data API; removed by the candidate or, once the vacancy has been Closed or Filled for long enough, by private.cleanup_saved_jobs.';

-- The list reads one candidate's rows newest first (keyset on created_at and job_id); the foreign key to jobs needs an
-- index for the cascade when a vacancy is deleted and for the clean-up join. The primary key serves every policy test.
create index saved_jobs_list_idx on public.saved_jobs (worker_user_id, created_at desc, job_id desc);
create index saved_jobs_job_idx on public.saved_jobs (job_id);
-- The clean-up finds the vacancies that have been Closed or Filled, or deleted, for more than the period; Draft, Open
-- and Paused vacancies that were never deleted, the bulk of the rows, cost these indexes nothing.
create index jobs_closed_filled_idx on public.jobs (status_changed_at) where status in ('closed', 'filled');
create index jobs_deleted_idx on public.jobs (deleted_at) where deleted_at is not null;

alter table public.saved_jobs enable row level security;
alter table public.saved_jobs force row level security;

-- No update: a saved row has nothing to change. No grant to anon.
grant select, delete on public.saved_jobs to authenticated;
grant insert (worker_user_id, job_id) on public.saved_jobs to authenticated;

create policy saved_jobs_select_own on public.saved_jobs
  for select to authenticated
  using (worker_user_id = (select auth.uid()));

-- The vacancy is read under the caller's own rights, so a candidate can save exactly what jobs_select_public shows them.
create policy saved_jobs_insert_own on public.saved_jobs
  for insert to authenticated
  with check (
    worker_user_id = (select auth.uid())
    and (select private.account_kind()) = 'worker'
    and exists (
      select 1 from public.jobs j
      where j.id = job_id and j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible'
    )
  );

create policy saved_jobs_delete_own on public.saved_jobs
  for delete to authenticated
  using (worker_user_id = (select auth.uid()));

-- One audit row the first time a candidate saves a vacancy, which is what the KPI "saved-to-applied conversion" counts:
-- the saves of a period against the applications that follow them. The audit log is append-only, so a candidate who
-- saves and unsaves in a loop must not add a row per cycle: a pair that already has its row adds none. Unsaving and the
-- clean-up leave no row of their own; the clean-up writes one summary row per run.
create function private.saved_jobs_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from audit.log l
    where l.action = 'saved_job.created' and l.entity_id = new.job_id::text and l.actor_id = (select auth.uid())
  ) then
    perform audit.record('saved_job.created', 'job', new.job_id::text);
  end if;
  return null;
end;
$$;

revoke all on function private.saved_jobs_audit() from public, anon, authenticated, service_role;

create trigger saved_jobs_audit
  after insert on public.saved_jobs
  for each row execute function private.saved_jobs_audit();

alter table public.saved_jobs enable always trigger saved_jobs_audit;

-- The saved list of the calling candidate: newest saved first, in keyset pages. A vacancy that is Open, Paused, Closed or
-- Filled and visible gives its title, employer name and status; one that is hidden, suspended, deleted or still a draft
-- gives only the id, the saving time and available = false, with no title, employer or status, so nothing moderation
-- withdrew can be read here. No description, reason or moderation state is ever returned.
--   p_cursor  the next_cursor of the last row of the previous page
--   p_limit   1 to 50, 20 when missing
-- Errors are the stable messages of the other functions: CHARA_FORBIDDEN for a caller who is not a signed-in worker,
-- CHARA_INVALID_INPUT with the parameter in the detail.
create function public.list_saved_jobs(p_cursor text default null, p_limit integer default null) returns table (
  job_id uuid,
  saved_at timestamptz,
  available boolean,
  status public.job_status,
  title text,
  employer_display_name text,
  next_cursor text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_cursor_created timestamptz;
  v_cursor_id uuid;
begin
  if v_uid is null or private.account_kind() is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  if p_cursor is not null then
    begin
      if p_cursor !~ '^[0-9T:.Z-]+\|[0-9a-f-]{36}$' then
        raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
      end if;
      v_cursor_created := split_part(p_cursor, '|', 1)::timestamptz;
      v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end;
  end if;

  return query
  with page as (
    select s.job_id, s.created_at, row_number() over (order by s.created_at desc, s.job_id desc) as n
    from public.saved_jobs s
    where s.worker_user_id = v_uid
      and (v_cursor_id is null or (s.created_at, s.job_id) < (v_cursor_created, v_cursor_id))
    order by s.created_at desc, s.job_id desc
    limit v_limit + 1
  )
  select
    p.job_id, p.created_at, d.id is not null, d.status, d.title, d.display_name,
    case
      when p.n = v_limit and exists (select 1 from page x where x.n > v_limit)
        then to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p.job_id
    end
  from page p
  left join lateral (
    select j.id, j.status, j.title, o.display_name
    from public.jobs j
    join public.organizations o on o.id = j.organization_id
    where j.id = p.job_id and j.deleted_at is null and j.moderation_state = 'visible' and j.status <> 'draft'
  ) d on true
  where p.n <= v_limit
  order by p.n;
end;
$$;

revoke all on function public.list_saved_jobs(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_saved_jobs(text, integer) to authenticated;

-- Runs daily. Removes the saved rows of every vacancy that has been Closed or Filled for more than the days of the
-- retention policy 'saved_jobs' (the days run from status_changed_at, so a vacancy that is reopened starts again) and
-- of every vacancy that was deleted more than that many days ago; Paused and hidden vacancies are flagged in the list
-- but kept (moderation has no timestamp to age on). A second run removes nothing more. One audit row per run says how
-- many rows went, so the control is visible without reading the table. A missing policy fails the run, which
-- cron.job_run_details shows, instead of a run that looks healthy and removes nothing.
create function private.cleanup_saved_jobs() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := (select p.days from private.retention_policies p where p.entity = 'saved_jobs');
  v_cutoff timestamptz;
  v_removed bigint;
begin
  if v_days is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'saved_jobs';
  end if;
  v_cutoff := now() - make_interval(days => v_days);
  delete from public.saved_jobs s
  using public.jobs j
  where j.id = s.job_id
    and ((j.status in ('closed', 'filled') and j.status_changed_at < v_cutoff)
      or (j.deleted_at is not null and j.deleted_at < v_cutoff));
  get diagnostics v_removed = row_count;
  perform audit.record(
    'saved_jobs.cleanup', 'saved_jobs', null, jsonb_build_object('days', v_days, 'removed', v_removed)
  );
  return v_removed;
end;
$$;

revoke all on function private.cleanup_saved_jobs() from public, anon, authenticated, service_role;

select cron.schedule('cleanup-saved-jobs', '47 3 * * *', 'select private.cleanup_saved_jobs()');
