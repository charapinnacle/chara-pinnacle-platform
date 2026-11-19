-- The release switches of releases 2b and 2c (FR-L5 AC2; docs/phase-2/DATA_MODEL.md section 1): release_job_orders,
-- release_candidate_submissions, release_messaging and release_find_workers, false until go-live, next to
-- release_partner_directories (2a). Each is public to read through get_public_settings, so the header menu, the sitemap
-- and the pricing page follow it, and changed only through the settings editor of FR-R2 (admin_set_setting: a Platform
-- Administrator at aal2, with a reason, audited as setting.changed). The editor refuses to switch one on while
-- private.legal_release_gaps names a document of its release feature: 2b puts job_orders live, 2c find_workers, as
-- scripts/check-go-live.mjs maps them.

insert into private.settings (key, value) values
  ('release_job_orders', 'false'),
  ('release_candidate_submissions', 'false'),
  ('release_messaging', 'false'),
  ('release_find_workers', 'false')
on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('release_job_orders', 'boolean', null, null, 'Release 2b: workforce requirements and job orders', 'job_orders'),
  ('release_candidate_submissions', 'boolean', null, null, 'Release 2b: candidate submissions', 'job_orders'),
  ('release_messaging', 'boolean', null, null, 'Release 2c: messaging', 'find_workers'),
  ('release_find_workers', 'boolean', null, null, 'Release 2c: Find Workers', 'find_workers');

-- The public settings of 20261124100000_workforce_availability.sql with the four release switches.
create or replace function public.get_public_settings() returns table (key text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.value #>> '{}'
  from private.settings s
  where s.key = any (array[
    'legal_entity_name', 'legal_entity_address', 'legal_entity_registration_number', 'legal_entity_vat_id',
    'legal_entity_email', 'privacy_contact', 'data_protection_contact', 'release_partner_directories',
    'partner_review_target_working_days', 'licence_number_patterns', 'licence_valid_until_max_years',
    'workforce_listing_stale_days', 'workforce_confirm_reminder_days', 'workforce_available_from_max_days',
    'release_job_orders', 'release_candidate_submissions', 'release_messaging', 'release_find_workers'
  ])
$$;

revoke all on function public.get_public_settings() from public, anon, authenticated, service_role;
grant execute on function public.get_public_settings() to anon, authenticated;
