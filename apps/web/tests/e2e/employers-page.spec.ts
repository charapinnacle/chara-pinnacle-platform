import type { Page } from "@playwright/test";
import { signedInPage } from "./support/app-shell";
import { expectNoAxeViolations } from "./support/axe";
import { createCommittedUser } from "./support/login";
import { overflow } from "./support/login-page";
import { newCompany } from "./support/jobs";
import { priceText, publicPlanRecords } from "./support/pricing";
import { EMPLOYERS_SECTION_HEADINGS } from "./support/public-pages";
import { expect, test } from "./support/test";

// The For employers page (U73, OPEN_QUESTIONS.md D90). How the pricing teaser follows a change of the plan records is in
// pricing.spec.ts, the project that may change them.
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test.describe("the For employers page (U73)", () => {
  test("one promise and Post a Job, then the steps, what you get, pricing and the last call, in that order", async ({ page }) => {
    await page.goto("/en/employers");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("Hire from the Global Workforce Network.");
    await expect(main.getByRole("heading", { level: 2 })).toHaveText(EMPLOYERS_SECTION_HEADINGS);
    const hero = region(page, "Hire from the Global Workforce Network.");
    await expect(hero.getByRole("link")).toHaveText(["Post a Job", "See pricing"]);

    await expect(region(page, "From vacancy to hire in three steps.").getByRole("heading", { level: 3 })).toHaveText([
      "Publish a vacancy",
      "Review applicants in one pipeline",
      "Hire and keep everyone informed",
    ]);
    await expect(region(page, "Built for teams that hire together.").getByRole("list", { name: "What your organisation gets" }).getByRole("listitem")).toHaveCount(4);
    await expect(main.locator("details")).toHaveCount(0);
    const text = (await main.innerText()).toLowerCase();
    for (const phrase of ["recruitment", "staffing", "verified", "chara match", "corridor", "every opening"]) expect(text, phrase).not.toContain(phrase);

    await hero.getByRole("link", { name: "See pricing" }).click();
    await expect(page).toHaveURL("/en/employers#pricing");
    await expect(region(page, "Pricing")).toBeInViewport();

    await hero.getByRole("link", { name: "Post a Job" }).click();
    await expect(page).toHaveURL("/en/signup?kind=company");
    await expect(page.getByRole("radio", { name: "I'm an employer" })).toBeChecked();
  });

  test("the pricing teaser shows the lowest public price of the plan records, its name and its trial, and leads to the pricing page", async ({ page }) => {
    const priced = publicPlanRecords().sort((a, b) => a.price_minor - b.price_minor)[0];
    await page.goto("/en/employers");
    const pricing = region(page, "Pricing");
    await expect(pricing).toContainText(`${priceText(priced.price_minor, priced.currency)}per ${priced.interval}, excluding VAT`);
    await expect(pricing).toContainText(`${priced.name} plan.`);
    await expect(pricing).toContainText(`${priced.trial_days} days free trial.`);
    await expect(pricing).toContainText("One free trial is granted for each legal entity.");
    await pricing.getByRole("link", { name: "See all plans" }).click();
    await expect(page).toHaveURL("/en/pricing");
    await expect(page.getByRole("list", { name: "Employer plans" })).toContainText(priceText(priced.price_minor, priced.currency));
  });

  test("the last call offers Post a Job to the employer sign-up, and the page passes axe at 1280 and 360 px", async ({ page }) => {
    await page.goto("/en/employers");
    const closing = region(page, "Ready to hire?");
    await expect(closing.getByRole("link")).toHaveText(["Post a Job"]);
    await expect(closing.getByRole("link", { name: "Post a Job" })).toHaveAttribute("href", "/en/signup?kind=company");
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoAxeViolations(page);
    }
  });

  test("without JavaScript every section is served and visible, and the page fits from 320 to 1440 px", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    for (const width of [320, 375, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/en/employers");
      for (const heading of EMPLOYERS_SECTION_HEADINGS) await expect(page.getByRole("heading", { level: 2, name: heading }), `${width} px`).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: "See all plans" })).toBeVisible();
      expect(await overflow(page), `${width} px`).toBeLessThanOrEqual(0);
    }
    await context.close();
  });

  test("a signed-in owner is sent by Post a Job to the new-vacancy page, and a candidate is offered none", async ({ browser }) => {
    const company = await newCompany();
    const owner = await signedInPage(browser, company.owner);
    await owner.page.goto("/en/employers");
    const hero = region(owner.page, "Hire from the Global Workforce Network.");
    await expect(hero.getByRole("link", { name: "Post a Job" })).toHaveAttribute("href", "/en/post-job");
    await expect(region(owner.page, "Ready to hire?").getByRole("link", { name: "Post a Job" })).toHaveAttribute("href", "/en/post-job");
    await hero.getByRole("link", { name: "Post a Job" }).click();
    await expect(owner.page).toHaveURL(`/en/org/${company.slug}/jobs/new`);
    await owner.context.close();

    const worker = await createCommittedUser("worker");
    const candidate = await signedInPage(browser, worker);
    await candidate.page.goto("/en/employers");
    await expect(candidate.page.getByRole("main").getByRole("link", { name: "Post a Job" })).toHaveCount(0);
    await expect(candidate.page.getByRole("heading", { level: 2, name: "Ready to hire?" })).toBeVisible();
    await candidate.context.close();
  });
});
