"use server";

import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { recordLimitPrompt } from "@/lib/actions/limits";
import { limitRefusalMessage } from "@/lib/billing/limits";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { onboardingPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, partnerTypeSchema, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";
import {
  toServiceTypes,
  workforceOfferSchema,
  type WorkforceOfferInput,
} from "@/lib/validation/workforce-offer";

export type SaveWorkforceOfferResult = { errors?: FieldErrors; message?: string; saved?: true };

const RELEASE_OFF = "Registration for recruitment and staffing companies is not open at the moment.";
const SUSPENDED = "This organisation is suspended, so its workforce offer cannot be changed.";
const FROM_LIST = "Choose from the list.";

// The database names the refused value; the form shows the message at its field.
const invalidField: Record<string, [keyof WorkforceOfferInput, string]> = {
  occupation_id: ["occupations", FROM_LIST],
  industry_code: ["industries", FROM_LIST],
  language_code: ["languages", FROM_LIST],
  recruitment_type: ["recruitmentType", "Choose a recruitment type."],
  staffing_types: ["staffingTypes", "Choose at least one staffing type."],
  staffing_service_required: ["staffingTypes", "Tick that you also supply staff to choose staffing types"],
  service_types: ["staffingTypes", FROM_LIST],
  founded_year: ["foundedYear", `Enter a year between 1800 and ${new Date().getFullYear()}.`],
};

// What you offer (FR-K2), from the onboarding step or the workforce profile page. The organisation comes from the slug,
// checked against the caller's membership and role; aal1 is enough (onboarding comes before the Security step), and the
// database checks all of it again. From onboarding a save continues with the next step.
export async function saveWorkforceOffer(
  slug: string,
  input: WorkforceOfferInput,
  { onboarding }: { onboarding: boolean },
): Promise<SaveWorkforceOfferResult | undefined> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_partner_directories"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", {
    mfa: false,
    hideFromOutsiders: true,
    partner: true,
  });
  const type = partnerTypeSchema.parse(organization.type);
  const parsed = workforceOfferSchema(type).safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const offer = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_organization_workforce_offer", {
    p_org: organization.id,
    p_occupations: offer.occupations,
    p_industries: offer.industries,
    p_languages: offer.languages,
    p_recruitment_type: offer.recruitmentType,
    p_service_types: toServiceTypes(type, offer),
    p_workforce_size_band: offer.sizeBand === "" ? undefined : offer.sizeBand,
    p_founded_year: offer.foundedYear === "" ? undefined : Number(offer.foundedYear),
  });
  if (error) {
    if (error.message === "CHARA_LIMIT_REACHED") {
      await recordLimitPrompt(organization.id, error.details);
      return { errors: { occupations: limitRefusalMessage(error.details, type) } };
    }
    const invalid = error.message === "CHARA_INVALID_INPUT" ? invalidField[error.details] : undefined;
    if (invalid) return { errors: { [invalid[0]]: invalid[1] } };
    if (error.message === "CHARA_FORBIDDEN" && error.details === "organization_suspended") return { message: SUSPENDED };
    if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { message: RELEASE_OFF };
    console.error("Saving the workforce offer failed", { code: error.code, message: error.message });
    return { message: GENERIC_FAILURE };
  }
  if (onboarding) redirect(onboardingPath(defaultLocale));
  return { saved: true };
}
