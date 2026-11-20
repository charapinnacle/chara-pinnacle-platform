# Runbook: manual accessibility audit of the release 2c pages

NFR-U3 (WCAG 2.2 AA on all partner, network and messaging pages), V80. Every page of release 2c (messaging: the inboxes, the conversations with their typed messages, block and report; Find Workers: the worker's opt-in, the search and its cards, contact requests on both sides; the connection actions; the release 2c blocks of the dashboards; the moderation, retention and statistics of messages and contact requests) passes the automated axe checks in CI (serious and critical violations, at 360 and 1280 px, with no horizontal scrolling at 360 px); axe finds about a third of the WCAG failures, so a person audits each page by hand before release 2c goes live, as for releases 2a and 2b (`release-2a-accessibility-audit.md`, `release-2b-accessibility-audit.md`). **The audit is operational**: it is done by a person on staging, with releases 2a and 2c (`release_find_workers`, `release_messaging`) switched on there, and its result is recorded in the release record (date, auditor, browser and assistive technology with versions, each finding with its page, criterion, severity and ticket). A finding at level A or AA that blocks a task (opting in to Find Workers or withdrawing, searching and filtering, sending, accepting, declining or withdrawing a contact request, reading and sending a message, sending an inquiry or a workforce request, inviting to apply, declining a typed message, blocking or unblocking, reporting a message or a contact request, turning message emails off) stops the go-live of release 2c; any other finding is a ticket with an owner and a date.

## 1. How to audit a page

Use the five checks of `release-2a-accessibility-audit.md` section 1 (K keyboard, S screen reader, Z zoom and reflow, C contrast and colour, F focus, input and targets), with the same browsers and assistive technologies, on each page of section 3 in every state its row names. As for release 2b, check on every page that shows the state of an item (NFR-U4) that the status is read as text (never told by colour or an icon alone) and that the next action is written next to it and reached in reading order right after it. For release 2c also check that live content is announced without stealing the focus: a new message in an open conversation, the unread badge in the header, the result count of Find Workers.

## 2. Automated coverage that already exists

CI runs axe through `expectAccessibleAtBothWidths` (360 and 1280 px, plus the horizontal scroll check) or `expectNoAxeViolations` in the spec of each page below, with the release 2c switches on. `accessibility-sweep.spec.ts` sweeps every page with the releases off and names the release 2c pages it leaves to their own specs (its list `releasedPages`). The two journeys of release 2c (`release-2c-journey.spec.ts`, NFR-O4) run axe at both widths on Find Workers with a result, the organisation's contact requests (waiting and accepted), the worker's contact requests, both sides of the conversation of an accepted request, the inbox under Contact requests and Inquiries, the conversation of an inquiry on both sides (waiting, answered, blocked), the report form of a message, and assert the status and the next action of each (NFR-U4). `worker-identity.spec.ts` (NFR-S9) reads the same pages for what they must not show. K in the last column: the spec also walks the flow, or part of it, by keyboard. None of this replaces sections 1 and 3.

## 3. The pages of release 2c

"Who" is the role that opens the page; "States" the states to audit by hand; "Axe in CI" the spec that checks the page with release 2c on.

### Messaging (every signed-in side)

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/messages` (candidate), `/[lang]/org/[slug]/messages` (organisation) | worker; employer, recruitment and staffing members, owners and admins at aal2 | list with unread counts, each context filter (Applications, Submissions, Invitations, Responses, Contact requests, Inquiries), Closed for new messages, next page, empty, empty under a filter, failed with a retry | `messaging.spec.ts`, `release-2c-journey.spec.ts` |
| `/[lang]/messages/[id]`, `/[lang]/org/[slug]/messages/[id]` | the same | no messages yet, a long thread with Show earlier messages, a message arriving while the page is open (the `log` region announces it), the composer with its counter at the limit and Ctrl+Enter, a dropped file, a failed send that keeps the text, the upgrade prompt at the monthly limit, Workers never pay with Report a fee request, Report on a message, Block dialog, blocked (by me, by the other side), closed (withdrawn application, suspended organisation), a message hidden by moderation with the appeal link | `messaging.spec.ts` (K for the composer), `release-2c-journey.spec.ts` |
| Typed message cards in a conversation | the receiving and the sending side, the worker | Inquiry, Workforce request, Invitation to apply (Apply, or no longer accepting applications), each status chip with its icon (Waiting for an answer, Answered, Accepted, Declined, Applied), Decline, Invite to job dialog | `connection-actions.spec.ts` (K for the inquiry), `release-2c-journey.spec.ts` |
| Header messages link with the unread badge | every signed-in user with Messages | none, a count, 99+ (the name says the exact count) | `messaging.spec.ts` |
| `/[lang]/settings/notifications` (New messages) | worker, company user | switch on and off by keyboard, failed save, saved | `messaging.spec.ts` (K) |

### Find Workers and contact requests

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/passport` Find Workers section, `/[lang]/dashboard/worker` card | worker | not visible with the explanation and the card preview, the opt-in dialog quoting the consent, visible with the optional sections, withdrawal, the yearly confirmation, failed save | `worker-visibility.spec.ts` (K) |
| `/[lang]/org/[slug]/find-workers` | employer and partner members | filters with visible labels, locked advanced filters with See plans, results with Matched on and the rule notice, the result count (live region), Send contact request, Request sent on with the status link, Invite to job after acceptance, Save and the saved workers, Saved for this requirement, no match with Clear filters, failed with a retry, refused (free plan, not listed, suspended) | `find-workers.spec.ts` (K for the search), `contact-requests.spec.ts`, `release-2c-journey.spec.ts`, `worker-identity.spec.ts` |
| Send a contact request dialog | the same | the message with its counter, the vacancy select, a refusal in the error summary with the text kept (daily limit, rules) | `contact-requests.spec.ts`, `release-2c-journey.spec.ts` |
| `/[lang]/org/[slug]/contact-requests` | members, owners and admins at aal2 | each status with its next step (Waiting for the worker, Accepted with the name and the conversation, Declined, No answer, Withdrawn, hidden by moderation with the appeal link), status filter, next page, Withdraw, empty with Find workers | `contact-requests.spec.ts`, `release-2c-journey.spec.ts` |
| `/[lang]/contact-requests` | worker | Waiting for your answer with what accepting shares, Accept (to the conversation), the Decline dialog with the 90 days, earlier requests with status and next step, Report this request, empty | `contact-requests.spec.ts` (K for Accept), `release-2c-journey.spec.ts` |
| `/[lang]/org/[slug]/requirements/[id]` Find workers for this requirement | employer members | the link and the prefilled search | `find-workers.spec.ts` |

### Connection actions, dashboards and analytics

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/partners/[slug]` Send inquiry and Request workforce dialogs | employer members (inquiry), owners and admins at aal2 (workforce) | counters, too short, an open inquiry with the link to its conversation, the workforce form's errors, Sign in to contact for a visitor | `connection-actions.spec.ts` (K), `release-2c-journey.spec.ts` |
| `/[lang]/request-workers` | visitor | the explanation and the link to the staffing partners | `connection-actions.spec.ts` |
| `/[lang]/find-workers` | visitor, company member | the explanation, Sign in and See the plans, the search of each organisation | `find-workers.spec.ts`, `worker-identity.spec.ts` |
| `/[lang]/dashboard/employer`, `/[lang]/dashboard/recruitment`, `/[lang]/dashboard/staffing` release 2c blocks | members | unread messages, matching workers (fewer than 5), inquiries and partner requests waiting, the free plan's notice | `messaging-dashboard-blocks.spec.ts` |
| `/[lang]/org/[slug]/analytics` inquiries | owners, admins | figures, hidden below the threshold | `network-analytics.spec.ts` |

### Reports, moderation and the console

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/report` for a message and a contact request | participant, worker | the category preselected from Report a fee request, errors, confirmation with the reference | `messaging.spec.ts`, `contact-requests.spec.ts`, `release-2c-journey.spec.ts` |
| `/[lang]/admin/reports/[id]` with a message or contact request target, Show the reported message | Trust & Safety Administrator at aal2 | the context of ten messages with the reported one marked, the Hide dialog with the statement of reasons | `messaging.spec.ts`, `contact-requests.spec.ts` |
| `/[lang]/appeals/[id]` for a hidden message or request | organisation members | the decision, the appeal form | `contact-requests.spec.ts` |
| `/[lang]/admin/retention` (conversations, contact requests, declines, saved cards), `/[lang]/admin/statistics` messaging and Find Workers metrics | Platform Administrator | the new periods with their editors, figures, below the threshold | `admin-retention.spec.ts`, `admin-network-statistics.spec.ts` |
| `/[lang]/legal/ranking` Find Workers section | visitor | the order, what never counts | `ranking-transparency.spec.ts` |

## 4. Known items to check first

- **New messages without a reload**: the thread is a `role="log"` region with `aria-live="polite"`, so a screen reader reads a message that arrives (by the Realtime signal, or the 4 s poll without it); check that it is read once, after the user's current speech, that the focus stays in the composer, and that Show earlier messages does not read the whole older page aloud.
- **The composer**: its name says to whom ("Message to ..."), the counter ("n / 4,000 characters") is read with the field rather than on every key, Enter makes a line and Ctrl+Enter or Cmd+Enter sends; check that the hint saying so is reachable, and that a failed send's toast is announced while the text stays.
- **Typed message cards**: the status chip has an icon and text; check that the chip, the details and the action (Apply, Decline) are read in that order, and that Decline names what it declines.
- **Report and Block**: each message's Report link names the sender and the time in its accessible name (visually only "Report"); the Block dialog says the other side is not told who blocked; check the focus returns to a sensible place after blocking, when the composer is gone.
- **Find Workers cards**: the card has no name, so its links and buttons are named by the occupation and the country ("Send contact request: ..."); check that two cards' buttons can be told apart in the rotor's list of buttons, that "Matched on" and the rule notice are read with the card, and that the result count is announced after a search.
- **Accept and Decline** on the worker's requests are named after the company; check that the Decline dialog's warning (90 days) is read before its button, and that Accept moving to the conversation announces the new page title.
- **The unread badge** in the header shows a number only; its accessible name has the exact count ("Messages, 3 unread"); check it with the rotor and at 400 % zoom.
- The translucent sticky header noted in the release 2a audit applies to every page here too, notably over a long conversation.
