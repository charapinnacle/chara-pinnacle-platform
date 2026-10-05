begin;
select plan(32);

\ir passport_fixture.inc

select is(
  pg_temp.call_as(:'wa', 'authenticated', $$select public.create_worker_passport('Amina', 'Okafor', 'NG', 'en')$$, 'aal1'),
  'ok', 'setup: candidate A has a passport'
);
select is(
  pg_temp.call_as(:'wb', 'authenticated', $$select public.create_worker_passport('Bruno', 'Silva', 'PT', 'en')$$, 'aal1'),
  'ok', 'setup: candidate B has a passport'
);

insert into public.worker_skills (worker_user_id, skill) values (:'wa', 'Welding'), (:'wb', 'Plumbing');
insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (:'wa', 'en', 'B2'), (:'wb', 'pt', 'C2');
insert into public.worker_preferred_countries (worker_user_id, country_code) values (:'wa', 'DE'), (:'wb', 'ES');
insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values (:'wa', 'DE', null), (:'wb', 'ES', null);
select set_config('t.a', :'wa', true);

-- An employer organization O with an owner, an admin and a member, another organization, and the three staff roles.
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.o', (public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'DE', 'F'))->>'organization_id', true)$$, 'aal1'), 'ok', 'setup: organization O');
select is(pg_temp.call_as(:'own2', 'authenticated',
  $$select public.create_organization('employer', 'Beta Works Ltd', 'Beta Works', 'GB', 'F')$$, 'aal1'), 'ok', 'setup: another organization');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.o')::uuid, :'adm', 'admin', now()), (current_setting('t.o')::uuid, :'mem', 'member', now());
insert into public.platform_staff (user_id, role) values (:'slg', 'admin'), (:'adm2', 'verification_reviewer'), (:'late', 'trust_safety');

-- One answer per table: the rows a select returns, the rows an update and a delete reach, and the state of an insert
-- for candidate A's id. A refusal shows as E and its SQLSTATE. A profile row is deleted only with the account, so
-- worker_profiles has no delete grant and a delete is refused for everyone instead of reaching no row.
create function pg_temp.count_as(p_user uuid, p_role text, p_sql text, p_aal text) returns text
language plpgsql as $$
begin
  return pg_temp.affected_as(p_user, p_role, p_sql, p_aal)::text;
exception when others then
  reset role;
  return 'E' || sqlstate;
end;
$$;

create function pg_temp.probe(p_user uuid, p_role text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_a text := current_setting('t.a');
  v_out text := '';
  v_table text;
  v_key text;
  v_set text;
  v_insert text;
begin
  for v_table, v_key, v_set, v_insert in
    select * from (values
      ('worker_profiles', 'user_id', 'headline = ''x''',
        format('insert into public.worker_profiles (user_id, first_name, last_name, current_country) values (%L, ''X'', ''Y'', ''DE'')', v_a)),
      ('worker_skills', 'worker_user_id', 'skill = ''x''',
        format('insert into public.worker_skills (worker_user_id, skill) values (%L, ''Probe'')', v_a)),
      ('worker_languages', 'worker_user_id', 'cefr_level = ''C2''',
        format('insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (%L, ''fr'', ''A1'')', v_a)),
      ('worker_preferred_countries', 'worker_user_id', 'country_code = ''FR''',
        format('insert into public.worker_preferred_countries (worker_user_id, country_code) values (%L, ''FR'')', v_a)),
      ('worker_work_authorizations', 'worker_user_id', 'expires_on = null',
        format('insert into public.worker_work_authorizations (worker_user_id, country_code) values (%L, ''FR'')', v_a))
    ) t(a, b, c, d)
  loop
    v_out := v_out || format('%s: select=%s update=%s delete=%s insert=%s; ', v_table,
      pg_temp.count_as(p_user, p_role, format('select 1 from public.%I where %I = %L', v_table, v_key, v_a), p_aal),
      pg_temp.count_as(p_user, p_role, format('update public.%I set %s where %I = %L', v_table, v_set, v_key, v_a), p_aal),
      pg_temp.count_as(p_user, p_role, format('delete from public.%I where %I = %L', v_table, v_key, v_a), p_aal),
      split_part(pg_temp.call_as(p_user, p_role, v_insert, p_aal), '|', 1));
  end loop;
  return v_out;
end;
$$;

create function pg_temp.denied(p_select text, p_update text, p_delete text, p_insert text) returns text
language sql as $$
  select string_agg(
    format('%s: select=%s update=%s delete=%s insert=%s; ', t, p_select, p_update,
      case when t = 'worker_profiles' and p_delete = '0' then 'E42501' else p_delete end, p_insert),
    '' order by o)
  from unnest(array['worker_profiles', 'worker_skills', 'worker_languages', 'worker_preferred_countries', 'worker_work_authorizations'])
    with ordinality as x(t, o)
$$;

-- AC10: nobody but A sees or changes A's rows
select is(pg_temp.probe(:'own1', 'authenticated'), pg_temp.denied('0', '0', '0', '42501'), 'AC10: an employer owner sees and changes nothing');
select is(pg_temp.probe(:'adm', 'authenticated'), pg_temp.denied('0', '0', '0', '42501'), 'AC10: an employer admin sees and changes nothing');
select is(pg_temp.probe(:'mem', 'authenticated', 'aal1'), pg_temp.denied('0', '0', '0', '42501'), 'AC10: an employer member sees and changes nothing');
select is(pg_temp.probe(:'own2', 'authenticated'), pg_temp.denied('0', '0', '0', '42501'), 'AC10: a company user of another organization sees and changes nothing');
select is(pg_temp.probe(:'slg', 'authenticated'), pg_temp.denied('0', '0', '0', '42501'), 'AC10: a platform administrator at aal2 sees and changes nothing');
select is(pg_temp.probe(:'adm2', 'authenticated'), pg_temp.denied('0', '0', '0', '42501'), 'AC10: a verification reviewer at aal2 sees and changes nothing');
select is(pg_temp.probe(:'late', 'authenticated'), pg_temp.denied('0', '0', '0', '42501'), 'AC10: a trust and safety administrator at aal2 sees and changes nothing');
select is(pg_temp.probe(:'wb', 'authenticated', 'aal1'), pg_temp.denied('0', '0', '0', '42501'), 'AC10: another candidate sees and changes nothing');
select is(pg_temp.probe(null, 'anon'), pg_temp.denied('E42501', 'E42501', 'E42501', '42501'), 'AC10: anonymous is refused by missing grants');
select is(
  (select count(*) from public.worker_profiles) + (select count(*) from public.worker_skills)
    + (select count(*) from public.worker_languages) + (select count(*) from public.worker_preferred_countries)
    + (select count(*) from public.worker_work_authorizations),
  10::bigint, 'AC10: the refused statements changed nothing'
);
select is(
  (select headline is null and (select count(*) from public.worker_skills where skill = 'x') = 0 from public.worker_profiles where user_id = :'wa'),
  true, 'AC10: candidate A is unchanged'
);

select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$select 1 from public.worker_profiles where user_id = %L$$, :'wa')), 1::bigint,
  'AC10: candidate A reads the own profile'
);
select is(
  (select pg_temp.affected_as(:'wa', 'authenticated', 'select 1 from public.worker_profiles')), 1::bigint,
  'AC10: and only the own profile'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$select 1 from public.worker_skills where worker_user_id = %L$$, :'wa'))
  + pg_temp.affected_as(:'wa', 'authenticated', format($$select 1 from public.worker_languages where worker_user_id = %L$$, :'wa'))
  + pg_temp.affected_as(:'wa', 'authenticated', format($$select 1 from public.worker_preferred_countries where worker_user_id = %L$$, :'wa'))
  + pg_temp.affected_as(:'wa', 'authenticated', format($$select 1 from public.worker_work_authorizations where worker_user_id = %L$$, :'wa')),
  4::bigint, 'AC10: candidate A reads the own child rows'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$update public.worker_profiles set headline = 'Welder' where user_id = %L$$, :'wa'))
  + pg_temp.affected_as(:'wa', 'authenticated', format($$update public.worker_skills set skill = 'Arc welding' where worker_user_id = %L$$, :'wa'))
  + pg_temp.affected_as(:'wa', 'authenticated', format($$update public.worker_languages set cefr_level = 'C1' where worker_user_id = %L$$, :'wa'))
  + pg_temp.affected_as(:'wa', 'authenticated', format($$update public.worker_preferred_countries set country_code = 'AT' where worker_user_id = %L$$, :'wa'))
  + pg_temp.affected_as(:'wa', 'authenticated', format($$update public.worker_work_authorizations set expires_on = (now() at time zone 'utc')::date + 30 where worker_user_id = %L$$, :'wa')),
  5::bigint, 'AC10: candidate A changes the own rows'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_profiles (user_id, first_name, last_name, current_country) values (%L, 'Amina', 'Okafor', 'NG')$$, :'wa')),
  '42501', 'AC10: A cannot insert a profile row directly'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_profiles set user_id = %L where user_id = %L$$, :'wnew', :'wa')),
  '42501', 'AC10: A cannot change the owner of the profile'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_profiles set searchable = true where user_id = %L$$, :'wa')),
  '42501', 'AC10: A cannot change searchable'
);
select is(
  pg_temp.state_as(:'wa', format($$delete from public.worker_profiles where user_id = %L$$, :'wa')),
  '42501', 'AC10: A cannot delete the profile row, and nobody holds a delete grant on it'
);
select is(
  (select count(*) from public.worker_profiles where user_id = :'wa'), 1::bigint, 'AC10: the profile row is still there'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, 'Plumbing')$$, :'wb')),
  '42501', 'AC10: A cannot add a skill to candidate B'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_skills set worker_user_id = %L where worker_user_id = %L$$, :'wb', :'wa')),
  '42501', 'AC10: A cannot move a child row to candidate B'
);
select is(
  pg_temp.state_as(:'wnew', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, 'Welding')$$, :'wnew')),
  '23503', 'a candidate without a passport cannot add child rows'
);
select is(
  (select count(*) from pg_class c
   where c.oid in ('public.worker_profiles'::regclass, 'public.worker_skills'::regclass, 'public.worker_languages'::regclass,
                   'public.worker_preferred_countries'::regclass, 'public.worker_work_authorizations'::regclass)
     and (has_table_privilege('service_role', c.oid, 'select, insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege('service_role', c.oid, 'select, insert, update, references')
       or has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate')
       or has_any_column_privilege('anon', c.oid, 'select, insert, update'))),
  0::bigint, 'AC10: service_role and anon have no grant on the passport tables'
);

-- AC11: nothing personal beyond the passport fields
select is_empty(
  $$
    select format('%s.%s', table_name, column_name)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('worker_profiles', 'worker_skills', 'worker_languages', 'worker_preferred_countries', 'worker_work_authorizations')
      and regexp_replace(lower(column_name), '[^a-z0-9]+', '_', 'g') ~ any (array[
        '(^|_)id_?number(_|$)', 'national_?id', 'passport_?number', 'date_?of_?birth', 'birth_?date', 'birthday',
        '(^|_)dob(_|$)', '(^|_)age(_|$)', 'nationality', 'gender', '(^|_)sex(_|$)', 'religion', 'marital',
        'insurance_?number', '(^|_)ssn(_|$)'
      ])
  $$,
  'AC11: no passport column holds a date of birth, age, nationality, gender, religion, marital status or identity number'
);
select columns_are(
  'public', 'worker_work_authorizations', array['worker_user_id', 'country_code', 'expires_on'],
  'AC11: work authorisation is a country and an optional expiry date'
);
select columns_are('public', 'worker_skills', array['id', 'worker_user_id', 'skill'], 'AC11: a skill is a tag');
select columns_are('public', 'worker_languages', array['worker_user_id', 'language_code', 'cefr_level'], 'AC11: a language is a code and a level');

select * from finish();
rollback;
