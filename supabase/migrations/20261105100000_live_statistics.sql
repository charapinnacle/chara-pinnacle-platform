-- Live statistics (FR-H4; ARCHITECTURE.md section 9.4; OPEN_QUESTIONS.md D72).

insert into private.settings (key, value) values ('stats_min_count', '5');

-- countries counts the distinct countries of the counted vacancies (D72). The recruitment, staffing and requirement
-- counts of ARCHITECTURE.md section 9.4 are later phase.
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

-- Required by refresh materialized view concurrently.
create unique index platform_counts_mv_key on stats.platform_counts_mv (countries, workers, employers, active_jobs);

revoke all on table stats.platform_counts_mv from public, anon, authenticated, service_role;

-- 5 is a floor: a missing row, a value that is not a whole number, or one below 5 never exposes a small count.
create function private.stats_min_count() returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(5, coalesce(
    (select case when s.v ~ '^[1-9][0-9]{0,8}$' then s.v::integer end
     from (select value #>> '{}' as v from private.settings where key = 'stats_min_count') s),
    5
  ))
$$;

revoke all on function private.stats_min_count() from public, anon, authenticated, service_role;

-- Runs with the rights of its owner because the visitor has no privilege on the snapshot or the settings. The test
-- against k is made on the exact count, before the candidate count is rounded to the nearest 10 (half up).
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

-- security_invoker like every view of public (035_privacy_catalogue.test.sql); the owner's rights sit in the function.
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
