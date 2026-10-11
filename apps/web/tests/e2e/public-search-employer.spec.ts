import type { Locator, Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { evidence } from "./support/evidence";
import { waitForHydration } from "./support/hydration";
import { newCompany, openMoreFilters, seedJob } from "./support/jobs";
import { organizationRows, uniqueToken } from "./support/organizations";
import { execute, literal } from "./support/db";
import { expect, test } from "./support/test";

const cards = (page: Page, marker: string): Locator => page.locator("ul:not([aria-label='Active filters']) > li").filter({ hasText: marker });

function rename(organizationId: string, displayName: string): void {
  execute(`update public.organizations set display_name = ${literal(displayName)} where id = ${literal(organizationId)}`);
}

test.describe("the Employer filter of Find Jobs", () => {
  test("FR-C3: the Employer field is in More filters, narrows the results by part of the name, is in the address and has a chip", async ({ page }) => {
    const marker = `zq${uniqueToken()}`;
    const first = await newCompany();
    const second = await newCompany();
    const [firstName, secondName] = [`Nordbau ${marker}`, `Sudwerk ${marker}`];
    rename(first.id, firstName);
    rename(second.id, secondName);
    seedJob(first, { title: `Welder ${marker} first`, status: "open" });
    seedJob(second, { title: `Welder ${marker} second`, status: "open" });
    seedJob(second, { title: `Welder ${marker} draft`, status: "draft" });
    expect(organizationRows(first.owner.id)[0].display_name).toBe(firstName);

    await page.goto("/en/jobs");
    await page.getByLabel("Keyword", { exact: true }).fill(marker);
    await expect(page.getByLabel("Employer")).toBeHidden();
    await openMoreFilters(page);
    await expect(page.getByLabel("Employer")).toBeVisible();
    await evidence(page, "find-jobs-employer-filter");
    await expectAccessibleAtBothWidths(page);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Search jobs" }).click();
    await expect(page).toHaveURL(`/en/jobs?q=${marker}`);
    await expect(cards(page, marker)).toHaveCount(2);

    await openMoreFilters(page);
    await page.getByLabel("Employer").fill(`  NORDBAU ${marker.toUpperCase()}  `);
    await page.getByRole("button", { name: "Search jobs" }).click();
    await expect(page).toHaveURL(new RegExp(`employer=${encodeURIComponent(`NORDBAU ${marker.toUpperCase()}`).replaceAll("%20", "(\\+|%20)")}`));
    await expect(cards(page, marker)).toHaveCount(1);
    await expect(cards(page, marker).first()).toContainText(`Welder ${marker} first`);
    await expect(cards(page, marker).first()).toContainText(firstName);
    const chip = page.getByRole("list", { name: "Active filters" }).getByRole("link", { name: /Employer: NORDBAU/ });
    await expect(chip).toBeVisible();
    await evidence(page, "find-jobs-employer-results");

    await page.goto(`/en/jobs?q=${marker}&employer=${marker}`);
    await expect(cards(page, marker)).toHaveCount(2);
    await page.goto(`/en/jobs?q=${marker}&employer=sudwerk`);
    await expect(cards(page, marker)).toHaveCount(1);
    await expect(cards(page, marker).first()).toContainText(`Welder ${marker} second`);

    await page.goto(`/en/jobs?q=${marker}&employer=nordbau+${marker}`);
    await page.getByRole("list", { name: "Active filters" }).getByRole("link", { name: /Employer: nordbau/ }).click();
    await expect(cards(page, marker)).toHaveCount(2);
    expect(new URL(page.url()).searchParams.has("employer")).toBe(false);
  });

  test("FR-C3: one character is refused next to the field, and an unknown employer finds nothing", async ({ page }) => {
    await page.goto("/en/jobs");
    await openMoreFilters(page);
    const field = page.getByLabel("Employer");
    await waitForHydration(field);
    await field.fill("a");
    await page.getByRole("button", { name: "Search jobs" }).click();
    await expect(page.getByText("Use 2 to 100 characters in the employer.").first()).toBeVisible();

    await page.goto(`/en/jobs?employer=zz${uniqueToken()}`);
    await expect(page.getByText(/No vacancies/i).first()).toBeVisible();
  });
});
