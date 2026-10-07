# Runbook: candidate journey tracker

FR-D3, design point D54 (OPEN_QUESTIONS.md). The SOP is "Candidate Journey Tracker E2E" (owner Candidate, reviewed semi-annually). The tracker stores nothing: it reads what FR-D1, FR-D2 and FR-D7 wrote. Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them.

## 1. What is read

- `public.my_applications(p_stage, p_limit, p_offset)` (definer, `authenticated` only, candidates only): the list. One row per application of the caller: `id`, `job_title`, `employer_display_name`, `job_status`, `moderation_state`, `status`, `applied_at`, `last_event_at`, newest latest event first (equal times: newer application first, then id). It is the only source of the list, because the policies of `public.jobs` hide a Paused, Closed, hidden or suspended vacancy from the candidate who applied to it. `p_stage` null means every stage; `p_limit` is 20 when null and at most 50; a negative `p_offset` is `CHARA_INVALID_INPUT`. It replaces `list_my_applications` of FR-D1.
- `public.get_my_application(p_id)` (FR-D1): the page of one application, with whether the vacancy is Open and visible (the link to the public page).
- `public.v_my_application_timeline` (`security_invoker`): `application_id`, `created_at`, `from_status`, `to_status`, `note`, `actor_role` (`you`, `employer` or `system`). No id and no user id. The grant on `application_events` leaves out `actor_id`, so the role is told by `private.application_event_actor_role(event id)`, a definer that reads the actor for the caller's own events only (null for anybody else's).
- Web: `/[lang]/applications` (`?stage=` and `?page=`, a value that is not valid falls back to every stage and the first page, page size 20, a pager of Previous and Next), `/[lang]/applications/[id]`. Visitors go to log in, platform staff to `/admin`, any other account to its home (`requireCandidate` in `lib/dal/session.ts`). The stage texts and the next-step texts are in `apps/web/lib/applications/presentation.ts`.

## 2. Open points

- The next-step texts (one per stage, at most 200 characters) are proposed wording; CHARA may change them in that one file. Vitest `application-presentation.test.ts` keeps the length, the wording of a decline ("not selected", never "rejected") and the sentence about documents on a withdrawn application.
- The page size (20) is `APPLICATIONS_PAGE_SIZE` in `lib/dal/applications.ts`; the function caps a page at 50.

## 3. KPIs

**Tracker visits per application**: the web server writes one line per view, `{"event":"tracker_view","page":"list"}` or `"page":"application"`; it names neither the candidate nor the application. Visits per application for a period are the lines of `page: application` divided by the applications made in the period, which are the audit rows `application.submitted`. The log platform keeps the lines only as long as its retention (export them per period, as in `docs/runbooks/vacancy-page.md`).

```sh
jq -s '[.[] | select(.event == "tracker_view" and .page == "application")] | length' pages.jsonl
```

```sql
select count(*) from audit.log
where action = 'application.submitted' and created_at >= date_trunc('month', now()) - interval '1 month' and created_at < date_trunc('month', now());
```

**Support requests about status**: operational. The platform has no support tracker; the requests arrive by email, and the team counts those that ask about an application's stage per month against the applications of the month (the same query). A rise after a change to the stage texts means the copy is unclear.

## 4. Controls and how to check them

- Own rows only: `job_applications_select_own` and `application_events_select_own` (FR-D1) decide the rows, `my_applications` filters on `worker_user_id = auth.uid()` itself; pgTAP `060_journey_timeline.test.sql` (another candidate, an employer member and owner, the three platform roles, anonymous) and `061_my_applications_list.test.sql` (the same, and the list of one candidate never holds another's).
- No employer identity: the view columns are asserted from the catalogue (060), the column `actor_id` cannot be selected from the view or the table (060), and the browser test `journey-tracker.spec.ts` (AC1 and AC6) searches the HTML, the server-component payload and the responses for the id, the email and the display name of the employer member who moved the application.
- Clear stage copy: the next-step text of every stage on the page, Vitest as above, and the stage shown as text on the list and the page (`journey-tracker.spec.ts`, AC12).
- Application kept after the vacancy leaves the public site: pgTAP 061 (Paused, Closed, Filled, hidden, org_suspended).

Check the exposed columns at any time (must list the six names above and nothing else):

```sql
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'v_my_application_timeline' order by ordinal_position;
```

## 5. Hand-offs

- U30 (FR-D4): the page renders `Withdraw application` for the five stages that `allowedTargets(status, "candidate", ...)` offers it for, **disabled**, because `withdraw_application` does not exist yet. U30 replaces that button with the confirmation dialog and the action.
- U33 (FR-E2) adds the notes form to the applicant page; the table `application_notes` came with U31. FR-D3 AC1, AC5 and AC6 name an internal note ("Weak English") that must appear nowhere on the candidate's pages: U33 adds that note to `journey-tracker.spec.ts` (AC1, AC6) and the checks of AC5 to the pgTAP tests (`application_notes` returns no row to the candidate, no output column of the view or `my_applications` carries its text).
- U31 (FR-D5) added the employer's read of the same tables; the view joins the application and keeps only the candidate's own rows, and the function stays the candidate's read.

## 6. Semi-annual review

1. Run `npm run db:test` and `npm run e2e -w @chara-pinnacle/web -- journey-tracker` and read the result.
2. Read the two KPIs of section 3 for the half year. Many visits per application with many status questions means the stage copy or the employer's notes leave candidates guessing.
3. Run the column check of section 4.
4. Read the next-step texts once more with the owner of the SOP.

## 7. Measured

Rolled-back transaction, 100,000 applications of 20,000 vacancies, 60 of them one candidate's and 100,060 events (`EXPLAIN (ANALYZE)`, statistics current): a page of `my_applications` (the candidate's rows by `job_applications_worker_created_idx`, the vacancy and the organisation by primary key, the latest event of each by an index-only backward scan of `application_events_application_idx`, a sort of the candidate's own rows) 0.7 ms; the timeline of one application 0.03 ms. The list reads all of one candidate's applications to order them by the latest event, which is bounded by what one candidate applies to (the apply rate limit, `docs/runbooks/applications.md`). First-load JavaScript, gzipped chunk by chunk from `.next/diagnostics/route-bundle-stats.json` after `npm run build`: the list 154 KB (it was 153 KB before the stage filter, the one client component of the tracker), the application page 153 KB.

The list is paged by offset over an order that depends on the latest event, so a page boundary can shift when an employer moves an application between two page loads (one row seen twice or skipped). If candidates reach thousands of applications, replace the offset with a keyset on (`last_event_at`, `created_at`, `id`).

## 8. Deploy order and event order

- Apply `20261024100000_journey_tracker.sql` together with, or immediately before, the web release: it drops `list_my_applications`, which the previous release still calls, so the old list page errors until that instance is replaced.
- The timeline is ordered by `created_at` alone (the view carries no event id). `application_events.created_at` is the transaction time, so two events of one application written in one transaction would tie. Every writer today (`private.move_application`, `apply_to_job`) writes one event per application per transaction; a unit that writes two must give the view a tie-break (event id) first.
