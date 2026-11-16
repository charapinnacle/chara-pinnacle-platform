"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { requestDocumentLink } from "@/lib/dal/applicant-review";
import type { StageRefusal } from "@/lib/dal/applicants";
import {
  addSubmissionNote,
  bulkSetSubmissionStatus,
  getEmployerSubmission,
  listSubmissionDocuments,
  setSubmissionStatus,
  type SubmissionBulkItem,
} from "@/lib/dal/submission-pipeline";
import { requireOrgRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { employerSubmissionPath } from "@/lib/routes";
import {
  SUBMISSION_REASON_MIN_CHARS,
  submissionBulkInputSchema,
  submissionNoteInputSchema,
  submissionStageInputSchema,
  type SubmissionBulkInput,
  type SubmissionNoteInput,
  type SubmissionStageInput,
} from "@/lib/validation/submission-pipeline";
import { DOCUMENT_RATE_LIMITED } from "@/lib/validation/documents";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

type ActionResult = { errors?: FieldErrors; message?: string; done?: true };

const NOT_FOUND = "This candidate could not be found.";

// The organisation of the address, with the caller's role checked (owners and admins at aal2), and the submission must be
// one of its approved ones, so the role and the two-step check are those of the employer that owns it.
async function resolveSubmission(slug: string, submissionId: string) {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedId = z.uuid().safeParse(submissionId);
  if (!parsedSlug.success || !parsedId.success) return null;
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", { hideFromOutsiders: true });
  const submission = await getEmployerSubmission(parsedId.data);
  return submission?.organizationId === organization.id ? { organization, submission } : null;
}

function refusalMessage(refusal: StageRefusal): ActionResult {
  switch (refusal.kind) {
    case "already_moved":
      return { message: "This candidate was already moved or withdrew. Reload to see the current stage." };
    case "not_found":
      return { message: NOT_FOUND };
    case "blocked":
      return {
        message:
          refusal.reason === "organization_suspended"
            ? "Your organization is suspended, so stages cannot be changed."
            : "Your organization has no active paid plan, so stages cannot be changed.",
      };
    case "shortlisting_not_in_plan":
      return { message: "Your plan does not include shortlisting." };
    case "note_too_long":
      return { errors: { note: `The reason must be ${SUBMISSION_REASON_MIN_CHARS} to 1,000 characters long.` } };
    case "failed":
      return { message: GENERIC_FAILURE };
  }
}

export async function changeSubmissionStage(slug: string, submissionId: string, input: SubmissionStageInput): Promise<ActionResult> {
  const target = await resolveSubmission(slug, submissionId);
  if (!target) return { message: NOT_FOUND };
  const parsed = submissionStageInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const refusal = await setSubmissionStatus(target.submission.id, parsed.data.status, parsed.data.note);
  revalidatePath(employerSubmissionPath(defaultLocale, target.organization.slug, target.submission.id));
  return refusal ? refusalMessage(refusal) : { done: true };
}

function itemMessage({ errorCode }: SubmissionBulkItem): string {
  switch (errorCode) {
    case "CHARA_INVALID_TRANSITION":
      return "Skipped: this move is not allowed from its stage, or the candidate withdrew";
    case "CHARA_NOT_FOUND":
      return "Skipped: this candidate could not be found";
    case "CHARA_FEATURE_NOT_IN_PLAN":
      return "Skipped: your plan does not include shortlisting";
    default:
      return GENERIC_FAILURE;
  }
}

export type SubmissionBulkSummary = { moved: string[]; skipped: { id: string; message: string }[] };

// Several submitted candidates get the same target and reason (FR-O5 AC8); the database judges each one and the summary
// reports the moved and the skipped.
export async function bulkChangeSubmissionStage(
  slug: string,
  input: SubmissionBulkInput,
): Promise<ActionResult & { summary?: SubmissionBulkSummary }> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return { message: NOT_FOUND };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", { hideFromOutsiders: true });
  if (organization.suspended) return refusalMessage({ kind: "blocked", reason: "organization_suspended" });
  const parsed = submissionBulkInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const outcome = await bulkSetSubmissionStatus(parsed.data.submissionIds, parsed.data.status, parsed.data.note);
  if ("refusal" in outcome) return refusalMessage(outcome.refusal);
  return {
    summary: {
      moved: outcome.items.filter((item) => item.ok).map((item) => item.submissionId),
      skipped: outcome.items.filter((item) => !item.ok).map((item) => ({ id: item.submissionId, message: itemMessage(item) })),
    },
  };
}

const noteRefusals = {
  not_found: NOT_FOUND,
  read_only_free_plan: "Your organization has no active paid plan, so notes cannot be added.",
  organization_suspended: "Your organization is suspended, so notes cannot be added.",
  invalid: "The note could not be saved. Check it and try again.",
  rate_limited: "Too many changes were made today. Try again tomorrow.",
  failed: GENERIC_FAILURE,
} as const;

export async function addSubmissionInternalNote(slug: string, submissionId: string, input: SubmissionNoteInput): Promise<ActionResult> {
  const parsed = submissionNoteInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const target = await resolveSubmission(slug, submissionId);
  if (!target) return { message: NOT_FOUND };
  const refusal = await addSubmissionNote(target.submission.id, parsed.data.body);
  if (refusal) return { message: noteRefusals[refusal] };
  revalidatePath(employerSubmissionPath(defaultLocale, target.organization.slug, target.submission.id));
  return { done: true };
}

const documentRefusals = {
  unavailable: "This document is no longer available.",
  not_scanned: "This file is still being checked and cannot be opened yet.",
  rate_limited: DOCUMENT_RATE_LIMITED,
  failed: GENERIC_FAILURE,
} as const;

// Only a document of this submission's share (the list the page shows) is asked for, for submission_review (FR-O5 AC6).
export async function openSubmissionDocument(slug: string, submissionId: string, documentId: string): Promise<{ url?: string; message?: string }> {
  const parsedDocument = z.uuid().safeParse(documentId);
  const target = parsedDocument.success ? await resolveSubmission(slug, submissionId) : null;
  if (!parsedDocument.success || !target) return { message: documentRefusals.unavailable };
  const shared = await listSubmissionDocuments(target.submission.id);
  if (!shared.some((document) => document.id === parsedDocument.data)) return { message: documentRefusals.unavailable };
  const link = await requestDocumentLink(parsedDocument.data, "submission_review");
  return "url" in link ? { url: link.url } : { message: documentRefusals[link.refusal] };
}
