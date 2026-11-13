# Phase 2 data model (provisional)

Version 0.1, 22 October 2026. Status: **provisional**. CHARA has not yet answered the 35 items of "CHARA - Phase 2 Decisions Required"; every choice below assumes our recommendation and cites the item as `[d2.4]`. When an answer differs, change the rows that cite it. Requirements and acceptance criteria: the Phase 2 SOP workbook and `docs/phase-1/client/phase-2/acceptance-criteria` (FR-J1 to FR-T1, 503 criteria), mirrored in Notion. `docs/ARCHITECTURE.md` stays the authority on Phase 1 and on technical rules; this file adds Phase 2 and lists every Phase 1 object it changes. The build order is `BUILD_ORDER.md`.

Rules carried over from Phase 1 without exception: Supabase CLI migrations only, never edited once merged; every table has RLS enabled and forced, default deny, an index on every column used in a policy; no insert, update or delete grant to API roles unless stated (writes go through `security definer` RPCs with `set search_path = ''`, which re-check caller, role, aal and organisation status, write `audit.record()` and raise `CHARA_*` errors); views are `security_invoker`; worker ids carry no foreign key (the erasure pseudonym pattern of `job_applications`); `alter type ... add value` sits in its own migration.

## 1. Releases and gates

| Release | Scope | Go-live gates |
|---|---|---|
| 2a | Partner accounts, review, workforce profile, licences, public partner profiles, Find Partners, save and follow, company page, partner plans, plan editor, in-app notifications, moderation of profiles, appeals, data export, partner dashboards | Partner legal documents approved by counsel [d6.2]; live payment provider, Supabase Pro, commercial hosting, sending domain [d7.3] |
| 2b | Workforce requirements, job order marketplace, invitations, partner responses, candidate submissions, direct-hiring rules (table and console), employer network dashboard | Legal opinion on the job order board [d6.1]; DPIA before submissions [d6.3] |
| 2c | Messaging with Realtime, connection actions, passport extensions, Find Workers, contact requests, direct-hiring enforcement | Legal opinion [d6.1]; DPIA [d6.3]; Realtime private channels on the hosted plan [d7.3] |

Each release is switched on by settings in `private.settings`, read by RPCs and navigation: `release_partner_directories`, `release_job_orders`, `release_candidate_submissions`, `release_messaging`, `release_find_workers` (all `false` until go-live). `private.legal_release_gaps(feature)` lists missing or draft legal documents per release; `scripts/check-go-live.mjs` runs it.

## 2. Names settled across the requirement groups

The acceptance-criteria files were written group by group and disagree on some names. These are canonical; the AC texts are corrected when each unit is built.

| Topic | Canonical | Not used |
|---|---|---|
| Partner listing state | `organizations.review_status`, listed when `listed_at is not null and review_status <> 'declined' and status = 'active'` (helper `private.public_partner_ids()`, `private.is_listed_partner(org)`) | `listing_state`, `listing_status` |
| Profile freshness | `organizations.workforce_profile_updated_at` (exposed as `profile_updated_at`) | |
| Staleness setting | `workforce_listing_stale_days` (60), `workforce_confirm_reminder_days` (30) | `workforce_staleness_days` |
| Partner plan codes | `free_recruitment_company`, `recruitment_partner`, `recruitment_professional`, `recruitment_enterprise`, and the same for `staffing_*` (ARCHITECTURE 10.1); display names Basic, Professional, Enterprise [d2.1] | `recruitment_basic`, `free_recruitment`, display name "Partner" |
| Limit keys | `markets`, `listed_occupations`, `workforce_listings`, `members`, `job_order_responses_per_month` (one key for both partner types), `candidate_submissions_per_month`, `messages_per_month`, `active_requirements`, `partner_invitations_per_requirement` | `occupations_listed`, `workforce_request_responses_per_month` |
| Feature keys | `job_order_access`, `worker_search`, `advanced_worker_search`, `employer_discovery`, `advanced_employer_discovery`, `available_workforce_search`, `advanced_partner_search`, `multi_country_requirements`, `analytics_basic`, `analytics_advanced`, `analytics_enterprise` | `employer_discovery_advanced` |
| Release switches | `release_*` | `feature_*` |
| Requirement columns | `workers_needed`, `city_region`, `show_identity`, optional `title` (generated when empty), `max_capacity_over_percent` | `workers_count`, `city`, `show_employer_name` |
| Service and staffing types | one enum `partner_service_type` | `staffing_type` |
| Industry granularity | ISIC sections (the `industries` table) | ISIC classes such as "2511" |
| Profile views | `private.profile_view_events` + `private.org_analytics_daily` | `public.partner_profile_views` |
| Report targets | `partner_profile`, `requirement`, `partner_response`, `candidate_submission`, `contact_request`, `message` | `conversation`, `submission` |
| Reported message context | `admin_get_reported_message`, audit `message.context_opened` | `admin_get_message_context` |
| Outdated commitment error | `CHARA_CONSENT_REQUIRED` detail `employer_pays_commitment` | `CHARA_FORBIDDEN reconsent_required` |
| Notification kinds | one catalogue `private.notification_kinds` (section 9); overlaps use `licence_expiring`, `listing_confirmation_due`, `moderation_decision`, `job_order_match`, `contact_request_decided` | `partner_licence_expiring`, `workforce_confirm_reminder`, `report_outcome`, `new_job_order` |
| Email preferences | `notification_preferences.email_kinds jsonb` | separate boolean columns per kind |
| Monthly limits | calendar month in UTC, `private.month_start()` | Europe/Berlin months |
| Suspension notice | existing `account_suspended` | `organization_suspended` |

## 3. Partner organisations reuse `public.organizations`

No criterion needs a separate partner table: `organization_type` already has `employer`, `recruitment_company`, `staffing_company`; members, invitations, billing, suspension and limits all key on `organization_id`; `private.org_plan_code` already falls back to `free_<type>`. Partner companies are organisations of the two partner types, with account kind `company`. The type is fixed at sign-up [d2.4]; a partner is listed only after staff review and is never shown as verified [d2.5, d2.6].

## 4. Phase 1 objects changed

Each change is a new migration. **Risky** marks a change to a central Phase 1 object; its unit runs the full Phase 1 test suite of that object.

Profiles and organisations
- `public.profiles`: + `intended_organization_type organization_type null` (only with intended kind `company`; frozen once the kind is committed by the profiles guard trigger; read by `private.handle_new_user`).
- `public.organizations`: + `review_status partner_review_status null` (check: null exactly for employers), `submitted_at`, `listed_at`, `info_step` (company, where_you_serve, commitments), `recruitment_type recruitment_preference`, `founded_year smallint`, `workforce_size_band`, `workforce_profile_updated_at`, `public_page_enabled boolean not null default false` (employers only), `moderation_state` for partner profiles; partial index for listed partners. Select grants unchanged: public reads go through definer RPCs, so legal name, identifier and licences never leak.
- `public.create_organization`: accepts the partner type equal to the profile's intended type (`organization_type_mismatch` otherwise); identifier required for partners; sets `review_status = 'onboarding'`; records identifier links without naming the other organisation.
- Re-review trigger on `organizations` (legal name, identifier, identifier kind, type): listed → `re_review`.
- Consents per organisation type: `private.required_consents(kind, org_type)` overload; `signup_documents(p_org_type)` (drop and recreate, web caller in the same PR), `accept_consents`, `set_account_kind`, `choose_account_kind`, `pending_reconsents`, `publish_legal_document` recipients.
- `public.get_public_job`: + company page link when the page is on (return type change: drop and recreate).

Billing
- `billing.plans`, `plan_limits`, `plan_features`: new rows only (section 8). Every partner plan has a row for every partner limit key, so a missing row never means unlimited.
- `billing.organization_limit_overrides`: + `expires_at`; **risky**: `private.org_limit` ignores expired rows and is read by every limit check.
- `private.billing_plan_audit`: reads `chara.audit_reason`; honours `chara.billing_audit_suppress` so a price change writes one audit row. **Risky**: shared by five billing tables; pgTAP 085 exception list updated.
- `public.billing_checkout_start`: `plan_not_for_org_type` before `plan_not_sold`.
- `public.billing_usage`: partner and Phase 2 employer keys; new member-level `public.org_usage(p_org)` (counts and limits, no aal2) instead of loosening the billing gate.
- `public.record_job_limit_prompt` generalised to `public.record_limit_prompt(p_org, p_limit_key)` (old function kept as a wrapper).
- `private.pause_jobs_on_lapse`: also pauses requirements over the limit (the billing-owned `billing_apply_event` stays untouched).
- Free partner plans: job order details need a paid plan regardless of `entitlements_enforced` [d3.6] (`private.org_plan_code(org) not like 'free\_%'` in the job order RPCs).

Passport, applications and documents
- `public.passport_shares`: `application_id` nullable, + `submission_id uuid unique`, `check (num_nonnulls(application_id, submission_id) = 1)`. **Risky**: `private.passport_shares_guard` and `private.passport_shares_audit` name a fixed column set.
- `private.consents_check_document`: accepts `share_passport:<org>:submission:<id>` (slug `sharing-notice`); without it every approval fails with 23503.
- `audit.document_access_log.purpose`: + `submission_review`; `document_access_grant` sets it for submission shares. The share's organisation is always the employer, never the partner.
- `public.worker_profiles`: drop `check (not searchable)`; + `card_id uuid unique default gen_random_uuid()`, `card_show_training`, `card_show_employment_history`, `card_show_industries`, `updated_at` with touch trigger. `card_id` never enters profile snapshots.
- `private.passport_completeness`, the web `computeCompleteness` and the application snapshot: new weights for the passport extensions (a complete Phase 1 passport drops to 90%; to confirm with CHARA).
- `public.jobs`: + `requirement_id` (set only by `create_vacancies_from_requirement`), + `required_experience_years smallint 0..40`; `public.search_jobs` gains `p_experience` (old signature dropped).
- `public.apply_to_job`: direct-hiring rule check (blocked refuses, licensed-partner-required allows with a notice); accepts a matching invite-to-job connection. **Risky**: return shape changes (drop and recreate), the most-tested Phase 1 RPC.

Reports, moderation, notifications, compliance
- `public.report_target_type`: + the six targets of section 2 (own migrations); `public.reports`: + `requirement_id`, `partner_response_id`, `candidate_submission_id`, `contact_request_id`, `message_id` (no foreign keys to rows that retention deletes), + `due_at` (1 working day for fee demands, 2 otherwise, Europe/Berlin, no holiday calendar); the unnamed target check is replaced (find its generated name first).
- `public.admin_list_reports`: fee demands first, then oldest; composite cursor (priority, created_at, id); web DAL changed in the same PR.
- `public.moderation_actions`: hide and unhide pairs for the new targets, + `report_id`.
- `public.suspend_organization`, `reinstate_organization`: cascade to partner profile, listings, requirements, responses and submissions, extended per release. **Risky**: most-called admin RPCs.
- `public.notifications`: + Phase 2 kinds (check rewritten not valid, then validated), + `read_at`, `email_status` (null, `suppressed_by_preference`, `suppressed_undeliverable`), `mandatory boolean not null default true`, `dedupe_key` with a partial unique index; `user_id` may be null for the submission invitation to an address without an account (+ `recipient_email`, one per address per 7 days).
- `public.notification_preferences`: + `email_kinds jsonb not null default '{}'`; `set_notification_preferences(p_kinds jsonb)` for workers and company users; mandatory kinds refused.
- `private.retention_policies`, `private.apply_retention`, `public.erase_user`: extended per release (section 10).
- `private.missing_reference_data`: + Phase 2 legal slugs and reference tables.

## 5. Enums

| Enum | Values and transitions |
|---|---|
| `partner_review_status` | onboarding → pending_review → listed / info_requested / declined; info_requested → pending_review (or re_review when listed before); listed → re_review on legal changes → listed / info_requested / declined |
| `geography_scope` | sources_from, serves_market (based-in is a column) |
| `partner_service_type` | staffing, temporary, contract, project, permanent |
| `workforce_size_band` | 1_49, 50_249, 250_999, 1000_plus |
| `requirement_status` | draft → open → paused ⇄ open; open / paused → closed (reason) or filled; closed and filled are final |
| `requirement_visibility` | private, job_order_marketplace [d3.1] |
| `requirement_close_reason` | filled, cancelled, expired |
| `partner_need` | none, recruitment, staffing, both |
| `invitation_status` | invited → viewed → accepted / declined; accepted → responded (invited or viewed → responded when a response auto-accepts); invited / viewed / accepted → withdrawn (employer) or expired (requirement closed) |
| `response_status` | submitted ⇄ updated; submitted / updated → withdrawn (partner) or shortlisted / selected / declined; shortlisted → selected / declined |
| `fee_model` | fee_per_hire, percent_first_year_salary, hourly_rate, monthly_rate, on_request [d3.3] |
| `submission_status` | awaiting_candidate → submitted / declined_by_candidate / expired (14 days); from submitted the application stages (submitted maps to applied in `private.application_transition_allowed`); withdrawn by the candidate from any active stage, including hired |
| `conversation_context` | application, contact_request, candidate_submission, requirement_invitation, partner_response, inquiry |
| `message_kind` | text, inquiry, request_workforce, invite_to_job, submit_candidate |
| `connection_kind` / `connection_status` | inquiry, request_workforce, invite_to_job, submit_candidate / sent → answered, accepted or declined |
| `contact_request_status` | pending → accepted / declined (worker) or expired (30 days) |
| `direct_hiring_rule_value` | allowed, licensed_partner_required, blocked [d4.5] |

## 6. New tables

Columns are the essentials; check constraints follow the Phase 1 text rules (trimmed, length-bounded, no control characters). "Members" means `private.member_org_ids()`; staff read only through admin RPCs.

### Release 2a

| Table | Key columns | Read access |
|---|---|---|
| `private.organization_identifier_links` | (organization_id, other_organization_id), same_type | none (review RPC) |
| `public.organization_geographies` | (organization_id, scope, country_code) | listed partners: everyone; else members |
| `public.organization_occupations` | (organization_id, occupation_id) | as above |
| `public.organization_industries` | (organization_id, industry_code) | as above |
| `public.organization_languages` | (organization_id, language_code) | as above |
| `public.organization_service_types` | (organization_id, service) | as above |
| `public.workforce_availability` | id; organization_id, occupation_id, source_country, available, monthly_capacity, available_from, confirmed_at, reminded_at; unique (org, occupation, country); composite FKs to the occupation and source-country rows, so a listing is deleted with its profile entry | members all rows; signed-in non-members fresh rows of listed partners; anon none |
| `public.partner_licences` | id; organization_id, country_code, issuing_authority, licence_number, valid_until, evidence path/mime/size/scan status, confirmed_at, partner_terms_version, status | members (without evidence path); staff via RPC; never public or to employers [d2.6] |
| `audit.partner_document_access_log` | licence_id, organization_id, accessed_by, staff_role, purpose, accessed_at | none; append-only |
| `public.partner_review_decisions` | organization_id, decision, reason, info_step, decided_by, decided_at | none; append-only |
| `public.saved_items` | (organization_id, target_organization_id), kind, saved_by | members of the saving organisation |
| `public.follows` | (user_id, organization_id) | own rows |
| `private.follow_activity_outbox` | organization_id, entity_type, entity_id, title | none (digest job) |
| `stats.partner_searches` | kind, filter_names, destination_country, result_count | none; no personal columns |
| `billing.limit_keys`, `billing.feature_keys` | key, org_types, period, label | catalogue, everyone |
| `private.setting_rules` | key, value_type, min, max, editable | none (settings editor) |
| `private.profile_view_events` | (viewed_organization_id, viewer_organization_id, viewed_on) | none; retained 35 days |
| `private.org_analytics_daily` | organization_id, day, metric, country_code, occupation_id, value | via `public.v_org_analytics` (members, suppressed below `stats_min_count`) |
| `public.appeals` | moderation_action_id (unique), appellant_user_id, grounds, status, decided_by, reasons, lodged_at, due_at, decided_at | via RPCs |
| `public.data_export_requests` | user_id, status, requested_at, ready_at, expires_at, storage_path | own rows without the path |
| `private.notification_kinds` | kind, mandatory, default_email, audience, label | via `notification_kind_catalogue()` |

Storage: private buckets `partner-documents` (licence evidence, PDF/JPEG/PNG, 15 MB, through `document-url` and `scan-document`) and `dsar-exports` (signed link by `account-ops`).

### Release 2b

| Table | Key columns | Read access |
|---|---|---|
| `public.workforce_requirements` | id; organization_id, title, workers_needed, country_code, city_region, industry_code, skills, experience_years, start_date, duration_months, employment_type, salary range, accommodation, work_permit_support, visa_support, recruitment_preference, partner_need, status, visibility, show_identity, moderation_state, published_at, closes_on, close_reason, max_capacity_over_percent | employer members; partners only through job order RPCs; never workers or anon [d3.1] |
| `public.requirement_occupations` | (requirement_id, occupation_id), quantity | as the requirement |
| `public.requirement_countries` | (requirement_id, country_code) (multi-country needs the feature) | as the requirement |
| `public.requirement_versions` | requirement_id, version, changed_fields, old_values | employer members; append-only |
| `private.prohibited_terms` | pattern, label | none (discriminatory criteria check) |
| `public.saved_searches` | organization_id, kind, filters | members |
| `public.direct_hiring_rules` | source_country, destination_country (null = any), rule, notice, legal_opinion_ref; unique nulls not distinct | none (admin RPCs, `hiring_rule_notice`) |
| `private.requirement_reveals` | (requirement_id, organization_id), cause, revealed_at | none (employer name shown to a partner after invitation, shortlist or selection [d3.2]) |
| `public.requirement_invitations` | id; requirement_id, organization_id (partner), employer_organization_id, status, source, invited_by, timestamps, decline_reason; unique (requirement, partner) | members of either organisation |
| `public.partner_responses` | id; requirement_id, organization_id, employer_organization_id, invitation_id, status, version, capacity, available_from, notes, fee_model, fee_amount, fee_currency, decision fields, submissions_allowed, withdrawal fields; unique (requirement, partner) | partner members; employer members; never other partners |
| `public.partner_response_versions` | (response_id, version), payload, changed_fields | the two parties; append-only |
| `public.partner_response_documents` | id; organization_id, requirement_id, response_id (null while staged), storage_path, file_name, size, scan_status; max 5 per response | metadata to the two parties; files through a 60-second broker URL, logged |
| `public.candidate_submissions` | id; requirement_id, organization_id (partner), employer_organization_id, response_id, invited_email, worker_user_id, note, status, worker_approved_at, passport_share_id, profile_snapshot | partner members; employer members only after the candidate approved; the worker; email, worker id and snapshot only through RPCs |
| `public.submission_events` | submission_id, from_status, to_status, actor_id, note | employer and worker; partner sees stages only through an RPC |
| `public.submission_notes` | submission_id, organization_id (employer), author_id, body | employer members |

Storage: private bucket `partner-response-documents` (PDF, 15 MB, scanned).

### Release 2c

| Table | Key columns | Read access |
|---|---|---|
| `public.conversations` | id; context_type, context_id (unique together), requirement_id, last_message_at, read_only_reason | participants (`private.can_access_conversation`) |
| `public.conversation_participants` | conversation_id, organization_id or user_id | participants |
| `public.messages` | id; conversation_id, sender_user_id, sender_organization_id, kind, connection_id, body (1 to 4000 characters, text only [d5.2]) | participants; staff only the reported context [d5.5] |
| `public.conversation_reads` | (conversation_id, user_id), last_read_at, last_emailed_at | own row |
| `public.conversation_blocks` | conversation_id, blocked_by_user_id, blocked_by_organization_id | participants, without who blocked |
| `public.connections` | id; kind, from_organization_id, to_organization_id or to_user_id, conversation_id, requirement_id, job_id, status | members of either side, the addressed user |
| `public.contact_requests` | id; organization_id, worker_user_id, card_id, sent_by, message, job_id, destination_country, status | organisation members (no worker id); the worker |
| `public.worker_training`, `worker_employment_history`, `worker_preferred_industries`, `worker_preferred_employment_types` | owner rows with list limits | owner only |
| `private.worker_search_log` | organization_id, user_id, filter_names, result_count | none; 90 days |
| View `public.worker_search` | card fields only: card_id, headline, occupation, skills, experience, languages, availability, countries, training, history without employer names, preferred industries and employment types, updated_at | not granted; `search_workers` is the only path |

Realtime: Broadcast on private channels only, `conversation:<id>` and `user:<id>`, authorised by policies on `realtime.messages` that use the same helpers as the tables; polling fallback when disconnected.

## 7. RPCs, jobs and Edge Functions (summary)

Every RPC below is `security definer`, executable by `authenticated` only unless marked anon, and audited.

- **Partner registration and review (2a):** `create_organization` (changed), `submit_partner_for_review`, `admin_list_partner_reviews`, `admin_get_partner_review`, `admin_decide_partner`, `admin_set_organization_type`, `accept_employer_pays_commitment`, helpers `private.partner_commitment_current`, `private.partner_has_current_licence`.
- **Licences (2a):** `add_/update_/delete_partner_licence`, `partner_document_access_grant` (upload by owner/admin at aal2; read by verification reviewer or trust and safety at aal2, logged), `partner_document_set_scan_status` (service role), `admin_list_partner_licences`; daily job `partner-licence-expiry`.
- **Workforce profile (2a):** `set_organization_geographies`, `set_organization_workforce_offer`, `add_/update_/confirm_/delete_workforce_availability`; daily confirmation reminder job.
- **Discovery (2a):** `get_partner_profile` (anon), `search_partners` (anon, rate-limited, never ordered by plan [d1.1]), `search_available_workforce`, `get_company_page` (anon), `set_company_page_visibility`, `record_profile_view`, `toggle_saved_partner`, `toggle_follow`, `follower_count`, `list_saved_partners`, `list_followed_companies`; hourly follower digest job.
- **Plans and editor (2a):** `org_usage`, `record_limit_prompt`, `admin_update_plan`, `admin_set_plan_limit`, `admin_set_plan_feature`, `admin_set_limit_override`, `admin_remove_limit_override`, `admin_set_setting`, `admin_record_plan_price`, history reads; Edge Function `billing-plan-price` (provider `createPrice`, live only with the payment provider [d7.3]).
- **Notifications (2a):** `list_my_notifications`, `unread_notification_count`, `mark_notifications_read`, `notification_kind_catalogue`, `set_notification_preferences(p_kinds)`, `private.queue_org_event`; trigger broadcasting the unread count on `user:<id>`.
- **Moderation and compliance (2a):** `moderation_decide`, `submit_appeal`, `decide_appeal` (second reviewer), `admin_list_appeals`, `list_my_appeals`, `admin_set_retention_policy`, `admin_list_retention_policies`, `request_data_export`, service `account_ops_export_data`, `admin_network_counts`, `get_partner_dashboard`, `get_org_analytics`, `export_org_analytics`; daily aggregation job.
- **Requirements (2b):** `save_requirement`, `publish_requirement`, `set_requirement_status`, `extend_requirement`, `create_vacancies_from_requirement`, `suggest_partners` (reasons, no score [d1.1]), `search_employers`, `save_employer_search`; daily close and reminder jobs.
- **Job orders and responses (2b):** `list_job_orders`, `get_job_order`, `invite_partners`, `get_invitation`, `list_my_invitations`, `list_requirement_invitations`, `answer_invitation`, `withdraw_invitation`, `respond_to_invitation`, `update_response`, `withdraw_response`, `response_document_access_grant`, `compare_responses`, `get_response`, `list_my_responses`, `decide_response`, `set_submissions_allowed`; direct-hiring admin RPCs and `hiring_rule_notice` (anon).
- **Submissions (2b):** `submit_candidate` (same reply whether or not the address has an account), `list_my_submission_requests`, `approve_submission`, `decline_submission`, `withdraw_submission`, `set_submission_status`, `bulk_set_submission_status`, `add_submission_note`, `list_requirement_submissions`, `list_partner_submissions`, `list_my_submissions`; daily expiry job; `get_employer_network_dashboard`.
- **Messaging and Find Workers (2c):** `open_conversation`, `send_message` (per-user throttle, organisation monthly limit, workers never counted [d5.3]), `mark_conversation_read`, `my_unread_counts`, `list_conversations`, `list_messages`, `block_conversation`, `unblock_conversation`, `send_inquiry`, `request_workforce`, `invite_to_job`, `set_connection_status`, `admin_get_reported_message`, `set_worker_visibility`, `set_card_sections`, `my_card_preview`, `search_workers`, `send_contact_request`, `respond_to_contact_request`, `list_contact_requests_sent`, `list_contact_requests_received`; jobs for delayed message emails, conversation purge (24 months [d5.4]), visibility confirmation (yearly) and contact request expiry.

## 8. Plans and limits (seeded as data, prices excluding VAT, editable in the plan editor)

| Plan | Price | Responses / month | Submissions / month | Listings | Markets | Occupations | Members | Messages / month |
|---|---|---|---|---|---|---|---|---|
| Free (each partner type) | 0 | 0 | 0 | 0 | 3 | 10 | 0 | 0 |
| Basic | recruitment €49, staffing €59 | 10 | 25 | 10 | 3 | 10 | 1 | 100 |
| Professional | recruitment €99, staffing €129 | 50 | 100 | 50 | 10 | 30 | 5 | 500 |
| Enterprise | from €199 / €249, contact us | 200 | 500 | unlimited | unlimited | unlimited | 15 | 2000 |

Partner features: Basic `job_order_access`, `worker_search`, `employer_discovery`, `analytics_basic`; Professional adds `advanced_worker_search`, `advanced_employer_discovery`, `analytics_advanced`; Enterprise adds `analytics_enterprise`. Employer additions: `active_requirements` 3 / 15 / 50 (free 0), `partner_invitations_per_requirement` 3 / 10 / 25, `messages_per_month` 100 / 500 / 2000, features `worker_search`, `available_workforce_search` (all paid), `advanced_worker_search`, `advanced_partner_search`, `multi_country_requirements` (Professional and Enterprise). 30-day trial, one per legal entity across types [d2.3]. Prices reach the payment provider only when the provider account exists [d7.3].

## 9. Notifications

One catalogue (`private.notification_kinds`), one email template per kind in `apps/web/emails`, payloads with ids, titles and display names only (never message text, fee amounts or an anonymous employer's name).

- Mandatory: `partner_approved`, `partner_info_requested`, `partner_declined`, `submission_request` (and its no-account variant), `moderation_decision`, `data_export_ready`.
- Optional (email on by default unless noted): `licence_expiring`, `listing_confirmation_due`, `followed_company_activity`, `invitation_received`, `invitation_withdrawn`, `response_received`, `response_withdrawn`, `response_decided`, `submission_approved`, `submission_withdrawn`, `submission_stage_changed`, `requirement_changed`, `requirement_closing_soon`, `job_order_match` (off by default), `new_message` (delayed 15 minutes, one per conversation per window), `inquiry_received`, `workforce_request_received`, `job_invitation`, `contact_request_received`, `contact_request_decided`, `visibility_confirmation`.
- Organisation events go to accepted owners and admins; members only for conversations they take part in.

## 10. Privacy, retention and erasure

- Never public: legal name, identifier, identifier links, licences (or the words licensed or verified), review state, plan, member data, view counts, followers, stale listings.
- Job orders are anonymous by default; the employer name is revealed to one partner on invitation, shortlist or selection [d3.2].
- A partner never sees another partner's response, submission or count; the employer sees a candidate only after the candidate approved, and documents only through the employer's share, logged as `submission_review`; the partner never opens candidate documents.
- Find Workers shows a pseudonymous card; a name is revealed to one organisation only when the worker accepts a contact request; documents still need an application or submission share [d4.2, d4.4].
- Direct-hiring rules use the worker's current country, never nationality; the partner channel is always open [d4.5].
- Workers never pay [d2.7]: notices on worker pages and a prioritised fee-demand report category.
- Retention (only the 24-month message period is agreed [d5.4]; the rest are proposals, editable): conversations 730 days after the last message, responses, submissions and closed requirements 730, contact requests 365 (declines 90), licence evidence 30 after replacement, profile view events 35, analytics 730, data exports 7, closed appeals 365.
- Erasure of a worker deletes submissions and their shares, contact requests and sent messages, and pseudonymises participant rows and appeals. A company member's messages stay as organisation records labelled "Former member".
- Data export: `request_data_export` (one per 24 hours) builds a zip of Phase 1 and Phase 2 data with a 10-minute link, kept 7 days. Phase 1 has no export today, so it is built in 2a.
- A catalogue test fails when a table with a user id is not covered by erasure, retention or export.

## 11. Open points (default in force until CHARA answers)

1. Available-workforce supply formula: sum of fresh listings plus monthly capacity pro rata (FR-K3) in `search_available_workforce`; a single listing covering the quantity in `search_partners` and `suggest_partners`.
2. The employer-pays commitment belongs to the owner who accepted it; after an ownership transfer the new owner must accept again.
3. A closed requirement cannot reopen; a paused requirement cannot be filled.
4. Request workforce may invite a partner on a draft requirement; responses still need an open one.
5. A candidate may withdraw a submission after hired.
6. Licence check on responses: a rule `licensed_partner_required` for the requirement's country requires a current licence there (needs the legal opinion [d6.1]).
7. No platform rule against an employer hiring a submitted candidate outside the partner (Partner Terms [d6.2]).
8. Passport completeness weights change for the new sections.
9. Appeal window 6 months, decided by a second reviewer, 7-day target [d7.2].
10. Retention periods other than messages.
11. Network analytics page may move to Phase 3 if time is short.
12. Decision numbers quoted inside some acceptance criteria do not match the Decisions document; this file uses the Decisions document numbering.
