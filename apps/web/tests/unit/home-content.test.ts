import { describe, expect, it } from "vitest";
import { countryChips, INDUSTRY_TILES, popularSearches, POPULAR_OCCUPATIONS, reachFigures } from "@/lib/public/home";
import { photos } from "@/lib/public/photos";

describe("the popular searches of the hero", () => {
  it("name each occupation by its first synonym with a capital, in the order of the list, and leave out a code the data does not hold", () => {
    expect(
      popularSearches([
        { code: "8332", label: "Heavy truck and lorry drivers", synonyms: ["truck driver", "lorry driver"] },
        { code: "7212", label: "Welders and flame cutters", synonyms: ["welder"] },
        { code: "3434", label: "Chefs", synonyms: [] },
      ]),
    ).toEqual([
      { code: "7212", label: "Welder" },
      { code: "8332", label: "Truck driver" },
      { code: "3434", label: "Chefs" },
    ]);
  });

  it("are ISCO-08 unit group codes", () => {
    for (const code of POPULAR_OCCUPATIONS) expect(code).toMatch(/^\d{4}$/);
  });
});

describe("the industry tiles", () => {
  it("are six distinct ISIC Rev.4 sections, each with a photograph that exists", () => {
    expect(INDUSTRY_TILES).toHaveLength(6);
    expect(new Set(INDUSTRY_TILES.map(({ code }) => code)).size).toBe(6);
    for (const { code, photo } of INDUSTRY_TILES) {
      expect(code).toMatch(/^[A-U]$/);
      expect(Object.keys(photos)).toContain(photo);
    }
  });
});

describe("the country chips", () => {
  const countries = [
    { code: "DE", name: "Germany" },
    { code: "NL", name: "Netherlands" },
    { code: "PL", name: "Poland" },
    { code: "AT", name: "Austria" },
  ];

  it("list each country of the vacancies once, the one with the most first, then by name", () => {
    const jobs = ["PL", "DE", "PL", "NL", "AT", "DE", "PL"].map((countryCode) => ({ countryCode }));
    expect(countryChips(jobs, countries)).toEqual([
      { code: "PL", name: "Poland" },
      { code: "DE", name: "Germany" },
      { code: "AT", name: "Austria" },
      { code: "NL", name: "Netherlands" },
    ]);
  });

  it("are at most twelve, those with the most vacancies", () => {
    const many = Array.from({ length: 14 }, (_, index) => ({ code: `C${String.fromCharCode(65 + index)}`, name: `Country ${String.fromCharCode(65 + index)}` }));
    const jobs = many.flatMap(({ code }, index) => Array.from({ length: 20 - index }, () => ({ countryCode: code })));
    expect(countryChips(jobs, many).map(({ code }) => code)).toEqual(many.slice(0, 12).map(({ code }) => code));
  });

  it("are empty without vacancies and skip a code the reference data does not name", () => {
    expect(countryChips([], countries)).toEqual([]);
    expect(countryChips([{ countryCode: "XX" }], countries)).toEqual([]);
  });
});

describe("the reach figures", () => {
  it("give the size of each reference list with digit grouping", () => {
    expect(reachFigures({ countries: 250, occupations: 436, industries: 21, languages: 1840 })).toEqual([
      { label: "Countries and territories", value: "250" },
      { label: "Occupations (ISCO-08)", value: "436" },
      { label: "Industries (ISIC Rev.4)", value: "21" },
      { label: "Languages", value: "1,840" },
    ]);
  });
});
