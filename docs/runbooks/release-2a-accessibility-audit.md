# Runbook: manual accessibility audit of the release 2a pages

NFR-U3 (WCAG 2.2 AA on all partner, network and messaging pages), V78. Every page of release 2a passes the automated axe checks in CI (serious and critical violations, at 360 and 1280 px, with no horizontal scrolling at 360 px); axe finds about a third of the WCAG failures, so a person audits each page by hand before release 2a goes live. **The audit is operational**: it is done by a person on staging, with release 2a switched on there, and its result is recorded in the release record (date, auditor, browser and assistive technology with versions, each finding with its page, criterion, severity and ticket). A finding at level A or AA that blocks a task (sign-up, onboarding, submission, review decision, search, appeal, data export) stops the go-live of release 2a (`release-2a-go-live.md`); any other finding is a ticket with an owner and a date. Releases 2b and 2c get their own audit (V79, V80).

## 1. How to audit a page

Do each check on each page of section 3, in every state the table names (with data, empty, an error from the form, a toast, a dialog open). Use a current Chrome and Firefox on Windows with NVDA, Safari on macOS with VoiceOver, and Safari on iOS with VoiceOver for the public pages and onboarding.

| # | Check | WCAG 2.2 AA criteria | How |
|---|---|---|---|
| K | **Keyboard** | 2.1.1, 2.1.2, 2.4.1, 2.4.3, 2.4.7, 2.4.11, 3.2.1, 3.2.2 | Unplug the mouse. Tab from the address bar: the skip link comes first and moves to the main content; every link, button and field is reached in reading order, with a visible focus ring that the sticky header never covers (2.4.11, Focus Not Obscured; scroll to each field with Tab and Shift+Tab); comboboxes and chips work with the arrow keys, Enter and Escape, Backspace removes a chip and returns focus to the field; a dialog takes the focus, keeps it inside, closes with Escape and returns the focus to the button that opened it; nothing changes context on focus or on input alone; no keyboard trap. |
| S | **Screen reader** | 1.1.1, 1.3.1, 1.3.2, 2.4.2, 2.4.4, 2.4.6, 3.3.1, 3.3.2, 3.3.3, 4.1.2, 4.1.3 | The page title names the page; one `h1`, headings in order, landmarks (banner, navigation, main, contentinfo) listed by the rotor; every field has its label and its hint read with it (character counters, limits "3 of 3 countries"); errors are announced: the error summary takes the focus and each link leads to its field; toasts and status messages (saved, decision saved, limit reached, listing confirmed) are read without moving the focus; links make sense out of context ("Appeal this decision", not "here"); tables have captions and header cells; badges and states ("Hidden by moderation", "Overdue", "Hidden from search") are read as text. |
| Z | **Zoom and reflow** | 1.4.4, 1.4.10, 1.4.12, 1.3.4 | Browser zoom 200 %: nothing is cut off or overlaps. Zoom 400 % on a 1280 px window (320 CSS px): one column, no horizontal scrolling except inside data tables of the console; dialogs fit and scroll. Text spacing bookmarklet (line height 1.5, paragraph spacing 2, letter spacing 0.12, word spacing 0.16): no text is clipped. Portrait and landscape on a phone. |
| C | **Contrast and colour** | 1.4.1, 1.4.3, 1.4.11 | With a contrast checker: body text and placeholders 4.5:1, large text 3:1, field borders, focus rings, chip remove buttons, toggles and icons that carry meaning 3:1 against their background, in light and dark mode; states are never told by colour alone (the Overdue and Hidden badges have text). Windows high contrast (forced colours): focus rings, checkboxes, radio buttons and chips stay visible. |
| F | **Focus, input and targets** | 2.5.3, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8 | Targets are at least 24 by 24 CSS px or spaced (chip remove buttons, icon buttons, pagination); the accessible name contains the visible label; no task needs dragging; help (Contact, Trust & Safety) is in the same place on every page; nothing already entered is asked again in the same flow (onboarding steps, Request information); the two-step code field accepts paste and the password manager (no cognitive test). |

## 2. Automated coverage that already exists

CI runs axe (`tests/e2e/support/axe.ts`, serious and critical violations) through `expectAccessibleAtBothWidths` (360 and 1280 px, plus the horizontal scroll check) or `expectNoAxeViolations`. `accessibility-sweep.spec.ts` sweeps every page of the application with release 2a off and names the release 2a pages it leaves to their own specs (its list `releasedPages`); the specs below switch release 2a on and check those pages in their states. Keyboard paths are clicked through in the specs where the column says so. None of this replaces sections 1 and 3: axe does not judge reading order, the sense of a label, announcements, zoom, or focus that the header hides.

## 3. The pages of release 2a

"Who" is the role that opens the page; "States" the states to audit by hand; "Axe in CI" the spec that checks the page with release 2a on (K: the spec also walks the flow by keyboard).

### Public pages and sign-up

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/signup` with the four account types | visitor | each type chosen, draft notice, field errors | `partner-registration.spec.ts` (K) |
| `/[lang]/partners/recruitment` (Find Partners, recruitment) | visitor, signed-in employer | filters, results, second page, empty, over the search limit, advanced filters for a paying employer | `partner-search.spec.ts`, `release-2a-journey.spec.ts` |
| `/[lang]/partners/staffing` (staffing directory, available workforce) | visitor, signed-in employer | results, empty, over the limit, available-workforce results | `staffing-directory.spec.ts` |
| `/[lang]/partners/[slug]` (public partner profile) | visitor, signed-in user | complete profile, no availability, Report company and Report a fee demand | `partner-profile.spec.ts`, `release-2a-journey.spec.ts` |
| `/[lang]/companies/[slug]` (company page) | visitor, administrator of the company | with vacancies, empty | `company-page.spec.ts` |
| `/[lang]/legal/ranking` (how Find Partners orders results) | visitor | | `ranking-transparency.spec.ts` |
| `/[lang]/legal/[slug]` for the partner documents (Partner Terms, Recruitment and Staffing Company Terms, employer-pays commitment) | visitor | draft notice | `partner-legal-documents.spec.ts` |
| `/[lang]` home, `/[lang]/employers`, `/[lang]/how-it-works`, menu and footer with the partner sections | visitor | menu open on a phone | `partner-network-pages.spec.ts` |
| `/[lang]/pricing` with the partner tabs | visitor | each tab | `partner-checkout.spec.ts`, `partner-network-pages.spec.ts` |
| `/[lang]/report` for a partner profile and a fee demand | visitor, signed-in user | errors, confirmation with reference | `partner-profile.spec.ts` |

### Partner onboarding and partner pages

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/onboarding`, step Company | partner owner | errors, identifier required, release closed toast | `partner-registration.spec.ts` (K) |
| `/[lang]/onboarding`, Where you serve and What you offer | partner owner, admin | chips, limit notice, errors, save failed toast, skeleton | `partner-geographies.spec.ts`, `partner-workforce-offer.spec.ts` (K) |
| `/[lang]/onboarding`, Commitments | owner, admin, member | box required, member notice | `partner-commitment.spec.ts` (K) |
| `/[lang]/onboarding`, Security and Ready, waiting for review, information requested | owner, admin | missing field, aal2 challenge, resubmission | `partner-submit-review.spec.ts`, `partner-approval.spec.ts` (K) |
| `/[lang]/dashboard/recruitment`, `/[lang]/dashboard/staffing` (`dashboard/[kind]`) | owner, admin, member | pending, listed, not listed, information requested, figures, empty, failed | `partner-dashboards.spec.ts`, `partner-submit-review.spec.ts`, `partner-approval.spec.ts` |
| `/[lang]/org/[slug]/workforce-profile` | owner, admin, member | Where you serve, What you offer, Licences dialog (with a file), Availability dialog, confirm and delete, limit and upgrade prompt, moderation notice | `partner-geographies.spec.ts`, `partner-workforce-offer.spec.ts`, `partner-licences.spec.ts`, `partner-availability.spec.ts`, `partner-usage-limits.spec.ts` (K) |
| `/[lang]/org/[slug]/workforce-profile/preview` | owner, admin, member of an unlisted partner | | `partner-profile.spec.ts` |
| `/[lang]/org/[slug]/members` and `/[lang]/invitations/[token]` for a partner | owner, admin, member, invitee | empty, with members, members limit | `partner-team.spec.ts` |
| `/[lang]/org/[slug]/billing` and `/billing/checkout` with partner plans | owner | each plan, trial | `partner-checkout.spec.ts` |
| `/[lang]/notifications` and the bell in the header | any signed-in user | unread, empty, mark as read, live update | `in-app-notifications.spec.ts` |
| `/[lang]/settings/notifications` (per-kind email preferences) | any signed-in user | mandatory kinds | `notification-settings.spec.ts`, `in-app-notifications.spec.ts` |
| `/[lang]/appeals`, `/[lang]/appeals/[id]` | owner, admin, member of an organisation with a decision | decision, appeal form, errors, appeal pending and decided | `partner-profile.spec.ts` (K) |
| `/[lang]/settings/data-export` | candidate, company user | empty, being prepared, ready | `data-export.spec.ts` |

### Employer pages of release 2a

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/org/[slug]/saved-partners` | employer owner, member | rows, empty, remove | `save-partner-follow.spec.ts` |
| `/[lang]/following` | company user | rows, empty, unfollow | `save-partner-follow.spec.ts` |

### Console pages added in V11 to V31

| Page | Who | States | Axe in CI |
|---|---|---|---|
| `/[lang]/admin/partners` (Partners to review) | Trust & Safety, Verification Reviewer, Platform Administrator | queue, Overdue, same identifier flag, empty, focus after a decision | `partner-approval.spec.ts` (K) |
| `/[lang]/admin/partners/[id]` (partner review) | the same | evidence download, checklist, List, Request information and Decline dialogs with errors, read-only notice | `partner-approval.spec.ts` (K) |
| `/[lang]/admin/plans`, `/admin/plans/[code]`, `/admin/plans/overrides` | Platform Administrator | edit forms, errors, price change confirmation | `admin-plan-editor.spec.ts`, `admin-plan-price.spec.ts`, `accessibility-sweep.spec.ts` |
| `/[lang]/admin/settings` (settings and release switches) | Platform Administrator | switch refused while legal drafts exist | `admin-plan-editor.spec.ts`, `accessibility-sweep.spec.ts` |
| `/[lang]/admin/retention` | Platform Administrator | edit, errors | `admin-retention.spec.ts`, `accessibility-sweep.spec.ts` |
| `/[lang]/admin/reports`, `/admin/reports/[id]` with partner targets and the decision dialog | Trust & Safety, Platform Administrator (read) | fee demand first, decision dialog, race message | `reports-queue.spec.ts`, `partner-profile.spec.ts` (K) |
| `/[lang]/admin/organizations/[id]` with the decisions on a partner | Trust & Safety, Platform Administrator | decisions table, suspension | `partner-profile.spec.ts` |
| `/[lang]/admin/appeals`, `/admin/appeals/[id]` | Trust & Safety | open appeals, empty, decider told to leave it, decision dialog, race message | `partner-profile.spec.ts` (K) |
| `/[lang]/admin/statistics` with the network statistics | Platform Administrator | figures, empty, failed | `admin-network-statistics.spec.ts` |
| `/[lang]/admin/legal` with the partner documents | Platform Administrator | drafts, publish | `partner-legal-documents.spec.ts`, `accessibility-sweep.spec.ts` |

## 4. Known items to check first

- The sticky app header is translucent (`bg-background/85 backdrop-blur-md` in `components/layout/app-shell.tsx`): check 1.4.3 and 1.4.11 for text and controls scrolled under it, and 2.4.11 for focus hidden behind it. It made axe results intermittent before; making it opaque is a recorded follow-up chore.
- The chips fields (countries, occupations, languages) and the comboboxes are custom widgets: check K and S on every one of them with NVDA and VoiceOver, including the "No matching ..." option and the limit notice in its live region.
- Dialogs with uploads (licence evidence) and with long statements of reasons (review decisions, moderation, appeals): the character counter is part of the field's description, not a live region (V27 departure 10); check that it is read with the field and not repeated on every key.
