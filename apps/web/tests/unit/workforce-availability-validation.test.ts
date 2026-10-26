import { describe, expect, it } from "vitest";
import {
  freshnessLabel,
  listingFormSchema,
  listingFreshness,
  listingsLimitMessage,
  sortListings,
  type ListingInput,
} from "@/lib/validation/workforce-availability";

const rules = { staleDays: 60, reminderDays: 30, maxDays: 730 };
const now = new Date("2026-10-26T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const form = listingFormSchema({
  occupations: [{ code: "7212" }],
  countries: [{ code: "PH" }, { code: "NP" }],
  maxDays: 730,
  today: "2026-10-26",
});
const input: ListingInput = { occupation: "7212", country: "ph", available: "120", monthlyCapacity: "40", availableFrom: "2027-03-01" };
const errorsOf = (value: ListingInput) => {
  const result = form.safeParse(value);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
};

describe("the listing form (FR-K3 AC1, AC2)", () => {
  it("accepts the AC1 listing and upper-cases the country", () => {
    expect(form.parse(input)).toEqual({ ...input, country: "PH" });
  });

  it("accepts 1 and 100,000 and refuses 0, 100,001, decimals and text", () => {
    expect(errorsOf({ ...input, available: "1", monthlyCapacity: "100000" })).toEqual({});
    const range = "Enter a whole number from 1 to 100,000.";
    expect(errorsOf({ ...input, available: "0", monthlyCapacity: "100001" })).toEqual({ available: range, monthlyCapacity: range });
    expect(errorsOf({ ...input, available: "2.5", monthlyCapacity: "many" })).toEqual({ available: range, monthlyCapacity: range });
    expect(errorsOf({ ...input, available: " ", monthlyCapacity: "" })).toEqual({
      available: "Enter how many workers are available now.",
      monthlyCapacity: "Enter how many workers you can supply each month.",
    });
  });

  it("lets a past date through (saved as today) and refuses a date beyond today + 730 days", () => {
    expect(errorsOf({ ...input, availableFrom: "2026-10-25" })).toEqual({});
    expect(errorsOf({ ...input, availableFrom: "2028-10-25" })).toEqual({});
    expect(errorsOf({ ...input, availableFrom: "2028-10-26" })).toEqual({ availableFrom: "Choose a date up to 730 days ahead." });
    expect(errorsOf({ ...input, availableFrom: "2027-02-30" })).toEqual({ availableFrom: "Choose a valid date." });
    expect(errorsOf({ ...input, availableFrom: "" })).toEqual({ availableFrom: "Enter the date from which the workers are available." });
  });

  it("allows only the occupations and source countries of the profile", () => {
    expect(errorsOf({ ...input, occupation: "7126", country: "IN" })).toEqual({
      occupation: "Choose one of the occupations you offer.",
      country: "Choose one of the countries you source workers from.",
    });
    expect(listingFormSchema().safeParse({ ...input, occupation: "7126", availableFrom: "2099-01-01" }).success).toBe(true);
  });
});

describe("freshness (FR-K3 AC1, AC6, AC10)", () => {
  it("is fresh before 30 days, due from 30 days and hidden from 60 days", () => {
    expect(listingFreshness(daysAgo(0), now, rules)).toEqual({ state: "fresh", ageDays: 0 });
    expect(listingFreshness(daysAgo(29.9), now, rules)).toEqual({ state: "fresh", ageDays: 29 });
    expect(listingFreshness(daysAgo(30), now, rules)).toEqual({ state: "due", ageDays: 30, daysLeft: 30 });
    expect(listingFreshness(daysAgo(59.9), now, rules)).toEqual({ state: "due", ageDays: 59, daysLeft: 1 });
    expect(listingFreshness(daysAgo(60), now, rules)).toEqual({ state: "hidden", ageDays: 60 });
    expect(listingFreshness(daysAgo(90), now, { ...rules, staleDays: 90 })).toEqual({ state: "hidden", ageDays: 90 });
    expect(listingFreshness(daysAgo(61), now, { ...rules, staleDays: 90 }).state).toBe("due");
  });

  it("always says when the listing was confirmed, and what to do", () => {
    expect(freshnessLabel(listingFreshness(daysAgo(0), now, rules), "26 October 2026")).toEqual({
      badge: null,
      text: "Confirmed today.",
    });
    expect(freshnessLabel(listingFreshness(daysAgo(1), now, rules), "25 October 2026").text).toBe(
      "Confirmed yesterday, on 25 October 2026.",
    );
    expect(freshnessLabel(listingFreshness(daysAgo(12), now, rules), "14 October 2026").text).toBe(
      "Confirmed 12 days ago, on 14 October 2026.",
    );
    expect(freshnessLabel(listingFreshness(daysAgo(50), now, rules), "6 September 2026")).toEqual({
      badge: null,
      text: "Confirmed 50 days ago, on 6 September 2026. Confirm within 10 days to stay visible.",
    });
    expect(freshnessLabel(listingFreshness(daysAgo(59), now, rules), "28 August 2026").text).toContain("Confirm within 1 day to");
    expect(freshnessLabel(listingFreshness(daysAgo(65), now, rules), "22 August 2026")).toEqual({
      badge: "Hidden from search",
      text: "Confirmed 65 days ago, on 22 August 2026. Confirm to show it again.",
    });
  });
});

describe("the list", () => {
  it("puts the listings confirmed longest ago first", () => {
    const listing = (occupation: string, country: string, confirmedAt: string) => ({ occupation, country, confirmedAt });
    expect(
      sortListings([listing("7212", "PH", daysAgo(1)), listing("7212", "NP", daysAgo(65)), listing("7126", "PH", daysAgo(1))]),
    ).toEqual([listing("7212", "NP", daysAgo(65)), listing("7126", "PH", daysAgo(1)), listing("7212", "PH", daysAgo(1))]);
  });

  it("names the plan limit", () => {
    expect(listingsLimitMessage(10)).toBe("Your plan includes 10 listings.");
    expect(listingsLimitMessage(1)).toBe("Your plan includes 1 listing.");
    expect(listingsLimitMessage(0)).toBe("Your plan does not include availability listings.");
  });
});
