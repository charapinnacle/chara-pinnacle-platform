begin;
select plan(9);

create function pg_temp.tables_without_forced_rls() returns setof text
language sql as $$
  select format('%I.%I', n.nspname, c.relname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private', 'audit', 'stats')
    and c.relkind in ('r', 'p')
    and not (c.relrowsecurity and c.relforcerowsecurity)
  order by 1
$$;

create function pg_temp.tables_exposed_without_policy() returns setof text
language sql as $$
  select format('%I.%I', n.nspname, c.relname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private', 'audit', 'stats')
    and c.relkind in ('r', 'p')
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    and exists (
      select 1
      from unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
      where has_table_privilege(r.rolname, c.oid, 'select, insert, update, delete, truncate, references, trigger')
         or has_any_column_privilege(r.rolname, c.oid, 'select, insert, update, references')
    )
  order by 1
$$;

select is_empty(
  $$select * from pg_temp.tables_without_forced_rls()$$,
  'every table in public, private, audit and stats has RLS enabled and forced'
);

select is_empty(
  $$select * from pg_temp.tables_exposed_without_policy()$$,
  'every table in public, private, audit and stats has a policy or no grants to anon, authenticated and service_role'
);

create table public.meta_probe (a int);

select results_eq(
  $$select * from pg_temp.tables_without_forced_rls()$$,
  $$values ('public.meta_probe')$$,
  'detector: a table without RLS is reported'
);

alter table public.meta_probe enable row level security;

select results_eq(
  $$select * from pg_temp.tables_without_forced_rls()$$,
  $$values ('public.meta_probe')$$,
  'detector: a table with RLS enabled but not forced is reported'
);

alter table public.meta_probe force row level security;

select is_empty(
  $$select * from pg_temp.tables_without_forced_rls()$$,
  'detector: enabled and forced RLS is accepted'
);

select is_empty(
  $$select * from pg_temp.tables_exposed_without_policy()$$,
  'detector: a table with no grants to the API roles needs no policy'
);

grant select (a) on public.meta_probe to authenticated;

select results_eq(
  $$select * from pg_temp.tables_exposed_without_policy()$$,
  $$values ('public.meta_probe')$$,
  'detector: a column grant to an API role without a policy is reported'
);

create policy meta_probe_select on public.meta_probe for select to authenticated using (true);

select is_empty(
  $$select * from pg_temp.tables_exposed_without_policy()$$,
  'detector: a granted table with a policy is accepted'
);

drop policy meta_probe_select on public.meta_probe;
revoke all on public.meta_probe from authenticated;
grant truncate on public.meta_probe to service_role;

select results_eq(
  $$select * from pg_temp.tables_exposed_without_policy()$$,
  $$values ('public.meta_probe')$$,
  'detector: a service_role grant without a policy is reported'
);

select * from finish();
rollback;
