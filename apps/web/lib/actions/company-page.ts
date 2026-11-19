"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { companyPagePath, mfaPath, organizationProfilePath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { slugSchema } from "@/lib/validation/team";

export type CompanyPageResult = { message: string } | { message?: undefined; enabled: boolean; href: string };

const RELEASE_OFF = "The company page cannot be changed at the moment.";
const SUSPENDED = "This organisation is suspended, so its company page cannot be changed.";

const storedSchema = z.object({ enabled: z.boolean(), slug: z.string() });

// Turns the public company page on or off (FR-K5 AC2, AC9). The organisation comes from the slug, the caller an owner or
// admin at aal2 (requireOrgRole sends an aal1 session to two-step verification); the database checks all of it again
// and writes the audit row.
export async function setCompanyPageVisibility(slug: string, enabled: boolean): Promise<CompanyPageResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedEnabled = z.boolean().safeParse(enabled);
  if (!parsedSlug.success || !parsedEnabled.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_partner_directories"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", { hideFromOutsiders: true });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_company_page_visibility", {
    p_org: organization.id,
    p_enabled: parsedEnabled.data,
  });
  if (error) {
    if (error.message === "CHARA_FORBIDDEN" && error.details === "aal2_required") {
      redirect(mfaPath(defaultLocale, organizationProfilePath(defaultLocale, parsedSlug.data)));
    }
    if (error.message === "CHARA_FORBIDDEN" && error.details === "organization_suspended") return { message: SUSPENDED };
    if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { message: RELEASE_OFF };
    return { message: faultMessage(logFault("Company page change", error)) };
  }
  const stored = storedSchema.parse(data);
  return { enabled: stored.enabled, href: companyPagePath(defaultLocale, stored.slug) };
}
