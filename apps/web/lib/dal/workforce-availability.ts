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
  languageCode: string | null;
  languageLevel: string | null;
  minExperienceYears: number | null;
  certificates: string | null;
};

// The availability listings of a partner as its members read them (FR-K3), the longest unconfirmed first.
export async function getWorkforceListings(organizationId: string): Promise<WorkforceListing[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workforce_availability")
    .select(
      "id, occupation_id, source_country, available, monthly_capacity, available_from, confirmed_at, language_code, language_level, min_experience_years, certificates",
    )
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
      languageCode: row.language_code,
      languageLevel: row.language_level,
      minExperienceYears: row.min_experience_years,
      certificates: row.certificates,
    })),
  );
}

export type ListingCounts = { occupations: Record<string, number>; countries: Record<string, number> };

// How many listings name each occupation and each source country, for the warning of the profile forms: removing one
// of them deletes its listings.
export async function getListingCounts(organizationId: string): Promise<ListingCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workforce_availability")
    .select("occupation_id, source_country")
    .eq("organization_id", organizationId);
  if (error) throw new Error("The availability listings of the organisation could not be counted", { cause: error });
  const counts: ListingCounts = { occupations: {}, countries: {} };
  for (const { occupation_id, source_country } of data) {
    counts.occupations[occupation_id] = (counts.occupations[occupation_id] ?? 0) + 1;
    counts.countries[source_country] = (counts.countries[source_country] ?? 0) + 1;
  }
  return counts;
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
