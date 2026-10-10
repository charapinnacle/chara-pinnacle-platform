"use server";

import { revalidatePath } from "next/cache";
import * as z from "@/lib/zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { resolveApplicantTarget } from "@/lib/actions/applicant-target";
import { addApplicationNote, listSharedDocuments, requestDocumentLink, type NoteRefusal } from "@/lib/dal/applicant-review";
import { defaultLocale } from "@/lib/i18n/locale";
import { applicantPath } from "@/lib/routes";
import { noteInputSchema, type NoteInput } from "@/lib/validation/applicant";
import { DOCUMENT_RATE_LIMITED } from "@/lib/validation/documents";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

type NoteResult = { errors?: FieldErrors; message?: string; done?: true };
type OpenResult = { url?: string; message?: string };

const noteRefusals: Record<NoteRefusal, string> = {
  not_found: "This applicant could not be found.",
  read_only_free_plan: "Your organization has no active paid plan, so notes cannot be added.",
  organization_suspended: "Your organization is suspended, so notes cannot be added.",
  invalid: "The note could not be saved. Check it and try again.",
  failed: GENERIC_FAILURE,
};

const documentRefusals = {
  unavailable: "This document is no longer available.",
  not_scanned: "This file is still being checked and cannot be opened yet.",
  rate_limited: DOCUMENT_RATE_LIMITED,
  failed: GENERIC_FAILURE,
} as const;

export async function addInternalNote(slug: string, applicationId: string, input: NoteInput): Promise<NoteResult> {
  const parsed = noteInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const target = await resolveApplicantTarget(slug, applicationId);
  if (!target) return { message: noteRefusals.not_found };
  const refusal = await addApplicationNote(target.applicationId, target.organization.id, parsed.data.body);
  if (refusal) return { message: noteRefusals[refusal] };
  revalidatePath(applicantPath(defaultLocale, target.organization.slug, target.applicationId));
  return { done: true };
}

// The document must be one the application shares (the same list the page shows): the database lets a member open any
// document shared with any organization they belong to, and the page must not be a way to reach another one's.
export async function openApplicantDocument(slug: string, applicationId: string, documentId: string): Promise<OpenResult> {
  const parsedDocument = z.uuid().safeParse(documentId);
  const target = parsedDocument.success ? await resolveApplicantTarget(slug, applicationId) : null;
  if (!parsedDocument.success || !target) return { message: documentRefusals.unavailable };
  const shared = await listSharedDocuments(target.applicationId);
  if (!shared.some((document) => document.id === parsedDocument.data)) return { message: documentRefusals.unavailable };
  const link = await requestDocumentLink(parsedDocument.data);
  return "url" in link ? { url: link.url } : { message: documentRefusals[link.refusal] };
}
