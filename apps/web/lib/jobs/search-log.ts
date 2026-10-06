import { usedFilters, type JobSearchFilters } from "@/lib/jobs/search-params";

type SearchOutcome = "ok" | "error";
type SearchLogEntry = {
  event: "job_search";
  durationMs: number;
  filters: string[];
  resultCount: number;
  outcome: SearchOutcome;
};

// One line per search for the monitoring of the 500 ms target and the zero-result rate (FR-C3 KPIs). It names the
// filters that were used and never what they held: a keyword or a city is something a person typed. A search that failed
// is logged too, with a count of 0 and no text of the error, so the slowest searches are not missing from the percentile.
export function searchLogEntry(
  filters: JobSearchFilters,
  durationMs: number,
  resultCount: number,
  outcome: SearchOutcome,
): SearchLogEntry {
  return { event: "job_search", durationMs: Math.round(durationMs), filters: usedFilters(filters), resultCount, outcome };
}

export function logSearch(filters: JobSearchFilters, durationMs: number, resultCount: number, outcome: SearchOutcome): void {
  process.stdout.write(`${JSON.stringify(searchLogEntry(filters, durationMs, resultCount, outcome))}\n`);
}
