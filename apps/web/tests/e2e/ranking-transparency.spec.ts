import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, query } from "./support/db";
import { setPartnerRelease } from "./support/partners";
import { SITE } from "./support/seo";
import { expect, test } from "./support/test";

const RANKING = "/en/legal/ranking";

function setJobOrderRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

const staleDays = () =>
  query<{ v: string }>(`select value #>> '{}' as v from private.settings where key = 'workforce_listing_stale_days'`)[0].v;

// NFR-C8: the public page that describes the order of Find Partners. Release 2a is set for the whole database while this
// file runs, so it is a project of its own that follows the other partner specs (playwright.config.ts), one test after
// the other; the release 2b test sets release 2b for a moment too, which no project running beside this one reads. The
// order itself, plan against plan, is proved in supabase/tests/database/154_ranking_transparency.test.sql (Find Partners)
// and 190_job_order_ranking.test.sql (the job order board, V79).
test.describe("the ranking transparency page (NFR-C8)", () => {
  test.describe.configure({ mode: "serial" });
  test.afterAll(() => {
    setJobOrderRelease(false);
    setPartnerRelease(false);
  });

  test("while release 2a is off the page does not exist, and neither the legal index nor the sitemap names it", async ({ page, request }) => {
    setPartnerRelease(false);
    expect((await request.get(RANKING)).status()).toBe(404);
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain(`${RANKING}</loc>`);
    await page.goto("/en/legal");
    await expect(page.getByRole("link", { name: "How search results are ranked" })).toHaveCount(0);
  });

  test("a visitor opens it from both directories and from the legal index and reads every parameter, at both widths", async ({ page }) => {
    setPartnerRelease(true);
    for (const directory of ["/en/partners/recruitment", "/en/partners/staffing"]) {
      await page.goto(directory);
      await page.getByRole("link", { name: "How results are ranked" }).click();
      await expect(page).toHaveURL(RANKING);
      await expect(page.getByRole("heading", { level: 1, name: "How search results are ranked" })).toBeVisible();
    }

    await page.goto("/en/legal");
    await page.getByRole("link", { name: "How search results are ranked" }).click();
    await expect(page).toHaveURL(RANKING);

    const main = page.getByRole("main");
    for (const heading of [
      "Which companies are shown",
      "Filters that narrow the results",
      "Filters that rank the results",
      "The order of the directories",
      "The available workforce search",
      "Advanced filters",
      "What never changes the order",
    ]) {
      await expect(main.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }
    await expect(main.getByText(`confirmed by the company within the last ${staleDays()} days`)).toBeVisible();
    await expect(main.getByText("Nobody can pay for a higher place.", { exact: false })).toBeVisible();
    await expect(main.getByText("can be added only within the allowance of the company's plan", { exact: false })).toBeVisible();
    await expect(main.getByText(/verified/i)).toHaveCount(0);
    await expect(page).toHaveTitle("How search results are ranked — Chara Pinnacle");

    await main.getByRole("link", { name: "Find Staffing Partners" }).click();
    await expect(page).toHaveURL("/en/partners/staffing");
    await page.goto(RANKING);
    await expectAccessibleAtBothWidths(page);
  });

  test("while release 2b is on it also describes the partner suggestions, the job order board and Find Employers (V79)", async ({ page }) => {
    setPartnerRelease(true);
    setJobOrderRelease(false);
    await page.goto(RANKING);
    const main = page.getByRole("main");
    for (const heading of ["Partner suggestions for a workforce requirement", "Job orders", "Find Employers"]) {
      await expect(main.getByRole("heading", { level: 2, name: heading, exact: true })).toHaveCount(0);
    }

    setJobOrderRelease(true);
    try {
      await page.reload();
      for (const heading of ["Partner suggestions for a workforce requirement", "Job orders", "Find Employers"]) {
        await expect(main.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible();
      }
      await expect(main).toContainText("and the order of their Find Employers results");
      const jobOrders = main.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Job orders", exact: true }) });
      await expect(jobOrders).toContainText("not hidden by moderation, and the employer's account is active");
      await expect(jobOrders).toContainText("listed in the directories, active and not hidden by moderation can open the job orders");
      await expect(jobOrders).toContainText("The time the employer published the job order, newest first.");
      await expect(jobOrders).toContainText("decides only what that company reads, never the order");
      await expect(jobOrders).toContainText("No employer can pay to place a job order higher");
      await expect(main.getByText(/verified/i)).toHaveCount(0);
      await expectAccessibleAtBothWidths(page);
    } finally {
      setJobOrderRelease(false);
    }
  });

  test("the sitemap lists the page while release 2a is on", async ({ request }) => {
    setPartnerRelease(true);
    expect(await (await request.get("/sitemap.xml")).text()).toContain(`<loc>${SITE}${RANKING}</loc>`);
  });
});
