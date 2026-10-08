begin;
select plan(54);

\ir status_fixture.inc

-- The rows of a query as one jsonb array, for the caller p_user at aal2; a refusal is the text 'sqlstate|message|detail'.
create function pg_temp.rows_as(p_user uuid, p_sql text) returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(s)), ''[]'') from (%s) s', p_sql) into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := to_jsonb(format('%s|%s|%s', v_state, v_message, coalesce(v_detail, '')));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

create function pg_temp.names_of(p_fn regprocedure) returns text
language sql as $$
  select string_agg(n, ',' order by o) from (
    select n, o from pg_proc p, unnest(p.proargnames) with ordinality as a (n, o)
    where p.oid = p_fn and (p.proargmodes)[o] = 't'
  ) x
$$;

-- AC3: candidate K (wa) with a passport, 2 documents and 3 applications; organisation O (Acme) with an owner, an admin, a
-- member, 4 vacancies of the owner and 5 applications (3 of them K's)
select pg_temp.doc('00000000-0000-0000-0000-0000000d0001', :'wa');
select pg_temp.doc('00000000-0000-0000-0000-0000000d0002', :'wa');
select pg_temp.seed_job('{"title": "Vacancy 1", "status": "open"}'::jsonb || jsonb_build_object('created_by', :'own1')) as j1 \gset
select pg_temp.seed_job('{"title": "Vacancy 2", "status": "open"}'::jsonb || jsonb_build_object('created_by', :'own1')) as j2 \gset
select pg_temp.seed_job('{"title": "Vacancy 3", "status": "open"}'::jsonb || jsonb_build_object('created_by', :'own1')) as j3 \gset
select pg_temp.seed_job('{"title": "Vacancy 4", "status": "open"}'::jsonb || jsonb_build_object('created_by', :'own1')) as j4 \gset
select pg_temp.seed_app('applied', null, :'wa', :'j1') as a1 \gset
select pg_temp.seed_app('viewed', null, :'wa', :'j2') as a2 \gset
select pg_temp.seed_app('rejected', null, :'wa', :'j3') as a3 \gset
select pg_temp.seed_app('applied', null, :'wb', :'j1') as a4 \gset
select pg_temp.seed_app('shortlisted', null, :'wb', :'j2') as a5 \gset
update public.job_applications set cover_note = 'SECRET-COVER-NOTE' where id = :'a1';
update public.profiles set display_name = 'Kemal Okonkwo' where id = :'wa';

select is(
  pg_temp.names_of('public.admin_get_user(uuid)'::regprocedure),
  'id,display_name,email,account_kind,status,created_at,memberships,applications_submitted,vacancies_created',
  'AC3: the user detail returns exactly the listed columns'
);
select is(
  pg_temp.names_of('public.admin_search_users(text, integer, text, uuid)'::regprocedure), 'id,display_name,email,account_kind,status,created_at',
  'AC3: and the user search returns the identity columns only'
);
select is(
  pg_temp.names_of('public.admin_get_organization(uuid)'::regprocedure), 'id,display_name,legal_name,slug,status,members,vacancies',
  'AC3: the organisation view returns exactly the listed columns'
);
select is(pg_temp.names_of('public.admin_application_counts(date, date)'::regprocedure), 'status,count', 'AC3: the statistics return a stage and a count');

select is(
  (pg_temp.rows_as(:'st_admin', format($$select applications_submitted, vacancies_created, status, account_kind::text as kind, email, display_name from public.admin_get_user(%L)$$, :'wa')) -> 0),
  jsonb_build_object('status', 'active', 'kind', 'worker', 'email', :'wa' || '@example.test', 'display_name', 'Kemal Okonkwo',
                     'applications_submitted', 3, 'vacancies_created', 0),
  'AC3: K has 3 applications submitted and the identity columns'
);
select is(
  (pg_temp.rows_as(:'st_trust', format($$select applications_submitted, vacancies_created from public.admin_get_user(%L)$$, :'own1')) -> 0),
  '{"applications_submitted": 0, "vacancies_created": 4}'::jsonb, 'AC3: the owner of O has created 4 vacancies'
);
select is(
  pg_temp.rows_as(:'st_admin', format($$select memberships from public.admin_get_user(%L)$$, :'own1')) -> 0 -> 'memberships',
  jsonb_build_array(jsonb_build_object('organization_id', current_setting('t.a'), 'name', 'Acme Bau', 'role', 'owner')),
  'AC3: the memberships hold the organisation id, its name and the role'
);
select is(
  (select jsonb_object_agg(r ->> 'status', (r ->> 'count')::int)
   from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_application_counts((now() at time zone 'utc')::date, (now() at time zone 'utc')::date)$$)) r),
  '{"applied": 2, "viewed": 1, "shortlisted": 1, "interview": 0, "offer": 0, "hired": 0, "rejected": 1, "withdrawn": 0}'::jsonb,
  'AC3: eight stages, zero filled, with the counts of the day'
);
select is(
  (select string_agg(r ->> 'status', ',') from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_application_counts(current_date, current_date)$$)) r),
  'applied,viewed,shortlisted,interview,offer,hired,rejected,withdrawn', 'AC3: in the order of the stages'
);
select is(
  (select sum((r ->> 'count')::int) from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_application_counts(current_date - 1, current_date + 1)$$)) r),
  5::bigint, 'AC3: the sum is the 5 applications'
);
select is(
  (select sum((r ->> 'count')::int) from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_application_counts(current_date + 1, current_date + 2)$$)) r),
  0::bigint, 'AC3: a range with no application counts none'
);
update public.job_applications set created_at = date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '23 hours 59 minutes 59.999 seconds' where id = :'a1';
update public.job_applications set created_at = date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '1 day' where id = :'a2';
select is(
  (select (r ->> 'count')::int from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_application_counts((now() at time zone 'utc')::date, (now() at time zone 'utc')::date)$$)) r where r ->> 'status' = 'applied'),
  2, 'AC3: 23:59:59.999 UTC of the last day is inside the range'
);
select is(
  (select (r ->> 'count')::int from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_application_counts((now() at time zone 'utc')::date, (now() at time zone 'utc')::date)$$)) r where r ->> 'status' = 'viewed'),
  0, 'AC3: 00:00:00 UTC of the next day is outside it'
);
update public.job_applications set created_at = now() where id in (:'a1', :'a2');

select is(
  pg_temp.rows_as(:'st_admin', $$select * from public.admin_application_counts(current_date, current_date - 1)$$), '"P0001|CHARA_INVALID_INPUT|range"'::jsonb,
  'AC3: a start after the end is invalid input'
);
select is(
  pg_temp.rows_as(:'st_admin', $$select * from public.admin_application_counts(current_date - 366, current_date)$$), '"P0001|CHARA_INVALID_INPUT|range"'::jsonb,
  'AC3: a range of 367 days is invalid input'
);
select is(
  jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_application_counts(current_date - 365, current_date)$$)), 8,
  'AC3: a range of 366 days is accepted'
);
select is(
  pg_temp.rows_as(:'st_admin', $$select * from public.admin_application_counts(null, current_date)$$), '"P0001|CHARA_INVALID_INPUT|range"'::jsonb,
  'AC3: a missing day is invalid input'
);

select is(
  (select count(*) from jsonb_array_elements(
       pg_temp.rows_as(:'st_admin', format($$select * from public.admin_get_user(%L)$$, :'wa'))
       || pg_temp.rows_as(:'st_trust', format($$select * from public.admin_get_user(%L)$$, :'wa'))
       || pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users('kemal')$$)
       || pg_temp.rows_as(:'st_admin', format($$select * from public.admin_get_organization(%L)$$, current_setting('t.a')))
       || pg_temp.rows_as(:'st_trust', format($$select * from public.admin_get_organization(%L)$$, current_setting('t.a')))
       || pg_temp.rows_as(:'st_admin', $$select * from public.admin_application_counts(current_date - 1, current_date + 1)$$)
     ) r
   where r::text ~* 'SECRET|Amina|Okafor|first_name|cv\.pdf|Title |storage|cover|snapshot|headline'),
  0::bigint, 'AC3: no result holds a cover note, snapshot, candidate name or headline, document title or file name, path or count'
);
select is(
  (select jsonb_agg(m ->> 'user_id' order by m ->> 'user_id')
   from jsonb_array_elements(pg_temp.rows_as(:'st_trust', format($$select members from public.admin_get_organization(%L)$$, current_setting('t.a'))) -> 0 -> 'members') m),
  (select jsonb_agg(u order by u) from (values (:'own1'), (:'adm'), (:'mem'), (:'pending')) v (u)),
  'AC3: the organisation view lists its members for the Trust & Safety Administrator too'
);
select is(
  (select jsonb_agg(m ->> 'role' order by (m ->> 'user_id')) from jsonb_array_elements(pg_temp.rows_as(:'st_trust', format($$select members from public.admin_get_organization(%L)$$, current_setting('t.a'))) -> 0 -> 'members') m
    where m ->> 'user_id' in (:'own1', :'adm')),
  (select jsonb_agg(r order by u) from (values (:'adm', 'admin'), (:'own1', 'owner')) v (u, r)),
  'AC3: with their roles'
);
select is(
  jsonb_array_length(pg_temp.rows_as(:'st_trust', format($$select vacancies from public.admin_get_organization(%L)$$, current_setting('t.a'))) -> 0 -> 'vacancies'),
  4, 'AC3: and its 4 vacancies'
);
select is(
  (pg_temp.rows_as(:'st_trust', format($$select vacancies from public.admin_get_organization(%L)$$, current_setting('t.a'))) -> 0 -> 'vacancies' -> 0) - 'id' - 'title',
  '{"status": "open", "moderation_state": "visible"}'::jsonb, 'AC3: a vacancy shows its status and moderation state'
);
select is(
  pg_temp.rows_as(:'st_trust', $$select * from public.admin_get_user(gen_random_uuid())$$), '"P0002|CHARA_NOT_FOUND|"'::jsonb,
  'an unknown user is not found'
);
select is(
  pg_temp.rows_as(:'st_trust', $$select * from public.admin_get_organization(gen_random_uuid())$$), '"P0002|CHARA_NOT_FOUND|"'::jsonb,
  'and so is an unknown organisation'
);

-- AC4: the search of users, 60 of them named Test User
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select ('00000000-0000-0000-0000-0000000e' || lpad(n::text, 4, '0'))::uuid, 'test.user' || n || '@search.test', now(),
       jsonb_build_object('intended_account_kind', 'worker')
from generate_series(1, 60) n;
update public.profiles set display_name = 'Test User ' || lpad(right(id::text, 4)::int::text, 2, '0'), account_kind = 'worker'
where id::text like '00000000-0000-0000-0000-0000000e%';

create temp table page1 as select * from jsonb_to_recordset(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users('test user', 25)$$)) as t (id uuid, display_name text);
select is((select count(*) from page1), 25::bigint, 'AC4: the first page holds 25 users');
select is((select min(display_name) || '|' || max(display_name) from page1), 'Test User 01|Test User 25', 'AC4: ordered by display name');
create temp table page2 as select * from jsonb_to_recordset(pg_temp.rows_as(:'st_admin', format(
  $$select * from public.admin_search_users('test user', 25, %L, %L)$$, (select display_name from page1 order by display_name desc limit 1), (select id from page1 order by display_name desc limit 1)))) as t (id uuid, display_name text);
select is((select min(display_name) || '|' || max(display_name) from page2), 'Test User 26|Test User 50', 'AC4: the next page continues after the last row');
create temp table page3 as select * from jsonb_to_recordset(pg_temp.rows_as(:'st_admin', format(
  $$select * from public.admin_search_users('test user', 25, %L, %L)$$, (select display_name from page2 order by display_name desc limit 1), (select id from page2 order by display_name desc limit 1)))) as t (id uuid, display_name text);
select is((select count(*) || '|' || min(display_name) || '|' || max(display_name) from page3), '10|Test User 51|Test User 60', 'AC4: and the last page holds the other 10');
select is(jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users('test user', 1000)$$)), 60, 'AC4: a page holds 100 rows at most');
select is(jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users('TEST USER 07')$$)), 1, 'AC4: users match case-insensitively on the display name');
select is(jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users('Test.User7@Search.Test')$$)), 1, 'AC4: and on the whole email address');
select is(jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users('test.user')$$)), 0, 'AC4: part of an email address does not match');
select is(
  jsonb_array_length(pg_temp.rows_as(:'st_trust', format($$select * from public.admin_search_users(%L)$$, upper(:'wb')))), 1,
  'AC4: and on the user id'
);
select is(jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users('zzzzqq')$$)), 0, 'AC4: no match is an empty list');
select is(jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users('%%%')$$)), 0, 'a percent sign matches itself, not everything');
select is(jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users('_____')$$)), 0, 'and so does an underscore');
select is(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users('ab')$$), '"P0001|CHARA_INVALID_INPUT|term"'::jsonb, 'AC4: a term of 2 characters is invalid input');
select is(pg_temp.rows_as(:'st_admin', format($$select * from public.admin_search_users(%L)$$, repeat('a', 101))), '"P0001|CHARA_INVALID_INPUT|term"'::jsonb, 'AC4: and 101 characters too');
select is(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users(null)$$), '"P0001|CHARA_INVALID_INPUT|term"'::jsonb, 'no term is invalid input');
select is(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_users('   ab  ')$$), '"P0001|CHARA_INVALID_INPUT|term"'::jsonb, 'the term is trimmed first');

-- AC4: the search of organisations, 60 of them named Test Org
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
select ('00000000-0000-0000-0000-0000000f' || lpad(n::text, 4, '0'))::uuid, 'employer', 'test-org-' || n, 'Legal Name ' || n || ' GmbH',
       'Test Org ' || lpad(n::text, 2, '0'), 'DE'
from generate_series(1, 60) n;
select is(jsonb_array_length(pg_temp.rows_as(:'st_trust', $$select * from public.admin_search_organizations('test org', 25)$$)), 25, 'AC4: the organisation search pages by 25');
select is(
  (select (r ->> 'display_name') from jsonb_array_elements(pg_temp.rows_as(:'st_trust', format(
     $$select * from public.admin_search_organizations('test org', 25, 'Test Org 25', %L)$$, '00000000-0000-0000-0000-0000000f0025'))) r limit 1),
  'Test Org 26', 'AC4: the next page continues after the last row'
);
select is(jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_organizations('legal name 7 gmbh')$$)), 1, 'AC4: organisations match on the legal name');
select is(jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_organizations('TEST-ORG-12')$$)), 1, 'AC4: and on the slug');
select is(jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_organizations('zzzzqq')$$)), 0, 'AC4: no match is an empty list');

-- AC4: the audit search
insert into audit.log (actor_id, action, entity_type, entity_id, metadata, created_at)
select case when n % 2 = 0 then :'st_admin'::uuid else :'st_trust'::uuid end,
       case when n % 3 = 0 then 'user.suspend' else 'user.reinstate' end, 'profile', 'entity-' || n,
       jsonb_build_object('reason', 'Reason number ' || n), timestamptz '2020-03-01 00:00:00+00' + n * interval '1 hour'
from generate_series(1, 60) n;
select is(jsonb_array_length(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_from => date '2020-03-01', p_to => date '2020-03-31')$$)), 25, 'AC4: the audit search returns 25 rows');
select is(
  (select r ->> 'entity_id' from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_from => date '2020-03-01', p_to => date '2020-03-31')$$)) r limit 1),
  'entity-60', 'AC4: newest first'
);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.rows_as(:'st_admin', format($$select * from public.admin_search_audit(p_actor => %L, p_action => 'user.suspend', p_from => date '2020-03-01', p_to => date '2020-03-31', p_limit => 100)$$, :'st_admin'))) r),
  10::bigint, 'AC4: filters on actor and action combine with AND'
);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_entity_type => 'profile', p_entity_id => 'entity-7')$$)) r), 1::bigint,
  'AC4: and on the entity'
);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_from => date '2020-03-02', p_to => date '2020-03-02', p_limit => 100)$$)) r), 24::bigint,
  'AC4: a day is taken whole, in UTC'
);
select is(
  (select r ->> 'entity_id' from jsonb_array_elements(pg_temp.rows_as(:'st_admin', format(
     $$select * from public.admin_search_audit(p_from => date '2020-03-01', p_to => date '2020-03-31', p_after_at => %L, p_after_id => %L)$$,
     (select created_at from audit.log where entity_id = 'entity-36'), (select id from audit.log where entity_id = 'entity-36')))) r limit 1),
  'entity-35', 'AC4: the next page continues after the last row'
);
select is(
  pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_from => date '2020-03-05', p_to => date '2020-03-01')$$), '"P0001|CHARA_INVALID_INPUT|filter"'::jsonb,
  'AC4: a start after the end is invalid input'
);
select is(
  (select (r -> 'metadata' ->> 'reason') from jsonb_array_elements(pg_temp.rows_as(:'st_admin', $$select * from public.admin_search_audit(p_entity_id => 'entity-9')$$)) r),
  'Reason number 9', 'AC4: the reason is in the metadata of the row'
);
select is(
  pg_temp.names_of('public.admin_search_audit(uuid, text, text, text, date, date, integer, timestamptz, bigint)'::regprocedure),
  'id,actor_id,action,entity_type,entity_id,metadata,created_at', 'the audit search returns no address'
);

select * from finish();
rollback;
