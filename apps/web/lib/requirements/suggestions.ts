import type { Database } from "@chara-pinnacle/db-types";
import { countryInSentence, formatCount, formatDate } from "@/lib/i18n/format";

type Enums = Database["public"]["Enums"];

// The ranking criteria of public.suggest_partners, in the order it names them (FR-M3 AC4, AC5).
export const suggestionCriteria = ["industry", "recruitment_type", "capacity", "available_before_start"] as const;
export type SuggestionCriterion = (typeof suggestionCriteria)[number];

type Named = { code: string; name: string };

export type Suggestion = {
  organizationId: string;
  slug: string;
  displayName: string;
  organizationType: Enums["organization_type"];
  alsoOffersStaffing: boolean;
  criteriaMet: SuggestionCriterion[];
  criteriaNotMet: SuggestionCriterion[];
  servedDestinations: Named[];
  matchingOccupations: Named[];
  // The best fresh listing of a requested occupation, null without one.
  listing: { occupation: string; available: number; availableFrom: string; confirmedAt: string } | null;
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
    met: "A current listing covers the number of workers you need",
    notMet: "No current listing covers the number of workers you need",
  },
  available_before_start: {
    met: "Workers available by your start date",
    notMet: "No listing covering your need is available by your start date",
  },
};

const listFormat = new Intl.ListFormat("en-GB", { type: "conjunction" });

// The sentence of a card from the facts of the row (FR-M3 AC7, AC8): the destinations served, the requested occupations
// listed and, only when the partner has a current listing, its number of workers and their date.
export function suggestionSentence(suggestion: Suggestion): string {
  const parts: string[] = [];
  if (suggestion.servedDestinations.length > 0) {
    parts.push(`Serves ${listFormat.format(suggestion.servedDestinations.map(({ code, name }) => countryInSentence(code, name)))}`);
  }
  if (suggestion.matchingOccupations.length > 0) {
    const verb = suggestion.organizationType === "staffing_company" ? "supplies" : "recruits";
    parts.push(`${verb} ${listFormat.format(suggestion.matchingOccupations.map(({ name }) => name))}`);
  }
  if (suggestion.listing) {
    const which = suggestion.matchingOccupations.length > 1 ? ` (${suggestion.listing.occupation})` : "";
    parts.push(`${formatCount(suggestion.listing.available)} available from ${formatDate(suggestion.listing.availableFrom)}${which}`);
  }
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
