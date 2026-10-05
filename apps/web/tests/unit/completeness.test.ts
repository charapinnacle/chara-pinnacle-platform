import { describe, expect, it } from "vitest";
import { computeCompleteness } from "@/lib/passport/completeness";

type CompletenessInput = Parameters<typeof computeCompleteness>[0];

const TODAY = "2026-10-03";
const empty: CompletenessInput = {
  headline: null,
  occupationId: null,
  yearsExperience: null,
  availability: null,
  skills: [],
  languages: [],
  authorizations: [],
};
const score = (patch: Partial<CompletenessInput>) => computeCompleteness({ ...empty, ...patch }, TODAY);
const many = (count: number) => Array.from({ length: count }, (_, index) => `item ${index}`);
const expiring = (...dates: (string | null)[]) => dates.map((expiresOn) => ({ expiresOn }));

describe("computeCompleteness", () => {
  it("scores a new passport at 10 percent and suggests the occupation first", () => {
    const result = score({});
    expect(result.percent).toBe(10);
    expect(result.next?.label).toBe("Occupation");
  });

  it("uses the published weights, which add up to 85 until the CV item exists", () => {
    const { items } = score({});
    expect(Object.fromEntries(items.map((item) => [item.key, item.weight]))).toEqual({
      names: 10,
      occupation: 15,
      skills: 15,
      languages: 10,
      experience: 10,
      availability: 10,
      authorization: 10,
      headline: 5,
    });
    expect(items.reduce((sum, item) => sum + item.weight, 0)).toBe(85);
  });

  it("scores a complete passport at 85 and has nothing left to suggest", () => {
    const result = score({
      headline: "Welder",
      occupationId: "7212",
      yearsExperience: 6,
      availability: "now",
      skills: many(3),
      languages: many(1),
      authorizations: expiring(null),
    });
    expect(result.percent).toBe(85);
    expect(result.next).toBeNull();
  });

  it("counts skills from three tags and languages from one", () => {
    expect([0, 2, 3, 4].map((count) => score({ skills: many(count) }).percent)).toEqual([10, 10, 25, 25]);
    expect([0, 1].map((count) => score({ languages: many(count) }).percent)).toEqual([10, 20]);
  });

  it("counts a years value of 0 and any availability including unavailable, but not a blank headline", () => {
    expect([null, 0, 12].map((yearsExperience) => score({ yearsExperience }).percent)).toEqual([10, 20, 20]);
    expect([null, "unavailable", "now", "from_date"].map((availability) => score({ availability }).percent)).toEqual([
      10, 20, 20, 20,
    ]);
    expect([null, "   ", "Welder"].map((headline) => score({ headline }).percent)).toEqual([10, 10, 15]);
  });

  it("counts an authorisation without an expiry or expiring today or later, not an expired one", () => {
    const percents = [[], ["2026-10-02"], ["2026-10-03"], [null]].map((dates) =>
      score({ authorizations: expiring(...dates) }).percent,
    );
    expect(percents).toEqual([10, 10, 20, 20]);
  });

  it("suggests the next item in the fixed order as items are completed", () => {
    const steps: Partial<CompletenessInput>[] = [
      { occupationId: "7212" },
      { skills: many(3) },
      { languages: many(1) },
      { yearsExperience: 2 },
      { availability: "now" },
      { authorizations: expiring(null) },
      { headline: "Welder" },
    ];
    let state: Partial<CompletenessInput> = {};
    const suggested = [score(state).next?.label];
    for (const step of steps) {
      state = { ...state, ...step };
      suggested.push(score(state).next?.label);
    }
    expect(suggested).toEqual([
      "Occupation",
      "Skills",
      "Languages",
      "Years of experience",
      "Availability",
      "Work authorisation",
      "Headline",
      undefined,
    ]);
  });
});
