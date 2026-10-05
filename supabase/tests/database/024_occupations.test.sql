begin;
select plan(14);

select has_table('public', 'occupations', 'occupations table exists');
select columns_are('public', 'occupations', array['code', 'label', 'synonyms'], 'occupations has the ISCO code, the label and the synonyms');
select cmp_ok((select count(*) from public.occupations), '>=', 430::bigint, 'the ISCO-08 unit groups are seeded');
select is_empty($$select 1 from public.occupations where code !~ '^[0-9]{4}$'$$, 'every code has four digits');
select is(
  (select count(distinct left(code, 1)) from public.occupations), 10::bigint,
  'all ten ISCO-08 major groups are present'
);
select is(
  (select label from public.occupations where code = '7411'), 'Building and related electricians',
  'the electricians unit group is seeded under 7411'
);
select ok(
  (select 'electrician' = any (synonyms) from public.occupations where code = '7411'),
  'a synonym finds the unit group by an everyday name'
);
select is(
  (select label from public.occupations where code = '7212'), 'Welders and flame cutters',
  'the welders unit group is seeded under 7212'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'occupations' and indexdef like '%gin_trgm_ops%'),
  'the label has a trigram index'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.occupations'::regclass)
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'occupations') = 1
  and not has_table_privilege('service_role', 'public.occupations', 'select'),
  'occupations has RLS enabled and forced, one policy, and no access for service_role'
);
select is_empty(
  $$
    select r.rolname, p.priv
    from unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
    cross join unnest(array['insert', 'update', 'delete', 'truncate']) as p(priv)
    where has_table_privilege(r.rolname, 'public.occupations', p.priv)
  $$,
  'no API role has a write grant on occupations'
);

set local role anon;
select cmp_ok((select count(*) from public.occupations), '>=', 430::bigint, 'anon can select occupations');
select throws_ok($$update public.occupations set label = 'Probe'$$, '42501', null, 'anon cannot update occupations');
reset role;
set local role authenticated;
select throws_ok($$delete from public.occupations$$, '42501', null, 'authenticated cannot delete from occupations');
reset role;

select * from finish();
rollback;
