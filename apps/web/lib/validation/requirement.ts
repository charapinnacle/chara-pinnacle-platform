import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { formatCount } from "@/lib/i18n/format";
import { ADDITIONAL_COUNTRIES_MAX } from "@/lib/requirements/limits";
import { characters } from "@/lib/utils";
import {
  amountField,
  CONTROL_CHARACTER,
  employmentTypes,
  LINE_BREAKS_AND_TABS,
  NO_CONTROL_CHARACTERS,
  recruitmentPreferences,
  salaryIssues,
  salaryPeriods,
} from "@/lib/validation/job";
import { dateWithin, parseDate, todayUtc } from "@/lib/validation/passport";

type SaveArgs = Database["public"]["Functions"]["save_requirement"]["Args"];

// The arguments the form decides. The organisation comes from the address, the requirement id from the page; status,
// visibility, created_by and the dates of publishing are no arguments of save_requirement at all, so the mapper cannot
// carry them (FR-M1 AC2).
export type RequirementArgs = Omit<SaveArgs, "p_org" | "p_requirement">;

// The same bounds as the checks of workforce_requirements and save_requirement; the database stays the authority.
export const WORKERS_MAX = 100_000;
export const OCCUPATIONS_MAX = 10;
const SKILLS_MAX = 1_000;
const CITY_MAX = 100;
const TITLE_MAX = 120;
const EXPERIENCE_MAX = 50;
const DURATION_MAX = 120;
const START_MONTHS_AHEAD = 36;

export const partnerNeeds = ["none", "recruitment", "staffing", "both"] as const;
export type PartnerNeed = (typeof partnerNeeds)[number];

export const partnerNeedLabels: Record<PartnerNeed, string> = {
  none: "No, we do not need partners",
  recruitment: "Yes, recruitment companies",
  staffing: "Yes, staffing companies",
  both: "Yes, recruitment and staffing companies",
};

export const partnerNeedOptions = partnerNeeds.map((value) => ({ value, label: partnerNeedLabels[value] }));

export const PROHIBITED_CRITERION =
  "Requirements may not ask for gender, age, nationality or other personal characteristics.";

function wholeNumber(value: string, min: number, max: number): boolean {
  return /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
}

function rangeMessage(min: number, max: number): string {
  return `Enter a whole number from ${formatCount(min)} to ${formatCount(max)}.`;
}

function optionalNumber(min: number, max: number) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || wholeNumber(value, min, max), { error: rangeMessage(min, max) });
}

function text(max: number, label: string, { lineBreaks = false } = {}) {
  return z
    .string()
    .trim()
    .refine((value) => characters(value) <= max, { error: `The ${label} must have ${formatCount(max)} characters or fewer.` })
    .refine((value) => !CONTROL_CHARACTER.test(lineBreaks ? value.replace(LINE_BREAKS_AND_TABS, "") : value), {
      error: NO_CONTROL_CHARACTERS,
    });
}

const occupationRowSchema = z.object({
  occupation: z
    .string({ error: "Select an occupation from the list." })
    .trim()
    .regex(/^\d{4}$/, { error: "Select an occupation from the list." }),
  quantity: z
    .string({ error: "Enter how many workers of this occupation you need." })
    .trim()
    .min(1, { error: "Enter how many workers of this occupation you need.", abort: true })
    .refine((value) => wholeNumber(value, 1, WORKERS_MAX), { error: rangeMessage(1, WORKERS_MAX) }),
});

const destinationRowSchema = z.object({
  country: z
    .string({ error: "Select a country from the list." })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, { error: "Select a country from the list." }),
});

// The form's own schema: numbers stay strings so the form can use it as its resolver; toRequirementArgs converts them.
// Keys the form does not own, such as status, created_by, organization_id or published_at, are dropped by the parse.
// today is the UTC date the start date is compared with, as save_requirement compares it.
export function requirementFormSchema(today: string = todayUtc()) {
  return z
    .object({
      title: text(TITLE_MAX, "title"),
      workersNeeded: z
        .string({ error: "Enter the number of workers." })
        .trim()
        .min(1, { error: "Enter the number of workers.", abort: true })
        .refine((value) => wholeNumber(value, 1, WORKERS_MAX), { error: rangeMessage(1, WORKERS_MAX) }),
      country: z
        .string({ error: "Select a country from the list." })
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2}$/, { error: "Select a country from the list." }),
      cityRegion: z
        .string({ error: "Enter the city or region." })
        .trim()
        .min(1, { error: "Enter the city or region.", abort: true })
        .pipe(text(CITY_MAX, "city or region")),
      industry: z
        .string({ error: "Select an industry from the list." })
        .trim()
        .toUpperCase()
        .min(1, { error: "Select an industry from the list." }),
      // Further destination countries next to the main one (FR-M4); the plan decides whether the form offers them and
      // save_requirement whether they are written.
      destinations: z
        .array(destinationRowSchema)
        .max(ADDITIONAL_COUNTRIES_MAX, { error: `Add at most ${ADDITIONAL_COUNTRIES_MAX} further destination countries.` }),
      occupations: z
        .array(occupationRowSchema)
        .min(1, { error: "Add at least one occupation." })
        .max(OCCUPATIONS_MAX, { error: `Add at most ${OCCUPATIONS_MAX} occupations.` }),
      skills: text(SKILLS_MAX, "skills", { lineBreaks: true }),
      experienceYears: optionalNumber(0, EXPERIENCE_MAX),
      startDate: z
        .string({ error: "Enter the start date." })
        .trim()
        .superRefine((value, context) => {
          const message =
            value === ""
              ? "Enter the start date."
              : parseDate(value) === null
                ? "Choose a valid date."
                : value < today
                  ? "The start date cannot be in the past."
                  : !dateWithin(value, today, START_MONTHS_AHEAD)
                    ? "Choose a start date within the next 3 years."
                    : null;
          if (message) context.addIssue({ code: "custom", message });
        }),
      durationMonths: optionalNumber(1, DURATION_MAX),
      employmentType: z
        .string({ error: "Select an employment type." })
        .pipe(z.enum(employmentTypes, { error: "Select an employment type." })),
      salaryMin: amountField("minimum salary"),
      salaryMax: amountField("maximum salary"),
      salaryCurrency: z
        .string()
        .trim()
        .toUpperCase()
        .refine((value) => value === "" || /^[A-Z]{3}$/.test(value), { error: "Select a currency from the list." }),
      salaryPeriod: z.union([z.literal(""), z.enum(salaryPeriods)], { error: "Select a pay period." }),
      accommodation: z.boolean().default(false),
      workPermitSupport: z.boolean().default(false),
      visaSupport: z.boolean().default(false),
      recruitmentPreference: z
        .string({ error: "Select a recruitment preference." })
        .pipe(z.enum(recruitmentPreferences, { error: "Select a recruitment preference." })),
      partnerNeed: z
        .string({ error: "Choose whether you need workforce partners." })
        .pipe(z.enum(partnerNeeds, { error: "Choose whether you need workforce partners." })),
    })
    .check((context) => {
      const value = context.value;
      const issue = (path: (string | number)[], message: string) =>
        context.issues.push({ code: "custom", input: value, path, message });

      salaryIssues(value, (path, message) => issue([path], message));

      const destinations = [value.country, ...value.destinations.map((row) => row.country)];
      value.destinations.forEach((row, index) => {
        if (destinations.indexOf(row.country) !== index + 1) issue(["destinations", index, "country"], "This country is already a destination.");
      });

      const codes = value.occupations.map((row) => row.occupation);
      value.occupations.forEach((row, index) => {
        if (codes.indexOf(row.occupation) !== index) issue(["occupations", index, "occupation"], "This occupation is already listed.");
      });
      const quantities = value.occupations.map((row) => row.quantity);
      if (wholeNumber(value.workersNeeded, 1, WORKERS_MAX) && quantities.every((quantity) => wholeNumber(quantity, 1, WORKERS_MAX))) {
        const total = quantities.reduce((sum, quantity) => sum + Number(quantity), 0);
        if (value.occupations.length > 0 && total !== Number(value.workersNeeded)) {
          issue(["occupations"], `Quantities must add up to ${formatCount(Number(value.workersNeeded))}.`);
        }
      }
    });
}

export type RequirementFormInput = z.input<ReturnType<typeof requirementFormSchema>>;
export type RequirementFormValues = z.output<ReturnType<typeof requirementFormSchema>>;

export const emptyRequirementForm: RequirementFormInput = {
  title: "",
  workersNeeded: "",
  country: "",
  cityRegion: "",
  industry: "",
  destinations: [],
  occupations: [{ occupation: "", quantity: "" }],
  skills: "",
  experienceYears: "",
  startDate: "",
  durationMonths: "",
  employmentType: "",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "",
  salaryPeriod: "",
  accommodation: false,
  workPermitSupport: false,
  visaSupport: false,
  recruitmentPreference: "",
  partnerNeed: "",
};

const optional = (value: string): number | undefined => (value === "" ? undefined : Number(value));

// The currency and the pay period only mean something with an amount, so they are not sent without one. An empty
// optional value is left out, which save_requirement stores as null, so an edit clears it rather than keeping it.
export function toRequirementArgs(values: RequirementFormValues): RequirementArgs {
  const hasSalary = values.salaryMin !== "" || values.salaryMax !== "";
  return {
    p_title: values.title === "" ? undefined : values.title,
    p_workers_needed: Number(values.workersNeeded),
    p_country_code: values.country,
    p_city_region: values.cityRegion,
    p_industry_code: values.industry,
    p_additional_countries: values.destinations.map((row) => row.country),
    p_occupations: values.occupations.map((row) => ({ occupation_id: row.occupation, quantity: Number(row.quantity) })),
    p_skills: values.skills === "" ? undefined : values.skills,
    p_experience_years: optional(values.experienceYears),
    p_start_date: values.startDate,
    p_duration_months: optional(values.durationMonths),
    p_employment_type: values.employmentType,
    p_salary_min: optional(values.salaryMin),
    p_salary_max: optional(values.salaryMax),
    p_salary_currency: hasSalary ? values.salaryCurrency : undefined,
    p_salary_period: hasSalary && values.salaryPeriod !== "" ? values.salaryPeriod : undefined,
    p_accommodation: values.accommodation,
    p_work_permit_support: values.workPermitSupport,
    p_visa_support: values.visaSupport,
    p_recruitment_preference: values.recruitmentPreference,
    p_partner_need: values.partnerNeed,
  };
}

export const requirementIdSchema = z.uuid();
