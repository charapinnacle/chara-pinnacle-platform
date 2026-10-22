# Phase 2 build order (provisional)

Version 0.1, 22 October 2026. The order in which the Phase 2 requirements (FR-J1 to FR-T1) are built, one pull request per unit, after the Phase 1 units of `docs/phase-1/BUILD_ORDER.md`. Data model, names and gates: `DATA_MODEL.md`. **Provisional:** no unit starts until CHARA has answered the Phase 2 decisions; a unit whose decisions change is re-planned first. Progress is read from merged pull requests, whose titles end with the unit id, for example `feat(FR-J1): partner registration [V05]`.

## Rules for every unit

The Phase 1 rules apply unchanged (branches, authorship, migrations, RLS, pgTAP with negative cross-tenant and wrong-role cases, Vitest, Playwright click-through, axe, CI green before merge, merge commit). In addition:

- A unit that changes a Phase 1 object marked **risky** in `DATA_MODEL.md` section 4 runs that object's full Phase 1 test suite and says so in the pull request.
- New screens and RPCs of a release stay behind its `release_*` setting until go-live.
- New dependencies: none expected. Realtime uses the installed `@supabase/supabase-js`. Anything else needs approval first.
- The acceptance-criteria text is corrected to the canonical names of `DATA_MODEL.md` section 2 in the same pull request.

## Units

Release 2a: partner accounts and discovery

| ID | Branch | Delivers | Needs |
|---|---|---|---|
| V01 | `feat/partner-plans-seed` | FR-R1 data: 8 partner plans, all partner and Phase 2 employer limit and feature rows, `billing.limit_keys`, `billing.feature_keys` | Phase 1 |
| V02 | `feat/in-app-notifications` | FR-T1 base: notification catalogue, `read_at`, `email_status`, `mandatory`, `dedupe_key`, per-kind email preferences, list, unread and mark-read RPCs, Realtime `user:<id>` channel (first Realtime use), bell and notifications pages | Phase 1 |
| V03 | `feat/db-partner-organizations` | infra: partner enums, organisation and profile columns, identifier links, partner types in `create_organization`, consents per organisation type, re-review trigger, `admin_set_organization_type`, listed-partner helpers | V01 |
| V04 | `feat/partner-legal-documents` | FR-S4: partner legal document drafts, per-type sign-up documents, organisation-level consent, `legal_release_gaps`, draft banner | V03 |
| V05 | `feat/partner-registration` | FR-J1 sign-up with four choices and the Company step | V03, V04 |
| V06 | `feat/partner-geographies` | FR-K1: Where you serve, `markets` limit | V03 |
| V07 | `feat/partner-workforce-offer` | FR-K2: occupations, industries, languages, recruitment and service types, `listed_occupations` limit | V06 |
| V08 | `feat/employer-pays-commitment` | FR-J3: commitment document, owner acceptance, Commitments step | V04 |
| V09 | `feat/partner-submit-review` | FR-J1: step resume, Security, Ready, `submit_partner_for_review`, pending dashboard state | V07, V08 |
| V10 | `feat/partner-licences` | FR-J2: licences, `partner-documents` bucket, `document-url` and `scan-document` branches, access log, expiry job | V03 |
| V11 | `feat/partner-approval` | FR-J4: review queue, review page, decisions, re-review | V09, V10, V02 |
| V12 | `feat/workforce-availability` | FR-K3: listings, confirmation, staleness, reminders | V07 |
| V13 | `feat/partner-usage-helpers` | FR-R1: `month_start`, `monthly_usage`, `org_usage`, `record_limit_prompt`, upgrade prompt, profile limits wired | V06, V07, V12 |
| V14 | `feat/partner-review-emails` | FR-T1: review, licence and listing-confirmation kinds, templates and daily jobs | V02, V11, V10, V12 |
| V15 | `feat/partner-checkout` | FR-R1: type-checked checkout, pricing tabs, partner billing page (provider products need the payment account [d7.3]) | V01, V03 |
| V16 | `feat/admin-plan-editor` | FR-R2: plan, limit, feature, override (with `expires_at`, risky `org_limit` change), trial and settings editor with audit | V01 |
| V17 | `feat/plan-price-change` | FR-R2: provider `createPrice`, `billing-plan-price` function, one audit row (live only with the payment account) | V16 |
| V18 | `feat/public-partner-profile` | FR-K4: public partner profile, rate limit, sitemap, preview | V11, V12 |
| V19 | `feat/retention-admin` | FR-S3: retention editor, Phase 2 retention rows, licence evidence retention, personal-data catalogue test | V10 |
| V20 | `feat/profile-view-counter` | FR-R6: view events, daily aggregates (profile views) | V18, V19 |
| V21 | `feat/partner-search` | FR-L1: `search_partners`, recruitment directory, search statistics | V18 |
| V22 | `feat/staffing-directory` | FR-L2, FR-K3 search: staffing directory, `search_available_workforce` | V21 |
| V23 | `feat/company-page` | FR-K5: public company page (vacancies), `get_public_job` link | V03 |
| V24 | `feat/save-partner-follow` | FR-L4: saved partners, follows, follower count, follower digest | V21, V23, V02 |
| V25 | `feat/partner-network-pages` | FR-L5: release settings, menu, pricing partner sections | V21, V01 |
| V26 | `feat/report-queue-priority` | FR-S1: `partner_profile` target, `due_at`, fee-demand-first queue with composite cursor | V18 |
| V27 | `feat/moderation-decide` | FR-S1: `moderation_decide`, suspension cascade to partner profile and listings, `moderation_decision` notice | V26, V02 |
| V28 | `feat/moderation-appeals` | FR-S1: appeals by a second reviewer | V27 |
| V29 | `feat/data-export` | FR-S3: data export of Phase 1 data (closes a Phase 1 gap), `dsar-exports` bucket, `data_export_ready` | V02 |
| V30 | `feat/partner-dashboards` | FR-R3, FR-R4 (2a parts): recruitment and staffing dashboards, routing by organisation type | V13, V20, V12 |
| V31 | `feat/admin-network-statistics` | FR-S2: partner organisation metrics | V11 |

Release 2b: workforce requirements, job orders, invitations, responses, submissions

| ID | Branch | Delivers | Needs |
|---|---|---|---|
| V32 | `feat/db-workforce-requirements` | FR-M1: requirements, occupations, countries, prohibited terms, form | V07 |
| V33 | `feat/requirement-lifecycle` | FR-M2: transitions, publish, extend, close and reminder jobs, lapse pause | V32 |
| V34 | `feat/requirement-limits` | FR-M4: `active_requirements`, multi-country feature, usage | V33, V16 |
| V35 | `feat/vacancies-from-requirement` | FR-M1: draft vacancies from a requirement (`jobs.requirement_id`) | V32 |
| V36 | `feat/partner-suggestions` | FR-M3: rule-based suggestions with reasons | V32, V12 |
| V37 | `feat/db-direct-hiring-rules` | FR-Q5 data: rules table, admin RPCs, `hiring_rule_notice` | V01 |
| V38 | `feat/direct-hiring-rules-console` | FR-Q5: admin page | V37 |
| V39 | `feat/db-job-orders` | FR-N1: `list_job_orders`, `get_job_order`, eligibility, reveals, free-plan titles-only rule | V33, V11, V06, V07 |
| V40 | `feat/job-orders-pages` | FR-N1: marketplace and detail pages, new job order alert | V39 |
| V41 | `feat/db-invitations` | FR-O1: invitations, limits, daily cap, expiry on close | V39, V34 |
| V42 | `feat/invitations-pages` | FR-O1: employer list, partner inbox, invite from suggestions and profiles | V41, V36 |
| V43 | `feat/requirement-change-notices` | FR-M2: versions, change notices, closing reminders to partners | V33, V41 |
| V44 | `feat/db-partner-responses` | FR-N2, FR-O2 data: responses, versions, fee models, commitment, licence (FR-J2 AC9, AC10) and monthly limit checks | V41, V37, V10, V08 |
| V45 | `feat/response-documents` | FR-O2: response documents bucket, scan, broker URL | V44 |
| V46 | `feat/partner-response-pages` | FR-N2, FR-O2: response form and lists | V44, V45, V40 |
| V47 | `feat/response-decisions` | FR-O3: comparison, decisions, reveal, submissions allowed | V46 |
| V48 | `feat/db-candidate-submissions` | FR-O4 data: submissions, passport share by submission (risky), consents purpose, approve, decline, withdraw, expiry (go-live after the DPIA [d6.3]) | V47 |
| V49 | `feat/candidate-submission-pages` | FR-O4: worker request page, sign-up link, partner form | V48 |
| V50 | `feat/submission-pipeline` | FR-O5: stages, notes, bulk, share expiry, journey tracker, applicants page source filter | V49 |
| V51 | `feat/partner-action-limits` | FR-R1: response and submission limits at boundaries and after a lapse | V13, V44, V48 |
| V52 | `feat/commitment-reconsent` | FR-S4: outdated commitment blocks responses and submissions | V04, V44, V48 |
| V53 | `feat/find-employers` | FR-L3: `search_employers`, saved searches | V23, V39 |
| V54 | `feat/job-order-follow-and-page` | FR-L4, FR-K5, FR-J3 (2b parts): job orders on company pages and in follower digests | V24, V23, V39, V48 |
| V55 | `feat/partner-dashboards-job-orders` | FR-R3, FR-R4 (2b parts) | V30, V32, V41, V44, V48 |
| V56 | `feat/employer-network-dashboard` | FR-R5 (2b parts) | V32, V41, V47, V24 |
| V57 | `feat/moderation-job-orders` | FR-S1: requirement, response and submission targets, suspension cascade | V27, V32, V44, V48 |
| V58 | `feat/network-retention-submissions` | FR-S3, FR-S2 (2b parts): retention, erasure and export of submissions; job order metrics | V19, V29, V31, V50 |
| V59 | `feat/job-order-notifications` | FR-T1 (2b kinds) | V02, V41 to V50, V33 |
| V60 | `feat/network-analytics-page` | FR-R6: analytics page and export (may move to Phase 3) | V20, V41, V44 |

Release 2c: messaging and Find Workers

| ID | Branch | Delivers | Needs |
|---|---|---|---|
| V61 | `feat/passport-extensions` | FR-Q4: training, employment history, preferred industries and employment types, completeness weights | Phase 1 |
| V62 | `feat/vacancy-required-experience` | FR-Q4: required experience on vacancies and in search | Phase 1 |
| V63 | `feat/db-messaging-core` | FR-P1: conversations, messages, reads, contact rules | V50, V41 |
| V64 | `feat/messaging-realtime` | FR-P1: Realtime policies and broadcast, polling fallback | V63, V02 |
| V65 | `feat/messaging-pages` | FR-P1: inbox and conversation pages | V64 |
| V66 | `feat/messaging-limits-safety` | FR-P3: monthly limit, throttle, report message, block | V65, V13 |
| V67 | `feat/message-notifications` | FR-P4, FR-T1: unread badge, delayed `new_message` email | V64, V02 |
| V68 | `feat/worker-visibility` | FR-Q1: opt-in, card, yearly confirmation | V61 |
| V69 | `feat/find-workers-search` | FR-Q2: `search_workers`, rule shaping, search log | V68, V37, V24 |
| V70 | `feat/contact-requests` | FR-Q3: contact requests, notices | V69, V63 |
| V71 | `feat/connection-actions` | FR-P2: inquiry, request workforce, invite to job, submit candidate entry | V63, V41, V70, V24 |
| V72 | `feat/direct-hiring-enforcement` | FR-Q5, FR-K1 AC8: rules in search, contact, invite and `apply_to_job` (risky) | V37, V70 |
| V73 | `feat/moderation-messages` | FR-S1, FR-J3 (2c parts): message and contact request targets, reported message context | V57, V63, V70 |
| V74 | `feat/messaging-retention-erasure` | FR-P3, FR-S3, FR-S2 (2c parts): conversation purge, erasure, export, metrics | V58, V63, V68, V70 |
| V75 | `feat/messaging-dashboard-blocks` | FR-R3, FR-R4, FR-R5 (2c parts): unread messages, matching workers, partner requests | V55, V56, V63, V71, V68 |
| V76 | `feat/analytics-inquiries` | FR-R6: inquiries metric | V60, V71 |

## Outside the code

- Before 2a goes live: counsel-approved partner legal documents [d6.2]; live payment provider with the six paid partner prices, Supabase Pro, a commercial hosting plan, sending domain with SPF, DKIM and DMARC [d7.3]; trust and safety staff named [d7.2].
- Before 2b goes live: legal opinion on the job order board and direct-hiring rules [d6.1]; DPIA for candidate submissions [d6.3].
- Before 2c goes live: Realtime private channels enabled on the hosted project.
- Acceptance: five working days per release with CHARA [d1.2].
