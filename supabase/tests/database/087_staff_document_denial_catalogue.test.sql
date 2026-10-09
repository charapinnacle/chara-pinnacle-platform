-- FR-F3 AC5 and AC6, the regression guard of the build (AC10): read from the catalogue, not from a fixture. A policy that
-- gives a staff role a path to a document, or a function behind a staff check that touches documents, fails these tests.
begin;
select plan(15);

create temp table doc_policies as
select schemaname, tablename, policyname, cmd, roles::text as roles, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check,
       coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
from pg_policies
where (schemaname, tablename) in (('public', 'worker_documents'), ('public', 'passport_shares'), ('audit', 'document_access_log'), ('storage', 'objects'));

-- What makes a function or a policy a staff matter: the three checks of the platform roles and the table of the roles.
create function pg_temp.staff_pattern() returns text language sql as $$
  select 'private\.(has_platform_role|assert_staff|assert_platform_admin)\s*\(|platform_staff|platform_role'
$$;
create function pg_temp.document_pattern() returns text language sql as $$
  select 'worker_documents|passport_shares|storage\.objects|document_access_grant|document_access_log|passport-documents'
$$;

-- The deparsed text of a policy depends on the search_path and the version of Postgres: compare it without schema
-- qualifiers, casts, parentheses and white space.
create function pg_temp.norm(p_expr text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(lower(p_expr), '(public|storage|auth)\.', '', 'g'), '[()\s]|::[a-z]+', '', 'g')
$$;

-- AC5: the policies
select set_eq(
  $$select schemaname || '.' || tablename || '.' || policyname from doc_policies$$,
  $$values ('public.worker_documents.worker_documents_select_own'), ('public.worker_documents.worker_documents_insert_own'),
           ('public.worker_documents.worker_documents_update_own'), ('public.passport_shares.passport_shares_select_own'),
           ('audit.document_access_log.document_access_log_select_own'), ('storage.objects.passport_docs_owner_select'),
           ('storage.objects.passport_docs_owner_insert'), ('storage.objects.passport_docs_owner_delete')$$,
  'AC5: the eight policies on the document tables, the log and storage.objects are the owner policies, and a new one has to be reviewed here'
);
select is_empty(
  $$select policyname from doc_policies where roles <> '{authenticated}'$$,
  'AC5: every one is for authenticated only'
);
select is_empty(
  $$select policyname from doc_policies where expr ~* pg_temp.staff_pattern()$$,
  'AC5: no policy expression calls a platform role check or reads public.platform_staff'
);
select cmp_ok(
  (select count(*) from doc_policies p cross join lateral regexp_matches(p.expr, '(?:private|public|audit)\.([a-z_]+)\(', 'g') m (g)), '>=', 1::bigint,
  'AC5: the policies call a helper by schema name (the account kind), so the next test has a function to look into'
);
select is_empty(
  $$select p.policyname, f.proname
    from doc_policies p
    cross join lateral regexp_matches(p.expr, '(?:private|public|audit)\.([a-z_]+)\(', 'g') m (g)
    join pg_proc f on f.proname = m.g[1] and f.pronamespace in ('public'::regnamespace, 'private'::regnamespace, 'audit'::regnamespace)
    where f.prosrc ~* pg_temp.staff_pattern()$$,
  'AC5: and no function that a policy calls is itself a platform role check or reads the table of the roles'
);
select is(
  pg_temp.norm((select qual from doc_policies where policyname = 'passport_docs_owner_select')),
  'bucket_id=''passport-documents''andfoldernamename[1]=selectuidasuid',
  'AC5: the select policy of the bucket tests only that the first folder of the path is the user'
);
select is(
  pg_temp.norm((select qual from doc_policies where policyname = 'passport_docs_owner_delete')),
  'bucket_id=''passport-documents''andfoldernamename[1]=selectuidasuid',
  'AC5: and so does the delete policy'
);
select ok(
  pg_temp.norm((select with_check from doc_policies where policyname = 'passport_docs_owner_insert')) ~
    'foldernamename\[1\]=selectuidasuid.*fromworker_documentsdwhered\.worker_user_id=selectuidasuidandd\.deleted_atisnullandd\.storage_path=objects\.name',
  'AC5: the insert policy of the bucket also needs the own, undeleted worker_documents row of the object name'
);

-- AC6: the functions behind a staff check, and the functions they call by name
create temp table gated as
with recursive fn as (
  select p.oid, p.proname, p.prosrc, n.nspname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'audit', 'billing')
), reach (oid) as (
  select oid from fn where nspname = 'public' and prosrc ~ 'private\.(has_platform_role|assert_staff|assert_platform_admin)\s*\('
  union
  select f.oid from reach r join fn a on a.oid = r.oid join fn f on a.prosrc ~ ('(public|private|audit|billing)\.' || f.proname || '\s*\(')
)
select fn.oid, fn.proname, fn.nspname, fn.prosrc from fn join reach using (oid);

select cmp_ok(
  (select count(*) from gated where nspname = 'public'), '>=', 15::bigint,
  'AC6: the administrative functions of the console are found behind the staff checks'
);
select is_empty(
  $$select nspname || '.' || proname from gated where prosrc ~* pg_temp.document_pattern()$$,
  'AC6: no function behind a staff check, nor any function it calls, references documents, shares, storage objects or the access log'
);

create temp table gated_columns as
select g.proname, c.col
from gated g
join pg_proc p on p.oid = g.oid
cross join lateral (
  select unnest(p.proargnames) as col, unnest(p.proargmodes) as mode
) c
where g.nspname = 'public' and c.mode in ('t', 'o', 'b')
union
select g.proname, a.attname::text
from gated g
join pg_proc p on p.oid = g.oid
join pg_type t on t.oid = p.prorettype and t.typrelid <> 0
join pg_attribute a on a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped
where g.nspname = 'public';

select cmp_ok((select count(*) from gated_columns), '>=', 40::bigint, 'AC6: the result columns of the administrative functions were collected');
select is_empty(
  $$select proname, col from gated_columns
    where col in ('bucket_id', 'object_path', 'storage_path', 'file_name', 'mime', 'size_bytes', 'scan_status', 'document_id', 'expires_on')$$,
  'AC6: none returns a bucket, a path, a file name, a type, a size, a scan status, a document id or an expiry date'
);
select is(
  (select array_agg(proname::text order by proname) from pg_proc
   where pronamespace = 'public'::regnamespace and prosrc ~ 'platform_staff' and prosrc ~* pg_temp.document_pattern()),
  array['erase_user'],
  'AC6: the only public function that reads the table of the roles and also documents is the erasure of an account'
);
select is_empty(
  $$select r.role_name from (values ('anon'), ('authenticated')) r (role_name)
    where has_function_privilege(r.role_name, 'public.erase_user(uuid)'::regprocedure, 'execute')$$,
  'AC6: and no API role of a signed-in person or visitor can call it (it refuses staff and runs for the account-ops job)'
);
select is_empty(
  $$select g.proname from gated g join pg_proc p on p.oid = g.oid
    where g.nspname = 'public' and has_function_privilege('service_role', p.oid, 'execute')$$,
  'AC6: the administrative functions are not callable by service_role either'
);

select * from finish();
rollback;
