import { describe, expect, it } from "vitest";
import { homePath } from "@/lib/routes";

describe("homePath", () => {
  it("sends each account kind to its own dashboard", () => {
    expect(homePath("en", "worker")).toBe("/en/dashboard/worker");
    expect(homePath("en", "company")).toBe("/en/dashboard/employer");
  });

  it("keeps an account whose kind is not committed on onboarding", () => {
    expect(homePath("en", null)).toBe("/en/onboarding");
  });
});
