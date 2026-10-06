begin;
select plan(24);

\ir search_fixture.inc

-- FR-C5 AC6: a candidate saved vacancies that are now in every state; written by the database owner, one hour apart,
-- the oldest first, so the list order is known.
create temp table t_ids (label text primary key, id uuid not null, n integer not null);
insert into t_ids
  select 'open', pg_temp.seed_job('{"title": "Seed open vacancy", "status": "open"}'), 1
  union all select 'paused', pg_temp.seed_job('{"title": "Seed paused vacancy", "status": "paused"}'), 2
  union all select 'closed', pg_temp.seed_job('{"title": "Seed closed vacancy", "status": "closed"}'), 3
  union all select 'filled', pg_temp.seed_job('{"title": "Seed filled vacancy", "status": "filled"}'), 4
  union all select 'hidden', pg_temp.seed_job('{"title": "Seed hidden vacancy", "status": "open", "moderation_state": "hidden"}'), 5
  union all select 'suspended', pg_temp.seed_job('{"title": "Seed suspended vacancy", "status": "open", "moderation_state": "org_suspended"}'), 6
  union all select 'deleted', pg_temp.seed_job('{"title": "Seed deleted vacancy", "status": "open", "deleted_at": "2026-01-01T00:00:00Z"}'), 7
  union all select 'draft', pg_temp.seed_job('{"title": "Seed draft vacancy", "status": "draft"}'), 8;

insert into public.saved_jobs (worker_user_id, job_id, created_at)
  select :'wa', t.id, now() - make_interval(hours => 10 - t.n) from t_ids t;

select set_config('t.wa', :'wa', true) as keep \gset

-- The list as p_role for p_user as JSON, in order; or 'sqlstate|message|detail' when the call is refused.
create function pg_temp.list_json(p_role text, p_user uuid, p_args text default '') returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', 'aal1')::text end,
    true
  );
  execute format('set local role %I', p_role);
  begin
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(s) order by s.o), ''[]'') from (select l.*, row_number() over () as o from public.list_saved_jobs(%s) l) s',
      p_args
    ) into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := to_jsonb(format('%s|%s|%s', v_state, v_message, coalesce(v_detail, '')));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

create function pg_temp.row_of(p_label text) returns jsonb
language sql as $$
  select r from jsonb_array_elements(pg_temp.list_json('authenticated', current_setting('t.wa')::uuid)) r
  where r ->> 'job_id' = (select id::text from t_ids where label = p_label)
$$;

select is(
  (select jsonb_agg(r ->> 'job_id' order by o) from jsonb_array_elements(pg_temp.list_json('authenticated', :'wa')) with ordinality as x(r, o)),
  (select jsonb_agg(id order by n desc) from t_ids),
  'the list has all eight rows, most recently saved first'
);
select is(jsonb_array_length(pg_temp.list_json('authenticated', :'wb')), 0, 'another candidate gets none of them');
select is(
  pg_temp.list_json('authenticated', :'wb'), '[]'::jsonb, 'another candidate gets an empty list, not an error'
);

select is(pg_temp.row_of('open') ->> 'title', 'Seed open vacancy', 'an open vacancy gives its title');
select is(pg_temp.row_of('open') ->> 'status', 'open', 'and its status flag');
select is(pg_temp.row_of('open') ->> 'employer_display_name', (select display_name from public.organizations where id = current_setting('t.a')::uuid), 'and the display name of its employer');
select is(pg_temp.row_of('open') ->> 'available', 'true', 'and is available');
select is(
  (select string_agg(l || '=' || (pg_temp.row_of(l) ->> 'status'), ',' order by l) from unnest(array['paused', 'closed', 'filled']) l),
  'closed=closed,filled=filled,paused=paused', 'a paused, closed or filled vacancy gives its status'
);
select is(
  (select string_agg(l || '=' || (pg_temp.row_of(l) ->> 'title') || '/' || (pg_temp.row_of(l) ->> 'available'), ',' order by l) from unnest(array['paused', 'closed', 'filled']) l),
  'closed=Seed closed vacancy/true,filled=Seed filled vacancy/true,paused=Seed paused vacancy/true',
  'and its title'
);

select is(
  (select string_agg(l || '=' || (pg_temp.row_of(l) ->> 'available') || ',' || coalesce(pg_temp.row_of(l) ->> 'title', 'null')
                     || ',' || coalesce(pg_temp.row_of(l) ->> 'employer_display_name', 'null')
                     || ',' || coalesce(pg_temp.row_of(l) ->> 'status', 'null'), ';' order by l)
   from unnest(array['hidden', 'suspended', 'deleted', 'draft']) l),
  'deleted=false,null,null,null;draft=false,null,null,null;hidden=false,null,null,null;suspended=false,null,null,null',
  'a hidden, suspended, soft-deleted or draft vacancy gives only the id and an unavailable flag, with a null title, employer and status'
);
select is(
  (select array_agg(distinct k order by k) from jsonb_array_elements(pg_temp.list_json('authenticated', :'wa')) r, jsonb_object_keys(r) k),
  array['available', 'employer_display_name', 'job_id', 'next_cursor', 'o', 'saved_at', 'status', 'title'],
  'no column holds a description, a reason or a moderation state (o is the order the test adds)'
);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.list_json('authenticated', :'wa')) r where r::text ~* 'moderation|org_suspended|hidden vacancy|suspended vacancy|deleted vacancy|Weld steel'),
  0::bigint, 'nothing of the moderation state, the withdrawn titles or the descriptions is in the result'
);

-- Who may call it, and how it runs.
select is(
  split_part(pg_temp.list_json('anon', null) #>> '{}', '|', 1), '42501', 'an anonymous caller is refused for lack of a grant'
);
select is(
  split_part(pg_temp.list_json('authenticated', :'own1') #>> '{}', '|', 1), 'P0001', 'a company user is refused'
);
select is(pg_temp.list_json('authenticated', :'own1') #>> '{}', 'P0001|CHARA_FORBIDDEN|', 'with the stable message');
select is(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""']
   from pg_proc p where p.proname = 'list_saved_jobs' and p.pronamespace = 'public'::regnamespace),
  true, 'list_saved_jobs is a stable definer function with an empty search path'
);
select ok(
  has_function_privilege('authenticated', 'public.list_saved_jobs(text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.list_saved_jobs(text, integer)', 'execute')
  and not has_function_privilege('service_role', 'public.list_saved_jobs(text, integer)', 'execute'),
  'only authenticated can execute it'
);

-- Pages: keyset, bounded, stable.
select is(
  jsonb_array_length(pg_temp.list_json('authenticated', :'wa', 'p_limit => 3')), 3, 'p_limit bounds the page'
);
select is(
  pg_temp.list_json('authenticated', :'wa', 'p_limit => 3') -> 2 ->> 'next_cursor' is not null
  and pg_temp.list_json('authenticated', :'wa', 'p_limit => 3') -> 1 ->> 'next_cursor' is null,
  true, 'only the last row of a page that has a successor carries the cursor'
);
select is(
  (select jsonb_agg(r ->> 'job_id' order by o) from jsonb_array_elements(pg_temp.list_json('authenticated', :'wa', format(
     'p_limit => 3, p_cursor => %L', pg_temp.list_json('authenticated', :'wa', 'p_limit => 3') -> 2 ->> 'next_cursor'))) with ordinality as x(r, o)),
  (select jsonb_agg(id order by n desc) from (select id, n from t_ids order by n desc offset 3 limit 3) q),
  'the cursor starts the next page after the third row'
);
select is(
  (select r ->> 'next_cursor' from jsonb_array_elements(pg_temp.list_json('authenticated', :'wa', format(
     'p_limit => 3, p_cursor => %L', (pg_temp.list_json('authenticated', :'wa', 'p_limit => 6') -> 5 ->> 'next_cursor')))) r limit 1),
  null, 'the page that ends the list has no cursor'
);
select is(
  jsonb_array_length(pg_temp.list_json('authenticated', :'wa', 'p_limit => 500')), 8, 'a limit above 50 is clamped, not refused'
);
select is(
  pg_temp.list_json('authenticated', :'wa', $$p_cursor => 'x|y'$$) #>> '{}', 'P0001|CHARA_INVALID_INPUT|p_cursor',
  'a cursor that is not one of ours is refused'
);
select is(
  pg_temp.list_json('authenticated', :'wa', $$p_cursor => '2026-13-45T00:00:00.000000Z|00000000-0000-0000-0000-000000000000'$$) #>> '{}',
  'P0001|CHARA_INVALID_INPUT|p_cursor', 'and so is one that does not cast'
);

select * from finish();
rollback;
