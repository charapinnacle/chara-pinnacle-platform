import * as z from "zod";
import { formatCount } from "@/lib/i18n/format";
import type { UnreadMessages } from "@/lib/messaging/thread";

const plural = (count: number, one: string, other: string) => `${formatCount(count)} ${count === 1 ? one : other}`;

// The matching workers of a dashboard (FR-R5 AC5, AC6), null while Find Workers is off: a count, a count below the
// small-count threshold, or the reason the organisation cannot search. Never a card.
export type MatchingWorkers =
  | { kind: "count"; count: number }
  | { kind: "suppressed"; fewerThan: number }
  | { kind: "unavailable"; reason: MatchingWorkersReason };

const reasons = ["feature_not_in_plan", "not_listed", "profile_hidden", "organization_suspended"] as const;

export type MatchingWorkersReason = (typeof reasons)[number];

const count = z.number().int().nonnegative();

export const matchingWorkersColumns = {
  matching_workers: count.nullable(),
  matching_workers_suppressed: z.boolean(),
  matching_workers_fewer_than: count.nullable(),
  matching_workers_reason: z.enum(reasons).nullable(),
};

type MatchingWorkersRow = {
  matching_workers: number | null;
  matching_workers_suppressed: boolean;
  matching_workers_fewer_than: number | null;
  matching_workers_reason: MatchingWorkersReason | null;
};

export function parseMatchingWorkers(row: MatchingWorkersRow): MatchingWorkers | null {
  if (row.matching_workers_reason) return { kind: "unavailable", reason: row.matching_workers_reason };
  if (row.matching_workers_suppressed && row.matching_workers_fewer_than !== null) {
    return { kind: "suppressed", fewerThan: row.matching_workers_fewer_than };
  }
  return row.matching_workers === null ? null : { kind: "count", count: row.matching_workers };
}

export type MatchingAudience = "employer" | "partner";

const needs: Record<MatchingAudience, string> = {
  employer: "your requirements",
  partner: "the occupations and countries you serve",
};

// The sentence of the block (FR-R5 AC6): "40 workers who chose to be visible match your requirements".
export function matchingWorkersText(value: Exclude<MatchingWorkers, { kind: "unavailable" }>, audience: MatchingAudience): string {
  if (value.kind === "suppressed") return `Fewer than ${formatCount(value.fewerThan)} workers match ${needs[audience]}.`;
  if (value.count === 0) {
    return audience === "employer"
      ? "No visible worker matches your open requirements and vacancies yet. Search Find Workers with other filters."
      : "No visible worker matches the occupations and countries you serve yet. Search Find Workers with other filters.";
  }
  return `${plural(value.count, "worker who chose to be visible matches", "workers who chose to be visible match")} ${needs[audience]}.`;
}

export const unavailableTexts: Record<MatchingWorkersReason, string> = {
  feature_not_in_plan: "Find Workers is included in paid plans.",
  not_listed: "Find Workers opens once your company is approved and listed.",
  profile_hidden: "Find Workers is closed while your profile is hidden by our team.",
  organization_suspended: "Find Workers is closed while your organisation is suspended.",
};

// The unread messages of one organisation's conversations among the caller's counts (FR-P1 AC7).
export function organizationUnread(counts: readonly UnreadMessages[], organizationId: string): number {
  return counts.reduce((sum, item) => (item.organizationId === organizationId ? sum + item.unread : sum), 0);
}

// Requests addressed to a recruitment or staffing company that wait for its answer (FR-R4 AC6).
export type PartnerRequests = { total: number; inquiries: number };

// The employer's own inquiries and workforce requests (FR-P2 step Track).
export type EmployerRequests = { waiting: number; answered: number };

// The worker's contact requests for the Find Workers card (FR-Q1 AC10).
export type ContactRequestCounts = { pending: number; received: number };

export function contactRequestsText({ pending, received }: ContactRequestCounts): string {
  if (received === 0) return "No contact requests received yet.";
  const total = plural(received, "contact request received", "contact requests received");
  return pending > 0 ? `${total}, ${formatCount(pending)} waiting for your answer.` : `${total}.`;
}
