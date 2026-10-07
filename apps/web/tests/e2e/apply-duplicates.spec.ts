import { literal, query } from "./support/db";
import {
  applicationRows,
  applicationsOf,
  applicationUrl,
  applyUrl,
  auditCount,
  displayName,
  eventRows,
  newApplicant,
  queuedForApplication,
  seedApplication,
  shareOf,
} from "./support/applications";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";
import { publicUrl } from "./support/vacancy-page";
import { SAVED_URL, seedSaved } from "./support/saved";

const CONSENT_LABEL = (employer: string) => `I agree to share the selected documents with ${employer} for this application`;

test.describe("one application per vacancy", () => {
  test("FR-D7 AC4: two requests sent together from two tabs create one application and both end on it, without an error", async ({
    browser,
  }) => {
    const company = await newCompany();
    const employer = displayName(company.id);
    const jobId = seedJob(company, { title: "Race welder", status: "open" });
    await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.8.7" } });
    await signInBrowser(context, candidate);
    const [first, second] = await Promise.all([context.newPage(), context.newPage()]);
    for (const tab of [first, second]) {
      await tab.goto(applyUrl(jobId));
      await waitForHydration(tab.getByLabel("Cover note (optional)"));
      await tab.getByLabel(CONSENT_LABEL(employer)).check();
    }

    await Promise.all([
      first.getByRole("button", { name: "Submit application" }).click(),
      second.getByRole("button", { name: "Submit application" }).click(),
    ]);
    for (const tab of [first, second]) {
      await expect(tab).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}(\?existing=1)?$/);
      await expect(tab.getByRole("heading", { name: "Race welder", level: 1 })).toBeVisible();
      await expect(tab.getByText(/error|violates|constraint|duplicate key/i)).toHaveCount(0);
    }

    const [application, ...others] = applicationRows(candidate.id);
    expect(others).toEqual([]);
    expect(first.url()).toContain(application.id);
    expect(second.url()).toContain(application.id);
    expect(shareOf(application.id)).toHaveLength(1);
    expect(eventRows(application.id)).toHaveLength(1);
    expect(auditCount("application.submitted", application.id)).toBe(1);
    expect(queuedForApplication(application.id)).toHaveLength(2);
    expect(
      query<{ n: number }>(`select count(*)::int as n from public.consents where user_id = ${literal(candidate.id)} and purpose like 'share_passport:%'`)[0].n,
    ).toBe(1);
    await context.close();
  });

  test("FR-D7 AC10: a double click on Submit sends one request", async ({ page }) => {
    const company = await newCompany();
    const employer = displayName(company.id);
    const jobId = seedJob(company, { title: "Double click welder", status: "open" });
    const candidate = await newApplicant();

    await logIn(page, candidate, applyUrl(jobId));
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    await page.getByLabel(CONSENT_LABEL(employer)).check();
    await page.route(`**${applyUrl(jobId)}`, async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith(applyUrl(jobId))) requests.push(request.url());
    });
    await page.getByRole("button", { name: "Submit application" }).dblclick();
    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}$/);

    expect(requests).toHaveLength(1);
    expect(applicationRows(candidate.id)).toHaveLength(1);
    const [{ id }] = applicationRows(candidate.id);
    expect(auditCount("application.duplicate_attempt", id)).toBe(0);
  });

  test("FR-D7 AC6, FR-C4 AC5: a candidate with an application sees its date and stage instead of Apply; the apply address leads to it", async ({
    page,
  }) => {
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Shortlisted welder", status: "open" });
    const candidate = await newApplicant();
    const id = seedApplication(candidate.id, jobId, company.id, { status: "shortlisted", createdAt: "'2026-10-03T10:00:00Z'" });

    await logIn(page, candidate, publicUrl(jobId));
    await expect(page.getByText("You applied on 3 Oct 2026, stage Shortlisted")).toBeVisible();
    await expect(page.getByRole("link", { name: "View your application" })).toHaveAttribute("href", applicationUrl(id));
    await expect(page.getByRole("link", { name: "Apply", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);

    await page.goto(applyUrl(jobId));
    await expect(page).toHaveURL(`${applicationUrl(id)}?existing=1`);
    await expect(page.getByRole("status").filter({ hasText: "You already applied to this vacancy." })).toBeVisible();
    await expect(page.locator("dd").filter({ hasText: /^Shortlisted$/ })).toBeVisible();
    expect(applicationRows(candidate.id)).toHaveLength(1);
    expect(auditCount("application.duplicate_attempt", id)).toBe(0);
  });

  test("FR-D7 AC6, FR-C4 AC5, FR-D7 AC3: after a withdrawal the page offers Apply again, and a new application is made while the vacancy is open", async ({
    page,
  }) => {
    const company = await newCompany();
    const employer = displayName(company.id);
    const jobId = seedJob(company, { title: "Again welder", status: "open" });
    const candidate = await newApplicant();
    const first = seedApplication(candidate.id, jobId, company.id, { status: "withdrawn", createdAt: "now() - interval '1 day'" });

    await logIn(page, candidate, publicUrl(jobId));
    await expect(page.getByText("You withdrew your application")).toBeVisible();
    await expect(page.getByRole("link", { name: "View your application" })).toHaveCount(0);
    await page.getByRole("link", { name: "Apply again" }).click();
    await expect(page).toHaveURL(applyUrl(jobId));
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    await page.getByLabel(CONSENT_LABEL(employer)).check();
    await page.getByRole("button", { name: "Submit application" }).click();
    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}$/);

    const rows = applicationsOf(jobId);
    expect(rows.map(({ status }) => status)).toEqual(["withdrawn", "applied"]);
    expect(rows[1].id).not.toBe(first);
    expect(page.url()).toContain(rows[1].id);

    await page.goto(publicUrl(jobId));
    await expect(page.getByText(/You applied on .*, stage Applied/)).toBeVisible();
  });

  test("FR-D7 AC3: a candidate who withdrew sees no way to apply again once the vacancy is closed", async ({ page }) => {
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Closed again welder", status: "closed" });
    const candidate = await newApplicant();
    seedApplication(candidate.id, jobId, company.id, { status: "withdrawn" });
    await logIn(page, candidate, applyUrl(jobId));
    await expect(page.getByRole("alert").filter({ hasText: "This vacancy is no longer accepting applications" })).toBeVisible();
    expect(applicationsOf(jobId)).toHaveLength(1);
  });

  test("FR-C5 AC9: the saved list marks an applied vacancy and links the application; the others offer Quick apply to the apply form", async ({
    page,
  }) => {
    const company = await newCompany();
    const candidate = await newApplicant();
    const applied = seedJob(company, { title: "Applied saved welder", status: "open" });
    const withdrawn = seedJob(company, { title: "Withdrawn saved welder", status: "open" });
    const fresh = seedJob(company, { title: "Fresh saved welder", status: "open" });
    seedSaved(candidate.id, applied, "now() - interval '3 minutes'");
    seedSaved(candidate.id, withdrawn, "now() - interval '2 minutes'");
    seedSaved(candidate.id, fresh, "now() - interval '1 minute'");
    const appliedId = seedApplication(candidate.id, applied, company.id);
    seedApplication(candidate.id, withdrawn, company.id, { status: "withdrawn" });

    await logIn(page, candidate, SAVED_URL);
    const row = (title: string) => page.locator("ul > li").filter({ hasText: title });
    await expect(row("Applied saved welder")).toContainText("Applied");
    await expect(row("Applied saved welder").getByRole("link", { name: /^View your application/ })).toHaveAttribute("href", applicationUrl(appliedId));
    await expect(row("Applied saved welder").getByRole("link", { name: /^Quick apply/ })).toHaveCount(0);
    for (const [title, id] of [["Withdrawn saved welder", withdrawn], ["Fresh saved welder", fresh]] as const) {
      await expect(row(title)).not.toContainText("Applied");
      await expect(row(title).getByRole("link", { name: /^Quick apply/ })).toHaveAttribute("href", applyUrl(id));
    }
    await row("Fresh saved welder").getByRole("link", { name: /^Quick apply/ }).click();
    await expect(page.getByRole("heading", { name: "Apply for Fresh saved welder", level: 1 })).toBeVisible();
  });
});
