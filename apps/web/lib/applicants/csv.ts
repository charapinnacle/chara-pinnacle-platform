import { applicationStatusLabels, FORMER_CANDIDATE } from "@/lib/applications/presentation";
import type { ApplicantExportRow } from "@/lib/dal/applicant-list";
import { formatIsoDate } from "@/lib/i18n/format";

const HEADER = ["Candidate", "Stage", "Applied", "Completeness (%)", "Documents"];

// A cell a spreadsheet would read as a formula gets a leading quote; a cell with a comma, a quote or a line break is
// quoted, with the quotes doubled (RFC 4180).
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function applicantsCsv(rows: readonly ApplicantExportRow[]): string {
  const body = rows.map((row) => [
    row.candidateName ?? FORMER_CANDIDATE,
    applicationStatusLabels[row.status],
    formatIsoDate(row.appliedAt),
    String(row.completeness),
    String(row.documents),
  ]);
  return [HEADER, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
