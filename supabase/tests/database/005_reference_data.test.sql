begin;
select plan(33);

select has_table('public', 'countries', 'countries table exists');
select has_table('public', 'languages', 'languages table exists');
select has_table('public', 'currencies', 'currencies table exists');
select has_table('public', 'industries', 'industries table exists');

select cmp_ok((select count(*) from public.countries), '>=', 249::bigint, 'at least 249 countries are seeded');
select ok(exists (select 1 from public.countries where code = 'DE' and name = 'Germany'), 'Germany is seeded under DE');
select is_empty($$select 1 from public.countries where code in ('EU', 'UN', 'ZZ', 'AN', 'UK')$$, 'non-country and deprecated region codes are not seeded');
select is((select count(*) from public.countries), 250::bigint, 'the 249 ISO 3166-1 countries plus XK are seeded');
select ok(exists (select 1 from public.countries where code = 'XK'), 'Kosovo (XK) is seeded');
select cmp_ok((select count(*) from public.languages), '>=', 180::bigint, 'ISO 639-1 languages are seeded');
select ok(exists (select 1 from public.languages where code = 'en' and name = 'English'), 'English is seeded under en');
select is_empty($$select 1 from public.languages where code in ('in', 'iw', 'ji', 'jw', 'mo', 'sh')$$, 'alias language codes are not seeded');
select cmp_ok((select count(*) from public.currencies), '>=', 150::bigint, 'ISO 4217 currencies are seeded');
select ok(exists (select 1 from public.currencies where code = 'EUR' and name = 'Euro'), 'the euro is seeded under EUR');
select is_empty($$select 1 from public.currencies where code in ('ANG', 'CUC', 'HRK', 'SLL', 'ZWL')$$, 'withdrawn currency codes are not seeded');
select is((select count(*) from public.industries), 21::bigint, 'the 21 ISIC Rev.4 sections are seeded');
select results_eq(
  $$select string_agg(code, '' order by code) from public.industries$$,
  $$values ('ABCDEFGHIJKLMNOPQRSTU')$$,
  'ISIC sections are the letters A to U'
);

select is_empty(
  $$
    select r.rolname, t.tbl, p.priv
    from unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
    cross join unnest(array['countries', 'languages', 'currencies', 'industries']) as t(tbl)
    cross join unnest(array['insert', 'update', 'delete', 'truncate']) as p(priv)
    where has_table_privilege(r.rolname, format('public.%I', t.tbl)::regclass, p.priv)
  $$,
  'no API role has a write grant on any reference table'
);
select is_empty(
  $$
    select t.tbl
    from unnest(array['countries', 'languages', 'currencies', 'industries']) as t(tbl)
    where has_table_privilege('service_role', format('public.%I', t.tbl)::regclass, 'select')
       or (select count(*) from pg_policies where schemaname = 'public' and tablename = t.tbl and cmd = 'SELECT') <> 1
       or (select count(*) from pg_policies where schemaname = 'public' and tablename = t.tbl) <> 1
  $$,
  'each reference table has exactly one select policy and service_role cannot read it'
);

set local role anon;
select cmp_ok((select count(*) from public.countries), '>=', 249::bigint, 'anon can select countries');
select cmp_ok((select count(*) from public.languages), '>', 0::bigint, 'anon can select languages');
select cmp_ok((select count(*) from public.currencies), '>', 0::bigint, 'anon can select currencies');
select is((select count(*) from public.industries), 21::bigint, 'anon can select industries');
select throws_ok($$insert into public.countries (code, name) values ('QQ', 'Probe')$$, '42501', null, 'anon cannot insert into countries');
select throws_ok($$update public.countries set name = 'Probe'$$, '42501', null, 'anon cannot update countries');
select throws_ok($$delete from public.countries$$, '42501', null, 'anon cannot delete from countries');
select throws_ok($$insert into public.languages (code, name) values ('qq', 'Probe')$$, '42501', null, 'anon cannot insert into languages');
select throws_ok($$update public.currencies set name = 'Probe'$$, '42501', null, 'anon cannot update currencies');
select throws_ok($$delete from public.industries$$, '42501', null, 'anon cannot delete from industries');
reset role;

set local role authenticated;
select cmp_ok((select count(*) from public.countries), '>=', 249::bigint, 'authenticated can select countries');
select throws_ok($$insert into public.currencies (code, name) values ('QQQ', 'Probe')$$, '42501', null, 'authenticated cannot insert into currencies');
select throws_ok($$update public.languages set name = 'Probe'$$, '42501', null, 'authenticated cannot update languages');
select throws_ok($$delete from public.industries$$, '42501', null, 'authenticated cannot delete from industries');
reset role;

select * from finish();
rollback;
