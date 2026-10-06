# Runbook: public vacancy search

FR-C3, design point D49 (OPEN_QUESTIONS.md). The SOP (Public Vacancy Search, quarterly review) names two KPIs, the 95th percentile of the search time and the zero-result rate, one target (500 ms, NFR-P1) and one upkeep step (an index for every filter). Nothing is stored about a search: no keyword, no filter value and no visitor. The only record is one line per search in the log of the web server.

## 1. The log line

Every search writes one JSON line to the standard output of the web server (the log of the hosting platform):

```json
{"event":"job_search","durationMs":6,"filters":["q","country","accommodation"],"resultCount":20}
```

`durationMs` is the time of the call to `search_jobs` (the database part of the page, which dominates it), `filters` the names of the filters that were set (the page cursor and page size are not filters), `resultCount` the number of vacancies on the page. A keyword, a city or a salary never appears in it.

## 2. KPIs

Export the lines of the quarter from the log platform to a file with one line per search, then:

```sh
# 95th percentile of the search time, in ms
jq -s '[.[] | select(.event == "job_search") | .durationMs] | sort | .[(length * 0.95 | floor)]' searches.jsonl

# Zero-result rate: the share of searches that found nothing
jq -s '[.[] | select(.event == "job_search")] | (map(select(.resultCount == 0)) | length) / length' searches.jsonl

# Which filters are in the searches that found nothing
jq -s '[.[] | select(.event == "job_search" and .resultCount == 0) | .filters[]] | group_by(.) | map({filter: .[0], searches: length}) | sort_by(-.searches)' searches.jsonl
```

A zero-result rate that rises is read together with the third query: a filter that often appears alone in a search without results is a filter whose list or whose wording needs a look (the lists are reference data, NFR-M1).

## 3. The 500 ms target

Monitoring: alert on the 95th percentile of `durationMs` above 400 ms over an hour in the log platform (the alert rule is configured there, outside the repository). The database side is reviewed with `pg_stat_statements` for the statements of `search_jobs`, as ARCHITECTURE section 13 sets for all search functions.

Before launch (FR-C3 AC11, NFR-P1), with the production build running against a database of 10,000 Open vacancies:

1. Fill a scratch database with 50,000 vacancies, a fifth of them Open, in 500 organisations of different countries, cities, occupations and industries, with a salary on a third of them, and run `analyze public.jobs`.
2. Request the search page for the twelve most common combinations of filters (none, a keyword, each of country, industry, employment type and the salary filter alone, accommodation, visa support with recruitment, a city, a keyword with country, an occupation, country with accommodation and a keyword), 30 times each in sequence, and take the 95th percentile of the response time.
3. The result is reviewed before launch. On 2026-10-07 on a development machine the whole page render had a median of 23 ms and a 95th percentile of 48 ms (the worst combination 157 ms), the function itself 0.6 to 8 ms.

## 4. Index upkeep (quarterly)

Every filter of `search_jobs` has an index (the list is in D49). Adding a filter means adding its index and a row in the pgTAP test `043_public_search_access.test.sql`. At the quarterly review read how often each index is used:

```sql
select indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) as size
from pg_stat_user_indexes
where relname = 'jobs'
order by idx_scan;
```

`jobs_title_trgm_idx` and `jobs_organization_status_idx` are built because the architecture and the acceptance criteria name them; no filter of the search reads them, so they show no scans until a later unit does. If they still show none when the vacancy moderation and the applicant list (FR-C7, FR-E1) are built, drop them in a migration.

## 5. Public-only rule

The function applies the public predicate itself and the pgTAP test `043_public_search_access.test.sql` proves it for an anonymous caller, a candidate, an owner, an admin and a member of the organisation, and for a vacancy that changes state. Any change of the predicate of `jobs_select_public` (for example a new status) must change `search_jobs` and that test in the same migration.
