import "server-only";
import { createClient } from "@/lib/supabase/server";

export type DeletionStatus = {
  requestedAt: string | null;
  erasesOn: string | null;
  canCancel: boolean;
  coolingOffDays: number;
};

// One row from the database function, which also holds the length of the cooling-off period, so the page states the
// period the erasure job uses and never a copy of it.
export async function getDeletionStatus(): Promise<DeletionStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("account_deletion_status").single();
  if (error) throw new Error("The deletion status could not be loaded", { cause: error });
  return {
    requestedAt: data.requested_at ?? null,
    erasesOn: data.erases_on ?? null,
    canCancel: data.can_cancel,
    coolingOffDays: data.cooling_off_days,
  };
}
