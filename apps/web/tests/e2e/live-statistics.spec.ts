import type { Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { execute, query } from "./support/db";
import { newCompany, retireEmployers, seedEmployersWithVacancy, seedJob, type SeededEmployers } from "./support/jobs";
import { restoreSnapshot, showSnapshot, visitorCounts } from "./support/statistics";
import { expect, test } from "./support/test";

const VIEW = "public.v_platform_counts";
const SCHEDULED_REFRESH = "select cron.alter_job((select jobid from cron.job where jobname = 'refresh-platform-counts'), active := ";

// The snapshot of the statistics, the threshold setting and the grant on the view are changed for the whole database
// while this file runs, so it has a project of its own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
let bulk: SeededEmployers = { organizations: [], jobs: [] };
test.afterEach(() => {
  retireEmployers(bulk);
  bulk = { organizations: [], jobs: [] };
  restoreSnapshot();
  execute(`grant select on ${VIEW} to anon, authenticated`);
  execute("update private.settings set value = '5' where key = 'stats_min_count'");
  execute(`${SCHEDULED_REFRESH}true)`);
});

const heading = (page: Page) => page.getByRole("heading", { name: "Global Workforce Network", level: 2, exact: true });
const block = (page: Page) => page.getByRole("region", { name: "Global Workforce Network", exact: true });
const groups = (page: Page) => block(page).locator("dl > div");

async function openHome(page: Page): Promise<void> {
  const response = await page.goto("/en");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "The Global Workforce Network" })).toBeVisible();
}

// The home page leaves out a live figure below 100, the credible minimum (D87), so the snapshots of these tests are at least
// that large where a value must be shown.
test.describe("live statistics on the home page", () => {
  test("FR-H4 AC1: an anonymous visitor sees the four labelled values, each as text in one group with its label", async ({ page }) => {
    showSnapshot({ jobs: 150, employers: 120, workers: 3000, countries: 120 });
    await openHome(page);

    await expect(heading(page)).toBeVisible();
    await expect(groups(page)).toHaveText([/^Workers\s*3,000$/, /^Employers\s*120$/, /^Active jobs\s*150$/, /^Countries\s*120$/]);
    await expect(page.getByRole("term")).toHaveText(["Workers", "Employers", "Active jobs", "Countries"]);
    await expect(page.getByRole("definition")).toHaveText(["3,000", "120", "150", "120"]);
    await expectNoAxeViolations(page);
  });

  test("U71: the block is a section of its own after the CHARA Passport and before the closing call, and no reference-table figure is shown", async ({ page }) => {
    showSnapshot({ jobs: 150, employers: 120, workers: 3000, countries: 60 });
    await openHome(page);

    const headings = await page.getByRole("main").getByRole("heading", { level: 2 }).allInnerTexts();
    expect(headings.slice(-3)).toEqual(["One professional profile. Multiple opportunities.", "Global Workforce Network", "Your Workforce. Your Network. One Platform."]);
    await expect(page.getByRole("main")).not.toContainText("Built for hiring across borders");
    await expect(page.getByRole("main")).not.toContainText("Countries and territories");
  });

  test("D87: a value the database shows but below 100 is left out, and 100 is shown", async ({ page }) => {
    showSnapshot({ jobs: 99, employers: 100, workers: 90, countries: 6 });
    await openHome(page);

    await expect(groups(page)).toHaveText([/^Employers\s*100$/]);
    await expect(block(page).getByText("Workers")).toHaveCount(0);
    await expect(block(page).getByText("Active jobs")).toHaveCount(0);
    await expect(block(page).getByText("Countries")).toHaveCount(0);

    showSnapshot({ jobs: 99, employers: 99, workers: 90, countries: 6 });
    await openHome(page);
    await expect(heading(page)).toHaveCount(0);
    await expect(page.locator("dl")).toHaveCount(0);
  });

  test("FR-H4 AC1: the block is part of the served page, so it shows without JavaScript", async ({ browser }) => {
    showSnapshot({ jobs: 150, employers: 120, workers: 3000, countries: 60 });
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await openHome(page);

    await expect(block(page)).toBeVisible();
    await expect(groups(page)).toHaveCount(3);
    await context.close();
  });

  test("FR-H4 AC2, AC7, AC12: a count at the minimum is shown, the worker count is rounded to the nearest 10 and a thousand has a separator", async ({ page }) => {
    showSnapshot({ jobs: 100, employers: 1234, workers: 1234, countries: 1234 });
    await openHome(page);

    await expect(groups(page)).toHaveText([/^Workers\s*1,230$/, /^Employers\s*1,234$/, /^Active jobs\s*100$/, /^Countries\s*1,234$/]);
  });

  test("FR-H4 AC3: a single low value is left out without a label, a zero, a dash or an empty tile", async ({ page }) => {
    showSnapshot({ jobs: 150, employers: 3, workers: 2000, countries: 6 });
    await openHome(page);

    await expect(groups(page)).toHaveText([/^Workers\s*2,000$/, /^Active jobs\s*150$/]);
    await expect(block(page).getByText("Employers")).toHaveCount(0);
    await expect(block(page)).not.toContainText(/\b0\b|[-–—]|\b3\b/);
  });

  test("FR-H4 AC4: when every value is low the page is served without the statistics heading or block, and the rest is there", async ({ page }) => {
    showSnapshot({ jobs: 4, employers: 3, workers: 2, countries: 1 });
    await openHome(page);

    await expect(page.getByText("Your Workforce. Your Network. One Platform.")).toBeVisible();
    await expect(heading(page)).toHaveCount(0);
    await expect(page.locator("dl")).toHaveCount(0);
    await expect(block(page)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("FR-H4 AC8: the threshold is read from the setting at the next request", async ({ page }) => {
    showSnapshot({ jobs: 190, employers: 190, workers: 190, countries: 190 });
    await openHome(page);
    await expect(groups(page)).toHaveCount(4);

    execute("update private.settings set value = '200' where key = 'stats_min_count'");
    await openHome(page);
    await expect(heading(page)).toHaveCount(0);
  });

  test("FR-H4 AC12: when the statistics cannot be read the home page is served with the rest of its content and no block", async ({ page }) => {
    showSnapshot({ jobs: 150, employers: 120, workers: 3000, countries: 60 });
    execute(`revoke select on ${VIEW} from anon, authenticated`);
    await openHome(page);

    await expect(page.getByText("Your Workforce. Your Network. One Platform.")).toBeVisible();
    await expect(heading(page)).toHaveCount(0);
    await expect(page.getByText("permission denied")).toHaveCount(0);
    await expect(page.getByText("v_platform_counts")).toHaveCount(0);

    execute(`grant select on ${VIEW} to anon, authenticated`);
    await openHome(page);
    await expect(groups(page)).toHaveCount(3);
  });

  test("FR-H4 AC5, AC9: real data reaches the page through the refresh and not before it", async ({ page }) => {
    execute(`${SCHEDULED_REFRESH}false)`);
    execute("refresh materialized view concurrently stats.platform_counts_mv");
    const before = visitorCounts();

    const companies = await Promise.all(Array.from({ length: 5 }, () => newCompany()));
    companies.forEach((company) => seedJob(company, { title: "Statistics welder", status: "open", country: "PL" }));
    // A hundred more, so that both figures reach the credible minimum of the page (D87) whatever the other specs left.
    bulk = seedEmployersWithVacancy(companies[0].owner, 100);
    expect(visitorCounts()).toEqual(before);

    execute("refresh materialized view concurrently stats.platform_counts_mv");
    const after = visitorCounts();
    const direct = query<{ jobs: number; employers: number }>(
      `select (select count(*) from public.jobs where status = 'open' and moderation_state = 'visible' and deleted_at is null)::integer as jobs,
              (select count(*) from public.organizations where type = 'employer' and status = 'active')::integer as employers`,
    )[0];
    expect(direct.jobs).toBeGreaterThanOrEqual(105);
    expect(direct.employers).toBeGreaterThanOrEqual(105);
    expect(after.active_jobs).toBe(direct.jobs);
    expect(after.employers).toBe(direct.employers);
    expect(after.active_jobs).not.toBe(before.active_jobs);

    await openHome(page);
    await expect(groups(page).filter({ hasText: "Active jobs" })).toHaveText(new RegExp(`^Active jobs\\s*${direct.jobs.toLocaleString("en")}$`));
    await expect(groups(page).filter({ hasText: "Employers" })).toHaveText(new RegExp(`^Employers\\s*${direct.employers.toLocaleString("en")}$`));
  });
});
