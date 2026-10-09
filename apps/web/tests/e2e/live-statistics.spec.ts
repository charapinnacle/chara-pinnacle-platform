import type { Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { execute, query } from "./support/db";
import { newCompany, seedJob } from "./support/jobs";
import { restoreSnapshot, showSnapshot, visitorCounts } from "./support/statistics";
import { expect, test } from "./support/test";

const VIEW = "public.v_platform_counts";

// The snapshot of the statistics, the threshold setting and the grant on the view are changed for the whole database
// while this file runs, so it has a project of its own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  restoreSnapshot();
  execute(`grant select on ${VIEW} to anon, authenticated`);
  execute("update private.settings set value = '5' where key = 'stats_min_count'");
});

const heading = (page: Page) => page.getByRole("heading", { name: "CHARA in numbers" });
const block = (page: Page) => page.getByRole("region", { name: "CHARA in numbers" });
const groups = (page: Page) => block(page).locator("dl > div");

async function openHome(page: Page): Promise<void> {
  const response = await page.goto("/en");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "The Global Workforce Network" })).toBeVisible();
}

test.describe("live statistics on the home page", () => {
  test("FR-H4 AC1: an anonymous visitor sees four labelled values, each as text in one group with its label", async ({ page }) => {
    showSnapshot({ jobs: 15, employers: 8, workers: 30, countries: 6 });
    await openHome(page);

    await expect(heading(page)).toBeVisible();
    await expect(groups(page)).toHaveText([/^Vacancies\s*15$/, /^Employers\s*8$/, /^Candidates\s*30$/, /^Countries\s*6$/]);
    await expect(page.getByRole("term")).toHaveText(["Vacancies", "Employers", "Candidates", "Countries"]);
    await expect(page.getByRole("definition")).toHaveText(["15", "8", "30", "6"]);
    await expectNoAxeViolations(page);
  });

  test("FR-H4 AC2, AC7, AC12: a count of 5 is shown, the candidate count is rounded to the nearest 10 and a thousand has a separator", async ({ page }) => {
    showSnapshot({ jobs: 5, employers: 5, workers: 1234, countries: 1234 });
    await openHome(page);

    await expect(groups(page)).toHaveText([/^Vacancies\s*5$/, /^Employers\s*5$/, /^Candidates\s*1,230$/, /^Countries\s*1,234$/]);
  });

  test("FR-H4 AC3: a single low value is left out without a label, a zero, a dash or an empty tile", async ({ page }) => {
    showSnapshot({ jobs: 15, employers: 3, workers: 30, countries: 6 });
    await openHome(page);

    await expect(groups(page)).toHaveText([/^Vacancies\s*15$/, /^Candidates\s*30$/, /^Countries\s*6$/]);
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
    showSnapshot({ jobs: 9, employers: 9, workers: 9, countries: 9 });
    await openHome(page);
    await expect(groups(page)).toHaveCount(4);

    execute("update private.settings set value = '10' where key = 'stats_min_count'");
    await openHome(page);
    await expect(heading(page)).toHaveCount(0);
  });

  test("FR-H4 AC12: when the statistics cannot be read the home page is served with the rest of its content and no block", async ({ page }) => {
    showSnapshot({ jobs: 15, employers: 8, workers: 30, countries: 6 });
    execute(`revoke select on ${VIEW} from anon, authenticated`);
    await openHome(page);

    await expect(page.getByText("Your Workforce. Your Network. One Platform.")).toBeVisible();
    await expect(heading(page)).toHaveCount(0);
    await expect(page.getByText("permission denied")).toHaveCount(0);
    await expect(page.getByText("v_platform_counts")).toHaveCount(0);

    execute(`grant select on ${VIEW} to anon, authenticated`);
    await openHome(page);
    await expect(groups(page)).toHaveCount(4);
  });

  test("FR-H4 AC5, AC9: real data reaches the page through the refresh and not before it", async ({ page }) => {
    execute("update private.settings set value = '1' where key = 'stats_min_count'");
    execute("refresh materialized view concurrently stats.platform_counts_mv");
    const before = visitorCounts();

    const company = await newCompany();
    seedJob(company, { title: "Statistics welder", status: "open", country: "PL" });
    expect(visitorCounts()).toEqual(before);

    execute("refresh materialized view concurrently stats.platform_counts_mv");
    const after = visitorCounts();
    expect(after.active_jobs).toBe((before.active_jobs ?? 0) + 1);
    expect(after.employers).toBe((before.employers ?? 0) + 1);
    const direct = query<{ n: number }>(
      "select count(*)::integer as n from public.jobs where status = 'open' and moderation_state = 'visible' and deleted_at is null",
    )[0].n;
    expect(after.active_jobs).toBe(direct);

    await openHome(page);
    await expect(groups(page).filter({ hasText: "Vacancies" })).toHaveText(new RegExp(`^Vacancies\\s*${after.active_jobs}$`));
    await expect(groups(page).filter({ hasText: "Employers" })).toHaveText(new RegExp(`^Employers\\s*${after.employers}$`));
  });
});
