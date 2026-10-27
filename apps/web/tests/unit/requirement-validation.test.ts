import { describe, expect, it } from "vitest";
import {
  emptyRequirementForm,
  requirementFormSchema,
  toRequirementArgs,
  type RequirementFormInput,
} from "@/lib/validation/requirement";
import { fieldErrors } from "@/lib/validation/sign-up";

const TODAY = "2026-10-27";
const schema = requirementFormSchema(TODAY);

// The requirement of FR-M1 AC1, with the industry as its ISIC section (DATA_MODEL.md section 2).
const valid: RequirementFormInput = {
  title: "",
  workersNeeded: "100",
  country: "DE",
  cityRegion: "Hamburg",
  industry: "C",
  occupations: [
    { occupation: "7212", quantity: "80" },
    { occupation: "7214", quantity: "20" },
  ],
  skills: "MIG/MAG welding, blueprint reading",
  experienceYears: "2",
  startDate: "2027-03-01",
  durationMonths: "12",
  employmentType: "full_time",
  salaryMin: "2800",
  salaryMax: "3400",
  salaryCurrency: "EUR",
  salaryPeriod: "month",
  accommodation: true,
  workPermitSupport: true,
  visaSupport: true,
  recruitmentPreference: "international",
  partnerNeed: "both",
};

function errorsFor(values: Partial<Record<keyof RequirementFormInput, unknown>>): Record<string, string> {
  const result = schema.safeParse({ ...valid, ...values });
  return result.success ? {} : fieldErrors(result.error);
}

describe("the requirement form schema (FR-M1 AC2)", () => {
  it("accepts the requirement of AC1", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["workersNeeded", "Enter the number of workers."],
    ["country", "Select a country from the list."],
    ["cityRegion", "Enter the city or region."],
    ["industry", "Select an industry from the list."],
    ["startDate", "Enter the start date."],
    ["employmentType", "Select an employment type."],
    ["recruitmentPreference", "Select a recruitment preference."],
    ["partnerNeed", "Choose whether you need workforce partners."],
  ] as const)("gives an error keyed to %s when it is empty", (field, message) => {
    expect(errorsFor({ [field]: "" })).toEqual({ [field]: message });
  });

  it("keys an empty occupation row to its fields and an empty list to the list", () => {
    expect(errorsFor({ occupations: [{ occupation: "", quantity: "" }] })).toEqual({
      "occupations.0.occupation": "Select an occupation from the list.",
      "occupations.0.quantity": "Enter how many workers of this occupation you need.",
    });
    expect(errorsFor({ occupations: [] })).toEqual({ occupations: "Add at least one occupation." });
  });

  it("rejects every required field of an empty form", () => {
    const result = schema.safeParse(emptyRequirementForm);
    expect(result.success).toBe(false);
    expect(Object.keys(fieldErrors(result.error!)).sort()).toEqual(
      [
        "cityRegion",
        "country",
        "employmentType",
        "industry",
        "occupations.0.occupation",
        "occupations.0.quantity",
        "partnerNeed",
        "recruitmentPreference",
        "startDate",
        "workersNeeded",
      ].sort(),
    );
  });

  it.each([
    ["0", false],
    ["1", true],
    ["100000", true],
    ["100001", false],
  ])("checks %s workers (accepted: %s)", (workers, accepted) => {
    const occupations = [{ occupation: "7212", quantity: workers }];
    expect("workersNeeded" in errorsFor({ workersNeeded: workers, occupations })).toBe(!accepted);
  });

  it("refuses quantities that do not add up to the workers, on the occupations", () => {
    expect(errorsFor({ occupations: [{ occupation: "7212", quantity: "80" }, { occupation: "7214", quantity: "10" }] })).toEqual({
      occupations: "Quantities must add up to 100.",
    });
  });

  it("refuses 11 occupations and the same occupation twice", () => {
    const eleven = Array.from({ length: 11 }, (_, index) => ({ occupation: String(7211 + index), quantity: index === 0 ? "90" : "1" }));
    expect(errorsFor({ occupations: eleven })).toEqual({ occupations: "Add at most 10 occupations." });
    expect(errorsFor({ occupations: [{ occupation: "7212", quantity: "50" }, { occupation: "7212", quantity: "50" }] })).toEqual({
      "occupations.1.occupation": "This occupation is already listed.",
    });
  });

  it.each([
    ["2026-10-26", "The start date cannot be in the past."],
    ["2026-10-27", null],
    ["2029-10-27", null],
    ["2029-10-28", "Choose a start date within the next 3 years."],
    ["2027-02-30", "Choose a valid date."],
  ])("checks a start date of %s", (startDate, message) => {
    expect(errorsFor({ startDate })).toEqual(message ? { startDate: message } : {});
  });

  it.each([
    ["0", false],
    ["1", true],
    ["120", true],
    ["121", false],
    ["", true],
  ])("checks a duration of %s months (accepted: %s)", (durationMonths, accepted) => {
    expect("durationMonths" in errorsFor({ durationMonths })).toBe(!accepted);
  });

  it.each([
    ["-1", false],
    ["0", true],
    ["50", true],
    ["51", false],
    ["", true],
  ])("checks %s years of experience (accepted: %s)", (experienceYears, accepted) => {
    expect("experienceYears" in errorsFor({ experienceYears })).toBe(!accepted);
  });

  it("applies the salary rules of FR-C1", () => {
    expect(errorsFor({ salaryMin: "3500", salaryMax: "3000" })).toEqual({
      salaryMin: "The minimum salary cannot be higher than the maximum.",
    });
    expect(errorsFor({ salaryCurrency: "", salaryPeriod: "" })).toEqual({
      salaryCurrency: "Select a currency when you enter a salary.",
      salaryPeriod: "Select a pay period when you enter a salary.",
    });
    expect(errorsFor({ salaryMin: "", salaryMax: "", salaryCurrency: "", salaryPeriod: "" })).toEqual({});
  });

  it("bounds skills to 1,000 and the city or region to 100 characters", () => {
    expect("skills" in errorsFor({ skills: "s".repeat(1000) })).toBe(false);
    expect(errorsFor({ skills: "s".repeat(1001) })).toEqual({ skills: "The skills must have 1,000 characters or fewer." });
    expect("cityRegion" in errorsFor({ cityRegion: "c".repeat(100) })).toBe(false);
    expect(errorsFor({ cityRegion: "c".repeat(101) })).toEqual({ cityRegion: "The city or region must have 100 characters or fewer." });
  });

  it("has no field for a personal characteristic", () => {
    expect(Object.keys(schema.shape).filter((key) => /gender|sex|age|birth|nationality|religion|marital|ethnic|photo|idNumber/i.test(key))).toEqual([]);
  });
});

describe("the payload of save_requirement (FR-M1 AC2)", () => {
  it("maps the form and never carries status, created_by, organization_id or published_at", () => {
    const input = { ...valid, status: "open", created_by: "x", organization_id: "y", published_at: "z" };
    const args = toRequirementArgs(schema.parse(input));
    expect(args).toEqual({
      p_title: undefined,
      p_workers_needed: 100,
      p_country_code: "DE",
      p_city_region: "Hamburg",
      p_industry_code: "C",
      p_occupations: [
        { occupation_id: "7212", quantity: 80 },
        { occupation_id: "7214", quantity: 20 },
      ],
      p_skills: "MIG/MAG welding, blueprint reading",
      p_experience_years: 2,
      p_start_date: "2027-03-01",
      p_duration_months: 12,
      p_employment_type: "full_time",
      p_salary_min: 2800,
      p_salary_max: 3400,
      p_salary_currency: "EUR",
      p_salary_period: "month",
      p_accommodation: true,
      p_work_permit_support: true,
      p_visa_support: true,
      p_recruitment_preference: "international",
      p_partner_need: "both",
    });
    expect(JSON.stringify(args)).not.toMatch(/status|created_by|organization_id|published_at|p_org/);
  });

  it("leaves out empty optional values and a currency without an amount", () => {
    const args = toRequirementArgs(
      schema.parse({ ...valid, title: " Welders ", skills: "", experienceYears: "", durationMonths: "", salaryMin: "", salaryMax: "" }),
    );
    expect(args).toMatchObject({ p_title: "Welders", p_skills: undefined, p_experience_years: undefined, p_duration_months: undefined });
    expect(args.p_salary_currency).toBeUndefined();
    expect(args.p_salary_period).toBeUndefined();
  });
});
