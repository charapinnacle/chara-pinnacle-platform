import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import type { JobOrderFilters } from "@/lib/job-orders/search-params";
import { createClient } from "@/lib/supabase/server";

type Enums = Database["public"]["Enums"];

export const jobOrderReasons = ["served_country_missing", "occupation_missing", "plan_required"] as const;
export type JobOrderReason = (typeof jobOrderReasons)[number];

// The refusals of private.assert_job_order_partner that a member of a recruitment or staffing company can meet: its
// company is not listed (yet, or declined), hidden by moderation or suspended. Each is a state of the page.
const refusalReasons = ["not_listed", "profile_hidden", "organization_suspended"] as const;
export type JobOrderRefusal = (typeof refusalReasons)[number];

const reasonsSchema = z.array(z.enum(jobOrderReasons));
const occupationsSchema = z.array(z.object({ code: z.string(), name: z.string(), quantity: z.number() })).nullable();

// What list_job_orders returns for one job order, and nothing more (NFR-S11): the employer's name and company page only
// when the database names them. A reduced row (eligible false) holds the title, the main destination, the workers and
// the reasons; every other field is null.
export type JobOrderSummary = {
  id: string;
  eligible: boolean;
  reasons: JobOrderReason[];
  title: string;
  countryCode: string;
  workersNeeded: number;
  countries: string[];
  cityRegion: string | null;
  industryCode: string | null;
  occupations: { code: string; name: string; quantity: number }[];
  startDate: string | null;
  employmentType: Enums["employment_type"] | null;
  recruitmentPreference: Enums["recruitment_preference"] | null;
  publishedOn: string | null;
  responseCount: number | null;
  responsesFewerThan: number | null;
  employerName: string | null;
  employerCompanySlug: string | null;
};

export type JobOrder = JobOrderSummary & {
  skills: string | null;
  experienceYears: number | null;
  durationMonths: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: Enums["salary_period"] | null;
  accommodation: boolean | null;
  workPermitSupport: boolean | null;
  visaSupport: boolean | null;
  partnerNeed: Enums["partner_need"] | null;
  closesOn: string | null;
};

type Refused = { state: "refused"; reason: JobOrderRefusal } | { state: "rate_limited" };

export type JobOrderList = { state: "found"; orders: JobOrderSummary[]; nextCursor: string | null } | Refused;
export type JobOrderRead = { state: "found"; order: JobOrder } | { state: "closed" } | { state: "not_found" } | Refused;

type Failure = { message: string; details?: string | null };

function refusal(error: Failure): Refused | null {
  if (error.message === "CHARA_RATE_LIMITED") return { state: "rate_limited" };
  const reason = refusalReasons.find((value) => value === error.details);
  return error.message === "CHARA_FORBIDDEN" && reason ? { state: "refused", reason } : null;
}

type ListRow = Database["public"]["Functions"]["list_job_orders"]["Returns"][number];

function summary(row: Omit<ListRow, "next_cursor">): JobOrderSummary {
  return {
    id: row.id,
    eligible: row.eligible,
    reasons: reasonsSchema.parse(row.reasons ?? []),
    title: row.title,
    countryCode: row.country_code,
    workersNeeded: row.workers_needed,
    countries: row.countries ?? [],
    cityRegion: row.city_region ?? null,
    industryCode: row.industry_code ?? null,
    occupations: occupationsSchema.parse(row.occupations ?? null) ?? [],
    startDate: row.start_date ?? null,
    employmentType: row.employment_type ?? null,
    recruitmentPreference: row.recruitment_preference ?? null,
    publishedOn: row.published_on ?? null,
    responseCount: row.response_count ?? null,
    responsesFewerThan: row.responses_fewer_than ?? null,
    employerName: row.employer_name ?? null,
    employerCompanySlug: row.employer_company_slug ?? null,
  };
}

// One page of the marketplace for the partner organisationId (FR-N1). The page checks the filters first, so a refusal
// for its input is a failure here, for the route's error boundary, as any other error.
export async function listJobOrders(organizationId: string, filters: JobOrderFilters): Promise<JobOrderList> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_job_orders", {
    p_org: organizationId,
    p_destination: filters.destination,
    p_source: filters.source,
    p_occupation: filters.occupation,
    p_industry: filters.industry,
    p_workers_min: filters.workers_min,
    p_workers_max: filters.workers_max,
    p_start_from: filters.start_from,
    p_start_to: filters.start_to,
    p_recruitment: filters.recruitment,
    p_cursor: filters.cursor,
    p_limit: filters.limit,
  });
  if (error) {
    const refused = refusal(error);
    if (refused) return refused;
    throw new Error("The job orders could not be loaded", { cause: error });
  }
  return { state: "found", orders: data.map(summary), nextCursor: data.at(-1)?.next_cursor ?? null };
}

// One job order for the partner organisationId: the full or reduced job order, closed (no longer open, with nothing of
// it), or not found (never on the marketplace).
export async function getJobOrder(organizationId: string, id: string): Promise<JobOrderRead> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_job_order", { p_org: organizationId, p_requirement: id });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return { state: "not_found" };
    const refused = refusal(error);
    if (refused) return refused;
    throw new Error("The job order could not be loaded", { cause: error });
  }
  const [row] = data;
  if (!row) return { state: "not_found" };
  if (!row.open) return { state: "closed" };
  return {
    state: "found",
    order: {
      ...summary(row),
      skills: row.skills ?? null,
      experienceYears: row.experience_years ?? null,
      durationMonths: row.duration_months ?? null,
      salaryMin: row.salary_min ?? null,
      salaryMax: row.salary_max ?? null,
      salaryCurrency: row.salary_currency ?? null,
      salaryPeriod: row.salary_period ?? null,
      accommodation: row.accommodation ?? null,
      workPermitSupport: row.work_permit_support ?? null,
      visaSupport: row.visa_support ?? null,
      partnerNeed: row.partner_need ?? null,
      closesOn: row.closes_on ?? null,
    },
  };
}
