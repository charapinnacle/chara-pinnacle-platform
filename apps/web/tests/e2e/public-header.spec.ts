import { signedInPage } from "./support/app-shell";
import { expectNoAxeViolations } from "./support/axe";
import { addCompanyUser, newCompany } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { HEADER_LABELS } from "./support/public-pages";
import { expect, test } from "./support/test";

const nav = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main" });

test.describe("the header of the public pages (FR-H1 AC3, D81)", () => {
  test("a visitor sees Find Jobs, How CHARA Works, Post a Job, Login and Sign up, and Post a Job opens the employer sign-up", async ({ page }) => {
    await page.goto("/en/pricing");
    await expect(nav(page).getByRole("link")).toHaveText(HEADER_LABELS);
    await expect(nav(page).getByRole("link", { name: "Login", exact: true })).toHaveAttribute("href", "/en/login");
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
    await expect(nav(page).getByRole("link", { name: "Post a Job" })).toHaveAttribute("href", `/en/org/${company.slug}/jobs/new`);
    await expect(nav(page).getByRole("link", { name: "Login", exact: true })).toHaveCount(0);
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
    await expect(nav(page).getByRole("link", { name: "Post a Job" })).toHaveAttribute("href", "/en/dashboard/employer");
    await context.close();
  });

  test("a member who cannot publish and a candidate see no Post a Job", async ({ browser }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const memberSession = await signedInPage(browser, member);
    await memberSession.page.goto("/en/about");
    await expect(nav(memberSession.page).getByRole("link", { name: "Go to my area" })).toBeVisible();
    await expect(nav(memberSession.page).getByRole("link", { name: "Post a Job" })).toHaveCount(0);
    await memberSession.context.close();

    const worker = await createCommittedUser("worker");
    const { context, page } = await signedInPage(browser, worker);
    await page.goto("/en/about");
    await expect(nav(page).getByRole("link")).toHaveText(["Find Jobs", "How CHARA Works", "Go to my area"]);
    await expect(nav(page).getByRole("link", { name: "Post a Job" })).toHaveCount(0);
    await context.close();
  });
});
