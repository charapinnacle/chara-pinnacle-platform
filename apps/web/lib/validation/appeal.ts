import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import type { StatusTone } from "@/lib/status-tone";
import { moderationFormSchema } from "@/lib/validation/admin";

type AppealStatus = Database["public"]["Enums"]["appeal_status"];

export const GROUNDS_MIN = 20;
export const GROUNDS_MAX = 2000;

// The grounds of an appeal against a moderation decision (FR-S1 AC12): 20 to 2,000 characters after trimming, as the
// database checks them.
export const appealFormSchema = z.object({
  grounds: z
    .string({ error: "Enter your grounds." })
    .trim()
    .min(GROUNDS_MIN, `Give grounds of at least ${GROUNDS_MIN} characters`)
    .max(GROUNDS_MAX, `The grounds can have at most ${GROUNDS_MAX} characters`),
});

export type AppealForm = z.input<typeof appealFormSchema>;

const positiveId = z.number().int().positive();

export const appealInputSchema = appealFormSchema.extend({ decision: positiveId });

export type AppealInput = z.input<typeof appealInputSchema>;

// An id of the address (a decision or an appeal), or null when it is not one.
export function idParam(value: string): number | null {
  const parsed = positiveId.safeParse(/^\d{1,15}$/.test(value) ? Number(value) : null);
  return parsed.success ? parsed.data : null;
}

// A second Trust & Safety Administrator upholds the decision or restores what it took away, with a statement of reasons.
export const appealOutcomes = ["uphold", "restore"] as const;

export type AppealOutcome = (typeof appealOutcomes)[number];

export const appealDecisionInputSchema = moderationFormSchema.extend({ id: positiveId, outcome: z.enum(appealOutcomes) });

export type AppealDecisionInput = z.input<typeof appealDecisionInputSchema>;

export const appealStatusLabels: Record<AppealStatus, string> = {
  open: "Appeal under review",
  upheld: "Decision upheld",
  restored: "Decision reversed",
};

export const appealStatusTones: Record<AppealStatus, StatusTone> = { open: "warning", upheld: "neutral", restored: "success" };

// The decisions that can be appealed, as the affected organisation and staff read them.
export const appealableDecisionLabels: Record<string, string> = {
  content_hidden: "Partner profile hidden",
  job_hidden: "Vacancy hidden",
  organization_suspended: "Organisation suspended",
};

export const appealTargetLabels: Record<string, string> = {
  partner_profile: "Partner profile",
  job: "Vacancy",
  organization: "Organisation",
  requirement: "Workforce requirement",
  partner_response: "Response",
  candidate_submission: "Candidate submission",
};

// The decision as a heading: a hidden job order, response or submission (V57) is named by its kind, not as a profile.
export function appealableDecisionLabel(action: string, targetType: string): string {
  if (action === "content_hidden" && targetType !== "partner_profile" && appealTargetLabels[targetType]) {
    return `${appealTargetLabels[targetType]} hidden`;
  }
  return appealableDecisionLabels[action] ?? "Moderation decision";
}

export const appealListStatuses = ["open", "decided", "all"] as const;

export type AppealListStatus = (typeof appealListStatuses)[number];

export const appealListStatusLabels: Record<AppealListStatus, string> = { open: "Open", decided: "Decided", all: "All" };

export const appealListStatusSchema = z.enum(appealListStatuses).catch("open");

// The open appeals continue after the due time and id of the last row; the decided ones after its id.
export type AppealCursor = { dueAt: string; id: number } | { id: number };

export const appealCursorSchema = z.string().transform((value, context): AppealCursor => {
  const parts = value.split("_");
  const id = z.coerce.number().int().positive();
  const parsed =
    parts.length === 2
      ? z.object({ dueAt: z.iso.datetime({ offset: true }), id }).safeParse({ dueAt: parts[0], id: parts[1] })
      : z.object({ id }).safeParse({ id: parts[0] });
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: "Not a cursor" });
    return z.NEVER;
  }
  return parsed.data;
});

export function appealCursorParam(cursor: AppealCursor): string {
  return "dueAt" in cursor ? `${cursor.dueAt}_${cursor.id}` : String(cursor.id);
}

// The KPI "Decisions reversed on appeal" (FR-S1) as a whole percentage of the decided appeals; null before any decision.
export function reversedShare(decided: number, restored: number): number | null {
  if (decided <= 0) return null;
  return Math.round((restored / decided) * 100);
}
