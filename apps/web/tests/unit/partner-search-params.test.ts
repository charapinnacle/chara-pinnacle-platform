import { describe, expect, it } from "vitest";
import {
  formFilters,
  hasPartnerFilters,
  parsePartnerSearchParams,
  partnerDirectoryPath,
  partnerFormDefaults,
  partnerSearchFormSchema,
  partnerSearchQuery,
  usesAdvancedFilters,
} from "@/lib/partners/search-params";

const CURSOR = "2|2026-10-07T10:00:00.123456Z|6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

const parse = (params: Record<string, string | string[]>) => parsePartnerSearchParams(params);

// FR-L1 AC7: the pure function that turns URL parameters into partner filters and back.
describe("parsePartnerSearchParams", () => {
  it("upper-cases a two-letter destination, rejects three letters and lets an unknown code through", () => {
    expect(parse({ destination: "de" }).filters.destination).toBe("DE");
    const three = parse({ destination: "deu" });
    expect(three.filters.destination).toBeUndefined();
    expect(Object.keys(three.errors)).toEqual(["destination"]);
    expect(parse({ destination: "XX" })).toMatchObject({ filters: { destination: "XX" }, errors: {} });
  });

  it("accepts a four-digit occupation only", () => {
    expect(parse({ occupation: "7212" }).filters.occupation).toBe("7212");
    for (const occupation of ["721", "abcd"]) {
      const result = parse({ occupation });
      expect(result.filters.occupation).toBeUndefined();
      expect(Object.keys(result.errors)).toEqual(["occupation"]);
    }
  });

  it("accepts an industry section of one letter and a language of two", () => {
    expect(parse({ industry: "C" }).filters.industry).toBe("C");
    expect(Object.keys(parse({ industry: "CC" }).errors)).toEqual(["industry"]);
    expect(parse({ language: "tl" }).filters.language).toBe("tl");
    expect(Object.keys(parse({ language: "tgl" }).errors)).toEqual(["language"]);
  });

  it("refuses both as a recruitment filter and accepts local and international", () => {
    expect(Object.keys(parse({ recruitment: "both" }).errors)).toEqual(["recruitment"]);
    expect(parse({ recruitment: "international" }).filters.recruitment).toBe("international");
    expect(parse({ recruitment: "local" }).filters.recruitment).toBe("local");
  });

  it("accepts a capacity of 1 to 100,000 workers", () => {
    expect(Object.keys(parse({ capacity: "0" }).errors)).toEqual(["capacity"]);
    expect(parse({ capacity: "1" }).filters.capacity).toBe(1);
    expect(parse({ capacity: "100000" }).filters.capacity).toBe(100_000);
    expect(Object.keys(parse({ capacity: "100001" }).errors)).toEqual(["capacity"]);
    expect(Object.keys(parse({ capacity: "12.5" }).errors)).toEqual(["capacity"]);
  });

  it("accepts within_days of 1 to 365", () => {
    expect(Object.keys(parse({ within_days: "0" }).errors)).toEqual(["within_days"]);
    expect(parse({ within_days: "1" }).filters.within_days).toBe(1);
    expect(parse({ within_days: "365" }).filters.within_days).toBe(365);
    expect(Object.keys(parse({ within_days: "366" }).errors)).toEqual(["within_days"]);
  });

  it("makes the source list unique, in its order, and refuses a list with a bad code", () => {
    expect(parse({ sources_from: "PH,IN,PH" }).filters.sources_from).toEqual(["PH", "IN"]);
    expect(parse({ sources_from: "ph, in" }).filters.sources_from).toEqual(["PH", "IN"]);
    const bad = parse({ sources_from: "PH,IND" });
    expect(bad.filters.sources_from).toBeUndefined();
    expect(Object.keys(bad.errors)).toEqual(["sources_from"]);
    const many = Array.from({ length: 21 }, (_, index) => String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26)));
    expect(Object.keys(parse({ sources_from: many.join(",") }).errors)).toEqual(["sources_from"]);
  });

  it("ignores an unknown parameter and names every error by its parameter", () => {
    const result = parse({ destination: "deu", occupation: "abcd", q: "welders", utm_source: "mail" });
    expect(Object.keys(result.errors).sort()).toEqual(["destination", "occupation"]);
    expect(result.filters).toEqual({ limit: 20 });
    expect(hasPartnerFilters(result.filters)).toBe(false);
  });

  it("keeps a valid cursor, drops another, and clamps the page size to 1 to 50", () => {
    expect(parse({ cursor: CURSOR }).filters.cursor).toBe(CURSOR);
    expect(Object.keys(parse({ cursor: "2|yesterday|x" }).errors)).toEqual(["cursor"]);
    expect(parse({ cursor: "2|2026-02-30T10:00:00.123456Z|6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11" }).filters.cursor).toBeUndefined();
    expect(parse({ limit: "500" }).filters.limit).toBe(50);
    expect(parse({ limit: "0" }).filters.limit).toBe(1);
    expect(parse({}).filters.limit).toBe(20);
  });

  it("serialises a valid filter set to the same query string", () => {
    const query = `destination=DE&occupation=7212&based_in=PH&sources_from=PH%2CIN&industry=C&language=tl&recruitment=international&capacity=100&within_days=60&cursor=${encodeURIComponent(CURSOR)}`;
    const { filters, errors } = parse(Object.fromEntries(new URLSearchParams(query)));
    expect(errors).toEqual({});
    expect(partnerSearchQuery(filters)).toBe(query);
    expect(partnerDirectoryPath("en", filters)).toBe(`/en/partners/recruitment?${query}`);
    expect(partnerDirectoryPath("en", { limit: 20 })).toBe("/en/partners/recruitment");
    expect(partnerSearchQuery({ limit: 30 })).toBe("limit=30");
  });
});

describe("the partner search form", () => {
  it("turns its values into the filters of the address, empty values left out", () => {
    const values = partnerSearchFormSchema.parse({
      destination: "de",
      occupation: "7212",
      based_in: "",
      sources_from: ["PH", "PH"],
      industry: "",
      language: "",
      recruitment: "",
      capacity: "",
      within_days: " 30 ",
    });
    expect(formFilters(values)).toEqual({ destination: "DE", occupation: "7212", sources_from: ["PH"], within_days: 30, limit: 20 });
  });

  it("shows the filters of an address, without its cursor", () => {
    expect(partnerFormDefaults(`destination=DE&sources_from=PH,IN&cursor=${encodeURIComponent(CURSOR)}`)).toEqual({
      destination: "DE",
      occupation: "",
      based_in: "",
      sources_from: ["PH", "IN"],
      industry: "",
      language: "",
      recruitment: "",
      capacity: "",
      within_days: "",
    });
  });

  it("names capacity, timeframe and several source countries as advanced (FR-L1 AC5)", () => {
    expect(usesAdvancedFilters({ limit: 20, sources_from: ["PH"] })).toBe(false);
    expect(usesAdvancedFilters({ limit: 20, sources_from: ["PH", "IN"] })).toBe(true);
    expect(usesAdvancedFilters({ limit: 20, capacity: 100 })).toBe(true);
    expect(usesAdvancedFilters({ limit: 20, within_days: 60 })).toBe(true);
  });
});
