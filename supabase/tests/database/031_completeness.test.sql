begin;
select plan(21);

\ir passport_fixture.inc

-- FR-B4: the completeness percentage is computed on read by the web tier and never stored. What the database holds
-- is the data it is computed from, and the monthly review (SOP FR-B4, step Measure) is an offline query over that
-- data. The view below is the score query of docs/runbooks/passport-completeness.md, with the same weights as
-- apps/web/lib/passport/completeness.ts.
create temp view completeness_scores as
select
  p.user_id,
  10
  + (btrim(coalesce(p.headline, '')) <> '')::int * 5
  + (p.occupation_id is not null)::int * 15
  + ((select count(*) from public.worker_skills s where s.worker_user_id = p.user_id) >= 3)::int * 15
  + exists (select 1 from public.worker_languages l where l.worker_user_id = p.user_id)::int * 10
  + (p.years_experience is not null)::int * 10
  + (p.availability is not null)::int * 10
  + exists (
    select 1 from public.worker_work_authorizations a
    where a.worker_user_id = p.user_id and (a.expires_on is null or a.expires_on >= (now() at time zone 'utc')::date)
  )::int * 10
  + exists (
    select 1 from public.worker_documents d
    where d.worker_user_id = p.user_id and d.type = 'cv' and d.deleted_at is null
      and d.scan_status in ('clean', 'skipped')
  )::int * 15 as score
from public.worker_profiles p;

insert into public.worker_profiles (user_id, first_name, last_name, current_country)
values (:'wa', 'Amina', 'Okafor', 'NG'), (:'wb', 'Bruno', 'Silva', 'PT'), (:'wnew', 'Chen', 'Wei', 'CN'), (:'wsus', 'Dara', 'Nwosu', 'NG');

create function pg_temp.score_of(p_user uuid) returns int
language sql as $$ select score from completeness_scores where user_id = p_user $$;

create function pg_temp.add_cv(p_user uuid, p_status text, p_type text default 'cv') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes, scan_status)
  values (v_id, p_user, p_type::public.worker_document_type, 'Document', p_user || '/' || v_id || '/cv.pdf', 'cv.pdf', 'application/pdf', 1000, p_status);
  return v_id;
end;
$$;

-- B: occupation, three skills and a usable CV (55); C: everything except the CV (85); D: everything (100)
update public.worker_profiles set occupation_id = '7411' where user_id = :'wb';
insert into public.worker_skills (worker_user_id, skill)
select u, s from unnest(array[:'wb', :'wnew', :'wsus']::uuid[]) u, unnest(array['Welding', 'Wiring', 'Cabling']) s;
select pg_temp.add_cv(:'wb', 'skipped');
update public.worker_profiles set occupation_id = '7411', headline = 'Electrician', years_experience = 6, availability = 'now'
where user_id in (:'wnew', :'wsus');
insert into public.worker_languages (worker_user_id, language_code, cefr_level)
values (:'wnew', 'en', 'B2'), (:'wsus', 'en', 'B2');
insert into public.worker_work_authorizations (worker_user_id, country_code) values (:'wnew', 'DE'), (:'wsus', 'DE');
select pg_temp.add_cv(:'wsus', 'clean');

select is(
  array[pg_temp.score_of(:'wa'), pg_temp.score_of(:'wb'), pg_temp.score_of(:'wnew'), pg_temp.score_of(:'wsus')],
  array[10, 55, 85, 100],
  'AC1: the score query gives 10, 55, 85 and 100 for the four reference profiles'
);

-- The reviewed numbers, over the four fixture profiles (other rows of a shared database are left out).
select is(
  (select percentile_cont(0.5) within group (order by score)::text from completeness_scores where user_id in (:'wa', :'wb', :'wnew', :'wsus')),
  '70',
  'KPI: median completeness is the middle of 10, 55, 85 and 100'
);
select is(
  (select round(100.0 * count(*) filter (where score >= 80) / nullif(count(*), 0), 1)::text
   from completeness_scores where user_id in (:'wa', :'wb', :'wnew', :'wsus')),
  '50.0',
  'KPI: the share of profiles at 80 percent or more is 2 of 4'
);

-- AC2, AC3: thresholds of the list and value items
delete from public.worker_skills where worker_user_id = :'wsus' and skill = 'Cabling';
select is(pg_temp.score_of(:'wsus'), 85, 'AC2: two skills do not count');
insert into public.worker_skills (worker_user_id, skill) values (:'wsus', 'Cabling');
select is(pg_temp.score_of(:'wsus'), 100, 'AC2: three skills count');
update public.worker_profiles set years_experience = null where user_id = :'wsus';
select is(pg_temp.score_of(:'wsus'), 90, 'AC3: years of experience not set does not count');
update public.worker_profiles set years_experience = 0 where user_id = :'wsus';
select is(pg_temp.score_of(:'wsus'), 100, 'AC3: 0 years counts');
update public.worker_profiles set availability = 'unavailable' where user_id = :'wsus';
select is(pg_temp.score_of(:'wsus'), 100, 'AC3: availability unavailable counts');
update public.worker_profiles set headline = null where user_id = :'wsus';
select is(pg_temp.score_of(:'wsus'), 95, 'AC3: no headline does not count');
update public.worker_profiles set headline = 'Electrician' where user_id = :'wsus';

-- AC4: only a valid work authorisation counts (a trigger refuses a past date, so the check is lifted for the setup)
alter table public.worker_work_authorizations disable trigger worker_authorizations_check_expiry;
update public.worker_work_authorizations set expires_on = (now() at time zone 'utc')::date - 1 where worker_user_id = :'wsus';
select is(pg_temp.score_of(:'wsus'), 90, 'AC4: an authorisation that expired yesterday does not count');
update public.worker_work_authorizations set expires_on = (now() at time zone 'utc')::date where worker_user_id = :'wsus';
select is(pg_temp.score_of(:'wsus'), 100, 'AC4: an authorisation that expires today counts');
alter table public.worker_work_authorizations enable always trigger worker_authorizations_check_expiry;

-- AC5: only a usable CV counts
update public.worker_documents set deleted_at = now() where worker_user_id = :'wsus';
select is(pg_temp.score_of(:'wsus'), 85, 'AC5: a deleted CV does not count');
select pg_temp.add_cv(:'wsus', 'rejected');
select is(pg_temp.score_of(:'wsus'), 85, 'AC5: a rejected CV does not count');
select pg_temp.add_cv(:'wsus', 'pending');
select is(pg_temp.score_of(:'wsus'), 85, 'AC5: a pending CV does not count');
select pg_temp.add_cv(:'wsus', 'clean', 'certificate');
select is(pg_temp.score_of(:'wsus'), 85, 'AC5: a certificate does not count');
select pg_temp.add_cv(:'wsus', 'skipped');
select is(pg_temp.score_of(:'wsus'), 100, 'AC5: a skipped CV counts');

-- No stored score: nothing in the candidate tables holds a percentage or a score
select is_empty(
  $$select table_name || '.' || column_name from information_schema.columns
    where table_schema = 'public' and table_name like 'worker\_%' and column_name ~ '(complet|score|percent)'$$,
  'the completeness is computed on read: no candidate table stores a score or a percentage'
);

-- Roles and permissions: the one data question the web tier asks, as the query of getUsableCvs
create function pg_temp.cv_rows_as(p_user uuid, p_role text, p_aal text default 'aal1') returns text
language plpgsql as $$
begin
  return pg_temp.affected_as(
    p_user, p_role,
    $q$select type, scan_status, deleted_at from public.worker_documents
       where type = 'cv' and scan_status in ('skipped', 'clean') limit 1$q$,
    p_aal)::text;
exception when others then
  reset role;
  return 'E' || sqlstate;
end;
$$;

select is(pg_temp.cv_rows_as(:'wb', 'authenticated'), '1', 'the candidate with a usable CV reads one row');
select is(pg_temp.cv_rows_as(:'wa', 'authenticated'), '0', 'a candidate without a CV reads none');
select is(
  array[pg_temp.cv_rows_as(:'own1', 'authenticated', 'aal2'), pg_temp.cv_rows_as(:'slg', 'authenticated', 'aal2')],
  array['0', '0'],
  'an employer owner and a platform administrator read none of the candidates'' CVs'
);
select is(pg_temp.cv_rows_as(null, 'anon'), 'E42501', 'anonymous is refused by missing grants');

select * from finish();
rollback;
