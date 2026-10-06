import { afterEach, describe, expect, it, vi } from "vitest";
import { logSearch, searchLogEntry } from "@/lib/jobs/search-log";

afterEach(() => vi.restoreAllMocks());

describe("the search timing log", () => {
  it("holds the duration, the names of the filters used and the result count, but no filter value", () => {
    const entry = searchLogEntry({ q: "welder", country: "DE", salary_min: 3000, limit: 20 }, 42.4, 7);
    expect(entry).toEqual({ event: "job_search", durationMs: 42, filters: ["q", "country", "salary_min"], resultCount: 7 });
    const text = JSON.stringify(entry);
    for (const value of ["welder", "DE", "3000"]) expect(text).not.toContain(`"${value}"`);
    expect(text).not.toContain("welder");
  });

  it("does not count the page cursor or the page size as filters, and skips filters that are not set", () => {
    const cursor = "0|2026-10-07T10:00:00.000000Z|6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
    expect(searchLogEntry({ city: "Hamburg", accommodation: undefined, cursor, limit: 5 }, 1, 0).filters).toEqual(["city"]);
    expect(searchLogEntry({ limit: 20 }, 1, 0).filters).toEqual([]);
  });

  it("writes one JSON line without the values", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    logSearch({ q: "welder", country: "DE", limit: 20 }, 12, 0);
    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0][0]);
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({ event: "job_search", durationMs: 12, filters: ["q", "country"], resultCount: 0 });
    expect(line).not.toContain("welder");
  });
});
