-- Shared by the candidate passport tests: the organization fixture (its helpers and company users) plus four
-- worker accounts (committed, the last one suspended) and two more helpers. Included with \ir.
\ir organizations_fixture.inc

\set wa '00000000-0000-0000-0000-00000000a101'
\set wb '00000000-0000-0000-0000-00000000a102'
\set wnew '00000000-0000-0000-0000-00000000a103'
\set wsus '00000000-0000-0000-0000-00000000a104'

select pg_temp.new_user(:'wa', 'worker');
select pg_temp.new_user(:'wb', 'worker');
select pg_temp.new_user(:'wnew', 'worker');
select pg_temp.new_user(:'wsus', 'worker');
update public.profiles set account_kind = intended_account_kind where id in (:'wa', :'wb', :'wnew', :'wsus');
update public.profiles set status = 'suspended' where id = :'wsus';

-- The SQLSTATE of a statement run as an authenticated user, or 'ok'.
create function pg_temp.state_as(p_user uuid, p_sql text, p_aal text default 'aal1') returns text
language sql as $$ select split_part(pg_temp.call_as(p_user, 'authenticated', p_sql, p_aal), '|', 1) $$;

-- The number of rows a statement affects when it runs as p_role for p_user.
create function pg_temp.affected_as(p_user uuid, p_role text, p_sql text, p_aal text default 'aal1') returns bigint
language plpgsql as $$
declare
  v_rows bigint;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', p_aal)::text end,
    true
  );
  execute format('set local role %I', p_role);
  execute p_sql;
  get diagnostics v_rows = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_rows;
end;
$$;
