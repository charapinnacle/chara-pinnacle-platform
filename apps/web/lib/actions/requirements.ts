"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { reportQuotaRefused } from "@/lib/quota-refused";
import { REQUIREMENT_MESSAGES, requirementRefusal } from "@/lib/requirements/refusal";
import { requirementPath, requirementsPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import {
  requirementFormSchema,
  requirementIdSchema,
  toRequirementArgs,
  type RequirementFormInput,
} from "@/lib/validation/requirement";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

export type RequirementResult = { errors?: FieldErrors; message?: string; savedHref?: string };

// An error of the occupation list as a whole (none, too many, quantities that do not add up) belongs to the list, which
// the form shows under its rows; an error of one row keeps its path.
function formErrors(errors: FieldErrors): FieldErrors {
  return Object.fromEntries(Object.entries(errors).map(([key, message]) => [key === "occupations" ? "occupations.root" : key, message]));
}

// Creates a draft (requirementId null) or saves the changes of one (FR-M1 AC1, AC3 to AC8, AC12). The organisation comes
// from the slug, the caller an owner or admin at aal2 (requireOrgRole sends an aal1 session to two-step verification);
// save_requirement checks all of it again, with the wording, the quantities and the code lists.
export async function saveRequirement(
  slug: string,
  requirementId: string | null,
  input: RequirementFormInput,
): Promise<RequirementResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedId = requirementId === null ? null : requirementIdSchema.safeParse(requirementId);
  if (!parsedSlug.success || (parsedId && !parsedId.success)) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_job_orders"))) return { message: REQUIREMENT_MESSAGES.releaseOff };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", { hideFromOutsiders: true });

  const parsed = requirementFormSchema().safeParse(input);
  if (!parsed.success) return { errors: formErrors(fieldErrors(parsed.error)) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_requirement", {
    p_org: organization.id,
    p_requirement: parsedId?.data,
    ...toRequirementArgs(parsed.data),
  });
  if (error) {
    const refusal = requirementRefusal(error);
    if (refusal.kind === "field") return { errors: { [refusal.field]: refusal.message } };
    if (refusal.kind === "message") {
      if (error.message === "CHARA_RATE_LIMITED") reportQuotaRefused("audited_write", "requirement");
      return { message: refusal.message };
    }
    return { message: faultMessage(logFault("Saving the workforce requirement", error)) };
  }
  revalidatePath(requirementsPath(defaultLocale, organization.slug));
  revalidatePath(requirementPath(defaultLocale, organization.slug, data));
  return { savedHref: requirementPath(defaultLocale, organization.slug, data) };
}
