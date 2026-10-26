import "server-only";
import type { Json } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { adminClient, failure } from "@/lib/dal/admin";
import { callBillingFunction, type FunctionRefusal } from "@/lib/dal/billing";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import {
  editorFeatureSchema,
  editorLimitSchema,
  type EditorPlan,
  type SettingRule,
} from "@/lib/validation/plan-editor";

// The reads of the plan editor (FR-R2): every plan with every key of its type, the history of a plan from the audit log,
// the limit overrides, the organisations that may get one and the editable settings. Each RPC asks for a Platform
// Administrator at aal2 itself.

const limitsSchema = z.array(editorLimitSchema);
const featuresSchema = z.array(editorFeatureSchema);

export async function listEditorPlans(): Promise<EditorPlan[]> {
  const { data, error } = await (await adminClient()).rpc("admin_list_plans");
  if (error) throw failure("The plans", error);
  return data.map((row) => ({
    code: row.code,
    orgType: row.org_type,
    name: row.name,
    priceMinor: row.price_minor,
    currency: row.currency,
    trialDays: row.trial_days,
    isPublic: row.is_public,
    contactSales: row.contact_sales,
    limits: limitsSchema.parse(row.limits),
    features: featuresSchema.parse(row.features),
  }));
}

export type PlanHistoryRow = {
  id: number;
  createdAt: string;
  actorName: string | null;
  table: string;
  operation: string;
  field: string;
  before: Json;
  after: Json;
  reason: string | null;
};

const fieldNames: Record<string, string> = {
  name: "Name",
  is_public: "Visibility",
  trial_days: "Trial days",
  price_minor: "Price",
  contact_sales: "Contact sales",
  provider_price_ref: "Provider price",
  provider_product_ref: "Provider product",
};

// The field a history row names: the catalogue label of the limit or feature (its key when the key left the catalogue),
// else the plan columns that changed.
function historyField(table: string | null, key: string | null, label: string | null, after: Json, before: Json): string {
  if (key) return label ?? key;
  const changed = after && typeof after === "object" && !Array.isArray(after) ? after : before;
  const columns = changed && typeof changed === "object" && !Array.isArray(changed) ? Object.keys(changed) : [];
  if (table === "plans" && columns.length > 0 && columns.length <= 3) return columns.map((column) => fieldNames[column] ?? column).join(", ");
  return table === "plan_provider_refs" ? "Provider references" : "Plan";
}

export async function listPlanHistory(code: string): Promise<PlanHistoryRow[]> {
  const { data, error } = await (await adminClient()).rpc("admin_list_plan_history", { p_code: code, p_limit: 100 });
  if (error) throw failure("The plan history", error);
  return data.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actorName: row.actor_name ?? null,
    table: row.table_name ?? "",
    operation: row.operation ?? "",
    field: historyField(row.table_name ?? null, row.limit_key ?? row.feature_key ?? null, row.label ?? null, row.after, row.before),
    before: row.before,
    after: row.after,
    reason: row.reason ?? null,
  }));
}

export type OverrideRow = {
  organizationId: string;
  organizationName: string;
  planCode: string;
  limitKey: string;
  limitLabel: string;
  value: number;
  planLimit: number | null;
  expiresAt: string | null;
  expired: boolean;
  reason: string | null;
};

export async function listLimitOverrides(): Promise<OverrideRow[]> {
  const { data, error } = await (await adminClient()).rpc("admin_list_limit_overrides");
  if (error) throw failure("The limit overrides", error);
  return data.map((row) => ({
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    planCode: row.plan_code,
    limitKey: row.limit_key,
    limitLabel: row.limit_label ?? row.limit_key,
    value: row.limit_value,
    planLimit: row.plan_limit ?? null,
    expiresAt: row.expires_at ?? null,
    expired: row.expired,
    reason: row.reason ?? null,
  }));
}

export type EnterpriseOrganization = { id: string; displayName: string; orgType: EditorPlan["orgType"]; planCode: string };

export async function listEnterpriseOrganizations(): Promise<EnterpriseOrganization[]> {
  const { data, error } = await (await adminClient()).rpc("admin_list_enterprise_organizations");
  if (error) throw failure("The Enterprise organisations", error);
  return data.map((row) => ({ id: row.id, displayName: row.display_name, orgType: row.org_type, planCode: row.plan_code }));
}

const valueTypeSchema = z.enum(["integer", "boolean", "text", "email"]);

export async function listEditableSettings(): Promise<SettingRule[]> {
  const { data, error } = await (await adminClient()).rpc("admin_list_settings");
  if (error) throw failure("The settings", error);
  return data.map((row) => ({
    key: row.key,
    label: row.label,
    value: row.value ?? "",
    valueType: valueTypeSchema.parse(row.value_type),
    min: row.min ?? null,
    max: row.max ?? null,
    releaseFeature: row.release_feature ?? null,
    releaseGaps: row.release_gaps ?? null,
  }));
}

export type PriceChangeAnswer = { done: true } | { refusal: FunctionRefusal };

// A price change (FR-R2 AC8) runs in the billing-plan-price function: it creates the new price at the provider and records
// it, both with the administrator's own token.
export async function requestPlanPrice(body: { plan_code: string; price_minor: number; reason: string }): Promise<PriceChangeAnswer> {
  const endpoint = serverEnv().BILLING_PLAN_PRICE_ENDPOINT ?? `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/billing-plan-price`;
  const result = await callBillingFunction(endpoint, body, z.object({ price_minor: z.literal(body.price_minor) }));
  return "data" in result ? { done: true } : result;
}
