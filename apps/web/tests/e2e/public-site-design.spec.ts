import type { Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal } from "./support/db";
import { newCompany, seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { overflow } from "./support/login-page";
import { uniqueToken } from "./support/organizations";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";
import { createTestUser } from "./support/test-user";

const WIDTHS = [1440, 1024, 768, 375];

async function settled(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await expectNoAxeViolations(page);
}

test.describe("the home page", () => {
  test("the search of the hero opens Find Jobs with the keyword and the city in the address, without JavaScript too", async ({ browser }) => {
    const company = await newCompany();
    const marker = `zq${uniqueToken()}`;
    const id = seedJob(company, { title: `Hero welder ${marker}`, status: "open", city: "Hamburg" });
    seedJob(company, { title: `Hero fitter ${marker}`, status: "open", city: "Rotterdam", country: "NL" });

    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ javaScriptEnabled });
      const page = await context.newPage();
      await page.goto("/en");
      const search = page.getByRole("search", { name: "Search vacancies" });
      await search.getByLabel("Keyword", { exact: true }).fill(marker);
      await search.getByLabel("City", { exact: true }).fill("Hamburg");
      // Without JavaScript the form is sent with Enter: the click waits for the entrance animation to settle through the
      // page's animation frames, which a context without JavaScript does not run for it.
      if (javaScriptEnabled) await search.getByRole("button", { name: "Search vacancies" }).click();
      else await search.getByLabel("City", { exact: true }).press("Enter");
      await expect(page).toHaveURL(`/en/jobs?q=${marker}&city=Hamburg`);
      await expect(page.getByRole("heading", { level: 1, name: "Find jobs" })).toBeVisible();
      // The results of Find Jobs stream in behind a skeleton, which needs JavaScript to be swapped in (as before this page).
      if (javaScriptEnabled) {
        await expect(page.getByRole("heading", { level: 2 })).toHaveText([`Hero welder ${marker}`]);
        await expect(page.getByRole("link", { name: `Hero welder ${marker}` })).toHaveAttribute("href", `/en/jobs/${id}`);
      }
      await context.close();
    }
  });

  test("the sections follow the hero in order and the closing call leads to sign-up and pricing", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 2 })).toContainText([
      "Four steps on each side",
      "Built on rules you can read",
      "Your next job or your next hire starts here.",
    ]);
    const workers = page.getByRole("region", { name: "For workers" });
    await expect(workers.getByRole("listitem")).toHaveCount(4);
    await expect(workers.getByRole("heading", { level: 4 })).toHaveText([
      "Create your profile",
      "Search vacancies",
      "Apply",
      "Follow your application",
    ]);
    await expect(page.getByRole("region", { name: "For employers" }).getByRole("listitem")).toHaveCount(4);
    const closing = page.getByRole("region", { name: "Your next job or your next hire starts here." });
    await expect(closing.getByRole("link", { name: "Create your account" })).toHaveAttribute("href", "/en/signup");
    await expect(closing.getByRole("link", { name: "See pricing" })).toHaveAttribute("href", "/en/pricing");
  });

  test("the entrance animations stop under reduced motion", async ({ browser }) => {
    for (const [reducedMotion, duration] of [
      ["no-preference", "0.24s"],
      ["reduce", "1e-05s"],
    ] as const) {
      const context = await browser.newContext({ reducedMotion });
      const page = await context.newPage();
      await page.goto("/en");
      const hero = page.locator("main header").first();
      expect(await hero.evaluate((element) => getComputedStyle(element).animationDuration), reducedMotion).toBe(duration);
      await context.close();
    }
  });
});

test.describe("the vacancy page", () => {
  test("the salary and the actions form a panel that stays in view on a desktop and follows the title on a phone", async ({
    page,
  }) => {
    const company = await newCompany();
    const id = seedJob(company, {
      title: "Panel welder",
      status: "open",
      salary: { min: 3200, max: 3900, currency: "EUR", period: "month" },
      description: Array.from({ length: 40 }, (_, line) => `Line ${line + 1} of a long description of the work.`).join("\n"),
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/en/jobs/${id}`);
    const apply = page.getByRole("button", { name: "Apply" });
    await expect(apply).toBeVisible();
    await page.getByText("Line 40 of a long description").scrollIntoViewIfNeeded();
    await expect(apply).toBeInViewport();
    await expect(page.getByText("EUR 3,200 to 3,900, per month").first()).toBeInViewport();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/en/jobs/${id}`);
    const applyBox = await page.getByRole("button", { name: "Apply" }).boundingBox();
    const titleBox = await page.getByRole("heading", { level: 1 }).boundingBox();
    const detailsBox = await page.locator("dl").boundingBox();
    expect(applyBox!.y).toBeGreaterThan(titleBox!.y);
    expect(applyBox!.y).toBeLessThan(detailsBox!.y);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("the pricing page", () => {
  test("marks the recommended plan in words on its card only", async ({ page }) => {
    await page.goto("/en/pricing");
    const cards = page.getByRole("list", { name: "Employer plans" }).locator(":scope > li");
    await expect(cards.filter({ hasText: "Recommended" })).toHaveCount(1);
    await expect(cards.filter({ hasText: "Recommended" }).getByRole("heading")).toHaveText("Professional");
    await expect(cards.filter({ hasText: "Recommended" }).getByRole("link", { name: "Sign up for Professional" })).toBeVisible();
  });
});

test.describe("the legal pages", () => {
  test("a long text lists its sections, each a link to its heading, and a short one does not", async ({ page }) => {
    const slug = `e2e-contents-${uniqueToken()}`;
    const short = `e2e-short-${uniqueToken()}`;
    const body = ["Scope", "Your rights", "Contact"]
      .map((heading) => `## ${heading}\n\n${`The text of the ${heading.toLowerCase()} section. `.repeat(30)}`)
      .join("\n\n");
    execute(
      `insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values
        (${literal(slug)}, 1, 'Long notice', ${literal(body)}, 'The first text.', now() - interval '1 day'),
        (${literal(short)}, 1, 'Short notice', '## Only heading\n\nOne paragraph.', 'The first text.', now() - interval '1 day')`,
    );
    try {
      await page.goto(`/en/legal/${slug}`);
      const contents = page.getByRole("navigation", { name: "On this page" });
      await expect(contents.getByRole("link")).toHaveText(["Scope", "Your rights", "Contact"]);
      await contents.getByRole("link", { name: "Contact" }).click();
      await expect(page).toHaveURL(new RegExp(`/en/legal/${slug}#section-3$`));
      await expect(page.getByRole("heading", { level: 2, name: "Contact" })).toBeInViewport();
      await expectNoAxeViolations(page);

      await page.goto(`/en/legal/${short}`);
      await expect(page.getByRole("heading", { level: 2, name: "Only heading" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "On this page" })).toHaveCount(0);
    } finally {
      execute(`delete from public.legal_documents where slug in (${literal(slug)}, ${literal(short)})`);
    }
  });
});

test.describe("the sign-in journey", () => {
  test("the brand panel stands beside the form on a desktop and gives way to it on a phone", async ({ page }) => {
    for (const path of ["/en/login", "/en/signup"]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);
      const panel = page.getByText("The global workforce network.", { exact: true });
      await expect(panel, path).toBeVisible();
      const form = await page.getByRole("heading", { level: 1 }).boundingBox();
      expect((await panel.boundingBox())!.x, path).toBeLessThan(form!.x);
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(panel, path).toBeHidden();
      expect(await overflow(page), path).toBeLessThanOrEqual(0);
    }
  });

  test("onboarding shows where the person is in the three steps", async ({ browser }) => {
    for (const [make, current, last] of [
      [() => createTestUser("worker"), "Account type", "Passport"],
      [() => createCommittedUser("worker", { passport: false }), "Passport", "Passport"],
      [() => createCommittedUser("company"), "Organisation", "Organisation"],
    ] as const) {
      const context = await browser.newContext();
      await signInBrowser(context, await make());
      const page = await context.newPage();
      await page.goto("/en/onboarding");
      const steps = page.getByRole("list", { name: "Setting up your account" });
      await expect(steps.getByRole("listitem")).toHaveText([/Account \(done\)$/, /Account type/, new RegExp(last)]);
      await expect(steps.locator('[aria-current="step"]')).toContainText(current);
      await expectNoAxeViolations(page);
      await context.close();
    }
  });
});

test.describe("the redesigned pages at every width", () => {
  test("no page scrolls sideways and axe finds no serious violation at 1440, 1024, 768 and 375 px", async ({ page }) => {
    test.setTimeout(240_000);
    const company = await newCompany();
    const id = seedJob(company, { title: "Width welder", status: "open", accommodation: true, visaSupport: true });
    const paths = ["/en", "/en/jobs", `/en/jobs/${id}`, "/en/pricing", "/en/how-it-works", "/en/legal/privacy-policy", "/en/login", "/en/signup"];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of paths) {
        await settled(page, path);
        expect(await overflow(page), `${path} at ${width}`).toBeLessThanOrEqual(0);
      }
    }
  });
});
