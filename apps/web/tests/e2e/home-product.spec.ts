import type { Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { query } from "./support/db";
import { newCompany, seedJob } from "./support/jobs";
import { uniqueToken } from "./support/organizations";
import { HOME_SECTION_HEADINGS } from "./support/public-pages";
import { expect, test } from "./support/test";

// The content and the links of the home page as the front door of the product (U70, OPEN_QUESTIONS.md D87); its motion,
// layout and accessibility are in home-layout.spec.ts. The parts that depend on which vacancies are open are in
// home-vacancies.spec.ts, which runs on its own.
const search = (page: Page) => page.getByRole("search", { name: "Search jobs" });

test.describe("the product home page (U70)", () => {
  test("the hero holds the h1, the client's line, the search, the popular searches and the way to post a job; then the sections follow in order", async ({ page }) => {
    await page.goto("/en");
    const main = page.getByRole("main");
    const hero = main.locator("header");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("The Global Workforce Network");
    await expect(hero.getByText("Connect with the people and companies that can build your workforce.")).toBeVisible();
    await expect(search(page).getByRole("textbox")).toHaveCount(2);
    await expect(search(page).getByRole("button", { name: "Search jobs" })).toBeVisible();
    await expect(hero.getByRole("list", { name: "Popular searches" }).getByRole("link")).toHaveText(["Welder", "Electrician", "Nurse", "Truck driver", "Chef", "Carpenter"]);
    await expect(hero.getByRole("link", { name: "Post a Job" })).toHaveAttribute("href", "/en/signup?kind=company");

    const headings = main.locator("h2:not(#home-jobs-heading, #home-countries-heading, #platform-statistics-heading)");
    await expect(headings).toHaveText(HOME_SECTION_HEADINGS);
    const tops = await main.locator("h1, h2").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));

    const text = await main.innerText();
    for (const gone of ["Who are you?", "Recruitment and staffing companies", "Your application", "Find Workers", "Request Workers", "CHARA Match", "corridor", "Verified"]) {
      expect(text, gone).not.toContain(gone);
    }
  });

  test("the What and Where fields open Find Jobs: a country name becomes the country filter, any other place the city, with and without JavaScript", async ({ browser }) => {
    const company = await newCompany();
    const marker = `zq${uniqueToken()}`;
    const inHamburg = seedJob(company, { title: `Hero welder ${marker}`, status: "open", city: "Hamburg" });
    seedJob(company, { title: `Hero fitter ${marker}`, status: "open", city: "Rotterdam", country: "NL" });

    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ javaScriptEnabled });
      const page = await context.newPage();
      await page.goto("/en");
      await search(page).getByLabel("Job title, skill or occupation").fill(marker);
      await search(page).getByLabel("City or country").fill("netherlands");
      await search(page).getByLabel("City or country").press("Enter");
      await expect(page).toHaveURL(`/en/jobs?q=${marker}&country=NL`);
      await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Netherlands");

      await page.goto("/en");
      await search(page).getByLabel("Job title, skill or occupation").fill(marker);
      await search(page).getByLabel("City or country").fill("Hamburg");
      if (javaScriptEnabled) await search(page).getByRole("button", { name: "Search jobs" }).click();
      else await search(page).getByLabel("City or country").press("Enter");
      await expect(page).toHaveURL(`/en/jobs?q=${marker}&city=Hamburg`);
      await expect(page.getByRole("heading", { level: 1, name: "Find Your Next Opportunity" })).toBeVisible();
      if (javaScriptEnabled) {
        await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText([`Hero welder ${marker}`]);
        await expect(page.getByRole("link", { name: `Hero welder ${marker}` })).toHaveAttribute("href", `/en/jobs/${inHamburg}`);
      }
      await context.close();
    }
  });

  test("the search with both fields empty opens the whole list without a warning or filter chips", async ({ page }) => {
    await page.goto("/en");
    await search(page).getByRole("button", { name: "Search jobs" }).click();
    await expect(page).toHaveURL("/en/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Find Your Next Opportunity" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /vacanc/ })).toBeVisible();
    await expect(page.getByText("Some search options were ignored")).toHaveCount(0);
    await expect(page.getByText("No vacancies match your search")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);
  });

  test("each popular search opens Find Jobs filtered by its ISCO occupation, which the reference data holds", async ({ page }) => {
    const codes = { Welder: "7212", Electrician: "7411", Nurse: "2221", "Truck driver": "8332", Chef: "3434", Carpenter: "7115" };
    const rows = query<{ code: string; label: string }>(`select code, label from public.occupations where code in (${Object.values(codes).map((code) => `'${code}'`).join(", ")})`);
    expect(rows).toHaveLength(6);
    await page.goto("/en");
    const chips = page.getByRole("list", { name: "Popular searches" });
    for (const [label, code] of Object.entries(codes)) {
      await expect(chips.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", `/en/jobs?occupation=${code}`);
    }
    await chips.getByRole("link", { name: "Truck driver" }).click();
    await expect(page).toHaveURL("/en/jobs?occupation=8332");
    const label = rows.find((row) => row.code === "8332")?.label;
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText(`8332 · ${label}`);
  });

  test("the six industry tiles open Find Jobs filtered by their industry, and a count is shown only when it is at least 100", async ({ page }) => {
    await page.goto("/en");
    const tiles = page.getByRole("region", { name: "Browse by industry" }).getByRole("list").first().getByRole("link");
    await expect(tiles).toHaveCount(6);
    const targets = await tiles.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(targets).toEqual(["F", "Q", "H", "I", "C", "G"].map((code) => `/en/jobs?industry=${code}`));
    for (const label of await tiles.allInnerTexts()) {
      const count = /([\d,]+) open jobs/.exec(label)?.[1];
      if (count !== undefined) expect(Number(count.replaceAll(",", ""))).toBeGreaterThanOrEqual(100);
    }
    await tiles.filter({ hasText: "Construction" }).click();
    await expect(page).toHaveURL("/en/jobs?industry=F");
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Construction");
  });

  test("the reach band gives the sizes of the reference data of the database, and the two panels lead to the right sign-up", async ({ page }) => {
    const [sizes] = query<{ countries: number; occupations: number; industries: number; languages: number }>(
      `select (select count(*) from public.countries)::int as countries, (select count(*) from public.occupations)::int as occupations,
              (select count(*) from public.industries)::int as industries, (select count(*) from public.languages)::int as languages`,
    );
    await page.goto("/en");
    const reach = page.getByRole("region", { name: "Built for hiring across borders" });
    await expect(reach.getByRole("listitem")).toHaveText([
      new RegExp(`^Countries and territories\\s*${sizes.countries}$`),
      new RegExp(`^Occupations \\(ISCO-08\\)\\s*${sizes.occupations}$`),
      new RegExp(`^Industries \\(ISIC Rev\\.4\\)\\s*${sizes.industries}$`),
      new RegExp(`^Languages\\s*${sizes.languages}$`),
    ]);
    expect(sizes.countries).toBeGreaterThan(200);
    expect(sizes.occupations).toBeGreaterThan(400);

    const employers = page.getByRole("region", { name: "Publish a vacancy and manage every applicant in one pipeline" });
    await expect(employers.getByRole("link", { name: "Post a Job" })).toHaveAttribute("href", "/en/signup?kind=company");
    const workers = page.getByRole("region", { name: "One CHARA Passport for every application" });
    await workers.getByRole("link", { name: "Create your passport" }).click();
    await expect(page).toHaveURL("/en/signup?kind=worker");
    await expect(page.getByRole("radio", { name: "I'm a worker" })).toBeChecked();
  });

  test("the trust strip says five things in one row at a desktop width and links to Trust & Safety", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    const strip = page.getByRole("region", { name: "What you can rely on" });
    const items = strip.getByRole("listitem");
    await expect(items).toHaveText(["Workers never pay", "Documents private by default", "Data stored in the EU", "Two-step verification for employer admins", "Vacancies are moderated"]);
    const tops = await items.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    await strip.getByRole("link", { name: "Trust & Safety" }).click();
    await expect(page).toHaveURL("/en/trust-safety");
  });

  test("the footer sets Platform, Company and Legal in three columns, and Photo credits opens the credits on the Imprint", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    const footer = page.getByRole("contentinfo");
    for (const [title, links] of [
      ["Platform", ["Find Jobs", "How Chara Pinnacle works", "Pricing"]],
      ["Company", ["About", "Trust & Safety", "Contact"]],
      ["Legal", ["Imprint", "Privacy Policy", "Terms of Service", "Cookie Policy", "Photo credits", "All legal documents"]],
    ] as const) {
      await expect(footer.getByRole("list", { name: title }).getByRole("link")).toHaveText([...links]);
    }
    const lefts = await footer.getByRole("list").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(3);
    await expect(footer.getByText(`© ${new Date().getFullYear()} Chara Pinnacle`)).toBeVisible();

    await footer.getByRole("link", { name: "Photo credits" }).click();
    await expect(page).toHaveURL("/en/imprint#photo-credits");
    const credits = page.locator("#photo-credits");
    await expect(credits.getByRole("heading", { name: "Photo credits" })).toBeInViewport();
    await expect(credits.getByRole("link", { name: "Unsplash License" })).toHaveAttribute("href", "https://unsplash.com/license");
    await expect(credits.getByRole("listitem")).toHaveCount(7);
    await expect(credits).toContainText("not customers or workers of Chara Pinnacle");
    await expectNoAxeViolations(page);
  });

  test("from the top the keyboard reaches the header's Post a Job and then, first in the page, the search, which Enter sends", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    const stops: string[] = [];
    for (let press = 0; press < 12; press++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        return `${element.closest("main") ? "main" : element.closest("header") ? "header" : "other"}:${element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? element.innerText.trim()}`;
      });
      stops.push(stop);
      if (stop === "main:City or country") break;
    }
    expect(stops).toEqual([
      "other:Skip to main content",
      "header:Chara Pinnacle\nCHARA",
      "header:Find Jobs",
      "header:How Chara Pinnacle works",
      "header:Post a Job",
      "header:Login",
      "header:Sign up",
      "main:Job title, skill or occupation",
      "main:City or country",
    ]);
    await page.keyboard.type("Germany");
    await page.keyboard.press("Tab");
    await expect(search(page).getByRole("button", { name: "Search jobs" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/en/jobs?country=DE");
  });
});
