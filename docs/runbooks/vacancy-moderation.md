# Runbook: vacancy moderation

FR-C7, ARCHITECTURE.md section 11, `admin-console.md`. The page is `/[lang]/admin/moderation` (search) and `/[lang]/admin/moderation/<vacancy id>` (decision); only the Trust & Safety Administrator at aal2 has them. The Platform Administrator and the Verification Reviewer get the not-found page, and every function repeats the check in the database.

## 1. The procedure

1. Receive. A report or a routine review names a vacancy. Phase 1 has no report form (reports are a later phase): the report arrives by the contact route of the Complaints and Dispute Process page.
2. Assess. Search by title, by part of the organisation name or by the vacancy id. The decision page shows the text as the employer wrote it and the moderation history, never an application, a note or a document.
3. Act. Hide this vacancy, with a statement of reasons of 10 to 2000 characters. One transaction sets `moderation_state = 'hidden'` (the status stays), writes one `moderation_actions` row (`job_hidden`) and one `audit.log` row (`job.hide`, reason and request id) and queues the mandatory `vacancy_hidden` email to the owner and each administrator of the organisation. The email quotes the reasons and links to the Complaints and Dispute Process page, which is the appeal route.
4. Appeal. The employer writes to the contact route of that page. The Trust & Safety Administrator decides within 7 days of the appeal. A decision to restore is an unhide with a statement of reasons (a `job_unhidden` row and a `job.unhide` audit row; no email is sent). A decision to uphold has no database record in Phase 1: it is entered with its reasons and date in the moderation log of the operating procedure, and the employer is told by reply to the appeal.
5. Restore. Unhide this vacancy when the matter is resolved. If its organisation is suspended at that moment the vacancy becomes `org_suspended` (not public) and is shown again by the reinstatement of the organisation.
6. Report. The monthly statistics are the query below.

A vacancy of a suspended organisation (`org_suspended`) cannot be hidden or unhidden until the organisation is reinstated, and a vacancy hidden by moderation stays hidden through a suspension and a reinstatement of its organisation. Of two simultaneous decisions one wins; the other is told the state the first left (`CHARA_INVALID_STATE`).

## 2. Monthly statistics

```sql
select date_trunc('month', created_at) as month,
       count(*) filter (where action = 'job_hidden') as hidden,
       count(*) filter (where action = 'job_unhidden') as unhidden
from public.moderation_actions
where target_type = 'job'
group by 1 order by 1 desc;
```

KPI "Decision within 7 days (%)" and "Appeals upheld (%)": Phase 1 stores no appeal, so both are read from the moderation log of the operating procedure (date of the appeal, date of the decision, outcome). Restored appeals are also `job_unhidden` rows of the month. The KPI of reasons recorded (100 %) is the query of `audit-log.md` section 3.

## 3. Measured

EXPLAIN ANALYZE in a rolled-back transaction with 20,000 vacancies in 500 organisations: a rare part of a title 12 ms by sequential scan and 1 ms through `jobs_title_trgm_idx` (the planner scans at this size; the index takes over as the table grows), a term that matches 30 % of the titles 20 to 25 ms for the page of 25 (the hits are sorted by `created_at`). The organisation-name branch is written for `organizations_display_name_trgm_idx` (it scanned the 500 organisations at this size).
