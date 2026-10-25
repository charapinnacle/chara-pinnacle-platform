import { describe, expect, it } from "vitest";
import { countryCount, geographiesSchema, marketsLimitMessage, servedQuestion } from "@/lib/validation/geographies";

describe("Where you serve (FR-K1)", () => {
  it("upper-cases, trims and merges the codes of both lists", () => {
    expect(
      geographiesSchema("recruitment_company").parse({ sourcesFrom: ["PH", "ph", " NP ", "PH"], servesMarket: ["de", "DE", "AE"] }),
    ).toEqual({ sourcesFrom: ["PH", "NP"], servesMarket: ["DE", "AE"] });
  });

  it.each([
    ["recruitment_company", "Choose at least one country you recruit for"],
    ["staffing_company", "Choose at least one country you supply workers for"],
  ] as const)("asks a %s for at least one country in each list, in its own words", (type, served) => {
    const result = geographiesSchema(type).safeParse({ sourcesFrom: [], servesMarket: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ path, message }) => [path.join("."), message])).toEqual([
      ["sourcesFrom", "Choose at least one country you source workers from"],
      ["servesMarket", served],
    ]);
  });

  it("refuses typed text that is no country code, and more codes than the list has countries", () => {
    const schema = geographiesSchema("recruitment_company");
    expect(schema.safeParse({ sourcesFrom: ["Germany"], servesMarket: ["DE"] }).success).toBe(false);
    expect(schema.safeParse({ sourcesFrom: ["PH"], servesMarket: Array.from({ length: 251 }, () => "DE") }).success).toBe(false);
  });

  it("words the served question after the partner type (AC9)", () => {
    expect(servedQuestion).toEqual({
      recruitment_company: "Where do you recruit for?",
      staffing_company: "Where do you supply workers for?",
    });
  });

  it("counts the chosen countries against the limit when there is one (AC2)", () => {
    expect(countryCount(2, 3)).toBe("2 of 3 countries");
    expect(countryCount(0, 1)).toBe("0 of 1 country");
    expect(countryCount(1, null)).toBe("1 country");
    expect(countryCount(4, null)).toBe("4 countries");
  });

  it("states the limit of the plan (AC5)", () => {
    expect(marketsLimitMessage(3)).toBe("Your plan includes 3 countries served.");
    expect(marketsLimitMessage(1)).toBe("Your plan includes 1 country served.");
  });
});
