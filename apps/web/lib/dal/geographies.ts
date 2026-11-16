import "server-only";
import { createClient } from "@/lib/supabase/server";

export type OrganizationGeographies = { sourcesFrom: string[]; servesMarket: string[] };

// The countries a partner sources workers from and serves (FR-K1), as its members read them; codes sorted.
export async function getOrganizationGeographies(organizationId: string): Promise<OrganizationGeographies> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_geographies")
    .select("scope, country_code")
    .eq("organization_id", organizationId)
    .order("country_code");
  if (error) throw new Error("The countries of the organisation could not be loaded", { cause: error });
  return {
    sourcesFrom: data.filter(({ scope }) => scope === "sources_from").map(({ country_code }) => country_code),
    servesMarket: data.filter(({ scope }) => scope === "serves_market").map(({ country_code }) => country_code),
  };
}

// Where you serve is done once both lists hold a country (submission for review needs both, FR-J1 AC10).
export function geographiesComplete({ sourcesFrom, servesMarket }: OrganizationGeographies): boolean {
  return sourcesFrom.length > 0 && servesMarket.length > 0;
}
