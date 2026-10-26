import { expectAccessibleAtBothWidths } from "./support/applications";
import { query } from "./support/db";
import { setPartnerRelease } from "./support/partners";
import { SITE } from "./support/seo";
import { expect, test } from "./support/test";

const RANKING = "/en/legal/ranking";

const staleDays = () =>
  query<{ v: string }>(`select value #>> '{}' as v from private.settings where key = 'workforce_listing_stale_days'`)[0].v;

// NFR-C8: the public page that describes the order of Find Partners. Release 2a is set for the whole database while this
// file runs, so it is a project of its own that follows the other partner specs (playwright.config.ts), one test after
// the other. The order itself, plan against plan, is proved in supabase/tests/database/154_ranking_transparency.test.sql.
test.describe("the ranking transparency page (NFR-C8)", () => {
  test.describe.configure({ mode: "serial" });
  test.afterAll(() => setPartnerRelease(false));

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
    await expect(main.getByText("No company can pay to appear higher.")).toBeVisible();
    await expect(main.getByText(/verified/i)).toHaveCount(0);
    await expect(page).toHaveTitle("How search results are ranked — Chara Pinnacle");

    await main.getByRole("link", { name: "Find Staffing Partners" }).click();
    await expect(page).toHaveURL("/en/partners/staffing");
    await page.goto(RANKING);
    await expectAccessibleAtBothWidths(page);
  });

  test("the sitemap lists the page while release 2a is on", async ({ request }) => {
    setPartnerRelease(true);
    expect(await (await request.get("/sitemap.xml")).text()).toContain(`<loc>${SITE}${RANKING}</loc>`);
  });
});
