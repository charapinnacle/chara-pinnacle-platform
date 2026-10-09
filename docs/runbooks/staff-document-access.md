# Runbook: no document access for platform staff

FR-F3, ADR-0006 (the rule, the layers and the exception process), design point D68 (OPEN_QUESTIONS.md). The restriction is tested by pgTAP 085 to 088, the Vitest file `admin-no-document-access` and the Playwright spec `staff-document-denial`. Nothing to deploy beyond the migration `20261103100000_audit_search_without_documents.sql`; the rest of the restriction was built with FR-B2, FR-B3, FR-B5 and FR-F1.

## 1. KPI: policy tests passing (100 %)

The `db` job of CI runs `npm run db:test` on every pull request; the KPI is the share of runs of that job on `main` that passed, read with `gh run list --workflow ci.yml --branch main --json conclusion,name` (the conclusion of the `db` job; the same list is in the Actions tab). A red run is a stop for merging, not a ticket.

## 2. The audit search

`admin_search_audit` leaves out the entity types in the setting `admin_audit_hidden_entity_types` (`worker_documents`, `passport_shares`). The events stay in `audit.log` and in the monthly export; a person with database access reads them there. To list them in the console (which needs the exception process of ADR-0006) a migration changes the setting. A new audit event of a document or a share under a new entity type must be added to the setting (pgTAP 088 fails until it is).

## 3. Annual review (operational, not built)

Once a year the Platform Administrator and the data protection contact read ADR-0006, run `npm run db:test`, and confirm that the list of eight policies in pgTAP 087 is still the list of `pg_policies` for the four relations, that no staff role was given a document path by a decision record that has since lapsed, and whether the open point in section 4 changed. The result is written in the review log of CHARA.

## 4. Open with the owner

Whether Trust and Safety must inspect reported documents at launch (FR-F3, OPEN_QUESTIONS.md P10, to be confirmed by CHARA). Default: no. Phase 1 has no report flow; a decision to inspect starts the exception process of ADR-0006 and is a change to the console, the access function and these tests together.
