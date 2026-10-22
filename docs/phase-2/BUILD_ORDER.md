# Phase 2 build order (provisional)

Version 0.2, 22 October 2026. The order in which the Phase 2 requirements (FR-J1 to FR-T1) are built, one pull request per unit (80 units; V77 to V80 were added for the non-functional requirements and sit at the end of their release), after the Phase 1 units of `docs/phase-1/BUILD_ORDER.md`. Data model, names and gates: `DATA_MODEL.md`. **Provisional:** no unit starts until CHARA has answered the Phase 2 decisions; a unit whose decisions change is re-planned first. Progress is read from merged pull requests, whose titles end with the unit id, for example `feat(FR-J1): partner registration [V05]`.

## Rules for every unit

The Phase 1 rules apply unchanged (branches, authorship, migrations, RLS, pgTAP with negative cross-tenant and wrong-role cases, Vitest, Playwright click-through, axe, CI green before merge, merge commit). In addition:

- A unit that changes a Phase 1 object marked **risky** in `DATA_MODEL.md` section 4 runs that object's full Phase 1 test suite and says so in the pull request.
- New screens and RPCs of a release stay behind its `release_*` setting until go-live.
- New dependencies: none expected. Realtime uses the installed `@supabase/supabase-js`. Anything else needs approval first.
- The acceptance-criteria text is corrected to the canonical names of `DATA_MODEL.md` section 2 in the same pull request.
- Non-functional requirements that bind every unit (section "Non-functional requirements" below): every new table gets cross-tenant pgTAP tests with two employers, two partners, two candidates and anonymous, and the RLS coverage test stays at 100 % (NFR-S8); every plan limit is enforced in the database in the same transaction, with a pgTAP concurrency test at the boundary (NFR-A4); every email is queued in the same transaction as its change (NFR-A3); every new page passes the axe checks (NFR-U3); every geography, occupation, industry, language and service type is a foreign key to a code list (NFR-M3); no ordering reads `billing.*` (NFR-C8); every value an administrator may change is a setting with an audited editor, not a constant (NFR-O5).

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
| V77 | `feat/ranking-transparency-page` | NFR-C8: public page describing the main ranking parameters of Find Partners (extended for the job order board in V79 and Find Workers in V80); test that paid and unpaid organisations rank the same | V21 |
| V78 | `chore/release-2a-readiness` | NFR-O4: end-to-end journey partner sign-up to approval to public profile in CI; NFR-P3: load test of Find Partners at 5,000 partner organisations with query plans; NFR-U3: manual accessibility audit checklist of the 2a pages; NFR-C7: review of the approval and moderation flows | V11, V21, V22, V27 |

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
| V79 | `chore/release-2b-readiness` | NFR-O4: journeys requirement to invitation to response to selection, and candidate submission with worker approval, in CI; NFR-P3: load test of the job order board at 2,000 open requirements; NFR-S11: page-source and network checks for an uninvited partner; NFR-U3 audit of 2b pages; NFR-C8 page extended | V47, V50, V77 |

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
| V80 | `chore/release-2c-readiness` | NFR-O4: contact request and messaging journeys in CI; NFR-P3: load test of Find Workers at 100,000 visible profiles; NFR-P4: message shown within 5 s and conversation list within 500 ms at 10,000 conversations; NFR-P5: capacity review at 2,000 partners and 50,000 messages a day; NFR-S9: page-source, network and notification payload checks; NFR-U3 audit of 2c pages; NFR-C8 page extended | V67, V70, V71, V79 |

## Coverage

Every Phase 2 functional requirement and its SOP (Notion database 3, P2-01 to P2-45, one SOP per requirement) is delivered by these units:

| Requirement | SOP | Units |
|---|---|---|
| FR-J1 | P2-01 | V05, V09 |
| FR-J2 | P2-02 | V10, V44 |
| FR-J3 | P2-03 | V08, V54, V73 |
| FR-J4 | P2-04 | V11 |
| FR-K1 | P2-05 | V06, V72 |
| FR-K2 | P2-06 | V07 |
| FR-K3 | P2-07 | V12, V22 |
| FR-K4 | P2-08 | V18 |
| FR-K5 | P2-09 | V23, V54 |
| FR-L1 | P2-10 | V21 |
| FR-L2 | P2-11 | V22 |
| FR-L3 | P2-12 | V53 |
| FR-L4 | P2-13 | V24, V54 |
| FR-L5 | P2-14 | V25 |
| FR-M1 | P2-15 | V32, V35 |
| FR-M2 | P2-16 | V33, V43 |
| FR-M3 | P2-17 | V36 |
| FR-M4 | P2-18 | V34 |
| FR-N1 | P2-19 | V39, V40 |
| FR-N2 | P2-20 | V44, V46 |
| FR-O1 | P2-21 | V41, V42 |
| FR-O2 | P2-22 | V44, V45, V46 |
| FR-O3 | P2-23 | V47 |
| FR-O4 | P2-24 | V48, V49 |
| FR-O5 | P2-25 | V50 |
| FR-P1 | P2-26 | V63, V64, V65 |
| FR-P2 | P2-27 | V71 |
| FR-P3 | P2-28 | V66, V74 |
| FR-P4 | P2-29 | V67 |
| FR-Q1 | P2-30 | V68 |
| FR-Q2 | P2-31 | V69 |
| FR-Q3 | P2-32 | V70 |
| FR-Q4 | P2-33 | V61, V62 |
| FR-Q5 | P2-34 | V37, V38, V72 |
| FR-R1 | P2-35 | V01, V13, V15, V51 |
| FR-R2 | P2-36 | V16, V17 |
| FR-R3 | P2-37 | V30, V55, V75 |
| FR-R4 | P2-38 | V30, V55, V75 |
| FR-R5 | P2-39 | V56, V75 |
| FR-R6 | P2-40 | V20, V60, V76 |
| FR-S1 | P2-41 | V26, V27, V28, V57, V73 |
| FR-S2 | P2-42 | V31, V58, V74 |
| FR-S3 | P2-43 | V19, V29, V58, V74 |
| FR-S4 | P2-44 | V04, V52 |
| FR-T1 | P2-45 | V02, V14, V59, V67 |

## Non-functional requirements

The 19 Phase 2 non-functional requirements (Notion database 2, Phase 2):

| NFR | Name | Where it is met |
|---|---|---|
| NFR-S8 | Tenant isolation in the partner network | every unit (rule); `DATA_MODEL.md` section 6 access column |
| NFR-S9 | Worker identity protection | V48, V68, V69, V70; checks in V80 |
| NFR-S10 | Messaging abuse control | V65 (plain text, escaped, links as text), V66 (limits, throttle, block, report) |
| NFR-S11 | Hidden employer name on job orders | V39, V41, V47; checks in V79 |
| NFR-P3 | Network search response time | V78 (Find Partners), V79 (job order board), V80 (Find Workers) |
| NFR-P4 | Message delivery time | V64, V65; measured in V80 |
| NFR-P5 | Phase 2 capacity | V80 |
| NFR-A3 | Event and email delivery | every unit that queues an email (rule); V02, V14, V59, V67 |
| NFR-A4 | Limit consistency under load | every limit unit (rule): V06, V07, V12, V13, V34, V41, V44, V48, V51, V66 |
| NFR-C4 | Worker consent for visibility and submissions | V48 (submission approval and withdrawal), V68 (Find Workers opt-in and withdrawal) |
| NFR-C5 | Message retention and staff access | V73 (reported message context, audited), V74 (24-month purge, setting) |
| NFR-C6 | Fair recruitment and employer pays | V08, V26 (fee reports first), V37, V72, V52 |
| NFR-C7 | Business user traceability and moderation | V03, V11 (identity checked before listing), V27, V57, V73; review in V78 |
| NFR-C8 | Ranking transparency | V77; rule for every search unit (V21, V22, V39, V53, V69) |
| NFR-U3 | Accessibility of Phase 2 pages | every unit (axe rule); manual audit in V78, V79, V80 |
| NFR-U4 | Clear status and next step | V42, V46, V47, V49, V50, V70 (status labels and next action, Playwright checks) |
| NFR-O4 | Phase 2 test coverage | V78, V79, V80 (journeys in CI) |
| NFR-O5 | Configuration without deployment | V16 (plans, limits, settings), V19 (retention), V33 (requirement duration settings), V37 (direct-contact rules) |
| NFR-M3 | Code lists for the partner network | V06, V07, V12, V32 (foreign keys to code lists, rule) |

## Outside the code

- Before 2a goes live: counsel-approved partner legal documents [d6.2]; live payment provider with the six paid partner prices, Supabase Pro, a commercial hosting plan, sending domain with SPF, DKIM and DMARC [d7.3]; trust and safety staff named [d7.2].
- Before 2b goes live: legal opinion on the job order board and direct-hiring rules [d6.1]; DPIA for candidate submissions [d6.3].
- Before 2c goes live: Realtime private channels enabled on the hosted project.
- Acceptance: five working days per release with CHARA [d1.2].
