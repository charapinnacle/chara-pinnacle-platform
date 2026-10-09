# ADR-0006: Platform staff have no access to candidate documents

- Status: Accepted
- Date: 2026-11-03

## Context

FR-F3 says that no platform staff role (Platform Administrator, Verification Reviewer, Trust and Safety Administrator) has a function to open or download candidate documents in Phase 1, and that reports are handled without document access. The risk in the SOP is insider access: a person with an administrative account reading CVs and certificates.

Whether Trust and Safety must inspect reported documents at launch is to be confirmed by CHARA (OPEN_QUESTIONS.md P10; the design point of the tests is D69). Phase 1 has no reports, so the default is that nobody inspects them.

## Decision

1. No policy, function, storage rule or page gives a staff role a path to `public.worker_documents`, `public.passport_shares`, the `passport-documents` bucket or `audit.document_access_log`. The owner policies of these tables and of the bucket test only the user id of the token; an organisation member gets a document only through `document_access_grant`, as a member of the organisation that holds a share, and a staff member who is also a member is treated as a member.
2. No administrative function (a function behind `private.assert_staff`, `private.assert_platform_admin` or `private.has_platform_role`, or any function it calls) references these tables or returns a column that describes a document. The audit search of the console leaves out the events of documents and shares (setting `admin_audit_hidden_entity_types`), so the console shows no list and no count of documents; the rows stay in `audit.log` and in the monthly export. A function that records an event of a document or a share under a new entity type fails pgTAP 088 until the type is added to the setting.
3. The restriction is tested on every build: `supabase/tests/database/085` to `088` (policies, grants, the access function, storage, the catalogue of policies and staff functions), `apps/web/tests/unit/admin-no-document-access.test.ts` (the source of the console) and `apps/web/tests/e2e/staff-document-denial.spec.ts` (document-url, the Storage API and every page of the console). The `db` job of CI is part of every pull request.

## Exception process

Any future need for a staff role to see a candidate document is merged only with all three of these, which the pull request template lists:

1. a decision record in `docs/adr` that names the need and the role;
2. a named legal basis;
3. candidate-visible logging: every access writes `audit.document_access_log` with the accessor, and the candidate sees it in `v_my_document_access_log`.

The same change replaces the tests above on purpose, in the same pull request; a change that makes them pass by weakening them is refused in review. `supabase/` has its own entry in `.github/CODEOWNERS` (FR-F3 AC11), so its owners can be narrowed without touching the default entry; today both entries name the same owners.

## Consequences

- A Trust and Safety decision about a reported document needs the candidate's own account of it or a new decision under the exception process; Phase 1 has no report flow, so no workflow depends on it.
- The tests read the catalogue, so a new policy on the document tables or a new staff-gated function that touches them fails the build until the decision is recorded.
- Branch protection that makes the `db` job required is a setting of the repository owner (OPEN_QUESTIONS.md W3), not a file.
