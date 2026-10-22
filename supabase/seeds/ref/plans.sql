-- Employer plans, limits and features (FR-G1; OPEN_QUESTIONS.md C1 to C3, C10, C11, C13, C16, D15). Prices are EUR
-- minor units, exclusive of VAT. Existing rows are never overwritten, so a value changed by a reviewed migration
-- survives a re-seed. A change to a seeded value is made in the same pull request in a migration (the live rows) and
-- in this file (a rebuilt database).
--
-- employer_professional (7900) is the price of the pricing source and is not confirmed by the owner (C10).
-- employer_enterprise has no price yet: it is not public, not sold and never sent to the payment provider (C10).
-- The display name Basic for employer_starter is open (C13); the plan code does not change.
-- free_employer is the fallback plan of an organization without a subscription: no open vacancies, no team members
-- besides the owner, no features, past applicants read-only (C11).

insert into billing.plans (code, org_type, name, price_minor, currency, interval, trial_days, is_public, is_default_trial, contact_sales, sort)
values
  ('free_employer', 'employer', 'Free', 0, 'EUR', 'month', 0, false, false, false, 0),
  ('employer_starter', 'employer', 'Basic', 3900, 'EUR', 'month', 30, true, true, false, 10),
  ('employer_professional', 'employer', 'Professional', 7900, 'EUR', 'month', 30, true, false, false, 20),
  ('employer_enterprise', 'employer', 'Enterprise', 0, 'EUR', 'month', 30, false, false, true, 30)
on conflict (code) do nothing;

insert into billing.plan_limits (plan_code, limit_key, limit_value)
values
  ('free_employer', 'active_jobs', 0),
  ('free_employer', 'members', 0),
  ('employer_starter', 'active_jobs', 3),
  ('employer_starter', 'members', 1),
  ('employer_professional', 'active_jobs', 15),
  ('employer_professional', 'members', 5),
  ('employer_enterprise', 'active_jobs', 50),
  ('employer_enterprise', 'members', 15)
on conflict (plan_code, limit_key) do nothing;

insert into billing.plan_features (plan_code, feature_key)
values
  ('employer_starter', 'shortlisting'),
  ('employer_professional', 'shortlisting'),
  ('employer_professional', 'analytics_advanced'),
  ('employer_enterprise', 'shortlisting'),
  ('employer_enterprise', 'analytics_advanced'),
  ('employer_starter', 'csv_export'),
  ('employer_professional', 'csv_export'),
  ('employer_enterprise', 'csv_export')
on conflict (plan_code, feature_key) do nothing;

-- Partner plans and the Phase 2 employer limits and features (FR-R1; docs/phase-2/DATA_MODEL.md section 8; decisions
-- 2.1 to 2.3, recommended defaults until CHARA answers). Migration 20261113100000_partner_plans.sql holds the same rows
-- and the catalogue billing.limit_keys and billing.feature_keys. Every plan has a row for every limit key of its type,
-- so a missing row never means unlimited. free_recruitment_company and free_staffing_company are the fallback plans:
-- a complete profile (3 countries served, 10 occupations) and no action. Enterprise is sold on request from the price
-- shown. Partner plans carry active_jobs 0: posting vacancies is not a partner function in Phase 2.

insert into billing.plans (code, org_type, name, price_minor, currency, interval, trial_days, is_public, is_default_trial, contact_sales, sort)
values
  ('free_recruitment_company', 'recruitment_company', 'Free', 0, 'EUR', 'month', 0, false, false, false, 100),
  ('recruitment_partner', 'recruitment_company', 'Basic', 4900, 'EUR', 'month', 30, true, false, false, 110),
  ('recruitment_professional', 'recruitment_company', 'Professional', 9900, 'EUR', 'month', 30, true, false, false, 120),
  ('recruitment_enterprise', 'recruitment_company', 'Enterprise', 19900, 'EUR', 'month', 30, true, false, true, 130),
  ('free_staffing_company', 'staffing_company', 'Free', 0, 'EUR', 'month', 0, false, false, false, 200),
  ('staffing_partner', 'staffing_company', 'Basic', 5900, 'EUR', 'month', 30, true, false, false, 210),
  ('staffing_professional', 'staffing_company', 'Professional', 12900, 'EUR', 'month', 30, true, false, false, 220),
  ('staffing_enterprise', 'staffing_company', 'Enterprise', 24900, 'EUR', 'month', 30, true, false, true, 230)
on conflict (code) do nothing;

insert into billing.plan_limits (plan_code, limit_key, limit_value)
values
  ('free_employer', 'active_requirements', 0),
  ('free_employer', 'partner_invitations_per_requirement', 0),
  ('free_employer', 'messages_per_month', 0),
  ('employer_starter', 'active_requirements', 3),
  ('employer_starter', 'partner_invitations_per_requirement', 3),
  ('employer_starter', 'messages_per_month', 100),
  ('employer_professional', 'active_requirements', 15),
  ('employer_professional', 'partner_invitations_per_requirement', 10),
  ('employer_professional', 'messages_per_month', 500),
  ('employer_enterprise', 'active_requirements', 50),
  ('employer_enterprise', 'partner_invitations_per_requirement', 25),
  ('employer_enterprise', 'messages_per_month', 2000),
  ('free_recruitment_company', 'active_jobs', 0),
  ('free_recruitment_company', 'members', 0),
  ('free_recruitment_company', 'markets', 3),
  ('free_recruitment_company', 'listed_occupations', 10),
  ('free_recruitment_company', 'workforce_listings', 0),
  ('free_recruitment_company', 'job_order_responses_per_month', 0),
  ('free_recruitment_company', 'candidate_submissions_per_month', 0),
  ('free_recruitment_company', 'messages_per_month', 0),
  ('recruitment_partner', 'active_jobs', 0),
  ('recruitment_partner', 'members', 1),
  ('recruitment_partner', 'markets', 3),
  ('recruitment_partner', 'listed_occupations', 10),
  ('recruitment_partner', 'workforce_listings', 10),
  ('recruitment_partner', 'job_order_responses_per_month', 10),
  ('recruitment_partner', 'candidate_submissions_per_month', 25),
  ('recruitment_partner', 'messages_per_month', 100),
  ('recruitment_professional', 'active_jobs', 0),
  ('recruitment_professional', 'members', 5),
  ('recruitment_professional', 'markets', 10),
  ('recruitment_professional', 'listed_occupations', 30),
  ('recruitment_professional', 'workforce_listings', 50),
  ('recruitment_professional', 'job_order_responses_per_month', 50),
  ('recruitment_professional', 'candidate_submissions_per_month', 100),
  ('recruitment_professional', 'messages_per_month', 500),
  ('recruitment_enterprise', 'active_jobs', 0),
  ('recruitment_enterprise', 'members', 15),
  ('recruitment_enterprise', 'markets', null),
  ('recruitment_enterprise', 'listed_occupations', null),
  ('recruitment_enterprise', 'workforce_listings', null),
  ('recruitment_enterprise', 'job_order_responses_per_month', 200),
  ('recruitment_enterprise', 'candidate_submissions_per_month', 500),
  ('recruitment_enterprise', 'messages_per_month', 2000),
  ('free_staffing_company', 'active_jobs', 0),
  ('free_staffing_company', 'members', 0),
  ('free_staffing_company', 'markets', 3),
  ('free_staffing_company', 'listed_occupations', 10),
  ('free_staffing_company', 'workforce_listings', 0),
  ('free_staffing_company', 'job_order_responses_per_month', 0),
  ('free_staffing_company', 'candidate_submissions_per_month', 0),
  ('free_staffing_company', 'messages_per_month', 0),
  ('staffing_partner', 'active_jobs', 0),
  ('staffing_partner', 'members', 1),
  ('staffing_partner', 'markets', 3),
  ('staffing_partner', 'listed_occupations', 10),
  ('staffing_partner', 'workforce_listings', 10),
  ('staffing_partner', 'job_order_responses_per_month', 10),
  ('staffing_partner', 'candidate_submissions_per_month', 25),
  ('staffing_partner', 'messages_per_month', 100),
  ('staffing_professional', 'active_jobs', 0),
  ('staffing_professional', 'members', 5),
  ('staffing_professional', 'markets', 10),
  ('staffing_professional', 'listed_occupations', 30),
  ('staffing_professional', 'workforce_listings', 50),
  ('staffing_professional', 'job_order_responses_per_month', 50),
  ('staffing_professional', 'candidate_submissions_per_month', 100),
  ('staffing_professional', 'messages_per_month', 500),
  ('staffing_enterprise', 'active_jobs', 0),
  ('staffing_enterprise', 'members', 15),
  ('staffing_enterprise', 'markets', null),
  ('staffing_enterprise', 'listed_occupations', null),
  ('staffing_enterprise', 'workforce_listings', null),
  ('staffing_enterprise', 'job_order_responses_per_month', 200),
  ('staffing_enterprise', 'candidate_submissions_per_month', 500),
  ('staffing_enterprise', 'messages_per_month', 2000)
on conflict (plan_code, limit_key) do nothing;

insert into billing.plan_features (plan_code, feature_key)
values
  ('employer_starter', 'available_workforce_search'),
  ('employer_starter', 'worker_search'),
  ('employer_professional', 'available_workforce_search'),
  ('employer_professional', 'worker_search'),
  ('employer_professional', 'advanced_partner_search'),
  ('employer_professional', 'advanced_worker_search'),
  ('employer_professional', 'multi_country_requirements'),
  ('employer_enterprise', 'available_workforce_search'),
  ('employer_enterprise', 'worker_search'),
  ('employer_enterprise', 'advanced_partner_search'),
  ('employer_enterprise', 'advanced_worker_search'),
  ('employer_enterprise', 'multi_country_requirements'),
  ('recruitment_partner', 'analytics_basic'),
  ('recruitment_partner', 'employer_discovery'),
  ('recruitment_partner', 'job_order_access'),
  ('recruitment_partner', 'worker_search'),
  ('recruitment_professional', 'advanced_employer_discovery'),
  ('recruitment_professional', 'advanced_worker_search'),
  ('recruitment_professional', 'analytics_advanced'),
  ('recruitment_professional', 'analytics_basic'),
  ('recruitment_professional', 'employer_discovery'),
  ('recruitment_professional', 'job_order_access'),
  ('recruitment_professional', 'worker_search'),
  ('recruitment_enterprise', 'advanced_employer_discovery'),
  ('recruitment_enterprise', 'advanced_worker_search'),
  ('recruitment_enterprise', 'analytics_advanced'),
  ('recruitment_enterprise', 'analytics_basic'),
  ('recruitment_enterprise', 'analytics_enterprise'),
  ('recruitment_enterprise', 'employer_discovery'),
  ('recruitment_enterprise', 'job_order_access'),
  ('recruitment_enterprise', 'worker_search'),
  ('staffing_partner', 'analytics_basic'),
  ('staffing_partner', 'employer_discovery'),
  ('staffing_partner', 'job_order_access'),
  ('staffing_partner', 'worker_search'),
  ('staffing_professional', 'advanced_employer_discovery'),
  ('staffing_professional', 'advanced_worker_search'),
  ('staffing_professional', 'analytics_advanced'),
  ('staffing_professional', 'analytics_basic'),
  ('staffing_professional', 'employer_discovery'),
  ('staffing_professional', 'job_order_access'),
  ('staffing_professional', 'worker_search'),
  ('staffing_enterprise', 'advanced_employer_discovery'),
  ('staffing_enterprise', 'advanced_worker_search'),
  ('staffing_enterprise', 'analytics_advanced'),
  ('staffing_enterprise', 'analytics_basic'),
  ('staffing_enterprise', 'analytics_enterprise'),
  ('staffing_enterprise', 'employer_discovery'),
  ('staffing_enterprise', 'job_order_access'),
  ('staffing_enterprise', 'worker_search')
on conflict (plan_code, feature_key) do nothing;
