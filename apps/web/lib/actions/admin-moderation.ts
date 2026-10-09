"use server";

import { revalidatePath } from "next/cache";
import { adminRefusal, type AdminResult } from "@/lib/actions/admin-errors";
import { adminClient } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import { jobModerationInputSchema, moderationInputSchema, type ModerationForm } from "@/lib/validation/admin";
import { fieldErrors } from "@/lib/validation/sign-up";

type Input = ModerationForm & { target: "user" | "organization"; id: string; to: "suspended" | "active" };

const FUNCTIONS = {
  user: { suspended: "suspend_user", active: "reinstate_user" },
  organization: { suspended: "suspend_organization", active: "reinstate_organization" },
} as const;

const noun = { user: "account", organization: "organisation" } as const;

// A suspension and a reinstatement are one call each, so the database decides which of two simultaneous submissions wins.
export async function changeStanding(input: Input): Promise<AdminResult> {
  const parsed = moderationInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { target, id, to, reason } = parsed.data;
  await requirePlatformRole(defaultLocale, ["trust_safety"]);

  const supabase = await adminClient();
  const path = adminPath(defaultLocale, target === "user" ? `users/${id}` : `organizations/${id}`);
  const { error } =
    target === "user"
      ? await supabase.rpc(FUNCTIONS.user[to], { p_user_id: id, p_reason: reason })
      : await supabase.rpc(FUNCTIONS.organization[to], { p_org: id, p_reason: reason });
  if (error) {
    return adminRefusal(error, path, {
      CHARA_INVALID_STATE: { message: `This ${noun[target]} is already ${to === "suspended" ? "suspended" : "active"}` },
      "CHARA_INVALID_INPUT:reason": { errors: { reason: "Give a reason of 10 to 2000 characters" } },
      "CHARA_FORBIDDEN:staff_account": {
        message: "This account holds a platform role. A Platform Administrator revokes the role first.",
      },
    });
  }
  revalidatePath(path);
  return { done: true };
}

type JobInput = ModerationForm & { id: string; action: "hide" | "unhide" };

// The database locks the vacancy, so of two simultaneous hides one is refused with the state the other left.
export async function moderateJob(input: JobInput): Promise<AdminResult> {
  const parsed = jobModerationInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { id, action, reason } = parsed.data;
  await requirePlatformRole(defaultLocale, ["trust_safety"]);

  const path = adminPath(defaultLocale, `moderation/${id}`);
  const { error } = await (await adminClient()).rpc("moderate_job", { p_job: id, p_action: action, p_reason: reason });
  if (error) {
    return adminRefusal(error, path, {
      "CHARA_INVALID_STATE:hidden": { message: "This vacancy is already hidden" },
      "CHARA_INVALID_STATE:visible": { message: "This vacancy is not hidden" },
      "CHARA_INVALID_STATE:org_suspended": { message: "This vacancy is hidden with the suspension of its organisation" },
      "CHARA_INVALID_INPUT:reason": { errors: { reason: "Give a reason of 10 to 2000 characters" } },
    });
  }
  revalidatePath(path);
  return { done: true };
}
