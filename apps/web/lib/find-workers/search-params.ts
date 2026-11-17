import * as z from "zod";
import type { Json } from "@chara-pinnacle/db-types";
import { employmentTypes } from "@/lib/validation/job";

// The limits below repeat those of public.search_workers, which stays the authority and refuses again: 20 and 50 its page
// size, 100 characters of keyword, 10 skills of 50 characters, 60 years of experience.
export const FIND_WORKERS_DEFAULT_LIMIT = 20;
const FIND_WORKERS_MAX_LIMIT = 50;
const MAX_SKILLS = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURSOR = /^(?:[0-9a-f]{2}){1,200}$/;

export const cefrLevels = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
type CefrLevel = (typeof cefrLevels)[number];
type EmploymentType = (typeof employmentTypes)[number];

export const findWorkersCursorError = "The page link is not valid, so the first page is shown.";
const SKILLS_ERROR = `Enter up to ${MAX_SKILLS} skills separated by commas, each up to 50 characters.`;
const EXPERIENCE_ERROR = "Enter a number of years from 0 to 60.";

function optional<Output extends string>(schema: z.ZodType<Output, string>) {
  return z.string().trim().pipe(z.union([z.literal(""), schema]));
}

function splitSkills(value: string): string[] {
  return value
    .split(",")
    .map((skill) => skill.trim())
    .filter((skill) => skill !== "");
}

const filterFields = {
  q: optional(z.string().max(100, { error: "Enter at most 100 characters." })),
  occupation: optional(z.string().regex(/^\d{4}$/, { error: "Select an occupation from the list." })),
  current_country: optional(z.string().toUpperCase().regex(/^[A-Z]{2}$/, { error: "Select a country from the list." })),
  destination: optional(z.string().toUpperCase().regex(/^[A-Z]{2}$/, { error: "Select a destination country from the list." })),
  availability: optional(z.enum(["now", "by"], { error: "Select an availability from the list." })),
  available_by: optional(z.iso.date({ error: "Enter a date." })),
  skills: optional(
    z.string().refine(
      (value) => {
        const skills = splitSkills(value);
        return skills.length <= MAX_SKILLS && skills.every((skill) => skill.length <= 50);
      },
      { error: SKILLS_ERROR },
    ),
  ),
  language: optional(z.string().regex(/^[a-z]{2}$/, { error: "Select a language from the list." })),
  language_level: optional(z.enum(cefrLevels, { error: "Select a level from the list." })),
  min_experience: optional(
    z
      .string()
      .regex(/^\d{1,2}$/, { error: EXPERIENCE_ERROR })
      .refine((value) => Number(value) <= 60, { error: EXPERIENCE_ERROR }),
  ),
  industry: optional(z.string().toUpperCase().regex(/^[A-Z]$/, { error: "Select an industry from the list." })),
  employment_type: optional(z.enum(employmentTypes, { error: "Select an employment type from the list." })),
  work_authorization: optional(z.string().toUpperCase().regex(/^[A-Z]{2}$/, { error: "Select a country from the list." })),
};

type FilterName = keyof typeof filterFields;

export const findWorkersFormSchema = z.object(filterFields).superRefine((values, context) => {
  if (values.availability === "by" && values.available_by === "") {
    context.addIssue({ code: "custom", path: ["available_by"], message: "Enter the date by which workers must be available." });
  }
});
export type FindWorkersFormInput = z.input<typeof findWorkersFormSchema>;
type FindWorkersFormValues = z.output<typeof findWorkersFormSchema>;

export type FindWorkersFilters = {
  q?: string;
  occupation?: string;
  current_country?: string;
  destination?: string;
  availability?: "now";
  available_by?: string;
  skills?: string[];
  language?: string;
  language_level?: CefrLevel;
  min_experience?: number;
  industry?: string;
  employment_type?: EmploymentType;
  work_authorization?: string;
  requirement?: string;
  cursor?: string;
  limit: number;
};

export type FindWorkersFilterErrors = Partial<Record<FilterName | "cursor" | "requirement", string>>;

// The basic filters are for every plan that may search; the others need advanced_worker_search (FR-Q2 open point: the
// default split).
export const advancedFilterNames = [
  "skills",
  "language",
  "min_experience",
  "industry",
  "employment_type",
  "work_authorization",
] as const satisfies readonly (keyof FindWorkersFilters)[];

export function formFindWorkersFilters(values: Partial<FindWorkersFormValues>): FindWorkersFilters {
  const skills = values.skills ? splitSkills(values.skills) : [];
  const language = values.language || undefined;
  return {
    q: values.q || undefined,
    occupation: values.occupation || undefined,
    current_country: values.current_country || undefined,
    destination: values.destination || undefined,
    availability: values.availability === "now" ? "now" : undefined,
    available_by: values.availability !== "now" && values.available_by ? values.available_by : undefined,
    skills: skills.length > 0 ? skills : undefined,
    language,
    language_level: language ? values.language_level || "A1" : undefined,
    min_experience: values.min_experience ? Number(values.min_experience) : undefined,
    industry: values.industry || undefined,
    employment_type: values.employment_type || undefined,
    work_authorization: values.work_authorization || undefined,
    limit: FIND_WORKERS_DEFAULT_LIMIT,
  };
}

export function withoutAdvancedFilters(filters: FindWorkersFilters): FindWorkersFilters {
  return { ...filters, skills: undefined, language: undefined, language_level: undefined, min_experience: undefined, industry: undefined, employment_type: undefined, work_authorization: undefined };
}

export function hasAdvancedFilters(filters: FindWorkersFilters): boolean {
  return advancedFilterNames.some((name) => filters[name] !== undefined);
}

// The filters object of search_workers: the keys it knows, and only those set.
export function workerSearchFilters(filters: FindWorkersFilters): { [key: string]: Json } {
  const rpc: { [key: string]: Json } = {};
  if (filters.q) rpc.q = filters.q;
  if (filters.occupation) rpc.occupation = filters.occupation;
  if (filters.current_country) rpc.current_country = filters.current_country;
  if (filters.destination) rpc.destination = filters.destination;
  if (filters.availability) rpc.availability = filters.availability;
  if (filters.available_by) rpc.available_by = filters.available_by;
  if (filters.skills) rpc.skills = filters.skills;
  if (filters.language) rpc.languages = [{ code: filters.language, min_level: filters.language_level ?? "A1" }];
  if (filters.min_experience !== undefined) rpc.min_experience = filters.min_experience;
  if (filters.industry) rpc.industry = filters.industry;
  if (filters.employment_type) rpc.employment_type = filters.employment_type;
  if (filters.work_authorization) rpc.work_authorization = filters.work_authorization;
  return rpc;
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function parseLimit(value: string | undefined): number {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return FIND_WORKERS_DEFAULT_LIMIT;
  return Math.min(Math.max(Number(value), 1), FIND_WORKERS_MAX_LIMIT);
}

const urlFields = z.object(filterFields).partial();
const fieldNames = Object.keys(filterFields) as FilterName[];

// An address is shared and typed by hand, so a value that does not parse is dropped and reported under the name of its
// parameter, the others are kept; unknown parameters are ignored and the limit is clamped to 1..50. availability=now and
// available_by are the two ways the address states availability.
export function parseFindWorkersParams(raw: RawParams): { filters: FindWorkersFilters; errors: FindWorkersFilterErrors } {
  const errors: FindWorkersFilterErrors = {};
  const given: Record<string, string> = {};
  for (const name of fieldNames) {
    const value = first(raw[name]);
    if (value !== undefined) given[name] = value;
  }
  if (given.availability === undefined && given.available_by !== undefined) given.availability = "by";
  const attempt = urlFields.safeParse(given);
  if (!attempt.success) {
    for (const issue of attempt.error.issues) {
      const name = String(issue.path[0]) as FilterName;
      errors[name] ??= issue.message;
      delete given[name];
    }
  }
  const filters: FindWorkersFilters = { ...formFindWorkersFilters(urlFields.parse(given)), limit: parseLimit(first(raw.limit)) };
  const requirement = first(raw.requirement);
  if (requirement !== undefined && UUID.test(requirement)) filters.requirement = requirement;
  const cursor = first(raw.cursor);
  if (cursor !== undefined) {
    if (CURSOR.test(cursor)) filters.cursor = cursor;
    else errors.cursor = findWorkersCursorError;
  }
  return { filters, errors };
}

const QUERY_ORDER = [
  "requirement",
  "q",
  "occupation",
  "current_country",
  "destination",
  "availability",
  "available_by",
  "skills",
  "language",
  "language_level",
  "min_experience",
  "industry",
  "employment_type",
  "work_authorization",
  "cursor",
] as const satisfies readonly (keyof FindWorkersFilters)[];

// The inverse of parseFindWorkersParams for a valid filter set; a limit equal to the default is not written.
export function findWorkersQuery(filters: FindWorkersFilters): string {
  const params = new URLSearchParams();
  for (const name of QUERY_ORDER) {
    const value = filters[name];
    if (value === undefined) continue;
    params.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }
  if (filters.limit !== FIND_WORKERS_DEFAULT_LIMIT) params.set("limit", String(filters.limit));
  return params.toString();
}

export function hasFindWorkersFilters(filters: FindWorkersFilters): boolean {
  return QUERY_ORDER.some((name) => name !== "cursor" && name !== "requirement" && filters[name] !== undefined);
}

// The values the form shows for the filters in an address (without the page cursor).
export function findWorkersFormDefaults(query: string): FindWorkersFormInput {
  const { filters } = parseFindWorkersParams(Object.fromEntries(new URLSearchParams(query)));
  return {
    q: filters.q ?? "",
    occupation: filters.occupation ?? "",
    current_country: filters.current_country ?? "",
    destination: filters.destination ?? "",
    availability: filters.availability ?? (filters.available_by ? "by" : ""),
    available_by: filters.available_by ?? "",
    skills: filters.skills?.join(", ") ?? "",
    language: filters.language ?? "",
    language_level: filters.language ? (filters.language_level ?? "A1") : "",
    min_experience: filters.min_experience === undefined ? "" : String(filters.min_experience),
    industry: filters.industry ?? "",
    employment_type: filters.employment_type ?? "",
    work_authorization: filters.work_authorization ?? "",
  };
}
