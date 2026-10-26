import "server-only";
import * as z from "zod";
import { visitorProof } from "@/lib/dal/rate-limit";
import { getCurrentUser } from "@/lib/dal/session";
import type { Named } from "@/lib/partners/profile";
import { matchedFilterNames, type MatchedFilter, type PartnerSearchFilters } from "@/lib/partners/search-params";
import { createClient } from "@/lib/supabase/server";

const namedSchema = z.array(z.object({ code: z.string(), name: z.string() }));
const matchedSchema = z.array(z.enum(matchedFilterNames));

export type PartnerResult = {
  id: string;
  slug: string;
  displayName: string;
  basedInCountry: string;
  servedCountries: Named[];
  mainOccupations: Named[];
  capacityConfirmedAt: string | null;
  matchedFilters: MatchedFilter[];
};

export type PartnerSearch =
  | { state: "found"; results: PartnerResult[]; nextCursor: string | null }
  | { state: "rate_limited" }
  | { state: "advanced_not_in_plan" };

// One page of the recruitment directory (FR-L1). A visitor is counted under the keyed hash of the address with the proof
// of this minute, a signed-in reader by the database, which also logs the first page of each search without anything
// personal. Advanced filters outside the reader's plan and the visitor limit are states of the page; anything else is an
// error for the route's boundary.
export async function searchPartners(filters: PartnerSearchFilters): Promise<PartnerSearch> {
  const visitor = (await getCurrentUser()) ? null : await visitorProof("partner_search");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_partners", {
    p_kind: "recruitment",
    p_destination: filters.destination,
    p_occupation: filters.occupation,
    p_based_in: filters.based_in,
    p_sources_from: filters.sources_from,
    p_industry: filters.industry,
    p_language: filters.language,
    p_recruitment_type: filters.recruitment,
    p_capacity: filters.capacity,
    p_within_days: filters.within_days,
    p_cursor: filters.cursor,
    p_limit: filters.limit,
    p_key: visitor?.key,
    p_proof: visitor?.proof,
  });
  if (error?.message === "CHARA_RATE_LIMITED") return { state: "rate_limited" };
  if (error?.message === "CHARA_FEATURE_NOT_IN_PLAN") return { state: "advanced_not_in_plan" };
  if (error) throw new Error("The partners could not be searched", { cause: error });
  return {
    state: "found",
    results: data.map((row) => ({
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      basedInCountry: row.based_in_country,
      servedCountries: namedSchema.parse(row.served_countries),
      mainOccupations: namedSchema.parse(row.main_occupations),
      capacityConfirmedAt: row.capacity_confirmed_at ?? null,
      matchedFilters: matchedSchema.parse(row.matched_filters),
    })),
    nextCursor: data.at(-1)?.next_cursor ?? null,
  };
}
