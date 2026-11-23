import { describe, expect, it } from "vitest";
import { feeModelsByKind, termNeeded, termsLines } from "@/lib/responses/presentation";
import {
  emptyResponseForm,
  FEE_MODEL_FOR_KIND,
  LEVEL_NEEDS_LANGUAGE,
  responseFormSchema,
  TERM_REQUIRED,
  toResponseTermsArgs,
} from "@/lib/validation/response";
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
      assignmentWeeks: null,
    };
    expect(termsLines(terms, names)).toEqual([
      ["The fee includes", "Medical check"],
      ["Guarantee", "No guarantee"],
      ["Lead time", "1 week from selection to arrival"],
      ["Language", "German"],
      ["Experience, at least", "1 year"],
    ]);
    expect(termsLines(undefined, names)).toEqual([]);
    expect(termsLines(undefined, names, true).map(([, text]) => text)).toEqual(Array(7).fill("Not stated"));
  });

  it("checks the terms in the form and sends only the stated ones", () => {
    const schema = responseFormSchema({ maxCapacity: 100, kind: "both", today: "2026-11-23" });
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

  it("offers each kind of partner its own fee models and asks for the term its fee needs", () => {
    expect(feeModelsByKind.recruitment).toEqual(["fee_per_hire", "percent_first_year_salary", "on_request"]);
    expect(feeModelsByKind.staffing).toEqual(["hourly_rate", "monthly_rate", "on_request"]);
    expect(termNeeded("both", "on_request")).toBeNull();
    const base = { ...emptyResponseForm, capacity: "10", availableFrom: "2027-01-10", experienceNote: "x".repeat(40) };
    const errors = (kind: "recruitment" | "staffing", values: object) => {
      const result = responseFormSchema({ maxCapacity: 100, kind, today: "2026-11-23" }).safeParse({ ...base, ...values });
      return result.success ? {} : fieldErrors(result.error);
    };
    const hourly = { feeModel: "hourly_rate", feeAmount: "18", feeCurrency: "EUR" };
    const perHire = { feeModel: "fee_per_hire", feeAmount: "1500", feeCurrency: "EUR" };
    expect(errors("recruitment", { ...hourly, assignmentWeeks: "26" })).toEqual({ feeModel: FEE_MODEL_FOR_KIND });
    expect(errors("staffing", { ...perHire, guaranteeDays: "90" })).toEqual({ feeModel: FEE_MODEL_FOR_KIND });
    expect(errors("recruitment", perHire)).toEqual({ guaranteeDays: TERM_REQUIRED.guaranteeDays });
    expect(errors("staffing", hourly)).toEqual({ assignmentWeeks: TERM_REQUIRED.assignmentWeeks });
    expect(errors("recruitment", { ...perHire, guaranteeDays: "0" })).toEqual({});
    expect(errors("staffing", { feeModel: "on_request", assignmentWeeks: "12" })).toEqual({});
  });
});
