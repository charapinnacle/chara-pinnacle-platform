import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { createClient } from "@/lib/supabase/server";
import type { ReportItemType } from "@/lib/validation/report";

export type ItemModeration = {
  state: Database["public"]["Enums"]["job_moderation_state"];
  decision: { id: number; reasons: string; decidedAt: string } | null;
};

// The moderation state of one of the organisation's own requirements, responses or submissions and, while it is hidden,
// the decision with its statement of reasons (FR-S1 AC12). Every member reads it; null when the item is not the
// organisation's (the page then ends in its own 404).
export async function getItemModeration(organizationId: string, type: ReportItemType, id: string): Promise<ItemModeration | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("item_moderation", { p_org: organizationId, p_target_type: type, p_target_id: id });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return null;
    throw new Error("The moderation state could not be loaded", { cause: error });
  }
  const [row] = data;
  if (!row) return null;
  return {
    state: row.moderation_state,
    decision:
      row.moderation_action_id === null || row.reasons === null || row.decided_at === null
        ? null
        : { id: row.moderation_action_id, reasons: row.reasons, decidedAt: row.decided_at },
  };
}
