# Runbook: public vacancy search

FR-C3, design point D49 (OPEN_QUESTIONS.md). The SOP (Public Vacancy Search, quarterly review) names two KPIs, the 95th percentile of the search time and the zero-result rate, one target (500 ms, NFR-P1) and one upkeep step (an index for every filter). Nothing is stored about a search: no keyword, no filter value and no visitor. The only record is one line per search in the log of the web server.

## 1. The log line

Every search writes one JSON line to the standard output of the web server (the log of the hosting platform):

```json
{"event":"job_search","durationMs":6,"filters":["q","country","accommodation"],"resultCount":20,"outcome":"ok"}
```

`durationMs` is the time of the call to `search_jobs` (the database part of the page, which dominates it), `filters` the names of the filters that were set (the page cursor and page size are not filters), `resultCount` the number of vacancies on the page, `outcome` `ok` or `error`. A search that failed (a timeout, a revoked grant) is logged too, with `resultCount` 0 and `outcome` `error`, and never with the text of the error. A keyword, a city or a salary never appears in it. The line has no request identifier or timestamp field of its own: the project has no request-id convention yet, and the log platform stamps every line of the standard output with its own time and request metadata (D49, departure 9).

## 2. KPIs

Export the lines of the quarter from the log platform to a file with one line per search, then:

```sh
# 95th percentile of the search time, in ms, failed searches included
jq -s '[.[] | select(.event == "job_search") | .durationMs] | sort | .[(length * 0.95 | floor)]' searches.jsonl

# Error rate: the share of searches that failed
jq -s '[.[] | select(.event == "job_search")] | (map(select(.outcome == "error")) | length) / length' searches.jsonl

# Zero-result rate: the share of searches that ran and found nothing
jq -s '[.[] | select(.event == "job_search" and .outcome == "ok")] | (map(select(.resultCount == 0)) | length) / length' searches.jsonl

# Which filters are in the searches that found nothing
jq -s '[.[] | select(.event == "job_search" and .outcome == "ok" and .resultCount == 0) | .filters[]] | group_by(.) | map({filter: .[0], searches: length}) | sort_by(-.searches)' searches.jsonl
```

A zero-result rate that rises is read together with the third query: a filter that often appears alone in a search without results is a filter whose list or whose wording needs a look (the lists are reference data, NFR-M1).

## 3. The 500 ms target

Monitoring: alert on the 95th percentile of `durationMs` above 400 ms over an hour in the log platform (the alert rule is configured there, outside the repository). The database side is reviewed with `pg_stat_statements` for the statements of `search_jobs`, as ARCHITECTURE section 13 sets for all search functions.

Before launch (FR-C3 AC11, NFR-P1), with the production build running against a database of 10,000 Open vacancies:

1. Fill a scratch database with 50,000 vacancies, a fifth of them Open, in 500 organisations of different countries, cities, occupations and industries, with a salary on a third of them, and run `analyze public.jobs`.
2. Request the search page for the twelve most common combinations of filters (none, a keyword, each of country, industry, employment type and the salary filter alone, accommodation, visa support with recruitment, a city, a keyword with country, an occupation, country with accommodation and a keyword), 30 times each in sequence, and take the 95th percentile of the response time.
3. The result is reviewed before launch. On 2026-10-07 on a development machine the whole page render had a median of 23 ms and a 95th percentile of 48 ms (the worst combination 157 ms), the function itself 0.6 to 8 ms.
4. Repeat steps 1 and 2 at 250,000 Open vacancies (about 500,000 rows) before AC11 is signed off.

The ceiling (D49): the cost of a search is proportional to the vacancies a filter matches, because a keyword is ranked on every match and a filter without an index of its own is applied to the newest-first scan. At 250,000 Open vacancies the 95th percentile of 400 random combinations was 135 ms and the worst 358 ms; a million would be over 500 ms. Revisit when the 95th percentile of `durationMs` exceeds 300 ms over an hour, or at 250,000 Open vacancies: rank only the newest 2,000 matches of a keyword, and index what the slowest combination reads.

The reference lists of the form (countries, currencies, industries, occupations) are cached for six hours across requests, so a page view makes one call to the database (the search). Measure the first byte of the page with the production build running: `curl -s -o /dev/null -w '%{time_starttransfer}\n' http://localhost:3100/en/jobs`. On 2026-10-07 on a development machine the first request after the start took 170 ms (it fills the cache) and the next ones 12 to 20 ms to the first byte and 13 to 20 ms in all, for a page of 238 KB uncompressed (the combobox lists dominate).

## 4. Index upkeep (quarterly)

Every filter of `search_jobs` is served by an index or, for the salary, the booleans and the recruitment preference, by the newest-first scan with the filter (the list is in D49). Adding a filter means adding its index and a row in the pgTAP test `043_public_search_access.test.sql`. At the quarterly review read how often each index is used:

```sql
select indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) as size
from pg_stat_user_indexes
where relname = 'jobs'
order by idx_scan;
```

`jobs_title_trgm_idx` and `jobs_organization_status_idx` are built because the architecture and the acceptance criteria name them (AC10, ARCHITECTURE 9.1; D49, departure 4); no filter of the search reads them, so they show no scans until a later unit does. If they still show none when the vacancy moderation and the applicant list (FR-C7, FR-E1) are built, drop them in a migration. There is no index for the minimum salary (D49, departure 8).

## 5. Public-only rule

The function applies the public predicate itself and the pgTAP test `043_public_search_access.test.sql` proves it for an anonymous caller, a candidate, an owner, an admin and a member of the organisation, and for a vacancy that changes state. Any change of the predicate of `jobs_select_public` (for example a new status) must change `search_jobs` and that test in the same migration.
