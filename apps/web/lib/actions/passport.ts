"use server";

import type { Database } from "@chara-pinnacle/db-types";
import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { refreshAppShell } from "@/lib/app/refresh-shell";
import { requireUser } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { homePath, onboardingPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import {
  authorizationSchema,
  basicsSchema,
  codeSchema,
  createPassportSchema,
  experienceSchema,
  idSchema,
  languageSchema,
  occupationSchema,
  preferredCountrySchema,
  SKILL_DUPLICATE_MESSAGE,
  skillFormSchema,
  type AuthorizationInput,
  type BasicsInput,
  type CreatePassportInput,
  type ExperienceInput,
  type LanguageInput,
  type OccupationInput,
  type PreferredCountryInput,
  type SkillInput,
} from "@/lib/validation/passport";
import {
  employmentSchema,
  employmentTypeSchema,
  industryCodeSchema,
  preferredEmploymentTypeSchema,
  preferredIndustrySchema,
  trainingSchema,
  type EmploymentInput,
  type PreferredEmploymentTypeInput,
  type PreferredIndustryInput,
  type TrainingInput,
} from "@/lib/validation/passport-extensions";
import { rememberWelcome } from "@/lib/welcome-cookie";

export type PassportResult = { errors?: FieldErrors; message?: string };

const ALREADY_ADDED = "This is already in your passport.";
const CHECK_VALUES = "Check the values and try again.";
const DATE_REFUSED = "Choose today or a later date that is not too far ahead.";
const ENTRY_GONE = "This entry is no longer in your passport. Reload the page.";
const limitMessages: Record<string, string> = {
  worker_skills: "You have reached the limit for skills in your passport.",
  worker_languages: "You have reached the limit for languages in your passport.",
  worker_preferred_countries: "You have reached the limit for preferred countries in your passport.",
  worker_training: "You have reached the limit for training entries in your passport.",
  worker_employment_history: "You have reached the limit for employment history entries in your passport.",
  worker_preferred_industries: "You have reached the limit for preferred industries in your passport.",
};
const refusedDates: Record<string, string> = { available_from: "availableFrom", expires_on: "expiresOn" };

// The limits and the date windows are the database's to enforce; a refusal is shown without repeating the number.
function refusal(error: PostgrestError): PassportResult {
  if (error.message === "CHARA_LIMIT_REACHED" && error.details && limitMessages[error.details]) {
    return { message: limitMessages[error.details] };
  }
  if (error.message === "CHARA_INVALID_INPUT" && error.details && refusedDates[error.details]) {
    return { errors: { [refusedDates[error.details]]: DATE_REFUSED } };
  }
  if (error.code === "23505") return { message: ALREADY_ADDED };
  if (error.code === "23514" || error.code === "23503" || error.message === "CHARA_INVALID_INPUT") {
    return { message: CHECK_VALUES };
  }
  return { message: faultMessage(logFault("Passport action", error)) };
}

function settle(error: PostgrestError | null): PassportResult {
  if (error) return refusal(error);
  revalidatePath(`/${defaultLocale}/passport`);
  revalidatePath(homePath(defaultLocale, "worker"));
  return {};
}

export async function createPassport(input: CreatePassportInput): Promise<PassportResult | undefined> {
  const user = await requireUser(defaultLocale);
  const parsed = createPassportSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { firstName, lastName, country } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_worker_passport", {
    p_first_name: firstName,
    p_last_name: lastName,
    p_current_country: country,
    p_preferred_lang: defaultLocale,
  });
  // A second submit of the same form finds the passport already created, which is what the person wanted.
  if (error && error.code !== "23505") return refusal(error);
  refreshAppShell();
  await rememberWelcome(user.id);
  redirect(onboardingPath(defaultLocale, "welcome"));
}

type ProfileUpdate = Database["public"]["Tables"]["worker_profiles"]["Update"];

async function updateProfile(values: ProfileUpdate): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const supabase = await createClient();
  const { data, error } = await supabase.from("worker_profiles").update(values).eq("user_id", id).select("user_id");
  if (error) return refusal(error);
  if (data.length === 0) redirect(onboardingPath(defaultLocale));
  return settle(null);
}

export async function saveBasics(input: BasicsInput): Promise<PassportResult> {
  const parsed = basicsSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { firstName, lastName, headline, country } = parsed.data;
  return updateProfile({ first_name: firstName, last_name: lastName, headline, current_country: country });
}

export async function saveOccupation(input: OccupationInput): Promise<PassportResult> {
  const parsed = occupationSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  return updateProfile({ occupation_id: parsed.data.occupation });
}

export async function saveExperience(input: ExperienceInput): Promise<PassportResult> {
  const parsed = experienceSchema().safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { yearsExperience, availability, availableFrom } = parsed.data;
  return updateProfile({
    years_experience: yearsExperience,
    availability,
    available_from: availableFrom,
  });
}

export async function addSkill(input: SkillInput): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = skillFormSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("worker_skills").insert({ worker_user_id: id, skill: parsed.data.skill });
  if (error?.code === "23505") return { errors: { skill: SKILL_DUPLICATE_MESSAGE } };
  return settle(error);
}

export async function removeSkill(skillId: string): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = idSchema.safeParse(skillId);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const supabase = await createClient();
  return settle((await supabase.from("worker_skills").delete().eq("worker_user_id", id).eq("id", parsed.data)).error);
}

export async function addLanguage(input: LanguageInput): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = languageSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { language, level } = parsed.data;
  return settle(
    (await supabase.from("worker_languages").insert({ worker_user_id: id, language_code: language, cefr_level: level }))
      .error,
  );
}

export async function removeLanguage(code: string): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = codeSchema.safeParse(code);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const supabase = await createClient();
  return settle(
    (await supabase.from("worker_languages").delete().eq("worker_user_id", id).eq("language_code", parsed.data)).error,
  );
}

export async function addPreferredCountry(input: PreferredCountryInput): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = preferredCountrySchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  return settle(
    (await supabase.from("worker_preferred_countries").insert({ worker_user_id: id, country_code: parsed.data.country }))
      .error,
  );
}

export async function removePreferredCountry(code: string): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = codeSchema.safeParse(code);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const supabase = await createClient();
  return settle(
    (await supabase.from("worker_preferred_countries").delete().eq("worker_user_id", id).eq("country_code", parsed.data))
      .error,
  );
}

export async function addAuthorization(input: AuthorizationInput): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = authorizationSchema().safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { country, expiresOn } = parsed.data;
  return settle(
    (await supabase.from("worker_work_authorizations").insert({ worker_user_id: id, country_code: country, expires_on: expiresOn }))
      .error,
  );
}

export async function removeAuthorization(code: string): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = codeSchema.safeParse(code);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const supabase = await createClient();
  return settle(
    (await supabase.from("worker_work_authorizations").delete().eq("worker_user_id", id).eq("country_code", parsed.data))
      .error,
  );
}

export async function addTraining(input: TrainingInput): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = trainingSchema().safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { course, provider, yearCompleted } = parsed.data;
  const supabase = await createClient();
  return settle(
    (await supabase.from("worker_training").insert({ worker_user_id: id, course, provider, year_completed: yearCompleted }))
      .error,
  );
}

export async function updateTraining(entryId: string, input: TrainingInput): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const entry = idSchema.safeParse(entryId);
  if (!entry.success) return { message: GENERIC_FAILURE };
  const parsed = trainingSchema().safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { course, provider, yearCompleted } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worker_training")
    .update({ course, provider, year_completed: yearCompleted })
    .eq("worker_user_id", id)
    .eq("id", entry.data)
    .select("id");
  if (error) return refusal(error);
  if (data.length === 0) return { message: ENTRY_GONE };
  return settle(null);
}

export async function removeTraining(entryId: string): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = idSchema.safeParse(entryId);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const supabase = await createClient();
  return settle((await supabase.from("worker_training").delete().eq("worker_user_id", id).eq("id", parsed.data)).error);
}

export async function addEmployment(input: EmploymentInput): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = employmentSchema().safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { role, employerName, country, fromMonth, toMonth } = parsed.data;
  const supabase = await createClient();
  return settle(
    (
      await supabase.from("worker_employment_history").insert({
        worker_user_id: id,
        role,
        employer_name: employerName,
        country_code: country,
        from_month: fromMonth,
        to_month: toMonth,
      })
    ).error,
  );
}

export async function updateEmployment(entryId: string, input: EmploymentInput): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const entry = idSchema.safeParse(entryId);
  if (!entry.success) return { message: GENERIC_FAILURE };
  const parsed = employmentSchema().safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { role, employerName, country, fromMonth, toMonth } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worker_employment_history")
    .update({ role, employer_name: employerName, country_code: country, from_month: fromMonth, to_month: toMonth })
    .eq("worker_user_id", id)
    .eq("id", entry.data)
    .select("id");
  if (error) return refusal(error);
  if (data.length === 0) return { message: ENTRY_GONE };
  return settle(null);
}

export async function removeEmployment(entryId: string): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = idSchema.safeParse(entryId);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const supabase = await createClient();
  return settle(
    (await supabase.from("worker_employment_history").delete().eq("worker_user_id", id).eq("id", parsed.data)).error,
  );
}

export async function addPreferredIndustry(input: PreferredIndustryInput): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = preferredIndustrySchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  return settle(
    (await supabase.from("worker_preferred_industries").insert({ worker_user_id: id, industry_code: parsed.data.industry }))
      .error,
  );
}

export async function removePreferredIndustry(code: string): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = industryCodeSchema.safeParse(code);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const supabase = await createClient();
  return settle(
    (await supabase.from("worker_preferred_industries").delete().eq("worker_user_id", id).eq("industry_code", parsed.data))
      .error,
  );
}

export async function addPreferredEmploymentType(input: PreferredEmploymentTypeInput): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = preferredEmploymentTypeSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  return settle(
    (
      await supabase
        .from("worker_preferred_employment_types")
        .insert({ worker_user_id: id, employment_type: parsed.data.employmentType })
    ).error,
  );
}

export async function removePreferredEmploymentType(type: string): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const parsed = employmentTypeSchema.safeParse(type);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const supabase = await createClient();
  return settle(
    (
      await supabase
        .from("worker_preferred_employment_types")
        .delete()
        .eq("worker_user_id", id)
        .eq("employment_type", parsed.data)
    ).error,
  );
}
