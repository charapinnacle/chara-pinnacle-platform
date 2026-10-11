-- SA-12 (security review), D79: the pg_net queue and response tables grant everything to PUBLIC and belong to the
-- platform's supabase_admin; the project's postgres role holds no grant option on them, so no migration can revoke it.
-- The same holds for the USAGE that anon and authenticated have on the schema. The mitigation is that schema net is
-- not exposed through the Data API (Vitest auth-config) and that the shared secret in the queued headers is rotated
-- (docs/runbooks/security-checklist.md section 3 item 9). When this test fails, the platform lets the project revoke
-- the privileges: add the migration that does.
begin;
select plan(6);

select is(
  (select array_agg(distinct c.relowner::regrole::text) from pg_class c where c.oid in ('net.http_request_queue'::regclass, 'net._http_response'::regclass)),
  array['supabase_admin'], 'both tables belong to supabase_admin'
);
select ok(
  not has_table_privilege('postgres', 'net.http_request_queue', 'select with grant option')
  and not has_table_privilege('postgres', 'net._http_response', 'select with grant option'),
  'postgres cannot pass on or take back a privilege on them'
);
select ok(
  exists (select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = 'net.http_request_queue'::regclass and a.grantee = 0 and a.privilege_type = 'SELECT'),
  'PUBLIC still reads the queue, which is why the secret is rotated and net stays unexposed'
);
select ok(
  has_schema_privilege('anon', 'net', 'usage') and has_schema_privilege('authenticated', 'net', 'usage'),
  'anon and authenticated keep USAGE on schema net, which postgres cannot revoke either'
);
select ok(
  (select n.nspowner::regrole::text from pg_namespace n where n.nspname = 'net') = 'supabase_admin'
  and not exists (
    select 1 from pg_namespace n, aclexplode(n.nspacl) a
    where n.nspname = 'net' and a.grantee = 'postgres'::regrole and a.privilege_type = 'USAGE' and a.is_grantable
  ),
  'the schema belongs to supabase_admin and postgres holds no grant option on it'
);
select ok(
  (select rolconfig is null or not exists (select 1 from unnest(rolconfig) s where s like 'pgrst.db_schemas=%net%')
   from pg_roles where rolname = 'authenticator'),
  'the Data API role is not configured to expose schema net'
);

select * from finish();
rollback;
