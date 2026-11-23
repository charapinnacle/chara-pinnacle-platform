import { describe, expect, it } from "vitest";
import { listingFormSchema } from "@/lib/validation/workforce-availability";
import { emptySkills, LEVEL_WITHOUT_LANGUAGE, skillsText } from "@/lib/workforce/skills";

const listing = { occupation: "7212", country: "PH", available: "40", monthlyCapacity: "10", availableFrom: "2027-03-01" };

describe("the skills of a listing", () => {
  it("reads as one short line with only what is stated", () => {
    expect(
      skillsText({ language: "German", languageLevel: "B1", minExperienceYears: 3, certificates: "ISO 9606-1 welders, 3G and 6G" }),
    ).toBe("German B1 · at least 3 years · ISO 9606-1 welders, 3G and 6G");
    expect(skillsText({ language: "English", languageLevel: null, minExperienceYears: 1 })).toBe("English · at least 1 year");
    expect(skillsText({ minExperienceYears: 0 })).toBe("at least 0 years");
    expect(skillsText({})).toBeNull();
  });

  it("are optional in the listing form, and a level needs its language", () => {
    const form = listingFormSchema({ today: "2026-11-23" });
    expect(form.safeParse({ ...listing, ...emptySkills }).success).toBe(true);
    const levelOnly = form.safeParse({ ...listing, ...emptySkills, languageLevel: "B1" });
    expect(levelOnly.success ? [] : levelOnly.error.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["languageCode", LEVEL_WITHOUT_LANGUAGE],
    ]);
    const wrong = form.safeParse({ ...listing, ...emptySkills, languageCode: "de", languageLevel: "D1", minExperienceYears: "60" });
    expect(wrong.success ? [] : wrong.error.issues.map((issue) => issue.path.join(".")).sort()).toEqual(["languageLevel", "minExperienceYears"]);
    expect(form.parse({ ...listing, ...emptySkills, languageCode: "DE", languageLevel: "B2" })).toMatchObject({ languageCode: "de", languageLevel: "B2" });
  });
});
