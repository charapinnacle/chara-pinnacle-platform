import "server-only";
import { isReleased } from "@/lib/dal/release";
import { createClient } from "@/lib/supabase/server";
import type { DirectHiringRuleValue } from "@/lib/validation/direct-hiring-rules";

export type HiringRule = { rule: DirectHiringRuleValue; notice: string; source: string; destination: string };

// The rules are enforced while release 2b or 2c is on (FR-Q5, V37, V72); before that nothing is shown.
export async function hiringRulesEnforced(): Promise<boolean> {
  const [jobOrders, findWorkers] = await Promise.all([isReleased("release_job_orders"), isReleased("release_find_workers")]);
  return jobOrders || findWorkers;
}

// The rule of the candidate's current country for a vacancy's country (FR-Q5 AC7), the one apply_to_job enforces; null
// while the rules are not enforced or the passport has no country yet.
export async function getApplyHiringRule(userId: string, destination: string): Promise<HiringRule | null> {
  if (!(await hiringRulesEnforced())) return null;
  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("worker_profiles")
    .select("current_country")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError) throw new Error("The passport could not be loaded", { cause: profileError });
  if (!profile?.current_country) return null;
  const { data, error } = await supabase.rpc("hiring_rule_notice", { p_source: profile.current_country, p_destination: destination });
  if (error) throw new Error("The hiring rule could not be loaded", { cause: error });
  const [row] = data;
  return row ? { rule: row.rule, notice: row.notice, source: profile.current_country, destination } : null;
}

// The countries a partner serves that need a licence it does not hold (FR-K1 AC8); none while the rules are not enforced.
export async function getLicenceRequiredDestinations(organizationId: string): Promise<string[]> {
  if (!(await hiringRulesEnforced())) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("licence_required_destinations", { p_org: organizationId });
  if (error) throw new Error("The licence prompts could not be loaded", { cause: error });
  return data.map((row) => row.country_code);
}
