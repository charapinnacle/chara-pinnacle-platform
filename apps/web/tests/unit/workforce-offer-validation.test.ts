import { describe, expect, it, vi } from "vitest";
import { chosenCount } from "@/lib/chips";
import {
  fromServiceTypes,
  occupationNoun,
  recruitmentTypeLabels,
  toServiceTypes,
  workforceOfferSchema,
  type WorkforceOfferInput,
} from "@/lib/validation/workforce-offer";

vi.mock("server-only", () => ({}));

const { workforceOfferComplete, workforceOfferDefaults } = await import("@/lib/dal/workforce-offer");

const offer: WorkforceOfferInput = {
  occupations: ["7212", " 7126 ", "7212"],
  industries: ["c", "F"],
  languages: ["EN", "tl", "ar"],
  recruitmentType: "international",
  staffingService: false,
  staffingTypes: [],
  sizeBand: "",
  foundedYear: "",
};

const issues = (input: WorkforceOfferInput, type: "recruitment_company" | "staffing_company" = "recruitment_company") =>
  workforceOfferSchema(type)
    .safeParse(input)
    .error?.issues.map(({ path, message }) => [path.join("."), message]);

describe("What you offer (FR-K2)", () => {
  it("names the recruitment types in words a profile can show alone, never \"Both\"", () => {
    expect(recruitmentTypeLabels).toEqual({ local: "Local", international: "International", both: "Local and international" });
  });

  it("trims, cases and merges the codes as their code lists hold them (AC1, AC3)", () => {
    expect(workforceOfferSchema("recruitment_company").parse(offer)).toMatchObject({
      occupations: ["7212", "7126"],
      industries: ["C", "F"],
      languages: ["en", "tl", "ar"],
    });
  });

  it("asks for an occupation and the recruitment type; industries and languages are optional", () => {
    expect(issues({ ...offer, occupations: [], industries: [], languages: [], recruitmentType: "" })).toEqual([
      ["occupations", "Choose at least one occupation"],
      ["recruitmentType", "Choose a recruitment type"],
    ]);
  });

  it("refuses typed text in place of a code and a recruitment type outside the list (AC2, AC3, NFR-M3)", () => {
    expect(issues({ ...offer, occupations: ["xyz welding"], industries: ["25"], languages: ["xx1"], recruitmentType: "global" })).toEqual([
      ["occupations.0", "Choose from the list."],
      ["industries.0", "Choose from the list."],
      ["languages.0", "Choose from the list."],
      ["recruitmentType", "Choose a recruitment type"],
    ]);
  });

  it("requires a staffing type of a staffing company, and of a recruitment company that supplies staff (AC5)", () => {
    expect(issues(offer, "staffing_company")).toEqual([["staffingTypes", "Choose at least one staffing type"]]);
    expect(issues({ ...offer, staffingService: true })).toEqual([["staffingTypes", "Choose at least one staffing type"]]);
    expect(issues({ ...offer, staffingTypes: ["temporary"] }, "staffing_company")).toBeUndefined();
    expect(issues(offer)).toBeUndefined();
  });

  it("stores the staffing types of a staffing company, and staffing with its types for a recruitment company (AC5, AC6)", () => {
    expect(toServiceTypes("staffing_company", { staffingService: false, staffingTypes: ["temporary", "contract"] })).toEqual([
      "temporary",
      "contract",
    ]);
    expect(toServiceTypes("recruitment_company", { staffingService: true, staffingTypes: ["temporary", "permanent"] })).toEqual([
      "staffing",
      "temporary",
      "permanent",
    ]);
    expect(toServiceTypes("recruitment_company", { staffingService: false, staffingTypes: ["temporary"] })).toEqual([]);
    expect(fromServiceTypes(["permanent", "staffing", "temporary"])).toEqual({
      staffingService: true,
      staffingTypes: ["temporary", "permanent"],
    });
  });

  it("checks the founded year and accepts an empty one", () => {
    const year = new Date().getFullYear();
    expect(issues({ ...offer, foundedYear: "2019" })).toBeUndefined();
    expect(issues({ ...offer, foundedYear: "19" })).toEqual([["foundedYear", "Enter a year, for example 2015."]]);
    expect(issues({ ...offer, foundedYear: String(year + 1) })).toEqual([["foundedYear", `Enter a year between 1800 and ${year}.`]]);
    expect(issues({ ...offer, sizeBand: "huge" })).toEqual([["sizeBand", "Choose from the list."]]);
  });

  it("counts the occupation limit of the plan (AC10)", () => {
    expect(chosenCount(10, 10, occupationNoun)).toBe("10 of 10 occupations");
  });

  it("counts the offer as done with an occupation, the recruitment type and, for a staffing company, a staffing type", () => {
    const saved = {
      occupations: ["7212"],
      industries: [],
      languages: [],
      recruitmentType: "both" as const,
      serviceTypes: [],
      sizeBand: null,
      foundedYear: null,
    };
    expect(workforceOfferComplete("recruitment_company", saved)).toBe(true);
    expect(workforceOfferComplete("recruitment_company", { ...saved, recruitmentType: null })).toBe(false);
    expect(workforceOfferComplete("recruitment_company", { ...saved, occupations: [] })).toBe(false);
    expect(workforceOfferComplete("staffing_company", saved)).toBe(false);
    expect(workforceOfferComplete("staffing_company", { ...saved, serviceTypes: ["project"] })).toBe(true);
    expect(workforceOfferDefaults({ ...saved, serviceTypes: ["staffing", "project"], sizeBand: "1_49", foundedYear: 2001 })).toEqual({
      occupations: ["7212"],
      industries: [],
      languages: [],
      recruitmentType: "both",
      staffingService: true,
      staffingTypes: ["project"],
      sizeBand: "1_49",
      foundedYear: "2001",
    });
  });
});
