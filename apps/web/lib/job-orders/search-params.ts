import * as z from "zod";
import { recruitmentFilterValues } from "@/lib/partners/search-params";

// The limits below repeat those of public.list_job_orders, which stays the authority and refuses again: 20 and 50 its page
// size, 1 to 100,000 workers.
export const JOB_ORDERS_DEFAULT_LIMIT = 20;
const JOB_ORDERS_MAX_LIMIT = 50;
const MAX_WORKERS = 100_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The years 0001 to 9999, as the database's date type reads them (no year 0).
function isDate(value: string): boolean {
  if (!ISO_DATE.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

const WORKERS_ERROR = "Enter a number of workers from 1 to 100,000.";
const DATE_ERROR = "Enter a date as YYYY-MM-DD.";
export const jobOrderFilterErrors = {
  workersOrder: "The minimum number of workers cannot be higher than the maximum.",
  startOrder: "The earliest start date cannot be after the latest start date.",
  cursor: "The page link is not valid, so the first page is shown.",
} as const;

function optional<Output extends string>(schema: z.ZodType<Output, string>) {
  return z.string().trim().pipe(z.union([z.literal(""), schema]));
}

const country = (error: string) => z.string().toUpperCase().regex(/^[A-Z]{2}$/, { error });

const workers = z
  .string()
  .regex(/^\d+$/, { error: WORKERS_ERROR })
  .refine((value) => Number(value) >= 1 && Number(value) <= MAX_WORKERS, { error: WORKERS_ERROR });

const date = z.string().refine(isDate, { error: DATE_ERROR });

const filterFields = {
  destination: optional(country("Select a destination country from the list.")),
  source: optional(country("Select a source country from the list.")),
  occupation: optional(z.string().regex(/^\d{4}$/, { error: "Select an occupation from the list." })),
  industry: optional(z.string().toUpperCase().regex(/^[A-Z]$/, { error: "Select an industry from the list." })),
  workers_min: optional(workers),
  workers_max: optional(workers),
  start_from: optional(date),
  start_to: optional(date),
  // An enum inside the union of optional() would report the union's own message, so the empty value is one of its values.
  recruitment: z.string().trim().pipe(z.enum(["", ...recruitmentFilterValues], { error: "Select local or international recruitment." })),
};

type FilterName = keyof typeof filterFields;

export type JobOrderFilters = {
  destination?: string;
  source?: string;
  occupation?: string;
  industry?: string;
  workers_min?: number;
  workers_max?: number;
  start_from?: string;
  start_to?: string;
  recruitment?: (typeof recruitmentFilterValues)[number];
  cursor?: string;
  limit: number;
};

export type JobOrderFilterErrors = Partial<Record<FilterName | "cursor", string>>;

// The form checks the same fields as the address, and the two orders the database checks (a minimum above the maximum
// names the minimum, an earliest start after the latest names the earliest), so what the form accepts the address can
// carry.
export const jobOrderFormSchema = z.object(filterFields).superRefine((values, context) => {
  if (values.workers_min && values.workers_max && Number(values.workers_min) > Number(values.workers_max)) {
    context.addIssue({ code: "custom", path: ["workers_min"], message: jobOrderFilterErrors.workersOrder });
  }
  if (values.start_from && values.start_to && values.start_from > values.start_to) {
    context.addIssue({ code: "custom", path: ["start_from"], message: jobOrderFilterErrors.startOrder });
  }
});

export type JobOrderFormInput = z.input<typeof jobOrderFormSchema>;
type JobOrderFormValues = z.output<typeof jobOrderFormSchema>;

export function formJobOrderFilters(values: Partial<JobOrderFormValues>): JobOrderFilters {
  return {
    destination: values.destination || undefined,
    source: values.source || undefined,
    occupation: values.occupation || undefined,
    industry: values.industry || undefined,
    workers_min: values.workers_min ? Number(values.workers_min) : undefined,
    workers_max: values.workers_max ? Number(values.workers_max) : undefined,
    start_from: values.start_from || undefined,
    start_to: values.start_to || undefined,
    recruitment: values.recruitment || undefined,
    limit: JOB_ORDERS_DEFAULT_LIMIT,
  };
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function parseLimit(value: string | undefined): number {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return JOB_ORDERS_DEFAULT_LIMIT;
  return Math.min(Math.max(Number(value), 1), JOB_ORDERS_MAX_LIMIT);
}

const urlFields = z.object(filterFields).partial();
const fieldNames = Object.keys(filterFields) as FilterName[];

// FR-N1 AC7: an address is shared and typed by hand, so a value that does not parse is dropped and reported under the
// name of its parameter, the others are kept; parameters that are not filters (verified among them: the verification
// filter is Phase 3) are ignored. Of a minimum above the maximum, or an earliest start after the latest, the first is
// dropped and named. The limit is clamped to 1..50, 20 when it is not a number.
export function parseJobOrderParams(raw: RawParams): { filters: JobOrderFilters; errors: JobOrderFilterErrors } {
  const errors: JobOrderFilterErrors = {};
  const given: Record<string, string> = {};
  for (const name of fieldNames) {
    const value = first(raw[name]);
    if (value !== undefined) given[name] = value;
  }
  const attempt = urlFields.safeParse(given);
  if (!attempt.success) {
    for (const issue of attempt.error.issues) {
      const name = String(issue.path[0]) as FilterName;
      errors[name] ??= issue.message;
      delete given[name];
    }
  }
  const filters: JobOrderFilters = { ...formJobOrderFilters(urlFields.parse(given)), limit: parseLimit(first(raw.limit)) };
  if (filters.workers_min !== undefined && filters.workers_max !== undefined && filters.workers_min > filters.workers_max) {
    errors.workers_min = jobOrderFilterErrors.workersOrder;
    filters.workers_min = undefined;
  }
  if (filters.start_from !== undefined && filters.start_to !== undefined && filters.start_from > filters.start_to) {
    errors.start_from = jobOrderFilterErrors.startOrder;
    filters.start_from = undefined;
  }
  const cursor = first(raw.cursor);
  if (cursor !== undefined) {
    if (UUID.test(cursor)) filters.cursor = cursor;
    else errors.cursor = jobOrderFilterErrors.cursor;
  }
  return { filters, errors };
}

const QUERY_ORDER = [
  "destination", "source", "occupation", "industry", "workers_min", "workers_max", "start_from", "start_to", "recruitment",
  "cursor",
] as const satisfies readonly (keyof JobOrderFilters)[];

// The inverse of parseJobOrderParams for a valid filter set; a limit equal to the default is not written.
export function jobOrderQuery(filters: JobOrderFilters): string {
  const params = new URLSearchParams();
  for (const name of QUERY_ORDER) {
    const value = filters[name];
    if (value !== undefined) params.set(name, String(value));
  }
  if (filters.limit !== JOB_ORDERS_DEFAULT_LIMIT) params.set("limit", String(filters.limit));
  return params.toString();
}

export function hasJobOrderFilters(filters: JobOrderFilters): boolean {
  return QUERY_ORDER.some((name) => name !== "cursor" && filters[name] !== undefined);
}

// The values the form shows for the filters in an address (without the page cursor).
export function jobOrderFormDefaults(query: string): JobOrderFormInput {
  const { filters } = parseJobOrderParams(Object.fromEntries(new URLSearchParams(query)));
  return {
    destination: filters.destination ?? "",
    source: filters.source ?? "",
    occupation: filters.occupation ?? "",
    industry: filters.industry ?? "",
    workers_min: filters.workers_min === undefined ? "" : String(filters.workers_min),
    workers_max: filters.workers_max === undefined ? "" : String(filters.workers_max),
    start_from: filters.start_from ?? "",
    start_to: filters.start_to ?? "",
    recruitment: filters.recruitment ?? "",
  };
}
