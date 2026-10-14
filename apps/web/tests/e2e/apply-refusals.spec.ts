import type { Page } from "@playwright/test";
import { applicationRows, applyUrl, displayName, expectAccessibleAtBothWidths, newApplicant } from "./support/applications";
import { execute, literal } from "./support/db";
import { seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { expect, test } from "./support/test";
import type { TestUser } from "./support/test-user";

const GENERIC = "We could not complete this request. Try again.";

// The candidate opens the form of an open vacancy; the test then changes the database as a second tab or another person would,
// and the candidate submits.
async function openForm(page: Page, candidate: TestUser, title: string): Promise<{ jobId: string; employer: string }> {
  const company = await newCompany();
  const jobId = seedJob(company, { title, status: "open" });
  await logIn(page, candidate, applyUrl(jobId));
  await waitForHydration(page.getByLabel("Cover note (optional)"));
  return { jobId, employer: displayName(company.id) };
}

async function submit(page: Page, employer: string) {
  await page.getByLabel(`I agree to share the selected documents with ${employer} for this application`).check();
  await page.getByRole("button", { name: "Submit application" }).click();
  return page.getByRole("alert").filter({ hasText: "There is a problem" });
}

test.describe("D89: every refusal of an application says why and what to do", () => {
  test("FR-D1 AC12: an occupation removed after the form was opened is named, with a link to its passport section", async ({ page }) => {
    const candidate = await newApplicant();
    const { employer } = await openForm(page, candidate, "Refusal welder one");
    execute(`update public.worker_profiles set occupation_id = null where user_id = ${literal(candidate.id)}`);

    const alert = await submit(page, employer);
    await expect(alert).toContainText("Add your occupation to your passport before you apply.");
    await expect(alert.getByRole("link", { name: "Add your occupation" })).toHaveAttribute("href", "/en/passport#occupation");
    await expect(alert).not.toContainText(GENERIC);
    await expect(alert).not.toContainText(/CHARA_|occupation_id/);
    expect(applicationRows(candidate.id)).toEqual([]);
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-D1 AC3: a document deleted after the form was opened asks for a reload and creates nothing", async ({ page }) => {
    const candidate = await newApplicant();
    const document = await seedDocument(candidate.id, { title: "Old CV.pdf" });
    const { employer } = await openForm(page, candidate, "Refusal welder two");
    await page.getByLabel("Old CV.pdf").check();
    execute(`update public.worker_documents set deleted_at = now() where id = ${literal(document.id)}`);

    const alert = await submit(page, employer);
    await expect(alert).toContainText("One of the selected documents is no longer available. Reload the page and choose again.");
    await expect(alert).not.toContainText(GENERIC);
    expect(applicationRows(candidate.id)).toEqual([]);
  });

  test("FR-D7 AC8: the abuse limit says how many minutes to wait", async ({ page }) => {
    const candidate = await newApplicant();
    const { employer } = await openForm(page, candidate, "Refusal welder three");
    execute(
      `insert into audit.log (actor_id, action, entity_type, entity_id, metadata, created_at)
       select ${literal(candidate.id)}, 'application.duplicate_attempt', 'job_application', gen_random_uuid()::text, '{}',
              now() - interval '30 minutes'
       from generate_series(1, 60)`,
    );

    const alert = await submit(page, employer);
    await expect(alert).toContainText("You have sent many applications in a short time. Try again in 30 minutes.");
    await expect(alert).not.toContainText(GENERIC);
    expect(applicationRows(candidate.id)).toEqual([]);
  });

  test("FR-D1 AC6: an account whose closure was requested after the form was opened is told so, with the way to settings", async ({ page }) => {
    const candidate = await newApplicant();
    const { employer } = await openForm(page, candidate, "Refusal welder four");
    execute(`update public.profiles set deleted_at = now() where id = ${literal(candidate.id)}`);

    const alert = await submit(page, employer);
    await expect(alert).toContainText("Your account is being closed, so you cannot apply. Cancel the closure in your settings to apply again.");
    await expect(alert.getByRole("link", { name: "Go to settings" })).toHaveAttribute("href", "/en/settings");
    expect(applicationRows(candidate.id)).toEqual([]);
    execute(`update public.profiles set deleted_at = null where id = ${literal(candidate.id)}`);
  });

  test("FR-D7 AC6: an application sent from a second tab meanwhile leads to the application with the notice", async ({ page }) => {
    const candidate = await newApplicant();
    const { jobId, employer } = await openForm(page, candidate, "Refusal welder five");
    execute(
      `set role authenticated;
       select set_config('request.jwt.claims', '{"sub": "${candidate.id}", "role": "authenticated", "aal": "aal1"}', false);
       select public.apply_to_job(${literal(jobId)}, null, null)`,
    );

    await submit(page, employer);
    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}\?existing=1$/);
    await expect(page.getByRole("status").filter({ hasText: "You already applied to this vacancy. Here is your application." })).toBeVisible();
    expect(applicationRows(candidate.id)).toHaveLength(1);
  });
});
