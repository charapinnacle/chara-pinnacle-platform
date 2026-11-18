import * as z from "zod";
import { BRAND_NAME } from "@/lib/brand";

export const COMMITMENT_SLUG = "employer-pays-commitment";
export const COMMITMENT_LABEL = "We charge workers no recruitment fees or related costs";
export const COMMITMENT_REQUIRED = "Please confirm the commitment to continue.";
// The line every partner page shows (FR-J3, NFR-C6).
export const WORKERS_NEVER_PAY = `Workers never pay fees to get a job through ${BRAND_NAME}`;

// The commitment is a separate confirmation, never ticked in advance (FR-J3 AC1).
export const commitmentSchema = z.object({
  confirmed: z.boolean().refine(Boolean, { error: COMMITMENT_REQUIRED }),
});

export type CommitmentInput = z.input<typeof commitmentSchema>;

// partner_commitment_status: the current version, whether it is the draft, whether the organisation holds an acceptance
// of it, and the version its owner last accepted (null when none).
export const commitmentStatusSchema = z
  .object({
    version: z.number().int().min(0),
    is_draft: z.boolean(),
    accepted: z.boolean(),
    accepted_version: z.number().int().min(0).nullable(),
  })
  .transform(({ version, is_draft, accepted, accepted_version }) => ({
    version,
    isDraft: is_draft,
    accepted,
    acceptedVersion: accepted_version,
  }));

export type CommitmentStatus = z.output<typeof commitmentStatusSchema>;

// An earlier version was accepted but the current one is not: the commitment changed (or the owner withdrew it). After a
// transfer of ownership the new owner has accepted no version, which is "not accepted", not "outdated".
export function commitmentOutdated(status: CommitmentStatus): boolean {
  return !status.accepted && status.acceptedVersion !== null;
}
