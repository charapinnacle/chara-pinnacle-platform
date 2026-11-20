import "server-only";
import * as z from "zod";
import type { PartnerFigures, SubmissionOutcome } from "@/lib/dashboard/partner-dashboard";
import type { SubmissionStatus } from "@/lib/submissions/presentation";
import { createClient } from "@/lib/supabase/server";
import { reviewStatusSchema } from "@/lib/validation/partner-review";

const count = z.number().int().nonnegative();

const submissionStatuses = [
  "awaiting_candidate",
  "declined_by_candidate",
  "expired",
  "submitted",
  "viewed",
  "shortlisted",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
] as const satisfies readonly SubmissionStatus[];

const stagesSchema = z.object(Object.fromEntries(submissionStatuses.map((status) => [status, count])) as Record<
  SubmissionStatus,
  typeof count
>);

const figuresRow = z.object({
  review_status: reviewStatusSchema,
  listed: z.boolean(),
  profile_hidden: z.boolean(),
  profile_missing: z.string().nullable(),
  profile_updated_at: z.string().nullable(),
  listings_total: count,
  listings_due: count,
  listings_stale: count,
  licences_current: count,
  licences_expiring: count,
  licences_expired: count,
  next_licence_expiry: z.string().nullable(),
  profile_views_30d: count.nullable(),
  profile_views_fewer_than: count.nullable(),
  profile_views_in_plan: z.boolean(),
  fitting_job_orders: count.nullable(),
  matching_employers: count.nullable(),
  invitations_awaiting: count.nullable(),
  responses_open: count.nullable(),
  responses_shortlisted: count.nullable(),
  responses_selected: count.nullable(),
  responses_declined: count.nullable(),
  submission_stages: stagesSchema.nullable(),
});

// The figures of a recruitment or staffing company dashboard (FR-R3, FR-R4), read again on every request in one call; the
// function refuses anyone who is not a member of the company.
export async function getPartnerFigures(organizationId: string): Promise<PartnerFigures> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_partner_dashboard", { p_org: organizationId });
  if (error) throw new Error("The figures of the dashboard could not be loaded", { cause: error });
  const row = figuresRow.parse(data[0]);
  return {
    reviewStatus: row.review_status,
    listed: row.listed,
    profileHidden: row.profile_hidden,
    profileMissing: row.profile_missing,
    profileUpdatedAt: row.profile_updated_at,
    listingsTotal: row.listings_total,
    listingsDue: row.listings_due,
    listingsStale: row.listings_stale,
    licencesCurrent: row.licences_current,
    licencesExpiring: row.licences_expiring,
    licencesExpired: row.licences_expired,
    nextLicenceExpiry: row.next_licence_expiry,
    profileViews: row.profile_views_30d,
    profileViewsFewerThan: row.profile_views_fewer_than,
    profileViewsInPlan: row.profile_views_in_plan,
    // The function returns every figure of release 2b or none of them.
    network:
      row.fitting_job_orders === null
        ? null
        : {
            fittingJobOrders: row.fitting_job_orders,
            matchingEmployers: row.matching_employers ?? 0,
            invitationsAwaiting: row.invitations_awaiting ?? 0,
            responsesOpen: row.responses_open ?? 0,
            responsesShortlisted: row.responses_shortlisted ?? 0,
            responsesSelected: row.responses_selected ?? 0,
            responsesDeclined: row.responses_declined ?? 0,
          },
    submissionStages: row.submission_stages,
  };
}

const outcomeRow = z.object({
  requirement_id: z.string(),
  title: z.string(),
  submitted: count,
  in_progress: count,
  hired: count,
  not_selected: count,
  withdrawn: count,
  last_change_at: z.string(),
});

// The hired and not selected counts of the company's submissions per requirement (FR-O5 AC10), the ten requirements
// with the latest change first, titled as the company knows each requirement.
export async function getSubmissionOutcomes(organizationId: string): Promise<SubmissionOutcome[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_partner_submission_outcomes", { p_org: organizationId });
  if (error) throw new Error("The outcomes of the submissions could not be loaded", { cause: error });
  return z
    .array(outcomeRow)
    .parse(data)
    .map((row) => ({
      requirementId: row.requirement_id,
      title: row.title,
      submitted: row.submitted,
      inProgress: row.in_progress,
      hired: row.hired,
      notSelected: row.not_selected,
      withdrawn: row.withdrawn,
      lastChangeAt: row.last_change_at,
    }));
}
