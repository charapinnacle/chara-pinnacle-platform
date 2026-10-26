import { describe, expect, it } from "vitest";
import { adminEntries, entriesFor } from "@/lib/admin/navigation";

const labels = (roles: Parameters<typeof entriesFor>[0]) => entriesFor(roles).map((entry) => entry.label);

describe("the entries of the console", () => {
  it("give the Platform Administrator ten functions, the reports, the plans and the settings among them", () => {
    expect(labels(["admin"])).toEqual([
      "Users",
      "Organisations",
      "Statistics",
      "Plans and limits",
      "Platform settings",
      "Legal documents",
      "Audit log",
      "Staff",
      "MFA reset",
      "Reports",
    ]);
  });

  it("give the Trust & Safety Administrator the searches, the reports, the moderation of vacancies and the record of suspensions", () => {
    expect(labels(["trust_safety"])).toEqual(["Users", "Organisations", "Reports", "Vacancy moderation", "Suspensions and reinstatements"]);
  });

  it("give the Verification Reviewer none while release 2a is off", () => {
    expect(entriesFor(["verification_reviewer"])).toEqual([]);
    expect(entriesFor([])).toEqual([]);
    expect(entriesFor([], ["release_partner_directories"])).toEqual([]);
  });

  it("add the partner reviews for all three roles once release 2a is on (FR-J4)", () => {
    const released = ["release_partner_directories"] as const;
    expect(entriesFor(["verification_reviewer"], released).map((entry) => entry.label)).toEqual(["Partner reviews"]);
    expect(entriesFor(["admin"], released).map((entry) => entry.label)).toContain("Partner reviews");
    expect(entriesFor(["trust_safety"], released).map((entry) => entry.label)).toContain("Partner reviews");
    expect(labels(["admin"])).not.toContain("Partner reviews");
  });

  it("join the entries of a person with two roles once each, in the order of the console", () => {
    expect(labels(["trust_safety", "admin"])).toHaveLength(12);
    expect(new Set(labels(["trust_safety", "admin"])).size).toBe(12);
  });

  it("give the plan editor and the settings to the Platform Administrator only, outside any release switch (FR-R2)", () => {
    const editor = adminEntries.filter((entry) => /plan|limit|setting/i.test(entry.label));
    expect(editor.map((entry) => [entry.segment, entry.roles, "release" in entry])).toEqual([
      ["plans", ["admin"], false],
      ["settings", ["admin"], false],
    ]);
    expect(labels(["trust_safety"]).join(" ")).not.toMatch(/plan|limit|setting/i);
    expect(entriesFor(["verification_reviewer"], ["release_partner_directories"]).map((entry) => entry.label)).toEqual(["Partner reviews"]);
  });

  it("use one address name for each entry", () => {
    expect(new Set(adminEntries.map((entry) => entry.segment)).size).toBe(adminEntries.length);
  });
});
