begin;
select plan(21);

-- Find Partners at 5,000 partner organisations (V78, NFR-P3), the light version of scripts/load/find-partners.mjs that
-- runs in CI: the same seeded network and the same typical searches, one warm-up and five timed runs each instead of
-- fifty, and without the captured plans. The strict check (95th percentile under 100 ms over 50 runs, the database share
-- of the 500 ms target) is the script's; on a shared CI runner five runs give no stable 95th percentile, so this file
-- holds the median under 100 ms and every run under 500 ms, and checks the plan shape, which does not depend on the
-- speed of the machine: the destination and occupation lookups that search_partners makes and the listed partners they
-- narrow to are read through indexes, with no sequential scan (docs/perf/release-2a.md). The
-- searches must also still skip every partner that is not listed and visible.

\ir find_partners_load_fixture.inc

update private.settings set value = 'true' where key = 'release_partner_directories';

select pg_temp.seed_find_partners(5000, 1000);
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
  (select r.p50_ms < 100 and r.max_ms < 500 from load_results r where r.label = c.label),
  format('NFR-P3: %s answers within 100 ms at the median and never takes 500 ms', c.label)
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
  68,
  'NFR-P3: the searches are logged as real searches are: the cursor read, 11 first-page searches x (1 warm-up + 5 runs) and the page above'
);

-- The plan shape, independent of the speed of the machine.
create function pg_temp.plan_of(p_sql text) returns text
language plpgsql as $$
declare
  v_plan json;
begin
  execute 'explain (format json) ' || p_sql into v_plan;
  return v_plan::text;
end;
$$;

-- A lookup passes when its plan reads the table through one of its indexes and scans no table sequentially. The index
-- itself is the planner's choice and moves with the table's history: on a fresh table (CI) the destination lookup takes
-- organization_geographies_scope_country_idx, on one with dead rows from earlier runs organization_geographies_country_idx;
-- both serve the search.
create function pg_temp.uses_index(p_plan text, p_index_prefix text) returns boolean
language sql as $$
  select p_plan not like '%"Node Type": "Seq Scan"%' and p_plan like '%"Index Name": "' || p_index_prefix || '%'
$$;

select ok(
  pg_temp.uses_index(pg_temp.plan_of($$select g.organization_id from public.organization_geographies g
                    where g.scope = 'serves_market' and g.country_code = 'DE'$$), 'organization_geographies_'),
  'NFR-P3: the destination lookup of a search reads organization_geographies through an index at 5,000 partners'
);
select ok(
  pg_temp.uses_index(pg_temp.plan_of($$select oo.organization_id from public.organization_occupations oo
                    where oo.occupation_id = '7212'$$), 'organization_occupations_'),
  'NFR-P3: the occupation lookup of a search reads organization_occupations through an index at 5,000 partners'
);
select ok(
  pg_temp.uses_index(pg_temp.plan_of($$select o.id from public.organizations o
                    where o.type = 'recruitment_company' and o.listed_at is not null and o.review_status <> 'declined'
                      and o.status = 'active'
                      and o.id in (select g.organization_id from public.organization_geographies g
                                   where g.scope = 'serves_market' and g.country_code = 'JP')
                      and o.id in (select oo.organization_id from public.organization_occupations oo
                                   where oo.occupation_id = '2221')$$), 'organizations_'),
  'NFR-P3: the listed partners a destination and an occupation narrow to are read through an index, with no sequential scan'
);

select * from finish();
rollback;
