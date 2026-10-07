"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { type BoardCounts, getBoardCounts } from "@/lib/dal/applicant-list";
import { getApplicant, setApplicationStatus, type StageRefusal } from "@/lib/dal/applicants";
import { requireOrgRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { applicantPath } from "@/lib/routes";
import { stageChangeInputSchema, type StageChangeFormInput } from "@/lib/validation/applicant";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

type StageActionResult = { errors?: FieldErrors; message?: string; done?: true };

const ALREADY_MOVED = "This applicant was already moved. Reload to see the current stage";

function refusalMessage(refusal: StageRefusal): StageActionResult {
  switch (refusal.kind) {
    case "already_moved":
      return { message: ALREADY_MOVED };
    case "not_found":
      return { message: "This applicant could not be found." };
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
      return { errors: { note: "The note is too long." } };
    case "failed":
      return { message: GENERIC_FAILURE };
  }
}

// The organization comes from the slug and the caller's membership and role, looked up on every call (owners and admins
// at aal2), and the application must belong to it, so that the role and the two-step check are those of the organization
// that owns the application; the stage rules are the database's. Only the target stage and the note are read from the call.
export async function changeApplicantStage(
  slug: string,
  applicationId: string,
  input: StageChangeFormInput,
): Promise<StageActionResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedId = z.uuid().safeParse(applicationId);
  if (!parsedSlug.success || !parsedId.success) return { message: GENERIC_FAILURE };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", { hideFromOutsiders: true });
  const parsed = stageChangeInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const applicant = await getApplicant(parsedId.data);
  if (applicant?.organizationId !== organization.id) return refusalMessage({ kind: "not_found" });

  const refusal = await setApplicationStatus(parsedId.data, parsed.data.status, parsed.data.note);
  revalidatePath(applicantPath(defaultLocale, organization.slug, parsedId.data));
  return refusal ? refusalMessage(refusal) : { done: true };
}

// What the polling board asks, every few seconds: the count of each stage of a vacancy, or null for an id that is none.
// There is no page guard on this path, to keep it to one request: the function counts with the rights of the caller, so
// the database lets through only the applications of the organizations the caller is an active member of, and a caller
// without a session gets an error.
export async function readBoardCounts(jobId: string): Promise<BoardCounts | null> {
  const parsedId = z.uuid().safeParse(jobId);
  return parsedId.success ? getBoardCounts(parsedId.data) : null;
}
