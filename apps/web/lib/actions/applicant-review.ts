"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { getApplicant } from "@/lib/dal/applicants";
import { addApplicationNote, requestDocumentLink, type NoteRefusal } from "@/lib/dal/applicant-review";
import { requireOrgRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { applicantPath } from "@/lib/routes";
import { noteInputSchema, type NoteInput } from "@/lib/validation/applicant";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

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
  rate_limited: "Too many documents were opened in a short time. Wait a minute and try again.",
  failed: GENERIC_FAILURE,
} as const;

// The organization comes from the slug and the caller's membership and role, looked up on every call (owners and admins
// at aal2), and the application must belong to it, so that the role and the two-step check are those of the organization
// that owns the application. The plan, the status and the share are the database's rules.
async function applicantOrganization(slug: string, applicationId: string) {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedId = z.uuid().safeParse(applicationId);
  if (!parsedSlug.success || !parsedId.success) return null;
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", { hideFromOutsiders: true });
  const applicant = await getApplicant(parsedId.data);
  return applicant?.organizationId === organization.id ? { organization, applicationId: parsedId.data } : null;
}

export async function addInternalNote(slug: string, applicationId: string, input: NoteInput): Promise<NoteResult> {
  const parsed = noteInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const target = await applicantOrganization(slug, applicationId);
  if (!target) return { message: noteRefusals.not_found };
  const refusal = await addApplicationNote(target.applicationId, target.organization.id, parsed.data.body);
  if (refusal) return { message: noteRefusals[refusal] };
  revalidatePath(applicantPath(defaultLocale, target.organization.slug, target.applicationId));
  return { done: true };
}

export async function openApplicantDocument(slug: string, applicationId: string, documentId: string): Promise<OpenResult> {
  const parsedDocument = z.uuid().safeParse(documentId);
  const target = parsedDocument.success ? await applicantOrganization(slug, applicationId) : null;
  if (!parsedDocument.success || !target) return { message: documentRefusals.unavailable };
  const link = await requestDocumentLink(parsedDocument.data);
  return "url" in link ? { url: link.url } : { message: documentRefusals[link.refusal] };
}
