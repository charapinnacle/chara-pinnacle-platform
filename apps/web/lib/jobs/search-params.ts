import { z } from "zod";
import { employmentTypes, salaryPeriods } from "@/lib/validation/job";

const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;

const MAX_TEXT = 100;
const MAX_SALARY = 9_999_999.99;
const SALARY_FORMAT = "Enter an amount above 0 and up to 9,999,999.99, for example 2800 or 2800.50.";

// The shape of the cursor search_jobs returns; the database parses it again and refuses anything else.
const CURSOR = /^[0-9]+(\.[0-9]+)?(e[+-][0-9]+)?\|[0-9T:.Z-]+\|[0-9a-f-]{36}$/;

const characters = (value: string) => Array.from(value).length;

// A text field of the form or the address: surrounding spaces go, and an empty value means "not set".
function optional<Output extends string>(schema: z.ZodType<Output, string>) {
  return z.string().trim().pipe(z.union([z.literal(""), schema]));
}

const filterFields = {
  q: optional(
    z.string().refine((value) => characters(value) <= MAX_TEXT, { error: "Use 100 characters or fewer in the keyword." }),
  ),
  country: optional(z.string().toUpperCase().regex(/^[A-Z]{2}$/, { error: "Select a country from the list." })),
  city: optional(
    z.string().refine((value) => characters(value) <= MAX_TEXT, { error: "Use 100 characters or fewer in the city." }),
  ),
  occupation: optional(z.string().regex(/^\d{4}$/, { error: "Select an occupation from the list." })),
  industry: optional(z.string().toUpperCase().regex(/^[A-Z]$/, { error: "Select an industry from the list." })),
  employment_type: optional(z.enum(employmentTypes, { error: "Select an employment type from the list." })),
  salary_min: optional(
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, { error: SALARY_FORMAT })
      .refine((value) => Number(value) > 0 && Number(value) <= MAX_SALARY, { error: SALARY_FORMAT }),
  ),
  salary_currency: optional(z.string().toUpperCase().regex(/^[A-Z]{3}$/, { error: "Select a currency from the list." })),
  salary_period: optional(z.enum(salaryPeriods, { error: "Select a pay period from the list." })),
  recruitment: optional(z.enum(["local", "international"], { error: "Select local or international recruitment." })),
};

type FilterName = keyof typeof filterFields;
const filterNames = Object.keys(filterFields) as FilterName[];

type SalaryTerms = { salary_min?: string; salary_currency?: string; salary_period?: string };

// A minimum salary only means something with its currency and pay period; the missing one is named.
function salaryIssues({ salary_min, salary_currency, salary_period }: SalaryTerms): [FilterName, string][] {
  if (!salary_min) return [];
  const issues: [FilterName, string][] = [];
  if (!salary_currency) issues.push(["salary_currency", "Select a currency for the minimum salary."]);
  if (!salary_period) issues.push(["salary_period", "Select a pay period for the minimum salary."]);
  return issues;
}

// The form checks the same fields as the address, so a value the form accepts is one the address can carry. Its values
// stay text (an empty one is "not set") so that what it validates is what it edits.
export const searchFormSchema = z.object({ ...filterFields, accommodation: z.boolean(), visa_support: z.boolean() }).check(
  (context) => {
    for (const [path, message] of salaryIssues(context.value)) {
      context.issues.push({ code: "custom", input: context.value, path: [path], message });
    }
  },
);

export type SearchFormInput = z.input<typeof searchFormSchema>;
type SearchFormValues = z.output<typeof searchFormSchema>;

export type JobSearchFilters = {
  q?: string;
  country?: string;
  city?: string;
  occupation?: string;
  industry?: string;
  employment_type?: Exclude<SearchFormValues["employment_type"], "">;
  salary_min?: number;
  salary_currency?: string;
  salary_period?: Exclude<SearchFormValues["salary_period"], "">;
  accommodation?: true;
  visa_support?: true;
  recruitment?: Exclude<SearchFormValues["recruitment"], "">;
  cursor?: string;
  limit: number;
};

type SearchParamName = FilterName | "cursor";
type SearchErrors = Partial<Record<SearchParamName, string>>;

// The filters of a validated form: what is empty is not a filter, and the currency and the pay period are only
// carried with a minimum salary.
export function formFilters(values: Partial<SearchFormValues>): JobSearchFilters {
  const salary = values.salary_min ? Number(values.salary_min) : undefined;
  return {
    q: values.q || undefined,
    country: values.country || undefined,
    city: values.city || undefined,
    occupation: values.occupation || undefined,
    industry: values.industry || undefined,
    employment_type: values.employment_type || undefined,
    salary_min: salary,
    salary_currency: salary === undefined ? undefined : values.salary_currency || undefined,
    salary_period: salary === undefined ? undefined : values.salary_period || undefined,
    accommodation: values.accommodation || undefined,
    visa_support: values.visa_support || undefined,
    recruitment: values.recruitment || undefined,
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

// An address is shared and typed by hand, so nothing in it is trusted: a value that does not parse is dropped and
// reported under the name of its parameter, the others are kept, and parameters that are not filters are ignored.
export function parseSearchParams(raw: RawParams): { filters: JobSearchFilters; errors: SearchErrors } {
  const errors: SearchErrors = {};
  const given: Record<string, string> = {};
  for (const name of filterNames) {
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
  const values = urlFields.parse(given);

  const issues = salaryIssues(values);
  for (const [name, message] of issues) errors[name] ??= message;
  const filters: JobSearchFilters = {
    ...formFilters({
      ...values,
      salary_min: issues.length === 0 ? values.salary_min : "",
      accommodation: first(raw.accommodation) === "true",
      visa_support: first(raw.visa_support) === "true",
    }),
    limit: parseLimit(first(raw.limit)),
  };

  const cursor = first(raw.cursor);
  if (cursor !== undefined) {
    if (CURSOR.test(cursor)) filters.cursor = cursor;
    else errors.cursor = "The page link is not valid, so the first page is shown.";
  }
  return { filters, errors };
}

const QUERY_ORDER = [
  "q", "country", "city", "occupation", "industry", "employment_type", "salary_min", "salary_currency", "salary_period",
  "accommodation", "visa_support", "recruitment", "cursor",
] as const satisfies readonly (keyof JobSearchFilters)[];

// The inverse of parseSearchParams for a valid filter set; a limit equal to the default is not written.
export function searchQuery(filters: JobSearchFilters): string {
  const params = new URLSearchParams();
  for (const name of QUERY_ORDER) {
    const value = filters[name];
    if (value !== undefined) params.set(name, String(value));
  }
  if (filters.limit !== SEARCH_DEFAULT_LIMIT) params.set("limit", String(filters.limit));
  return params.toString();
}

// The names of the filters that are set; the page cursor and the page size are not filters.
export function usedFilters(filters: JobSearchFilters): string[] {
  return QUERY_ORDER.filter((name) => name !== "cursor" && filters[name] !== undefined);
}

export function searchPath(lang: string, filters: JobSearchFilters): string {
  const query = searchQuery(filters);
  return query === "" ? `/${lang}/jobs` : `/${lang}/jobs?${query}`;
}

// The values the form shows for the filters in an address (without the page cursor).
export function formDefaults(query: string): SearchFormInput {
  const { filters } = parseSearchParams(Object.fromEntries(new URLSearchParams(query)));
  return {
    q: filters.q ?? "",
    country: filters.country ?? "",
    city: filters.city ?? "",
    occupation: filters.occupation ?? "",
    industry: filters.industry ?? "",
    employment_type: filters.employment_type ?? "",
    salary_min: filters.salary_min === undefined ? "" : String(filters.salary_min),
    salary_currency: filters.salary_currency ?? "",
    salary_period: filters.salary_period ?? "",
    accommodation: filters.accommodation ?? false,
    visa_support: filters.visa_support ?? false,
    recruitment: filters.recruitment ?? "",
  };
}
