import { execute } from "./support/db";
import {
  applicationRows,
  APPLICATIONS_URL,
  applyUrl,
  displayName,
  newApplicant,
  seedApplication,
} from "./support/applications";
import { seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { expect, test } from "./support/test";

const APPLY = "public.apply_to_job(uuid, text, uuid[])";
const LIST = "public.my_applications(public.application_status, integer, integer)";
const GET = "public.get_my_application(uuid)";

// The functions are withdrawn from the API role for the whole database while this file runs, so it has a project of its
// own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  for (const signature of [APPLY, LIST, GET]) execute(`grant execute on function ${signature} to authenticated`);
});

test.describe("applications when the database fails", () => {
  test("FR-D1 AC12: a failed submission shows an alert, keeps the note and the ticked boxes, and a second try works", async ({ page }) => {
    const company = await newCompany();
    const employer = displayName(company.id);
    const jobId = seedJob(company, { title: "Failing welder", status: "open" });
    const candidate = await newApplicant();
    await seedDocument(candidate.id, { title: "CV.pdf" });
    await logIn(page, candidate, applyUrl(jobId));
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    await page.getByLabel("Cover note (optional)").fill("My typed note");
    await page.getByLabel("CV.pdf").check();
    await page.getByLabel(`I agree to share the selected documents with ${employer} for this application`).check();
    execute(`revoke execute on function ${APPLY} from authenticated`);

    await page.getByRole("button", { name: "Submit application" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "There is a problem" });
    await expect(alert).toContainText("We could not complete this request. Try again.");
    await expect(page.getByLabel("Cover note (optional)")).toHaveValue("My typed note");
    await expect(page.getByLabel("CV.pdf")).toBeChecked();
    await expect(page.getByLabel(`I agree to share the selected documents with ${employer} for this application`)).toBeChecked();
    await expect(page.getByRole("button", { name: "Submit application" })).toBeEnabled();
    await expect(page.getByText(/permission denied|apply_to_job/)).toHaveCount(0);
    expect(applicationRows(candidate.id)).toEqual([]);

    execute(`grant execute on function ${APPLY} to authenticated`);
    await page.getByRole("button", { name: "Submit application" }).click();
    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}$/);
    expect(applicationRows(candidate.id)[0]).toMatchObject({ cover_note: "My typed note" });
  });

  test("FR-D1, FR-D3 AC3: a failed read of the list shows a toast, a message and a retry that works once the database answers", async ({ page }) => {
    const company = await newCompany();
    const candidate = await newApplicant();
    seedApplication(candidate.id, seedJob(company, { title: "Retry welder", status: "open" }), company.id);
    await logIn(page, candidate);
    await expect(page).toHaveURL(/\/dashboard\/worker$/);
    execute(`revoke execute on function ${LIST} from authenticated`);

    await page.goto(APPLICATIONS_URL);
    await expect(page.getByRole("heading", { name: "Your applications could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.", { exact: true })).toBeVisible();
    await expect(page.getByText("You have not applied to any vacancy yet")).toHaveCount(0);
    await expect(page.getByText(/permission denied|my_applications/)).toHaveCount(0);

    execute(`grant execute on function ${LIST} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Retry welder" })).toBeVisible();
  });
});
