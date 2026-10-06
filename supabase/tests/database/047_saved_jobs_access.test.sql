begin;
select plan(35);

\ir search_fixture.inc

-- FR-C5 AC5: vacancies of Acme in every state; exactly one can be saved.
create temp table t_ids (label text primary key, id uuid not null);
insert into t_ids
  select 'draft', pg_temp.seed_job('{"title": "Seed draft vacancy", "status": "draft"}')
  union all select 'open', pg_temp.seed_job('{"title": "Seed open vacancy", "status": "open"}')
  union all select 'paused', pg_temp.seed_job('{"title": "Seed paused vacancy", "status": "paused"}')
  union all select 'closed', pg_temp.seed_job('{"title": "Seed closed vacancy", "status": "closed"}')
  union all select 'filled', pg_temp.seed_job('{"title": "Seed filled vacancy", "status": "filled"}')
  union all select 'hidden', pg_temp.seed_job('{"title": "Seed hidden vacancy", "status": "open", "moderation_state": "hidden"}')
  union all select 'suspended', pg_temp.seed_job('{"title": "Seed suspended vacancy", "status": "open", "moderation_state": "org_suspended"}')
  union all select 'deleted', pg_temp.seed_job('{"title": "Seed deleted vacancy", "status": "open", "deleted_at": "2026-01-01T00:00:00Z"}');

select id as open_id from t_ids where label = 'open' \gset

-- A save as the Data API does it: the user's own id and the vacancy, a repeated one ignored.
create function pg_temp.save_sql(p_user uuid, p_job uuid) returns text
language sql as $$
  select format(
    'insert into public.saved_jobs (worker_user_id, job_id) values (%L, %L) on conflict (worker_user_id, job_id) do nothing',
    p_user, p_job
  )
$$;

create function pg_temp.save_as(p_user uuid, p_job uuid) returns text
language sql as $$ select pg_temp.call_as(p_user, 'authenticated', pg_temp.save_sql(p_user, p_job), 'aal1') $$;

create function pg_temp.saved_rows(p_user uuid) returns bigint
language sql as $$ select count(*) from public.saved_jobs where worker_user_id = p_user $$;

-- Structure.
select ok(
  (select c.relrowsecurity and c.relforcerowsecurity from pg_class c where c.oid = 'public.saved_jobs'::regclass),
  'saved_jobs has row level security enabled and forced'
);
select is(
  (select array_agg(a.attname::text order by a.attnum) from pg_index i
   join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = 'public.saved_jobs'::regclass and i.indisprimary),
  array['worker_user_id', 'job_id'], 'the primary key is (worker_user_id, job_id)'
);
select is(
  (select array_agg(policyname::text order by policyname) from pg_policies where tablename = 'saved_jobs' and schemaname = 'public'),
  array['saved_jobs_delete_own', 'saved_jobs_insert_own', 'saved_jobs_select_own'],
  'saved_jobs has an own-rows policy for select, insert and delete and none for update'
);
select ok(
  not has_table_privilege('anon', 'public.saved_jobs', 'select, insert, update, delete')
  and not has_any_column_privilege('anon', 'public.saved_jobs', 'select, insert, update')
  and not has_table_privilege('service_role', 'public.saved_jobs', 'select, insert, update, delete')
  and not has_table_privilege('authenticated', 'public.saved_jobs', 'update')
  and not has_any_column_privilege('authenticated', 'public.saved_jobs', 'update'),
  'anon and service_role hold no privilege and authenticated cannot update'
);
select ok(
  exists (select 1 from pg_indexes where tablename = 'saved_jobs' and indexdef like '%(worker_user_id, created_at DESC, job_id DESC)%')
  and exists (select 1 from pg_indexes where tablename = 'saved_jobs' and indexdef like '%(job_id)%'),
  'saved_jobs has the index of the list order and the index of the foreign key to jobs'
);

-- FR-C5 AC5: only the open, visible, undeleted vacancy is saved.
select is(pg_temp.save_as(:'wa', :'open_id'), 'ok', 'a candidate saves the open vacancy');
select is(
  (select string_agg(t.label || '=' || split_part(pg_temp.save_as(:'wb', t.id), '|', 1), ',' order by t.label)
   from t_ids t where t.label <> 'open'),
  'closed=42501,deleted=42501,draft=42501,filled=42501,hidden=42501,paused=42501,suspended=42501',
  'the other seven states are refused by row level security'
);
select is(
  pg_temp.save_as(:'wb', '6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11'), '42501|new row violates row-level security policy for table "saved_jobs"|',
  'a vacancy that does not exist is refused the same way'
);
select is(pg_temp.saved_rows(:'wb'), 0::bigint, 'the eight refused attempts created no row');

-- FR-C5 AC3: saving and unsaving are idempotent.
select is(pg_temp.save_as(:'wa', :'open_id'), 'ok', 'the second save returns no error');
select is(pg_temp.saved_rows(:'wa'), 1::bigint, 'exactly one row exists for the pair after two saves');
select is(
  pg_temp.call_as(:'wa', 'authenticated', format('delete from public.saved_jobs where job_id = %L', :'open_id'), 'aal1'), 'ok',
  'the first unsave returns no error'
);
select is(pg_temp.saved_rows(:'wa'), 0::bigint, 'the row is gone');
select is(
  pg_temp.call_as(:'wa', 'authenticated', format('delete from public.saved_jobs where job_id = %L', :'open_id'), 'aal1'), 'ok',
  'the second unsave is a no-op without error'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format('delete from public.saved_jobs where job_id = %L', :'open_id')), 0::bigint,
  'and deletes no row'
);
select is(
  split_part(pg_temp.call_as(:'wa', 'authenticated', format('insert into public.saved_jobs (job_id) values (%L)', :'open_id'), 'aal1'), '|', 1),
  'ok', 'the user id of the row defaults to the caller'
);
select is(
  split_part(pg_temp.call_as(:'wa', 'authenticated', format('insert into public.saved_jobs (job_id) values (%L)', :'open_id'), 'aal1'), '|', 1),
  '23505', 'a plain repeated insert is refused by the primary key'
);

-- The audit trail of the KPI: one row for the save that added a row, none for the repeated saves.
select is(
  (select count(*) from audit.log where action = 'saved_job.created' and actor_id = :'wa' and entity_id = :'open_id'),
  2::bigint, 'one audit row per saved row that was added (the first save and the later plain insert)'
);

-- FR-C5 AC4: private and for candidates only.
select id as second_open from (select pg_temp.seed_job('{"title": "Second open vacancy", "status": "open"}') as id) s \gset
select is(pg_temp.save_as(:'wa', :'second_open'), 'ok', 'candidate A has two saved rows');
select is(pg_temp.affected_as(:'wb', 'authenticated', 'select * from public.saved_jobs'), 0::bigint, 'candidate B selects 0 rows');
select is(pg_temp.affected_as(:'wb', 'authenticated', 'delete from public.saved_jobs'), 0::bigint, 'candidate B deletes 0 rows');
select is(
  split_part(pg_temp.call_as(:'wb', 'authenticated', pg_temp.save_sql(:'wa', :'open_id'), 'aal1'), '|', 1), '42501',
  'candidate B cannot insert a row for candidate A'
);
select is(
  split_part(pg_temp.call_as(:'own1', 'authenticated', pg_temp.save_sql(:'own1', :'open_id'), 'aal1'), '|', 1), '42501',
  'a company user cannot save, even a vacancy of its own organisation'
);
select is(
  split_part(pg_temp.call_as(:'adm', 'authenticated', pg_temp.save_sql(:'adm', :'second_open'), 'aal1'), '|', 1), '42501',
  'nor can an admin or a member'
);
select is(
  split_part(pg_temp.call_as(null, 'anon', 'select * from public.saved_jobs'), '|', 1), '42501',
  'an anonymous caller is refused for lack of a grant'
);
select is(
  split_part(pg_temp.call_as(null, 'anon', pg_temp.save_sql(:'wa', :'open_id')), '|', 1), '42501',
  'an anonymous caller cannot insert either'
);
select is(pg_temp.saved_rows(:'wa'), 2::bigint, 'the rows of candidate A are unchanged');
select is(pg_temp.affected_as(:'own1', 'authenticated', 'select * from public.saved_jobs'), 0::bigint, 'a company user selects nothing');
select is(
  split_part(pg_temp.call_as(:'wa', 'authenticated', format('update public.saved_jobs set created_at = now() where job_id = %L', :'open_id'), 'aal1'), '|', 1),
  '42501', 'a row cannot be updated'
);
select is(
  split_part(pg_temp.call_as(:'wa', 'authenticated', format('update public.saved_jobs set worker_user_id = %L where job_id = %L', :'wb', :'open_id'), 'aal1'), '|', 1),
  '42501', 'a row cannot be given to another candidate'
);

-- A candidate who saved a vacancy keeps the row when the vacancy leaves the public state, and can still remove it.
select pg_temp.set_status(:'own1', :'second_open', 'closed') as closed \gset
select is(pg_temp.saved_rows(:'wa'), 2::bigint, 'closing a vacancy keeps the saved row');
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format('delete from public.saved_jobs where job_id = %L', :'second_open')), 1::bigint,
  'the candidate can remove the row of a closed vacancy'
);

-- The rows follow the vacancy and the account.
delete from public.jobs where id = :'open_id';
select is(pg_temp.saved_rows(:'wa'), 0::bigint, 'deleting a vacancy deletes its saved rows');

insert into public.saved_jobs (worker_user_id, job_id) values (:'wnew', :'second_open');
select is(
  (select array_agg(c.confdeltype::text order by c.conname) from pg_constraint c where c.conrelid = 'public.saved_jobs'::regclass and c.contype = 'f'),
  array['c', 'c'], 'both foreign keys cascade, so erase_user (it deletes the profile) removes the rows of the account'
);
delete from public.profiles where id = :'wnew';
select is(pg_temp.saved_rows(:'wnew'), 0::bigint, 'deleting the profile of a candidate deletes the saved rows');

select * from finish();
rollback;
