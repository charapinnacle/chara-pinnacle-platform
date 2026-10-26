import * as z from "zod";
import type { OrganizationType } from "@/lib/billing/limits";
import { staffReasonSchema } from "@/lib/validation/admin";

// The plan, limit, feature, override and settings editor (FR-R2). The bounds mirror the editor RPCs, which check them
// again: limits and overrides 0 to 1,000,000 (null is unlimited for a plan limit), trial length 0 to 365 days, plan names
// 1 to 60 characters, a reason of 10 to 500 characters.

export const LIMIT_MAX = 1_000_000;

export const organizationTypeSections = {
  employer: "Employers",
  recruitment_company: "Recruitment companies",
  staffing_company: "Staffing companies",
} as const satisfies Record<OrganizationType, string>;

export const editorLimitSchema = z.object({
  key: z.string(),
  label: z.string(),
  period: z.enum(["none", "month"]),
  value: z.number().int().nullable(),
  defined: z.boolean(),
});

export const editorFeatureSchema = z.object({ key: z.string(), label: z.string(), enabled: z.boolean() });

export type EditorLimit = z.infer<typeof editorLimitSchema>;
export type EditorFeature = z.infer<typeof editorFeatureSchema>;

export type EditorPlan = {
  code: string;
  orgType: OrganizationType;
  name: string;
  priceMinor: number;
  currency: string;
  trialDays: number;
  isPublic: boolean;
  contactSales: boolean;
  limits: EditorLimit[];
  features: EditorFeature[];
};

const wholeNumber = /^\d{1,7}$/;

function inRange(value: string, max: number): boolean {
  return wholeNumber.test(value.trim()) && Number(value.trim()) <= max;
}

export const planFormSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name of 1 to 60 characters").max(60, "Enter a name of 1 to 60 characters"),
    isPublic: z.boolean(),
    trialDays: z.string().refine((value) => inRange(value, 365), "Enter a whole number of days from 0 to 365"),
    limits: z.record(z.string(), z.object({ unlimited: z.boolean(), value: z.string() })),
    features: z.record(z.string(), z.boolean()),
    reason: staffReasonSchema,
  })
  .superRefine((values, ctx) => {
    for (const [key, limit] of Object.entries(values.limits)) {
      if (!limit.unlimited && !inRange(limit.value, LIMIT_MAX)) {
        ctx.addIssue({ code: "custom", path: ["limits", key, "value"], message: "Enter a whole number from 0 to 1,000,000" });
      }
    }
  });

export type PlanForm = z.input<typeof planFormSchema>;
export type PlanFormOutput = z.output<typeof planFormSchema>;

export function planFormValues(plan: EditorPlan): PlanForm {
  return {
    name: plan.name,
    isPublic: plan.isPublic,
    trialDays: String(plan.trialDays),
    limits: Object.fromEntries(plan.limits.map((limit) => [limit.key, { unlimited: limit.value === null, value: limit.value === null ? "" : String(limit.value) }])),
    features: Object.fromEntries(plan.features.map((feature) => [feature.key, feature.enabled])),
    reason: "",
  };
}

export function limitText(value: number | null): string {
  return value === null ? "Unlimited" : value.toLocaleString("en");
}

export type PlanChange = { label: string; from: string; to: string };

export type PlanChanges = {
  plan: { name: string; isPublic: boolean; trialDays: number } | null;
  limits: { key: string; value: number | null }[];
  features: { key: string; enabled: boolean }[];
  lines: PlanChange[];
};

// What a submitted edit changes, in the order of the dialog, with the lines the confirmation shows before anything is
// saved ("Job order responses per month: 10 -> 12"). A value that is not changed is not sent.
export function planChanges(plan: EditorPlan, values: PlanFormOutput): PlanChanges {
  const lines: PlanChange[] = [];
  const trialDays = Number(values.trialDays.trim());
  if (values.name !== plan.name) lines.push({ label: "Name", from: plan.name, to: values.name });
  if (values.isPublic !== plan.isPublic) {
    lines.push({ label: "Visibility", from: plan.isPublic ? "Public" : "Not public", to: values.isPublic ? "Public" : "Not public" });
  }
  if (trialDays !== plan.trialDays) lines.push({ label: "Trial days", from: String(plan.trialDays), to: String(trialDays) });
  const planChanged = lines.length > 0;

  const limits = plan.limits.flatMap((limit) => {
    const entry = values.limits[limit.key];
    if (!entry) return [];
    const value = entry.unlimited ? null : Number(entry.value.trim());
    if (value === limit.value) return [];
    lines.push({ label: limit.label, from: limitText(limit.value), to: limitText(value) });
    return [{ key: limit.key, value }];
  });
  const features = plan.features.flatMap((feature) => {
    const enabled = values.features[feature.key] ?? feature.enabled;
    if (enabled === feature.enabled) return [];
    lines.push({ label: feature.label, from: feature.enabled ? "On" : "Off", to: enabled ? "On" : "Off" });
    return [{ key: feature.key, enabled }];
  });

  return { plan: planChanged ? { name: values.name, isPublic: values.isPublic, trialDays } : null, limits, features, lines };
}

export function changeLine(change: PlanChange): string {
  return `${change.label}: ${change.from} -> ${change.to}`;
}

const planCodeSchema = z.string().regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/).max(64);
const keySchema = z.string().regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/).max(64);

export const savePlanInputSchema = z
  .object({
    code: planCodeSchema,
    plan: z
      .object({
        name: z.string().trim().min(1, "Enter a name of 1 to 60 characters").max(60, "Enter a name of 1 to 60 characters"),
        isPublic: z.boolean(),
        trialDays: z.number().int().min(0).max(365),
      })
      .nullable(),
    limits: z.array(z.object({ key: keySchema, value: z.number().int().min(0).max(LIMIT_MAX).nullable() })).max(50),
    features: z.array(z.object({ key: keySchema, enabled: z.boolean() })).max(50),
    reason: staffReasonSchema,
  })
  .refine((input) => input.plan !== null || input.limits.length > 0 || input.features.length > 0, {
    path: ["reason"],
    error: "Change at least one value",
  });

export type SavePlanInput = z.input<typeof savePlanInputSchema>;

// The expiry of an override is a calendar day after today (UTC); it applies until the start of that day.
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export function isFutureDay(value: string, now = new Date()): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return dayPattern.test(value) && !Number.isNaN(time) && new Date(time).toISOString().startsWith(value) && time > now.getTime();
}

export function expiryInstant(day: string): string {
  return `${day}T00:00:00Z`;
}

export const overrideFormSchema = z.object({
  organizationId: z.uuid({ error: "Choose an organisation" }),
  limitKey: z.string().min(1, "Choose a limit"),
  value: z.string().refine((value) => inRange(value, LIMIT_MAX), "Enter a whole number from 0 to 1,000,000"),
  expiresOn: z.string().refine((value) => isFutureDay(value), "Enter a date after today as year-month-day"),
  reason: staffReasonSchema,
});

export type OverrideForm = z.input<typeof overrideFormSchema>;

export const overrideInputSchema = z.object({
  organizationId: z.uuid(),
  limitKey: keySchema,
  value: z.number().int().min(0).max(LIMIT_MAX),
  expiresOn: z.string().refine((value) => isFutureDay(value), "Enter a date after today as year-month-day"),
  reason: staffReasonSchema,
});

export type OverrideInput = z.input<typeof overrideInputSchema>;

export const removeOverrideFormSchema = z.object({ reason: staffReasonSchema });

export type RemoveOverrideForm = z.input<typeof removeOverrideFormSchema>;

export const removeOverrideInputSchema = removeOverrideFormSchema.extend({ organizationId: z.uuid(), limitKey: keySchema });

export type SettingRule = {
  key: string;
  label: string;
  value: string;
  valueType: "integer" | "boolean" | "text" | "email";
  min: number | null;
  max: number | null;
  releaseFeature: string | null;
  releaseGaps: string[] | null;
};

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// The value of a setting checked against its rule, as the database checks it: null when it is valid, else the message.
export function settingValueError(rule: Pick<SettingRule, "valueType" | "min" | "max">, raw: string): string | null {
  const value = raw.trim();
  if (rule.valueType === "integer") {
    const min = rule.min ?? 0;
    const max = rule.max ?? 0;
    return /^-?\d{1,9}$/.test(value) && Number(value) >= min && Number(value) <= max ? null : `Enter a whole number from ${min} to ${max}`;
  }
  if (rule.valueType === "boolean") return value === "true" || value === "false" ? null : "Choose on or off";
  if (rule.valueType === "email") return value.length <= 254 && emailPattern.test(value) ? null : "Enter an email address";
  return value.length >= (rule.min ?? 1) && value.length <= (rule.max ?? 0)
    ? null
    : `Enter ${rule.min ?? 1} to ${rule.max ?? 0} characters`;
}

export function settingFormSchema(rule: Pick<SettingRule, "valueType" | "min" | "max">) {
  return z.object({
    value: z.string().superRefine((value, ctx) => {
      const message = settingValueError(rule, value);
      if (message) ctx.addIssue({ code: "custom", message });
    }),
    reason: staffReasonSchema,
  });
}

export type SettingForm = z.input<ReturnType<typeof settingFormSchema>>;

export const settingInputSchema = z.object({
  key: keySchema,
  value: z.string().max(1000),
  reason: staffReasonSchema,
});

export type SettingInput = z.input<typeof settingInputSchema>;

export function settingValueText(rule: Pick<SettingRule, "valueType">, value: string): string {
  if (rule.valueType === "boolean") return value === "true" ? "On" : "Off";
  return value === "" ? "Not set" : value;
}

// A release switch is how a release goes live (DATA_MODEL.md section 1); the legal documents that still stop it are named
// before the switch is turned on. The go-live check stays the authority.
export function releaseWarning(rule: Pick<SettingRule, "releaseFeature" | "releaseGaps">, nextValue: string): string[] {
  if (!rule.releaseFeature || nextValue !== "true") return [];
  return (rule.releaseGaps ?? []).map((gap) => {
    const [slug, state] = gap.split(":");
    return `${slug}: ${state === "draft" ? "still a draft" : "not published"}`;
  });
}

// The rule of a setting in words, for the editor and the settings list.
export function ruleText(rule: Pick<SettingRule, "valueType" | "min" | "max">): string {
  if (rule.valueType === "integer") return `A whole number from ${rule.min ?? 0} to ${rule.max ?? 0}.`;
  if (rule.valueType === "boolean") return "On or off.";
  if (rule.valueType === "email") return "An email address.";
  return `Text of ${rule.min ?? 1} to ${rule.max ?? 0} characters.`;
}
