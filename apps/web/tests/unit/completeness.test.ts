import { describe, expect, it } from "vitest";
import { computeCompleteness, showsNudge } from "@/lib/passport/completeness";

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
  training: [],
  employmentHistory: [],
  hasCv: false,
};
const score = (patch: Partial<CompletenessInput>) => computeCompleteness({ ...empty, ...patch }, TODAY, false);
const scoreFrom2c = (patch: Partial<CompletenessInput>) => computeCompleteness({ ...empty, ...patch }, TODAY, true);
const many = (count: number) => Array.from({ length: count }, (_, index) => `item ${index}`);
const expiring = (...dates: (string | null)[]) => dates.map((expiresOn) => ({ expiresOn }));

const full: Partial<CompletenessInput> = {
  headline: "Welder",
  occupationId: "7212",
  yearsExperience: 6,
  availability: "now",
  skills: many(3),
  languages: many(1),
  authorizations: expiring(null),
  hasCv: true,
};

describe("computeCompleteness while release_find_workers is off (Phase 1 weights)", () => {
  it("scores a new passport at 10 percent and suggests the occupation first", () => {
    const result = score({});
    expect(result.percent).toBe(10);
    expect(result.next?.label).toBe("Occupation");
  });

  it("uses the published weights, which add up to 100", () => {
    const { items } = score({});
    expect(Object.fromEntries(items.map((item) => [item.key, item.weight]))).toEqual({
      names: 10,
      headline: 5,
      occupation: 15,
      skills: 15,
      languages: 10,
      experience: 10,
      availability: 10,
      authorization: 10,
      cv: 15,
    });
    expect(items.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it("scores 10, 55, 85 and 100 for the four reference profiles, always a whole number from 0 to 100", () => {
    const withoutCv = { ...full, hasCv: false };
    const results = [
      score({}).percent,
      score({ occupationId: "7212", skills: many(3), hasCv: true }).percent,
      score(withoutCv).percent,
      score(full).percent,
    ];
    expect(results).toEqual([10, 55, 85, 100]);
    for (const percent of results) expect(Number.isInteger(percent) && percent >= 0 && percent <= 100).toBe(true);
  });

  it("has nothing left to suggest for a complete profile", () => {
    expect(score(full).next).toBeNull();
  });

  it("V61: lists no training or employment history item and scores their entries nothing until release 2c", () => {
    expect(score({}).items).toHaveLength(9);
    expect(score({}).items.map((item) => item.key)).not.toContain("training");
    expect(score({ ...full, training: many(1), employmentHistory: many(1) }).percent).toBe(100);
    expect(score({ training: many(2), employmentHistory: many(1) }).percent).toBe(10);
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

  it("counts the CV item when the candidate has a usable CV", () => {
    expect([false, true].map((hasCv) => score({ hasCv }).percent)).toEqual([10, 25]);
  });

  it("suggests the next item in the fixed order as items are completed", () => {
    const steps: Partial<CompletenessInput>[] = [
      { occupationId: "7212" },
      { skills: many(3) },
      { hasCv: true },
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
      "CV",
      "Languages",
      "Years of experience",
      "Availability",
      "Work authorisation",
      "Headline",
      undefined,
    ]);
  });

  it("points each suggestion at the passport section where the item is added", () => {
    expect(score({}).next?.section).toBe("occupation");
    expect(score({ occupationId: "7212", skills: many(3) }).next?.section).toBe("documents");
  });
});

describe("computeCompleteness from release 2c (release_find_workers on, FR-Q4 AC7)", () => {
  const complete = { ...full, training: many(1), employmentHistory: many(1) };

  it("uses the weights of FR-Q4 AC7, which add up to 100", () => {
    const { items } = scoreFrom2c({});
    expect(Object.fromEntries(items.map((item) => [item.key, item.weight]))).toEqual({
      names: 10,
      headline: 5,
      occupation: 15,
      skills: 10,
      languages: 10,
      experience: 5,
      availability: 10,
      authorization: 10,
      cv: 15,
      training: 5,
      employmentHistory: 5,
    });
    expect(items.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it("scores 90 for a passport complete under the Phase 1 rules and suggests Training, then 95 and 100", () => {
    const result = scoreFrom2c(full);
    expect(result.percent).toBe(90);
    expect(result.next?.label).toBe("Training");
    expect(result.next?.section).toBe("training");
    expect(scoreFrom2c({ ...full, training: many(1) }).percent).toBe(95);
    expect(scoreFrom2c({ ...full, training: many(1) }).next?.section).toBe("employment-history");
    expect(scoreFrom2c({ ...full, employmentHistory: many(1) }).next?.label).toBe("Training");
    expect(scoreFrom2c(complete).percent).toBe(100);
    expect(scoreFrom2c(complete).next).toBeNull();
    expect(scoreFrom2c({}).percent).toBe(10);
  });

  it("gives preferred industries and employment types no item and no weight", () => {
    expect(scoreFrom2c({}).items.map((item) => item.key)).not.toContain("preferredIndustries");
    expect(scoreFrom2c({}).items.map((item) => item.label.toLowerCase()).some((label) => label.includes("preferred"))).toBe(false);
  });

  it("scores 10, 50, 85 and 100 for the four reference profiles with training and employment history", () => {
    expect([
      scoreFrom2c({}).percent,
      scoreFrom2c({ occupationId: "7212", skills: many(3), hasCv: true }).percent,
      scoreFrom2c({ ...complete, hasCv: false }).percent,
      scoreFrom2c(complete).percent,
    ]).toEqual([10, 50, 85, 100]);
    expect([0, 2, 3].map((count) => scoreFrom2c({ skills: many(count) }).percent)).toEqual([10, 10, 20]);
    expect([null, 0].map((yearsExperience) => scoreFrom2c({ yearsExperience }).percent)).toEqual([10, 15]);
  });

  it("suggests the next item in the order of FR-Q4 AC7 as items are completed", () => {
    const steps: Partial<CompletenessInput>[] = [
      { occupationId: "7212" },
      { hasCv: true },
      { skills: many(3) },
      { languages: many(1) },
      { availability: "now" },
      { authorizations: expiring(null) },
      { yearsExperience: 2 },
      { headline: "Welder" },
      { training: many(1) },
      { employmentHistory: many(1) },
    ];
    let state: Partial<CompletenessInput> = {};
    const suggested = [scoreFrom2c(state).next?.label];
    for (const step of steps) {
      state = { ...state, ...step };
      suggested.push(scoreFrom2c(state).next?.label);
    }
    expect(suggested).toEqual([
      "Occupation",
      "CV",
      "Skills",
      "Languages",
      "Availability",
      "Work authorisation",
      "Years of experience",
      "Headline",
      "Training",
      "Employment history",
      undefined,
    ]);
  });
});

describe("showsNudge", () => {
  it("is true below 60 percent and false from 60 percent", () => {
    expect([0, 59, 60, 100].map(showsNudge)).toEqual([true, true, false, false]);
  });
});
