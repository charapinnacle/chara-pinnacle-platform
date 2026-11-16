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
import { geographiesSchema, type GeographiesInput } from "@/lib/validation/geographies";
import { fieldErrors, partnerTypeSchema, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

export type SaveGeographiesResult = { errors?: FieldErrors; message?: string; saved?: true };

const RELEASE_OFF = "Registration for recruitment and staffing companies is not open at the moment.";
const SUSPENDED = "This organization is suspended, so its countries cannot be changed.";
const UNKNOWN_COUNTRY = "Choose countries from the list.";

// Where you serve (FR-K1), from the onboarding step or the workforce profile page. The organisation comes from the slug,
// checked against the caller's membership and role; aal1 is enough (FR-K1 AC6), and the database checks all of it again.
// From onboarding a save continues with the next step.
export async function saveOrganizationGeographies(
  slug: string,
  input: GeographiesInput,
  { onboarding }: { onboarding: boolean },
): Promise<SaveGeographiesResult | undefined> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_partner_directories"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", {
    mfa: false,
    hideFromOutsiders: true,
    partner: true,
  });
  const type = partnerTypeSchema.parse(organization.type);
  const parsed = geographiesSchema(type).safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_organization_geographies", {
    p_org: organization.id,
    p_sources_from: parsed.data.sourcesFrom,
    p_serves_market: parsed.data.servesMarket,
  });
  if (error) {
    if (error.message === "CHARA_LIMIT_REACHED") {
      await recordLimitPrompt(organization.id, error.details);
      return { errors: { servesMarket: limitRefusalMessage(error.details, type) } };
    }
    if (error.message === "CHARA_INVALID_INPUT" && error.details === "country_code") return { message: UNKNOWN_COUNTRY };
    if (error.message === "CHARA_FORBIDDEN" && error.details === "organization_suspended") return { message: SUSPENDED };
    if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { message: RELEASE_OFF };
    console.error("Saving the countries failed", { code: error.code, message: error.message });
    return { message: GENERIC_FAILURE };
  }
  if (onboarding) redirect(onboardingPath(defaultLocale));
  return { saved: true };
}
