# Runbook: applicant list and pipeline board

FR-E1, design point D57 (OPEN_QUESTIONS.md). The SOP is "Applicant List & Pipeline Board E2E" (owner Employer member, reviewed semi-annually). Queries are run by CHARA staff as the database owner (SQL editor of the project).

## 1. What is read and written

- `public.v_job_applicants` (`security_invoker`, `authenticated` only): one row per application the caller may read (the member policy of FR-D5 decides), with `id`, `job_id`, `organization_id`, `job_title`, `candidate_name` (from the snapshot, null after erasure), `status`, `applied_at`, `completeness` and `documents`. No document name, document id, storage path, candidate id or address. `documents` is the number of ids in the scope of the application's share, 0 once the share is revoked or has expired (`private.application_document_count`).
- The completeness is the percentage of the candidate's passport (FR-B4) at the time of applying. `private.passport_completeness(user)` computes it in SQL and the trigger `job_applications_snapshot_completeness` stores it in `profile_snapshot.completeness`. The weights are those of `apps/web/lib/passport/completeness.ts`: a change to one needs the same change to the other (pgTAP `069_applicant_completeness.test.sql` and Vitest `completeness.test.ts` pin them, and both places point to the other). The value is the one at the time of applying; it is not updated when the candidate improves the passport. An application made before the migration shows 0.
- `public.get_board_counts(job)` (`security invoker`, `authenticated` only): the number of applications in each stage of a vacancy, counted under the row policy of FR-D5. The board polls it (server action `readBoardCounts`) and reads the page again only when a count differs.
- `public.get_applicant_access(org)`: `stage_change_blocked` (`read_only_free_plan` for a lapsed organisation, or any on the free plan once limits are enforced), `shortlisting_available`, `csv_export_available`, `note_max_chars`. No row for anybody who is not an accepted member of an active organisation.
- `public.export_applicants(job, stage)`: the rows of the list for the CSV file, every page of the filter, newest first; writes the audit row `applicants_exported` (actor, `entity_type` job, vacancy id; metadata: organisation, stage, row count; never a candidate). The file is built by the POST route `/[lang]/org/[slug]/applicants/export` (`lib/applicants/csv.ts`: a cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading quote; cells with a comma, a quote or a line break are quoted as RFC 4180).
- Web: `/[lang]/org/[slug]/applicants` (`job`, `view`, `sort`, `dir`, `stage`, `page`). The stage moves are `changeApplicantStage` (FR-D2) and so `set_application_status`; nothing in FR-E1 writes a stage by another path.

## 2. Settings and data that CHARA may change

- Which plans include the CSV export (C16, to be confirmed by CHARA): rows of `billing.plan_features` with `feature_key = 'csv_export'` (now `employer_starter`, `employer_professional`, `employer_enterprise`). Insert or delete rows; no code changes.
- The most rows one export may hold: `private.settings.applicant_export_max_rows` (10,000). More is refused with `CHARA_LIMIT_REACHED`, never cut; the user filters by stage.
- Page size 50 (`APPLICANTS_PAGE_SIZE`), board column size 25 (`BOARD_COLUMN_LIMIT`) in `apps/web/lib/dal/applicant-list.ts`; the polling interval of the board (5 seconds) is `POLL_MS` and the time without input after which it stops (5 minutes) is `IDLE_MS` in `apps/web/components/applicants/board.tsx`.

## 3. KPI: time to first review of new applicants

The first review is the first event of an application that is neither its creation nor a withdrawal: the move to Viewed on the first open of the applicant page (FR-D2), or any move a member makes. Median and 90th percentile in hours for the applications of last month, per organisation, and the applications that nobody has looked at yet:

```sql
select a.organization_id,
       count(*) as reviewed,
       round(percentile_cont(0.5) within group (order by extract(epoch from r.first_review - a.created_at) / 3600)::numeric, 1) as median_hours,
       round(percentile_cont(0.9) within group (order by extract(epoch from r.first_review - a.created_at) / 3600)::numeric, 1) as p90_hours
from public.job_applications a
join lateral (
  select min(e.created_at) as first_review from public.application_events e
  where e.application_id = a.id and e.to_status not in ('applied', 'withdrawn')
) r on r.first_review is not null
where a.created_at >= date_trunc('month', now()) - interval '1 month' and a.created_at < date_trunc('month', now())
group by a.organization_id;

-- Waiting for more than seven days (the partial index job_applications_applied_created_idx serves it)
select organization_id, count(*) from public.job_applications
where status = 'applied' and created_at < now() - interval '7 days' group by organization_id;
```

pgTAP `069_applicant_completeness.test.sql` runs the first query against known events.

## 4. Risk and controls

Risk: overlooked applicants. Controls:

- New-applicant highlighting: the New badge marks every application in Applied (not opened by a member) on the list and the board; the default order is newest first, and the stage filter and the sort by stage bring the waiting ones together. Tested by `applicant-list.spec.ts` (AC1), `applicant-board.spec.ts` (AC4, AC12) and Vitest `applicants-page.test.ts`.
- Digest emails: operational for this unit. They are FR-I3 (U39), built on `notify` (U37); until then nothing mails an employer about waiting applicants. The query in section 3 shows what a digest would list.
- Isolation: members read the applications of their own active organisation only (policies of FR-D5, pgTAP `064`, `066`, `067`, `068` for the view and the export). `get_applicant_access` and `export_applicants` answer an outsider with no row or `CHARA_NOT_FOUND`.
- A lapsed organisation keeps a read-only view (C11): `stage_change_blocked`, the disabled Move buttons and Export, the refusal `CHARA_FEATURE_NOT_IN_PLAN` of `set_application_status` and `export_applicants` (`applicant-board.spec.ts` AC12, `applicant-export.spec.ts`, pgTAP `068`).

Quarterly nothing is required; semi-annually:

1. Run `npm run db:test` and `npm run e2e -w @chara-pinnacle/web -- applicant-` and read the result.
2. Read the KPI of section 3 and the number of applications waiting for more than seven days.
3. Check the plans that carry the export: `select plan_code from billing.plan_features where feature_key = 'csv_export' order by 1;` and the export log: `select count(*), max(created_at) from audit.log where action = 'applicants_exported';`.

## 5. Measured

Rolled-back transaction, 30,000 applications of one organisation (20,000 in one vacancy), shares with two documents, as an authenticated member (`EXPLAIN (ANALYZE)`, statistics current):

| Query | Time |
|---|---|
| a page of the vacancy list, newest first (`job_applications_job_created_idx`, 50 rows) | 1.7 ms |
| a board column (25 newest of one stage, `job_applications_applied_created_idx`) | 0.9 ms |
| count of one stage of the vacancy / of the whole organisation | 2.5 ms / 3.7 ms |
| a page of the list of all vacancies sorted by stage, 200,000 applications of one organisation, without the row policy (`job_applications_organization_status_idx`; 20 ms by a parallel scan without the index) | first page 0.1 ms; a descending page at offset 50,000 44 ms |
| the counts of the board poll (`get_board_counts`, index-only scan of `job_applications_job_status_idx`) | 3.5 ms for 20,000 applications of one vacancy (one grouped read per poll, every 5 seconds per open board) |
| a page of the vacancy list sorted by documents (the count is read for each of the 20,000 applications) | 261 ms |

The list of all vacancies sorts by stage and applied date only, because completeness and documents would be evaluated for every application of the organisation. Sorting by documents of one vacancy is the slowest path: it grows linearly with the applications of the vacancy, and a list of 2,000 takes about 30 ms. If a vacancy reaches tens of thousands of applications, store the count on the application and keep it with a trigger on `passport_shares`. First-load JavaScript, gzipped chunk by chunk from `.next/diagnostics/route-bundle-stats.json` after `npm run build`: the applicants page 158 KB (the board and the stage filter are the client parts), the applicant page 154 KB.

The list is paged by offset because the criteria ask for page numbers and a last page; a move between two page loads can show one row twice or skip one.

## 6. Hand-offs

- U33 (FR-E2): the decline reason. Today Not selected, from the menu or by dropping a card, opens the two-step dialog of FR-D2 with the stage preselected (`StageChangeDialog`); FR-E2 replaces its fields with the reason.
- U34 (FR-E3) adds the selection and bulk actions to the list; U36 (FR-E5) links the dashboard to `?stage=` and `?sort=applied` of this page.
- U37 (FR-I2): the candidate's `status_changed` email. The tests read the queue (`pgmq.q_notifications`).
- Live counts are polled. If Realtime Broadcast is wanted, add a trigger on `job_applications` that sends ids and the status on a private topic per organisation, a `realtime.messages` policy for active members, and the subscription in `lib/supabase/browser.ts`; the 10-second polling stays as the fallback.
