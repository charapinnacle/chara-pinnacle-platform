import * as z from "zod";
import type { Database } from "@chara-pinnacle/db-types";
import { partnerTypeSchema } from "@/lib/validation/sign-up";

type ProfileRow = Database["public"]["Functions"]["get_partner_profile"]["Returns"][number];

const namedSchema = z.array(z.object({ code: z.string(), name: z.string() }));

const listingSchema = z.object({
  occupation_code: z.string(),
  occupation: z.string(),
  source_country: z.string(),
  source_country_name: z.string(),
  available: z.union([z.number(), z.string()]),
  monthly_capacity: z.union([z.number(), z.string()]),
  available_from: z.string(),
  confirmed_at: z.string(),
});

export type Named = z.infer<typeof namedSchema>[number];

export type PartnerListing = {
  occupation: string;
  sourceCountry: string;
  // Exact for the company's own members, a range for everyone else.
  available: number | string;
  monthlyCapacity: number | string;
  availableFrom: string;
  confirmedAt: string;
};

// The public workforce profile of a partner (FR-K4): the fields get_partner_profile returns, nothing else.
export type PartnerProfile = {
  slug: string;
  displayName: string;
  type: z.infer<typeof partnerTypeSchema>;
  basedIn: Named;
  servedCountries: Named[];
  sourceCountries: Named[];
  industries: Named[];
  occupations: Named[];
  languages: Named[];
  serviceTypes: ProfileRow["service_types"];
  recruitmentType: ProfileRow["recruitment_type"] | null;
  sizeBand: ProfileRow["workforce_size_band"] | null;
  foundedYear: number | null;
  description: string | null;
  website: string | null;
  commitmentCurrent: boolean;
  updatedAt: string | null;
  // Null for a visitor: the capacity is for signed-in readers only (FR-K3 AC4).
  listings: PartnerListing[] | null;
};

type SharedRow = Omit<ProfileRow, "viewer_is_member">;

// The row of get_partner_profile or preview_partner_profile; the generated types call every column required, but the
// optional ones come back as null.
export function partnerProfileFrom(row: SharedRow): PartnerProfile {
  return {
    slug: row.slug,
    displayName: row.display_name,
    type: partnerTypeSchema.parse(row.organization_type),
    basedIn: { code: row.based_in_country, name: row.based_in_country_name },
    servedCountries: namedSchema.parse(row.served_countries),
    sourceCountries: namedSchema.parse(row.source_countries),
    industries: namedSchema.parse(row.industries),
    occupations: namedSchema.parse(row.occupations),
    languages: namedSchema.parse(row.languages),
    serviceTypes: row.service_types,
    recruitmentType: row.recruitment_type ?? null,
    sizeBand: row.workforce_size_band ?? null,
    foundedYear: row.founded_year ?? null,
    description: row.description ?? null,
    website: row.website ?? null,
    commitmentCurrent: row.commitment_current,
    updatedAt: row.profile_updated_at ?? null,
    listings: z
      .array(listingSchema)
      .nullable()
      .parse(row.listings ?? null)
      ?.map((listing) => ({
        occupation: listing.occupation,
        sourceCountry: listing.source_country_name,
        available: listing.available,
        monthlyCapacity: listing.monthly_capacity,
        availableFrom: listing.available_from,
        confirmedAt: listing.confirmed_at,
      })) ?? null,
  };
}
