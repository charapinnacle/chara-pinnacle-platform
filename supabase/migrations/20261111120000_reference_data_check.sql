-- A deployment check of the data that migrations do not create (FR-D1, FR-A1; OPEN_QUESTIONS.md D89). The hosted project
-- once lacked the legal document sharing-notice, because supabase/seeds/ref ran only on the first deployment and the seed
-- gained that slug later: every application then failed with CHARA_SETTING_MISSING. private.missing_reference_data() lists
-- what is missing, one row each, and nothing when the environment is complete; docs/runbooks/deploy.md runs it after every
-- push, and the pgTAP test 111 runs it against the seeded local database.
--
-- It lists: a legal document of the seed without a published version (pgTAP 111 fails when the seed gains a slug that this
-- list lacks); an empty reference table of the seed; a setting without a row in private.settings that a database function
-- reads by its literal key (key = '<name>' in the function body), that a trigger passes to private.worker_list_limit, or that
-- is a throttle setting of the actions of rate_limit_attempt and document_access; and the Vault secret rate_limit_proof_key,
-- without which rate_limit_attempt and notify_existing_account accept calls without the visitor proof, so a direct caller of
-- the Data API could mail every registered address. Settings read another way (the legal entity details, audit_retention_years)
-- are not listed. The function bodies are read at call time, so a setting that a later migration starts to read by its
-- literal key is checked without changing this function. On a local stack the Vault secret is deliberately absent (D79).

create function private.missing_reference_data()
returns table (kind text, name text)
language sql
stable
set search_path = ''
as $$
  select 'legal_document', d.slug
  from unnest(array[
    'terms-of-service', 'privacy-policy', 'cookie-policy', 'platform-rules', 'acceptable-use-policy',
    'subscription-and-billing-terms', 'employer-terms', 'worker-terms', 'complaints-and-dispute-process',
    'account-suspension-and-termination-rules', 'sharing-notice', 'age-18-plus'
  ]) as d (slug)
  where private.current_legal_version(d.slug) is null
  union all
  select 'reference_table', t.name
  from (values
    ('public.countries', not exists (select 1 from public.countries)),
    ('public.languages', not exists (select 1 from public.languages)),
    ('public.currencies', not exists (select 1 from public.currencies)),
    ('public.industries', not exists (select 1 from public.industries)),
    ('public.occupations', not exists (select 1 from public.occupations)),
    ('billing.plans', not exists (select 1 from billing.plans))
  ) as t (name, empty)
  where t.empty
  union all
  select 'setting', k.key
  from (
    select m[1] as key
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral regexp_matches(p.prosrc, '\mkey\s*=\s*''([a-z0-9_]*[a-z0-9])''', 'g') as m
    where n.nspname in ('public', 'private', 'billing', 'audit', 'stats')
    union
    select (regexp_match(encode(t.tgargs, 'escape'), '^([a-z0-9_]+)\\000'))[1]
    from pg_catalog.pg_trigger t
    where t.tgfoid = 'private.worker_list_limit()'::regprocedure
    union
    select 'rate_limit_' || a || s
    from unnest(array['signup', 'resend', 'login', 'forgot_password', 'reset_password', 'mfa_code', 'report', 'document_access']) as a
    cross join unnest(array['_max', '_seconds']) as s
  ) as k
  where not exists (select 1 from private.settings st where st.key = k.key)
  union all
  select 'vault_secret', 'rate_limit_proof_key'
  where not exists (select 1 from vault.secrets v where v.name = 'rate_limit_proof_key')
  order by 1, 2
$$;

revoke all on function private.missing_reference_data() from public, anon, authenticated, service_role;
