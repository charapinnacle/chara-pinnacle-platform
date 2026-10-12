import type { Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { newCompany, seedJob } from "./support/jobs";
import { uniqueToken } from "./support/organizations";
import { expect, test } from "./support/test";

// The vacancy parts of the home page read the public search without a session and keep the answer for a minute for all
// visitors (lib/dal/home.ts). The vacancies of this file are dated a day ahead, so they are the newest of the database
// until the file removes them; the file has a project of its own after the others, so that no other spec sees them
// (playwright.config.ts).
const CACHE_MS = 75_000;
test.describe.configure({ mode: "serial" });

const seeded: string[] = [];
const marker = `zq${uniqueToken()}`;
test.afterAll(() => {
  if (seeded.length > 0) execute(`update public.jobs set deleted_at = now() where id in (${seeded.map(literal).join(", ")})`);
});

const latest = (page: Page) => page.getByRole("region", { name: "Latest jobs" });

async function untilShown(page: Page, check: () => Promise<boolean>): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto("/en");
        return check();
      },
      { timeout: CACHE_MS, intervals: [2_000, 5_000] },
    )
    .toBe(true);
}

test.describe("the vacancies of the home page (U70)", () => {
  test.setTimeout(150_000);

  test("the latest jobs are the newest open vacancies as cards, each opening its vacancy page, with Browse all jobs", async ({ page }) => {
    const company = await newCompany();
    for (const [index, city] of ["Bergen", "Oslo", "Trondheim", "Stavanger", "Tromsø", "Drammen", "Bodø"].entries()) {
      seeded.push(
        seedJob(company, {
          title: `Home card ${index} ${marker}`,
          status: "open",
          country: "NO",
          city,
          createdAt: `now() + interval '1 day' + interval '${index} minutes'`,
          salary: index === 1 ? { min: 41000, max: 47000, currency: "NOK", period: "month" } : null,
        }),
      );
    }
    await untilShown(page, async () => (await latest(page).getByRole("link", { name: `Home card 6 ${marker}` }).count()) === 1);

    const cards = latest(page).getByRole("listitem").filter({ has: page.getByRole("link") });
    await expect(cards).toHaveCount(6);
    // Seven are open and the six newest are shown, the newest first.
    await expect(latest(page).getByRole("heading", { level: 3 })).toHaveText([6, 5, 4, 3, 2, 1].map((index) => `Home card ${index} ${marker}`));
    const first = latest(page).getByRole("link", { name: `Home card 1 ${marker}` });
    await expect(first).toContainText("Oslo, Norway");
    await expect(first).toContainText("NOK 41,000 to 47,000, per month");
    await expect(first).toContainText("Apply now");
    const [{ created_at }] = query<{ created_at: string }>(`select created_at from public.jobs where id = ${literal(seeded[1])}`);
    const posted = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(created_at));
    await expect(first).toContainText(`Posted ${posted}`);
    // Every card is an open vacancy of the database: the search answers for the public only.
    const ids = await latest(page)
      .getByRole("link")
      .evaluateAll((links) => links.flatMap((link) => /^\/en\/jobs\/([0-9a-f-]{36})$/.exec(link.getAttribute("href") ?? "")?.[1] ?? []));
    expect(ids).toHaveLength(6);
    const open = query<{ id: string }>(`select id from public.jobs where status = 'open' and moderation_state = 'visible' and deleted_at is null and id in (${ids.map(literal).join(", ")})`);
    expect(open).toHaveLength(6);
    await expect(latest(page).getByRole("link", { name: "Browse all jobs" })).toHaveAttribute("href", "/en/jobs");
    await expectNoAxeViolations(page);

    await first.click();
    await expect(page).toHaveURL(`/en/jobs/${seeded[1]}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Home card 1 ${marker}`);
  });

  test("the countries of the open vacancies are chips that open Find Jobs filtered by the country, then All countries", async ({ page }) => {
    await untilShown(page, async () => (await page.getByRole("region", { name: "Browse by country" }).getByRole("link", { name: "Norway" }).count()) === 1);
    const chips = page.getByRole("region", { name: "Browse by country" }).getByRole("link");
    await expect(chips.last()).toHaveText("All countries");
    await expect(chips.last()).toHaveAttribute("href", "/en/jobs");
    expect(await chips.count()).toBeLessThanOrEqual(13);
    const codes = await chips.evaluateAll((links) => links.map((link) => new URL(link.getAttribute("href") ?? "", "http://x").searchParams.get("country")).filter(Boolean));
    const listed = query<{ country_code: string }>(
      `select distinct country_code from public.jobs where status = 'open' and moderation_state = 'visible' and deleted_at is null and country_code in (${codes.map((code) => literal(String(code))).join(", ")})`,
    );
    expect(listed.map(({ country_code }) => country_code).sort()).toEqual([...codes].sort());

    await chips.filter({ hasText: "Norway" }).click();
    await expect(page).toHaveURL("/en/jobs?country=NO");
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Norway");
    await expect(page.getByRole("link", { name: `Home card 0 ${marker}` })).toBeVisible();
    await expect(page.getByRole("main").getByRole("heading", { level: 2 }).filter({ hasText: marker })).toHaveCount(7);
  });
});
