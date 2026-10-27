import type { Database } from "@chara-pinnacle/db-types";
import { formatCount } from "@/lib/i18n/format";
import type { StatusTone } from "@/lib/status-tone";

type RequirementStatus = Database["public"]["Enums"]["requirement_status"];
type CloseReason = Database["public"]["Enums"]["requirement_close_reason"];

export const requirementStatusLabels: Record<RequirementStatus, string> = {
  draft: "Draft",
  open: "Open",
  paused: "Paused",
  closed: "Closed",
  filled: "Filled",
};

export const requirementStatusTones: Record<RequirementStatus, StatusTone> = {
  draft: "neutral",
  open: "success",
  paused: "warning",
  closed: "neutral",
  filled: "info",
};

// The status of a requirement with what it means for partners (NFR-U4); the status notice adds the date that matters.
export const requirementStatusNotices: Record<RequirementStatus, string> = {
  draft: "Draft - not visible to partners",
  open: "Open - partners can respond",
  paused: "Paused - partners cannot respond",
  closed: "Closed - final",
  filled: "Filled - final",
};

// How a closed or filled requirement ended, followed by its date.
export const closeReasonTexts: Record<CloseReason, string> = {
  filled: "Marked as filled",
  cancelled: "Closed by your company",
  expired: "Closed automatically when its closing date passed",
};

export function isRequirementEditable(status: RequirementStatus): boolean {
  return status !== "closed" && status !== "filled";
}

export function workersText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "worker" : "workers"}`;
}

export function monthsText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "month" : "months"}`;
}

export function yearsText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "year" : "years"}`;
}
