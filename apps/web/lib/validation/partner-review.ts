import * as z from "zod";

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
