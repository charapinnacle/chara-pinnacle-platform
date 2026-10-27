import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import type { QueryData } from "@supabase/supabase-js";
import { featurePlanName } from "@/lib/billing/limits";
import { listPublicPlans } from "@/lib/dal/pricing";
import { getPublicSettings } from "@/lib/dal/settings";
import { MULTI_COUNTRY_FEATURE } from "@/lib/requirements/limits";
import type { RequirementDurations } from "@/lib/requirements/lifecycle";
import { createClient } from "@/lib/supabase/server";
import { formatJobCursor, type JobCursor } from "@/lib/validation/job";
import type { RequirementFormInput } from "@/lib/validation/requirement";

type Enums = Database["public"]["Enums"];
type Client = Awaited<ReturnType<typeof createClient>>;

export const REQUIREMENTS_PAGE_SIZE = 20;

export type RequirementSummary = {
  id: string;
  title: string;
  workersNeeded: number;
  cityRegion: string;
  country: string;
  status: Enums["requirement_status"];
  createdAt: string;
};

export type Requirement = RequirementSummary & {
  countryCode: string;
  // The destinations next to the main country, by name (FR-M4).
  destinations: { code: string; name: string }[];
  industry: string;
  industryCode: string;
  occupations: { code: string; label: string; quantity: number }[];
  skills: string | null;
  experienceYears: number | null;
  startDate: string;
  durationMonths: number | null;
  employmentType: Enums["employment_type"];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: Enums["salary_period"] | null;
  accommodation: boolean;
  workPermitSupport: boolean;
  visaSupport: boolean;
  recruitmentPreference: Enums["recruitment_preference"];
  partnerNeed: Enums["partner_need"];
  visibility: Enums["requirement_visibility"] | null;
  showIdentity: boolean;
  publishedAt: string | null;
  closesOn: string | null;
  closeReason: Enums["requirement_close_reason"] | null;
  statusChangedAt: string;
  updatedAt: string;
};

// Members read the requirements of their organisation under row level security (workforce_requirements_select_member);
// nobody else reads a row, so an id of another organisation finds nothing.
export async function listRequirements(
  organizationId: string,
  cursor: JobCursor | null,
): Promise<{ requirements: RequirementSummary[]; nextCursor: string | null }> {
  const supabase = await createClient();
  let query = supabase
    .from("workforce_requirements")
    .select("id, title, workers_needed, city_region, status, created_at, countries!workforce_requirements_country_code_fkey(name)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(REQUIREMENTS_PAGE_SIZE + 1);
  if (cursor) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }
  const { data, error } = await query;
  if (error) throw new Error("The workforce requirements could not be loaded", { cause: error });
  const requirements = data.slice(0, REQUIREMENTS_PAGE_SIZE).map((row) => ({
    id: row.id,
    title: row.title,
    workersNeeded: row.workers_needed,
    cityRegion: row.city_region,
    country: row.countries?.name ?? "",
    status: row.status,
    createdAt: row.created_at,
  }));
  const last = requirements[requirements.length - 1];
  return {
    requirements,
    nextCursor: data.length > REQUIREMENTS_PAGE_SIZE ? formatJobCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

const selectRequirement = (supabase: Client) =>
  supabase
    .from("workforce_requirements")
    .select(
      "id, title, workers_needed, country_code, city_region, industry_code, skills, experience_years, start_date, duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation, work_permit_support, visa_support, recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on, close_reason, status_changed_at, created_at, updated_at, countries!workforce_requirements_country_code_fkey(name), industries(name), requirement_occupations(occupation_id, quantity, occupations(label)), requirement_countries(country_code, countries(name))",
    );

type RequirementRow = QueryData<ReturnType<typeof selectRequirement>>[number];

function toRequirement(row: RequirementRow): Requirement {
  return {
    id: row.id,
    title: row.title,
    workersNeeded: row.workers_needed,
    cityRegion: row.city_region,
    country: row.countries?.name ?? row.country_code,
    countryCode: row.country_code,
    destinations: row.requirement_countries
      .filter((item) => item.country_code !== row.country_code)
      .map((item) => ({ code: item.country_code, name: item.countries?.name ?? item.country_code }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    industry: row.industries?.name ?? row.industry_code,
    industryCode: row.industry_code,
    occupations: row.requirement_occupations
      .map((item) => ({ code: item.occupation_id, label: item.occupations?.label ?? item.occupation_id, quantity: item.quantity }))
      .sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label)),
    skills: row.skills,
    experienceYears: row.experience_years,
    startDate: row.start_date,
    durationMonths: row.duration_months,
    employmentType: row.employment_type,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency,
    salaryPeriod: row.salary_period,
    accommodation: row.accommodation,
    workPermitSupport: row.work_permit_support,
    visaSupport: row.visa_support,
    recruitmentPreference: row.recruitment_preference,
    partnerNeed: row.partner_need,
    status: row.status,
    visibility: row.visibility,
    showIdentity: row.show_identity,
    publishedAt: row.published_at,
    closesOn: row.closes_on,
    closeReason: row.close_reason,
    statusChangedAt: row.status_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getRequirement(organizationId: string, id: string): Promise<Requirement | null> {
  const supabase = await createClient();
  const { data, error } = await selectRequirement(supabase).eq("organization_id", organizationId).eq("id", id).maybeSingle();
  if (error) throw new Error("The workforce requirement could not be loaded", { cause: error });
  return data ? toRequirement(data) : null;
}

const numberText = (value: number | null) => (value === null ? "" : String(value));

export function toRequirementFormInput(requirement: Requirement): RequirementFormInput {
  return {
    title: requirement.title,
    workersNeeded: String(requirement.workersNeeded),
    country: requirement.countryCode,
    cityRegion: requirement.cityRegion,
    industry: requirement.industryCode,
    destinations: requirement.destinations.map((item) => ({ country: item.code })),
    occupations: requirement.occupations.map((item) => ({ occupation: item.code, quantity: String(item.quantity) })),
    skills: requirement.skills ?? "",
    experienceYears: numberText(requirement.experienceYears),
    startDate: requirement.startDate,
    durationMonths: numberText(requirement.durationMonths),
    employmentType: requirement.employmentType,
    salaryMin: numberText(requirement.salaryMin),
    salaryMax: numberText(requirement.salaryMax),
    salaryCurrency: requirement.salaryCurrency ?? "",
    salaryPeriod: requirement.salaryPeriod ?? "",
    accommodation: requirement.accommodation,
    workPermitSupport: requirement.workPermitSupport,
    visaSupport: requirement.visaSupport,
    recruitmentPreference: requirement.recruitmentPreference,
    partnerNeed: requirement.partnerNeed,
  };
}

// The durations of the lifecycle (FR-M2, NFR-O5), from the public settings.
export async function getRequirementDurations(): Promise<RequirementDurations> {
  const settings = await getPublicSettings();
  return {
    openDays: Number(settings.requirement_open_days),
    extensionDays: Number(settings.requirement_extension_days),
    reminderDays: Number(settings.requirement_closing_reminder_days),
  };
}

export type MultiCountryPlan = { allowed: boolean; planName: string | null };

// Whether the form offers further destination countries (the plan has multi_country_requirements, or the feature is not
// enforced for the organisation), and the first public plan that has the feature, for the prompt (FR-M4 AC4, AC9); a
// failed plan read names no plan.
export async function getMultiCountryPlan(organizationId: string): Promise<MultiCountryPlan> {
  const supabase = await createClient();
  const [{ data, error }, plans] = await Promise.all([
    supabase.rpc("requirement_multi_country", { p_org: organizationId }),
    listPublicPlans("employer").catch(() => []),
  ]);
  if (error) throw new Error("The plan of the workforce requirements could not be loaded", { cause: error });
  return { allowed: data, planName: featurePlanName(plans, MULTI_COUNTRY_FEATURE) };
}
