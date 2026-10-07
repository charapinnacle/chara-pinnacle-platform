# Runbook: applications (apply and duplicate protection)

FR-D1 and FR-D7, design point D52 (OPEN_QUESTIONS.md). The SOPs are "Job Application Submission E2E" (owner Candidate, reviewed quarterly) and "Duplicate Application Prevention E2E" (owner Platform, reviewed annually). Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them and no staff role can read an application through the application.

## 1. What is stored

- `public.job_applications`: one row per application, written only by `apply_to_job` (status `applied`, `cover_note`, `profile_snapshot`, `passport_share_id`, `organization_id` of the vacancy). No API role can insert, update or delete. The candidate reads the own rows; the employer read comes with FR-D5.
- `public.application_events`: append-only; the first row is `null -> applied` by the candidate. The candidate reads it without `actor_id`.
- `public.passport_shares` and `public.consents`: the share (scope = ids of the selected documents) and the granted consent `share_passport:<organisation id>` at the version of the legal document `sharing-notice` that was current when the candidate applied (version 0 is the draft placeholder of `supabase/seeds/ref/legal_documents.sql` until legal counsel approves a text).
- `audit.log`: `application.submitted` (entity = the application, metadata `job_id`, `organization_id`, `document_count`; never the note), `share.created` (written by the trigger of the share) and `application.duplicate_attempt` (entity = the existing application, metadata `job_id`).
- The pgmq queue `notifications`: one `application_received` message per accepted member of the employer, with ids only. `notify` and the `notifications` table are FR-I2 (U37); FR-D6 (U38) adds the preference check and the digest.

## 2. Settings (rows of `private.settings`)

| Key | Default | Meaning |
|---|---|---|
| `apply_cover_note_max_chars` | 2000 | longest cover note, after trimming (proposed limit) |
| `apply_documents_max` | 10 | most documents of one application (proposed limit) |
| `apply_rate_limit_max` | 60 | calls per candidate in the window that left an audit row (created applications and duplicate attempts) |
| `apply_rate_limit_window_seconds` | 3600 | the window |

The form reads the first two through `public.apply_limits()`, so the text it shows is the limit the function enforces. Change one with a ticketed `update private.settings set value = '...' where key = '...'`; a missing row makes the call fail with `CHARA_SETTING_MISSING` instead of lifting the limit.

Open owner questions (C17, L8 in OPEN_QUESTIONS.md): direct applications are not capped per month and are open for every country pair, with the general cross-border notice (`CROSS_BORDER_NOTICE` in `apps/web/lib/applications/presentation.ts`). When CHARA decides otherwise, the cap or the corridor rule is added inside `apply_to_job`, where the comment of the AC10 test (`051_apply_to_job_refusals.test.sql`) says it does not exist today.

## 3. KPIs

**Application completion rate** (FR-D1): the share of apply forms opened by a candidate that end in an application. The opens are the lines `{"event":"vacancy_action","action":"apply","jobId":...,"viewer":"candidate"}` on the standard output of the web server (the Apply click-through log of `docs/runbooks/vacancy-page.md`; the apply page writes one when it shows the form), the completions are the audit rows:

```sql
-- Applications created per month (the numerator; the log lines of the month are the denominator)
select date_trunc('month', created_at)::date as month, count(*) as applications
from audit.log where action = 'application.submitted' group by 1 order by 1;
```

A candidate can open the form more than once for one application, so the rate is read as a trend.

**Applications per vacancy** (FR-D1):

```sql
select j.id, j.title, count(a.id) as applications, count(a.id) filter (where a.status <> 'withdrawn') as active
from public.jobs j left join public.job_applications a on a.job_id = j.id
where j.status = 'open' group by j.id, j.title order by applications desc limit 100;
-- Average over the vacancies that were open in a month
select round(avg(n), 1) from (select count(*) as n from public.job_applications
  where created_at >= date_trunc('month', now()) group by job_id) t;
```

**Duplicate attempts per month** (FR-D7):

```sql
select date_trunc('month', created_at)::date as month, count(*) as attempts, count(distinct actor_id) as candidates
from audit.log where action = 'application.duplicate_attempt' group by 1 order by 1;
-- Candidates who tried most in the last 30 days (abuse signal)
select actor_id, count(*) from audit.log
where action = 'application.duplicate_attempt' and created_at > now() - interval '30 days'
group by 1 order by 2 desc limit 20;
```

The queries read the whole of `audit.log`: run them monthly and outside peak hours, or add a period filter once the log is large. The conversion of saved vacancies into applications (FR-C5) is the query of `docs/runbooks/saved-vacancies.md`, which reads `job_applications` from this unit on.

## 4. Controls and how to check them

- Explicit selection and consent: the form has no document ticked and no consent ticked by default; the Server Action refuses an unticked consent before it calls the database. Browser test `apply-to-vacancy.spec.ts` (AC1, AC12); Vitest `application-validation.test.ts`, `applications-action.test.ts`.
- Share scoped by document id: pgTAP `050_apply_to_job_create.test.sql` (AC4) applies, uploads a later CV and asks `document_access_grant` for the selected, the unselected and the later document.
- Atomic transaction: pgTAP `050` (AC3: a document of another candidate, a deleted document and a failing queue write each leave every table and the queue unchanged).
- Duplicate rule: the partial unique index `job_applications_one_active_per_job_worker`, the function that returns the existing application, the UI that shows it; pgTAP `052_apply_to_job_duplicates.test.sql`, browser test `apply-duplicates.spec.ts` (two tabs at once, double click, existing application, Apply again).
- Rate limit: pgTAP `052` (AC8). A refused call writes nothing, so only calls that leave an audit row are counted; a candidate who sends only refused calls is not limited by this rule (they cost nothing to store).
- Atomicity under concurrency: `apply_to_job` locks the candidate's profile row first, so two calls of one candidate run one after the other.

Monthly check that nothing writes around the function (must return 0):

```sql
select count(*) from public.job_applications a
where not exists (select 1 from audit.log l where l.action = 'application.submitted' and l.entity_id = a.id::text);
```

## 5. Erasure

`erase_user` (FR-B6) moves the candidate's applications to the pseudonym of the erasure (every account its own, so two erased candidates of one vacancy do not meet at the unique index), empties `cover_note`, removes `first_name`, `last_name` and `headline` from `profile_snapshot` and moves the events the candidate caused. The rest of the snapshot (skills, languages, country, occupation) stays as the criteria say; if CHARA wants it removed too, change the one `update` in `erase_user`.

## 6. Annual review

1. Run `npm run db:test` and `npm run e2e -w @chara-pinnacle/web -- apply` (and the project `apply-failure`, which runs last in a full `npm run e2e`) and read the result.
2. Read the three KPIs of section 3 for the year and the monthly trend. A rising count of duplicate attempts from few candidates is the abuse signal; the limit of section 2 is the lever.
3. Check that the text of the `sharing-notice` is no longer the placeholder (`select version, title from public.legal_documents where slug = 'sharing-notice'`) and that the consents of new applications carry the approved version.
4. Run the check of section 4 and read the open owner questions C17 and L8.

## 7. Measured

Rolled-back transaction, 110,000 applications of 50,000 candidates for 20,000 vacancies, 110,000 events and 420,000 audit rows (`EXPLAIN (ANALYZE)`): the duplicate check is one index lookup on the unique index (0.04 ms), the hourly call count an index-only scan of the partial audit index (0.03 ms), a page of the candidate's list or the next page one range of `job_applications_worker_created_idx` (0.1 ms), the state of the vacancies of a page under the row policy the same index (0.1 ms), the timeline of an application 0.1 ms, the erasure lookups of a candidate's applications and events 1.3 ms and 0.1 ms, the applicants of a vacancy by status an index-only scan of `job_applications_job_status_idx` (0.06 ms). The apply route sends 132 KB of gzipped JavaScript (React Hook Form and the zod resolver), the same as the search page (133 KB); the application list and page send 25 KB.
