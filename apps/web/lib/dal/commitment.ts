import "server-only";
import { createClient } from "@/lib/supabase/server";
import { commitmentStatusSchema, type CommitmentStatus } from "@/lib/validation/commitment";

// The employer-pays commitment of a partner (FR-J3), as its members read it.
export async function getCommitmentStatus(organizationId: string): Promise<CommitmentStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("partner_commitment_status", { p_org: organizationId });
  if (error) throw new Error("The commitment of the organisation could not be loaded", { cause: error });
  return commitmentStatusSchema.parse(data);
}
