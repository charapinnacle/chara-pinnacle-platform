import type { Database } from "@chara-pinnacle/db-types";
import { countryInSentence, formatCount, formatDate } from "@/lib/i18n/format";

type Enums = Database["public"]["Enums"];

// The ranking criteria of public.suggest_partners, in the order it names them (FR-M3 AC4, AC5).
export const suggestionCriteria = ["industry", "recruitment_type", "capacity", "available_before_start"] as const;
export type SuggestionCriterion = (typeof suggestionCriteria)[number];

type Named = { code: string; name: string };

// A requested occupation the partner lists, with its quantity and the facts of the partner's fresh listings of it: the
// workers summed over its source countries, the latest available-from and confirmation among them; null without one.
export type OccupationCoverage = Named & {
  quantity: number;
  available: string | null;
  availableFrom: string | null;
  confirmedAt: string | null;
};

export type Suggestion = {
  organizationId: string;
  slug: string;
  displayName: string;
  organizationType: Enums["organization_type"];
  alsoOffersStaffing: boolean;
  criteriaMet: SuggestionCriterion[];
  criteriaNotMet: SuggestionCriterion[];
  servedDestinations: Named[];
  matchingOccupations: OccupationCoverage[];
};

// Partners are suggested for a requirement that needs them and is not final; a draft gets a preview (suggest_partners).
export function canSuggestPartners(status: Enums["requirement_status"], need: Enums["partner_need"]): boolean {
  return need !== "none" && status !== "closed" && status !== "filled";
}

// Each criterion in words, met and not met (FR-M3 AC7). No word of verification, matching, scoring or plans [d1.1].
export const criterionTexts: Record<SuggestionCriterion, { met: string; notMet: string }> = {
  industry: { met: "Works in your industry", notMet: "Does not list your industry" },
  recruitment_type: {
    met: "Offers the type of recruitment you need",
    notMet: "Does not offer the type of recruitment you need",
  },
  capacity: {
    met: "Current listings cover the number of workers you need for every occupation",
    notMet: "Current listings do not cover the number of workers you need for every occupation",
  },
  available_before_start: {
    met: "Enough workers for every occupation are available by your start date",
    notMet: "Not enough workers for every occupation are available by your start date",
  },
};

const listFormat = new Intl.ListFormat("en-GB", { type: "conjunction" });
const orFormat = new Intl.ListFormat("en-GB", { type: "disjunction" });

// The destination countries of a requirement in a sentence: "Germany or the Netherlands".
export function destinationsText(countries: readonly Named[]): string {
  return orFormat.format(countries.map(({ code, name }) => countryInSentence(code, name)));
}

const needTexts: Record<Exclude<Enums["partner_need"], "none">, string> = {
  recruitment: "recruitment partners",
  staffing: "staffing partners",
  both: "recruitment or staffing partners",
};

// What no suggestion means: no listed partner of the types the requirement asks for serves it for its occupations.
export function noSuggestionsText(need: Enums["partner_need"], countries: readonly Named[]): string {
  const partners = need === "none" ? "partners" : needTexts[need];
  return `No listed ${partners} serve ${destinationsText(countries)} for these occupations yet`;
}

// The facts of the listings (FR-M3 AC7, AC8; decided, user delegated): one occupation reads "120 available from 1
// February 2027"; several name each occupation with workers and those without a listing.
function coverageText(occupations: readonly OccupationCoverage[]): string | null {
  const listed = occupations.flatMap(({ name, available, availableFrom }) =>
    available !== null && availableFrom !== null ? [{ name, available, availableFrom }] : [],
  );
  if (listed.length === 0) return null;
  const several = occupations.length > 1;
  const counted = listed.map(
    (item) => `${item.available}${several ? ` ${item.name}` : ""} available from ${formatDate(item.availableFrom)}`,
  );
  const missing = occupations.filter(({ available }) => available === null).map(({ name }) => name);
  return [...counted, ...(missing.length > 0 ? [`no listing for ${listFormat.format(missing)}`] : [])].join("; ");
}

// The latest confirmation among the partner's fresh listings of the requested occupations, null without one.
export function latestConfirmation(suggestion: Suggestion): string | null {
  const dates = suggestion.matchingOccupations.flatMap(({ confirmedAt }) => (confirmedAt ? [confirmedAt] : []));
  return dates.length === 0 ? null : dates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
}

// The sentence of a card from the facts of the row (FR-M3 AC7, AC8): the destinations served, the requested occupations
// listed and, only when the partner has current listings, their workers and dates.
export function suggestionSentence(suggestion: Suggestion): string {
  const parts: string[] = [];
  if (suggestion.servedDestinations.length > 0) {
    parts.push(`Serves ${listFormat.format(suggestion.servedDestinations.map(({ code, name }) => countryInSentence(code, name)))}`);
  }
  if (suggestion.matchingOccupations.length > 0) {
    const verb = suggestion.organizationType === "staffing_company" ? "supplies" : "recruits";
    parts.push(`${verb} ${listFormat.format(suggestion.matchingOccupations.map(({ name }) => name))}`);
  }
  const coverage = coverageText(suggestion.matchingOccupations);
  if (coverage) parts.push(coverage);
  return parts.join(", ");
}

export function criteriaLists(suggestion: Suggestion): { met: string[]; notMet: string[] } {
  return {
    met: suggestion.criteriaMet.map((name) => criterionTexts[name].met),
    notMet: suggestion.criteriaNotMet.map((name) => criterionTexts[name].notMet),
  };
}

export function partnerKindText(suggestion: Suggestion): string {
  if (suggestion.organizationType === "staffing_company") return "Staffing company";
  return suggestion.alsoOffersStaffing ? "Recruitment company, also offers staffing" : "Recruitment company";
}

export function suggestionCountText(count: number, more: boolean): string {
  const shown = `${formatCount(count)} ${count === 1 ? "partner" : "partners"} suggested`;
  return more ? `${shown}. More partners fit; search the directories for the rest.` : `${shown}.`;
}

// The disclosure of P2B Regulation article 5(3) (decided, user delegated): the order reads no payment, but two criteria
// use availability listings, which a partner adds only within the allowance of its plan (billing.plan_limits
// workforce_listings). Worded without plan names so that it stays true when the allowances change.
export const suggestionPlanDisclosure =
  "Nobody can pay for a higher place. Availability listings, which the capacity and start date criteria use, can be added only within the allowance of a partner's plan.";
