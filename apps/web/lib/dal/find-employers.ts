import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { jobOrderReasons } from "@/lib/dal/job-orders";
import type { FindEmployersFilters } from "@/lib/find-employers/search-params";
import { createClient } from "@/lib/supabase/server";

// The refusals of private.assert_employer_search_partner that a member of a recruitment or staffing company can meet,
// each a state of the page: not listed (yet, or declined), hidden, suspended, or a plan without employer discovery.
const refusalReasons = ["not_listed", "profile_hidden", "organization_suspended"] as const;
export type FindEmployersRefusal = (typeof refusalReasons)[number] | "plan_required";

const jobOrderSchema = z.object({
  id: z.string(),
  eligible: z.boolean(),
  reasons: z.array(z.enum(jobOrderReasons)),
  title: z.string(),
  country_code: z.string(),
  workers_needed: z.number(),
  industry_code: z.string().nullable(),
  published_on: z.string().nullable(),
});

export type EmployerJobOrder = {
  id: string;
  eligible: boolean;
  reasons: z.infer<typeof jobOrderSchema>["reasons"];
  title: string;
  countryCode: string;
  workersNeeded: number;
  industryCode: string | null;
  publishedOn: string | null;
};

// A result of search_employers as the database returns it to this partner, and nothing more (NFR-S11): a company, with
// its page fields only while the page is public, or an open job order whose employer is not named, with no employer
// field at all.
export type EmployerResult =
  | {
      kind: "company";
      employerId: string;
      displayName: string;
      slug: string | null;
      website: string | null;
      basedInCountry: string | null;
      industryCode: string | null;
      openVacancyCount: number | null;
      jobOrderCount: number;
      jobOrders: EmployerJobOrder[];
    }
  | { kind: "job_order"; jobOrder: EmployerJobOrder };

type Refused = { state: "refused"; reason: FindEmployersRefusal } | { state: "rate_limited" } | { state: "advanced_required" };

// cursorIgnored: the page link named no result (one that left the search, or a made-up id), so the first page is shown.
export type EmployerSearch = { state: "found"; results: EmployerResult[]; nextCursor: string | null; cursorIgnored: boolean } | Refused;

type Failure = { message: string; details?: string | null };

function refusal(error: Failure): Refused | null {
  if (error.message === "CHARA_RATE_LIMITED") return { state: "rate_limited" };
  if (error.message === "CHARA_FEATURE_NOT_IN_PLAN") {
    return error.details === "employer_discovery" ? { state: "refused", reason: "plan_required" } : { state: "advanced_required" };
  }
  const reason = refusalReasons.find((value) => value === error.details);
  return error.message === "CHARA_FORBIDDEN" && reason ? { state: "refused", reason } : null;
}

export type EmployerSearchAccess = { state: "allowed"; advanced: boolean } | { state: "refused"; reason: FindEmployersRefusal };

// Whether the company may search and with which filters (FR-L3 AC8, AC9), before the page shows its form.
export async function getEmployerSearchAccess(organizationId: string): Promise<EmployerSearchAccess> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("employer_search_access", { p_org: organizationId });
  if (error) {
    const refused = refusal(error);
    if (refused?.state === "refused") return refused;
    throw new Error("Find Employers could not be loaded", { cause: error });
  }
  return { state: "allowed", advanced: data };
}

type Row = Database["public"]["Functions"]["search_employers"]["Returns"][number];

function jobOrder(value: unknown): EmployerJobOrder {
  const row = jobOrderSchema.parse(value);
  return {
    id: row.id,
    eligible: row.eligible,
    reasons: row.reasons,
    title: row.title,
    countryCode: row.country_code,
    workersNeeded: row.workers_needed,
    industryCode: row.industry_code,
    publishedOn: row.published_on,
  };
}

function result(row: Row): EmployerResult {
  const orders = z.array(z.unknown()).parse(row.job_orders).map(jobOrder);
  if (row.kind === "job_order") return { kind: "job_order", jobOrder: orders[0] };
  return {
    kind: "company",
    employerId: row.employer_id,
    displayName: row.display_name,
    slug: row.slug ?? null,
    website: row.website ?? null,
    basedInCountry: row.based_in_country ?? null,
    industryCode: row.industry_code ?? null,
    openVacancyCount: row.open_vacancy_count ?? null,
    jobOrderCount: row.job_order_count,
    jobOrders: orders,
  };
}

// One page of Find Employers for the partner organizationId (FR-L3). The page checks the filters first, so a refusal for
// its input is a failure here, for the route's error boundary, as any other error.
export async function searchEmployers(organizationId: string, filters: FindEmployersFilters): Promise<EmployerSearch> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_employers", {
    p_org: organizationId,
    p_destination: filters.destination,
    p_industry: filters.industry,
    p_occupation: filters.occupation,
    p_min_workers: filters.min_workers,
    p_cursor: filters.cursor,
    p_limit: filters.limit,
  });
  if (error) {
    if (error.message === "CHARA_INVALID_INPUT" && error.details === "p_cursor" && filters.cursor !== undefined) {
      const firstPage = await searchEmployers(organizationId, { ...filters, cursor: undefined });
      return firstPage.state === "found" ? { ...firstPage, cursorIgnored: true } : firstPage;
    }
    const refused = refusal(error);
    if (refused) return refused;
    throw new Error("The employers could not be loaded", { cause: error });
  }
  return { state: "found", results: data.map(result), nextCursor: data.at(-1)?.next_cursor ?? null, cursorIgnored: false };
}

export type SavedSearch = {
  id: string;
  destination: string | null;
  industry: string | null;
  occupation: string | null;
  minWorkers: number | null;
};

// The searches the partner organizationId saved, newest first; row level security answers its members only.
export async function listSavedSearches(organizationId: string): Promise<SavedSearch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_searches")
    .select("id, destination_country, industry_code, occupation_id, min_workers")
    .eq("organization_id", organizationId)
    .eq("kind", "employers")
    .order("created_at", { ascending: false })
    .order("id");
  if (error) throw new Error("The saved searches could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    destination: row.destination_country,
    industry: row.industry_code,
    occupation: row.occupation_id,
    minWorkers: row.min_workers,
  }));
}
