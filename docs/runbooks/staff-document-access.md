# Runbook: no document access for platform staff

FR-F3, ADR-0006, design point D68 (OPEN_QUESTIONS.md). Nothing to deploy beyond the migration `20261103100000_audit_search_without_documents.sql`; the rest of the restriction was built with FR-B2, FR-B3, FR-B5 and FR-F1 and is now tested.

## 1. What holds the restriction

| Layer | Rule | Test |
|---|---|---|
| Tables | `worker_documents`, `passport_shares` and `audit.document_access_log` have only owner policies for `authenticated`; `anon` and `service_role` have no grant | pgTAP 085 (AC1, AC3, AC4) |
| Storage | the bucket `passport-documents` has the three owner policies and none for staff | pgTAP 086 (AC2) |
| Access function | `document_access_grant` refuses a caller who is not the owner or a member of an organisation with an active share, whatever the staff role | pgTAP 085 (AC3), Playwright (AC7) |
| Catalogue | no policy and no function behind a staff check touches documents or returns a column that describes one | pgTAP 087 (AC5, AC6) |
| Console | the pages show no document, file name or count; the audit search leaves out the document events; the source holds no document code | Playwright (AC8), pgTAP 088, Vitest (AC9) |

## 2. KPI: policy tests passing (100 %)

The `db` job of CI runs `npm run db:test` on every pull request; the KPI is the share of runs of that job on `main` that passed, read from the job history. A red run is a stop for merging, not a ticket.

## 3. The audit search

`admin_search_audit` leaves out the entity types in the setting `admin_audit_hidden_entity_types` (`worker_documents`, `passport_shares`). The events stay in `audit.log` and in the monthly export; a person with database access reads them there. To list them in the console (which needs the exception process of ADR-0006) a migration changes the setting.

## 4. Annual review (operational, not built)

Once a year the Platform Administrator and the data protection contact read ADR-0006, run `npm run db:test`, and confirm that the list of eight policies in pgTAP 087 is still the list of `pg_policies` for the four relations, that no staff role was given a document path by a decision record that has since lapsed, and whether the open point in section 5 changed. The result is written in the review log of CHARA.

## 5. Open with the owner

Whether Trust and Safety must inspect reported documents at launch (FR-F3, to be confirmed by CHARA). Default: no. Phase 1 has no report flow; a decision to inspect starts the exception process of ADR-0006 and is a change to the console, the access function and these tests together.

## 6. Proving that the tests fail

The regression guard (AC10) was checked by hand against the database of this unit: a policy `for select to authenticated using (private.has_platform_role('trust_safety'))` on `public.worker_documents` fails pgTAP 085 (AC1) and 087 (AC5), and a function behind `private.assert_staff` that counts `worker_documents` fails 087 (AC6). To repeat it, run the test file in `psql` after `begin;` and `create extension if not exists pgtap with schema extensions; set search_path to public, extensions;` and the statement of the case; the `rollback;` at the end of the file removes it.
