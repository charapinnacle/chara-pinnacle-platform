import type { Locator, Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { waitForHydration } from "./support/hydration";
import { chooseFromList, newCompany, seedJob, type Company } from "./support/jobs";
import { logIn, overflow } from "./support/login-page";
import { organizationRows, uniqueToken } from "./support/organizations";
import { expect, test } from "./support/test";

// The shared database holds the vacancies of every other test, so each test searches for a word of its own.
const newMarker = () => `zq${uniqueToken()}`;

const cards = (page: Page, marker: string): Locator => page.locator("ul:not([aria-label='Active filters']) > li").filter({ hasText: marker });
const status = (page: Page, text: string): Locator => page.getByRole("status").filter({ hasText: text });
const params = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

function seedMany(company: Company, marker: string, count: number): void {
  for (let n = 1; n <= count; n++) {
    seedJob(company, {
      title: `Welder ${marker} ${String(n).padStart(2, "0")}`,
      status: "open",
      createdAt: `now() - interval '${n} minutes'`,
      salary: { min: 2500, max: 3500, currency: "EUR", period: "month" },
    });
  }
}

test.describe("public vacancy search", () => {
  test("FR-C3 AC8: the filters and the page are in the address, Back restores them in the form and a new visitor sees the same results", async ({
    page,
    browser,
  }) => {
    const company = await newCompany();
    const marker = newMarker();
    seedMany(company, marker, 25);

    await page.goto("/en/jobs");
    await waitForHydration(page.getByLabel("Keyword", { exact: true }));
    await page.getByLabel("Keyword", { exact: true }).fill(marker);
    await chooseFromList(page, "Country", "Germany", /^Germany$/);
    await page.getByLabel("Employment type").selectOption("full_time");
    await page.getByLabel("Salary at least").fill("3000");
    await chooseFromList(page, "Currency", "EUR", /^EUR /);
    await page.getByLabel("Pay period").selectOption("month");
    await page.getByRole("button", { name: "Search vacancies" }).click();

    await expect
      .poll(() => params(page))
      .toEqual({
        q: marker,
        country: "DE",
        employment_type: "full_time",
        salary_min: "3000",
        salary_currency: "EUR",
        salary_period: "month",
      });
    await expect(cards(page, marker)).toHaveCount(20);
    await expect(cards(page, marker).first()).toBeVisible();
    const firstPageUrl = page.url();
    const firstPageTitles = await cards(page, marker).getByRole("heading").allTextContents();
    await expect(status(page, "vacancies shown")).toHaveText("20 vacancies shown, more on the next page");

    await page.getByRole("link", { name: "Show more vacancies" }).click();
    await expect(cards(page, marker)).toHaveCount(5);
    await expect(cards(page, marker).first()).toBeVisible();
    expect(params(page).cursor).toMatch(/^[0-9.e+-]+\|\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[0-9a-f-]{36}$/);
    expect(params(page).country).toBe("DE");
    await expect(status(page, "vacancies shown")).toHaveText("5 vacancies shown");
    const secondPageTitles = await cards(page, marker).getByRole("heading").allTextContents();
    expect(new Set([...firstPageTitles, ...secondPageTitles]).size).toBe(25);

    await page.goBack();
    await expect(cards(page, marker)).toHaveCount(20);
    expect(page.url()).toBe(firstPageUrl);
    await expect(page.getByLabel("Keyword", { exact: true })).toHaveValue(marker);
    await expect(page.getByRole("combobox", { name: "Country", exact: true })).toHaveValue("Germany");
    await expect(page.getByLabel("Employment type")).toHaveValue("full_time");
    await expect(page.getByLabel("Salary at least")).toHaveValue("3000");

    await page.getByLabel("City", { exact: true }).fill("Hamburg");
    await page.getByRole("button", { name: "Search vacancies" }).click();
    await expect.poll(() => params(page).city).toBe("Hamburg");
    await expect(cards(page, marker)).toHaveCount(20);
    await page.goBack();
    await expect(page.getByLabel("City", { exact: true })).toHaveValue("");
    expect(page.url()).toBe(firstPageUrl);

    const visitor = await browser.newContext();
    try {
      const other = await visitor.newPage();
      await other.goto(firstPageUrl);
      await expect(cards(other, marker)).toHaveCount(20);
      await expect(cards(other, marker).first()).toBeVisible();
      expect(await cards(other, marker).getByRole("heading").allTextContents()).toEqual(firstPageTitles);
      await expect(other.getByLabel("Keyword", { exact: true })).toHaveValue(marker);
    } finally {
      await visitor.close();
    }
  });

  test("FR-C3 AC9: a result card shows the key facts of a vacancy and no person, and every filter has a visible label", async ({
    page,
  }) => {
    const company = await newCompany();
    const [organization] = organizationRows(company.owner.id);
    const marker = newMarker();
    const id = seedJob(company, {
      title: `Welder ${marker}`,
      status: "open",
      city: "Hamburg",
      salary: { min: 2800, max: 3400, currency: "EUR", period: "month" },
      accommodation: true,
      visaSupport: true,
    });

    await page.goto(`/en/jobs?q=${marker}`);
    const card = cards(page, marker);
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("heading", { level: 2 })).toHaveText(`Welder ${marker}`);
    await expect(card.getByRole("link", { name: `Welder ${marker}` })).toHaveAttribute("href", `/en/jobs/${id}`);
    await expect(card).toContainText(organization.display_name);
    await expect(card).toContainText("Hamburg, Germany");
    await expect(card).toContainText("Full time");
    await expect(card).toContainText("EUR 2,800 to 3,400, per month");
    await expect(card.getByText("Accommodation", { exact: true })).toBeVisible();
    await expect(card.getByText("Visa support", { exact: true })).toBeVisible();
    await expect(card).toContainText(/Posted [A-Z][a-z]+ \d{1,2}, \d{4}/);
    await expect(status(page, "1 vacancy shown")).toBeVisible();
    const text = (await page.locator("body").innerText()) + (await page.content());
    expect(text).not.toContain(organization.legal_name);
    expect(text).not.toContain(company.owner.email);

    for (const label of ["Country", "Occupation", "Industry", "Currency"]) {
      await expect(page.getByRole("combobox", { name: label, exact: true }), label).toBeVisible();
    }
    for (const label of ["Keyword", "City", "Employment type", "Recruitment", "Salary at least", "Pay period", "Accommodation provided", "Visa support offered"]) {
      await expect(page.getByLabel(label, { exact: true }), label).toBeVisible();
    }
  });

  test("FR-C3 AC9: the form is filled and sent from the keyboard, and Enter in the keyword field runs the search", async ({ page }) => {
    const company = await newCompany();
    const marker = newMarker();
    seedJob(company, { title: `Welder ${marker}`, status: "open" });
    seedJob(company, { title: `Welder ${marker} in Sweden`, status: "open", country: "SE", city: "Malmo" });

    await page.goto("/en/jobs");
    const keyword = page.getByLabel("Keyword", { exact: true });
    await waitForHydration(keyword);
    await keyword.focus();
    await page.keyboard.type(marker);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("combobox", { name: "Country", exact: true })).toBeFocused();
    await page.keyboard.type("Germany");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("combobox", { name: "Country", exact: true })).toHaveValue("Germany");
    await page.keyboard.press("Shift+Tab");
    await expect(keyword).toBeFocused();
    await page.keyboard.press("Enter");

    await expect.poll(() => params(page)).toEqual({ q: marker, country: "DE" });
    await expect(cards(page, marker)).toHaveCount(1);
    await expect(cards(page, marker)).toContainText("Hamburg, Germany");
  });

  test("FR-C3 AC9: the results stream behind a skeleton that the server sends before them", async ({ page }) => {
    const company = await newCompany();
    const marker = newMarker();
    seedJob(company, { title: `Welder ${marker}`, status: "open" });

    const html = await (await page.request.get(`/en/jobs?q=${marker}`)).text();
    const skeleton = html.indexOf('<span class="sr-only">Loading</span>');
    expect(skeleton).toBeGreaterThan(-1);
    expect(html.indexOf(`Welder ${marker}`)).toBeGreaterThan(skeleton);
  });

  test("FR-C3 AC9: no results show the empty state, and Clear filters brings back the unfiltered search", async ({ page }) => {
    const marker = newMarker();
    await page.goto("/en/jobs");
    await waitForHydration(page.getByLabel("Keyword", { exact: true }));
    await page.getByLabel("Keyword", { exact: true }).fill(marker);
    await page.getByRole("button", { name: "Search vacancies" }).click();

    const empty = page.getByRole("status").filter({ has: page.getByRole("heading", { name: "No vacancies match your search" }) });
    await expect(empty).toBeVisible();
    await expectNoAxeViolations(page);
    await empty.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL("/en/jobs");
    await expect(page.getByLabel("Keyword", { exact: true })).toHaveValue("");
    await expect(page.getByRole("heading", { name: "No vacancies match your search" })).toHaveCount(0);
  });

  test("FR-C3 AC1: only the open, visible vacancy of a company is found, by a visitor and by the owner signed in", async ({ page }) => {
    const company = await newCompany();
    const marker = newMarker();
    seedJob(company, { title: `Visible ${marker}`, status: "open" });
    for (const [label, status, moderation] of [
      ["draft", "draft", "visible"],
      ["paused", "paused", "visible"],
      ["closed", "closed", "visible"],
      ["filled", "filled", "visible"],
      ["hidden", "open", "hidden"],
      ["suspended", "open", "org_suspended"],
    ] as const) {
      seedJob(company, { title: `Not public ${label} ${marker}`, status, moderation });
    }

    await page.goto(`/en/jobs?q=${marker}`);
    await expect(cards(page, marker)).toHaveCount(1);
    await expect(cards(page, marker)).toContainText(`Visible ${marker}`);

    await logIn(page, company.owner, `/en/jobs?q=${marker}`);
    await expect(page).toHaveURL(`/en/jobs?q=${marker}`);
    await expect(cards(page, marker)).toHaveCount(1);
    await expect(cards(page, marker)).toContainText(`Visible ${marker}`);
    await expect(page.getByText("Not public", { exact: false })).toHaveCount(0);
  });

  test("FR-C3: a value in the address that does not parse is reported and the rest of the search still runs", async ({ page }) => {
    const company = await newCompany();
    const marker = newMarker();
    seedJob(company, { title: `Welder ${marker}`, status: "open" });

    await page.goto(`/en/jobs?q=${marker}&country=DEU&salary_min=3000`);
    const notice = page.getByRole("alert").filter({ hasText: "Some search options were ignored" });
    await expect(notice).toContainText("Select a country from the list.");
    await expect(notice).toContainText("Select a currency for the minimum salary.");
    await expect(notice).toContainText("Select a pay period for the minimum salary.");
    await expect(cards(page, marker)).toHaveCount(1);
    await expect(page.getByRole("combobox", { name: "Country", exact: true })).toHaveValue("");
    await expect(page.getByLabel("Salary at least")).toHaveValue("");
  });

  test("FR-C3 AC7: a crafted page link is reported and the first page is shown, not the error page", async ({ page }) => {
    const company = await newCompany();
    const marker = newMarker();
    seedJob(company, { title: `Welder ${marker}`, status: "open" });
    const uuid = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

    for (const cursor of [`0|T|${"-".repeat(36)}`, `0|2026-13-45T10:00:00.123456Z|${uuid}`]) {
      await page.goto(`/en/jobs?q=${marker}&cursor=${encodeURIComponent(cursor)}`);
      await expect(page.getByRole("alert").filter({ hasText: "The page link is not valid, so the first page is shown." })).toBeVisible();
      await expect(cards(page, marker)).toHaveCount(1);
      await expect(page.getByText("The vacancies could not be loaded")).toHaveCount(0);
    }
  });

  test("FR-C3 AC9: at 360 px the page, with results and without, has no accessibility violations and no sideways scroll", async ({ page }) => {
    const company = await newCompany();
    const marker = newMarker();
    seedMany(company, marker, 3);
    await page.setViewportSize({ width: 360, height: 800 });

    await page.goto(`/en/jobs?q=${marker}`);
    await expect(cards(page, marker)).toHaveCount(3);
    await expectNoAxeViolations(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await page.goto(`/en/jobs?q=${marker}x`);
    await expect(page.getByRole("heading", { name: "No vacancies match your search" })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("FR-C3: the form refuses a minimum salary without its currency and pay period and names what is missing", async ({ page }) => {
    await page.goto("/en/jobs");
    await waitForHydration(page.getByLabel("Salary at least"));
    await page.getByLabel("Salary at least").fill("3000");
    await page.getByRole("button", { name: "Search vacancies" }).click();
    await expect(page.getByText("Select a currency for the minimum salary.")).toBeVisible();
    await expect(page.getByText("Select a pay period for the minimum salary.")).toBeVisible();
    await expect(page).toHaveURL("/en/jobs");
  });
});
