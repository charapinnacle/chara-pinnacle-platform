"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { getLicenceSettings, requestEvidenceLink, requestEvidenceUpload } from "@/lib/dal/licences";
import { getCountries } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import {
  evidenceFileSchema,
  licenceFormSchema,
  licenceIdSchema,
  type EvidenceFile,
  type LicenceInput,
} from "@/lib/validation/licences";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

export type LicenceResult = { errors?: FieldErrors; message?: string; licenceId?: string };
export type EvidenceUploadResult = { message?: string; upload?: { path: string; token: string } };
export type EvidenceDownloadResult = { message?: string; url?: string };

const RELEASE_OFF = "Licences cannot be changed at the moment.";
const SUSPENDED = "This organisation is suspended, so its licences cannot be changed.";
const GONE = "This licence no longer exists.";

// The database names the refused field; the form shows the message at it.
const invalidField: Record<string, [keyof LicenceInput, string]> = {
  confirmation: ["confirmed", "Confirm that this entry is accurate."],
  valid_until: ["validUntil", "Choose today or a later date within the allowed range."],
  licence_number: ["licenceNumber", "This does not match the usual format of licence numbers in this country"],
};

function refusal(error: PostgrestError): LicenceResult {
  if (error.message === "CHARA_CONFLICT" && error.details === "licence_number") {
    return { errors: { licenceNumber: "You have already added this number for this country." } };
  }
  const invalid = error.message === "CHARA_INVALID_INPUT" ? invalidField[error.details] : undefined;
  if (invalid) return { errors: { [invalid[0]]: invalid[1] } };
  if (error.code === "23503") return { errors: { country: "Choose a country from the list." } };
  if (error.code === "P0002") return { message: GONE };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "organization_suspended") return { message: SUSPENDED };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { message: RELEASE_OFF };
  return { message: faultMessage(logFault("Licence change", error)) };
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

// Adds a licence entry (licenceId null) or changes one, with the accuracy statement (FR-J2).
export async function saveLicence(slug: string, licenceId: string | null, input: LicenceInput): Promise<LicenceResult> {
  const id = licenceId === null ? null : licenceIdSchema.safeParse(licenceId);
  if (id && !id.success) return { message: GENERIC_FAILURE };
  const organization = await managedOrganization(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RELEASE_OFF };

  const [countries, { patterns }] = await Promise.all([getCountries(), getLicenceSettings()]);
  const parsed = licenceFormSchema({ countries, patterns }).safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { country, issuingAuthority, licenceNumber, validUntil, confirmed } = parsed.data;
  const fields = {
    p_country_code: country,
    p_issuing_authority: issuingAuthority,
    p_licence_number: licenceNumber,
    p_valid_until: validUntil,
    p_confirmed: confirmed,
  };

  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.rpc("update_partner_licence", { p_licence: id.data, ...fields });
    return error ? refusal(error) : { licenceId: id.data };
  }
  const { data, error } = await supabase.rpc("add_partner_licence", { p_org: organization.id, ...fields });
  return error ? refusal(error) : { licenceId: data };
}

export async function deleteLicence(slug: string, licenceId: string): Promise<{ message?: string }> {
  const id = licenceIdSchema.safeParse(licenceId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const organization = await managedOrganization(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RELEASE_OFF };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_partner_licence", { p_licence: id.data });
  if (error && error.code !== "P0002") return refusal(error);
  return {};
}

// The upload URL for the evidence of an entry: the browser then sends the file straight to Storage, so no file passes
// through a Next.js request.
export async function startEvidenceUpload(slug: string, licenceId: string, file: EvidenceFile): Promise<EvidenceUploadResult> {
  const id = licenceIdSchema.safeParse(licenceId);
  const parsedFile = evidenceFileSchema.safeParse(file);
  if (!id.success) return { message: GENERIC_FAILURE };
  if (!parsedFile.success) return { message: parsedFile.error.issues[0]?.message ?? GENERIC_FAILURE };
  const organization = await managedOrganization(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RELEASE_OFF };
  const upload = await requestEvidenceUpload(id.data, parsedFile.data);
  if ("refusal" in upload) {
    if (upload.refusal === "invalid_file") return { message: "Choose a PDF, JPG or PNG file of up to 15 MB." };
    if (upload.refusal === "unavailable") return { message: GONE };
    return { message: GENERIC_FAILURE };
  }
  return { upload };
}

// A 60-second link that makes the browser save the scanned evidence of an entry; the opening is logged by the database.
export async function getEvidenceDownload(slug: string, licenceId: string): Promise<EvidenceDownloadResult> {
  const id = licenceIdSchema.safeParse(licenceId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const organization = await managedOrganization(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RELEASE_OFF };
  const link = await requestEvidenceLink(id.data);
  if ("url" in link) return { url: link.url };
  if (link.refusal === "not_scanned") return { message: "This file cannot be downloaded until it has been checked." };
  if (link.refusal === "unavailable") return { message: GONE };
  if (link.refusal === "rate_limited") return { message: "Too many files were opened in a short time. Wait a minute and try again." };
  return { message: GENERIC_FAILURE };
}
