import "server-only";
import * as z from "zod";
import { limitPrompt, type OrganizationType, type OrgUsage, type UsagePrompt } from "@/lib/billing/limits";
import { listPublicPlans } from "@/lib/dal/pricing";
import { createClient } from "@/lib/supabase/server";

const usageSchema = z.array(
  z.object({
    limit_key: z.string(),
    used: z.number().int(),
    limit_value: z.number().int().nullable(),
    applies: z.boolean(),
    period_resets_at: z.string().nullable(),
    plan_name: z.string().nullable(),
  }),
);

// The usage and limits of the organisation for its type (FR-R1), as any accepted member reads them through org_usage;
// only the keys named, so that a page section waits for its own table only.
export async function getOrgUsage(organizationId: string, keys: readonly string[]): Promise<OrgUsage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("org_usage", { p_org: organizationId, p_keys: [...keys] });
  if (error) throw new Error("The usage of the organisation could not be loaded", { cause: error });
  const rows = usageSchema.parse(data);
  return {
    planName: rows[0]?.plan_name ?? null,
    items: Object.fromEntries(
      rows.map((row) => [
        row.limit_key,
        { used: row.used, limit: row.limit_value, applies: row.applies, resetsAt: row.period_resets_at },
      ]),
    ),
  };
}

// The prompts of the given limit keys: the usage once, and the plans of a partner's type to compare (a partner's prompt
// has no billing link before partner checkout opens, see upgradeHref).
export async function getUsagePrompts<K extends string>(
  organizationId: string,
  type: OrganizationType,
  keys: readonly K[],
): Promise<Record<K, UsagePrompt | null>> {
  const [usage, plans] = await Promise.all([
    getOrgUsage(organizationId, keys),
    type === "employer" ? null : listPublicPlans(type),
  ]);
  return Object.fromEntries(keys.map((key) => [key, limitPrompt(usage, key, type, plans)])) as Record<K, UsagePrompt | null>;
}
