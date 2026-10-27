import "server-only";
import { adminClient, failure } from "@/lib/dal/admin";
import { parseRuleValues, type DirectHiringRule, type DirectHiringRuleChange } from "@/lib/validation/direct-hiring-rules";

const ACTIONS = {
  "direct_hiring_rule.created": "created",
  "direct_hiring_rule.updated": "updated",
  "direct_hiring_rule.deleted": "deleted",
} as const;

// The rules of the editor with their legal opinion reference and review flag (FR-Q5 AC10, AC11). The RPC asks for a
// Platform Administrator at aal2 itself.
export async function listDirectHiringRules(): Promise<DirectHiringRule[]> {
  const { data, error } = await (await adminClient()).rpc("admin_list_direct_hiring_rules");
  if (error) throw failure("The direct-hiring rules", error);
  return data.map((row) => ({
    id: row.id,
    sourceCountry: row.source_country,
    sourceName: row.source_name,
    destinationCountry: row.destination_country ?? null,
    destinationName: row.destination_name ?? null,
    rule: row.rule,
    notice: row.notice,
    legalOpinionRef: row.legal_opinion_ref,
    updatedByName: row.updated_by_name ?? null,
    updatedAt: row.updated_at,
    reviewDue: row.review_due,
  }));
}

// The latest changes of the rules from the audit log, newest first, deleted rules included.
export async function listDirectHiringRuleHistory(): Promise<DirectHiringRuleChange[]> {
  const { data, error } = await (await adminClient()).rpc("admin_list_direct_hiring_rule_history", { p_limit: 50 });
  if (error) throw failure("The direct-hiring rule history", error);
  return data.flatMap((row) => {
    const action = ACTIONS[row.action as keyof typeof ACTIONS];
    if (!action) return [];
    return [
      {
        id: row.id,
        createdAt: row.created_at,
        actorName: row.actor_name ?? null,
        action,
        before: parseRuleValues(row.before),
        after: parseRuleValues(row.after),
        reason: row.reason ?? null,
      },
    ];
  });
}
