import { describe, expect, it } from "vitest";
import { classifyUsage } from "@/lib/billing/usage";

describe("classifyUsage (FR-G5 AC6)", () => {
  it.each([
    [2, 3, { state: "ok", label: "2 of 3", percent: 67 }],
    [3, 3, { state: "at_limit", label: "3 of 3", percent: 100 }],
    [5, 3, { state: "over_limit", label: "5 of 3", percent: 100 }],
    [0, 15, { state: "ok", label: "0 of 15", percent: 0 }],
    [3, null, { state: "unlimited", label: "Unlimited", percent: null }],
    [0, 0, { state: "at_limit", label: "0 of 0", percent: 100 }],
  ] as const)("(%i, %s) is %j", (used, limit, expected) => {
    expect(classifyUsage(used, limit)).toEqual(expected);
  });

  it("rounds to the nearest whole percent", () => {
    expect(classifyUsage(1, 3).percent).toBe(33);
    expect(classifyUsage(14, 15).percent).toBe(93);
  });

  it("keeps the figures of an unlimited plan out of the bar", () => {
    expect(classifyUsage(0, null)).toEqual({ state: "unlimited", label: "Unlimited", percent: null });
  });
});
