begin;
select plan(21);

-- Whatever the local database already holds (earlier browser tests leave rows behind) is taken out of the counted sets,
-- inside this transaction, so that the counts below are absolute.
update public.jobs set deleted_at = now() where deleted_at is null;
update public.organizations set status = 'suspended';
update public.profiles set status = 'suspended';

\ir search_fixture.inc

create function pg_temp.snapshot() returns text
language sql as $$
  select format('%s|%s|%s|%s', active_jobs, employers, workers, countries) from stats.platform_counts_mv
$$;

-- FR-H4 AC9: the job, the populated view and the index that lets it refresh concurrently.
select is(
  (select count(*) from cron.job
   where jobname = 'refresh-platform-counts' and schedule = '*/10 * * * *' and active
     and command = 'refresh materialized view concurrently stats.platform_counts_mv'),
  1::bigint, 'AC9: the active job refresh-platform-counts refreshes the snapshot concurrently every 10 minutes'
);
select ok(
  (select ispopulated from pg_matviews where schemaname = 'stats' and matviewname = 'platform_counts_mv'),
  'AC9: the snapshot is populated at creation'
);
select is(
  (select count(*) from pg_index i
   where i.indrelid = 'stats.platform_counts_mv'::regclass and i.indisunique and i.indisvalid),
  1::bigint, 'AC9: the snapshot has a unique index'
);
select lives_ok($$refresh materialized view concurrently stats.platform_counts_mv$$, 'AC9: a concurrent refresh succeeds');
select is(
  (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
   where a.attrelid = 'stats.platform_counts_mv'::regclass and a.attnum > 0 and not a.attisdropped),
  array['countries', 'workers', 'employers', 'active_jobs'],
  'AC6: the snapshot has the four Phase 1 columns and nothing else'
);

-- The fixture holds Acme and Beta (active employers) and the workers wkr, wa, wb, wnew (active) and wsus (suspended).
refresh materialized view concurrently stats.platform_counts_mv;
select is(pg_temp.snapshot(), '0|2|4|0', 'control: with no vacancy the snapshot holds 0 vacancies and 0 countries');

-- FR-H4 AC5: one vacancy of each kind; only the open, visible, undeleted one counts.
select pg_temp.seed_job('{"title": "Seed open vacancy", "status": "open"}') as v_open \gset
select pg_temp.seed_job('{"title": "Seed draft vacancy", "status": "draft"}') as v_draft \gset
select pg_temp.seed_job('{"title": "Seed paused vacancy", "status": "paused"}') as v_paused \gset
select pg_temp.seed_job('{"title": "Seed closed vacancy", "status": "closed"}') as v_closed \gset
select pg_temp.seed_job('{"title": "Seed filled vacancy", "status": "filled"}') as v_filled \gset
select pg_temp.seed_job('{"title": "Seed hidden vacancy", "status": "open", "moderation_state": "hidden"}') as v_hidden \gset
select pg_temp.seed_job('{"title": "Seed suspended vacancy", "status": "open", "moderation_state": "org_suspended"}') as v_suspended \gset
select pg_temp.seed_job('{"title": "Seed deleted vacancy", "status": "open", "deleted_at": "2026-01-01T00:00:00Z"}') as v_deleted \gset

select is(pg_temp.snapshot(), '0|2|4|0', 'AC9: the snapshot does not change before the refresh');
refresh materialized view concurrently stats.platform_counts_mv;
select is(
  (select active_jobs from stats.platform_counts_mv), 1,
  'AC5: of the eight vacancies only the open, visible, undeleted one is counted'
);
select is(
  (select countries from stats.platform_counts_mv), 1,
  'AC5: the vacancies that are not counted add no country'
);

-- A vacancy that changes state moves in and out of the count at the next refresh, never before it.
select pg_temp.set_status(:'own1', :'v_paused', 'open') as opened \gset
update public.jobs set moderation_state = 'visible' where id = :'v_hidden';
select is(pg_temp.snapshot(), '1|2|4|1', 'a paused vacancy that is opened and a hidden one that is shown change nothing before the refresh');
refresh materialized view concurrently stats.platform_counts_mv;
select is((select active_jobs from stats.platform_counts_mv), 3, 'AC9: after the refresh the count is higher by the two vacancies that became public');
select pg_temp.set_status(:'own1', :'v_paused', 'paused') as paused_again \gset
update public.jobs set moderation_state = 'org_suspended' where id = :'v_hidden';
refresh materialized view concurrently stats.platform_counts_mv;
select is((select active_jobs from stats.platform_counts_mv), 1, 'the count falls again when they stop being public');

-- FR-H4 AC6: open vacancies in DE (2) and PL (1), a paused one in FR, three active employers and one suspended, a
-- recruitment company, two candidates who count, company users and a staff user.
select pg_temp.seed_job('{"title": "Second German vacancy", "status": "open", "country_code": "DE"}') as v_de \gset
select pg_temp.seed_job('{"title": "Polish vacancy", "status": "open", "country_code": "PL"}') as v_pl \gset
select pg_temp.seed_job('{"title": "Paused French vacancy", "status": "paused", "country_code": "FR"}') as v_fr \gset
insert into public.organizations (type, slug, legal_name, display_name, based_in_country, status) values
  ('employer', 'gamma', 'Gamma GmbH', 'Gamma', 'DE', 'active'),
  ('employer', 'delta', 'Delta GmbH', 'Delta', 'DE', 'suspended'),
  ('recruitment_company', 'recruiter', 'Recruiter Ltd', 'Recruiter', 'GB', 'active');
update public.profiles set deleted_at = now() where id in (:'wkr', :'wnew');
insert into public.platform_staff (user_id, role) values (:'late', 'admin');
refresh materialized view concurrently stats.platform_counts_mv;

select is(pg_temp.snapshot(), '3|3|2|2', 'AC6: 3 vacancies, 3 employers, 2 candidates and 2 countries (DE and PL)');
select is(
  (select employers from stats.platform_counts_mv), (select count(*)::integer from public.organizations where type = 'employer' and status = 'active'),
  'AC6: employers equals the direct count of active employer organisations'
);
select is(
  (select workers from stats.platform_counts_mv),
  (select count(*)::integer from public.profiles where account_kind = 'worker' and status = 'active' and deleted_at is null),
  'AC6: candidates equals the direct count of active, undeleted worker profiles'
);
select is(
  (select countries from stats.platform_counts_mv),
  (select count(distinct country_code)::integer from public.jobs where status = 'open' and moderation_state = 'visible' and deleted_at is null),
  'AC6: countries equals the direct count of the countries of the open, visible, undeleted vacancies'
);
select is(
  (select active_jobs from stats.platform_counts_mv),
  (select count(*)::integer from public.jobs where status = 'open' and moderation_state = 'visible' and deleted_at is null),
  'AC6: vacancies equals the direct count'
);
select ok(
  exists (select 1 from public.profiles p join public.platform_staff s on s.user_id = p.id
          where p.account_kind = 'company' and p.status = 'active')
  and (select count(*) from public.profiles where account_kind = 'company' and status = 'active') > 1,
  'control: the company users and the staff user are active profiles that the candidate count leaves out'
);

-- Closing a country: the last public vacancy of a country leaves the count of countries at the next refresh.
update public.jobs set deleted_at = now() where id = :'v_pl';
refresh materialized view concurrently stats.platform_counts_mv;
select is((select countries from stats.platform_counts_mv), 1, 'a country with no public vacancy left is no longer counted');

-- A suspended employer, a withdrawn candidate and a pending deletion leave the counts at the next refresh.
update public.organizations set status = 'suspended' where slug = 'gamma';
update public.profiles set status = 'deletion_pending' where id = :'wa';
refresh materialized view concurrently stats.platform_counts_mv;
select is(
  (select employers || '|' || workers from stats.platform_counts_mv), '2|1',
  'a suspended employer and a candidate whose deletion is pending are no longer counted'
);

-- The index behind the vacancy count and the distinct countries.
select ok(
  exists (select 1 from pg_indexes where indexname = 'jobs_public_country_idx' and indexdef like '%(country_code)%'
          and indexdef like '%status = ''open''%' and indexdef like '%deleted_at IS NULL%'),
  'the public vacancies have an index on the country'
);

select * from finish();
rollback;
