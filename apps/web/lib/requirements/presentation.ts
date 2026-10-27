import type { Database } from "@chara-pinnacle/db-types";
import { formatCount } from "@/lib/i18n/format";
import type { StatusTone } from "@/lib/status-tone";

type RequirementStatus = Database["public"]["Enums"]["requirement_status"];

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

// The status of a requirement with what it means for partners and what comes next (NFR-U4). Publishing is V33; until
// then a draft says only that partners do not see it.
export const requirementStatusNotices: Record<RequirementStatus, string> = {
  draft: "Draft - not visible to partners",
  open: "Open - partners can respond",
  paused: "Paused - partners cannot respond",
  closed: "Closed - final",
  filled: "Filled - final",
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
