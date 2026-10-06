import type { Page } from "@playwright/test";
import { createCommittedUser } from "./login";
import { execute, literal, query } from "./db";
import { organizationRows, registerOrganization, uniqueName } from "./organizations";
import { expect } from "./test";
import type { TestUser } from "./test-user";

export interface Company {
  id: string;
  slug: string;
  owner: TestUser;
}

// An organization whose owner has not set up two-step verification: the vacancy pages are not gated by it.
export async function newCompany(): Promise<Company> {
  const owner = await createCommittedUser("company");
  await registerOrganization(owner, uniqueName("Vacancy Bau GmbH"), uniqueName("Vacancy Bau"));
  const [organization] = organizationRows(owner.id);
  return { id: organization.id, slug: organization.slug, owner };
}

export async function addCompanyUser(company: Company, role: "admin" | "member"): Promise<TestUser> {
  const user = await createCommittedUser("company");
  execute(
    `insert into public.organization_members (organization_id, user_id, role, accepted_at, invited_by)
     values (${literal(company.id)}, ${literal(user.id)}, ${literal(role)}, now(), ${literal(company.owner.id)})`,
  );
  return user;
}

export const jobsUrl = (slug: string) => `/en/org/${slug}/jobs`;
export const newJobUrl = (slug: string) => `${jobsUrl(slug)}/new`;
export const jobUrl = (slug: string, id: string) => `${jobsUrl(slug)}/${id}`;
export const previewUrl = (slug: string, id: string) => `${jobUrl(slug, id)}/preview`;

export const DESCRIPTION =
  "We build steel frames for halls and bridges in our Hamburg workshop and need an experienced MIG and MAG welder.";

export const FIELD_LABELS = [
  "Title",
  "Description",
  "Occupation",
  "Industry",
  "Country",
  "City",
  "Employment type",
  "Salary minimum",
  "Salary maximum",
  "Currency",
  "Pay period",
  "Accommodation provided",
  "Visa support offered",
  "Recruitment preference",
] as const;

export async function chooseFromList(page: Page, label: string, search: string, option: string | RegExp): Promise<void> {
  await page.getByRole("combobox", { name: label, exact: true }).fill(search);
  await page.getByRole("option", { name: option }).first().click();
}

export interface JobDetails {
  title: string;
  description?: string;
  salary?: { min: string; max: string; currency?: string; period?: string } | null;
}

// The values of FR-C1 AC1; the salary can be left out.
export async function fillJob(page: Page, { title, description = DESCRIPTION, salary }: JobDetails): Promise<void> {
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Description", { exact: true }).fill(description);
  await chooseFromList(page, "Occupation", "weld", "Welders and flame cutters");
  await chooseFromList(page, "Industry", "Manufacturing", "Manufacturing");
  await chooseFromList(page, "Country", "Germany", /^Germany$/);
  await page.getByLabel("City", { exact: true }).fill("Hamburg");
  await page.getByLabel("Employment type").selectOption({ value: "full_time" });
  if (salary !== null) {
    const { min, max, currency = "EUR", period = "month" } = salary ?? { min: "2800", max: "3400" };
    await page.getByLabel("Salary minimum").fill(min);
    await page.getByLabel("Salary maximum").fill(max);
    await chooseFromList(page, "Currency", currency, new RegExp(`^${currency} `));
    await page.getByLabel("Pay period").selectOption({ value: period });
  }
  await page.getByLabel("Accommodation provided").check();
  await page.getByLabel("Visa support offered").check();
  await page.getByLabel("Recruitment preference").selectOption({ value: "both" });
}

export function jobRows(organizationId: string) {
  return query<{
    id: string;
    title: string;
    description: string;
    occupation_id: string;
    industry_code: string;
    country_code: string;
    city: string;
    employment_type: string;
    salary_min: string | null;
    salary_max: string | null;
    salary_currency: string | null;
    salary_period: string | null;
    accommodation: boolean;
    visa_support: boolean;
    recruitment_preference: string;
    status: string;
    moderation_state: string;
    deleted_at: string | null;
    created_by: string | null;
    posted_on_behalf_of_organization_id: string | null;
    organization_id: string;
  }>(
    `select id, title, description, occupation_id, industry_code, country_code, city, employment_type::text,
            salary_min::text, salary_max::text, salary_currency, salary_period::text, accommodation, visa_support,
            recruitment_preference::text, status::text, moderation_state::text, deleted_at, created_by,
            posted_on_behalf_of_organization_id, organization_id
     from public.jobs where organization_id = ${literal(organizationId)} order by created_at, id`,
  );
}

export function jobAudit(organizationId: string, action: string) {
  return query<{ actor_id: string | null; entity_id: string; metadata: Record<string, unknown> }>(
    `select actor_id, entity_id, metadata from audit.log
     where action = ${literal(action)}
       and (metadata ->> 'organization_id' = ${literal(organizationId)} or entity_id = ${literal(organizationId)})
     order by id`,
  );
}

export interface Salary {
  min: number | null;
  max: number | null;
  currency: string;
  period: string;
}

// A vacancy as an administrator would have saved it, written by the database owner so that a test can give it any status.
export function seedJob(
  company: Company,
  {
    title = "Seeded welder",
    status = "draft",
    moderation = "visible",
    createdAt = "now()",
    statusChangedAt = "now()",
    country = "DE",
    city = "Hamburg",
    employment = "full_time",
    salary = null,
    accommodation = false,
    visaSupport = false,
  }: {
    title?: string;
    status?: string;
    moderation?: string;
    createdAt?: string;
    statusChangedAt?: string;
    country?: string;
    city?: string;
    employment?: string;
    salary?: Salary | null;
    accommodation?: boolean;
    visaSupport?: boolean;
  } = {},
): string {
  const amount = (value: number | null | undefined) => (value === null || value === undefined ? "null" : String(value));
  const output = execute(
    `insert into public.jobs (organization_id, title, description, occupation_id, industry_code, country_code, city,
        employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation, visa_support,
        recruitment_preference, status, moderation_state, created_by, created_at, status_changed_at)
     values (${literal(company.id)}, ${literal(title)}, ${literal("Line one of the description.\nLine two of it, which is long enough to pass the limit.")},
        '7212', 'C', ${literal(country)}, ${literal(city)}, ${literal(employment)}, ${amount(salary?.min)}, ${amount(salary?.max)},
        ${salary ? literal(salary.currency) : "null"}, ${salary ? literal(salary.period) : "null"}, ${accommodation}, ${visaSupport},
        'both', ${literal(status)}, ${literal(moderation)}, ${literal(company.owner.id)}, ${createdAt}, ${statusChangedAt})
     returning id`,
  );
  return output.trim();
}

export async function expectDraftBanner(page: Page): Promise<void> {
  await expect(page.getByRole("status").filter({ hasText: "Draft - not public" })).toBeVisible();
}

export function statusAudit(jobId: string) {
  return query<{ actor_id: string | null; metadata: { from: string; to: string; actor_fn?: string } }>(
    `select actor_id, metadata - 'organization_id' as metadata from audit.log
     where action = 'job.status_changed' and entity_id = ${literal(jobId)} order by id`,
  );
}

export function jobStatus(jobId: string): string {
  return execute(`select status from public.jobs where id = ${literal(jobId)}`).trim();
}
