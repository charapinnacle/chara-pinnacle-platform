begin;
select plan(9);

\ir apply_fixture.inc

-- Five applications of candidate A (the vacancy of the first one is hidden later), one of candidate B.
create temp table t_jobs as
  select n, pg_temp.open_job('Listed vacancy ' || n) as id from generate_series(1, 5) n;
create temp table t_apps (n integer primary key, id uuid not null);
create function pg_temp.apply_n(p_user uuid, p_n integer) returns uuid
language plpgsql as $$
begin
  perform set_config('t.x', pg_temp.apply_as(p_user, (select id from t_jobs where n = p_n)), true);
  update public.job_applications set created_at = now() - make_interval(mins => 10 - p_n) where id = current_setting('t.app')::uuid;
  return current_setting('t.app')::uuid;
end;
$$;
insert into t_apps select n, pg_temp.apply_n(:'wa', n) from generate_series(1, 5) n;
select pg_temp.apply_n(:'wb', 1) as wb_first \gset
select set_config('t.wb_app', current_setting('t.app'), true) as keep \gset

-- The page keeps the application after the vacancy has left the public site (the list is covered by 061).
select pg_temp.set_status(:'own1', (select id from t_jobs where n = 1), 'paused') as paused \gset
select pg_temp.set_status(:'own1', (select id from t_jobs where n = 2), 'closed') as closed \gset
update public.jobs set moderation_state = 'hidden' where id = (select id from t_jobs where n = 3);
create function pg_temp.get_as(p_user uuid, p_id uuid, p_role text default 'authenticated') returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', 'aal1')::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(g)), ''[]'') from public.get_my_application(%L) g', p_id) into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    v_result := to_jsonb(v_state || '|' || v_message);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;
select is(
  (pg_temp.get_as(:'wa', (select id from t_apps where n = 5)) -> 0) - 'id' - 'job_id' - 'applied_at',
  jsonb_build_object('job_title', 'Listed vacancy 5', 'vacancy_is_open', true, 'status', 'applied', 'cover_note', null,
                     'employer_display_name', (select display_name from public.organizations where id = current_setting('t.a')::uuid)),
  'get_my_application gives the vacancy and whether it can still be opened'
);
select is(
  (select string_agg((pg_temp.get_as(:'wa', a.id) -> 0 ->> 'vacancy_is_open'), ',' order by a.n) from t_apps a),
  'false,false,false,true,true', 'the vacancy of a paused, closed or hidden vacancy cannot be opened; an open one can'
);
select is(pg_temp.get_as(:'wb', (select id from t_apps where n = 5)), '[]'::jsonb, 'another candidate gets no row for the application');
select is(pg_temp.get_as(:'wa', gen_random_uuid()), '[]'::jsonb, 'an unknown id gives no row');
select is(pg_temp.get_as(:'own1', (select id from t_apps where n = 5)), to_jsonb('P0001|CHARA_FORBIDDEN'::text), 'a company user is refused');
select is(pg_temp.get_as(null, (select id from t_apps where n = 5), 'anon'), to_jsonb('42501|permission denied for function get_my_application'::text), 'an anonymous caller has no EXECUTE');

-- The cover note of the candidate is shown back to the candidate, to nobody else.
select pg_temp.apply_as(:'wb', pg_temp.open_job('Note vacancy'), 'My note') as noted \gset
select is(pg_temp.get_as(:'wb', current_setting('t.app')::uuid) -> 0 ->> 'cover_note', 'My note', 'the page shows the own cover note');

-- Indexes.
select is(
  (select count(*) from pg_indexes where tablename = 'job_applications' and indexname in
    ('job_applications_worker_created_idx', 'job_applications_one_active_per_job_worker', 'job_applications_job_status_idx', 'job_applications_organization_idx')),
  4::bigint, 'the list, the duplicate rule, the vacancy and the organisation each have an index'
);
select is(
  (select count(*) from pg_indexes where tablename = 'application_events' and indexname in ('application_events_application_idx', 'application_events_actor_idx')),
  2::bigint, 'the timeline and the erasure each have an index on the events'
);

select * from finish();
rollback;
