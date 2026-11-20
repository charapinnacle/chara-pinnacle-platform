import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { contentPathFrom, vacancyIdFrom } from "@/lib/reports/target";
import { moderationFormSchema } from "@/lib/validation/admin";
import type { StatusTone } from "@/lib/status-tone";
import { characters } from "@/lib/utils";
import { emailSchema } from "@/lib/validation/sign-up";
import { BRAND_NAME } from "@/lib/brand";

type Enums = Database["public"]["Enums"];

const DETAILS_MIN_CHARS = 20;
export const DETAILS_MAX_CHARS = 2000;

export const reportCategoryLabels = {
  illegal_content: "Illegal content",
  misleading_or_fraud: "Misleading or fraudulent",
  discrimination: "Discrimination",
  fee_demanded_from_worker: "A fee is demanded from the worker",
  harassment: "Harassment",
  privacy_violation: "Privacy violation",
  other: "Something else",
} as const satisfies Record<Enums["report_category"], string>;

export const reportCategoryOptions = Object.entries(reportCategoryLabels).map(([value, label]) => ({ value, label }));

export const FEE_DEMAND = "fee_demanded_from_worker" satisfies Enums["report_category"];

// On a partner profile and a submission the fee category says what a worker experienced (FR-J3 AC8); elsewhere it keeps
// its Phase 1 label.
export function reportCategoryOptionsFor(type: Enums["report_target_type"]) {
  if (type !== "partner_profile" && type !== "candidate_submission") return reportCategoryOptions;
  return reportCategoryOptions.map((option) =>
    option.value === FEE_DEMAND ? { value: option.value, label: "The company asked me to pay a fee" } : option,
  );
}

// The label of a fee-demand report in the queue, where it comes first (FR-S1 AC10).
export const FEE_DEMAND_LABEL = "Fee demand";

export const reportStatusLabels = {
  new: "New",
  in_review: "In review",
  actioned: "Actioned",
  dismissed: "Dismissed",
} as const satisfies Record<Enums["report_status"], string>;

// The tone of a status in a list; the label always says it in words.
export const reportStatusTones = {
  new: "info",
  in_review: "warning",
  actioned: "success",
  dismissed: "neutral",
} as const satisfies Record<Enums["report_status"], StatusTone>;

export const reportTargetLabels = {
  job: "Vacancy",
  company: "Company",
  profile: "Candidate profile",
  content: "Page",
  partner_profile: "Partner profile",
  requirement: "Job order",
  partner_response: "Partner response",
  candidate_submission: "Candidate submission",
} as const satisfies Record<Enums["report_target_type"], string>;

export const reportTargetTypes = [
  "job",
  "company",
  "profile",
  "content",
  "partner_profile",
  "requirement",
  "partner_response",
  "candidate_submission",
] as const satisfies readonly Enums["report_target_type"][];

// The items of the job order network (V57): reported by a participant only, from the page of the item.
export const reportItemTypes = ["requirement", "partner_response", "candidate_submission"] as const satisfies readonly Enums["report_target_type"][];

export type ReportItemType = (typeof reportItemTypes)[number];

export function isReportItem(type: Enums["report_target_type"]): type is ReportItemType {
  return (reportItemTypes as readonly string[]).includes(type);
}

// The category a report link may preselect (?category=), for example "Report a fee demand"; anything else selects none.
export const reportCategorySchema = z.enum(Object.keys(reportCategoryLabels) as [Enums["report_category"], ...Enums["report_category"][]], {
  error: "Choose a category.",
});

const categorySchema = z.string({ error: "Choose a category." }).pipe(reportCategorySchema);

const detailsSchema = z
  .string({ error: "Describe what you are reporting." })
  .trim()
  .refine((value) => characters(value) >= DETAILS_MIN_CHARS, { error: `Describe it in at least ${DETAILS_MIN_CHARS} characters.` })
  .refine((value) => characters(value) <= DETAILS_MAX_CHARS, { error: `Use at most ${DETAILS_MAX_CHARS} characters.` });

const optionalEmailSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || emailSchema.safeParse(value).success, { error: "Enter a valid email address." });

const goodFaithSchema = z.boolean().refine((value) => value, { error: "Confirm that you are reporting in good faith." });

// The fields every report form has. The address is only asked of a visitor, and the link only when the target is not
// already known.
const commonFields = { category: categorySchema, details: detailsSchema, email: optionalEmailSchema, goodFaith: goodFaithSchema };

export const VACANCY_LINK = `Paste the address of a vacancy page on ${BRAND_NAME}.`;
export const PAGE_LINK = `Enter the address of a page of ${BRAND_NAME}, for example /en/jobs.`;

const vacancyReportFormSchema = z.object({
  ...commonFields,
  link: z.string().trim().refine((value) => vacancyIdFrom(value) !== null, { error: VACANCY_LINK }),
});

const contentReportFormSchema = z.object({
  ...commonFields,
  link: z.string().trim().refine((value) => contentPathFrom(value) !== null, { error: PAGE_LINK }),
});

// A form whose target is known has no link to check.
const knownTargetReportFormSchema = z.object({ ...commonFields, link: z.string() });

export type ReportFormInput = z.input<typeof knownTargetReportFormSchema>;

export function reportFormSchemaFor(type: Enums["report_target_type"], targetKnown: boolean) {
  if (targetKnown) return knownTargetReportFormSchema;
  return type === "content" ? contentReportFormSchema : vacancyReportFormSchema;
}

// What the Server Action receives: the kind, the target (the vacancy for a vacancy or a company, the application for a
// profile, a path for a page) and the fields of the form. The action resolves the link itself, so a form cannot send a
// target it did not parse.
export const reportInputSchema = z.object({
  type: z.enum(reportTargetTypes),
  target: z.string().trim().min(1).max(2048),
  ...commonFields,
});

export type ReportInput = z.input<typeof reportInputSchema>;

export const reportReferenceSchema = z.object({ reference: z.string().regex(/^R-\d{6,}$/), is_duplicate: z.boolean() });

export const reportIdSchema = z.number().int().positive();

// The cursor of the list of a reporter's own reports, as the address carries it (afterAt and afterId).
export const reportCursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.coerce.number().int().positive() });

// Every move of a report takes the statement of reasons of every administrative action. The reason of a closing is also
// the note that a signed-in reporter reads.
export const reportMoveInputSchema = moderationFormSchema.extend({
  id: reportIdSchema,
  status: z.enum(["in_review", "actioned", "dismissed"] as const satisfies readonly Enums["report_status"][]),
});

export type ReportMoveInput = z.input<typeof reportMoveInputSchema>;

export const reportListStatuses = ["open", "new", "in_review", "actioned", "dismissed", "all"] as const;

export const reportListStatusLabels = {
  open: "Open (new and in review)",
  ...reportStatusLabels,
  all: "All",
} as const satisfies Record<(typeof reportListStatuses)[number], string>;

export const reportListFilterSchema = z.object({
  status: z.enum(reportListStatuses).catch("open"),
  type: z.enum(reportTargetTypes).optional().catch(undefined),
});

export type ReportListFilter = z.output<typeof reportListFilterSchema>;

// The page of the open queue after a cursor: the priority, due time and id of the last row shown, as one query value
// ("<priority>_<iso time>_<id>"). A closed list pages on the id alone ("<id>").
export type ReportQueueCursor = { priority: number; dueAt: string; id: number } | { id: number };

const cursorId = z.string().regex(/^\d{1,15}$/).transform(Number);

export const reportQueueCursorSchema = z.string().transform((value, context): ReportQueueCursor => {
  const parts = value.split("_");
  const parsed =
    parts.length === 3
      ? z
          .object({ priority: z.string().regex(/^[1-9]$/).transform(Number), dueAt: z.iso.datetime({ offset: true }), id: cursorId })
          .safeParse({ priority: parts[0], dueAt: parts[1], id: parts[2] })
      : z.object({ id: cursorId }).safeParse({ id: parts.length === 1 ? parts[0] : "" });
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: "Not a cursor" });
    return z.NEVER;
  }
  return parsed.data;
});

export function reportQueueCursorParam(cursor: ReportQueueCursor): string {
  return "priority" in cursor ? `${cursor.priority}_${cursor.dueAt}_${cursor.id}` : String(cursor.id);
}

export function isFeeDemand(category: string): boolean {
  return category === FEE_DEMAND;
}

// The decisions of FR-S1 on an open report (moderation_decide): hide the item, suspend its organisation, or dismiss. The
// reasons are the statement of reasons sent to the affected party and the note a signed-in reporter reads.
export const reportDecisionValues = ["hide", "suspend_organization", "dismiss"] as const;

export type ReportDecisionValue = (typeof reportDecisionValues)[number];

export const reportDecisionInputSchema = moderationFormSchema.extend({ id: reportIdSchema, decision: z.enum(reportDecisionValues) });

export type ReportDecisionInput = z.input<typeof reportDecisionInputSchema>;

type DecisionTarget = {
  targetType: Enums["report_target_type"];
  job: { moderationState: Enums["job_moderation_state"] } | null;
  item?: { moderationState: Enums["job_moderation_state"] | null } | null;
  organization: { status: Enums["organization_status"]; moderationState: Enums["job_moderation_state"] | null } | null;
};

// A decision the console offers. A report that asks for what an earlier decision already did (the item is hidden, the
// organisation suspended) is closed actioned with the same decision, which the database records without acting again.
export type ReportDecisionOption = "hide" | "hide_in_effect" | "suspend_organization" | "suspend_in_effect" | "dismiss";

export const decisionOfOption = {
  hide: "hide",
  hide_in_effect: "hide",
  suspend_organization: "suspend_organization",
  suspend_in_effect: "suspend_organization",
  dismiss: "dismiss",
} as const satisfies Record<ReportDecisionOption, ReportDecisionValue>;

// What the console offers for the target of a report, as the database allows it: a vacancy, partner profile, job order,
// response or submission can be hidden (or the report closed on a hide in effect), the organisation of any of them or of
// a company suspended (or the report closed on a suspension in effect), and every report dismissed. An item hidden with
// the suspension of its organisation is not hidden on its own. A report about a candidate or a page has nothing on the
// platform to act on; it is closed with a note instead.
export function reportDecisionsFor({ targetType, job, item, organization }: DecisionTarget): ReportDecisionOption[] {
  const decisions: ReportDecisionOption[] = [];
  const itemState =
    targetType === "job"
      ? job?.moderationState
      : targetType === "partner_profile"
        ? organization?.moderationState
        : isReportItem(targetType)
          ? item?.moderationState
          : null;
  if (itemState === "visible") decisions.push("hide");
  if (itemState === "hidden") decisions.push("hide_in_effect");
  if (targetType === "job" || targetType === "company" || targetType === "partner_profile" || isReportItem(targetType)) {
    if (organization?.status === "active") decisions.push("suspend_organization");
    if (organization?.status === "suspended") decisions.push("suspend_in_effect");
  }
  decisions.push("dismiss");
  return decisions;
}

export function closesWithNote(targetType: Enums["report_target_type"]): boolean {
  return targetType === "profile" || targetType === "content";
}

// The decision recorded on a closed report, by its moderation action; content_hidden names the kind of item.
export const reportDecisionLabels: Record<string, string> = {
  job_hidden: "Vacancy hidden",
  content_hidden: "Partner profile hidden",
  organization_suspended: "Organisation suspended",
};

export function reportDecisionLabel(decision: string, targetType: Enums["report_target_type"]): string {
  if (decision === "content_hidden" && isReportItem(targetType)) return `${reportTargetLabels[targetType]} hidden`;
  return reportDecisionLabels[decision] ?? decision;
}

// The reference of a report as the database writes it (private.report_reference): R- and the id, six digits at least.
export function reportReference(id: number): string {
  return `R-${String(id).padStart(6, "0")}`;
}
