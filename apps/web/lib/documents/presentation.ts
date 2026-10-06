const DAY_MS = 86_400_000;
const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * 1024;

// How far ahead an expiring document is flagged, on the passport and the dashboard.
const REMINDER_DAYS = 30;

function utcMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

// today and expiresOn are UTC dates, YYYY-MM-DD. A date more than 30 days ahead carries no label.
export function expiryLabel(expiresOn: string | null, today: string): string | null {
  if (expiresOn === null) return null;
  const days = Math.round((utcMs(expiresOn) - utcMs(today)) / DAY_MS);
  if (days < 0) return "Expired";
  if (days === 0) return "Expires today";
  if (days > REMINDER_DAYS) return null;
  return days === 1 ? "Expires in 1 day" : `Expires in ${days} days`;
}

export function reminderCutoff(today: string): string {
  return new Date(utcMs(today) + REMINDER_DAYS * DAY_MS).toISOString().slice(0, 10);
}

const oneDecimal = (value: number) => String(Number(value.toFixed(1)));

// 1 MB is 1,048,576 bytes.
export function formatFileSize(bytes: number): string {
  if (bytes < KILOBYTE) return `${bytes} B`;
  if (bytes < MEGABYTE) return `${oneDecimal(bytes / KILOBYTE)} KB`;
  return `${oneDecimal(bytes / MEGABYTE)} MB`;
}

// A document the candidate can download and, later, share: the scan found nothing wrong, or no vendor scans yet.
export const USABLE_SCAN_STATUSES = ["skipped", "clean"] as const;

export function isUsableScanStatus(scanStatus: string): boolean {
  return (USABLE_SCAN_STATUSES as readonly string[]).includes(scanStatus);
}

const REJECTED_LABEL = "File rejected: not a valid PDF, JPG or PNG";

// The scan starts a moment after the bytes arrive and the database announces a pending object again from the second
// minute on (private.rescan_pending_documents), so a pending row younger than this is still being checked.
const SCAN_WINDOW_MS = 5 * 60_000;

export function isAwaitingScan(scanStatus: string, createdAt: string, nowMs: number): boolean {
  return scanStatus === "pending" && nowMs - Date.parse(createdAt) < SCAN_WINDOW_MS;
}

// A pending row is either an upload that is being checked, or one that never finished.
export function documentStatus(scanStatus: string, checking: boolean): { label: string; usable: boolean } {
  if (isUsableScanStatus(scanStatus)) return { label: "Ready", usable: true };
  if (scanStatus === "rejected") return { label: REJECTED_LABEL, usable: false };
  return { label: checking ? "Checking the file" : "Upload not finished", usable: false };
}

// null applications: the count could not be read.
export function shareWarning(applications: number | null): string | null {
  if (applications === null) {
    return "We could not check whether this document is shared. If it is, deleting it ends the employers' access to all documents shared with it.";
  }
  if (applications === 0) return null;
  const [noun, pronoun] = applications === 1 ? ["application", "it"] : ["applications", "them"];
  return `This document is shared with ${applications} ${noun}. Deleting it ends the employers' access to all documents shared in ${pronoun}.`;
}
