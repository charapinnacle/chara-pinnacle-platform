// The plan limit and the plan feature of workforce requirements (FR-M4): the names the database refuses with and the
// words the pages use for the feature.
export const ACTIVE_REQUIREMENTS = "active_requirements";
export const MULTI_COUNTRY_FEATURE = "multi_country_requirements";

// Up to 10 destinations: the main country and 9 more, as save_requirement allows.
export const ADDITIONAL_COUNTRIES_MAX = 9;

// "Several destination countries are available on Professional."
export function multiCountryText(planName: string | null): string {
  return `Several destination countries are available on ${planName ?? "a higher plan"}.`;
}
