# Runbook: application visibility

FR-D5, design point D56 (OPEN_QUESTIONS.md). The SOP is "Application Visibility Control E2E" (owner Platform, reviewed quarterly). Queries are run by CHARA staff as the database owner (SQL editor of the project).

## 1. The rule and where it is enforced

- A candidate reads the own applications and their events (`job_applications_select_worker`, `application_events_select_worker`).
- An accepted member of an active organisation (owner, admin or member) reads the applications and events of its vacancies (`job_applications_select_member`, `application_events_select_member`) and the internal notes (`application_notes_select_member`) and adds notes (`application_notes_insert_member`); the organisations come from `private.active_member_org_ids()`. A removed member and an invitation that is not accepted read nothing from the next query on: the policies look the membership up in `organization_members`, not in the token.
- Nobody else reads any of the three tables: not another candidate, not another organisation, not the three platform roles, not `service_role` (no grant), not an anonymous session (no grant). No API role writes to `job_applications` or `application_events`; only the RPCs do. A note is the one direct insert and is append-only.
- The candidate never reads a note: `application_notes` has no candidate policy, and the candidate's timeline (`v_my_application_timeline`) and list (`my_applications`) are built from the events and the application only.
- Past applicants of a lapsed organisation stay readable (C11); adding a note or changing a stage is refused with `CHARA_FEATURE_NOT_IN_PLAN` (`read_only_free_plan`). A suspended organisation: its members read no row of the three tables and `get_applicant` and `list_applicant_events` return no row; the page shows 'This organization is suspended, so its applicants are not available.', and note inserts and stage changes are refused (`CHARA_FORBIDDEN`, `organization_suspended`); its candidates keep reading their own applications.
- The notes of a candidate who is erased (FR-B6) are deleted by `erase_user`; the other notes of the organisation stay.
- Owners and admins reach the applicant pages only at aal2 (`requireOrgRole`, FR-A4 AC3); the policies do not test aal2 (D8).

## 2. The log of attempts across organisations

`set_application_status` (and each item of `bulk_set_application_status`), `mark_application_viewed`, `withdraw_application`, `get_applicant`, `list_applicant_events`, `application_documents`, `application_profile_changed` and `list_application_notes` write one line to the Postgres log when the caller asks for an application that exists and is neither the caller's own nor one of the caller's organisations:

```
LOG:  CHARA_CROSS_TENANT caller=<user id> function=<name> application=<application id>
```

The line has ids only. The call itself answers `CHARA_NOT_FOUND` (or no row), the very answer for an unknown id, and a guessed id that does not exist leaves no line. Bulk items are logged under `set_application_status`. A `RAISE LOG` line stays when the failing call rolls back; a table row would not, which is why the log is used and not `audit.log`.

Where to read it: Supabase Studio, Logs, Postgres logs of the project, filter `CHARA_CROSS_TENANT`; locally `docker logs supabase_db_chara-pinnacle 2>&1 | grep CHARA_CROSS_TENANT`. Quarterly: read the lines of the quarter. One caller with several lines, or many callers on one application, is worth a look (a guessed link shared in a team, or a probe); the application's organisation is `select organization_id from public.job_applications where id = '<application id>'`.

## 3. KPI

**Policy tests passing (100 %)** (SOP KPI): measured on every build by the `db` job of CI (`npm run db:test`, the TAP summary `Result: PASS` and `Tests=<n>` with no `Failed`), and by the job `e2e` for the page rules. The tests that carry the visibility rule are `064_application_visibility_reads`, `065_application_notes`, `066_application_visibility_refusals` and the per-table access tests that came before (`053`, `055`, `058`, `060`, `062`). The quarterly figure is the share of the builds of the quarter in which these files passed; a failing build is a failed gate, so the expected value is 100 %.

## 4. Risk and controls

Risk: cross-tenant exposure. Controls: row-level security (forced on the three tables), the negative tests, and the catalogue check below. Quarterly check (all must return the stated result):

```sql
-- Forced RLS and at least one policy on each of the three tables: 3 rows, all true
select c.relname, c.relrowsecurity and c.relforcerowsecurity as forced,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c where c.oid in ('public.job_applications'::regclass, 'public.application_events'::regclass, 'public.application_notes'::regclass);
-- No privilege for anon or service_role, and for authenticated only select (and insert on the notes): 0 rows
select r, t, p from unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['public.job_applications', 'public.application_events', 'public.application_notes']) t,
  unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
where ((p in ('select', 'insert', 'update', 'references') and has_any_column_privilege(r, t::regclass, p))
    or (p in ('delete', 'truncate', 'trigger') and has_table_privilege(r, t::regclass, p)))
  and not (r = 'authenticated' and p = 'select')
  and not (r = 'authenticated' and t = 'public.application_notes' and p = 'insert');
```

- Candidates and members, the other organisation, removal, pending invitation, staff, anonymous, `service_role`, lapsed and suspended organisation: pgTAP `064_application_visibility_reads.test.sql`.
- Direct writes, notes (visibility, author, organisation, size, append-only, lapsed and suspended organisation): pgTAP `065_application_notes.test.sql`.
- The RPCs against an application of another organisation, the policy names, the indexes: pgTAP `066_application_visibility_refusals.test.sql`.
- The pages (404 for another organisation's application, two-step verification, suspended organisation) and the log line: browser tests `application-visibility.spec.ts`, `application-viewed.spec.ts`. Vitest `applicant-page.test.ts` and `require-org-role.test.ts` pin the page decisions.

## 5. Quarterly review

1. Run `npm run db:test` and `npm run e2e -w @chara-pinnacle/web -- application-visibility application-viewed` and read the result.
2. Run the two catalogue queries of section 4.
3. Read the `CHARA_CROSS_TENANT` lines of the quarter (section 2).
