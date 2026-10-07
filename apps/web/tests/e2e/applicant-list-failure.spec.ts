import { applicantsUrl, listRows, seedListApplicant } from "./support/applicant-list";
import { execute, executeAsync } from "./support/db";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

const VIEW = "public.v_job_applicants";

// The table is locked for the whole database in the first test and the view is withdrawn from the API role in the second,
// so this file has a project of its own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  execute(`grant select on ${VIEW} to authenticated`);
});

async function setup(browser: import("@playwright/test").Browser) {
  const company = await newCompany();
  const job = seedJob(company, { title: "Failing welder", status: "open" });
  seedListApplicant(company, job, { name: "Ana Silva", appliedAt: "2026-09-04T10:00:00Z", completeness: 80 });
  const context = await browser.newContext();
  await signInBrowser(context, await addCompanyUser(company, "member"));
  return { company, job, context, page: await context.newPage() };
}

test.describe("the applicant list when the database is slow or fails", () => {
  test("FR-E1 AC7: a skeleton of rows shows while the query is delayed and the list replaces it", async ({ browser }) => {
    const { company, job, context, page } = await setup(browser);
    const held = executeAsync("begin; lock table public.job_applications in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await page.goto(applicantsUrl(company.slug, `?job=${job}`), { waitUntil: "commit" });
    await expect(page.getByRole("status").getByText("Loading")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(listRows(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByRole("status").getByText("Loading")).toHaveCount(0);
    await held;
    await context.close();
  });

  test("FR-E1 AC7: a failed query shows an error with a toast and Try again, and no partial data", async ({ browser }) => {
    const { company, job, context, page } = await setup(browser);
    execute(`revoke select on ${VIEW} from authenticated`);

    await page.goto(applicantsUrl(company.slug, `?job=${job}`));
    await expect(page.getByRole("heading", { name: "The applicants could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.", { exact: true })).toBeVisible();
    await expect(page.getByText("Ana Silva")).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText(/permission denied|v_job_applicants/)).toHaveCount(0);

    execute(`grant select on ${VIEW} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(listRows(page)).toHaveCount(1);
    await context.close();
  });
});
