import * as z from "zod";
import type { Database } from "@chara-pinnacle/db-types";
import { employmentTypes, salaryPeriods } from "@/lib/validation/job";

// What the visibility switch says it does (FR-K5 AC9).
export const COMPANY_PAGE_DESCRIPTION =
  "Shows your company details, open vacancies and named job orders to everyone. Anonymous job orders are never shown.";

type PageRow = Database["public"]["Functions"]["get_company_page"]["Returns"][number];
type MemberRole = Database["public"]["Enums"]["member_role"];

const vacancySchema = z.object({
  id: z.string(),
  title: z.string(),
  city: z.string(),
  country_code: z.string(),
  country: z.string(),
  employment_type: z.enum(employmentTypes),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  salary_currency: z.string().nullable(),
  salary_period: z.enum(salaryPeriods).nullable(),
  published_at: z.string(),
});

// A named job order of the company (FR-K5 AC3, V54): the id only for a member of a listed partner, who may open it.
const jobOrderSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  country_code: z.string(),
  country: z.string(),
  workers_needed: z.number().int(),
  published_on: z.string(),
});

export type CompanyJobOrder = {
  id: string | null;
  title: string;
  country: string;
  workersNeeded: number;
  publishedOn: string;
};

export type CompanyVacancy = {
  id: string;
  title: string;
  city: string;
  country: string;
  employmentType: z.infer<typeof vacancySchema>["employment_type"];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: z.infer<typeof vacancySchema>["salary_period"];
  publishedAt: string;
};

// The public company page of an employer (FR-K5): the fields get_company_page returns, nothing else.
export type CompanyPage = {
  slug: string;
  displayName: string;
  basedIn: { code: string; name: string };
  industry: { code: string; name: string } | null;
  website: string | null;
  description: string | null;
  openVacancyCount: number;
  vacancies: CompanyVacancy[];
  jobOrderCount: number;
  jobOrders: CompanyJobOrder[];
};

// The row of get_company_page; the generated types call every column required, but the optional ones come back as null.
export function companyPageFrom(row: Omit<PageRow, "viewer_role" | "viewer_partner_slug">): CompanyPage {
  return {
    slug: row.slug,
    displayName: row.display_name,
    basedIn: { code: row.based_in_country, name: row.based_in_country_name },
    industry: row.industry_code && row.industry_name ? { code: row.industry_code, name: row.industry_name } : null,
    website: row.website ?? null,
    description: row.description ?? null,
    openVacancyCount: row.open_vacancy_count,
    vacancies: z
      .array(vacancySchema)
      .parse(row.vacancies)
      .map((vacancy) => ({
        id: vacancy.id,
        title: vacancy.title,
        city: vacancy.city,
        country: vacancy.country,
        employmentType: vacancy.employment_type,
        salaryMin: vacancy.salary_min,
        salaryMax: vacancy.salary_max,
        salaryCurrency: vacancy.salary_currency,
        salaryPeriod: vacancy.salary_period,
        publishedAt: vacancy.published_at,
      })),
    jobOrderCount: row.job_order_count,
    jobOrders: z
      .array(jobOrderSchema)
      .parse(row.job_orders)
      .map((jobOrder) => ({
        id: jobOrder.id ?? null,
        title: jobOrder.title,
        country: jobOrder.country,
        workersNeeded: jobOrder.workers_needed,
        publishedOn: jobOrder.published_on,
      })),
  };
}

// What the page offers the viewer (FR-K5 AC8): an owner or administrator manages the page, a member of the company only
// reads it, everyone else may report it.
export type CompanyViewer = "manager" | "member" | "outsider";

export function companyViewerOf(role: MemberRole | null | undefined): CompanyViewer {
  if (role === "owner" || role === "admin") return "manager";
  return role === "member" ? "member" : "outsider";
}
