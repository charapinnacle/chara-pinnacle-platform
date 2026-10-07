begin;
select plan(18);

\ir applicants_fixture.inc

-- The completeness a snapshot stores (FR-E1 data rules, FR-B4 weights): name and country 10, headline 5, occupation 15,
-- three skills 15, a language 10, years of experience 10, availability 10, a valid work authorisation 10, a usable CV 15.
-- The fixture passport of wa has its names, a country and an occupation: 25.
select is(private.passport_completeness(:'wa'), 25, 'completeness: names, country and occupation');
select is(private.passport_completeness(gen_random_uuid()), 0, 'completeness: a user without a passport has 0');
insert into public.worker_skills (worker_user_id, skill) values (:'wa', 'Welding'), (:'wa', 'Wiring');
select is(private.passport_completeness(:'wa'), 25, 'completeness: two skills do not count');
insert into public.worker_skills (worker_user_id, skill) values (:'wa', 'Cabling');
select is(private.passport_completeness(:'wa'), 40, 'completeness: three skills count 15');
select pg_temp.doc('00000000-0000-0000-0000-0000000e0001', :'wa', 'rejected');
select is(private.passport_completeness(:'wa'), 40, 'completeness: a CV that failed the file check does not count');
select pg_temp.doc('00000000-0000-0000-0000-0000000e0002', :'wa', 'skipped');
select is(private.passport_completeness(:'wa'), 55, 'completeness: a usable CV counts 15');
update public.worker_documents set deleted_at = now() where id = '00000000-0000-0000-0000-0000000e0002';
select is(private.passport_completeness(:'wa'), 40, 'completeness: a deleted CV does not count');
update public.worker_documents set deleted_at = null where id = '00000000-0000-0000-0000-0000000e0002';
update public.worker_profiles set headline = 'Welder', years_experience = 0, availability = 'now' where user_id = :'wa';
select is(private.passport_completeness(:'wa'), 80, 'completeness: a headline 5, years of experience 10 (0 counts) and availability 10');
insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (:'wa', 'en', 'B2');
insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values (:'wa', 'DE', (now() at time zone 'utc')::date);
-- The table refuses a date in the past; an authorisation that has run out is one whose date has passed since.
alter table public.worker_work_authorizations disable trigger user;
update public.worker_work_authorizations set expires_on = (now() at time zone 'utc')::date - 1 where worker_user_id = :'wa';
alter table public.worker_work_authorizations enable trigger user;
select is(private.passport_completeness(:'wa'), 90, 'completeness: a language 10; an authorisation that expired yesterday does not count');
update public.worker_work_authorizations set expires_on = (now() at time zone 'utc')::date where worker_user_id = :'wa';
select is(private.passport_completeness(:'wa'), 100, 'completeness: an authorisation that expires today counts');

-- apply_to_job stores the percentage at that moment in the snapshot, and a later change of the passport leaves it as it was.
create temp table t_a as select pg_temp.org_on('employer_starter') as org;
select pg_temp.open_job('Completeness vacancy', (select org from t_a)) as job \gset
select pg_temp.apply_as(:'wa', :'job') as applied \gset
select current_setting('t.app')::uuid as app \gset
select is((select (profile_snapshot ->> 'completeness')::int from public.job_applications where id = :'app'), 100, 'the snapshot of an application holds the completeness at the time of applying');
update public.worker_profiles set headline = null, availability = null where user_id = :'wa';
select is(private.passport_completeness(:'wa'), 85, 'the passport changed afterwards');
select is((select (profile_snapshot ->> 'completeness')::int from public.job_applications where id = :'app'), 100, 'and the stored completeness did not');
select pg_temp.seed_applicant(:'job', (select org from t_a), 'applied', now(), 'Explicit One', 33, 0) as explicit \gset
select is((select (profile_snapshot ->> 'completeness')::int from public.job_applications where id = :'explicit'), 33, 'a snapshot that carries a completeness keeps it');
select is(
  (select count(*) from public.job_applications where not (profile_snapshot ? 'completeness')), 0::bigint,
  'no application is written without a completeness in its snapshot'
);
select is((select tgenabled::text from pg_trigger where tgname = 'job_applications_snapshot_completeness'), 'A', 'the trigger is enabled always');

-- Time to first review of new applicants (SOP FR-E1 KPI): from the application to its first event that is neither the
-- candidate's application nor a withdrawal, the median in hours. The query is that of docs/runbooks/applicant-list.md.
create temp table t_k as select pg_temp.seed_applicant(:'job', (select org from t_a), 'applied', now() - interval '10 hours', 'Kpi ' || n, 20, 0) as id, n
  from generate_series(1, 4) n;
insert into public.application_events (application_id, from_status, to_status, actor_id, created_at) values
  ((select id from t_k where n = 1), 'applied', 'viewed', null, now() - interval '8 hours'),
  ((select id from t_k where n = 1), 'viewed', 'interview', :'mem', now() - interval '2 hours'),
  ((select id from t_k where n = 2), 'applied', 'shortlisted', :'mem', now() - interval '4 hours'),
  ((select id from t_k where n = 3), 'applied', 'withdrawn', (select worker_user_id from public.job_applications where id = (select id from t_k where n = 3)), now() - interval '1 hour');
select results_eq(
  $$select count(*), round(percentile_cont(0.5) within group (order by extract(epoch from (r.first_review - a.created_at)) / 3600)::numeric, 1)
    from public.job_applications a
    join lateral (
      select min(e.created_at) as first_review from public.application_events e
      where e.application_id = a.id and e.to_status not in ('applied', 'withdrawn')
    ) r on r.first_review is not null
    where a.id in (select id from t_k)$$,
  $$values (2::bigint, 4.0::numeric)$$,
  'KPI: two of the four were reviewed, after 2 and 6 hours (median 4.0); one was only withdrawn and one is waiting'
);
select is(
  (select count(*) from public.job_applications where status = 'applied' and id in (select id from t_k)), 4::bigint,
  'KPI: the applications still waiting stay in Applied, which the New badge marks'
);

select * from finish();
rollback;
