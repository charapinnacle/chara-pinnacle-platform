import * as z from "zod";
import { statementSchema } from "@/lib/validation/admin";

// The staff review of a recruitment or staffing company (FR-J1, FR-J4; DATA_MODEL.md section 5).
export const reviewStatusSchema = z.enum(["onboarding", "pending_review", "info_requested", "listed", "re_review", "declined"]);

export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

// The steps staff may reopen with a request for information (organizations.info_step), with their place in the step
// indicator of partner onboarding (Company, Where you serve, Commitments, Security, Ready).
export const infoStepSchema = z.enum(["company", "where_you_serve", "commitments"]);

export type InfoStep = z.infer<typeof infoStepSchema>;

export const infoStepIndex = { company: 0, where_you_serve: 1, commitments: 2 } as const satisfies Record<InfoStep, number>;

export const infoStepLabels = {
  company: "your company details",
  where_you_serve: "where you serve and what you offer",
  commitments: "the employer-pays commitment",
} as const satisfies Record<InfoStep, string>;

// The organisation is in the staff queue: submitted, and not yet decided.
export function awaitingReview(status: ReviewStatus): status is "pending_review" | "re_review" {
  return status === "pending_review" || status === "re_review";
}

// The organisation may (still or again) be submitted from the Ready step.
export function submittable(status: ReviewStatus): boolean {
  return status === "onboarding" || status === "info_requested";
}

// What staff check before a partner is listed (FR-J1 AC11, FR-J4); never called verification (decision 2.6).
export const REVIEW_CHECKS = [
  "Your company name and registration number",
  "Your website",
  "The licences you declare",
] as const;

export function reviewTimeText(workingDays: number): string {
  return workingDays === 1 ? "one working day" : `${workingDays} working days`;
}

// The review target of decision 7.2, a setting (partner_review_target_working_days); one working day when it is unset.
export function parseReviewTarget(value: string | undefined): number {
  const parsed = z.coerce.number().int().min(1).max(30).safeParse(value);
  return parsed.success ? parsed.data : 1;
}

// The details of CHARA_PROFILE_INCOMPLETE from submit_partner_for_review, said as what to do next.
export const missingFieldMessages: Readonly<Record<string, string>> = {
  legal_entity_identifier: "Add your company registration number, VAT number or other identifier, then submit again.",
  sources_from: "Choose at least one country you source workers from, then submit again.",
  serves_market: "Choose at least one country you serve, then submit again.",
  occupations: "Choose at least one occupation you recruit or supply, then submit again.",
  recruitment_type: "Choose your recruitment type, then submit again.",
  staffing_types: "Choose at least one staffing type, then submit again.",
  employer_pays_commitment: "The owner needs to accept the current employer-pays commitment, then submit again.",
};

// The staff decisions on a partner in the queue (FR-J4 AC3), as admin_decide_partner names them.
export const partnerDecisionSchema = z.enum(["approve", "request_info", "decline"]);

export type PartnerDecision = z.infer<typeof partnerDecisionSchema>;

// The statement of reasons (10 to 2,000 characters, as the database checks it) and, for a request for information, the
// step it reopens; the other decisions leave the step empty.
export function decisionFormSchema(decision: PartnerDecision) {
  return z.object({
    reason: statementSchema,
    infoStep: decision === "request_info" ? infoStepSchema.or(z.literal("")).refine((step) => step !== "", "Choose the step to reopen") : z.literal(""),
  });
}

export type DecisionForm = { reason: string; infoStep: InfoStep | "" };

export const decisionInputSchema = z
  .object({
    organizationId: z.uuid(),
    decision: partnerDecisionSchema,
    reason: statementSchema,
    infoStep: infoStepSchema.nullable(),
  })
  .refine((value) => (value.decision === "request_info") === (value.infoStep !== null), {
    path: ["infoStep"],
    message: "Choose the step to reopen",
  });

export type DecisionInput = z.input<typeof decisionInputSchema>;

// What staff read about the state of a partner; never shown to the public (DATA_MODEL.md section 10).
export const reviewStatusLabels = {
  onboarding: "Onboarding",
  pending_review: "Waiting for review",
  info_requested: "Information requested",
  listed: "Listed",
  re_review: "Waiting for re-review",
  declined: "Declined",
} as const satisfies Record<ReviewStatus, string>;

export const decisionLabels = {
  approve: "Listed",
  request_info: "Information requested",
  decline: "Declined",
} as const satisfies Record<PartnerDecision, string>;

// The steps staff may reopen, as staff read them.
export const infoStepStaffLabels = {
  company: "Company details",
  where_you_serve: "Where you serve and what you offer",
  commitments: "Employer-pays commitment",
} as const satisfies Record<InfoStep, string>;

// What staff tick before they decide (FR-J4 AC2); a reminder on the page, not stored.
export const STAFF_REVIEW_CHECKS = [
  "Legal entity matches public register",
  "Website belongs to the company",
  "Licences reviewed",
] as const;

// Whether the review target of a partner in the queue has passed (decision 7.2).
export function reviewOverdue(dueAt: string | null, now: Date): boolean {
  return dueAt !== null && new Date(dueAt).getTime() < now.getTime();
}

// The page of the queue after a cursor: the submission time and id of the last row shown, as one query value
// ("<iso time>_<uuid>").
export const queueCursorSchema = z
  .string()
  .transform((value, context) => {
    const at = value.slice(0, value.lastIndexOf("_"));
    const id = value.slice(value.lastIndexOf("_") + 1);
    const parsed = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() }).safeParse({ at, id });
    if (!parsed.success) {
      context.addIssue({ code: "custom", message: "Not a cursor" });
      return z.NEVER;
    }
    return parsed.data;
  });

export type QueueCursor = { at: string; id: string };

export function queueCursorParam(cursor: QueueCursor): string {
  return `${cursor.at}_${cursor.id}`;
}
