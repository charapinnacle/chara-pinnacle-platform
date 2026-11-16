import * as z from "zod";

// The limits below repeat those of public.search_employers, which stays the authority and refuses again: 20 and 50 its
// page size, 1 to 100,000 workers.
export const FIND_EMPLOYERS_DEFAULT_LIMIT = 20;
const FIND_EMPLOYERS_MAX_LIMIT = 50;
const MAX_WORKERS = 100_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const WORKERS_ERROR = "Enter a number of workers from 1 to 100,000.";
export const findEmployersCursorError = "The page link is not valid, so the first page is shown.";

function optional<Output extends string>(schema: z.ZodType<Output, string>) {
  return z.string().trim().pipe(z.union([z.literal(""), schema]));
}

const filterFields = {
  destination: optional(z.string().toUpperCase().regex(/^[A-Z]{2}$/, { error: "Select a destination country from the list." })),
  industry: optional(z.string().toUpperCase().regex(/^[A-Z]$/, { error: "Select an industry from the list." })),
  occupation: optional(z.string().regex(/^\d{4}$/, { error: "Select an occupation from the list." })),
  min_workers: optional(
    z
      .string()
      .regex(/^\d+$/, { error: WORKERS_ERROR })
      .refine((value) => Number(value) >= 1 && Number(value) <= MAX_WORKERS, { error: WORKERS_ERROR }),
  ),
};

type FilterName = keyof typeof filterFields;

export type FindEmployersFilters = {
  destination?: string;
  industry?: string;
  occupation?: string;
  min_workers?: number;
  cursor?: string;
  limit: number;
};

export type FindEmployersFilterErrors = Partial<Record<FilterName | "cursor", string>>;

export const findEmployersFormSchema = z.object(filterFields);
export type FindEmployersFormInput = z.input<typeof findEmployersFormSchema>;
type FindEmployersFormValues = z.output<typeof findEmployersFormSchema>;

export function formFindEmployersFilters(values: Partial<FindEmployersFormValues>): FindEmployersFilters {
  return {
    destination: values.destination || undefined,
    industry: values.industry || undefined,
    occupation: values.occupation || undefined,
    min_workers: values.min_workers ? Number(values.min_workers) : undefined,
    limit: FIND_EMPLOYERS_DEFAULT_LIMIT,
  };
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function parseLimit(value: string | undefined): number {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return FIND_EMPLOYERS_DEFAULT_LIMIT;
  return Math.min(Math.max(Number(value), 1), FIND_EMPLOYERS_MAX_LIMIT);
}

const urlFields = z.object(filterFields).partial();
const fieldNames = Object.keys(filterFields) as FilterName[];

// An address is shared and typed by hand, so a value that does not parse is dropped and reported under the name of its
// parameter, the others are kept; unknown parameters are ignored and the limit is clamped to 1..50.
export function parseFindEmployersParams(raw: RawParams): { filters: FindEmployersFilters; errors: FindEmployersFilterErrors } {
  const errors: FindEmployersFilterErrors = {};
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
  const filters: FindEmployersFilters = { ...formFindEmployersFilters(urlFields.parse(given)), limit: parseLimit(first(raw.limit)) };
  const cursor = first(raw.cursor);
  if (cursor !== undefined) {
    if (UUID.test(cursor)) filters.cursor = cursor;
    else errors.cursor = findEmployersCursorError;
  }
  return { filters, errors };
}

const QUERY_ORDER = ["destination", "industry", "occupation", "min_workers", "cursor"] as const satisfies readonly (keyof FindEmployersFilters)[];

// The inverse of parseFindEmployersParams for a valid filter set; a limit equal to the default is not written.
export function findEmployersQuery(filters: FindEmployersFilters): string {
  const params = new URLSearchParams();
  for (const name of QUERY_ORDER) {
    const value = filters[name];
    if (value !== undefined) params.set(name, String(value));
  }
  if (filters.limit !== FIND_EMPLOYERS_DEFAULT_LIMIT) params.set("limit", String(filters.limit));
  return params.toString();
}

export function hasFindEmployersFilters(filters: FindEmployersFilters): boolean {
  return QUERY_ORDER.some((name) => name !== "cursor" && filters[name] !== undefined);
}

// The values the form shows for the filters in an address (without the page cursor).
export function findEmployersFormDefaults(query: string): FindEmployersFormInput {
  const { filters } = parseFindEmployersParams(Object.fromEntries(new URLSearchParams(query)));
  return {
    destination: filters.destination ?? "",
    industry: filters.industry ?? "",
    occupation: filters.occupation ?? "",
    min_workers: filters.min_workers === undefined ? "" : String(filters.min_workers),
  };
}
