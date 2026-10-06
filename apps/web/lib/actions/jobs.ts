"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { requireOrgRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { statusLabels } from "@/lib/jobs/presentation";
import { jobPath, jobsPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { jobFormSchema, jobIdSchema, toJobInsert, type JobFormInput } from "@/lib/validation/job";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

type JobActionResult = { errors?: FieldErrors; message?: string };

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

type Client = Awaited<ReturnType<typeof createClient>>;

function refusal(error: PostgrestError): JobActionResult {
  const constraint = /constraint "([^"]+)"/.exec(error.message)?.[1];
  const known = constraint ? fieldByConstraint[constraint] : undefined;
  if (known) return { errors: { [known[0]]: known[1] } };
  if (error.code === "42501") return { message: NOT_ALLOWED };
  console.error("Create vacancy failed", { code: error.code, message: error.message });
  return { message: GENERIC_FAILURE };
}

const fieldNamesSchema = z.array(jobFormSchema.keyof()).min(1);

// Feeds the validation error rate of FR-C1 with the names of the fields at fault. Best effort: a failure to record it
// never reaches the person filling the form.
async function recordInvalidForm(supabase: Client, organizationId: string, fields: string[]): Promise<void> {
  const names = fieldNamesSchema.safeParse(fields);
  if (!names.success) return;
  const { error } = await supabase.rpc("record_job_form_invalid", {
    p_org: organizationId,
    p_fields: [...new Set(names.data)],
  });
  if (error) console.error("Recording the refused vacancy form failed", { code: error.code, message: error.message });
}

// The organization comes from the slug in the address, checked against the caller's membership and role on every call;
// nothing about the organization, the status or the author is read from the form.
export async function createJob(slug: string, input: JobFormInput): Promise<JobActionResult | undefined> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return { message: GENERIC_FAILURE };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", {
    mfa: false,
    hideFromOutsiders: true,
  });
  const supabase = await createClient();
  const parsed = jobFormSchema.safeParse(input);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    await recordInvalidForm(supabase, organization.id, Object.keys(errors));
    return { errors };
  }

  const { data, error } = await supabase
    .from("jobs")
    .insert(toJobInsert(parsed.data, organization.id))
    .select("id")
    .single();
  if (error) {
    const result = refusal(error);
    if (result.errors) await recordInvalidForm(supabase, organization.id, Object.keys(result.errors));
    return result;
  }
  redirect(jobPath(defaultLocale, organization.slug, data.id));
}

// Reports a form that was refused in the browser; the server records its own refusals in createJob.
export async function reportInvalidJobForm(slug: string, fields: string[]): Promise<void> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return;
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", {
    mfa: false,
    hideFromOutsiders: true,
  });
  await recordInvalidForm(await createClient(), organization.id, fields);
}

const statusChangeSchema = z.object({ id: jobIdSchema, to: z.enum(["open", "paused", "closed", "filled"]) });

const CHANGED_ELSEWHERE = "This vacancy was changed by someone else, reload.";

// The database guard decides which change is allowed; a refusal as an invalid transition means another person moved the
// vacancy since this page was loaded, so the message names the status it has now.
async function statusRefusal(
  error: PostgrestError,
  supabase: Client,
  organizationId: string,
  id: string,
): Promise<JobActionResult> {
  if (error.message === "CHARA_INVALID_TRANSITION") {
    const { data } = await supabase.from("jobs").select("status").eq("id", id).eq("organization_id", organizationId).maybeSingle();
    return { message: data ? `${CHANGED_ELSEWHERE} It is now ${statusLabels[data.status]}.` : CHANGED_ELSEWHERE };
  }
  if (error.code === "42501") return { message: "You are not allowed to change the status of this vacancy." };
  console.error("Change vacancy status failed", { code: error.code, message: error.message });
  return { message: GENERIC_FAILURE };
}

// The organization comes from the slug and the caller's role as for createJob; only the target status is read from the
// call, and the guard in the database checks it against the status the vacancy has now.
export async function changeJobStatus(
  slug: string,
  id: string,
  to: z.input<typeof statusChangeSchema>["to"],
): Promise<JobActionResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsed = statusChangeSchema.safeParse({ id, to });
  if (!parsedSlug.success || !parsed.success) return { message: GENERIC_FAILURE };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", {
    mfa: false,
    hideFromOutsiders: true,
  });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .update({ status: parsed.data.to })
    .eq("id", parsed.data.id)
    .eq("organization_id", organization.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  const result = error
    ? await statusRefusal(error, supabase, organization.id, parsed.data.id)
    : data
      ? {}
      : { message: "This vacancy could not be found." };
  revalidatePath(jobsPath(defaultLocale, organization.slug));
  revalidatePath(jobPath(defaultLocale, organization.slug, parsed.data.id));
  return result;
}
