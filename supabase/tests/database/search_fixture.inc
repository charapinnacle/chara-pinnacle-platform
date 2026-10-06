-- Shared by the search tests: the vacancy fixture (two organizations, the helpers, a candidate and company users) plus
-- seed_job, which writes a vacancy as the database owner with any status, and the helpers that run search_jobs as a
-- caller. Included with \ir.
\ir jobs_fixture.inc

-- A vacancy written by the database owner: every column of a valid vacancy can be replaced by a key of p_over (a JSON
-- null inserts NULL), including status, moderation_state, deleted_at and created_at, which no API role can write.
create function pg_temp.seed_job(p_over jsonb default '{}', p_org uuid default null) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  execute pg_temp.insert_job(coalesce(p_org, current_setting('t.a')::uuid), p_over) || ' returning id' into v_id;
  return v_id;
end;
$$;

-- search_jobs as p_role (for p_user, null for anonymous) with the named arguments p_args ("p_q => 'welder'"); returns
-- the ids of the page in order, or 'sqlstate|message|detail' when the call is refused.
create function pg_temp.search_ids(p_role text, p_user uuid, p_args text default '') returns text
language plpgsql as $$
declare
  v_result text;
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
      'select coalesce(string_agg(t.id::text, '','' order by t.o), '''') from (select s.id, row_number() over () as o from public.search_jobs(%s) s) t',
      p_args
    ) into v_result;
  exception when others then
    get stacked diagnostics v_result = returned_sqlstate, v_detail = pg_exception_detail;
    v_result := v_result || '|' || sqlerrm || '|' || coalesce(v_detail, '');
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- The same as search_ids, anonymous, with the titles in place of the ids.
create function pg_temp.search_titles(p_args text default '') returns text
language plpgsql as $$
declare
  v_result text;
  v_detail text;
begin
  set local role anon;
  begin
    execute format(
      'select coalesce(string_agg(t.title, '','' order by t.o), '''') from (select s.title, row_number() over () as o from public.search_jobs(%s) s) t',
      p_args
    ) into v_result;
  exception when others then
    get stacked diagnostics v_result = returned_sqlstate, v_detail = pg_exception_detail;
    v_result := v_result || '|' || sqlerrm || '|' || coalesce(v_detail, '');
  end;
  reset role;
  return v_result;
end;
$$;

-- One page of search_jobs as an anonymous caller: the ids in order and the cursor of the last row.
create function pg_temp.page(p_args text default '') returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
begin
  set local role anon;
  execute format(
    'select jsonb_build_object(''ids'', coalesce(jsonb_agg(s.id order by s.o), ''[]''), ''cursor'', max(s.next_cursor)) from (select t.id, t.next_cursor, row_number() over () as o from public.search_jobs(%s) t) s',
    p_args
  ) into v_result;
  reset role;
  return v_result;
end;
$$;
