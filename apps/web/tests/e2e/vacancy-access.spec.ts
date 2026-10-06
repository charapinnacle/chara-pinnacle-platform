import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { signInAsEmployer } from "./support/organizations";
import { signIn } from "./support/passport";
import {
  addCompanyUser,
  jobsUrl,
  jobUrl,
  newCompany,
  newJobUrl,
  previewUrl,
  seedJob,
} from "./support/jobs";
import { execute, literal } from "./support/db";

const UNAVAILABLE = "This vacancy is no longer available";

test.describe("vacancy pages: who sees what", () => {
  test("FR-C1 AC10: a member previews the draft in the public layout, noindex, and the other organisation gets not found", async ({
    page,
    browser,
  }) => {
    const acme = await newCompany();
    const beta = await newCompany();
    const member = await addCompanyUser(acme, "member");
    const betaAdmin = await addCompanyUser(beta, "admin");
    const id = seedJob(acme, { title: "Preview welder" });

    await logIn(page, member, previewUrl(acme.slug, id));
    await expect(page).toHaveURL(previewUrl(acme.slug, id));
    await expect(page.getByRole("status").filter({ hasText: "Preview - not public" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Preview welder", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Vacancy Bau / })).toBeVisible();
    await expect(page.getByText("Line two of it", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expectNoAxeViolations(page);

    await page.goto(jobUrl(acme.slug, id));
    await expectDraftBannerAndLinks(page, acme.slug, id);

    const outsider = await browser.newContext();
    const other = await outsider.newPage();
    await signInAsEmployer(other, betaAdmin);
    for (const path of [newJobUrl(acme.slug), jobUrl(acme.slug, id), previewUrl(acme.slug, id), jobsUrl(acme.slug)]) {
      await expectNotFound(other, path);
      await expect(other.getByText("Preview welder")).toHaveCount(0);
    }
    await outsider.close();
  });

  test("FR-C1 AC10: a visitor is sent to log in for the preview and gets the neutral page for the draft", async ({ page }) => {
    const acme = await newCompany();
    const id = seedJob(acme);

    await page.goto(previewUrl(acme.slug, id));
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(previewUrl(acme.slug, id))}`);

    const response = await page.goto(`/en/jobs/${id}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: UNAVAILABLE })).toBeVisible();
    await expect(page.getByText("Seeded welder")).toHaveCount(0);
    await expectNoAxeViolations(page);

    const unknown = await page.goto("/en/jobs/6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11");
    expect(unknown?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: UNAVAILABLE })).toBeVisible();
    const malformed = await page.goto("/en/jobs/not-an-id");
    expect(malformed?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: UNAVAILABLE })).toBeVisible();
  });

  test("FR-C1 AC10: a signed-in member of the organisation also gets the neutral page on the public address of a draft", async ({ page }) => {
    const acme = await newCompany();
    const id = seedJob(acme);
    await signInAsEmployer(page, acme.owner);
    const response = await page.goto(`/en/jobs/${id}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: UNAVAILABLE })).toBeVisible();
  });

  test("FR-C1: an open visible vacancy shows on the public address, a paused, hidden or deleted one does not", async ({ page }) => {
    const acme = await newCompany();
    const id = seedJob(acme, { title: "Open welder", status: "open" });

    const open = await page.goto(`/en/jobs/${id}`);
    expect(open?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Open welder", level: 1 })).toBeVisible();
    await expect(page.getByText("Hamburg, Germany")).toBeVisible();
    await expectNoAxeViolations(page);

    const others = [
      seedJob(acme, { title: "Paused welder", status: "paused" }),
      seedJob(acme, { title: "Hidden welder", status: "open", moderation: "hidden" }),
      seedJob(acme, { title: "Suspended welder", status: "open", moderation: "org_suspended" }),
      seedJob(acme, { title: "Deleted welder", status: "open" }),
    ];
    execute(`update public.jobs set deleted_at = now() where id = ${literal(others[3])}`);
    for (const other of others) {
      const response = await page.goto(`/en/jobs/${other}`);
      expect(response?.status(), other).toBe(404);
      await expect(page.getByRole("heading", { name: UNAVAILABLE }), other).toBeVisible();
    }
  });

  test("FR-C1 roles: a member opens the list and the vacancy but not the form; an admin and an owner open all pages without two-step verification", async ({
    page,
  }) => {
    const acme = await newCompany();
    const member = await addCompanyUser(acme, "member");
    const admin = await addCompanyUser(acme, "admin");
    const id = seedJob(acme, { title: "Role welder" });

    await logIn(page, member, jobsUrl(acme.slug));
    await expect(page).toHaveURL(jobsUrl(acme.slug));
    await expect(page.getByRole("link", { name: "Role welder" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create vacancy" })).toHaveCount(0);
    await page.goto(jobUrl(acme.slug, id));
    await expect(page.getByRole("heading", { name: "Role welder", level: 1 })).toBeVisible();
    await page.goto(newJobUrl(acme.slug));
    await expect(page).toHaveURL("/en/forbidden");
    await page.context().clearCookies();

    for (const user of [admin, acme.owner]) {
      await logIn(page, user, jobsUrl(acme.slug));
      await expect(page).toHaveURL(jobsUrl(acme.slug));
      await expect(page.getByRole("link", { name: "Create vacancy" })).toBeVisible();
      await expectNoAxeViolations(page);
      await page.goto(newJobUrl(acme.slug));
      await expect(page).toHaveURL(newJobUrl(acme.slug));
      await expect(page.getByRole("heading", { name: "New vacancy" })).toBeVisible();
      await page.context().clearCookies();
    }
  });

  test("FR-C1: the list shows the newest first in pages of 20 and follows the cursor without a gap or a repeat", async ({ page }) => {
    const acme = await newCompany();
    for (let index = 1; index <= 25; index += 1) {
      seedJob(acme, { title: `Vacancy ${String(index).padStart(2, "0")}`, createdAt: `now() - interval '${index} minutes'` });
    }
    await logIn(page, acme.owner, jobsUrl(acme.slug));
    const titles = page.getByRole("listitem").getByRole("link");
    await expect(titles).toHaveCount(20);
    await expect(titles.first()).toHaveText("Vacancy 01");
    await expect(titles.last()).toHaveText("Vacancy 20");

    await page.getByRole("link", { name: "Show more vacancies" }).click();
    await expect(page).toHaveURL(/\?after=/);
    await expect(titles).toHaveText(["Vacancy 21", "Vacancy 22", "Vacancy 23", "Vacancy 24", "Vacancy 25"]);
    await expect(page.getByRole("link", { name: "Show more vacancies" })).toHaveCount(0);

    await page.goto(`${jobsUrl(acme.slug)}?after=garbage`);
    await expect(titles).toHaveCount(20);
  });

  test("FR-C1: a vacancy of another organisation is not found under this organisation's address either", async ({ page }) => {
    const acme = await newCompany();
    const beta = await newCompany();
    const betaJob = seedJob(beta, { title: "Beta only" });
    await signInAsEmployer(page, acme.owner);
    for (const path of [jobUrl(acme.slug, betaJob), previewUrl(acme.slug, betaJob)]) {
      await expectNotFound(page, path);
    }
    await expect(page.getByText("Beta only")).toHaveCount(0);
  });

  test("FR-C1: a candidate gets not found on the organisation's pages", async ({ page }) => {
    const acme = await newCompany();
    const id = seedJob(acme);
    const candidate = await createCommittedUser("worker");
    await signIn(page, candidate);
    for (const path of [jobsUrl(acme.slug), newJobUrl(acme.slug), jobUrl(acme.slug, id), previewUrl(acme.slug, id)]) {
      await expectNotFound(page, path);
    }
  });
});

// These pages stream behind the loading boundary of the app group, so Next answers with status 200 and the not-found
// page, marked noindex; the public vacancy address is not behind one and answers 404 (checked where it is visited).
// The 200 is the recorded departure from FR-C1 AC10 (D45); the status is pinned so that a change shows up here.
async function expectNotFound(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await expect(page.getByRole("heading", { name: "Page not found" }), path).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first(), path).toHaveAttribute("content", /noindex/);
}

async function expectDraftBannerAndLinks(page: Page, slug: string, id: string) {
  await expect(page.getByRole("status").filter({ hasText: "Draft - not public" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Preview as candidates see it" })).toHaveAttribute("href", previewUrl(slug, id));
}
