begin;
select plan(32);

\ir search_fixture.inc

-- FR-C3 AC6: keyset pages are stable. 45 vacancies of Sweden, page size 20.
create temp table t_original (id uuid primary key);
insert into t_original
  select pg_temp.seed_job(jsonb_build_object(
    'title', format('Paged vacancy %s', lpad(n::text, 2, '0')), 'status', 'open', 'country_code', 'SE', 'city', 'Malmo',
    'created_at', '2026-04-01T00:00:00Z'::timestamptz + n * interval '1 minute'
  ))
  from generate_series(1, 45) n;
select set_config('t.page1', pg_temp.page('p_country => ''SE'', p_limit => 20')::text, true);
select pg_temp.seed_job('{"title": "Paged vacancy newest", "status": "open", "country_code": "SE", "created_at": "2026-05-01T00:00:00Z"}');
select set_config(
  't.page2',
  pg_temp.page(format('p_country => ''SE'', p_limit => 20, p_cursor => %L', current_setting('t.page1')::jsonb ->> 'cursor'))::text,
  true
);
select set_config(
  't.page3',
  pg_temp.page(format('p_country => ''SE'', p_limit => 20, p_cursor => %L', current_setting('t.page2')::jsonb ->> 'cursor'))::text,
  true
);

select is(jsonb_array_length(current_setting('t.page1')::jsonb -> 'ids'), 20, 'page 1 holds 20 vacancies');
select is(jsonb_array_length(current_setting('t.page2')::jsonb -> 'ids'), 20, 'page 2 holds 20 vacancies');
select is(jsonb_array_length(current_setting('t.page3')::jsonb -> 'ids'), 5, 'page 3 holds the remaining 5');
select isnt(current_setting('t.page1')::jsonb ->> 'cursor', null, 'page 1 returns a cursor');
select isnt(current_setting('t.page2')::jsonb ->> 'cursor', null, 'page 2 returns a cursor');
select is(current_setting('t.page3')::jsonb ->> 'cursor', null, 'the last page returns no cursor');
select is(
  (select count(distinct x) from (
    select jsonb_array_elements_text(current_setting(k)::jsonb -> 'ids') x from unnest(array['t.page1', 't.page2', 't.page3']) k) s),
  45::bigint, 'the three pages hold 45 different vacancies'
);
select is(
  (select count(*) from (
    select jsonb_array_elements_text(current_setting(k)::jsonb -> 'ids')::uuid x from unnest(array['t.page1', 't.page2', 't.page3']) k) s
   where x in (select id from t_original)),
  45::bigint, 'and they are exactly the original 45: none skipped'
);
select is(
  (select count(*) from (
    select jsonb_array_elements_text(current_setting(k)::jsonb -> 'ids')::uuid x from unnest(array['t.page2', 't.page3']) k) s
   where x = (select id from public.jobs where title = 'Paged vacancy newest')),
  0::bigint, 'the vacancy created after page 1 does not appear on pages 2 and 3'
);
select is(
  (select string_agg(j.title, ',' order by j.created_at desc, j.id desc) from public.jobs j
   where j.id = (current_setting('t.page1')::jsonb -> 'ids' ->> 0)::uuid),
  'Paged vacancy 45', 'the first page starts with the newest of the original vacancies'
);

-- Page size: capped at 50, 20 when missing, at least 1.
insert into t_original
  select pg_temp.seed_job(jsonb_build_object(
    'title', format('Paged extra %s', n), 'status', 'open', 'country_code', 'PL', 'city', 'Krakow',
    'created_at', '2026-06-01T00:00:00Z'::timestamptz + n * interval '1 minute'
  ))
  from generate_series(1, 55) n;
select is(jsonb_array_length(pg_temp.page('p_country => ''PL'', p_limit => 500') -> 'ids'), 50, 'a limit of 500 is capped at 50');
select isnt(pg_temp.page('p_country => ''PL'', p_limit => 500') ->> 'cursor', null, 'and the capped page has a successor');
select is(jsonb_array_length(pg_temp.page('p_country => ''PL''') -> 'ids'), 20, 'a missing limit gives 20');
select is(jsonb_array_length(pg_temp.page('p_country => ''PL'', p_limit => 0') -> 'ids'), 1, 'a limit of 0 gives 1');
select is(jsonb_array_length(pg_temp.page('p_country => ''PL'', p_limit => -5') -> 'ids'), 1, 'a negative limit gives 1');
select is(jsonb_array_length(pg_temp.page('p_country => ''PL'', p_limit => 55') -> 'ids'), 50, 'and 55 is capped at 50');

-- Pages with a keyword are ordered by relevance across the cursor: the walk equals the unpaged order.
delete from public.jobs;
select pg_temp.seed_job(jsonb_build_object(
  'title', format('Relevance %s', lpad(n::text, 2, '0')), 'status', 'open',
  'created_at', '2026-07-01T00:00:00Z'::timestamptz + n * interval '1 minute',
  'description', 'We need ' || repeat('welder ', 1 + n % 4) || 'for the steel frames of our workshop in Hamburg.'
))
from generate_series(1, 14) n;
create temp table t_walk (page int, ids jsonb);
do $walk$
declare
  v_cursor text;
  v_page jsonb;
  v_n int := 0;
begin
  loop
    v_n := v_n + 1;
    v_page := pg_temp.page(
      'p_q => ''welder'', p_limit => 5' || case when v_cursor is null then '' else format(', p_cursor => %L', v_cursor) end
    );
    insert into t_walk values (v_n, v_page -> 'ids');
    v_cursor := v_page ->> 'cursor';
    exit when v_cursor is null or v_n > 10;
  end loop;
end
$walk$;
select is((select count(*) from t_walk), 3::bigint, '14 vacancies in pages of 5 take three pages');
select is(
  (select string_agg(x, ',' order by p.page, o) from t_walk p, jsonb_array_elements_text(p.ids) with ordinality as e (x, o)),
  (select string_agg(x, ',' order by o) from jsonb_array_elements_text(pg_temp.page('p_q => ''welder'', p_limit => 50') -> 'ids') with ordinality as e (x, o)),
  'the pages of a keyword search in a row equal the unpaged order, so the cursor carries the relevance'
);
select is(
  (select string_agg(j.title, ',' order by o) from jsonb_array_elements_text(pg_temp.page('p_q => ''welder'', p_limit => 4') -> 'ids') with ordinality as e (x, o)
   join public.jobs j on j.id = e.x::uuid),
  'Relevance 11,Relevance 07,Relevance 03,Relevance 14',
  'the vacancies with four occurrences come first, newest first'
);

-- Refused input: the stable code with the parameter in the detail, and nothing is run.
select is(pg_temp.search_ids('anon', null, format('p_q => %L', repeat('a', 101))), 'P0001|CHARA_INVALID_INPUT|p_q', 'a keyword of 101 characters is refused');
select is(pg_temp.search_ids('anon', null, format('p_q => %L', repeat('a', 100))) like 'P0001%', false, 'a keyword of 100 characters is accepted');
select is(pg_temp.search_ids('anon', null, format('p_city => %L', repeat('a', 101))), 'P0001|CHARA_INVALID_INPUT|p_city', 'a city of 101 characters is refused');
select is(pg_temp.search_ids('anon', null, 'p_country => ''DEU'''), 'P0001|CHARA_INVALID_INPUT|p_country', 'a country of three letters is refused');
select is(pg_temp.search_ids('anon', null, 'p_country => ''1A'''), 'P0001|CHARA_INVALID_INPUT|p_country', 'a country with a digit is refused');
select is(pg_temp.search_ids('anon', null, 'p_recruitment => ''both'''), 'P0001|CHARA_INVALID_INPUT|p_recruitment', 'recruitment both is refused: it is not a filter');
select is(pg_temp.search_ids('anon', null, 'p_salary_min => 3000, p_salary_period => ''month'''), 'P0001|CHARA_INVALID_INPUT|p_salary_currency', 'a minimum salary without a currency is refused');
select is(pg_temp.search_ids('anon', null, 'p_salary_min => 3000, p_salary_currency => ''EUR'''), 'P0001|CHARA_INVALID_INPUT|p_salary_period', 'a minimum salary without a pay period is refused');
select is(pg_temp.search_ids('anon', null, 'p_salary_min => 0, p_salary_currency => ''EUR'', p_salary_period => ''month'''), 'P0001|CHARA_INVALID_INPUT|p_salary_min', 'a minimum salary of 0 is refused');
select is(pg_temp.search_ids('anon', null, 'p_salary_min => 10000000, p_salary_currency => ''EUR'', p_salary_period => ''month'''), 'P0001|CHARA_INVALID_INPUT|p_salary_min', 'a minimum salary above 9,999,999.99 is refused');
select is(pg_temp.search_ids('anon', null, 'p_cursor => ''not a cursor'''), 'P0001|CHARA_INVALID_INPUT|p_cursor', 'a malformed cursor is refused');
select is(pg_temp.search_ids('anon', null, 'p_cursor => ''0|2026-07-01T00:00:00.000000Z|ffffffff-ffff-ffff-ffff-ffffffffffff-ffff'''), 'P0001|CHARA_INVALID_INPUT|p_cursor', 'a cursor of the right shape that does not parse is refused');
select is(split_part(pg_temp.search_ids('anon', null, 'p_employment_type => ''forever'''), '|', 1), '22P02', 'an employment type outside the list is refused by the type');

select * from finish();
rollback;
