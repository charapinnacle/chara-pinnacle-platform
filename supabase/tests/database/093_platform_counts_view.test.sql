begin;
select plan(40);

\ir organizations_fixture.inc

-- The four values of the view as p_role reads them, as 'vacancies|employers|candidates|countries' with null for a
-- hidden value, or 'sqlstate|message' when the read is refused.
create function pg_temp.view_as(p_role text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  execute format('set local role %I', p_role);
  begin
    select format('%s|%s|%s|%s', coalesce(active_jobs::text, 'null'), coalesce(employers::text, 'null'),
                  coalesce(workers::text, 'null'), coalesce(countries::text, 'null'))
      into v_result from public.v_platform_counts;
  exception when others then
    v_result := sqlstate || '|' || sqlerrm;
  end;
  reset role;
  return v_result;
end;
$$;

-- Replaces the snapshot by one with these exact counts (inside this transaction only), in the argument order of the view.
create function pg_temp.set_snapshot(p_jobs integer, p_employers integer, p_workers integer, p_countries integer) returns void
language plpgsql as $$
begin
  drop materialized view stats.platform_counts_mv;
  execute format(
    'create materialized view stats.platform_counts_mv as select %s::integer as countries, %s::integer as workers, %s::integer as employers, %s::integer as active_jobs',
    p_countries, p_workers, p_employers, p_jobs
  );
end;
$$;

create function pg_temp.set_k(p_value jsonb) returns void
language sql as $$ update private.settings set value = p_value where key = 'stats_min_count' $$;

-- FR-H4 AC10: what a visitor can and cannot read.
select ok(pg_temp.view_as('anon') ~ '^[0-9n]', 'AC10: anon reads public.v_platform_counts');
select ok(pg_temp.view_as('authenticated') ~ '^[0-9n]', 'AC10: an authenticated user reads public.v_platform_counts');
select is(
  (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
   where a.attrelid = 'public.v_platform_counts'::regclass and a.attnum > 0 and not a.attisdropped),
  array['active_jobs', 'employers', 'workers', 'countries'],
  'AC10: the view has exactly the four Phase 1 value columns'
);
select is(
  (select array_agg(distinct format_type(a.atttypid, null)) from pg_attribute a
   where a.attrelid = 'public.v_platform_counts'::regclass and a.attnum > 0 and not a.attisdropped),
  array['integer'], 'AC10: every column is a count: no name, identifier or per-record value'
);
select is((select count(*) from public.v_platform_counts), 1::bigint, 'AC10: the view has one row');
select is(
  (select reloptions from pg_class where oid = 'public.v_platform_counts'::regclass), array['security_invoker=true'],
  'the view is security_invoker; its reader is a function that runs with the rights of its owner'
);
select ok(
  not has_table_privilege('anon', 'stats.platform_counts_mv', 'select')
  and not has_table_privilege('authenticated', 'stats.platform_counts_mv', 'select')
  and not has_table_privilege('service_role', 'stats.platform_counts_mv', 'select'),
  'AC10: no API role holds a privilege on the materialized view'
);
select ok(
  not has_schema_privilege('anon', 'stats', 'usage') and not has_schema_privilege('authenticated', 'stats', 'usage'),
  'AC10: nor usage on the schema stats'
);
select is(
  (select pg_temp.call_as(null, 'anon', 'select * from stats.platform_counts_mv', 'aal1') ~ '^42501\|'), true,
  'AC10: a select on the materialized view as anon is refused (42501)'
);
select is(
  (select pg_temp.call_as(:'wkr', 'authenticated', 'select * from stats.platform_counts_mv', 'aal1') ~ '^42501\|'), true,
  'AC10: and as an authenticated user'
);
select is(
  (select pg_temp.call_as(null, 'anon', 'select * from public.profiles', 'aal1') ~ '^42501\|'), true,
  'AC10: a select on public.profiles as anon is refused (42501)'
);
select ok(
  has_table_privilege('anon', 'public.v_platform_counts', 'select') and has_table_privilege('authenticated', 'public.v_platform_counts', 'select')
  and not has_table_privilege('anon', 'public.v_platform_counts', 'insert, update, delete, truncate')
  and not has_table_privilege('authenticated', 'public.v_platform_counts', 'insert, update, delete, truncate')
  and not has_table_privilege('service_role', 'public.v_platform_counts', 'select'),
  'the view is read-only for anon and authenticated and closed to service_role'
);
select ok(
  not has_function_privilege('anon', 'private.stats_min_count()', 'execute')
  and not has_function_privilege('authenticated', 'private.stats_min_count()', 'execute')
  and has_function_privilege('anon', 'private.platform_counts()', 'execute')
  and has_function_privilege('authenticated', 'private.platform_counts()', 'execute')
  and not has_function_privilege('service_role', 'private.platform_counts()', 'execute'),
  'only the function behind the view is executable by anon and authenticated, not the threshold helper'
);
select is(
  (select count(*) from pg_proc p where p.proname in ('stats_min_count', 'platform_counts') and p.pronamespace = 'private'::regnamespace
     and p.prosecdef and p.proconfig = array['search_path=""']),
  2::bigint, 'both functions are security definer with an empty search_path'
);

-- FR-H4 AC2: the threshold k = 5 is applied to the exact count.
select pg_temp.set_k('5');
select pg_temp.set_snapshot(4, 4, 4, 4);
select is(pg_temp.view_as('anon'), 'null|null|null|null', 'AC2: counts of 4 are returned as null (the candidate count too, although 4 would round to 0)');
select pg_temp.set_snapshot(5, 5, 5, 5);
select is(pg_temp.view_as('anon'), '5|5|10|5', 'AC2: counts of 5 are returned as numbers');
select is(pg_temp.view_as('authenticated'), '5|5|10|5', 'AC2: an authenticated user gets the same values');
select pg_temp.set_snapshot(4, 5, 5, 6);
select is(pg_temp.view_as('anon'), 'null|5|10|6', 'AC2: each value is tested on its own');
select pg_temp.set_snapshot(0, 0, 0, 0);
select is(pg_temp.view_as('anon'), 'null|null|null|null', 'AC2: an empty platform shows no value');

-- FR-H4 AC7: the candidate count is rounded to the nearest 10 after the test; the other three are not rounded.
select pg_temp.set_snapshot(14, 14, 14, 14);
select is(pg_temp.view_as('anon'), '14|14|10|14', 'AC7: 14 candidates are returned as 10');
select pg_temp.set_snapshot(15, 15, 15, 15);
select is(pg_temp.view_as('anon'), '15|15|20|15', 'AC7: 15 candidates are returned as 20 (half up)');
select pg_temp.set_snapshot(1234, 1234, 1234, 1234);
select is(pg_temp.view_as('anon'), '1234|1234|1230|1234', 'AC7: 1234 candidates are returned as 1230; the vacancy, employer and country counts are exact');
select pg_temp.set_snapshot(7, 7, 9, 7);
select is(pg_temp.view_as('anon'), '7|7|10|7', 'AC7: 9 candidates are returned as 10');

-- FR-H4 AC8: the threshold comes from the setting; a missing or invalid row falls back to 5.
select pg_temp.set_snapshot(9, 9, 9, 9);
select pg_temp.set_k('5');
select is(pg_temp.view_as('anon'), '9|9|10|9', 'AC8: with k = 5 a count of 9 is shown');
select pg_temp.set_k('10');
select is(pg_temp.view_as('anon'), 'null|null|null|null', 'AC8: with k = 10 a count of 9 is hidden, and the candidate count is tested before it rounds to 10');
select pg_temp.set_snapshot(10, 10, 10, 10);
select is(pg_temp.view_as('anon'), '10|10|10|10', 'AC8: with k = 10 a count of 10 is shown');
select pg_temp.set_k('"10"');
select is(pg_temp.view_as('anon'), '10|10|10|10', 'AC8: the setting may also be stored as text, as the other settings are read');
select pg_temp.set_snapshot(9, 9, 9, 9);
select pg_temp.set_k('"abc"');
select is(pg_temp.view_as('anon'), '9|9|10|9', 'AC8: text that is not a number falls back to 5');
select pg_temp.set_k('0');
select is(pg_temp.view_as('anon'), '9|9|10|9', 'AC8: 0 falls back to 5');
select pg_temp.set_k('-3');
select is(pg_temp.view_as('anon'), '9|9|10|9', 'AC8: a negative number falls back to 5');
select pg_temp.set_k('5.5');
select is(pg_temp.view_as('anon'), '9|9|10|9', 'AC8: a number with a fraction falls back to 5');
select pg_temp.set_k('99999999999');
select is(pg_temp.view_as('anon'), '9|9|10|9', 'AC8: a number too large for an integer falls back to 5');
select pg_temp.set_k('null');
select is(pg_temp.view_as('anon'), '9|9|10|9', 'AC8: a JSON null falls back to 5');
select pg_temp.set_k('[7]');
select is(pg_temp.view_as('anon'), '9|9|10|9', 'AC8: a list falls back to 5');
select pg_temp.set_snapshot(4, 4, 4, 4);
select pg_temp.set_k('"abc"');
select is(pg_temp.view_as('anon'), 'null|null|null|null', 'AC8: a bad setting never lowers the threshold below 5');
delete from private.settings where key = 'stats_min_count';
select is(pg_temp.view_as('anon'), 'null|null|null|null', 'AC8: with the row missing a count of 4 is hidden');
select pg_temp.set_snapshot(5, 5, 5, 5);
select is(pg_temp.view_as('anon'), '5|5|10|5', 'AC8: with the row missing a count of 5 is shown');
insert into private.settings (key, value) values ('stats_min_count', '1');
select is(pg_temp.view_as('anon'), '5|5|10|5', 'AC8: k = 1 is allowed and shows every count from 1');
select pg_temp.set_snapshot(0, 1, 1, 0);
select is(pg_temp.view_as('anon'), 'null|1|0|null', 'AC8: with k = 1 only a count of 0 is hidden, and a single candidate rounds to 0 (the rounding follows the test)');
select is(
  (select value from private.settings where key = 'stats_min_count'), '1'::jsonb,
  'control: the test changed the setting row itself'
);

select * from finish();
rollback;
