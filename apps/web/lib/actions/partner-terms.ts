"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { getPartnerKind } from "@/lib/dal/workforce-offer";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { hasAmount, hasCurrency, type FeeModel } from "@/lib/responses/presentation";
import { standardTermsSchema, trackRecordSchema, type StandardTermsInput, type TrackRecordInput } from "@/lib/partners/terms-and-record";
import { workforceProfilePath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { FEE_MODEL_FOR_KIND } from "@/lib/validation/response";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

export type TermsResult = {
  errors?: FieldErrors;
  message?: string;
  saved?: true;
};

const RELEASE_OFF = "The workforce profile cannot be changed at the moment.";
const SUSPENDED = "This organisation is suspended, so its profile cannot be changed.";

// The organisation from the slug, the caller an owner or admin at aal2; the database checks all of it again.
async function managedOrganization(slug: string) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  if (!(await isReleased("release_partner_directories"))) return "release_off" as const;
  const { organization } = await requireOrgRole(defaultLocale, parsed.data, "admin", { hideFromOutsiders: true, partner: true });
  return organization;
}

const fieldOfDetail: Record<string, [string, string]> = {
  fee_model_for_kind: ["feeModel", FEE_MODEL_FOR_KIND],
  fee_currency: ["feeCurrency", "Select a currency from the list."],
  standard_terms: ["feeAmount", "Check the amount for this fee model."],
  countries_placed: ["countriesPlaced", "Choose countries from the list."],
  track_record: ["placementsLastYear", "Enter a whole number of 0 or more."],
};

function refusal(error: PostgrestError, action: string): TermsResult {
  const field = error.message === "CHARA_INVALID_INPUT" ? fieldOfDetail[error.details] : undefined;
  if (field) return { errors: { [field[0]]: field[1] } };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "organization_suspended") return { message: SUSPENDED };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { message: RELEASE_OFF };
  return { message: faultMessage(logFault(action, error)) };
}

// Saves the standard terms of the company: the fee models of its kind, the guarantee with a placement fee and the
// shortest assignment with a rate.
export async function saveStandardTerms(slug: string, input: StandardTermsInput): Promise<TermsResult> {
  const organization = await managedOrganization(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RELEASE_OFF };
  const parsed = standardTermsSchema(await getPartnerKind(organization)).safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const values = parsed.data;
  const model = values.feeModel as FeeModel;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_partner_standard_terms", {
    p_org: organization.id,
    p_fee_model: model,
    p_fee_amount: hasAmount(model) ? Number(values.feeAmount) : undefined,
    p_fee_currency: hasCurrency(model) ? values.feeCurrency : undefined,
    p_guarantee_days: values.guaranteeDays === "" ? undefined : Number(values.guaranteeDays),
    p_min_assignment_weeks: values.minAssignmentWeeks === "" ? undefined : Number(values.minAssignmentWeeks),
    p_note: values.note === "" ? undefined : values.note,
  });
  if (error) return refusal(error, "Saving the standard terms");
  revalidatePath(workforceProfilePath(defaultLocale, organization.slug));
  return { saved: true };
}

export async function saveTrackRecord(slug: string, input: TrackRecordInput): Promise<TermsResult> {
  const organization = await managedOrganization(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RELEASE_OFF };
  const parsed = trackRecordSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_partner_track_record", {
    p_org: organization.id,
    p_placements_last_year: parsed.data.placementsLastYear === "" ? undefined : Number(parsed.data.placementsLastYear),
    p_countries_placed: parsed.data.countriesPlaced,
  });
  if (error) return refusal(error, "Saving the track record");
  revalidatePath(workforceProfilePath(defaultLocale, organization.slug));
  return { saved: true };
}
