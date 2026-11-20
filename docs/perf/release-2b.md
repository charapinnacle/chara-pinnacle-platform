# Performance: the job order board at 2,000 open requirements (release 2b)

NFR-P3 (network search response time): 95 % of the job order board renders within 500 ms server time at 2,000 open requirements and 5,000 partner organisations, shown with a load test and query plans. This page records the load test of V79 for the board (`list_job_orders`, V39 as recreated by V57) and the job order page (`get_job_order`). Find Partners at 5,000 partners is V78 (`release-2a.md`) and Find Workers at 100,000 profiles is V80.

## Method

- **Data.** `supabase/tests/database/job_order_board_load_fixture.inc` seeds, in a transaction that is rolled back, 400 employers (one in a hundred suspended, one in five on Professional so their requirements may name a second destination, a third with a public company page) with 8,000 workforce requirements: 2,000 open job orders on the marketplace and 6,000 the board must skip (closed, filled, paused, drafts, private requirements and open job orders hidden by moderation). Each requirement has one of 30 destinations (Germany, Poland, the Gulf states and the United Kingdom weighted up; 15 % of those of Professional employers a second one), one or two of 43 common ISCO-08 occupations, one of 12 industries, 10 to 199 workers, a start in the next year, a recruitment type, and 30 % show the company name. The partner network is 5,000 listed recruitment and staffing companies (six in ten on a paid plan) serving one to four destinations with three to ten occupations; they have sent up to eight responses (about 3.5 on average) to each job order that was ever on the marketplace (a tenth withdrawn; 25,000 in all) and one requirement in three has been revealed to one to three of them through an invitation or a shortlist (7,248 reveals). Two partners are measured: an eligible one on the Professional plan that serves Germany, Poland and the Netherlands with welders, care workers and plumbers and had 40 anonymous job orders revealed to it, and one with the same profile on no plan, which sees every job order reduced. The number of partners does not enter a call (the board reads the caller's own profile once), but their responses and reveals are read for every row shown. `setseed` makes every run seed the same marketplace.
- **Calls.** Thirteen typical calls (table below), each as the API role `authenticated` with the partner member's claims, through the same functions as the pages, the partner checks, rate limit, weekly-use record and reveal marking included; the rate-limit window is emptied before each run.
- **Measure.** The server time of each call in the database (`clock_timestamp` around the call), 50 runs per call after one untimed warm-up run, after `analyze` of the seeded tables. The plans are the `EXPLAIN ANALYZE` output of the main statements of each function, taken with `auto_explain` (nested statements) on one more run.
- **Budget.** As for Find Partners, the database is held to 100 ms at the 95th percentile, a fifth of the 500 ms NFR-P3 target, so that the page's rendering and the round trip to PostgREST fit in the rest. The script and the CI test fail above it.

## How to run it

```sh
npm run db:start                                    # the local stack
node scripts/load/job-order-board.mjs --plans       # 50 runs per call, with plans; exit 1 above the budget
node scripts/load/job-order-board.mjs --runs 200    # more runs, no plans
DATABASE_URL=postgres://... node scripts/load/job-order-board.mjs   # a staging copy (never production)
```

CI runs the light version on every change: pgTAP `supabase/tests/database/189_job_order_board_load.test.sql` (part of `npm run db:test`, about 6 seconds) seeds the same marketplace, runs each call once untimed and five times timed, and fails when a call's median is 100 ms or more or one run takes 500 ms, when a page is not full (so no call is timed on an empty answer), when the board lists a requirement that is not an open, visible job order of an active employer or names an employer that neither shows its name nor revealed it to the partner (NFR-S11 at volume), or when the plan shape changes: the open job orders no longer read in their order through `workforce_requirements_job_orders_idx`, or the response count, the reveal, the destination or the occupation of a row no longer read through the key of its table. `164_job_orders_load.test.sql` (V39) keeps timing the list on its own smaller network.

## Results (V79, 17 November 2026)

Local stack: PostgreSQL 17.11 in Docker (8 CPUs, 8 GB) on an Apple M1 Pro, 50 runs per call after a warm-up. The local stack shared by the worktrees lacked the release 2b migrations of V54 to V60, so the run used a copy of its database with every migration up to `20270114100100_network_analytics.sql` applied (the functions measured are those of `20270111100100_moderation_job_orders.sql`).

| Call | Rows | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| eligible: first page | 20 | 9.1 | 10.5 | 15.2 |
| eligible: page of 50 | 50 | 17.1 | 19 | 21.6 |
| eligible: destination | 20 | 12.8 | 14.6 | 17 |
| eligible: destination, occupation, 50 | 16 | 39.9 | 48 | 67.2 |
| eligible: five filters | 15 | 27.3 | 31.3 | 44.2 |
| eligible: sparse filter | 2 | 9.5 | 11 | 11.2 |
| eligible: source country | 50 | 58.5 | 72.3 | 100.8 |
| eligible: deep page (cursor at 1,900) | 50 | 18.3 | 23.8 | 26.5 |
| free: first page | 20 | 7 | 9.4 | 10.3 |
| free: hidden-field filter | 0 | 7 | 12.3 | 16.4 |
| job order: anonymous | 1 | 1 | 2.2 | 3.6 |
| job order: revealed | 1 | 0.9 | 1.7 | 2 |
| job order: no longer open | 1 | 0.4 | 0.6 | 0.8 |

Every call is within the database budget: the slowest 95th percentile is 72.3 ms (a source country filter, which reads every open job order) against 100 ms, and 500 ms for the whole render. No index was added: every table is read through an index or its key, and the time is spent in the per-row functions, not in reading rows. The page itself was not measured under load here (see the operational check below).

What the plans show:

- **Without a filter on a detail** (the first page, a page of 50, a destination, the deep page, the free partner's first page), the selection reads `workforce_requirements_job_orders_idx` in the board's order (`published_at desc, id`) and stops after the page and one row (21 or 51 rows, under 1 ms); the cursor is one primary-key read. The suspended employers are checked through `organizations_pkey` (memoized).
- **The page statement** (`with page as (...)`) reads the 20 or 50 rows by their primary keys and, per row, the reasons (`private.job_order_reasons`: the keys of `requirement_countries` and `requirement_occupations`), the reveal (`requirement_reveals_organization_idx` once, hashed), the countries and occupations through their keys, the response count through `partner_responses_partner_key`, the neutral title and the city check (`private.city_names_organization`) of anonymous rows. These per-row functions are most of the 9 ms of a first page; at 50 rows they stay under 25 ms.
- **With a filter on a detail** (occupation, industry, start dates, recruitment type, source country), only the job orders the partner sees in full are listed, so the reasons are computed for every open job order that passes the other filters until the page is full: the planner takes a bitmap of `workforce_requirements_job_orders_idx` and `workforce_requirements_live_closes_on_idx`, filters, and sorts the matches (quicksort, a few kB). This is the slowest shape (the source country, which most job orders pass, reads all 2,375 open marketplace requirements, the hidden ones included: 58 ms at the median) and the one to watch as the marketplace grows: the cost is linear in the open job orders, about 25 µs each. A destination or an occupation narrows it through `requirement_countries_country_idx` and the keys first.
- **The free partner's hidden-field filter** answers nothing after one pass (7 ms at the median): without a paid plan the reasons are `plan_required` before any lookup.
- **The job order page** reads one row by its primary key; the same per-row functions follow (under 3 ms).
- The durations in the plans below are those of the instrumented run (`log_analyze` with nested statements logs every statement inside every per-row function), so a page that takes 9 ms shows about 58 ms there; compare the rows and the buffers, not the times.

## Operational check at the HTTP level

As for Find Partners (`release-2a.md`), no HTTP load tool is added, so the render time of the board under load is checked by hand on a disposable copy of staging before release 2b goes live, as item 14 of `docs/runbooks/release-2a-go-live.md` does for release 2a. Record the date, the person and the figures in the release record.

1. **A disposable copy of staging** with the release tag's web build, never production and never the shared staging database.
2. **Seed it, committed**, and give a password to the measured partner's member (`board-eligible@load.test`) through the Auth admin API of the copy, so it can sign in:

   ```sh
   { echo "begin;"
     echo "update private.settings set value = 'true' where key in ('release_partner_directories', 'release_job_orders');"
     cat supabase/tests/database/job_order_board_load_fixture.inc
     echo "select pg_temp.seed_job_order_board(2000, 6000, 5000);"
     echo "commit;"; } | psql "$STAGING_COPY_URL" -v ON_ERROR_STOP=1
   ```

3. **Measure.** Signed in as that member (its session cookie in the requests), request `/en/org/board-eligible/job-orders`, `/en/org/board-eligible/job-orders?destination=DE&occupation=7212` and one job order page 100 times each from a host near the web tier (for example `curl -s -o /dev/null -b "$COOKIE" -w '%{time_starttransfer}\n'` in a loop, ten in parallel; on the copy, raise `rate_limit_job_orders_max` first, so the per-user allowance does not answer instead of the page) and take the 95th percentile of the time to first byte. It must be under 500 ms.
4. **Clean up** (or delete the copy): the organisations cascade to their requirements, geographies, occupations, responses, reveals and members, and the seeded users are the `@load.test` addresses:

   ```sh
   psql "$STAGING_COPY_URL" -v ON_ERROR_STOP=1 -c "begin;
     delete from public.organizations where slug like 'board-%';
     delete from auth.users where email like '%@load.test';
     update private.settings set value = 'false' where key in ('release_partner_directories', 'release_job_orders');
     commit;"
   ```

## Query plans

The main statements of each call on the 51st run, from `node scripts/load/job-order-board.mjs --plans` (`auto_explain`, `log_analyze`, `log_buffers`, nested statements; the query text is left out, it is the body of `list_job_orders` and `get_job_order` in `supabase/migrations/20270111100100_moderation_job_orders.sql`). For the board the first plan is the selection (`select coalesce(array_agg(j.id ...))`) and the second the page (`with page as (...)`); for the job order page it is the read of the row.

### eligible: first page

```
duration: 0.122 ms  plan:
Aggregate  (cost=7.03..7.04 rows=1 width=32) (actual time=0.120..0.121 rows=1 loops=1)
  Buffers: shared hit=66
  ->  Limit  (cost=0.57..6.98 rows=21 width=24) (actual time=0.013..0.111 rows=21 loops=1)
        Buffers: shared hit=66
        ->  Nested Loop  (cost=0.57..841.13 rows=2755 width=24) (actual time=0.012..0.109 rows=21 loops=1)
              Buffers: shared hit=66
              ->  Index Scan using workforce_requirements_job_orders_idx on workforce_requirements r  (cost=0.28..554.50 rows=2757 width=40) (actual time=0.006..0.011 rows=21 loops=1)
                    Filter: (moderation_state = 'visible'::public.job_moderation_state)
                    Buffers: shared hit=3
              ->  Memoize  (cost=0.29..0.55 rows=1 width=16) (actual time=0.004..0.004 rows=1 loops=21)
                    Cache Key: r.organization_id
                    Cache Mode: logical
                    Hits: 0  Misses: 21  Evictions: 0  Overflows: 0  Memory Usage: 3kB
                    Buffers: shared hit=63
                    ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.54 rows=1 width=16) (actual time=0.004..0.004 rows=1 loops=21)
                          Index Cond: (id = r.organization_id)
                          Filter: (status = 'active'::public.organization_status)
                          Buffers: shared hit=63
```

```
duration: 58.413 ms  plan:
Nested Loop  (cost=0.57..1563.77 rows=20 width=328) (actual time=8.293..58.334 rows=20 loops=1)
  Buffers: shared hit=2710
  ->  Nested Loop  (cost=0.28..158.20 rows=20 width=99) (actual time=0.012..0.186 rows=20 loops=1)
        Buffers: shared hit=60
        ->  Function Scan on unnest u  (cost=0.00..0.20 rows=20 width=24) (actual time=0.005..0.015 rows=20 loops=1)
        ->  Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..7.90 rows=1 width=91) (actual time=0.007..0.007 rows=1 loops=20)
              Index Cond: (id = u.id)
              Buffers: shared hit=60
  ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.38 rows=1 width=54) (actual time=0.009..0.009 rows=1 loops=20)
        Index Cond: (id = r.organization_id)
        Buffers: shared hit=60
  SubPlan 2
    ->  Bitmap Heap Scan on requirement_reveals rv  (cost=4.56..68.47 rows=36 width=16) (actual time=0.025..0.034 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.017..0.021 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 3
    ->  Sort  (cost=8.31..8.32 rows=1 width=4) (actual time=0.010..0.010 rows=1 loops=2)
          Sort Key: ((rc.country_code <> r.country_code)), rc.country_code
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=7
          ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=4) (actual time=0.004..0.004 rows=1 loops=2)
                Index Cond: (requirement_id = r.id)
                Heap Fetches: 2
                Buffers: shared hit=7
  SubPlan 5
    ->  Bitmap Heap Scan on requirement_reveals rv_1  (cost=4.56..68.47 rows=36 width=16) (actual time=0.041..0.046 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.032..0.032 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 6
    ->  Aggregate  (cost=23.02..23.03 rows=1 width=32) (actual time=0.154..0.155 rows=1 loops=2)
          Buffers: shared hit=19
          ->  Sort  (cost=23.00..23.01 rows=2 width=42) (actual time=0.112..0.114 rows=2 loops=2)
                Sort Key: ro.quantity DESC, oc.label
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=19
                ->  Hash Join  (cost=11.48..22.99 rows=2 width=42) (actual time=0.078..0.104 rows=2 loops=2)
                      Hash Cond: (oc.code = ro.occupation_id)
                      Buffers: shared hit=19
                      ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.008..0.040 rows=436 loops=2)
                            Buffers: shared hit=12
                      ->  Hash  (cost=11.45..11.45 rows=2 width=9) (actual time=0.028..0.028 rows=2 loops=2)
                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                            Buffers: shared hit=7
                            ->  Bitmap Heap Scan on requirement_occupations ro  (cost=4.30..11.45 rows=2 width=9) (actual time=0.009..0.011 rows=2 loops=2)
                                  Recheck Cond: (requirement_id = r.id)
                                  Heap Blocks: exact=3
                                  Buffers: shared hit=7
                                  ->  Bitmap Index Scan on requirement_occupations_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.003..0.003 rows=2 loops=2)
                                        Index Cond: (requirement_id = r.id)
                                        Buffers: shared hit=4
  SubPlan 8
    ->  Bitmap Heap Scan on requirement_reveals rv_2  (cost=4.56..68.47 rows=36 width=16) (actual time=0.019..0.025 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.006..0.007 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 10
    ->  Bitmap Heap Scan on requirement_reveals rv_3  (cost=4.56..68.47 rows=36 width=16) (actual time=0.086..0.142 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.009..0.009 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
```

### eligible: page of 50

```
duration: 0.210 ms  plan:
Aggregate  (cost=16.26..16.27 rows=1 width=32) (actual time=0.208..0.209 rows=1 loops=1)
  Buffers: shared hit=157
  ->  Limit  (cost=0.57..16.13 rows=51 width=24) (actual time=0.020..0.200 rows=51 loops=1)
        Buffers: shared hit=157
        ->  Nested Loop  (cost=0.57..841.13 rows=2755 width=24) (actual time=0.020..0.196 rows=51 loops=1)
              Buffers: shared hit=157
              ->  Index Scan using workforce_requirements_job_orders_idx on workforce_requirements r  (cost=0.28..554.50 rows=2757 width=40) (actual time=0.006..0.020 rows=52 loops=1)
                    Filter: (moderation_state = 'visible'::public.job_moderation_state)
                    Buffers: shared hit=4
              ->  Memoize  (cost=0.29..0.55 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=52)
                    Cache Key: r.organization_id
                    Cache Mode: logical
                    Hits: 1  Misses: 51  Evictions: 0  Overflows: 0  Memory Usage: 7kB
                    Buffers: shared hit=153
                    ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.54 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=51)
                          Index Cond: (id = r.organization_id)
                          Filter: (status = 'active'::public.organization_status)
                          Rows Removed by Filter: 0
                          Buffers: shared hit=153
```

```
duration: 144.883 ms  plan:
Nested Loop  (cost=0.57..3857.42 rows=50 width=328) (actual time=5.300..144.648 rows=50 loops=1)
  Buffers: shared hit=7138
  ->  Nested Loop  (cost=0.28..343.50 rows=50 width=99) (actual time=0.009..0.520 rows=50 loops=1)
        Buffers: shared hit=150
        ->  Function Scan on unnest u  (cost=0.00..0.50 rows=50 width=24) (actual time=0.003..0.028 rows=50 loops=1)
        ->  Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..6.86 rows=1 width=91) (actual time=0.008..0.008 rows=1 loops=50)
              Index Cond: (id = u.id)
              Buffers: shared hit=150
  ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.38 rows=1 width=54) (actual time=0.007..0.007 rows=1 loops=50)
        Index Cond: (id = r.organization_id)
        Buffers: shared hit=150
  SubPlan 2
    ->  Bitmap Heap Scan on requirement_reveals rv  (cost=4.56..68.47 rows=36 width=16) (actual time=0.028..0.034 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.015..0.015 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 3
    ->  Sort  (cost=8.31..8.32 rows=1 width=4) (actual time=0.009..0.009 rows=1 loops=3)
          Sort Key: ((rc.country_code <> r.country_code)), rc.country_code
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=10
          ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=4) (actual time=0.003..0.003 rows=1 loops=3)
                Index Cond: (requirement_id = r.id)
                Heap Fetches: 4
                Buffers: shared hit=10
  SubPlan 5
    ->  Bitmap Heap Scan on requirement_reveals rv_1  (cost=4.56..68.47 rows=36 width=16) (actual time=0.011..0.016 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.005..0.005 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 6
    ->  Aggregate  (cost=23.02..23.03 rows=1 width=32) (actual time=0.112..0.113 rows=1 loops=3)
          Buffers: shared hit=28
          ->  Sort  (cost=23.00..23.01 rows=2 width=42) (actual time=0.095..0.096 rows=2 loops=3)
                Sort Key: ro.quantity DESC, oc.label
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=28
                ->  Hash Join  (cost=11.48..22.99 rows=2 width=42) (actual time=0.063..0.088 rows=2 loops=3)
                      Hash Cond: (oc.code = ro.occupation_id)
                      Buffers: shared hit=28
                      ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.005..0.041 rows=436 loops=3)
                            Buffers: shared hit=18
                      ->  Hash  (cost=11.45..11.45 rows=2 width=9) (actual time=0.010..0.011 rows=2 loops=3)
                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                            Buffers: shared hit=10
                            ->  Bitmap Heap Scan on requirement_occupations ro  (cost=4.30..11.45 rows=2 width=9) (actual time=0.006..0.007 rows=2 loops=3)
                                  Recheck Cond: (requirement_id = r.id)
                                  Heap Blocks: exact=4
                                  Buffers: shared hit=10
                                  ->  Bitmap Index Scan on requirement_occupations_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.003..0.003 rows=2 loops=3)
                                        Index Cond: (requirement_id = r.id)
                                        Buffers: shared hit=6
  SubPlan 8
    ->  Bitmap Heap Scan on requirement_reveals rv_2  (cost=4.56..68.47 rows=36 width=16) (actual time=0.012..0.017 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.005..0.005 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 10
    ->  Bitmap Heap Scan on requirement_reveals rv_3  (cost=4.56..68.47 rows=36 width=16) (actual time=0.005..0.008 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.003..0.003 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
```

### eligible: destination

```
duration: 42.627 ms  plan:
Aggregate  (cost=786.77..786.78 rows=1 width=32) (actual time=42.625..42.626 rows=1 loops=1)
  Buffers: shared hit=1403
  ->  Limit  (cost=0.57..786.72 rows=21 width=24) (actual time=5.267..42.594 rows=21 loops=1)
        Buffers: shared hit=1403
        ->  Nested Loop  (cost=0.57..25756.10 rows=688 width=24) (actual time=5.267..42.584 rows=21 loops=1)
              Buffers: shared hit=1403
              ->  Index Scan using workforce_requirements_job_orders_idx on workforce_requirements r  (cost=0.28..25317.25 rows=689 width=40) (actual time=5.243..42.375 rows=21 loops=1)
                    Filter: ((moderation_state = 'visible'::public.job_moderation_state) AND CASE WHEN (country_code = 'DE'::text) THEN true ELSE (cardinality(private.job_order_reasons(id, true, '{DE,PL,NL}'::text[], '{7212,5322,7126}'::text[])) = 0) END AND (ANY (id = (hashed SubPlan 2).col1)))
                    Rows Removed by Filter: 167
                    Buffers: shared hit=1340
                    SubPlan 2
                      ->  Bitmap Heap Scan on requirement_countries rc  (cost=20.76..87.42 rows=1093 width=16) (actual time=0.687..2.947 rows=1093 loops=1)
                            Recheck Cond: (country_code = 'DE'::text)
                            Heap Blocks: exact=53
                            Buffers: shared hit=55
                            ->  Bitmap Index Scan on requirement_countries_country_idx  (cost=0.00..20.48 rows=1093 width=0) (actual time=0.671..0.671 rows=1093 loops=1)
                                  Index Cond: (country_code = 'DE'::text)
                                  Buffers: shared hit=2
              ->  Memoize  (cost=0.29..1.27 rows=1 width=16) (actual time=0.009..0.009 rows=1 loops=21)
                    Cache Key: r.organization_id
                    Cache Mode: logical
                    Hits: 0  Misses: 21  Evictions: 0  Overflows: 0  Memory Usage: 3kB
                    Buffers: shared hit=63
                    ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..1.26 rows=1 width=16) (actual time=0.007..0.007 rows=1 loops=21)
                          Index Cond: (id = r.organization_id)
                          Filter: (status = 'active'::public.organization_status)
                          Buffers: shared hit=63
```

```
duration: 61.303 ms  plan:
Nested Loop  (cost=0.57..1563.77 rows=20 width=328) (actual time=9.321..61.265 rows=20 loops=1)
  Buffers: shared hit=3700
  ->  Nested Loop  (cost=0.28..158.20 rows=20 width=99) (actual time=0.011..0.208 rows=20 loops=1)
        Buffers: shared hit=60
        ->  Function Scan on unnest u  (cost=0.00..0.20 rows=20 width=24) (actual time=0.004..0.018 rows=20 loops=1)
        ->  Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..7.90 rows=1 width=91) (actual time=0.006..0.006 rows=1 loops=20)
              Index Cond: (id = u.id)
              Buffers: shared hit=60
  ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.38 rows=1 width=54) (actual time=0.005..0.005 rows=1 loops=20)
        Index Cond: (id = r.organization_id)
        Buffers: shared hit=60
  SubPlan 2
    ->  Bitmap Heap Scan on requirement_reveals rv  (cost=4.56..68.47 rows=36 width=16) (actual time=0.013..0.018 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.006..0.006 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 3
    ->  Sort  (cost=8.31..8.32 rows=1 width=4) (actual time=0.008..0.008 rows=2 loops=2)
          Sort Key: ((rc.country_code <> r.country_code)), rc.country_code
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=7
          ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=4) (actual time=0.003..0.004 rows=2 loops=2)
                Index Cond: (requirement_id = r.id)
                Heap Fetches: 3
                Buffers: shared hit=7
  SubPlan 5
    ->  Bitmap Heap Scan on requirement_reveals rv_1  (cost=4.56..68.47 rows=36 width=16) (actual time=0.007..0.011 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.003..0.004 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 6
    ->  Aggregate  (cost=23.02..23.03 rows=1 width=32) (actual time=0.204..0.205 rows=1 loops=2)
          Buffers: shared hit=19
          ->  Sort  (cost=23.00..23.01 rows=2 width=42) (actual time=0.186..0.187 rows=2 loops=2)
                Sort Key: ro.quantity DESC, oc.label
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=19
                ->  Hash Join  (cost=11.48..22.99 rows=2 width=42) (actual time=0.118..0.142 rows=2 loops=2)
                      Hash Cond: (oc.code = ro.occupation_id)
                      Buffers: shared hit=19
                      ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.008..0.064 rows=436 loops=2)
                            Buffers: shared hit=12
                      ->  Hash  (cost=11.45..11.45 rows=2 width=9) (actual time=0.029..0.029 rows=2 loops=2)
                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                            Buffers: shared hit=7
                            ->  Bitmap Heap Scan on requirement_occupations ro  (cost=4.30..11.45 rows=2 width=9) (actual time=0.012..0.013 rows=2 loops=2)
                                  Recheck Cond: (requirement_id = r.id)
                                  Heap Blocks: exact=3
                                  Buffers: shared hit=7
                                  ->  Bitmap Index Scan on requirement_occupations_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.006..0.006 rows=2 loops=2)
                                        Index Cond: (requirement_id = r.id)
                                        Buffers: shared hit=4
  SubPlan 8
    ->  Bitmap Heap Scan on requirement_reveals rv_2  (cost=4.56..68.47 rows=36 width=16) (actual time=0.012..0.017 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.005..0.006 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 10
    ->  Bitmap Heap Scan on requirement_reveals rv_3  (cost=4.56..68.47 rows=36 width=16) (actual time=0.010..0.015 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.005..0.005 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
```

### eligible: destination, occupation, 50

```
duration: 415.999 ms  plan:
Aggregate  (cost=33236.23..33236.24 rows=1 width=32) (actual time=415.995..415.997 rows=1 loops=1)
  Buffers: shared hit=16691
  ->  Limit  (cost=33236.22..33236.22 rows=3 width=24) (actual time=415.986..415.990 rows=16 loops=1)
        Buffers: shared hit=16691
        ->  Sort  (cost=33236.22..33236.22 rows=3 width=24) (actual time=415.985..415.988 rows=16 loops=1)
              Sort Key: r.published_at DESC, r.id
              Sort Method: quicksort  Memory: 26kB
              Buffers: shared hit=16691
              ->  Nested Loop  (cost=199.87..33236.19 rows=3 width=24) (actual time=0.503..415.964 rows=16 loops=1)
                    Buffers: shared hit=16691
                    ->  Bitmap Heap Scan on workforce_requirements r  (cost=199.58..33211.28 rows=3 width=40) (actual time=0.497..415.782 rows=16 loops=1)
                          Recheck Cond: ((status = ANY ('{open,paused}'::public.requirement_status[])) AND (status = 'open'::public.requirement_status) AND (visibility = 'job_order_marketplace'::public.requirement_visibility))
                          Filter: ((moderation_state = 'visible'::public.job_moderation_state) AND (cardinality(private.job_order_reasons(id, true, '{DE,PL,NL}'::text[], '{7212,5322,7126}'::text[])) = 0) AND EXISTS(SubPlan 1) AND EXISTS(SubPlan 3))
                          Rows Removed by Filter: 2361
                          Heap Blocks: exact=64
                          Buffers: shared hit=16643
                          ->  BitmapAnd  (cost=199.58..199.58 rows=1943 width=0) (actual time=0.227..0.228 rows=0 loops=1)
                                Buffers: shared hit=22
                                ->  Bitmap Index Scan on workforce_requirements_live_closes_on_idx  (cost=0.00..91.17 rows=5377 width=0) (actual time=0.139..0.139 rows=5377 loops=1)
                                      Buffers: shared hit=9
                                ->  Bitmap Index Scan on workforce_requirements_job_orders_idx  (cost=0.00..108.17 rows=2892 width=0) (actual time=0.083..0.083 rows=2377 loops=1)
                                      Buffers: shared hit=13
                          SubPlan 1
                            ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=0) (actual time=0.003..0.003 rows=1 loops=90)
                                  Index Cond: ((requirement_id = r.id) AND (country_code = 'DE'::text))
                                  Heap Fetches: 49
                                  Buffers: shared hit=230
                          SubPlan 3
                            ->  Index Only Scan using requirement_occupations_pkey on requirement_occupations ro  (cost=0.29..8.30 rows=1 width=0) (actual time=0.003..0.003 rows=0 loops=49)
                                  Index Cond: ((requirement_id = r.id) AND (occupation_id = '7212'::text))
                                  Heap Fetches: 16
                                  Buffers: shared hit=115
                    ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..8.30 rows=1 width=16) (actual time=0.009..0.009 rows=1 loops=16)
                          Index Cond: (id = r.organization_id)
                          Filter: (status = 'active'::public.organization_status)
                          Buffers: shared hit=48
```

```
duration: 65.849 ms  plan:
Nested Loop  (cost=0.57..1253.38 rows=16 width=328) (actual time=7.912..65.813 rows=16 loops=1)
  Buffers: shared hit=2657
  ->  Nested Loop  (cost=0.28..128.96 rows=16 width=99) (actual time=0.016..0.238 rows=16 loops=1)
        Buffers: shared hit=48
        ->  Function Scan on unnest u  (cost=0.00..0.16 rows=16 width=24) (actual time=0.005..0.014 rows=16 loops=1)
        ->  Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..8.05 rows=1 width=91) (actual time=0.012..0.012 rows=1 loops=16)
              Index Cond: (id = u.id)
              Buffers: shared hit=48
  ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.38 rows=1 width=54) (actual time=0.006..0.006 rows=1 loops=16)
        Index Cond: (id = r.organization_id)
        Buffers: shared hit=48
  SubPlan 2
    ->  Bitmap Heap Scan on requirement_reveals rv  (cost=4.56..68.47 rows=36 width=16) (actual time=0.027..0.032 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.016..0.016 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 3
    ->  Sort  (cost=8.31..8.32 rows=1 width=4) (actual time=0.009..0.010 rows=1 loops=16)
          Sort Key: ((rc.country_code <> r.country_code)), rc.country_code
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=49
          ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=4) (actual time=0.005..0.006 rows=1 loops=16)
                Index Cond: (requirement_id = r.id)
                Heap Fetches: 17
                Buffers: shared hit=49
  SubPlan 5
    ->  Bitmap Heap Scan on requirement_reveals rv_1  (cost=4.56..68.47 rows=36 width=16) (actual time=0.006..0.010 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.003..0.003 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 6
    ->  Aggregate  (cost=23.02..23.03 rows=1 width=32) (actual time=0.112..0.112 rows=1 loops=16)
          Buffers: shared hit=157
          ->  Sort  (cost=23.00..23.01 rows=2 width=42) (actual time=0.099..0.099 rows=2 loops=16)
                Sort Key: ro.quantity DESC, oc.label
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=157
                ->  Hash Join  (cost=11.48..22.99 rows=2 width=42) (actual time=0.060..0.088 rows=2 loops=16)
                      Hash Cond: (oc.code = ro.occupation_id)
                      Buffers: shared hit=157
                      ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.004..0.036 rows=436 loops=16)
                            Buffers: shared hit=96
                      ->  Hash  (cost=11.45..11.45 rows=2 width=9) (actual time=0.012..0.012 rows=2 loops=16)
                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                            Buffers: shared hit=61
                            ->  Bitmap Heap Scan on requirement_occupations ro  (cost=4.30..11.45 rows=2 width=9) (actual time=0.006..0.007 rows=2 loops=16)
                                  Recheck Cond: (requirement_id = r.id)
                                  Heap Blocks: exact=29
                                  Buffers: shared hit=61
                                  ->  Bitmap Index Scan on requirement_occupations_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.003..0.003 rows=2 loops=16)
                                        Index Cond: (requirement_id = r.id)
                                        Buffers: shared hit=32
  SubPlan 8
    ->  Bitmap Heap Scan on requirement_reveals rv_2  (cost=4.56..68.47 rows=36 width=16) (actual time=0.015..0.020 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.007..0.007 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 10
    ->  Bitmap Heap Scan on requirement_reveals rv_3  (cost=4.56..68.47 rows=36 width=16) (actual time=0.023..0.027 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.011..0.011 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
```

### eligible: five filters

```
duration: 177.722 ms  plan:
Aggregate  (cost=33242.48..33242.49 rows=1 width=32) (actual time=177.718..177.721 rows=1 loops=1)
  Buffers: shared hit=9408
  ->  Limit  (cost=33242.47..33242.48 rows=2 width=24) (actual time=177.709..177.713 rows=15 loops=1)
        Buffers: shared hit=9408
        ->  Sort  (cost=33242.47..33242.48 rows=2 width=24) (actual time=177.708..177.711 rows=15 loops=1)
              Sort Key: r.published_at DESC, r.id
              Sort Method: quicksort  Memory: 26kB
              Buffers: shared hit=9408
              ->  Nested Loop  (cost=199.87..33242.46 rows=2 width=24) (actual time=1.126..177.687 rows=15 loops=1)
                    Buffers: shared hit=9408
                    ->  Bitmap Heap Scan on workforce_requirements r  (cost=199.58..33225.85 rows=2 width=40) (actual time=1.118..177.546 rows=15 loops=1)
                          Recheck Cond: ((status = ANY ('{open,paused}'::public.requirement_status[])) AND (status = 'open'::public.requirement_status) AND (visibility = 'job_order_marketplace'::public.requirement_visibility))
                          Filter: ((workers_needed >= 20) AND (start_date >= '2027-01-16'::date) AND (recruitment_preference = ANY ('{both,international}'::public.recruitment_preference[])) AND (moderation_state = 'visible'::public.job_moderation_state) AND (cardinality(private.job_order_reasons(id, true, '{DE,PL,NL}'::text[], '{7212,5322,7126}'::text[])) = 0) AND EXISTS(SubPlan 1) AND EXISTS(SubPlan 3))
                          Rows Removed by Filter: 2362
                          Heap Blocks: exact=64
                          Buffers: shared hit=9363
                          ->  BitmapAnd  (cost=199.58..199.58 rows=1943 width=0) (actual time=0.329..0.330 rows=0 loops=1)
                                Buffers: shared hit=22
                                ->  Bitmap Index Scan on workforce_requirements_live_closes_on_idx  (cost=0.00..91.17 rows=5377 width=0) (actual time=0.163..0.163 rows=5377 loops=1)
                                      Buffers: shared hit=9
                                ->  Bitmap Index Scan on workforce_requirements_job_orders_idx  (cost=0.00..108.17 rows=2892 width=0) (actual time=0.160..0.160 rows=2377 loops=1)
                                      Buffers: shared hit=13
                          SubPlan 1
                            ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=0) (actual time=0.003..0.003 rows=1 loops=54)
                                  Index Cond: ((requirement_id = r.id) AND (country_code = 'DE'::text))
                                  Heap Fetches: 31
                                  Buffers: shared hit=140
                          SubPlan 3
                            ->  Index Only Scan using requirement_occupations_pkey on requirement_occupations ro  (cost=0.29..8.30 rows=1 width=0) (actual time=0.002..0.002 rows=0 loops=31)
                                  Index Cond: ((requirement_id = r.id) AND (occupation_id = '5322'::text))
                                  Heap Fetches: 15
                                  Buffers: shared hit=78
                    ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..8.30 rows=1 width=16) (actual time=0.008..0.008 rows=1 loops=15)
                          Index Cond: (id = r.organization_id)
                          Filter: (status = 'active'::public.organization_status)
                          Buffers: shared hit=45
```

```
duration: 52.682 ms  plan:
Nested Loop  (cost=0.57..1174.79 rows=15 width=328) (actual time=6.555..52.653 rows=15 loops=1)
  Buffers: shared hit=2438
  ->  Nested Loop  (cost=0.28..120.65 rows=15 width=99) (actual time=0.013..0.124 rows=15 loops=1)
        Buffers: shared hit=45
        ->  Function Scan on unnest u  (cost=0.00..0.15 rows=15 width=24) (actual time=0.004..0.012 rows=15 loops=1)
        ->  Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..8.03 rows=1 width=91) (actual time=0.006..0.006 rows=1 loops=15)
              Index Cond: (id = u.id)
              Buffers: shared hit=45
  ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.38 rows=1 width=54) (actual time=0.006..0.006 rows=1 loops=15)
        Index Cond: (id = r.organization_id)
        Buffers: shared hit=45
  SubPlan 2
    ->  Bitmap Heap Scan on requirement_reveals rv  (cost=4.56..68.47 rows=36 width=16) (actual time=0.018..0.023 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.009..0.010 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 3
    ->  Sort  (cost=8.31..8.32 rows=1 width=4) (actual time=0.007..0.007 rows=1 loops=15)
          Sort Key: ((rc.country_code <> r.country_code)), rc.country_code
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=46
          ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=4) (actual time=0.003..0.003 rows=1 loops=15)
                Index Cond: (requirement_id = r.id)
                Heap Fetches: 15
                Buffers: shared hit=46
  SubPlan 5
    ->  Bitmap Heap Scan on requirement_reveals rv_1  (cost=4.56..68.47 rows=36 width=16) (actual time=0.008..0.012 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.004..0.004 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 6
    ->  Aggregate  (cost=23.02..23.03 rows=1 width=32) (actual time=0.100..0.100 rows=1 loops=15)
          Buffers: shared hit=147
          ->  Sort  (cost=23.00..23.01 rows=2 width=42) (actual time=0.086..0.086 rows=2 loops=15)
                Sort Key: ro.quantity DESC, oc.label
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=147
                ->  Hash Join  (cost=11.48..22.99 rows=2 width=42) (actual time=0.052..0.078 rows=2 loops=15)
                      Hash Cond: (oc.code = ro.occupation_id)
                      Buffers: shared hit=147
                      ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.004..0.036 rows=436 loops=15)
                            Buffers: shared hit=90
                      ->  Hash  (cost=11.45..11.45 rows=2 width=9) (actual time=0.011..0.011 rows=2 loops=15)
                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                            Buffers: shared hit=57
                            ->  Bitmap Heap Scan on requirement_occupations ro  (cost=4.30..11.45 rows=2 width=9) (actual time=0.006..0.007 rows=2 loops=15)
                                  Recheck Cond: (requirement_id = r.id)
                                  Heap Blocks: exact=27
                                  Buffers: shared hit=57
                                  ->  Bitmap Index Scan on requirement_occupations_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.003..0.003 rows=2 loops=15)
                                        Index Cond: (requirement_id = r.id)
                                        Buffers: shared hit=30
  SubPlan 8
    ->  Bitmap Heap Scan on requirement_reveals rv_2  (cost=4.56..68.47 rows=36 width=16) (actual time=0.009..0.014 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.004..0.004 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 10
    ->  Bitmap Heap Scan on requirement_reveals rv_3  (cost=4.56..68.47 rows=36 width=16) (actual time=0.005..0.009 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.003..0.003 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
```

### eligible: sparse filter

```
duration: 33.958 ms  plan:
Aggregate  (cost=33471.14..33471.15 rows=1 width=32) (actual time=33.955..33.957 rows=1 loops=1)
  Buffers: shared hit=2142
  ->  Limit  (cost=33471.13..33471.14 rows=1 width=24) (actual time=33.949..33.952 rows=2 loops=1)
        Buffers: shared hit=2142
        ->  Sort  (cost=33471.13..33471.14 rows=1 width=24) (actual time=33.949..33.951 rows=2 loops=1)
              Sort Key: r.published_at DESC, r.id
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=2142
              ->  Nested Loop  (cost=199.58..33471.12 rows=1 width=24) (actual time=8.525..33.943 rows=2 loops=1)
                    Join Filter: (e.id = r.organization_id)
                    Rows Removed by Join Filter: 10496
                    Buffers: shared hit=2142
                    ->  Bitmap Heap Scan on workforce_requirements r  (cost=199.58..33221.00 rows=1 width=40) (actual time=7.076..31.642 rows=2 loops=1)
                          Recheck Cond: ((status = ANY ('{open,paused}'::public.requirement_status[])) AND (status = 'open'::public.requirement_status) AND (visibility = 'job_order_marketplace'::public.requirement_visibility))
                          Filter: ((start_date >= '2027-02-25'::date) AND (start_date <= '2027-03-27'::date) AND (moderation_state = 'visible'::public.job_moderation_state) AND (cardinality(private.job_order_reasons(id, true, '{DE,PL,NL}'::text[], '{7212,5322,7126}'::text[])) = 0) AND EXISTS(SubPlan 1) AND EXISTS(SubPlan 3))
                          Rows Removed by Filter: 2375
                          Heap Blocks: exact=64
                          Buffers: shared hit=1917
                          ->  BitmapAnd  (cost=199.58..199.58 rows=1943 width=0) (actual time=0.198..0.198 rows=0 loops=1)
                                Buffers: shared hit=22
                                ->  Bitmap Index Scan on workforce_requirements_live_closes_on_idx  (cost=0.00..91.17 rows=5377 width=0) (actual time=0.124..0.124 rows=5377 loops=1)
                                      Buffers: shared hit=9
                                ->  Bitmap Index Scan on workforce_requirements_job_orders_idx  (cost=0.00..108.17 rows=2892 width=0) (actual time=0.069..0.069 rows=2377 loops=1)
                                      Buffers: shared hit=13
                          SubPlan 1
                            ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=0) (actual time=0.005..0.005 rows=1 loops=12)
                                  Index Cond: ((requirement_id = r.id) AND (country_code = 'PL'::text))
                                  Heap Fetches: 7
                                  Buffers: shared hit=32
                          SubPlan 3
                            ->  Index Only Scan using requirement_occupations_pkey on requirement_occupations ro  (cost=0.29..8.30 rows=1 width=0) (actual time=0.002..0.002 rows=0 loops=7)
                                  Index Cond: ((requirement_id = r.id) AND (occupation_id = '7126'::text))
                                  Heap Fetches: 2
                                  Buffers: shared hit=17
                    ->  Seq Scan on organizations e  (cost=0.00..182.59 rows=5403 width=16) (actual time=0.009..0.894 rows=5249 loops=2)
                          Filter: (status = 'active'::public.organization_status)
                          Rows Removed by Filter: 2
                          Buffers: shared hit=225
```

```
duration: 11.204 ms  plan:
Nested Loop  (cost=0.57..157.18 rows=2 width=328) (actual time=4.762..11.199 rows=2 loops=1)
  Buffers: shared hit=347
  ->  Nested Loop  (cost=0.28..16.62 rows=2 width=99) (actual time=0.007..0.015 rows=2 loops=1)
        Buffers: shared hit=6
        ->  Function Scan on unnest u  (cost=0.00..0.02 rows=2 width=24) (actual time=0.002..0.003 rows=2 loops=1)
        ->  Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..8.30 rows=1 width=91) (actual time=0.004..0.004 rows=1 loops=2)
              Index Cond: (id = u.id)
              Buffers: shared hit=6
  ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.38 rows=1 width=54) (actual time=0.003..0.003 rows=1 loops=2)
        Index Cond: (id = r.organization_id)
        Buffers: shared hit=6
  SubPlan 1
    ->  Index Only Scan using requirement_reveals_pkey on requirement_reveals rv  (cost=0.28..8.30 rows=1 width=0) (actual time=0.011..0.012 rows=0 loops=2)
          Index Cond: ((requirement_id = r.id) AND (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid))
          Heap Fetches: 0
          Buffers: shared hit=4
  SubPlan 3
    ->  Sort  (cost=8.31..8.32 rows=1 width=4) (actual time=0.007..0.007 rows=1 loops=2)
          Sort Key: ((rc.country_code <> r.country_code)), rc.country_code
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=7
          ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=4) (actual time=0.003..0.003 rows=1 loops=2)
                Index Cond: (requirement_id = r.id)
                Heap Fetches: 2
                Buffers: shared hit=7
  SubPlan 4
    ->  Index Only Scan using requirement_reveals_pkey on requirement_reveals rv_1  (cost=0.28..8.30 rows=1 width=0) (actual time=0.003..0.003 rows=0 loops=2)
          Index Cond: ((requirement_id = r.id) AND (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid))
          Heap Fetches: 0
          Buffers: shared hit=4
  SubPlan 6
    ->  Aggregate  (cost=23.02..23.03 rows=1 width=32) (actual time=0.147..0.147 rows=1 loops=2)
          Buffers: shared hit=20
          ->  Sort  (cost=23.00..23.01 rows=2 width=42) (actual time=0.122..0.123 rows=2 loops=2)
                Sort Key: ro.quantity DESC, oc.label
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=20
                ->  Hash Join  (cost=11.48..22.99 rows=2 width=42) (actual time=0.073..0.115 rows=2 loops=2)
                      Hash Cond: (oc.code = ro.occupation_id)
                      Buffers: shared hit=20
                      ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.005..0.057 rows=436 loops=2)
                            Buffers: shared hit=12
                      ->  Hash  (cost=11.45..11.45 rows=2 width=9) (actual time=0.012..0.013 rows=2 loops=2)
                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                            Buffers: shared hit=8
                            ->  Bitmap Heap Scan on requirement_occupations ro  (cost=4.30..11.45 rows=2 width=9) (actual time=0.007..0.008 rows=2 loops=2)
                                  Recheck Cond: (requirement_id = r.id)
                                  Heap Blocks: exact=4
                                  Buffers: shared hit=8
                                  ->  Bitmap Index Scan on requirement_occupations_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.003..0.003 rows=2 loops=2)
                                        Index Cond: (requirement_id = r.id)
                                        Buffers: shared hit=4
  SubPlan 7
    ->  Index Only Scan using requirement_reveals_pkey on requirement_reveals rv_2  (cost=0.28..8.30 rows=1 width=0) (actual time=0.005..0.005 rows=0 loops=2)
          Index Cond: ((requirement_id = r.id) AND (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid))
          Heap Fetches: 0
          Buffers: shared hit=4
  SubPlan 9
    ->  Index Only Scan using requirement_reveals_pkey on requirement_reveals rv_3  (cost=0.28..8.30 rows=1 width=0) (actual time=0.003..0.003 rows=0 loops=2)
          Index Cond: ((requirement_id = r.id) AND (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid))
          Heap Fetches: 0
          Buffers: shared hit=4
```

### eligible: source country

```
duration: 361.908 ms  plan:
Aggregate  (cost=17148.73..17148.74 rows=1 width=32) (actual time=361.904..361.906 rows=1 loops=1)
  Buffers: shared hit=16486
  ->  Limit  (cost=17148.67..17148.70 rows=11 width=24) (actual time=361.889..361.897 rows=51 loops=1)
        Buffers: shared hit=16486
        ->  Sort  (cost=17148.67..17148.70 rows=11 width=24) (actual time=361.889..361.892 rows=51 loops=1)
              Sort Key: r.published_at DESC, r.id
              Sort Method: quicksort  Memory: 29kB
              Buffers: shared hit=16486
              ->  Nested Loop  (cost=199.87..17148.48 rows=11 width=24) (actual time=0.467..361.552 rows=62 loops=1)
                    Buffers: shared hit=16486
                    ->  Bitmap Heap Scan on workforce_requirements r  (cost=199.59..17061.15 rows=11 width=40) (actual time=0.461..360.654 rows=62 loops=1)
                          Recheck Cond: ((status = ANY ('{open,paused}'::public.requirement_status[])) AND (status = 'open'::public.requirement_status) AND (visibility = 'job_order_marketplace'::public.requirement_visibility))
                          Filter: ((moderation_state = 'visible'::public.job_moderation_state) AND (cardinality(private.job_order_reasons(id, true, '{DE,PL,NL}'::text[], '{7212,5322,7126}'::text[])) = 0) AND ((recruitment_preference <> 'local'::public.recruitment_preference) OR (ANY (id = (hashed SubPlan 2).col1))))
                          Rows Removed by Filter: 2315
                          Heap Blocks: exact=64
                          Buffers: shared hit=16300
                          ->  BitmapAnd  (cost=199.59..199.59 rows=1943 width=0) (actual time=0.206..0.206 rows=0 loops=1)
                                Buffers: shared hit=22
                                ->  Bitmap Index Scan on workforce_requirements_live_closes_on_idx  (cost=0.00..91.17 rows=5377 width=0) (actual time=0.128..0.128 rows=5377 loops=1)
                                      Buffers: shared hit=9
                                ->  Bitmap Index Scan on workforce_requirements_job_orders_idx  (cost=0.00..108.17 rows=2892 width=0) (actual time=0.072..0.072 rows=2377 loops=1)
                                      Buffers: shared hit=13
                          SubPlan 2
                            ->  Index Scan using requirement_countries_country_idx on requirement_countries rc  (cost=0.29..8.29 rows=1 width=16) (actual time=0.006..0.006 rows=0 loops=1)
                                  Index Cond: (country_code = 'PH'::text)
                                  Buffers: shared hit=2
                    ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..7.94 rows=1 width=16) (actual time=0.012..0.012 rows=1 loops=62)
                          Index Cond: (id = r.organization_id)
                          Filter: (status = 'active'::public.organization_status)
                          Buffers: shared hit=186
```

```
duration: 206.811 ms  plan:
Nested Loop  (cost=0.57..3857.42 rows=50 width=328) (actual time=7.649..206.700 rows=50 loops=1)
  Buffers: shared hit=8404
  ->  Nested Loop  (cost=0.28..343.50 rows=50 width=99) (actual time=0.014..0.462 rows=50 loops=1)
        Buffers: shared hit=150
        ->  Function Scan on unnest u  (cost=0.00..0.50 rows=50 width=24) (actual time=0.005..0.039 rows=50 loops=1)
        ->  Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..6.86 rows=1 width=91) (actual time=0.007..0.007 rows=1 loops=50)
              Index Cond: (id = u.id)
              Buffers: shared hit=150
  ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.38 rows=1 width=54) (actual time=0.006..0.006 rows=1 loops=50)
        Index Cond: (id = r.organization_id)
        Buffers: shared hit=150
  SubPlan 2
    ->  Bitmap Heap Scan on requirement_reveals rv  (cost=4.56..68.47 rows=36 width=16) (actual time=0.016..0.022 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.007..0.007 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 3
    ->  Sort  (cost=8.31..8.32 rows=1 width=4) (actual time=0.008..0.008 rows=1 loops=50)
          Sort Key: ((rc.country_code <> r.country_code)), rc.country_code
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=151
          ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=4) (actual time=0.003..0.004 rows=1 loops=50)
                Index Cond: (requirement_id = r.id)
                Heap Fetches: 51
                Buffers: shared hit=151
  SubPlan 5
    ->  Bitmap Heap Scan on requirement_reveals rv_1  (cost=4.56..68.47 rows=36 width=16) (actual time=0.009..0.014 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.005..0.005 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 6
    ->  Aggregate  (cost=23.02..23.03 rows=1 width=32) (actual time=0.118..0.118 rows=1 loops=50)
          Buffers: shared hit=482
          ->  Sort  (cost=23.00..23.01 rows=2 width=42) (actual time=0.099..0.099 rows=2 loops=50)
                Sort Key: ro.quantity DESC, oc.label
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=482
                ->  Hash Join  (cost=11.48..22.99 rows=2 width=42) (actual time=0.064..0.088 rows=2 loops=50)
                      Hash Cond: (oc.code = ro.occupation_id)
                      Buffers: shared hit=482
                      ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.005..0.041 rows=436 loops=50)
                            Buffers: shared hit=300
                      ->  Hash  (cost=11.45..11.45 rows=2 width=9) (actual time=0.012..0.012 rows=2 loops=50)
                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                            Buffers: shared hit=182
                            ->  Bitmap Heap Scan on requirement_occupations ro  (cost=4.30..11.45 rows=2 width=9) (actual time=0.007..0.008 rows=2 loops=50)
                                  Recheck Cond: (requirement_id = r.id)
                                  Heap Blocks: exact=82
                                  Buffers: shared hit=182
                                  ->  Bitmap Index Scan on requirement_occupations_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.004..0.004 rows=2 loops=50)
                                        Index Cond: (requirement_id = r.id)
                                        Buffers: shared hit=100
  SubPlan 8
    ->  Bitmap Heap Scan on requirement_reveals rv_2  (cost=4.56..68.47 rows=36 width=16) (actual time=0.015..0.019 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.007..0.007 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 10
    ->  Bitmap Heap Scan on requirement_reveals rv_3  (cost=4.56..68.47 rows=36 width=16) (actual time=0.005..0.008 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.003..0.003 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
```

### eligible: deep page (cursor at 1,900)

```
duration: 0.578 ms  plan:
Aggregate  (cost=25.23..25.24 rows=1 width=32) (actual time=0.577..0.577 rows=1 loops=1)
  Buffers: shared hit=219
  ->  Limit  (cost=0.57..25.10 rows=51 width=24) (actual time=0.420..0.570 rows=51 loops=1)
        Buffers: shared hit=219
        ->  Nested Loop  (cost=0.57..886.36 rows=1842 width=24) (actual time=0.420..0.565 rows=51 loops=1)
              Buffers: shared hit=219
              ->  Index Scan using workforce_requirements_job_orders_idx on workforce_requirements r  (cost=0.28..576.19 rows=1843 width=40) (actual time=0.411..0.423 rows=52 loops=1)
                    Filter: ((moderation_state = 'visible'::public.job_moderation_state) AND ((published_at < '2026-11-08 09:34:05.895542+00'::timestamp with time zone) OR ((published_at = '2026-11-08 09:34:05.895542+00'::timestamp with time zone) AND (id > '29b3733a-6135-4503-b25f-637a273c1d0b'::uuid))))
                    Rows Removed by Filter: 1902
                    Buffers: shared hit=63
              ->  Memoize  (cost=0.29..0.67 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=52)
                    Cache Key: r.organization_id
                    Cache Mode: logical
                    Hits: 0  Misses: 52  Evictions: 0  Overflows: 0  Memory Usage: 7kB
                    Buffers: shared hit=156
                    ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.66 rows=1 width=16) (actual time=0.002..0.002 rows=1 loops=52)
                          Index Cond: (id = r.organization_id)
                          Filter: (status = 'active'::public.organization_status)
                          Rows Removed by Filter: 0
                          Buffers: shared hit=156
```

```
duration: 161.545 ms  plan:
Nested Loop  (cost=0.57..3857.42 rows=50 width=328) (actual time=5.953..161.447 rows=50 loops=1)
  Buffers: shared hit=6963
  ->  Nested Loop  (cost=0.28..343.50 rows=50 width=99) (actual time=0.012..0.399 rows=50 loops=1)
        Buffers: shared hit=150
        ->  Function Scan on unnest u  (cost=0.00..0.50 rows=50 width=24) (actual time=0.005..0.037 rows=50 loops=1)
        ->  Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..6.86 rows=1 width=91) (actual time=0.005..0.005 rows=1 loops=50)
              Index Cond: (id = u.id)
              Buffers: shared hit=150
  ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.38 rows=1 width=54) (actual time=0.007..0.007 rows=1 loops=50)
        Index Cond: (id = r.organization_id)
        Buffers: shared hit=150
  SubPlan 2
    ->  Bitmap Heap Scan on requirement_reveals rv  (cost=4.56..68.47 rows=36 width=16) (actual time=0.012..0.017 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.006..0.006 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 3
    ->  Sort  (cost=8.31..8.32 rows=1 width=4) (actual time=0.012..0.012 rows=1 loops=3)
          Sort Key: ((rc.country_code <> r.country_code)), rc.country_code
          Sort Method: quicksort  Memory: 25kB
          Buffers: shared hit=10
          ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=4) (actual time=0.005..0.005 rows=1 loops=3)
                Index Cond: (requirement_id = r.id)
                Heap Fetches: 3
                Buffers: shared hit=10
  SubPlan 5
    ->  Bitmap Heap Scan on requirement_reveals rv_1  (cost=4.56..68.47 rows=36 width=16) (actual time=0.016..0.021 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.006..0.006 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 6
    ->  Aggregate  (cost=23.02..23.03 rows=1 width=32) (actual time=0.106..0.107 rows=1 loops=3)
          Buffers: shared hit=29
          ->  Sort  (cost=23.00..23.01 rows=2 width=42) (actual time=0.088..0.089 rows=2 loops=3)
                Sort Key: ro.quantity DESC, oc.label
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=29
                ->  Hash Join  (cost=11.48..22.99 rows=2 width=42) (actual time=0.054..0.080 rows=2 loops=3)
                      Hash Cond: (oc.code = ro.occupation_id)
                      Buffers: shared hit=29
                      ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (actual time=0.006..0.040 rows=436 loops=3)
                            Buffers: shared hit=18
                      ->  Hash  (cost=11.45..11.45 rows=2 width=9) (actual time=0.011..0.011 rows=2 loops=3)
                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                            Buffers: shared hit=11
                            ->  Bitmap Heap Scan on requirement_occupations ro  (cost=4.30..11.45 rows=2 width=9) (actual time=0.006..0.008 rows=2 loops=3)
                                  Recheck Cond: (requirement_id = r.id)
                                  Heap Blocks: exact=5
                                  Buffers: shared hit=11
                                  ->  Bitmap Index Scan on requirement_occupations_pkey  (cost=0.00..4.30 rows=2 width=0) (actual time=0.002..0.002 rows=2 loops=3)
                                        Index Cond: (requirement_id = r.id)
                                        Buffers: shared hit=6
  SubPlan 8
    ->  Bitmap Heap Scan on requirement_reveals rv_2  (cost=4.56..68.47 rows=36 width=16) (actual time=0.032..0.037 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.023..0.023 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
  SubPlan 10
    ->  Bitmap Heap Scan on requirement_reveals rv_3  (cost=4.56..68.47 rows=36 width=16) (actual time=0.011..0.015 rows=36 loops=1)
          Recheck Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
          Heap Blocks: exact=2
          Buffers: shared hit=4
          ->  Bitmap Index Scan on requirement_reveals_organization_idx  (cost=0.00..4.55 rows=36 width=0) (actual time=0.007..0.007 rows=37 loops=1)
                Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7911'::uuid)
                Buffers: shared hit=2
```

### free: first page

```
duration: 0.078 ms  plan:
Aggregate  (cost=7.03..7.04 rows=1 width=32) (actual time=0.076..0.077 rows=1 loops=1)
  Buffers: shared hit=66
  ->  Limit  (cost=0.57..6.98 rows=21 width=24) (actual time=0.015..0.072 rows=21 loops=1)
        Buffers: shared hit=66
        ->  Nested Loop  (cost=0.57..841.13 rows=2755 width=24) (actual time=0.015..0.071 rows=21 loops=1)
              Buffers: shared hit=66
              ->  Index Scan using workforce_requirements_job_orders_idx on workforce_requirements r  (cost=0.28..554.50 rows=2757 width=40) (actual time=0.008..0.012 rows=21 loops=1)
                    Filter: (moderation_state = 'visible'::public.job_moderation_state)
                    Buffers: shared hit=3
              ->  Memoize  (cost=0.29..0.55 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=21)
                    Cache Key: r.organization_id
                    Cache Mode: logical
                    Hits: 0  Misses: 21  Evictions: 0  Overflows: 0  Memory Usage: 3kB
                    Buffers: shared hit=63
                    ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.54 rows=1 width=16) (actual time=0.002..0.002 rows=1 loops=21)
                          Index Cond: (id = r.organization_id)
                          Filter: (status = 'active'::public.organization_status)
                          Buffers: shared hit=63
```

```
duration: 41.627 ms  plan:
Nested Loop  (cost=0.57..1563.77 rows=20 width=328) (actual time=5.512..41.596 rows=20 loops=1)
  Buffers: shared hit=422
  ->  Nested Loop  (cost=0.28..158.20 rows=20 width=99) (actual time=0.009..0.193 rows=20 loops=1)
        Buffers: shared hit=60
        ->  Function Scan on unnest u  (cost=0.00..0.20 rows=20 width=24) (actual time=0.003..0.013 rows=20 loops=1)
        ->  Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..7.90 rows=1 width=91) (actual time=0.007..0.007 rows=1 loops=20)
              Index Cond: (id = u.id)
              Buffers: shared hit=60
  ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.38 rows=1 width=54) (actual time=0.005..0.005 rows=1 loops=20)
        Index Cond: (id = r.organization_id)
        Buffers: shared hit=60
  SubPlan 2
    ->  Index Scan using requirement_reveals_organization_idx on requirement_reveals rv  (cost=0.28..8.30 rows=1 width=16) (actual time=0.015..0.015 rows=0 loops=1)
          Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7912'::uuid)
          Buffers: shared hit=2
  SubPlan 3
    ->  Sort  (cost=8.31..8.32 rows=1 width=4) (never executed)
          Sort Key: ((rc.country_code <> r.country_code)), rc.country_code
          ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=4) (never executed)
                Index Cond: (requirement_id = r.id)
                Heap Fetches: 0
  SubPlan 5
    ->  Index Scan using requirement_reveals_organization_idx on requirement_reveals rv_1  (cost=0.28..8.30 rows=1 width=16) (never executed)
          Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7912'::uuid)
  SubPlan 6
    ->  Aggregate  (cost=23.02..23.03 rows=1 width=32) (never executed)
          ->  Sort  (cost=23.00..23.01 rows=2 width=42) (never executed)
                Sort Key: ro.quantity DESC, oc.label
                ->  Hash Join  (cost=11.48..22.99 rows=2 width=42) (never executed)
                      Hash Cond: (oc.code = ro.occupation_id)
                      ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (never executed)
                      ->  Hash  (cost=11.45..11.45 rows=2 width=9) (never executed)
                            ->  Bitmap Heap Scan on requirement_occupations ro  (cost=4.30..11.45 rows=2 width=9) (never executed)
                                  Recheck Cond: (requirement_id = r.id)
                                  ->  Bitmap Index Scan on requirement_occupations_pkey  (cost=0.00..4.30 rows=2 width=0) (never executed)
                                        Index Cond: (requirement_id = r.id)
  SubPlan 8
    ->  Index Scan using requirement_reveals_organization_idx on requirement_reveals rv_2  (cost=0.28..8.30 rows=1 width=16) (actual time=0.013..0.013 rows=0 loops=1)
          Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7912'::uuid)
          Buffers: shared hit=2
  SubPlan 10
    ->  Index Scan using requirement_reveals_organization_idx on requirement_reveals rv_3  (cost=0.28..8.30 rows=1 width=16) (actual time=0.003..0.003 rows=0 loops=1)
          Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7912'::uuid)
          Buffers: shared hit=2
```

### free: hidden-field filter

```
duration: 529.714 ms  plan:
Aggregate  (cost=967.86..967.87 rows=1 width=32) (actual time=529.707..529.708 rows=1 loops=1)
  Buffers: shared hit=86
  ->  Limit  (cost=967.84..967.85 rows=3 width=24) (actual time=529.698..529.699 rows=0 loops=1)
        Buffers: shared hit=86
        ->  Sort  (cost=967.84..967.85 rows=3 width=24) (actual time=529.696..529.698 rows=0 loops=1)
              Sort Key: r.published_at DESC, r.id
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=86
              ->  Nested Loop  (cost=199.87..967.82 rows=3 width=24) (actual time=529.688..529.689 rows=0 loops=1)
                    Buffers: shared hit=86
                    ->  Bitmap Heap Scan on workforce_requirements r  (cost=199.58..942.91 rows=3 width=40) (actual time=529.683..529.684 rows=0 loops=1)
                          Recheck Cond: ((status = ANY ('{open,paused}'::public.requirement_status[])) AND (status = 'open'::public.requirement_status) AND (visibility = 'job_order_marketplace'::public.requirement_visibility))
                          Filter: ((moderation_state = 'visible'::public.job_moderation_state) AND (industry_code = 'C'::text) AND (cardinality(private.job_order_reasons(id, false, '{DE,PL,NL}'::text[], '{7212,5322,7126}'::text[])) = 0))
                          Rows Removed by Filter: 2377
                          Heap Blocks: exact=64
                          Buffers: shared hit=86
                          ->  BitmapAnd  (cost=199.58..199.58 rows=1943 width=0) (actual time=0.239..0.239 rows=0 loops=1)
                                Buffers: shared hit=22
                                ->  Bitmap Index Scan on workforce_requirements_live_closes_on_idx  (cost=0.00..91.17 rows=5377 width=0) (actual time=0.159..0.159 rows=5377 loops=1)
                                      Buffers: shared hit=9
                                ->  Bitmap Index Scan on workforce_requirements_job_orders_idx  (cost=0.00..108.17 rows=2892 width=0) (actual time=0.074..0.074 rows=2377 loops=1)
                                      Buffers: shared hit=13
                    ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..8.30 rows=1 width=16) (never executed)
                          Index Cond: (id = r.organization_id)
                          Filter: (status = 'active'::public.organization_status)
```

```
duration: 0.009 ms  plan:
Nested Loop  (cost=0.57..78.59 rows=1 width=328) (actual time=0.007..0.008 rows=0 loops=1)
  ->  Nested Loop  (cost=0.28..8.31 rows=1 width=99) (actual time=0.006..0.006 rows=0 loops=1)
        ->  Function Scan on unnest u  (cost=0.00..0.01 rows=1 width=24) (actual time=0.006..0.006 rows=0 loops=1)
        ->  Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..8.30 rows=1 width=91) (never executed)
              Index Cond: (id = u.id)
  ->  Index Scan using organizations_pkey on organizations e  (cost=0.28..0.38 rows=1 width=54) (never executed)
        Index Cond: (id = r.organization_id)
  SubPlan 1
    ->  Index Scan using requirement_reveals_organization_idx on requirement_reveals rv  (cost=0.28..8.30 rows=1 width=0) (never executed)
          Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7912'::uuid)
          Filter: (requirement_id = r.id)
  SubPlan 3
    ->  Sort  (cost=8.31..8.32 rows=1 width=4) (never executed)
          Sort Key: ((rc.country_code <> r.country_code)), rc.country_code
          ->  Index Only Scan using requirement_countries_pkey on requirement_countries rc  (cost=0.29..8.30 rows=1 width=4) (never executed)
                Index Cond: (requirement_id = r.id)
                Heap Fetches: 0
  SubPlan 4
    ->  Index Scan using requirement_reveals_organization_idx on requirement_reveals rv_1  (cost=0.28..8.30 rows=1 width=0) (never executed)
          Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7912'::uuid)
          Filter: (requirement_id = r.id)
  SubPlan 6
    ->  Aggregate  (cost=23.02..23.03 rows=1 width=32) (never executed)
          ->  Sort  (cost=23.00..23.01 rows=2 width=42) (never executed)
                Sort Key: ro.quantity DESC, oc.label
                ->  Hash Join  (cost=11.48..22.99 rows=2 width=42) (never executed)
                      Hash Cond: (oc.code = ro.occupation_id)
                      ->  Seq Scan on occupations oc  (cost=0.00..10.36 rows=436 width=38) (never executed)
                      ->  Hash  (cost=11.45..11.45 rows=2 width=9) (never executed)
                            ->  Bitmap Heap Scan on requirement_occupations ro  (cost=4.30..11.45 rows=2 width=9) (never executed)
                                  Recheck Cond: (requirement_id = r.id)
                                  ->  Bitmap Index Scan on requirement_occupations_pkey  (cost=0.00..4.30 rows=2 width=0) (never executed)
                                        Index Cond: (requirement_id = r.id)
  SubPlan 7
    ->  Index Scan using requirement_reveals_organization_idx on requirement_reveals rv_2  (cost=0.28..8.30 rows=1 width=0) (never executed)
          Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7912'::uuid)
          Filter: (requirement_id = r.id)
  SubPlan 9
    ->  Index Scan using requirement_reveals_organization_idx on requirement_reveals rv_3  (cost=0.28..8.30 rows=1 width=0) (never executed)
          Index Cond: (organization_id = '00000000-0000-0000-0000-0000000b7912'::uuid)
          Filter: (requirement_id = r.id)
```

### job order: anonymous

```
duration: 0.010 ms  plan:
Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..8.30 rows=1 width=221) (actual time=0.008..0.008 rows=1 loops=1)
  Index Cond: (id = $2)
  Filter: (visibility = 'job_order_marketplace'::public.requirement_visibility)
  Buffers: shared hit=3
```

### job order: revealed

```
duration: 0.010 ms  plan:
Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..8.30 rows=1 width=221) (actual time=0.008..0.008 rows=1 loops=1)
  Index Cond: (id = $2)
  Filter: (visibility = 'job_order_marketplace'::public.requirement_visibility)
  Buffers: shared hit=3
```

### job order: no longer open

```
duration: 0.018 ms  plan:
Index Scan using workforce_requirements_pkey on workforce_requirements r  (cost=0.28..8.30 rows=1 width=221) (actual time=0.016..0.016 rows=1 loops=1)
  Index Cond: (id = $2)
  Filter: (visibility = 'job_order_marketplace'::public.requirement_visibility)
  Buffers: shared hit=3
```

