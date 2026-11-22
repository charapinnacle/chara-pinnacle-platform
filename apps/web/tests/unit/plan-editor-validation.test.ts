import { describe, expect, it } from "vitest";
import { historyValues } from "@/lib/admin/plan-history";
import {
  amountMinor,
  changeLine,
  expiryInstant,
  gapLines,
  isFutureDay,
  lowersPlanLimit,
  overrideFormSchema,
  planChanges,
  planFormSchema,
  planFormValues,
  priceChangeInputSchema,
  priceFormSchema,
  releaseWarning,
  ruleText,
  savePlanInputSchema,
  settingFormSchema,
  settingValueError,
  settingValueText,
  type EditorPlan,
} from "@/lib/validation/plan-editor";

const plan: EditorPlan = {
  code: "recruitment_partner",
  orgType: "recruitment_company",
  name: "Basic",
  priceMinor: 4900,
  currency: "EUR",
  trialDays: 30,
  isPublic: true,
  contactSales: false,
  limits: [
    { key: "job_order_responses_per_month", label: "Job order responses per month", period: "month", value: 10, defined: true },
    { key: "markets", label: "Countries served", period: "none", value: 3, defined: true },
    { key: "workforce_listings", label: "Workforce listings", period: "none", value: null, defined: true },
  ],
  features: [
    { key: "analytics_advanced", label: "Advanced analytics", enabled: false },
    { key: "job_order_access", label: "Job order access", enabled: true },
  ],
};

const reason = "Raise after first month of usage review";

function parse(overrides: Partial<ReturnType<typeof planFormValues>>) {
  return planFormSchema.parse({ ...planFormValues(plan), reason, ...overrides });
}

describe("the plan edit form (FR-R2 AC4, AC10)", () => {
  it("starts from the plan, with an unlimited limit as an empty value and the box ticked", () => {
    expect(planFormValues(plan)).toEqual({
      name: "Basic",
      isPublic: true,
      trialDays: "30",
      limits: {
        job_order_responses_per_month: { unlimited: false, value: "10" },
        markets: { unlimited: false, value: "3" },
        workforce_listings: { unlimited: true, value: "" },
      },
      features: { analytics_advanced: false, job_order_access: true },
      reason: "",
    });
  });

  it("asks for a reason of 10 to 500 characters", () => {
    const errors = (value: string) => planFormSchema.safeParse({ ...planFormValues(plan), reason: value }).error?.issues.map((issue) => issue.message);
    expect(errors("")).toEqual(["Give a reason of at least 10 characters."]);
    expect(errors("  short  ")).toEqual(["Give a reason of at least 10 characters."]);
    expect(errors("r".repeat(501))).toEqual(["The reason can have at most 500 characters."]);
    expect(errors("r".repeat(10))).toBeUndefined();
    expect(errors("r".repeat(500))).toBeUndefined();
  });

  it("refuses a limit outside 0 to 1,000,000 on the limit's own field, and trial days outside 0 to 365", () => {
    const issues = planFormSchema.safeParse({
      ...planFormValues(plan),
      reason,
      trialDays: "366",
      limits: { ...planFormValues(plan).limits, markets: { unlimited: false, value: "1000001" }, job_order_responses_per_month: { unlimited: false, value: "-1" } },
    }).error?.issues;
    expect(issues?.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["trialDays", "Enter a whole number of days from 0 to 365."],
      ["limits.job_order_responses_per_month.value", "Enter a whole number from 0 to 1,000,000."],
      ["limits.markets.value", "Enter a whole number from 0 to 1,000,000."],
    ]);
    expect(planFormSchema.safeParse({ ...planFormValues(plan), reason, trialDays: "0" }).success).toBe(true);
    expect(planFormSchema.safeParse({ ...planFormValues(plan), reason, trialDays: "365" }).success).toBe(true);
  });

  it("refuses an empty name and one of 61 characters", () => {
    expect(planFormSchema.safeParse({ ...planFormValues(plan), reason, name: "   " }).success).toBe(false);
    expect(planFormSchema.safeParse({ ...planFormValues(plan), reason, name: "n".repeat(61) }).success).toBe(false);
    expect(planFormSchema.safeParse({ ...planFormValues(plan), reason, name: "n".repeat(60) }).success).toBe(true);
  });
});

describe("the changes a plan edit makes (FR-R2 AC10)", () => {
  it("lists 'Job order responses per month: 10 -> 12' and sends that limit only", () => {
    const values = parse({ limits: { ...planFormValues(plan).limits, job_order_responses_per_month: { unlimited: false, value: "12" } } });
    const changes = planChanges(plan, values);
    expect(changes.lines.map(changeLine)).toEqual(["Job order responses per month: 10 -> 12"]);
    expect(changes).toMatchObject({ plan: null, limits: [{ key: "job_order_responses_per_month", value: 12, expected: 10 }], features: [] });
  });

  it("sends the plan row when the name, the visibility or the trial changes, with every line in dialog order", () => {
    const values = parse({
      name: "Basic Plus",
      isPublic: false,
      trialDays: "14",
      limits: { ...planFormValues(plan).limits, markets: { unlimited: true, value: "3" }, workforce_listings: { unlimited: false, value: "25" } },
      features: { analytics_advanced: true, job_order_access: false },
    });
    const changes = planChanges(plan, values);
    expect(changes.plan).toEqual({ name: "Basic Plus", isPublic: false, trialDays: 14, expected: { name: "Basic", isPublic: true, trialDays: 30 } });
    expect(changes.lines.map(changeLine)).toEqual([
      "Name: Basic -> Basic Plus",
      "Visibility: Public -> Not public",
      "Trial days: 30 -> 14",
      "Countries served: 3 -> Unlimited",
      "Workforce listings: Unlimited -> 25",
      "Advanced analytics: Off -> On",
      "Job order access: On -> Off",
    ]);
    expect(changes.limits).toEqual([
      { key: "markets", value: null, expected: 3 },
      { key: "workforce_listings", value: 25, expected: null },
    ]);
    expect(changes.features).toEqual([
      { key: "analytics_advanced", enabled: true, expected: false },
      { key: "job_order_access", enabled: false, expected: true },
    ]);
  });

  it("finds nothing to save when no value changed, and a limit without a row stays unlimited", () => {
    expect(planChanges(plan, parse({})).lines).toEqual([]);
    const undefinedRow = { ...plan, limits: [{ ...plan.limits[2], defined: false }] };
    expect(planChanges(undefinedRow, planFormSchema.parse({ ...planFormValues(undefinedRow), reason })).lines).toEqual([]);
  });

  it("is refused by the action input when nothing changes", () => {
    expect(savePlanInputSchema.safeParse({ code: "recruitment_partner", plan: null, limits: [], features: [], reason }).error?.issues[0]?.message).toBe(
      "Change at least one value.",
    );
    expect(savePlanInputSchema.safeParse({ code: "recruitment_partner", plan: null, limits: [{ key: "markets", value: 1_000_001, expected: 3 }], features: [], reason }).success).toBe(
      false,
    );
    expect(savePlanInputSchema.safeParse({ code: "recruitment_partner", plan: null, limits: [{ key: "markets", value: null, expected: 3 }], features: [], reason }).success).toBe(true);
  });
});

describe("overrides (FR-R2 AC5)", () => {
  const now = new Date("2026-10-26T12:00:00Z");

  it("warn when the value gives less than the plan, an unlimited plan included, and not before a value is typed", () => {
    expect(lowersPlanLimit(null, "40")).toBe(true);
    expect(lowersPlanLimit(50, "40")).toBe(true);
    expect(lowersPlanLimit(50, "50")).toBe(false);
    expect(lowersPlanLimit(50, "80")).toBe(false);
    expect(lowersPlanLimit(50, "")).toBe(false);
    expect(lowersPlanLimit(undefined, "1")).toBe(false);
  });

  it("take a day after today as the expiry, at the start of that day in UTC", () => {
    expect(isFutureDay("2026-10-27", now)).toBe(true);
    expect(isFutureDay("2026-10-26", now)).toBe(false);
    expect(isFutureDay("2026-02-30", now)).toBe(false);
    expect(isFutureDay("27.10.2026", now)).toBe(false);
    expect(expiryInstant("2027-01-24")).toBe("2027-01-24T00:00:00Z");
  });

  it("need an organisation, a limit, a value of 0 to 1,000,000 and a reason", () => {
    const issues = overrideFormSchema.safeParse({ organizationId: "", limitKey: "", value: "1000001", expiresOn: "2020-01-01", reason: "" }).error?.issues;
    expect(issues?.map((issue) => issue.path.join("."))).toEqual(["organizationId", "limitKey", "value", "expiresOn", "reason"]);
  });
});

describe("settings (FR-R2 AC7)", () => {
  const stats = { valueType: "integer", min: 5, max: 100 } as const;

  it("check the value against the type and range of the rule, as the database does", () => {
    expect(settingValueError(stats, "4")).toBe("Enter a whole number from 5 to 100");
    expect(settingValueError(stats, "5")).toBeNull();
    expect(settingValueError(stats, "20")).toBeNull();
    expect(settingValueError({ valueType: "integer", min: 1, max: 20 }, "three")).toBe("Enter a whole number from 1 to 20");
    expect(settingValueError({ valueType: "boolean", min: null, max: null }, "yes")).toBe("Choose on or off.");
    expect(settingValueError({ valueType: "boolean", min: null, max: null }, "true")).toBeNull();
    expect(settingValueError({ valueType: "email", min: null, max: null }, "legal@chara.example")).toBeNull();
    expect(settingValueError({ valueType: "email", min: null, max: null }, "not-an-address")).toBe("Enter an email address.");
    expect(settingValueError({ valueType: "text", min: 1, max: 5 }, "abcdef")).toBe("Enter 1 to 5 characters");
    expect(settingFormSchema(stats).safeParse({ value: "4", reason }).success).toBe(false);
  });

  it("say the value and the rule in words", () => {
    expect(settingValueText({ valueType: "boolean" }, "true")).toBe("On");
    expect(settingValueText({ valueType: "text" }, "")).toBe("Not set");
    expect(ruleText(stats)).toBe("A whole number from 5 to 100.");
    expect(ruleText({ valueType: "email", min: null, max: null })).toBe("An email address.");
  });

  it("name the documents that stop a release going live, and only when it is switched on", () => {
    expect(gapLines(["partner-terms:draft", "partner-dpa:missing"])).toEqual(["partner-terms: still a draft", "partner-dpa: not published"]);
  });

  it("warn before a release goes live while its legal documents are not approved, and only then", () => {
    const rule = { releaseFeature: "partner_accounts", releaseGaps: ["partner-terms:draft", "partner-dpa:missing"] };
    expect(releaseWarning(rule, "true")).toEqual(["partner-terms: still a draft", "partner-dpa: not published"]);
    expect(releaseWarning(rule, "false")).toEqual([]);
    expect(releaseWarning({ releaseFeature: null, releaseGaps: null }, "true")).toEqual([]);
    expect(releaseWarning({ ...rule, releaseGaps: [] }, "true")).toEqual([]);
  });
});

describe("the plan history values (FR-R2 AC11)", () => {
  it("show limits as numbers or Unlimited, features as On or Off and plan columns by value", () => {
    expect(historyValues({ table: "plan_limits", operation: "update", before: { limit_value: 10 }, after: { limit_value: 12 } })).toEqual({ from: "10", to: "12" });
    expect(historyValues({ table: "plan_limits", operation: "update", before: { limit_value: 10 }, after: { limit_value: null } })).toEqual({
      from: "10",
      to: "Unlimited",
    });
    expect(historyValues({ table: "plan_limits", operation: "insert", before: null, after: { plan_code: "x", limit_key: "markets", limit_value: 3 } })).toEqual({
      from: "Not set",
      to: "3",
    });
    expect(historyValues({ table: "plan_features", operation: "insert", before: null, after: {} })).toEqual({ from: "Off", to: "On" });
    expect(historyValues({ table: "plan_features", operation: "delete", before: {}, after: null })).toEqual({ from: "On", to: "Off" });
    expect(historyValues({ table: "plans", operation: "update", before: { name: "Basic" }, after: { name: "Basic Plus" } })).toEqual({ from: "Basic", to: "Basic Plus" });
    expect(historyValues({ table: "plans", operation: "update", before: { is_public: true, trial_days: 30 }, after: { is_public: false, trial_days: 14 } })).toEqual({
      from: "is_public: Public, trial_days: 30",
      to: "is_public: Not public, trial_days: 14",
    });
    expect(historyValues({ table: "plans", operation: "insert", before: null, after: { code: "x" } })).toEqual({ from: "None", to: "Created" });
  });
});

describe("the price change form (FR-R2 AC8)", () => {
  it("reads an amount in euros with at most two decimals as minor units from 1.00 to 100,000.00", () => {
    expect(amountMinor("54")).toBe(5400);
    expect(amountMinor(" 54.5 ")).toBe(5450);
    expect(amountMinor("54.05")).toBe(5405);
    expect(amountMinor("1.00")).toBe(100);
    expect(amountMinor("100000")).toBe(10_000_000);
    for (const value of ["0.99", "100000.01", "54.001", "54,00", "-54", "", "1e3", "EUR 54"]) {
      expect(amountMinor(value), value).toBeNull();
    }
  });

  it("refuses the current price, an amount out of range and a short reason", () => {
    const schema = priceFormSchema(4900);
    expect(schema.safeParse({ amount: "54.00", reason: "Price review after the first quarter" }).success).toBe(true);
    const errors = (amount: string, reasonText: string) =>
      schema.safeParse({ amount, reason: reasonText }).error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    expect(errors("49", "Price review after the first quarter")).toEqual(["amount: Enter a price other than the current one."]);
    expect(errors("0.50", "Price review")).toEqual(["amount: Enter an amount from 1.00 to 100,000.00, for example 54.00."]);
    expect(errors("54", "too short")).toEqual(["reason: Give a reason of at least 10 characters."]);
  });

  it("is checked again by the action input", () => {
    expect(priceChangeInputSchema.safeParse({ code: "recruitment_partner", priceMinor: 5400, reason: "Price review 2026" }).success).toBe(true);
    expect(priceChangeInputSchema.safeParse({ code: "recruitment_partner", priceMinor: 99, reason: "Price review 2026" }).success).toBe(false);
  });
});
