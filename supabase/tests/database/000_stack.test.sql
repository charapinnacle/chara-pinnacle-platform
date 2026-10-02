begin;
select plan(6);

select cmp_ok(
  current_setting('server_version_num')::int, '>=', 170000,
  'Postgres 17 or newer'
);

select has_role('anon');
select has_role('authenticated');
select has_role('service_role');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  auth.uid(),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'auth.uid() reads sub from the request JWT claims'
);

select set_has(
  'select name::text from pg_available_extensions',
  $$values ('citext'), ('pg_trgm'), ('unaccent'), ('pgcrypto'), ('btree_gin'),
           ('pg_cron'), ('pg_net'), ('pgmq'), ('supabase_vault'), ('pgtap')$$,
  'extensions the architecture relies on are available'
);

select * from finish();
rollback;
