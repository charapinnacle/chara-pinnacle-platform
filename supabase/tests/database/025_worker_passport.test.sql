begin;
select plan(41);

\ir passport_fixture.inc

-- FR-B1: structure, grants and indexes
select has_table('public', 'worker_profiles', 'worker_profiles exists');
select has_table('public', 'worker_skills', 'worker_skills exists');
select has_table('public', 'worker_languages', 'worker_languages exists');
select has_table('public', 'worker_preferred_countries', 'worker_preferred_countries exists');
select has_table('public', 'worker_work_authorizations', 'worker_work_authorizations exists');
select enum_has_labels('public', 'worker_availability', array['now', 'from_date', 'unavailable'], 'worker_availability values');
select enum_has_labels('public', 'cefr_level', array['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], 'cefr_level values');
select columns_are(
  'public', 'worker_profiles',
  array['user_id', 'first_name', 'last_name', 'headline', 'current_country', 'occupation_id', 'years_experience',
        'availability', 'available_from', 'searchable', 'created_at'],
  'worker_profiles has the passport columns and nothing else'
);
select is_empty(
  $$
    select c.relname
    from pg_class c
    where c.oid in (
      'public.worker_profiles'::regclass, 'public.worker_skills'::regclass, 'public.worker_languages'::regclass,
      'public.worker_preferred_countries'::regclass, 'public.worker_work_authorizations'::regclass
    )
    and not (c.relrowsecurity and c.relforcerowsecurity)
  $$,
  'all five passport tables have RLS enabled and forced'
);
select is_empty(
  $$
    select c.relname
    from pg_class c
    where c.oid in (
      'public.worker_profiles'::regclass, 'public.worker_skills'::regclass, 'public.worker_languages'::regclass,
      'public.worker_preferred_countries'::regclass, 'public.worker_work_authorizations'::regclass
    )
    and not exists (
      select 1 from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indrelid = c.oid and a.attname in ('user_id', 'worker_user_id')
    )
  $$,
  'every policy column (user_id, worker_user_id) leads an index'
);
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""'])
   from pg_proc where oid = 'public.create_worker_passport(text, text, text, text)'::regprocedure)
  and has_function_privilege('authenticated', 'public.create_worker_passport(text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.create_worker_passport(text, text, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.create_worker_passport(text, text, text, text)', 'execute'),
  'create_worker_passport is security definer with an empty search_path and runs for authenticated only'
);
select ok(
  not has_function_privilege('authenticated', 'private.worker_list_limit()', 'execute')
  and not has_function_privilege('authenticated', 'private.worker_profiles_check_available_from()', 'execute')
  and not has_function_privilege('authenticated', 'private.worker_authorizations_check_expiry()', 'execute'),
  'the trigger functions are not callable through the API'
);
select results_eq(
  $$select key || '=' || (value #>> '{}') from private.settings
    where key in ('worker_skills_max', 'worker_languages_max', 'worker_preferred_countries_max',
                  'availability_window_months', 'work_authorization_expiry_max_years') order by key$$,
  $$values ('availability_window_months=24'), ('work_authorization_expiry_max_years=50'),
           ('worker_languages_max=15'), ('worker_preferred_countries_max=20'), ('worker_skills_max=30')$$,
  'the list limits and the date windows are settings with the proposed defaults'
);

-- AC2: a worker creates a private passport and the creation is audited
select is(
  pg_temp.call_as(:'wa', 'authenticated', $$select public.create_worker_passport('Amina', 'Okafor', 'NG', 'en')$$, 'aal1'),
  'ok', 'AC2: an active worker creates a passport'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s', count(*), min(searchable::text), min(first_name || ' ' || last_name),
     min(current_country), count(occupation_id), count(years_experience), count(availability), count(available_from))
   from public.worker_profiles where user_id = :'wa'),
  '1|false|Amina Okafor|NG|0|0|0|0',
  'AC2: one private row with the names and the country, and the other fields empty'
);
select is((select preferred_lang from public.profiles where id = :'wa'), 'en', 'AC2: the preferred language is English');
select is(
  (select format('%s|%s|%s|%s|%s', count(*), min(actor_id::text) = :'wa', min(entity_type), min(entity_id) = :'wa',
     min(metadata::text))
   from audit.log where action = 'passport.created' and entity_id = :'wa'),
  '1|t|worker_profiles|t|{}',
  'AC2: one audit row names the actor and the entity and carries no name'
);

-- AC3: wrong callers and duplicates
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.create_worker_passport('Other', 'Name', 'DE', 'en')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|worker_account_required', 'AC3: a company account is refused'
);
select is(
  pg_temp.call_as(:'wsus', 'authenticated', $$select public.create_worker_passport('Other', 'Name', 'DE', 'en')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|profile_not_active', 'AC3: a suspended worker is refused'
);
select is(
  pg_temp.call_as(:'nul', 'authenticated', $$select public.create_worker_passport('Other', 'Name', 'DE', 'en')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|worker_account_required', 'AC3: a user whose account kind is not committed is refused'
);
select is(
  split_part(pg_temp.call_as(null, 'anon', $$select public.create_worker_passport('Other', 'Name', 'DE', 'en')$$), '|', 1),
  '42501', 'AC3: anonymous is refused by the missing EXECUTE grant'
);
select is(
  split_part(pg_temp.call_as(:'wa', 'authenticated', $$select public.create_worker_passport('Other', 'Name', 'DE', 'en')$$, 'aal1'), '|', 1),
  '23505', 'AC3: a second passport for the same candidate is a unique violation'
);
select is(
  (select count(*) from public.worker_profiles where user_id in (:'own1', :'wsus', :'nul')), 0::bigint,
  'AC3: no row was inserted for a refused caller'
);
select is((select first_name from public.worker_profiles where user_id = :'wa'), 'Amina', 'AC3: the existing passport is unchanged');
select is(
  (select count(*) from audit.log where action = 'passport.created'), 1::bigint,
  'AC3: the refused calls wrote no audit row'
);

-- Input rules of the RPC
select is(
  pg_temp.call_as(:'wnew', 'authenticated', $$select public.create_worker_passport('Zoe', 'Park', 'KR', 'fr')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|preferred_lang', 'English is the only interface language in Phase 1'
);
select is(
  split_part(pg_temp.call_as(:'wnew', 'authenticated', $$select public.create_worker_passport('Zoe', 'Park', 'XX', 'en')$$, 'aal1'), '|', 1),
  '23503', 'an unknown country is refused by the foreign key'
);
select is(
  split_part(pg_temp.call_as(:'wnew', 'authenticated', $$select public.create_worker_passport('Zoe', 'Park', 'kr', 'en')$$, 'aal1'), '|', 1),
  '23503', 'a lower-case country code is refused'
);
select is(
  split_part(pg_temp.call_as(:'wnew', 'authenticated', $$select public.create_worker_passport('Zoe1', 'Park', 'KR', 'en')$$, 'aal1'), '|', 1),
  '23514', 'a name with a digit is refused'
);
select is(
  split_part(pg_temp.call_as(:'wnew', 'authenticated', $$select public.create_worker_passport('   ', 'Park', 'KR', 'en')$$, 'aal1'), '|', 1),
  '23514', 'a blank name is refused'
);
select is(
  split_part(pg_temp.call_as(:'wnew', 'authenticated', $$select public.create_worker_passport('Zoe', repeat('a', 81), 'KR', 'en')$$, 'aal1'), '|', 1),
  '23514', 'a name of 81 characters is refused'
);
select is((select count(*) from public.worker_profiles where user_id = :'wnew'), 0::bigint, 'refused input stored nothing');
select is(
  pg_temp.call_as(:'wnew', 'authenticated', $$select public.create_worker_passport('  Zoë  ', E'O''Neil-Park Jr.', 'KR', 'en')$$, 'aal1'),
  'ok', 'a name with an accent, an apostrophe, a hyphen and a full stop is accepted'
);
select is(
  (select first_name || '|' || last_name from public.worker_profiles where user_id = :'wnew'),
  E'Zoë|O''Neil-Park Jr.', 'the names are stored trimmed'
);

-- The name rule covers letters of every script and refuses digits, markup and line breaks
select is(
  (select string_agg(private.is_person_name(n)::text, ',' order by o)
   from unnest(array['Amina', 'Zoë', 'José María', '李明', 'Αλέξανδρος', 'أحمد', 'राम', 'Nguyễn']) with ordinality as t(n, o)),
  'true,true,true,true,true,true,true,true', 'names in Latin, Greek, Arabic, Devanagari and Han script are accepted'
);
select is(
  (select string_agg(private.is_person_name(n)::text, ',' order by o)
   from unnest(array['Amina1', '<b>x</b>', E'Amina\nOkafor', ' Amina', 'Amina ', '-Amina', '', repeat('a', 81)]) with ordinality as t(n, o)),
  'false,false,false,false,false,false,false,false', 'digits, markup, a line break, edge spaces, a leading hyphen and the wrong length are refused'
);

-- A deleted account takes its passport with it
select pg_temp.new_user('00000000-0000-0000-0000-00000000a105', 'worker');
update public.profiles set account_kind = intended_account_kind where id = '00000000-0000-0000-0000-00000000a105';
select is(
  pg_temp.call_as('00000000-0000-0000-0000-00000000a105', 'authenticated', $$select public.create_worker_passport('Del', 'Ete', 'DE', 'en')$$, 'aal1'),
  'ok', 'a further candidate creates a passport'
);
insert into public.worker_skills (worker_user_id, skill) values ('00000000-0000-0000-0000-00000000a105', 'Welding');
delete from auth.users where id = '00000000-0000-0000-0000-00000000a105';
select is(
  (select count(*) from public.worker_profiles where user_id = '00000000-0000-0000-0000-00000000a105')
  + (select count(*) from public.worker_skills where worker_user_id = '00000000-0000-0000-0000-00000000a105'),
  0::bigint, 'deleting the account removes the passport and its children'
);

-- Every wrong caller above leaves exactly the two passports that were created
select is((select count(*) from public.worker_profiles), 2::bigint, 'only the two successful calls left a passport');
select is((select count(*) from audit.log where action = 'passport.created'), 3::bigint, 'and one audit row each, plus the deleted account');
select is(
  (select count(*) from audit.log where action = 'passport.created' and metadata::text ~* '(amina|zoe|okafor|neil)'),
  0::bigint, 'no audit row holds a name'
);

select * from finish();
rollback;
