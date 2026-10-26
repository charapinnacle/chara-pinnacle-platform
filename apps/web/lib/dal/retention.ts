import "server-only";
import { adminClient, failure } from "@/lib/dal/admin";
import type { RetentionPolicy } from "@/lib/validation/retention";

// The retention periods of the editor (FR-S3 AC10). The RPC asks for a Platform Administrator at aal2 itself.
export async function listRetentionPolicies(): Promise<RetentionPolicy[]> {
  const { data, error } = await (await adminClient()).rpc("admin_list_retention_policies");
  if (error) throw failure("The retention periods", error);
  return data.map((row) => ({
    entity: row.entity,
    label: row.label,
    description: row.description,
    days: row.days,
    editable: row.editable,
  }));
}
