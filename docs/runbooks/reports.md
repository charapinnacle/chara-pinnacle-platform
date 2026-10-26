# Runbook: reports

FR-F4 (new requirement, proposed: OPEN_QUESTIONS.md D82, L10, L11, O12, P23), FR-F1, FR-C7, FR-F3, ARCHITECTURE.md sections 4 and 11, `vacancy-moderation.md`, `admin-console.md`. The queue is `/[lang]/admin/reports` and a report is `/[lang]/admin/reports/<number>`. The Trust & Safety Administrator at aal2 works the queue; the Platform Administrator at aal2 reads it; the Verification Reviewer, a company member and a candidate get the not-found page, and every function repeats the check in the database.

## 1. Who can report what

| Button or link | Who | What is stored |
|---|---|---|
| Report job (Trust & Safety page, or Report this vacancy on a vacancy page) | anyone | the vacancy (it must be open, visible and not deleted) |
| Report company (Trust & Safety page, or Report this company on a vacancy page) | anyone | the organisation, found through one of its public vacancies (a company has no public page of its own) |
| Report content (Trust & Safety page) | anyone | the path of a page of the site, without query or fragment |
| Report company and Report a fee demand (public partner profile, release 2a, V26) | anyone but a member of the partner | the organisation of the profile (target `partner_profile`); Report a fee demand chooses the category "The company asked me to pay a fee". A profile that is not public (not listed, declined, suspended, hidden, or release 2a off) gets the same "not public" answer as a slug that does not exist |
| Report profile (Trust & Safety page) | nobody from outside: it explains that candidate profiles are private | no form |
| Report this profile (applicant page) | a member of the organisation of the application, at aal2 where applicant data asks for it | the application id and nothing of the candidate; the form tells the member not to write the candidate's name, contact details or documents, but the text is free, so it is the one place where personal data can still reach staff (D82): do not copy it elsewhere |

A report has a category (illegal content, misleading or fraudulent, discrimination, a fee demanded from the worker, harassment, privacy violation, something else), a text of 20 to 2000 characters, a statement of good faith, and, for a visitor, an optional email address. The reporter gets a reference number (`R-` and the id with at least six digits) on the screen. A signed-in reporter reads the status, the outcome and the note under My reports, and a notice on the dashboard for 14 days after the closing. No email is sent.

The same reporter reporting the same target in the same category within 24 hours gets the first reference and nothing new is stored. A visitor is recognised by the address they gave, which is not verified (someone who types another person's address can make that person's report of the same target and category within a day a duplicate); without one they are not, and the limit is the throttle of 10 reports per visitor and hour (`rate_limit_report_max` and `rate_limit_report_seconds` in `private.settings`).

## 2. Working the queue

1. Open the queue. The default is the open reports (new and in review), 25 to a page: reports of a fee demanded from a worker first (labelled Fee demand, `reports.priority` 1, NFR-C6), then the others, each group by its due time and then by number (FR-S1, V26). The Due column shows the due time and Overdue once it has passed. Filter by status and by kind; the address holds the filter and the cursor of the page (`<priority>_<due time>_<id>` for the open lists, the id for the closed ones, which stay newest first).
2. Open one report. It shows the category, the text, the reporter (a signed-in account, or the visitor and their address when given) and the target in context: the vacancy with its status and visibility, the organisation with its status, the page, or for a candidate only the vacancy applied to and the organisation. The name of a candidate and the documents are never shown (FR-F3).
3. Mark in review when you start, with a reason of 10 to 2000 characters (FR-F1: every administrative action has one). It records who and when, the reason goes into the audit row only (the reporter does not read it), and the report stays in the open queue.
4. Decide (FR-S1, V27). The decision buttons fit the target: Hide for a visible vacancy or partner profile, Suspend organisation for the active organisation of a vacancy, a company or a partner, and Dismiss for every report; a report about a candidate or a page has nothing on the platform to act on and is closed with Mark actioned and a note instead. The dialog names the target and its organisation and asks for a statement of reasons of 10 to 2000 characters, with its count. One call (`moderation_decide`) takes the decision and closes the report actioned (dismissed for Dismiss) with the reasons as its note, in one transaction:
   - Hide a vacancy: as `vacancy-moderation.md`; the owner and administrators get the `vacancy_hidden` email with the reasons and the appeal route.
   - Hide a partner profile: the profile, its listings and its directory entries leave the public; the owner and administrators get the mandatory `moderation_decision` email and in-app item with the reasons and the appeal route, and every member sees the badge "Hidden by moderation" with the reasons on the workforce profile page.
   - Suspend the organisation: as `admin-console.md`; the vacancies and a visible partner profile leave the public, the members are signed out and the owner and administrators get the `account_suspended` email with the reasons and the appeal route.
   - Dismiss: nothing changes for the reported party and nothing is sent to it.
   A second report asking for what is already in effect (the item hidden, the organisation suspended) offers "Hide (already hidden)" or "Suspend organisation (already suspended)": the report is closed actioned without acting again, the audit row names the decision in effect, and only the reporter is told. Nobody decides on their own organisation (a member, an open invitation, or an organisation with the same identifier: `own_organization`). A signed-in reporter gets the `moderation_decision` notice with the reference and the outcome only, and reads the note under My reports. While release 2a is off the report page keeps the Phase 1 moves (Dismiss and Mark actioned with a note) and the vacancy and organisation controls linked above, and `moderation_decide` refuses (`release_off`). Write the reasons for both readers; do not put personal data in them. A closed report is final.
5. Staff's own finding, without a report: the organisation page shows a partner's profile visibility, every availability listing (stale ones flagged, those of a suspended or hidden partner included: DATA_MODEL 11.13), the decisions on it with the report each closed, and Hide partner profile or Show partner profile again; the suspension and the reinstatement stay where they were. A vacancy is hidden or shown again on its moderation page.

Of two simultaneous decisions one wins; the other is told "This report was changed by someone else, reload the page" with the status the report now has (`CHARA_INVALID_STATE` with the status). A report about a candidate cannot lead to a suspension from the page, because staff do not see who the candidate is; if the text of the reporter identifies an account, find it with the user search and act there with its own reason. While release 2a is on, every notice of a decision that can be appealed links to its decision page (section 2a); before it, the appeal route is the Complaints and Dispute Process page.

## 2a. Appeals (FR-S1 step Appeal, V28, DSA Art. 20; release 2a only)

1. What can be appealed: a partner profile hidden, a vacancy hidden and an organisation suspended (`content_hidden`, `job_hidden`, `organization_suspended`). An unhide, a reinstatement, a dismissal and the suspension of a user are not appealed here. A reporter's complaint against a dismissal and a worker's appeal on a message: not built; open question with CHARA (`OPEN_QUESTIONS.md` L12). Until it is answered, the email and the notification that tell a reporter their report was dismissed point to the Complaints and Dispute Process.
2. Who appeals and when: an owner or admin of the affected organisation, at aal2, from the "Hidden by moderation" badge, from the decision page under Moderation decisions (`/appeals`, linked from the hidden vacancy and from the `moderation_decision`, `vacancy_hidden` and `account_suspended` notices) or, for a suspended organisation, from the decision page its suspension notice links to. One appeal per decision, within `appeal_window_months` (6) of it and while it is still in effect, with grounds of 20 to 2000 characters. Every member sees the decision, its reasons and the appeal under review or decided, without the button. The appeal is due `appeal_decision_target_days` (7) days after it is lodged; both are settings of the settings editor (1 to 24 months, 1 to 90 days) and the target is shown, not enforced.
3. Deciding: Appeals in the console lists the open appeals by due time (Overdue once passed), then the decided ones newest first, with the share reversed on appeal over the last year. The appeal page shows the decision with its reasons and report, whether it is still in effect, and the grounds; the appellant's name is not shown. A Trust & Safety administrator who did not take the decision and does not belong to the organisation (`same_reviewer`, `own_organization`) chooses Reverse the decision or Uphold the decision, with a statement of reasons of 10 to 2000 characters. Reverse undoes the decision through the same bodies as the console: the profile or the vacancy is shown again (to `org_suspended` while its organisation is suspended), the organisation is reinstated (its members get `account_reinstated`). The appellant gets one mandatory `moderation_decision` notice with the outcome and the reasons; the page and the badge show it to every member. Of two simultaneous decisions one wins, the other is told "This appeal was decided by someone else, reload the page". The Platform Administrator reads the appeals only.
4. Audit: `appeal.lodged` (by the appellant: decision, organisation, target type), `appeal.restored` or `appeal.upheld` (reasons, decision, reversal decision id, `already_reversed` when a later decision had undone it already), and the reversal's own row (`partner_profile.unhide`, `job.unhide`, `organization.reinstate`).

Every move is an audit row (`report.in_review`, `report.actioned`, `report.dismissed`, each with the reason and the request id, and for a decision the decision and the `moderation_actions` id; the target action writes its own row, such as `partner_profile.hide` or `organization.suspend`, with the report id; the reason KPI query of `audit-log.md` section 3 covers them), and every report is an audit row `report.submitted` (kind, category and target ids; no text, no address).

## 3. Response times (decision 7.2, to be confirmed by CHARA, O12)

Since V26 each report gets a due time when it is stored (`reports.due_at`): one working day for a fee demand (`report_fee_demand_target_working_days`), two working days for a first look at any other report (`report_first_look_target_working_days`), Monday to Friday in Europe/Berlin at the same local time, without a holiday calendar; a report made on a weekend counts from the Monday. Both targets are changed in the settings editor (Platform Administrator at aal2, with a reason, audited as `setting.changed`, 1 to 20 working days) and apply to the reports stored after the change. The targets are shown, not enforced: nothing happens to an overdue report but the label, and no one is notified. Since V27 each report also gets a decision target when it is stored (`reports.decision_due_at`): `report_decision_target_days` (7) calendar days later, a setting of the same editor (1 to 90 days), shown as Decision due on the report and not enforced either. Look at the queue every working day: the first row is the fee demand due first, or the report due first when there is none. If the legal adviser confirms that Art. 16 of the Digital Services Act applies (L10), the confirmation of receipt and the notice of the decision to a reporter who gave an address are duties this release does not meet by email; the adviser says whether the reference on screen and the note under My reports are enough.

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

KPIs of FR-S1 (P2-41): median time to first look and to decision, in hours, per month of creation. The first look is the audit row `report.in_review` (the report keeps only the time of its last move); a report closed without review counts its closing as the first look:

```sql
select date_trunc('month', r.created_at) as month,
       round((percentile_cont(0.5) within group (order by extract(epoch from coalesce(l.at, r.handled_at) - r.created_at)) / 3600)::numeric) as median_first_look_hours,
       round((percentile_cont(0.5) within group (order by extract(epoch from r.handled_at - r.created_at)) filter (where r.status in ('actioned', 'dismissed')) / 3600)::numeric) as median_decision_hours,
       count(*) filter (where coalesce(l.at, r.handled_at) <= r.due_at) as first_look_on_time,
       count(*) as reports
from public.reports r
left join lateral (select min(a.created_at) as at from audit.log a where a.action = 'report.in_review' and a.entity_id = r.id::text) l on true
where r.handled_at is not null
group by 1 order by 1 desc;
```

Decisions in the month by kind, from the record of each decision (V27; a dismissal has no record and is the `report.dismissed` audit row), and the decisions taken after their target:

```sql
select a.target_type, a.action, count(*) as decisions, count(*) filter (where a.report_id is null) as own_findings,
       count(*) filter (where a.created_at > r.decision_due_at) as after_target
from public.moderation_actions a left join public.reports r on r.id = a.report_id
where a.created_at >= date_trunc('month', now()) group by 1, 2 order by 3 desc;
```

Decisions reversed on appeal (%) per month of the appeal decision (V28; the console shows the last 12 months from `admin_appeal_stats`), and the appeals decided after their target:

```sql
select date_trunc('month', decided_at) as month, count(*) as decided, count(*) filter (where status = 'restored') as restored,
       round(100.0 * count(*) filter (where status = 'restored') / count(*)) as reversed_percent,
       count(*) filter (where decided_at > due_at) as after_target
from public.appeals where status <> 'open' group by 1 order by 1 desc;
```

Reports per 1,000 active organisations in the month (FR-S1 KPI; reports about an organisation, a company or a partner profile):

```sql
select round(1000.0 * count(*) / nullif((select count(*) from public.organizations where status = 'active'), 0), 1) as per_1000
from public.reports where created_at >= date_trunc('month', now()) and organization_id is not null;
```

Open reports by age and the oldest one:

```sql
select status, count(*), min(created_at) as oldest, count(*) filter (where due_at < now()) as overdue
from public.reports where status in ('new', 'in_review') group by 1;
```

Reports by kind and category in the month, and the share closed as actioned:

```sql
select target_type, category, count(*) as reports, count(*) filter (where status = 'actioned') as actioned
from public.reports where created_at >= date_trunc('month', now()) group by 1, 2 order by 3 desc;
```

Closed reports are removed 365 days after the closing (`closed_reports` in `private.retention_policies`, L11), so these queries cover a year of closed reports and every open report. The count of reports submitted per day, which the removal does not touch, is the audit rows `report.submitted`.

## 5. Retention and erasure

`private.apply_retention` removes a report closed more than 365 days ago and a decided appeal more than 365 days after its decision (`closed_appeals`; an open appeal is never removed, and the decision itself stays in `moderation_actions`), and writes one `retention.run` audit row per rule with the period and the count. `erase_user` of a candidate who made reports replaces the account of the reporter by the pseudonym of the erasure, clears an address that equals their email, and keeps the text and the outcome until the retention period ends. Reports about an applicant keep the application id, which the erasure already pseudonymises.

## 6. Checks and measured

- `npm run db:test` runs `105` to `109`, `147` (V26: the target `partner_profile`, due times, the fee-demand-first order and its cursor) `149` (V28: appeals, their roles, window, one per decision, the second reviewer, the restore through the decision bodies, the notice, the KPI, the retention and the cross-tenant reads) and `148` (V27: `moderation_decide`, its statement of reasons and roles, the race, the partner profile hide and unhide, the suspension cascade to profiles, listings, directories, company pages, sitemaps, the follower digest and `connection_target`, the notices and the staff read of listings) of `supabase/tests/database`: the table has no grant and no policy, every refusal of `submit_report` (a vacancy that is not public, an applicant of another organisation, a candidate, a visitor, the good-faith statement, the length of the text, the path), the duplicate rule, the throttle and the proof, the queue and the three staff functions with their roles, the audit rows, the retention and the erasure.
- `npm run e2e -w @chara-pinnacle/web -- reports-visitor reports-queue reports-applicant company-description public-search-employer` runs the browser flows with axe at 1280 and 360 px; they write the screenshots of U65 to `docs/phase-1/client/evidence/U65/` (not committed).
- Query plans (EXPLAIN ANALYZE in a rolled-back transaction with 200,000 reports, 6,020 of them open): the first page of the open queue reads `reports_queue_idx` (priority, due_at, id) in 0.07 ms and a later page from its cursor in 0.05 ms (V26, 6,060 open of 200,000), a page of a closed status or of all reports walks the primary key backwards in 0.03 ms, filtering the open queue by kind reads the open reports only (4 ms for 6,000), and the daily removal reads `reports_closed_idx`.
- Employer filter: with 3,000 organisations and 180,000 open vacancies the planner takes the trigram index for a rare part of a name (0.4 ms) and walks the newest vacancies for a common one (1.3 ms); a search without the filter keeps its plan (0.1 ms).
