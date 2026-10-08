import type { Browser } from "@playwright/test";
import { card, dashboardUrl, seedApplicationAgo, stageRows, HOUR } from "./support/dashboard";
import { execute, executeAsync } from "./support/db";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

const FUNCTION = "public.get_dashboard_applications(uuid)";
const PLAN_FUNCTION = "public.get_dashboard_plan(uuid)";

// The applications table is locked for the whole database in the first test and the function is withdrawn from the API
// role in the second, so this file has a project of its own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  execute(`grant execute on function ${FUNCTION} to authenticated`);
  execute(`grant execute on function ${PLAN_FUNCTION} to authenticated`);
});

async function setup(browser: Browser) {
  const company = await newCompany();
  const job = seedJob(company, { title: "Failing welder", status: "open" });
  seedApplicationAgo(company, job, "applied", HOUR);
  seedApplicationAgo(company, job, "hired", 40 * HOUR);
  const context = await browser.newContext();
  await signInBrowser(context, await addCompanyUser(company, "member"));
  return { company, context, page: await context.newPage() };
}

test.describe("the employer dashboard when the database is slow or fails", () => {
  test("FR-E5 AC10: each card that waits shows a skeleton while the others show their numbers, and the numbers replace the skeletons", async ({ browser }) => {
    const { company, context, page } = await setup(browser);
    const held = executeAsync("begin; lock table public.job_applications in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await page.goto(dashboardUrl(company.slug), { waitUntil: "commit" });
    await expect(card(page, "Open vacancies: 1")).toBeVisible();
    await expect(page.getByRole("region", { name: "Plan" })).toContainText("Free plan");
    await expect(page.getByRole("status").getByText("Loading")).toHaveCount(2);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(card(page, /^New applications/)).toHaveCount(0);

    await expect(card(page, "New applications in the last 7 days: 2")).toBeVisible({ timeout: 15_000 });
    expect((await stageRows(page))[0]).toEqual(["Applied", "1"]);
    await expect(page.getByRole("status").getByText("Loading")).toHaveCount(0);
    await held;
    await context.close();
  });

  test("FR-E5 AC10: a card whose query fails shows an error with a toast and Try again, the others keep their numbers, and Try again reads them again", async ({ browser }) => {
    const { company, context, page } = await setup(browser);
    execute(`revoke execute on function ${FUNCTION} from authenticated`);

    await page.goto(dashboardUrl(company.slug));
    await expect(page.getByRole("heading", { name: "The new applications could not be counted", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The applicants by stage could not be counted", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.").first()).toBeVisible();
    await expect(card(page, "Open vacancies: 1")).toBeVisible();
    await expect(page.getByRole("region", { name: "Plan" })).toContainText("Free plan");
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText(/permission denied|get_dashboard_applications/)).toHaveCount(0);

    execute(`grant execute on function ${FUNCTION} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).first().click();
    await expect(card(page, "New applications in the last 7 days: 2")).toBeVisible();
    expect((await stageRows(page))[0]).toEqual(["Applied", "1"]);
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await context.close();
  });

  test("FR-E5 AC10: the Open vacancies card shows a skeleton while the vacancies are read, and the others show their numbers", async ({ browser }) => {
    const { company, context, page } = await setup(browser);
    const held = executeAsync("begin; lock table public.jobs in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await page.goto(dashboardUrl(company.slug), { waitUntil: "commit" });
    await expect(card(page, "New applications in the last 7 days: 2")).toBeVisible();
    expect((await stageRows(page))[0]).toEqual(["Applied", "1"]);
    await expect(page.getByRole("region", { name: "Plan" })).toContainText("Free plan");
    await expect(page.getByRole("status").getByText("Loading")).toHaveCount(1);
    await expect(card(page, /^Open vacancies/)).toHaveCount(0);

    await expect(card(page, "Open vacancies: 1")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status").getByText("Loading")).toHaveCount(0);
    await held;
    await context.close();
  });

  test("FR-E5 AC10: the plan card whose function fails shows an error and Try again, the alerts stay quiet and the other cards keep their numbers", async ({ browser }) => {
    const { company, context, page } = await setup(browser);
    execute(`revoke execute on function ${PLAN_FUNCTION} from authenticated`);

    await page.goto(dashboardUrl(company.slug));
    await expect(page.getByRole("heading", { name: "The plan could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.").first()).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /trial|payment/ })).toHaveCount(0);
    await expect(card(page, "Open vacancies: 1")).toBeVisible();
    await expect(card(page, "New applications in the last 7 days: 2")).toBeVisible();
    expect((await stageRows(page))[0]).toEqual(["Applied", "1"]);
    await expect(page.getByText(/permission denied|get_dashboard_plan/)).toHaveCount(0);

    execute(`grant execute on function ${PLAN_FUNCTION} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("region", { name: "Plan" })).toContainText("Free plan");
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await context.close();
  });
});
