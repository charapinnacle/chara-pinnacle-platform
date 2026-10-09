-- The details of the legal entity that the public pages show (FR-H1; OPEN_QUESTIONS.md L1, L3): the Imprint, the Contact
-- page and the Privacy Policy read them from private.settings, so they change without a release. They are seeded empty
-- because the legal entity and the contacts are confirmed by CHARA later; a page leaves out an empty value, and the
-- go-live check (scripts/check-go-live.mjs) refuses to release while the main ones are empty.
--
-- private.settings stays closed to every API role. get_public_settings is the only way in for a visitor, and it returns
-- the seven keys below and no other key (limits, switches and thresholds are not public).

insert into private.settings (key, value) values
  ('legal_entity_name', '""'),
  ('legal_entity_address', '""'),
  ('legal_entity_registration_number', '""'),
  ('legal_entity_vat_id', '""'),
  ('legal_entity_email', '""'),
  ('privacy_contact', '""'),
  ('data_protection_contact', '""')
on conflict (key) do nothing;

create function public.get_public_settings() returns table (key text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.value #>> '{}'
  from private.settings s
  where s.key = any (array[
    'legal_entity_name', 'legal_entity_address', 'legal_entity_registration_number', 'legal_entity_vat_id',
    'legal_entity_email', 'privacy_contact', 'data_protection_contact'
  ])
  order by s.key
$$;

revoke all on function public.get_public_settings() from public, anon, authenticated, service_role;
grant execute on function public.get_public_settings() to anon, authenticated;
