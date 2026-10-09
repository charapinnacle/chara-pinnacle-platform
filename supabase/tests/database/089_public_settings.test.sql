begin;
select plan(15);

-- FR-H1 AC7, AC9: the legal-entity details come from private.settings through one accessor that returns the seven public
-- keys and nothing else.
create temp table t_public_keys (key text primary key);
insert into t_public_keys values
  ('data_protection_contact'), ('legal_entity_address'), ('legal_entity_email'), ('legal_entity_name'),
  ('legal_entity_registration_number'), ('legal_entity_vat_id'), ('privacy_contact');
grant select on t_public_keys to anon, authenticated;

select is(
  (select count(*) from private.settings where key in (select key from t_public_keys)), 7::bigint,
  'the migration seeds the seven keys'
);
select is(
  (select count(*) from private.settings where key in (select key from t_public_keys) and value = '""'), 7::bigint,
  'they are seeded empty: the legal entity is confirmed by CHARA later'
);

insert into private.settings (key, value) values ('entitlements_enforced', 'true'), ('share_expiry_days_after_final', '30')
on conflict (key) do update set value = excluded.value;
update private.settings set value = to_jsonb('Example GmbH'::text) where key = 'legal_entity_name';
update private.settings set value = to_jsonb('privacy@example.com'::text) where key = 'privacy_contact';

select ok(
  not has_table_privilege('anon', 'private.settings', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('authenticated', 'private.settings', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('service_role', 'private.settings', 'select, insert, update, delete, truncate, references, trigger'),
  'anon, authenticated and service_role hold no table privilege on private.settings'
);
select ok(
  not has_any_column_privilege('anon', 'private.settings', 'select, insert, update, references')
  and not has_any_column_privilege('authenticated', 'private.settings', 'select, insert, update, references')
  and not has_any_column_privilege('service_role', 'private.settings', 'select, insert, update, references'),
  'and no column privilege either'
);

set local role anon;
select throws_ok(
  'select * from private.settings', '42501', 'permission denied for table settings',
  'an anonymous visitor cannot select private.settings'
);
reset role;
set local role authenticated;
select throws_ok(
  'select * from private.settings', '42501', 'permission denied for table settings',
  'a signed-in user cannot select private.settings'
);
reset role;
set local role service_role;
select throws_ok(
  'select * from private.settings', '42501', 'permission denied for schema private',
  'the service role cannot select private.settings: it has no usage on the schema either'
);
reset role;

set local role anon;
select is(
  (select array_agg(key order by key) from public.get_public_settings()),
  (select array_agg(key order by key) from t_public_keys),
  'an anonymous visitor gets exactly the seven public keys'
);
select is(
  (select count(*) from public.get_public_settings() where key in ('entitlements_enforced', 'share_expiry_days_after_final')),
  0::bigint, 'and neither entitlements_enforced nor share_expiry_days_after_final'
);
select is(
  (select value from public.get_public_settings() where key = 'legal_entity_name'), 'Example GmbH',
  'the value comes back as plain text, not as JSON'
);
reset role;

set local role authenticated;
select is(
  (select array_agg(key order by key) from public.get_public_settings()),
  (select array_agg(key order by key) from t_public_keys),
  'a signed-in user gets the same seven keys'
);
reset role;

-- The page reads the value at every request, so a change is shown at once.
update private.settings set value = to_jsonb('Example Ltd'::text) where key = 'legal_entity_name';
set local role anon;
select is(
  (select value from public.get_public_settings() where key = 'legal_entity_name'), 'Example Ltd',
  'a changed value is returned by the next call'
);
reset role;

select is(
  (select count(*) from public.get_public_settings() where key = 'legal_entity_vat_id' and value = ''), 1::bigint,
  'an empty value is returned as an empty text, for the page to leave out'
);

select ok(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""'] from pg_proc p
   where p.oid = 'public.get_public_settings()'::regprocedure),
  'the accessor is a stable definer function with an empty search_path'
);
select ok(
  has_function_privilege('anon', 'public.get_public_settings()', 'execute')
  and has_function_privilege('authenticated', 'public.get_public_settings()', 'execute')
  and not has_function_privilege('service_role', 'public.get_public_settings()', 'execute')
  and not has_function_privilege('public', 'public.get_public_settings()', 'execute'),
  'visitors and users may call it; the service role and PUBLIC may not'
);

select * from finish();
rollback;
