"use server";

import { revalidatePath } from "next/cache";
import { adminRefusal, type AdminResult } from "@/lib/actions/admin-errors";
import { adminClient } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import { moderationInputSchema, type ModerationForm } from "@/lib/validation/admin";
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
