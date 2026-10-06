import type { Viewer } from "@/lib/jobs/viewer";

type VacancyEntry =
  | { event: "vacancy_view"; outcome: "ok"; jobId: string; viewer: Viewer }
  | { event: "vacancy_view"; outcome: "unavailable"; viewer: Viewer }
  | { event: "vacancy_action"; action: "apply" | "save"; jobId: string; viewer: Viewer };

// One line per page view and per press of Apply or Save, for the Apply click-through rate (FR-C4 KPI) and the share of
// views that meet a vacancy that is no longer available. The id of a vacancy is public; nobody who looked is named, and
// the id of a page that is not available is not written, because it is text from the address.
export function logVacancy(entry: VacancyEntry): void {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}
