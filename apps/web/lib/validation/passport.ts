import type { Database } from "@chara-pinnacle/db-types";
import { z } from "zod";

type Enums = Database["public"]["Enums"];

// The limits and windows below mirror the database (constraints and the settings worker_*_max,
// availability_window_months and work_authorization_expiry_max_years); the database is the authority.
const MAX_NAME_LENGTH = 80;
const MAX_HEADLINE_LENGTH = 120;
const MAX_YEARS_EXPERIENCE = 60;
const MAX_SKILLS = 30;
const MAX_SKILL_LENGTH = 50;
export const MAX_LANGUAGES = 15;
export const MAX_PREFERRED_COUNTRIES = 20;
const AVAILABILITY_WINDOW_MONTHS = 24;
const AUTHORIZATION_EXPIRY_MAX_YEARS = 50;

export const SKILL_LIMIT_MESSAGE = `You can add up to ${MAX_SKILLS} skills`;

const cefrLevels = ["A1", "A2", "B1", "B2", "C1", "C2"] as const satisfies readonly Enums["cefr_level"][];
const availabilityValues = ["now", "from_date", "unavailable"] as const satisfies readonly Enums["worker_availability"][];

export const cefrOptions = [
  { value: "A1", label: "A1 (beginner)" },
  { value: "A2", label: "A2 (elementary)" },
  { value: "B1", label: "B1 (intermediate)" },
  { value: "B2", label: "B2 (upper intermediate)" },
  { value: "C1", label: "C1 (advanced)" },
  { value: "C2", label: "C2 (proficient)" },
] as const satisfies readonly { value: (typeof cefrLevels)[number]; label: string }[];

export const availabilityOptions = [
  { value: "now", label: "Available now" },
  { value: "from_date", label: "From a date" },
  { value: "unavailable", label: "Not available" },
] as const satisfies readonly { value: (typeof availabilityValues)[number]; label: string }[];

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$/u;
const CONTROL_CHARACTER = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function personName(label: string) {
  return z
    .string({ error: `Enter your ${label.toLowerCase()}.` })
    .trim()
    .min(1, { error: `Enter your ${label.toLowerCase()}.` })
    .max(MAX_NAME_LENGTH, { error: `${label} must be ${MAX_NAME_LENGTH} characters or fewer.` })
    .regex(NAME_PATTERN, {
      error: `${label} can only contain letters, spaces, hyphens, apostrophes and full stops.`,
    });
}

const firstNameSchema = personName("First name");
const lastNameSchema = personName("Last name");

const headlineText = z
  .string()
  .trim()
  .max(MAX_HEADLINE_LENGTH, { error: `Headline must be ${MAX_HEADLINE_LENGTH} characters or fewer.` })
  .refine((value) => !CONTROL_CHARACTER.test(value), { error: "Headline must be one line of plain text." });

const YEARS_MESSAGE = `Enter a whole number from 0 to ${MAX_YEARS_EXPERIENCE}.`;

const yearsText = z
  .string({ error: YEARS_MESSAGE })
  .trim()
  .refine((value) => value === "" || (/^\d+$/.test(value) && Number(value) <= MAX_YEARS_EXPERIENCE), {
    error: YEARS_MESSAGE,
  });

const countryCodeSchema = z
  .string({ error: "Choose a country." })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { error: "Choose a country." });

export const createPassportSchema = z.object({
  firstName: firstNameSchema,
  lastName: lastNameSchema,
  country: countryCodeSchema,
});

export const basicsFormSchema = createPassportSchema.extend({ headline: headlineText });
export const basicsSchema = basicsFormSchema.transform((value) => ({ ...value, headline: value.headline === "" ? null : value.headline }));

export const occupationFormSchema = z.object({
  occupation: z
    .string({ error: "Choose an occupation from the list." })
    .trim()
    .regex(/^(\d{4})?$/, { error: "Choose an occupation from the list." }),
});
export const occupationSchema = occupationFormSchema.transform(({ occupation }) => ({
  occupation: occupation === "" ? null : occupation,
}));

export type CreatePassportInput = z.input<typeof createPassportSchema>;
export type BasicsInput = z.input<typeof basicsFormSchema>;
export type OccupationInput = z.input<typeof occupationFormSchema>;

const skillTextSchema = z
  .string({ error: "Enter a skill." })
  .trim()
  .min(1, { error: "Enter a skill." })
  .max(MAX_SKILL_LENGTH, { error: `A skill can have up to ${MAX_SKILL_LENGTH} characters.` })
  .refine((value) => !CONTROL_CHARACTER.test(value), { error: "A skill cannot contain control characters." });

type SkillResult =
  | { status: "added"; skill: string }
  | { status: "duplicate" }
  | { status: "refused"; message: string };

// A skill already in the list under any letter case is ignored, not refused; the list holds at most MAX_SKILLS tags.
export function validateSkill(existing: readonly string[], input: string): SkillResult {
  const parsed = skillTextSchema.safeParse(input);
  if (!parsed.success) return { status: "refused", message: parsed.error.issues[0].message };
  const key = parsed.data.toLowerCase();
  if (existing.some((skill) => skill.toLowerCase() === key)) return { status: "duplicate" };
  if (existing.length >= MAX_SKILLS) return { status: "refused", message: SKILL_LIMIT_MESSAGE };
  return { status: "added", skill: parsed.data };
}

export const skillFormSchema = z.object({ skill: skillTextSchema });
export type SkillInput = z.input<typeof skillFormSchema>;

const languageCode = z
  .string({ error: "Choose a language." })
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}$/, { error: "Choose a language." });
const LEVEL_MESSAGE = "Choose a level.";

export const languageFormSchema = z.object({
  language: languageCode,
  level: z.string({ error: LEVEL_MESSAGE }).refine((value) => cefrLevels.some((level) => level === value), { error: LEVEL_MESSAGE }),
});
export const languageSchema = z.object({ language: languageCode, level: z.enum(cefrLevels, { error: LEVEL_MESSAGE }) });
export type LanguageInput = z.input<typeof languageFormSchema>;

export const preferredCountrySchema = z.object({ country: countryCodeSchema });
export type PreferredCountryInput = z.input<typeof preferredCountrySchema>;

export const idSchema = z.uuid();
export const codeSchema = z.string().regex(/^[A-Za-z]{2}$/);

function parseDate(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

// PostgreSQL clamps to the last day of the month (2028-02-29 plus 24 months is 2030-02-28); so does this.
function addMonthsUtc(date: Date, months: number): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateWithin(value: string, today: string, months: number): boolean {
  const date = parseDate(value);
  const first = parseDate(today);
  return date !== null && first !== null && date >= first && date <= addMonthsUtc(first, months);
}

const availabilityChoice = z.enum(["", ...availabilityValues], { error: "Choose your availability." });

// Availability and the date it starts: from_date needs a date from today to 24 months ahead (UTC), the other values
// carry none. The empty availability keeps the field unset.
export function experienceFormSchema(today: string = todayUtc()) {
  return z
    .object({
      yearsExperience: yearsText,
      availability: availabilityChoice,
      availableFrom: z.string().trim(),
    })
    .check((context) => {
      const { availability, availableFrom } = context.value;
      if (availability === "from_date" && !dateWithin(availableFrom, today, AVAILABILITY_WINDOW_MONTHS)) {
        context.issues.push({
          code: "custom",
          input: availableFrom,
          path: ["availableFrom"],
          message: `Choose a date from today to ${AVAILABILITY_WINDOW_MONTHS} months ahead.`,
        });
      }
    });
}

export function experienceSchema(today: string = todayUtc()) {
  return experienceFormSchema(today).transform((value) => ({
    yearsExperience: value.yearsExperience === "" ? null : Number(value.yearsExperience),
    availability: value.availability === "" ? null : value.availability,
    availableFrom: value.availability === "from_date" ? value.availableFrom : null,
  }));
}
export type ExperienceInput = z.input<ReturnType<typeof experienceFormSchema>>;

// An authorisation may have no expiry date; one that is given is not in the past and not more than 50 years ahead.
export function authorizationFormSchema(today: string = todayUtc()) {
  return z
    .object({
      country: countryCodeSchema,
      expiresOn: z.string().trim(),
    })
    .check((context) => {
      const { expiresOn } = context.value;
      if (expiresOn !== "" && !dateWithin(expiresOn, today, AUTHORIZATION_EXPIRY_MAX_YEARS * 12)) {
        context.issues.push({
          code: "custom",
          input: expiresOn,
          path: ["expiresOn"],
          message: "Choose today or a later date, up to 50 years ahead.",
        });
      }
    });
}

export function authorizationSchema(today: string = todayUtc()) {
  return authorizationFormSchema(today).transform((value) => ({
    country: value.country,
    expiresOn: value.expiresOn === "" ? null : value.expiresOn,
  }));
}
export type AuthorizationInput = z.input<ReturnType<typeof authorizationFormSchema>>;
