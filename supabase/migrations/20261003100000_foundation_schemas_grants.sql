-- Foundation: schemas, extensions, default-deny grants, settings (ARCHITECTURE.md sections 4, 5.1, 14.1).

create schema private;
create schema audit;
create schema stats;

revoke all on schema private from public;
revoke all on schema audit from public;
revoke all on schema stats from public;

-- Functions in private are called from RLS policies and need schema usage;
-- each function still needs an explicit EXECUTE grant.
grant usage on schema private to anon, authenticated;

-- pgcrypto is preinstalled in the Supabase image; 003_default_deny.test.sql asserts it.
create extension citext with schema extensions;
create extension pg_trgm with schema extensions;
create extension unaccent with schema extensions;
create extension btree_gin with schema extensions;

-- Extensions are created above, before the global function default is
-- tightened, so their functions keep the PUBLIC execute they need.
revoke all on schema public from public;
grant usage on schema public to anon, authenticated;

alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role, public;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from anon, authenticated, service_role, public;
revoke all on all sequences in schema public from anon, authenticated, service_role;

create table private.settings (
  key text primary key check (key <> ''),
  value jsonb not null
);

comment on table private.settings is
  'Configuration values. Always read as value #>> ''{}'' and then cast (design point D6).';

alter table private.settings enable row level security;
alter table private.settings force row level security;
revoke all on table private.settings from public, anon, authenticated, service_role;

insert into private.settings (key, value) values ('audit_retention_years', '6');
