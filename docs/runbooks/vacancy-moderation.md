# Runbook: vacancy moderation

FR-C7, ARCHITECTURE.md section 11, `admin-console.md`. The page is `/[lang]/admin/moderation` (search) and `/[lang]/admin/moderation/<vacancy id>` (decision); only the Trust & Safety Administrator at aal2 has them. The Platform Administrator and the Verification Reviewer get the not-found page, and every function repeats the check in the database.

## 1. The procedure

1. Receive. A report or a routine review names a vacancy. Phase 1 has no report form (reports are a later phase): the report arrives by the contact route of the Complaints and Dispute Process page.
2. Assess. Search by title, by part of the organisation name or by the vacancy id. The decision page shows the text as the employer wrote it and the moderation history, never an application, a note or a document.
3. Act. Hide this vacancy, with a statement of reasons of 10 to 2000 characters. One transaction sets `moderation_state = 'hidden'` (the status stays), writes one `moderation_actions` row (`job_hidden`) and one `audit.log` row (`job.hide`, reason and request id) and queues the mandatory `vacancy_hidden` email to the owner and each administrator of the organisation. The email quotes the reasons and links to the Complaints and Dispute Process page, which is the appeal route.
4. Appeal. The employer writes to the contact route of that page. The Trust & Safety Administrator decides within 7 days of the appeal. A decision to restore is an unhide with a statement of reasons (a `job_unhidden` row and a `job.unhide` audit row; no email is sent). A decision to uphold has no database record in Phase 1: it is entered in the appeals log (section 2) with its reasons and date, and the employer is told by reply to the appeal.
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

The statement of reasons is 10 to 2000 characters, the limit of every administrative action and the one the acceptance criteria of FR-F1 name for `moderate_job`; the criterion AC2 of FR-C7 says 20, and the two cannot both hold. The KPI of reasons recorded (100 %) is the query of `audit-log.md` section 3.

Appeals log (operational, to be confirmed by CHARA). Phase 1 stores no appeal, so a sheet kept by the Trust & Safety Administrator holds one row per appeal: vacancy id, date the appeal was received, date of the decision, outcome (`restored` or `upheld`) and the reasons given. A restored appeal is also a `job_unhidden` row of the month; an upheld one exists only in the log. The two KPIs of the procedure are read from it:

- Decision within 7 days (%) = appeals whose decision date is at most 7 days after the received date / appeals received in the month.
- Appeals upheld (%) = appeals with the outcome `upheld` / appeals decided in the month.

## 3. Measured

Calls of `admin_search_jobs` in a rolled-back transaction with 200,000 vacancies in 5,000 organisations (30 % of the titles contain "welder"), seven calls of each in one connection: the page of 25 for "welder" takes 2.5 ms (without `jobs_newest_idx` 70 ms, sorting 60,000 matches), a page after a cursor 2.5 ms, a rare part of a title 2.5 ms (the planner takes `jobs_title_trgm_idx`), and a term that matches the names of 500 organisations 11 ms (one page per organisation through `jobs_organization_created_idx`). Each branch applies the cursor and takes one page, so the union holds at most three pages whatever the number of matches. The function is planned for each call (`plan_cache_mode = force_custom_plan`): from the sixth call of a connection the generic plan took 140 to 330 ms. `admin_search_users` and `admin_search_organizations` have the same shape and are bounded by the number of accounts; they were not changed. The list of suspensions and reinstatements is served by `moderation_actions_accounts_idx`.
