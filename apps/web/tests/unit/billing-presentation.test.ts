import { describe, expect, it } from "vitest";
import { checkoutDisclosures, daysText, formatPrice, priceLine, type SoldPlan } from "@/lib/billing/presentation";

const BASIC: SoldPlan = { code: "employer_starter", name: "Basic", priceMinor: 3900, currency: "EUR", interval: "month", trialDays: 30 };

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
