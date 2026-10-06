import { describe, expect, it } from "vitest";
import {
  formatJobCursor,
  jobFormSchema,
  parseJobCursor,
  toJobInsert,
  type JobFormInput,
} from "@/lib/validation/job";
import { fieldErrors } from "@/lib/validation/sign-up";

const valid: JobFormInput = {
  title: "Welder MIG/MAG",
  description: "d".repeat(120),
  occupation: "7212",
  industry: "C",
  country: "DE",
  city: "Hamburg",
  employmentType: "full_time",
  salaryMin: "2800",
  salaryMax: "3400",
  salaryCurrency: "EUR",
  salaryPeriod: "month",
  accommodation: true,
  visaSupport: true,
  recruitmentPreference: "both",
};

function errorsFor(values: Partial<Record<keyof JobFormInput, unknown>>): Record<string, string> {
  const result = jobFormSchema.safeParse({ ...valid, ...values });
  return result.success ? {} : fieldErrors(result.error);
}

describe("the vacancy form schema (FR-C1 AC2)", () => {
  it("accepts a complete vacancy", () => {
    expect(jobFormSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["title", "Enter the title."],
    ["description", "Enter the description."],
    ["occupation", "Select an occupation from the list."],
    ["industry", "Select an industry from the list."],
    ["country", "Select a country from the list."],
    ["city", "Enter the city."],
    ["employmentType", "Select an employment type."],
    ["recruitmentPreference", "Select a recruitment preference."],
  ] as const)("gives an error keyed to %s when it is empty", (field, message) => {
    expect(errorsFor({ [field]: "" })).toEqual({ [field]: message });
  });

  it.each([
    [4, false],
    [5, true],
    [120, true],
    [121, false],
  ])("checks a title of %i characters (accepted: %s)", (length, accepted) => {
    expect("title" in errorsFor({ title: "t".repeat(length) })).toBe(!accepted);
  });

  it("rejects a title of six spaces and trims the outer spaces of a title", () => {
    expect(errorsFor({ title: "      " })).toEqual({ title: "Enter the title." });
    expect(jobFormSchema.parse({ ...valid, title: "  Welder  " }).title).toBe("Welder");
  });

  it.each([
    [49, false],
    [50, true],
    [10_000, true],
    [10_001, false],
  ])("checks a description of %i characters (accepted: %s)", (length, accepted) => {
    expect("description" in errorsFor({ description: "d".repeat(length) })).toBe(!accepted);
  });

  it.each([
    [100, true],
    [101, false],
  ])("checks a city of %i characters (accepted: %s)", (length, accepted) => {
    expect("city" in errorsFor({ city: "c".repeat(length) })).toBe(!accepted);
  });

  it("keeps line breaks in a description but refuses control characters in it and elsewhere", () => {
    expect(errorsFor({ description: `${"a".repeat(30)}\r\n\t${"b".repeat(30)}` })).toEqual({});
    expect(errorsFor({ description: `${"a".repeat(60)}\u001b` })).toHaveProperty("description");
    expect(errorsFor({ title: "Weld\ner" })).toHaveProperty("title");
    expect(errorsFor({ city: "Ham\u0007burg" })).toHaveProperty("city");
    expect(errorsFor({ title: "Weld\u0085er" })).toHaveProperty("title");
    expect(errorsFor({ title: "Weld\u2028er", city: "Ham\u2029burg" })).toHaveProperty("title");
    expect(errorsFor({ city: "Ham\u2029burg" })).toHaveProperty("city");
  });

  it("counts characters as the database does, so an emoji is one character in every limit", () => {
    expect(errorsFor({ title: "\u{1F477}".repeat(3) })).toEqual({ title: "The title must have at least 5 characters." });
    expect(errorsFor({ title: "\u{1F477}".repeat(5) })).toEqual({});
    expect(errorsFor({ title: "\u{1F477}".repeat(120), city: "\u{1F3D7}".repeat(100) })).toEqual({});
    expect(errorsFor({ title: "\u{1F477}".repeat(121) })).toHaveProperty("title");
    expect(errorsFor({ description: "\u{1F477}".repeat(49) })).toHaveProperty("description");
    expect(errorsFor({ description: "\u{1F477}".repeat(50) })).toEqual({});
    expect(errorsFor({ description: "\u{1F477}".repeat(10_000) })).toEqual({});
    expect(errorsFor({ description: "\u{1F477}".repeat(10_001) })).toHaveProperty("description");
  });

  it("refuses an occupation that is not a four-digit code and normalises the industry and country codes", () => {
    expect(errorsFor({ occupation: "Welding xyz" })).toEqual({ occupation: "Select an occupation from the list." });
    const parsed = jobFormSchema.parse({ ...valid, industry: " c ", country: "de" });
    expect([parsed.industry, parsed.country]).toEqual(["C", "DE"]);
  });

  it("refuses an employment type, a recruitment preference and a pay period outside their lists", () => {
    expect(errorsFor({ employmentType: "gig" })).toEqual({ employmentType: "Select an employment type." });
    expect(errorsFor({ recruitmentPreference: "any" })).toEqual({ recruitmentPreference: "Select a recruitment preference." });
    expect(errorsFor({ salaryPeriod: "week" })).toHaveProperty("salaryPeriod");
  });

  it("defaults accommodation and visa support to false without being touched", () => {
    const { accommodation, visaSupport, ...untouched } = valid;
    expect([accommodation, visaSupport]).toEqual([true, true]);
    expect(jobFormSchema.parse(untouched)).toMatchObject({ accommodation: false, visaSupport: false });
  });
});

describe("the salary rules of the form schema (FR-C1 AC3)", () => {
  it("fails a minimum above the maximum on the minimum", () => {
    expect(errorsFor({ salaryMin: "3500", salaryMax: "3000" })).toEqual({
      salaryMin: "The minimum salary cannot be higher than the maximum.",
    });
  });

  it("accepts equal amounts and a range with only a maximum or only a minimum", () => {
    expect(errorsFor({ salaryMin: "3000", salaryMax: "3000" })).toEqual({});
    expect(errorsFor({ salaryMin: "", salaryMax: "3400" })).toEqual({});
    expect(errorsFor({ salaryMin: "2800", salaryMax: "" })).toEqual({});
  });

  it.each(["-1", "10000000", "2800.555", "abc", "1,5", "2800.", "1e3"])("fails the amount %s on the minimum", (amount) => {
    expect(Object.keys(errorsFor({ salaryMin: amount, salaryMax: "" }))).toEqual(["salaryMin"]);
  });

  it("accepts the largest amount and two decimals", () => {
    expect(errorsFor({ salaryMin: "", salaryMax: "9999999.99" })).toEqual({});
    expect(errorsFor({ salaryMin: "2800.5", salaryMax: "2800.50" })).toEqual({});
  });

  it("asks for a currency when an amount has none and for a period when it has none", () => {
    expect(errorsFor({ salaryCurrency: "" })).toEqual({ salaryCurrency: "Select a currency when you enter a salary." });
    expect(errorsFor({ salaryPeriod: "" })).toEqual({ salaryPeriod: "Select a pay period when you enter a salary." });
    expect(Object.keys(errorsFor({ salaryCurrency: "", salaryPeriod: "" })).sort()).toEqual(["salaryCurrency", "salaryPeriod"]);
  });

  it("accepts no amounts with no currency or period", () => {
    expect(errorsFor({ salaryMin: "", salaryMax: "", salaryCurrency: "", salaryPeriod: "" })).toEqual({});
  });
});

describe("the insert payload (FR-C1 AC2)", () => {
  const organizationId = "0a1b2c3d-0000-4000-8000-000000000001";

  it("maps the form to the columns the client may write", () => {
    expect(toJobInsert(jobFormSchema.parse(valid), organizationId)).toEqual({
      organization_id: organizationId,
      title: "Welder MIG/MAG",
      description: "d".repeat(120),
      occupation_id: "7212",
      industry_code: "C",
      country_code: "DE",
      city: "Hamburg",
      employment_type: "full_time",
      salary_min: 2800,
      salary_max: 3400,
      salary_currency: "EUR",
      salary_period: "month",
      accommodation: true,
      visa_support: true,
      recruitment_preference: "both",
    });
  });

  it("never carries a column the server owns, even when the input names it", () => {
    const parsed = jobFormSchema.parse({
      ...valid,
      status: "open",
      created_by: "someone",
      moderation_state: "hidden",
      posted_on_behalf_of_organization_id: organizationId,
      deleted_at: "2026-01-01T00:00:00Z",
      organization_id: "another",
    });
    const payload = toJobInsert(parsed, organizationId);
    for (const reserved of ["status", "created_by", "moderation_state", "posted_on_behalf_of_organization_id", "deleted_at"]) {
      expect(payload).not.toHaveProperty(reserved);
    }
    expect(payload.organization_id).toBe(organizationId);
  });

  it("sends no currency and no period without an amount, and null for an amount left empty", () => {
    const payload = toJobInsert(
      jobFormSchema.parse({ ...valid, salaryMin: "", salaryMax: "", salaryCurrency: "EUR", salaryPeriod: "year" }),
      organizationId,
    );
    expect(payload).toMatchObject({ salary_min: null, salary_max: null, salary_currency: null, salary_period: null });
    const oneAmount = toJobInsert(jobFormSchema.parse({ ...valid, salaryMin: "", salaryMax: "3400" }), organizationId);
    expect(oneAmount).toMatchObject({ salary_min: null, salary_max: 3400, salary_currency: "EUR", salary_period: "month" });
  });
});

describe("the list cursor", () => {
  const id = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
  const createdAt = "2026-10-06T10:00:00.123456+00:00";

  it("round-trips the creation time and the id", () => {
    expect(parseJobCursor(formatJobCursor({ createdAt, id }))).toEqual({ createdAt, id });
  });

  it.each([undefined, "", "x", `${createdAt}|`, `|${id}`, `not a date|${id}`, `${createdAt}|not-an-id`, `${createdAt}|${id}|extra`])(
    "treats %s as no cursor",
    (value) => {
      expect(parseJobCursor(value)).toBeNull();
    },
  );
});
