import "server-only";
import { getLegalDocument } from "@/lib/dal/legal";
import { createClient } from "@/lib/supabase/server";
import {
  COMMITMENT_SLUG,
  commitmentOutdated,
  commitmentStatusSchema,
  type CommitmentBlock,
  type CommitmentStatus,
} from "@/lib/validation/commitment";

// The employer-pays commitment of a partner (FR-J3), as its members read it.
export async function getCommitmentStatus(organizationId: string): Promise<CommitmentStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("partner_commitment_status", { p_org: organizationId });
  if (error) throw new Error("The commitment of the organisation could not be loaded", { cause: error });
  return commitmentStatusSchema.parse(data);
}

// What blocks the partner's responses and submissions (FR-S4 AC7, FR-J3 AC3): null while the organisation holds an
// acceptance of the current version; otherwise whether an earlier version was accepted and the current version as the
// owner accepts it.
export async function getCommitmentBlock(organizationId: string): Promise<CommitmentBlock | null> {
  const status = await getCommitmentStatus(organizationId);
  if (status.accepted) return null;
  const document = await getLegalDocument(COMMITMENT_SLUG);
  if (!document) throw new Error("The employer-pays commitment has no published version");
  return {
    outdated: commitmentOutdated(status),
    title: document.title,
    version: document.version,
    changeSummary: document.changeSummary,
    publishedAt: document.publishedAt,
    isDraft: document.isDraft,
  };
}
