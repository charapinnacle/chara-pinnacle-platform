-- The GeoNames cities of the City suggestions: a reference table readable by everyone and writable by nobody, and
-- suggest_cities, which lists the cities of one country with the cities of public vacancies first.
begin;
select plan(29);

\ir search_fixture.inc

-- suggest_cities as anon with the arguments p_args; the names in order, or 'sqlstate|message|detail' when refused.
create function pg_temp.suggest(p_args text) returns text
language plpgsql as $$
declare
  v_result text;
  v_detail text;
begin
  set local role anon;
  begin
    execute format(
      'select coalesce(string_agg(s.n, '','' order by s.o), '''') from public.suggest_cities(%s) with ordinality as s (n, o)',
      p_args
    ) into v_result;
  exception when others then
    get stacked diagnostics v_result = returned_sqlstate, v_detail = pg_exception_detail;
    v_result := v_result || '|' || sqlerrm || '|' || coalesce(v_detail, '');
  end;
  reset role;
  return v_result;
end;
$$;

-- The table
select has_table('public', 'cities', 'cities table exists');
select cmp_ok((select count(*) from public.cities), '>=', 20000::bigint, 'the GeoNames cities are seeded');
select ok(exists (select 1 from public.cities where country_code = 'DE' and name = 'Berlin'), 'Berlin is seeded under DE');
select is_empty(
  $$select country_code, name from public.cities group by 1, 2 having count(*) > 1$$,
  'a name is seeded once per country'
);
select is_empty(
  $$
    select r.rolname, p.priv
    from unnest(array['anon', 'authenticated', 'service_role']) as r (rolname)
    cross join unnest(array['insert', 'update', 'delete', 'truncate']) as p (priv)
    where has_table_privilege(r.rolname, 'public.cities', p.priv)
  $$,
  'no API role has a write grant on cities'
);
select ok(not has_table_privilege('service_role', 'public.cities', 'select'), 'service_role cannot read cities');
select is(
  (select array_agg(policyname::text) from pg_policies where schemaname = 'public' and tablename = 'cities'),
  array['cities_select'], 'cities has exactly the one select policy'
);
select has_index('public', 'cities', 'cities_country_fold_name_idx', 'the folded name within a country is indexed');

set local role anon;
select ok(exists (select 1 from public.cities where name = 'Berlin'), 'anon can select cities');
select throws_ok($$insert into public.cities (id, country_code, name) values (-1, 'DE', 'Probe')$$, '42501', null, 'anon cannot insert into cities');
select throws_ok($$update public.cities set name = 'Probe'$$, '42501', null, 'anon cannot update cities');
reset role;
set local role authenticated;
select throws_ok($$delete from public.cities$$, '42501', null, 'authenticated cannot delete from cities');
reset role;

-- Who may run suggest_cities
select ok(has_function_privilege('anon', 'public.suggest_cities(text, text)', 'execute'), 'anon can execute suggest_cities');
select ok(has_function_privilege('authenticated', 'public.suggest_cities(text, text)', 'execute'), 'authenticated can execute suggest_cities');
select ok(not has_function_privilege('service_role', 'public.suggest_cities(text, text)', 'execute'), 'service_role cannot execute suggest_cities');

-- The order, on cities of this test only: the seeded German cities are removed in this rolled-back transaction.
delete from public.cities where country_code = 'DE';
insert into public.cities (id, country_code, name, population) values
  (-1, 'DE', 'Bergen', 100),
  (-2, 'DE', 'Berlin', 1000),
  (-3, 'DE', 'Oberberg', 5000),
  (-4, 'DE', 'Bad Berleburg', 200),
  (-5, 'DE', 'Hamburg', 2000),
  (-6, 'DE', U&'K\00F6ln', 900);
insert into public.cities (id, country_code, name, population)
  select -100 - n, 'DE', 'Teststadt ' || n, n from generate_series(1, 12) n;

select pg_temp.seed_job('{"title": "Open in Hamburg", "status": "open"}') as j_hamburg \gset
select pg_temp.seed_job('{"title": "Open in Neuberg", "status": "open", "city": "Neuberg Ost"}') as j_neuberg \gset
select pg_temp.seed_job('{"title": "Draft in Bernau", "status": "draft", "city": "Bernau"}') as j_draft \gset
select pg_temp.seed_job('{"title": "Hidden in Berkheim", "status": "open", "city": "Berkheim", "moderation_state": "hidden"}') as j_hidden \gset
select pg_temp.seed_job('{"title": "Deleted in Berga", "status": "open", "city": "Berga", "deleted_at": "2026-01-01T00:00:00Z"}') as j_deleted \gset
select pg_temp.seed_job('{"title": "Open in Berkel", "status": "open", "city": "Berkel", "country_code": "NL"}') as j_nl \gset

select is(
  pg_temp.suggest($$'DE', 'ber'$$),
  'Neuberg Ost,Berlin,Bergen,Bad Berleburg,Oberberg',
  'a public vacancy city first (though GeoNames lacks it), then names that start with the text by size, then a word start, then inside a word'
);
select is(
  pg_temp.suggest($$'DE', ''$$),
  U&'Hamburg,Neuberg Ost,Oberberg,Berlin,K\00F6ln,Bad Berleburg,Bergen,Teststadt 12,Teststadt 11,Teststadt 10',
  'an empty text gives the vacancy cities, then the largest cities, ten at most'
);
select is(pg_temp.suggest($$'DE', null$$), pg_temp.suggest($$'DE', ''$$), 'a null text is an empty text');
select is(
  pg_temp.suggest($$'DE', 'hamb'$$), 'Hamburg',
  'a city with a vacancy that GeoNames also lists is suggested once, spelled as GeoNames has it'
);
select is(pg_temp.suggest($$'de', '  KOLN '$$), U&'K\00F6ln', 'the country in any case; the text trimmed, in any case and without accents');
select is(
  pg_temp.suggest($$'DE', 'teststadt'$$),
  'Teststadt 12,Teststadt 11,Teststadt 10,Teststadt 9,Teststadt 8,Teststadt 7,Teststadt 6,Teststadt 5,Teststadt 4,Teststadt 3',
  'at most ten names'
);
select is(pg_temp.suggest($$'DE', 'berk'$$), '', 'neither a hidden vacancy nor a vacancy of another country is suggested');
select is(split_part(pg_temp.suggest($$'NL', 'berk'$$), ',', 1), 'Berkel', 'the vacancy city of the other country leads its own list');
select is(pg_temp.suggest($$'DE', '%'$$), '', 'a percent sign matches only itself');
select is(pg_temp.suggest($$'DE', 'b_r'$$), '', 'an underscore matches only itself');

-- Refusals
select is(pg_temp.suggest($$'D1', 'ber'$$), 'P0001|CHARA_INVALID_INPUT|p_country', 'a country that is not two letters is refused');
select is(pg_temp.suggest($$null, 'ber'$$), 'P0001|CHARA_INVALID_INPUT|p_country', 'a missing country is refused');
select is(pg_temp.suggest(format('%L, %L', 'DE', repeat('a', 101))), 'P0001|CHARA_INVALID_INPUT|p_query', 'a text over 100 characters is refused');
select is(pg_temp.suggest(format('%L, %L', 'DE', repeat('a', 100))), '', 'a text of 100 characters is accepted');

select * from finish();
rollback;
