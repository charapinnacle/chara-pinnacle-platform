-- D89: private.missing_reference_data() is empty on a complete environment (the local database after migrations and
-- supabase/seeds/ref, plus the Vault secret) and names each legal document, reference table, setting and secret that is
-- missing, so a hosted database without its seeds is caught by the deployment check before a candidate meets CHARA_SETTING_MISSING.
begin;
select plan(11);

create temp table t_seeded_slugs as select distinct slug from public.legal_documents;

-- A local stack has no Vault secret (D79); a hosted one must.
select results_eq(
  'select kind, name from private.missing_reference_data()',
  $$values ('vault_secret'::text, 'rate_limit_proof_key'::text)$$,
  'without the Vault secret rate_limit_proof_key the check names it'
);
select vault.create_secret(repeat('0', 64), 'rate_limit_proof_key') is not null as vault_set \gset
select is_empty('select * from private.missing_reference_data()', 'the seeded database with the Vault secret is complete');

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

-- Every Phase 1 slug of supabase/seeds/ref/legal_documents.sql is checked: a slug the seed gains without this list fails
-- here. The partner documents of Phase 2 are reported by private.legal_release_gaps instead (V04, pgTAP 119), so that a
-- missing one stops its release and not a Phase 1 deployment.
alter table public.legal_documents disable trigger user;
delete from public.legal_documents;
alter table public.legal_documents enable trigger user;
select set_eq(
  $$select name from private.missing_reference_data() where kind = 'legal_document'$$,
  $$select slug from t_seeded_slugs where slug <> all (array['partner-terms', 'recruitment-company-terms',
    'staffing-company-terms', 'employer-pays-commitment', 'partner-dpa', 'worker-visibility-consent', 'immigration-disclaimer'])$$,
  'with no legal document published, the check names every Phase 1 slug of the seed'
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
delete from private.settings where key = 'worker_languages_max';
select ok(
  exists (select 1 from private.missing_reference_data() where kind = 'setting' and name = 'worker_languages_max'),
  'a missing setting that a trigger passes to worker_list_limit is named'
);

-- A key that a function names inside a longer column name (limit_key) is not taken for a setting.
select is_empty(
  $$select 1 from private.missing_reference_data() where name in ('members', 'active_jobs')$$,
  'the limit keys of plans are not settings'
);

select * from finish();
rollback;
