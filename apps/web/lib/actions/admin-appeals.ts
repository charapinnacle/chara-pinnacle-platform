"use server";

import { revalidatePath } from "next/cache";
import { adminRefusal, type AdminResult } from "@/lib/actions/admin-errors";
import { adminClient } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import { appealDecisionInputSchema, appealStatusLabels, type AppealDecisionInput } from "@/lib/validation/appeal";
import { fieldErrors } from "@/lib/validation/sign-up";

function changed(status: keyof typeof appealStatusLabels): AdminResult {
  return { message: `This appeal was decided by someone else, reload the page. It is now: ${appealStatusLabels[status]}.` };
}

const REFUSALS = {
  "CHARA_FORBIDDEN:same_reviewer": { message: "You took this decision, so another Trust & Safety administrator decides the appeal." },
  "CHARA_FORBIDDEN:own_organization": { message: "You belong to this organisation, so another Trust & Safety administrator decides the appeal." },
  "CHARA_FORBIDDEN:release_off": { message: "Appeals are not open at the moment." },
  "CHARA_INVALID_STATE:upheld": changed("upheld"),
  "CHARA_INVALID_STATE:restored": changed("restored"),
  "CHARA_INVALID_INPUT:reason": { errors: { reason: "Give a reason of 10 to 2000 characters" } },
  "CHARA_INVALID_INPUT:outcome": { message: "Choose to uphold the decision or to reverse it." },
} as const;

// A second Trust & Safety Administrator decides an appeal (FR-S1 AC9): uphold, or restore what the decision took away, with
// the statement of reasons the appellant is sent. The database refuses the administrator who took the decision.
export async function decideAppeal(input: AppealDecisionInput): Promise<AdminResult> {
  const parsed = appealDecisionInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { id, outcome, reason } = parsed.data;
  await requirePlatformRole(defaultLocale, ["trust_safety"]);

  const path = adminPath(defaultLocale, `appeals/${id}`);
  const { error } = await (await adminClient()).rpc("decide_appeal", { p_appeal: id, p_outcome: outcome, p_reasons: reason });
  if (error) return adminRefusal(error, path, REFUSALS);
  revalidatePath(path);
  revalidatePath(adminPath(defaultLocale, "appeals"));
  return { done: true };
}
