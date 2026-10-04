"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { requireUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { mfaPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import {
  createdOrganizationSchema,
  organizationInputSchema,
  type OrganizationFormInput,
} from "@/lib/validation/organization";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

export type CreateOrganizationResult = {
  errors?: FieldErrors;
  message?: string;
  created?: { duplicateLegalName: true };
};

const LIMIT_REACHED = "You have reached the number of organizations one account can own.";

const fieldByConstraint: Record<string, keyof OrganizationFormInput> = {
  legal_name: "legalName",
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
  console.error("Create organization failed", { code: error.code, message: error.message });
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
  if (created.duplicate_legal_name) return { created: { duplicateLegalName: true } };
  redirect(mfaPath(defaultLocale));
}
