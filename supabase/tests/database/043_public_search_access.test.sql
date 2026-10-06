begin;
select plan(30);

\ir search_fixture.inc

-- FR-C3 AC1: vacancies of Acme in every status, moderation state and deleted state; exactly one is public.
create temp table t_ids (label text primary key, id uuid not null);
insert into t_ids
  select 'draft', pg_temp.seed_job('{"title": "Seed draft vacancy", "status": "draft"}')
  union all select 'open', pg_temp.seed_job('{"title": "Seed open vacancy", "status": "open"}')
  union all select 'paused', pg_temp.seed_job('{"title": "Seed paused vacancy", "status": "paused"}')
  union all select 'closed', pg_temp.seed_job('{"title": "Seed closed vacancy", "status": "closed"}')
  union all select 'filled', pg_temp.seed_job('{"title": "Seed filled vacancy", "status": "filled"}')
  union all select 'hidden', pg_temp.seed_job('{"title": "Seed hidden vacancy", "status": "open", "moderation_state": "hidden"}')
  union all select 'suspended', pg_temp.seed_job('{"title": "Seed suspended vacancy", "status": "open", "moderation_state": "org_suspended"}')
  union all select 'deleted', pg_temp.seed_job('{"title": "Seed deleted vacancy", "status": "open", "deleted_at": "2026-01-01T00:00:00Z"}');

select is((select count(*) from public.jobs), 8::bigint, 'eight vacancies of Acme exist, one of them public');
select is(
  (select count(*) from (
    select pg_temp.val_as(:'own1', 'aal1', 'select count(*)::text from public.jobs')::int as n) s where n > 1),
  1::bigint, 'control: the Acme owner can read their own non-public vacancies through the table'
);
select is(pg_temp.search_ids('anon', null), (select id::text from t_ids where label = 'open'), 'an anonymous caller finds only the open, visible, undeleted vacancy');
select is(pg_temp.search_ids('authenticated', :'wa'), (select id::text from t_ids where label = 'open'), 'a candidate finds only that vacancy');
select is(pg_temp.search_ids('authenticated', :'own1'), (select id::text from t_ids where label = 'open'), 'the Acme owner finds only that vacancy');
select is(pg_temp.search_ids('authenticated', :'adm'), (select id::text from t_ids where label = 'open'), 'an Acme admin finds only that vacancy');
select is(pg_temp.search_ids('authenticated', :'mem'), (select id::text from t_ids where label = 'open'), 'an Acme member finds only that vacancy');
select is(pg_temp.search_ids('authenticated', :'own2'), (select id::text from t_ids where label = 'open'), 'the owner of another organisation finds only that vacancy');
select is(
  pg_temp.search_titles('p_q => ''draft'''), '',
  'the word of a draft title finds nothing: a draft is not reachable by keyword either'
);

-- A vacancy that becomes public appears, and one that stops being public leaves, without any other change.
create temp table t_flip as select pg_temp.seed_job('{"title": "Flip vacancy", "status": "draft"}') as id;
select is(pg_temp.search_titles('p_q => ''flip'''), '', 'a draft vacancy is not found');
select pg_temp.set_status(:'own1', (select id from t_flip), 'open') as flipped \gset
select is(pg_temp.search_titles('p_q => ''flip'''), 'Flip vacancy', 'it is found when it is open');
update public.jobs set moderation_state = 'hidden' where id = (select id from t_flip);
select is(pg_temp.search_titles('p_q => ''flip'''), '', 'it is not found when hidden by moderation');
update public.jobs set moderation_state = 'visible', deleted_at = now() where id = (select id from t_flip);
select is(pg_temp.search_titles('p_q => ''flip'''), '', 'it is not found when deleted');

-- The result columns: exactly the public ones, the employer by display name and slug, and the keyset cursor.
select is(
  (select array_agg(a.name order by a.ord)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a (name, mode, ord)
   where p.oid = 'public.search_jobs(text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean, public.recruitment_preference, text, integer)'::regprocedure
     and a.mode = 't'),
  array[
    'id', 'title', 'employer_display_name', 'employer_slug', 'country_code', 'city', 'employment_type', 'salary_min',
    'salary_max', 'salary_currency', 'salary_period', 'accommodation', 'visa_support', 'recruitment_preference',
    'created_at', 'next_cursor'
  ],
  'the result columns are the public ones plus the cursor: no created_by, no legal name, no member data'
);
select is(
  (select count(*) from public.search_jobs() s where s.employer_display_name = 'Acme Bau' and s.employer_slug is not null),
  1::bigint, 'the employer is named by its display name, not its legal name'
);
select is(
  (select count(*) from public.search_jobs() s where to_jsonb(s)::text like '%Acme Bau GmbH%'), 0::bigint,
  'the legal name of the employer is nowhere in the result'
);

-- Who may execute it, and how it runs.
select ok(has_function_privilege('anon', 'public.search_jobs(text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean, public.recruitment_preference, text, integer)', 'execute'), 'anon can execute search_jobs');
select ok(has_function_privilege('authenticated', 'public.search_jobs(text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean, public.recruitment_preference, text, integer)', 'execute'), 'authenticated can execute search_jobs');
select ok(not has_function_privilege('service_role', 'public.search_jobs(text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean, public.recruitment_preference, text, integer)', 'execute'), 'service_role cannot execute search_jobs');
select is(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""']
   from pg_proc p where p.proname = 'search_jobs' and p.pronamespace = 'public'::regnamespace),
  true, 'search_jobs is a stable definer function with an empty search path'
);
select is(
  (select p.prosrc ~* 'billing' from pg_proc p where p.proname = 'search_jobs' and p.pronamespace = 'public'::regnamespace),
  false, 'the function never reads billing: a plan cannot change the order'
);

-- The indexes of FR-C3 AC10 and the ones the filters need.
select ok(
  exists (select 1 from pg_indexes where tablename = 'jobs' and schemaname = 'public'
          and indexdef like '%(status, country_code, occupation_id, created_at DESC)%'),
  'jobs has the index (status, country_code, occupation_id, created_at desc)'
);
select ok(
  exists (select 1 from pg_indexes where tablename = 'jobs' and schemaname = 'public' and indexdef like '%(organization_id, status)%'),
  'jobs has the index (organization_id, status)'
);
select ok(
  exists (select 1 from pg_indexes where tablename = 'jobs' and schemaname = 'public' and indexdef like '%USING gin (search_vector)%'),
  'jobs has the GIN index on search_vector'
);
select ok(
  exists (select 1 from pg_indexes where tablename = 'jobs' and schemaname = 'public' and indexdef like '%USING gin (title%gin_trgm_ops)%'),
  'jobs has the pg_trgm GIN index on title'
);
select is(
  (select array_agg(indexname::text order by indexname) from pg_indexes
   where tablename = 'jobs' and schemaname = 'public'
     and indexdef like '%WHERE%status = ''open''%deleted_at IS NULL%moderation_state = ''visible''%'),
  array['jobs_public_city_idx', 'jobs_public_employment_type_idx', 'jobs_public_industry_idx', 'jobs_public_newest_idx'],
  'these four indexes each hold only public vacancies (status, deleted_at and moderation_state in the predicate), which covers the policy columns'
);
select ok(
  exists (select 1 from pg_indexes where indexname = 'jobs_public_industry_idx' and indexdef like '%(industry_code, created_at DESC, id DESC)%'),
  'industry_code has an index'
);
select ok(
  exists (select 1 from pg_indexes where indexname = 'jobs_public_employment_type_idx' and indexdef like '%(employment_type, created_at DESC, id DESC)%'),
  'employment_type has an index'
);
select ok(
  exists (select 1 from pg_indexes where indexname = 'jobs_public_city_idx' and indexdef like '%private.fold_text(city)%'),
  'the whole-value city filter has an index on the folded city'
);
select ok(
  exists (select 1 from pg_indexes where indexname = 'jobs_public_newest_idx' and indexdef like '%(created_at DESC, id DESC)%'),
  'the newest-first order of the public vacancies has an index'
);

select * from finish();
rollback;
