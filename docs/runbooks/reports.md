# Runbook: reports

FR-F4 (new requirement, proposed: OPEN_QUESTIONS.md D82, L10, L11, O12, P23), FR-F1, FR-C7, FR-F3, ARCHITECTURE.md sections 4 and 11, `vacancy-moderation.md`, `admin-console.md`. The queue is `/[lang]/admin/reports` and a report is `/[lang]/admin/reports/<number>`. The Trust & Safety Administrator at aal2 works the queue; the Platform Administrator at aal2 reads it; the Verification Reviewer, a company member and a candidate get the not-found page, and every function repeats the check in the database.

## 1. Who can report what

| Button or link | Who | What is stored |
|---|---|---|
| Report job (Trust & Safety page, or Report this vacancy on a vacancy page) | anyone | the vacancy (it must be open, visible and not deleted) |
| Report company (Trust & Safety page, or Report this company on a vacancy page) | anyone | the organisation, found through one of its public vacancies (a company has no public page of its own) |
| Report content (Trust & Safety page) | anyone | the path of a page of the site, without query or fragment |
| Report profile (Trust & Safety page) | nobody from outside: it explains that candidate profiles are private | no form |
| Report this profile (applicant page) | a member of the organisation of the application, at aal2 where applicant data asks for it | the application id and nothing of the candidate |

A report has a category (illegal content, misleading or fraudulent, discrimination, a fee demanded from the worker, harassment, privacy violation, something else), a text of 20 to 2000 characters, a statement of good faith, and, for a visitor, an optional email address. The reporter gets a reference number (`R-` and six digits) on the screen. A signed-in reporter reads the status, the outcome and the note under My reports, and a notice on the dashboard for 14 days after the closing. No email is sent.

The same reporter reporting the same target in the same category within 24 hours gets the first reference and nothing new is stored. A visitor is recognised by the address they gave; without one they are not, and the limit is the throttle of 10 reports per visitor and hour (`rate_limit_report_max` and `rate_limit_report_seconds` in `private.settings`).

## 2. Working the queue

1. Open the queue. The default is the open reports (new and in review), oldest first, 25 to a page. Filter by status and by kind; the address holds the filter.
2. Open one report. It shows the category, the text, the reporter (a signed-in account, or the visitor and their address when given) and the target in context: the vacancy with its status and visibility, the organisation with its status, the page, or for a candidate only the vacancy applied to and the organisation. The name of a candidate and the documents are never shown (FR-F3).
3. Mark in review when you start. It records who and when, and the report stays in the open queue.
4. Decide. If the vacancy must be hidden, use Open the vacancy to hide or unhide it, which is the page of `vacancy-moderation.md` (statement of reasons, email to the employer, appeal route). If the organisation must be suspended, use Open the organisation (`admin-console.md`). The report does not repeat these controls and does not check that they were used.
5. Close the report as actioned or dismissed with a note of 10 to 2000 characters. A signed-in reporter reads the note, so write it for them; do not put personal data in it. A closed report is final.

Of two simultaneous moves one wins; the other is told that the report was moved (`CHARA_INVALID_STATE`). A report about a candidate cannot lead to a suspension from the page, because staff do not see who the candidate is; if the text of the reporter identifies an account, find it with the user search and act there with its own reason.

Every move is an audit row (`report.in_review`, `report.actioned`, `report.dismissed`, with the reason and the request id), and every report is an audit row `report.submitted` (kind, category and target ids; no text, no address).

## 3. Response times (to be set by CHARA, O12)

The software sets none. Proposed: look at the queue every working day, a first look (in review) within 2 working days, a decision within 7 days. The queue is oldest first, so the first row is always the report that has waited longest. If the legal adviser confirms that Art. 16 of the Digital Services Act applies (L10), the confirmation of receipt and the notice of the decision to a reporter who gave an address are duties this release does not meet by email; the adviser says whether the reference on screen and the note under My reports are enough.

## 4. Measured

KPI of FR-F1, time to resolve reports, in hours, per month of closing:

```sql
select date_trunc('month', handled_at) as month,
       count(*) as closed,
       round(avg(extract(epoch from handled_at - created_at)) / 3600) as mean_hours,
       round((percentile_cont(0.5) within group (order by extract(epoch from handled_at - created_at)) / 3600)::numeric) as median_hours
from public.reports
where status in ('actioned', 'dismissed')
group by 1 order by 1 desc;
```

Open reports by age and the oldest one:

```sql
select status, count(*), min(created_at) as oldest from public.reports where status in ('new', 'in_review') group by 1;
```

Reports by kind and category in the month, and the share closed as actioned:

```sql
select target_type, category, count(*) as reports, count(*) filter (where status = 'actioned') as actioned
from public.reports where created_at >= date_trunc('month', now()) group by 1, 2 order by 3 desc;
```

Closed reports are removed 365 days after the closing (`closed_reports` in `private.retention_policies`, L11), so these queries cover a year of closed reports and every open report. The count of reports submitted per day, which the removal does not touch, is the audit rows `report.submitted`.

## 5. Retention and erasure

`private.apply_retention` removes a report closed more than 365 days ago and writes one `retention.run` audit row with the period and the count. `erase_user` of a candidate who made reports replaces the account of the reporter by the pseudonym of the erasure, clears an address that equals their email, and keeps the text and the outcome until the retention period ends. Reports about an applicant keep the application id, which the erasure already pseudonymises.

## 6. Checks and measured

- `npm run db:test` runs `105` to `109` of `supabase/tests/database`: the table has no grant and no policy, every refusal of `submit_report` (a vacancy that is not public, an applicant of another organisation, a candidate, a visitor, the good-faith statement, the length of the text, the path), the duplicate rule, the throttle and the proof, the queue and the three staff functions with their roles, the audit rows, the retention and the erasure.
- `npm run e2e -w @chara-pinnacle/web -- reports-visitor reports-queue reports-applicant company-description public-search-employer` runs the browser flows with axe at 1280 and 360 px; they write the screenshots of U65 to `docs/phase-1/client/evidence/U65/` (not committed).
- Query plans (EXPLAIN ANALYZE in a rolled-back transaction with 200,000 reports, 6,020 of them open): the first page of the open queue reads `reports_open_idx` in 0.1 ms, a page of a closed status or of all reports walks the primary key backwards in 0.03 ms, filtering the open queue by kind reads the open reports only (4 ms for 6,000), and the daily removal reads `reports_closed_idx`.
- Employer filter: with 3,000 organisations and 180,000 open vacancies the planner takes the trigram index for a rare part of a name (0.4 ms) and walks the newest vacancies for a common one (1.3 ms); a search without the filter keeps its plan (0.1 ms).
