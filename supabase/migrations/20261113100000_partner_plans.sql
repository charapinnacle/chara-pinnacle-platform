-- Partner plans and the limit and feature catalogue (FR-R1; docs/phase-2/DATA_MODEL.md sections 2, 4 and 8; decisions
-- 2.1, 2.2, 2.3). Recruitment and staffing companies get a fallback plan ('free_' || type, as private.org_plan_code
-- resolves it) and Basic, Professional and Enterprise plans; employer plans get the Phase 2 limit and feature rows. The
-- values are the recommended defaults until CHARA answers the decisions and stay data, changed by a reviewed migration
-- (later the plan editor).
--
-- The rows sell nothing yet: no partner organisation can be created (create_organization refuses every type but
-- employer), billing_checkout_start refuses a plan of another type than the organisation's, the pricing and billing
-- pages read employer plans only, and scripts/sync-stripe-plans.mjs mirrors employer plans only.

-- Every limit and feature key that a plan row may carry, and the organisation types it applies to. A plan of a type
-- has a row for every limit key of that type, so a missing row never means unlimited. Written by migrations only.
create table billing.limit_keys (
  key text primary key check (key ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and length(key) <= 64),
  org_types public.organization_type[] not null check (cardinality(org_types) > 0 and array_position(org_types, null) is null),
  period text not null check (period in ('none', 'month')),
  label text not null check (length(label) between 1 and 80 and label = btrim(label))
);

comment on table billing.limit_keys is
  'Catalogue of plan limit keys (FR-R1). period month: rows created since the first day of the calendar month in UTC count.';

create table billing.feature_keys (
  key text primary key check (key ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' and length(key) <= 64),
  org_types public.organization_type[] not null check (cardinality(org_types) > 0 and array_position(org_types, null) is null),
  label text not null check (length(label) between 1 and 80 and label = btrim(label))
);

comment on table billing.feature_keys is 'Catalogue of plan feature keys (FR-R1).';

alter table billing.limit_keys owner to billing_owner;
alter table billing.feature_keys owner to billing_owner;

alter table billing.limit_keys enable row level security;
alter table billing.limit_keys force row level security;
alter table billing.feature_keys enable row level security;
alter table billing.feature_keys force row level security;

revoke all on billing.limit_keys, billing.feature_keys from public, anon, authenticated, service_role;
grant select on billing.limit_keys, billing.feature_keys to anon, authenticated;

create policy limit_keys_all_billing_owner on billing.limit_keys
  for all to billing_owner using (true) with check (true);
create policy feature_keys_all_billing_owner on billing.feature_keys
  for all to billing_owner using (true) with check (true);
create policy limit_keys_select on billing.limit_keys
  for select to anon, authenticated using (true);
create policy feature_keys_select on billing.feature_keys
  for select to anon, authenticated using (true);

-- Partner plans carry active_jobs 0: posting vacancies is not a partner function in Phase 2, and vacancies are not
-- guarded by organisation type.
insert into billing.limit_keys (key, org_types, period, label)
values
  ('active_jobs', '{employer,recruitment_company,staffing_company}', 'none', 'Open vacancies'),
  ('members', '{employer,recruitment_company,staffing_company}', 'none', 'Team members'),
  ('messages_per_month', '{employer,recruitment_company,staffing_company}', 'month', 'Messages per month'),
  ('active_requirements', '{employer}', 'none', 'Active workforce requirements'),
  ('partner_invitations_per_requirement', '{employer}', 'none', 'Partner invitations per requirement'),
  ('markets', '{recruitment_company,staffing_company}', 'none', 'Countries served'),
  ('listed_occupations', '{recruitment_company,staffing_company}', 'none', 'Occupations listed'),
  ('workforce_listings', '{recruitment_company,staffing_company}', 'none', 'Workforce listings'),
  ('job_order_responses_per_month', '{recruitment_company,staffing_company}', 'month', 'Job order responses per month'),
  ('candidate_submissions_per_month', '{recruitment_company,staffing_company}', 'month', 'Candidate submissions per month');

insert into billing.feature_keys (key, org_types, label)
values
  ('shortlisting', '{employer}', 'Shortlisting'),
  ('csv_export', '{employer}', 'Applicant export'),
  ('available_workforce_search', '{employer}', 'Available workforce search'),
  ('advanced_partner_search', '{employer}', 'Advanced partner search'),
  ('multi_country_requirements', '{employer}', 'Multi-country requirements'),
  ('worker_search', '{employer,recruitment_company,staffing_company}', 'Worker search'),
  ('advanced_worker_search', '{employer,recruitment_company,staffing_company}', 'Advanced worker search'),
  ('analytics_advanced', '{employer,recruitment_company,staffing_company}', 'Advanced analytics'),
  ('job_order_access', '{recruitment_company,staffing_company}', 'Job order access'),
  ('employer_discovery', '{recruitment_company,staffing_company}', 'Employer discovery'),
  ('advanced_employer_discovery', '{recruitment_company,staffing_company}', 'Advanced employer discovery'),
  ('analytics_basic', '{recruitment_company,staffing_company}', 'Basic analytics'),
  ('analytics_enterprise', '{recruitment_company,staffing_company}', 'Enterprise analytics');

-- The plan rows, as in supabase/seeds/ref/plans.sql. Existing rows are never overwritten; a rebuilt database gets the
-- rows from the seed (the currencies they refer to are seeded too), and these statements add them to a database whose
-- plans exist already.
insert into billing.plans (code, org_type, name, price_minor, currency, interval, trial_days, is_public, is_default_trial, contact_sales, sort)
select v.code, v.org_type::public.organization_type, v.name, v.price_minor, 'EUR', 'month', v.trial_days, v.is_public, false, v.contact_sales, v.sort
from (values
  ('free_recruitment_company', 'recruitment_company', 'Free', 0, 0, false, false, 100),
  ('recruitment_partner', 'recruitment_company', 'Basic', 4900, 30, true, false, 110),
  ('recruitment_professional', 'recruitment_company', 'Professional', 9900, 30, true, false, 120),
  ('recruitment_enterprise', 'recruitment_company', 'Enterprise', 19900, 30, true, true, 130),
  ('free_staffing_company', 'staffing_company', 'Free', 0, 0, false, false, 200),
  ('staffing_partner', 'staffing_company', 'Basic', 5900, 30, true, false, 210),
  ('staffing_professional', 'staffing_company', 'Professional', 12900, 30, true, false, 220),
  ('staffing_enterprise', 'staffing_company', 'Enterprise', 24900, 30, true, true, 230)
) as v (code, org_type, name, price_minor, trial_days, is_public, contact_sales, sort)
where exists (select 1 from billing.plans p where p.code = 'free_employer')
on conflict (code) do nothing;

insert into billing.plan_limits (plan_code, limit_key, limit_value)
select v.plan_code, v.limit_key, v.limit_value
from (values
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
  ('employer_enterprise', 'messages_per_month', 2000)
) as v (plan_code, limit_key, limit_value)
join billing.plans p on p.code = v.plan_code
on conflict (plan_code, limit_key) do nothing;

insert into billing.plan_limits (plan_code, limit_key, limit_value)
select v.plan_code, v.limit_key, v.limit_value
from (values
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
) as v (plan_code, limit_key, limit_value)
join billing.plans p on p.code = v.plan_code
on conflict (plan_code, limit_key) do nothing;

insert into billing.plan_features (plan_code, feature_key)
select v.plan_code, v.feature_key
from (values
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
) as v (plan_code, feature_key)
join billing.plans p on p.code = v.plan_code
on conflict (plan_code, feature_key) do nothing;
