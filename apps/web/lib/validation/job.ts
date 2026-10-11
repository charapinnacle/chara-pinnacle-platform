import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import type { Job } from "@/lib/dal/hiring";

type JobInsertRow = Database["public"]["Tables"]["jobs"]["Insert"];

// The only columns a client may send when it creates a vacancy; status, moderation_state, deleted_at, created_by and
// the hiring-on-behalf organisation belong to the server and are not in this type, so the mapper cannot carry them.
type JobInsert = Pick<
  JobInsertRow,
  | "organization_id"
  | "title"
  | "description"
  | "occupation_id"
  | "industry_code"
  | "country_code"
  | "city"
  | "employment_type"
  | "salary_min"
  | "salary_max"
  | "salary_currency"
  | "salary_period"
  | "accommodation"
  | "visa_support"
  | "recruitment_preference"
>;

// The organization is fixed at creation: the update grant leaves it out, so an update that named it would be refused.
type JobUpdate = Omit<JobInsert, "organization_id">;

export const employmentTypes = ["full_time", "part_time", "contract", "temporary", "seasonal"] as const;
export const salaryPeriods = ["hour", "month", "year"] as const;
const recruitmentPreferences = ["local", "international", "both"] as const;

export const employmentTypeLabels: Record<(typeof employmentTypes)[number], string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  temporary: "Temporary",
  seasonal: "Seasonal",
};

export const salaryPeriodLabels: Record<(typeof salaryPeriods)[number], string> = {
  hour: "Per hour",
  month: "Per month",
  year: "Per year",
};

export const recruitmentPreferenceLabels: Record<(typeof recruitmentPreferences)[number], string> = {
  local: "Local candidates",
  international: "International candidates",
  both: "Local and international candidates",
};

export const employmentTypeOptions = employmentTypes.map((value) => ({ value, label: employmentTypeLabels[value] }));
export const salaryPeriodOptions = salaryPeriods.map((value) => ({ value, label: salaryPeriodLabels[value] }));
export const recruitmentPreferenceOptions = recruitmentPreferences.map((value) => ({
  value,
  label: recruitmentPreferenceLabels[value],
}));

const MAX_AMOUNT = 9_999_999.99;
const AMOUNT_FORMAT = "Enter an amount of 0 or more, for example 2800 or 2800.50.";

const CONTROL_CHARACTER = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const LINE_BREAKS_AND_TABS = /[\t\n\r]/g;

// The table checks count characters, not UTF-16 units, so an emoji is one character here as there.
const characters = (value: string) => Array.from(value).length;

const NO_CONTROL_CHARACTERS = "Remove the special characters.";

function amountField(label: string) {
  return z
    .string()
    .trim()
    .superRefine((value, context) => {
      if (value === "") return;
      if (!/^\d+(\.\d+)?$/.test(value)) {
        context.addIssue({ code: "custom", message: AMOUNT_FORMAT });
      } else if (value.includes(".") && value.split(".")[1].length > 2) {
        context.addIssue({ code: "custom", message: `The ${label} can have at most 2 decimals.` });
      } else if (Number(value) > MAX_AMOUNT) {
        context.addIssue({ code: "custom", message: `The ${label} cannot be more than 9,999,999.99.` });
      }
    });
}

// The form's own schema: the amounts stay strings so that the form can use it as its resolver; toJobUpdate converts them.
// Keys the form does not own, such as status or created_by, are dropped by the parse.
export const jobFormSchema = z
  .object({
    title: z
      .string({ error: "Enter the title." })
      .trim()
      .min(1, { error: "Enter the title." })
      .refine((value) => characters(value) >= 5, { error: "The title must have at least 5 characters." })
      .refine((value) => characters(value) <= 120, { error: "The title must have 120 characters or fewer." })
      .refine((value) => !CONTROL_CHARACTER.test(value), { error: NO_CONTROL_CHARACTERS }),
    description: z
      .string({ error: "Enter the description." })
      .trim()
      .min(1, { error: "Enter the description." })
      .refine((value) => characters(value) >= 50, { error: "The description must have at least 50 characters." })
      .refine((value) => characters(value) <= 10_000, { error: "The description must have 10,000 characters or fewer." })
      .refine((value) => !CONTROL_CHARACTER.test(value.replace(LINE_BREAKS_AND_TABS, "")), {
        error: NO_CONTROL_CHARACTERS,
      }),
    occupation: z
      .string({ error: "Select an occupation from the list." })
      .trim()
      .regex(/^\d{4}$/, { error: "Select an occupation from the list." }),
    industry: z
      .string({ error: "Select an industry from the list." })
      .trim()
      .toUpperCase()
      .min(1, { error: "Select an industry from the list." }),
    country: z
      .string({ error: "Select a country from the list." })
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, { error: "Select a country from the list." }),
    city: z
      .string({ error: "Enter the city." })
      .trim()
      .min(1, { error: "Enter the city." })
      .refine((value) => characters(value) <= 100, { error: "The city must have 100 characters or fewer." })
      .refine((value) => !CONTROL_CHARACTER.test(value), { error: NO_CONTROL_CHARACTERS }),
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
    visaSupport: z.boolean().default(false),
    recruitmentPreference: z
      .string({ error: "Select a recruitment preference." })
      .pipe(z.enum(recruitmentPreferences, { error: "Select a recruitment preference." })),
  })
  .check((context) => {
    const { salaryMin, salaryMax, salaryCurrency, salaryPeriod } = context.value;
    const issue = (path: string, message: string) =>
      context.issues.push({ code: "custom", input: context.value, path: [path], message });
    if (salaryMin === "" && salaryMax === "") return;
    if (salaryMin !== "" && salaryMax !== "" && Number(salaryMin) > Number(salaryMax)) {
      issue("salaryMin", "The minimum salary cannot be higher than the maximum.");
    }
    if (salaryCurrency === "") issue("salaryCurrency", "Select a currency when you enter a salary.");
    if (salaryPeriod === "") issue("salaryPeriod", "Select a pay period when you enter a salary.");
  });

export type JobFormInput = z.input<typeof jobFormSchema>;
export type JobFormValues = z.output<typeof jobFormSchema>;

// The currency and the pay period only mean something with an amount, so they are not sent without one. An edit sends
// every content column, so an emptied salary is cleared rather than kept.
export function toJobUpdate(values: JobFormValues): JobUpdate {
  const hasSalary = values.salaryMin !== "" || values.salaryMax !== "";
  return {
    title: values.title,
    description: values.description,
    occupation_id: values.occupation,
    industry_code: values.industry,
    country_code: values.country,
    city: values.city,
    employment_type: values.employmentType,
    salary_min: values.salaryMin === "" ? null : Number(values.salaryMin),
    salary_max: values.salaryMax === "" ? null : Number(values.salaryMax),
    salary_currency: hasSalary ? values.salaryCurrency : null,
    salary_period: hasSalary && values.salaryPeriod !== "" ? values.salaryPeriod : null,
    accommodation: values.accommodation,
    visa_support: values.visaSupport,
    recruitment_preference: values.recruitmentPreference,
  };
}

export function toJobInsert(values: JobFormValues, organizationId: string): JobInsert {
  return { organization_id: organizationId, ...toJobUpdate(values) };
}

// The saved vacancy as the values of the form, so that the edit form starts from what is stored.
export function toJobFormInput(job: Job): JobFormInput {
  const amount = (value: number | null) => (value === null ? "" : String(value));
  return {
    title: job.title,
    description: job.description,
    occupation: job.occupationId,
    industry: job.industryCode,
    country: job.countryCode,
    city: job.city,
    employmentType: job.employmentType,
    salaryMin: amount(job.salaryMin),
    salaryMax: amount(job.salaryMax),
    salaryCurrency: job.salaryCurrency ?? "",
    salaryPeriod: job.salaryPeriod ?? "",
    accommodation: job.accommodation,
    visaSupport: job.visaSupport,
    recruitmentPreference: job.recruitmentPreference,
  };
}

export const jobIdSchema = z.uuid();

const CURSOR_SEPARATOR = "|";

// A page of the vacancy list ends at the creation time and id of its last row; the next page starts after it.
const jobCursorSchema = z
  .string()
  .transform((value) => value.split(CURSOR_SEPARATOR))
  .pipe(z.tuple([z.iso.datetime({ offset: true }), z.uuid()]))
  .transform(([createdAt, id]) => ({ createdAt, id }));

export type JobCursor = z.output<typeof jobCursorSchema>;

export function parseJobCursor(value: unknown): JobCursor | null {
  const parsed = jobCursorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function formatJobCursor({ createdAt, id }: JobCursor): string {
  return `${createdAt}${CURSOR_SEPARATOR}${id}`;
}

// The exact shape of the next_cursor of the keyset lists of the database (saved vacancies, applications). Dropping a
// cursor the function would refuse makes a mistyped address show the first page, not an error page; parseJobCursor adds
// the calendar check the pattern lacks.
const LIST_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseListCursor(value: unknown): string | null {
  return typeof value === "string" && LIST_CURSOR.test(value) && parseJobCursor(value) ? value : null;
}
