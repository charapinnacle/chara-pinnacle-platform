import type { Database } from "@chara-pinnacle/db-types";
import { formatCount } from "@/lib/i18n/format";

type RequirementStatus = Database["public"]["Enums"]["requirement_status"];

// The periods of the public settings requirement_open_days, requirement_extension_days and
// requirement_closing_reminder_days (NFR-O5): an administrator changes them, the pages follow.
export type RequirementDurations = { openDays: number; extensionDays: number; reminderDays: number };

const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// The closing date of a requirement published on publishedOn (a UTC date) that starts on startDate: the later of the
// start date and openDays after publication (decision 3.5), as private.requirement_closes_on stores it.
export function requirementClosesOn(publishedOn: string, startDate: string, openDays: number): string {
  const end = addDays(publishedOn, openDays);
  return end > startDate ? end : startDate;
}

// The closing date after one extension, as extend_requirement moves it: counted from today when the date has passed.
export function extendedClosesOn(closesOn: string, today: string, extensionDays: number): string {
  return addDays(closesOn > today ? closesOn : today, extensionDays);
}

// Within the reminder period the employer is told it closes soon and offered the extension (FR-M2 step Expire).
export function isClosingSoon(closesOn: string, today: string, reminderDays: number): boolean {
  return closesOn >= today && closesOn <= addDays(today, reminderDays);
}

export type RequirementAction = "publish" | "pause" | "reopen" | "close" | "fill" | "extend";

// The changes the database guard allows an owner or admin (FR-M2 AC12); the guard is the authority, this only decides
// what to offer. A paused requirement is not filled (DATA_MODEL.md section 11.3), Closed and Filled are final.
export const requirementActions: Record<RequirementStatus, readonly RequirementAction[]> = {
  draft: ["publish"],
  open: ["pause", "close", "fill", "extend"],
  paused: ["reopen", "close", "extend"],
  closed: [],
  filled: [],
};

export function extendLabel(days: number): string {
  return `Extend by ${formatCount(days)} ${days === 1 ? "day" : "days"}`;
}
