import "server-only";
import * as z from "zod";
import type { PartnerFigures } from "@/lib/dashboard/partner-dashboard";
import { createClient } from "@/lib/supabase/server";
import { reviewStatusSchema } from "@/lib/validation/partner-review";

const count = z.number().int().nonnegative();

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
  };
}
