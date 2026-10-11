import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { contentPathFrom, vacancyIdFrom } from "@/lib/reports/target";
import { moderationFormSchema } from "@/lib/validation/admin";
import type { StatusTone } from "@/lib/status-tone";
import { emailSchema } from "@/lib/validation/sign-up";

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
} as const satisfies Record<Enums["report_target_type"], string>;

export const reportTargetTypes = ["job", "company", "profile", "content"] as const satisfies readonly Enums["report_target_type"][];

const categorySchema = z.string({ error: "Choose a category." }).pipe(
  z.enum(Object.keys(reportCategoryLabels) as [Enums["report_category"], ...Enums["report_category"][]], { error: "Choose a category." }),
);

const detailsSchema = z
  .string({ error: "Describe what you are reporting." })
  .trim()
  .min(DETAILS_MIN_CHARS, { error: `Describe it in at least ${DETAILS_MIN_CHARS} characters.` })
  .max(DETAILS_MAX_CHARS, { error: `Use at most ${DETAILS_MAX_CHARS} characters.` });

const optionalEmailSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || emailSchema.safeParse(value).success, { error: "Enter a valid email address." });

const goodFaithSchema = z.boolean().refine((value) => value, { error: "Confirm that you are reporting in good faith." });

// The fields every report form has. The address is only asked of a visitor, and the link only when the target is not
// already known.
const commonFields = { category: categorySchema, details: detailsSchema, email: optionalEmailSchema, goodFaith: goodFaithSchema };

const VACANCY_LINK = "Paste the address of a vacancy page on CHARA.";
const PAGE_LINK = "Enter the address of a page of CHARA, for example /en/jobs.";

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

export const reportReferenceSchema = z.object({ reference: z.string().regex(/^R-\d{6}$/), is_duplicate: z.boolean() });

export const reportIdSchema = z.number().int().positive();

// The cursor of the list of a reporter's own reports, as the address carries it (afterAt and afterId).
export const reportCursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.coerce.number().int().positive() });

// Closing a report takes the statement of reasons of every administrative action as its note to the reporter.
export const reportCloseInputSchema = moderationFormSchema.extend({
  id: reportIdSchema,
  status: z.enum(["actioned", "dismissed"] as const satisfies readonly Enums["report_status"][]),
});

export type ReportCloseInput = z.input<typeof reportCloseInputSchema>;

export const reportListFilterSchema = z.object({
  status: z.enum(["open", "new", "in_review", "actioned", "dismissed", "all"]).catch("open"),
  type: z.enum(reportTargetTypes).optional().catch(undefined),
});

export type ReportListFilter = z.output<typeof reportListFilterSchema>;
