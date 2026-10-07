// One line per view of the candidate's list and of an application page, for the SOP KPI "tracker visits per application"
// (FR-D3). The line names neither the candidate nor the application: the visits are divided by the applications made in
// the period, which are counted in the audit log.
export function logTrackerView(page: "list" | "application"): void {
  process.stdout.write(`${JSON.stringify({ event: "tracker_view", page })}\n`);
}
