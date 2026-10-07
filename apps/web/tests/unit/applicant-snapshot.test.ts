import { describe, expect, it } from "vitest";
import { parseSnapshot } from "@/lib/applicants/snapshot";

describe("parseSnapshot", () => {
  it("reads the snapshot apply_to_job writes", () => {
    const snapshot = parseSnapshot({
      first_name: "Ana",
      last_name: "Silva",
      headline: "Welder",
      current_country: "PT",
      occupation_id: "7212",
      occupation: "Welders and flame cutters",
      years_experience: 6,
      availability: "from_date",
      available_from: "2026-11-01",
      skills: ["MIG welding"],
      languages: [{ code: "en", level: "C1" }],
      preferred_countries: ["DE"],
      work_authorizations: [{ country: "PT", expires_on: null }],
      completeness: 80,
    });
    expect(snapshot).toMatchObject({ headline: "Welder", years_experience: 6, languages: [{ code: "en", level: "C1" }] });
    expect(snapshot).not.toHaveProperty("completeness");
  });

  it("reads the snapshot of an erased candidate, which has lost the name and the headline", () => {
    expect(parseSnapshot({ current_country: "PT", skills: [] })).toMatchObject({ skills: [], languages: [], preferred_countries: [], work_authorizations: [] });
  });

  it("refuses a value that is not a snapshot or has an unknown availability", () => {
    expect(() => parseSnapshot(null)).toThrow();
    expect(() => parseSnapshot({ availability: "sometimes" })).toThrow();
  });
});
