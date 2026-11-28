import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import type { OrganizationType } from "@/lib/billing/limits";
import type { BoostProduct } from "@/lib/boosts/presentation";
import { requestHostedSession, type HostedSession } from "@/lib/dal/billing";
import type { Named } from "@/lib/partners/profile";
import type { PartnerDirectoryKind, PartnerSearchFilters } from "@/lib/partners/search-params";
import { createClient } from "@/lib/supabase/server";

type Row = Database["public"]["Functions"]["boosted_partners"]["Returns"][number];

const namedSchema = z.array(z.object({ code: z.string(), name: z.string() }));
const productSchema = z.object({ sku: z.string(), days: z.number(), price_minor: z.number(), currency: z.string() });
const boostSchema = z.object({ starts_at: z.string(), ends_at: z.string() });

export type BoostedPartner = {
  id: string;
  slug: string;
  displayName: string;
  basedInCountry: string;
  servedCountries: Named[];
  mainOccupations: Named[];
  staffingTypes: Row["staffing_types"];
};

// The boosts of the organisation that have not ended: the one running now, if any, and the ones bought to follow it.
export type BoostStatus = { running: boolean; endsAt: string } | null;

// The boosted partners of one directory search, for the rail above the results (at most three, each matching every
// filter). The database decides who is shown and in which order; an empty rail is shown as nothing.
export async function getBoostedPartners(kind: PartnerDirectoryKind, filters: PartnerSearchFilters): Promise<BoostedPartner[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("boosted_partners", {
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
  });
  if (error) throw new Error("The boosted partners could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    basedInCountry: row.based_in_country,
    servedCountries: namedSchema.parse(row.served_countries),
    mainOccupations: namedSchema.parse(row.main_occupations),
    staffingTypes: row.staffing_types,
  }));
}

// The products on sale for the organisation's type, shortest first.
export async function listBoostProducts(orgType: OrganizationType): Promise<BoostProduct[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_boost_products")
    .select("sku, days, price_minor, currency")
    .eq("org_type", orgType)
    .eq("target_type", "organization")
    .order("sort");
  if (error) throw new Error("The boost products could not be loaded", { cause: error });
  return z
    .array(productSchema)
    .parse(data)
    .map((row) => ({ sku: row.sku, days: row.days, priceMinor: row.price_minor, currency: row.currency }));
}

export async function getBoostStatus(organizationId: string, now: Date = new Date()): Promise<BoostStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_active_boosts")
    .select("starts_at, ends_at")
    .eq("organization_id", organizationId)
    .order("ends_at");
  if (error) throw new Error("The boosts could not be loaded", { cause: error });
  const boosts = z.array(boostSchema).parse(data);
  const last = boosts.at(-1);
  if (!last) return null;
  return { running: boosts.some((boost) => new Date(boost.starts_at) <= now), endsAt: last.ends_at };
}

// billing-checkout starts the one-time payment of the product; this server only sends the person to the provider.
export function requestBoostCheckout(organizationId: string, sku: string): Promise<HostedSession> {
  return requestHostedSession({ action: "boost", orgId: organizationId, sku });
}
