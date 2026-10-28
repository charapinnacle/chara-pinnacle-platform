// The fields of a workforce requirement that partners are shown, as private.requirement_change_fields lists them (the
// order of the form), with the names the change history, the change notices and their emails use (FR-M2 step Edit).
// Shared by the emails of the notify function, so it imports nothing.
export const requirementChangeFieldLabels = {
  title: "Title",
  workers_needed: "Number of workers",
  occupations: "Occupations",
  country_code: "Country",
  countries: "Further destination countries",
  city_region: "City or region",
  industry_code: "Industry",
  skills: "Skills",
  experience_years: "Experience",
  start_date: "Start date",
  duration_months: "Project duration",
  employment_type: "Employment type",
  salary_min: "Salary minimum",
  salary_max: "Salary maximum",
  salary_currency: "Currency",
  salary_period: "Pay period",
  accommodation: "Accommodation",
  work_permit_support: "Work permit support",
  visa_support: "Visa support",
  recruitment_preference: "Recruitment preference",
  partner_need: "Workforce partners",
  closes_on: "Closing date",
} as const;

export type RequirementChangeField = keyof typeof requirementChangeFieldLabels;

export function isRequirementChangeField(value: unknown): value is RequirementChangeField {
  return typeof value === "string" && Object.hasOwn(requirementChangeFieldLabels, value);
}

// The known fields of a payload or version, in the order given, without repeats; anything else is dropped.
export function changeFields(value: unknown): RequirementChangeField[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isRequirementChangeField))];
}

// "Number of workers", "Number of workers and Occupations", "Title, Number of workers and Occupations"; undefined when
// no known field is named.
export function changedFieldsText(value: unknown): string | undefined {
  const labels = changeFields(value).map((field) => requirementChangeFieldLabels[field]);
  if (labels.length === 0) return undefined;
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
