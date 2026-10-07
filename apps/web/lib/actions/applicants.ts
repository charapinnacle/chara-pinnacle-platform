"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { setApplicationStatus, type StageRefusal } from "@/lib/dal/applicants";
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
// at aal2); the application, its organization and the stage rules are the database's. Only the target stage and the
// note are read from the call.
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

  const refusal = await setApplicationStatus(parsedId.data, parsed.data.status, parsed.data.note);
  revalidatePath(applicantPath(defaultLocale, organization.slug, parsedId.data));
  return refusal ? refusalMessage(refusal) : { done: true };
}
