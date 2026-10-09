type SettingField = { key: string; label: string };

export type SettingRow = { label: string; value: string; mailto: string | null };

// Only a plain address becomes a link: no query string, no display name, nothing a setting could add to the message.
const EMAIL_PATTERN = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

// The rows a public page shows for some settings, in the order of the fields. A value that is missing, empty or only
// white space gives no row, so a page never has a label without a value. The text is not changed otherwise: the page
// escapes it.
export function settingRows(
  settings: Readonly<Record<string, string | undefined>>,
  fields: readonly SettingField[],
): SettingRow[] {
  return fields.flatMap(({ key, label }) => {
    const value = settings[key]?.trim();
    if (!value) return [];
    return [{ label, value, mailto: EMAIL_PATTERN.test(value) ? `mailto:${value}` : null }];
  });
}

export const IMPRINT_FIELDS: readonly SettingField[] = [
  { key: "legal_entity_name", label: "Legal entity" },
  { key: "legal_entity_address", label: "Address" },
  { key: "legal_entity_registration_number", label: "Registration number" },
  { key: "legal_entity_vat_id", label: "VAT ID" },
  { key: "legal_entity_email", label: "Email" },
];

export const CONTACT_FIELDS: readonly SettingField[] = [
  { key: "legal_entity_email", label: "Email" },
  { key: "privacy_contact", label: "Privacy contact" },
  { key: "data_protection_contact", label: "Data-protection contact" },
];

export const PRIVACY_FIELDS: readonly SettingField[] = CONTACT_FIELDS.slice(1);
