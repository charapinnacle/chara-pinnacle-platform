"use server";

import { revalidatePath } from "next/cache";
import { adminRefusal, type AdminResult } from "@/lib/actions/admin-errors";
import { adminClient } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import { deleteRuleInputSchema, NOTICE_MAX, NOTICE_MIN, REFERENCE_MAX, RULE_UNCHANGED, ruleFormSchema, type RuleForm } from "@/lib/validation/direct-hiring-rules";
import { fieldErrors } from "@/lib/validation/sign-up";

const REASON = { "CHARA_INVALID_INPUT:reason": { errors: { reason: "Give a reason of 10 to 500 characters." } } };

const SEGMENT = "direct-hiring-rules";

// Creates the rule of a source and destination, or changes the one that exists (FR-Q5 AC1, AC3). The database checks the
// input again and names the field it refuses. A save with the values the rule already has writes nothing and says so.
export async function saveDirectHiringRule(input: RuleForm): Promise<AdminResult> {
  const parsed = ruleFormSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const path = adminPath(defaultLocale, SEGMENT);
  const { sourceCountry, destinationCountry, rule, notice, legalOpinionRef, reason } = parsed.data;
  const { data: changed, error } = await (await adminClient()).rpc("admin_upsert_direct_hiring_rule", {
    p_source: sourceCountry,
    p_destination: destinationCountry === "" ? undefined : destinationCountry,
    p_rule: rule,
    p_notice: notice,
    p_legal_opinion_ref: legalOpinionRef,
    p_reason: reason,
  });
  if (error) {
    return adminRefusal(error, path, {
      ...REASON,
      "CHARA_INVALID_INPUT:source_country": { errors: { sourceCountry: "Choose a country" } },
      "CHARA_INVALID_INPUT:destination_country": {
        errors: { destinationCountry: "Choose a destination other than the source country, or all destinations." },
      },
      "CHARA_INVALID_INPUT:rule": { errors: { rule: "Choose a rule." } },
      "CHARA_INVALID_INPUT:notice": { errors: { notice: `Write a notice of ${NOTICE_MIN} to ${NOTICE_MAX.toLocaleString("en-GB")} characters` } },
      "CHARA_INVALID_INPUT:legal_opinion_ref": { errors: { legalOpinionRef: `Enter a reference of 1 to ${REFERENCE_MAX} characters` } },
    });
  }
  if (!changed) return { message: RULE_UNCHANGED };
  revalidatePath(path);
  return { done: true };
}

// Deletes a rule (FR-Q5 AC12): its source country, or pair, returns to the next rule that applies or to the default.
export async function deleteDirectHiringRule(input: { id: string; reason: string }): Promise<AdminResult> {
  const parsed = deleteRuleInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const path = adminPath(defaultLocale, SEGMENT);
  const { error } = await (await adminClient()).rpc("admin_delete_direct_hiring_rule", { p_rule: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return adminRefusal(error, path, { ...REASON, CHARA_NOT_FOUND: { message: "This rule was already deleted." } });
  revalidatePath(path);
  return { done: true };
}
