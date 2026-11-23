"use server";

import * as z from "zod";
import { isReleased } from "@/lib/dal/release";
import { faultMessage, logFault } from "@/lib/fault";
import {
  availableWorkforceSchema,
  type AvailableWorkforceInput,
  type AvailableWorkforcePage,
} from "@/lib/partners/available-workforce";
import { createClient } from "@/lib/supabase/server";
import { skillsText } from "@/lib/workforce/skills";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

// One of: field errors, a page of results, a refusal the page explains (plan, search limit), or a failure to toast.
export type AvailableWorkforceResult = {
  errors?: FieldErrors;
  page?: AvailableWorkforcePage;
  refused?: "not_in_plan" | "rate_limited";
  failure?: string;
};

const UNAVAILABLE = "The available workforce cannot be searched at the moment.";

const listingsSchema = z.array(
  z.object({
    source_country_name: z.string(),
    available: z.string(),
    monthly_capacity: z.string(),
    available_from: z.string(),
    confirmed_at: z.string(),
    language: z.string().nullish(),
    language_level: z.string().nullish(),
    min_experience_years: z.number().nullish(),
    certificates: z.string().nullish(),
  }),
);

const cursorSchema = z.string().max(80).nullable();

// One page of search_available_workforce (FR-K3 step Search, FR-L2 AC4). The database checks again that the caller is a
// signed-in employer on a plan with the feature and logs the first page without anything personal.
export async function searchAvailableWorkforce(input: AvailableWorkforceInput, cursor: string | null): Promise<AvailableWorkforceResult> {
  const parsed = availableWorkforceSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const after = cursorSchema.safeParse(cursor);
  if (!after.success || !(await isReleased("release_partner_directories"))) return { failure: UNAVAILABLE };

  const { occupation, destination, workers, within_days } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_available_workforce", {
    p_destination: destination,
    p_occupation: occupation,
    p_workers_needed: Number(workers),
    p_within_days: Number(within_days),
    p_cursor: after.data ?? undefined,
  });
  if (error?.message === "CHARA_FEATURE_NOT_IN_PLAN") return { refused: "not_in_plan" };
  if (error?.message === "CHARA_RATE_LIMITED") return { refused: "rate_limited" };
  // A caller without an employer organisation, a visitor refused at the grant and the release switched off are
  // refusals, not faults.
  if (error?.message === "CHARA_FORBIDDEN" || error?.code === "42501" || error?.code === "P0002") {
    return { failure: UNAVAILABLE };
  }
  if (error) return { failure: faultMessage(logFault("Available workforce search", error)) };
  return {
    page: {
      suppliers: data.map((row) => ({
        id: row.id,
        slug: row.slug,
        displayName: row.display_name,
        recruitmentCompany: row.organization_type === "recruitment_company",
        supply: row.supply,
        availableNow: row.available_now,
        listings: listingsSchema.parse(row.listings).map((listing) => ({
          sourceCountry: listing.source_country_name,
          available: listing.available,
          monthlyCapacity: listing.monthly_capacity,
          availableFrom: listing.available_from,
          confirmedAt: listing.confirmed_at,
          skills: skillsText({
            language: listing.language,
            languageLevel: listing.language_level,
            minExperienceYears: listing.min_experience_years,
            certificates: listing.certificates,
          }),
        })),
      })),
      nextCursor: data.at(-1)?.next_cursor ?? null,
    },
  };
}
