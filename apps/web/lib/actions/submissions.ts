"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { profileFields } from "@/lib/applications/presentation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import type { UsagePrompt } from "@/lib/billing/limits";
import { getApplyLimits } from "@/lib/dal/applications";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole, requireUser } from "@/lib/dal/session";
import { getUsagePrompts } from "@/lib/dal/usage";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { reportQuotaRefused } from "@/lib/quota-refused";
import { newSubmissionPath, partnerSubmissionsPath, requirementSubmissionsPath, submissionPath, submissionsPath } from "@/lib/routes";
import { SUBMISSION_LIMIT_KEY } from "@/lib/submissions/presentation";
import { answerRefusal, SUBMISSION_MESSAGES, submitRefusal, withdrawRefusal } from "@/lib/submissions/refusal";
import { createClient } from "@/lib/supabase/server";
import {
  approveFormSchema,
  submitCandidateFormSchema,
  type ApproveFormInput,
  type SubmitCandidateFormInput,
} from "@/lib/validation/submission";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

const idSchema = z.uuid();

export type SubmitCandidateResult = {
  errors?: FieldErrors;
  message?: string;
  limitReached?: UsagePrompt;
  sent?: { existing: boolean };
};

// Asks the candidate at the address for permission to submit them for the requirement (FR-O4 step Request, AC1 to AC4,
// AC12), for any accepted member of the partner (no aal2) while the release is on; submit_candidate checks the selection,
// the plan, the commitment and the monthly limit again. The reply is the same whether the address has an account or not
// (AC2), and a second press for the same address answers the request already sent, counting nothing.
export async function submitCandidate(slug: string, requirementId: string, input: SubmitCandidateFormInput): Promise<SubmitCandidateResult> {
  const id = idSchema.safeParse(requirementId);
  const parsedSlug = slugSchema.safeParse(slug);
  if (!id.success || !parsedSlug.success) return { message: GENERIC_FAILURE };
  const parsed = submitCandidateFormSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (!(await isReleased("release_candidate_submissions"))) return { message: SUBMISSION_MESSAGES.releaseOff };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", { mfa: false, hideFromOutsiders: true, partner: true });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_candidate", {
    p_org: organization.id,
    p_requirement: id.data,
    p_email: parsed.data.email,
    p_note: parsed.data.note === "" ? undefined : parsed.data.note,
  });
  revalidatePath(partnerSubmissionsPath(defaultLocale, organization.slug));
  revalidatePath(requirementSubmissionsPath(defaultLocale, organization.slug, id.data));
  revalidatePath(newSubmissionPath(defaultLocale, organization.slug, id.data));
  if (!error) return { sent: { existing: data[0]?.existing ?? false } };

  const refusal = submitRefusal(error);
  switch (refusal.kind) {
    case "field":
      return { errors: { [refusal.field]: refusal.message } };
    case "limit": {
      const prompts = await getUsagePrompts(organization.id, organization.type, [SUBMISSION_LIMIT_KEY]).catch(() => null);
      const prompt = prompts?.[SUBMISSION_LIMIT_KEY];
      return prompt ? { limitReached: prompt } : { message: SUBMISSION_MESSAGES.limit };
    }
    case "message":
      if (error.message === "CHARA_RATE_LIMITED") reportQuotaRefused("audited_write", "submission");
      return { message: refusal.message };
    case "fault":
      return { message: faultMessage(logFault("Sending the submission request", error)) };
  }
}

export type AnswerResult = { errors?: FieldErrors; message?: string; missing?: { label: string; section: string }[]; done?: boolean };

// The candidate from the session, never from the form (FR-O4 roles: only the worker the request was sent to answers it);
// the database answers anyone else with not found.
async function candidate(): Promise<"release_off" | "not_candidate" | null> {
  const user = await requireUser(defaultLocale);
  if (user.accountKind !== "worker") return "not_candidate";
  return (await isReleased("release_candidate_submissions")) ? null : "release_off";
}

function revalidateCandidate(id: string): void {
  revalidatePath(submissionsPath(defaultLocale));
  revalidatePath(submissionPath(defaultLocale, id));
}

function answerFailure(error: { code?: string; message: string; details?: string | null }, action: string): AnswerResult {
  const refusal = answerRefusal(error);
  switch (refusal.kind) {
    case "field":
      return { errors: { documentIds: refusal.message } };
    case "profile": {
      const missing = refusal.missing.map((field) => profileFields[field] ?? { label: field, section: "basics" });
      return { message: "Complete your passport before you approve.", missing };
    }
    case "message":
      return { message: refusal.message };
    case "fault":
      return { message: faultMessage(logFault(action, error)) };
  }
}

// Approves the request and shares the profile and the chosen documents with the employer (FR-O4 step Approve, AC5),
// after the consent to the sharing notice: approve_submission writes the consent, the share and the snapshot in one
// transaction and tells the partner and the employer (NFR-C4).
export async function approveSubmission(submissionId: string, input: ApproveFormInput): Promise<AnswerResult> {
  const id = idSchema.safeParse(submissionId);
  if (!id.success) return { message: SUBMISSION_MESSAGES.requestNotFound };
  const refused = await candidate();
  if (refused === "not_candidate") return { message: SUBMISSION_MESSAGES.requestNotFound };
  if (refused === "release_off") return { message: SUBMISSION_MESSAGES.releaseOff };
  const parsed = approveFormSchema((await getApplyLimits()).documentsMax).safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_submission", { p_submission: id.data, p_document_ids: parsed.data.documentIds });
  revalidateCandidate(id.data);
  if (!error) return { done: true };
  return answerFailure(error, "Approving the submission request");
}

// Declines the request (FR-O4 step Decline, AC7): nothing reaches the employer and the partner reads "Declined by
// candidate".
export async function declineSubmission(submissionId: string): Promise<AnswerResult> {
  const id = idSchema.safeParse(submissionId);
  if (!id.success) return { message: SUBMISSION_MESSAGES.requestNotFound };
  const refused = await candidate();
  if (refused === "not_candidate") return { message: SUBMISSION_MESSAGES.requestNotFound };
  if (refused === "release_off") return { message: SUBMISSION_MESSAGES.releaseOff };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_submission", { p_submission: id.data });
  revalidateCandidate(id.data);
  if (!error) return { done: true };
  return answerFailure(error, "Declining the submission request");
}

// Withdraws an approved submission at any stage (FR-O4 step Withdraw, AC9): the share is revoked at once. A second press,
// or a second tab, finds it withdrawn already, which is the outcome asked for.
export async function withdrawSubmission(submissionId: string): Promise<{ message?: string }> {
  const id = idSchema.safeParse(submissionId);
  if (!id.success) return { message: SUBMISSION_MESSAGES.notWithdrawable };
  const refused = await candidate();
  if (refused === "not_candidate") return { message: SUBMISSION_MESSAGES.notWithdrawable };
  if (refused === "release_off") return { message: SUBMISSION_MESSAGES.releaseOff };

  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_submission", { p_submission: id.data });
  revalidateCandidate(id.data);
  if (!error) return {};
  const refusal = withdrawRefusal(error);
  if (refusal.kind === "withdrawn") return {};
  if (refusal.kind === "message") return { message: refusal.message };
  return { message: faultMessage(logFault("Withdrawing the submission", error)) };
}
