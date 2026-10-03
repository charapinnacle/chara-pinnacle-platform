begin;
select plan(22);

create function pg_temp.new_user(p_id uuid, p_kind text, p_pending jsonb, p_confirmed boolean default true) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (
    p_id, p_id || '@example.test', case when p_confirmed then now() end,
    jsonb_build_object('intended_account_kind', p_kind, 'pending_consents', p_pending)
  )
$$;

-- Runs p_sql as p_role with the given user and returns 'ok' or 'sqlstate|message|detail'.
create function pg_temp.call_as(p_user uuid, p_role text, p_sql text) returns text
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
  v_result text := 'ok';
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role)::text end,
    true
  );
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

\set w '00000000-0000-0000-0000-00000000a001'
\set c '00000000-0000-0000-0000-00000000b002'
\set m '00000000-0000-0000-0000-00000000e005'

select pg_temp.new_user(
  :'w', 'worker',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0},{"purpose":"age-18-plus","version":0}]'
);
select pg_temp.new_user(
  :'c', 'company',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"employer-terms","version":0}]'
);
select pg_temp.new_user(
  :'m', 'worker',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0},{"purpose":"age-18-plus","version":0}]'
);
select ok(
  bool_and(pg_temp.call_as(u, 'authenticated', 'select public.set_account_kind()') = 'ok'),
  'the three users of this file commit their account kind'
)
from (values (:'w'::uuid), (:'c'::uuid), (:'m'::uuid)) v(u);

-- Visibility
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'w'), true);
set local role authenticated;
select is(
  (select count(*) from public.consents),
  (select count(*) from public.consents where user_id = :'w'),
  'a user reads only their own consent rows'
);
select cmp_ok((select count(*) from public.consents), '>', 0::bigint, 'a user reads their own consent rows');
select is_empty(
  format($$select 1 from public.consents where user_id = %L$$, :'c'),
  'another user''s consent rows are not readable'
);
select throws_ok(
  $$insert into public.consents (user_id, purpose, version, action) values (gen_random_uuid(), 'cookie-policy', 0, 'granted')$$,
  '42501', null, 'authenticated cannot insert a consent row directly'
);
select throws_ok($$update public.consents set action = 'granted'$$, '42501', null, 'authenticated cannot update consents');
select throws_ok($$delete from public.consents$$, '42501', null, 'authenticated cannot delete consents');
select throws_ok($$truncate public.consents$$, '42501', null, 'authenticated cannot truncate consents');
reset role;
set local role anon;
select throws_ok($$select * from public.consents$$, '42501', null, 'anon cannot read consents');
reset role;
set local role service_role;
select throws_ok($$select * from public.consents$$, '42501', null, 'service_role cannot read consents');
select throws_ok($$delete from public.consents$$, '42501', null, 'service_role cannot delete consents');
reset role;

-- Append-only for the table owner, in normal and replica mode
select throws_ok(
  $$update public.consents set action = 'withdrawn' where user_id = '00000000-0000-0000-0000-00000000a001'$$,
  '42501', 'consents is append-only', 'update is refused for the table owner'
);
select throws_ok($$delete from public.consents$$, '42501', 'consents is append-only', 'delete is refused for the table owner');
select throws_ok($$truncate public.consents$$, '42501', 'consents is append-only', 'truncate is refused for the table owner');
set local session_replication_role = replica;
select throws_ok($$delete from public.consents$$, '42501', 'consents is append-only', 'delete is refused in replica mode');
select throws_ok($$truncate public.consents$$, '42501', 'consents is append-only', 'truncate is refused in replica mode');
set local session_replication_role = origin;

-- Version and purpose are mandatory and must exist
select throws_ok(
  $$insert into public.consents (user_id, purpose, version, action)
    values ('00000000-0000-0000-0000-00000000a001', 'terms-of-service', 99, 'granted')$$,
  '23503', null, 'a consent for an unknown version is refused'
);
select throws_ok(
  $$insert into public.consents (user_id, purpose, version, action)
    values ('00000000-0000-0000-0000-00000000a001', 'terms-of-service', null, 'granted')$$,
  '23502', null, 'a consent without a version is refused'
);
select throws_ok(
  $$insert into public.consents (user_id, purpose, version, action)
    values ('00000000-0000-0000-0000-00000000a001', 'no-such-document', 0, 'granted')$$,
  '23503', null, 'a consent for an unknown document is refused'
);

-- The lookups the RPCs and the own-rows policy make use the index at volume
insert into public.consents (user_id, purpose, version, action)
select gen_random_uuid(), (array['terms-of-service', 'privacy-policy', 'cookie-policy', 'worker-terms'])[1 + g % 4], 0, 'granted'
from generate_series(1, 50000) g;
analyze public.consents;
create function pg_temp.plan_of(p_sql text) returns text
language plpgsql as $$
declare
  v_line text;
  v_plan text := '';
begin
  for v_line in execute 'explain ' || p_sql loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  return v_plan;
end;
$$;
select ok(
  pg_temp.plan_of(format(
    $$select action, version from public.consents where user_id = %L and purpose = 'worker-terms' order by id desc limit 1$$, :'w'
  )) like '%consents_user_purpose_idx%',
  'the latest-row lookup per user and purpose uses the ledger index'
);
select ok(
  pg_temp.plan_of(format($$select * from public.consents where user_id = %L$$, :'w')) like '%consents_user_purpose_idx%',
  'reading a user''s own rows uses the ledger index'
);

-- The ledger outlives the account
delete from auth.users where id = :'m';
select is(
  (select count(*) from public.consents where user_id = :'m'),
  4::bigint,
  'consent rows stay after the account is deleted'
);

select * from finish();
rollback;
