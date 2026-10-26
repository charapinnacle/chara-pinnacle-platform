import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { visitorProof } from "@/lib/dal/rate-limit";
import { getCurrentUser } from "@/lib/dal/session";
import type { Named } from "@/lib/partners/profile";
import {
  matchedFilterNames,
  type MatchedFilter,
  type PartnerDirectoryKind,
  type PartnerSearchFilters,
} from "@/lib/partners/search-params";
import { createClient } from "@/lib/supabase/server";

type Row = Database["public"]["Functions"]["search_partners"]["Returns"][number];

const namedSchema = z.array(z.object({ code: z.string(), name: z.string() }));
const matchedSchema = z.array(z.enum(matchedFilterNames));
const workforceSchema = z.array(
  z.object({ code: z.string(), name: z.string(), available: z.number(), confirmed_at: z.string() }),
);

export type PartnerResult = {
  id: string;
  slug: string;
  displayName: string;
  organizationType: Row["organization_type"];
  alsoOffersStaffing: boolean;
  basedInCountry: string;
  servedCountries: Named[];
  mainOccupations: Named[];
  staffingTypes: Row["staffing_types"];
  availableWorkforce: { occupation: string; available: number; confirmedAt: string }[];
  capacityConfirmedAt: string | null;
  matchedFilters: MatchedFilter[];
};

export type PartnerSearch =
  | { state: "found"; results: PartnerResult[]; nextCursor: string | null }
  | { state: "rate_limited" }
  | { state: "advanced_not_in_plan" };

// One page of the recruitment (FR-L1) or the staffing (FR-L2) directory. A visitor is counted under the keyed hash of the address with the proof
// of this minute, a signed-in reader by the database, which also logs the first page of each search without anything
// personal. Advanced filters outside the reader's plan and the visitor limit are states of the page; anything else is an
// error for the route's boundary.
export async function searchPartners(kind: PartnerDirectoryKind, filters: PartnerSearchFilters): Promise<PartnerSearch> {
  const visitor = (await getCurrentUser()) ? null : await visitorProof("partner_search");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_partners", {
    p_kind: kind,
    p_destination: filters.destination,
    p_occupation: filters.occupation,
    p_based_in: filters.based_in,
    p_sources_from: filters.sources_from,
    p_industry: filters.industry,
    p_language: filters.language,
    p_recruitment_type: filters.recruitment,
    p_staffing_types: filters.staffing_type,
    p_workforce_size: filters.workforce_size,
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
      organizationType: row.organization_type,
      alsoOffersStaffing: row.also_offers_staffing,
      basedInCountry: row.based_in_country,
      servedCountries: namedSchema.parse(row.served_countries),
      mainOccupations: namedSchema.parse(row.main_occupations),
      staffingTypes: row.staffing_types,
      availableWorkforce: workforceSchema
        .parse(row.available_workforce)
        .map((item) => ({ occupation: item.name, available: item.available, confirmedAt: item.confirmed_at })),
      capacityConfirmedAt: row.capacity_confirmed_at ?? null,
      matchedFilters: matchedSchema.parse(row.matched_filters),
    })),
    nextCursor: data.at(-1)?.next_cursor ?? null,
  };
}
