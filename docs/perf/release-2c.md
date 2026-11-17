# Performance and capacity: Find Workers, messaging and the Phase 2 capacity (release 2c)

This page records the load tests and the capacity review of V80 for release 2c:

- **NFR-P3** (network search response time): 95 % of Find Workers renders within 500 ms server time at 100,000 visible worker profiles, shown with a load test and query plans. Find Partners is V78 (`release-2a.md`), the job order board V79 (`release-2b.md`).
- **NFR-P4** (message delivery time): a sent message appears for the recipient without a reload within 5 seconds in 95 % of cases; the conversation list loads within 500 ms server time for an organisation with 10,000 conversations.
- **NFR-P5** (Phase 2 capacity): 2,000 partner organisations and 50,000 messages a day handled without architectural change, on top of the Phase 1 capacity of NFR-P2.

## 1. Find Workers at 100,000 visible profiles (NFR-P3)

### Method

- **Data.** `supabase/tests/database/find_workers_load_fixture.inc` seeds, in a transaction that is rolled back, 110,000 worker accounts with a passport: 100,000 listed cards (opted in, account active, no deletion requested) and 10,000 that must never be found (8,000 not opted in, 1,000 suspended accounts, 1,000 with a deletion requested). Each passport has one of 29 common ISCO-08 occupations (welders, care workers and drivers weighted up), one of 15 headlines, a current country among 25 source countries, 0 to 25 years of experience, an availability (now, from a date in the next eight months, or not available), two to six of 40 skills, one to three of 16 languages with a CEFR level, one to four of 30 preferred countries, an unexpired work authorisation for one in five, and for half of them the preferred industries and employment types shown on the card; the cards were last changed over the past year. Two direct-hiring rules (Nepal: licensed partner required; Ethiopia to Germany: blocked) shape the cards of those countries. The searchers are two employers based in Germany: one on Professional (the advanced filters), with 100 saved cards and 300 contact requests, and one on Starter. The per-row triggers of the passport lists (their size limits, which the seed keeps, and the stamp of the card's change time, which the seed sets itself) are switched off for the seed, so that it takes about a minute; the switch is rolled back with the rest. `setseed` makes every run seed the same passports.
- **Calls.** Sixteen calls of the Find Workers page (table below), each as the API role `authenticated` with the member's claims, through the same functions as the page: `worker_search_access`, `search_workers` (the searcher checks, the rate limit and the search log included; the rate-limit window is emptied before each run), `card_contact_requests` for 20 cards with requests and `list_saved_worker_cards`.
- **Measure.** The server time of each call in the database (`clock_timestamp` around the call), 50 runs per call after one untimed warm-up run, after `analyze` of the seeded tables. The plans are the `EXPLAIN ANALYZE` output of the main statements of each function, taken with `auto_explain` (nested statements) on one more run.
- **Budget.** 200 ms at the 95th percentile for the database, two fifths of the 500 ms of NFR-P3: the page also reads the access check, the contact requests of its cards and the saved cards, and renders the cards. Releases 2a and 2b kept a fifth (100 ms); a Find Workers search covers twenty times as many rows as Find Partners, and its typical calls stay well under 200 ms on an idle machine (below). The script fails above the budget.

### How to run it

```sh
npm run db:start                                  # the local stack
node scripts/load/find-workers.mjs --plans        # 50 runs per call, with plans; exit 1 above the budget
node scripts/load/find-workers.mjs --runs 200     # more runs, no plans
DATABASE_URL=postgres://... node scripts/load/find-workers.mjs   # a staging copy (never production)
```

CI runs the light version on every change: pgTAP `supabase/tests/database/220_find_workers_load.test.sql` (part of `npm run db:test`, about a minute, most of it the seed) seeds the same passports, runs each call once untimed and five times timed, and fails when one run of a call takes 500 ms or its median 300 ms (a margin over the slowest call on a slower runner; V69's full scan failed both), when a page is not full (so no call is timed on an empty answer), when the first 50 cards without a filter, for a keyword or for two skills differ from what V69's definition of the search answers at this size (score, last change, card id, computed again in the test with V69's `strpos` and per-card counts), when a card that is not listed is found or a card holds a name, an address or a user id (NFR-S9 at volume), or when the plan shape changes: the cards no longer read in their order through `worker_profiles_search_updated_idx`, a keyword no longer found through the trigram indexes or the chosen skills through `worker_skills_lower_skill_idx`. `200_find_workers_search.test.sql` (V69) keeps testing the search on its small set of cards.

### Results (V80, 18 November 2026)

Local throwaway database: the Supabase image `postgres:17.11.0.002` in Docker (8 CPUs, 8 GB) on an Apple M1 Pro, built from every migration of the branch and the reference seeds, 50 runs per call after a warm-up. The machine was shared with other work and its load average varied between 10 and 50 during the runs; the figures of the slower calls move with it (see the note after the table).

**Before** (V69's `search_workers`, `20270209100000_find_workers_search.sql`; 5 runs per call, same data):

| Call | Rows | p50 ms | p95 ms |
|---|---|---|---|
| basic: first page | 20 | 159.5 | 212.1 |
| basic: keyword "welder" | 20 | 874.1 | 1008.5 |
| basic: keyword "dementia" | 20 | 778.0 | 999.5 |
| basic: occupation, destination | 20 | 61.2 | 63.9 |
| basic: lives in, available now | 20 | 66.6 | 68.8 |
| basic: available by, page of 50 | 50 | 119.9 | 131.1 |
| basic: deep page (cursor at 2,000) | 20 | 172.4 | 177.5 |
| basic: rules shape the cards (Ethiopia) | 20 | 36.2 | 38.8 |
| advanced: two skills | 20 | 470.0 | 1521.3 |
| advanced: language, destination | 20 | 164.8 | 179.2 |
| advanced: five filters, page of 50 | 50 | 29.1 | 30.4 |
| advanced: keyword, work authorisation | 20 | 732.2 | 988.6 |
| advanced: sparse | 1 | 6.9 | 9.5 |
| page: requests of 20 cards | 20 | 2.1 | 2.4 |
| page: saved workers | 100 | 24.7 | 25.2 |

A keyword, two skills and the advanced keyword were over the 500 ms of NFR-P3 on their own, and a first page without a filter took 160 ms. The plans showed why: the search read every listed card (100,000 rows of `worker_profiles` joined to `profiles`), computed the score of each (for a keyword, a lookup of the card's skills with `strpos` for each card, three times over as the expression was repeated; for skills, a count per card, twice), and sorted all of them to take 21.

**The fix** (`supabase/migrations/20270217100000_find_workers_load.sql`):

- `worker_profiles_search_updated_idx` on `worker_profiles (updated_at desc, card_id) where searchable`, the order of the cards when every card scores the same;
- `worker_profiles_search_headline_trgm_idx` (`lower(headline)`, `gin_trgm_ops`, where searchable) and `worker_skills_lower_skill_trgm_idx` (`lower(skill)`, `gin_trgm_ops`), which find a keyword anywhere in a headline or a skill;
- `search_workers` recreated with a narrower first step: before the cards are read, the cards a keyword can match (its occupations, the headlines and the skills that hold it, as a `like` pattern with `%`, `_` and `\` escaped, which matches exactly what V69's `strpos` matched) and the cards that list a chosen skill, with how many, are found once through the indexes; the cards are then read for those only, and every score term is a constant when its filter is not used, so a search without a keyword or skills reads the cards in the order of `worker_profiles_search_updated_idx` and stops after the page. The result, the order, the cursor, the refusals and the search log are those of V69: pgTAP 200, 207 and 222 pass unchanged and 220 compares the answers with V69's definition at 100,000 cards.

**After** (`node scripts/load/find-workers.mjs --plans`):

| Call | Rows | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| access check | 1 | 1.1 | 1.9 | 6.8 |
| basic: first page | 20 | 7.9 | 10.1 | 13.6 |
| basic: keyword "welder" | 20 | 88.3 | 110.7 | 111.9 |
| basic: keyword "dementia" | 20 | 77.1 | 110.4 | 156.6 |
| basic: occupation, destination | 20 | 13.8 | 18.6 | 20.5 |
| basic: lives in, available now | 20 | 4.8 | 5.6 | 7.5 |
| basic: available by, page of 50 | 50 | 8.2 | 15.2 | 41.3 |
| basic: deep page (cursor at 2,000) | 20 | 6.6 | 10 | 11.6 |
| basic: rules shape the cards (Ethiopia) | 20 | 18 | 24.5 | 27.3 |
| advanced: two skills | 20 | 183.6 | 268.2 | 329.3 |
| advanced: language, destination | 20 | 20.6 | 26.4 | 31.5 |
| advanced: five filters, page of 50 | 50 | 59.3 | 72.5 | 75.2 |
| advanced: keyword, work authorisation | 20 | 52.2 | 68.9 | 73.1 |
| advanced: sparse | 1 | 29.3 | 35.6 | 39.1 |
| page: requests of 20 cards | 20 | 1.1 | 1.4 | 1.7 |
| page: saved workers | 100 | 15.4 | 18.2 | 19.5 |

Every call is within the 500 ms of NFR-P3 at the 95th percentile. Without a keyword or skills a page takes under 20 ms whatever its depth (the deep page reads 2,000 index entries before its 20). The slowest shapes are a keyword (about 15,000 cards hold "welder" in their occupation or headline, 10,000 "dementia" in a skill, each scored and sorted) and two common skills (18,000 cards): 60 to 100 ms at the median for a keyword and 120 to 180 ms for the two skills over the runs of the day, and up to twice that at the 95th percentile while the machine was loaded. They are the ones to watch as the cards grow: the cost is linear in the cards a keyword or the skills match (about 5 to 10 µs each). In the run recorded above the two skills went over the script's 200 ms at the 95th percentile (the script exited 1 for it alone), within the 500 ms of NFR-P3; the go-live check runs the script on the idle staging copy. The CI test holds every run under 500 ms and the median under 300 ms.

What the plans show:

- **Without a keyword or skills** (the first page, the basic filters, the deep page): an index scan of `worker_profiles_search_updated_idx` in the page's order, a nested loop to `profiles_pkey` for the account state and the filters checked per card, stopped after the page and one card; the deep page starts from the top of the index and reads past the cursor's 2,000 cards.
- **A keyword**: three index reads before the search (the occupations by label and synonym, `worker_profiles_search_headline_trgm_idx` and `worker_skills_lower_skill_trgm_idx`, a bitmap each); the cards are then read by their keys (`user_id = any (...)`, hashed) or a bitmap of the occupation index, joined to `profiles` by hash, scored and sorted (top-N heapsort).
- **Skills**: one read of `worker_skills_lower_skill_idx` for the chosen skills, grouped per card into the map of hits; the cards follow as for a keyword.
- **The page** reads the 20 cards' columns (`private.worker_cards`, a lookup per list) and the direct-hiring rule of each; under 10 ms.
- The durations in the plans below are those of the instrumented run (`log_analyze` with nested statements), so they are larger than the timed runs; compare the rows and the buffers, not the times.

### Operational check at the HTTP level

As for Find Partners and the job order board, no HTTP load tool is added, so the render time of Find Workers under load is checked by hand on a disposable copy of staging before release 2c goes live, as item 14 of `docs/runbooks/release-2a-go-live.md` does for release 2a. Record the date, the person and the figures in the release record.

1. **A disposable copy of staging** with the release tag's web build, never production and never the shared staging database.
2. **Seed it, committed**, switch the passport lists' triggers back on before the commit (the fixture switches them off for its own transaction), and give a password to the measured member (`workers-basic@load.test`) through the Auth admin API of the copy, so it can sign in:

   ```sh
   { echo "begin;"
     echo "update private.settings set value = 'true' where key = 'release_find_workers';"
     cat supabase/tests/database/find_workers_load_fixture.inc
     echo "select pg_temp.seed_find_workers(100000, 10000);"
     echo "alter table public.worker_skills enable trigger user; alter table public.worker_languages enable trigger user;"
     echo "alter table public.worker_preferred_countries enable trigger user; alter table public.worker_work_authorizations enable trigger user;"
     echo "alter table public.worker_preferred_industries enable trigger user; alter table public.worker_preferred_employment_types enable trigger user;"
     for t in worker_skills worker_languages worker_preferred_countries worker_work_authorizations worker_preferred_industries worker_preferred_employment_types; do
       echo "alter table public.$t enable always trigger ${t}_touch_profile;"
     done
     echo "commit;"; } | psql "$STAGING_COPY_URL" -v ON_ERROR_STOP=1
   ```

3. **Measure.** Signed in as that member (its session cookie in the requests), request `/en/org/workers-basic/find-workers`, `/en/org/workers-basic/find-workers?q=welder` and `/en/org/workers-basic/find-workers?occupation=7212&destination=DE` 100 times each from a host near the web tier (for example `curl -s -o /dev/null -b "$COOKIE" -w '%{time_starttransfer}\n'` in a loop, ten in parallel; on the copy, raise `rate_limit_worker_search_max` first, so the per-user allowance does not answer instead of the page) and take the 95th percentile of the time to first byte. It must be under 500 ms.
4. **Clean up** (or delete the copy): the accounts cascade to their profiles, passports, lists, saved cards and contact requests, and the seeded users are the `@load.test` addresses:

   ```sh
   psql "$STAGING_COPY_URL" -v ON_ERROR_STOP=1 -c "begin;
     delete from public.organizations where slug in ('workers-pro', 'workers-basic');
     delete from auth.users where email like '%@load.test';
     delete from public.direct_hiring_rules where legal_opinion_ref = 'LOAD-V80';
     update private.settings set value = 'false' where key = 'release_find_workers';
     commit;"
   ```

## 2. Messages within 5 seconds and the conversation list at 10,000 conversations (NFR-P4)

### The message shown within 5 seconds

The two journeys of release 2c (`apps/web/tests/e2e/release-2c-journey.spec.ts`, project `release-2c-journey`, NFR-O4) time every message they send, both ways: after a contact request is accepted, the employer's member and the worker write four messages with both conversations open; after an inquiry, the partner and the employer's member write three. For each, the clock starts when the sender's Send returned (the composer empties once `send_message` stored the message) and stops when the message shows in the recipient's open conversation, without a reload; each must take less than 5 s. The open conversation follows the Realtime signal of V64 (`message` on `conversation:<id>`) and, while its channel is not connected, reads the newest messages every 4 s (`THREAD_POLL_MS`), so the worst case without Realtime is the 4 s poll plus one read of `list_messages` (5 ms at 10,000 conversations, below). Every message, not 95 % of them, is held to the 5 s.

### Method of the list load

- **Data.** `supabase/tests/database/conversations_load_fixture.inc` seeds, rolled back, an employer on Professional (an owner at aal2 and a member) with 10,000 conversations: an inquiry with each of 2,000 listed partners (the 2,000 partners of NFR-P5), 5,000 conversations about 200 of its requirements with the same partners (invitations and responses) and 3,000 conversations of accepted contact requests with 3,000 workers; each has one to nine messages (50,000 in all, half of them the employer's, 20 to 400 characters), the last in the past 90 days. The owner has read seven conversations in ten to their last message and three in ten earlier, so 2,709 hold unread messages. The messages are written while `release_messaging` is off, so nothing is broadcast for the seed.
- **Calls.** The inbox (`list_conversations`: the first page, a page of 50, the inquiries, contact requests and responses filters, a page after the cursor of the 9,000th conversation, and a member's first page), `my_unread_counts` (the inbox reads it with the list, the header badge on every page and every 15 s), the conversation page (`get_conversation`, `list_messages` of the busiest conversation) and `send_message` from the owner (the write of NFR-P5: the checks, the throttle, the organisation's messages lock and limit, the row, the broadcast signal; the rate-limit window is emptied before each run). The owner calls at aal2, the member at aal1.
- **Measure and budget.** As for Find Workers, 50 runs after a warm-up; 100 ms at the 95th percentile, a fifth of NFR-P4's 500 ms.

```sh
node scripts/load/conversations.mjs --plans       # 50 runs per call, with plans and the table sizes of the capacity review
DATABASE_URL=postgres://... node scripts/load/conversations.mjs   # a staging copy (never production)
```

CI runs pgTAP `221_conversations_load.test.sql` (a few seconds): five timed runs; the list under 100 ms at the median and every call under 500 ms in every run; full pages; the first page of 50 the 50 conversations with the latest messages; the unread counts, for every conversation and only those, the visible messages of the other side after the owner's last read; no sequential scan in the plan of an inbox page, and the unread count of a row of the list through `messages_conversation_idx`. `193_messaging_pages.test.sql` (V65) keeps its own 10,000-conversation check of the first page.

### Results (V80, 18 November 2026)

Same machine and database as above; the timings and the sizes are those of the first run on the fresh database, the plans those of a second run. Before V80, the list took 2 to 6 ms but `my_unread_counts` 147 ms at the median and 168 ms at the 95th percentile (5 runs), and 213 and 370 ms over 50 runs on the loaded machine: it called `private.conversation_unread` twice for each of the caller's 10,000 conversations (once to keep the row, once for the count), each a lookup of the read row and of the messages after it. As the inbox reads it beside the list, the inbox page's database time was that of the unread counts. `supabase/migrations/20270217100100_unread_counts_load.sql` recreates it as one join of the caller's participant rows, the caller's read rows and the visible messages of the other side after them, grouped by conversation: the same rows and counts (221 compares them, 190, 192, 193, 198 and 208 pass unchanged), the same callers and refusals.

| Call | Rows | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| inbox: first page | 20 | 2.3 | 2.9 | 3.2 |
| inbox: page of 50 | 50 | 4.1 | 5.7 | 9.3 |
| inbox: inquiries | 20 | 1.5 | 1.6 | 1.6 |
| inbox: contact requests | 20 | 1.8 | 2.6 | 4.8 |
| inbox: responses | 20 | 2.2 | 2.8 | 3.7 |
| inbox: deep page (cursor at 9,000) | 20 | 1.9 | 2.2 | 3.4 |
| member: first page | 20 | 2 | 3.1 | 3.9 |
| unread counts | 2709 | 15.7 | 26.2 | 44.8 |
| conversation: header | 1 | 4.5 | 6.4 | 17.9 |
| conversation: latest messages | 9 | 3.9 | 4.5 | 5.2 |
| send a message | 1 | 6.1 | 8.8 | 11.6 |

The list answers within 10 ms in every shape: it reads the page of the organisation's participant rows in the order of `conversations_last_message_idx` (a nested loop to `conversation_participants_organization_idx`, stopped after the page) and names, counts and closes only the 20 rows of the page. For an organisation with few conversations among millions the planner starts from `conversation_participants_organization_idx` instead (the estimate of its rows decides), which keeps the page cheap as the platform grows. The unread counts take 16 ms at the median for 10,000 conversations (a hash join of the 10,000 participant rows, their reads and the 50,000 messages).

## 3. Capacity review at 2,000 partners and 50,000 messages a day (NFR-P5)

NFR-P5 asks for 2,000 partner organisations and 50,000 messages a day without architectural change, on top of the Phase 1 capacity (NFR-P2: 500 registered users on day 1 with headroom to 20,000, checked by the Phase 1 load tests of `docs/runbooks/release-checklist.md` item 11). The architecture is one PostgreSQL database (Supabase) behind PostgREST and the Next.js web tier, the Realtime service for signals and the notify Edge Function for emails; nothing in release 2c adds a store or a service.

### Partners

2,000 partner organisations are fewer than the load tests already run: Find Partners at 5,000 listed partners (V78, `release-2a.md`), the job order board with 5,000 partners and 25,000 responses (V79, `release-2b.md`), and the inbox above with 2,000 listed partners. A partner organisation takes about 2.2 kB with its indexes in `organizations` (the seed above: 344 kB of rows and 4.0 MB of indexes for 2,001 organisations; the trigram indexes of the names are most of it), its geographies, occupations, members and listings a few hundred bytes each: under 50 MB for 2,000 partners with their profiles. No table of the partner network needs more than its current indexes at this size.

### Messages: table and index sizes

Measured with `scripts/load/conversations.mjs` on a fresh database (the space each table grew by during the seed, in the seed's transaction):

| Table | Rows | Row bytes | Heap added | Indexes added |
|---|---|---|---|---|
| public.organizations | 2001 | 328126 | 344064 | 4038656 |
| public.contact_requests | 3000 | 564000 | 606208 | 1245184 |
| public.conversation_reads | 10000 | 639997 | 688128 | 679936 |
| public.conversations | 10000 | 959997 | 1024000 | 1867776 |
| public.conversation_participants | 15000 | 1079997 | 1155072 | 3088384 |
| public.messages | 49982 | 16149720 | 16752640 | 9666560 |

- **A message** takes about 335 bytes of rows (323 bytes on average with a body of 210 characters; bodies stay inline below about 2 kB and are compressed above) and 193 bytes of indexes (the key, the conversation and time, the sender and the sender's organisation and time, the time, and the connection when there is one): about **530 bytes**. 50,000 messages a day are **about 26 MB a day**. A body of 4,000 characters (the limit) takes about 4 kB, so the size grows with the length people write, not with the count.
- **A conversation** with its two participant rows and up to two read rows takes about 1 kB (290 bytes for the conversation, 283 for each participant, 137 for each read row with their indexes). At the seed's five messages per conversation, 50,000 messages open 10,000 conversations a day, about 10 MB a day; longer conversations open fewer.
- **A contact request** takes about 620 bytes with its indexes.
- **Broadcasts.** Each message sends one `message` signal on the conversation's topic and one `messages_unread` signal to each user of the other side (`realtime.messages`, an id and a time, never a body), kept by the Realtime service for a few days in daily partitions: at 50,000 messages and about three signals each, 150,000 small rows a day, dropped with their partitions. (The throwaway database of these runs had no partition for the day, so the signals were not stored there; on a Supabase project the Realtime service creates the partitions.)

### Write rates

- **Sending** (`send_message`): 6 ms at the median and 9 ms at the 95th percentile in the database, with the rule checks, the throttle (`rate_limit_message_*`), the organisation's messages lock (`messages:<org>`) and monthly limit, the row and its broadcast trigger. 50,000 messages a day are 0.6 a second on average; at a peak of ten times the average (6 a second) the database spends about 4 % of one connection on them. The lock serialises the messages of one organisation only (about 150 a second at 6 ms each), far above what a team writes.
- **The delayed email** (`private.queue_message_emails`, every minute, V67): it looks at the conversations with a message in the day before the delay. With all 50,000 messages of the seed moved into the last 24 hours it took 0.2 s when nothing was due; the first run queued 13,869 emails at once (every recipient of the day due at the same time, which does not happen in operation) in 7.7 s, in its single statement under its advisory lock. In operation a minute brings about 35 messages and their emails.
- **The unread counts** are read on every signed-in page (the header badge) and every 15 s while the channel is not connected: 16 ms for an organisation with 10,000 conversations, and much less for most.
- **Reading** a conversation (`get_conversation`, `list_messages`) and the inbox take under 10 ms; they do not grow with the messages of the day.

### Retention

`private.apply_retention` (V74) deletes a conversation whose last message is older than `conversations` (730 days, decision 5.4), with its participants, messages, reads and block, unless a message of it is under an open report; contact requests go after 365 days (declines after 90), the Find Workers search log after 90 days, saved cards whose worker no longer shows them after 365 days. With 50,000 messages a day the messages therefore reach a steady state after two years: **about 36.5 million messages, 12 GB of rows and 7 GB of indexes (about 19 GB)**, and, at five messages per conversation, about 7.3 million conversations with their participants and reads (about 7 GB more; fewer with longer conversations). Without retention the tables would grow by about 13 GB a year. The retention job deletes about 50,000 messages a day at steady state, in its nightly run.

### Conclusion

No architectural change is needed for 2,000 partners and 50,000 messages a day: every read measured stays within its budget at volumes above those of NFR-P5 (Find Partners at 5,000 partners, the job order board, the inbox at 10,000 conversations, Find Workers at 100,000 cards), a message costs about 6 ms to write, and the messaging tables reach about 26 GB at steady state with the 730-day retention. To watch:

1. **Database disk**: size the project for the steady state above (about 30 GB of messaging data with indexes, plus Phase 1 and the partner network), and set an alert on the database size.
2. **The keyword and skills searches of Find Workers** grow with the cards they match (about 5 µs a card); at several hundred thousand cards, consider a precomputed search column.
3. **`queue_message_emails`** reads the day's messages every minute; if the daily volume grows far beyond 50,000, keep it on `messages_created_at_idx` and check its time in the cron history.
4. **`realtime.messages`**: check that the Realtime service drops its old partitions on the hosted project.
5. **VACUUM of `messages`**: the retention job deletes a day's messages each night; autovacuum's defaults are enough at this rate, check the dead rows in the database report after the first year.

## Query plans

The main statements of each call on the 51st run, from `node scripts/load/find-workers.mjs --plans` and `node scripts/load/conversations.mjs --plans` (`auto_explain`, `log_analyze`, `log_buffers`, nested statements; the query text is left out, it is the body of the functions in `supabase/migrations/20270217100000_find_workers_load.sql`, `20270217100100_unread_counts_load.sql`, `20270205100000_messaging_pages.sql` and their predecessors). For a Find Workers search the plans are, in order, those of the keyword's headlines and skills or of the chosen skills (when used) and of the search itself (`with found as (...)`).

### Find Workers

#### access check

```
(no plan captured)
```

#### basic: first page

```
duration: 12.285 ms  plan:
Sort  (cost=672556.43..672573.93 rows=7000 width=459) (actual time=12.261..12.270 rows=20 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 42kB
  Buffers: shared hit=864 read=22
  CTE page
    ->  WindowAgg  (cost=29.51..29.96 rows=21 width=59) (actual time=1.490..1.521 rows=21 loops=1)
          Buffers: shared hit=209 read=4
          ->  Sort  (cost=29.49..29.54 rows=21 width=51) (actual time=1.485..1.494 rows=21 loops=1)
                Sort Key: x.score DESC, x.updated_at DESC, x.card_id
                Sort Method: quicksort  Memory: 26kB
                Buffers: shared hit=209 read=4
                ->  Subquery Scan on x  (cost=1.25..29.03 rows=21 width=51) (actual time=0.050..1.468 rows=21 loops=1)
                      Buffers: shared hit=209 read=4
                      ->  Limit  (cost=1.25..29.03 rows=21 width=51) (actual time=0.049..1.458 rows=21 loops=1)
                            Buffers: shared hit=209 read=4
                            ->  Nested Loop  (cost=1.25..132691.60 rows=100314 width=51) (actual time=0.049..1.452 rows=21 loops=1)
                                  Buffers: shared hit=209 read=4
                                  ->  Nested Loop  (cost=0.83..76843.57 rows=100316 width=56) (actual time=0.042..0.814 rows=21 loops=1)
                                        Buffers: shared hit=129
                                        ->  Index Scan using worker_profiles_search_updated_idx on worker_profiles w_2  (cost=0.42..15187.89 rows=102098 width=40) (actual time=0.010..0.105 rows=21 loops=1)
                                              Buffers: shared hit=24
                                        ->  Index Scan using profiles_pkey on profiles pr_1  (cost=0.42..0.60 rows=1 width=16) (actual time=0.031..0.031 rows=1 loops=21)
                                              Index Cond: (id = w_2.user_id)
                                              Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                              Buffers: shared hit=105
                                  ->  Index Only Scan using worker_profiles_pkey on worker_profiles w_1  (cost=0.42..0.56 rows=1 width=16) (actual time=0.029..0.029 rows=1 loops=21)
                                        Index Cond: (user_id = pr_1.id)
                                        Heap Fetches: 21
                                        Buffers: shared hit=80 read=4
  InitPlan 11
    ->  CTE Scan on page m  (cost=0.00..0.47 rows=7 width=0) (actual time=0.005..0.005 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  Nested Loop  (cost=1.08..672079.33 rows=7000 width=459) (actual time=2.308..12.220 rows=20 loops=1)
        Buffers: shared hit=864 read=22
        ->  Nested Loop  (cost=0.83..63.40 rows=7 width=145) (actual time=1.507..1.759 rows=20 loops=1)
              Buffers: shared hit=389 read=4
              ->  Nested Loop  (cost=0.42..59.52 rows=7 width=75) (actual time=1.500..1.660 rows=20 loops=1)
                    Buffers: shared hit=309 read=4
                    ->  CTE Scan on page p  (cost=0.00..0.47 rows=7 width=59) (actual time=1.493..1.535 rows=20 loops=1)
                          Filter: (n <= 20)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=209 read=4
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.005..0.005 rows=1 loops=20)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 40
                          Buffers: shared hit=100
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.004..0.004 rows=1 loops=20)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=80
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.421..0.421 rows=1 loops=20)
              Buffers: shared hit=126 read=1
        SubPlan 2
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.024..0.024 rows=1 loops=20)
                Buffers: shared hit=76 read=4
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.021..0.021 rows=3 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=76 read=4
        SubPlan 3
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.025..0.025 rows=1 loops=20)
                Buffers: shared hit=76 read=4
                ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.017..0.018 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=76 read=4
        SubPlan 4
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.017..0.017 rows=1 loops=20)
                Buffers: shared hit=77 read=3
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.015..0.015 rows=3 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 54
                      Buffers: shared hit=77 read=3
        SubPlan 5
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.010..0.010 rows=1 loops=20)
                Buffers: shared hit=45 read=1
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.009..0.009 rows=0 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=45 read=1
        SubPlan 6
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 7
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 8
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.014..0.014 rows=1 loops=10)
                Buffers: shared hit=39 read=1
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.013..0.013 rows=2 loops=10)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 16
                      Buffers: shared hit=39 read=1
        SubPlan 9
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.022..0.022 rows=1 loops=10)
                Buffers: shared hit=36 read=4
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.020..0.020 rows=2 loops=10)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 16
                      Buffers: shared hit=36 read=4
        SubPlan 10
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                Join Filter: (l_1.language_code = f.code)
                ->  Function Scan on unnest f  (cost=0.00..0.01 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (never executed)
                      Index Cond: (worker_user_id = p.user_id)
```

#### basic: keyword "welder"

```
duration: 14.219 ms  plan:
Result  (cost=875.83..875.84 rows=1 width=32) (actual time=14.183..14.183 rows=1 loops=1)
  Buffers: shared hit=2115 read=17
  InitPlan 1
    ->  Bitmap Heap Scan on worker_profiles w  (cost=755.58..875.83 rows=33 width=16) (actual time=3.174..13.693 rows=6805 loops=1)
          Recheck Cond: ((lower(headline) ~~ '%welder%'::text) AND searchable)
          Heap Blocks: exact=1946
          Buffers: shared hit=2115 read=17
          ->  Bitmap Index Scan on worker_profiles_search_headline_trgm_idx  (cost=0.00..755.57 rows=33 width=0) (actual time=2.920..2.920 rows=6805 loops=1)
                Index Cond: (lower(headline) ~~ '%welder%'::text)
                Buffers: shared hit=169 read=17
```

```
duration: 3.580 ms  plan:
Result  (cost=537.85..537.86 rows=1 width=32) (actual time=3.578..3.579 rows=1 loops=1)
  Buffers: shared hit=124 read=32
  InitPlan 1
    ->  Unique  (cost=537.84..537.85 rows=1 width=16) (actual time=3.576..3.576 rows=0 loops=1)
          Buffers: shared hit=124 read=32
          ->  Sort  (cost=537.84..537.85 rows=1 width=16) (actual time=3.576..3.576 rows=0 loops=1)
                Sort Key: s.worker_user_id
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=124 read=32
                ->  Bitmap Heap Scan on worker_skills s  (cost=533.82..537.83 rows=1 width=16) (actual time=3.573..3.573 rows=0 loops=1)
                      Recheck Cond: (lower(skill) ~~ '%welder%'::text)
                      Buffers: shared hit=124 read=32
                      ->  Bitmap Index Scan on worker_skills_lower_skill_trgm_idx  (cost=0.00..533.81 rows=1 width=0) (actual time=3.570..3.570 rows=0 loops=1)
                            Index Cond: (lower(skill) ~~ '%welder%'::text)
                            Buffers: shared hit=124 read=32
```

```
duration: 115.224 ms  plan:
Sort  (cost=685104.24..685121.74 rows=7000 width=459) (actual time=115.195..115.207 rows=20 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 42kB
  Buffers: shared hit=8626 read=100 written=1
  CTE page
    ->  WindowAgg  (cost=12577.33..12577.78 rows=21 width=59) (actual time=102.968..103.017 rows=21 loops=1)
          Buffers: shared hit=8058 read=8
          ->  Subquery Scan on x  (cost=12577.31..12577.36 rows=21 width=51) (actual time=102.960..102.985 rows=21 loops=1)
                Buffers: shared hit=8058 read=8
                ->  Limit  (cost=12577.31..12577.36 rows=21 width=51) (actual time=102.959..102.975 rows=21 loops=1)
                      Buffers: shared hit=8058 read=8
                      ->  Sort  (cost=12577.31..12596.96 rows=7863 width=51) (actual time=102.958..102.970 rows=21 loops=1)
                            Sort Key: (((((COALESCE((w_2.occupation_id = ANY ('{7212}'::text[])), false))::integer + ((w_2.user_id = ANY ('{6805 values}'::uuid[])))::integer) + ((w_2.user_id = ANY ('{}'::uuid[])))::integer) + 0)) DESC, w_2.updated_at DESC, w_2.card_id
                            Sort Method: top-N heapsort  Memory: 29kB
                            Buffers: shared hit=8058 read=8
                            ->  Hash Join  (cost=7904.11..12365.31 rows=7863 width=51) (actual time=60.845..100.187 rows=15220 loops=1)
                                  Hash Cond: (pr_1.id = w_2.user_id)
                                  Buffers: shared hit=8058 read=8
                                  ->  Seq Scan on profiles pr_1  (cost=0.00..3761.03 rows=108082 width=16) (actual time=11.721..30.158 rows=108002 loops=1)
                                        Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                        Rows Removed by Filter: 2000
                                        Buffers: shared hit=2386
                                  ->  Hash  (cost=7770.05..7770.05 rows=8003 width=61) (actual time=48.387..48.390 rows=15514 loops=1)
                                        Buckets: 16384 (originally 8192)  Batches: 1 (originally 1)  Memory Usage: 1537kB
                                        Buffers: shared hit=5672 read=8
                                        ->  Hash Join  (cost=4225.29..7770.05 rows=8003 width=61) (actual time=17.505..44.870 rows=15514 loops=1)
                                              Hash Cond: (w_1.user_id = w_2.user_id)
                                              Buffers: shared hit=5672 read=8
                                              ->  Seq Scan on worker_profiles w_1  (cost=0.00..3256.00 rows=110000 width=16) (actual time=0.028..12.598 rows=110000 loops=1)
                                                    Buffers: shared hit=2156
                                              ->  Hash  (cost=4125.25..4125.25 rows=8003 width=45) (actual time=17.435..17.438 rows=15514 loops=1)
                                                    Buckets: 16384 (originally 8192)  Batches: 1 (originally 1)  Memory Usage: 1295kB
                                                    Buffers: shared hit=3516 read=8
                                                    ->  Bitmap Heap Scan on worker_profiles w_2  (cost=1617.10..4125.25 rows=8003 width=45) (actual time=6.996..14.338 rows=15514 loops=1)
                                                          Recheck Cond: (((occupation_id = ANY ('{7212}'::text[])) AND searchable) OR ((user_id = ANY ('{6805 values}'::uuid[])) AND searchable) OR (user_id = ANY ('{}'::uuid[])))
                                                          Filter: (COALESCE((occupation_id = ANY ('{7212}'::text[])), false) OR (user_id = ANY ('{6805 values}'::uuid[])) OR (user_id = ANY ('{}'::uuid[])))
                                                          Heap Blocks: exact=1999
                                                          Buffers: shared hit=3516 read=8
                                                          ->  BitmapOr  (cost=1583.08..1583.08 rows=15651 width=0) (actual time=6.484..6.485 rows=0 loops=1)
                                                                Buffers: shared hit=1517 read=8
                                                                ->  Bitmap Index Scan on worker_profiles_search_occupation_idx  (cost=0.00..142.30 rows=9335 width=0) (actual time=1.176..1.176 rows=9347 loops=1)
                                                                      Index Cond: (occupation_id = ANY ('{7212}'::text[]))
                                                                      Buffers: shared hit=1 read=8
                                                                ->  Bitmap Index Scan on worker_profiles_searchable_idx  (cost=0.00..1430.35 rows=6316 width=0) (actual time=5.303..5.303 rows=6805 loops=1)
                                                                      Index Cond: (user_id = ANY ('{6805 values}'::uuid[]))
                                                                      Buffers: shared hit=1516
                                                                ->  Bitmap Index Scan on worker_profiles_searchable_idx  (cost=0.00..4.43 rows=1 width=0) (actual time=0.004..0.004 rows=0 loops=1)
                                                                      Index Cond: (user_id = ANY ('{}'::uuid[]))
  InitPlan 11
    ->  CTE Scan on page m  (cost=0.00..0.47 rows=7 width=0) (actual time=0.004..0.004 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  Nested Loop  (cost=1.08..672079.33 rows=7000 width=459) (actual time=104.094..115.156 rows=20 loops=1)
        Buffers: shared hit=8626 read=100 written=1
        ->  Nested Loop  (cost=0.83..63.40 rows=7 width=145) (actual time=103.065..103.963 rows=20 loops=1)
              Buffers: shared hit=8219 read=27
              ->  Nested Loop  (cost=0.42..59.52 rows=7 width=75) (actual time=103.002..103.464 rows=20 loops=1)
                    Buffers: shared hit=8152 read=14
                    ->  CTE Scan on page p  (cost=0.00..0.47 rows=7 width=59) (actual time=102.971..103.028 rows=20 loops=1)
                          Filter: (n <= 20)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=8058 read=8
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.021..0.021 rows=1 loops=20)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 40
                          Buffers: shared hit=94 read=6
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.023..0.023 rows=1 loops=20)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=67 read=13
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.425..0.425 rows=1 loops=20)
              Buffers: shared hit=124
        SubPlan 2
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.034..0.034 rows=1 loops=20)
                Buffers: shared hit=63 read=17
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.030..0.031 rows=4 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=63 read=17
        SubPlan 3
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.032..0.032 rows=1 loops=20)
                Buffers: shared hit=66 read=14
                ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.023..0.024 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=66 read=14
        SubPlan 4
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.023..0.023 rows=1 loops=20)
                Buffers: shared hit=65 read=16
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.021..0.021 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 43
                      Buffers: shared hit=65 read=16
        SubPlan 5
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.008..0.008 rows=1 loops=20)
                Buffers: shared hit=39 read=4
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.007..0.007 rows=0 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=39 read=4
        SubPlan 6
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 7
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 8
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.019..0.019 rows=1 loops=9)
                Buffers: shared hit=30 read=6
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.017..0.017 rows=1 loops=9)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 13
                      Buffers: shared hit=30 read=6
        SubPlan 9
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.041..0.041 rows=1 loops=9)
                Buffers: shared hit=20 read=16 written=1
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.038..0.039 rows=1 loops=9)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 10
                      Buffers: shared hit=20 read=16 written=1
        SubPlan 10
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                Join Filter: (l_1.language_code = f.code)
                ->  Function Scan on unnest f  (cost=0.00..0.01 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (never executed)
                      Index Cond: (worker_user_id = p.user_id)
```

#### basic: keyword "dementia"

```
duration: 1.358 ms  plan:
Result  (cost=839.79..839.80 rows=1 width=32) (actual time=1.357..1.357 rows=1 loops=1)
  Buffers: shared hit=171
  InitPlan 1
    ->  Bitmap Heap Scan on worker_profiles w  (cost=801.68..839.79 rows=10 width=16) (actual time=1.355..1.356 rows=0 loops=1)
          Recheck Cond: ((lower(headline) ~~ '%dementia%'::text) AND searchable)
          Buffers: shared hit=171
          ->  Bitmap Index Scan on worker_profiles_search_headline_trgm_idx  (cost=0.00..801.68 rows=10 width=0) (actual time=1.348..1.349 rows=0 loops=1)
                Index Cond: (lower(headline) ~~ '%dementia%'::text)
                Buffers: shared hit=171
```

```
duration: 19.503 ms  plan:
Result  (cost=4831.48..4831.49 rows=1 width=32) (actual time=19.456..19.456 rows=1 loops=1)
  Buffers: shared hit=3828
  InitPlan 1
    ->  HashAggregate  (cost=4728.79..4831.48 rows=10269 width=16) (actual time=17.832..18.747 rows=10668 loops=1)
          Group Key: s.worker_user_id
          Batches: 1  Memory Usage: 913kB
          Buffers: shared hit=3828
          ->  Bitmap Heap Scan on worker_skills s  (cost=648.58..4702.05 rows=10698 width=16) (actual time=4.233..15.623 rows=10668 loops=1)
                Recheck Cond: (lower(skill) ~~ '%dementia%'::text)
                Heap Blocks: exact=3676
                Buffers: shared hit=3828
                ->  Bitmap Index Scan on worker_skills_lower_skill_trgm_idx  (cost=0.00..645.90 rows=10698 width=0) (actual time=3.779..3.779 rows=10668 loops=1)
                      Index Cond: (lower(skill) ~~ '%dementia%'::text)
                      Buffers: shared hit=152
```

```
duration: 87.673 ms  plan:
Sort  (cost=683630.33..683647.83 rows=7000 width=459) (actual time=87.645..87.657 rows=20 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 43kB
  Buffers: shared hit=55533 read=211
  CTE page
    ->  WindowAgg  (cost=11103.42..11103.87 rows=21 width=59) (actual time=77.957..78.012 rows=21 loops=1)
          Buffers: shared hit=54949 read=148
          ->  Subquery Scan on x  (cost=11103.40..11103.45 rows=21 width=51) (actual time=77.948..77.971 rows=21 loops=1)
                Buffers: shared hit=54949 read=148
                ->  Limit  (cost=11103.40..11103.45 rows=21 width=51) (actual time=77.946..77.961 rows=21 loops=1)
                      Buffers: shared hit=54949 read=148
                      ->  Sort  (cost=11103.40..11116.74 rows=5336 width=51) (actual time=77.945..77.956 rows=21 loops=1)
                            Sort Key: (((((COALESCE((w_2.occupation_id = ANY ('{}'::text[])), false))::integer + ((w_2.user_id = ANY ('{}'::uuid[])))::integer) + ((w_2.user_id = ANY ('{10668 values}'::uuid[])))::integer) + 0)) DESC, w_2.updated_at DESC, w_2.card_id
                            Sort Method: top-N heapsort  Memory: 29kB
                            Buffers: shared hit=54949 read=148
                            ->  Nested Loop  (cost=3999.10..10959.53 rows=5336 width=51) (actual time=14.422..75.688 rows=9686 loops=1)
                                  Join Filter: (pr_1.id = w_2.user_id)
                                  Buffers: shared hit=54949 read=148
                                  ->  Hash Join  (cost=3945.34..7490.10 rows=5431 width=61) (actual time=13.756..39.162 rows=9889 loops=1)
                                        Hash Cond: (w_1.user_id = w_2.user_id)
                                        Buffers: shared hit=5652
                                        ->  Seq Scan on worker_profiles w_1  (cost=0.00..3256.00 rows=110000 width=16) (actual time=0.007..10.880 rows=110000 loops=1)
                                              Buffers: shared hit=2156
                                        ->  Hash  (cost=3877.45..3877.45 rows=5431 width=45) (actual time=13.724..13.725 rows=9889 loops=1)
                                              Buckets: 16384 (originally 8192)  Batches: 1 (originally 1)  Memory Usage: 872kB
                                              Buffers: shared hit=3496
                                              ->  Bitmap Heap Scan on worker_profiles w_2  (cost=1523.41..3877.45 rows=5431 width=45) (actual time=6.597..11.256 rows=9889 loops=1)
                                                    Recheck Cond: ((occupation_id = ANY ('{}'::text[])) OR (user_id = ANY ('{}'::uuid[])) OR ((user_id = ANY ('{10668 values}'::uuid[])) AND searchable))
                                                    Heap Blocks: exact=1988
                                                    Buffers: shared hit=3496
                                                    ->  BitmapOr  (cost=1470.07..1470.07 rows=9902 width=0) (actual time=6.322..6.323 rows=0 loops=1)
                                                          Buffers: shared hit=1508
                                                          ->  Bitmap Index Scan on worker_profiles_search_occupation_idx  (cost=0.00..4.30 rows=1 width=0) (actual time=0.001..0.001 rows=0 loops=1)
                                                                Index Cond: (occupation_id = ANY ('{}'::text[]))
                                                          ->  Bitmap Index Scan on worker_profiles_searchable_idx  (cost=0.00..4.43 rows=1 width=0) (actual time=0.000..0.000 rows=0 loops=1)
                                                                Index Cond: (user_id = ANY ('{}'::uuid[]))
                                                          ->  Bitmap Index Scan on worker_profiles_searchable_idx  (cost=0.00..1457.27 rows=9902 width=0) (actual time=6.321..6.321 rows=9889 loops=1)
                                                                Index Cond: (user_id = ANY ('{10668 values}'::uuid[]))
                                                                Buffers: shared hit=1508
                                  ->  Index Scan using profiles_pkey on profiles pr_1  (cost=0.42..0.59 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=9889)
                                        Index Cond: (id = w_1.user_id)
                                        Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                        Rows Removed by Filter: 0
                                        Buffers: shared hit=49297 read=148
  InitPlan 11
    ->  CTE Scan on page m  (cost=0.00..0.47 rows=7 width=0) (actual time=0.004..0.004 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  Nested Loop  (cost=1.08..672079.33 rows=7000 width=459) (actual time=78.796..87.618 rows=20 loops=1)
        Buffers: shared hit=55533 read=211
        ->  Nested Loop  (cost=0.83..63.40 rows=7 width=145) (actual time=77.998..78.564 rows=20 loops=1)
              Buffers: shared hit=55118 read=159
              ->  Nested Loop  (cost=0.42..59.52 rows=7 width=75) (actual time=77.984..78.172 rows=20 loops=1)
                    Buffers: shared hit=55049 read=148
                    ->  CTE Scan on page p  (cost=0.00..0.47 rows=7 width=59) (actual time=77.959..78.020 rows=20 loops=1)
                          Filter: (n <= 20)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=54949 read=148
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.007..0.007 rows=1 loops=20)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 40
                          Buffers: shared hit=100
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.019..0.019 rows=1 loops=20)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=69 read=11
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.342..0.343 rows=1 loops=20)
              Buffers: shared hit=122
        SubPlan 2
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.025..0.025 rows=1 loops=20)
                Buffers: shared hit=67 read=13
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.021..0.022 rows=4 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=67 read=13
        SubPlan 3
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.029..0.029 rows=1 loops=20)
                Buffers: shared hit=62 read=18
                ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.022..0.022 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=62 read=18
        SubPlan 4
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.021..0.021 rows=1 loops=20)
                Buffers: shared hit=67 read=13
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.018..0.019 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 49
                      Buffers: shared hit=67 read=13
        SubPlan 5
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.005..0.006 rows=1 loops=20)
                Buffers: shared hit=40 read=1
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.005..0.005 rows=0 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=40 read=1
        SubPlan 6
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 7
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 8
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.013..0.013 rows=1 loops=8)
                Buffers: shared hit=29 read=3
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.011..0.012 rows=2 loops=8)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 12
                      Buffers: shared hit=29 read=3
        SubPlan 9
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.040..0.040 rows=1 loops=8)
                Buffers: shared hit=28 read=4
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.037..0.038 rows=2 loops=8)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 12
                      Buffers: shared hit=28 read=4
        SubPlan 10
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                Join Filter: (l_1.language_code = f.code)
                ->  Function Scan on unnest f  (cost=0.00..0.01 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (never executed)
                      Index Cond: (worker_user_id = p.user_id)
```

#### basic: occupation, destination

```
duration: 32.660 ms  plan:
Sort  (cost=676626.82..676644.32 rows=7000 width=459) (actual time=32.636..32.644 rows=20 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 43kB
  Buffers: shared hit=3052 read=55
  CTE page
    ->  WindowAgg  (cost=4099.90..4100.35 rows=21 width=59) (actual time=24.162..24.184 rows=21 loops=1)
          Buffers: shared hit=2401 read=40
          ->  Sort  (cost=4099.88..4099.93 rows=21 width=51) (actual time=24.157..24.164 rows=21 loops=1)
                Sort Key: x.score DESC, x.updated_at DESC, x.card_id
                Sort Method: quicksort  Memory: 26kB
                Buffers: shared hit=2401 read=40
                ->  Subquery Scan on x  (cost=1.25..4099.42 rows=21 width=51) (actual time=23.097..24.144 rows=21 loops=1)
                      Buffers: shared hit=2401 read=40
                      ->  Limit  (cost=1.25..4099.42 rows=21 width=51) (actual time=23.097..24.139 rows=21 loops=1)
                            Buffers: shared hit=2401 read=40
                            ->  Nested Loop  (cost=1.25..895158.34 rows=4587 width=51) (actual time=23.096..24.134 rows=21 loops=1)
                                  Join Filter: (pr_1.id = w_2.user_id)
                                  Buffers: shared hit=2401 read=40
                                  ->  Nested Loop  (cost=0.83..892336.83 rows=4668 width=56) (actual time=23.077..23.982 rows=22 loops=1)
                                        Buffers: shared hit=2291 read=40
                                        ->  Index Scan using worker_profiles_search_updated_idx on worker_profiles w_2  (cost=0.42..877150.25 rows=4668 width=40) (actual time=23.057..23.596 rows=22 loops=1)
                                              Filter: ((occupation_id = '7212'::text) AND (ANY (user_id = (hashed SubPlan 2).col1)))
                                              Rows Removed by Filter: 530
                                              Buffers: shared hit=2213 read=30
                                              SubPlan 2
                                                ->  Bitmap Heap Scan on worker_preferred_countries pc  (cost=462.80..2525.84 rows=32323 width=16) (actual time=1.283..15.002 rows=32060 loops=1)
                                                      Recheck Cond: (country_code = 'DE'::text)
                                                      Heap Blocks: exact=1659
                                                      Buffers: shared hit=1656 read=30
                                                      ->  Bitmap Index Scan on worker_preferred_countries_country_idx  (cost=0.00..454.72 rows=32323 width=0) (actual time=1.095..1.095 rows=32060 loops=1)
                                                            Index Cond: (country_code = 'DE'::text)
                                                            Buffers: shared hit=4 read=23
                                        ->  Index Only Scan using worker_profiles_pkey on worker_profiles w_1  (cost=0.42..3.25 rows=1 width=16) (actual time=0.017..0.017 rows=1 loops=22)
                                              Index Cond: (user_id = w_2.user_id)
                                              Heap Fetches: 22
                                              Buffers: shared hit=78 read=10
                                  ->  Index Scan using profiles_pkey on profiles pr_1  (cost=0.42..0.59 rows=1 width=16) (actual time=0.006..0.006 rows=1 loops=22)
                                        Index Cond: (id = w_1.user_id)
                                        Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                        Rows Removed by Filter: 0
                                        Buffers: shared hit=110
  InitPlan 13
    ->  CTE Scan on page m  (cost=0.00..0.47 rows=7 width=0) (actual time=0.006..0.006 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  Nested Loop  (cost=1.08..672079.33 rows=7000 width=459) (actual time=24.937..32.616 rows=20 loops=1)
        Buffers: shared hit=3052 read=55
        ->  Nested Loop  (cost=0.83..63.40 rows=7 width=144) (actual time=24.172..24.395 rows=20 loops=1)
              Buffers: shared hit=2581 read=40
              ->  Nested Loop  (cost=0.42..59.52 rows=7 width=74) (actual time=24.168..24.316 rows=20 loops=1)
                    Buffers: shared hit=2501 read=40
                    ->  CTE Scan on page p  (cost=0.00..0.47 rows=7 width=58) (actual time=24.164..24.192 rows=20 loops=1)
                          Filter: (n <= 20)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=2401 read=40
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.005..0.005 rows=1 loops=20)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 40
                          Buffers: shared hit=100
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.003..0.003 rows=1 loops=20)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=80
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.325..0.325 rows=1 loops=20)
              Buffers: shared hit=122
        SubPlan 4
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.020..0.020 rows=1 loops=20)
                Buffers: shared hit=81
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.017..0.017 rows=4 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=81
        SubPlan 5
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.020..0.020 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.014..0.014 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=80
        SubPlan 6
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.013..0.013 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.011..0.011 rows=3 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 56
                      Buffers: shared hit=80
        SubPlan 7
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.006..0.006 rows=1 loops=20)
                Buffers: shared hit=43
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.006..0.006 rows=0 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=43
        SubPlan 8
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 9
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 10
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.022..0.022 rows=1 loops=10)
                Buffers: shared hit=32 read=8
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.020..0.021 rows=1 loops=10)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 14
                      Buffers: shared hit=32 read=8
        SubPlan 11
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.017..0.017 rows=1 loops=10)
                Buffers: shared hit=33 read=7
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.016..0.016 rows=1 loops=10)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 14
                      Buffers: shared hit=33 read=7
        SubPlan 12
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                Join Filter: (l_1.language_code = f.code)
                ->  Function Scan on unnest f  (cost=0.00..0.01 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (never executed)
                      Index Cond: (worker_user_id = p.user_id)
```

#### basic: lives in, available now

```
duration: 9.515 ms  plan:
Sort  (cost=672649.40..672666.90 rows=7000 width=459) (actual time=9.492..9.500 rows=20 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 45kB
  Buffers: shared hit=1193 read=19
  CTE page
    ->  WindowAgg  (cost=122.49..122.94 rows=21 width=59) (actual time=0.794..0.819 rows=21 loops=1)
          Buffers: shared hit=523 read=6
          ->  Sort  (cost=122.47..122.52 rows=21 width=51) (actual time=0.791..0.797 rows=21 loops=1)
                Sort Key: x.score DESC, x.updated_at DESC, x.card_id
                Sort Method: quicksort  Memory: 26kB
                Buffers: shared hit=523 read=6
                ->  Subquery Scan on x  (cost=1.25..122.01 rows=21 width=51) (actual time=0.022..0.783 rows=21 loops=1)
                      Buffers: shared hit=523 read=6
                      ->  Limit  (cost=1.25..122.01 rows=21 width=51) (actual time=0.022..0.778 rows=21 loops=1)
                            Buffers: shared hit=523 read=6
                            ->  Nested Loop  (cost=1.25..35359.17 rows=6149 width=51) (actual time=0.021..0.775 rows=21 loops=1)
                                  Join Filter: (pr_1.id = w_2.user_id)
                                  Buffers: shared hit=523 read=6
                                  ->  Nested Loop  (cost=0.83..31576.61 rows=6258 width=56) (actual time=0.015..0.643 rows=21 loops=1)
                                        Buffers: shared hit=418 read=6
                                        ->  Index Scan using worker_profiles_search_updated_idx on worker_profiles w_2  (cost=0.42..15698.38 rows=6258 width=40) (actual time=0.009..0.348 rows=21 loops=1)
                                              Filter: ((current_country = 'PH'::text) AND (availability = 'now'::public.worker_availability))
                                              Rows Removed by Filter: 314
                                              Buffers: shared hit=340
                                        ->  Index Only Scan using worker_profiles_pkey on worker_profiles w_1  (cost=0.42..2.54 rows=1 width=16) (actual time=0.013..0.013 rows=1 loops=21)
                                              Index Cond: (user_id = w_2.user_id)
                                              Heap Fetches: 21
                                              Buffers: shared hit=78 read=6
                                  ->  Index Scan using profiles_pkey on profiles pr_1  (cost=0.42..0.59 rows=1 width=16) (actual time=0.006..0.006 rows=1 loops=21)
                                        Index Cond: (id = w_1.user_id)
                                        Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                        Buffers: shared hit=105
  InitPlan 11
    ->  CTE Scan on page m  (cost=0.00..0.47 rows=7 width=0) (actual time=0.004..0.004 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  Nested Loop  (cost=1.08..672079.33 rows=7000 width=459) (actual time=1.365..9.469 rows=20 loops=1)
        Buffers: shared hit=1193 read=19
        ->  Nested Loop  (cost=0.83..63.40 rows=7 width=145) (actual time=0.803..1.038 rows=20 loops=1)
              Buffers: shared hit=703 read=6
              ->  Nested Loop  (cost=0.42..59.52 rows=7 width=75) (actual time=0.800..0.959 rows=20 loops=1)
                    Buffers: shared hit=623 read=6
                    ->  CTE Scan on page p  (cost=0.00..0.47 rows=7 width=59) (actual time=0.795..0.831 rows=20 loops=1)
                          Filter: (n <= 20)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=523 read=6
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.006..0.006 rows=1 loops=20)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 40
                          Buffers: shared hit=100
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.003..0.003 rows=1 loops=20)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=80
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.340..0.340 rows=1 loops=20)
              Buffers: shared hit=120
        SubPlan 2
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.017..0.017 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.014..0.014 rows=3 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=80
        SubPlan 3
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.017..0.017 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.011..0.011 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=80
        SubPlan 4
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.013..0.013 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.011..0.012 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 48
                      Buffers: shared hit=80
        SubPlan 5
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.006..0.006 rows=1 loops=20)
                Buffers: shared hit=47
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.005..0.005 rows=0 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=47
        SubPlan 6
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 7
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 8
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.019..0.019 rows=1 loops=12)
                Buffers: shared hit=41 read=7
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.017..0.017 rows=2 loops=12)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 21
                      Buffers: shared hit=41 read=7
        SubPlan 9
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.015..0.015 rows=1 loops=12)
                Buffers: shared hit=42 read=6
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.013..0.013 rows=2 loops=12)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 20
                      Buffers: shared hit=42 read=6
        SubPlan 10
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                Join Filter: (l_1.language_code = f.code)
                ->  Function Scan on unnest f  (cost=0.00..0.01 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (never executed)
                      Index Cond: (worker_user_id = p.user_id)
```

#### basic: available by, page of 50

```
duration: 23.920 ms  plan:
Sort  (cost=1637019.26..1637061.76 rows=17000 width=459) (actual time=23.875..23.887 rows=50 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 70kB
  Buffers: shared hit=2170 read=37
  CTE page
    ->  WindowAgg  (cost=85.73..86.85 rows=51 width=59) (actual time=1.012..1.070 rows=51 loops=1)
          Buffers: shared hit=562 read=11
          ->  Sort  (cost=85.71..85.83 rows=51 width=51) (actual time=1.009..1.023 rows=51 loops=1)
                Sort Key: x.score DESC, x.updated_at DESC, x.card_id
                Sort Method: quicksort  Memory: 28kB
                Buffers: shared hit=562 read=11
                ->  Subquery Scan on x  (cost=1.25..84.26 rows=51 width=51) (actual time=0.034..0.992 rows=51 loops=1)
                      Buffers: shared hit=562 read=11
                      ->  Limit  (cost=1.25..84.26 rows=51 width=51) (actual time=0.033..0.981 rows=51 loops=1)
                            Buffers: shared hit=562 read=11
                            ->  Nested Loop  (cost=1.25..83166.55 rows=51097 width=51) (actual time=0.033..0.975 rows=51 loops=1)
                                  Join Filter: (pr_1.id = w_2.user_id)
                                  Buffers: shared hit=562 read=11
                                  ->  Nested Loop  (cost=0.83..51732.23 rows=52006 width=56) (actual time=0.023..0.698 rows=52 loops=1)
                                        Buffers: shared hit=302 read=11
                                        ->  Index Scan using worker_profiles_search_updated_idx on worker_profiles w_2  (cost=0.42..15953.62 rows=52006 width=40) (actual time=0.008..0.133 rows=52 loops=1)
                                              Filter: ((availability = 'now'::public.worker_availability) OR ((availability = 'from_date'::public.worker_availability) AND (available_from <= '2027-01-16'::date)))
                                              Rows Removed by Filter: 50
                                              Buffers: shared hit=105
                                        ->  Index Only Scan using worker_profiles_pkey on worker_profiles w_1  (cost=0.42..0.69 rows=1 width=16) (actual time=0.010..0.010 rows=1 loops=52)
                                              Index Cond: (user_id = w_2.user_id)
                                              Heap Fetches: 52
                                              Buffers: shared hit=197 read=11
                                  ->  Index Scan using profiles_pkey on profiles pr_1  (cost=0.42..0.59 rows=1 width=16) (actual time=0.005..0.005 rows=1 loops=52)
                                        Index Cond: (id = w_1.user_id)
                                        Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                        Rows Removed by Filter: 0
                                        Buffers: shared hit=260
  InitPlan 11
    ->  CTE Scan on page m  (cost=0.00..1.15 rows=17 width=0) (actual time=0.006..0.006 rows=1 loops=1)
          Filter: (n > 50)
          Rows Removed by Filter: 50
  ->  Nested Loop  (cost=1.08..1632192.31 rows=17000 width=459) (actual time=1.524..23.819 rows=50 loops=1)
        Buffers: shared hit=2170 read=37
        ->  Nested Loop  (cost=0.83..153.97 rows=17 width=145) (actual time=1.020..1.686 rows=50 loops=1)
              Buffers: shared hit=1012 read=11
              ->  Nested Loop  (cost=0.42..144.54 rows=17 width=75) (actual time=1.017..1.432 rows=50 loops=1)
                    Buffers: shared hit=812 read=11
                    ->  CTE Scan on page p  (cost=0.00..1.15 rows=17 width=59) (actual time=1.013..1.101 rows=50 loops=1)
                          Filter: (n <= 50)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=562 read=11
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.006..0.006 rows=1 loops=50)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 100
                          Buffers: shared hit=250
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.004..0.004 rows=1 loops=50)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=200
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.372..0.372 rows=1 loops=50)
              Buffers: shared hit=306
        SubPlan 2
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.016..0.016 rows=1 loops=50)
                Buffers: shared hit=202
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.013..0.014 rows=4 loops=50)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=202
        SubPlan 3
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.017..0.017 rows=1 loops=50)
                Buffers: shared hit=200
                ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.010..0.010 rows=2 loops=50)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=200
        SubPlan 4
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.011..0.011 rows=1 loops=50)
                Buffers: shared hit=200
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.009..0.010 rows=2 loops=50)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 120
                      Buffers: shared hit=200
        SubPlan 5
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.005..0.005 rows=1 loops=50)
                Buffers: shared hit=108
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.004..0.004 rows=0 loops=50)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=108
        SubPlan 6
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 7
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 8
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.016..0.016 rows=1 loops=21)
                Buffers: shared hit=76 read=8
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.014..0.014 rows=1 loops=21)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 31
                      Buffers: shared hit=76 read=8
        SubPlan 9
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.018..0.018 rows=1 loops=21)
                Buffers: shared hit=66 read=18
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.016..0.016 rows=1 loops=21)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 29
                      Buffers: shared hit=66 read=18
        SubPlan 10
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=50)
                Join Filter: (l_1.language_code = f.code)
                ->  Function Scan on unnest f  (cost=0.00..0.01 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=50)
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (never executed)
                      Index Cond: (worker_user_id = p.user_id)
```

#### basic: deep page (cursor at 2,000)

```
duration: 12.975 ms  plan:
Sort  (cost=672556.73..672574.23 rows=7000 width=459) (actual time=12.938..12.948 rows=20 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 42kB
  Buffers: shared hit=2892 read=27
  CTE page
    ->  WindowAgg  (cost=29.82..30.27 rows=21 width=59) (actual time=3.203..3.234 rows=21 loops=1)
          Buffers: shared hit=2260 read=7
          ->  Sort  (cost=29.80..29.85 rows=21 width=51) (actual time=3.199..3.207 rows=21 loops=1)
                Sort Key: x.score DESC, x.updated_at DESC, x.card_id
                Sort Method: quicksort  Memory: 26kB
                Buffers: shared hit=2260 read=7
                ->  Subquery Scan on x  (cost=1.25..29.33 rows=21 width=51) (actual time=2.694..3.190 rows=21 loops=1)
                      Buffers: shared hit=2260 read=7
                      ->  Limit  (cost=1.25..29.33 rows=21 width=51) (actual time=2.693..3.185 rows=21 loops=1)
                            Buffers: shared hit=2260 read=7
                            ->  Nested Loop  (cost=1.25..131397.46 rows=98258 width=51) (actual time=2.692..3.181 rows=21 loops=1)
                                  Buffers: shared hit=2260 read=7
                                  ->  Nested Loop  (cost=0.83..76694.06 rows=98260 width=56) (actual time=2.671..2.813 rows=21 loops=1)
                                        Buffers: shared hit=2183
                                        ->  Index Scan using worker_profiles_search_updated_idx on worker_profiles w_2  (cost=0.42..15953.62 rows=100006 width=40) (actual time=2.658..2.679 rows=21 loops=1)
                                              Filter: ((updated_at < '2026-11-10 11:23:21.835315+00'::timestamp with time zone) OR ((updated_at = '2026-11-10 11:23:21.835315+00'::timestamp with time zone) AND (card_id > '94fd28e1-1b8a-42bc-9af8-734ad200eb2e'::uuid)))
                                              Rows Removed by Filter: 2043
                                              Buffers: shared hit=2078
                                        ->  Index Scan using profiles_pkey on profiles pr_1  (cost=0.42..0.61 rows=1 width=16) (actual time=0.006..0.006 rows=1 loops=21)
                                              Index Cond: (id = w_2.user_id)
                                              Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                              Buffers: shared hit=105
                                  ->  Index Only Scan using worker_profiles_pkey on worker_profiles w_1  (cost=0.42..0.56 rows=1 width=16) (actual time=0.017..0.017 rows=1 loops=21)
                                        Index Cond: (user_id = pr_1.id)
                                        Heap Fetches: 21
                                        Buffers: shared hit=77 read=7
  InitPlan 11
    ->  CTE Scan on page m  (cost=0.00..0.47 rows=7 width=0) (actual time=0.005..0.005 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  Nested Loop  (cost=1.08..672079.33 rows=7000 width=459) (actual time=3.814..12.914 rows=20 loops=1)
        Buffers: shared hit=2892 read=27
        ->  Nested Loop  (cost=0.83..63.40 rows=7 width=145) (actual time=3.213..3.459 rows=20 loops=1)
              Buffers: shared hit=2440 read=7
              ->  Nested Loop  (cost=0.42..59.52 rows=7 width=75) (actual time=3.209..3.355 rows=20 loops=1)
                    Buffers: shared hit=2360 read=7
                    ->  CTE Scan on page p  (cost=0.00..0.47 rows=7 width=59) (actual time=3.205..3.246 rows=20 loops=1)
                          Filter: (n <= 20)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=2260 read=7
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.005..0.005 rows=1 loops=20)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 40
                          Buffers: shared hit=100
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.004..0.004 rows=1 loops=20)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=80
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.361..0.362 rows=1 loops=20)
              Buffers: shared hit=123
        SubPlan 2
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.027..0.027 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.023..0.024 rows=4 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=80
        SubPlan 3
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.026..0.026 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.019..0.019 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=80
        SubPlan 4
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.016..0.016 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.014..0.015 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 42
                      Buffers: shared hit=80
        SubPlan 5
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.006..0.006 rows=1 loops=20)
                Buffers: shared hit=45
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.005..0.005 rows=0 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=45
        SubPlan 6
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 7
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 8
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.032..0.032 rows=1 loops=8)
                Buffers: shared hit=25 read=7
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.030..0.031 rows=1 loops=8)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 10
                      Buffers: shared hit=25 read=7
        SubPlan 9
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.030..0.030 rows=1 loops=8)
                Buffers: shared hit=19 read=13
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.027..0.027 rows=1 loops=8)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 9
                      Buffers: shared hit=19 read=13
        SubPlan 10
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                Join Filter: (l_1.language_code = f.code)
                ->  Function Scan on unnest f  (cost=0.00..0.01 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (never executed)
                      Index Cond: (worker_user_id = p.user_id)
```

#### basic: rules shape the cards (Ethiopia)

```
duration: 36.979 ms  plan:
Sort  (cost=681873.31..681890.81 rows=7000 width=459) (actual time=36.923..36.946 rows=20 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 34kB
  Buffers: shared hit=4583 read=34
  CTE page
    ->  WindowAgg  (cost=9346.40..9346.85 rows=21 width=59) (actual time=19.019..19.064 rows=21 loops=1)
          Buffers: shared hit=3904 read=6
          ->  Sort  (cost=9346.38..9346.43 rows=21 width=51) (actual time=19.011..19.026 rows=21 loops=1)
                Sort Key: x.score DESC, x.updated_at DESC, x.card_id
                Sort Method: quicksort  Memory: 26kB
                Buffers: shared hit=3904 read=6
                ->  Subquery Scan on x  (cost=1.25..9345.92 rows=21 width=51) (actual time=15.293..18.994 rows=21 loops=1)
                      Buffers: shared hit=3904 read=6
                      ->  Limit  (cost=1.25..9345.92 rows=21 width=51) (actual time=15.293..18.984 rows=21 loops=1)
                            Buffers: shared hit=3904 read=6
                            ->  Nested Loop  (cost=1.25..889079.42 rows=1998 width=51) (actual time=15.291..18.976 rows=21 loops=1)
                                  Join Filter: (pr_1.id = w_2.user_id)
                                  Buffers: shared hit=3904 read=6
                                  ->  Nested Loop  (cost=0.83..887850.61 rows=2033 width=56) (actual time=15.278..18.758 rows=21 loops=1)
                                        Buffers: shared hit=3799 read=6
                                        ->  Index Scan using worker_profiles_search_updated_idx on worker_profiles w_2  (cost=0.42..877150.25 rows=2033 width=40) (actual time=15.258..17.637 rows=21 loops=1)
                                              Filter: ((current_country = 'ET'::text) AND (ANY (user_id = (hashed SubPlan 2).col1)))
                                              Rows Removed by Filter: 2000
                                              Buffers: shared hit=3721
                                              SubPlan 2
                                                ->  Bitmap Heap Scan on worker_preferred_countries pc  (cost=462.80..2525.84 rows=32323 width=16) (actual time=0.882..8.380 rows=32060 loops=1)
                                                      Recheck Cond: (country_code = 'DE'::text)
                                                      Heap Blocks: exact=1659
                                                      Buffers: shared hit=1686
                                                      ->  Bitmap Index Scan on worker_preferred_countries_country_idx  (cost=0.00..454.72 rows=32323 width=0) (actual time=0.703..0.703 rows=32060 loops=1)
                                                            Index Cond: (country_code = 'DE'::text)
                                                            Buffers: shared hit=27
                                        ->  Index Only Scan using worker_profiles_pkey on worker_profiles w_1  (cost=0.42..5.26 rows=1 width=16) (actual time=0.052..0.052 rows=1 loops=21)
                                              Index Cond: (user_id = w_2.user_id)
                                              Heap Fetches: 21
                                              Buffers: shared hit=78 read=6
                                  ->  Index Scan using profiles_pkey on profiles pr_1  (cost=0.42..0.59 rows=1 width=16) (actual time=0.009..0.009 rows=1 loops=21)
                                        Index Cond: (id = w_1.user_id)
                                        Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                        Buffers: shared hit=105
  InitPlan 13
    ->  CTE Scan on page m  (cost=0.00..0.47 rows=7 width=0) (actual time=0.008..0.008 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  Nested Loop  (cost=1.08..672079.33 rows=7000 width=459) (actual time=20.116..36.893 rows=20 loops=1)
        Buffers: shared hit=4583 read=34
        ->  Nested Loop  (cost=0.83..63.40 rows=7 width=145) (actual time=19.038..19.446 rows=20 loops=1)
              Buffers: shared hit=4084 read=6
              ->  Nested Loop  (cost=0.42..59.52 rows=7 width=75) (actual time=19.031..19.284 rows=20 loops=1)
                    Buffers: shared hit=4004 read=6
                    ->  CTE Scan on page p  (cost=0.00..0.47 rows=7 width=59) (actual time=19.022..19.081 rows=20 loops=1)
                          Filter: (n <= 20)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=3904 read=6
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.009..0.009 rows=1 loops=20)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 40
                          Buffers: shared hit=100
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.006..0.006 rows=1 loops=20)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=80
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.530..0.530 rows=1 loops=20)
              Buffers: shared hit=140
        SubPlan 4
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.081..0.081 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.075..0.076 rows=4 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=80
        SubPlan 5
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.055..0.055 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.039..0.040 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=80
        SubPlan 6
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.043..0.043 rows=1 loops=20)
                Buffers: shared hit=81
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.033..0.034 rows=3 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 55
                      Buffers: shared hit=81
        SubPlan 7
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.010..0.010 rows=1 loops=20)
                Buffers: shared hit=42
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.009..0.009 rows=0 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=42
        SubPlan 8
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 9
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 10
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.115..0.116 rows=1 loops=13)
                Buffers: shared hit=44 read=8
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.111..0.112 rows=2 loops=13)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 21
                      Buffers: shared hit=44 read=8
        SubPlan 11
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.068..0.068 rows=1 loops=13)
                Buffers: shared hit=32 read=20
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.063..0.064 rows=2 loops=13)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 20
                      Buffers: shared hit=32 read=20
        SubPlan 12
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.000..0.001 rows=0 loops=20)
                Join Filter: (l_1.language_code = f.code)
                ->  Function Scan on unnest f  (cost=0.00..0.01 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (never executed)
                      Index Cond: (worker_user_id = p.user_id)
```

#### advanced: two skills

```
duration: 52.803 ms  plan:
Aggregate  (cost=4966.10..4966.11 rows=1 width=64) (actual time=51.494..51.495 rows=1 loops=1)
  Buffers: shared hit=3900
  ->  HashAggregate  (cost=4627.54..4869.37 rows=19346 width=20) (actual time=21.480..24.952 rows=20106 loops=1)
        Group Key: s.worker_user_id
        Batches: 1  Memory Usage: 2065kB
        Buffers: shared hit=3900
        ->  Bitmap Heap Scan on worker_skills s  (cost=315.30..4522.73 rows=20962 width=16) (actual time=1.774..15.520 rows=21036 loops=1)
              Recheck Cond: (lower(skill) = ANY ('{"tig welding","pipe welding"}'::text[]))
              Heap Blocks: exact=3878
              Buffers: shared hit=3900
              ->  Bitmap Index Scan on worker_skills_lower_skill_idx  (cost=0.00..310.06 rows=20962 width=0) (actual time=1.280..1.280 rows=21036 loops=1)
                    Index Cond: (lower(skill) = ANY ('{"tig welding","pipe welding"}'::text[]))
                    Buffers: shared hit=22
```

```
duration: 154.308 ms  plan:
Sort  (cost=685742.81..685760.31 rows=7000 width=459) (actual time=154.275..154.286 rows=20 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 42kB
  Buffers: shared hit=7330 read=42
  CTE page
    ->  WindowAgg  (cost=13215.90..13216.35 rows=21 width=59) (actual time=139.195..139.313 rows=21 loops=1)
          Buffers: shared hit=6698
          ->  Subquery Scan on x  (cost=13215.88..13215.93 rows=21 width=51) (actual time=139.162..139.192 rows=21 loops=1)
                Buffers: shared hit=6698
                ->  Limit  (cost=13215.88..13215.93 rows=21 width=51) (actual time=139.160..139.179 rows=21 loops=1)
                      Buffers: shared hit=6698
                      ->  Sort  (cost=13215.88..13261.72 rows=18336 width=51) (actual time=139.159..139.171 rows=21 loops=1)
                            Sort Key: ((0 + COALESCE((('{20106 values}'::jsonb ->> (w_2.user_id)::text))::integer, 0))) DESC, w_2.updated_at DESC, w_2.card_id
                            Sort Method: top-N heapsort  Memory: 29kB
                            Buffers: shared hit=6698
                            ->  Hash Join  (cost=7867.58..12721.51 rows=18336 width=51) (actual time=68.970..135.581 rows=18259 loops=1)
                                  Hash Cond: (pr_1.id = w_2.user_id)
                                  Buffers: shared hit=6698
                                  ->  Seq Scan on profiles pr_1  (cost=0.00..3761.03 rows=108082 width=16) (actual time=3.601..20.848 rows=108002 loops=1)
                                        Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                        Rows Removed by Filter: 2000
                                        Buffers: shared hit=2386
                                  ->  Hash  (cost=7634.30..7634.30 rows=18662 width=56) (actual time=65.217..65.220 rows=18632 loops=1)
                                        Buckets: 32768  Batches: 1  Memory Usage: 1858kB
                                        Buffers: shared hit=4312
                                        ->  Hash Join  (cost=4089.54..7634.30 rows=18662 width=56) (actual time=29.400..59.980 rows=18632 loops=1)
                                              Hash Cond: (w_1.user_id = w_2.user_id)
                                              Buffers: shared hit=4312
                                              ->  Seq Scan on worker_profiles w_1  (cost=0.00..3256.00 rows=110000 width=16) (actual time=0.010..12.868 rows=110000 loops=1)
                                                    Buffers: shared hit=2156
                                              ->  Hash  (cost=3856.27..3856.27 rows=18662 width=40) (actual time=29.245..29.246 rows=18632 loops=1)
                                                    Buckets: 32768  Batches: 1  Memory Usage: 1567kB
                                                    Buffers: shared hit=2156
                                                    ->  Seq Scan on worker_profiles w_2  (cost=50.27..3856.27 rows=18662 width=40) (actual time=0.852..23.793 rows=18632 loops=1)
                                                          Filter: (searchable AND (user_id = ANY ('{20106 values}'::uuid[])))
                                                          Rows Removed by Filter: 91368
                                                          Buffers: shared hit=2156
  InitPlan 11
    ->  CTE Scan on page m  (cost=0.00..0.47 rows=7 width=0) (actual time=0.005..0.005 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  Nested Loop  (cost=1.08..672079.33 rows=7000 width=459) (actual time=140.626..154.217 rows=20 loops=1)
        Buffers: shared hit=7330 read=42
        ->  Nested Loop  (cost=0.83..63.40 rows=7 width=145) (actual time=139.271..140.093 rows=20 loops=1)
              Buffers: shared hit=6873 read=5
              ->  Nested Loop  (cost=0.42..59.52 rows=7 width=75) (actual time=139.241..139.673 rows=20 loops=1)
                    Buffers: shared hit=6798
                    ->  CTE Scan on page p  (cost=0.00..0.47 rows=7 width=59) (actual time=139.198..139.329 rows=20 loops=1)
                          Filter: (n <= 20)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=6698
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.016..0.016 rows=1 loops=20)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 40
                          Buffers: shared hit=100
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.019..0.019 rows=1 loops=20)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=75 read=5
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.533..0.534 rows=1 loops=20)
              Buffers: shared hit=124
        SubPlan 2
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.035..0.035 rows=1 loops=20)
                Buffers: shared hit=77 read=5
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.029..0.030 rows=5 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=77 read=5
        SubPlan 3
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.044..0.044 rows=1 loops=20)
                Buffers: shared hit=72 read=8
                ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.034..0.034 rows=1 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=72 read=8
        SubPlan 4
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.033..0.033 rows=1 loops=20)
                Buffers: shared hit=75 read=5
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.029..0.030 rows=3 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 52
                      Buffers: shared hit=75 read=5
        SubPlan 5
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.006..0.007 rows=1 loops=20)
                Buffers: shared hit=40
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.006..0.006 rows=0 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=40
        SubPlan 6
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 7
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 8
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.025..0.025 rows=1 loops=11)
                Buffers: shared hit=40 read=4
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.022..0.023 rows=1 loops=11)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 16
                      Buffers: shared hit=40 read=4
        SubPlan 9
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.046..0.046 rows=1 loops=11)
                Buffers: shared hit=29 read=15
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.042..0.043 rows=1 loops=11)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 16
                      Buffers: shared hit=29 read=15
        SubPlan 10
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                Join Filter: (l_1.language_code = f.code)
                ->  Function Scan on unnest f  (cost=0.00..0.01 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (never executed)
                      Index Cond: (worker_user_id = p.user_id)
```

#### advanced: language, destination

```
duration: 31.600 ms  plan:
Sort  (cost=674020.06..674037.56 rows=7000 width=459) (actual time=31.566..31.579 rows=20 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 43kB
  Buffers: shared hit=3121 read=14
  CTE page
    ->  WindowAgg  (cost=1493.14..1493.59 rows=21 width=59) (actual time=18.297..18.339 rows=21 loops=1)
          Buffers: shared hit=2363
          ->  Sort  (cost=1493.12..1493.17 rows=21 width=51) (actual time=18.292..18.304 rows=21 loops=1)
                Sort Key: x.score DESC, x.updated_at DESC, x.card_id
                Sort Method: quicksort  Memory: 26kB
                Buffers: shared hit=2363
                ->  Subquery Scan on x  (cost=1.25..1492.66 rows=21 width=51) (actual time=16.714..18.275 rows=21 loops=1)
                      Buffers: shared hit=2363
                      ->  Limit  (cost=1.25..1492.66 rows=21 width=51) (actual time=16.713..18.267 rows=21 loops=1)
                            Buffers: shared hit=2363
                            ->  Nested Loop  (cost=1.25..1781097.43 rows=25079 width=51) (actual time=16.711..18.261 rows=21 loops=1)
                                  Join Filter: (pr_1.id = w_2.user_id)
                                  Buffers: shared hit=2363
                                  ->  Nested Loop  (cost=0.83..1765669.20 rows=25525 width=56) (actual time=16.692..18.001 rows=21 loops=1)
                                        Buffers: shared hit=2258
                                        ->  Index Scan using worker_profiles_search_updated_idx on worker_profiles w_2  (cost=0.42..1741409.82 rows=25525 width=40) (actual time=16.678..17.798 rows=21 loops=1)
                                              Filter: ((ANY (user_id = (hashed SubPlan 2).col1)) AND (NOT EXISTS(SubPlan 3)))
                                              Rows Removed by Filter: 207
                                              Buffers: shared hit=2174
                                              SubPlan 2
                                                ->  Bitmap Heap Scan on worker_preferred_countries pc  (cost=462.80..2525.84 rows=32323 width=16) (actual time=1.149..9.030 rows=32060 loops=1)
                                                      Recheck Cond: (country_code = 'DE'::text)
                                                      Heap Blocks: exact=1659
                                                      Buffers: shared hit=1686
                                                      ->  Bitmap Index Scan on worker_preferred_countries_country_idx  (cost=0.00..454.72 rows=32323 width=0) (actual time=0.916..0.916 rows=32060 loops=1)
                                                            Index Cond: (country_code = 'DE'::text)
                                                            Buffers: shared hit=27
                                              SubPlan 3
                                                ->  Nested Loop Anti Join  (cost=0.42..8.47 rows=1 width=0) (actual time=0.010..0.010 rows=1 loops=77)
                                                      Buffers: shared hit=256
                                                      ->  Function Scan on f  (cost=0.01..0.01 rows=1 width=36) (actual time=0.000..0.000 rows=1 loops=77)
                                                      ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..8.44 rows=1 width=7) (actual time=0.009..0.009 rows=0 loops=77)
                                                            Index Cond: ((worker_user_id = w_2.user_id) AND (language_code = f.code))
                                                            Filter: (cefr_level >= f.level)
                                                            Rows Removed by Filter: 0
                                                            Buffers: shared hit=256
                                        ->  Index Only Scan using worker_profiles_pkey on worker_profiles w_1  (cost=0.42..0.95 rows=1 width=16) (actual time=0.008..0.008 rows=1 loops=21)
                                              Index Cond: (user_id = w_2.user_id)
                                              Heap Fetches: 21
                                              Buffers: shared hit=84
                                  ->  Index Scan using profiles_pkey on profiles pr_1  (cost=0.42..0.59 rows=1 width=16) (actual time=0.011..0.011 rows=1 loops=21)
                                        Index Cond: (id = w_1.user_id)
                                        Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                        Buffers: shared hit=105
  InitPlan 14
    ->  CTE Scan on page m  (cost=0.00..0.47 rows=7 width=0) (actual time=0.005..0.005 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  Nested Loop  (cost=1.08..672079.33 rows=7000 width=459) (actual time=19.159..31.508 rows=20 loops=1)
        Buffers: shared hit=3121 read=14
        ->  Nested Loop  (cost=0.83..63.40 rows=7 width=145) (actual time=18.311..18.660 rows=20 loops=1)
              Buffers: shared hit=2543
              ->  Nested Loop  (cost=0.42..59.52 rows=7 width=75) (actual time=18.306..18.530 rows=20 loops=1)
                    Buffers: shared hit=2463
                    ->  CTE Scan on page p  (cost=0.00..0.47 rows=7 width=59) (actual time=18.300..18.359 rows=20 loops=1)
                          Filter: (n <= 20)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=2363
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.007..0.007 rows=1 loops=20)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 40
                          Buffers: shared hit=100
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.005..0.005 rows=1 loops=20)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=80
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.511..0.511 rows=1 loops=20)
              Buffers: shared hit=124
        SubPlan 5
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.026..0.027 rows=1 loops=20)
                Buffers: shared hit=81
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.018..0.019 rows=4 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=81
        SubPlan 6
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.018..0.018 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (actual time=0.005..0.006 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=80
        SubPlan 7
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.015..0.015 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.012..0.012 rows=3 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 62
                      Buffers: shared hit=80
        SubPlan 8
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.010..0.010 rows=1 loops=20)
                Buffers: shared hit=43
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.009..0.009 rows=0 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=43
        SubPlan 9
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 10
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 11
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.020..0.020 rows=1 loops=13)
                Buffers: shared hit=50 read=2
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.018..0.018 rows=2 loops=13)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 23
                      Buffers: shared hit=50 read=2
        SubPlan 12
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.039..0.039 rows=1 loops=13)
                Buffers: shared hit=40 read=12
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.036..0.037 rows=2 loops=13)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 21
                      Buffers: shared hit=40 read=12
        SubPlan 13
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.006..0.006 rows=1 loops=20)
                Join Filter: (l_2.language_code = f_1.code)
                Rows Removed by Join Filter: 0
                Buffers: shared hit=80
                ->  Function Scan on unnest f_1  (cost=0.00..0.01 rows=1 width=40) (actual time=0.001..0.001 rows=1 loops=20)
                ->  Index Scan using worker_languages_pkey on worker_languages l_2  (cost=0.42..10.21 rows=2 width=7) (actual time=0.003..0.003 rows=1 loops=20)
                      Index Cond: (worker_user_id = p.user_id)
                      Buffers: shared hit=80
```

#### advanced: five filters, page of 50

```
duration: 127.049 ms  plan:
Sort  (cost=1798019.17..1798061.67 rows=17000 width=459) (actual time=126.983..127.002 rows=50 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 77kB
  Buffers: shared hit=11695 read=12
  CTE page
    ->  WindowAgg  (cost=161085.64..161086.77 rows=51 width=59) (actual time=87.641..87.735 rows=51 loops=1)
          Buffers: shared hit=9647
          ->  Sort  (cost=161085.62..161085.75 rows=51 width=51) (actual time=87.635..87.661 rows=51 loops=1)
                Sort Key: x.score DESC, x.updated_at DESC, x.card_id
                Sort Method: quicksort  Memory: 28kB
                Buffers: shared hit=9647
                ->  Subquery Scan on x  (cost=161084.05..161084.17 rows=51 width=51) (actual time=87.600..87.625 rows=51 loops=1)
                      Buffers: shared hit=9647
                      ->  Limit  (cost=161084.05..161084.17 rows=51 width=51) (actual time=87.598..87.614 rows=51 loops=1)
                            Buffers: shared hit=9647
                            ->  Sort  (cost=161084.05..161085.20 rows=463 width=51) (actual time=87.597..87.606 rows=51 loops=1)
                                  Sort Key: w_2.updated_at DESC, w_2.card_id
                                  Sort Method: top-N heapsort  Memory: 36kB
                                  Buffers: shared hit=9647
                                  ->  Nested Loop  (cost=4083.50..161068.60 rows=463 width=51) (actual time=61.775..87.477 rows=115 loops=1)
                                        Join Filter: (pr_1.id = w_2.user_id)
                                        Buffers: shared hit=9647
                                        ->  Hash Join  (cost=4083.08..160710.88 rows=471 width=56) (actual time=61.719..85.444 rows=118 loops=1)
                                              Hash Cond: (w_2.user_id = w_1.user_id)
                                              Buffers: shared hit=9057
                                              ->  Bitmap Heap Scan on worker_profiles w_2  (cost=140.96..156766.28 rows=943 width=40) (actual time=26.126..49.807 rows=237 loops=1)
                                                    Recheck Cond: ((occupation_id = '5322'::text) AND searchable)
                                                    Filter: ((years_experience >= 5) AND ((availability = 'now'::public.worker_availability) OR ((availability = 'from_date'::public.worker_availability) AND (available_from <= '2027-02-15'::date))) AND (ANY (user_id = (hashed SubPlan 3).col1)) AND (NOT EXISTS(SubPlan 1)))
                                                    Rows Removed by Filter: 8947
                                                    Heap Blocks: exact=1980
                                                    Buffers: shared hit=6901
                                                    ->  Bitmap Index Scan on worker_profiles_search_occupation_idx  (cost=0.00..140.72 rows=9124 width=0) (actual time=0.585..0.586 rows=9184 loops=1)
                                                          Index Cond: (occupation_id = '5322'::text)
                                                          Buffers: shared hit=9
                                                    SubPlan 3
                                                      ->  Bitmap Heap Scan on worker_preferred_industries i  (cost=399.91..1748.67 rows=27821 width=16) (actual time=1.093..16.545 rows=28173 loops=1)
                                                            Recheck Cond: (industry_code = 'Q'::text)
                                                            Heap Blocks: exact=1001
                                                            Buffers: shared hit=1025
                                                            ->  Bitmap Index Scan on worker_preferred_industries_industry_idx  (cost=0.00..392.95 rows=27821 width=0) (actual time=0.938..0.938 rows=28173 loops=1)
                                                                  Index Cond: (industry_code = 'Q'::text)
                                                                  Buffers: shared hit=24
                                                    SubPlan 1
                                                      ->  Nested Loop Anti Join  (cost=0.42..8.47 rows=1 width=0) (actual time=0.013..0.013 rows=1 loops=1134)
                                                            Buffers: shared hit=3887
                                                            ->  Function Scan on f  (cost=0.01..0.01 rows=1 width=36) (actual time=0.000..0.000 rows=1 loops=1134)
                                                            ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..8.44 rows=1 width=7) (actual time=0.012..0.012 rows=0 loops=1134)
                                                                  Index Cond: ((worker_user_id = w_2.user_id) AND (language_code = f.code))
                                                                  Filter: (cefr_level >= f.level)
                                                                  Rows Removed by Filter: 0
                                                                  Buffers: shared hit=3887
                                              ->  Hash  (cost=3256.00..3256.00 rows=54890 width=16) (actual time=35.308..35.309 rows=54959 loops=1)
                                                    Buckets: 65536  Batches: 1  Memory Usage: 3089kB
                                                    Buffers: shared hit=2156
                                                    ->  Seq Scan on worker_profiles w_1  (cost=0.00..3256.00 rows=54890 width=16) (actual time=0.018..21.901 rows=54959 loops=1)
                                                          Filter: card_show_industries
                                                          Rows Removed by Filter: 55041
                                                          Buffers: shared hit=2156
                                        ->  Index Scan using profiles_pkey on profiles pr_1  (cost=0.42..0.75 rows=1 width=16) (actual time=0.016..0.016 rows=1 loops=118)
                                              Index Cond: (id = w_1.user_id)
                                              Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                              Rows Removed by Filter: 0
                                              Buffers: shared hit=590
  InitPlan 14
    ->  CTE Scan on page m  (cost=0.00..1.15 rows=17 width=0) (actual time=0.009..0.010 rows=1 loops=1)
          Filter: (n > 50)
          Rows Removed by Filter: 50
  ->  Nested Loop  (cost=1.08..1632192.31 rows=17000 width=459) (actual time=89.093..126.888 rows=50 loops=1)
        Buffers: shared hit=11695 read=12
        ->  Nested Loop  (cost=0.83..153.97 rows=17 width=144) (actual time=87.725..90.321 rows=50 loops=1)
              Buffers: shared hit=10097
              ->  Nested Loop  (cost=0.42..144.54 rows=17 width=74) (actual time=87.682..88.350 rows=50 loops=1)
                    Buffers: shared hit=9897
                    ->  CTE Scan on page p  (cost=0.00..1.15 rows=17 width=58) (actual time=87.644..87.806 rows=50 loops=1)
                          Filter: (n <= 50)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=9647
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.010..0.010 rows=1 loops=50)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 100
                          Buffers: shared hit=250
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.038..0.038 rows=1 loops=50)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=200
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.569..0.569 rows=1 loops=50)
              Buffers: shared hit=303
        SubPlan 5
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.036..0.036 rows=1 loops=50)
                Buffers: shared hit=201
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.031..0.032 rows=4 loops=50)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=201
        SubPlan 6
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.016..0.016 rows=1 loops=50)
                Buffers: shared hit=201
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (actual time=0.007..0.007 rows=2 loops=50)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=201
        SubPlan 7
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.023..0.023 rows=1 loops=50)
                Buffers: shared hit=200
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.020..0.021 rows=2 loops=50)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 118
                      Buffers: shared hit=200
        SubPlan 8
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.012..0.013 rows=1 loops=50)
                Buffers: shared hit=105
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.012..0.012 rows=0 loops=50)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=105
        SubPlan 9
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 10
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 11
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.023..0.023 rows=1 loops=50)
                Buffers: shared hit=200
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i_1  (cost=0.42..10.21 rows=2 width=2) (actual time=0.021..0.021 rows=1 loops=50)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 74
                      Buffers: shared hit=200
        SubPlan 12
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.032..0.033 rows=1 loops=50)
                Buffers: shared hit=188 read=12
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.029..0.030 rows=1 loops=50)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 69
                      Buffers: shared hit=188 read=12
        SubPlan 13
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.006..0.006 rows=1 loops=50)
                Join Filter: (l_2.language_code = f_1.code)
                Rows Removed by Join Filter: 0
                Buffers: shared hit=200
                ->  Function Scan on unnest f_1  (cost=0.00..0.01 rows=1 width=40) (actual time=0.001..0.001 rows=1 loops=50)
                ->  Index Scan using worker_languages_pkey on worker_languages l_2  (cost=0.42..10.21 rows=2 width=7) (actual time=0.003..0.003 rows=1 loops=50)
                      Index Cond: (worker_user_id = p.user_id)
                      Buffers: shared hit=200
```

#### advanced: keyword, work authorisation

```
duration: 15.689 ms  plan:
Result  (cost=875.83..875.84 rows=1 width=32) (actual time=15.642..15.643 rows=1 loops=1)
  Buffers: shared hit=2117
  InitPlan 1
    ->  Bitmap Heap Scan on worker_profiles w  (cost=755.58..875.83 rows=33 width=16) (actual time=4.165..15.000 rows=6680 loops=1)
          Recheck Cond: ((lower(headline) ~~ '%driver%'::text) AND searchable)
          Heap Blocks: exact=1937
          Buffers: shared hit=2117
          ->  Bitmap Index Scan on worker_profiles_search_headline_trgm_idx  (cost=0.00..755.57 rows=33 width=0) (actual time=3.834..3.835 rows=6680 loops=1)
                Index Cond: (lower(headline) ~~ '%driver%'::text)
                Buffers: shared hit=180
```

```
duration: 1.443 ms  plan:
Result  (cost=537.85..537.86 rows=1 width=32) (actual time=1.440..1.441 rows=1 loops=1)
  Buffers: shared hit=112
  InitPlan 1
    ->  Unique  (cost=537.84..537.85 rows=1 width=16) (actual time=1.438..1.438 rows=0 loops=1)
          Buffers: shared hit=112
          ->  Sort  (cost=537.84..537.85 rows=1 width=16) (actual time=1.437..1.438 rows=0 loops=1)
                Sort Key: s.worker_user_id
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=112
                ->  Bitmap Heap Scan on worker_skills s  (cost=533.82..537.83 rows=1 width=16) (actual time=1.432..1.433 rows=0 loops=1)
                      Recheck Cond: (lower(skill) ~~ '%driver%'::text)
                      Buffers: shared hit=112
                      ->  Bitmap Index Scan on worker_skills_lower_skill_trgm_idx  (cost=0.00..533.81 rows=1 width=0) (actual time=1.427..1.427 rows=0 loops=1)
                            Index Cond: (lower(skill) ~~ '%driver%'::text)
                            Buffers: shared hit=112
```

```
duration: 86.590 ms  plan:
Sort  (cost=812798.82..812816.32 rows=7000 width=459) (actual time=86.557..86.570 rows=20 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 41kB
  Buffers: shared hit=8662
  CTE page
    ->  WindowAgg  (cost=140271.91..140272.36 rows=21 width=59) (actual time=73.145..73.207 rows=21 loops=1)
          Buffers: shared hit=7959
          ->  Subquery Scan on x  (cost=140271.89..140271.94 rows=21 width=51) (actual time=73.127..73.158 rows=21 loops=1)
                Buffers: shared hit=7959
                ->  Limit  (cost=140271.89..140271.94 rows=21 width=51) (actual time=73.125..73.145 rows=21 loops=1)
                      Buffers: shared hit=7959
                      ->  Sort  (cost=140271.89..140281.61 rows=3889 width=51) (actual time=73.123..73.136 rows=21 loops=1)
                            Sort Key: (((((COALESCE((w_2.occupation_id = ANY ('{3258,8311,8321,8322,8331,8332,8344,9331,9332}'::text[])), false))::integer + ((w_2.user_id = ANY ('{6680 values}'::uuid[])))::integer) + ((w_2.user_id = ANY ('{}'::uuid[])))::integer) + 0)) DESC, w_2.updated_at DESC, w_2.card_id
                            Sort Method: top-N heapsort  Memory: 30kB
                            Buffers: shared hit=7959
                            ->  Nested Loop  (cost=6277.65..140167.03 rows=3889 width=51) (actual time=60.931..72.922 rows=416 loops=1)
                                  Join Filter: (pr_1.id = w_2.user_id)
                                  Buffers: shared hit=7959
                                  ->  Hash Join  (cost=6243.79..137605.12 rows=3958 width=61) (actual time=60.212..68.899 rows=426 loops=1)
                                        Hash Cond: (w_2.user_id = w_1.user_id)
                                        Buffers: shared hit=5829
                                        ->  Bitmap Heap Scan on worker_profiles w_2  (cost=1612.79..132963.73 rows=3958 width=45) (actual time=10.723..18.977 rows=426 loops=1)
                                              Recheck Cond: (((occupation_id = ANY ('{3258,8311,8321,8322,8331,8332,8344,9331,9332}'::text[])) AND searchable) OR ((user_id = ANY ('{6680 values}'::uuid[])) AND searchable) OR (user_id = ANY ('{}'::uuid[])))
                                              Filter: ((COALESCE((occupation_id = ANY ('{3258,8311,8321,8322,8331,8332,8344,9331,9332}'::text[])), false) OR (user_id = ANY ('{6680 values}'::uuid[])) OR (user_id = ANY ('{}'::uuid[]))) AND (ANY (user_id = (hashed SubPlan 2).col1)))
                                              Rows Removed by Filter: 14879
                                              Heap Blocks: exact=2000
                                              Buffers: shared hit=3673
                                              ->  BitmapOr  (cost=1579.34..1579.34 rows=15491 width=0) (actual time=7.018..7.019 rows=0 loops=1)
                                                    Buffers: shared hit=1528
                                                    ->  Bitmap Index Scan on worker_profiles_search_occupation_idx  (cost=0.00..144.29 rows=9291 width=0) (actual time=0.744..0.744 rows=9213 loops=1)
                                                          Index Cond: (occupation_id = ANY ('{3258,8311,8321,8322,8331,8332,8344,9331,9332}'::text[]))
                                                          Buffers: shared hit=14
                                                    ->  Bitmap Index Scan on worker_profiles_searchable_idx  (cost=0.00..1427.65 rows=6200 width=0) (actual time=6.271..6.271 rows=6680 loops=1)
                                                          Index Cond: (user_id = ANY ('{6680 values}'::uuid[]))
                                                          Buffers: shared hit=1514
                                                    ->  Bitmap Index Scan on worker_profiles_searchable_idx  (cost=0.00..4.43 rows=1 width=0) (actual time=0.002..0.002 rows=0 loops=1)
                                                          Index Cond: (user_id = ANY ('{}'::uuid[]))
                                              SubPlan 2
                                                ->  Bitmap Heap Scan on worker_work_authorizations a  (cost=54.92..239.72 rows=2920 width=16) (actual time=0.164..2.095 rows=2920 loops=1)
                                                      Recheck Cond: (country_code = 'DE'::text)
                                                      Filter: ((expires_on IS NULL) OR (expires_on >= '2026-11-17'::date))
                                                      Heap Blocks: exact=141
                                                      Buffers: shared hit=145
                                                      ->  Bitmap Index Scan on worker_work_authorizations_country_idx  (cost=0.00..54.19 rows=2920 width=0) (actual time=0.120..0.120 rows=2920 loops=1)
                                                            Index Cond: (country_code = 'DE'::text)
                                                            Buffers: shared hit=4
                                        ->  Hash  (cost=3256.00..3256.00 rows=110000 width=16) (actual time=48.910..48.911 rows=110000 loops=1)
                                              Buckets: 131072  Batches: 1  Memory Usage: 6181kB
                                              Buffers: shared hit=2156
                                              ->  Seq Scan on worker_profiles w_1  (cost=0.00..3256.00 rows=110000 width=16) (actual time=0.015..17.072 rows=110000 loops=1)
                                                    Buffers: shared hit=2156
                                  ->  Index Scan using profiles_pkey on profiles pr_1  (cost=0.42..0.59 rows=1 width=16) (actual time=0.007..0.007 rows=1 loops=426)
                                        Index Cond: (id = w_1.user_id)
                                        Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                        Rows Removed by Filter: 0
                                        Buffers: shared hit=2130
  InitPlan 13
    ->  CTE Scan on page m  (cost=0.00..0.47 rows=7 width=0) (actual time=0.006..0.006 rows=1 loops=1)
          Filter: (n > 20)
          Rows Removed by Filter: 20
  ->  Nested Loop  (cost=1.08..672079.33 rows=7000 width=459) (actual time=74.250..86.520 rows=20 loops=1)
        Buffers: shared hit=8662
        ->  Nested Loop  (cost=0.83..63.40 rows=7 width=145) (actual time=73.194..73.719 rows=20 loops=1)
              Buffers: shared hit=8139
              ->  Nested Loop  (cost=0.42..59.52 rows=7 width=75) (actual time=73.170..73.408 rows=20 loops=1)
                    Buffers: shared hit=8059
                    ->  CTE Scan on page p  (cost=0.00..0.47 rows=7 width=59) (actual time=73.148..73.221 rows=20 loops=1)
                          Filter: (n <= 20)
                          Rows Removed by Filter: 1
                          Buffers: shared hit=7959
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.008..0.008 rows=1 loops=20)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 40
                          Buffers: shared hit=100
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.014..0.014 rows=1 loops=20)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=80
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.525..0.525 rows=1 loops=20)
              Buffers: shared hit=127
        SubPlan 4
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.023..0.023 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.019..0.019 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=80
        SubPlan 5
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.024..0.024 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.013..0.013 rows=2 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=80
        SubPlan 6
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.018..0.018 rows=1 loops=20)
                Buffers: shared hit=80
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.014..0.015 rows=3 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 54
                      Buffers: shared hit=80
        SubPlan 7
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.010..0.010 rows=1 loops=20)
                Buffers: shared hit=60
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a_1  (cost=0.29..8.31 rows=1 width=3) (actual time=0.009..0.009 rows=1 loops=20)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=60
        SubPlan 8
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 9
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 10
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.015..0.015 rows=1 loops=12)
                Buffers: shared hit=48
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.013..0.013 rows=2 loops=12)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 18
                      Buffers: shared hit=48
        SubPlan 11
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.022..0.022 rows=1 loops=12)
                Buffers: shared hit=48
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.018..0.019 rows=2 loops=12)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 18
                      Buffers: shared hit=48
        SubPlan 12
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.000..0.001 rows=0 loops=20)
                Join Filter: (l_1.language_code = f.code)
                ->  Function Scan on unnest f  (cost=0.00..0.01 rows=1 width=40) (actual time=0.000..0.000 rows=0 loops=20)
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (never executed)
                      Index Cond: (worker_user_id = p.user_id)
```

#### advanced: sparse

```
duration: 1.654 ms  plan:
Result  (cost=839.79..839.80 rows=1 width=32) (actual time=1.653..1.653 rows=1 loops=1)
  Buffers: shared hit=171
  InitPlan 1
    ->  Bitmap Heap Scan on worker_profiles w  (cost=801.68..839.79 rows=10 width=16) (actual time=1.652..1.652 rows=0 loops=1)
          Recheck Cond: ((lower(headline) ~~ '%dementia%'::text) AND searchable)
          Buffers: shared hit=171
          ->  Bitmap Index Scan on worker_profiles_search_headline_trgm_idx  (cost=0.00..801.68 rows=10 width=0) (actual time=1.649..1.649 rows=0 loops=1)
                Index Cond: (lower(headline) ~~ '%dementia%'::text)
                Buffers: shared hit=171
```

```
duration: 28.509 ms  plan:
Result  (cost=4831.48..4831.49 rows=1 width=32) (actual time=28.441..28.442 rows=1 loops=1)
  Buffers: shared hit=3828
  InitPlan 1
    ->  HashAggregate  (cost=4728.79..4831.48 rows=10269 width=16) (actual time=26.119..27.423 rows=10668 loops=1)
          Group Key: s.worker_user_id
          Batches: 1  Memory Usage: 913kB
          Buffers: shared hit=3828
          ->  Bitmap Heap Scan on worker_skills s  (cost=648.58..4702.05 rows=10698 width=16) (actual time=5.346..22.599 rows=10668 loops=1)
                Recheck Cond: (lower(skill) ~~ '%dementia%'::text)
                Heap Blocks: exact=3676
                Buffers: shared hit=3828
                ->  Bitmap Index Scan on worker_skills_lower_skill_trgm_idx  (cost=0.00..645.90 rows=10698 width=0) (actual time=4.768..4.769 rows=10668 loops=1)
                      Index Cond: (lower(skill) ~~ '%dementia%'::text)
                      Buffers: shared hit=152
```

```
duration: 6.496 ms  plan:
Sort  (cost=133588.72..133591.22 rows=1000 width=459) (actual time=6.484..6.491 rows=1 loops=1)
  Sort Key: p.n
  Sort Method: quicksort  Memory: 26kB
  Buffers: shared hit=1869
  CTE page
    ->  WindowAgg  (cost=37527.30..37527.32 rows=2 width=59) (actual time=5.396..5.400 rows=1 loops=1)
          Buffers: shared hit=1832
          ->  Subquery Scan on x  (cost=37527.28..37527.28 rows=2 width=51) (actual time=5.388..5.391 rows=1 loops=1)
                Buffers: shared hit=1832
                ->  Limit  (cost=37527.28..37527.28 rows=2 width=51) (actual time=5.387..5.389 rows=1 loops=1)
                      Buffers: shared hit=1832
                      ->  Sort  (cost=37527.28..37527.28 rows=2 width=51) (actual time=5.386..5.388 rows=1 loops=1)
                            Sort Key: (((((COALESCE((w_2.occupation_id = ANY ('{}'::text[])), false))::integer + ((w_2.user_id = ANY ('{}'::uuid[])))::integer) + ((w_2.user_id = ANY ('{10668 values}'::uuid[])))::integer) + 0)) DESC, w_2.updated_at DESC, w_2.card_id
                            Sort Method: quicksort  Memory: 25kB
                            Buffers: shared hit=1832
                            ->  Nested Loop  (cost=170.95..37527.27 rows=2 width=51) (actual time=4.857..5.381 rows=1 loops=1)
                                  Join Filter: (pr_1.id = w_2.user_id)
                                  Buffers: shared hit=1832
                                  ->  Nested Loop  (cost=117.19..37472.36 rows=2 width=61) (actual time=3.907..4.430 rows=1 loops=1)
                                        Buffers: shared hit=1827
                                        ->  Bitmap Heap Scan on worker_profiles w_2  (cost=116.77..37438.62 rows=4 width=45) (actual time=1.949..4.377 rows=4 loops=1)
                                              Recheck Cond: ((current_country = 'MX'::text) AND searchable)
                                              Filter: ((years_experience >= 25) AND ((occupation_id = ANY ('{}'::text[])) OR (user_id = ANY ('{}'::uuid[])) OR (user_id = ANY ('{10668 values}'::uuid[]))) AND (COALESCE((occupation_id = ANY ('{}'::text[])), false) OR (user_id = ANY ('{}'::uuid[])) OR (user_id = ANY ('{10668 values}'::uuid[]))) AND EXISTS(SubPlan 1))
                                              Rows Removed by Filter: 4061
                                              Heap Blocks: exact=1757
                                              Buffers: shared hit=1811
                                              ->  Bitmap Index Scan on worker_profiles_search_country_idx  (cost=0.00..63.43 rows=4152 width=0) (actual time=0.366..0.366 rows=4065 loops=1)
                                                    Index Cond: (current_country = 'MX'::text)
                                                    Buffers: shared hit=5
                                              SubPlan 1
                                                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types et  (cost=0.42..8.44 rows=1 width=0) (actual time=0.012..0.012 rows=0 loops=15)
                                                      Index Cond: ((worker_user_id = w_2.user_id) AND (employment_type = 'seasonal'::public.employment_type))
                                                      Heap Fetches: 4
                                                      Buffers: shared hit=49
                                        ->  Index Scan using worker_profiles_pkey on worker_profiles w_1  (cost=0.42..8.44 rows=1 width=16) (actual time=0.011..0.011 rows=0 loops=4)
                                              Index Cond: (user_id = w_2.user_id)
                                              Filter: card_show_industries
                                              Rows Removed by Filter: 1
                                              Buffers: shared hit=16
                                  ->  Index Scan using profiles_pkey on profiles pr_1  (cost=0.42..0.75 rows=1 width=16) (actual time=0.021..0.021 rows=1 loops=1)
                                        Index Cond: (id = w_1.user_id)
                                        Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                        Buffers: shared hit=5
  InitPlan 13
    ->  CTE Scan on page m  (cost=0.00..0.04 rows=1 width=0) (never executed)
          Filter: (n > 20)
  ->  Nested Loop  (cost=1.08..96011.53 rows=1000 width=459) (actual time=6.475..6.483 rows=1 loops=1)
        Buffers: shared hit=1869
        ->  Nested Loop  (cost=0.83..9.03 rows=1 width=145) (actual time=5.416..5.420 rows=1 loops=1)
              Buffers: shared hit=1841
              ->  Nested Loop  (cost=0.42..8.48 rows=1 width=75) (actual time=5.409..5.412 rows=1 loops=1)
                    Buffers: shared hit=1837
                    ->  CTE Scan on page p  (cost=0.00..0.04 rows=1 width=59) (actual time=5.398..5.401 rows=1 loops=1)
                          Filter: (n <= 20)
                          Buffers: shared hit=1832
                    ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.009..0.009 rows=1 loops=1)
                          Index Cond: (id = p.user_id)
                          Heap Fetches: 2
                          Buffers: shared hit=5
              ->  Index Scan using worker_profiles_pkey on worker_profiles w  (cost=0.42..0.55 rows=1 width=86) (actual time=0.005..0.005 rows=1 loops=1)
                    Index Cond: (user_id = pr.id)
                    Buffers: shared hit=4
        ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.933..0.933 rows=1 loops=1)
              Buffers: shared hit=6
        SubPlan 4
          ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.028..0.029 rows=1 loops=1)
                Buffers: shared hit=4
                ->  Index Scan using worker_skills_candidate_skill on worker_skills s  (cost=0.42..13.74 rows=4 width=11) (actual time=0.021..0.022 rows=5 loops=1)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=4
        SubPlan 5
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.019..0.019 rows=1 loops=1)
                Buffers: shared hit=4
                ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.008..0.008 rows=1 loops=1)
                      Index Cond: (worker_user_id = w.user_id)
                      Buffers: shared hit=4
        SubPlan 6
          ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.040..0.040 rows=1 loops=1)
                Buffers: shared hit=4
                ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.033..0.036 rows=4 loops=1)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 4
                      Buffers: shared hit=4
        SubPlan 7
          ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.007..0.007 rows=1 loops=1)
                Buffers: shared hit=2
                ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.006..0.006 rows=0 loops=1)
                      Index Cond: (worker_user_id = w.user_id)
                      Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                      Buffers: shared hit=2
        SubPlan 8
          ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                      Sort Key: t.year_completed DESC, t.course
                      ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 9
          ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                      Sort Key: h.from_month DESC, h.role
                      ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                            Recheck Cond: (worker_user_id = w.user_id)
                            ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                  Index Cond: (worker_user_id = w.user_id)
        SubPlan 10
          ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.009..0.009 rows=1 loops=1)
                Buffers: shared hit=4
                ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.007..0.008 rows=1 loops=1)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 1
                      Buffers: shared hit=4
        SubPlan 11
          ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.006..0.006 rows=1 loops=1)
                Buffers: shared hit=4
                ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.003..0.004 rows=2 loops=1)
                      Index Cond: (worker_user_id = w.user_id)
                      Heap Fetches: 2
                      Buffers: shared hit=4
        SubPlan 12
          ->  Nested Loop  (cost=0.42..10.25 rows=1 width=40) (actual time=0.001..0.001 rows=0 loops=1)
                Join Filter: (l_1.language_code = f.code)
                ->  Function Scan on unnest f  (cost=0.00..0.01 rows=1 width=40) (actual time=0.001..0.001 rows=0 loops=1)
                ->  Index Scan using worker_languages_pkey on worker_languages l_1  (cost=0.42..10.21 rows=2 width=7) (never executed)
                      Index Cond: (worker_user_id = p.user_id)
```

#### page: requests of 20 cards

```
duration: 6.381 ms  plan:
Nested Loop  (cost=44.94..254.81 rows=10 width=45) (actual time=1.350..6.363 rows=20 loops=1)
  Buffers: shared hit=327 read=11
  ->  Nested Loop  (cost=44.67..166.78 rows=10 width=32) (actual time=0.114..0.404 rows=20 loops=1)
        Buffers: shared hit=171
        ->  Bitmap Heap Scan on worker_profiles w  (cost=44.25..82.43 rows=10 width=32) (actual time=0.096..0.158 rows=20 loops=1)
              Recheck Cond: (card_id = ANY ($2))
              Heap Blocks: exact=20
              Buffers: shared hit=71
              ->  Bitmap Index Scan on worker_profiles_card_id_key  (cost=0.00..44.25 rows=10 width=0) (actual time=0.084..0.084 rows=20 loops=1)
                    Index Cond: (card_id = ANY ($2))
                    Buffers: shared hit=51
        ->  Index Only Scan using profiles_pkey on profiles pr  (cost=0.42..8.44 rows=1 width=16) (actual time=0.011..0.011 rows=1 loops=20)
              Index Cond: (id = w.user_id)
              Heap Fetches: 40
              Buffers: shared hit=100
  ->  Limit  (cost=0.27..8.29 rows=1 width=36) (actual time=0.019..0.019 rows=1 loops=20)
        Buffers: shared hit=50 read=10
        ->  Index Scan using contact_requests_worker_idx on contact_requests r  (cost=0.27..8.29 rows=1 width=36) (actual time=0.018..0.018 rows=1 loops=20)
              Index Cond: (worker_user_id = w.user_id)
              Filter: (organization_id = $11)
              Buffers: shared hit=50 read=10
```

#### page: saved workers

```
duration: 42.222 ms  plan:
Limit  (cost=156.70..156.95 rows=100 width=412) (actual time=42.151..42.177 rows=100 loops=1)
  Buffers: shared hit=3356
  ->  Sort  (cost=156.70..159.20 rows=1000 width=412) (actual time=42.150..42.164 rows=100 loops=1)
        Sort Key: s.created_at DESC, s.card_id
        Sort Method: quicksort  Memory: 129kB
        Buffers: shared hit=3356
        ->  Nested Loop Left Join  (cost=1.08..118.48 rows=1000 width=412) (actual time=0.633..41.996 rows=100 loops=1)
              Join Filter: (w.card_id IS NOT NULL)
              Buffers: shared hit=3356
              ->  Nested Loop Left Join  (cost=0.83..98.23 rows=1 width=363) (actual time=0.137..7.560 rows=100 loops=1)
                    Buffers: shared hit=2745
                    ->  Seq Scan on saved_worker_cards s  (cost=0.00..3.50 rows=1 width=40) (actual time=0.032..0.098 rows=100 loops=1)
                          Filter: ((NOT (requirement_id IS DISTINCT FROM $2)) AND (organization_id = $1))
                          Buffers: shared hit=2
                    ->  Nested Loop  (cost=0.83..94.72 rows=1 width=323) (actual time=0.073..0.074 rows=1 loops=100)
                          Buffers: shared hit=2743
                          ->  Index Scan using worker_profiles_card_id_key on worker_profiles w  (cost=0.42..94.12 rows=1 width=339) (actual time=0.062..0.063 rows=1 loops=100)
                                Index Cond: (card_id = s.card_id)
                                Filter: searchable
                                Buffers: shared hit=2243
                                SubPlan 1
                                  ->  Aggregate  (cost=13.77..13.78 rows=1 width=32) (actual time=0.010..0.011 rows=1 loops=100)
                                        Buffers: shared hit=407
                                        ->  Index Scan using worker_skills_candidate_skill on worker_skills s_1  (cost=0.42..13.74 rows=4 width=11) (actual time=0.007..0.008 rows=4 loops=100)
                                              Index Cond: (worker_user_id = w.user_id)
                                              Buffers: shared hit=407
                                SubPlan 2
                                  ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.014..0.015 rows=1 loops=100)
                                        Buffers: shared hit=400
                                        ->  Index Scan using worker_languages_pkey on worker_languages l  (cost=0.42..10.21 rows=2 width=7) (actual time=0.007..0.007 rows=2 loops=100)
                                              Index Cond: (worker_user_id = w.user_id)
                                              Buffers: shared hit=400
                                SubPlan 3
                                  ->  Aggregate  (cost=11.98..11.99 rows=1 width=32) (actual time=0.010..0.010 rows=1 loops=100)
                                        Buffers: shared hit=400
                                        ->  Index Only Scan using worker_preferred_countries_pkey on worker_preferred_countries c  (cost=0.42..11.97 rows=3 width=3) (actual time=0.008..0.008 rows=2 loops=100)
                                              Index Cond: (worker_user_id = w.user_id)
                                              Heap Fetches: 237
                                              Buffers: shared hit=400
                                SubPlan 4
                                  ->  Aggregate  (cost=8.32..8.33 rows=1 width=32) (actual time=0.005..0.005 rows=1 loops=100)
                                        Buffers: shared hit=220
                                        ->  Index Scan using worker_work_authorizations_pkey on worker_work_authorizations a  (cost=0.29..8.31 rows=1 width=3) (actual time=0.004..0.004 rows=0 loops=100)
                                              Index Cond: (worker_user_id = w.user_id)
                                              Filter: ((expires_on IS NULL) OR (expires_on >= ((now() AT TIME ZONE 'utc'::text))::date))
                                              Buffers: shared hit=220
                                SubPlan 5
                                  ->  Aggregate  (cost=11.33..11.34 rows=1 width=32) (never executed)
                                        ->  Sort  (cost=11.31..11.31 rows=3 width=66) (never executed)
                                              Sort Key: t.year_completed DESC, t.course
                                              ->  Bitmap Heap Scan on worker_training t  (cost=4.17..11.28 rows=3 width=66) (never executed)
                                                    Recheck Cond: (worker_user_id = w.user_id)
                                                    ->  Bitmap Index Scan on worker_training_worker_idx  (cost=0.00..4.17 rows=3 width=0) (never executed)
                                                          Index Cond: (worker_user_id = w.user_id)
                                SubPlan 6
                                  ->  Aggregate  (cost=9.55..9.56 rows=1 width=32) (never executed)
                                        ->  Sort  (cost=9.51..9.52 rows=2 width=72) (never executed)
                                              Sort Key: h.from_month DESC, h.role
                                              ->  Bitmap Heap Scan on worker_employment_history h  (cost=4.16..9.50 rows=2 width=72) (never executed)
                                                    Recheck Cond: (worker_user_id = w.user_id)
                                                    ->  Bitmap Index Scan on worker_employment_history_worker_idx  (cost=0.00..4.16 rows=2 width=0) (never executed)
                                                          Index Cond: (worker_user_id = w.user_id)
                                SubPlan 7
                                  ->  Aggregate  (cost=10.21..10.22 rows=1 width=32) (actual time=0.008..0.008 rows=1 loops=52)
                                        Buffers: shared hit=208
                                        ->  Index Only Scan using worker_preferred_industries_pkey on worker_preferred_industries i  (cost=0.42..10.21 rows=2 width=2) (actual time=0.007..0.007 rows=1 loops=52)
                                              Index Cond: (worker_user_id = w.user_id)
                                              Heap Fetches: 76
                                              Buffers: shared hit=208
                                SubPlan 8
                                  ->  Aggregate  (cost=10.22..10.23 rows=1 width=32) (actual time=0.011..0.011 rows=1 loops=52)
                                        Buffers: shared hit=208
                                        ->  Index Only Scan using worker_preferred_employment_types_pkey on worker_preferred_employment_types e  (cost=0.42..10.21 rows=2 width=4) (actual time=0.008..0.008 rows=1 loops=52)
                                              Index Cond: (worker_user_id = w.user_id)
                                              Heap Fetches: 73
                                              Buffers: shared hit=208
                          ->  Index Scan using profiles_pkey on profiles pr  (cost=0.42..0.60 rows=1 width=16) (actual time=0.009..0.009 rows=1 loops=100)
                                Index Cond: (id = w.user_id)
                                Filter: ((deleted_at IS NULL) AND (status = 'active'::public.profile_status))
                                Buffers: shared hit=500
              ->  Function Scan on worker_card_contact dc  (cost=0.25..10.25 rows=1000 width=64) (actual time=0.343..0.343 rows=1 loops=100)
                    Buffers: shared hit=611
```

### Conversations

#### inbox: first page

```
duration: 0.256 ms  plan:
Aggregate  (cost=12.29..12.30 rows=1 width=32) (actual time=0.252..0.254 rows=1 loops=1)
  Buffers: shared hit=83
  ->  Limit  (cost=0.57..12.24 rows=20 width=24) (actual time=0.028..0.241 rows=20 loops=1)
        Buffers: shared hit=83
        ->  Nested Loop  (cost=0.57..5833.98 rows=10000 width=24) (actual time=0.026..0.235 rows=20 loops=1)
              Buffers: shared hit=83
              ->  Index Only Scan using conversations_last_message_idx on conversations c  (cost=0.29..1455.43 rows=10081 width=24) (actual time=0.014..0.061 rows=20 loops=1)
                    Heap Fetches: 70
                    Buffers: shared hit=23
              ->  Index Only Scan using conversation_participants_organization_idx on conversation_participants p  (cost=0.29..0.43 rows=1 width=16) (actual time=0.008..0.008 rows=1 loops=20)
                    Index Cond: ((organization_id = '00000000-0000-0000-0000-0000000b8021'::uuid) AND (conversation_id = c.id))
                    Heap Fetches: 20
                    Buffers: shared hit=60
```

```
duration: 34.264 ms  plan:
Nested Loop  (cost=0.54..5283.38 rows=10000 width=216) (actual time=5.232..34.228 rows=20 loops=1)
  Buffers: shared hit=704
  ->  Nested Loop  (cost=0.29..83.13 rows=10 width=176) (actual time=0.054..0.340 rows=20 loops=1)
        Buffers: shared hit=62
        ->  Function Scan on unnest u  (cost=0.00..0.10 rows=10 width=24) (actual time=0.017..0.059 rows=20 loops=1)
        ->  Index Scan using conversations_pkey on conversations c  (cost=0.29..8.30 rows=1 width=168) (actual time=0.012..0.012 rows=1 loops=20)
              Index Cond: (id = u.conversation_id)
              Buffers: shared hit=62
  ->  Function Scan on conversation_labels l  (cost=0.25..10.25 rows=1000 width=96) (actual time=0.780..0.781 rows=1 loops=20)
        Buffers: shared hit=143
```

#### inbox: page of 50

```
duration: 0.393 ms  plan:
Aggregate  (cost=29.86..29.87 rows=1 width=32) (actual time=0.390..0.391 rows=1 loops=1)
  Buffers: shared hit=203
  ->  Limit  (cost=0.57..29.74 rows=50 width=24) (actual time=0.026..0.376 rows=50 loops=1)
        Buffers: shared hit=203
        ->  Nested Loop  (cost=0.57..5833.98 rows=10000 width=24) (actual time=0.025..0.370 rows=50 loops=1)
              Buffers: shared hit=203
              ->  Index Only Scan using conversations_last_message_idx on conversations c  (cost=0.29..1455.43 rows=10081 width=24) (actual time=0.013..0.095 rows=50 loops=1)
                    Heap Fetches: 100
                    Buffers: shared hit=53
              ->  Index Only Scan using conversation_participants_organization_idx on conversation_participants p  (cost=0.29..0.43 rows=1 width=16) (actual time=0.005..0.005 rows=1 loops=50)
                    Index Cond: ((organization_id = '00000000-0000-0000-0000-0000000b8021'::uuid) AND (conversation_id = c.id))
                    Heap Fetches: 50
                    Buffers: shared hit=150
```

```
duration: 83.760 ms  plan:
Nested Loop  (cost=0.54..5283.38 rows=10000 width=216) (actual time=3.436..83.566 rows=50 loops=1)
  Buffers: shared hit=1412
  ->  Nested Loop  (cost=0.29..83.13 rows=10 width=176) (actual time=0.032..0.813 rows=50 loops=1)
        Buffers: shared hit=152
        ->  Function Scan on unnest u  (cost=0.00..0.10 rows=10 width=24) (actual time=0.011..0.042 rows=50 loops=1)
        ->  Index Scan using conversations_pkey on conversations c  (cost=0.29..8.30 rows=1 width=168) (actual time=0.013..0.013 rows=1 loops=50)
              Index Cond: (id = u.conversation_id)
              Buffers: shared hit=152
  ->  Function Scan on conversation_labels l  (cost=0.25..10.25 rows=1000 width=96) (actual time=0.837..0.838 rows=1 loops=50)
        Buffers: shared hit=282
```

#### inbox: inquiries

```
duration: 0.328 ms  plan:
Aggregate  (cost=34.61..34.62 rows=1 width=32) (actual time=0.326..0.326 rows=1 loops=1)
  Buffers: shared hit=155
  ->  Limit  (cost=0.57..34.56 rows=20 width=24) (actual time=0.057..0.314 rows=20 loops=1)
        Buffers: shared hit=155
        ->  Nested Loop  (cost=0.57..3399.51 rows=2000 width=24) (actual time=0.056..0.310 rows=20 loops=1)
              Buffers: shared hit=155
              ->  Index Scan using conversations_last_message_idx on conversations c  (cost=0.29..1480.63 rows=2016 width=24) (actual time=0.031..0.162 rows=20 loops=1)
                    Filter: (context_type = 'inquiry'::public.conversation_context)
                    Rows Removed by Filter: 72
                    Buffers: shared hit=95
              ->  Index Only Scan using conversation_participants_organization_idx on conversation_participants p  (cost=0.29..0.95 rows=1 width=16) (actual time=0.007..0.007 rows=1 loops=20)
                    Index Cond: ((organization_id = '00000000-0000-0000-0000-0000000b8021'::uuid) AND (conversation_id = c.id))
                    Heap Fetches: 20
                    Buffers: shared hit=60
```

```
duration: 28.669 ms  plan:
Nested Loop  (cost=0.54..5283.38 rows=10000 width=216) (actual time=8.611..28.623 rows=20 loops=1)
  Buffers: shared hit=618
  ->  Nested Loop  (cost=0.29..83.13 rows=10 width=176) (actual time=0.022..0.399 rows=20 loops=1)
        Buffers: shared hit=60
        ->  Function Scan on unnest u  (cost=0.00..0.10 rows=10 width=24) (actual time=0.008..0.018 rows=20 loops=1)
        ->  Index Scan using conversations_pkey on conversations c  (cost=0.29..8.30 rows=1 width=168) (actual time=0.016..0.016 rows=1 loops=20)
              Index Cond: (id = u.conversation_id)
              Buffers: shared hit=60
  ->  Function Scan on conversation_labels l  (cost=0.25..10.25 rows=1000 width=96) (actual time=0.518..0.518 rows=1 loops=20)
        Buffers: shared hit=140
```

#### inbox: contact requests

```
duration: 0.363 ms  plan:
Aggregate  (cost=25.33..25.34 rows=1 width=32) (actual time=0.361..0.361 rows=1 loops=1)
  Buffers: shared hit=138
  ->  Limit  (cost=0.57..25.28 rows=20 width=24) (actual time=0.026..0.349 rows=20 loops=1)
        Buffers: shared hit=138
        ->  Nested Loop  (cost=0.57..3706.95 rows=3000 width=24) (actual time=0.025..0.345 rows=20 loops=1)
              Buffers: shared hit=138
              ->  Index Scan using conversations_last_message_idx on conversations c  (cost=0.29..1480.63 rows=3024 width=24) (actual time=0.012..0.136 rows=20 loops=1)
                    Filter: (context_type = 'contact_request'::public.conversation_context)
                    Rows Removed by Filter: 56
                    Buffers: shared hit=78
              ->  Index Only Scan using conversation_participants_organization_idx on conversation_participants p  (cost=0.29..0.74 rows=1 width=16) (actual time=0.010..0.010 rows=1 loops=20)
                    Index Cond: ((organization_id = '00000000-0000-0000-0000-0000000b8021'::uuid) AND (conversation_id = c.id))
                    Heap Fetches: 20
                    Buffers: shared hit=60
```

```
duration: 33.606 ms  plan:
Nested Loop  (cost=0.54..5283.38 rows=10000 width=216) (actual time=3.829..33.556 rows=20 loops=1)
  Buffers: shared hit=865
  ->  Nested Loop  (cost=0.29..83.13 rows=10 width=176) (actual time=0.493..0.823 rows=20 loops=1)
        Buffers: shared hit=62
        ->  Function Scan on unnest u  (cost=0.00..0.10 rows=10 width=24) (actual time=0.008..0.019 rows=20 loops=1)
        ->  Index Scan using conversations_pkey on conversations c  (cost=0.29..8.30 rows=1 width=168) (actual time=0.037..0.037 rows=1 loops=20)
              Index Cond: (id = u.conversation_id)
              Buffers: shared hit=62
  ->  Function Scan on conversation_labels l  (cost=0.25..10.25 rows=1000 width=96) (actual time=0.605..0.606 rows=1 loops=20)
        Buffers: shared hit=220
```

#### inbox: responses

```
duration: 0.453 ms  plan:
Aggregate  (cost=29.04..29.05 rows=1 width=32) (actual time=0.450..0.451 rows=1 loops=1)
  Buffers: shared hit=158
  ->  Limit  (cost=0.57..28.99 rows=20 width=24) (actual time=0.042..0.434 rows=20 loops=1)
        Buffers: shared hit=158
        ->  Nested Loop  (cost=0.57..3553.23 rows=2500 width=24) (actual time=0.041..0.428 rows=20 loops=1)
              Buffers: shared hit=158
              ->  Index Scan using conversations_last_message_idx on conversations c  (cost=0.29..1480.63 rows=2520 width=24) (actual time=0.027..0.174 rows=20 loops=1)
                    Filter: (context_type = 'partner_response'::public.conversation_context)
                    Rows Removed by Filter: 75
                    Buffers: shared hit=98
              ->  Index Only Scan using conversation_participants_organization_idx on conversation_participants p  (cost=0.29..0.82 rows=1 width=16) (actual time=0.011..0.011 rows=1 loops=20)
                    Index Cond: ((organization_id = '00000000-0000-0000-0000-0000000b8021'::uuid) AND (conversation_id = c.id))
                    Heap Fetches: 20
                    Buffers: shared hit=60
```

```
duration: 51.139 ms  plan:
Nested Loop  (cost=0.54..5283.38 rows=10000 width=216) (actual time=2.703..51.077 rows=20 loops=1)
  Buffers: shared hit=460
  ->  Nested Loop  (cost=0.29..83.13 rows=10 width=176) (actual time=0.023..0.699 rows=20 loops=1)
        Buffers: shared hit=60
        ->  Function Scan on unnest u  (cost=0.00..0.10 rows=10 width=24) (actual time=0.006..0.017 rows=20 loops=1)
        ->  Index Scan using conversations_pkey on conversations c  (cost=0.29..8.30 rows=1 width=168) (actual time=0.032..0.032 rows=1 loops=20)
              Index Cond: (id = u.conversation_id)
              Buffers: shared hit=60
  ->  Function Scan on conversation_labels l  (cost=0.25..10.25 rows=1000 width=96) (actual time=1.393..1.393 rows=1 loops=20)
        Buffers: shared hit=60
```

#### inbox: deep page (cursor at 9,000)

```
duration: 0.267 ms  plan:
Aggregate  (cost=44.84..44.85 rows=1 width=32) (actual time=0.264..0.265 rows=1 loops=1)
  Buffers: shared hit=82
  ->  Limit  (cost=0.57..44.79 rows=20 width=24) (actual time=0.039..0.250 rows=20 loops=1)
        Buffers: shared hit=82
        ->  Nested Loop  (cost=0.57..2213.59 rows=1001 width=24) (actual time=0.038..0.244 rows=20 loops=1)
              Buffers: shared hit=82
              ->  Index Only Scan using conversations_last_message_idx on conversations c  (cost=0.29..601.85 rows=1009 width=24) (actual time=0.014..0.062 rows=20 loops=1)
                    Index Cond: (ROW(last_message_at, id) < ROW('2026-08-29 00:05:46.632204+00'::timestamp with time zone, 'f81f93a7-2e92-403f-a275-b03356ab024b'::uuid))
                    Heap Fetches: 20
                    Buffers: shared hit=22
              ->  Index Only Scan using conversation_participants_organization_idx on conversation_participants p  (cost=0.29..1.60 rows=1 width=16) (actual time=0.008..0.008 rows=1 loops=20)
                    Index Cond: ((organization_id = '00000000-0000-0000-0000-0000000b8021'::uuid) AND (conversation_id = c.id))
                    Heap Fetches: 20
                    Buffers: shared hit=60
```

```
duration: 29.168 ms  plan:
Nested Loop  (cost=0.54..5283.38 rows=10000 width=216) (actual time=3.076..29.127 rows=20 loops=1)
  Buffers: shared hit=576
  ->  Nested Loop  (cost=0.29..83.13 rows=10 width=176) (actual time=0.027..0.318 rows=20 loops=1)
        Buffers: shared hit=60
        ->  Function Scan on unnest u  (cost=0.00..0.10 rows=10 width=24) (actual time=0.009..0.018 rows=20 loops=1)
        ->  Index Scan using conversations_pkey on conversations c  (cost=0.29..8.30 rows=1 width=168) (actual time=0.013..0.013 rows=1 loops=20)
              Index Cond: (id = u.conversation_id)
              Buffers: shared hit=60
  ->  Function Scan on conversation_labels l  (cost=0.25..10.25 rows=1000 width=96) (actual time=0.651..0.652 rows=1 loops=20)
        Buffers: shared hit=116
```

#### member: first page

```
duration: 0.467 ms  plan:
Aggregate  (cost=12.29..12.30 rows=1 width=32) (actual time=0.460..0.462 rows=1 loops=1)
  Buffers: shared hit=83
  ->  Limit  (cost=0.57..12.24 rows=20 width=24) (actual time=0.061..0.425 rows=20 loops=1)
        Buffers: shared hit=83
        ->  Nested Loop  (cost=0.57..5833.98 rows=10000 width=24) (actual time=0.059..0.416 rows=20 loops=1)
              Buffers: shared hit=83
              ->  Index Only Scan using conversations_last_message_idx on conversations c  (cost=0.29..1455.43 rows=10081 width=24) (actual time=0.034..0.129 rows=20 loops=1)
                    Heap Fetches: 70
                    Buffers: shared hit=23
              ->  Index Only Scan using conversation_participants_organization_idx on conversation_participants p  (cost=0.29..0.43 rows=1 width=16) (actual time=0.011..0.011 rows=1 loops=20)
                    Index Cond: ((organization_id = '00000000-0000-0000-0000-0000000b8021'::uuid) AND (conversation_id = c.id))
                    Heap Fetches: 20
                    Buffers: shared hit=60
```

```
duration: 38.073 ms  plan:
Nested Loop  (cost=0.54..5283.38 rows=10000 width=216) (actual time=9.779..38.030 rows=20 loops=1)
  Buffers: shared hit=640
  ->  Nested Loop  (cost=0.29..83.13 rows=10 width=176) (actual time=0.051..0.303 rows=20 loops=1)
        Buffers: shared hit=62
        ->  Function Scan on unnest u  (cost=0.00..0.10 rows=10 width=24) (actual time=0.008..0.018 rows=20 loops=1)
        ->  Index Scan using conversations_pkey on conversations c  (cost=0.29..8.30 rows=1 width=168) (actual time=0.012..0.012 rows=1 loops=20)
              Index Cond: (id = u.conversation_id)
              Buffers: shared hit=62
  ->  Function Scan on conversation_labels l  (cost=0.25..10.25 rows=1000 width=96) (actual time=0.620..0.621 rows=1 loops=20)
        Buffers: shared hit=120
```

#### unread counts

```
duration: 131.501 ms  plan:
GroupAggregate  (cost=4623.87..4764.34 rows=6243 width=36) (actual time=126.925..130.691 rows=2709 loops=1)
  Group Key: p.conversation_id, p.organization_id
  Buffers: shared hit=2274
  InitPlan 1
    ->  Result  (cost=0.00..0.03 rows=1 width=16) (actual time=0.018..0.019 rows=1 loops=1)
  InitPlan 2
    ->  Result  (cost=0.00..0.03 rows=1 width=16) (actual time=0.013..0.013 rows=1 loops=1)
  ->  Sort  (cost=4623.81..4639.41 rows=6243 width=32) (actual time=126.915..127.384 rows=2709 loops=1)
        Sort Key: p.conversation_id, p.organization_id
        Sort Method: quicksort  Memory: 223kB
        Buffers: shared hit=2274
        ->  Hash Left Join  (cost=794.05..4230.25 rows=6243 width=32) (actual time=32.225..124.020 rows=2709 loops=1)
              Hash Cond: (p.conversation_id = r.conversation_id)
              Filter: (m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamp with time zone))
              Rows Removed by Filter: 19479
              Buffers: shared hit=2274
              ->  Hash Join  (cost=460.05..3847.06 rows=18728 width=40) (actual time=9.239..89.167 rows=22188 loops=1)
                    Hash Cond: (m.conversation_id = p.conversation_id)
                    Join Filter: CASE WHEN (p.organization_id IS NULL) THEN (m.sender_organization_id IS NOT NULL) ELSE (m.sender_organization_id IS DISTINCT FROM p.organization_id) END
                    Rows Removed by Join Filter: 27794
                    Buffers: shared hit=2190
                    ->  Seq Scan on messages m  (cost=0.00..2669.14 rows=49931 width=40) (actual time=0.020..55.037 rows=49982 loops=1)
                          Filter: (moderation_state = 'visible'::public.job_moderation_state)
                          Buffers: shared hit=2045
                    ->  Hash  (cost=366.30..366.30 rows=7500 width=32) (actual time=9.197..9.199 rows=10000 loops=1)
                          Buckets: 16384 (originally 8192)  Batches: 1 (originally 1)  Memory Usage: 753kB
                          Buffers: shared hit=145
                          ->  Seq Scan on conversation_participants p  (cost=0.30..366.30 rows=7500 width=32) (actual time=0.819..5.578 rows=10000 loops=1)
                                Filter: ((user_id = (InitPlan 2).col1) OR (ANY (organization_id = (hashed SubPlan 3).col1)))
                                Rows Removed by Filter: 5000
                                Buffers: shared hit=145
                                SubPlan 3
                                  ->  ProjectSet  (cost=0.00..0.29 rows=5 width=16) (actual time=0.577..0.777 rows=1 loops=1)
                                        Buffers: shared hit=4
                                        ->  Result  (cost=0.00..0.01 rows=1 width=0) (actual time=0.000..0.001 rows=1 loops=1)
              ->  Hash  (cost=209.00..209.00 rows=10000 width=24) (actual time=22.926..22.926 rows=10000 loops=1)
                    Buckets: 16384  Batches: 1  Memory Usage: 675kB
                    Buffers: shared hit=84
                    ->  Seq Scan on conversation_reads r  (cost=0.00..209.00 rows=10000 width=24) (actual time=0.047..7.634 rows=10000 loops=1)
                          Filter: (user_id = (InitPlan 1).col1)
                          Buffers: shared hit=84
```

#### conversation: header

```
duration: 4.074 ms  plan:
Function Scan on conversation_labels l  (cost=8.42..518.42 rows=1000 width=209) (actual time=4.066..4.068 rows=1 loops=1)
  Buffers: shared hit=77
  InitPlan 1
    ->  Index Scan using conversation_blocks_pkey on conversation_blocks b  (cost=0.15..8.17 rows=1 width=0) (actual time=0.019..0.019 rows=0 loops=1)
          Index Cond: (conversation_id = $19)
          Filter: (blocked_by_user_id = $16)
          Buffers: shared hit=2
```

#### conversation: latest messages

```
duration: 0.133 ms  plan:
Limit  (cost=0.41..37.38 rows=1 width=351) (actual time=0.060..0.124 rows=9 loops=1)
  Buffers: shared hit=67
  ->  Index Scan using messages_conversation_idx on messages m  (cost=0.41..74.35 rows=2 width=351) (actual time=0.059..0.121 rows=9 loops=1)
        Index Cond: (conversation_id = $24)
        Filter: (((moderation_state = 'visible'::public.job_moderation_state) OR (NOT (sender_organization_id IS DISTINCT FROM $20))) AND (($2 IS NULL) OR (ROW(created_at, id) < ROW($2, COALESCE($3, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))))
        Buffers: shared hit=67
        SubPlan 1
          ->  Index Scan using profiles_pkey on profiles u  (cost=0.41..8.42 rows=1 width=32) (actual time=0.005..0.005 rows=1 loops=9)
                Index Cond: (id = m.sender_user_id)
                Buffers: shared hit=36
        SubPlan 2
          ->  Index Scan using organizations_pkey on organizations o  (cost=0.28..8.29 rows=1 width=19) (actual time=0.003..0.003 rows=1 loops=9)
                Index Cond: (id = m.sender_organization_id)
                Buffers: shared hit=27
        SubPlan 3
          ->  Limit  (cost=0.15..8.17 rows=1 width=8) (never executed)
                ->  Index Scan using moderation_actions_target_idx on moderation_actions a  (cost=0.15..8.17 rows=1 width=8) (never executed)
                      Index Cond: ((target_type = 'message'::text) AND (target_id = m.id))
                      Filter: (action = 'content_hidden'::text)
```

#### send a message

```
duration: 6.010 ms  plan:
Insert on messages  (cost=0.00..0.01 rows=1 width=128) (actual time=0.257..0.258 rows=1 loops=1)
  Buffers: shared hit=14
  ->  Result  (cost=0.00..0.01 rows=1 width=128) (actual time=0.043..0.043 rows=1 loops=1)
```
