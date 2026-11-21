"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { adminRefusal, type AdminResult } from "@/lib/actions/admin-errors";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { adminClient } from "@/lib/dal/admin";
import { requestPartnerReviewEvidence } from "@/lib/dal/partner-evidence";
import { isReleased } from "@/lib/dal/release";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import { decisionInputSchema, type DecisionInput } from "@/lib/validation/partner-review";
import { fieldErrors } from "@/lib/validation/sign-up";

const RELEASE_OFF = "Partner reviews are not open at the moment.";

// Only a Trust & Safety Administrator decides (FR-J4 AC4); the database checks the role, aal2, the open state and that the
// reviewer is not a member of the partner again. Of two simultaneous decisions the second finds the new state.
export async function decidePartner(input: DecisionInput): Promise<AdminResult> {
  const parsed = decisionInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { organizationId, decision, reason, infoStep } = parsed.data;
  await requirePlatformRole(defaultLocale, ["trust_safety"]);
  if (!(await isReleased("release_partner_directories"))) return { message: RELEASE_OFF };

  const path = adminPath(defaultLocale, `partners/${organizationId}`);
  const { error } = await (await adminClient()).rpc("admin_decide_partner", {
    p_org: organizationId,
    p_decision: decision,
    p_reason: reason,
    p_info_step: infoStep ?? undefined,
  });
  if (error) {
    return adminRefusal(error, path, {
      CHARA_INVALID_TRANSITION: { message: "This partner was decided by someone else. Reload the page." },
      "CHARA_FORBIDDEN:own_organization": { message: "You are a member of this company, so another reviewer decides." },
      "CHARA_FORBIDDEN:release_off": { message: RELEASE_OFF },
      "CHARA_INVALID_INPUT:reason": { errors: { reason: "Give a reason of 10 to 2000 characters." } },
      "CHARA_INVALID_INPUT:info_step": { errors: { infoStep: "Choose the step to reopen." } },
    });
  }
  revalidatePath(adminPath(defaultLocale, "partners"));
  revalidatePath(path);
  return { done: true };
}

// A 60-second link to the evidence of a licence, for the two reviewer roles; the database logs the opening.
export async function openPartnerEvidence(licenceId: string): Promise<{ message?: string; url?: string }> {
  const id = z.uuid().safeParse(licenceId);
  if (!id.success) return { message: GENERIC_FAILURE };
  await requirePlatformRole(defaultLocale, ["trust_safety", "verification_reviewer"]);
  const link = await requestPartnerReviewEvidence(id.data);
  if ("url" in link) return { url: link.url };
  if (link.refusal === "not_scanned") return { message: "This file cannot be opened until it has been checked." };
  if (link.refusal === "unavailable") return { message: "This file is no longer available." };
  if (link.refusal === "rate_limited") return { message: "Too many files were opened in a short time. Wait a minute and try again." };
  return { message: GENERIC_FAILURE };
}
