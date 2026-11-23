-- The agency-work rules of destination countries (public.agency_work_rules): public law that anyone reads, nobody writes
-- through the API, each row with an official https source and the date it was checked.
begin;
select plan(8);

select has_table('public', 'agency_work_rules', 'the agency work rules table exists');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.agency_work_rules'::regclass),
  'row level security is on and forced'
);
select ok(
  has_table_privilege('anon', 'public.agency_work_rules', 'select')
  and has_table_privilege('authenticated', 'public.agency_work_rules', 'select'),
  'visitors and signed-in users read the rules, as the staffing directory shows them to visitors'
);
select is_empty(
  $$
    select r.rolname, p.priv
    from unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
    cross join unnest(array['insert', 'update', 'delete', 'truncate']) as p(priv)
    where has_table_privilege(r.rolname, 'public.agency_work_rules', p.priv)
  $$,
  'no API role writes a rule: a change of law is a migration'
);
select is(
  (select string_agg(destination_country || ':' || non_eu_workers_only, ',' order by destination_country, id)
   from public.agency_work_rules),
  'DE:true,DE:false,DE:false,NL:false,PL:false',
  'the seeded rules: Germany (non-EU leasing, construction, permit), the Netherlands and Poland'
);
select is_empty(
  $$select id from public.agency_work_rules where source_url !~ '^https://' or reviewed_on > current_date$$,
  'every rule has an https source and a check date that is not in the future'
);
select throws_ok(
  $$insert into public.agency_work_rules (destination_country, title, notice, source_url, reviewed_on)
    values ('DE', 'A rule', 'A notice of enough characters.', 'http://example.com', current_date)$$,
  '23514', null,
  'a source that is not https is refused'
);
select throws_ok(
  $$insert into public.agency_work_rules (destination_country, title, notice, source_url, reviewed_on)
    values ('Germany', 'A rule', 'A notice of enough characters.', 'https://example.com', current_date)$$,
  '23514', null,
  'the destination is a two-letter country code'
);

select * from finish();
rollback;
