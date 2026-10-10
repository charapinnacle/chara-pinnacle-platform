import type { Browser } from "@playwright/test";
import { enrolledStaff } from "./support/admin";
import { signedInPage } from "./support/app-shell";
import { seedApplication } from "./support/applications";
import { card, dashboardUrl, seedApplicationAgo, stageRows, HOUR } from "./support/dashboard";
import { execute, executeAsync } from "./support/db";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { seedSaved } from "./support/saved";
import { signInBrowser } from "./support/session";
import { signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

const FUNCTION = "public.get_dashboard_applications(uuid)";
const PLAN_FUNCTION = "public.get_dashboard_plan(uuid)";
const STAGE_FUNCTION = "public.my_application_stage_counts()";
const STAFF_FUNCTION = "public.admin_staff_count()";
const WITHDRAWN = [FUNCTION, PLAN_FUNCTION, STAGE_FUNCTION, STAFF_FUNCTION];

// Tables are locked for the whole database and functions are withdrawn from the API role while these tests run, so this
// file has a project of its own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  for (const fn of WITHDRAWN) execute(`grant execute on function ${fn} to authenticated`);
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

async function candidate(browser: Browser) {
  const company = await newCompany();
  const job = seedJob(company, { title: "Failing fitter", status: "open" });
  const worker = await createCommittedUser("worker");
  seedApplication(worker.id, job, company.id, { status: "interview" });
  seedSaved(worker.id, job);
  return signedInPage(browser, worker);
}

test.describe("the candidate dashboard and the console when the database is slow or fails (UX-03, UX-10)", () => {
  test("the saved vacancies card shows a skeleton while they are read, and the application figures show their numbers", async ({ browser }) => {
    const { context, page } = await candidate(browser);
    const held = executeAsync("begin; lock table public.saved_jobs in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await page.goto("/en/dashboard/worker", { waitUntil: "commit" });
    await expect(card(page, "My applications: 1")).toBeVisible();
    await expect(card(page, "Interviews: 1")).toBeVisible();
    await expect(page.getByRole("status").getByText("Loading")).toHaveCount(1);
    await expect(card(page, /^Saved vacancies/)).toHaveCount(0);

    await expect(card(page, "Saved vacancies: 1")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status").getByText("Loading")).toHaveCount(0);
    await held;
    await context.close();
  });

  test("the application figures whose function fails show their errors and Try again, the saved vacancies keep their number", async ({ browser }) => {
    const { context, page } = await candidate(browser);
    execute(`revoke execute on function ${STAGE_FUNCTION} from authenticated`);

    await page.goto("/en/dashboard/worker");
    await expect(page.getByRole("heading", { name: "Your applications could not be counted", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your interviews could not be counted", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your recent applications could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.").first()).toBeVisible();
    await expect(card(page, "Saved vacancies: 1")).toBeVisible();
    await expect(page.getByText(/permission denied|my_application_stage_counts/)).toHaveCount(0);

    execute(`grant execute on function ${STAGE_FUNCTION} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).first().click();
    await expect(card(page, "My applications: 1")).toBeVisible();
    await expect(card(page, "Interviews: 1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await context.close();
  });

  test("the staff figure whose function fails shows its error and Try again on the console landing, the other figures keep their numbers", async ({ page }) => {
    const staff = await enrolledStaff("admin");
    await signInAtAal2(page, staff.user, staff.secret, "/en/admin");
    execute(`revoke execute on function ${STAFF_FUNCTION} from authenticated`);

    await page.reload();
    await expect(page.getByRole("heading", { name: "The staff could not be counted", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.").first()).toBeVisible();
    await expect(card(page, /^Applications in the last 30 days: /)).toBeVisible();
    await expect(card(page, /^Legal documents in draft: /)).toBeVisible();
    await expect(page.getByRole("table", { name: "Applications by stage" })).toBeVisible();
    await expect(card(page, /^Staff members/)).toHaveCount(0);
    await expect(page.getByText(/permission denied|admin_staff_count/)).toHaveCount(0);

    execute(`grant execute on function ${STAFF_FUNCTION} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(card(page, /^Staff members: \d+$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  });
});
