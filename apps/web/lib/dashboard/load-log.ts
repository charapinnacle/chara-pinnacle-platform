// One line per dashboard load for the SOP KPI "dashboard load time" (FR-E5) and the 500 ms target (NFR-P1): the time
// from the first read to the last. It names no organisation and no number. A load in which a read failed is logged as
// error, so the slowest loads are not missing from the percentile.
export function logDashboardLoad(durationMs: number, outcome: "ok" | "error"): void {
  process.stdout.write(`${JSON.stringify({ event: "dashboard_load", durationMs: Math.round(durationMs), outcome })}\n`);
}
