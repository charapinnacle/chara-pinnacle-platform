import type { Database } from "@chara-pinnacle/db-types";
import type { StatusTone } from "@/lib/status-tone";
import { formatCount } from "@/lib/i18n/format";

export type SubmissionStatus = Database["public"]["Enums"]["submission_status"];

export const SUBMISSION_LIMIT_KEY = "candidate_submissions_per_month";

// The status as the partner reads it (FR-O4 AC2, AC7, AC12): "Request sent" is the same for every address, and the
// stages after Submitted are the employer's (FR-O5).
export const partnerSubmissionLabels: Record<SubmissionStatus, string> = {
  awaiting_candidate: "Awaiting candidate",
  declined_by_candidate: "Declined by candidate",
  expired: "Expired",
  submitted: "Submitted",
  viewed: "Viewed by the employer",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Not selected",
  withdrawn: "Withdrawn by candidate",
};

// The status as the candidate reads it.
export const candidateSubmissionLabels: Record<SubmissionStatus, string> = {
  awaiting_candidate: "Waiting for your answer",
  declined_by_candidate: "Declined",
  expired: "Expired",
  submitted: "Submitted",
  viewed: "Viewed by the employer",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Not selected",
  withdrawn: "Withdrawn",
};

export const submissionTones: Record<SubmissionStatus, StatusTone> = {
  awaiting_candidate: "warning",
  declined_by_candidate: "neutral",
  expired: "neutral",
  submitted: "info",
  viewed: "info",
  shortlisted: "info",
  interview: "info",
  offer: "success",
  hired: "success",
  rejected: "neutral",
  withdrawn: "neutral",
};

// The candidate's next step on an answered submission (NFR-U4).
export const candidateNextSteps: Record<Exclude<SubmissionStatus, "awaiting_candidate">, string> = {
  declined_by_candidate: "You declined this request. Nothing was shared with the employer.",
  expired: "You did not answer this request in time, so it expired. Nothing was shared with the employer.",
  submitted: "The employer can now read your profile and the documents you chose. You can withdraw at any time.",
  viewed: "The employer has looked at your profile. You can withdraw at any time.",
  shortlisted: "The employer shortlisted you. You can withdraw at any time.",
  interview: "The employer would like to interview you. You can withdraw at any time.",
  offer: "The employer is making you an offer. You can withdraw at any time.",
  hired: "The employer marked you as hired. You can still withdraw, which ends the employer's access to your documents.",
  rejected: "The employer did not select you for this requirement. You can withdraw to end the access to your documents.",
  withdrawn: "You withdrew this submission. The employer can no longer open your documents.",
};

// The partner's next step for each status (NFR-U4).
export const partnerNextSteps: Record<SubmissionStatus, string> = {
  awaiting_candidate: "The candidate has not answered yet. Nothing reaches the employer until they approve.",
  declined_by_candidate: "The candidate declined. Nothing was shared with the employer.",
  expired: "The candidate did not answer in time. Nothing was shared with the employer.",
  submitted: "The candidate approved. The employer can read the profile and the documents the candidate chose.",
  viewed: "The employer has opened the candidate's profile.",
  shortlisted: "The employer shortlisted the candidate.",
  interview: "The employer is interviewing the candidate.",
  offer: "The employer is making the candidate an offer.",
  hired: "The employer marked the candidate as hired.",
  rejected: "The employer did not select the candidate.",
  withdrawn: "The candidate withdrew. The employer can no longer open the documents.",
};

// Once the candidate approved, until they withdraw (withdraw_submission).
export function isWithdrawable(status: SubmissionStatus, approvedAt: string | null): boolean {
  return approvedAt !== null && status !== "withdrawn";
}

export function submissionUsageText(used: number, limit: number): string {
  return `${formatCount(used)} of ${formatCount(limit)} submissions used this month`;
}

export function submissionCountText(count: number, more: boolean): string {
  return `${more ? "The newest " : ""}${formatCount(count)} ${count === 1 ? "candidate" : "candidates"}`;
}

// The stages of an approved submission in the employer's pipeline (FR-O5): those of an application, with Submitted in
// place of Applied, in the same order.
export const pipelineSubmissionStages = [
  "submitted",
  "viewed",
  "shortlisted",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
] as const satisfies readonly SubmissionStatus[];

export type PipelineSubmissionStage = (typeof pipelineSubmissionStages)[number];

// What a bulk move leaves out, said before the employer confirms it.
export const BULK_MOVE_SKIPPED =
  "Candidates who withdrew, and candidates who cannot move to this stage from their current one, are skipped";

export const employerSubmissionLabels: Record<PipelineSubmissionStage, string> = {
  submitted: "Submitted",
  viewed: "Viewed",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Not selected",
  withdrawn: "Withdrawn",
};

export function isPipelineSubmissionStage(value: unknown): value is PipelineSubmissionStage {
  return typeof value === "string" && Object.hasOwn(employerSubmissionLabels, value);
}

// The label FR-O5 AC1 puts on every submitted candidate in the pipeline.
export function submittedByLabel(partnerName: string): string {
  return `Submitted by ${partnerName}`;
}

// How the candidate's journey tracker names a submission (FR-O5 AC9).
export function proposedByLabel(partnerName: string, title: string): string {
  return `Proposed by ${partnerName} for ${title}`;
}

// What the candidate reads about who moved a stage.
export const submissionActorLabels: Record<string, string> = {
  candidate: "By you",
  employer: "By the employer",
  system: "Automatic",
};
