import "server-only";
import { z } from "zod";
import type { SoldPlan, SubscriptionStatus } from "@/lib/billing/presentation";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

const MAX_PLANS = 20;
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
  z.object({ limit_key: z.enum(["active_jobs", "members"]), used: z.number(), limit_value: z.number().nullable() }),
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

export type Usage = { key: "active_jobs" | "members"; used: number; limit: number | null };

// The plans a company can buy online: public, priced and not for contact. Limits and features are not read here.
export async function listSoldPlans(): Promise<SoldPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_plans")
    .select("code, name, price_minor, currency, interval, trial_days")
    .eq("org_type", "employer")
    .eq("is_public", true)
    .eq("contact_sales", false)
    .gt("price_minor", 0)
    .order("sort")
    .limit(MAX_PLANS);
  if (error) throw new Error("The plans could not be loaded", { cause: error });
  return data.flatMap((row) =>
    row.code && row.name && row.price_minor !== null && row.currency && row.interval && row.trial_days !== null
      ? [{ code: row.code, name: row.name, priceMinor: row.price_minor, currency: row.currency, interval: row.interval, trialDays: row.trial_days }]
      : [],
  );
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

// The open vacancies and the team members against the limits of the plan (null is unlimited).
export async function getUsage(organizationId: string): Promise<Usage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_usage", { p_org: organizationId });
  if (error) throw new Error("The usage could not be loaded", { cause: error });
  return usageSchema.parse(data).map((row) => ({ key: row.limit_key, used: row.used, limit: row.limit_value }));
}

const answerSchema = z.object({
  url: z.url({ protocol: /^https$/ }).optional(),
  error: z.string().optional(),
  reason: z.string().nullish(),
  field: z.string().nullish(),
});

export type HostedSession =
  | { url: string }
  | { refusal: { status: number; reason: string | null; field: string | null } };

// The billing-checkout function runs the checks of the database with the person's own token and holds the keys of the
// payment provider; this server only forwards the session and sends the person to the address it answers with.
export async function requestHostedSession(body: Record<string, unknown>): Promise<HostedSession> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { refusal: { status: 401, reason: null, field: null } };
  const endpoint = serverEnv().BILLING_CHECKOUT_ENDPOINT ?? `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/billing-checkout`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { refusal: { status: 0, reason: null, field: null } };
  }
  const answer = answerSchema.safeParse(await response.json().catch(() => null));
  if (response.ok && answer.success && answer.data.url) return { url: answer.data.url };
  return {
    refusal: {
      status: response.ok ? 502 : response.status,
      reason: (answer.success && answer.data.reason) || null,
      field: (answer.success && answer.data.field) || null,
    },
  };
}
