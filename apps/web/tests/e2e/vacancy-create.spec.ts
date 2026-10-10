import { env } from "@/lib/env";
import { expect, test } from "./support/test";
import { breadcrumbs } from "./support/app-shell";
import { expectNoAxeViolations } from "./support/axe";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import {
  addCompanyUser,
  DESCRIPTION,
  expectDraftBanner,
  FIELD_LABELS,
  fillJob,
  jobAudit,
  jobRows,
  jobsUrl,
  jobUrl,
  newCompany,
  newJobUrl,
} from "./support/jobs";
import { summary } from "./support/signup-page";
import { captureActionRequests } from "./support/server-action";

test.describe("create vacancy", () => {
  test("FR-C1 AC1: an owner at aal1 creates a complete draft, lands on its page and the public cannot find it", async ({ page }) => {
    const company = await newCompany();
    await logIn(page, company.owner, newJobUrl(company.slug));
    await expect(page).toHaveURL(newJobUrl(company.slug));
    await expect(page.getByRole("heading", { name: "New vacancy" })).toBeVisible();
    await expectNoAxeViolations(page);

    await fillJob(page, { title: "Welder MIG/MAG" });
    await page.getByRole("button", { name: "Save vacancy" }).click();
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);

    const [job, ...rest] = jobRows(company.id);
    expect(rest).toEqual([]);
    await expect(page).toHaveURL(jobUrl(company.slug, job.id));
    await expectDraftBanner(page);
    await expect(page.getByRole("heading", { name: "Welder MIG/MAG", level: 1 })).toBeVisible();
    await expect(page.getByText("Welders and flame cutters", { exact: true })).toBeVisible();
    await expect(page.getByText("EUR 2,800 to 3,400, per month")).toBeVisible();
    await expectNoAxeViolations(page);

    expect(job).toMatchObject({
      title: "Welder MIG/MAG",
      description: DESCRIPTION,
      occupation_id: "7212",
      industry_code: "C",
      country_code: "DE",
      city: "Hamburg",
      employment_type: "full_time",
      salary_min: "2800.00",
      salary_max: "3400.00",
      salary_currency: "EUR",
      salary_period: "month",
      accommodation: true,
      visa_support: true,
      recruitment_preference: "both",
      status: "draft",
      moderation_state: "visible",
      deleted_at: null,
      organization_id: company.id,
      created_by: company.owner.id,
      posted_on_behalf_of_organization_id: null,
    });
    const created = jobAudit(company.id, "job.created");
    expect(created).toEqual([
      { actor_id: company.owner.id, entity_id: job.id, metadata: { organization_id: company.id } },
    ]);

    const anonymous = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}&select=id`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    });
    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toEqual([]);
  });

  test("FR-C1 steps: an admin saves a draft without a salary and sees it in the list as not public", async ({ page }) => {
    const company = await newCompany();
    const admin = await addCompanyUser(company, "admin");
    await logIn(page, admin, jobsUrl(company.slug));
    await expect(page.getByRole("heading", { name: "No vacancies yet" })).toBeVisible();
    await page.getByRole("link", { name: "Create vacancy" }).click();
    await expect(page).toHaveURL(newJobUrl(company.slug));
    await fillJob(page, { title: "Crane operator", salary: null });
    await page.getByRole("button", { name: "Save vacancy" }).click();

    const [job] = jobRows(company.id);
    await expect(page).toHaveURL(jobUrl(company.slug, job.id));
    await expect(page.getByText("Not stated", { exact: true })).toBeVisible();
    expect(job).toMatchObject({ salary_min: null, salary_max: null, salary_currency: null, salary_period: null, created_by: admin.id });

    await breadcrumbs(page).getByRole("link", { name: "Vacancies" }).click();
    await expect(page).toHaveURL(jobsUrl(company.slug));
    const row = page.getByRole("listitem").filter({ hasText: "Crane operator" });
    await expect(row).toContainText("Hamburg, Germany");
    await expect(row).toContainText("Draft - not public");
  });

  test("FR-C1 AC6: the occupation is chosen from the list with the arrow keys, a free text industry is not accepted", async ({ page }) => {
    const company = await newCompany();
    await logIn(page, company.owner, newJobUrl(company.slug));
    const calls = captureActionRequests(page);

    const occupation = page.getByRole("combobox", { name: "Occupation", exact: true });
    const options = page.getByRole("listbox", { name: "Occupation" }).getByRole("option");
    await occupation.fill("electric");
    expect(await options.count()).toBeGreaterThan(2);
    const second = (await options.nth(1).textContent()) ?? "";
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(occupation).toHaveValue(second);

    await occupation.fill("weld");
    await expect(options.filter({ hasText: "Welders and flame cutters" })).toHaveCount(1);
    await occupation.fill("welding");
    await expect(options).toHaveText(["7212 · Welders and flame cutters"]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(occupation).toHaveValue("7212 · Welders and flame cutters");

    await page.getByLabel("Title", { exact: true }).fill("Welder");
    await page.getByLabel("Description", { exact: true }).fill(DESCRIPTION);
    const industry = page.getByRole("combobox", { name: "Industry", exact: true });
    await industry.fill("Welding xyz");
    await expect(page.getByRole("listbox", { name: "Industry" }).getByRole("option")).toHaveText(["No match"]);
    await page.getByRole("button", { name: "Save vacancy" }).click();

    await expect(page.locator("#job-industry-error")).toHaveText("Select an industry from the list.");
    await expect(industry).toBeFocused();
    await expect(summary(page).getByRole("link", { name: "Select an industry from the list." })).toBeVisible();
    expect(calls.map(({ body }) => body).join("")).not.toContain("Welder");
    expect(jobRows(company.id)).toEqual([]);
  });

  test("FR-C1 AC9: the form has exactly the fields of the criterion and a Platform Rules link that opens in a new tab", async ({
    page,
    context,
  }) => {
    const company = await newCompany();
    await logIn(page, company.owner, newJobUrl(company.slug));
    await expect(page.getByRole("heading", { name: "New vacancy" })).toBeVisible();

    const labels = page.locator("main form label");
    await expect(labels).toHaveText([...FIELD_LABELS]);
    const controls = page.locator("main form").locator("input:not([type=hidden]), textarea, select");
    await expect(controls).toHaveCount(FIELD_LABELS.length);
    for (const forbidden of [/gender/i, /\bage\b/i, /nationality/i, /religion/i, /marital/i, /photo/i]) {
      await expect(page.locator("main form").getByLabel(forbidden)).toHaveCount(0);
    }

    await page.getByLabel("Title", { exact: true }).fill("Entered title");
    const link = page.getByRole("main").getByRole("link", { name: /Platform Rules/ });
    await expect(link).toHaveAttribute("href", "/en/legal/platform-rules");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await page.getByLabel("Title", { exact: true }).focus();
    for (let presses = 0; presses < 5 && !(await link.evaluate((el) => el === document.activeElement)); presses += 1) {
      await page.keyboard.press("Shift+Tab");
    }
    await expect(link).toBeFocused();
    const popup = context.waitForEvent("page");
    await page.keyboard.press("Enter");
    const opened = await popup;
    await expect(opened).toHaveURL(/\/en\/legal\/platform-rules$/);
    await opened.close();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Entered title");
  });

  test("FR-C1 AC12: empty required fields are named next to the fields, announced, and focus goes to the first one", async ({ page }) => {
    const company = await newCompany();
    await logIn(page, company.owner, newJobUrl(company.slug));
    const calls = captureActionRequests(page);
    await page.getByRole("button", { name: "Save vacancy" }).click();

    await expect(page.locator("#job-title-error")).toHaveText("Enter the title.");
    await expect(page.locator("#job-description-error")).toHaveText("Enter the description.");
    await expect(page.locator("#job-occupation-error")).toHaveText("Select an occupation from the list.");
    await expect(page.locator("#job-employment-type-error")).toHaveText("Select an employment type.");
    await expect(summary(page)).toBeVisible();
    await expect(summary(page).getByRole("link")).toHaveCount(8);
    await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
    await expect(page.getByLabel("Title", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(jobRows(company.id)).toEqual([]);

    await summary(page).getByRole("link", { name: "Enter the description." }).click();
    await expect(page.getByLabel("Description", { exact: true })).toBeFocused();
    expect(calls.map(({ body }) => body).join("")).not.toContain("Welder");
  });

  test("FR-C1 AC12: a keyboard-only user fills the form, and a double click on Submit creates one row", async ({ page }) => {
    const company = await newCompany();
    await logIn(page, company.owner, newJobUrl(company.slug));
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Title", { exact: true }).focus();
    await page.keyboard.type("Keyboard welder");
    await page.keyboard.press("Tab");
    await page.keyboard.type(DESCRIPTION);
    await page.keyboard.press("Tab");
    await page.keyboard.type("weld");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("manuf");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("germa");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Hamburg");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Full");
    await page.keyboard.press("Tab");
    await page.keyboard.type("2800");
    await page.keyboard.press("Tab");
    await page.keyboard.type("3400");
    await page.keyboard.press("Tab");
    await page.keyboard.type("EUR");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Per m");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Local and");
    await expect(page.getByLabel("Recruitment preference")).toHaveValue("both");
    await expect(page.getByLabel("Employment type")).toHaveValue("full_time");
    await expect(page.getByLabel("Pay period")).toHaveValue("month");

    const calls = captureActionRequests(page);
    await page.route(`**${newJobUrl(company.slug)}`, async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.continue();
    });
    await page.getByRole("button", { name: "Save vacancy" }).dblclick();
    await expect(page.getByRole("button", { name: "Saving vacancy..." })).toBeDisabled();
    const rows = () => jobRows(company.id);
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
    expect(calls).toHaveLength(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ title: "Keyboard welder", occupation_id: "7212", visa_support: false, accommodation: true });
  });

  test("FR-C1 AC12: when the server answers with an error a toast appears, the typed values stay and nothing is created", async ({
    page,
  }) => {
    const company = await newCompany();
    await logIn(page, company.owner, newJobUrl(company.slug));
    await fillJob(page, { title: "Failing welder" });
    await page.route(`**${newJobUrl(company.slug)}`, (route) =>
      route.request().method() === "POST" ? route.fulfill({ status: 500, body: "boom" }) : route.continue(),
    );
    await page.getByRole("button", { name: "Save vacancy" }).click();

    await expect(page.getByText("Could not save the vacancy", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Failing welder");
    await expect(page.getByLabel("City", { exact: true })).toHaveValue("Hamburg");
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(DESCRIPTION);
    await expect(page.getByRole("combobox", { name: "Occupation", exact: true })).toHaveValue("7212 · Welders and flame cutters");
    await expect(page.getByRole("button", { name: "Save vacancy" })).toBeEnabled();
    expect(jobRows(company.id)).toEqual([]);

    await page.unroute(`**${newJobUrl(company.slug)}`);
    await page.getByRole("button", { name: "Save vacancy" }).click();
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
    expect(jobRows(company.id)).toHaveLength(1);
  });

  test("FR-C1 AC12: a network failure shows an error toast and keeps what was typed", async ({ page, context }) => {
    const company = await newCompany();
    await logIn(page, company.owner, newJobUrl(company.slug));
    await fillJob(page, { title: "Offline welder" });
    await context.setOffline(true);
    await page.getByRole("button", { name: "Save vacancy" }).click();
    await expect(page.getByText("Could not save the vacancy", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Offline welder");
    await expect(page.getByLabel("City", { exact: true })).toHaveValue("Hamburg");
    await context.setOffline(false);
    expect(jobRows(company.id)).toEqual([]);
  });

  test("FR-C1 KPI: a refused form is reported with its field names and a valid one is not", async ({ page }) => {
    const company = await newCompany();
    await logIn(page, company.owner, newJobUrl(company.slug));
    await page.getByRole("button", { name: "Save vacancy" }).click();
    await expect(summary(page)).toBeVisible();
    await expect.poll(() => jobAudit(company.id, "job.form_invalid").length).toBe(1);
    const [report] = jobAudit(company.id, "job.form_invalid");
    expect(report.actor_id).toBe(company.owner.id);
    expect(report.metadata.fields).toEqual(
      expect.arrayContaining(["title", "description", "occupation", "industry", "country", "city", "employmentType", "recruitmentPreference"]),
    );
    expect(JSON.stringify(report.metadata)).not.toContain("Hamburg");

    await fillJob(page, { title: "Counted welder" });
    await page.getByRole("button", { name: "Save vacancy" }).click();
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
    expect(jobAudit(company.id, "job.form_invalid")).toHaveLength(1);
    expect(jobAudit(company.id, "job.created")).toHaveLength(1);
  });

  test("FR-C1 NFR-U2: the form and the vacancy page fit a 360 px screen without scrolling sideways", async ({ page }) => {
    const company = await newCompany();
    await page.setViewportSize({ width: 360, height: 800 });
    await logIn(page, company.owner, newJobUrl(company.slug));
    await expect(page.getByRole("heading", { name: "New vacancy" })).toBeVisible();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await fillJob(page, { title: "Narrow screen welder with a rather long title to check how it wraps" });
    await page.getByRole("button", { name: "Save vacancy" }).click();
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
  });

  test("FR-C1: a plain candidate who opens the new vacancy form is sent away and creates nothing", async ({ page }) => {
    const company = await newCompany();
    const candidate = await createCommittedUser("worker");
    await logIn(page, candidate, newJobUrl(company.slug));
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(jobRows(company.id)).toEqual([]);
  });
});
