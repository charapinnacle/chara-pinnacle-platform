import type { Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { newCompany, seedJob } from "./support/jobs";
import { uniqueToken } from "./support/organizations";
import { FOOTER_LABELS, HEADER_LABELS, HOME_SECTION_HEADINGS } from "./support/public-pages";
import { expect, test } from "./support/test";

// The content and the links of the home page (U73, OPEN_QUESTIONS.md D90); its layout, type, motion and accessibility are
// in home-layout.spec.ts and its live figures in live-statistics.spec.ts.
const search = (page: Page) => page.getByRole("search", { name: "Search jobs" });
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

// What Phase 1 does not have and the claims the audits of U71 and U73 removed.
const NEVER_SAID = [
  "recruitment",
  "staffing",
  "CHARA Match",
  "corridor",
  "verified",
  "Find Workers",
  "Request Workers",
  "Popular searches",
  "Data stored in the EU",
  "moderated",
  "Built for hiring across borders",
  "Latest jobs",
  "Browse by",
  "Apply now",
  "Who are you?",
  "Workers and employers, connected",
  "Frequently asked",
];

test.describe("the home page (U73)", () => {
  test("the hero holds the h1, the client's line, the search and the quiet line to For employers; the sections follow in order", async ({ page }) => {
    await page.goto("/en");
    const main = page.getByRole("main");
    const hero = region(page, "The Global Workforce Network");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("The Global Workforce Network");
    await expect(hero.getByText("Connect with the people and companies that can build your workforce.")).toBeVisible();
    await expect(search(page).getByRole("textbox")).toHaveCount(2);
    await expect(search(page).getByRole("button", { name: "Search jobs" })).toBeVisible();
    await expect(hero.getByRole("link")).toHaveCount(1);
    await expect(hero.getByRole("link", { name: "Post a job" })).toHaveAttribute("href", "/en/employers");

    await expect(main.locator("h2:not(#platform-statistics-heading)")).toHaveText(HOME_SECTION_HEADINGS);
    const order = await main.locator(":scope > section").evaluateAll((sections) =>
      sections.map((section) => section.getAttribute("aria-label") ?? document.getElementById(section.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""),
    );
    expect(order.filter((name) => name !== "Global Workforce Network")).toEqual([
      "The Global Workforce Network",
      "From profile to offer, in three steps.",
      "One professional profile. Multiple opportunities.",
      "For employers",
      "Your Workforce. Your Network. One Platform.",
    ]);
    const tops = await main.locator("h1, h2").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });

  test("says nothing of a later phase, invents no claim, asks no question and lists no vacancy: the search is the way to them", async ({ page }) => {
    await page.goto("/en");
    const text = (await page.getByRole("main").innerText()).toLowerCase();
    for (const phrase of NEVER_SAID) expect(text, phrase).not.toContain(phrase.toLowerCase());
    await expect(page.getByRole("main").locator("details")).toHaveCount(0);
    const vacancyLinks = await page.getByRole("main").locator("a").evaluateAll((links) => links.filter((link) => /^\/en\/jobs\/[0-9a-f-]{36}$/.test(link.getAttribute("href") ?? "")).length);
    expect(vacancyLinks).toBe(0);
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
      await search(page).getByLabel("What: Job title, skill or occupation").fill(marker);
      await search(page).getByLabel("Where: City or country").fill("netherlands");
      await search(page).getByLabel("Where: City or country").press("Enter");
      await expect(page).toHaveURL(`/en/jobs?q=${marker}&country=NL`);
      await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Netherlands");

      await page.goto("/en");
      await search(page).getByLabel("What: Job title, skill or occupation").fill(marker);
      await search(page).getByLabel("Where: City or country").fill("Hamburg");
      if (javaScriptEnabled) await search(page).getByRole("button", { name: "Search jobs" }).click();
      else await search(page).getByLabel("Where: City or country").press("Enter");
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

  test("How it works gives a candidate's three steps and one button, which opens the candidate sign-up", async ({ page }) => {
    await page.goto("/en");
    const how = region(page, "From profile to offer, in three steps.");
    await expect(how.getByRole("listitem").getByRole("heading", { level: 3 })).toHaveText([
      "Create your CHARA Passport",
      "Apply with the documents you choose",
      "Follow every stage of your application",
    ]);
    await expect(how.getByRole("link")).toHaveCount(1);
    await how.getByRole("link", { name: "Create your CHARA Passport" }).click();
    await expect(page).toHaveURL("/en/signup?kind=worker");
    await expect(page.getByRole("radio", { name: "I'm a worker" })).toBeChecked();
  });

  test("the passport section states the four facts and nothing else; the employer band leads to the employer sign-up and to For employers", async ({ page }) => {
    await page.goto("/en");
    const passport = region(page, "One professional profile. Multiple opportunities.");
    await expect(passport.getByRole("list", { name: "What your CHARA Passport gives you" }).getByRole("listitem")).toHaveCount(4);
    await expect(passport).toContainText("Workers never pay");
    await expect(passport).toContainText("Your access log shows which organisation opened which document, and when.");
    await expect(passport.getByRole("link")).toHaveCount(0);

    const band = region(page, "For employers");
    await expect(band).toContainText("Hiring? Publish a vacancy and manage every applicant in one pipeline.");
    await expect(band.getByRole("link", { name: "Post a Job" })).toHaveAttribute("href", "/en/signup?kind=company");
    await band.getByRole("link", { name: "For employers" }).click();
    await expect(page).toHaveURL("/en/employers");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hire from the Global Workforce Network.");
  });

  test("the closing call offers Join Chara Pinnacle and Start hiring, each to its sign-up", async ({ page }) => {
    await page.goto("/en");
    const closing = region(page, "Your Workforce. Your Network. One Platform.");
    await expect(closing.getByRole("link", { name: "Start hiring" })).toHaveAttribute("href", "/en/signup?kind=company");
    await closing.getByRole("link", { name: "Join Chara Pinnacle" }).click();
    await expect(page).toHaveURL("/en/signup");
    await expectNoAxeViolations(page);
  });

  test("the footer sets Platform, Company and Legal in three columns, For employers among the Platform links", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    const footer = page.getByRole("contentinfo");
    for (const [title, links] of [
      ["Platform", ["Find Jobs", "For employers", "How Chara Pinnacle works", "Pricing"]],
      ["Company", ["About", "Trust & Safety", "Contact"]],
      ["Legal", ["Imprint", "Privacy Policy", "Terms of Service", "Cookie Policy", "All legal documents"]],
    ] as const) {
      await expect(footer.getByRole("list", { name: title }).getByRole("link")).toHaveText([...links]);
    }
    await expect(footer.getByRole("link")).toHaveText(FOOTER_LABELS);
    const lefts = await footer.getByRole("list").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(3);
    await expect(footer.getByText(`© ${new Date().getFullYear()} Chara Pinnacle`)).toBeVisible();
  });

  test("from the top the keyboard reaches the header and the Menu, then the search, which Enter sends, then the employer line", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    await page.getByRole("button", { name: "Menu", exact: true }).waitFor();
    const stops: string[] = [];
    for (let press = 0; press < 12; press++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        return `${element.closest("main") ? "main" : element.closest("header") ? "header" : "other"}:${element.getAttribute("placeholder") ?? element.innerText.trim()}`;
      });
      stops.push(stop);
      if (stop === "main:Post a job") break;
    }
    expect(stops).toEqual([
      "other:Skip to main content",
      "header:Chara Pinnacle\nCHARA",
      ...HEADER_LABELS.map((label) => `header:${label}`),
      "header:Menu",
      "main:Job title, skill or occupation",
      "main:City or country",
      "main:Search jobs",
      "main:Post a job",
    ]);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.type("Germany");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/en/jobs?country=DE");
  });
});
