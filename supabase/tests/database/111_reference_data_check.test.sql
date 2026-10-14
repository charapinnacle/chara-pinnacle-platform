-- D89: private.missing_reference_data() is empty on a complete environment (the local database after migrations and
-- supabase/seeds/ref) and names each legal document, reference table and setting that is missing, so a hosted database
-- without its seeds is caught by the deployment check before a candidate meets CHARA_SETTING_MISSING.
begin;
select plan(8);

select is_empty('select * from private.missing_reference_data()', 'the seeded database is complete');

select function_privs_are('private', 'missing_reference_data', array[]::text[], 'anon', array[]::text[], 'anon cannot run the check');
select function_privs_are('private', 'missing_reference_data', array[]::text[], 'authenticated', array[]::text[],
  'authenticated cannot run the check');
select function_privs_are('private', 'missing_reference_data', array[]::text[], 'service_role', array[]::text[],
  'service_role cannot run the check');

-- The incident: the database has no sharing notice (published versions are immutable, so the guard is lifted in this
-- rolled-back transaction).
alter table public.legal_documents disable trigger user;
delete from public.legal_documents where slug = 'sharing-notice';
alter table public.legal_documents enable trigger user;
select results_eq(
  'select kind, name from private.missing_reference_data()',
  $$values ('legal_document'::text, 'sharing-notice'::text)$$,
  'a sharing notice without a published version is named'
);

-- An empty reference table of the seed.
delete from public.industries;
select results_eq(
  $$select kind, name from private.missing_reference_data() where kind = 'reference_table'$$,
  $$values ('reference_table'::text, 'public.industries'::text)$$,
  'an empty industries table is named'
);

-- A setting a function reads by name, and a throttle setting built from the action name.
delete from private.settings where key in ('apply_rate_limit_max', 'rate_limit_signup_seconds');
select results_eq(
  $$select kind, name from private.missing_reference_data() where kind = 'setting'$$,
  $$values ('setting'::text, 'apply_rate_limit_max'::text), ('setting', 'rate_limit_signup_seconds')$$,
  'a missing setting that apply_to_job reads and a missing throttle setting are named'
);

-- A key that a function names inside a longer column name (limit_key) is not taken for a setting.
select is_empty(
  $$select 1 from private.missing_reference_data() where name in ('members', 'active_jobs')$$,
  'the limit keys of plans are not settings'
);

select * from finish();
rollback;
