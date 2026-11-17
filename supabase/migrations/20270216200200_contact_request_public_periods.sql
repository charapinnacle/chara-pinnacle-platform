-- get_public_settings of 20270205100000_messaging_pages.sql with the contact request periods (V70): the organisation's
-- Contact requests page says from when it may ask a worker again after a declined, withdrawn or expired request.
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
    'response_documents_max', 'message_body_max_chars', 'contact_request_repeat_days', 'contact_request_decline_days',
    'contact_request_expiry_days'
  ])
$$;
