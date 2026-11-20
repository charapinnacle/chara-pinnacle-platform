import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

type Enums = Database["public"]["Enums"];

export type Passport = {
  firstName: string;
  lastName: string;
  headline: string | null;
  country: string;
  occupationId: string | null;
  yearsExperience: number | null;
  availability: Enums["worker_availability"] | null;
  availableFrom: string | null;
  skills: { id: string; name: string }[];
  languages: { code: string; level: Enums["cefr_level"] }[];
  preferredCountries: string[];
  authorizations: { country: string; expiresOn: string | null }[];
  training: { id: string; course: string; provider: string | null; yearCompleted: number }[];
  employmentHistory: {
    id: string;
    role: string;
    employerName: string | null;
    country: string;
    fromMonth: string;
    toMonth: string | null;
  }[];
  preferredIndustries: string[];
  preferredEmploymentTypes: Enums["employment_type"][];
};

// One request reads the profile with its eight lists. Each list is bounded by the database (30 skills, 15 languages,
// 20 preferred countries, one authorisation per country, 20 training and 20 employment entries, 10 industries, the five
// employment types), so the embedded rows stay small. Months come back as YYYY-MM.
export const getPassport = cache(async (userId: string): Promise<Passport | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worker_profiles")
    .select(
      `first_name, last_name, headline, current_country, occupation_id, years_experience, availability, available_from,
       worker_skills(id, skill), worker_languages(language_code, cefr_level),
       worker_preferred_countries(country_code), worker_work_authorizations(country_code, expires_on),
       worker_training(id, course, provider, year_completed),
       worker_employment_history(id, role, employer_name, country_code, from_month, to_month),
       worker_preferred_industries(industry_code), worker_preferred_employment_types(employment_type)`,
    )
    .eq("user_id", userId)
    .order("skill", { referencedTable: "worker_skills" })
    .order("language_code", { referencedTable: "worker_languages" })
    .order("country_code", { referencedTable: "worker_preferred_countries" })
    .order("country_code", { referencedTable: "worker_work_authorizations" })
    .order("year_completed", { referencedTable: "worker_training", ascending: false })
    .order("from_month", { referencedTable: "worker_employment_history", ascending: false })
    .order("industry_code", { referencedTable: "worker_preferred_industries" })
    .order("employment_type", { referencedTable: "worker_preferred_employment_types" })
    .maybeSingle();
  if (error) throw new Error("The passport could not be loaded", { cause: error });
  if (!data) return null;
  return {
    firstName: data.first_name,
    lastName: data.last_name,
    headline: data.headline,
    country: data.current_country,
    occupationId: data.occupation_id,
    yearsExperience: data.years_experience,
    availability: data.availability,
    availableFrom: data.available_from,
    skills: data.worker_skills.map(({ id, skill }) => ({ id, name: skill })),
    languages: data.worker_languages.map(({ language_code, cefr_level }) => ({ code: language_code, level: cefr_level })),
    preferredCountries: data.worker_preferred_countries.map(({ country_code }) => country_code),
    authorizations: data.worker_work_authorizations.map(({ country_code, expires_on }) => ({
      country: country_code,
      expiresOn: expires_on,
    })),
    training: data.worker_training.map(({ id, course, provider, year_completed }) => ({
      id,
      course,
      provider,
      yearCompleted: year_completed,
    })),
    employmentHistory: data.worker_employment_history.map(({ id, role, employer_name, country_code, from_month, to_month }) => ({
      id,
      role,
      employerName: employer_name,
      country: country_code,
      fromMonth: from_month.slice(0, 7),
      toMonth: to_month === null ? null : to_month.slice(0, 7),
    })),
    preferredIndustries: data.worker_preferred_industries.map(({ industry_code }) => industry_code),
    preferredEmploymentTypes: data.worker_preferred_employment_types.map(({ employment_type }) => employment_type),
  };
});

export type PassportLimits = {
  skillsMax: number;
  availabilityWindowMonths: number;
  authorizationExpiryYears: number;
  trainingMax: number;
  employmentHistoryMax: number;
  preferredIndustriesMax: number;
};

// The owner-set list limits and date windows (settings in the database), so the forms quote and check the same values
// the triggers enforce.
export const getPassportLimits = cache(async (): Promise<PassportLimits> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("passport_limits").single();
  if (error) throw new Error("The passport limits could not be loaded", { cause: error });
  return {
    skillsMax: data.skills_max,
    availabilityWindowMonths: data.availability_window_months,
    authorizationExpiryYears: data.work_authorization_expiry_max_years,
    trainingMax: data.training_max,
    employmentHistoryMax: data.employment_history_max,
    preferredIndustriesMax: data.preferred_industries_max,
  };
});
