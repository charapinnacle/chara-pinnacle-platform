import { describe, expect, it } from "vitest";
import {
  canSuggestPartners,
  criteriaLists,
  partnerKindText,
  suggestionCountText,
  suggestionSentence,
  type Suggestion,
} from "@/lib/requirements/suggestions";

const welders = { code: "7212", name: "Welders and flame cutters" };
const germany = { code: "DE", name: "Germany" };

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
    matchingOccupations: [welders],
    listing: null,
    ...over,
  };
}

// The rows of FR-M3 AC4 as suggest_partners returns them.
const q1 = row({
  criteriaMet: ["industry", "recruitment_type", "capacity", "available_before_start"],
  criteriaNotMet: [],
  listing: { occupation: welders.name, available: 120, availableFrom: "2027-02-01", confirmedAt: "2026-10-18T09:00:00+00:00" },
});
const q2 = row({
  slug: "q2",
  listing: { occupation: welders.name, available: 80, availableFrom: "2026-11-01", confirmedAt: "2026-10-23T09:00:00+00:00" },
});
const q3 = row({ slug: "q3", criteriaMet: ["industry"], criteriaNotMet: ["recruitment_type", "capacity", "available_before_start"] });
const q4 = row({
  slug: "q4",
  criteriaMet: ["capacity"],
  criteriaNotMet: ["industry", "recruitment_type", "available_before_start"],
  listing: { occupation: welders.name, available: 1200, availableFrom: "2027-04-01", confirmedAt: "2026-10-25T09:00:00+00:00" },
});
const noListing = row({ slug: "none", listing: null });

const everyText = (suggestion: Suggestion) => {
  const { met, notMet } = criteriaLists(suggestion);
  return [suggestionSentence(suggestion), partnerKindText(suggestion), ...met, ...notMet].join(" | ");
};

// FR-M3 AC8: the card sentence and the criteria in words, from the facts of the row only.
describe("the suggestion card wording (FR-M3 AC8)", () => {
  it("writes Q1's sentence with the date in words and the number of the row", () => {
    expect(suggestionSentence(q1)).toBe("Serves Germany, recruits Welders and flame cutters, 120 available from 1 February 2027");
  });

  it("writes the facts present for Q2, Q3 and Q4", () => {
    expect(suggestionSentence(q2)).toBe("Serves Germany, recruits Welders and flame cutters, 80 available from 1 November 2026");
    expect(suggestionSentence(q3)).toBe("Serves Germany, recruits Welders and flame cutters");
    expect(suggestionSentence(q4)).toBe("Serves Germany, recruits Welders and flame cutters, 1,200 available from 1 April 2027");
  });

  it("says nothing about capacity for a row without a listing", () => {
    expect(suggestionSentence(noListing)).not.toMatch(/available|\d/);
  });

  it("lists the criteria met and not met in words", () => {
    expect(criteriaLists(q1)).toEqual({
      met: [
        "Works in your industry",
        "Offers the type of recruitment you need",
        "A current listing covers the number of workers you need",
        "Workers available by your start date",
      ],
      notMet: [],
    });
    expect(criteriaLists(q4)).toEqual({
      met: ["A current listing covers the number of workers you need"],
      notMet: [
        "Does not list your industry",
        "Does not offer the type of recruitment you need",
        "No listing covering your need is available by your start date",
      ],
    });
  });

  it("never writes verified, match, score, recommended, a percentage or a plan name", () => {
    for (const suggestion of [q1, q2, q3, q4, noListing]) {
      expect(everyText(suggestion)).not.toMatch(/verified|match|score|recommended|%|basic|professional|enterprise|plan\b/i);
    }
  });

  it("names several destinations and occupations, the article of a country and the occupation of the listing", () => {
    const several = row({
      servedDestinations: [germany, { code: "NL", name: "Netherlands" }],
      matchingOccupations: [welders, { code: "7214", name: "Structural-metal preparers and erectors" }],
      listing: { occupation: welders.name, available: 120, availableFrom: "2027-02-01", confirmedAt: "2026-10-18T09:00:00+00:00" },
    });
    expect(suggestionSentence(several)).toBe(
      "Serves Germany and the Netherlands, recruits Welders and flame cutters and Structural-metal preparers and erectors, 120 available from 1 February 2027 (Welders and flame cutters)",
    );
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
});
