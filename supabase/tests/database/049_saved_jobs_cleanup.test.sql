begin;
select plan(17);

\ir search_fixture.inc

-- FR-C5 AC8: one saved row for each of these vacancies; the number is how long ago the status last changed.
create temp table t_ids (label text primary key, id uuid not null);
insert into t_ids
  select 'closed91', pg_temp.seed_job(jsonb_build_object('title', 'Closed 91 days', 'status', 'closed', 'status_changed_at', (now() - interval '91 days')::text))
  union all select 'filled91', pg_temp.seed_job(jsonb_build_object('title', 'Filled 91 days', 'status', 'filled', 'status_changed_at', (now() - interval '91 days')::text))
  union all select 'closed90', pg_temp.seed_job(jsonb_build_object('title', 'Closed 90 days', 'status', 'closed', 'status_changed_at', (now() - interval '90 days')::text))
  union all select 'closed89', pg_temp.seed_job(jsonb_build_object('title', 'Closed 89 days', 'status', 'closed', 'status_changed_at', (now() - interval '89 days')::text))
  union all select 'paused120', pg_temp.seed_job(jsonb_build_object('title', 'Paused 120 days', 'status', 'paused', 'status_changed_at', (now() - interval '120 days')::text))
  union all select 'hidden120', pg_temp.seed_job(jsonb_build_object('title', 'Hidden 120 days', 'status', 'open', 'moderation_state', 'hidden', 'status_changed_at', (now() - interval '120 days')::text))
  union all select 'deleted91', pg_temp.seed_job(jsonb_build_object('title', 'Deleted 91 days ago', 'status', 'open', 'deleted_at', (now() - interval '91 days')::text))
  union all select 'deleted89', pg_temp.seed_job(jsonb_build_object('title', 'Deleted 89 days ago', 'status', 'open', 'deleted_at', (now() - interval '89 days')::text))
  union all select 'open', pg_temp.seed_job('{"title": "Open vacancy", "status": "open"}')
  union all select 'reopened', pg_temp.seed_job(jsonb_build_object('title', 'Reopened yesterday', 'status', 'open', 'status_changed_at', (now() - interval '1 day')::text));

insert into public.saved_jobs (worker_user_id, job_id) select :'wa', t.id from t_ids t;
insert into public.saved_jobs (worker_user_id, job_id) select :'wb', t.id from t_ids t where t.label in ('closed91', 'open');

create function pg_temp.kept() returns text
language sql as $$
  select string_agg(t.label, ',' order by t.label)
  from t_ids t join public.saved_jobs s on s.job_id = t.id and s.worker_user_id = current_setting('t.wa')::uuid
$$;
select set_config('t.wa', :'wa', true) as keep \gset

select is(
  (select days from private.retention_policies where entity = 'saved_jobs'), 90, 'the period is a retention policy, 90 days'
);
select is(
  private.cleanup_saved_jobs(), 4::bigint,
  'the first run removes four rows: the three of candidate A (closed, filled, deleted) and the one of candidate B'
);
select is(
  pg_temp.kept(), 'closed89,closed90,deleted89,hidden120,open,paused120,reopened',
  'only the vacancies closed, filled or deleted more than 90 days ago lost their rows; 90 and 89 days, paused, hidden, open and reopened stay'
);
select is(
  (select count(*) from public.saved_jobs s join t_ids t on t.id = s.job_id where s.worker_user_id = :'wb'), 1::bigint,
  'the rows of the other candidate are cleaned by the same rule and the open one stays'
);
select is(private.cleanup_saved_jobs(), 0::bigint, 'the second run removes nothing further');
select is(
  pg_temp.kept(), 'closed89,closed90,deleted89,hidden120,open,paused120,reopened', 'and changes nothing'
);

-- One audit row per run, with the period and the number removed.
select is(
  (select jsonb_agg(metadata order by id) from audit.log where action = 'saved_jobs.cleanup'),
  '[{"days": 90, "removed": 4}, {"days": 90, "removed": 0}]'::jsonb, 'each run writes one audit row with the period and the number of rows removed'
);

-- The period is data: a shorter one takes the rows of the vacancies closed between 30 and 90 days ago.
update private.retention_policies set days = 30 where entity = 'saved_jobs';
select is(private.cleanup_saved_jobs(), 3::bigint, 'with 30 days the rows closed 89 and 90 days ago and deleted 89 days ago go');
select is(pg_temp.kept(), 'hidden120,open,paused120,reopened', 'and the rest stays');

-- A missing policy fails the run instead of a run that removes nothing and looks healthy.
delete from private.retention_policies where entity = 'saved_jobs';
select throws_ok(
  'select private.cleanup_saved_jobs()', 'P0001', 'CHARA_SETTING_MISSING', 'a run without the retention policy fails'
);
select is(
  (select count(*) from audit.log where action = 'saved_jobs.cleanup'), 3::bigint, 'and writes no audit row'
);

-- The job and who can run it.
select is(
  (select schedule from cron.job where jobname = 'cleanup-saved-jobs'), '47 3 * * *', 'a pg_cron job runs the clean-up daily'
);
select is(
  (select command from cron.job where jobname = 'cleanup-saved-jobs'), 'select private.cleanup_saved_jobs()',
  'and its command is the function'
);
select ok(
  not has_function_privilege('authenticated', 'private.cleanup_saved_jobs()', 'execute')
  and not has_function_privilege('anon', 'private.cleanup_saved_jobs()', 'execute')
  and not has_function_privilege('service_role', 'private.cleanup_saved_jobs()', 'execute'),
  'no API role can execute the clean-up'
);
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
   where p.proname = 'cleanup_saved_jobs' and p.pronamespace = 'private'::regnamespace),
  true, 'it is a definer function with an empty search path'
);

-- The clean-up reads the vacancies through a partial index on the status the rule names.
select ok(
  exists (select 1 from pg_indexes where indexname = 'jobs_closed_filled_idx'
          and indexdef like '%(status_changed_at)%' and indexdef like '%closed%' and indexdef like '%filled%'),
  'jobs has a partial index on status_changed_at for the closed and filled vacancies'
);
select ok(
  exists (select 1 from pg_indexes where indexname = 'jobs_deleted_idx' and indexdef like '%(deleted_at)%' and indexdef like '%IS NOT NULL%'),
  'and a partial index on deleted_at for the deleted vacancies'
);
select * from finish();
rollback;
