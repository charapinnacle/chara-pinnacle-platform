import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { alertText, logIn } from "./support/login-page";
import { addCompanyUser, expectNotFound, jobAudit, jobRows, jobsUrl, jobUrl, newCompany, seedJob, statusAudit } from "./support/jobs";
import { captureActionRequests } from "./support/server-action";
import { publicUrl } from "./support/vacancy-page";

const editUrl = (slug: string, id: string) => `${jobUrl(slug, id)}/edit`;

function updatedAt(id: string): string {
  return execute(`select updated_at from public.jobs where id = ${literal(id)}`).trim();
}

test.describe("vacancy edit", () => {
  test("FR-C1 AC11: the owner corrects an open vacancy from the list, keeps its status, and the public page shows the change at once", async ({
    page,
  }) => {
    const acme = await newCompany();
    const id = seedJob(acme, {
      title: "Welder MIG/MAG",
      status: "open",
      statusChangedAt: "now() - interval '3 days'",
      salary: { min: 2800, max: 3400, currency: "EUR", period: "month" },
    });
    const before = updatedAt(id);

    await logIn(page, acme.owner, jobsUrl(acme.slug));
    await expect(page).toHaveURL(jobsUrl(acme.slug));
    await page.getByRole("link", { name: "Edit Welder MIG/MAG" }).click();
    await expect(page).toHaveURL(editUrl(acme.slug, id));
    await expect(page.getByRole("heading", { name: "Edit vacancy", level: 1 })).toBeVisible();
    await expect(page.getByText("Status: Open. Saving keeps the status, and the public page shows the changes at once.")).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Welder MIG/MAG");
    await expect(page.getByRole("combobox", { name: "Occupation", exact: true })).toHaveValue("7212 · Welders and flame cutters");
    await expect(page.getByLabel("Salary minimum")).toHaveValue("2800");
    await expect(page.getByLabel("Pay period")).toHaveValue("month");
    await expectNoAxeViolations(page);

    await page.getByLabel("Title", { exact: true }).fill("Welder MIG/MAG night shift");
    await page.getByLabel("City", { exact: true }).fill("Bremen");
    await page.getByLabel("Salary minimum").fill("");
    await page.getByLabel("Salary maximum").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(jobUrl(acme.slug, id));
    await expect(page.getByText("Vacancy saved", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welder MIG/MAG night shift", level: 1 })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /^Open/ })).toBeVisible();
    const [row] = jobRows(acme.id);
    expect(row).toMatchObject({
      title: "Welder MIG/MAG night shift",
      city: "Bremen",
      status: "open",
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      organization_id: acme.id,
    });
    expect(jobAudit(acme.id, "job.updated")).toEqual([
      {
        actor_id: acme.owner.id,
        entity_id: id,
        metadata: {
          organization_id: acme.id,
          changed_fields: ["city", "salary_currency", "salary_max", "salary_min", "salary_period", "title"],
        },
      },
    ]);
    expect(statusAudit(id)).toEqual([]);
    expect(new Date(updatedAt(id)).getTime()).toBeGreaterThan(new Date(before).getTime());

    const response = await page.goto(publicUrl(id));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Welder MIG/MAG night shift", level: 1 })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "Bremen, Germany" })).toBeVisible();
  });

  test("FR-C1 AC2, AC3: the edit form refuses invalid values next to their fields and saves nothing", async ({ page }) => {
    const acme = await newCompany();
    const admin = await addCompanyUser(acme, "admin");
    const id = seedJob(acme, { title: "Draft welder" });

    await logIn(page, admin, jobUrl(acme.slug, id));
    await page.getByRole("link", { name: "Edit vacancy" }).click();
    await expect(page).toHaveURL(editUrl(acme.slug, id));
    await page.getByLabel("Title", { exact: true }).fill("Weld");
    await page.getByLabel("Salary minimum").fill("5000");
    await page.getByLabel("Salary maximum").fill("4000");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(alertText(page)).toBeVisible();
    await expect(page.locator("#job-title-error")).toHaveText("The title must have at least 5 characters.");
    await expect(page.locator("#job-salary-min-error")).toHaveText("The minimum salary cannot be higher than the maximum.");
    await expect(page.locator("#job-salary-currency-error")).toHaveText("Select a currency when you enter a salary.");
    await expect(page).toHaveURL(editUrl(acme.slug, id));
    expect(jobRows(acme.id)[0]).toMatchObject({ title: "Draft welder", salary_min: null, status: "draft" });
    expect(jobAudit(acme.id, "job.updated")).toEqual([]);
    expect(jobAudit(acme.id, "job.form_invalid")).toEqual([]);
    await expectNoAxeViolations(page);

    await page.getByLabel("Title", { exact: true }).fill("Draft welder corrected");
    await page.getByLabel("Salary minimum").fill("");
    await page.getByLabel("Salary maximum").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(jobUrl(acme.slug, id));
    await expect(page.getByRole("status").filter({ hasText: "Draft - not public" })).toBeVisible();
    expect(jobRows(acme.id)[0]).toMatchObject({ title: "Draft welder corrected", status: "draft" });
  });

  test("FR-C1 roles: a member sees no edit link and is refused the page; another organisation gets not found", async ({ page, browser }) => {
    const acme = await newCompany();
    const beta = await newCompany();
    const member = await addCompanyUser(acme, "member");
    const id = seedJob(acme, { title: "Member welder", status: "open" });

    await logIn(page, member, jobsUrl(acme.slug));
    await expect(page.getByRole("link", { name: "Member welder" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Edit/ })).toHaveCount(0);
    await page.goto(jobUrl(acme.slug, id));
    await expect(page.getByRole("heading", { name: "Member welder", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit vacancy" })).toHaveCount(0);
    await page.goto(editUrl(acme.slug, id));
    await expect(page).toHaveURL("/en/forbidden");

    const other = await browser.newContext();
    const betaPage = await other.newPage();
    await logIn(betaPage, beta.owner, jobsUrl(beta.slug));
    await expect(betaPage).toHaveURL(jobsUrl(beta.slug));
    await expectNotFound(betaPage, editUrl(acme.slug, id));
    await other.close();
    expect(jobRows(acme.id)[0].title).toBe("Member welder");
  });

  test("FR-C7: a vacancy hidden by moderation can be corrected but stays hidden; a suspended organisation cannot edit", async ({ page }) => {
    const acme = await newCompany();
    const id = seedJob(acme, { title: "Hidden welder", status: "open", moderation: "hidden" });

    await logIn(page, acme.owner, editUrl(acme.slug, id));
    await expect(page).toHaveURL(editUrl(acme.slug, id));
    await expect(page.getByRole("status").filter({ hasText: "Saving your changes does not make it public again" })).toBeVisible();
    await page.getByLabel("Title", { exact: true }).fill("Welder with corrected wording");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(jobUrl(acme.slug, id));
    await expect(page.getByRole("status").filter({ hasText: "Hidden by moderation" })).toBeVisible();
    expect(jobRows(acme.id)[0]).toMatchObject({ title: "Welder with corrected wording", moderation_state: "hidden", status: "open" });
    expect((await page.goto(publicUrl(id)))?.status()).toBe(404);

    execute(`update public.organizations set status = 'suspended' where id = ${literal(acme.id)}`);
    await page.goto(editUrl(acme.slug, id));
    await expect(page.getByRole("alert").filter({ hasText: "This organization is suspended, so its vacancies are not available." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    expect(query<{ n: number }>(`select count(*)::int as n from audit.log where action = 'job.updated' and entity_id = ${literal(id)}`)[0].n).toBe(1);
  });

  test("FR-C1 AC12 in edit mode: a save without changes sends nothing, and a double click on Save changes writes one edit", async ({
    page,
  }) => {
    const acme = await newCompany();
    const id = seedJob(acme, { title: "Steady welder", status: "open" });
    const before = updatedAt(id);

    await logIn(page, acme.owner, editUrl(acme.slug, id));
    const save = page.getByRole("button", { name: "Save changes" });
    await waitForHydration(save);
    const calls = captureActionRequests(page);
    await save.click();
    await expect(page).toHaveURL(jobUrl(acme.slug, id));
    await expect(page.getByText("No changes to save", { exact: true })).toBeVisible();
    expect(calls).toHaveLength(0);
    expect(updatedAt(id)).toBe(before);
    expect(jobAudit(acme.id, "job.updated")).toEqual([]);

    await page.goto(editUrl(acme.slug, id));
    await waitForHydration(save);
    await page.route(`**${editUrl(acme.slug, id)}`, async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.getByLabel("City", { exact: true }).fill("Lübeck");
    await save.dblclick();
    await expect(page.getByRole("button", { name: "Saving vacancy..." })).toBeDisabled();
    await expect(page).toHaveURL(jobUrl(acme.slug, id));
    expect(calls).toHaveLength(1);
    expect(jobAudit(acme.id, "job.updated")).toEqual([expect.objectContaining({ metadata: { organization_id: acme.id, changed_fields: ["city"] } })]);
  });

  test("FR-C2: a filled vacancy is final, so it offers no edit link and its edit page shows no form", async ({ page }) => {
    const acme = await newCompany();
    const filled = seedJob(acme, { title: "Filled welder", status: "filled" });
    seedJob(acme, { title: "Closed welder", status: "closed" });

    await logIn(page, acme.owner, jobsUrl(acme.slug));
    await expect(page.getByRole("link", { name: "Edit Closed welder" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit Filled welder" })).toHaveCount(0);
    await page.goto(jobUrl(acme.slug, filled));
    await expect(page.getByRole("status").filter({ hasText: "Filled - not public" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit vacancy" })).toHaveCount(0);

    await page.goto(editUrl(acme.slug, filled));
    await expect(page.getByRole("status").filter({ hasText: "A filled vacancy is final, so it can no longer be changed." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go back to the vacancy" })).toHaveAttribute("href", jobUrl(acme.slug, filled));
    await expectNoAxeViolations(page);
    expect(jobAudit(acme.id, "job.updated")).toEqual([]);
  });
});
