import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import type { QueryData } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { formatJobCursor, type JobCursor } from "@/lib/validation/job";

type Enums = Database["public"]["Enums"];
type Client = Awaited<ReturnType<typeof createClient>>;

export const JOBS_PAGE_SIZE = 20;

export type Job = {
  id: string;
  title: string;
  description: string;
  occupation: string;
  industry: string;
  country: string;
  city: string;
  employmentType: Enums["employment_type"];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: Enums["salary_period"] | null;
  accommodation: boolean;
  visaSupport: boolean;
  recruitmentPreference: Enums["recruitment_preference"];
  status: Enums["job_status"];
  moderationState: Enums["job_moderation_state"];
  createdAt: string;
};

export type JobSummary = {
  id: string;
  title: string;
  city: string;
  country: string;
  status: Enums["job_status"];
  moderationState: Enums["job_moderation_state"];
  createdAt: string;
};

export type Employer = { displayName: string; country: string; website: string | null };

type JobPage = { jobs: JobSummary[]; nextCursor: string | null };

const selectJob = (supabase: Client) =>
  supabase
    .from("jobs")
    .select(
      "id, title, description, occupation_id, industry_code, country_code, city, employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation, visa_support, recruitment_preference, status, moderation_state, created_at, occupations(label), industries(name), countries(name)",
    );

type JobRow = QueryData<ReturnType<typeof selectJob>>[number];

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    occupation: row.occupations?.label ?? row.occupation_id,
    industry: row.industries?.name ?? row.industry_code,
    country: row.countries?.name ?? row.country_code,
    city: row.city,
    employmentType: row.employment_type,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency,
    salaryPeriod: row.salary_period,
    accommodation: row.accommodation,
    visaSupport: row.visa_support,
    recruitmentPreference: row.recruitment_preference,
    status: row.status,
    moderationState: row.moderation_state,
    createdAt: row.created_at,
  };
}

// A vacancy of the organization in any status, for its members; the policy lets nobody else read a draft.
export async function getJob(organizationId: string, id: string): Promise<Job | null> {
  const supabase = await createClient();
  const { data, error } = await selectJob(supabase)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error("The vacancy could not be loaded", { cause: error });
  return data && toJob(data);
}

// The conditions repeat the public read policy, because a member's session would otherwise also read a draft here.
export async function getPublicJob(id: string): Promise<Job | null> {
  const supabase = await createClient();
  const { data, error } = await selectJob(supabase)
    .eq("id", id)
    .eq("status", "open")
    .eq("moderation_state", "visible")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error("The vacancy could not be loaded", { cause: error });
  return data && toJob(data);
}

// Newest first, in keyset pages of JOBS_PAGE_SIZE; one row more is read to know whether a next page exists.
export async function listJobs(organizationId: string, cursor: JobCursor | null): Promise<JobPage> {
  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select("id, title, city, status, moderation_state, created_at, countries(name)")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(JOBS_PAGE_SIZE + 1);
  if (cursor) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }
  const { data, error } = await query;
  if (error) throw new Error("The vacancies could not be loaded", { cause: error });
  const page = data.slice(0, JOBS_PAGE_SIZE).map((row) => ({
    id: row.id,
    title: row.title,
    city: row.city,
    country: row.countries?.name ?? "",
    status: row.status,
    moderationState: row.moderation_state,
    createdAt: row.created_at,
  }));
  const last = page[page.length - 1];
  return {
    jobs: page,
    nextCursor: data.length > JOBS_PAGE_SIZE ? formatJobCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

export async function getEmployer(organizationId: string): Promise<Employer | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("display_name, website, countries(name)")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error("The employer could not be loaded", { cause: error });
  return data && { displayName: data.display_name, country: data.countries?.name ?? "", website: data.website };
}
