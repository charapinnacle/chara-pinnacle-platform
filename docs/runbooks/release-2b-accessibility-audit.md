# Runbook: manual accessibility audit of the release 2b pages

NFR-U3 (WCAG 2.2 AA on all partner, network and messaging pages), V79. Every page of release 2b (the hiring network: workforce requirements, job orders, invitations, responses, decisions, candidate submissions and their pipeline, Find Employers, the network blocks of the dashboards, the moderation of job orders) passes the automated axe checks in CI (serious and critical violations, at 360 and 1280 px, with no horizontal scrolling at 360 px); axe finds about a third of the WCAG failures, so a person audits each page by hand before release 2b goes live, as for release 2a (`release-2a-accessibility-audit.md`). **The audit is operational**: it is done by a person on staging, with releases 2a and 2b and candidate submissions switched on there, and its result is recorded in the release record (date, auditor, browser and assistive technology with versions, each finding with its page, criterion, severity and ticket). A finding at level A or AA that blocks a task (posting or publishing a requirement, inviting, answering an invitation, responding, comparing and deciding, submitting a candidate, approving or withdrawing a submission, changing a stage, reporting a job order) stops the go-live of release 2b; any other finding is a ticket with an owner and a date.

## 1. How to audit a page

Use the five checks of `release-2a-accessibility-audit.md` section 1 (K keyboard, S screen reader, Z zoom and reflow, C contrast and colour, F focus, input and targets), with the same browsers and assistive technologies, on each page of section 3 in every state its row names. For release 2b also check, on every page that shows the state of an item (NFR-U4), that the status is read as text (not told by colour alone) and that the next action is written next to it and reached in reading order right after it.

## 2. Automated coverage that already exists

CI runs axe through `expectAccessibleAtBothWidths` (360 and 1280 px, plus the horizontal scroll check) or `expectNoAxeViolations` in the spec of each page below, with releases 2a and 2b switched on. `accessibility-sweep.spec.ts` sweeps every page with the releases off and names the release 2b pages it leaves to their own specs (its list `releasedPages`). The two journeys of release 2b (`release-2b-journey.spec.ts`, NFR-O4) run axe at both widths on the requirement form and page, the invitation, the response form and page, the employer's response, the submission form and lists, the candidate's submission and the pipeline, and assert the status and the next action of each (NFR-U4). K in the last column: the spec also walks the flow, or part of it, by keyboard. None of this replaces sections 1 and 3.

## 3. The pages of release 2b

"Who" is the role that opens the page; "States" the states to audit by hand; "Axe in CI" the spec that checks the page with release 2b on.

### Employer pages

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/org/[slug]/requirements` | employer owner, admin, member | empty, list with each status, usage of the open-requirements limit | `workforce-requirements.spec.ts`, `requirement-limits.spec.ts` |
| `/[lang]/org/[slug]/requirements/new`, `/requirements/[id]/edit` | owner, admin at aal2 | field errors and the error summary, refused wording at the skills field, occupation rows added and removed, total of workers, second destination locked by plan, draft restored from the session | `workforce-requirements.spec.ts` (K), `requirement-limits.spec.ts`, `release-2b-journey.spec.ts` |
| `/[lang]/org/[slug]/requirements/[id]` | owner, admin, member | draft, open, paused, closed, filled (status notice and its actions), Publish and Close dialogs with errors, limit prompt, change history, capacity tolerance, invitations, responses, selected partner, submitted candidates, vacancies copied | `workforce-requirements.spec.ts` (K), `requirement-changes.spec.ts`, `requirement-vacancies.spec.ts`, `release-2b-journey.spec.ts` |
| `/[lang]/org/[slug]/requirements/[id]/partners` (suggestions) | owner, admin, member | cards with facts and criteria, Invite selected with the bar, limit prompt, member without checkboxes, draft preview | `partner-suggestions.spec.ts`, `invitations.spec.ts` |
| `/[lang]/partners/[slug]` Invite dialog | employer owner, admin | one and several requirements, already invited, limit prompt | `invitations.spec.ts`, `release-2b-journey.spec.ts` |
| `/[lang]/org/[slug]/requirements/[id]/invitations` | owner, admin, member | each status and the counter, withdraw confirmation, empty with a link to partners | `invitations.spec.ts` |
| `/[lang]/org/[slug]/requirements/[id]/responses`, `/responses/[responseId]` | owner, admin, member | Received, Updated badge with the history, withdrawn with its reason, decided, documents | `partner-responses.spec.ts`, `response-decisions.spec.ts`, `release-2b-journey.spec.ts` |
| `/[lang]/org/[slug]/requirements/[id]/responses/compare` | owner, admin, member | several columns (the table scrolls in its own container at 360 px), one column, empty, failed with a retry, Select, Shortlist and Decline dialogs with the note and its error, focus after a decision | `response-decisions.spec.ts` (K), `release-2b-journey.spec.ts` |
| `/[lang]/org/[slug]/applicants?requirement=` (pipeline, list and board) | owner, admin, member | list, board columns, empty, filter without a match, failed with a retry, bulk move and decline dialogs | `submission-pipeline.spec.ts`, `release-2b-journey.spec.ts` |
| `/[lang]/org/[slug]/applicants/submissions/[id]` | owner, admin, member | first open (Viewed), stage change dialog (Review, Confirm), final stage notice, internal notes, documents, blocked stage change on an ended plan | `submission-pipeline.spec.ts`, `release-2b-journey.spec.ts` |
| `/[lang]/dashboard/employer` network blocks, `/[lang]/org/[slug]/analytics` | owner, admin, member | figures, empty, hidden below the threshold, failed | `employer-network-dashboard.spec.ts`, `network-analytics.spec.ts` |

### Partner pages

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/org/[slug]/job-orders` (board) | partner owner, admin, member | full and reduced cards, Company not named, filters in the address, ignored filters alert, empty and no match, next page, failed with a retry, not listed, suspended | `job-orders.spec.ts` (K at 360 px), `job-order-anonymity.spec.ts` |
| `/[lang]/org/[slug]/job-orders/[id]` | the same | full, reduced (Only the title is shown), named, no longer open, eligibility panel with each missing condition and the upgrade prompt | `job-orders.spec.ts`, `partner-responses.spec.ts`, `commitment-reconsent.spec.ts` |
| `/[lang]/org/[slug]/job-orders/[id]/respond`, `/invitations/[id]/respond`, `/responses/[id]/edit` | owner, admin, member | field errors and the summary, documents being checked, ready, refused (sixth file, size, type), capacity above the tolerance, stale change | `partner-responses.spec.ts` (K), `release-2b-journey.spec.ts` |
| `/[lang]/org/[slug]/invitations`, `/invitations/[id]` | owner, admin, member | New, Not answered, Accepted, Declined with the reason, Responded, Withdrawn, Expired; status filter; Accept and Decline dialogs; changes since the invitation | `invitations.spec.ts` (K), `requirement-changes.spec.ts`, `release-2b-journey.spec.ts` |
| `/[lang]/org/[slug]/responses`, `/responses/[id]` | owner, admin, member | Sent, Changed, Withdrawn, Shortlisted, Selected (Submit a candidate), Declined with the note, versions, moderation notice | `partner-responses.spec.ts`, `response-decisions.spec.ts`, `release-2b-journey.spec.ts` |
| `/[lang]/org/[slug]/requirements/[id]/submissions`, `/submissions/new`, `/[lang]/org/[slug]/submissions` | owner, admin, member | empty, each status with its next step and the stages, field errors, at the monthly limit (disabled with its description), outdated commitment | `candidate-submissions.spec.ts`, `commitment-reconsent.spec.ts`, `release-2b-journey.spec.ts` |
| `/[lang]/org/[slug]/find-employers` | owner, admin, member | company and anonymous job order cards, locked advanced filters, saved searches, empty and no match, refused (free plan, not listed), failed | `find-employers.spec.ts`, `job-order-anonymity.spec.ts` |
| `/[lang]/dashboard/recruitment`, `/[lang]/dashboard/staffing` release 2b blocks | owner, admin, member | figures, empty, outdated commitment | `partner-dashboards-job-orders.spec.ts`, `commitment-reconsent.spec.ts` |
| `/[lang]/settings/notifications` (New job orders that fit) | partner owner, member | switch on and off, saved | `job-orders.spec.ts` |

### Candidate pages

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/submissions`, `/submissions/[id]` | worker | waiting for an answer, approve with documents and the consent (error when unchecked), declined, submitted by another partner (Decline only), each stage with its next step, withdraw confirmation, fee demand report link | `candidate-submissions.spec.ts`, `release-2b-journey.spec.ts` |
| `/[lang]/applications` with proposed submissions (journey tracker) | worker | Proposed by, timeline, withdraw | `submission-pipeline.spec.ts` |

### Public pages and console

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/job-orders`, `/[lang]/companies` | visitor, partner member, other signed-in users | explanation, partner led to its board, several partners to choose from | `job-orders.spec.ts`, `find-employers.spec.ts` |
| `/[lang]/companies/[slug]` with named job orders | visitor | with and without job orders | `job-order-company-page.spec.ts` |
| `/[lang]/legal/ranking` with the release 2b sections | visitor | partner suggestions, job orders, Find Employers | `ranking-transparency.spec.ts` |
| `/[lang]/report` for a requirement, a response and a submission | partner, employer, worker | errors, confirmation | `moderation-job-orders.spec.ts` |
| `/[lang]/admin/reports`, `/admin/reports/[id]` with job order targets, `/[lang]/appeals` for them | Trust & Safety, organisation members | hide dialog with the statement of reasons, appeal | `moderation-job-orders.spec.ts` |
| `/[lang]/admin/statistics` job order metrics, `/[lang]/admin/retention` new periods | Platform Administrator | figures, hidden below the threshold | `admin-network-statistics.spec.ts`, `admin-retention.spec.ts` |

## 4. Known items to check first

- **The comparison table** (`/responses/compare`) is the one wide table outside the console: at 320 CSS px it scrolls inside its own container, so check that the container is reachable and scrollable by keyboard, that its caption and the row headers are read with each cell, and that the focus returns to the column header after a decision.
- **Statuses and next steps** (NFR-U4) are text in each page's Status section, the partner's candidate list and the pipeline: check that a screen reader reads the badge and the sentence after it, and that a status change after an action (selection, approval, stage change) is announced or the focus moves to the Status heading (the invitation page does this with `FocusOnChange`).
- **Company not named**: anonymous job orders read "Company not named" and a neutral title ("Lithuania, 30 Welders and flame cutters"); check that the card's link names the job order in a way that tells two of them apart in the rotor's list of links.
- **Uploads and long dialogs**: the response documents (scan status announced in a live region, "Being checked" then "Ready"), the Decline note and the withdrawal reason with their character counters (read with the field, not on every key, as in release 2a).
- **The consent checkbox** of the candidate's approval has a long label: check that it is read in full and that the error when it is left unchecked leads to it.
- **Disabled actions with a reason** (Send request at the monthly limit, Respond with an outdated commitment): the reason is the button's description; check that it is read when the button is focused, and that the button is reachable at all (not removed from the tab order).
- The translucent sticky header noted in the release 2a audit applies to every page here too.
