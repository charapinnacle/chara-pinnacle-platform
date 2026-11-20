import * as z from "zod";
import { employmentTypeLabels, employmentTypes } from "@/lib/validation/job";

// The Find Workers card (FR-Q1): the columns of public.worker_search, which the worker's preview (my_card_preview) and
// the search of V69 return alike. Codes are named through the reference lists by the component; nothing here is a name,
// a contact detail or a document (NFR-S9).
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

export const workerCardSchema = z.object({
  card_id: z.uuid(),
  headline: z.string().nullable(),
  occupation_id: z.string().nullable(),
  skills: z.array(z.string()),
  years_experience: z.number().int().nullable(),
  languages: z.array(z.object({ code: z.string(), level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]) })),
  availability: z.enum(["now", "from_date", "unavailable"]).nullable(),
  available_from: z.string().nullable(),
  current_country: z.string(),
  preferred_countries: z.array(z.string()),
  work_authorization_countries: z.array(z.string()),
  training: z
    .array(z.object({ course: z.string(), provider: z.string().nullable(), year_completed: z.number().int() }))
    .nullable(),
  employment_history: z
    .array(z.object({ role: z.string(), country_code: z.string(), from_month: monthSchema, to_month: monthSchema.nullable() }))
    .nullable(),
  preferred_industries: z.array(z.string()).nullable(),
  preferred_employment_types: z.array(z.enum(employmentTypes)).nullable(),
  updated_at: z.string(),
});

export type WorkerCardData = z.infer<typeof workerCardSchema>;

export function experienceText(years: number | null): string | null {
  if (years === null) return null;
  if (years === 0) return "No experience yet";
  return years === 1 ? "1 year of experience" : `${years} years of experience`;
}

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

// "2020-01" -> "Jan 2020"
export function monthText(month: string): string {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`));
}

// "Jan 2020 to Jun 2022", or "since Jan 2020" for the current job.
export function periodText(from: string, to: string | null): string {
  return to === null ? `since ${monthText(from)}` : `${monthText(from)} to ${monthText(to)}`;
}

export function employmentTypeText(types: readonly (keyof typeof employmentTypeLabels)[]): string {
  return types.map((type) => employmentTypeLabels[type]).join(", ");
}

// What companies see and never see, said in the passport and in the dialog (FR-Q1 AC9).
export const CARD_SHOWS = [
  "Your headline, occupation, skills and years of experience",
  "Your languages and availability",
  "The country you live in, your preferred countries and the countries where you may work",
  "Training, employment history and preferred industries, only if you switch them on",
] as const;

export const CARD_NEVER_SHOWS = [
  "Your name or photo",
  "Your email address, phone number or other contact details",
  "Your documents, such as your CV",
  "The names of your past employers",
] as const;
