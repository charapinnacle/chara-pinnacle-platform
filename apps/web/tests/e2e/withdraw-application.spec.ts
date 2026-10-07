import type { Page } from "@playwright/test";
import { userToken } from "./support/accounts";
import {
  APPLICATIONS_URL,
  applicationUrl,
  displayName,
  eventRows,
  expectAccessibleAtBothWidths,
  newApplicant,
  queuedForApplication,
  seedApplication,
  shareOf,
} from "./support/applications";
import { applicantUrl, seedNamedApplication, stageValue } from "./support/applicants";
import { execute, literal, query } from "./support/db";
import { seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { accessLog, requestDocumentUrl } from "./support/privacy";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

const TITLE = "Withdraw this application?";
const todayShort = () =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date());

const withdrawButton = (page: Page) => page.getByRole("button", { name: "Withdraw application" });
const dialogOf = (page: Page) => page.getByRole("dialog", { name: TITLE });

async function candidateWithApplication(status: string) {
  const company = await newCompany();
  const candidate = await newApplicant();
  const jobId = seedJob(company, { title: "Withdrawing welder", status: "open" });
  const applicationId = seedNamedApplication(candidate, jobId, company, status);
  return { company, candidate, applicationId, employer: displayName(company.id) };
}

test.describe("withdrawing an application", () => {
  test("FR-D4 AC1: the candidate confirms in the dialog, the page shows Withdrawn, a new event and a toast, and the application stays in the list", async ({
    page,
  }) => {
    const { candidate, applicationId, employer } = await candidateWithApplication("shortlisted");
    await logIn(page, candidate, applicationUrl(applicationId));
    await waitForHydration(withdrawButton(page));
    await expect(stageValue(page)).toHaveText("Shortlisted");

    await withdrawButton(page).click();
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("The employer loses access to your documents immediately.");
    await expect(dialog).toContainText(`Your application for Withdrawing welder at ${employer}.`);
    await expectAccessibleAtBothWidths(page);
    expect(eventRows(applicationId)).toHaveLength(1);

    await dialog.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("Application withdrawn", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(stageValue(page)).toHaveText("Withdrawn");
    await expect(withdrawButton(page)).toHaveCount(0);
    const events = page.getByRole("region", { name: "Timeline" }).getByRole("listitem");
    await expect(events).toHaveCount(2);
    await expect(events.nth(1)).toContainText(`Withdrawn ${todayShort()}`);
    await expect(events.nth(1)).toContainText("By you");
    await expect(page.getByRole("region", { name: "What usually happens next" })).toContainText("You withdrew this application.");
    await expectAccessibleAtBothWidths(page);

    const [moved] = eventRows(applicationId).slice(1);
    expect(eventRows(applicationId)).toHaveLength(2);
    expect(moved).toMatchObject({ from_status: "shortlisted", to_status: "withdrawn", actor_id: candidate.id, note: null });
    const [share] = shareOf(applicationId);
    expect(Date.parse(share.revoked_at ?? "")).not.toBeNaN();
    expect(
      query<{ action: string }>(
        `select w.action::text from public.consents g join public.consents w on w.user_id = g.user_id and w.purpose = g.purpose
         where g.id = ${share.consent_id} order by w.id`,
      ).map((consent) => consent.action),
    ).toEqual(["granted", "withdrawn"]);
    expect(queuedForApplication(applicationId)).toEqual([{ kind: "status_changed", user_id: candidate.id }]);

    await page.goto(APPLICATIONS_URL);
    const row = page.locator("main ul > li").filter({ hasText: "Withdrawing welder" });
    await expect(row).toContainText("Withdrawn");
  });

  test("FR-D4 AC12: Cancel has the focus, Escape returns it, the pending button reads Withdrawing, and a double click makes one event", async ({
    page,
  }) => {
    const { candidate, applicationId, employer } = await candidateWithApplication("interview");
    await logIn(page, candidate, applicationUrl(applicationId));
    await waitForHydration(withdrawButton(page));

    await withdrawButton(page).focus();
    await page.keyboard.press("Enter");
    const dialog = dialogOf(page);
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(dialog).toContainText(employer);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(withdrawButton(page)).toBeFocused();
    await withdrawButton(page).click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(stageValue(page)).toHaveText("Interview");
    expect(eventRows(applicationId)).toHaveLength(1);

    await page.route(`**${applicationUrl(applicationId)}`, async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    await withdrawButton(page).click();
    await dialog.getByRole("button", { name: "Withdraw", exact: true }).dblclick();
    await expect(dialog.getByRole("button", { name: "Withdrawing" })).toBeDisabled();
    await expect(page.getByText("Application withdrawn", { exact: true })).toBeVisible();
    await expect(stageValue(page)).toHaveText("Withdrawn");
    await expect(page.getByText("The application was not withdrawn")).toHaveCount(0);
    expect(eventRows(applicationId).map((event) => event.to_status)).toEqual(["applied", "withdrawn"]);
    expect(queuedForApplication(applicationId)).toHaveLength(1);
  });

  test("FR-D4: a page that was open when the application was withdrawn elsewhere ends on Withdrawn without an error", async ({
    page,
    browser,
  }) => {
    const { candidate, applicationId } = await candidateWithApplication("offer");
    await logIn(page, candidate, applicationUrl(applicationId));
    await waitForHydration(withdrawButton(page));

    const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.8.7" } });
    await signInBrowser(other, candidate);
    const tab = await other.newPage();
    await tab.goto(applicationUrl(applicationId));
    await waitForHydration(withdrawButton(tab));
    await withdrawButton(tab).click();
    await dialogOf(tab).getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(stageValue(tab)).toHaveText("Withdrawn");
    await other.close();

    await withdrawButton(page).click();
    await dialogOf(page).getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(stageValue(page)).toHaveText("Withdrawn");
    await expect(page.getByText("The application was not withdrawn")).toHaveCount(0);
    expect(eventRows(applicationId).map((event) => event.to_status)).toEqual(["applied", "withdrawn"]);
  });

  test("FR-D4: an employer decision that came first is explained in a toast and the stage on the page is the new one", async ({ page }) => {
    const { candidate, applicationId } = await candidateWithApplication("shortlisted");
    await logIn(page, candidate, applicationUrl(applicationId));
    await waitForHydration(withdrawButton(page));
    execute(
      `select set_config('chara.actor_fn', 'set_application_status', true);
       update public.job_applications set status = 'rejected' where id = ${literal(applicationId)}`,
    );

    await withdrawButton(page).click();
    await dialogOf(page).getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("The application was not withdrawn", { exact: true })).toBeVisible();
    await expect(page.getByText("This application can no longer be withdrawn. Reload to see its stage.").first()).toBeVisible();
    await expect(dialogOf(page)).toBeHidden();
    expect(shareOf(applicationId)[0].revoked_at).toBeNull();
  });

  test("FR-D4 AC4: after the candidate withdraws, the employer member gets no link to the document and the applicant shows Withdrawn", async ({
    page,
    browser,
  }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const cv = await seedDocument(candidate.id, { title: "Ana Silva CV" });
    const jobId = seedJob(company, { title: "Document welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, jobId, company, "shortlisted", [cv.id]);
    const token = await userToken(member);

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(stageValue(page)).toHaveText("Shortlisted");
    const before = await requestDocumentUrl(token, cv.id);
    expect(before.status).toBe(200);
    expect(accessLog(cv.id)).toHaveLength(1);

    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.8.6" } });
    await signInBrowser(context, candidate);
    const candidatePage = await context.newPage();
    await candidatePage.goto(applicationUrl(applicationId));
    await waitForHydration(withdrawButton(candidatePage));
    await withdrawButton(candidatePage).click();
    await dialogOf(candidatePage).getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(stageValue(candidatePage)).toHaveText("Withdrawn");
    await context.close();

    const after = await requestDocumentUrl(token, cv.id);
    expect(after).toEqual({ status: 403, body: { error: "forbidden" } });
    expect(accessLog(cv.id)).toHaveLength(1);
    await page.reload();
    await expect(stageValue(page)).toHaveText("Withdrawn");
    await expect(page.getByRole("button", { name: "Change stage" })).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Shortlisted to Withdrawn" })).toContainText("Candidate");
  });

  test("FR-D4 AC11: withdrawing one of two applications to one organisation leaves the other share open", async ({ page }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const cv = await seedDocument(candidate.id, { title: "Shared CV" });
    const first = seedApplication(candidate.id, seedJob(company, { title: "First welder", status: "open" }), company.id, { documentIds: [cv.id] });
    const second = seedApplication(candidate.id, seedJob(company, { title: "Second welder", status: "open" }), company.id, { documentIds: [cv.id] });

    await logIn(page, candidate, applicationUrl(first));
    await waitForHydration(withdrawButton(page));
    await withdrawButton(page).click();
    await dialogOf(page).getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(stageValue(page)).toHaveText("Withdrawn");

    const link = await requestDocumentUrl(await userToken(member), cv.id);
    expect(link.status).toBe(200);
    expect(shareOf(second)[0].revoked_at).toBeNull();
  });
});
