import type { Locator, Page } from "@playwright/test";
import { PHONE } from "./support/app-shell";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, fillJob, jobAudit, jobRows, jobUrl, newCompany, newJobUrl, openMoreFilters, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { uniqueToken } from "./support/organizations";
import { expect, test } from "./support/test";
import { publicUrl } from "./support/vacancy-page";

const EXPERIENCE_FIELD = "Required experience (years)";
const MY_EXPERIENCE = "My experience (years)";

const cards = (page: Page, marker: string): Locator => page.locator("ul:not([aria-label='Active filters']) > li").filter({ hasText: marker });
const params = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);
const details = (page: Page) => page.getByRole("main").locator("dl");

test.describe("required experience on vacancies (FR-Q4 AC11)", () => {
  test("an admin saves a vacancy needing 3 years, its pages say so, and a vacancy without it says nothing", async ({ page }) => {
    const company = await newCompany();
    const admin = await addCompanyUser(company, "admin");
    await logIn(page, admin, newJobUrl(company.slug));
    await expect(page.getByLabel(EXPERIENCE_FIELD)).toBeVisible();

    await fillJob(page, { title: "Welder with experience" });
    await page.getByLabel(EXPERIENCE_FIELD).fill("41");
    await page.getByRole("button", { name: "Save vacancy" }).click();
    await expect(page.locator("#job-required-experience-error")).toHaveText(
      "Enter a whole number of years from 0 to 40, or leave it empty.",
    );
    await expect(page.getByLabel(EXPERIENCE_FIELD)).toBeFocused();
    expect(jobRows(company.id)).toEqual([]);

    await page.getByLabel(EXPERIENCE_FIELD).fill("3");
    await page.getByRole("button", { name: "Save vacancy" }).click();
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
    const [job] = jobRows(company.id);
    await expect(page).toHaveURL(jobUrl(company.slug, job.id));
    await expect(details(page)).toContainText("At least 3 years of experience");
    expect(execute(`select required_experience_years from public.jobs where id = ${literal(job.id)}`).trim()).toBe("3");

    execute(
      `select set_config('request.jwt.claims', json_build_object('sub', ${literal(admin.id)}, 'role', 'authenticated')::text, true);
       update public.jobs set status = 'open' where id = ${literal(job.id)}`,
    );
    await page.goto(publicUrl(job.id));
    await expect(details(page).getByText("Experience", { exact: true })).toBeVisible();
    await expect(details(page)).toContainText("At least 3 years of experience");
    await expectNoAxeViolations(page);

    const without = seedJob(company, { title: "Welder without a requirement", status: "open" });
    await page.goto(publicUrl(without));
    await expect(page.getByRole("heading", { name: "Welder without a requirement", level: 1 })).toBeVisible();
    await expect(details(page).getByText("Experience", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText("of experience");
  });

  test("an admin clears the required experience on the edit form and the change is audited by its name", async ({ page }) => {
    const company = await newCompany();
    const id = seedJob(company, { title: "Welder to correct", status: "open", requiredExperience: 5 });
    await logIn(page, company.owner, `${jobUrl(company.slug, id)}/edit`);
    const field = page.getByLabel(EXPERIENCE_FIELD);
    await waitForHydration(field);
    await expect(field).toHaveValue("5");

    await field.fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(jobUrl(company.slug, id));
    await expect(page.getByText("Vacancy saved", { exact: true })).toBeVisible();
    await expect(details(page)).not.toContainText("of experience");
    expect(execute(`select coalesce(required_experience_years::text, 'none') from public.jobs where id = ${literal(id)}`).trim()).toBe("none");
    expect(jobAudit(company.id, "job.updated").map(({ metadata }) => metadata.changed_fields)).toEqual([["required_experience_years"]]);
  });

  test("a visitor filters Find Jobs by experience, the address keeps experience=5 across pages and Back restores it", async ({ page }) => {
    const company = await newCompany();
    const marker = `zq${uniqueToken()}`;
    for (let n = 1; n <= 21; n++) {
      seedJob(company, {
        title: `Welder ${marker} ${String(n).padStart(2, "0")}`,
        status: "open",
        createdAt: `now() - interval '${n} minutes'`,
        requiredExperience: n % 3 === 0 ? null : n % 6,
      });
    }
    seedJob(company, { title: `Welder ${marker} senior`, status: "open", requiredExperience: 10 });

    await page.goto(`/en/jobs?q=${marker}`);
    await expect(cards(page, marker)).toHaveCount(20);
    await openMoreFilters(page);
    const field = page.getByLabel(MY_EXPERIENCE);
    await expect(field).toBeVisible();
    await field.fill("5");
    await page.getByRole("button", { name: "Search jobs" }).click();

    await expect.poll(() => params(page)).toEqual({ q: marker, experience: "5" });
    await expect(cards(page, marker)).toHaveCount(20);
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText("My experience: 5 years");
    const firstPageUrl = page.url();
    await expectNoAxeViolations(page);

    await page.getByRole("link", { name: "Show more vacancies" }).click();
    await expect(cards(page, marker)).toHaveCount(1);
    expect(params(page).experience).toBe("5");
    await expect(cards(page, marker).filter({ hasText: "senior" })).toHaveCount(0);

    await page.goBack();
    await expect(cards(page, marker)).toHaveCount(20);
    expect(page.url()).toBe(firstPageUrl);
    await openMoreFilters(page);
    await expect(page.getByLabel(MY_EXPERIENCE)).toHaveValue("5");
  });

  test("an experience the address cannot carry is dropped with a message naming experience, at phone width too", async ({ browser }) => {
    const context = await browser.newContext(PHONE);
    try {
      const page = await context.newPage();
      await page.goto("/en/jobs?experience=41");
      await expect(page.getByRole("alert").filter({ hasText: "Enter your experience as a whole number of years from 0 to 40." })).toBeVisible();
      await openMoreFilters(page);
      await expect(page.getByLabel(MY_EXPERIENCE)).toHaveValue("");
      await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);
      await expectNoAxeViolations(page);
    } finally {
      await context.close();
    }
  });
});
