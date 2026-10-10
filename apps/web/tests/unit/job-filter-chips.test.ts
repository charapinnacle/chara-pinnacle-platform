import { describe, expect, it } from "vitest";
import { filterChips } from "@/lib/jobs/filter-chips";
import { parseSearchParams } from "@/lib/jobs/search-params";

const names = {
  countries: new Map([["DE", "Germany"]]),
  occupations: new Map([["7212", "7212 · Welders and flame cutters"]]),
  industries: new Map([["F", "Construction"]]),
};
const chipsOf = (search: Record<string, string>) => filterChips("en", parseSearchParams(search).filters, names);

describe("filterChips", () => {
  it("has no chip for a search without filters", () => {
    expect(chipsOf({})).toEqual([]);
    expect(chipsOf({ cursor: "x", limit: "50" })).toEqual([]);
  });

  it("names each filter in words and links to the same search without it", () => {
    const chips = chipsOf({ q: "welder", country: "DE", city: "Hamburg", occupation: "7212", industry: "F", employment_type: "full_time", recruitment: "local" });
    expect(chips.map(({ label }) => label)).toEqual([
      "Keyword: welder",
      "Country: Germany",
      "City: Hamburg",
      "Occupation: 7212 · Welders and flame cutters",
      "Industry: Construction",
      "Employment type: Full time",
      "Recruitment: Local candidates",
    ]);
    const country = chips.find(({ name }) => name === "country");
    expect(country?.href).toBe("/en/jobs?q=welder&city=Hamburg&occupation=7212&industry=F&employment_type=full_time&recruitment=local");
  });

  it("removes the minimum salary with its currency and pay period, and the flags one at a time", () => {
    const chips = chipsOf({ salary_min: "2800", salary_currency: "EUR", salary_period: "month", accommodation: "true", visa_support: "true" });
    expect(chips.map(({ label }) => label)).toEqual([
      "Minimum salary: 2800 EUR per month",
      "Accommodation provided",
      "Visa support offered",
    ]);
    expect(chips[0].href).toBe("/en/jobs?accommodation=true&visa_support=true");
    expect(chips[1].href).toBe("/en/jobs?salary_min=2800&salary_currency=EUR&salary_period=month&visa_support=true");
  });

  it("shows the code when the name is not known, and drops the page cursor from every link", () => {
    const cursor = "1|2026-09-01T10:00:00.000000Z|8d4f0a2e-1b3c-4d5e-8f60-123456789abc";
    const [chip] = filterChips("de", parseSearchParams({ country: "FR", city: "Lyon", cursor }).filters, names);
    expect(chip.label).toBe("Country: FR");
    expect(chip.href).toBe("/de/jobs?city=Lyon");
  });

  it("leaves out a minimum salary that the address gave without its currency", () => {
    expect(chipsOf({ salary_min: "2800" })).toEqual([]);
  });
});
