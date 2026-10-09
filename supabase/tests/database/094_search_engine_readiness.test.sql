begin;
select plan(45);

\ir search_fixture.inc

-- FR-H5 AC3, AC4: one vacancy in every status, moderation state and deleted state, two of them public with the same
-- creation time, so the order after the time is the id.
create temp table t_ids (label text primary key, id uuid not null);
insert into t_ids
  select 'draft', pg_temp.seed_job('{"title": "Seed draft vacancy", "status": "draft", "created_at": "2026-03-01T10:00:00Z"}')
  union all select 'open_old', pg_temp.seed_job('{"title": "Seed old open vacancy", "status": "open", "created_at": "2026-03-02T10:00:00Z"}')
  union all select 'paused', pg_temp.seed_job('{"title": "Seed paused vacancy", "status": "paused", "created_at": "2026-03-03T10:00:00Z"}')
  union all select 'closed', pg_temp.seed_job('{"title": "Seed closed vacancy", "status": "closed", "created_at": "2026-03-04T10:00:00Z"}')
  union all select 'filled', pg_temp.seed_job('{"title": "Seed filled vacancy", "status": "filled", "created_at": "2026-03-05T10:00:00Z"}')
  union all select 'hidden', pg_temp.seed_job('{"title": "Seed hidden vacancy", "status": "open", "moderation_state": "hidden", "created_at": "2026-03-06T10:00:00Z"}')
  union all select 'suspended', pg_temp.seed_job('{"title": "Seed suspended vacancy", "status": "open", "moderation_state": "org_suspended", "created_at": "2026-03-07T10:00:00Z"}')
  union all select 'deleted', pg_temp.seed_job('{"title": "Seed deleted vacancy", "status": "open", "deleted_at": "2026-04-01T00:00:00Z", "created_at": "2026-03-08T10:00:00Z"}')
  union all select 'open_a', pg_temp.seed_job('{"title": "Seed open vacancy A", "status": "open", "created_at": "2026-03-09T10:00:00.123456Z"}')
  union all select 'open_b', pg_temp.seed_job('{"title": "Seed open vacancy B", "status": "open", "created_at": "2026-03-09T10:00:00.123456Z"}')
  union all select 'open_new', pg_temp.seed_job('{"title": "Seed new open vacancy", "status": "open", "created_at": "2026-03-10T10:00:00Z"}', current_setting('t.b')::uuid);

-- list_sitemap_jobs as p_role with the named arguments p_args; the entries as a jsonb array.
create function pg_temp.sitemap_as(p_role text, p_args text default '') returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
begin
  execute format('set local role %I', p_role);
  execute format('select public.list_sitemap_jobs(%s)', p_args) into v_result;
  reset role;
  return v_result;
end;
$$;

-- The ids of those entries that are vacancies of this test, in the order of the page.
create function pg_temp.labels(p_entries jsonb) returns text
language sql as $$
  select coalesce(string_agg(t.label, ',' order by e.o), '')
  from jsonb_array_elements(p_entries) with ordinality as e (entry, o)
  join t_ids t on t.id = (e.entry ->> 'id')::uuid
$$;

-- The set of vacancies: only the open, visible and undeleted ones are listed, newest first, with the id as the tie-break.
select is(
  pg_temp.labels(pg_temp.sitemap_as('anon')),
  (select string_agg(label, ',' order by o) from (
     select 'open_new' as label, 1 as o
     union all select label, 2 + row_number() over (order by id desc) from t_ids where label in ('open_a', 'open_b')
     union all select 'open_old', 9) x),
  'an anonymous caller lists the open, visible, undeleted vacancies newest first, the id breaking a tie, and no other'
);
select is(pg_temp.labels(pg_temp.sitemap_as('authenticated')), pg_temp.labels(pg_temp.sitemap_as('anon')), 'a signed-in caller lists the same');
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.sitemap_as('anon')) e
   where e ->> 'id' in (select id::text from t_ids where label in ('draft', 'paused', 'closed', 'filled', 'hidden', 'suspended', 'deleted'))),
  0, 'no draft, paused, closed, filled, hidden, suspended or deleted vacancy is listed'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.sitemap_as('anon') -> 0) k),
  array['created_at', 'id', 'updated_at'],
  'an entry holds the id and the two dates and nothing else'
);

-- A vacancy that becomes public appears, and one that stops being public leaves, with no other change.
create temp table t_flip as select pg_temp.seed_job('{"title": "Flip vacancy", "status": "draft"}') as id;
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.sitemap_as('anon')) e where e ->> 'id' = (select id::text from t_flip)), 'a draft is not listed');
select pg_temp.set_status(:'own1', (select id from t_flip), 'open') as opened \gset
select ok(exists (select 1 from jsonb_array_elements(pg_temp.sitemap_as('anon')) e where e ->> 'id' = (select id::text from t_flip)), 'it is listed when open');
select pg_temp.set_status(:'own1', (select id from t_flip), 'paused') as paused \gset
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.sitemap_as('anon')) e where e ->> 'id' = (select id::text from t_flip)), 'it is not listed when paused');
select pg_temp.set_status(:'own1', (select id from t_flip), 'open') as reopened \gset
update public.jobs set moderation_state = 'hidden' where id = (select id from t_flip);
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.sitemap_as('anon')) e where e ->> 'id' = (select id::text from t_flip)), 'it is not listed when hidden by moderation');
update public.jobs set moderation_state = 'org_suspended' where id = (select id from t_flip);
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.sitemap_as('anon')) e where e ->> 'id' = (select id::text from t_flip)), 'it is not listed when its organisation is suspended');
update public.jobs set moderation_state = 'visible' where id = (select id from t_flip);
select ok(exists (select 1 from jsonb_array_elements(pg_temp.sitemap_as('anon')) e where e ->> 'id' = (select id::text from t_flip)), 'it is listed again when visible');
update public.jobs set deleted_at = now() where id = (select id from t_flip);
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.sitemap_as('anon')) e where e ->> 'id' = (select id::text from t_flip)), 'it is not listed when deleted');

-- Keyset pages: each page starts after the last entry of the one before; the pages hold every entry once, in order.
create temp table t_all as select pg_temp.sitemap_as('anon') as j;
create temp table t_page1 as select pg_temp.sitemap_as('anon', 'p_limit => 2') as j;
select is(jsonb_array_length((select j from t_page1)), 2, 'p_limit 2 gives two entries');
create temp table t_page2 as
  select pg_temp.sitemap_as('anon', format('p_after_created => %L, p_after_id => %L, p_limit => 2',
    (select (j -> 1 ->> 'created_at') from t_page1), (select (j -> 1 ->> 'id') from t_page1))) as j;
create temp table t_page3 as
  select pg_temp.sitemap_as('anon', format('p_after_created => %L, p_after_id => %L, p_limit => 2',
    (select (j -> 1 ->> 'created_at') from t_page2), (select (j -> 1 ->> 'id') from t_page2))) as j;
select is(
  (select (a.j || b.j || c.j) from t_page1 a, t_page2 b, t_page3 c),
  (select j from t_all),
  'the pages follow one another with no gap and no repeat, even where two entries share the creation time'
);
select is(
  pg_temp.sitemap_as('anon', 'p_after_created => ''1970-01-01'', p_after_id => ''00000000-0000-0000-0000-000000000000'''),
  '[]'::jsonb, 'a page after the oldest entry is an empty array'
);
select is(jsonb_array_length(pg_temp.sitemap_as('anon', 'p_limit => 0')), 1, 'a limit below 1 gives one entry');
select is(jsonb_array_length(pg_temp.sitemap_as('anon', 'p_limit => 1000000')), jsonb_array_length((select j from t_all)), 'a limit above the maximum is cut, not refused');
select throws_ok(
  $$set local role anon; select public.list_sitemap_jobs(p_after_created => now())$$,
  'P0001', 'CHARA_INVALID_INPUT', 'a creation time without an id is refused'
);
reset role;
select throws_ok(
  $$set local role anon; select public.list_sitemap_jobs(p_after_id => gen_random_uuid())$$,
  'P0001', 'CHARA_INVALID_INPUT', 'an id without a creation time is refused'
);
reset role;

-- The dates of an entry are those of the row.
select is(
  (select e ->> 'created_at' from jsonb_array_elements(pg_temp.sitemap_as('anon')) e where e ->> 'id' = (select id::text from t_ids where label = 'open_a')),
  '2026-03-09T10:00:00.123456+00:00', 'created_at keeps the microseconds the next page needs'
);

-- Who may execute it, and how it runs.
select ok(has_function_privilege('anon', 'public.list_sitemap_jobs(timestamptz, uuid, integer)', 'execute'), 'anon can execute list_sitemap_jobs');
select ok(has_function_privilege('authenticated', 'public.list_sitemap_jobs(timestamptz, uuid, integer)', 'execute'), 'authenticated can execute list_sitemap_jobs');
select ok(not has_function_privilege('service_role', 'public.list_sitemap_jobs(timestamptz, uuid, integer)', 'execute'), 'service_role cannot execute list_sitemap_jobs');
select ok(not has_function_privilege('public', 'public.list_sitemap_jobs(timestamptz, uuid, integer)', 'execute'), 'public cannot execute list_sitemap_jobs');
select is(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""']
   from pg_proc p where p.proname = 'list_sitemap_jobs' and p.pronamespace = 'public'::regnamespace),
  true, 'list_sitemap_jobs is a stable definer function with an empty search path'
);
select is(
  (select p.prosrc ~* 'billing|legal_name|created_by|organization_members|description|title' from pg_proc p
   where p.proname = 'list_sitemap_jobs' and p.pronamespace = 'public'::regnamespace),
  false, 'the function reads neither billing, nor the legal name, nor the creator, nor the members, nor any text of the vacancy'
);

-- jobs.updated_at: the creation time first, the time of the change after every update.
create temp table t_touch as
  select pg_temp.seed_job('{"title": "Touch vacancy", "status": "open"}') as id;
update public.jobs set updated_at = '2026-01-01T00:00:00Z' where id = (select id from t_touch);
select is((select updated_at from public.jobs where id = (select id from t_touch)), now(), 'an update stamps updated_at, whatever the statement sets it to');
select is(
  (select updated_at from public.jobs where id = (select id from t_ids where label = 'draft')), now(),
  'a vacancy inserted in this transaction has the time of the insert'
);
insert into public.jobs (organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type, recruitment_preference, updated_at, created_at)
  values (current_setting('t.a')::uuid, 'Old vacancy', btrim(repeat('Weld steel frames in the workshop. ', 2)), '7212', 'C', 'DE', 'Hamburg', 'full_time', 'both', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
select is(
  (select updated_at from public.jobs where title = 'Old vacancy'), '2026-01-02T00:00:00Z'::timestamptz,
  'a row nobody updated keeps its date'
);
update public.jobs set title = 'Old vacancy, renamed' where title = 'Old vacancy';
select is((select updated_at from public.jobs where title = 'Old vacancy, renamed'), now(), 'an edit of the text stamps it');
update public.jobs set updated_at = '2026-01-02T00:00:00Z' where title = 'Old vacancy, renamed';
update public.jobs set moderation_state = 'hidden' where title = 'Old vacancy, renamed';
select is((select updated_at from public.jobs where title = 'Old vacancy, renamed'), now(), 'a moderation decision stamps it');
select pg_temp.call_as(:'own1', 'authenticated',
  format('update public.jobs set status = %L, updated_at = %L where id = %L', 'paused', '2026-01-01T00:00:00Z', (select id from t_touch)), 'aal1') as paused_touch \gset
select is((select updated_at from public.jobs where id = (select id from t_touch)), now(), 'a status change by a member stamps it');

-- The audit log does not treat the stamp as an edit.
create temp table t_audit_before as select count(*) as n from audit.log where entity_id = (select id::text from t_touch);
update public.jobs set title = title where id = (select id from t_touch);
select is(
  (select count(*) from audit.log where entity_id = (select id::text from t_touch)), (select n from t_audit_before),
  'an update that changes nothing writes no audit row'
);
update public.jobs set title = 'Touch vacancy, renamed' where id = (select id from t_touch);
select is(
  (select metadata -> 'changed_fields' from audit.log where entity_id = (select id::text from t_touch) and action = 'job.updated' order by id desc limit 1),
  '["title"]'::jsonb, 'a title edit is audited as the title alone, without updated_at'
);

-- updated_at is no column of the API.
select throws_ok($$set local role anon; select updated_at from public.jobs$$, '42501', null, 'anon cannot read updated_at');
reset role;
select throws_ok($$set local role authenticated; select updated_at from public.jobs$$, '42501', null, 'authenticated cannot read updated_at');
reset role;
select throws_ok(
  format($$set local role authenticated; set local request.jwt.claims = '{"sub": "%s", "role": "authenticated", "aal": "aal1"}'; update public.jobs set updated_at = now() where id = '%s'$$, :'own1', (select id from t_touch)),
  '42501', null, 'a member cannot write updated_at'
);
reset role;

-- published_legal_slugs: the slugs among the given ones that have a published version.
insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values
  ('seo-unpublished', 1, 'Unpublished notice', 'The text.', 'The first text of the notice.', null),
  ('seo-future', 1, 'Future notice', 'The text.', 'The first text of the notice.', now() + interval '1 day'),
  ('seo-published', 1, 'Published notice', 'The text.', 'The first text of the notice.', now() - interval '1 day');

create function pg_temp.legal_slugs(p_role text, p_slugs text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  execute format('set local role %I', p_role);
  execute format('select coalesce(string_agg(s, '','' order by s), '''') from public.published_legal_slugs(%s) s', p_slugs) into v_result;
  reset role;
  return v_result;
end;
$$;

select is(
  pg_temp.legal_slugs('anon', $$array['seo-unpublished', 'seo-future', 'seo-published', 'seo-missing', 'terms-of-service']$$),
  'seo-published,terms-of-service', 'only the slugs with a version published now are returned'
);
select is(pg_temp.legal_slugs('authenticated', $$array['seo-published']$$), 'seo-published', 'a signed-in caller gets the same');
select is(pg_temp.legal_slugs('anon', $$array['seo-published', 'seo-published']$$), 'seo-published', 'a slug given twice is returned once');
select is(pg_temp.legal_slugs('anon', $$array[]::text[]$$), '', 'no slug gives no slug');
select throws_ok($$select public.published_legal_slugs(null)$$, 'P0001', 'CHARA_INVALID_INPUT', 'null is refused');
select throws_ok(
  $$select public.published_legal_slugs((select array_agg('slug-' || i) from generate_series(1, 51) i))$$,
  'P0001', 'CHARA_INVALID_INPUT', 'more than 50 slugs are refused'
);
select ok(has_function_privilege('anon', 'public.published_legal_slugs(text[])', 'execute'), 'anon can execute published_legal_slugs');
select ok(not has_function_privilege('service_role', 'public.published_legal_slugs(text[])', 'execute'), 'service_role cannot execute published_legal_slugs');
select is(
  (select not p.prosecdef and p.proconfig @> array['search_path=""']
   from pg_proc p where p.proname = 'published_legal_slugs' and p.pronamespace = 'public'::regnamespace),
  true, 'published_legal_slugs runs with the rights of the caller and an empty search path'
);

select * from finish();
rollback;
