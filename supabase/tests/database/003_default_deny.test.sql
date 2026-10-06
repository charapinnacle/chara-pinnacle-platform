begin;
select plan(20);

select has_schema('private');
select has_schema('audit');
select has_schema('stats');

select set_eq(
  $$select extname::text from pg_extension where extname in ('citext', 'pg_trgm', 'unaccent', 'pgcrypto', 'btree_gin')$$,
  $$values ('citext'), ('pg_trgm'), ('unaccent'), ('pgcrypto'), ('btree_gin')$$,
  'foundation extensions are installed'
);

select ok(
  not has_schema_privilege('anon', 'audit', 'usage'),
  'anon has no usage on schema audit'
);
-- authenticated has usage only so that the candidate's view of the document access log (FR-B5) can read its table as the
-- caller; every other table of the schema stays closed and the grant on the log names columns, never accessed_by.
select is_empty(
  $$select c.relname::text from pg_class c
    where c.relnamespace = 'audit'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
      and (has_table_privilege('authenticated', c.oid, 'select, insert, update, delete, truncate, references, trigger')
        or has_any_column_privilege('authenticated', c.oid, 'select, insert, update, references'))
      and c.relname <> 'document_access_log'$$,
  'authenticated holds no privilege on any table of schema audit except the document access log'
);
select ok(
  not has_schema_privilege('anon', 'stats', 'usage') and not has_schema_privilege('authenticated', 'stats', 'usage'),
  'anon and authenticated have no usage on schema stats'
);
select ok(
  not has_schema_privilege('public', 'private', 'create') and not has_schema_privilege('anon', 'private', 'create'),
  'nobody but the owner can create objects in schema private'
);
select ok(
  has_schema_privilege('service_role', 'public', 'usage'),
  'service_role keeps usage on schema public to call service RPCs'
);

create table public.default_deny_probe (a int);
create function public.default_deny_probe() returns int language sql as 'select 1';
create function private.default_deny_probe() returns int language sql as 'select 1';
create function audit.default_deny_probe() returns int language sql as 'select 1';
create sequence public.default_deny_probe_seq;

select ok(
  not has_table_privilege('anon', 'public.default_deny_probe', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('authenticated', 'public.default_deny_probe', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('service_role', 'public.default_deny_probe', 'select, insert, update, delete, truncate, references, trigger'),
  'a new table in public carries no grants to the API roles'
);
select ok(
  not has_sequence_privilege('anon', 'public.default_deny_probe_seq', 'usage, select, update')
  and not has_sequence_privilege('authenticated', 'public.default_deny_probe_seq', 'usage, select, update')
  and not has_sequence_privilege('service_role', 'public.default_deny_probe_seq', 'usage, select, update'),
  'a new sequence in public carries no grants to the API roles'
);
select ok(
  not has_function_privilege('anon', 'public.default_deny_probe()', 'execute')
  and not has_function_privilege('authenticated', 'public.default_deny_probe()', 'execute')
  and not has_function_privilege('service_role', 'public.default_deny_probe()', 'execute'),
  'a new function in public is not executable by the API roles'
);
select ok(
  not has_function_privilege('anon', 'private.default_deny_probe()', 'execute')
  and not has_function_privilege('authenticated', 'private.default_deny_probe()', 'execute'),
  'a new function in private is not executable by anon or authenticated'
);
select ok(
  not has_function_privilege('anon', 'audit.default_deny_probe()', 'execute')
  and not has_function_privilege('authenticated', 'audit.default_deny_probe()', 'execute'),
  'a new function in audit is not executable by anon or authenticated'
);

select ok(
  has_function_privilege('anon', 'extensions.citext_eq(extensions.citext, extensions.citext)', 'execute'),
  'extension functions stay executable so citext and unaccent work for API roles'
);

select results_eq(
  $$select value #>> '{}' from private.settings where key = 'audit_retention_years'$$,
  $$values ('6')$$,
  'audit retention is a setting, 6 years by default, read with value #>> ''{}'''
);
select is(
  (select (value #>> '{}')::int from private.settings where key = 'audit_retention_years'),
  6,
  'the setting casts to an integer after #>> ''{}'''
);

insert into private.settings (key, value) values ('probe_flag', 'true'), ('probe_text', '"hello"');

select is(
  (select (value #>> '{}')::boolean from private.settings where key = 'probe_flag'),
  true,
  'a jsonb boolean is read with #>> and cast to boolean'
);

set local role anon;
select throws_ok($$select * from private.settings$$, '42501', null, 'anon cannot read private.settings');
reset role;

set local role authenticated;
select throws_ok($$select * from private.settings$$, '42501', null, 'authenticated cannot read private.settings');
reset role;

select * from finish();
rollback;
