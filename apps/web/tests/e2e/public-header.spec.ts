import { signedInPage } from "./support/app-shell";
import { expectNoAxeViolations } from "./support/axe";
import { addCompanyUser, newCompany } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { EMPLOYERS_HEADER_LABELS, HEADER_LABELS, LATER_PHASE, MENU_LINKS } from "./support/public-pages";
import { expect, test } from "./support/test";

const nav = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main" });

test.describe("the header of the public pages (FR-H1 AC3, D81, D90)", () => {
  test("a visitor sees Find Jobs, For employers, Post a Job, Sign in and Menu, and Post a Job opens the employer sign-up", async ({ page }) => {
    await page.goto("/en/pricing");
    await expect(nav(page).getByRole("link")).toHaveText(HEADER_LABELS);
    await expect(nav(page).getByRole("link", { name: "For employers" })).toHaveAttribute("href", "/en/employers");
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "How Chara Pinnacle works" })).toHaveCount(0);
    await nav(page).getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/en/login");
    await page.getByRole("main").getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL("/en/signup");
    await page.goto("/en/pricing");
    for (const hidden of ["Pricing", "Trust & Safety", "About", "Contact"]) {
      await expect(nav(page).getByRole("link", { name: hidden })).toHaveCount(0);
    }
    await expectNoAxeViolations(page);

    await nav(page).getByRole("link", { name: "Post a Job" }).click();
    await expect(page).toHaveURL("/en/signup?kind=company");
    await expect(page.getByRole("radio", { name: "I'm an employer" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "I'm a worker" })).not.toBeChecked();
    await expect(page.getByText("Employer Terms")).toBeVisible();
  });

  test("a signed-in owner is sent by Post a Job to the new-vacancy page of the organisation, and Login and Sign up are gone", async ({ browser }) => {
    const company = await newCompany();
    const { context, page } = await signedInPage(browser, company.owner);
    await page.goto("/en/about");
    await expect(nav(page).getByRole("link", { name: "Post a Job" })).toHaveAttribute("href", "/en/post-job");
    expect(await page.content()).not.toContain(company.slug);
    await expect(nav(page).getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Sign up" })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await nav(page).getByRole("link", { name: "Post a Job" }).click();
    await expect(page).toHaveURL(`/en/org/${company.slug}/jobs/new`);
    await expect(page.getByRole("heading", { name: "New vacancy" })).toBeVisible();
    await context.close();
  });

  test("a signed-in employer without an organisation is sent to the employer dashboard", async ({ browser }) => {
    const employer = await createCommittedUser("company");
    const { context, page } = await signedInPage(browser, employer);
    await page.goto("/en/about");
    await expect(nav(page).getByRole("link", { name: "Post a Job" })).toHaveAttribute("href", "/en/post-job");
    await nav(page).getByRole("link", { name: "Post a Job" }).click();
    await expect(page).toHaveURL("/en/dashboard/employer");
    await context.close();
  });

  test("a member who cannot publish and a candidate see no Post a Job", async ({ browser }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const memberSession = await signedInPage(browser, member);
    await memberSession.page.goto("/en/about");
    await expect(nav(memberSession.page).getByRole("link", { name: "Go to my area" })).toBeVisible();
    await expect(nav(memberSession.page).getByRole("link", { name: "Post a Job" })).toHaveCount(0);
    await memberSession.page.goto("/en/post-job");
    await expect(memberSession.page).toHaveURL(/\/en\/dashboard\/employer/);
    await memberSession.context.close();

    const worker = await createCommittedUser("worker");
    const { context, page } = await signedInPage(browser, worker);
    await page.goto("/en/about");
    await expect(nav(page).getByRole("link")).toHaveText(["Find Jobs", "For employers", "Go to my area"]);
    await expect(nav(page).getByRole("link", { name: "Post a Job" })).toHaveCount(0);
    await page.goto("/en/post-job");
    await expect(page).toHaveURL("/en/dashboard/worker");
    await context.close();
  });

  test("a visitor who opens /post-job is sent to log in and an employer who logs in lands on the new-vacancy page", async ({ page }) => {
    const company = await newCompany();
    await page.goto("/en/post-job");
    await expect(page).toHaveURL("/en/login?next=%2Fen%2Fpost-job");
    await logIn(page, company.owner, "/en/post-job");
    await expect(page).toHaveURL(`/en/org/${company.slug}/jobs/new`);
  });

  test("on the For employers page For job seekers replaces Find Jobs and For employers, and leads home", async ({ page }) => {
    await page.goto("/en/employers");
    await expect(nav(page).getByRole("link")).toHaveText(EMPLOYERS_HEADER_LABELS);
    await nav(page).getByRole("link", { name: "For job seekers" }).click();
    await expect(page).toHaveURL("/en");
    await expect(nav(page).getByRole("link")).toHaveText(HEADER_LABELS);
  });

  test("the Menu opens a side panel that holds focus, names the later-phase navigation without links and closes by Escape, the close button and the backdrop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en/about");
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    const panel = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toHaveAttribute("aria-haspopup", "dialog");
    await expect(panel).toBeHidden();
    // Closed, nothing of the panel is reachable: it is not displayed.
    expect(await page.locator("#site-menu").evaluate((node) => getComputedStyle(node).display)).toBe("none");

    await menu.click();
    await expect(panel).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("button", { name: "Close menu" })).toBeFocused();
    await expect(panel.getByRole("navigation", { name: "Explore" }).getByRole("link")).toHaveText(MENU_LINKS);
    await expect(panel.getByRole("navigation", { name: "Explore" }).getByRole("link", { name: "For job seekers" })).toHaveAttribute("href", "/en");
    const later = panel.getByRole("list", { name: "Coming in a later phase" });
    await expect(later.getByRole("listitem")).toHaveText(LATER_PHASE.map((feature) => `${feature}Not yet available`));
    await expect(later.locator("a")).toHaveCount(0);
    for (const footerOnly of ["Pricing", "Trust & Safety", "About", "Contact"]) await expect(panel.getByRole("link", { name: footerOnly, exact: true })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/en/login");
    await expect(panel.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/en/signup");
    // At 1280 px Post a Job is in the header; the panel's own is for phones.
    await expect(panel.getByRole("link", { name: "Post a Job" })).toBeHidden();
    await expectNoAxeViolations(page);

    // Focus cannot leave the open panel: Tab from its last control comes back inside it.
    for (let press = 0; press < 12; press++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("#site-menu")) || document.activeElement === document.body), `press ${press}`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(menu).toBeFocused();

    await menu.click();
    await panel.getByRole("button", { name: "Close menu" }).click();
    await expect(panel).toBeHidden();
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    await menu.click();
    await page.mouse.click(40, 400);
    await expect(panel).toBeHidden();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  test("on a phone the header keeps the logo, Sign in and Menu; Post a Job moves into the panel below 420 px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/en");
    await expect(nav(page).getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    for (const hidden of ["Find Jobs", "For employers", "Post a Job"]) await expect(nav(page).getByRole("link", { name: hidden }), hidden).toBeHidden();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Menu" });
    await expect(panel.getByRole("link", { name: "Post a Job" })).toBeVisible();
    await panel.getByRole("link", { name: "Post a Job" }).click();
    await expect(page).toHaveURL("/en/signup?kind=company");

    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto("/en");
    await expect(nav(page).getByRole("link", { name: "Post a Job" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Find Jobs" })).toBeHidden();
  });
});
