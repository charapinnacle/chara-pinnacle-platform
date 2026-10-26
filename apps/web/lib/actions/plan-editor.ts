"use server";

import { revalidatePath } from "next/cache";
import { adminRefusal, type AdminResult } from "@/lib/actions/admin-errors";
import { adminClient } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import {
  expiryInstant,
  gapLines,
  overrideInputSchema,
  removeOverrideInputSchema,
  savePlanInputSchema,
  settingInputSchema,
  type OverrideInput,
  type SavePlanInput,
  type SettingInput,
} from "@/lib/validation/plan-editor";
import { fieldErrors } from "@/lib/validation/sign-up";

const REASON = { "CHARA_INVALID_INPUT:reason": { errors: { reason: "Give a reason of 10 to 500 characters" } } };

// The changes of one plan edit (FR-R2 AC10) as one call: the database saves them all or none, and refuses them when a
// value shown in the dialog is no longer current.
export async function savePlan(input: SavePlanInput): Promise<AdminResult> {
  const parsed = savePlanInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const { code, plan, limits, features, reason } = parsed.data;
  const path = adminPath(defaultLocale, "plans");
  const fields = (row: { name: string; isPublic: boolean; trialDays: number }) => ({
    name: row.name,
    is_public: row.isPublic,
    trial_days: row.trialDays,
  });
  const { error } = await (await adminClient()).rpc("admin_update_plan_bundle", {
    p_code: code,
    p_changes: {
      plan: plan ? { ...fields(plan), expected: fields(plan.expected) } : null,
      limits: limits.map(({ key, value, expected }) => ({ key, value, expected })),
      features: features.map(({ key, enabled, expected }) => ({ key, enabled, expected })),
    },
    p_reason: reason,
  });
  if (error) {
    return adminRefusal(error, path, {
      ...REASON,
      "CHARA_INVALID_INPUT:name": { errors: { name: "Enter a name of 1 to 60 characters" } },
      "CHARA_INVALID_INPUT:trial_days": { errors: { trialDays: "Enter a whole number of days from 0 to 365" } },
      "CHARA_INVALID_INPUT:is_public": { errors: { isPublic: "Only a paid plan can be public" } },
      "CHARA_INVALID_INPUT:limit_value": { message: "A limit must be a whole number from 0 to 1,000,000." },
      "CHARA_INVALID_INPUT:plan_code": { message: "This plan no longer exists." },
      "CHARA_INVALID_INPUT:unknown_limit_key": { message: "A limit does not apply to this plan." },
      "CHARA_INVALID_INPUT:unknown_feature_key": { message: "A feature does not apply to this plan." },
      CHARA_CONFLICT: { message: "Someone changed this plan after the page was loaded. Nothing was saved. Reload the page and try again." },
    });
  }
  revalidatePath(path);
  return { done: true };
}

// An individual limit for an organisation on an Enterprise plan until the start of the chosen day (FR-R2 AC5).
export async function setLimitOverride(input: OverrideInput): Promise<AdminResult> {
  const parsed = overrideInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const { organizationId, limitKey, value, expiresOn, reason } = parsed.data;
  const path = adminPath(defaultLocale, "plans/overrides");
  const { error } = await (await adminClient()).rpc("admin_set_limit_override", {
    p_org: organizationId,
    p_limit_key: limitKey,
    p_value: value,
    p_expires_at: expiryInstant(expiresOn),
    p_reason: reason,
  });
  if (error) {
    return adminRefusal(error, path, {
      ...REASON,
      "CHARA_FORBIDDEN:override_enterprise_only": { errors: { organizationId: "Only an organisation on an Enterprise plan can get an override" } },
      "CHARA_INVALID_INPUT:unknown_limit_key": { errors: { limitKey: "This limit does not apply to this organisation" } },
      "CHARA_INVALID_INPUT:limit_value": { errors: { value: "Enter a whole number from 0 to 1,000,000" } },
      "CHARA_INVALID_INPUT:expires_at": { errors: { expiresOn: "Enter a date after today as year-month-day" } },
      CHARA_NOT_FOUND: { errors: { organizationId: "This organisation no longer exists" } },
    });
  }
  revalidatePath(path);
  return { done: true };
}

export async function removeLimitOverride(input: { organizationId: string; limitKey: string; reason: string }): Promise<AdminResult> {
  const parsed = removeOverrideInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const path = adminPath(defaultLocale, "plans/overrides");
  const { error } = await (await adminClient()).rpc("admin_remove_limit_override", {
    p_org: parsed.data.organizationId,
    p_limit_key: parsed.data.limitKey,
    p_reason: parsed.data.reason,
  });
  if (error) return adminRefusal(error, path, { ...REASON, CHARA_NOT_FOUND: { message: "This override was already removed." } });
  revalidatePath(path);
  return { done: true };
}

// One allow-listed platform setting (FR-R2 AC7); switching a release_* setting on puts that release live.
export async function saveSetting(input: SettingInput): Promise<AdminResult> {
  const parsed = settingInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const path = adminPath(defaultLocale, "settings");
  const { error } = await (await adminClient()).rpc("admin_set_setting", {
    p_key: parsed.data.key,
    p_value: parsed.data.value,
    p_reason: parsed.data.reason,
  });
  if (error) {
    if (error.message === "CHARA_FORBIDDEN" && error.details === "release_legal_gaps") {
      const documents = gapLines(error.hint ? error.hint.split(",") : []);
      return { message: `The release cannot go live until these legal documents are approved: ${documents.join("; ")}.` };
    }
    return adminRefusal(error, path, {
      ...REASON,
      "CHARA_INVALID_INPUT:value": { errors: { value: "This value is outside the rule of the setting" } },
      "CHARA_FORBIDDEN:setting_not_editable": { message: "This setting cannot be changed here." },
    });
  }
  revalidatePath(path);
  return { done: true };
}
