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
  ('employer_enterprise', 'analytics_advanced')
on conflict (plan_code, feature_key) do nothing;
