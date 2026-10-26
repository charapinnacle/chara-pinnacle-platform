import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";

// The limits below repeat those of public.search_partners, which stays the authority and refuses again: 20 and 50 its
// page size, 20 source countries, 1 to 100,000 workers and 1 to 365 days.
const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;
const MAX_SOURCES = 20;
const MAX_CAPACITY = 100_000;
const MAX_WITHIN_DAYS = 365;

// The exact shape of the next_cursor search_partners returns: the matched filter count, the profile time in UTC with
// microseconds, the id.
const CURSOR = /^\d{1,2}\|(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isCursor(value: string): boolean {
  const seconds = CURSOR.exec(value)?.[1];
  if (seconds === undefined) return false;
  const parsed = new Date(`${seconds}Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(seconds);
}

type RecruitmentPreference = Database["public"]["Enums"]["recruitment_preference"];
export const recruitmentFilterValues = ["local", "international"] as const satisfies readonly RecruitmentPreference[];

// The filters named on a result card and in the search log, in their order (search_partners matched_filters).
export const matchedFilterNames = [
  "destination", "occupation", "based_in", "sources_from", "industry", "language", "recruitment_type", "capacity", "timeframe",
] as const;
export type MatchedFilter = (typeof matchedFilterNames)[number];

function optional<Output extends string>(schema: z.ZodType<Output, string>) {
  return z.string().trim().pipe(z.union([z.literal(""), schema]));
}

const COUNTRY = /^[A-Z]{2}$/;
const country = (error: string) => z.string().toUpperCase().regex(COUNTRY, { error });

function wholeNumber(max: number, error: string) {
  return z
    .string()
    .regex(/^\d+$/, { error })
    .refine((value) => Number(value) >= 1 && Number(value) <= max, { error });
}

const CAPACITY_ERROR = "Enter a number of workers from 1 to 100,000.";
const WITHIN_DAYS_ERROR = "Enter a number of days from 1 to 365.";
const SOURCES_ERROR = "Select up to 20 source countries from the list.";

const filterFields = {
  destination: optional(country("Select a destination country from the list.")),
  occupation: optional(z.string().regex(/^\d{4}$/, { error: "Select an occupation from the list." })),
  based_in: optional(country("Select the country where the company is based from the list.")),
  industry: optional(z.string().toUpperCase().regex(/^[A-Z]$/, { error: "Select an industry from the list." })),
  language: optional(z.string().toLowerCase().regex(/^[a-z]{2}$/, { error: "Select a language from the list." })),
  recruitment: optional(z.enum(recruitmentFilterValues, { error: "Select local or international recruitment." })),
  capacity: optional(wholeNumber(MAX_CAPACITY, CAPACITY_ERROR)),
  within_days: optional(wholeNumber(MAX_WITHIN_DAYS, WITHIN_DAYS_ERROR)),
};

const sourcesSchema = z
  .array(country(SOURCES_ERROR))
  .transform((codes) => [...new Set(codes)])
  .refine((codes) => codes.length <= MAX_SOURCES, { error: SOURCES_ERROR });

// The form checks the same fields as the address, so what the form accepts the address can carry.
export const partnerSearchFormSchema = z.object({ ...filterFields, sources_from: sourcesSchema });

export type PartnerSearchFormInput = z.input<typeof partnerSearchFormSchema>;
type PartnerSearchFormValues = z.output<typeof partnerSearchFormSchema>;

export type PartnerSearchFilters = {
  destination?: string;
  occupation?: string;
  based_in?: string;
  sources_from?: string[];
  industry?: string;
  language?: string;
  recruitment?: (typeof recruitmentFilterValues)[number];
  capacity?: number;
  within_days?: number;
  cursor?: string;
  limit: number;
};

type FilterName = keyof typeof filterFields | "sources_from";
type SearchErrors = Partial<Record<FilterName | "cursor", string>>;

export function formFilters(values: Partial<PartnerSearchFormValues>): PartnerSearchFilters {
  return {
    destination: values.destination || undefined,
    occupation: values.occupation || undefined,
    based_in: values.based_in || undefined,
    sources_from: values.sources_from?.length ? values.sources_from : undefined,
    industry: values.industry || undefined,
    language: values.language || undefined,
    recruitment: values.recruitment || undefined,
    capacity: values.capacity ? Number(values.capacity) : undefined,
    within_days: values.within_days ? Number(values.within_days) : undefined,
    limit: SEARCH_DEFAULT_LIMIT,
  };
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function parseLimit(value: string | undefined): number {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(Number(value), 1), SEARCH_MAX_LIMIT);
}

const urlFields = z.object(filterFields).partial();
const fieldNames = Object.keys(filterFields) as (keyof typeof filterFields)[];

// An address is shared and typed by hand: a value that does not parse is dropped and reported under the name of its
// parameter, the others are kept, and parameters that are not filters are ignored. sources_from is a comma list.
export function parsePartnerSearchParams(raw: RawParams): { filters: PartnerSearchFilters; errors: SearchErrors } {
  const errors: SearchErrors = {};
  const given: Record<string, string> = {};
  for (const name of fieldNames) {
    const value = first(raw[name]);
    if (value !== undefined) given[name] = value;
  }
  const attempt = urlFields.safeParse(given);
  if (!attempt.success) {
    for (const issue of attempt.error.issues) {
      const name = String(issue.path[0]) as keyof typeof filterFields;
      errors[name] ??= issue.message;
      delete given[name];
    }
  }
  const values = urlFields.parse(given);

  let sources: string[] = [];
  const rawSources = first(raw.sources_from)?.trim();
  if (rawSources) {
    const parsed = sourcesSchema.safeParse(rawSources.split(",").map((code) => code.trim()));
    if (parsed.success) sources = parsed.data;
    else errors.sources_from = SOURCES_ERROR;
  }

  const filters: PartnerSearchFilters = {
    ...formFilters({ ...values, sources_from: sources }),
    limit: parseLimit(first(raw.limit)),
  };
  const cursor = first(raw.cursor);
  if (cursor !== undefined) {
    if (isCursor(cursor)) filters.cursor = cursor;
    else errors.cursor = "The page link is not valid, so the first page is shown.";
  }
  return { filters, errors };
}

const QUERY_ORDER = [
  "destination", "occupation", "based_in", "sources_from", "industry", "language", "recruitment", "capacity", "within_days", "cursor",
] as const satisfies readonly (keyof PartnerSearchFilters)[];

// The inverse of parsePartnerSearchParams for a valid filter set; a limit equal to the default is not written.
export function partnerSearchQuery(filters: PartnerSearchFilters): string {
  const params = new URLSearchParams();
  for (const name of QUERY_ORDER) {
    const value = filters[name];
    if (value !== undefined) params.set(name, Array.isArray(value) ? value.join(",") : String(value));
  }
  if (filters.limit !== SEARCH_DEFAULT_LIMIT) params.set("limit", String(filters.limit));
  return params.toString();
}

export function hasPartnerFilters(filters: PartnerSearchFilters): boolean {
  return QUERY_ORDER.some((name) => name !== "cursor" && filters[name] !== undefined);
}

// Capacity, timeframe and several source countries at once need the plan feature advanced_partner_search.
export function usesAdvancedFilters(filters: PartnerSearchFilters): boolean {
  return filters.capacity !== undefined || filters.within_days !== undefined || (filters.sources_from?.length ?? 0) > 1;
}

export function partnerDirectoryPath(lang: string, filters?: PartnerSearchFilters): string {
  const query = filters ? partnerSearchQuery(filters) : "";
  return query === "" ? `/${lang}/partners/recruitment` : `/${lang}/partners/recruitment?${query}`;
}

// The values the form shows for the filters in an address (without the page cursor).
export function partnerFormDefaults(query: string): PartnerSearchFormInput {
  const { filters } = parsePartnerSearchParams(Object.fromEntries(new URLSearchParams(query)));
  return {
    destination: filters.destination ?? "",
    occupation: filters.occupation ?? "",
    based_in: filters.based_in ?? "",
    sources_from: filters.sources_from ?? [],
    industry: filters.industry ?? "",
    language: filters.language ?? "",
    recruitment: filters.recruitment ?? "",
    capacity: filters.capacity === undefined ? "" : String(filters.capacity),
    within_days: filters.within_days === undefined ? "" : String(filters.within_days),
  };
}

export const matchedFilterLabels: Record<MatchedFilter, string> = {
  destination: "destination",
  occupation: "occupation",
  based_in: "based in",
  sources_from: "source country",
  industry: "industry",
  language: "language",
  recruitment_type: "recruitment type",
  capacity: "capacity",
  timeframe: "timeframe",
};
