import type { Locator, Page } from "@playwright/test";
import { PHONE, signedInPage } from "./support/app-shell";
import { signIn } from "./support/passport";
import { newApplicant, seedApplication } from "./support/applications";
import { seedListApplicant, subscribe } from "./support/applicant-list";
import { expectNoAxeViolations } from "./support/axe";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany, newJobUrl, seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { expect, test } from "./support/test";

const combobox = (page: Page, name: string): Locator => page.getByRole("combobox", { name, exact: true });
const optionNodes = (page: Page): Locator => page.locator("[role=option]");
const announcement = (page: Page): Locator => page.locator("[aria-live=polite]").filter({ hasText: /result|match/i });
const filtersToggle = (page: Page): Locator => page.getByRole("button", { name: "Filters", exact: true });
const filtersRegion = (page: Page): Locator => page.getByRole("group", { name: "Filters", exact: true });

async function openJobs(page: Page): Promise<void> {
  await page.goto("/en/jobs");
  await waitForHydration(page.getByLabel("Keyword", { exact: true }));
}

test.describe("UX-02, PERF-01: the list of a combobox", () => {
  test("PERF-01: no option is in the page while the list is closed, and an open list holds at most 50", async ({ page }) => {
    await openJobs(page);
    await expect(optionNodes(page)).toHaveCount(0);
    await expect(combobox(page, "Country")).toHaveAttribute("aria-expanded", "false");

    await combobox(page, "Country").click();
    await expect(combobox(page, "Country")).toHaveAttribute("aria-expanded", "true");
    await expect(optionNodes(page)).toHaveCount(50);
    await expect(page.getByText(/^Showing 50 of \d+\. Type to narrow the list\.$/)).toBeVisible();
    await expect(announcement(page)).toHaveText(/^\d+ results available, 50 are listed\. Type to narrow the list\.$/);

    await page.keyboard.press("Escape");
    await expect(optionNodes(page)).toHaveCount(0);
    await expect(combobox(page, "Country")).toHaveAttribute("aria-expanded", "false");
  });

  test("UX-02: a click opens the list, typing narrows the whole list and a click on an option chooses it", async ({ page }) => {
    await openJobs(page);
    await combobox(page, "Country").click();
    await expect(page.getByRole("listbox", { name: "Country" })).toBeVisible();

    await combobox(page, "Country").fill("germ");
    await expect(optionNodes(page)).toHaveText(["Germany"]);
    await expect(announcement(page)).toHaveText("1 result available");
    await expect(page.getByText(/^Showing \d+ of/)).toHaveCount(0);

    await page.getByRole("option", { name: "Germany" }).click();
    await expect(combobox(page, "Country")).toHaveValue("Germany");
    await expect(optionNodes(page)).toHaveCount(0);

    await combobox(page, "Country").click();
    await expect(optionNodes(page).first()).toHaveText("Germany");
    await expect(optionNodes(page).first()).toHaveAttribute("aria-selected", "true");
    await combobox(page, "Country").fill("zzzz");
    await expect(optionNodes(page)).toHaveText(["No match"]);
    await expect(announcement(page)).toHaveText("No match");
  });

  test("UX-02: the chevron opens and closes the list, keeps the focus in the field and is at least 44 px", async ({ page }) => {
    await openJobs(page);
    const chevron = page.getByRole("button", { name: "Show Country options" });
    const box = await chevron.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);

    await chevron.click();
    await expect(combobox(page, "Country")).toBeFocused();
    await expect(optionNodes(page)).toHaveCount(50);
    const option = await optionNodes(page).first().boundingBox();
    expect(option?.height).toBeGreaterThanOrEqual(44);
    await chevron.click();
    await expect(optionNodes(page)).toHaveCount(0);
  });

  test("UX-02: opening the list moves nothing on the page", async ({ page }) => {
    await openJobs(page);
    const next = page.getByRole("button", { name: "Search vacancies" });
    const before = await next.boundingBox();
    await combobox(page, "Country").click();
    await expect(optionNodes(page)).toHaveCount(50);
    expect(await next.boundingBox()).toEqual(before);
  });

  test("UX-02: the keyboard opens the list, moves through it, chooses with Enter and leaves with Escape and Tab", async ({ page }) => {
    await openJobs(page);
    const country = combobox(page, "Country");
    await country.focus();
    await expect(optionNodes(page)).toHaveCount(0);

    await page.keyboard.press("ArrowDown");
    await expect(country).toHaveAttribute("aria-expanded", "true");
    const activeText = () =>
      country.evaluate((input) => document.getElementById(input.getAttribute("aria-activedescendant") ?? "")?.textContent ?? null);
    expect(await activeText()).toBe("Afghanistan");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await activeText()).toBe("Albania");
    await page.keyboard.press("ArrowUp");
    expect(await activeText()).toBe("Åland Islands");
    await page.keyboard.press("End");
    await expect(optionNodes(page).last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    expect(await activeText()).toBe("Afghanistan");

    await page.keyboard.press("Escape");
    await expect(country).toHaveAttribute("aria-expanded", "false");
    await expect(country).toHaveValue("");

    await page.keyboard.type("fran");
    await expect(optionNodes(page)).toHaveText(["France"]);
    await page.keyboard.press("Enter");
    await expect(country).toHaveValue("France");
    await expect(optionNodes(page)).toHaveCount(0);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("x");
    await page.keyboard.press("Tab");
    await expect(country).toHaveAttribute("aria-expanded", "false");
    await expect(country).toHaveValue("France");
  });

  test("UX-02: Home and End move the text cursor until an arrow key is used, and ArrowUp opens the list", async ({ page }) => {
    await openJobs(page);
    const country = combobox(page, "Country");
    await country.click();
    await page.keyboard.type("germany");
    await page.keyboard.press("Home");
    await page.keyboard.type("x");
    await expect(country).toHaveValue("xgermany");
    await expect(country).not.toHaveAttribute("aria-activedescendant");
    await page.keyboard.press("End");
    await expect(country).not.toHaveAttribute("aria-activedescendant");
    await page.keyboard.press("Escape");

    await country.focus();
    await page.keyboard.press("ArrowUp");
    await expect(country).toHaveAttribute("aria-expanded", "true");
    await expect(optionNodes(page)).toHaveCount(50);
  });

  test("UX-02: a chosen option beyond the first 50 is listed and highlighted when the list opens again", async ({ page }) => {
    await openJobs(page);
    const country = combobox(page, "Country");
    await country.fill("zimbabwe");
    await page.getByRole("option", { name: "Zimbabwe" }).click();
    await expect(country).toHaveValue("Zimbabwe");

    await country.click();
    await expect(optionNodes(page)).toHaveCount(50);
    await expect(optionNodes(page).last()).toHaveText("Zimbabwe");
    await expect(optionNodes(page).last()).toHaveAttribute("aria-selected", "true");
    await expect(country).toHaveAttribute("aria-activedescendant", /-option-49$/);
  });

  test("UX-02: the list has no accessibility violation when it is open, on a wide screen and on a phone", async ({ page, browser }) => {
    await openJobs(page);
    await combobox(page, "Country").click();
    await expect(optionNodes(page)).toHaveCount(50);
    await page.keyboard.press("ArrowDown");
    await expectNoAxeViolations(page);

    const context = await browser.newContext(PHONE);
    const phone = await context.newPage();
    await openJobs(phone);
    await combobox(phone, "Country").click();
    await phone.keyboard.press("ArrowDown");
    await expect(optionNodes(phone)).toHaveCount(50);
    await expectNoAxeViolations(phone);
    await context.close();
  });

  test("UX-02: a free-text field opens its suggestions on a click and keeps the typed text on Enter", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await signIn(page, user);
    await page.goto("/en/passport");
    const skills = combobox(page, "Skills");
    await waitForHydration(skills);

    await skills.click();
    await expect(optionNodes(page)).toHaveCount(50);
    await expect(skills).toHaveAttribute("aria-expanded", "true");
    await skills.fill("Zzz own skill");
    await expect(optionNodes(page)).toHaveCount(0);
    await expect(skills).toHaveAttribute("aria-expanded", "false");
    await expect(skills).not.toHaveAttribute("aria-controls");
    await page.keyboard.press("Enter");
    await expect(skills).toHaveValue("Zzz own skill");
    await expect(page.getByText("Skill added", { exact: true })).toBeVisible();
  });

  test("UX-02: a tap opens the list and a tap on an option chooses it", async ({ browser }) => {
    const context = await browser.newContext({ ...PHONE, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await openJobs(page);
    await combobox(page, "Country").tap();
    await expect(optionNodes(page)).toHaveCount(50);
    await combobox(page, "Country").fill("germany");
    await page.getByRole("option", { name: "Germany" }).tap();
    await expect(combobox(page, "Country")).toHaveValue("Germany");
    await expect(optionNodes(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Show Country options" }).tap();
    await expect(optionNodes(page)).toHaveCount(50);
    await context.close();
  });

  test("UX-02: the country of the onboarding form opens by click, tap and keyboard and has no accessibility violation open", async ({
    browser,
  }) => {
    const user = await createCommittedUser("worker", { passport: false });
    const { context, page } = await signedInPage(browser, user, { ...PHONE, hasTouch: true });
    await page.goto("/en/onboarding");
    await waitForHydration(page.getByLabel("First name", { exact: true }));

    const country = combobox(page, "Current country");
    await country.click();
    await expect(optionNodes(page)).toHaveCount(50);
    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(optionNodes(page)).toHaveCount(0);

    await country.tap();
    await expect(optionNodes(page)).toHaveCount(50);
    await page.keyboard.press("Escape");

    await country.blur();
    await country.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(country).toHaveValue("Åland Islands");
    await context.close();
  });

  test("UX-02: the occupation of the vacancy form opens by click and chooses by keyboard", async ({ browser }) => {
    const company = await newCompany();
    const { context, page } = await signedInPage(browser, company.owner);
    await page.goto(newJobUrl(company.slug));
    await waitForHydration(page.getByLabel("Title", { exact: true }));

    const occupation = combobox(page, "Occupation");
    await occupation.click();
    await expect(optionNodes(page)).toHaveCount(50);
    await expect(page.getByText(/^Showing 50 of \d+\./)).toBeVisible();
    await page.keyboard.type("7212");
    await expect(optionNodes(page)).toHaveText([/^7212 · Welders and flame cutters$/]);
    await page.keyboard.press("Enter");
    await expect(occupation).toHaveValue(/^7212 · Welders and flame cutters$/);
    await expect(optionNodes(page)).toHaveCount(0);

    await combobox(page, "Country").click();
    await expect(optionNodes(page)).toHaveCount(50);
    await expectNoAxeViolations(page);
    await context.close();
  });

  test("UX-02: the occupation of the vacancy form opens by tap", async ({ browser }) => {
    const company = await newCompany();
    const { context, page } = await signedInPage(browser, company.owner, { ...PHONE, hasTouch: true });
    await page.goto(newJobUrl(company.slug));
    await waitForHydration(page.getByLabel("Title", { exact: true }));
    await combobox(page, "Occupation").tap();
    await expect(optionNodes(page)).toHaveCount(50);
    await combobox(page, "Occupation").fill("7212");
    await page.getByRole("option", { name: /^7212 · / }).tap();
    await expect(combobox(page, "Occupation")).toHaveValue(/^7212 · Welders and flame cutters$/);
    await context.close();
  });
});

test.describe("UX-02: the country of the vacancy search without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("a native select takes the place of the combobox and the form searches by the country code", async ({ page }) => {
    await page.goto("/en/jobs");
    await expect(page.locator("#search-country")).toBeHidden();
    await page.locator("select[name=country]").selectOption({ label: "Germany" });
    await page.getByLabel("Keyword", { exact: true }).fill("welder");
    await page.getByRole("button", { name: "Search vacancies" }).click();
    await expect(page).toHaveURL(/[?&]country=DE(&|$)/);
    await expect(page).toHaveURL(/[?&]q=welder(&|$)/);
    await expect(page.getByRole("link", { name: "Remove filter Country: Germany" })).toBeVisible();
  });
});

test.describe("UX-06: the vacancy search puts the results first", () => {
  test("a phone sees the keyword, the country and the results, and opens the filters with a button", async ({ browser }) => {
    const company = await newCompany();
    const marker = `zq${Date.now().toString(36)}`;
    seedJob(company, { title: `Welder ${marker}`, status: "open" });
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    await page.goto(`/en/jobs?q=${marker}`);
    await waitForHydration(page.getByLabel("Keyword", { exact: true }));

    await expect(filtersToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(filtersRegion(page)).toBeHidden();
    await expect(page.getByLabel("Keyword", { exact: true })).toBeVisible();
    await expect(combobox(page, "Country")).toBeVisible();
    const card = page.getByRole("heading", { name: `Welder ${marker}` });
    await expect(card).toBeVisible();
    expect((await card.boundingBox())?.y).toBeLessThan(812);

    await filtersToggle(page).click();
    await expect(filtersToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(filtersRegion(page)).toBeVisible();
    for (const label of ["City", "Occupation", "Industry", "Employment type", "Recruitment", "Salary at least", "Currency", "Pay period"]) {
      await expect(page.getByLabel(label, { exact: true }).first(), label).toBeVisible();
    }
    await expectNoAxeViolations(page);
    await filtersToggle(page).click();
    await expect(filtersRegion(page)).toBeHidden();
    await context.close();
  });

  test("a wide screen shows the filters beside the results and no toggle", async ({ page }) => {
    await openJobs(page);
    await expect(filtersRegion(page)).toBeVisible();
    await expect(filtersToggle(page)).toBeHidden();
    const keyword = await page.getByLabel("Keyword", { exact: true }).boundingBox();
    const results = await page.getByRole("status").filter({ hasText: /vacanc/ }).boundingBox();
    expect(results?.x).toBeGreaterThan((keyword?.x ?? 0) + (keyword?.width ?? 0));
    expect(results?.y).toBeLessThan((keyword?.y ?? 0) + 100);
    await expectNoAxeViolations(page);
  });

  test("a filter that the form refuses opens the closed filters and names the problem", async ({ browser }) => {
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    await openJobs(page);
    await filtersToggle(page).click();
    await page.getByLabel("Salary at least").fill("2800");
    await filtersToggle(page).click();
    await expect(page.getByLabel("Salary at least")).toBeHidden();
    await page.getByRole("button", { name: "Search vacancies" }).click();
    await expect(filtersRegion(page)).toBeVisible();
    await expect(page.getByText("Select a currency for the minimum salary.")).toBeVisible();
    await context.close();
  });

  test("the active filters are chips that remove one filter each and keep the others", async ({ page }) => {
    const search =
      "q=welder&country=DE&employment_type=full_time&salary_min=2800&salary_currency=EUR&salary_period=month&accommodation=true";
    await page.goto(`/en/jobs?${search}`);
    await waitForHydration(page.getByLabel("Keyword", { exact: true }));
    const chips = page.getByRole("list", { name: "Active filters" }).getByRole("listitem");
    await expect(chips).toHaveText([
      "Remove filter Keyword: welder",
      "Remove filter Country: Germany",
      "Remove filter Employment type: Full time",
      "Remove filter Minimum salary: 2800 EUR per month",
      "Remove filter Accommodation provided",
    ]);
    for (const chip of await chips.all()) expect((await chip.getByRole("link").boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expectNoAxeViolations(page);

    await page.getByRole("link", { name: "Remove filter Country: Germany" }).click();
    await expect(page).toHaveURL(
      /\/en\/jobs\?q=welder&employment_type=full_time&salary_min=2800&salary_currency=EUR&salary_period=month&accommodation=true$/,
    );
    await expect(combobox(page, "Country")).toHaveValue("");
    await expect(chips).toHaveCount(4);

    await page.getByRole("link", { name: /^Remove filter Minimum salary/ }).click();
    await expect(page).toHaveURL(/\/en\/jobs\?q=welder&employment_type=full_time&accommodation=true$/);
    await expect(page.getByLabel("Salary at least")).toHaveValue("");
    await expect(combobox(page, "Currency")).toHaveValue("");

    for (const name of ["Keyword: welder", "Employment type: Full time", "Accommodation provided"]) {
      const chip = page.getByRole("link", { name: `Remove filter ${name}` });
      await chip.click();
      await expect(chip).toHaveCount(0);
    }
    await expect(page).toHaveURL(/\/en\/jobs$/);
    await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);
  });

  test("A11Y-02: a single-line checkbox row is at least 44 px high", async ({ browser }) => {
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    await openJobs(page);
    await filtersToggle(page).click();
    for (const name of ["Accommodation provided", "Visa support offered"]) {
      const row = page.getByRole("checkbox", { name }).locator("xpath=ancestor::*[@data-slot='field'][1]");
      expect((await row.boundingBox())?.height, name).toBeGreaterThanOrEqual(44);
    }
    await context.close();
  });
});

test.describe("A11Y-01, A11Y-03: the applicant lists", () => {
  test("WCAG 3.2.2: the stage filter changes nothing until Apply is pressed, and Apply keeps the other parameters", async ({
    browser,
  }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const job = seedJob(company, { title: "Filtered welder", status: "open" });
    seedListApplicant(company, job, { name: "Ana Silva", status: "applied", appliedAt: "2026-09-04T10:00:00Z", completeness: 80 });
    seedListApplicant(company, job, { name: "Ben Okoro", status: "shortlisted", appliedAt: "2026-09-03T10:00:00Z", completeness: 55 });
    const member = await addCompanyUser(company, "member");
    const { context, page } = await signedInPage(browser, member);
    await page.goto(`/en/org/${company.slug}/applicants?job=${job}&sort=stage&dir=asc`);
    await waitForHydration(page.getByLabel("Filter by stage"));
    const rows = page.getByRole("table").locator("tbody tr");
    await expect(rows).toHaveCount(2);

    await page.getByLabel("Filter by stage").selectOption({ label: "Shortlisted" });
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain("stage=");
    await expect(rows).toHaveCount(2);

    await page.getByLabel("Filter by stage").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Apply filter" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`job=${job}&sort=stage&dir=asc&stage=shortlisted$`));
    await expect(rows).toHaveCount(1);
    await expect(page.getByLabel("Filter by stage")).toHaveValue("shortlisted");
    await expectNoAxeViolations(page);
    await context.close();
  });

  test("WCAG 3.2.2: the stage filter is a plain GET form that needs no JavaScript on both lists", async ({ browser }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const job = seedJob(company, { title: "Plain welder", status: "open" });
    const candidate = await newApplicant();
    seedApplication(candidate.id, job, company.id, { status: "shortlisted" });
    seedApplication(candidate.id, seedJob(company, { title: "Other welder", status: "open" }), company.id, { status: "applied" });

    // The signed-in pages stream their content, which only a browser with scripts unhides: the HTML is read as it is sent.
    const htmlOf = async (session: Awaited<ReturnType<typeof signedInPage>>, path: string) =>
      (await session.context.request.get(path)).text();
    const worker = await signedInPage(browser, candidate);
    const all = await htmlOf(worker, "/en/applications");
    expect(all).toMatch(/<form[^>]*action="\/en\/applications"[^>]*method="get"/);
    expect(all).toMatch(/<select[^>]*name="stage"/);
    expect(all).toContain("Apply filter");
    expect(all).toContain("Plain welder");
    expect(all).toContain("Other welder");
    const shortlisted = await htmlOf(worker, "/en/applications?stage=shortlisted");
    expect(shortlisted).toContain("Plain welder");
    expect(shortlisted).not.toContain("Other welder");
    expect(shortlisted).toMatch(/<option value="shortlisted" selected/);
    await worker.context.close();

    const member = await addCompanyUser(company, "member");
    const staff = await signedInPage(browser, member);
    const applicants = await htmlOf(staff, `/en/org/${company.slug}/applicants?job=${job}&sort=stage&dir=asc`);
    expect(applicants).toMatch(new RegExp(`<form[^>]*action="/en/org/${company.slug}/applicants"[^>]*method="get"`));
    expect(applicants).toMatch(new RegExp(`<input type="hidden" name="job" value="${job}"`));
    expect(applicants).toMatch(/<input type="hidden" name="sort" value="stage"/);
    expect(applicants).toMatch(/<select[^>]*name="stage"/);
    await staff.context.close();
  });

  test("A11Y-03: the stacked applicant table on a phone keeps the table, row, header and cell roles", async ({ browser }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const job = seedJob(company, { title: "Stacked welder", status: "open" });
    seedListApplicant(company, job, { name: "Ana Silva", appliedAt: "2026-09-04T10:00:00Z", completeness: 80, documents: 1 });
    seedListApplicant(company, job, { name: "Ben Okoro", status: "shortlisted", appliedAt: "2026-09-03T10:00:00Z", completeness: 55 });
    const member = await addCompanyUser(company, "member");
    const { context, page } = await signedInPage(browser, member, PHONE);
    await page.goto(`/en/org/${company.slug}/applicants?job=${job}`);

    const table = page.getByRole("table", { name: "Applicants" });
    await expect(table).toBeVisible();
    expect(await table.evaluate((element) => getComputedStyle(element).display)).toBe("block");
    await expect(table.getByRole("columnheader")).toHaveCount(6);
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(table.getByRole("rowgroup")).toHaveCount(2);
    await expect(table.getByRole("cell")).toHaveCount(2 * 6);
    await expect(table.getByRole("row").nth(1).getByRole("cell").nth(2)).toHaveText("Applied");
    await expectNoAxeViolations(page);
    await context.close();
  });
});
