import { describe, expect, it } from "vitest";
import {
  formDefaults,
  formFilters,
  parseSearchParams,
  searchFormSchema,
  searchQuery,
  usedFilters,
  type JobSearchFilters,
} from "@/lib/jobs/search-params";

const salary = { salary_currency: "EUR", salary_period: "month" };
const CURSOR = "0.30396357|2026-10-07T10:00:00.123456Z|6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

function parse(params: Record<string, string | string[]>) {
  return parseSearchParams(params);
}

describe("parseSearchParams", () => {
  it("rejects a keyword of 101 characters naming q and keeps one of 100", () => {
    const tooLong = parse({ q: "a".repeat(101) });
    expect(Object.keys(tooLong.errors)).toEqual(["q"]);
    expect(tooLong.filters.q).toBeUndefined();
    expect(parse({ q: "a".repeat(100) }).filters.q).toBe("a".repeat(100));
  });

  it("counts characters, not UTF-16 units, in the keyword and the city", () => {
    expect(parse({ q: "\u{1F600}".repeat(100) }).errors).toEqual({});
    expect(Object.keys(parse({ city: "\u{1F600}".repeat(101) }).errors)).toEqual(["city"]);
  });

  it("trims the keyword and treats an empty one as not set", () => {
    expect(parse({ q: "  welder  " }).filters.q).toBe("welder");
    const blank = parse({ q: "   ", city: "" });
    expect(blank.filters.q).toBeUndefined();
    expect(blank.filters.city).toBeUndefined();
    expect(blank.errors).toEqual({});
  });

  it("accepts a country of two letters in any case and refuses three letters", () => {
    expect(parse({ country: "de" }).filters.country).toBe("DE");
    const refused = parse({ country: "DEU" });
    expect(Object.keys(refused.errors)).toEqual(["country"]);
    expect(refused.filters.country).toBeUndefined();
  });

  it("names the missing currency or pay period of a minimum salary and drops the minimum", () => {
    const noCurrency = parse({ salary_min: "3000", salary_period: "month" });
    expect(Object.keys(noCurrency.errors)).toEqual(["salary_currency"]);
    expect(noCurrency.filters.salary_min).toBeUndefined();
    expect(noCurrency.filters.salary_period).toBeUndefined();
    const noPeriod = parse({ salary_min: "3000", salary_currency: "EUR" });
    expect(Object.keys(noPeriod.errors)).toEqual(["salary_period"]);
    expect(noPeriod.filters.salary_min).toBeUndefined();
    const neither = parse({ salary_min: "3000" });
    expect(Object.keys(neither.errors).sort()).toEqual(["salary_currency", "salary_period"]);
  });

  it("accepts a minimum salary above 0 and up to 9,999,999.99", () => {
    expect(parse({ salary_min: "3000", ...salary }).filters.salary_min).toBe(3000);
    expect(parse({ salary_min: "2800.50", ...salary }).filters.salary_min).toBe(2800.5);
    expect(parse({ salary_min: "9999999.99", ...salary }).filters.salary_min).toBe(9_999_999.99);
    expect(parse({ salary_min: "0.01", ...salary }).filters.salary_min).toBe(0.01);
  });

  it.each(["0", "-5", "abc", "10000000", "3000.123", "1e3", "3,000"])("refuses a minimum salary of %s", (value) => {
    const result = parse({ salary_min: value, ...salary });
    expect(Object.keys(result.errors)).toEqual(["salary_min"]);
    expect(result.filters.salary_min).toBeUndefined();
    expect(result.filters.salary_currency).toBeUndefined();
  });

  it("accepts hour, month and year as the pay period and refuses week", () => {
    for (const period of ["hour", "month", "year"]) {
      expect(parse({ salary_min: "10", salary_currency: "EUR", salary_period: period }).errors).toEqual({});
    }
    const week = parse({ salary_min: "10", salary_currency: "EUR", salary_period: "week" });
    expect(Object.keys(week.errors)).toContain("salary_period");
    expect(week.filters.salary_min).toBeUndefined();
  });

  it("accepts local and international recruitment and refuses both", () => {
    expect(parse({ recruitment: "local" }).filters.recruitment).toBe("local");
    expect(parse({ recruitment: "international" }).filters.recruitment).toBe("international");
    const both = parse({ recruitment: "both" });
    expect(Object.keys(both.errors)).toEqual(["recruitment"]);
    expect(both.filters.recruitment).toBeUndefined();
  });

  it("clamps the limit to 1 to 50 and falls back to 20", () => {
    expect(parse({ limit: "0" }).filters.limit).toBe(1);
    expect(parse({ limit: "-3" }).filters.limit).toBe(1);
    expect(parse({ limit: "99" }).filters.limit).toBe(50);
    expect(parse({ limit: "99999999999999999999" }).filters.limit).toBe(50);
    expect(parse({ limit: "abc" }).filters.limit).toBe(20);
    expect(parse({ limit: "7" }).filters.limit).toBe(7);
    expect(parse({}).filters.limit).toBe(20);
  });

  it("ignores a parameter that is not a filter", () => {
    const result = parse({ country: "DE", utm_source: "mail", page: "3" });
    expect(result.errors).toEqual({});
    expect(result.filters).toEqual({ country: "DE", limit: 20 });
  });

  it("uses the first value of a repeated parameter", () => {
    expect(parse({ country: ["se", "de"] }).filters.country).toBe("SE");
  });

  it("keeps the valid values when others are invalid, and each error names its parameter", () => {
    const result = parse({ q: "x".repeat(101), country: "DEU", city: "Hamburg", occupation: "7212", industry: "c" });
    expect(Object.keys(result.errors).sort()).toEqual(["country", "q"]);
    expect(result.filters).toEqual({ city: "Hamburg", occupation: "7212", industry: "C", limit: 20 });
  });

  it("validates the code lists by shape: occupation of four digits, industry of one letter, currency of three", () => {
    expect(Object.keys(parse({ occupation: "72" }).errors)).toEqual(["occupation"]);
    expect(Object.keys(parse({ industry: "CC" }).errors)).toEqual(["industry"]);
    expect(Object.keys(parse({ salary_min: "5", salary_currency: "EU", salary_period: "year" }).errors)).toContain(
      "salary_currency",
    );
    expect(Object.keys(parse({ employment_type: "forever" }).errors)).toEqual(["employment_type"]);
  });

  it("treats the flags as filters only when true", () => {
    expect(parse({ accommodation: "true", visa_support: "true" }).filters).toMatchObject({
      accommodation: true,
      visa_support: true,
    });
    const off = parse({ accommodation: "false", visa_support: "" });
    expect(off.errors).toEqual({});
    expect(off.filters.accommodation).toBeUndefined();
    expect(off.filters.visa_support).toBeUndefined();
    expect(parse({ accommodation: "yes" }).filters.accommodation).toBeUndefined();
  });

  it("accepts a cursor of the shape the database returns and drops anything else", () => {
    expect(parse({ cursor: CURSOR }).filters.cursor).toBe(CURSOR);
    const refused = parse({ cursor: "'; drop table jobs; --" });
    expect(Object.keys(refused.errors)).toEqual(["cursor"]);
    expect(refused.filters.cursor).toBeUndefined();
  });

  it("drops a cursor that has the look of one but that the database could not read", () => {
    const uuid = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
    for (const cursor of [
      `0|T|${"-".repeat(36)}`,
      `0|2026-13-45T10:00:00.123456Z|${uuid}`,
      `0|2026-02-30T10:00:00.123456Z|${uuid}`,
      `0|2026-10-07T25:00:00.123456Z|${uuid}`,
      `0|2026-10-07T10:00:00Z|${uuid}`,
      `0|2026-10-07T10:00:00.123456Z|${"-".repeat(36)}`,
      `x|2026-10-07T10:00:00.123456Z|${uuid}`,
    ]) {
      const refused = parse({ cursor, q: "welder" });
      expect(Object.keys(refused.errors), cursor).toEqual(["cursor"]);
      expect(refused.filters.cursor, cursor).toBeUndefined();
      expect(refused.filters.q).toBe("welder");
    }
  });

  it("accepts the relevance in the exponent form a real prints", () => {
    const cursor = "1.2345679e-05|2026-10-07T10:00:00.123456Z|6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
    expect(parse({ cursor }).filters.cursor).toBe(cursor);
  });
});

describe("searchQuery", () => {
  const filters: JobSearchFilters = {
    q: "welder",
    country: "DE",
    city: "München",
    occupation: "7212",
    industry: "C",
    employment_type: "full_time",
    salary_min: 3000,
    salary_currency: "EUR",
    salary_period: "month",
    accommodation: true,
    visa_support: true,
    recruitment: "local",
    cursor: CURSOR,
    limit: 20,
  };

  it("writes the filters in a fixed order, the example of the criteria included", () => {
    expect(
      searchQuery({
        country: "DE",
        employment_type: "full_time",
        salary_min: 3000,
        salary_currency: "EUR",
        salary_period: "month",
        limit: 20,
      }),
    ).toBe("country=DE&employment_type=full_time&salary_min=3000&salary_currency=EUR&salary_period=month");
  });

  it("round-trips a full filter set through the address", () => {
    const query = searchQuery(filters);
    const parsed = parseSearchParams(Object.fromEntries(new URLSearchParams(query)));
    expect(parsed.errors).toEqual({});
    expect(parsed.filters).toEqual(filters);
    expect(searchQuery(parsed.filters)).toBe(query);
  });

  it("writes a limit only when it is not the default, and nothing for an empty filter set", () => {
    expect(searchQuery({ limit: 20 })).toBe("");
    expect(searchQuery({ limit: 5 })).toBe("limit=5");
  });

  it("serialises the same query string that was parsed", () => {
    const query = "q=welder&country=DE&salary_min=2800.5&salary_currency=EUR&salary_period=year&visa_support=true&limit=10";
    const parsed = parseSearchParams(Object.fromEntries(new URLSearchParams(query)));
    expect(searchQuery(parsed.filters)).toBe(query);
  });
});

describe("usedFilters", () => {
  it("names the filters that are set and none for an empty search, whatever the cursor and the page size", () => {
    expect(usedFilters(parse({}).filters)).toEqual([]);
    expect(usedFilters(parse({ limit: "5", cursor: CURSOR }).filters)).toEqual([]);
    expect(usedFilters(parse({ q: "welder", country: "de", accommodation: "true", cursor: CURSOR }).filters)).toEqual([
      "q",
      "country",
      "accommodation",
    ]);
  });

  it("does not name an option the address could not carry", () => {
    expect(usedFilters(parse({ country: "DEU", salary_min: "3000" }).filters)).toEqual([]);
  });
});

describe("formDefaults", () => {
  it("shows the filters of an address in the form and leaves the rest empty", () => {
    expect(formDefaults("country=DE&salary_min=3000&salary_currency=EUR&salary_period=month&visa_support=true")).toEqual({
      q: "", country: "DE", city: "", occupation: "", industry: "", employment_type: "", salary_min: "3000",
      salary_currency: "EUR", salary_period: "month", accommodation: false, visa_support: true, recruitment: "",
    });
  });

  it("drops what the address cannot carry, so the form never shows an invalid value", () => {
    expect(formDefaults("country=DEU&salary_min=3000").salary_min).toBe("");
    expect(formDefaults("country=DEU").country).toBe("");
  });
});

describe("searchFormSchema", () => {
  const empty = {
    q: "", country: "", city: "", occupation: "", industry: "", employment_type: "", salary_min: "",
    salary_currency: "", salary_period: "", accommodation: false, visa_support: false, recruitment: "",
  };

  it("turns an empty form into no filters", () => {
    const result = searchFormSchema.safeParse(empty);
    expect(result.success && searchQuery(formFilters(result.data))).toBe("");
  });

  it("asks for the currency and the pay period next to a minimum salary", () => {
    const result = searchFormSchema.safeParse({ ...empty, salary_min: "3000" });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues.map((issue) => issue.path[0]).sort()).toEqual([
      "salary_currency",
      "salary_period",
    ]);
  });

  it("produces the address of the criteria", () => {
    const result = searchFormSchema.safeParse({
      ...empty,
      country: "de",
      employment_type: "full_time",
      salary_min: "3000",
      salary_currency: "eur",
      salary_period: "month",
      accommodation: true,
    });
    expect(result.success && searchQuery(formFilters(result.data))).toBe(
      "country=DE&employment_type=full_time&salary_min=3000&salary_currency=EUR&salary_period=month&accommodation=true",
    );
  });
});
