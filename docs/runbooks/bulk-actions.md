# Runbook: bulk applicant actions

FR-E3, design point D59 (OPEN_QUESTIONS.md). The SOP is "Bulk Applicant Actions E2E" (owner Employer member, reviewed annually). Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them.

## 1. What is stored and read

- Nothing new is stored. A bulk change is `public.bulk_set_application_status(ids, target, note)` (FR-D2, migration `20261023100100`): every application goes through the same guard as one change, in its own subtransaction, so each has its own event (`application_events`: from, to, actor, note), its own audit row `application.status_changed` and its own `status_changed` queue message (ids and the new stage only, never the note). A refused item leaves no row.
- `audit.log`, action `application.bulk_status_changed`: one row per call and per organisation of the applied items, with `organization_id`, `to`, `requested` (distinct ids sent), `applied` and `ids`; never the note. A call refused as a whole (lapsed or restricted organisation, bad input) writes none.
- The reason of a decline is the note of its event, which the candidate reads in the journey tracker under "Message from the employer". The wording of the two templates (`position_filled`, `qualifications_not_matching`) is a constant of the application, `declineReasonOptions` in `apps/web/lib/validation/applicant.ts`, shared with the single change; it is reviewed with legal like all text the candidate reads.
- The page: `/[lang]/org/[slug]/applicants` (list and board). The boxes and the toolbar appear for a member of an organisation whose stage changes are not blocked; the choice is held in the browser only until the page is left. Review opens the confirmation (every applicant with the stage they are in, the target, the text under "Visible to the candidate", the warning that a decline is final); only Confirm calls the Server Action `bulkChangeApplicantStage`, which checks the role of the address (owners and admins at aal2), parses 1 to 100 ids, a target an employer may choose and the reason, and returns the summary. A refused applicant is reported with the stage they are in now ("Not allowed from Applied") and stays selected.

## 2. Settings and the open owner points

| Key | Default | Meaning |
|---|---|---|
| `application_status_note_max_chars` | 1000 | longest note, quoted by the form through `get_applicant_access` |
| `share_expiry_days_after_final` | 30 | days a share lives after Hired or Not selected (P13) |
| `entitlements_enforced` | false | with true, an organisation on `free_employer` is read-only for stage changes, bulk changes included (C11) |

The limit of 100 applicants per call is the constant `BULK_MAX` in the validation module and `v_max` in the function. Open points: P14 (an undo window for declines) would need a new function, nothing here prepares one; C11 (what `free_employer` contains) is data in `billing`; P13 is the setting above.

## 3. KPI: bulk actions per month

```sql
select to_char(date_trunc('month', l.created_at), 'YYYY-MM') as month,
       count(*) as bulk_actions,
       sum((l.metadata ->> 'applied')::integer) as applications_changed
from audit.log l
where l.action = 'application.bulk_status_changed'
group by 1 order by 1 desc;
```

A call that applied nothing counts as an action (its `applied` is 0). By organisation: add `l.metadata ->> 'organization_id'` to the grouping. The query reads the index `log_action_created_at_idx`; it is run by hand, monthly. pgTAP `073_bulk_actions.test.sql` runs it on written audit rows.

## 4. Controls and how to check them

- Confirmation step: nothing is sent before Confirm. Playwright `bulk-actions.spec.ts` (AC1, AC2).
- Per-item guard and no undo: a final application is refused with `CHARA_INVALID_TRANSITION`; pgTAP 054, 057, 073; Playwright AC4, AC5.
- Whole-call refusal for a lapsed or restricted organisation: pgTAP 055, 057, 073.
- Mass mistakes after the fact: the events list who moved which application and when (`application_events.actor_id`); the audit row ties the ids of one call together. To find the applications of one call: `select l.metadata -> 'ids' from audit.log l where l.action = 'application.bulk_status_changed' and l.id = <id>`.

## 5. Reads added by the page

The summary reads `id, status` of the refused items only, from `v_job_applicants` with `id = any(...)` (at most 100): a bitmap scan on `job_applications_pkey`, 0.9 ms on 50,000 applications (rolled-back transaction, `EXPLAIN ANALYZE`, as the database owner; the member policy adds the organisation lookup that the list reads already use).
