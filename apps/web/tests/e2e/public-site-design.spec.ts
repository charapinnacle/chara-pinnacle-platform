import type { Page } from "@playwright/test";
import { pendingConsents } from "./support/accounts";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal } from "./support/db";
import { addCompanyUser, newCompany, previewUrl, seedJob } from "./support/jobs";
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
    const apply = page.getByRole("button", { name: /^Apply now/ });
    await expect(apply).toBeVisible();
    await page.getByText("Line 40 of a long description").scrollIntoViewIfNeeded();
    await expect(apply).toBeInViewport();
    await expect(page.getByText("EUR 3,200 to 3,900, per month").first()).toBeInViewport();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/en/jobs/${id}`);
    const applyBox = await page.getByRole("button", { name: /^Apply now/ }).boundingBox();
    const titleBox = await page.getByRole("heading", { level: 1 }).boundingBox();
    const detailsBox = await page.locator("dl").boundingBox();
    expect(applyBox!.y).toBeGreaterThan(titleBox!.y);
    expect(applyBox!.y).toBeLessThan(detailsBox!.y);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("the vacancy preview", () => {
  test("keeps one column in the narrow page of the signed-in area, with the panel between the title and the facts", async ({
    browser,
  }) => {
    const company = await newCompany();
    const id = seedJob(company, { title: "Preview panel welder" });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await signInBrowser(context, await addCompanyUser(company, "member"));
    const page = await context.newPage();
    await page.goto(previewUrl(company.slug, id));
    const titleBox = (await page.getByRole("heading", { level: 1, name: "Preview panel welder" }).boundingBox())!;
    const panelBox = (await page.getByRole("button", { name: /^Apply now/ }).boundingBox())!;
    const detailsBox = (await page.locator("article dl").boundingBox())!;
    expect(panelBox.y).toBeGreaterThan(titleBox.y);
    expect(panelBox.y).toBeLessThan(detailsBox.y);
    expect(panelBox.x).toBeLessThan(detailsBox.x + detailsBox.width / 2);
    await context.close();
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

  test("onboarding shows where the person is in the steps that are left, and none for the account or its type", async ({ browser }) => {
    for (const [make, labels, current] of [
      [async () => createTestUser("worker", await pendingConsents("worker")), [/Your profile$/, /Ready$/], "Your profile"],
      [() => createCommittedUser("worker", { passport: false }), [/Your profile$/, /Ready$/], "Your profile"],
      [() => createCommittedUser("company"), [/Company$/, /Security$/, /Ready$/], "Company"],
    ] as const) {
      const context = await browser.newContext();
      await signInBrowser(context, await make());
      const page = await context.newPage();
      await page.goto("/en/onboarding");
      const steps = page.getByRole("list", { name: "Setting up your account" });
      await expect(steps.getByRole("listitem")).toHaveText([...labels]);
      await expect(steps.locator('[aria-current="step"]')).toContainText(current);
      await expect(steps).not.toContainText("Account type");
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
