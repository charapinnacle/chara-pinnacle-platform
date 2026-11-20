import "server-only";
import * as z from "zod";
import { shownLimit, type OrganizationType } from "@/lib/billing/limits";
import type { SoldPlan, SubscriptionStatus } from "@/lib/billing/presentation";
import { PLAN_LIMIT_KEYS, type PlanLimitKey } from "@/lib/billing/pricing";
import { listPublicPlans } from "@/lib/dal/pricing";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

const TIMEOUT_MS = 20_000;

const stateSchema = z.object({
  trial_used: z.boolean(),
  has_customer: z.boolean(),
  identifier_locked: z.boolean(),
  identifier: z.string().nullable(),
  identifier_kind: z.string().nullable(),
  billing_country: z.string().nullable(),
  vat_id: z.string().nullable(),
  registration_number: z.string().nullable(),
});

const statuses = ["trialing", "active", "past_due", "canceled", "paused"] as const satisfies readonly SubscriptionStatus[];

const subscriptionSchema = z.object({
  plan_code: z.string(),
  plan_name: z.string().nullable(),
  status: z.enum(statuses),
  trial_ends_at: z.string().nullable(),
  current_period_end: z.string().nullable(),
  cancel_at: z.string().nullable(),
  past_due_since: z.string().nullable(),
});

const usageSchema = z.array(
  z.object({ limit_key: z.string(), used: z.number(), limit_value: z.number().nullable(), applies: z.boolean() }),
);

export type BillingState = z.infer<typeof stateSchema>;

export type Subscription = {
  planCode: string;
  planName: string | null;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  pastDueSince: string | null;
};

// The keys of the billing page: those its plans list, and the open workforce requirements while release 2b is on (FR-M4).
export type UsageKey = PlanLimitKey | "active_requirements";

// applies: the limit is enforced now (entitlements_enforced, or an organisation restricted to its free plan); otherwise
// a change above it still succeeds.
export type Usage = { key: UsageKey; used: number; limit: number | null; applies: boolean };

// The plans a company of the given type can buy online: public, priced and not for contact.
export async function listSoldPlans(orgType: OrganizationType = "employer"): Promise<SoldPlan[]> {
  return (await listPublicPlans(orgType)).filter((plan) => !plan.contactSales && plan.priceMinor > 0);
}

export async function getBillingState(organizationId: string): Promise<BillingState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_checkout_state", { p_org: organizationId });
  if (error) throw new Error("The billing state could not be loaded", { cause: error });
  return stateSchema.parse(data[0]);
}

// The live subscription of the organization, else its newest cancelled one.
export async function getSubscription(organizationId: string): Promise<Subscription | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_my_subscription")
    .select("plan_code, plan_name, status, trial_ends_at, current_period_end, cancel_at, past_due_since")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error("The subscription could not be loaded", { cause: error });
  if (!data) return null;
  const row = subscriptionSchema.parse(data);
  return {
    planCode: row.plan_code,
    planName: row.plan_name,
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEnd: row.current_period_end,
    cancelAt: row.cancel_at,
    pastDueSince: row.past_due_since,
  };
}

// The usage against the limits of the plan (null is unlimited) for the keys the plans of the organisation's type list:
// open vacancies and team members for an employer, the workforce profile and the team for a partner. billing_usage also
// returns the keys of later releases, which the page shows once their features are released (extraKeys).
export async function getUsage(
  organizationId: string,
  orgType: OrganizationType = "employer",
  extraKeys: readonly UsageKey[] = [],
): Promise<Usage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_usage", { p_org: organizationId });
  if (error) throw new Error("The usage could not be loaded", { cause: error });
  const keys: readonly UsageKey[] = [...PLAN_LIMIT_KEYS[orgType], ...extraKeys];
  const rows = usageSchema.parse(data);
  return keys.flatMap((key) => {
    const row = rows.find((candidate) => candidate.limit_key === key);
    return row ? [{ key, used: row.used, limit: shownLimit(key, row.limit_value), applies: row.applies }] : [];
  });
}

export type FunctionRefusal = { status: number; reason: string | null; field: string | null };

const refusalSchema = z.object({ reason: z.string().nullish(), field: z.string().nullish() });

// A billing Edge Function called with the person's own token: the function runs the checks of the database as that person
// and holds the keys of the payment provider. A success is an answer that matches the schema; anything else is a refusal
// with the function's reason or field. Status 0 is a network failure or a timeout, 502 a success the schema does not accept.
export async function callBillingFunction<T>(
  endpoint: string,
  body: unknown,
  schema: z.ZodType<T>,
  extraHeaders: Record<string, string> = {},
): Promise<{ data: T } | { refusal: FunctionRefusal }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { refusal: { status: 401, reason: null, field: null } };
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { ...extraHeaders, authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { refusal: { status: 0, reason: null, field: null } };
  }
  const payload: unknown = await response.json().catch(() => null);
  const answer = response.ok ? schema.safeParse(payload) : null;
  if (answer?.success) return { data: answer.data };
  const refusal = refusalSchema.safeParse(payload);
  return {
    refusal: {
      status: response.ok ? 502 : response.status,
      reason: (refusal.success && refusal.data.reason) || null,
      field: (refusal.success && refusal.data.field) || null,
    },
  };
}

const sessionSchema = z.object({ url: z.url({ protocol: /^https$/ }) });

export type HostedSession = { url: string } | { refusal: FunctionRefusal };

// billing-checkout answers with the address of the provider's hosted page; this server only sends the person there.
export async function requestHostedSession(body: Record<string, unknown>): Promise<HostedSession> {
  const endpoint = serverEnv().BILLING_CHECKOUT_ENDPOINT ?? `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/billing-checkout`;
  const result = await callBillingFunction(endpoint, body, sessionSchema);
  return "data" in result ? { url: result.data.url } : result;
}
