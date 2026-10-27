"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { featurePlanName, limitRefusalMessage, type UsagePrompt } from "@/lib/billing/limits";
import { listPublicPlans } from "@/lib/dal/pricing";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { getUsagePrompts } from "@/lib/dal/usage";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { reportQuotaRefused } from "@/lib/quota-refused";
import { ACTIVE_REQUIREMENTS, MULTI_COUNTRY_FEATURE, multiCountryText } from "@/lib/requirements/limits";
import { lifecycleRefusal, REQUIREMENT_MESSAGES, requirementRefusal, vacanciesRefusal } from "@/lib/requirements/refusal";
import { jobsPath, requirementPath, requirementsPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import {
  requirementFormSchema,
  requirementIdSchema,
  toRequirementArgs,
  type RequirementFormInput,
} from "@/lib/validation/requirement";
import {
  publishFormSchema,
  requirementTargetSchema,
  statusChangeSchema,
  type PublishFormInput,
  type RequirementTarget as LifecycleTarget,
  type StatusChange,
} from "@/lib/validation/requirement-status";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

export type RequirementResult = { errors?: FieldErrors; message?: string; savedHref?: string };

// The requirement a save changes, with the version (updated_at) the form was loaded with.
const targetSchema = z.object({ id: requirementIdSchema, expectedUpdatedAt: z.iso.datetime({ offset: true }) });
type RequirementTarget = z.input<typeof targetSchema>;

// An error of the occupation list as a whole (none, too many, quantities that do not add up) belongs to the list, which
// the form shows under its rows; an error of one row keeps its path.
function formErrors(errors: FieldErrors): FieldErrors {
  return Object.fromEntries(Object.entries(errors).map(([key, message]) => [key === "occupations" ? "occupations.root" : key, message]));
}

// The first public plan with several destinations, for the prompt; a failed read names no plan.
async function multiCountryPlanName(): Promise<string | null> {
  return featurePlanName(await listPublicPlans("employer").catch(() => []), MULTI_COUNTRY_FEATURE);
}

// Creates a draft (target null) or saves the changes of one (FR-M1 AC1, AC3 to AC8, AC12). The organisation comes from
// the slug, the caller an owner or admin at aal2 (requireOrgRole sends an aal1 session to two-step verification);
// save_requirement checks all of it again, with the wording, the quantities, the code lists and the version.
export async function saveRequirement(
  slug: string,
  target: RequirementTarget | null,
  input: RequirementFormInput,
): Promise<RequirementResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedTarget = target === null ? null : targetSchema.safeParse(target);
  if (!parsedSlug.success || (parsedTarget && !parsedTarget.success)) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_job_orders"))) return { message: REQUIREMENT_MESSAGES.releaseOff };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", { hideFromOutsiders: true });

  const parsed = requirementFormSchema().safeParse(input);
  if (!parsed.success) return { errors: formErrors(fieldErrors(parsed.error)) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_requirement", {
    p_org: organization.id,
    p_requirement: parsedTarget?.data?.id,
    p_expected_updated_at: parsedTarget?.data?.expectedUpdatedAt,
    ...toRequirementArgs(parsed.data),
  });
  if (error) {
    const refusal = requirementRefusal(error);
    if (refusal.kind === "field") return { errors: { [refusal.field]: refusal.message } };
    if (refusal.kind === "feature") return { errors: { "destinations.root": multiCountryText(await multiCountryPlanName()) } };
    if (refusal.kind === "message") {
      if (error.message === "CHARA_RATE_LIMITED") reportQuotaRefused("audited_write", "requirement");
      return { message: refusal.message };
    }
    return { message: faultMessage(logFault("Saving the workforce requirement", error)) };
  }
  revalidatePath(requirementsPath(defaultLocale, organization.slug));
  revalidatePath(requirementPath(defaultLocale, organization.slug, data));
  return { savedHref: requirementPath(defaultLocale, organization.slug, data) };
}

// limitReached is the usage the upgrade prompt shows after a refusal at the open-requirements limit; multiCountry names
// the plan with several destinations after a refusal of a requirement that has more than one (FR-M4 AC9).
export type RequirementStatusResult = {
  message?: string;
  errors?: FieldErrors;
  done?: boolean;
  limitReached?: UsagePrompt;
  multiCountry?: { planName: string | null };
};

// Read after the refusal, so the prompt shows what another admin's publish left behind; without the usage the refusal
// is said in words.
async function limitResult(organizationId: string): Promise<RequirementStatusResult> {
  const prompts = await getUsagePrompts(organizationId, "employer", [ACTIVE_REQUIREMENTS]).catch(() => null);
  const prompt = prompts?.[ACTIVE_REQUIREMENTS];
  return prompt ? { limitReached: prompt } : { message: limitRefusalMessage(ACTIVE_REQUIREMENTS, "employer") };
}

type LifecycleCall = (organizationId: string, target: { id: string; expectedUpdatedAt: string }) => PromiseLike<{
  error: { code?: string; message: string; details?: string | null } | null;
}>;

// The status actions of the requirement page (FR-M2 AC1, AC7, AC10, AC12): an owner or admin at aal2 of the organisation
// of the address, while release 2b is on; the function checks all of it again, with the transition and the version the
// page was drawn with (a page that is out of date gets the stale message and is drawn again).
async function runLifecycle(slug: string, target: LifecycleTarget, what: string, call: LifecycleCall): Promise<RequirementStatusResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedTarget = requirementTargetSchema.safeParse(target);
  if (!parsedSlug.success || !parsedTarget.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_job_orders"))) return { message: REQUIREMENT_MESSAGES.releaseOff };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", { hideFromOutsiders: true });

  const { error } = await call(organization.id, parsedTarget.data);
  revalidatePath(requirementsPath(defaultLocale, organization.slug));
  revalidatePath(requirementPath(defaultLocale, organization.slug, parsedTarget.data.id));
  if (!error) return { done: true };
  const refusal = lifecycleRefusal(error);
  if (refusal.kind === "limit") return limitResult(organization.id);
  if (refusal.kind === "feature") return { multiCountry: { planName: await multiCountryPlanName() } };
  if (refusal.kind === "message") {
    if (error.message === "CHARA_RATE_LIMITED") reportQuotaRefused("audited_write", "requirement");
    return { message: refusal.message };
  }
  return { message: faultMessage(logFault(what, error)) };
}

export async function publishRequirement(slug: string, target: LifecycleTarget, input: PublishFormInput): Promise<RequirementStatusResult> {
  const parsed = publishFormSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  return runLifecycle(slug, target, "Publishing the workforce requirement", (organizationId, { id, expectedUpdatedAt }) =>
    supabase.rpc("publish_requirement", {
      p_org: organizationId,
      p_requirement: id,
      p_visibility: parsed.data.visibility,
      p_show_identity: parsed.data.visibility === "job_order_marketplace" && parsed.data.showIdentity,
      p_expected_updated_at: expectedUpdatedAt,
    }),
  );
}

export async function changeRequirementStatus(slug: string, target: LifecycleTarget, change: StatusChange): Promise<RequirementStatusResult> {
  const parsed = statusChangeSchema.safeParse(change);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const supabase = await createClient();
  return runLifecycle(slug, target, "Changing the status of the workforce requirement", (organizationId, { id, expectedUpdatedAt }) =>
    supabase.rpc("set_requirement_status", {
      p_org: organizationId,
      p_requirement: id,
      p_status: parsed.data.to,
      p_expected_updated_at: expectedUpdatedAt,
      p_close_reason: parsed.data.to === "closed" ? parsed.data.reason : undefined,
    }),
  );
}

export async function extendRequirement(slug: string, target: LifecycleTarget): Promise<RequirementStatusResult> {
  const supabase = await createClient();
  return runLifecycle(slug, target, "Extending the workforce requirement", (organizationId, { id, expectedUpdatedAt }) =>
    supabase.rpc("extend_requirement", { p_org: organizationId, p_requirement: id, p_expected_updated_at: expectedUpdatedAt }),
  );
}

export type RequirementVacanciesResult = { message?: string; created?: number };

const linkedCountSchema = z.number().int().min(0);

// "Create vacancies for direct applications" (FR-M1 step Next steps, AC10): one draft vacancy per occupation of an open
// requirement, for an owner or admin at aal2 while release 2b is on; the function checks all of it again, with the
// status, the version the page was drawn with and the number of linked vacancies it showed (expectedLinked), so a
// confirmation given for an older list is refused as stale.
export async function createRequirementVacancies(
  slug: string,
  target: LifecycleTarget,
  expectedLinked: number,
): Promise<RequirementVacanciesResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedTarget = requirementTargetSchema.safeParse(target);
  const parsedLinked = linkedCountSchema.safeParse(expectedLinked);
  if (!parsedSlug.success || !parsedTarget.success || !parsedLinked.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_job_orders"))) return { message: REQUIREMENT_MESSAGES.releaseOff };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", { hideFromOutsiders: true });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_vacancies_from_requirement", {
    p_org: organization.id,
    p_requirement: parsedTarget.data.id,
    p_expected_updated_at: parsedTarget.data.expectedUpdatedAt,
    p_expected_linked: parsedLinked.data,
  });
  revalidatePath(requirementPath(defaultLocale, organization.slug, parsedTarget.data.id));
  if (!error) {
    revalidatePath(jobsPath(defaultLocale, organization.slug));
    return { created: data.length };
  }
  const refusal = vacanciesRefusal(error);
  if (refusal.kind === "message") {
    if (error.message === "CHARA_RATE_LIMITED") reportQuotaRefused("audited_write", "requirement");
    return { message: refusal.message };
  }
  return { message: faultMessage(logFault("Creating vacancies from the workforce requirement", error)) };
}
