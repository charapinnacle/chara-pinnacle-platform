# Runbook: application status pipeline

FR-D2, design point D53 (OPEN_QUESTIONS.md). The SOP is "Application Status Pipeline E2E" (owner Employer member / Candidate, reviewed semi-annually). Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them and no staff role can read an application through the application.

## 1. What is stored

- `public.job_applications.status`: the eight states of the enum `application_status` (`rejected` is "Not selected" on every screen). Nobody writes it through the API; the trigger `applications_guard_transition` judges every change and the functions `set_application_status`, `bulk_set_application_status` and `mark_application_viewed` are the writers (the candidate's `withdraw_application` joins them with FR-D4).
- `public.application_events`: one row per change, appended by `private.move_application` only: `from_status`, `to_status`, `actor_id` (the employer member; null for the system's Viewed move), `note` (the note the candidate sees) and `created_at`. The history cannot be edited or deleted, by anyone.
- `public.passport_shares.expires_at`: set to the time of the move plus `share_expiry_days_after_final` days when an application becomes Hired or Not selected; the share is not revoked, `document_access_grant` refuses it once the time has passed.
- `audit.log`: `application.status_changed` (entity = the application, metadata `organization_id`, `from`, `to`; never a note) for every move, Viewed included, and `application.bulk_status_changed` (metadata `organization_id`, `to`, `requested`, `applied`, `ids`; never a note) once per bulk call and per organisation of the applied items, the ids being those applied in that organisation; a call that applied nothing is one row with a null `organization_id` and no ids.
- The pgmq queue `notifications`: one `status_changed` message per move except to Viewed: `{kind, user_id (the candidate), application_id, job_id, status, mandatory: true}`, ids and the new state only, never a note. `notify` (FR-I2, U37) sends the email; until then the messages wait in the queue.

## 2. Settings and the open owner points

| Key | Default | Meaning |
|---|---|---|
| `application_status_note_max_chars` | 1000 | longest note of a stage change, after trimming (proposed limit); the form quotes it through `get_applicant`; a missing row fails the call with `CHARA_SETTING_MISSING` |
| `share_expiry_days_after_final` | 30 | days a share lives after Hired or Not selected (P13, to be confirmed by CHARA); a missing row fails the move with `CHARA_SETTING_MISSING` instead of leaving the share open |
| `entitlements_enforced` | false | with true, an organisation on `free_employer` is read-only for status changes (C11); a lapsed organisation is read-only whatever this says |

Change a setting with a ticketed `update private.settings set value = '...' where key = '...'`. Open points and what changes if CHARA answers differently: P17 (moving back from Shortlisted) is one line in `private.application_transition_allowed`, one in `apps/web/lib/applications/stage-machine.ts` and their tests; C16 (shortlisting in every paid plan) is data in `billing.plan_features`; P14 (undo window for declines) would need a new function, nothing here prepares one.

## 3. KPIs

**Time in each stage** (SOP KPI): the time between an event and the next event of the same application is the time spent in the stage the first one entered. An application still in a stage has no end yet and is left out; the first event, `null -> applied`, starts the clock.

```sql
select stage, count(*) as moves, round(avg(extract(epoch from (next_at - created_at)) / 3600)::numeric, 1) as avg_hours
from (
  select x.to_status as stage, x.created_at,
         lead(x.created_at) over (partition by x.application_id order by x.created_at, x.id) as next_at
  from public.application_events x
  where x.created_at >= date_trunc('month', now()) - interval '1 month'
) e
where next_at is not null
group by stage order by stage;
```

**Applications left in Applied for more than 14 days** (SOP KPI):

```sql
select count(*) from public.job_applications where status = 'applied' and created_at < now() - interval '14 days';
-- Where they are, by organisation
select o.display_name, count(*) as waiting
from public.job_applications a join public.organizations o on o.id = a.organization_id
where a.status = 'applied' and a.created_at < now() - interval '14 days'
group by o.display_name order by waiting desc limit 20;
```

pgTAP `059_application_status_kpis.test.sql` runs the statements of this section as written (time in each stage, both queries above and the silent-changes query below) on written events. They read whole tables or, for the applications left in Applied, the partial index `job_applications_applied_created_idx`, and are run monthly by staff, not on a page.

**Silent changes** (SOP risk; must return 0): an application whose status has no event naming it.

```sql
select count(*) from public.job_applications a
where a.status <> 'applied'
  and not exists (select 1 from public.application_events e where e.application_id = a.id and e.to_status = a.status);
```

## 4. Controls and how to check them

- Transition guard: pgTAP `054_application_status_transitions.test.sql` (all 64 pairs through the single and the bulk function, Viewed by the system only, the trigger against the database owner). Vitest `stage-machine.test.ts` pins what the page offers to the same table.
- Who may change a status, the plan gates and the lapsed and suspended organisations: pgTAP `055_application_status_access.test.sql`; browser tests `application-viewed.spec.ts` (outsider, candidate, visitor, owner without two-step verification, lapsed and suspended organisations).
- Notes, append-only events, one transaction, share expiry: pgTAP `056_application_status_effects.test.sql`.
- Bulk moves, per item: pgTAP `057_bulk_set_application_status.test.sql`.
- The applicant reads: pgTAP `058_applicant_stage_reads.test.sql`.
- Concurrent changes and the confirmation: browser tests `application-status.spec.ts` (two members at once, a stale move, the keyboard path and the candidate's view of the note, accessibility at 1280 and 360 px).
- Notifications: the queue message is asserted in pgTAP 056 and in the browser tests; the email itself is U37 and U38.

## 5. Hand-offs

- U29 (journey tracker) replaced the timeline of `/applications/[id]` by `v_my_application_timeline` and added the next-step texts (`docs/runbooks/journey-tracker.md`); the note is shown there as `Message from the employer`.
- U30 (withdraw) consumes the `candidate` branch of `allowedTargets` in `apps/web/lib/applications/stage-machine.ts` (FR-D2 AC11 names the role parameter; nothing calls it before U30, so it is not dead code); it writes `chara.actor_fn = 'withdraw_application'` around its update (the guard already lists that function), revokes the share and must not call `assert_org_writable`.
- U31 adds the employer read policies of the two tables and `application_notes`; U32 to U35 call `set_application_status` and `bulk_set_application_status` from the list and the board and link to the applicant page; U33 reuses `mark_application_viewed` as `open_application` and reconciles its AC3 (the actor of the Viewed event is null here); U34 adds the selection, the confirmation step and the reason templates in front of `bulk_set_application_status`.
- U37 and U38: `notify` reads the `status_changed` messages above.

## 6. Semi-annual review

1. Run `npm run db:test` and `npm run e2e -w @chara-pinnacle/web -- application-status application-viewed` and read the result.
2. Read the two KPIs of section 3 for the half year. A rising number left in Applied points at employers who do not open their applicants; the digest email (FR-I3) and the highlighting of new applicants (FR-E1) are the levers.
3. Run the silent-changes check of section 3 (must be 0).
4. Read the open owner points P13, P14, P17, C11 and C16 and whether CHARA has answered them.

## 7. Measured

Rolled-back transaction, 108,000 applications of 18,000 vacancies in 3,000 organisations and 216,000 events (`EXPLAIN (ANALYZE)`): the lookup and lock of one application for a member (`job_applications_pkey`, then the membership check of `private.member_org_ids`) takes 0.6 ms, the history of one application (`application_events_application_idx`, index only) 0.3 ms; the share expiry is an update through the unique index `passport_shares_application_key`. The KPI queries of section 3: 220 ms for the time in each stage over a month of events (it reads the events of the window), run by staff monthly and not on any page; the applications left in Applied read the partial index `job_applications_applied_created_idx` (an index-only scan, checked with `EXPLAIN` on the migrated database; the 54 ms of the earlier sequential scan at 108,000 applications is gone). A bulk call of 100 applications (100 subtransactions, each with an update, an event, an audit row and a queue message) takes 79 ms in a rolled-back transaction on the local stack; 100 is more than the 64 subtransaction ids a backend caches, so a reader that overlaps the call consults `pg_subtrans` for those 79 ms and the row locks are held until the call ends, which FR-E3 AC10 (100 per call) and the per-item isolation of FR-D2 AC9 accept. First-load JavaScript, gzipped chunk by chunk from `.next/diagnostics/route-bundle-stats.json` after `npm run build` (a different method from the figures of earlier units, so compare the routes with each other only): the applicant page 154 KB, the candidate's applications page 153 KB, the apply page 260 KB; the stage form (React Hook Form, the resolver and the schema) is fetched when the dialog first opens.
