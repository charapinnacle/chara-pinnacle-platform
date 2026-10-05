"use server";

import type { Database } from "@chara-pinnacle/db-types";
import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { requireUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { homePath } from "@/lib/routes";
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

export type PassportResult = { errors?: FieldErrors; message?: string };

const ALREADY_ADDED = "This is already in your passport.";
const CHECK_VALUES = "Check the values and try again.";
const DATE_REFUSED = "Choose today or a later date that is not too far ahead.";
const limitMessages: Record<string, string> = {
  worker_skills: "You have reached the limit for skills in your passport.",
  worker_languages: "You have reached the limit for languages in your passport.",
  worker_preferred_countries: "You have reached the limit for preferred countries in your passport.",
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
  console.error("Passport action failed", { code: error.code, message: error.message });
  return { message: GENERIC_FAILURE };
}

function settle(error: PostgrestError | null): PassportResult {
  if (error) return refusal(error);
  revalidatePath(`/${defaultLocale}/passport`);
  revalidatePath(homePath(defaultLocale, "worker"));
  return {};
}

export async function createPassport(input: CreatePassportInput): Promise<PassportResult | undefined> {
  await requireUser(defaultLocale);
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
  redirect(homePath(defaultLocale, "worker"));
}

type ProfileUpdate = Database["public"]["Tables"]["worker_profiles"]["Update"];

async function updateProfile(values: ProfileUpdate): Promise<PassportResult> {
  const { id } = await requireUser(defaultLocale);
  const supabase = await createClient();
  const { data, error } = await supabase.from("worker_profiles").update(values).eq("user_id", id).select("user_id");
  if (error) return refusal(error);
  if (data.length === 0) return { message: GENERIC_FAILURE };
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
