import { describe, expect, it } from "vitest";
import {
  canSuggestPartners,
  criteriaLists,
  destinationsText,
  latestConfirmation,
  noSuggestionsText,
  partnerKindText,
  suggestionCountText,
  suggestionPlanDisclosure,
  suggestionSentence,
  type OccupationCoverage,
  type Suggestion,
} from "@/lib/requirements/suggestions";

const germany = { code: "DE", name: "Germany" };

function welders(available: string | null, availableFrom: string | null = null, confirmedAt: string | null = null): OccupationCoverage {
  return { code: "7212", name: "Welders and flame cutters", quantity: 100, available, availableFrom, confirmedAt };
}

function row(over: Partial<Suggestion>): Suggestion {
  return {
    organizationId: "00000000-0000-0000-0000-000000000001",
    slug: "q1",
    displayName: "Q1 Recruitment",
    organizationType: "recruitment_company",
    alsoOffersStaffing: false,
    criteriaMet: [],
    criteriaNotMet: ["industry", "recruitment_type", "capacity", "available_before_start"],
    servedDestinations: [germany],
    matchingOccupations: [welders(null)],
    ...over,
  };
}

// The rows of FR-M3 AC4 as suggest_partners returns them.
const q1 = row({
  criteriaMet: ["industry", "recruitment_type", "capacity", "available_before_start"],
  criteriaNotMet: [],
  matchingOccupations: [welders("100–249", "2027-02-01", "2026-10-18T09:00:00+00:00")],
});
const q2 = row({ slug: "q2", matchingOccupations: [welders("50–99", "2026-11-01", "2026-10-23T09:00:00+00:00")] });
const q3 = row({ slug: "q3", criteriaMet: ["industry"], criteriaNotMet: ["recruitment_type", "capacity", "available_before_start"] });
const q4 = row({
  slug: "q4",
  criteriaMet: ["capacity"],
  criteriaNotMet: ["industry", "recruitment_type", "available_before_start"],
  matchingOccupations: [welders("250+", "2027-04-01", "2026-10-25T09:00:00+00:00")],
});
const noListing = row({ slug: "none" });

const everyText = (suggestion: Suggestion) => {
  const { met, notMet } = criteriaLists(suggestion);
  return [suggestionSentence(suggestion), partnerKindText(suggestion), ...met, ...notMet].join(" | ");
};

// FR-M3 AC8: the card sentence and the criteria in words, from the facts of the row only.
describe("the suggestion card wording (FR-M3 AC8)", () => {
  it("writes Q1's sentence with the date in words and the number of the row", () => {
    expect(suggestionSentence(q1)).toBe("Serves Germany, recruits Welders and flame cutters, 100–249 available from 1 February 2027");
  });

  it("writes the facts present for Q2, Q3 and Q4", () => {
    expect(suggestionSentence(q2)).toBe("Serves Germany, recruits Welders and flame cutters, 50–99 available from 1 November 2026");
    expect(suggestionSentence(q3)).toBe("Serves Germany, recruits Welders and flame cutters");
    expect(suggestionSentence(q4)).toBe("Serves Germany, recruits Welders and flame cutters, 250+ available from 1 April 2027");
  });

  it("says nothing about capacity for a row without a listing", () => {
    expect(suggestionSentence(noListing)).not.toMatch(/available|listing|\d/);
    expect(latestConfirmation(noListing)).toBeNull();
  });

  it("lists the criteria met and not met in words", () => {
    expect(criteriaLists(q1)).toEqual({
      met: [
        "Works in your industry",
        "Offers the type of recruitment you need",
        "Current listings cover the number of workers you need for every occupation",
        "Enough workers for every occupation are available by your start date",
      ],
      notMet: [],
    });
    expect(criteriaLists(q4)).toEqual({
      met: ["Current listings cover the number of workers you need for every occupation"],
      notMet: [
        "Does not list your industry",
        "Does not offer the type of recruitment you need",
        "Not enough workers for every occupation are available by your start date",
      ],
    });
  });

  it("never writes verified, match, score, recommended, a percentage or a plan name", () => {
    for (const suggestion of [q1, q2, q3, q4, noListing]) {
      expect(everyText(suggestion)).not.toMatch(/verified|match|score|recommended|%|basic|professional|enterprise|plan\b/i);
    }
  });

  it("names the coverage per occupation, and the occupations without a listing (decided, user delegated)", () => {
    const fitters = { code: "7214", name: "Structural-metal preparers and erectors", quantity: 50, available: null, availableFrom: null, confirmedAt: null };
    const several = row({
      servedDestinations: [germany, { code: "NL", name: "Netherlands" }],
      matchingOccupations: [welders("100–249", "2027-02-01", "2026-10-18T09:00:00+00:00"), fitters],
    });
    expect(suggestionSentence(several)).toBe(
      "Serves Germany and the Netherlands, recruits Welders and flame cutters and Structural-metal preparers and erectors, 100–249 Welders and flame cutters available from 1 February 2027; no listing for Structural-metal preparers and erectors",
    );
    const both = row({
      matchingOccupations: [welders("100–249", "2027-02-01", "2026-10-18T09:00:00+00:00"), { ...fitters, available: "50–99", availableFrom: "2027-01-10", confirmedAt: "2026-10-20T09:00:00+00:00" }],
    });
    expect(suggestionSentence(both)).toContain("100–249 Welders and flame cutters available from 1 February 2027; 50–99 Structural-metal preparers and erectors available from 10 January 2027");
    expect(latestConfirmation(both)).toBe("2026-10-20T09:00:00+00:00");
  });

  it("says supplies for a staffing company and names the kind of partner", () => {
    const staffing = row({ organizationType: "staffing_company" });
    expect(suggestionSentence(staffing)).toBe("Serves Germany, supplies Welders and flame cutters");
    expect(partnerKindText(staffing)).toBe("Staffing company");
    expect(partnerKindText(row({ alsoOffersStaffing: true }))).toBe("Recruitment company, also offers staffing");
    expect(partnerKindText(q1)).toBe("Recruitment company");
  });
});

describe("the suggestions page rules (FR-M3 AC6, AC10, AC11)", () => {
  it("suggests for draft, open and paused requirements that need partners only", () => {
    expect(canSuggestPartners("draft", "both")).toBe(true);
    expect(canSuggestPartners("open", "recruitment")).toBe(true);
    expect(canSuggestPartners("paused", "staffing")).toBe(true);
    expect(canSuggestPartners("closed", "both")).toBe(false);
    expect(canSuggestPartners("filled", "both")).toBe(false);
    expect(canSuggestPartners("open", "none")).toBe(false);
  });

  it("counts the suggestions and says when more partners fit", () => {
    expect(suggestionCountText(1, false)).toBe("1 partner suggested.");
    expect(suggestionCountText(50, true)).toBe("50 partners suggested. More partners fit; search the directories for the rest.");
  });

  it("names every destination and the partner types in the empty state", () => {
    const countries = [germany, { code: "NL", name: "Netherlands" }];
    expect(destinationsText(countries)).toBe("Germany or the Netherlands");
    expect(noSuggestionsText("recruitment", countries)).toBe("No listed recruitment partners serve Germany or the Netherlands for these occupations yet");
    expect(noSuggestionsText("staffing", [germany])).toBe("No listed staffing partners serve Germany for these occupations yet");
    expect(noSuggestionsText("both", [germany])).toBe("No listed recruitment or staffing partners serve Germany for these occupations yet");
  });

  it("discloses that two criteria use listings within the plan allowance and makes no claim that plans play no part", () => {
    expect(suggestionPlanDisclosure).toBe(
      "Nobody can pay for a higher place. Availability listings, which the capacity and start date criteria use, can be added only within the allowance of a partner's plan.",
    );
  });
});
