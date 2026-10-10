import type { Browser, Locator, Page } from "@playwright/test";
import { seedListApplicant } from "./applicant-list";
import { execute, literal } from "./db";
import { addCompanyUser, type Company } from "./jobs";
import { logIn } from "./login-page";
import { enterCode } from "./mfa";
import { signInBrowser } from "./session";
import type { Team } from "./team";
import { expect } from "./test";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const dashboardUrl = (slug: string) => `/en/dashboard/employer?org=${slug}`;

export const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
export const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

interface SubscriptionDates {
  trialEndsAt?: string;
  currentPeriodEnd?: string;
  cancelAt?: string;
  pastDueSince?: string;
}

// A subscription as the billing webhook would have left it, with the dates the dashboard shows.
export function seedSubscription(company: Company, plan: string, status: string, dates: SubscriptionDates = {}): void {
  const value = (iso?: string) => (iso ? `${literal(iso)}::timestamptz` : "null");
  execute(
    `insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at, current_period_end, cancel_at, past_due_since)
     values (${literal(company.id)}, ${literal(plan)}, ${literal(status)}, 'null', ${value(dates.trialEndsAt)},
             ${value(dates.currentPeriodEnd)}, ${value(dates.cancelAt)}, ${value(dates.pastDueSince)})`,
  );
}

// An application of the vacancy made some time ago, at any stage; the candidate belongs to no account.
export function seedApplicationAgo(company: Company, jobId: string, status: string, agoMs: number, name = "Cand Seeded"): string {
  return seedListApplicant(company, jobId, { name, status, appliedAt: ago(agoMs), completeness: 50 });
}

export function softDeleteJob(jobId: string): void {
  execute(`update public.jobs set deleted_at = now() where id = ${literal(jobId)}`);
}

export const card = (page: Page, name: string | RegExp): Locator => page.getByRole("main").getByRole("link", { name });

// The count of each stage in the table of the dashboard, in the order of the rows.
export async function stageRows(page: Page): Promise<string[][]> {
  const table = page.getByRole("table", { name: "Applicants by stage" });
  await expect(table).toBeVisible();
  return table.locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) => Array.from(row.querySelectorAll("th, td")).map((cell) => (cell.textContent ?? "").trim())),
  );
}

// The owner of the team on the dashboard at aal2: the login lands on the dashboard at aal1, which asks for the code.
export async function openDashboardAtAal2(page: Page, team: Team): Promise<void> {
  await page.context().clearCookies();
  await logIn(page, team.owner, dashboardUrl(team.slug));
  await page.getByRole("link", { name: "Enter your code" }).click();
  await enterCode(page, team.ownerSecret);
  await expect(page).toHaveURL(dashboardUrl(team.slug));
  await expect(page.getByRole("link", { name: /^Open vacancies/ })).toBeVisible();
}

// A plain member of the organization in a browser of its own.
export async function memberPage(browser: Browser, company: Company) {
  const member = await addCompanyUser(company, "member");
  const context = await browser.newContext();
  await signInBrowser(context, member);
  return { member, context, page: await context.newPage() };
}
