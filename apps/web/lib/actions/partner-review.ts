"use server";

import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { mfaPath, onboardingPath, partnerStepPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { missingFieldMessages } from "@/lib/validation/partner-review";
import { slugSchema } from "@/lib/validation/team";

export type SubmitForReviewResult = { message: string };

const RELEASE_OFF = "Registration for recruitment and staffing companies is not open at the moment.";
const SUSPENDED = "This organization is suspended, so it cannot be submitted for review.";

// The owner or an admin submits the partner for review from the Ready step (FR-J1 AC10). The organisation comes from the
// slug, checked against the caller's membership and role. The database checks all of it again, two-step verification
// included: a session at aal1 is sent to enter its code and comes back to Ready, which is open at aal1 (AC9). An
// incomplete profile is answered with its first missing field. Onboarding then shows the pending state.
export async function submitForReview(slug: string): Promise<SubmitForReviewResult | undefined> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_partner_directories"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", {
    mfa: false,
    hideFromOutsiders: true,
    partner: true,
  });

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_partner_for_review", { p_org: organization.id });
  if (error) {
    if (error.message === "CHARA_PROFILE_INCOMPLETE") return { message: missingFieldMessages[error.details] ?? GENERIC_FAILURE };
    if (error.message === "CHARA_FORBIDDEN" && error.details === "aal2_required") {
      redirect(mfaPath(defaultLocale, partnerStepPath(defaultLocale, "ready")));
    }
    if (error.message === "CHARA_FORBIDDEN" && error.details === "organization_suspended") return { message: SUSPENDED };
    if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { message: RELEASE_OFF };
    // Staff decided meanwhile: onboarding shows the state as it is now.
    if (error.message === "CHARA_INVALID_TRANSITION") redirect(onboardingPath(defaultLocale));
    console.error("Submitting for review failed", { code: error.code, message: error.message });
    return { message: GENERIC_FAILURE };
  }
  redirect(onboardingPath(defaultLocale));
}
