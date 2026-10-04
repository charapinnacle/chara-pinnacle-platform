import { describe, expect, it } from "vitest";
import { dashboardSegments, homePath, isDashboardSegment } from "@/lib/routes";

describe("homePath", () => {
  it("sends each account kind to its own dashboard", () => {
    expect(homePath("en", "worker")).toBe("/en/dashboard/worker");
    expect(homePath("en", "company")).toBe("/en/dashboard/employer");
  });

  it("keeps an account whose kind is not committed on onboarding", () => {
    expect(homePath("en", null)).toBe("/en/onboarding");
  });
});

describe("dashboard segments", () => {
  it("maps each URL segment to its account kind", () => {
    expect(dashboardSegments).toEqual({ worker: "worker", employer: "company" });
  });

  it("accepts only its own segments", () => {
    expect(isDashboardSegment("worker")).toBe(true);
    expect(isDashboardSegment("employer")).toBe(true);
    expect(isDashboardSegment("company")).toBe(false);
    expect(isDashboardSegment("constructor")).toBe(false);
  });
});
