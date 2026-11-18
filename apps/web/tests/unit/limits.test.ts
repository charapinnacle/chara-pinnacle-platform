import { describe, expect, it } from "vitest";
import type { PublicPlan } from "@/lib/billing/pricing";
import {
  GENERIC_LIMIT_MESSAGE,
  appliedLimit,
  limitErrorMessage,
  limitPrompt,
  limitRefusalMessage,
  planComparison,
  resetText,
  shownLimit,
  usageText,
  type OrgUsage,
} from "@/lib/billing/limits";

const GENERIC_ERROR = "We could not complete this request. Try again.";

function plan(code: string, name: string, limits: Record<string, number | null>): PublicPlan {
  return { code, name, priceMinor: 0, currency: "EUR", interval: "month", trialDays: 30, contactSales: false, limits, features: [] };
}

const recruitmentPlans = [
  plan("recruitment_partner", "Basic", { markets: 3, listed_occupations: 10, job_order_responses_per_month: 10 }),
  plan("recruitment_professional", "Professional", { markets: 10, listed_occupations: 30, job_order_responses_per_month: 50 }),
  plan("recruitment_enterprise", "Enterprise", { markets: null, listed_occupations: null, job_order_responses_per_month: 200 }),
];

const usage: OrgUsage = {
  planName: "Basic",
  items: {
    markets: { used: 3, limit: 3, applies: true, resetsAt: null },
    listed_occupations: { used: 4, limit: 10, applies: false, resetsAt: null },
    job_order_responses_per_month: { used: 10, limit: 10, applies: true, resetsAt: "2026-12-01T00:00:00+00:00" },
  },
};

describe("limit messages per organisation type (FR-R1 AC12)", () => {
  it("names a response limit after what each partner type answers", () => {
    const error = { message: "CHARA_LIMIT_REACHED", details: "job_order_responses_per_month" };
    expect(limitErrorMessage(error, "recruitment_company")).toBe("Your plan's limit of job order responses this month is reached.");
    expect(limitErrorMessage(error, "staffing_company")).toBe("Your plan's limit of responses to workforce requests this month is reached.");
  });

  it.each([
    ["markets", "countries served"],
    ["listed_occupations", "occupations listed"],
    ["workforce_listings", "workforce listings"],
    ["candidate_submissions_per_month", "candidate submissions this month"],
    ["members", "team members"],
  ])("maps %s to %s", (detail, words) => {
    expect(limitRefusalMessage(detail, "recruitment_company")).toBe(`Your plan's limit of ${words} is reached.`);
  });

  it("gives the generic limit message for an unknown or missing detail, and the generic error for anything else", () => {
    expect(limitRefusalMessage("no_such_key", "staffing_company")).toBe(GENERIC_LIMIT_MESSAGE);
    expect(limitRefusalMessage(null, "staffing_company")).toBe(GENERIC_LIMIT_MESSAGE);
    expect(limitErrorMessage({ message: "CHARA_LIMIT_REACHED", details: "no_such_key" }, "employer")).toBe(GENERIC_LIMIT_MESSAGE);
    const unexpected = { message: 'duplicate key value violates unique constraint "x"', details: "Key (id)=(1) exists." };
    expect(limitErrorMessage(unexpected, "recruitment_company")).toBe(GENERIC_ERROR);
  });

  it("never shows SQL text or a detail code", () => {
    for (const detail of ["markets", "job_order_responses_per_month", "no_such_key", "workforce_listings"]) {
      const message = limitErrorMessage({ message: "CHARA_LIMIT_REACHED", details: detail }, "staffing_company");
      expect(message).not.toMatch(/_|CHARA|SQL/);
    }
  });
});

describe("usage and reset text (FR-R1 AC11)", () => {
  it("counts in the words of the key, singular for a limit of one", () => {
    expect(usageText("markets", "recruitment_company", 2, 3)).toBe("2 of 3 countries served");
    expect(usageText("job_order_responses_per_month", "recruitment_company", 10, 10)).toBe("10 of 10 job order responses this month");
    expect(usageText("job_order_responses_per_month", "staffing_company", 1, 1)).toBe("1 of 1 response to workforce requests this month");
    expect(usageText("workforce_listings", "staffing_company", 1200, 1500)).toBe("1,200 of 1,500 workforce listings");
  });

  it("names the first of the next month in UTC", () => {
    expect(resetText("2026-12-01T00:00:00+00:00")).toBe("The count starts again on 1 December 2026.");
  });
});

describe("the upgrade prompt data", () => {
  it("gives the limit only when it applies", () => {
    expect(appliedLimit(usage, "markets")).toBe(3);
    expect(appliedLimit(usage, "listed_occupations")).toBeNull();
    expect(appliedLimit(usage, "members")).toBeNull();
  });

  it("builds the prompt with the plan, the reset date and the higher plans compared", () => {
    expect(limitPrompt(usage, "job_order_responses_per_month", "recruitment_company", recruitmentPlans)).toEqual({
      limitKey: "job_order_responses_per_month",
      used: 10,
      limit: 10,
      resetsAt: "2026-12-01T00:00:00+00:00",
      planName: "Basic",
      comparison: "Professional includes 50 job order responses this month; Enterprise includes 200 job order responses this month.",
    });
    expect(limitPrompt(usage, "markets", "recruitment_company", null)?.comparison).toBeNull();
    expect(limitPrompt(usage, "listed_occupations", "recruitment_company", recruitmentPlans)).toBeNull();
  });

  it("compares only the plans that allow more, and none when no plan does", () => {
    expect(planComparison(recruitmentPlans, "markets", "recruitment_company", 3)).toBe(
      "Professional includes 10 countries served; Enterprise has no limit.",
    );
    expect(planComparison(recruitmentPlans, "markets", "recruitment_company", 10)).toBe("Enterprise has no limit.");
    expect(planComparison(recruitmentPlans, "job_order_responses_per_month", "recruitment_company", 200)).toBeNull();
    expect(planComparison(recruitmentPlans, "members", "recruitment_company", 1)).toBeNull();
  });

  it("shows a members limit below 1 as the owner alone, which the team size counts (FR-R1 AC2, AC8)", () => {
    expect(shownLimit("members", 0)).toBe(1);
    expect(shownLimit("members", 1)).toBe(1);
    expect(shownLimit("members", 5)).toBe(5);
    expect(shownLimit("members", null)).toBeNull();
    expect(shownLimit("markets", 0)).toBe(0);
    expect(usageText("members", "recruitment_company", 1, shownLimit("members", 0) ?? 0)).toBe("1 of 1 team member");
  });
});
