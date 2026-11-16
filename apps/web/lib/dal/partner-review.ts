import "server-only";
import { getPublicSettings } from "@/lib/dal/settings";
import { createClient } from "@/lib/supabase/server";
import {
  infoStepSchema,
  parseReviewTarget,
  reviewStatusSchema,
  type InfoStep,
  type ReviewStatus,
} from "@/lib/validation/partner-review";

export type PartnerReview = {
  status: ReviewStatus;
  submittedAt: string | null;
  // The step staff reopened with a request for information (V11); null otherwise.
  infoStep: InfoStep | null;
};

// The review state of a partner as its members read it (organizations is readable by members only); null for an
// employer.
export async function getPartnerReview(organizationId: string): Promise<PartnerReview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("review_status, submitted_at, info_step")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error("The review state of the organisation could not be loaded", { cause: error });
  if (!data?.review_status) return null;
  const infoStep = infoStepSchema.safeParse(data.info_step);
  return {
    status: reviewStatusSchema.parse(data.review_status),
    submittedAt: data.submitted_at,
    infoStep: infoStep.success ? infoStep.data : null,
  };
}

// How long a review usually takes, in working days (decision 7.2, setting partner_review_target_working_days).
export async function getReviewTargetDays(): Promise<number> {
  return parseReviewTarget((await getPublicSettings()).partner_review_target_working_days);
}
