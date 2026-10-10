begin;
select plan(30);

\ir search_fixture.inc

-- FR-C4 AC7, AC8: vacancies of Acme in every status, moderation state and deleted state; exactly one is public.
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

-- The number of rows get_public_job gives to p_role for p_user (null for anonymous), or the error of the call.
create function pg_temp.page_rows(p_role text, p_user uuid, p_id uuid) returns text
language plpgsql as $$
declare
  v_rows bigint;
begin
  v_rows := pg_temp.affected_as(p_user, p_role, format('select * from public.get_public_job(%L)', p_id));
  return v_rows::text;
exception when others then
  reset role;
  return sqlstate;
end;
$$;

-- The row of the page as an anonymous caller reads it, as JSON; null when there is none.
create function pg_temp.page_json(p_id uuid) returns jsonb
language plpgsql as $$
declare
  v_row jsonb;
begin
  set local role anon;
  select to_jsonb(g) into v_row from public.get_public_job(p_id) g;
  reset role;
  return v_row;
end;
$$;

create function pg_temp.page_title(p_id uuid) returns text
language sql as $$ select pg_temp.page_json(p_id) ->> 'title' $$;

select is(
  (select string_agg(t.label || '=' || pg_temp.page_rows('anon', null, t.id), ',' order by t.label) from t_ids t),
  'closed=0,deleted=0,draft=0,filled=0,hidden=0,open=1,paused=0,suspended=0',
  'an anonymous caller gets a row for the open, visible, undeleted vacancy and for no other state'
);
select is(pg_temp.page_rows('anon', null, '6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11'), '0', 'an id that does not exist gives no row');
select is(pg_temp.page_rows('anon', null, null), '0', 'a null id gives no row');

select is(
  (select string_agg(t.label || '=' || pg_temp.page_rows('authenticated', :'wa', t.id), ',' order by t.label) from t_ids t),
  'closed=0,deleted=0,draft=0,filled=0,hidden=0,open=1,paused=0,suspended=0',
  'a candidate gets the same'
);
select is(
  (select string_agg(t.label || '=' || pg_temp.page_rows('authenticated', :'own1', t.id), ',' order by t.label) from t_ids t),
  'closed=0,deleted=0,draft=0,filled=0,hidden=0,open=1,paused=0,suspended=0',
  'the owner of the organisation gets no row for its own draft, paused, closed, filled, hidden or deleted vacancy'
);
select is(
  (select string_agg(t.label || '=' || pg_temp.page_rows('authenticated', :'adm', t.id), ',' order by t.label) from t_ids t),
  'closed=0,deleted=0,draft=0,filled=0,hidden=0,open=1,paused=0,suspended=0',
  'an admin of the organisation gets the same'
);
select is(
  (select string_agg(t.label || '=' || pg_temp.page_rows('authenticated', :'mem', t.id), ',' order by t.label) from t_ids t),
  'closed=0,deleted=0,draft=0,filled=0,hidden=0,open=1,paused=0,suspended=0',
  'a member of the organisation gets the same'
);
select is(
  (select string_agg(t.label || '=' || pg_temp.page_rows('authenticated', :'own2', t.id), ',' order by t.label) from t_ids t),
  'closed=0,deleted=0,draft=0,filled=0,hidden=0,open=1,paused=0,suspended=0',
  'the owner of another organisation gets the same'
);

-- A vacancy that becomes public appears, and one that stops being public leaves, without any other change.
create temp table t_flip as select pg_temp.seed_job('{"title": "Flip vacancy", "status": "draft"}') as id;
select is(pg_temp.page_title((select id from t_flip)), null, 'a draft has no page');
select pg_temp.set_status(:'own1', (select id from t_flip), 'open') as flipped \gset
select is(pg_temp.page_title((select id from t_flip)), 'Flip vacancy', 'it has a page when it is open');
select pg_temp.set_status(:'own1', (select id from t_flip), 'paused') as paused \gset
select is(pg_temp.page_title((select id from t_flip)), null, 'it has none when paused');
select pg_temp.set_status(:'own1', (select id from t_flip), 'open') as reopened \gset
update public.jobs set moderation_state = 'hidden' where id = (select id from t_flip);
select is(pg_temp.page_title((select id from t_flip)), null, 'it has none when hidden by moderation');
update public.jobs set moderation_state = 'visible', deleted_at = now() where id = (select id from t_flip);
select is(pg_temp.page_title((select id from t_flip)), null, 'it has none when deleted');

-- FR-C4 AC1: the labels of the vacancy and the public profile of the employer.
update public.organizations set website = 'https://acme.example' where id = current_setting('t.a')::uuid;
create temp table t_page as select pg_temp.page_json((select id from t_ids where label = 'open')) as j;
select is(
  (select j - 'id' - 'published_at' - 'created_at' from t_page),
  jsonb_build_object(
    'title', 'Seed open vacancy',
    'description', (select description from public.jobs where id = (select id from t_ids where label = 'open')),
    'occupation', 'Welders and flame cutters',
    'industry', 'Manufacturing',
    'country_code', 'DE',
    'country', 'Germany',
    'city', 'Hamburg',
    'employment_type', 'full_time',
    'salary_min', null,
    'salary_max', null,
    'salary_currency', null,
    'salary_period', null,
    'accommodation', true,
    'visa_support', true,
    'recruitment_preference', 'both',
    'employer_display_name', 'Acme Bau',
    'employer_country', 'Germany',
    'employer_industry', 'Construction',
    'employer_website', 'https://acme.example'
  ),
  'the page has the labels of the lists and the employer by display name, country, industry and website'
);

-- FR-C4 AC2: no private column of the vacancy or the organisation is in the result.
select is(
  (select array_agg(a.name order by a.ord)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a (name, mode, ord)
   where p.oid = 'public.get_public_job(uuid)'::regprocedure and a.mode = 't'),
  array[
    'id', 'title', 'description', 'occupation', 'industry', 'country_code', 'country', 'city', 'employment_type',
    'salary_min', 'salary_max', 'salary_currency', 'salary_period', 'accommodation', 'visa_support',
    'recruitment_preference', 'published_at', 'created_at', 'employer_display_name', 'employer_country', 'employer_industry',
    'employer_website'
  ],
  'the result columns are the public ones: no created_by, no organisation id, no legal name, no member or plan data'
);
select is(
  (select count(*) from t_page where j::text like '%Acme Bau GmbH%'), 0::bigint,
  'the legal name of the employer is nowhere in the result'
);
select is(
  (select count(*) from t_page, auth.users u where j::text like '%' || u.email || '%'),
  0::bigint, 'no email of a member is in the result'
);

-- A website that is not http or https cannot be stored, so the card never has one to show as a link.
select throws_ok(
  $$update public.organizations set website = 'javascript:alert(1)' where id = current_setting('t.a')::uuid$$,
  '23514', null, 'a website of another scheme is refused by the table'
);

-- datePosted: the first publication, kept through a pause and a reopening, and the creation time when there is none.
create temp table t_dates as
  select pg_temp.seed_job('{"title": "Dated vacancy", "status": "draft"}') as id,
         pg_temp.seed_job('{"title": "Unpublished open vacancy", "status": "open", "created_at": "2026-03-04T05:06:07Z"}') as undated;
select pg_temp.set_status(:'own1', (select id from t_dates), 'open') as opened \gset
update public.jobs set published_at = '2026-02-02T10:00:00Z' where id = (select id from t_dates);
select pg_temp.set_status(:'own1', (select id from t_dates), 'paused') as paused2 \gset
select pg_temp.set_status(:'own1', (select id from t_dates), 'open') as reopened2 \gset
select is(
  (pg_temp.page_json((select id from t_dates)) ->> 'published_at')::timestamptz, '2026-02-02T10:00:00Z'::timestamptz,
  'published_at is the first publication, unchanged by a pause and a reopening'
);
select is(
  (pg_temp.page_json((select undated from t_dates)) ->> 'published_at')::timestamptz, '2026-03-04T05:06:07Z'::timestamptz,
  'a vacancy with no published_at shows its creation time'
);

-- A salary is returned as stored, with its currency and pay period, and a range with only a minimum keeps the maximum null.
create temp table t_salary as
  select pg_temp.seed_job('{"title": "Paid vacancy", "status": "open", "salary_min": 2800, "salary_max": 3400, "salary_currency": "EUR", "salary_period": "month"}') as paid,
         pg_temp.seed_job('{"title": "Minimum only vacancy", "status": "open", "salary_min": 2800, "salary_currency": "EUR", "salary_period": "month"}') as floor;
select is(
  (select (j -> 'salary_min')::text || ' ' || (j -> 'salary_max')::text || ' ' || (j ->> 'salary_currency') || ' ' || (j ->> 'salary_period')
   from (select pg_temp.page_json((select paid from t_salary)) as j) s),
  '2800.00 3400.00 EUR month', 'the salary range comes with its currency and pay period'
);
select is(
  (select (j -> 'salary_min')::text || ' ' || (j -> 'salary_max')::text
   from (select pg_temp.page_json((select floor from t_salary)) as j) s),
  '2800.00 null', 'a salary with only a minimum has no maximum'
);

-- Who may execute it, and how it runs.
select ok(has_function_privilege('anon', 'public.get_public_job(uuid)', 'execute'), 'anon can execute get_public_job');
select ok(has_function_privilege('authenticated', 'public.get_public_job(uuid)', 'execute'), 'authenticated can execute get_public_job');
select ok(not has_function_privilege('service_role', 'public.get_public_job(uuid)', 'execute'), 'service_role cannot execute get_public_job');
select ok(not has_function_privilege('public', 'public.get_public_job(uuid)', 'execute'), 'public cannot execute get_public_job');
select is(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""']
   from pg_proc p where p.proname = 'get_public_job' and p.pronamespace = 'public'::regnamespace),
  true, 'get_public_job is a stable definer function with an empty search path'
);
select is(
  (select p.prosrc ~* 'billing|legal_name|created_by|organization_members' from pg_proc p
   where p.proname = 'get_public_job' and p.pronamespace = 'public'::regnamespace),
  false, 'the function reads neither billing, nor the legal name, nor the creator, nor the members'
);

-- An anonymous caller still cannot read the organisation or the creator straight from the tables.
select throws_ok(
  $$set local role anon; select 1 from public.organizations$$, '42501', null,
  'anon cannot read the organisations table'
);
select throws_ok(
  $$set local role anon; select created_by from public.jobs$$, '42501', null,
  'created_by is not readable through the API'
);
reset role;

select * from finish();
rollback;
