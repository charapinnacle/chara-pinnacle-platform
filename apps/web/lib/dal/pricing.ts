import "server-only";
import { z } from "zod";
import type { PricingViewer, PublicPlan } from "@/lib/billing/pricing";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { getCurrentUser, roleRank } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";

const MAX_PLANS = 20;

const planSchema = z.object({
  code: z.string(),
  name: z.string(),
  price_minor: z.number().int(),
  currency: z.string(),
  interval: z.string(),
  trial_days: z.number().int(),
  contact_sales: z.boolean(),
  limits: z.record(z.string(), z.number().int().nullable()),
  features: z.array(z.string()),
});

// The plans the pricing page shows. A member also reads the plan its own organisation is on, even when it is not
// public (the fallback plan, Enterprise before its price is stated), so the filter on is_public is not left to the
// row policy.
export async function listPublicPlans(): Promise<PublicPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_plans")
    .select("code, name, price_minor, currency, interval, trial_days, contact_sales, limits, features")
    .eq("org_type", "employer")
    .eq("is_public", true)
    .order("sort")
    .limit(MAX_PLANS);
  if (error) throw new Error("The plans could not be loaded", { cause: error });
  return z.array(planSchema).parse(data).map((row) => ({
    code: row.code,
    name: row.name,
    priceMinor: row.price_minor,
    currency: row.currency,
    interval: row.interval,
    trialDays: row.trial_days,
    contactSales: row.contact_sales,
    limits: row.limits,
    features: row.features,
  }));
}

// Who reads the page decides which link a plan card carries. The first organisation the person owns or administers is
// the one the links lead to.
export async function getPricingViewer(): Promise<PricingViewer> {
  const user = await getCurrentUser();
  if (!user) return { kind: "visitor" };
  if (user.accountKind === "worker") return { kind: "worker" };
  if (user.accountKind !== "company") return { kind: "setup" };
  const organizations = await getMyOrganizations(user.id);
  const manager = organizations.find((organization) => roleRank[organization.role] >= roleRank.admin);
  if (manager) return { kind: "manager", slug: manager.slug };
  return organizations.length > 0 ? { kind: "member" } : { kind: "setup" };
}
