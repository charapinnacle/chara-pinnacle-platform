import { describe, expect, it } from "vitest";
import {
  hasJobOrderFilters,
  jobOrderFormDefaults,
  jobOrderFormSchema,
  jobOrderQuery,
  parseJobOrderParams,
} from "@/lib/job-orders/search-params";

const CURSOR = "11111111-1111-4111-8111-111111111111";

describe("the job order filters in the address (FR-N1 AC7)", () => {
  it("rejects a three-letter destination and upper-cases two-letter country codes", () => {
    expect(parseJobOrderParams({ destination: "DEU" })).toEqual({
      filters: { limit: 20 },
      errors: { destination: "Select a destination country from the list." },
    });
    expect(parseJobOrderParams({ destination: "de", source: "ph" }).filters).toMatchObject({ destination: "DE", source: "PH" });
  });

  it("accepts 1 to 100,000 workers and names the parameter of a value outside", () => {
    expect(parseJobOrderParams({ workers_min: "0" }).errors).toEqual({ workers_min: "Enter a number of workers from 1 to 100,000." });
    expect(parseJobOrderParams({ workers_max: "100001" }).errors).toEqual({ workers_max: "Enter a number of workers from 1 to 100,000." });
    expect(parseJobOrderParams({ workers_min: "1", workers_max: "100000" })).toEqual({
      filters: { workers_min: 1, workers_max: 100000, limit: 20 },
      errors: {},
    });
    expect(parseJobOrderParams({ workers_min: "12.5" }).errors).toHaveProperty("workers_min");
  });

  it("names the first parameter of a minimum above the maximum and of a start after the end, and drops it", () => {
    expect(parseJobOrderParams({ workers_min: "200", workers_max: "100" })).toEqual({
      filters: { workers_max: 100, limit: 20 },
      errors: { workers_min: "The minimum number of workers cannot be higher than the maximum." },
    });
    expect(parseJobOrderParams({ start_from: "2027-03-01", start_to: "2027-02-01" })).toEqual({
      filters: { start_to: "2027-02-01", limit: 20 },
      errors: { start_from: "The earliest start date cannot be after the latest start date." },
    });
  });

  it("refuses a date that does not exist", () => {
    expect(parseJobOrderParams({ start_from: "2027-13-01" }).errors).toEqual({ start_from: "Enter a date as YYYY-MM-DD." });
    expect(parseJobOrderParams({ start_to: "2027-02-30" }).errors).toEqual({ start_to: "Enter a date as YYYY-MM-DD." });
  });

  it("offers local and international recruitment only", () => {
    expect(parseJobOrderParams({ recruitment: "both" }).errors).toEqual({ recruitment: "Select local or international recruitment." });
    expect(parseJobOrderParams({ recruitment: "local" }).filters.recruitment).toBe("local");
  });

  it("ignores verified and every parameter that is not a filter", () => {
    expect(parseJobOrderParams({ verified: "true", utm_source: "mail", sort: "plan" })).toEqual({ filters: { limit: 20 }, errors: {} });
  });

  it("clamps the limit: 0 becomes 1, 99 becomes 50 and abc becomes 20", () => {
    expect(parseJobOrderParams({ limit: "0" }).filters.limit).toBe(1);
    expect(parseJobOrderParams({ limit: "99" }).filters.limit).toBe(50);
    expect(parseJobOrderParams({ limit: "abc" }).filters.limit).toBe(20);
  });

  it("keeps a page cursor that is an id and drops any other", () => {
    expect(parseJobOrderParams({ cursor: CURSOR }).filters.cursor).toBe(CURSOR);
    expect(parseJobOrderParams({ cursor: "2027-01-01|x" })).toEqual({
      filters: { limit: 20 },
      errors: { cursor: "The page link is not valid, so the first page is shown." },
    });
  });

  it("serialises a valid filter set to the query string it was parsed from", () => {
    const query =
      "destination=DE&source=PH&occupation=7212&industry=C&workers_min=50&workers_max=100&start_from=2027-01-01&start_to=2027-03-31&recruitment=international&cursor=" +
      CURSOR +
      "&limit=50";
    const { filters, errors } = parseJobOrderParams(Object.fromEntries(new URLSearchParams(query)));
    expect(errors).toEqual({});
    expect(jobOrderQuery(filters)).toBe(query);
    expect(jobOrderQuery({ limit: 20 })).toBe("");
    expect(hasJobOrderFilters(filters)).toBe(true);
    expect(hasJobOrderFilters({ cursor: CURSOR, limit: 20 })).toBe(false);
  });

  it("puts the filters of an address back into the form, without the cursor", () => {
    expect(jobOrderFormDefaults(`destination=nl&workers_min=5&cursor=${CURSOR}`)).toEqual({
      destination: "NL",
      source: "",
      occupation: "",
      industry: "",
      workers_min: "5",
      workers_max: "",
      start_from: "",
      start_to: "",
      recruitment: "",
    });
  });

  it("checks in the form the same orders as in the address", () => {
    const empty = jobOrderFormDefaults("");
    const workers = jobOrderFormSchema.safeParse({ ...empty, workers_min: "200", workers_max: "100" });
    expect(workers.success).toBe(false);
    expect(workers.error?.issues.map((issue) => issue.path.join("."))).toEqual(["workers_min"]);
    const dates = jobOrderFormSchema.safeParse({ ...empty, start_from: "2027-03-01", start_to: "2027-02-01" });
    expect(dates.error?.issues.map((issue) => issue.path.join("."))).toEqual(["start_from"]);
    expect(jobOrderFormSchema.safeParse({ ...empty, destination: "de" }).data?.destination).toBe("DE");
  });
});
