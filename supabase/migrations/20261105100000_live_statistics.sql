-- Live statistics (FR-H4; ARCHITECTURE.md section 9.4; OPEN_QUESTIONS.md D72). The home page shows four numbers of the
-- platform: open vacancies, employers, candidates and countries. They are counted from the real tables into a
-- materialized view that a pg_cron job refreshes every 10 minutes, and read through public.v_platform_counts, which hides
-- every value below the threshold k (the setting stats_min_count, 5 by default) and rounds the candidate count to the
-- nearest 10. Nothing in the snapshot or the view names or identifies a person, an organisation or a vacancy.

insert into private.settings (key, value) values ('stats_min_count', '5');

-- The public vacancies are a small part of the table, so the refresh reads this index (both the count and the distinct
-- countries) and not the table. The employers and the candidates are most of their tables, where an index would not be
-- used: a refresh reads those in parallel in under 50 ms at 500,000 profiles.
create index jobs_public_country_idx on public.jobs (country_code)
  where status = 'open' and moderation_state = 'visible' and deleted_at is null;

-- Exact counts, one row. countries is the number of distinct countries of the counted vacancies (OPEN_QUESTIONS.md D72).
-- The Phase 1 values only: the recruitment, staffing and requirement counts of ARCHITECTURE.md section 9.4 are later phase.
create materialized view stats.platform_counts_mv as
select
  (select count(distinct j.country_code)
   from public.jobs j
   where j.status = 'open' and j.moderation_state = 'visible' and j.deleted_at is null)::integer as countries,
  (select count(*)
   from public.profiles p
   where p.account_kind = 'worker' and p.status = 'active' and p.deleted_at is null)::integer as workers,
  (select count(*)
   from public.organizations o
   where o.type = 'employer' and o.status = 'active')::integer as employers,
  (select count(*)
   from public.jobs j
   where j.status = 'open' and j.moderation_state = 'visible' and j.deleted_at is null)::integer as active_jobs;

comment on materialized view stats.platform_counts_mv is
  'Exact counts for the home page, refreshed every 10 minutes by the job refresh-platform-counts. Not readable through the API: public.v_platform_counts applies the threshold and the rounding.';

-- Required by refresh materialized view concurrently; the row is unique because there is only one.
create unique index platform_counts_mv_key on stats.platform_counts_mv (countries, workers, employers, active_jobs);

revoke all on table stats.platform_counts_mv from public, anon, authenticated, service_role;

-- The threshold. A missing row, a text that is not a whole number of 1 or more, or a number too large for an integer
-- falls back to 5, so a bad value can never expose a small count.
create function private.stats_min_count() returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when s.v ~ '^[1-9][0-9]{0,8}$' then s.v::integer end
     from (select value #>> '{}' as v from private.settings where key = 'stats_min_count') s),
    5
  )
$$;

revoke all on function private.stats_min_count() from public, anon, authenticated, service_role;

-- The only reader of the snapshot. It runs with the rights of its owner, because the visitor has no privilege on the
-- snapshot or on the settings, and returns the values after the test against k, which is made on the exact count; the
-- candidate count is rounded to the nearest 10 (half up) after that test.
create function private.platform_counts()
returns table (active_jobs integer, employers integer, workers integer, countries integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when c.active_jobs >= k.min_count then c.active_jobs end,
    case when c.employers >= k.min_count then c.employers end,
    case when c.workers >= k.min_count then (c.workers + 5) / 10 * 10 end,
    case when c.countries >= k.min_count then c.countries end
  from stats.platform_counts_mv c
  cross join (select private.stats_min_count() as min_count) k
$$;

revoke all on function private.platform_counts() from public, anon, authenticated, service_role;
grant execute on function private.platform_counts() to anon, authenticated;

-- security_invoker like every view of public (035_privacy_catalogue.test.sql); the owner's rights it needs are the
-- function's. The view has four columns and no other data.
create view public.v_platform_counts with (security_invoker = true) as
select active_jobs, employers, workers, countries from private.platform_counts();

comment on view public.v_platform_counts is
  'Home page statistics. A value is null when its exact count is below stats_min_count; workers is rounded to the nearest 10.';

revoke all on table public.v_platform_counts from public, anon, authenticated, service_role;
grant select on table public.v_platform_counts to anon, authenticated;

select cron.schedule(
  'refresh-platform-counts',
  '*/10 * * * *',
  'refresh materialized view concurrently stats.platform_counts_mv'
);
