import { describe, expect, it } from "vitest";
import { skillSuggestions } from "@/lib/passport/skill-suggestions";
import { validateSkill } from "@/lib/validation/passport";

describe("skill suggestions", () => {
  it("are valid tags", () => {
    for (const suggestion of skillSuggestions) {
      expect(validateSkill([], suggestion), suggestion).toEqual({ status: "added", skill: suggestion });
    }
  });

  it("have no duplicates in any letter case", () => {
    expect(new Set(skillSuggestions.map((suggestion) => suggestion.toLowerCase())).size).toBe(skillSuggestions.length);
  });

  it("include Welding, which the passport flow searches for", () => {
    expect(skillSuggestions).toContain("Welding");
  });
});
