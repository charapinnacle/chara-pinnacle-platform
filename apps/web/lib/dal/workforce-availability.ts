import "server-only";
import { getPublicSettings } from "@/lib/dal/settings";
import { createClient } from "@/lib/supabase/server";
import { sortListings, type AvailabilityRules } from "@/lib/validation/workforce-availability";

export type WorkforceListing = {
  id: string;
  occupation: string;
  country: string;
  available: number;
  monthlyCapacity: number;
  availableFrom: string;
  confirmedAt: string;
};

// The availability listings of a partner as its members read them (FR-K3), the longest unconfirmed first.
export async function getWorkforceListings(organizationId: string): Promise<WorkforceListing[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workforce_availability")
    .select("id, occupation_id, source_country, available, monthly_capacity, available_from, confirmed_at")
    .eq("organization_id", organizationId);
  if (error) throw new Error("The availability listings of the organisation could not be loaded", { cause: error });
  return sortListings(
    data.map((row) => ({
      id: row.id,
      occupation: row.occupation_id,
      country: row.source_country,
      available: row.available,
      monthlyCapacity: row.monthly_capacity,
      availableFrom: row.available_from,
      confirmedAt: row.confirmed_at,
    })),
  );
}

// The plan limit of listings when it applies; null when the plan has none or limits are not enforced.
export async function getListingsLimit(organizationId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("workforce_listings_limit", { p_org: organizationId });
  if (error) throw new Error("The plan limit of listings could not be loaded", { cause: error });
  return data;
}

// The staleness, reminder and date periods of the listings, from the public settings.
export async function getAvailabilityRules(): Promise<AvailabilityRules> {
  const settings = await getPublicSettings();
  return {
    staleDays: Number(settings.workforce_listing_stale_days),
    reminderDays: Number(settings.workforce_confirm_reminder_days),
    maxDays: Number(settings.workforce_available_from_max_days),
  };
}
