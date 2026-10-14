import type { Locator, Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { newCompany, seedJob } from "./support/jobs";
import { uniqueToken } from "./support/organizations";
import { HOME_SECTION_HEADINGS } from "./support/public-pages";
import { expect, test } from "./support/test";

// The content and the links of the home page (U71, OPEN_QUESTIONS.md D88); its layout, type, motion and accessibility are
// in home-layout.spec.ts and its live figures in live-statistics.spec.ts.
const search = (page: Page) => page.getByRole("search", { name: "Search jobs" });
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

// What Phase 1 does not have and the claims the audit of U71 removed (docs/phase-1/client/audit/HOME_AUDIT_U71.md).
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
];

test.describe("the home page (U71)", () => {
  test("the hero holds the h1, the client's line, the search and Post a Job; the sections follow in the client's order", async ({ page }) => {
    await page.goto("/en");
    const main = page.getByRole("main");
    const hero = region(page, "The Global Workforce Network");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("The Global Workforce Network");
    await expect(hero.getByText("Connect with the people and companies that can build your workforce.")).toBeVisible();
    await expect(search(page).getByRole("textbox")).toHaveCount(2);
    await expect(search(page).getByRole("button", { name: "Search jobs" })).toBeVisible();
    await expect(hero.getByRole("link", { name: "Post a Job" })).toHaveAttribute("href", "/en/signup?kind=company");

    await expect(main.locator("h2:not(#platform-statistics-heading):not([inert] h2)")).toHaveText(HOME_SECTION_HEADINGS);
    const tops = await main.locator("h1, h2").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });

  test("says nothing of a later phase, invents no claim and lists no vacancy: the search is the way to them", async ({ page }) => {
    await page.goto("/en");
    const text = (await page.getByRole("main").innerText()).toLowerCase();
    for (const phrase of NEVER_SAID) expect(text, phrase).not.toContain(phrase.toLowerCase());
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

  test("Who are you? gives each side the steps of How Chara Pinnacle works and a button to its own sign-up", async ({ page }) => {
    await page.goto("/en/how-it-works");
    const stepsOf = (scope: Locator) => scope.getByRole("listitem").locator("h3").allInnerTexts();
    const section = (heading: string) => page.locator("section", { has: page.getByRole("heading", { level: 2, name: heading }) });
    const workerSteps = await stepsOf(section("For workers"));
    const employerSteps = await stepsOf(section("For employers"));
    expect(workerSteps).toHaveLength(4);

    await page.goto("/en");
    const who = region(page, "Who are you?");
    const employer = region(page, "Employer");
    const worker = region(page, "Worker");
    await expect(employer.getByRole("listitem").locator(".text-h3")).toHaveText(employerSteps);
    await expect(worker.getByRole("listitem").locator(".text-h3")).toHaveText(workerSteps);
    await expect(employer).toContainText("Two-step verification is required for owners and administrators.");
    await expect(worker).toContainText("Workers never pay.");

    await who.getByRole("link", { name: "How Chara Pinnacle works" }).click();
    await expect(page).toHaveURL("/en/how-it-works");

    await page.goto("/en");
    await employer.getByRole("link", { name: "I'm an employer" }).click();
    await expect(page).toHaveURL("/en/signup?kind=company");
    await expect(page.getByRole("radio", { name: "I'm an employer" })).toBeChecked();
    await page.goto("/en");
    await worker.getByRole("link", { name: "I'm a worker" }).click();
    await expect(page).toHaveURL("/en/signup?kind=worker");
    await expect(page.getByRole("radio", { name: "I'm a worker" })).toBeChecked();
  });

  test("the network shows the two dashboards with fictional data under a caption, and the passport section leads to the worker sign-up", async ({ page }) => {
    await page.goto("/en");
    const network = region(page, "Workers and employers, connected");
    await expect(network.getByRole("figure")).toHaveAccessibleName("Screens of Chara Pinnacle, shown with fictional data.");
    await expect(network.locator("[inert]")).toContainText("Employer dashboard");
    await expect(network.locator("[inert]")).toContainText("Worker dashboard");
    await expect(network.locator("[inert] tbody th")).toHaveText(["Applied", "Viewed", "Shortlisted", "Interview", "Offer", "Hired", "Not selected", "Withdrawn"]);

    const passport = region(page, "One professional profile. Multiple opportunities.");
    await expect(passport.getByRole("list", { name: "What your CHARA Passport holds" }).getByRole("listitem")).toHaveCount(6);
    await expect(passport).toContainText("You choose which ones an employer sees, application by application.");
    await passport.getByRole("link", { name: "Create your CHARA Passport" }).click();
    await expect(page).toHaveURL("/en/signup?kind=worker");
  });

  test("the closing call offers Join Chara Pinnacle and Start hiring, each to its sign-up", async ({ page }) => {
    await page.goto("/en");
    const closing = region(page, "Your Workforce. Your Network. One Platform.");
    await expect(closing.getByRole("link", { name: "Start hiring" })).toHaveAttribute("href", "/en/signup?kind=company");
    await closing.getByRole("link", { name: "Join Chara Pinnacle" }).click();
    await expect(page).toHaveURL("/en/signup");
    await expectNoAxeViolations(page);
  });

  test("the footer sets Platform, Company and Legal in three columns, and nothing credits a photograph any more", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    const footer = page.getByRole("contentinfo");
    for (const [title, links] of [
      ["Platform", ["Find Jobs", "How Chara Pinnacle works", "Pricing"]],
      ["Company", ["About", "Trust & Safety", "Contact"]],
      ["Legal", ["Imprint", "Privacy Policy", "Terms of Service", "Cookie Policy", "All legal documents"]],
    ] as const) {
      await expect(footer.getByRole("list", { name: title }).getByRole("link")).toHaveText([...links]);
    }
    const lefts = await footer.getByRole("list").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(3);
    await expect(footer.getByText(`© ${new Date().getFullYear()} Chara Pinnacle`)).toBeVisible();

    await page.goto("/en/imprint");
    await expect(page.getByRole("heading", { name: "Photo credits" })).toHaveCount(0);
    expect((await page.request.get("/images/home/hero-welder-1920.webp")).status()).toBe(404);
  });

  test("from the top the keyboard reaches the header, then the search, which Enter sends, then Post a Job", async ({ page }) => {
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
      if (stop === "main:Post a Job") break;
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
      "main:Search jobs",
      "main:Post a Job",
    ]);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.type("Germany");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/en/jobs?country=DE");
  });
});
