"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { z } from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { requireOrgRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { jobPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { jobFormSchema, toJobInsert, type JobFormInput } from "@/lib/validation/job";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

export type CreateJobResult = { errors?: FieldErrors; message?: string };

const CHECK_VALUE = "Check this value.";
const NOT_ALLOWED = "You are not allowed to create vacancies for this company.";

// The constraints a value the schema let through can still fail, each with the field it belongs to.
const fieldByConstraint: Record<string, [field: keyof JobFormInput, message: string]> = {
  jobs_title_check: ["title", CHECK_VALUE],
  jobs_description_check: ["description", CHECK_VALUE],
  jobs_city_check: ["city", CHECK_VALUE],
  jobs_occupation_id_fkey: ["occupation", "Select an occupation from the list."],
  jobs_industry_code_fkey: ["industry", "Select an industry from the list."],
  jobs_country_code_fkey: ["country", "Select a country from the list."],
  jobs_salary_currency_fkey: ["salaryCurrency", "Select a currency from the list."],
  jobs_salary_min_check: ["salaryMin", CHECK_VALUE],
  jobs_salary_max_check: ["salaryMax", CHECK_VALUE],
  jobs_salary_order: ["salaryMin", "The minimum salary cannot be higher than the maximum."],
  jobs_salary_terms: ["salaryCurrency", "Select a currency and a pay period when you enter a salary."],
};

function refusal(error: PostgrestError): CreateJobResult {
  const constraint = /constraint "([^"]+)"/.exec(error.message)?.[1];
  const known = constraint ? fieldByConstraint[constraint] : undefined;
  if (known) return { errors: { [known[0]]: known[1] } };
  if (error.code === "42501") return { message: NOT_ALLOWED };
  console.error("Create vacancy failed", { code: error.code, message: error.message });
  return { message: GENERIC_FAILURE };
}

// The organization comes from the slug in the address, checked against the caller's membership and role on every call;
// nothing about the organization, the status or the author is read from the form.
export async function createJob(slug: string, input: JobFormInput): Promise<CreateJobResult | undefined> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return { message: GENERIC_FAILURE };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", {
    mfa: false,
    hideFromOutsiders: true,
  });
  const parsed = jobFormSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .insert(toJobInsert(parsed.data, organization.id))
    .select("id")
    .single();
  if (error) return refusal(error);
  redirect(jobPath(defaultLocale, organization.slug, data.id));
}

const fieldNamesSchema = z.array(z.string().regex(/^[A-Za-z]{1,40}$/)).min(1).max(20);

// Reports a form that was refused in the browser, with the names of the fields at fault, for the validation error rate
// of FR-C1. The call is best effort: a failure to record it never reaches the person filling the form.
export async function reportInvalidJobForm(slug: string, fields: string[]): Promise<void> {
  const parsedSlug = slugSchema.safeParse(slug);
  const names = fieldNamesSchema.safeParse(fields);
  if (!parsedSlug.success || !names.success) return;
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", {
    mfa: false,
    hideFromOutsiders: true,
  });
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_job_form_invalid", {
    p_org: organization.id,
    p_fields: [...new Set(names.data)],
  });
  if (error) console.error("Recording the refused vacancy form failed", { code: error.code, message: error.message });
}
