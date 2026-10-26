"use server";

import { revalidatePath } from "next/cache";
import { adminRefusal, type AdminResult } from "@/lib/actions/admin-errors";
import { adminClient } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import {
  expiryInstant,
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

// The changes of one plan edit (FR-R2 AC10): the plan row first, then each limit and feature, each through its audited RPC.
// A change to the value it already has writes nothing, so a retry after a failure saves only what is still missing.
export async function savePlan(input: SavePlanInput): Promise<AdminResult> {
  const parsed = savePlanInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  await requirePlatformRole(defaultLocale, ["admin"]);
  const { code, plan, limits, features, reason } = parsed.data;
  const path = adminPath(defaultLocale, "plans");
  const supabase = await adminClient();
  const known = {
    ...REASON,
    "CHARA_INVALID_INPUT:name": { errors: { name: "Enter a name of 1 to 60 characters" } },
    "CHARA_INVALID_INPUT:trial_days": { errors: { trialDays: "Enter a whole number of days from 0 to 365" } },
    "CHARA_INVALID_INPUT:is_public": { errors: { isPublic: "Only a paid plan can be public" } },
    "CHARA_INVALID_INPUT:plan_code": { message: "This plan no longer exists." },
  };

  if (plan) {
    const { error } = await supabase.rpc("admin_update_plan", {
      p_code: code,
      p_name: plan.name,
      p_is_public: plan.isPublic,
      p_trial_days: plan.trialDays,
      p_reason: reason,
    });
    if (error) return adminRefusal(error, path, known);
  }
  for (const limit of limits) {
    const { error } = await supabase.rpc("admin_set_plan_limit", {
      p_code: code,
      p_limit_key: limit.key,
      p_value: limit.value ?? undefined,
      p_reason: reason,
    });
    if (error) {
      return adminRefusal(error, path, {
        ...known,
        "CHARA_INVALID_INPUT:limit_value": { errors: { [`limits.${limit.key}.value`]: "Enter a whole number from 0 to 1,000,000" } },
        "CHARA_INVALID_INPUT:unknown_limit_key": { message: "This limit does not apply to this plan." },
      });
    }
  }
  for (const feature of features) {
    const { error } = await supabase.rpc("admin_set_plan_feature", {
      p_code: code,
      p_feature_key: feature.key,
      p_enabled: feature.enabled,
      p_reason: reason,
    });
    if (error) {
      return adminRefusal(error, path, { ...known, "CHARA_INVALID_INPUT:unknown_feature_key": { message: "This feature does not apply to this plan." } });
    }
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
    return adminRefusal(error, path, {
      ...REASON,
      "CHARA_INVALID_INPUT:value": { errors: { value: "This value is outside the rule of the setting" } },
      "CHARA_FORBIDDEN:setting_not_editable": { message: "This setting cannot be changed here." },
    });
  }
  revalidatePath(path);
  return { done: true };
}
