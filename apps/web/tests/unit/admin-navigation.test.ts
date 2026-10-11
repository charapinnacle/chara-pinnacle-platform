import { describe, expect, it } from "vitest";
import { adminEntries, entriesFor } from "@/lib/admin/navigation";

const labels = (roles: Parameters<typeof entriesFor>[0]) => entriesFor(roles).map((entry) => entry.label);

describe("the entries of the console", () => {
  it("give the Platform Administrator eight functions, the reports among them", () => {
    expect(labels(["admin"])).toEqual(["Users", "Organisations", "Statistics", "Legal documents", "Audit log", "Staff", "MFA reset", "Reports"]);
  });

  it("give the Trust & Safety Administrator the searches, the reports, the moderation of vacancies and the record of suspensions", () => {
    expect(labels(["trust_safety"])).toEqual(["Users", "Organisations", "Reports", "Vacancy moderation", "Suspensions and reinstatements"]);
  });

  it("give the Verification Reviewer none", () => {
    expect(entriesFor(["verification_reviewer"])).toEqual([]);
    expect(entriesFor([])).toEqual([]);
  });

  it("join the entries of a person with two roles once each, in the order of the console", () => {
    expect(labels(["trust_safety", "admin"])).toHaveLength(10);
    expect(new Set(labels(["trust_safety", "admin"])).size).toBe(10);
  });

  it("have no entry for plans, limits or settings, which Phase 1 changes by migration", () => {
    expect(adminEntries.map((entry) => entry.label).join(" ")).not.toMatch(/plan|limit|setting/i);
  });

  it("use one address name for each entry", () => {
    expect(new Set(adminEntries.map((entry) => entry.segment)).size).toBe(adminEntries.length);
  });
});
