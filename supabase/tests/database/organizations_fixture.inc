-- Shared by the organization tests: the helper functions, the users and their psql variables. Included with \ir.
create function pg_temp.new_user(
  p_id uuid, p_kind text default 'company', p_email text default null, p_confirmed boolean default true
) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (
    p_id, coalesce(p_email, p_id || '@example.test'), case when p_confirmed then now() end,
    jsonb_build_object('intended_account_kind', p_kind)
  )
$$;

-- Runs p_sql as p_role with the given user and token level, settles the deferred one-owner check, and returns 'ok'
-- or 'sqlstate|message|detail'. Values are passed between statements through the transaction settings t.*.
create function pg_temp.call_as(p_user uuid, p_role text, p_sql text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
  v_result text := 'ok';
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', p_aal)::text end,
    true
  );
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- Returns the single value of a query that must succeed, read as an authenticated user.
create function pg_temp.val_as(p_user uuid, p_aal text, p_sql text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  set local role authenticated;
  execute p_sql into v_result;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

\set own1 '00000000-0000-0000-0000-00000000a001'
\set adm '00000000-0000-0000-0000-00000000b002'
\set mem '00000000-0000-0000-0000-00000000c003'
\set own2 '00000000-0000-0000-0000-00000000d004'
\set wkr '00000000-0000-0000-0000-00000000e005'
\set nul '00000000-0000-0000-0000-00000000f006'
\set inv '00000000-0000-0000-0000-00000000a007'
\set unc '00000000-0000-0000-0000-00000000a008'
\set slg '00000000-0000-0000-0000-00000000a009'
\set adm2 '00000000-0000-0000-0000-00000000a010'
\set oth '00000000-0000-0000-0000-00000000a011'
\set late '00000000-0000-0000-0000-00000000a012'
\set sus '00000000-0000-0000-0000-00000000a013'
\set gone '00000000-0000-0000-0000-00000000a014'

select pg_temp.new_user(:'own1');
select pg_temp.new_user(:'adm');
select pg_temp.new_user(:'mem');
select pg_temp.new_user(:'own2');
select pg_temp.new_user(:'wkr', 'worker');
select pg_temp.new_user(:'nul');
select pg_temp.new_user(:'inv', 'company', 'Bea@Example.TEST');
select pg_temp.new_user(:'unc', 'company', 'unc@example.test', false);
select pg_temp.new_user(:'slg');
select pg_temp.new_user(:'adm2');
select pg_temp.new_user(:'oth', 'company', 'oth@example.test');
select pg_temp.new_user(:'late', 'company', 'late@example.test');
select pg_temp.new_user(:'sus');
select pg_temp.new_user(:'gone', 'company', 'gone@example.test');
update public.profiles set account_kind = intended_account_kind where id <> :'nul';
update public.profiles set status = 'suspended' where id = :'sus';
