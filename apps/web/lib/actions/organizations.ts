"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { refreshAppShell } from "@/lib/app/refresh-shell";
import { requireOrgRole, requireUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { mfaPath, organizationProfilePath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import {
  createdOrganizationSchema,
  organizationInputSchema,
  organizationProfileSchema,
  updatedOrganizationSchema,
  type OrganizationFormInput,
  type OrganizationProfileInput,
} from "@/lib/validation/organization";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

export type CreateOrganizationResult = {
  errors?: FieldErrors;
  message?: string;
  duplicateLegalName?: true;
};

const LIMIT_REACHED = "You have reached the number of organizations one account can own.";

const fieldByConstraint: Record<string, keyof OrganizationFormInput> = {
  legal_name: "legalName",
  based_in_country: "country",
  organizations_legal_name_check: "legalName",
  organizations_display_name_check: "displayName",
  industry_code: "industry",
  organizations_industry_code_fkey: "industry",
  organizations_based_in_country_fkey: "country",
  organizations_website_check: "website",
  legal_entity_identifier: "identifier",
  legal_entity_identifier_kind: "identifierKind",
};

function refusal(error: PostgrestError): CreateOrganizationResult {
  if (error.message === "CHARA_LIMIT_REACHED") return { message: LIMIT_REACHED };
  const constraint =
    error.message === "CHARA_INVALID_INPUT"
      ? error.details
      : /constraint "([^"]+)"/.exec(error.message)?.[1];
  const field = constraint ? fieldByConstraint[constraint] : undefined;
  if (field) return { errors: { [field]: "Check this value." } };
  console.error("Saving the organization failed", { code: error.code, message: error.message });
  return { message: GENERIC_FAILURE };
}

export async function createOrganization(
  input: OrganizationFormInput,
): Promise<CreateOrganizationResult | undefined> {
  await requireUser(defaultLocale);
  const parsed = organizationInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const organization = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organization", {
    p_type: organization.type,
    p_legal_name: organization.legalName,
    p_display_name: organization.displayName,
    p_based_in_country: organization.country,
    p_industry_code: organization.industry,
    p_website: organization.website ?? undefined,
    p_identifier: organization.identifier ?? undefined,
    p_identifier_kind: organization.identifierKind ?? undefined,
  });
  if (error) return refusal(error);

  const created = createdOrganizationSchema.parse(data);
  if (created.duplicate_legal_name) return { duplicateLegalName: true };
  refreshAppShell();
  redirect(mfaPath(defaultLocale));
}

export type UpdateOrganizationResult = CreateOrganizationResult & { saved?: true };

const LEGAL_NAME_LOCKED = "The legal name cannot be changed once a payment has been started for the company.";
const SUSPENDED = "This organization is suspended, so its profile cannot be changed.";

// The organization comes from the slug in the address, checked against the caller's membership and role; the function
// checks the role, two-step verification and the lock of the legal name again in the database.
export async function updateOrganizationProfile(
  slug: string,
  input: OrganizationProfileInput,
): Promise<UpdateOrganizationResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return { message: GENERIC_FAILURE };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin");
  const parsed = organizationProfileSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_organization_profile", {
    p_org: organization.id,
    p_legal_name: parsed.data.legalName,
    p_display_name: parsed.data.displayName,
    p_based_in_country: parsed.data.country,
    p_industry_code: parsed.data.industry,
    p_website: parsed.data.website,
  });
  if (error) {
    const path = organizationProfilePath(defaultLocale, parsedSlug.data);
    if (error.message === "CHARA_FORBIDDEN" && error.details === "aal2_required") redirect(mfaPath(defaultLocale, path));
    if (error.message === "CHARA_FORBIDDEN" && error.details === "legal_name_locked") {
      return { errors: { legalName: LEGAL_NAME_LOCKED } };
    }
    if (error.message === "CHARA_FORBIDDEN" && error.details === "organization_suspended") return { message: SUSPENDED };
    return refusal(error);
  }

  const updated = updatedOrganizationSchema.parse(data);
  refreshAppShell();
  return { saved: true, ...(updated.duplicate_legal_name ? { duplicateLegalName: true } : {}) };
}
