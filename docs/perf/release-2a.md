# Performance: Find Partners at 5,000 partner organisations (release 2a)

NFR-P3 (network search response time): 95 % of Find Partners renders within 500 ms server time at 5,000 partner organisations, shown with a load test and query plans. This page records the load test of V78 for the two directories (`search_partners` with kind `recruitment` and `staffing`) and the available-workforce search (`search_available_workforce`). The job order board (2,000 open requirements) is V79 and Find Workers (100,000 worker profiles) is V80.

## Method

- **Data.** `supabase/tests/database/find_partners_load_fixture.inc` seeds, in a transaction that is rolled back, 5,000 listed partner organisations (7 in 10 recruitment companies, 3 in 10 staffing companies; one in a hundred hidden by moderation) and 1,000 unlisted ones (onboarding, pending review, information requested, declined). Each partner is based in and sources from one to four of 25 labour-sending countries, recruits for one to six of 30 destinations (Germany, the Gulf states and the United Kingdom weighted up), lists 3 to 15 occupations (mostly from 40 common ISCO-08 unit groups, the rest from the whole list), one to three industries, one to four languages, staffing types, a recruitment type and a workforce size; six in ten keep one to four availability listings confirmed in the last 90 days, so about a third of the listings are stale. That is about 50,400 occupation rows, 39,000 geography rows and 10,300 listings (3,400 of them stale). `setseed` makes every run seed the same network.
- **Searches.** Twelve typical searches (table below): a visitor (anonymous, with a visitor key, as the web tier calls them) on both directories with no filter, a destination, a destination and an occupation, five filters, a rare combination and the second page through the cursor; a signed-in employer with the advanced filters (capacity, timeframe, two source countries) and two available-workforce searches. Each runs as the API role through the same function as the page, rate limit and search log included; the rate-limit window is emptied before each run so the limit is not what is measured.
- **Measure.** The server time of each call in the database (`clock_timestamp` around the call), 50 runs per search after one untimed warm-up run, after `analyze` of the seeded tables. The plans are the `EXPLAIN ANALYZE` output of the main statement of each function, taken with `auto_explain` (nested statements) on one more run.
- **Budget.** The page adds its own rendering and the round trip to PostgREST to the database time, so the database is held to 100 ms at the 95th percentile, a fifth of the 500 ms NFR-P3 target. The script and the CI test fail above it.

## How to run it

```sh
npm run db:start                                   # the local stack
node scripts/load/find-partners.mjs --plans        # 50 runs per search, with plans; exit 1 above the budget
node scripts/load/find-partners.mjs --runs 200     # more runs, no plans
DATABASE_URL=postgres://... node scripts/load/find-partners.mjs   # a staging copy (never production)
```

CI runs the light version on every change: pgTAP `supabase/tests/database/155_find_partners_load.test.sql` (part of `npm run db:test`, about 5 seconds) seeds the same network, runs each search once untimed and five times timed, and fails when a search's median is 100 ms or more or one run takes 500 ms (five runs on a shared runner give no stable 95th percentile, so the strict 95th-percentile budget stays with the script), when the plan shape changes (the destination and occupation lookups leave `organization_geographies_country_idx` and `organization_occupations_occupation_idx`, or the listed partners they narrow to are no longer read through `organizations_listed_partners_idx`), when a search finds nothing, or when an unlisted, declined or hidden partner reaches the results.

## Results (V78, 27 October 2026)

Local stack: PostgreSQL 17.11 in Docker (8 CPUs, 8 GB) on an Apple M1 Pro, database freshly reset, 50 runs per search. This run predates the warm-up: the first, cold run of each search is among the 50, so the maximum column is an upper bound.

| Search | Rows | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| recruitment: no filter | 20 | 5.1 | 5.6 | 6.1 |
| recruitment: destination | 20 | 6.3 | 7.2 | 7.2 |
| recruitment: destination, occupation | 20 | 7.6 | 8.6 | 9 |
| recruitment: five filters | 20 | 9.3 | 10.7 | 10.9 |
| recruitment: rare destination and occupation | 20 | 6.8 | 7.9 | 8.3 |
| recruitment: destination, second page | 20 | 6.3 | 7.3 | 8.4 |
| recruitment: advanced (capacity, timeframe, two sources) | 20 | 12.8 | 16.1 | 18.3 |
| staffing: no filter | 20 | 4.9 | 5.6 | 6.1 |
| staffing: destination, staffing type | 20 | 7.1 | 8.5 | 9.7 |
| staffing: four filters | 20 | 6.9 | 7 | 8.2 |
| available workforce: 50 welders, Germany, 60 days | 20 | 2.1 | 2.3 | 3.9 |
| available workforce: 200 care workers, UAE, 90 days | 12 | 2 | 2 | 2.3 |

Every search is within the database budget by a wide margin: the slowest 95th percentile is 16.1 ms (the advanced filters) against 100 ms, and 500 ms for the whole render. The page itself was not measured under load here (see the operational check below).

What the plans show:

- A search with a destination or an occupation starts from the listed-partner index (`organizations_listed_partners_idx`) and checks the destination and the occupation with hashed sub-plans over `organization_geographies_country_idx` and `organization_occupations_occupation_idx`; the 20 rows of a page then read their countries, occupations and listings through the primary keys and `workforce_availability_listing_key` (20 loops each).
- A search with no filter reads `organizations` sequentially (3,450 recruitment rows in 1.6 ms): at this size almost every partner matches, so the sequential scan is the right plan. It is the plan to watch as the network grows past NFR-P5's 2,000 and NFR-P3's 5,000 partners.
- The staffing directory reads `organization_service_types` sequentially for the "also offers staffing" test (856 rows, 0.3 ms); an index on `(service, organization_id)` exists and the planner prefers the scan at this size.
- The available-workforce search starts from `workforce_availability_search_idx` on the occupation and checks the destination with an index-only scan of `organization_geographies_scope_country_idx`.
- Sorting is a top-N heap sort of the matching partners (at most a few thousand rows, 34 kB); nothing spills to disk.

## Operational check at the HTTP level

No HTTP load tool is installed in the project (and none is added: no new dependencies), so the render time of the pages under load is checked by hand on staging before release 2a goes live (`docs/runbooks/release-2a-go-live.md`): with staging seeded to 5,000 listed partners, request `/en/partners/recruitment?destination=DE&occupation=7212`, `/en/partners/staffing?destination=DE` and a partner profile 100 times each from a host near the web tier (for example `curl -s -o /dev/null -w '%{time_starttransfer}\n'` in a loop, ten in parallel) and record the 95th percentile of the time to first byte. It must be under 500 ms. Record the date, the person and the figures in the release record.

## Query plans

The main statement of each search on the 51st run, from `node scripts/load/find-partners.mjs --plans` (`auto_explain`, `log_analyze`, `log_buffers`, nested statements; the query text is left out, it is the body of the function in `supabase/migrations/20261203100000_staffing_directory.sql` and `20261203100100_available_workforce_search.sql`).
### recruitment: no filter

```
duration: 6.940 ms  plan:
Sort  (cost=2394.33..2394.34 rows=7 width=333) (actual time=6.925..6.931 rows=20 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 40kB
  Buffers: shared hit=1954
  CTE numbered
    ->  WindowAgg  (cost=1496.35..1496.80 rows=21 width=120) (actual time=3.412..3.421 rows=21 loops=1)
          Buffers: shared hit=1203
          ->  Sort  (cost=1496.32..1496.38 rows=21 width=112) (actual time=3.410..3.412 rows=21 loops=1)
                Sort Key: p.matched_count DESC, p.updated_at DESC, p.id
                Sort Method: quicksort  Memory: 27kB
                Buffers: shared hit=1203
                ->  Subquery Scan on p  (cost=1321.19..1495.86 rows=21 width=112) (actual time=3.396..3.406 rows=21 loops=1)
                      Buffers: shared hit=1203
                      ->  Limit  (cost=1321.19..1495.86 rows=21 width=112) (actual time=3.396..3.404 rows=21 loops=1)
                            Buffers: shared hit=1203
                            ->  Result  (cost=1321.19..28985.20 rows=3326 width=112) (actual time=3.396..3.402 rows=21 loops=1)
                                  Buffers: shared hit=1203
                                  ->  Sort  (cost=1321.19..1329.51 rows=3326 width=111) (actual time=2.963..2.964 rows=21 loops=1)
                                        Sort Key: (COALESCE(o.workforce_profile_updated_at, o.listed_at)) DESC, o.id
                                        Sort Method: top-N heapsort  Memory: 29kB
                                        Buffers: shared hit=1045
                                        ->  Nested Loop Left Join  (cost=0.00..1231.52 rows=3326 width=111) (actual time=0.805..2.441 rows=3450 loops=1)
                                              Buffers: shared hit=1045
                                              ->  Seq Scan on organizations o  (cost=0.00..1165.00 rows=3326 width=75) (actual time=0.803..1.631 rows=3450 loops=1)
                                                    Filter: ((listed_at IS NOT NULL) AND (review_status <> 'declined'::public.partner_review_status) AND (type = 'recruitment_company'::public.organization_type) AND (status = 'active'::public.organization_status) AND (moderation_state = 'visible'::public.job_moderation_state))
                                                    Rows Removed by Filter: 2551
                                                    Buffers: shared hit=1045
                                              ->  Limit  (cost=0.00..0.00 rows=1 width=1) (actual time=0.000..0.000 rows=0 loops=3450)
                                                    ->  Result  (cost=0.00..0.00 rows=0 width=1) (actual time=0.000..0.000 rows=0 loops=3450)
                                                          One-Time Filter: false
                                  SubPlan 2
                                    ->  Seq Scan on organization_service_types st  (cost=0.00..224.74 rows=856 width=16) (actual time=0.283..0.343 rows=856 loops=1)
                                          Filter: (service = 'staffing'::public.partner_service_type)
                                          Rows Removed by Filter: 4483
                                          Buffers: shared hit=158
  InitPlan 9
    ->  CTE Scan on numbered x  (cost=0.00..0.47 rows=7 width=0) (actual time=0.003..0.003 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  CTE Scan on numbered r  (cost=0.00..897.36 rows=7 width=333) (actual time=3.622..6.917 rows=20 loops=1)
        Filter: (n <= 20)
        Rows Removed by Filter: 1
        Buffers: shared hit=1954
        SubPlan 4
          ->  Aggregate  (cost=21.29..21.30 rows=1 width=32) (actual time=0.042..0.043 rows=1 loops=20)
                Buffers: shared hit=121
                ->  Sort  (cost=21.26..21.27 rows=3 width=13) (actual time=0.037..0.038 rows=4 loops=20)
                      Sort Key: c.name, c.code
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=121
                      ->  Hash Join  (cost=16.07..21.24 rows=3 width=13) (actual time=0.014..0.035 rows=4 loops=20)
                            Hash Cond: (c.code = g.country_code)
                            Buffers: shared hit=121
                            ->  Seq Scan on countries c  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.015 rows=250 loops=20)
                                  Buffers: shared hit=40
                            ->  Hash  (cost=16.03..16.03 rows=3 width=3) (actual time=0.006..0.006 rows=4 loops=20)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=81
                                  ->  Bitmap Heap Scan on organization_geographies g  (cost=4.45..16.03 rows=3 width=3) (actual time=0.004..0.005 rows=4 loops=20)
                                        Recheck Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                        Heap Blocks: exact=21
                                        Buffers: shared hit=81
                                        ->  Bitmap Index Scan on organization_geographies_pkey  (cost=0.00..4.45 rows=3 width=0) (actual time=0.003..0.003 rows=4 loops=20)
                                              Index Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                              Buffers: shared hit=60
        SubPlan 5
          ->  Aggregate  (cost=58.73..58.74 rows=1 width=32) (actual time=0.085..0.085 rows=1 loops=20)
                Buffers: shared hit=398
                ->  Limit  (cost=58.69..58.70 rows=5 width=46) (actual time=0.079..0.080 rows=5 loops=20)
                      Buffers: shared hit=398
                      ->  Sort  (cost=58.69..58.71 rows=8 width=46) (actual time=0.079..0.079 rows=5 loops=20)
                            Sort Key: (COALESCE(sum(a.available), '0'::bigint)) DESC, oc.label, oc.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=398
                            ->  GroupAggregate  (cost=46.84..58.57 rows=8 width=46) (actual time=0.073..0.076 rows=8 loops=20)
                                  Group Key: oc.code
                                  Buffers: shared hit=398
                                  ->  Merge Left Join  (cost=46.84..58.45 rows=8 width=42) (actual time=0.072..0.074 rows=8 loops=20)
                                        Merge Cond: (oo.occupation_id = a.occupation_id)
                                        Buffers: shared hit=398
                                        ->  Sort  (cost=46.55..46.57 rows=8 width=59) (actual time=0.068..0.069 rows=8 loops=20)
                                              Sort Key: oo.occupation_id
                                              Sort Method: quicksort  Memory: 25kB
                                              Buffers: shared hit=343
                                              ->  Hash Join  (cost=34.91..46.43 rows=8 width=59) (actual time=0.028..0.063 rows=8 loops=20)
                                                    Hash Cond: (oc.code = oo.occupation_id)
                                                    Buffers: shared hit=343
                                                    ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.025 rows=436 loops=20)
                                                          Buffers: shared hit=120
                                                    ->  Hash  (cost=34.81..34.81 rows=8 width=21) (actual time=0.013..0.013 rows=8 loops=20)
                                                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                          Buffers: shared hit=223
                                                          ->  Bitmap Heap Scan on organization_occupations oo  (cost=4.48..34.81 rows=8 width=21) (actual time=0.006..0.012 rows=8 loops=20)
                                                                Recheck Cond: (organization_id = r.id)
                                                                Heap Blocks: exact=163
                                                                Buffers: shared hit=223
                                                                ->  Bitmap Index Scan on organization_occupations_pkey  (cost=0.00..4.47 rows=8 width=0) (actual time=0.004..0.004 rows=8 loops=20)
                                                                      Index Cond: (organization_id = r.id)
                                                                      Buffers: shared hit=60
                                        ->  Index Scan using workforce_availability_listing_key on workforce_availability a  (cost=0.29..11.85 rows=2 width=25) (actual time=0.004..0.004 rows=1 loops=20)
                                              Index Cond: (organization_id = r.id)
                                              Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                              Rows Removed by Filter: 1
                                              Buffers: shared hit=55
        SubPlan 6
          ->  Aggregate  (cost=11.68..11.69 rows=1 width=32) (actual time=0.004..0.004 rows=1 loops=20)
                Buffers: shared hit=48
                ->  Sort  (cost=11.66..11.67 rows=2 width=4) (actual time=0.003..0.003 rows=0 loops=20)
                      Sort Key: st_1.service
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=48
                      ->  Bitmap Heap Scan on organization_service_types st_1  (cost=4.30..11.65 rows=2 width=4) (actual time=0.002..0.002 rows=0 loops=20)
                            Recheck Cond: (organization_id = r.id)
                            Filter: (service <> 'staffing'::public.partner_service_type)
                            Rows Removed by Filter: 0
                            Heap Blocks: exact=8
                            Buffers: shared hit=48
                            ->  Bitmap Index Scan on organization_service_types_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.002..0.002 rows=0 loops=20)
                                  Index Cond: (organization_id = r.id)
                                  Buffers: shared hit=40
        SubPlan 7
          ->  Aggregate  (cost=24.51..24.52 rows=1 width=32) (actual time=0.038..0.038 rows=1 loops=20)
                Buffers: shared hit=129
                ->  Limit  (cost=24.49..24.50 rows=2 width=54) (actual time=0.034..0.034 rows=1 loops=20)
                      Buffers: shared hit=129
                      ->  Sort  (cost=24.49..24.50 rows=2 width=54) (actual time=0.034..0.034 rows=1 loops=20)
                            Sort Key: (sum(a_1.available)) DESC, oc_1.label, oc_1.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=129
                            ->  GroupAggregate  (cost=24.44..24.48 rows=2 width=54) (actual time=0.033..0.033 rows=1 loops=20)
                                  Group Key: oc_1.code
                                  Buffers: shared hit=129
                                  ->  Sort  (cost=24.44..24.45 rows=2 width=50) (actual time=0.033..0.033 rows=1 loops=20)
                                        Sort Key: oc_1.code
                                        Sort Method: quicksort  Memory: 25kB
                                        Buffers: shared hit=129
                                        ->  Hash Join  (cost=11.87..24.43 rows=2 width=50) (actual time=0.020..0.031 rows=1 loops=20)
                                              Hash Cond: (oc_1.code = a_1.occupation_id)
                                              Buffers: shared hit=129
                                              ->  Seq Scan on occupations oc_1  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.023 rows=403 loops=13)
                                                    Buffers: shared hit=74
                                              ->  Hash  (cost=11.85..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=1 loops=20)
                                                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                    Buffers: shared hit=55
                                                    ->  Index Scan using workforce_availability_listing_key on workforce_availability a_1  (cost=0.29..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=1 loops=20)
                                                          Index Cond: (organization_id = r.id)
                                                          Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                                          Rows Removed by Filter: 1
                                                          Buffers: shared hit=55
        SubPlan 8
          ->  Aggregate  (cost=11.85..11.86 rows=1 width=8) (actual time=0.003..0.003 rows=1 loops=20)
                Buffers: shared hit=55
                ->  Index Scan using workforce_availability_source_idx on workforce_availability a_2  (cost=0.29..11.85 rows=2 width=8) (actual time=0.002..0.003 rows=1 loops=20)
                      Index Cond: (organization_id = r.id)
                      Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                      Rows Removed by Filter: 1
                      Buffers: shared hit=55
```

### recruitment: destination

```
duration: 7.294 ms  plan:
Sort  (cost=31008.54..31008.55 rows=7 width=333) (actual time=7.278..7.284 rows=20 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 42kB
  Buffers: shared hit=2081
  CTE numbered
    ->  WindowAgg  (cost=30110.56..30111.01 rows=21 width=120) (actual time=3.749..3.758 rows=21 loops=1)
          Buffers: shared hit=1304
          ->  Sort  (cost=30110.53..30110.59 rows=21 width=112) (actual time=3.747..3.750 rows=21 loops=1)
                Sort Key: p.matched_count DESC, p.updated_at DESC, p.id
                Sort Method: quicksort  Memory: 27kB
                Buffers: shared hit=1304
                ->  Subquery Scan on p  (cost=29935.41..30110.07 rows=21 width=112) (actual time=3.732..3.744 rows=21 loops=1)
                      Buffers: shared hit=1304
                      ->  Limit  (cost=29935.41..30110.07 rows=21 width=112) (actual time=3.731..3.739 rows=21 loops=1)
                            Buffers: shared hit=1304
                            ->  Result  (cost=29935.41..43767.41 rows=1663 width=112) (actual time=3.731..3.737 rows=21 loops=1)
                                  Buffers: shared hit=1304
                                  ->  Sort  (cost=29935.41..29939.56 rows=1663 width=111) (actual time=3.338..3.340 rows=21 loops=1)
                                        Sort Key: (COALESCE(o.workforce_profile_updated_at, o.listed_at)) DESC, o.id
                                        Sort Method: top-N heapsort  Memory: 34kB
                                        Buffers: shared hit=1146
                                        ->  Nested Loop Left Join  (cost=445.85..29890.57 rows=1663 width=111) (actual time=2.175..3.143 rows=1242 loops=1)
                                              Buffers: shared hit=1146
                                              ->  Bitmap Heap Scan on organizations o  (cost=445.85..29857.31 rows=1663 width=75) (actual time=2.171..2.831 rows=1242 loops=1)
                                                    Recheck Cond: ((type = 'recruitment_company'::public.organization_type) AND (listed_at IS NOT NULL) AND (review_status <> 'declined'::public.partner_review_status) AND (status = 'active'::public.organization_status))
                                                    Filter: ((moderation_state = 'visible'::public.job_moderation_state) AND (ANY (id = (hashed SubPlan 4).col1)))
                                                    Rows Removed by Filter: 2258
                                                    Heap Blocks: exact=478
                                                    Buffers: shared hit=1146
                                                    ->  Bitmap Index Scan on organizations_listed_partners_idx  (cost=0.00..445.44 rows=3354 width=0) (actual time=0.466..0.466 rows=12599 loops=1)
                                                          Index Cond: (type = 'recruitment_company'::public.organization_type)
                                                          Buffers: shared hit=85
                                                    SubPlan 4
                                                      ->  Bitmap Heap Scan on organization_geographies g  (cost=65.08..1254.63 rows=1094 width=16) (actual time=0.817..1.161 rows=2225 loops=1)
                                                            Recheck Cond: (country_code = 'DE'::text)
                                                            Filter: (scope = 'serves_market'::public.geography_scope)
                                                            Heap Blocks: exact=575
                                                            Buffers: shared hit=583
                                                            ->  Bitmap Index Scan on organization_geographies_country_idx  (cost=0.00..64.81 rows=2202 width=0) (actual time=0.136..0.136 rows=8900 loops=1)
                                                                  Index Cond: (country_code = 'DE'::text)
                                                                  Buffers: shared hit=8
                                              ->  Limit  (cost=0.00..0.00 rows=1 width=1) (actual time=0.000..0.000 rows=0 loops=1242)
                                                    ->  Result  (cost=0.00..0.00 rows=0 width=1) (actual time=0.000..0.000 rows=0 loops=1242)
                                                          One-Time Filter: false
                                  SubPlan 2
                                    ->  Seq Scan on organization_service_types st  (cost=0.00..224.74 rows=856 width=16) (actual time=0.248..0.305 rows=856 loops=1)
                                          Filter: (service = 'staffing'::public.partner_service_type)
                                          Rows Removed by Filter: 4483
                                          Buffers: shared hit=158
  InitPlan 11
    ->  CTE Scan on numbered x  (cost=0.00..0.47 rows=7 width=0) (actual time=0.002..0.003 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  CTE Scan on numbered r  (cost=0.00..897.36 rows=7 width=333) (actual time=3.933..7.270 rows=20 loops=1)
        Filter: (n <= 20)
        Rows Removed by Filter: 1
        Buffers: shared hit=2081
        SubPlan 6
          ->  Aggregate  (cost=21.29..21.30 rows=1 width=32) (actual time=0.042..0.042 rows=1 loops=20)
                Buffers: shared hit=120
                ->  Sort  (cost=21.26..21.27 rows=3 width=13) (actual time=0.037..0.037 rows=4 loops=20)
                      Sort Key: c.name, c.code
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=120
                      ->  Hash Join  (cost=16.07..21.24 rows=3 width=13) (actual time=0.011..0.034 rows=4 loops=20)
                            Hash Cond: (c.code = g_1.country_code)
                            Buffers: shared hit=120
                            ->  Seq Scan on countries c  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.014 rows=250 loops=20)
                                  Buffers: shared hit=40
                            ->  Hash  (cost=16.03..16.03 rows=3 width=3) (actual time=0.005..0.005 rows=4 loops=20)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=80
                                  ->  Bitmap Heap Scan on organization_geographies g_1  (cost=4.45..16.03 rows=3 width=3) (actual time=0.004..0.004 rows=4 loops=20)
                                        Recheck Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                        Heap Blocks: exact=20
                                        Buffers: shared hit=80
                                        ->  Bitmap Index Scan on organization_geographies_pkey  (cost=0.00..4.45 rows=3 width=0) (actual time=0.003..0.003 rows=4 loops=20)
                                              Index Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                              Buffers: shared hit=60
        SubPlan 7
          ->  Aggregate  (cost=58.73..58.74 rows=1 width=32) (actual time=0.083..0.083 rows=1 loops=20)
                Buffers: shared hit=411
                ->  Limit  (cost=58.69..58.70 rows=5 width=46) (actual time=0.077..0.077 rows=5 loops=20)
                      Buffers: shared hit=411
                      ->  Sort  (cost=58.69..58.71 rows=8 width=46) (actual time=0.076..0.077 rows=5 loops=20)
                            Sort Key: (COALESCE(sum(a.available), '0'::bigint)) DESC, oc.label, oc.code
                            Sort Method: top-N heapsort  Memory: 25kB
                            Buffers: shared hit=411
                            ->  GroupAggregate  (cost=46.84..58.57 rows=8 width=46) (actual time=0.070..0.073 rows=9 loops=20)
                                  Group Key: oc.code
                                  Buffers: shared hit=411
                                  ->  Merge Left Join  (cost=46.84..58.45 rows=8 width=42) (actual time=0.069..0.071 rows=9 loops=20)
                                        Merge Cond: (oo.occupation_id = a.occupation_id)
                                        Buffers: shared hit=411
                                        ->  Sort  (cost=46.55..46.57 rows=8 width=59) (actual time=0.065..0.065 rows=9 loops=20)
                                              Sort Key: oo.occupation_id
                                              Sort Method: quicksort  Memory: 25kB
                                              Buffers: shared hit=354
                                              ->  Hash Join  (cost=34.91..46.43 rows=8 width=59) (actual time=0.024..0.062 rows=9 loops=20)
                                                    Hash Cond: (oc.code = oo.occupation_id)
                                                    Buffers: shared hit=354
                                                    ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.025 rows=436 loops=20)
                                                          Buffers: shared hit=120
                                                    ->  Hash  (cost=34.81..34.81 rows=8 width=21) (actual time=0.012..0.012 rows=9 loops=20)
                                                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                          Buffers: shared hit=234
                                                          ->  Bitmap Heap Scan on organization_occupations oo  (cost=4.48..34.81 rows=8 width=21) (actual time=0.005..0.010 rows=9 loops=20)
                                                                Recheck Cond: (organization_id = r.id)
                                                                Heap Blocks: exact=174
                                                                Buffers: shared hit=234
                                                                ->  Bitmap Index Scan on organization_occupations_pkey  (cost=0.00..4.47 rows=8 width=0) (actual time=0.003..0.003 rows=9 loops=20)
                                                                      Index Cond: (organization_id = r.id)
                                                                      Buffers: shared hit=60
                                        ->  Index Scan using workforce_availability_listing_key on workforce_availability a  (cost=0.29..11.85 rows=2 width=25) (actual time=0.003..0.003 rows=1 loops=20)
                                              Index Cond: (organization_id = r.id)
                                              Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                              Rows Removed by Filter: 1
                                              Buffers: shared hit=57
        SubPlan 8
          ->  Aggregate  (cost=11.68..11.69 rows=1 width=32) (actual time=0.003..0.003 rows=1 loops=20)
                Buffers: shared hit=46
                ->  Sort  (cost=11.66..11.67 rows=2 width=4) (actual time=0.003..0.003 rows=0 loops=20)
                      Sort Key: st_1.service
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=46
                      ->  Bitmap Heap Scan on organization_service_types st_1  (cost=4.30..11.65 rows=2 width=4) (actual time=0.002..0.002 rows=0 loops=20)
                            Recheck Cond: (organization_id = r.id)
                            Filter: (service <> 'staffing'::public.partner_service_type)
                            Rows Removed by Filter: 0
                            Heap Blocks: exact=6
                            Buffers: shared hit=46
                            ->  Bitmap Index Scan on organization_service_types_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.002..0.002 rows=0 loops=20)
                                  Index Cond: (organization_id = r.id)
                                  Buffers: shared hit=40
        SubPlan 9
          ->  Aggregate  (cost=24.51..24.52 rows=1 width=32) (actual time=0.043..0.043 rows=1 loops=20)
                Buffers: shared hit=143
                ->  Limit  (cost=24.49..24.50 rows=2 width=54) (actual time=0.039..0.039 rows=1 loops=20)
                      Buffers: shared hit=143
                      ->  Sort  (cost=24.49..24.50 rows=2 width=54) (actual time=0.039..0.039 rows=1 loops=20)
                            Sort Key: (sum(a_1.available)) DESC, oc_1.label, oc_1.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=143
                            ->  GroupAggregate  (cost=24.44..24.48 rows=2 width=54) (actual time=0.038..0.038 rows=1 loops=20)
                                  Group Key: oc_1.code
                                  Buffers: shared hit=143
                                  ->  Sort  (cost=24.44..24.45 rows=2 width=50) (actual time=0.037..0.037 rows=1 loops=20)
                                        Sort Key: oc_1.code
                                        Sort Method: quicksort  Memory: 25kB
                                        Buffers: shared hit=143
                                        ->  Hash Join  (cost=11.87..24.43 rows=2 width=50) (actual time=0.021..0.036 rows=1 loops=20)
                                              Hash Cond: (oc_1.code = a_1.occupation_id)
                                              Buffers: shared hit=143
                                              ->  Seq Scan on occupations oc_1  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.024 rows=407 loops=15)
                                                    Buffers: shared hit=86
                                              ->  Hash  (cost=11.85..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=1 loops=20)
                                                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                    Buffers: shared hit=57
                                                    ->  Index Scan using workforce_availability_listing_key on workforce_availability a_1  (cost=0.29..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=1 loops=20)
                                                          Index Cond: (organization_id = r.id)
                                                          Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                                          Rows Removed by Filter: 1
                                                          Buffers: shared hit=57
        SubPlan 10
          ->  Aggregate  (cost=11.85..11.86 rows=1 width=8) (actual time=0.003..0.003 rows=1 loops=20)
                Buffers: shared hit=57
                ->  Index Scan using workforce_availability_source_idx on workforce_availability a_2  (cost=0.29..11.85 rows=2 width=8) (actual time=0.002..0.002 rows=1 loops=20)
                      Index Cond: (organization_id = r.id)
                      Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                      Rows Removed by Filter: 1
                      Buffers: shared hit=57
```

### recruitment: destination, occupation

```
duration: 8.839 ms  plan:
Sort  (cost=59260.29..59260.31 rows=7 width=333) (actual time=8.795..8.802 rows=20 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 43kB
  Buffers: shared hit=3632
  CTE numbered
    ->  WindowAgg  (cost=58362.31..58362.76 rows=21 width=120) (actual time=4.936..4.945 rows=21 loops=1)
          Buffers: shared hit=2810
          ->  Sort  (cost=58362.29..58362.34 rows=21 width=112) (actual time=4.934..4.937 rows=21 loops=1)
                Sort Key: p.matched_count DESC, p.updated_at DESC, p.id
                Sort Method: quicksort  Memory: 28kB
                Buffers: shared hit=2810
                ->  Subquery Scan on p  (cost=58187.16..58361.83 rows=21 width=112) (actual time=4.920..4.931 rows=21 loops=1)
                      Buffers: shared hit=2810
                      ->  Limit  (cost=58187.16..58361.83 rows=21 width=112) (actual time=4.920..4.928 rows=21 loops=1)
                            Buffers: shared hit=2810
                            ->  Result  (cost=58187.16..65107.32 rows=832 width=112) (actual time=4.920..4.926 rows=21 loops=1)
                                  Buffers: shared hit=2810
                                  ->  Sort  (cost=58187.16..58189.24 rows=832 width=111) (actual time=4.533..4.536 rows=21 loops=1)
                                        Sort Key: (COALESCE(o.workforce_profile_updated_at, o.listed_at)) DESC, o.id
                                        Sort Method: top-N heapsort  Memory: 34kB
                                        Buffers: shared hit=2652
                                        ->  Nested Loop Left Join  (cost=445.65..58164.73 rows=832 width=111) (actual time=3.705..4.476 rows=337 loops=1)
                                              Buffers: shared hit=2652
                                              ->  Bitmap Heap Scan on organizations o  (cost=445.65..58148.09 rows=832 width=75) (actual time=3.702..4.383 rows=337 loops=1)
                                                    Recheck Cond: ((type = 'recruitment_company'::public.organization_type) AND (listed_at IS NOT NULL) AND (review_status <> 'declined'::public.partner_review_status) AND (status = 'active'::public.organization_status))
                                                    Filter: ((moderation_state = 'visible'::public.job_moderation_state) AND (ANY (id = (hashed SubPlan 6).col1)) AND (ANY (id = (hashed SubPlan 4).col1)))
                                                    Rows Removed by Filter: 3163
                                                    Heap Blocks: exact=478
                                                    Buffers: shared hit=2652
                                                    ->  Bitmap Index Scan on organizations_listed_partners_idx  (cost=0.00..445.44 rows=3354 width=0) (actual time=0.395..0.395 rows=12599 loops=1)
                                                          Index Cond: (type = 'recruitment_company'::public.organization_type)
                                                          Buffers: shared hit=85
                                                    SubPlan 6
                                                      ->  Bitmap Heap Scan on organization_occupations oo  (cost=300.97..1871.14 rows=1620 width=16) (actual time=1.302..1.698 rows=1609 loops=1)
                                                            Recheck Cond: (occupation_id = '7212'::text)
                                                            Heap Blocks: exact=1466
                                                            Buffers: shared hit=1506
                                                            ->  Bitmap Index Scan on organization_occupations_occupation_idx  (cost=0.00..300.56 rows=1620 width=0) (actual time=0.323..0.323 rows=6436 loops=1)
                                                                  Index Cond: (occupation_id = '7212'::text)
                                                                  Buffers: shared hit=40
                                                    SubPlan 4
                                                      ->  Bitmap Heap Scan on organization_geographies g  (cost=65.08..1254.63 rows=1094 width=16) (actual time=0.565..0.852 rows=2225 loops=1)
                                                            Recheck Cond: (country_code = 'DE'::text)
                                                            Filter: (scope = 'serves_market'::public.geography_scope)
                                                            Heap Blocks: exact=575
                                                            Buffers: shared hit=583
                                                            ->  Bitmap Index Scan on organization_geographies_country_idx  (cost=0.00..64.81 rows=2202 width=0) (actual time=0.127..0.127 rows=8900 loops=1)
                                                                  Index Cond: (country_code = 'DE'::text)
                                                                  Buffers: shared hit=8
                                              ->  Limit  (cost=0.00..0.00 rows=1 width=1) (actual time=0.000..0.000 rows=0 loops=337)
                                                    ->  Result  (cost=0.00..0.00 rows=0 width=1) (actual time=0.000..0.000 rows=0 loops=337)
                                                          One-Time Filter: false
                                  SubPlan 2
                                    ->  Seq Scan on organization_service_types st  (cost=0.00..224.74 rows=856 width=16) (actual time=0.240..0.297 rows=856 loops=1)
                                          Filter: (service = 'staffing'::public.partner_service_type)
                                          Rows Removed by Filter: 4483
                                          Buffers: shared hit=158
  InitPlan 13
    ->  CTE Scan on numbered x  (cost=0.00..0.47 rows=7 width=0) (actual time=0.002..0.002 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  CTE Scan on numbered r  (cost=0.00..897.36 rows=7 width=333) (actual time=5.215..8.784 rows=20 loops=1)
        Filter: (n <= 20)
        Rows Removed by Filter: 1
        Buffers: shared hit=3632
        SubPlan 8
          ->  Aggregate  (cost=21.29..21.30 rows=1 width=32) (actual time=0.043..0.043 rows=1 loops=20)
                Buffers: shared hit=120
                ->  Sort  (cost=21.26..21.27 rows=3 width=13) (actual time=0.037..0.037 rows=4 loops=20)
                      Sort Key: c.name, c.code
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=120
                      ->  Hash Join  (cost=16.07..21.24 rows=3 width=13) (actual time=0.010..0.034 rows=4 loops=20)
                            Hash Cond: (c.code = g_1.country_code)
                            Buffers: shared hit=120
                            ->  Seq Scan on countries c  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.014 rows=250 loops=20)
                                  Buffers: shared hit=40
                            ->  Hash  (cost=16.03..16.03 rows=3 width=3) (actual time=0.004..0.004 rows=4 loops=20)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=80
                                  ->  Bitmap Heap Scan on organization_geographies g_1  (cost=4.45..16.03 rows=3 width=3) (actual time=0.003..0.003 rows=4 loops=20)
                                        Recheck Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                        Heap Blocks: exact=20
                                        Buffers: shared hit=80
                                        ->  Bitmap Index Scan on organization_geographies_pkey  (cost=0.00..4.45 rows=3 width=0) (actual time=0.002..0.002 rows=4 loops=20)
                                              Index Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                              Buffers: shared hit=60
        SubPlan 9
          ->  Aggregate  (cost=58.73..58.74 rows=1 width=32) (actual time=0.087..0.087 rows=1 loops=20)
                Buffers: shared hit=436
                ->  Limit  (cost=58.69..58.70 rows=5 width=46) (actual time=0.081..0.081 rows=5 loops=20)
                      Buffers: shared hit=436
                      ->  Sort  (cost=58.69..58.71 rows=8 width=46) (actual time=0.081..0.081 rows=5 loops=20)
                            Sort Key: (COALESCE(sum(a.available), '0'::bigint)) DESC, oc.label, oc.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=436
                            ->  GroupAggregate  (cost=46.84..58.57 rows=8 width=46) (actual time=0.074..0.078 rows=10 loops=20)
                                  Group Key: oc.code
                                  Buffers: shared hit=436
                                  ->  Merge Left Join  (cost=46.84..58.45 rows=8 width=42) (actual time=0.073..0.075 rows=10 loops=20)
                                        Merge Cond: (oo_1.occupation_id = a.occupation_id)
                                        Buffers: shared hit=436
                                        ->  Sort  (cost=46.55..46.57 rows=8 width=59) (actual time=0.069..0.070 rows=10 loops=20)
                                              Sort Key: oo_1.occupation_id
                                              Sort Method: quicksort  Memory: 25kB
                                              Buffers: shared hit=378
                                              ->  Hash Join  (cost=34.91..46.43 rows=8 width=59) (actual time=0.023..0.066 rows=10 loops=20)
                                                    Hash Cond: (oc.code = oo_1.occupation_id)
                                                    Buffers: shared hit=378
                                                    ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.030 rows=436 loops=20)
                                                          Buffers: shared hit=120
                                                    ->  Hash  (cost=34.81..34.81 rows=8 width=21) (actual time=0.011..0.011 rows=10 loops=20)
                                                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                          Buffers: shared hit=258
                                                          ->  Bitmap Heap Scan on organization_occupations oo_1  (cost=4.48..34.81 rows=8 width=21) (actual time=0.005..0.009 rows=10 loops=20)
                                                                Recheck Cond: (organization_id = r.id)
                                                                Heap Blocks: exact=198
                                                                Buffers: shared hit=258
                                                                ->  Bitmap Index Scan on organization_occupations_pkey  (cost=0.00..4.47 rows=8 width=0) (actual time=0.003..0.003 rows=10 loops=20)
                                                                      Index Cond: (organization_id = r.id)
                                                                      Buffers: shared hit=60
                                        ->  Index Scan using workforce_availability_listing_key on workforce_availability a  (cost=0.29..11.85 rows=2 width=25) (actual time=0.003..0.003 rows=2 loops=20)
                                              Index Cond: (organization_id = r.id)
                                              Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                              Rows Removed by Filter: 1
                                              Buffers: shared hit=58
        SubPlan 10
          ->  Aggregate  (cost=11.68..11.69 rows=1 width=32) (actual time=0.004..0.004 rows=1 loops=20)
                Buffers: shared hit=48
                ->  Sort  (cost=11.66..11.67 rows=2 width=4) (actual time=0.004..0.004 rows=0 loops=20)
                      Sort Key: st_1.service
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=48
                      ->  Bitmap Heap Scan on organization_service_types st_1  (cost=4.30..11.65 rows=2 width=4) (actual time=0.003..0.003 rows=0 loops=20)
                            Recheck Cond: (organization_id = r.id)
                            Filter: (service <> 'staffing'::public.partner_service_type)
                            Rows Removed by Filter: 0
                            Heap Blocks: exact=8
                            Buffers: shared hit=48
                            ->  Bitmap Index Scan on organization_service_types_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.002..0.003 rows=1 loops=20)
                                  Index Cond: (organization_id = r.id)
                                  Buffers: shared hit=40
        SubPlan 11
          ->  Aggregate  (cost=24.51..24.52 rows=1 width=32) (actual time=0.052..0.052 rows=1 loops=20)
                Buffers: shared hit=160
                ->  Limit  (cost=24.49..24.50 rows=2 width=54) (actual time=0.048..0.048 rows=2 loops=20)
                      Buffers: shared hit=160
                      ->  Sort  (cost=24.49..24.50 rows=2 width=54) (actual time=0.048..0.048 rows=2 loops=20)
                            Sort Key: (sum(a_1.available)) DESC, oc_1.label, oc_1.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=160
                            ->  GroupAggregate  (cost=24.44..24.48 rows=2 width=54) (actual time=0.047..0.047 rows=2 loops=20)
                                  Group Key: oc_1.code
                                  Buffers: shared hit=160
                                  ->  Sort  (cost=24.44..24.45 rows=2 width=50) (actual time=0.046..0.046 rows=2 loops=20)
                                        Sort Key: oc_1.code
                                        Sort Method: quicksort  Memory: 25kB
                                        Buffers: shared hit=160
                                        ->  Hash Join  (cost=11.87..24.43 rows=2 width=50) (actual time=0.025..0.045 rows=2 loops=20)
                                              Hash Cond: (oc_1.code = a_1.occupation_id)
                                              Buffers: shared hit=160
                                              ->  Seq Scan on occupations oc_1  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.025 rows=436 loops=17)
                                                    Buffers: shared hit=102
                                              ->  Hash  (cost=11.85..11.85 rows=2 width=17) (actual time=0.003..0.003 rows=2 loops=20)
                                                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                    Buffers: shared hit=58
                                                    ->  Index Scan using workforce_availability_listing_key on workforce_availability a_1  (cost=0.29..11.85 rows=2 width=17) (actual time=0.002..0.002 rows=2 loops=20)
                                                          Index Cond: (organization_id = r.id)
                                                          Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                                          Rows Removed by Filter: 1
                                                          Buffers: shared hit=58
        SubPlan 12
          ->  Aggregate  (cost=11.85..11.86 rows=1 width=8) (actual time=0.003..0.003 rows=1 loops=20)
                Buffers: shared hit=58
                ->  Index Scan using workforce_availability_source_idx on workforce_availability a_2  (cost=0.29..11.85 rows=2 width=8) (actual time=0.002..0.003 rows=2 loops=20)
                      Index Cond: (organization_id = r.id)
                      Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                      Rows Removed by Filter: 1
                      Buffers: shared hit=58
```

### recruitment: five filters

```
duration: 10.388 ms  plan:
Sort  (cost=66636.29..66636.30 rows=7 width=333) (actual time=10.366..10.373 rows=20 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 44kB
  Buffers: shared hit=5115
  CTE numbered
    ->  WindowAgg  (cost=65234.46..65738.76 rows=21 width=120) (actual time=6.484..6.518 rows=21 loops=1)
          Buffers: shared hit=4288
          ->  Subquery Scan on p  (cost=65209.24..65738.34 rows=21 width=112) (actual time=6.481..6.507 rows=21 loops=1)
                Buffers: shared hit=4288
                ->  Limit  (cost=65209.24..65738.34 rows=21 width=112) (actual time=6.481..6.504 rows=21 loops=1)
                      Buffers: shared hit=4288
                      ->  Result  (cost=65209.24..86171.48 rows=832 width=112) (actual time=6.480..6.502 rows=21 loops=1)
                            Buffers: shared hit=4288
                            ->  Sort  (cost=65209.24..65211.32 rows=832 width=83) (actual time=5.074..5.077 rows=21 loops=1)
                                  Sort Key: (cardinality(array_remove(ARRAY['destination'::text, 'occupation'::text, CASE WHEN (o.based_in_country = 'PH'::text) THEN 'based_in'::text ELSE NULL::text END, NULL::text, NULL::text, CASE WHEN (ANY (o.id = (hashed SubPlan 6).col1)) THEN 'language'::text ELSE NULL::text END, CASE WHEN (o.recruitment_type = ANY ('{both,international}'::public.recruitment_preference[])) THEN 'recruitment_type'::text ELSE NULL::text END, NULL::text, NULL::text, NULL::text, NULL::text], NULL::text))) DESC, (COALESCE(o.workforce_profile_updated_at, o.listed_at)) DESC, o.id
                                  Sort Method: top-N heapsort  Memory: 29kB
                                  Buffers: shared hit=3717
                                  ->  Nested Loop Left Join  (cost=445.65..65186.81 rows=832 width=83) (actual time=4.243..5.020 rows=190 loops=1)
                                        Buffers: shared hit=3717
                                        ->  Bitmap Heap Scan on organizations o  (cost=445.65..58148.09 rows=832 width=79) (actual time=2.959..3.624 rows=190 loops=1)
                                              Recheck Cond: ((type = 'recruitment_company'::public.organization_type) AND (listed_at IS NOT NULL) AND (review_status <> 'declined'::public.partner_review_status) AND (status = 'active'::public.organization_status))
                                              Filter: ((moderation_state = 'visible'::public.job_moderation_state) AND (ANY (id = (hashed SubPlan 10).col1)) AND (ANY (id = (hashed SubPlan 8).col1)))
                                              Rows Removed by Filter: 3310
                                              Heap Blocks: exact=478
                                              Buffers: shared hit=3304
                                              ->  Bitmap Index Scan on organizations_listed_partners_idx  (cost=0.00..445.44 rows=3354 width=0) (actual time=0.399..0.399 rows=12599 loops=1)
                                                    Index Cond: (type = 'recruitment_company'::public.organization_type)
                                                    Buffers: shared hit=85
                                              SubPlan 10
                                                ->  Bitmap Heap Scan on organization_occupations oo  (cost=296.92..1866.58 rows=1614 width=16) (actual time=1.202..1.568 rows=1586 loops=1)
                                                      Recheck Cond: (occupation_id = '5322'::text)
                                                      Heap Blocks: exact=1473
                                                      Buffers: shared hit=1514
                                                      ->  Bitmap Index Scan on organization_occupations_occupation_idx  (cost=0.00..296.52 rows=1614 width=0) (actual time=0.353..0.353 rows=6344 loops=1)
                                                            Index Cond: (occupation_id = '5322'::text)
                                                            Buffers: shared hit=41
                                              SubPlan 8
                                                ->  Index Only Scan using organization_geographies_scope_country_idx on organization_geographies g  (cost=0.41..959.88 rows=595 width=16) (actual time=0.007..0.365 rows=1207 loops=1)
                                                      Index Cond: ((scope = 'serves_market'::public.geography_scope) AND (country_code = 'AE'::text))
                                                      Heap Fetches: 1207
                                                      Buffers: shared hit=1227
                                        ->  Limit  (cost=0.00..0.00 rows=1 width=1) (actual time=0.000..0.000 rows=0 loops=190)
                                              ->  Result  (cost=0.00..0.00 rows=0 width=1) (actual time=0.000..0.000 rows=0 loops=190)
                                                    One-Time Filter: false
                                        SubPlan 6
                                          ->  Seq Scan on organization_languages l_1  (cost=0.00..588.26 rows=1816 width=16) (actual time=0.390..1.069 rows=1816 loops=1)
                                                Filter: (language_code = 'en'::text)
                                                Rows Removed by Filter: 12205
                                                Buffers: shared hit=413
                            SubPlan 2
                              ->  Seq Scan on organization_service_types st  (cost=0.00..224.74 rows=856 width=16) (actual time=0.238..0.304 rows=856 loops=1)
                                    Filter: (service = 'staffing'::public.partner_service_type)
                                    Rows Removed by Filter: 4483
                                    Buffers: shared hit=158
                            SubPlan 4
                              ->  Seq Scan on organization_languages l  (cost=0.00..588.26 rows=1816 width=16) (actual time=0.198..0.814 rows=1816 loops=1)
                                    Filter: (language_code = 'en'::text)
                                    Rows Removed by Filter: 12205
                                    Buffers: shared hit=413
  InitPlan 17
    ->  CTE Scan on numbered x  (cost=0.00..0.47 rows=7 width=0) (actual time=0.004..0.004 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  CTE Scan on numbered r  (cost=0.00..897.36 rows=7 width=333) (actual time=6.754..10.358 rows=20 loops=1)
        Filter: (n <= 20)
        Rows Removed by Filter: 1
        Buffers: shared hit=5115
        SubPlan 12
          ->  Aggregate  (cost=21.29..21.30 rows=1 width=32) (actual time=0.043..0.043 rows=1 loops=20)
                Buffers: shared hit=121
                ->  Sort  (cost=21.26..21.27 rows=3 width=13) (actual time=0.038..0.038 rows=4 loops=20)
                      Sort Key: c.name, c.code
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=121
                      ->  Hash Join  (cost=16.07..21.24 rows=3 width=13) (actual time=0.008..0.035 rows=4 loops=20)
                            Hash Cond: (c.code = g_1.country_code)
                            Buffers: shared hit=121
                            ->  Seq Scan on countries c  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.014 rows=250 loops=20)
                                  Buffers: shared hit=40
                            ->  Hash  (cost=16.03..16.03 rows=3 width=3) (actual time=0.005..0.005 rows=4 loops=20)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=81
                                  ->  Bitmap Heap Scan on organization_geographies g_1  (cost=4.45..16.03 rows=3 width=3) (actual time=0.004..0.004 rows=4 loops=20)
                                        Recheck Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                        Heap Blocks: exact=21
                                        Buffers: shared hit=81
                                        ->  Bitmap Index Scan on organization_geographies_pkey  (cost=0.00..4.45 rows=3 width=0) (actual time=0.003..0.003 rows=4 loops=20)
                                              Index Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                              Buffers: shared hit=60
        SubPlan 13
          ->  Aggregate  (cost=58.73..58.74 rows=1 width=32) (actual time=0.086..0.086 rows=1 loops=20)
                Buffers: shared hit=438
                ->  Limit  (cost=58.69..58.70 rows=5 width=46) (actual time=0.079..0.080 rows=5 loops=20)
                      Buffers: shared hit=438
                      ->  Sort  (cost=58.69..58.71 rows=8 width=46) (actual time=0.079..0.079 rows=5 loops=20)
                            Sort Key: (COALESCE(sum(a.available), '0'::bigint)) DESC, oc.label, oc.code
                            Sort Method: top-N heapsort  Memory: 25kB
                            Buffers: shared hit=438
                            ->  GroupAggregate  (cost=46.84..58.57 rows=8 width=46) (actual time=0.072..0.076 rows=10 loops=20)
                                  Group Key: oc.code
                                  Buffers: shared hit=438
                                  ->  Merge Left Join  (cost=46.84..58.45 rows=8 width=42) (actual time=0.071..0.073 rows=10 loops=20)
                                        Merge Cond: (oo_1.occupation_id = a.occupation_id)
                                        Buffers: shared hit=438
                                        ->  Sort  (cost=46.55..46.57 rows=8 width=59) (actual time=0.066..0.067 rows=10 loops=20)
                                              Sort Key: oo_1.occupation_id
                                              Sort Method: quicksort  Memory: 25kB
                                              Buffers: shared hit=380
                                              ->  Hash Join  (cost=34.91..46.43 rows=8 width=59) (actual time=0.022..0.062 rows=10 loops=20)
                                                    Hash Cond: (oc.code = oo_1.occupation_id)
                                                    Buffers: shared hit=380
                                                    ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.025 rows=436 loops=20)
                                                          Buffers: shared hit=120
                                                    ->  Hash  (cost=34.81..34.81 rows=8 width=21) (actual time=0.012..0.012 rows=10 loops=20)
                                                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                          Buffers: shared hit=260
                                                          ->  Bitmap Heap Scan on organization_occupations oo_1  (cost=4.48..34.81 rows=8 width=21) (actual time=0.005..0.010 rows=10 loops=20)
                                                                Recheck Cond: (organization_id = r.id)
                                                                Heap Blocks: exact=200
                                                                Buffers: shared hit=260
                                                                ->  Bitmap Index Scan on organization_occupations_pkey  (cost=0.00..4.47 rows=8 width=0) (actual time=0.004..0.004 rows=10 loops=20)
                                                                      Index Cond: (organization_id = r.id)
                                                                      Buffers: shared hit=60
                                        ->  Index Scan using workforce_availability_listing_key on workforce_availability a  (cost=0.29..11.85 rows=2 width=25) (actual time=0.004..0.004 rows=2 loops=20)
                                              Index Cond: (organization_id = r.id)
                                              Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                              Rows Removed by Filter: 1
                                              Buffers: shared hit=58
        SubPlan 14
          ->  Aggregate  (cost=11.68..11.69 rows=1 width=32) (actual time=0.005..0.005 rows=1 loops=20)
                Buffers: shared hit=54
                ->  Sort  (cost=11.66..11.67 rows=2 width=4) (actual time=0.004..0.004 rows=0 loops=20)
                      Sort Key: st_1.service
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=54
                      ->  Bitmap Heap Scan on organization_service_types st_1  (cost=4.30..11.65 rows=2 width=4) (actual time=0.003..0.003 rows=0 loops=20)
                            Recheck Cond: (organization_id = r.id)
                            Filter: (service <> 'staffing'::public.partner_service_type)
                            Rows Removed by Filter: 0
                            Heap Blocks: exact=14
                            Buffers: shared hit=54
                            ->  Bitmap Index Scan on organization_service_types_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.002..0.002 rows=1 loops=20)
                                  Index Cond: (organization_id = r.id)
                                  Buffers: shared hit=40
        SubPlan 15
          ->  Aggregate  (cost=24.51..24.52 rows=1 width=32) (actual time=0.053..0.053 rows=1 loops=20)
                Buffers: shared hit=156
                ->  Limit  (cost=24.49..24.50 rows=2 width=54) (actual time=0.049..0.049 rows=2 loops=20)
                      Buffers: shared hit=156
                      ->  Sort  (cost=24.49..24.50 rows=2 width=54) (actual time=0.048..0.048 rows=2 loops=20)
                            Sort Key: (sum(a_1.available)) DESC, oc_1.label, oc_1.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=156
                            ->  GroupAggregate  (cost=24.44..24.48 rows=2 width=54) (actual time=0.047..0.047 rows=2 loops=20)
                                  Group Key: oc_1.code
                                  Buffers: shared hit=156
                                  ->  Sort  (cost=24.44..24.45 rows=2 width=50) (actual time=0.047..0.047 rows=2 loops=20)
                                        Sort Key: oc_1.code
                                        Sort Method: quicksort  Memory: 25kB
                                        Buffers: shared hit=156
                                        ->  Hash Join  (cost=11.87..24.43 rows=2 width=50) (actual time=0.026..0.045 rows=2 loops=20)
                                              Hash Cond: (oc_1.code = a_1.occupation_id)
                                              Buffers: shared hit=156
                                              ->  Seq Scan on occupations oc_1  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.025 rows=410 loops=17)
                                                    Buffers: shared hit=98
                                              ->  Hash  (cost=11.85..11.85 rows=2 width=17) (actual time=0.004..0.004 rows=2 loops=20)
                                                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                    Buffers: shared hit=58
                                                    ->  Index Scan using workforce_availability_listing_key on workforce_availability a_1  (cost=0.29..11.85 rows=2 width=17) (actual time=0.003..0.004 rows=2 loops=20)
                                                          Index Cond: (organization_id = r.id)
                                                          Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                                          Rows Removed by Filter: 1
                                                          Buffers: shared hit=58
        SubPlan 16
          ->  Aggregate  (cost=11.85..11.86 rows=1 width=8) (actual time=0.003..0.003 rows=1 loops=20)
                Buffers: shared hit=58
                ->  Index Scan using workforce_availability_source_idx on workforce_availability a_2  (cost=0.29..11.85 rows=2 width=8) (actual time=0.003..0.003 rows=2 loops=20)
                      Index Cond: (organization_id = r.id)
                      Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                      Rows Removed by Filter: 1
                      Buffers: shared hit=58
```

### recruitment: rare destination and occupation

```
duration: 7.654 ms  plan:
Sort  (cost=59260.29..59260.31 rows=7 width=333) (actual time=7.634..7.640 rows=20 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 42kB
  Buffers: shared hit=3708
  CTE numbered
    ->  WindowAgg  (cost=58362.31..58362.76 rows=21 width=120) (actual time=3.968..3.977 rows=21 loops=1)
          Buffers: shared hit=2905
          ->  Sort  (cost=58362.29..58362.34 rows=21 width=112) (actual time=3.964..3.967 rows=21 loops=1)
                Sort Key: p.matched_count DESC, p.updated_at DESC, p.id
                Sort Method: quicksort  Memory: 28kB
                Buffers: shared hit=2905
                ->  Subquery Scan on p  (cost=58187.16..58361.83 rows=21 width=112) (actual time=3.951..3.961 rows=21 loops=1)
                      Buffers: shared hit=2905
                      ->  Limit  (cost=58187.16..58361.83 rows=21 width=112) (actual time=3.951..3.959 rows=21 loops=1)
                            Buffers: shared hit=2905
                            ->  Result  (cost=58187.16..65107.32 rows=832 width=112) (actual time=3.950..3.957 rows=21 loops=1)
                                  Buffers: shared hit=2905
                                  ->  Sort  (cost=58187.16..58189.24 rows=832 width=111) (actual time=3.562..3.564 rows=21 loops=1)
                                        Sort Key: (COALESCE(o.workforce_profile_updated_at, o.listed_at)) DESC, o.id
                                        Sort Method: top-N heapsort  Memory: 34kB
                                        Buffers: shared hit=2747
                                        ->  Nested Loop Left Join  (cost=445.65..58164.73 rows=832 width=111) (actual time=2.853..3.539 rows=118 loops=1)
                                              Buffers: shared hit=2747
                                              ->  Bitmap Heap Scan on organizations o  (cost=445.65..58148.09 rows=832 width=75) (actual time=2.852..3.508 rows=118 loops=1)
                                                    Recheck Cond: ((type = 'recruitment_company'::public.organization_type) AND (listed_at IS NOT NULL) AND (review_status <> 'declined'::public.partner_review_status) AND (status = 'active'::public.organization_status))
                                                    Filter: ((moderation_state = 'visible'::public.job_moderation_state) AND (ANY (id = (hashed SubPlan 6).col1)) AND (ANY (id = (hashed SubPlan 4).col1)))
                                                    Rows Removed by Filter: 3382
                                                    Heap Blocks: exact=478
                                                    Buffers: shared hit=2747
                                                    ->  Bitmap Index Scan on organizations_listed_partners_idx  (cost=0.00..445.44 rows=3354 width=0) (actual time=0.421..0.421 rows=12599 loops=1)
                                                          Index Cond: (type = 'recruitment_company'::public.organization_type)
                                                          Buffers: shared hit=85
                                                    SubPlan 6
                                                      ->  Bitmap Heap Scan on organization_occupations oo  (cost=292.66..1858.60 rows=1580 width=16) (actual time=1.240..1.603 rows=1585 loops=1)
                                                            Recheck Cond: (occupation_id = '2221'::text)
                                                            Heap Blocks: exact=1461
                                                            Buffers: shared hit=1505
                                                            ->  Bitmap Index Scan on organization_occupations_occupation_idx  (cost=0.00..292.27 rows=1580 width=0) (actual time=0.379..0.379 rows=6340 loops=1)
                                                                  Index Cond: (occupation_id = '2221'::text)
                                                                  Buffers: shared hit=44
                                                    SubPlan 4
                                                      ->  Index Only Scan using organization_geographies_scope_country_idx on organization_geographies g  (cost=0.41..578.31 rows=329 width=16) (actual time=0.009..0.239 rows=670 loops=1)
                                                            Index Cond: ((scope = 'serves_market'::public.geography_scope) AND (country_code = 'JP'::text))
                                                            Heap Fetches: 670
                                                            Buffers: shared hit=679
                                              ->  Limit  (cost=0.00..0.00 rows=1 width=1) (actual time=0.000..0.000 rows=0 loops=118)
                                                    ->  Result  (cost=0.00..0.00 rows=0 width=1) (actual time=0.000..0.000 rows=0 loops=118)
                                                          One-Time Filter: false
                                  SubPlan 2
                                    ->  Seq Scan on organization_service_types st  (cost=0.00..224.74 rows=856 width=16) (actual time=0.246..0.303 rows=856 loops=1)
                                          Filter: (service = 'staffing'::public.partner_service_type)
                                          Rows Removed by Filter: 4483
                                          Buffers: shared hit=158
  InitPlan 13
    ->  CTE Scan on numbered x  (cost=0.00..0.47 rows=7 width=0) (actual time=0.003..0.003 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  CTE Scan on numbered r  (cost=0.00..897.36 rows=7 width=333) (actual time=4.215..7.627 rows=20 loops=1)
        Filter: (n <= 20)
        Rows Removed by Filter: 1
        Buffers: shared hit=3708
        SubPlan 8
          ->  Aggregate  (cost=21.29..21.30 rows=1 width=32) (actual time=0.041..0.041 rows=1 loops=20)
                Buffers: shared hit=120
                ->  Sort  (cost=21.26..21.27 rows=3 width=13) (actual time=0.036..0.036 rows=4 loops=20)
                      Sort Key: c.name, c.code
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=120
                      ->  Hash Join  (cost=16.07..21.24 rows=3 width=13) (actual time=0.012..0.033 rows=4 loops=20)
                            Hash Cond: (c.code = g_1.country_code)
                            Buffers: shared hit=120
                            ->  Seq Scan on countries c  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.014 rows=250 loops=20)
                                  Buffers: shared hit=40
                            ->  Hash  (cost=16.03..16.03 rows=3 width=3) (actual time=0.005..0.005 rows=4 loops=20)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=80
                                  ->  Bitmap Heap Scan on organization_geographies g_1  (cost=4.45..16.03 rows=3 width=3) (actual time=0.004..0.004 rows=4 loops=20)
                                        Recheck Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                        Heap Blocks: exact=20
                                        Buffers: shared hit=80
                                        ->  Bitmap Index Scan on organization_geographies_pkey  (cost=0.00..4.45 rows=3 width=0) (actual time=0.003..0.003 rows=4 loops=20)
                                              Index Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                              Buffers: shared hit=60
        SubPlan 9
          ->  Aggregate  (cost=58.73..58.74 rows=1 width=32) (actual time=0.082..0.082 rows=1 loops=20)
                Buffers: shared hit=411
                ->  Limit  (cost=58.69..58.70 rows=5 width=46) (actual time=0.075..0.076 rows=5 loops=20)
                      Buffers: shared hit=411
                      ->  Sort  (cost=58.69..58.71 rows=8 width=46) (actual time=0.075..0.075 rows=5 loops=20)
                            Sort Key: (COALESCE(sum(a.available), '0'::bigint)) DESC, oc.label, oc.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=411
                            ->  GroupAggregate  (cost=46.84..58.57 rows=8 width=46) (actual time=0.068..0.072 rows=9 loops=20)
                                  Group Key: oc.code
                                  Buffers: shared hit=411
                                  ->  Merge Left Join  (cost=46.84..58.45 rows=8 width=42) (actual time=0.067..0.069 rows=9 loops=20)
                                        Merge Cond: (oo_1.occupation_id = a.occupation_id)
                                        Buffers: shared hit=411
                                        ->  Sort  (cost=46.55..46.57 rows=8 width=59) (actual time=0.063..0.064 rows=9 loops=20)
                                              Sort Key: oo_1.occupation_id
                                              Sort Method: quicksort  Memory: 25kB
                                              Buffers: shared hit=352
                                              ->  Hash Join  (cost=34.91..46.43 rows=8 width=59) (actual time=0.016..0.060 rows=9 loops=20)
                                                    Hash Cond: (oc.code = oo_1.occupation_id)
                                                    Buffers: shared hit=352
                                                    ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.025 rows=436 loops=20)
                                                          Buffers: shared hit=120
                                                    ->  Hash  (cost=34.81..34.81 rows=8 width=21) (actual time=0.010..0.010 rows=9 loops=20)
                                                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                          Buffers: shared hit=232
                                                          ->  Bitmap Heap Scan on organization_occupations oo_1  (cost=4.48..34.81 rows=8 width=21) (actual time=0.005..0.008 rows=9 loops=20)
                                                                Recheck Cond: (organization_id = r.id)
                                                                Heap Blocks: exact=172
                                                                Buffers: shared hit=232
                                                                ->  Bitmap Index Scan on organization_occupations_pkey  (cost=0.00..4.47 rows=8 width=0) (actual time=0.003..0.003 rows=9 loops=20)
                                                                      Index Cond: (organization_id = r.id)
                                                                      Buffers: shared hit=60
                                        ->  Index Scan using workforce_availability_listing_key on workforce_availability a  (cost=0.29..11.85 rows=2 width=25) (actual time=0.003..0.004 rows=1 loops=20)
                                              Index Cond: (organization_id = r.id)
                                              Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                              Rows Removed by Filter: 1
                                              Buffers: shared hit=59
        SubPlan 10
          ->  Aggregate  (cost=11.68..11.69 rows=1 width=32) (actual time=0.004..0.004 rows=1 loops=20)
                Buffers: shared hit=52
                ->  Sort  (cost=11.66..11.67 rows=2 width=4) (actual time=0.004..0.004 rows=1 loops=20)
                      Sort Key: st_1.service
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=52
                      ->  Bitmap Heap Scan on organization_service_types st_1  (cost=4.30..11.65 rows=2 width=4) (actual time=0.003..0.003 rows=1 loops=20)
                            Recheck Cond: (organization_id = r.id)
                            Filter: (service <> 'staffing'::public.partner_service_type)
                            Rows Removed by Filter: 0
                            Heap Blocks: exact=12
                            Buffers: shared hit=52
                            ->  Bitmap Index Scan on organization_service_types_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.002..0.002 rows=1 loops=20)
                                  Index Cond: (organization_id = r.id)
                                  Buffers: shared hit=40
        SubPlan 11
          ->  Aggregate  (cost=24.51..24.52 rows=1 width=32) (actual time=0.050..0.050 rows=1 loops=20)
                Buffers: shared hit=161
                ->  Limit  (cost=24.49..24.50 rows=2 width=54) (actual time=0.046..0.047 rows=1 loops=20)
                      Buffers: shared hit=161
                      ->  Sort  (cost=24.49..24.50 rows=2 width=54) (actual time=0.046..0.046 rows=1 loops=20)
                            Sort Key: (sum(a_1.available)) DESC, oc_1.label, oc_1.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=161
                            ->  GroupAggregate  (cost=24.44..24.48 rows=2 width=54) (actual time=0.045..0.046 rows=1 loops=20)
                                  Group Key: oc_1.code
                                  Buffers: shared hit=161
                                  ->  Sort  (cost=24.44..24.45 rows=2 width=50) (actual time=0.045..0.045 rows=1 loops=20)
                                        Sort Key: oc_1.code
                                        Sort Method: quicksort  Memory: 25kB
                                        Buffers: shared hit=161
                                        ->  Hash Join  (cost=11.87..24.43 rows=2 width=50) (actual time=0.021..0.043 rows=1 loops=20)
                                              Hash Cond: (oc_1.code = a_1.occupation_id)
                                              Buffers: shared hit=161
                                              ->  Seq Scan on occupations oc_1  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.025 rows=436 loops=17)
                                                    Buffers: shared hit=102
                                              ->  Hash  (cost=11.85..11.85 rows=2 width=17) (actual time=0.002..0.002 rows=1 loops=20)
                                                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                    Buffers: shared hit=59
                                                    ->  Index Scan using workforce_availability_listing_key on workforce_availability a_1  (cost=0.29..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=1 loops=20)
                                                          Index Cond: (organization_id = r.id)
                                                          Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                                          Rows Removed by Filter: 1
                                                          Buffers: shared hit=59
        SubPlan 12
          ->  Aggregate  (cost=11.85..11.86 rows=1 width=8) (actual time=0.003..0.003 rows=1 loops=20)
                Buffers: shared hit=59
                ->  Index Scan using workforce_availability_source_idx on workforce_availability a_2  (cost=0.29..11.85 rows=2 width=8) (actual time=0.002..0.002 rows=1 loops=20)
                      Index Cond: (organization_id = r.id)
                      Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                      Rows Removed by Filter: 1
                      Buffers: shared hit=59
```

### recruitment: destination, second page

```
duration: 7.349 ms  plan:
Sort  (cost=30981.52..30981.54 rows=7 width=333) (actual time=7.331..7.337 rows=20 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 43kB
  Buffers: shared hit=2106
  CTE numbered
    ->  WindowAgg  (cost=30083.54..30083.99 rows=21 width=120) (actual time=3.627..3.636 rows=21 loops=1)
          Buffers: shared hit=1304
          ->  Sort  (cost=30083.52..30083.57 rows=21 width=112) (actual time=3.623..3.625 rows=21 loops=1)
                Sort Key: p.matched_count DESC, p.updated_at DESC, p.id
                Sort Method: quicksort  Memory: 27kB
                Buffers: shared hit=1304
                ->  Subquery Scan on p  (cost=29908.39..30083.06 rows=21 width=112) (actual time=3.610..3.619 rows=21 loops=1)
                      Buffers: shared hit=1304
                      ->  Limit  (cost=29908.39..30083.06 rows=21 width=112) (actual time=3.609..3.617 rows=21 loops=1)
                            Buffers: shared hit=1304
                            ->  Result  (cost=29908.39..34549.56 rows=558 width=112) (actual time=3.609..3.615 rows=21 loops=1)
                                  Buffers: shared hit=1304
                                  ->  Sort  (cost=29908.39..29909.79 rows=558 width=111) (actual time=3.213..3.214 rows=21 loops=1)
                                        Sort Key: (COALESCE(o.workforce_profile_updated_at, o.listed_at)) DESC, o.id
                                        Sort Method: top-N heapsort  Memory: 34kB
                                        Buffers: shared hit=1146
                                        ->  Nested Loop Left Join  (cost=445.58..29893.35 rows=558 width=111) (actual time=2.035..3.020 rows=1222 loops=1)
                                              Buffers: shared hit=1146
                                              ->  Bitmap Heap Scan on organizations o  (cost=445.58..29882.19 rows=558 width=75) (actual time=2.034..2.726 rows=1222 loops=1)
                                                    Recheck Cond: ((type = 'recruitment_company'::public.organization_type) AND (listed_at IS NOT NULL) AND (review_status <> 'declined'::public.partner_review_status) AND (status = 'active'::public.organization_status))
                                                    Filter: ((moderation_state = 'visible'::public.job_moderation_state) AND ((COALESCE(workforce_profile_updated_at, listed_at) < '2026-10-24 19:16:58.918859+00'::timestamp with time zone) OR ((COALESCE(workforce_profile_updated_at, listed_at) = '2026-10-24 19:16:58.918859+00'::timestamp with time zone) AND (id > '4f9fba9a-3369-4284-b1c1-13645ab3bbe5'::uuid))) AND (ANY (id = (hashed SubPlan 4).col1)))
                                                    Rows Removed by Filter: 2278
                                                    Heap Blocks: exact=478
                                                    Buffers: shared hit=1146
                                                    ->  Bitmap Index Scan on organizations_listed_partners_idx  (cost=0.00..445.44 rows=3354 width=0) (actual time=0.398..0.398 rows=12599 loops=1)
                                                          Index Cond: (type = 'recruitment_company'::public.organization_type)
                                                          Buffers: shared hit=85
                                                    SubPlan 4
                                                      ->  Bitmap Heap Scan on organization_geographies g  (cost=65.08..1254.63 rows=1094 width=16) (actual time=0.756..1.078 rows=2225 loops=1)
                                                            Recheck Cond: (country_code = 'DE'::text)
                                                            Filter: (scope = 'serves_market'::public.geography_scope)
                                                            Heap Blocks: exact=575
                                                            Buffers: shared hit=583
                                                            ->  Bitmap Index Scan on organization_geographies_country_idx  (cost=0.00..64.81 rows=2202 width=0) (actual time=0.128..0.128 rows=8900 loops=1)
                                                                  Index Cond: (country_code = 'DE'::text)
                                                                  Buffers: shared hit=8
                                              ->  Limit  (cost=0.00..0.00 rows=1 width=1) (actual time=0.000..0.000 rows=0 loops=1222)
                                                    ->  Result  (cost=0.00..0.00 rows=0 width=1) (actual time=0.000..0.000 rows=0 loops=1222)
                                                          One-Time Filter: false
                                  SubPlan 2
                                    ->  Seq Scan on organization_service_types st  (cost=0.00..224.74 rows=856 width=16) (actual time=0.249..0.305 rows=856 loops=1)
                                          Filter: (service = 'staffing'::public.partner_service_type)
                                          Rows Removed by Filter: 4483
                                          Buffers: shared hit=158
  InitPlan 11
    ->  CTE Scan on numbered x  (cost=0.00..0.47 rows=7 width=0) (actual time=0.003..0.003 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  CTE Scan on numbered r  (cost=0.00..897.36 rows=7 width=333) (actual time=3.869..7.323 rows=20 loops=1)
        Filter: (n <= 20)
        Rows Removed by Filter: 1
        Buffers: shared hit=2106
        SubPlan 6
          ->  Aggregate  (cost=21.29..21.30 rows=1 width=32) (actual time=0.041..0.041 rows=1 loops=20)
                Buffers: shared hit=120
                ->  Sort  (cost=21.26..21.27 rows=3 width=13) (actual time=0.036..0.036 rows=4 loops=20)
                      Sort Key: c.name, c.code
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=120
                      ->  Hash Join  (cost=16.07..21.24 rows=3 width=13) (actual time=0.009..0.033 rows=4 loops=20)
                            Hash Cond: (c.code = g_1.country_code)
                            Buffers: shared hit=120
                            ->  Seq Scan on countries c  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.014 rows=250 loops=20)
                                  Buffers: shared hit=40
                            ->  Hash  (cost=16.03..16.03 rows=3 width=3) (actual time=0.004..0.004 rows=4 loops=20)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=80
                                  ->  Bitmap Heap Scan on organization_geographies g_1  (cost=4.45..16.03 rows=3 width=3) (actual time=0.003..0.003 rows=4 loops=20)
                                        Recheck Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                        Heap Blocks: exact=20
                                        Buffers: shared hit=80
                                        ->  Bitmap Index Scan on organization_geographies_pkey  (cost=0.00..4.45 rows=3 width=0) (actual time=0.002..0.002 rows=4 loops=20)
                                              Index Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                              Buffers: shared hit=60
        SubPlan 7
          ->  Aggregate  (cost=58.73..58.74 rows=1 width=32) (actual time=0.083..0.083 rows=1 loops=20)
                Buffers: shared hit=414
                ->  Limit  (cost=58.69..58.70 rows=5 width=46) (actual time=0.077..0.077 rows=5 loops=20)
                      Buffers: shared hit=414
                      ->  Sort  (cost=58.69..58.71 rows=8 width=46) (actual time=0.077..0.077 rows=5 loops=20)
                            Sort Key: (COALESCE(sum(a.available), '0'::bigint)) DESC, oc.label, oc.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=414
                            ->  GroupAggregate  (cost=46.84..58.57 rows=8 width=46) (actual time=0.070..0.074 rows=9 loops=20)
                                  Group Key: oc.code
                                  Buffers: shared hit=414
                                  ->  Merge Left Join  (cost=46.84..58.45 rows=8 width=42) (actual time=0.069..0.072 rows=9 loops=20)
                                        Merge Cond: (oo.occupation_id = a.occupation_id)
                                        Buffers: shared hit=414
                                        ->  Sort  (cost=46.55..46.57 rows=8 width=59) (actual time=0.066..0.066 rows=9 loops=20)
                                              Sort Key: oo.occupation_id
                                              Sort Method: quicksort  Memory: 25kB
                                              Buffers: shared hit=356
                                              ->  Hash Join  (cost=34.91..46.43 rows=8 width=59) (actual time=0.024..0.062 rows=9 loops=20)
                                                    Hash Cond: (oc.code = oo.occupation_id)
                                                    Buffers: shared hit=356
                                                    ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.025 rows=436 loops=20)
                                                          Buffers: shared hit=120
                                                    ->  Hash  (cost=34.81..34.81 rows=8 width=21) (actual time=0.012..0.012 rows=9 loops=20)
                                                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                          Buffers: shared hit=236
                                                          ->  Bitmap Heap Scan on organization_occupations oo  (cost=4.48..34.81 rows=8 width=21) (actual time=0.005..0.011 rows=9 loops=20)
                                                                Recheck Cond: (organization_id = r.id)
                                                                Heap Blocks: exact=176
                                                                Buffers: shared hit=236
                                                                ->  Bitmap Index Scan on organization_occupations_pkey  (cost=0.00..4.47 rows=8 width=0) (actual time=0.004..0.004 rows=9 loops=20)
                                                                      Index Cond: (organization_id = r.id)
                                                                      Buffers: shared hit=60
                                        ->  Index Scan using workforce_availability_listing_key on workforce_availability a  (cost=0.29..11.85 rows=2 width=25) (actual time=0.003..0.003 rows=2 loops=20)
                                              Index Cond: (organization_id = r.id)
                                              Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                              Rows Removed by Filter: 1
                                              Buffers: shared hit=58
        SubPlan 8
          ->  Aggregate  (cost=11.68..11.69 rows=1 width=32) (actual time=0.004..0.004 rows=1 loops=20)
                Buffers: shared hit=50
                ->  Sort  (cost=11.66..11.67 rows=2 width=4) (actual time=0.003..0.003 rows=0 loops=20)
                      Sort Key: st_1.service
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=50
                      ->  Bitmap Heap Scan on organization_service_types st_1  (cost=4.30..11.65 rows=2 width=4) (actual time=0.002..0.002 rows=0 loops=20)
                            Recheck Cond: (organization_id = r.id)
                            Filter: (service <> 'staffing'::public.partner_service_type)
                            Rows Removed by Filter: 0
                            Heap Blocks: exact=10
                            Buffers: shared hit=50
                            ->  Bitmap Index Scan on organization_service_types_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.002..0.002 rows=1 loops=20)
                                  Index Cond: (organization_id = r.id)
                                  Buffers: shared hit=40
        SubPlan 9
          ->  Aggregate  (cost=24.51..24.52 rows=1 width=32) (actual time=0.051..0.051 rows=1 loops=20)
                Buffers: shared hit=160
                ->  Limit  (cost=24.49..24.50 rows=2 width=54) (actual time=0.046..0.046 rows=2 loops=20)
                      Buffers: shared hit=160
                      ->  Sort  (cost=24.49..24.50 rows=2 width=54) (actual time=0.046..0.046 rows=2 loops=20)
                            Sort Key: (sum(a_1.available)) DESC, oc_1.label, oc_1.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=160
                            ->  GroupAggregate  (cost=24.44..24.48 rows=2 width=54) (actual time=0.045..0.045 rows=2 loops=20)
                                  Group Key: oc_1.code
                                  Buffers: shared hit=160
                                  ->  Sort  (cost=24.44..24.45 rows=2 width=50) (actual time=0.044..0.045 rows=2 loops=20)
                                        Sort Key: oc_1.code
                                        Sort Method: quicksort  Memory: 25kB
                                        Buffers: shared hit=160
                                        ->  Hash Join  (cost=11.87..24.43 rows=2 width=50) (actual time=0.024..0.043 rows=2 loops=20)
                                              Hash Cond: (oc_1.code = a_1.occupation_id)
                                              Buffers: shared hit=160
                                              ->  Seq Scan on occupations oc_1  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.025 rows=436 loops=17)
                                                    Buffers: shared hit=102
                                              ->  Hash  (cost=11.85..11.85 rows=2 width=17) (actual time=0.002..0.002 rows=2 loops=20)
                                                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                    Buffers: shared hit=58
                                                    ->  Index Scan using workforce_availability_listing_key on workforce_availability a_1  (cost=0.29..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=2 loops=20)
                                                          Index Cond: (organization_id = r.id)
                                                          Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                                          Rows Removed by Filter: 1
                                                          Buffers: shared hit=58
        SubPlan 10
          ->  Aggregate  (cost=11.85..11.86 rows=1 width=8) (actual time=0.003..0.003 rows=1 loops=20)
                Buffers: shared hit=58
                ->  Index Scan using workforce_availability_source_idx on workforce_availability a_2  (cost=0.29..11.85 rows=2 width=8) (actual time=0.003..0.003 rows=2 loops=20)
                      Index Cond: (organization_id = r.id)
                      Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                      Rows Removed by Filter: 1
                      Buffers: shared hit=58
```

### recruitment: advanced (capacity, timeframe, two sources)

```
duration: 12.816 ms  plan:
Sort  (cost=77415.79..77415.80 rows=7 width=333) (actual time=12.789..12.796 rows=20 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 46kB
  Buffers: shared hit=5581
  CTE numbered
    ->  WindowAgg  (cost=75836.76..76518.26 rows=21 width=120) (actual time=8.801..8.832 rows=21 loops=1)
          Buffers: shared hit=4749
          ->  Subquery Scan on p  (cost=75802.68..76517.84 rows=21 width=112) (actual time=8.798..8.821 rows=21 loops=1)
                Buffers: shared hit=4749
                ->  Limit  (cost=75802.68..76517.84 rows=21 width=112) (actual time=8.797..8.818 rows=21 loops=1)
                      Buffers: shared hit=4749
                      ->  Result  (cost=75802.68..104136.44 rows=832 width=112) (actual time=8.797..8.815 rows=21 loops=1)
                            Buffers: shared hit=4749
                            ->  Sort  (cost=75802.68..75804.76 rows=832 width=80) (actual time=6.998..7.002 rows=21 loops=1)
                                  Sort Key: (cardinality(array_remove(ARRAY['destination'::text, 'occupation'::text, NULL::text, CASE WHEN (ANY (o.id = (hashed SubPlan 6).col1)) THEN 'sources_from'::text ELSE NULL::text END, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, CASE WHEN (true) THEN 'capacity'::text ELSE NULL::text END, CASE WHEN (true) THEN 'timeframe'::text ELSE NULL::text END], NULL::text))) DESC, (COALESCE(o.workforce_profile_updated_at, o.listed_at)) DESC, o.id
                                  Sort Method: top-N heapsort  Memory: 29kB
                                  Buffers: shared hit=4000
                                  ->  Nested Loop Left Join  (cost=445.93..75780.25 rows=832 width=80) (actual time=5.523..6.912 rows=337 loops=1)
                                        Buffers: shared hit=4000
                                        ->  Bitmap Heap Scan on organizations o  (cost=445.65..58148.09 rows=832 width=75) (actual time=3.671..4.387 rows=337 loops=1)
                                              Recheck Cond: ((type = 'recruitment_company'::public.organization_type) AND (listed_at IS NOT NULL) AND (review_status <> 'declined'::public.partner_review_status) AND (status = 'active'::public.organization_status))
                                              Filter: ((moderation_state = 'visible'::public.job_moderation_state) AND (ANY (id = (hashed SubPlan 10).col1)) AND (ANY (id = (hashed SubPlan 8).col1)))
                                              Rows Removed by Filter: 3163
                                              Heap Blocks: exact=478
                                              Buffers: shared hit=2652
                                              ->  Bitmap Index Scan on organizations_listed_partners_idx  (cost=0.00..445.44 rows=3354 width=0) (actual time=0.408..0.408 rows=12599 loops=1)
                                                    Index Cond: (type = 'recruitment_company'::public.organization_type)
                                                    Buffers: shared hit=85
                                              SubPlan 10
                                                ->  Bitmap Heap Scan on organization_occupations oo  (cost=300.97..1871.14 rows=1620 width=16) (actual time=1.202..1.580 rows=1609 loops=1)
                                                      Recheck Cond: (occupation_id = '7212'::text)
                                                      Heap Blocks: exact=1466
                                                      Buffers: shared hit=1506
                                                      ->  Bitmap Index Scan on organization_occupations_occupation_idx  (cost=0.00..300.56 rows=1620 width=0) (actual time=0.323..0.323 rows=6436 loops=1)
                                                            Index Cond: (occupation_id = '7212'::text)
                                                            Buffers: shared hit=40
                                              SubPlan 8
                                                ->  Bitmap Heap Scan on organization_geographies g_2  (cost=65.08..1254.63 rows=1094 width=16) (actual time=0.592..0.890 rows=2225 loops=1)
                                                      Recheck Cond: (country_code = 'DE'::text)
                                                      Filter: (scope = 'serves_market'::public.geography_scope)
                                                      Heap Blocks: exact=575
                                                      Buffers: shared hit=583
                                                      ->  Bitmap Index Scan on organization_geographies_country_idx  (cost=0.00..64.81 rows=2202 width=0) (actual time=0.123..0.124 rows=8900 loops=1)
                                                            Index Cond: (country_code = 'DE'::text)
                                                            Buffers: shared hit=8
                                        ->  Limit  (cost=0.29..8.31 rows=1 width=1) (actual time=0.002..0.002 rows=0 loops=337)
                                              Buffers: shared hit=757
                                              ->  Index Scan using workforce_availability_listing_key on workforce_availability a  (cost=0.29..8.31 rows=1 width=1) (actual time=0.001..0.001 rows=0 loops=337)
                                                    Index Cond: ((organization_id = o.id) AND (occupation_id = '7212'::text))
                                                    Filter: ((confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone) AND (available >= 20) AND (available_from <= '2026-12-26'::date))
                                                    Rows Removed by Filter: 0
                                                    Buffers: shared hit=757
                                        SubPlan 6
                                          ->  Bitmap Heap Scan on organization_geographies g_1  (cost=108.76..1310.20 rows=1859 width=16) (actual time=0.982..1.469 rows=3673 loops=1)
                                                Recheck Cond: (country_code = ANY ('{PH,IN}'::text[]))
                                                Filter: (scope = 'sources_from'::public.geography_scope)
                                                Heap Blocks: exact=577
                                                Buffers: shared hit=591
                                                ->  Bitmap Index Scan on organization_geographies_country_idx  (cost=0.00..108.30 rows=3696 width=0) (actual time=0.203..0.203 rows=14692 loops=1)
                                                      Index Cond: (country_code = ANY ('{PH,IN}'::text[]))
                                                      Buffers: shared hit=14
                            SubPlan 2
                              ->  Seq Scan on organization_service_types st  (cost=0.00..224.74 rows=856 width=16) (actual time=0.271..0.329 rows=856 loops=1)
                                    Filter: (service = 'staffing'::public.partner_service_type)
                                    Rows Removed by Filter: 4483
                                    Buffers: shared hit=158
                            SubPlan 4
                              ->  Bitmap Heap Scan on organization_geographies g  (cost=108.76..1310.20 rows=1859 width=16) (actual time=0.579..0.996 rows=3673 loops=1)
                                    Recheck Cond: (country_code = ANY ('{PH,IN}'::text[]))
                                    Filter: (scope = 'sources_from'::public.geography_scope)
                                    Heap Blocks: exact=577
                                    Buffers: shared hit=591
                                    ->  Bitmap Index Scan on organization_geographies_country_idx  (cost=0.00..108.30 rows=3696 width=0) (actual time=0.193..0.193 rows=14692 loops=1)
                                          Index Cond: (country_code = ANY ('{PH,IN}'::text[]))
                                          Buffers: shared hit=14
  InitPlan 17
    ->  CTE Scan on numbered x  (cost=0.00..0.47 rows=7 width=0) (actual time=0.004..0.004 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  CTE Scan on numbered r  (cost=0.00..897.36 rows=7 width=333) (actual time=9.131..12.777 rows=20 loops=1)
        Filter: (n <= 20)
        Rows Removed by Filter: 1
        Buffers: shared hit=5581
        SubPlan 12
          ->  Aggregate  (cost=21.29..21.30 rows=1 width=32) (actual time=0.042..0.042 rows=1 loops=20)
                Buffers: shared hit=121
                ->  Sort  (cost=21.26..21.27 rows=3 width=13) (actual time=0.036..0.036 rows=4 loops=20)
                      Sort Key: c.name, c.code
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=121
                      ->  Hash Join  (cost=16.07..21.24 rows=3 width=13) (actual time=0.009..0.033 rows=4 loops=20)
                            Hash Cond: (c.code = g_3.country_code)
                            Buffers: shared hit=121
                            ->  Seq Scan on countries c  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.014 rows=250 loops=20)
                                  Buffers: shared hit=40
                            ->  Hash  (cost=16.03..16.03 rows=3 width=3) (actual time=0.004..0.004 rows=4 loops=20)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=81
                                  ->  Bitmap Heap Scan on organization_geographies g_3  (cost=4.45..16.03 rows=3 width=3) (actual time=0.003..0.004 rows=4 loops=20)
                                        Recheck Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                        Heap Blocks: exact=21
                                        Buffers: shared hit=81
                                        ->  Bitmap Index Scan on organization_geographies_pkey  (cost=0.00..4.45 rows=3 width=0) (actual time=0.002..0.002 rows=4 loops=20)
                                              Index Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                              Buffers: shared hit=60
        SubPlan 13
          ->  Aggregate  (cost=58.73..58.74 rows=1 width=32) (actual time=0.083..0.083 rows=1 loops=20)
                Buffers: shared hit=425
                ->  Limit  (cost=58.69..58.70 rows=5 width=46) (actual time=0.077..0.077 rows=5 loops=20)
                      Buffers: shared hit=425
                      ->  Sort  (cost=58.69..58.71 rows=8 width=46) (actual time=0.077..0.077 rows=5 loops=20)
                            Sort Key: (COALESCE(sum(a_1.available), '0'::bigint)) DESC, oc.label, oc.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=425
                            ->  GroupAggregate  (cost=46.84..58.57 rows=8 width=46) (actual time=0.069..0.074 rows=9 loops=20)
                                  Group Key: oc.code
                                  Buffers: shared hit=425
                                  ->  Merge Left Join  (cost=46.84..58.45 rows=8 width=42) (actual time=0.068..0.071 rows=9 loops=20)
                                        Merge Cond: (oo_1.occupation_id = a_1.occupation_id)
                                        Buffers: shared hit=425
                                        ->  Sort  (cost=46.55..46.57 rows=8 width=59) (actual time=0.066..0.066 rows=9 loops=20)
                                              Sort Key: oo_1.occupation_id
                                              Sort Method: quicksort  Memory: 25kB
                                              Buffers: shared hit=365
                                              ->  Hash Join  (cost=34.91..46.43 rows=8 width=59) (actual time=0.020..0.062 rows=9 loops=20)
                                                    Hash Cond: (oc.code = oo_1.occupation_id)
                                                    Buffers: shared hit=365
                                                    ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.025 rows=436 loops=20)
                                                          Buffers: shared hit=120
                                                    ->  Hash  (cost=34.81..34.81 rows=8 width=21) (actual time=0.012..0.012 rows=9 loops=20)
                                                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                          Buffers: shared hit=245
                                                          ->  Bitmap Heap Scan on organization_occupations oo_1  (cost=4.48..34.81 rows=8 width=21) (actual time=0.005..0.011 rows=9 loops=20)
                                                                Recheck Cond: (organization_id = r.id)
                                                                Heap Blocks: exact=185
                                                                Buffers: shared hit=245
                                                                ->  Bitmap Index Scan on organization_occupations_pkey  (cost=0.00..4.47 rows=8 width=0) (actual time=0.004..0.004 rows=9 loops=20)
                                                                      Index Cond: (organization_id = r.id)
                                                                      Buffers: shared hit=60
                                        ->  Index Scan using workforce_availability_listing_key on workforce_availability a_1  (cost=0.29..11.85 rows=2 width=25) (actual time=0.002..0.002 rows=2 loops=20)
                                              Index Cond: (organization_id = r.id)
                                              Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                              Rows Removed by Filter: 0
                                              Buffers: shared hit=60
        SubPlan 14
          ->  Aggregate  (cost=11.68..11.69 rows=1 width=32) (actual time=0.003..0.003 rows=1 loops=20)
                Buffers: shared hit=46
                ->  Sort  (cost=11.66..11.67 rows=2 width=4) (actual time=0.003..0.003 rows=0 loops=20)
                      Sort Key: st_1.service
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=46
                      ->  Bitmap Heap Scan on organization_service_types st_1  (cost=4.30..11.65 rows=2 width=4) (actual time=0.002..0.002 rows=0 loops=20)
                            Recheck Cond: (organization_id = r.id)
                            Filter: (service <> 'staffing'::public.partner_service_type)
                            Rows Removed by Filter: 0
                            Heap Blocks: exact=6
                            Buffers: shared hit=46
                            ->  Bitmap Index Scan on organization_service_types_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.002..0.002 rows=0 loops=20)
                                  Index Cond: (organization_id = r.id)
                                  Buffers: shared hit=40
        SubPlan 15
          ->  Aggregate  (cost=24.51..24.52 rows=1 width=32) (actual time=0.063..0.063 rows=1 loops=20)
                Buffers: shared hit=180
                ->  Limit  (cost=24.49..24.50 rows=2 width=54) (actual time=0.057..0.057 rows=2 loops=20)
                      Buffers: shared hit=180
                      ->  Sort  (cost=24.49..24.50 rows=2 width=54) (actual time=0.057..0.057 rows=2 loops=20)
                            Sort Key: (sum(a_2.available)) DESC, oc_1.label, oc_1.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=180
                            ->  GroupAggregate  (cost=24.44..24.48 rows=2 width=54) (actual time=0.055..0.055 rows=2 loops=20)
                                  Group Key: oc_1.code
                                  Buffers: shared hit=180
                                  ->  Sort  (cost=24.44..24.45 rows=2 width=50) (actual time=0.054..0.055 rows=2 loops=20)
                                        Sort Key: oc_1.code
                                        Sort Method: quicksort  Memory: 25kB
                                        Buffers: shared hit=180
                                        ->  Hash Join  (cost=11.87..24.43 rows=2 width=50) (actual time=0.030..0.053 rows=2 loops=20)
                                              Hash Cond: (oc_1.code = a_2.occupation_id)
                                              Buffers: shared hit=180
                                              ->  Seq Scan on occupations oc_1  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.025 rows=436 loops=20)
                                                    Buffers: shared hit=120
                                              ->  Hash  (cost=11.85..11.85 rows=2 width=17) (actual time=0.003..0.003 rows=2 loops=20)
                                                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                    Buffers: shared hit=60
                                                    ->  Index Scan using workforce_availability_listing_key on workforce_availability a_2  (cost=0.29..11.85 rows=2 width=17) (actual time=0.002..0.003 rows=2 loops=20)
                                                          Index Cond: (organization_id = r.id)
                                                          Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                                          Rows Removed by Filter: 0
                                                          Buffers: shared hit=60
        SubPlan 16
          ->  Aggregate  (cost=11.85..11.86 rows=1 width=8) (actual time=0.003..0.003 rows=1 loops=20)
                Buffers: shared hit=60
                ->  Index Scan using workforce_availability_source_idx on workforce_availability a_3  (cost=0.29..11.85 rows=2 width=8) (actual time=0.003..0.003 rows=2 loops=20)
                      Index Cond: (organization_id = r.id)
                      Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                      Rows Removed by Filter: 0
                      Buffers: shared hit=60
```

### staffing: no filter

```
duration: 6.078 ms  plan:
Sort  (cost=42332.85..42332.87 rows=7 width=333) (actual time=6.064..6.069 rows=20 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 38kB
  Buffers: shared hit=1354
  CTE numbered
    ->  WindowAgg  (cost=41434.87..41435.32 rows=21 width=120) (actual time=3.108..3.116 rows=21 loops=1)
          Buffers: shared hit=660
          ->  Sort  (cost=41434.85..41434.90 rows=21 width=112) (actual time=3.106..3.109 rows=21 loops=1)
                Sort Key: p.matched_count DESC, p.updated_at DESC, p.id
                Sort Method: quicksort  Memory: 27kB
                Buffers: shared hit=660
                ->  Subquery Scan on p  (cost=41259.72..41434.39 rows=21 width=112) (actual time=2.750..3.102 rows=21 loops=1)
                      Buffers: shared hit=660
                      ->  Limit  (cost=41259.72..41434.39 rows=21 width=112) (actual time=2.750..3.100 rows=21 loops=1)
                            Buffers: shared hit=660
                            ->  Result  (cost=41259.72..62802.05 rows=2590 width=112) (actual time=2.749..3.098 rows=21 loops=1)
                                  Buffers: shared hit=660
                                  ->  Sort  (cost=41259.72..41266.20 rows=2590 width=111) (actual time=2.748..2.750 rows=21 loops=1)
                                        Sort Key: (COALESCE(o.workforce_profile_updated_at, o.listed_at)) DESC, o.id
                                        Sort Method: top-N heapsort  Memory: 29kB
                                        Buffers: shared hit=502
                                        ->  Nested Loop Left Join  (cost=532.69..41189.89 rows=2590 width=111) (actual time=0.988..2.413 rows=2198 loops=1)
                                              Buffers: shared hit=502
                                              ->  Bitmap Heap Scan on organizations o  (cost=532.69..41138.09 rows=2590 width=75) (actual time=0.987..1.838 rows=2198 loops=1)
                                                    Recheck Cond: ((status = 'active'::public.organization_status) AND (listed_at IS NOT NULL) AND (review_status <> 'declined'::public.partner_review_status) AND (moderation_state = 'visible'::public.job_moderation_state))
                                                    Filter: ((type = 'staffing_company'::public.organization_type) OR ((type = 'recruitment_company'::public.organization_type) AND (ANY (id = (hashed SubPlan 4).col1))))
                                                    Rows Removed by Filter: 2752
                                                    Heap Blocks: exact=273
                                                    Buffers: shared hit=502
                                                    ->  Bitmap Index Scan on organizations_public_profile_slug_idx  (cost=0.00..532.04 rows=4752 width=0) (actual time=0.379..0.379 rows=9125 loops=1)
                                                          Buffers: shared hit=71
                                                    SubPlan 4
                                                      ->  Seq Scan on organization_service_types st_1  (cost=0.00..224.74 rows=856 width=16) (actual time=0.269..0.340 rows=856 loops=1)
                                                            Filter: (service = 'staffing'::public.partner_service_type)
                                                            Rows Removed by Filter: 4483
                                                            Buffers: shared hit=158
                                              ->  Limit  (cost=0.00..0.00 rows=1 width=1) (actual time=0.000..0.000 rows=0 loops=2198)
                                                    ->  Result  (cost=0.00..0.00 rows=0 width=1) (actual time=0.000..0.000 rows=0 loops=2198)
                                                          One-Time Filter: false
                                  SubPlan 2
                                    ->  Seq Scan on organization_service_types st  (cost=0.00..224.74 rows=856 width=16) (actual time=0.198..0.254 rows=856 loops=1)
                                          Filter: (service = 'staffing'::public.partner_service_type)
                                          Rows Removed by Filter: 4483
                                          Buffers: shared hit=158
  InitPlan 11
    ->  CTE Scan on numbered x  (cost=0.00..0.47 rows=7 width=0) (actual time=0.002..0.002 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  CTE Scan on numbered r  (cost=0.00..897.36 rows=7 width=333) (actual time=3.305..6.058 rows=20 loops=1)
        Filter: (n <= 20)
        Rows Removed by Filter: 1
        Buffers: shared hit=1354
        SubPlan 6
          ->  Aggregate  (cost=21.29..21.30 rows=1 width=32) (actual time=0.040..0.040 rows=1 loops=20)
                Buffers: shared hit=120
                ->  Sort  (cost=21.26..21.27 rows=3 width=13) (actual time=0.036..0.036 rows=3 loops=20)
                      Sort Key: c.name, c.code
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=120
                      ->  Hash Join  (cost=16.07..21.24 rows=3 width=13) (actual time=0.011..0.034 rows=3 loops=20)
                            Hash Cond: (c.code = g.country_code)
                            Buffers: shared hit=120
                            ->  Seq Scan on countries c  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.014 rows=250 loops=20)
                                  Buffers: shared hit=40
                            ->  Hash  (cost=16.03..16.03 rows=3 width=3) (actual time=0.005..0.005 rows=3 loops=20)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=80
                                  ->  Bitmap Heap Scan on organization_geographies g  (cost=4.45..16.03 rows=3 width=3) (actual time=0.004..0.005 rows=3 loops=20)
                                        Recheck Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                        Heap Blocks: exact=20
                                        Buffers: shared hit=80
                                        ->  Bitmap Index Scan on organization_geographies_pkey  (cost=0.00..4.45 rows=3 width=0) (actual time=0.003..0.003 rows=3 loops=20)
                                              Index Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                              Buffers: shared hit=60
        SubPlan 7
          ->  Aggregate  (cost=58.73..58.74 rows=1 width=32) (actual time=0.086..0.086 rows=1 loops=20)
                Buffers: shared hit=409
                ->  Limit  (cost=58.69..58.70 rows=5 width=46) (actual time=0.080..0.080 rows=5 loops=20)
                      Buffers: shared hit=409
                      ->  Sort  (cost=58.69..58.71 rows=8 width=46) (actual time=0.080..0.080 rows=5 loops=20)
                            Sort Key: (COALESCE(sum(a.available), '0'::bigint)) DESC, oc.label, oc.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=409
                            ->  GroupAggregate  (cost=46.84..58.57 rows=8 width=46) (actual time=0.073..0.076 rows=9 loops=20)
                                  Group Key: oc.code
                                  Buffers: shared hit=409
                                  ->  Merge Left Join  (cost=46.84..58.45 rows=8 width=42) (actual time=0.072..0.074 rows=9 loops=20)
                                        Merge Cond: (oo.occupation_id = a.occupation_id)
                                        Buffers: shared hit=409
                                        ->  Sort  (cost=46.55..46.57 rows=8 width=59) (actual time=0.069..0.069 rows=9 loops=20)
                                              Sort Key: oo.occupation_id
                                              Sort Method: quicksort  Memory: 25kB
                                              Buffers: shared hit=366
                                              ->  Hash Join  (cost=34.91..46.43 rows=8 width=59) (actual time=0.024..0.065 rows=9 loops=20)
                                                    Hash Cond: (oc.code = oo.occupation_id)
                                                    Buffers: shared hit=366
                                                    ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.026 rows=436 loops=20)
                                                          Buffers: shared hit=120
                                                    ->  Hash  (cost=34.81..34.81 rows=8 width=21) (actual time=0.013..0.013 rows=9 loops=20)
                                                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                          Buffers: shared hit=246
                                                          ->  Bitmap Heap Scan on organization_occupations oo  (cost=4.48..34.81 rows=8 width=21) (actual time=0.006..0.012 rows=9 loops=20)
                                                                Recheck Cond: (organization_id = r.id)
                                                                Heap Blocks: exact=186
                                                                Buffers: shared hit=246
                                                                ->  Bitmap Index Scan on organization_occupations_pkey  (cost=0.00..4.47 rows=8 width=0) (actual time=0.004..0.004 rows=9 loops=20)
                                                                      Index Cond: (organization_id = r.id)
                                                                      Buffers: shared hit=60
                                        ->  Index Scan using workforce_availability_listing_key on workforce_availability a  (cost=0.29..11.85 rows=2 width=25) (actual time=0.004..0.004 rows=0 loops=20)
                                              Index Cond: (organization_id = r.id)
                                              Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                              Rows Removed by Filter: 0
                                              Buffers: shared hit=43
        SubPlan 8
          ->  Aggregate  (cost=11.68..11.69 rows=1 width=32) (actual time=0.005..0.005 rows=1 loops=20)
                Buffers: shared hit=65
                ->  Sort  (cost=11.66..11.67 rows=2 width=4) (actual time=0.005..0.005 rows=2 loops=20)
                      Sort Key: st_2.service
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=65
                      ->  Bitmap Heap Scan on organization_service_types st_2  (cost=4.30..11.65 rows=2 width=4) (actual time=0.003..0.004 rows=2 loops=20)
                            Recheck Cond: (organization_id = r.id)
                            Filter: (service <> 'staffing'::public.partner_service_type)
                            Rows Removed by Filter: 0
                            Heap Blocks: exact=25
                            Buffers: shared hit=65
                            ->  Bitmap Index Scan on organization_service_types_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.003..0.003 rows=2 loops=20)
                                  Index Cond: (organization_id = r.id)
                                  Buffers: shared hit=40
        SubPlan 9
          ->  Aggregate  (cost=24.51..24.52 rows=1 width=32) (actual time=0.010..0.010 rows=1 loops=20)
                Buffers: shared hit=57
                ->  Limit  (cost=24.49..24.50 rows=2 width=54) (actual time=0.009..0.009 rows=0 loops=20)
                      Buffers: shared hit=57
                      ->  Sort  (cost=24.49..24.50 rows=2 width=54) (actual time=0.009..0.009 rows=0 loops=20)
                            Sort Key: (sum(a_1.available)) DESC, oc_1.label, oc_1.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=57
                            ->  GroupAggregate  (cost=24.44..24.48 rows=2 width=54) (actual time=0.008..0.008 rows=0 loops=20)
                                  Group Key: oc_1.code
                                  Buffers: shared hit=57
                                  ->  Sort  (cost=24.44..24.45 rows=2 width=50) (actual time=0.007..0.008 rows=0 loops=20)
                                        Sort Key: oc_1.code
                                        Sort Method: quicksort  Memory: 25kB
                                        Buffers: shared hit=57
                                        ->  Hash Join  (cost=11.87..24.43 rows=2 width=50) (actual time=0.005..0.007 rows=0 loops=20)
                                              Hash Cond: (oc_1.code = a_1.occupation_id)
                                              Buffers: shared hit=57
                                              ->  Seq Scan on occupations oc_1  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.017 rows=291 loops=3)
                                                    Buffers: shared hit=14
                                              ->  Hash  (cost=11.85..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=0 loops=20)
                                                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                    Buffers: shared hit=43
                                                    ->  Index Scan using workforce_availability_listing_key on workforce_availability a_1  (cost=0.29..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=0 loops=20)
                                                          Index Cond: (organization_id = r.id)
                                                          Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                                          Rows Removed by Filter: 0
                                                          Buffers: shared hit=43
        SubPlan 10
          ->  Aggregate  (cost=11.85..11.86 rows=1 width=8) (actual time=0.002..0.002 rows=1 loops=20)
                Buffers: shared hit=43
                ->  Index Scan using workforce_availability_source_idx on workforce_availability a_2  (cost=0.29..11.85 rows=2 width=8) (actual time=0.002..0.002 rows=0 loops=20)
                      Index Cond: (organization_id = r.id)
                      Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                      Rows Removed by Filter: 0
                      Buffers: shared hit=43
```

### staffing: destination, staffing type

```
duration: 8.080 ms  plan:
Sort  (cost=93473.27..93473.29 rows=7 width=333) (actual time=8.061..8.071 rows=20 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 40kB
  Buffers: shared hit=2260
  CTE numbered
    ->  WindowAgg  (cost=92076.74..92575.74 rows=21 width=120) (actual time=4.626..4.987 rows=21 loops=1)
          Buffers: shared hit=1559
          ->  Subquery Scan on p  (cost=92051.79..92575.32 rows=21 width=112) (actual time=4.622..4.974 rows=21 loops=1)
                Buffers: shared hit=1559
                ->  Limit  (cost=92051.79..92575.32 rows=21 width=112) (actual time=4.621..4.972 rows=21 loops=1)
                      Buffers: shared hit=1559
                      ->  Result  (cost=92051.79..124336.14 rows=1295 width=112) (actual time=4.621..4.970 rows=21 loops=1)
                            Buffers: shared hit=1559
                            ->  Sort  (cost=92051.79..92055.03 rows=1295 width=79) (actual time=4.194..4.196 rows=21 loops=1)
                                  Sort Key: (cardinality(array_remove(ARRAY['destination'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, CASE WHEN (ANY (o.id = (hashed SubPlan 6).col1)) THEN 'staffing_type'::text ELSE NULL::text END, NULL::text, NULL::text, NULL::text], NULL::text))) DESC, (COALESCE(o.workforce_profile_updated_at, o.listed_at)) DESC, o.id
                                  Sort Method: top-N heapsort  Memory: 30kB
                                  Buffers: shared hit=1243
                                  ->  Nested Loop Left Join  (cost=532.37..92016.88 rows=1295 width=79) (actual time=2.671..4.002 rows=838 loops=1)
                                        Buffers: shared hit=1243
                                        ->  Bitmap Heap Scan on organizations o  (cost=532.37..81232.77 rows=1295 width=75) (actual time=2.203..3.137 rows=838 loops=1)
                                              Recheck Cond: ((status = 'active'::public.organization_status) AND (listed_at IS NOT NULL) AND (review_status <> 'declined'::public.partner_review_status) AND (moderation_state = 'visible'::public.job_moderation_state))
                                              Filter: (((type = 'staffing_company'::public.organization_type) OR ((type = 'recruitment_company'::public.organization_type) AND (ANY (id = (hashed SubPlan 8).col1)))) AND (ANY (id = (hashed SubPlan 10).col1)))
                                              Rows Removed by Filter: 4112
                                              Heap Blocks: exact=273
                                              Buffers: shared hit=1085
                                              ->  Bitmap Index Scan on organizations_public_profile_slug_idx  (cost=0.00..532.04 rows=4752 width=0) (actual time=0.320..0.320 rows=9125 loops=1)
                                                    Buffers: shared hit=71
                                              SubPlan 8
                                                ->  Seq Scan on organization_service_types st_3  (cost=0.00..224.74 rows=856 width=16) (actual time=0.270..0.339 rows=856 loops=1)
                                                      Filter: (service = 'staffing'::public.partner_service_type)
                                                      Rows Removed by Filter: 4483
                                                      Buffers: shared hit=158
                                              SubPlan 10
                                                ->  Bitmap Heap Scan on organization_geographies g  (cost=65.08..1254.63 rows=1094 width=16) (actual time=0.691..1.045 rows=2225 loops=1)
                                                      Recheck Cond: (country_code = 'DE'::text)
                                                      Filter: (scope = 'serves_market'::public.geography_scope)
                                                      Heap Blocks: exact=575
                                                      Buffers: shared hit=583
                                                      ->  Bitmap Index Scan on organization_geographies_country_idx  (cost=0.00..64.81 rows=2202 width=0) (actual time=0.131..0.131 rows=8900 loops=1)
                                                            Index Cond: (country_code = 'DE'::text)
                                                            Buffers: shared hit=8
                                        ->  Limit  (cost=0.00..0.00 rows=1 width=1) (actual time=0.000..0.000 rows=0 loops=838)
                                              ->  Result  (cost=0.00..0.00 rows=0 width=1) (actual time=0.000..0.000 rows=0 loops=838)
                                                    One-Time Filter: false
                                        SubPlan 6
                                          ->  Seq Scan on organization_service_types st_2  (cost=0.00..218.06 rows=1103 width=16) (actual time=0.090..0.364 rows=1103 loops=1)
                                                Filter: (service = ANY ('{temporary}'::public.partner_service_type[]))
                                                Rows Removed by Filter: 4236
                                                Buffers: shared hit=158
                            SubPlan 2
                              ->  Seq Scan on organization_service_types st  (cost=0.00..224.74 rows=856 width=16) (actual time=0.195..0.250 rows=856 loops=1)
                                    Filter: (service = 'staffing'::public.partner_service_type)
                                    Rows Removed by Filter: 4483
                                    Buffers: shared hit=158
                            SubPlan 4
                              ->  Seq Scan on organization_service_types st_1  (cost=0.00..218.06 rows=1103 width=16) (actual time=0.073..0.314 rows=1103 loops=1)
                                    Filter: (service = ANY ('{temporary}'::public.partner_service_type[]))
                                    Rows Removed by Filter: 4236
                                    Buffers: shared hit=158
  InitPlan 17
    ->  CTE Scan on numbered x  (cost=0.00..0.47 rows=7 width=0) (actual time=0.003..0.003 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  CTE Scan on numbered r  (cost=0.00..897.36 rows=7 width=333) (actual time=4.819..8.056 rows=20 loops=1)
        Filter: (n <= 20)
        Rows Removed by Filter: 1
        Buffers: shared hit=2260
        SubPlan 12
          ->  Aggregate  (cost=21.29..21.30 rows=1 width=32) (actual time=0.042..0.042 rows=1 loops=20)
                Buffers: shared hit=120
                ->  Sort  (cost=21.26..21.27 rows=3 width=13) (actual time=0.036..0.036 rows=4 loops=20)
                      Sort Key: c.name, c.code
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=120
                      ->  Hash Join  (cost=16.07..21.24 rows=3 width=13) (actual time=0.008..0.033 rows=4 loops=20)
                            Hash Cond: (c.code = g_1.country_code)
                            Buffers: shared hit=120
                            ->  Seq Scan on countries c  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.014 rows=250 loops=20)
                                  Buffers: shared hit=40
                            ->  Hash  (cost=16.03..16.03 rows=3 width=3) (actual time=0.004..0.004 rows=4 loops=20)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=80
                                  ->  Bitmap Heap Scan on organization_geographies g_1  (cost=4.45..16.03 rows=3 width=3) (actual time=0.003..0.003 rows=4 loops=20)
                                        Recheck Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                        Heap Blocks: exact=20
                                        Buffers: shared hit=80
                                        ->  Bitmap Index Scan on organization_geographies_pkey  (cost=0.00..4.45 rows=3 width=0) (actual time=0.002..0.002 rows=4 loops=20)
                                              Index Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                              Buffers: shared hit=60
        SubPlan 13
          ->  Aggregate  (cost=58.73..58.74 rows=1 width=32) (actual time=0.087..0.087 rows=1 loops=20)
                Buffers: shared hit=398
                ->  Limit  (cost=58.69..58.70 rows=5 width=46) (actual time=0.080..0.081 rows=5 loops=20)
                      Buffers: shared hit=398
                      ->  Sort  (cost=58.69..58.71 rows=8 width=46) (actual time=0.080..0.080 rows=5 loops=20)
                            Sort Key: (COALESCE(sum(a.available), '0'::bigint)) DESC, oc.label, oc.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=398
                            ->  GroupAggregate  (cost=46.84..58.57 rows=8 width=46) (actual time=0.074..0.077 rows=9 loops=20)
                                  Group Key: oc.code
                                  Buffers: shared hit=398
                                  ->  Merge Left Join  (cost=46.84..58.45 rows=8 width=42) (actual time=0.073..0.075 rows=9 loops=20)
                                        Merge Cond: (oo.occupation_id = a.occupation_id)
                                        Buffers: shared hit=398
                                        ->  Sort  (cost=46.55..46.57 rows=8 width=59) (actual time=0.069..0.070 rows=9 loops=20)
                                              Sort Key: oo.occupation_id
                                              Sort Method: quicksort  Memory: 25kB
                                              Buffers: shared hit=352
                                              ->  Hash Join  (cost=34.91..46.43 rows=8 width=59) (actual time=0.026..0.066 rows=9 loops=20)
                                                    Hash Cond: (oc.code = oo.occupation_id)
                                                    Buffers: shared hit=352
                                                    ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.026 rows=436 loops=20)
                                                          Buffers: shared hit=120
                                                    ->  Hash  (cost=34.81..34.81 rows=8 width=21) (actual time=0.014..0.014 rows=9 loops=20)
                                                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                          Buffers: shared hit=232
                                                          ->  Bitmap Heap Scan on organization_occupations oo  (cost=4.48..34.81 rows=8 width=21) (actual time=0.006..0.013 rows=9 loops=20)
                                                                Recheck Cond: (organization_id = r.id)
                                                                Heap Blocks: exact=172
                                                                Buffers: shared hit=232
                                                                ->  Bitmap Index Scan on organization_occupations_pkey  (cost=0.00..4.47 rows=8 width=0) (actual time=0.004..0.004 rows=9 loops=20)
                                                                      Index Cond: (organization_id = r.id)
                                                                      Buffers: shared hit=60
                                        ->  Index Scan using workforce_availability_listing_key on workforce_availability a  (cost=0.29..11.85 rows=2 width=25) (actual time=0.003..0.004 rows=0 loops=20)
                                              Index Cond: (organization_id = r.id)
                                              Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                              Rows Removed by Filter: 0
                                              Buffers: shared hit=46
        SubPlan 14
          ->  Aggregate  (cost=11.68..11.69 rows=1 width=32) (actual time=0.005..0.005 rows=1 loops=20)
                Buffers: shared hit=65
                ->  Sort  (cost=11.66..11.67 rows=2 width=4) (actual time=0.004..0.004 rows=2 loops=20)
                      Sort Key: st_4.service
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=65
                      ->  Bitmap Heap Scan on organization_service_types st_4  (cost=4.30..11.65 rows=2 width=4) (actual time=0.003..0.003 rows=2 loops=20)
                            Recheck Cond: (organization_id = r.id)
                            Filter: (service <> 'staffing'::public.partner_service_type)
                            Rows Removed by Filter: 0
                            Heap Blocks: exact=25
                            Buffers: shared hit=65
                            ->  Bitmap Index Scan on organization_service_types_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.002..0.002 rows=2 loops=20)
                                  Index Cond: (organization_id = r.id)
                                  Buffers: shared hit=40
        SubPlan 15
          ->  Aggregate  (cost=24.51..24.52 rows=1 width=32) (actual time=0.015..0.015 rows=1 loops=20)
                Buffers: shared hit=72
                ->  Limit  (cost=24.49..24.50 rows=2 width=54) (actual time=0.013..0.013 rows=0 loops=20)
                      Buffers: shared hit=72
                      ->  Sort  (cost=24.49..24.50 rows=2 width=54) (actual time=0.013..0.013 rows=0 loops=20)
                            Sort Key: (sum(a_1.available)) DESC, oc_1.label, oc_1.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=72
                            ->  GroupAggregate  (cost=24.44..24.48 rows=2 width=54) (actual time=0.012..0.013 rows=0 loops=20)
                                  Group Key: oc_1.code
                                  Buffers: shared hit=72
                                  ->  Sort  (cost=24.44..24.45 rows=2 width=50) (actual time=0.012..0.012 rows=0 loops=20)
                                        Sort Key: oc_1.code
                                        Sort Method: quicksort  Memory: 25kB
                                        Buffers: shared hit=72
                                        ->  Hash Join  (cost=11.87..24.43 rows=2 width=50) (actual time=0.005..0.011 rows=0 loops=20)
                                              Hash Cond: (oc_1.code = a_1.occupation_id)
                                              Buffers: shared hit=72
                                              ->  Seq Scan on occupations oc_1  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.020 rows=349 loops=5)
                                                    Buffers: shared hit=26
                                              ->  Hash  (cost=11.85..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=0 loops=20)
                                                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                    Buffers: shared hit=46
                                                    ->  Index Scan using workforce_availability_listing_key on workforce_availability a_1  (cost=0.29..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=0 loops=20)
                                                          Index Cond: (organization_id = r.id)
                                                          Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                                          Rows Removed by Filter: 0
                                                          Buffers: shared hit=46
        SubPlan 16
          ->  Aggregate  (cost=11.85..11.86 rows=1 width=8) (actual time=0.003..0.003 rows=1 loops=20)
                Buffers: shared hit=46
                ->  Index Scan using workforce_availability_source_idx on workforce_availability a_2  (cost=0.29..11.85 rows=2 width=8) (actual time=0.002..0.002 rows=0 loops=20)
                      Index Cond: (organization_id = r.id)
                      Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                      Rows Removed by Filter: 0
                      Buffers: shared hit=46
```

### staffing: four filters

```
duration: 7.460 ms  plan:
Sort  (cost=128149.43..128149.45 rows=7 width=333) (actual time=7.445..7.451 rows=20 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 40kB
  Buffers: shared hit=4139
  CTE numbered
    ->  WindowAgg  (cost=126752.50..127251.90 rows=21 width=120) (actual time=4.097..4.505 rows=21 loops=1)
          Buffers: shared hit=3441
          ->  Subquery Scan on p  (cost=126727.53..127251.48 rows=21 width=112) (actual time=4.095..4.495 rows=21 loops=1)
                Buffers: shared hit=3441
                ->  Limit  (cost=126727.53..127251.48 rows=21 width=112) (actual time=4.095..4.492 rows=21 loops=1)
                      Buffers: shared hit=3441
                      ->  Result  (cost=126727.53..142870.18 rows=647 width=112) (actual time=4.095..4.490 rows=21 loops=1)
                            Buffers: shared hit=3441
                            ->  Sort  (cost=126727.53..126729.15 rows=647 width=83) (actual time=3.800..3.803 rows=21 loops=1)
                                  Sort Key: (cardinality(array_remove(ARRAY['destination'::text, 'occupation'::text, NULL::text, NULL::text, CASE WHEN (ANY (o.id = (hashed SubPlan 6).col1)) THEN 'industry'::text ELSE NULL::text END, NULL::text, NULL::text, NULL::text, CASE WHEN ((o.workforce_size_band)::text = '50_249'::text) THEN 'workforce_size'::text ELSE NULL::text END, NULL::text, NULL::text], NULL::text))) DESC, (COALESCE(o.workforce_profile_updated_at, o.listed_at)) DESC, o.id
                                  Sort Method: quicksort  Memory: 28kB
                                  Buffers: shared hit=2929
                                  ->  Nested Loop Left Join  (cost=532.20..126710.09 rows=647 width=83) (actual time=3.068..3.783 rows=30 loops=1)
                                        Buffers: shared hit=2929
                                        ->  Bitmap Heap Scan on organizations o  (cost=532.20..121315.72 rows=647 width=79) (actual time=2.565..3.257 rows=30 loops=1)
                                              Recheck Cond: ((status = 'active'::public.organization_status) AND (listed_at IS NOT NULL) AND (review_status <> 'declined'::public.partner_review_status) AND (moderation_state = 'visible'::public.job_moderation_state))
                                              Filter: (((type = 'staffing_company'::public.organization_type) OR ((type = 'recruitment_company'::public.organization_type) AND (ANY (id = (hashed SubPlan 8).col1)))) AND (ANY (id = (hashed SubPlan 12).col1)) AND (ANY (id = (hashed SubPlan 10).col1)))
                                              Rows Removed by Filter: 4920
                                              Heap Blocks: exact=273
                                              Buffers: shared hit=2575
                                              ->  Bitmap Index Scan on organizations_public_profile_slug_idx  (cost=0.00..532.04 rows=4752 width=0) (actual time=0.264..0.264 rows=9125 loops=1)
                                                    Buffers: shared hit=71
                                              SubPlan 8
                                                ->  Seq Scan on organization_service_types st_1  (cost=0.00..224.74 rows=856 width=16) (actual time=0.245..0.308 rows=856 loops=1)
                                                      Filter: (service = 'staffing'::public.partner_service_type)
                                                      Rows Removed by Filter: 4483
                                                      Buffers: shared hit=158
                                              SubPlan 12
                                                ->  Bitmap Heap Scan on organization_occupations oo  (cost=175.66..1555.82 rows=935 width=16) (actual time=1.026..1.341 rows=918 loops=1)
                                                      Recheck Cond: (occupation_id = '8332'::text)
                                                      Heap Blocks: exact=1378
                                                      Buffers: shared hit=1402
                                                      ->  Bitmap Index Scan on organization_occupations_occupation_idx  (cost=0.00..175.43 rows=935 width=0) (actual time=0.218..0.218 rows=3672 loops=1)
                                                            Index Cond: (occupation_id = '8332'::text)
                                                            Buffers: shared hit=24
                                              SubPlan 10
                                                ->  Index Only Scan using organization_geographies_scope_country_idx on organization_geographies g  (cost=0.41..571.19 rows=323 width=16) (actual time=0.009..0.232 rows=662 loops=1)
                                                      Index Cond: ((scope = 'serves_market'::public.geography_scope) AND (country_code = 'NL'::text))
                                                      Heap Fetches: 662
                                                      Buffers: shared hit=671
                                        ->  Limit  (cost=0.00..0.00 rows=1 width=1) (actual time=0.000..0.000 rows=0 loops=30)
                                              ->  Result  (cost=0.00..0.00 rows=0 width=1) (actual time=0.000..0.000 rows=0 loops=30)
                                                    One-Time Filter: false
                                        SubPlan 6
                                          ->  Bitmap Heap Scan on organization_industries i_1  (cost=76.42..438.54 rows=518 width=16) (actual time=0.325..0.443 rows=518 loops=1)
                                                Recheck Cond: (industry_code = 'H'::text)
                                                Heap Blocks: exact=340
                                                Buffers: shared hit=354
                                                ->  Bitmap Index Scan on organization_industries_industry_idx  (cost=0.00..76.30 rows=518 width=0) (actual time=0.086..0.086 rows=2072 loops=1)
                                                      Index Cond: (industry_code = 'H'::text)
                                                      Buffers: shared hit=14
                            SubPlan 2
                              ->  Seq Scan on organization_service_types st  (cost=0.00..224.74 rows=856 width=16) (actual time=0.228..0.287 rows=856 loops=1)
                                    Filter: (service = 'staffing'::public.partner_service_type)
                                    Rows Removed by Filter: 4483
                                    Buffers: shared hit=158
                            SubPlan 4
                              ->  Bitmap Heap Scan on organization_industries i  (cost=76.42..438.54 rows=518 width=16) (actual time=0.171..0.238 rows=518 loops=1)
                                    Recheck Cond: (industry_code = 'H'::text)
                                    Heap Blocks: exact=340
                                    Buffers: shared hit=354
                                    ->  Bitmap Index Scan on organization_industries_industry_idx  (cost=0.00..76.30 rows=518 width=0) (actual time=0.067..0.067 rows=2072 loops=1)
                                          Index Cond: (industry_code = 'H'::text)
                                          Buffers: shared hit=14
  InitPlan 19
    ->  CTE Scan on numbered x  (cost=0.00..0.47 rows=7 width=0) (actual time=0.003..0.003 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  CTE Scan on numbered r  (cost=0.00..897.36 rows=7 width=333) (actual time=4.278..7.437 rows=20 loops=1)
        Filter: (n <= 20)
        Rows Removed by Filter: 1
        Buffers: shared hit=4139
        SubPlan 14
          ->  Aggregate  (cost=21.29..21.30 rows=1 width=32) (actual time=0.044..0.044 rows=1 loops=20)
                Buffers: shared hit=121
                ->  Sort  (cost=21.26..21.27 rows=3 width=13) (actual time=0.037..0.037 rows=4 loops=20)
                      Sort Key: c.name, c.code
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=121
                      ->  Hash Join  (cost=16.07..21.24 rows=3 width=13) (actual time=0.010..0.034 rows=4 loops=20)
                            Hash Cond: (c.code = g_1.country_code)
                            Buffers: shared hit=121
                            ->  Seq Scan on countries c  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.015 rows=250 loops=20)
                                  Buffers: shared hit=40
                            ->  Hash  (cost=16.03..16.03 rows=3 width=3) (actual time=0.005..0.005 rows=4 loops=20)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=81
                                  ->  Bitmap Heap Scan on organization_geographies g_1  (cost=4.45..16.03 rows=3 width=3) (actual time=0.003..0.003 rows=4 loops=20)
                                        Recheck Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                        Heap Blocks: exact=21
                                        Buffers: shared hit=81
                                        ->  Bitmap Index Scan on organization_geographies_pkey  (cost=0.00..4.45 rows=3 width=0) (actual time=0.002..0.002 rows=4 loops=20)
                                              Index Cond: ((organization_id = r.id) AND (scope = 'serves_market'::public.geography_scope))
                                              Buffers: shared hit=60
        SubPlan 15
          ->  Aggregate  (cost=58.73..58.74 rows=1 width=32) (actual time=0.081..0.081 rows=1 loops=20)
                Buffers: shared hit=405
                ->  Limit  (cost=58.69..58.70 rows=5 width=46) (actual time=0.075..0.075 rows=5 loops=20)
                      Buffers: shared hit=405
                      ->  Sort  (cost=58.69..58.71 rows=8 width=46) (actual time=0.075..0.075 rows=5 loops=20)
                            Sort Key: (COALESCE(sum(a.available), '0'::bigint)) DESC, oc.label, oc.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=405
                            ->  GroupAggregate  (cost=46.84..58.57 rows=8 width=46) (actual time=0.068..0.071 rows=9 loops=20)
                                  Group Key: oc.code
                                  Buffers: shared hit=405
                                  ->  Merge Left Join  (cost=46.84..58.45 rows=8 width=42) (actual time=0.067..0.069 rows=9 loops=20)
                                        Merge Cond: (oo_1.occupation_id = a.occupation_id)
                                        Buffers: shared hit=405
                                        ->  Sort  (cost=46.55..46.57 rows=8 width=59) (actual time=0.064..0.065 rows=9 loops=20)
                                              Sort Key: oo_1.occupation_id
                                              Sort Method: quicksort  Memory: 25kB
                                              Buffers: shared hit=361
                                              ->  Hash Join  (cost=34.91..46.43 rows=8 width=59) (actual time=0.021..0.061 rows=9 loops=20)
                                                    Hash Cond: (oc.code = oo_1.occupation_id)
                                                    Buffers: shared hit=361
                                                    ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.026 rows=436 loops=20)
                                                          Buffers: shared hit=120
                                                    ->  Hash  (cost=34.81..34.81 rows=8 width=21) (actual time=0.011..0.011 rows=9 loops=20)
                                                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                          Buffers: shared hit=241
                                                          ->  Bitmap Heap Scan on organization_occupations oo_1  (cost=4.48..34.81 rows=8 width=21) (actual time=0.005..0.009 rows=9 loops=20)
                                                                Recheck Cond: (organization_id = r.id)
                                                                Heap Blocks: exact=181
                                                                Buffers: shared hit=241
                                                                ->  Bitmap Index Scan on organization_occupations_pkey  (cost=0.00..4.47 rows=8 width=0) (actual time=0.004..0.004 rows=9 loops=20)
                                                                      Index Cond: (organization_id = r.id)
                                                                      Buffers: shared hit=60
                                        ->  Index Scan using workforce_availability_listing_key on workforce_availability a  (cost=0.29..11.85 rows=2 width=25) (actual time=0.003..0.003 rows=0 loops=20)
                                              Index Cond: (organization_id = r.id)
                                              Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                              Rows Removed by Filter: 0
                                              Buffers: shared hit=44
        SubPlan 16
          ->  Aggregate  (cost=11.68..11.69 rows=1 width=32) (actual time=0.005..0.005 rows=1 loops=20)
                Buffers: shared hit=63
                ->  Sort  (cost=11.66..11.67 rows=2 width=4) (actual time=0.004..0.004 rows=2 loops=20)
                      Sort Key: st_2.service
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=63
                      ->  Bitmap Heap Scan on organization_service_types st_2  (cost=4.30..11.65 rows=2 width=4) (actual time=0.003..0.003 rows=2 loops=20)
                            Recheck Cond: (organization_id = r.id)
                            Filter: (service <> 'staffing'::public.partner_service_type)
                            Rows Removed by Filter: 0
                            Heap Blocks: exact=23
                            Buffers: shared hit=63
                            ->  Bitmap Index Scan on organization_service_types_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.002..0.002 rows=2 loops=20)
                                  Index Cond: (organization_id = r.id)
                                  Buffers: shared hit=40
        SubPlan 17
          ->  Aggregate  (cost=24.51..24.52 rows=1 width=32) (actual time=0.012..0.012 rows=1 loops=20)
                Buffers: shared hit=64
                ->  Limit  (cost=24.49..24.50 rows=2 width=54) (actual time=0.011..0.011 rows=0 loops=20)
                      Buffers: shared hit=64
                      ->  Sort  (cost=24.49..24.50 rows=2 width=54) (actual time=0.011..0.011 rows=0 loops=20)
                            Sort Key: (sum(a_1.available)) DESC, oc_1.label, oc_1.code
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=64
                            ->  GroupAggregate  (cost=24.44..24.48 rows=2 width=54) (actual time=0.010..0.010 rows=0 loops=20)
                                  Group Key: oc_1.code
                                  Buffers: shared hit=64
                                  ->  Sort  (cost=24.44..24.45 rows=2 width=50) (actual time=0.010..0.010 rows=0 loops=20)
                                        Sort Key: oc_1.code
                                        Sort Method: quicksort  Memory: 25kB
                                        Buffers: shared hit=64
                                        ->  Hash Join  (cost=11.87..24.43 rows=2 width=50) (actual time=0.006..0.009 rows=0 loops=20)
                                              Hash Cond: (oc_1.code = a_1.occupation_id)
                                              Buffers: shared hit=64
                                              ->  Seq Scan on occupations oc_1  (cost=0.00..10.36 rows=436 width=38) (actual time=0.001..0.019 rows=327 loops=4)
                                                    Buffers: shared hit=20
                                              ->  Hash  (cost=11.85..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=0 loops=20)
                                                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                    Buffers: shared hit=44
                                                    ->  Index Scan using workforce_availability_listing_key on workforce_availability a_1  (cost=0.29..11.85 rows=2 width=17) (actual time=0.001..0.001 rows=0 loops=20)
                                                          Index Cond: (organization_id = r.id)
                                                          Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                                                          Rows Removed by Filter: 0
                                                          Buffers: shared hit=44
        SubPlan 18
          ->  Aggregate  (cost=11.85..11.86 rows=1 width=8) (actual time=0.003..0.003 rows=1 loops=20)
                Buffers: shared hit=45
                ->  Index Scan using workforce_availability_source_idx on workforce_availability a_2  (cost=0.29..11.85 rows=2 width=8) (actual time=0.002..0.002 rows=0 loops=20)
                      Index Cond: (organization_id = r.id)
                      Filter: (confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone)
                      Rows Removed by Filter: 0
                      Buffers: shared hit=45
```

### available workforce: 50 welders, Germany, 60 days

```
duration: 1.729 ms  plan:
Sort  (cost=1505.94..1505.95 rows=1 width=144) (actual time=1.720..1.723 rows=20 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 31kB
  Buffers: shared hit=1162
  CTE counted
    ->  Nested Loop  (cost=51.31..1491.06 rows=15 width=43) (actual time=0.395..0.903 rows=33 loops=1)
          Join Filter: (a.organization_id = o_1.id)
          Buffers: shared hit=1042
          ->  Nested Loop  (cost=51.02..1412.55 rows=19 width=55) (actual time=0.388..0.784 rows=37 loops=1)
                Buffers: shared hit=894
                ->  Bitmap Heap Scan on workforce_availability a  (cost=50.60..560.09 rows=105 width=39) (actual time=0.378..0.509 rows=116 loops=1)
                      Recheck Cond: (occupation_id = '7212'::text)
                      Filter: ((confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone) AND (available_from <= '2026-12-26'::date))
                      Rows Removed by Filter: 189
                      Heap Blocks: exact=509
                      Buffers: shared hit=519
                      ->  Bitmap Index Scan on workforce_availability_search_idx  (cost=0.00..50.57 rows=305 width=0) (actual time=0.075..0.075 rows=1220 loops=1)
                            Index Cond: (occupation_id = '7212'::text)
                            Buffers: shared hit=10
                ->  Memoize  (cost=0.42..8.18 rows=1 width=16) (actual time=0.002..0.002 rows=0 loops=116)
                      Cache Key: a.organization_id
                      Cache Mode: logical
                      Hits: 3  Misses: 113  Evictions: 0  Overflows: 0  Memory Usage: 11kB
                      Buffers: shared hit=375
                      ->  Index Only Scan using organization_geographies_scope_country_idx on organization_geographies g  (cost=0.41..8.17 rows=1 width=16) (actual time=0.002..0.002 rows=0 loops=113)
                            Index Cond: ((scope = 'serves_market'::public.geography_scope) AND (country_code = 'DE'::text) AND (organization_id = a.organization_id))
                            Heap Fetches: 36
                            Buffers: shared hit=375
          ->  Index Scan using organizations_pkey on organizations o_1  (cost=0.28..4.10 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=37)
                Index Cond: (id = g.organization_id)
                Filter: ((listed_at IS NOT NULL) AND (type <> 'employer'::public.organization_type) AND (review_status <> 'declined'::public.partner_review_status) AND (status = 'active'::public.organization_status) AND (moderation_state = 'visible'::public.job_moderation_state))
                Rows Removed by Filter: 0
                Buffers: shared hit=148
  CTE numbered
    ->  WindowAgg  (cost=0.60..0.62 rows=2 width=44) (actual time=0.941..0.952 rows=21 loops=1)
          Buffers: shared hit=1042
          ->  Subquery Scan on p  (cost=0.58..0.58 rows=2 width=36) (actual time=0.937..0.942 rows=21 loops=1)
                Buffers: shared hit=1042
                ->  Limit  (cost=0.58..0.58 rows=2 width=36) (actual time=0.936..0.939 rows=21 loops=1)
                      Buffers: shared hit=1042
                      ->  Sort  (cost=0.58..0.58 rows=2 width=36) (actual time=0.936..0.937 rows=21 loops=1)
                            Sort Key: (((f.available_now >= 50))::integer) DESC, f.confirmed_at DESC, f.organization_id
                            Sort Method: quicksort  Memory: 27kB
                            Buffers: shared hit=1042
                            ->  Subquery Scan on f  (cost=0.49..0.57 rows=2 width=36) (actual time=0.924..0.931 rows=29 loops=1)
                                  Buffers: shared hit=1042
                                  ->  HashAggregate  (cost=0.49..0.56 rows=2 width=32) (actual time=0.923..0.927 rows=29 loops=1)
                                        Group Key: c.organization_id
                                        Filter: (sum(c.supply) >= 50)
                                        Batches: 1  Memory Usage: 24kB
                                        Rows Removed by Filter: 3
                                        Buffers: shared hit=1042
                                        ->  CTE Scan on counted c  (cost=0.00..0.30 rows=15 width=36) (actual time=0.396..0.910 rows=33 loops=1)
                                              Buffers: shared hit=1042
  InitPlan 4
    ->  CTE Scan on numbered x  (cost=0.00..0.04 rows=1 width=0) (actual time=0.002..0.002 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  Nested Loop  (cost=0.28..14.21 rows=1 width=144) (actual time=0.994..1.716 rows=20 loops=1)
        Buffers: shared hit=1162
        ->  CTE Scan on numbered r  (cost=0.00..0.04 rows=1 width=44) (actual time=0.942..0.956 rows=20 loops=1)
              Filter: (n <= 20)
              Rows Removed by Filter: 1
              Buffers: shared hit=1042
        ->  Index Scan using organizations_pkey on organizations o  (cost=0.28..8.30 rows=1 width=56) (actual time=0.001..0.001 rows=1 loops=20)
              Index Cond: (id = r.organization_id)
              Buffers: shared hit=80
        SubPlan 3
          ->  Aggregate  (cost=5.82..5.83 rows=1 width=32) (actual time=0.036..0.036 rows=1 loops=20)
                Buffers: shared hit=40
                ->  Sort  (cost=5.81..5.81 rows=1 width=62) (actual time=0.032..0.032 rows=1 loops=20)
                      Sort Key: co.name, c_1.source_country
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=40
                      ->  Hash Join  (cost=0.35..5.80 rows=1 width=62) (actual time=0.016..0.030 rows=1 loops=20)
                            Hash Cond: (co.code = c_1.source_country)
                            Buffers: shared hit=40
                            ->  Seq Scan on countries co  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.014 rows=250 loops=20)
                                  Buffers: shared hit=40
                            ->  Hash  (cost=0.34..0.34 rows=1 width=52) (actual time=0.002..0.002 rows=1 loops=20)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  ->  CTE Scan on counted c_1  (cost=0.00..0.34 rows=1 width=52) (actual time=0.001..0.001 rows=1 loops=20)
                                        Filter: (organization_id = r.organization_id)
                                        Rows Removed by Filter: 32
```

### available workforce: 200 care workers, UAE, 90 days

```
duration: 1.480 ms  plan:
Sort  (cost=1620.88..1620.88 rows=1 width=144) (actual time=1.472..1.474 rows=12 loops=1)
  Sort Key: r.n
  Sort Method: quicksort  Memory: 29kB
  Buffers: shared hit=1892
  CTE counted
    ->  Nested Loop  (cost=561.70..1606.24 rows=12 width=43) (actual time=0.466..0.984 rows=20 loops=1)
          Join Filter: (a.organization_id = o_1.id)
          Buffers: shared hit=1820
          ->  Merge Join  (cost=561.42..1523.29 rows=15 width=55) (actual time=0.460..0.906 rows=24 loops=1)
                Merge Cond: (a.organization_id = g.organization_id)
                Buffers: shared hit=1724
                ->  Sort  (cost=561.01..561.39 rows=153 width=39) (actual time=0.439..0.446 rows=143 loops=1)
                      Sort Key: a.organization_id
                      Sort Method: quicksort  Memory: 32kB
                      Buffers: shared hit=518
                      ->  Bitmap Heap Scan on workforce_availability a  (cost=50.57..555.45 rows=153 width=39) (actual time=0.320..0.424 rows=143 loops=1)
                            Recheck Cond: (occupation_id = '5322'::text)
                            Filter: ((confirmed_at > '2026-08-28 00:10:25.240208+00'::timestamp with time zone) AND (available_from <= '2027-01-25'::date))
                            Rows Removed by Filter: 156
                            Heap Blocks: exact=508
                            Buffers: shared hit=518
                            ->  Bitmap Index Scan on workforce_availability_search_idx  (cost=0.00..50.53 rows=299 width=0) (actual time=0.086..0.086 rows=1196 loops=1)
                                  Index Cond: (occupation_id = '5322'::text)
                                  Buffers: shared hit=10
                ->  Index Only Scan using organization_geographies_scope_country_idx on organization_geographies g  (cost=0.41..959.88 rows=595 width=16) (actual time=0.006..0.397 rows=1186 loops=1)
                      Index Cond: ((scope = 'serves_market'::public.geography_scope) AND (country_code = 'AE'::text))
                      Heap Fetches: 1186
                      Buffers: shared hit=1206
          ->  Index Scan using organizations_pkey on organizations o_1  (cost=0.28..5.50 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=24)
                Index Cond: (id = g.organization_id)
                Filter: ((listed_at IS NOT NULL) AND (type <> 'employer'::public.organization_type) AND (review_status <> 'declined'::public.partner_review_status) AND (status = 'active'::public.organization_status) AND (moderation_state = 'visible'::public.job_moderation_state))
                Rows Removed by Filter: 0
                Buffers: shared hit=96
  CTE numbered
    ->  WindowAgg  (cost=0.46..0.49 rows=1 width=44) (actual time=1.004..1.010 rows=12 loops=1)
          Buffers: shared hit=1820
          ->  Subquery Scan on p  (cost=0.46..0.47 rows=1 width=36) (actual time=1.002..1.005 rows=12 loops=1)
                Buffers: shared hit=1820
                ->  Limit  (cost=0.46..0.47 rows=1 width=36) (actual time=1.002..1.004 rows=12 loops=1)
                      Buffers: shared hit=1820
                      ->  Sort  (cost=0.46..0.47 rows=1 width=36) (actual time=1.002..1.002 rows=12 loops=1)
                            Sort Key: (((f.available_now >= 200))::integer) DESC, f.confirmed_at DESC, f.organization_id
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=1820
                            ->  Subquery Scan on f  (cost=0.39..0.45 rows=1 width=36) (actual time=0.996..0.999 rows=12 loops=1)
                                  Buffers: shared hit=1820
                                  ->  HashAggregate  (cost=0.39..0.45 rows=1 width=32) (actual time=0.995..0.997 rows=12 loops=1)
                                        Group Key: c.organization_id
                                        Filter: (sum(c.supply) >= 200)
                                        Batches: 1  Memory Usage: 24kB
                                        Rows Removed by Filter: 6
                                        Buffers: shared hit=1820
                                        ->  CTE Scan on counted c  (cost=0.00..0.24 rows=12 width=36) (actual time=0.467..0.988 rows=20 loops=1)
                                              Buffers: shared hit=1820
  InitPlan 4
    ->  CTE Scan on numbered x  (cost=0.00..0.02 rows=1 width=0) (never executed)
          Filter: (n > 20)
  ->  Nested Loop  (cost=0.28..14.12 rows=1 width=144) (actual time=1.063..1.469 rows=12 loops=1)
        Buffers: shared hit=1892
        ->  CTE Scan on numbered r  (cost=0.00..0.02 rows=1 width=44) (actual time=1.004..1.013 rows=12 loops=1)
              Filter: (n <= 20)
              Buffers: shared hit=1820
        ->  Index Scan using organizations_pkey on organizations o  (cost=0.28..8.30 rows=1 width=56) (actual time=0.001..0.001 rows=1 loops=12)
              Index Cond: (id = r.organization_id)
              Buffers: shared hit=48
        SubPlan 3
          ->  Aggregate  (cost=5.75..5.76 rows=1 width=32) (actual time=0.036..0.036 rows=1 loops=12)
                Buffers: shared hit=24
                ->  Sort  (cost=5.74..5.74 rows=1 width=62) (actual time=0.031..0.031 rows=1 loops=12)
                      Sort Key: co.name, c_1.source_country
                      Sort Method: quicksort  Memory: 25kB
                      Buffers: shared hit=24
                      ->  Hash Join  (cost=0.28..5.73 rows=1 width=62) (actual time=0.018..0.029 rows=1 loops=12)
                            Hash Cond: (co.code = c_1.source_country)
                            Buffers: shared hit=24
                            ->  Seq Scan on countries co  (cost=0.00..4.50 rows=250 width=13) (actual time=0.001..0.014 rows=250 loops=12)
                                  Buffers: shared hit=24
                            ->  Hash  (cost=0.27..0.27 rows=1 width=52) (actual time=0.001..0.001 rows=1 loops=12)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  ->  CTE Scan on counted c_1  (cost=0.00..0.27 rows=1 width=52) (actual time=0.000..0.001 rows=1 loops=12)
                                        Filter: (organization_id = r.organization_id)
                                        Rows Removed by Filter: 19
```

