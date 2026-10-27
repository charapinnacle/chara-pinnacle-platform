begin;
select plan(18);

-- Find Partners at 5,000 partner organisations (V78, NFR-P3), the light version of scripts/load/find-partners.mjs that
-- runs in CI: the same seeded network and the same typical searches, five runs each instead of fifty and without the
-- query plans. Every search must stay within the database share of the NFR-P3 target (95 % of renders within 500 ms
-- server time): 100 ms at the 95th percentile, which leaves the rest for the page and the network
-- (docs/perf/release-2a.md). The searches must also still skip every partner that is not listed and visible.

\ir find_partners_load_fixture.inc

update private.settings set value = 'true' where key = 'release_partner_directories';

select pg_temp.seed_find_partners(5000, 1000);
analyze public.organizations, public.organization_geographies, public.organization_occupations,
  public.organization_industries, public.organization_languages, public.organization_service_types,
  public.workforce_availability;
select pg_temp.load_employer() as employer \gset

select is(
  (select count(*)::integer from public.organizations
   where slug like 'load-partner-%' and listed_at is not null and moderation_state = 'visible'),
  4950,
  'NFR-P3: the load seeds 5,000 listed partners (50 of them hidden by moderation) and 1,000 unlisted ones'
);

select count(*) as searches_before from stats.partner_searches \gset
select pg_temp.prepare_find_partners_cases(:'employer');
select pg_temp.run_find_partners_load(:'employer', 5);

select ok(
  (select r.p95_ms < 100 from load_results r where r.label = c.label),
  format('NFR-P3: %s stays within 100 ms at the 95th percentile', c.label)
)
from load_cases c order by c.position;

select is(
  (select count(*)::integer from load_results where rows_returned > 0),
  12,
  'NFR-P3: every measured search finds partners in the seeded network (no search is timed on an empty answer)'
);

-- At this size the searches still return listed, visible partners only, and a full first page with a cursor.
delete from private.rate_limit_hits;
create temp table load_page as
  select * from public.search_partners('recruitment', p_destination => 'DE', p_key => repeat('b', 64));
select is((select count(*)::integer from load_page), 20, 'NFR-P3: a broad search fills its first page of 20');
select is((select count(*)::integer from load_page where next_cursor is not null), 1, 'NFR-P3: the first page ends with a cursor');
select is(
  (select count(*)::integer from load_page p join public.organizations o on o.id = p.id
   where o.listed_at is null or o.moderation_state <> 'visible' or o.review_status = 'declined'),
  0,
  'NFR-P3: no unlisted, declined or hidden partner reaches the results at 5,000 partners'
);
select is(
  (select count(*)::integer from stats.partner_searches) - :searches_before,
  57,
  'NFR-P3: the timed searches are logged as real searches are: the cursor read, 11 first-page searches x 5 runs and the page above'
);

select * from finish();
rollback;
