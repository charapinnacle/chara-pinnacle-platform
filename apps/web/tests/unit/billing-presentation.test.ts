import { describe, expect, it } from "vitest";
import {
  checkoutDisclosures,
  daysText,
  formatPrice,
  planChanges,
  planFacts,
  priceLine,
  shortPriceLine,
  type SoldPlan,
} from "@/lib/billing/presentation";

const BASIC: SoldPlan = { code: "employer_starter", name: "Basic", priceMinor: 3900, currency: "EUR", interval: "month", trialDays: 30 };
const PROFESSIONAL: SoldPlan = { ...BASIC, code: "employer_professional", name: "Professional", priceMinor: 7900 };
const NO_DATES = { trialEndsAt: null, currentPeriodEnd: null, cancelAt: null, pastDueSince: null };

describe("prices", () => {
  it("shows minor units in the currency code, with a plain space", () => {
    expect(formatPrice(3900, "EUR")).toBe("EUR 39.00");
    expect(formatPrice(7905, "EUR")).toBe("EUR 79.05");
    expect(formatPrice(500, "JPY")).toBe("JPY 500");
  });

  it("says that the price excludes VAT and what it is for", () => {
    expect(priceLine(BASIC)).toBe("EUR 39.00 per month, excluding VAT");
  });

  it("counts days", () => {
    expect([daysText(1), daysText(14), daysText(30)]).toEqual(["1 day", "14 days", "30 days"]);
  });
});

describe("the disclosures before the redirect (FR-G2 AC2)", () => {
  it("states the five things for an organisation that is eligible for a trial", () => {
    expect(checkoutDisclosures(BASIC, false)).toEqual([
      { title: "Trial period", text: "30 days free, starting when you confirm your payment details." },
      { title: "Price after the trial", text: "EUR 39.00 per month, excluding VAT." },
      { title: "Billing frequency", text: "Billed every month." },
      {
        title: "Automatic conversion",
        text: "When the trial ends, your subscription converts to the paid Basic plan and your payment method is charged automatically.",
      },
      { title: "How to cancel", text: "Open Manage billing on the billing page and cancel before the trial ends, and you are not charged." },
    ]);
  });

  it("follows the trial length of the plan record", () => {
    expect(checkoutDisclosures({ ...BASIC, trialDays: 14 }, false)[0].text).toBe("14 days free, starting when you confirm your payment details.");
  });

  it("shows no trial period, and says the first payment is due at once, for a company that had its trial", () => {
    const items = checkoutDisclosures(BASIC, true);
    expect(items.map((item) => item.title)).toEqual(["Trial period", "Price", "Billing frequency", "Automatic conversion", "How to cancel"]);
    expect(items[0].text).toBe(
      "There is no free trial: a free trial has already been used for this company, so the first payment is due at once.",
    );
    expect(items.map((item) => item.text).join(" ")).not.toMatch(/30 days|trial ends/);
    expect(items[3].text).toBe("Your subscription starts as the paid Basic plan and renews automatically every month.");
  });

  it("shows no trial for a plan whose record has none", () => {
    expect(checkoutDisclosures({ ...BASIC, trialDays: 0 }, false)[0].text).toContain("no free trial");
  });
});

describe("the price on the billing page (FR-G5 AC4, AC9)", () => {
  it("shows the amount per period, excluding VAT", () => {
    expect(shortPriceLine(PROFESSIONAL)).toBe("EUR 79.00 per month excl. VAT");
  });
});

describe("the plan changes offered on the billing page (FR-G5 AC8)", () => {
  const sold = [BASIC, PROFESSIONAL];

  it("offers Professional to a Basic organisation as an upgrade and Basic to a Professional one as a downgrade", () => {
    expect(planChanges("employer_starter", sold).map(({ kind, label }) => [kind, label])).toEqual([["upgrade", "Upgrade to Professional"]]);
    expect(planChanges("employer_professional", sold).map(({ kind, label }) => [kind, label])).toEqual([["downgrade", "Downgrade to Basic"]]);
  });

  it("offers nothing to a plan that is not sold online, so that Enterprise is never offered or left", () => {
    expect(planChanges("employer_enterprise", sold)).toEqual([]);
    expect(planChanges("free_employer", sold)).toEqual([]);
    expect(planChanges("employer_starter", [BASIC])).toEqual([]);
  });

  it("offers neither an upgrade nor a downgrade for a plan at the same price or with another billing interval", () => {
    const sameFee: SoldPlan = { ...PROFESSIONAL, priceMinor: BASIC.priceMinor };
    const yearly: SoldPlan = { ...PROFESSIONAL, code: "employer_yearly", name: "Yearly", priceMinor: 99900, interval: "year" };
    expect(planChanges("employer_starter", [BASIC, sameFee, yearly])).toEqual([]);
  });
});

describe("the dates and amounts of a live subscription (FR-G5 AC4, AC5)", () => {
  it("shows the end of the trial and the first payment of a trialing subscription", () => {
    expect(planFacts({ ...NO_DATES, status: "trialing", trialEndsAt: "2026-11-04T09:30:00Z" }, BASIC)).toEqual([
      "Trial ends 4 Nov 2026",
      "First payment of EUR 39.00 excl. VAT on 4 Nov 2026",
    ]);
  });

  it("shows the next invoice date and the price of an active subscription", () => {
    expect(planFacts({ ...NO_DATES, status: "active", currentPeriodEnd: "2026-12-04T00:00:00Z" }, PROFESSIONAL)).toEqual([
      "Next invoice 4 Dec 2026",
      "EUR 79.00 per month excl. VAT",
    ]);
  });

  it("shows the failed payment and the end of the grace period, and no next invoice, when the payment is past due", () => {
    expect(
      planFacts({ ...NO_DATES, status: "past_due", pastDueSince: "2026-11-04T10:00:00Z", currentPeriodEnd: "2026-12-04T00:00:00Z" }, BASIC),
    ).toEqual(["Payment failed 4 Nov 2026", "Grace period ends 11 Nov 2026"]);
  });

  it("shows the end of a subscription that is set to end, and no next invoice", () => {
    expect(
      planFacts({ ...NO_DATES, status: "active", cancelAt: "2026-12-04T00:00:00Z", currentPeriodEnd: "2026-12-04T00:00:00Z" }, BASIC),
    ).toEqual(["Ends 4 Dec 2026"]);
    expect(planFacts({ ...NO_DATES, status: "trialing", trialEndsAt: "2026-11-04T00:00:00Z", cancelAt: "2026-11-04T00:00:00Z" }, BASIC)).toEqual([
      "Trial ends 4 Nov 2026",
      "Ends 4 Nov 2026",
    ]);
  });

  it("leaves the amount out for a plan that is not sold online", () => {
    expect(planFacts({ ...NO_DATES, status: "active", currentPeriodEnd: "2026-12-04T00:00:00Z" }, undefined)).toEqual(["Next invoice 4 Dec 2026"]);
    expect(planFacts({ ...NO_DATES, status: "trialing", trialEndsAt: "2026-11-04T00:00:00Z" }, undefined)).toEqual(["Trial ends 4 Nov 2026"]);
  });

  it("reads dates as UTC calendar days, not the day of the server", () => {
    expect(planFacts({ ...NO_DATES, status: "active", currentPeriodEnd: "2026-12-03T23:30:00-05:00" }, undefined)).toEqual(["Next invoice 4 Dec 2026"]);
  });

  it("says that the free plan applies to a paused subscription, with no next invoice", () => {
    expect(planFacts({ ...NO_DATES, status: "paused", currentPeriodEnd: "2026-12-04T00:00:00Z" }, BASIC)).toEqual([
      "Paused: the free plan applies until the subscription is resumed",
    ]);
  });
});
