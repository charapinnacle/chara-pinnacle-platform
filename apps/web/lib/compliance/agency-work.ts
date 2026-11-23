// The agency-work rules of a destination country (public.agency_work_rules), as the pages that ask a staffing company for
// workers show them.
export type AgencyWorkRule = {
  id: number;
  destination: string;
  nonEuWorkersOnly: boolean;
  title: string;
  notice: string;
  sourceUrl: string;
  reviewedOn: string;
};

// Citizens of the EU, the EEA and Switzerland move freely for work, so a rule about non-EU workers does not concern them.
const FREE_MOVEMENT = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH",
]);

export function outsideFreeMovement(country: string): boolean {
  return !FREE_MOVEMENT.has(country.toUpperCase());
}

// The rules for a destination. nonEuWorkers is false only when every worker is known to come from inside free movement
// (a staffing company that sources from those countries only); otherwise the non-EU rules are shown too.
export function agencyWorkRulesFor(
  rules: readonly AgencyWorkRule[],
  destination: string | null | undefined,
  nonEuWorkers = true,
): AgencyWorkRule[] {
  if (!destination) return [];
  const country = destination.toUpperCase();
  return rules.filter((rule) => rule.destination === country && (nonEuWorkers || !rule.nonEuWorkersOnly));
}
