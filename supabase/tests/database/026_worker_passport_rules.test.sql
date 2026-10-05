begin;
select plan(69);

\ir passport_fixture.inc

select is(
  pg_temp.call_as(:'wa', 'authenticated', $$select public.create_worker_passport('Amina', 'Okafor', 'NG', 'en')$$, 'aal1'),
  'ok', 'setup: candidate A has a passport'
);
select is(
  pg_temp.call_as(:'wb', 'authenticated', $$select public.create_worker_passport('Bruno', 'Silva', 'PT', 'en')$$, 'aal1'),
  'ok', 'setup: candidate B has a passport'
);

-- AC7: skills
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, 'Welding')$$, :'wa')),
  'ok', 'AC7: a skill is stored'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, 'WELDING')$$, :'wa')),
  '23505', 'AC7: the same skill in other letter case is refused for the same candidate'
);
select is(
  pg_temp.state_as(:'wb', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, 'Welding')$$, :'wb')),
  'ok', 'AC7: another candidate may hold the same skill'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, repeat('a', 50))$$, :'wa')),
  'ok', 'AC7: a skill of 50 characters is stored'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, repeat('b', 51))$$, :'wa')),
  '23514', 'AC7: a skill of 51 characters is refused'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, '')$$, :'wa')),
  '23514', 'AC7: an empty skill is refused'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, ' Pipefitting ')$$, :'wa')),
  '23514', 'AC7: a skill with leading and trailing spaces is refused'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, 'Pipe' || chr(7) || 'fitting')$$, :'wa')),
  '23514', 'AC7: a skill with a control character is refused'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) select %L, 'Skill ' || g from generate_series(1, 28) g$$, :'wa')),
  'ok', 'AC7: skills up to 30 are stored (the 30th)'
);
select is((select count(*) from public.worker_skills where worker_user_id = :'wa'), 30::bigint, 'AC7: the candidate holds 30 skills');
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, 'One too many')$$, :'wa'), 'aal1'),
  'P0001|CHARA_LIMIT_REACHED|worker_skills', 'AC7: the 31st skill is refused'
);
update private.settings set value = '31' where key = 'worker_skills_max';
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, 'One too many')$$, :'wa')),
  'ok', 'AC7: the limit is read from the setting'
);
update private.settings set value = '30' where key = 'worker_skills_max';
delete from public.worker_skills where skill = 'One too many';

-- AC7: languages
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (%L, 'en', 'B2')$$, :'wa')),
  'ok', 'AC7: English at B2 is stored'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (%L, 'en', 'C1')$$, :'wa')),
  '23505', 'AC7: a second row for the same language is refused'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (%L, 'fr', 'B3')$$, :'wa')),
  '22P02', 'AC7: the level B3 does not exist'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (%L, 'fr', 'native')$$, :'wa')),
  '22P02', 'AC7: the level native does not exist'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (%L, 'xx', 'A1')$$, :'wa')),
  '23503', 'AC7: an unknown language is refused by the foreign key'
);
select is(
  pg_temp.state_as(:'wa', format(
    $$insert into public.worker_languages (worker_user_id, language_code, cefr_level)
      select %L, code, 'A1' from (select code from public.languages where code <> 'en' order by code limit 14) l$$, :'wa')),
  'ok', 'AC7: languages up to 15 are stored (the 15th)'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', format(
    $$insert into public.worker_languages (worker_user_id, language_code, cefr_level)
      select %L, code, 'A1' from public.languages where code not in (select language_code from public.worker_languages where worker_user_id = %L) order by code limit 1$$,
    :'wa', :'wa'), 'aal1'),
  'P0001|CHARA_LIMIT_REACHED|worker_languages', 'AC7: the 16th language is refused'
);
select results_eq(
  $$select unnest(enum_range(null::public.cefr_level))::text$$,
  $$values ('A1'), ('A2'), ('B1'), ('B2'), ('C1'), ('C2')$$,
  'AC7: only A1 to C2 exist as levels'
);

-- AC8: column rules
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set first_name = '' where user_id = %L$$, :'wa')), '23514', 'AC8: an empty first name is refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set first_name = repeat('a', 81) where user_id = %L$$, :'wa')), '23514', 'AC8: a first name of 81 characters is refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set last_name = 'Okafor2' where user_id = %L$$, :'wa')), '23514', 'AC8: a last name with a digit is refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set headline = repeat('h', 121) where user_id = %L$$, :'wa')), '23514', 'AC8: a headline of 121 characters is refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set headline = E'Welder\nPipe fitter' where user_id = %L$$, :'wa')), '23514', 'AC8: a headline with a line break is refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set headline = repeat('h', 120) where user_id = %L$$, :'wa')), 'ok', 'AC8: a headline of 120 characters is stored');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set current_country = 'XX' where user_id = %L$$, :'wa')), '23503', 'AC8: an unknown country is refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set occupation_id = '0000' where user_id = %L$$, :'wa')), '23503', 'AC8: an unknown occupation is refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set occupation_id = '7411' where user_id = %L$$, :'wa')), 'ok', 'AC8: an ISCO-08 occupation is stored');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set years_experience = 0 where user_id = %L$$, :'wa')), 'ok', 'AC8: 0 years are stored');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set years_experience = 60 where user_id = %L$$, :'wa')), 'ok', 'AC8: 60 years are stored');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set years_experience = -1 where user_id = %L$$, :'wa')), '23514', 'AC8: -1 years are refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set years_experience = 61 where user_id = %L$$, :'wa')), '23514', 'AC8: 61 years are refused');

select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set availability = 'from_date', available_from = null where user_id = %L$$, :'wa')), '23514', 'AC8: from_date without a date is refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set availability = 'now', available_from = current_date where user_id = %L$$, :'wa')), '23514', 'AC8: now with a date is refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set availability = 'unavailable', available_from = current_date where user_id = %L$$, :'wa')), '23514', 'AC8: unavailable with a date is refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set available_from = current_date where user_id = %L$$, :'wa')), '23514', 'AC8: a date without availability is refused');
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$update public.worker_profiles set availability = 'from_date', available_from = (now() at time zone 'utc')::date - 1 where user_id = %L$$, :'wa'), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|available_from', 'AC8: yesterday is refused'
);
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set availability = 'from_date', available_from = (now() at time zone 'utc')::date where user_id = %L$$, :'wa')), 'ok', 'AC8: today is accepted');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set availability = 'from_date', available_from = ((now() at time zone 'utc')::date + interval '24 months')::date where user_id = %L$$, :'wa')), 'ok', 'AC8: today plus 24 months is accepted');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set availability = 'from_date', available_from = ((now() at time zone 'utc')::date + interval '24 months')::date + 1 where user_id = %L$$, :'wa')), 'P0001', 'AC8: today plus 24 months and one day is refused');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set availability = 'now', available_from = null where user_id = %L$$, :'wa')), 'ok', 'AC8: now with the date cleared is accepted');
select is(pg_temp.state_as(:'wa', format($$update public.worker_profiles set availability = 'unavailable' where user_id = %L$$, :'wa')), 'ok', 'AC8: unavailable is accepted');

alter table public.worker_profiles disable trigger worker_profiles_check_available_from;
update public.worker_profiles set availability = 'from_date', available_from = (now() at time zone 'utc')::date - 10 where user_id = :'wa';
alter table public.worker_profiles enable always trigger worker_profiles_check_available_from;
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_profiles set headline = 'Welder' where user_id = %L$$, :'wa')),
  'ok', 'AC8: a date that has since passed does not block an unrelated edit'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_profiles set availability = availability, available_from = available_from where user_id = %L$$, :'wa')),
  'ok', 'AC8: saving the same availability again does not trip over a passed date'
);
select is(
  pg_temp.state_as(:'wa', format($$update public.worker_profiles set available_from = (now() at time zone 'utc')::date - 9 where user_id = %L$$, :'wa')),
  'P0001', 'AC8: moving the date to another past day is checked'
);

select is(
  pg_temp.state_as(:'wa', format($$update public.worker_profiles set searchable = true where user_id = %L$$, :'wa')),
  '42501', 'a candidate cannot make the profile searchable'
);
select throws_ok(
  format($$update public.worker_profiles set searchable = true where user_id = %L$$, :'wa'),
  '23514', null, 'searchable cannot be true for anyone in Phase 1'
);

-- AC9: preferred countries
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_preferred_countries (worker_user_id, country_code) values (%L, 'NG')$$, :'wa')), 'ok', 'AC9: a preferred country is stored');
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_preferred_countries (worker_user_id, country_code) values (%L, 'NG')$$, :'wa')), '23505', 'AC9: the same preferred country twice is refused');
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_preferred_countries (worker_user_id, country_code) values (%L, 'XX')$$, :'wa')), '23503', 'AC9: an unknown preferred country is refused');
select is(
  pg_temp.state_as(:'wa', format(
    $$insert into public.worker_preferred_countries (worker_user_id, country_code)
      select %L, code from (select code from public.countries where code <> 'NG' order by code limit 19) c$$, :'wa')),
  'ok', 'AC9: preferred countries up to 20 are stored (the 20th)'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', format(
    $$insert into public.worker_preferred_countries (worker_user_id, country_code)
      select %L, code from public.countries where code not in (select country_code from public.worker_preferred_countries where worker_user_id = %L) order by code limit 1$$,
    :'wa', :'wa'), 'aal1'),
  'P0001|CHARA_LIMIT_REACHED|worker_preferred_countries', 'AC9: the 21st preferred country is refused'
);

-- AC9: work authorisations
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values (%L, 'DE', (now() at time zone 'utc')::date + 365)$$, :'wa')), 'ok', 'AC9: an authorisation with an expiry date is stored');
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_work_authorizations (worker_user_id, country_code) values (%L, 'DE')$$, :'wa')), '23505', 'AC9: a second authorisation for the same country is refused');
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values (%L, 'FR', (now() at time zone 'utc')::date - 1)$$, :'wa'), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|expires_on', 'AC9: an expiry date of yesterday is refused'
);
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values (%L, 'FR', (now() at time zone 'utc')::date)$$, :'wa')), 'ok', 'AC9: an expiry date of today is accepted');
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values (%L, 'ES', null)$$, :'wa')), 'ok', 'AC9: no expiry date is accepted');
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values (%L, 'PL', ((now() at time zone 'utc')::date + interval '51 years')::date)$$, :'wa')), 'P0001', 'AC9: 51 years ahead is refused');
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values (%L, 'PL', ((now() at time zone 'utc')::date + interval '50 years')::date)$$, :'wa')), 'ok', 'AC9: 50 years ahead is accepted');
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_work_authorizations (worker_user_id, country_code) values (%L, 'de')$$, :'wa')), '23503', 'AC9: a lower-case code is refused by the foreign key');
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_work_authorizations (worker_user_id, country_code) values (%L, 'XX')$$, :'wa')), '23503', 'AC9: an unknown country is refused');

-- The candidate removes what was added
select is(pg_temp.affected_as(:'wa', 'authenticated', format($$delete from public.worker_work_authorizations where worker_user_id = %L and country_code = 'ES'$$, :'wa')), 1::bigint, 'a candidate removes an authorisation');
select is(pg_temp.affected_as(:'wa', 'authenticated', format($$delete from public.worker_skills where worker_user_id = %L and lower(skill) = 'welding'$$, :'wa')), 1::bigint, 'a candidate removes a skill');
select is(pg_temp.affected_as(:'wa', 'authenticated', format($$delete from public.worker_languages where worker_user_id = %L and language_code = 'en'$$, :'wa')), 1::bigint, 'a candidate removes a language');
select is(pg_temp.affected_as(:'wa', 'authenticated', format($$delete from public.worker_preferred_countries where worker_user_id = %L and country_code = 'NG'$$, :'wa')), 1::bigint, 'a candidate removes a preferred country');
select is(
  pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, 'Welding')$$, :'wa')),
  'ok', 'a removed skill can be added again, and the count had room again'
);

select * from finish();
rollback;
