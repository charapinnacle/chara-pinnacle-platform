import { usedFilters, type JobSearchFilters } from "@/lib/jobs/search-params";

type SearchLogEntry = { event: "job_search"; durationMs: number; filters: string[]; resultCount: number };

// One line per search for the monitoring of the 500 ms target and the zero-result rate (FR-C3 KPIs). It names the
// filters that were used and never what they held: a keyword or a city is something a person typed.
export function searchLogEntry(filters: JobSearchFilters, durationMs: number, resultCount: number): SearchLogEntry {
  return { event: "job_search", durationMs: Math.round(durationMs), filters: usedFilters(filters), resultCount };
}

export function logSearch(filters: JobSearchFilters, durationMs: number, resultCount: number): void {
  process.stdout.write(`${JSON.stringify(searchLogEntry(filters, durationMs, resultCount))}\n`);
}
