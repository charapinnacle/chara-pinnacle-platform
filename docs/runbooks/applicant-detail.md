# Runbook: applicant detail review

FR-E2, design point D58 (OPEN_QUESTIONS.md). The SOP is "Applicant Detail Review E2E" (owner Employer member, reviewed quarterly). Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them and no job runs them.

## 1. What is stored and read

- `public.job_applications.profile_snapshot`: the profile as submitted, built by `private.profile_snapshot(user)` when `apply_to_job` runs and never changed afterwards (the migration `20261028100000_applicant_detail.sql` moved the expression into that function; `apply_to_job` calls it). The page reads the snapshot with the member policy of `job_applications`; the live profile is never shown.
- `public.application_profile_changed(application)`: true when the live profile differs in content from the snapshot, false when it does not, null when the share has ended (revoked, expired, consent withdrawn, account closing or suspended) and the live profile is not read. It returns nothing else. The completeness percentage and the occupation label (read from the reference data, so a renamed label is no change of the profile) are left out of the comparison; `occupation_id` stays in.
- `public.application_documents(application)`: the documents in the scope of the share while it is valid, never a deleted or rejected one, with id, title, type, file name, size, expiry date and `available` (checked or still being checked). No bucket and no storage path.
- Opening a document: the Open button calls the Server Action `openApplicantDocument`, which sends the member's session token to `document-url` with `purpose = application_review`. The function runs `document_access_grant` as the member and signs a 60-second link with an attachment disposition. `document_access_grant` writes one `audit.document_access_log` row for the candidate (a second request for the same document by the same person within `document_access_repeat_seconds`, 10, adds no row: D44).
- `public.application_notes` (FR-D5) and `public.list_application_notes(application)`: internal notes, newest first, 50 to a page, with the display name of the author. `p_before_id` (the id of the last note of the page before) is the keyset cursor over `application_notes_application_idx`, and `has_more` says that older notes exist; the page links to them with `?notesBefore=<id>`. A note is added by an insert of the member (policy and guard trigger of FR-D5); there is no update or delete.
- `public.application_events`: the history; the page shows it through `list_applicant_events` (FR-D2). The system's move to Viewed has no actor and shows as System.

## 2. Settings

| Key | Default | Meaning |
|---|---|---|
| `rate_limit_document_access_max` | 30 | requests to `document_access_grant` per person in one window |
| `rate_limit_document_access_seconds` | 60 | the window |
| `rate_limit_user_buckets` | 1048576 | number of counter rows per action for per-person counters (see below) |
| `document_access_repeat_seconds` | 10 | a repeat within this time adds no log row (D44) |

Change a setting with a ticketed `update private.settings set value = '...' where key = '...'`. The counters are rows of `private.rate_limit_hits` (action `user:document_access`, a name `public.rate_limit_attempt` cannot reach, so an anonymous caller cannot fill the counter of a known user id), purged every five minutes; the counting is `private.rate_limit_hit`, the same function that serves `rate_limit_attempt`. The bucket is the hash of the user id modulo `rate_limit_user_buckets`: two people in one bucket share the allowance. At about 100000 active members the chance that a given person shares is about 10 %; raise `rate_limit_user_buckets` (a power of two, ahead of the growth) when the member count passes a few hundred thousand. The table stays bounded by actions x buckets rows and is unlogged. A refused request is rolled back with its count, so refusals do not extend the window.

The address of the function is `DOCUMENT_URL_ENDPOINT` (server only); unset, it is `NEXT_PUBLIC_SUPABASE_URL` plus `/functions/v1/document-url`.

## 3. KPI: applicants reviewed within 7 days (%)

An application is reviewed when its first move out of Applied is a move to Viewed, Shortlisted, Interview or Not selected (a withdrawal is no review). An application counts once its 7 days are over. One that the candidate withdrew before any review is left out. An organisation whose writes are refused (lapsed, or on `free_employer` with limits enforced) sets no Viewed and moves no stage, so its applications count as not reviewed.

```sql
select count(*) as applications,
       count(*) filter (where r.reviewed_at <= a.created_at + interval '7 days') as reviewed_within_7_days,
       round(100.0 * count(*) filter (where r.reviewed_at <= a.created_at + interval '7 days') / nullif(count(*), 0), 1) as percent
from public.job_applications a
left join lateral (
  select min(e.created_at) as reviewed_at from public.application_events e
  where e.application_id = a.id and e.from_status = 'applied' and e.to_status <> 'withdrawn'
) r on true
where a.created_at >= date_trunc('month', now()) - interval '1 month'
  and a.created_at < now() - interval '7 days'
  and (r.reviewed_at is not null or a.status <> 'withdrawn');
```

Where the percentage is low, by organisation (worst first):

```sql
select o.display_name, count(*) as applications,
       round(100.0 * count(*) filter (where r.reviewed_at <= a.created_at + interval '7 days') / count(*), 1) as percent
from public.job_applications a
join public.organizations o on o.id = a.organization_id
left join lateral (
  select min(e.created_at) as reviewed_at from public.application_events e
  where e.application_id = a.id and e.from_status = 'applied' and e.to_status <> 'withdrawn'
) r on true
where a.created_at >= date_trunc('month', now()) - interval '1 month'
  and a.created_at < now() - interval '7 days'
  and (r.reviewed_at is not null or a.status <> 'withdrawn')
group by o.display_name order by percent, applications desc limit 20;
```

pgTAP `072_applicant_review_kpi.test.sql` runs the first query as written on written events (2 of 4 reviewed in time: 50 %). Both read whole tables for a month; they are run by hand, quarterly.

## Plans of the reads (measured)

On a rolled-back copy with 605000 notes (one application with 5000), 300000 documents and 100000 shares, after `analyze`: the first page of notes is one index scan of `application_notes_application_idx` (0.15 ms, 6 buffers); a page 2000 notes deep is the same index with the row comparison as index condition plus one primary-key probe for the cursor (0.4 ms); the document list is one probe of `passport_shares_pkey` and one scan of `worker_documents_owner_created_idx` with the scope ids as the condition (0.24 ms). No sequential scan.

## 4. Controls and how to check them

- Brokered links, access log, 60 seconds: pgTAP `032` and `033` (every refusal), `071_document_access_rate_limit.test.sql` (the allowance), Deno `document-url.test.ts` (the statuses, 429 included), browser tests `privacy-by-default.spec.ts` (the link lives 60 seconds and is dead at 61) and `applicant-detail.spec.ts` (the page: no path in the HTML, a download, the claims of the link, the log row, a refusal as a toast).
- The lists and the check expose nothing beyond a valid share: pgTAP `070_applicant_detail_reads.test.sql`, and the allow-list of `035_privacy_catalogue.test.sql`, which fails when a new function that reads candidate data is open to an API role.
- A decline needs a reason: the form and the Server Action require it (Vitest `applicant-validation`, `applicants-action`); `set_application_status` itself accepts a decline without a note, so a direct caller of the function can decline without one. This is a control of the interface only.
- Org-only notes: pgTAP `065_application_notes.test.sql` (policies, append-only, plan rules) and `070` (the list, the plan rules with limits enforced); browser test `applicant-detail.spec.ts` (the candidate's page shows no note).
- Access guards of the page: browser test `applicant-detail.spec.ts` (visitor, outsider, platform administrator, candidate, owner without two-step verification) and `application-viewed.spec.ts`.

## 5. Quarterly review

1. Run `npm run db:test` and `npm run e2e -w @chara-pinnacle/web -- applicant-detail` and read the result.
2. Read the KPI of section 3 for the quarter. A low percentage points at employers who do not open their applicants; the digest email (FR-I3) and the highlighting of new applicants (FR-E1) are the levers.
3. Read the document access log for the quarter by organisation (`audit.document_access_log`, `purpose = 'application_review'`) and the Postgres log lines `CHARA_CROSS_TENANT` (`docs/runbooks/application-visibility.md`): an organisation that opens far more documents than it has applications is a question for trust and safety.
