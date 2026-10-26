"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { appealPath, appealsPath, mfaPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { appealInputSchema, type AppealInput } from "@/lib/validation/appeal";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

export type AppealResult = { errors?: FieldErrors; message?: string; done?: true };

const REFUSALS: Record<string, AppealResult> = {
  "CHARA_INVALID_STATE:appeal_exists": { message: "This decision has already been appealed. Reload the page to see the appeal." },
  "CHARA_INVALID_STATE:appeal_window_closed": { message: "The time to appeal this decision has ended." },
  "CHARA_INVALID_STATE:not_in_effect": { message: "This decision is no longer in effect, so there is nothing to appeal. Reload the page." },
  "CHARA_INVALID_INPUT:grounds": { errors: { grounds: "Give grounds of 20 to 2000 characters" } },
  "CHARA_FORBIDDEN:release_off": { message: "Appeals are not open at the moment." },
  "CHARA_FORBIDDEN:": { message: "Only the owner or an admin of the organisation can appeal." },
  "CHARA_NOT_FOUND:": { message: "This decision no longer exists." },
};

// An owner or admin appeals a moderation decision on their organisation (FR-S1 AC9, AC12). The database checks the role,
// the window, the one appeal per decision and two-step verification; a session that lost aal2 confirms it again and
// returns to the decision.
export async function submitAppeal(input: AppealInput): Promise<AppealResult> {
  const parsed = appealInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { decision, grounds } = parsed.data;
  await requireUser(defaultLocale);
  if (!(await isReleased("release_partner_directories"))) return REFUSALS["CHARA_FORBIDDEN:release_off"];

  const path = appealPath(defaultLocale, decision);
  const { error } = await (await createClient()).rpc("submit_appeal", { p_action: decision, p_grounds: grounds });
  if (error) {
    if (error.message === "CHARA_FORBIDDEN" && error.details === "aal2_required") redirect(mfaPath(defaultLocale, path));
    const known = REFUSALS[`${error.message}:${error.details ?? ""}`];
    if (known) return known;
    console.error("Lodging an appeal failed", { code: error.code, message: /^CHARA_[A-Z_]+$/.test(error.message) ? error.message : undefined });
    return { message: GENERIC_FAILURE };
  }
  revalidatePath(path);
  revalidatePath(appealsPath(defaultLocale));
  return { done: true };
}
