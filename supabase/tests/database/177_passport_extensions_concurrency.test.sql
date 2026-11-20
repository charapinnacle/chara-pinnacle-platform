begin;
select plan(6);

-- The list limits of the passport extensions under concurrent inserts (V61; FR-Q4 AC1; NFR-A4). A candidate committed by a
-- setup session holds 19 training entries (worker_training_max 20); one session adds the 20th and keeps its transaction
-- open, a second adds another at the same time. private.worker_list_limit locks the passport row before it counts, so the
-- second waits and, once the first commits, counts 20 and is refused. Everything committed is removed at the end.

\set w '00000000-0000-0000-0000-0000000f6201'

create extension if not exists dblink schema extensions;
select extensions.dblink_connect('setup',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('blocked',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));

select extensions.dblink_exec('setup', format($$
  begin;
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%1$L, %1$L || '@worker.test', now(), '{"intended_account_kind": "worker"}');
  update public.profiles set account_kind = intended_account_kind where id = %1$L;
  insert into public.worker_profiles (user_id, first_name, last_name, current_country) values (%1$L, 'Lena', 'Kowalska', 'PL');
  insert into public.worker_training (worker_user_id, course, year_completed)
  select %1$L, 'Course ' || n, 2015 from generate_series(1, 19) n;
  commit;
$$, :'w')) as setup \gset

create function pg_temp.open_as_worker(p_conn text) returns text
language sql as $$
  select extensions.dblink_exec(p_conn, format($f$
    begin;
    set local lock_timeout = '5s';
    select set_config('request.jwt.claims', json_build_object('sub', %L, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
  $f$, current_setting('t.w')))
$$;

create function pg_temp.insert_sql(p_course text) returns text
language sql as $$
  select format('insert into public.worker_training (worker_user_id, course, year_completed) values (%L, %L, 2020)',
    current_setting('t.w'), p_course)
$$;

create function pg_temp.blocked_result() returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config('client_min_messages', 'warning', true);
  select r into v_result from extensions.dblink_get_result('blocked', false) as t (r text);
  if v_result is null then
    v_result := extensions.dblink_error_message('blocked');
  end if;
  perform r from extensions.dblink_get_result('blocked', false) as t (r text);
  perform extensions.dblink_exec('blocked', 'rollback');
  return v_result;
end;
$$;

select set_config('t.w', :'w', false) as keep \gset
select pg_temp.open_as_worker('holder') as opened \gset
select is(extensions.dblink_exec('holder', pg_temp.insert_sql('Twentieth')), 'INSERT 0 1',
  'a session adds the 20th training entry and keeps its transaction open');
select pg_temp.open_as_worker('blocked') as opened \gset
select is(extensions.dblink_send_query('blocked', pg_temp.insert_sql('Twenty-first')), 1, 'a second session adds another at the same time');
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1, 'NFR-A4: the second insert waits for the lock on the passport row');
select extensions.dblink_exec('holder', 'commit') as committed \gset
select matches(pg_temp.blocked_result(), 'CHARA_LIMIT_REACHED',
  'NFR-A4, FR-Q4 AC1: once the first is committed, the waiting insert counts 20 entries and is refused');
select is((select count(*)::integer from public.worker_training where worker_user_id = :'w'), 20, 'NFR-A4: 20 entries, never 21');

select extensions.dblink_disconnect('holder');
select extensions.dblink_disconnect('blocked');
select extensions.dblink_exec('setup', format($$
  begin;
  delete from public.worker_profiles where user_id = %1$L;
  delete from auth.users where id = %1$L;
  commit;
$$, :'w')) as cleaned \gset
select extensions.dblink_disconnect('setup');
select is((select count(*)::integer from auth.users where id = :'w'), 0, 'the committed candidate of the test is removed again');

select * from finish();
rollback;
