"use server";

import { revalidatePath } from "next/cache";
import { adminRefusal, type AdminResult } from "@/lib/actions/admin-errors";
import { adminClient } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import { retentionInputSchema, type RetentionInput } from "@/lib/validation/retention";
import { fieldErrors } from "@/lib/validation/sign-up";

const DAYS = { errors: { days: "Enter a whole number of days from 1 to 3,650." } };

// One retention period with a reason (FR-S3 AC1, AC10). The daily retention run reads the new period the next time.
export async function saveRetentionPolicy(input: RetentionInput): Promise<AdminResult> {
  const parsed = retentionInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const path = adminPath(defaultLocale, "retention");
  const { error } = await (await adminClient()).rpc("admin_set_retention_policy", {
    p_entity: parsed.data.entity,
    p_days: parsed.data.days,
    p_reason: parsed.data.reason,
  });
  if (error) {
    if (error.code === "23514") return DAYS;
    return adminRefusal(error, path, {
      "CHARA_INVALID_INPUT:reason": { errors: { reason: "Give a reason of 10 to 500 characters" } },
      "CHARA_INVALID_INPUT:days": DAYS,
      "CHARA_FORBIDDEN:retention_not_editable": { message: "This period cannot be changed here." },
    });
  }
  revalidatePath(path);
  return { done: true };
}
