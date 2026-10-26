"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { recordLimitPrompt } from "@/lib/actions/limits";
import { limitRefusalMessage } from "@/lib/billing/limits";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, partnerTypeSchema, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";
import { listingFormSchema, listingIdSchema, type ListingInput } from "@/lib/validation/workforce-availability";

export type ListingResult = { errors?: FieldErrors; message?: string; saved?: true };

const RELEASE_OFF = "Availability cannot be changed at the moment.";
const SUSPENDED = "This organization is suspended, so its availability cannot be changed.";
const GONE = "This listing no longer exists.";

type ManagedOrganization = { id: string; type: string };

// The database names the refused field; the form shows the message at it.
const invalidField: Record<string, [keyof ListingInput, string]> = {
  occupation_not_in_profile: ["occupation", "Choose one of the occupations you offer."],
  source_country_not_in_profile: ["country", "Choose one of the countries you source workers from."],
  available_from: ["availableFrom", "Choose a date within the allowed range."],
};

async function refusal(error: PostgrestError, organization: ManagedOrganization): Promise<ListingResult> {
  if (error.message === "CHARA_CONFLICT" && error.details === "listing") {
    return { errors: { country: "You already list this occupation from this country." } };
  }
  const invalid = error.message === "CHARA_INVALID_INPUT" ? invalidField[error.details] : undefined;
  if (invalid) return { errors: { [invalid[0]]: invalid[1] } };
  if (error.message === "CHARA_LIMIT_REACHED") {
    await recordLimitPrompt(organization.id, error.details);
    return { message: limitRefusalMessage(error.details, partnerTypeSchema.parse(organization.type)) };
  }
  if (error.code === "P0002") return { message: GONE };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "organization_suspended") return { message: SUSPENDED };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { message: RELEASE_OFF };
  return { message: faultMessage(logFault("Availability change", error)) };
}

// The organisation from the slug, the caller an owner or admin at aal2 (requireOrgRole sends an aal1 session to two-step
// verification); the database checks all of it again.
async function managedOrganization(slug: string) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  if (!(await isReleased("release_partner_directories"))) return "release_off" as const;
  const { organization } = await requireOrgRole(defaultLocale, parsed.data, "admin", { hideFromOutsiders: true, partner: true });
  return organization;
}

// Adds a listing (listingId null) or changes the numbers and the date of one (FR-K3 AC1, AC2). The occupation, the
// country and the date bound are the database's to check against the profile and the settings.
export async function saveListing(slug: string, listingId: string | null, input: ListingInput): Promise<ListingResult> {
  const id = listingId === null ? null : listingIdSchema.safeParse(listingId);
  if (id && !id.success) return { message: GENERIC_FAILURE };
  const organization = await managedOrganization(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RELEASE_OFF };

  const parsed = listingFormSchema().safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { occupation, country, available, monthlyCapacity, availableFrom } = parsed.data;
  const values = {
    p_available: Number(available),
    p_monthly_capacity: Number(monthlyCapacity),
    p_available_from: availableFrom,
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.rpc("update_workforce_availability", { p_listing: id.data, ...values })
    : await supabase.rpc("add_workforce_availability", {
        p_org: organization.id,
        p_occupation_id: occupation,
        p_source_country: country,
        ...values,
      });
  return error ? refusal(error, organization) : { saved: true };
}

// Confirms a listing unchanged, so it stays or becomes visible again (FR-K3 AC6, AC10).
export async function confirmListing(slug: string, listingId: string): Promise<{ message?: string }> {
  const id = listingIdSchema.safeParse(listingId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const organization = await managedOrganization(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RELEASE_OFF };
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_workforce_availability", { p_listing: id.data });
  return error ? { message: (await refusal(error, organization)).message ?? GENERIC_FAILURE } : {};
}

export async function deleteListing(slug: string, listingId: string): Promise<{ message?: string }> {
  const id = listingIdSchema.safeParse(listingId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const organization = await managedOrganization(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RELEASE_OFF };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_workforce_availability", { p_listing: id.data });
  if (error && error.code !== "P0002") return { message: (await refusal(error, organization)).message ?? GENERIC_FAILURE };
  return {};
}
