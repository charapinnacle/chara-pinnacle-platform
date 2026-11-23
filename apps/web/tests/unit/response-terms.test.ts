import { describe, expect, it } from "vitest";
import { termsLines } from "@/lib/responses/presentation";
import { emptyResponseForm, LEVEL_NEEDS_LANGUAGE, responseFormSchema, toResponseTermsArgs } from "@/lib/validation/response";
import { fieldErrors } from "@/lib/validation/sign-up";

const names = (code: string) => ({ de: "German", en: "English" })[code] ?? code;

describe("the skills and fee terms of a response", () => {
  it("writes only what the partner stated on the response page, and every row in a comparison", () => {
    const terms = {
      languageCode: "de",
      languageLevel: null,
      minExperienceYears: 1,
      certificates: null,
      feeIncludes: ["medical_check"],
      guaranteeDays: 0,
      leadTimeWeeks: 1,
    };
    expect(termsLines(terms, names)).toEqual([
      ["The fee includes", "Medical check"],
      ["Guarantee", "No guarantee"],
      ["Lead time", "1 week from selection to arrival"],
      ["Language", "German"],
      ["Experience, at least", "1 year"],
    ]);
    expect(termsLines(undefined, names)).toEqual([]);
    expect(termsLines(undefined, names, true).map(([, text]) => text)).toEqual(Array(6).fill("Not stated"));
  });

  it("checks the terms in the form and sends only the stated ones", () => {
    const schema = responseFormSchema({ maxCapacity: 100, today: "2026-11-23" });
    const base = {
      ...emptyResponseForm,
      capacity: "10",
      availableFrom: "2027-01-10",
      experienceNote: "x".repeat(40),
      feeModel: "on_request",
    };
    const levelOnly = schema.safeParse({ ...base, languageLevel: "B1" });
    expect(levelOnly.success ? {} : fieldErrors(levelOnly.error)).toEqual({ languageCode: LEVEL_NEEDS_LANGUAGE });
    const wrong = schema.safeParse({ ...base, guaranteeDays: "400", leadTimeWeeks: "0", minExperienceYears: "x" });
    expect(Object.keys(wrong.success ? {} : fieldErrors(wrong.error)).sort()).toEqual(["guaranteeDays", "leadTimeWeeks", "minExperienceYears"]);
    const parsed = schema.parse({ ...base, languageCode: "DE", languageLevel: "B2", feeIncludes: ["flights"], guaranteeDays: "60" });
    expect(toResponseTermsArgs(parsed)).toEqual({
      p_language_code: "de",
      p_language_level: "B2",
      p_min_experience_years: undefined,
      p_certificates: undefined,
      p_fee_includes: ["flights"],
      p_guarantee_days: 60,
      p_lead_time_weeks: undefined,
    });
  });
});
