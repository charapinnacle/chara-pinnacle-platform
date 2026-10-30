-- The response pages (FR-N2, FR-O2, V46, release 2b): what the pages need to read and no function of V44 or V45 answers.
--
-- The response form names the documents limit ("You can attach up to five documents") and checks the count before it
-- asks for an upload URL, so response_documents_max (decision 3.3, an administrator setting of V45) joins the public
-- settings. The employer's requirement page shows the capacity tolerance it set with set_requirement_capacity_tolerance
-- (FR-O2 AC4), so its members may read workforce_requirements.max_capacity_over_percent under the existing row policy (the
-- members of the requirement's organisation only); writing it stays with the function.

-- The public settings of 20261216100000_requirement_lifecycle.sql with the documents limit of a response.
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
    'release_job_orders', 'release_candidate_submissions', 'release_messaging', 'release_find_workers',
    'release_data_export', 'requirement_open_days', 'requirement_extension_days', 'requirement_closing_reminder_days',
    'response_documents_max'
  ])
$$;

grant select (max_capacity_over_percent) on public.workforce_requirements to authenticated;
