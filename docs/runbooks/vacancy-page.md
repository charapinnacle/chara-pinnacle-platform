# Runbook: vacancy page

FR-C4, design point D50 (OPEN_QUESTIONS.md). The SOP (Vacancy Page Presentation, semi-annual review) names one KPI, the Apply click-through rate, one risk (outdated content, broken actions) and two controls (server rendering from live data, tests). The page stores nothing. The only record is one line per page view and per press of Apply or Save in the log of the web server.

## 1. The log lines

```json
{"event":"vacancy_view","outcome":"ok","jobId":"6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11","viewer":"visitor"}
{"event":"vacancy_view","outcome":"unavailable","viewer":"candidate"}
{"event":"vacancy_action","action":"apply","jobId":"6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11","viewer":"visitor"}
```

`viewer` is `visitor` (no session, or an account that has not chosen its kind), `candidate` or `company`. `outcome` is `unavailable` for a draft, paused, closed, filled, hidden, suspended or deleted vacancy, an unknown id and an id that is not a uuid; that line has no `jobId`, because the id is text from the address. A failed read of the vacancy is not a view: it is an error of the page and shows in the error log. Nobody who looked is named and no address is written. The log platform stamps every line with its own time.

## 2. KPI: Apply click-through rate

The share of views of an open vacancy that end in a press of Apply, for the viewers who can apply (a company user cannot, so it is left out). Export the lines of the period from the log platform to a file with one line per event, then:

```sh
# Apply click-through rate
jq -s '([.[] | select(.event == "vacancy_action" and .action == "apply" and .viewer != "company")] | length)
       / ([.[] | select(.event == "vacancy_view" and .outcome == "ok" and .viewer != "company")] | length)' pages.jsonl

# Per vacancy: views, presses of Apply, presses of Save
jq -s '[.[] | select(.jobId)] | group_by(.jobId) | map({job: .[0].jobId,
       views: map(select(.event == "vacancy_view")) | length,
       apply: map(select(.action == "apply")) | length,
       save: map(select(.action == "save")) | length}) | sort_by(-.views)' pages.jsonl

# Share of page views that met a vacancy that is no longer available (links that outlive a vacancy)
jq -s '([.[] | select(.event == "vacancy_view" and .outcome == "unavailable")] | length)
       / ([.[] | select(.event == "vacancy_view")] | length)' pages.jsonl
```

Until the application step of FR-D1 exists (U27) a candidate's buttons are switched off, so the rate counts visitors who are sent to log in; from U27 the same event is written when a candidate presses Apply (the action that handles the press logs it before it redirects). Applications that were actually submitted are read from `job_applications` (FR-D1), not from this log.

## 3. Control: server rendering from live data

Every route renders per request (ADR-0004) and the page reads the vacancy through `get_public_job` on each request, so an edit, a pause or a moderation decision is on the page at once and no cache can show an outdated vacancy. The browser test `vacancy-page.spec.ts` (AC11) fetches the page before and after an edit, with JavaScript off. The function reads one vacancy by its primary key (0.1 ms at 50,000 vacancies), so the cost of the page does not grow with the number of vacancies.

## 4. Semi-annual review

1. Run `npm run e2e -w @chara-pinnacle/web -- vacancy-page` (and the project `vacancy-page-failure`, which runs last in a full `npm run e2e`) and read the result: the details, the employer card, Apply and Save, the neutral page, the JobPosting markup and the accessibility checks.
2. Read the KPI of section 2 for the half year. A click-through rate that falls for all vacancies points at the page; one that falls for a few points at those vacancies.
3. Read the share of unavailable views. A high share means search engines or users hold links to vacancies that are closed; the neutral page is correct, and the sitemap of FR-H5 must drop them.
4. Validate the markup of one live vacancy with the structured data test of the search engine (an external tool: manual, not part of the build) and check that title, date, employer, place, employment type and salary match the page.
5. The criteria assume that a hidden or closed vacancy answers with the neutral 404 page and no reason. If CHARA wants a closed vacancy to say that it is closed, `not-found.tsx` and `get_public_job` change together, and the moderation reason must still never be shown.
