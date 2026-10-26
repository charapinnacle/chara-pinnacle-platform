"use server";

import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { createClient } from "@/lib/supabase/server";

type ConnectionResult = { message?: string };

const RELEASE_OFF = "Saving and following are not available at the moment.";

const idSchema = z.uuid();

// Saves or unsaves a partner for the employer organizationId (FR-L4 AC1, AC9). The state is set, not toggled, so a
// press that arrives twice changes nothing; the database checks the membership, the partner and the release again.
export async function setSavedPartner(partnerId: string, organizationId: string, saved: boolean): Promise<ConnectionResult> {
  const partner = idSchema.safeParse(partnerId);
  const organization = idSchema.safeParse(organizationId);
  if (!partner.success || !organization.success || typeof saved !== "boolean") return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_partner_directories"))) return { message: RELEASE_OFF };
  await requireUser(defaultLocale);

  const supabase = await createClient();
  const { error } = await supabase.rpc("toggle_saved_partner", {
    p_partner: partner.data,
    p_org: organization.data,
    p_saved: saved,
  });
  if (!error) return {};
  if (error.message === "CHARA_NOT_FOUND") return { message: "This partner can no longer be saved." };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { message: RELEASE_OFF };
  if (error.message === "CHARA_FORBIDDEN") return { message: "Only members of an employer can save partners." };
  return { message: faultMessage(logFault("Saved partner change", error)) };
}

// Follows or unfollows a company for the signed-in user (FR-L4 AC4, AC9; FR-K5 AC7), set rather than toggled.
export async function setFollowing(organizationId: string, following: boolean): Promise<ConnectionResult> {
  const organization = idSchema.safeParse(organizationId);
  if (!organization.success || typeof following !== "boolean") return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_partner_directories"))) return { message: RELEASE_OFF };
  await requireUser(defaultLocale);

  const supabase = await createClient();
  const { error } = await supabase.rpc("toggle_follow", { p_org: organization.data, p_following: following });
  if (!error) return {};
  if (error.message === "CHARA_NOT_FOUND") return { message: "This company can no longer be followed." };
  if (error.details === "own_organization") return { message: "You cannot follow your own company." };
  if (error.details === "employer_follows_employer") return { message: "Employers cannot follow other employers." };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { message: RELEASE_OFF };
  return { message: faultMessage(logFault("Follow change", error)) };
}
