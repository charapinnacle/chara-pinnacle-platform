import { describe, expect, it } from "vitest";
import { daysLeft, daysLeftText, graceEnd, trialAlert } from "@/lib/dashboard/plan-status";

const now = new Date("2026-10-08T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const after = (ms: number) => new Date(now.getTime() + ms);

describe("trialAlert (FR-E5 AC6)", () => {
  it("alerts at 72 hours and at 1 minute left, and gives the whole days rounded up", () => {
    expect(trialAlert("trialing", after(72 * HOUR), now)).toEqual({ alert: true, daysLeft: 3 });
    expect(trialAlert("trialing", after(MINUTE), now)).toEqual({ alert: true, daysLeft: 1 });
  });

  it("does not alert at 72 hours and 1 minute left", () => {
    expect(trialAlert("trialing", after(72 * HOUR + MINUTE), now)).toEqual({ alert: false, daysLeft: 4 });
  });

  it("does not alert at 0 or fewer minutes left and never gives a negative number of days", () => {
    expect(trialAlert("trialing", after(0), now)).toEqual({ alert: false, daysLeft: 0 });
    expect(trialAlert("trialing", after(-MINUTE), now)).toEqual({ alert: false, daysLeft: 0 });
    expect(trialAlert("trialing", after(-30 * DAY), now)).toEqual({ alert: false, daysLeft: 0 });
  });

  it("counts 11 days for 10 days and 5 hours and does not alert", () => {
    expect(trialAlert("trialing", after(10 * DAY + 5 * HOUR), now)).toEqual({ alert: false, daysLeft: 11 });
    expect(trialAlert("trialing", after(2 * DAY), now)).toEqual({ alert: true, daysLeft: 2 });
  });

  it("does not alert for any other status, whatever the date", () => {
    for (const status of ["active", "canceled", "past_due", "free"] as const) {
      expect(trialAlert(status, after(HOUR), now), status).toEqual({ alert: false, daysLeft: 0 });
    }
  });

  it("does not alert without a trial end", () => {
    expect(trialAlert("trialing", null, now)).toEqual({ alert: false, daysLeft: 0 });
  });
});

describe("grace period (FR-E5 AC7)", () => {
  it("ends 7 days after the first failed payment, with 5 days left two days in", () => {
    const pastDueSince = new Date(now.getTime() - 2 * DAY);
    expect(graceEnd(pastDueSince).toISOString()).toBe("2026-10-13T12:00:00.000Z");
    expect(daysLeft(graceEnd(pastDueSince), now)).toBe(5);
  });

  it("rounds a part of a day up and stops at 0 once the grace has passed", () => {
    expect(daysLeft(after(DAY + MINUTE), now)).toBe(2);
    expect(daysLeft(after(-DAY), now)).toBe(0);
  });
});

describe("daysLeftText", () => {
  it("says day for one and days for the others", () => {
    expect([0, 1, 2, 11].map(daysLeftText)).toEqual(["0 days left", "1 day left", "2 days left", "11 days left"]);
  });
});
