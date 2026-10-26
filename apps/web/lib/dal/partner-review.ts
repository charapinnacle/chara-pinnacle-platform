import "server-only";
import { cache } from "react";
import { getPublicSettings } from "@/lib/dal/settings";
import { createClient } from "@/lib/supabase/server";
import {
  infoStepSchema,
  parseReviewTarget,
  partnerDecisionSchema,
  reviewStatusSchema,
  type InfoStep,
  type PartnerDecision,
  type ReviewStatus,
} from "@/lib/validation/partner-review";

export type PartnerReview = {
  status: ReviewStatus;
  submittedAt: string | null;
  // The step staff reopened with a request for information; null otherwise.
  infoStep: InfoStep | null;
  // Set at the first approval: a partner in re-review, or asked for information during one, stays listed.
  listedAt: string | null;
};

// The latest staff decision as the partner's members read it (FR-J4 AC7, NFR-C7): the reason only for a request for
// information or a decline, never the staff member.
export type ReviewOutcome = { decision: PartnerDecision; reason: string | null; infoStep: InfoStep | null; decidedAt: string };

// The review state of a partner as its members read it (organizations is readable by members only); null for an
// employer.
// Cached per request: the dashboard page reads it to route and its review card again.
export const getPartnerReview = cache(async (organizationId: string): Promise<PartnerReview | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("review_status, submitted_at, info_step, listed_at")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error("The review state of the organisation could not be loaded", { cause: error });
  if (!data?.review_status) return null;
  const infoStep = infoStepSchema.safeParse(data.info_step);
  return {
    status: reviewStatusSchema.parse(data.review_status),
    submittedAt: data.submitted_at,
    infoStep: infoStep.success ? infoStep.data : null,
    listedAt: data.listed_at,
  };
});

export async function getReviewOutcome(organizationId: string): Promise<ReviewOutcome | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("partner_review_outcome", { p_org: organizationId });
  if (error) throw new Error("The outcome of the review could not be loaded", { cause: error });
  const [row] = data;
  if (!row) return null;
  const infoStep = infoStepSchema.safeParse(row.info_step);
  return {
    decision: partnerDecisionSchema.parse(row.decision),
    reason: row.reason ?? null,
    infoStep: infoStep.success ? infoStep.data : null,
    decidedAt: row.decided_at,
  };
}

// How long a review usually takes, in working days (decision 7.2, setting partner_review_target_working_days).
export async function getReviewTargetDays(): Promise<number> {
  return parseReviewTarget((await getPublicSettings()).partner_review_target_working_days);
}
