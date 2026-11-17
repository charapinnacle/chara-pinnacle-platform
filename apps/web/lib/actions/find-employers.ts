"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { findEmployersFormSchema, formFindEmployersFilters, type FindEmployersFormInput } from "@/lib/find-employers/search-params";
import { defaultLocale } from "@/lib/i18n/locale";
import { findEmployersPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { slugSchema } from "@/lib/validation/team";

type SavedSearchResult = { message?: string };

const RELEASE_OFF = "Find Employers is not available at the moment.";

const idSchema = z.uuid();

// Saves the filters of a Find Employers search for the company slug (FR-L3 AC9); any member may, on a plan with advanced
// employer discovery, which save_employer_search checks again with the codes and the release. Saving the same filters
// twice keeps one saved search.
export async function saveEmployerSearch(slug: string, input: FindEmployersFormInput): Promise<SavedSearchResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsed = findEmployersFormSchema.safeParse(input);
  if (!parsedSlug.success || !parsed.success) return { message: GENERIC_FAILURE };
  const filters = formFindEmployersFilters(parsed.data);
  if (!filters.destination && !filters.industry && !filters.occupation && filters.min_workers === undefined) {
    return { message: "Choose at least one filter to save a search." };
  }
  if (!(await isReleased("release_job_orders"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", { mfa: false, hideFromOutsiders: true, partner: true });

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_employer_search", {
    p_org: organization.id,
    p_destination: filters.destination,
    p_industry: filters.industry,
    p_occupation: filters.occupation,
    p_min_workers: filters.min_workers,
  });
  revalidatePath(findEmployersPath(defaultLocale, organization.slug));
  if (!error) return {};
  if (error.message === "CHARA_FEATURE_NOT_IN_PLAN") return { message: "Saved searches are available on Professional and Enterprise." };
  if (error.message === "CHARA_INVALID_INPUT") return { message: "Choose the filters from the lists to save a search." };
  if (error.message === "CHARA_NOT_FOUND") return { message: RELEASE_OFF };
  return { message: faultMessage(logFault("Saved search", error)) };
}

// Deletes a saved search of the company slug; any member may, whatever the plan.
export async function deleteSavedSearch(slug: string, savedSearchId: string): Promise<SavedSearchResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const id = idSchema.safeParse(savedSearchId);
  if (!parsedSlug.success || !id.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_job_orders"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", { mfa: false, hideFromOutsiders: true, partner: true });

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_saved_search", { p_org: organization.id, p_id: id.data });
  revalidatePath(findEmployersPath(defaultLocale, organization.slug));
  if (!error) return {};
  if (error.message === "CHARA_NOT_FOUND") return { message: "This saved search was already deleted." };
  return { message: faultMessage(logFault("Saved search deletion", error)) };
}
