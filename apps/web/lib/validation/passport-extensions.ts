import * as z from "zod";
import { employmentTypeLabels, employmentTypes } from "@/lib/validation/job";
import { CONTROL_CHARACTER, countryCodeSchema, todayUtc } from "@/lib/validation/passport";

// The lengths and the first year mirror the table constraints of the passport extensions (FR-Q4); the list limits are
// settings the forms read through getPassportLimits, and the database stays the authority.
const MIN_TEXT_LENGTH = 2;
const MAX_TEXT_LENGTH = 120;
export const FIRST_TRAINING_YEAR = 1960;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_MESSAGE = "Enter a month as YYYY-MM, for example 2019-03.";

export const SENSITIVE_DETAILS_NOTICE =
  "Do not enter ID numbers, date of birth, nationality, religion, health or other sensitive details.";

function requiredText(label: string) {
  return z
    .string({ error: `Enter the ${label.toLowerCase()}.` })
    .trim()
    .min(1, { error: `Enter the ${label.toLowerCase()}.` })
    .min(MIN_TEXT_LENGTH, { error: `${label} must be at least ${MIN_TEXT_LENGTH} characters.` })
    .max(MAX_TEXT_LENGTH, { error: `${label} must be ${MAX_TEXT_LENGTH} characters or fewer.` })
    .refine((value) => !CONTROL_CHARACTER.test(value), { error: `${label} must be one line of plain text.` });
}

function optionalText(label: string) {
  return z
    .string()
    .trim()
    .max(MAX_TEXT_LENGTH, { error: `${label} must be ${MAX_TEXT_LENGTH} characters or fewer.` })
    .refine((value) => !CONTROL_CHARACTER.test(value), { error: `${label} must be one line of plain text.` });
}

// today is a UTC date, YYYY-MM-DD: the year completed and the start month may not lie after it.
export function trainingFormSchema(today: string = todayUtc()) {
  const lastYear = Number(today.slice(0, 4));
  const yearMessage = `Enter a year from ${FIRST_TRAINING_YEAR} to ${lastYear}.`;
  return z.object({
    course: requiredText("Course"),
    provider: optionalText("Provider"),
    yearCompleted: z
      .string({ error: yearMessage })
      .trim()
      .refine((value) => /^\d{4}$/.test(value) && Number(value) >= FIRST_TRAINING_YEAR && Number(value) <= lastYear, {
        error: yearMessage,
      }),
  });
}

export function trainingSchema(today?: string) {
  return trainingFormSchema(today).transform(({ course, provider, yearCompleted }) => ({
    course,
    provider: provider === "" ? null : provider,
    yearCompleted: Number(yearCompleted),
  }));
}
export type TrainingInput = z.input<ReturnType<typeof trainingFormSchema>>;

// Months are entered as YYYY-MM and stored as the first day of the month. "I still work here" or an empty end month
// means the candidate still works there.
export function employmentFormSchema(today: string = todayUtc()) {
  const thisMonth = today.slice(0, 7);
  return z
    .object({
      role: requiredText("Role"),
      employerName: optionalText("Employer name"),
      country: countryCodeSchema,
      fromMonth: z.string().trim(),
      toMonth: z.string().trim(),
      current: z.boolean(),
    })
    .check((context) => {
      const { fromMonth, toMonth, current } = context.value;
      const fromValid = MONTH_PATTERN.test(fromMonth);
      const fromMessage = !fromValid ? MONTH_MESSAGE : fromMonth > thisMonth ? "The start month cannot be in the future." : null;
      if (fromMessage) context.issues.push({ code: "custom", input: fromMonth, path: ["fromMonth"], message: fromMessage });
      if (current || toMonth === "") return;
      const toMessage = !MONTH_PATTERN.test(toMonth)
        ? MONTH_MESSAGE
        : fromValid && toMonth < fromMonth
          ? "The end month cannot be before the start month."
          : null;
      if (toMessage) context.issues.push({ code: "custom", input: toMonth, path: ["toMonth"], message: toMessage });
    });
}

export function employmentSchema(today?: string) {
  return employmentFormSchema(today).transform(({ role, employerName, country, fromMonth, toMonth, current }) => ({
    role,
    employerName: employerName === "" ? null : employerName,
    country,
    fromMonth: `${fromMonth}-01`,
    toMonth: current || toMonth === "" ? null : `${toMonth}-01`,
  }));
}
export type EmploymentInput = z.input<ReturnType<typeof employmentFormSchema>>;

const INDUSTRY_MESSAGE = "Choose an industry from the list.";

export const industryCodeSchema = z.string().regex(/^[A-Z]$/);
export const preferredIndustrySchema = z.object({
  industry: z.string({ error: INDUSTRY_MESSAGE }).trim().toUpperCase().regex(/^[A-Z]$/, { error: INDUSTRY_MESSAGE }),
});
export type PreferredIndustryInput = z.input<typeof preferredIndustrySchema>;

const EMPLOYMENT_TYPE_MESSAGE = "Choose an employment type.";

export const employmentTypeOptions = employmentTypes.map((value) => ({ value, label: employmentTypeLabels[value] }));
export const preferredEmploymentTypeFormSchema = z.object({
  employmentType: z
    .string({ error: EMPLOYMENT_TYPE_MESSAGE })
    .refine((value) => employmentTypes.some((type) => type === value), { error: EMPLOYMENT_TYPE_MESSAGE }),
});
export const employmentTypeSchema = z.enum(employmentTypes, { error: EMPLOYMENT_TYPE_MESSAGE });
export const preferredEmploymentTypeSchema = z.object({ employmentType: employmentTypeSchema });
export type PreferredEmploymentTypeInput = z.input<typeof preferredEmploymentTypeFormSchema>;
