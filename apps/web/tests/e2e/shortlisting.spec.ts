import type { Page } from "@playwright/test";
import { eventRows, expectAccessibleAtBothWidths, newApplicant, shareOf } from "./support/applications";
import { ALREADY_MOVED, applicantUrl, changeStageButton, chooseStage, seedNamedApplication, stageDialog, stageValue, statusMessages } from "./support/applicants";
import { applicantsUrl, boardColumn, columnCounts, dragCard, eventCount, listRows, seedListApplicant, statusOf, subscribe } from "./support/applicant-list";
import { execute } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { enrollTotp } from "./support/login";
import { logIn } from "./support/login-page";
import { enterCode } from "./support/mfa";
import { enforceLimits, restoreLimits } from "./support/team";
import { expect, test } from "./support/test";

// The limits are switched on for the whole database while this file runs, so it has a project of its own that follows
// the others (playwright.config.ts) and runs in one worker.
test.describe.configure({ mode: "serial" });

const NO_SHORTLISTING = "employer_e2e_noshort";
const PROMPT = "Upgrade to shortlist applicants";
const CONTACT = "Contact an owner or admin of your organization to upgrade the plan.";

test.beforeAll(() => {
  enforceLimits();
  execute(
    `insert into billing.plans (code, org_type, name, price_minor, currency, interval, trial_days, is_public, sort)
     values ('${NO_SHORTLISTING}', 'employer', 'No shortlisting', 100, 'EUR', 'month', 0, false, 99)`,
  );
});

test.afterAll(() => {
  execute(`delete from billing.subscriptions where plan_code = '${NO_SHORTLISTING}'; delete from billing.plans where code = '${NO_SHORTLISTING}'`);
  restoreLimits();
});

test.describe("shortlisting an applicant", () => {
  test("FR-E4: a member of a plan with the feature shortlists from the applicant page, leaves the shortlist only forward, and finds the applicant under the Shortlisted filter and column", async ({
    page,
  }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Shortlist welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, jobId, company, "viewed");
    const ben = seedListApplicant(company, jobId, { name: "Ben Okoro", status: "shortlisted", appliedAt: "2026-09-03T10:00:00Z", completeness: 55 });
    seedListApplicant(company, jobId, { name: "Cara Lima", appliedAt: "2026-09-04T10:00:00Z", completeness: 40 });

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(stageValue(page)).toHaveText("Viewed");
    await waitForHydration(changeStageButton(page));
    await expect(page.getByText(PROMPT)).toHaveCount(0);
    await chooseStage(page, "Shortlisted", "Strong profile");
    await expect(stageDialog(page).getByText("The candidate is told by email.")).toBeVisible();
    await stageDialog(page).getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText("Stage changed to Shortlisted", { exact: true })).toBeVisible();
    await expect(stageValue(page)).toHaveText("Shortlisted");
    expect(statusOf(applicationId)).toBe("shortlisted");
    const events = eventRows(applicationId);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ from_status: "viewed", to_status: "shortlisted", actor_id: member.id, note: "Strong profile" });
    expect(statusMessages(applicationId)).toEqual([{ user_id: candidate.id, status: "shortlisted", note: null }]);
    expect(shareOf(applicationId).map(({ revoked_at, expires_at }) => ({ revoked_at, expires_at }))).toEqual([{ revoked_at: null, expires_at: null }]);

    await changeStageButton(page).click();
    await expect(stageDialog(page).getByLabel("New stage").locator("option")).toHaveText(["Choose a stage", "Interview", "Offer", "Not selected"]);
    await page.keyboard.press("Escape");

    await page.goto(applicantsUrl(company.slug, `?job=${jobId}`));
    await page.getByLabel("Filter by stage").selectOption({ label: "Shortlisted" });
    await expect(page).toHaveURL(/stage=shortlisted/);
    await expect(listRows(page)).toHaveCount(2);
    await expect(listRows(page).filter({ hasText: "Ana Silva" })).toContainText("Shortlisted");
    await expect(listRows(page).filter({ hasText: "Ben Okoro" })).toContainText("Shortlisted");
    await expect(page.getByText(PROMPT)).toHaveCount(0);

    await page.goto(applicantsUrl(company.slug, `?job=${jobId}&view=board`));
    const column = boardColumn(page, "Shortlisted");
    await expect(column.getByRole("heading", { level: 2 })).toHaveText("Shortlisted2");
    await expect(column.getByRole("link", { name: "Ana Silva" })).toBeVisible();
    await expect(column.getByRole("link", { name: "Ben Okoro" })).toBeVisible();
    expect(statusOf(ben)).toBe("shortlisted");
  });

  test("FR-E4 AC10: Shortlisted is a filter and a board column, an Applied card is shortlisted from the board menu, and Shortlist is offered on Applied and Viewed cards only", async ({
    page,
  }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const member = await addCompanyUser(company, "member");
    const jobId = seedJob(company, { title: "Board welder", status: "open" });
    const at = (day: number) => `2026-09-0${day}T10:00:00Z`;
    seedListApplicant(company, jobId, { name: "Ben Okoro", status: "shortlisted", appliedAt: at(1), completeness: 55 });
    const cara = seedListApplicant(company, jobId, { name: "Cara Lima", appliedAt: at(2), completeness: 40 });
    seedListApplicant(company, jobId, { name: "Dev Rao", appliedAt: at(3), completeness: 70 });
    seedListApplicant(company, jobId, { name: "Eli Park", status: "viewed", appliedAt: at(4), completeness: 65 });
    seedListApplicant(company, jobId, { name: "Fay Ng", status: "interview", appliedAt: at(5), completeness: 80 });

    await logIn(page, member, applicantsUrl(company.slug, `?job=${jobId}`));
    await page.getByLabel("Filter by stage").selectOption({ label: "Shortlisted" });
    await expect(page).toHaveURL(/stage=shortlisted/);
    await expect(listRows(page)).toHaveCount(1);
    await expect(listRows(page).filter({ hasText: "Ben Okoro" })).toContainText("Shortlisted");

    await page.goto(applicantsUrl(company.slug, `?job=${jobId}&view=board`));
    await waitForHydration(page.getByRole("region", { name: "Pipeline board" }));
    await expect(boardColumn(page, "Shortlisted").getByRole("heading", { level: 2 })).toHaveText("Shortlisted1");

    const items = async (name: string) => {
      await page.getByRole("button", { name: `Move ${name}`, exact: true }).click();
      const texts = await page.getByRole("menuitem").allTextContents();
      await page.keyboard.press("Escape");
      return texts;
    };
    expect(await items("Dev Rao")).toEqual(["Shortlisted", "Interview", "Not selected"]);
    expect(await items("Eli Park")).toEqual(["Shortlisted", "Interview", "Not selected"]);
    expect(await items("Fay Ng")).toEqual(["Offer", "Not selected"]);
    expect(await items("Ben Okoro")).toEqual(["Interview", "Offer", "Not selected"]);

    await page.getByRole("button", { name: "Move Cara Lima", exact: true }).click();
    await page.getByRole("menuitem", { name: "Shortlisted", exact: true }).click();
    await expect(boardColumn(page, "Shortlisted").getByRole("heading", { level: 2 })).toHaveText("Shortlisted2");
    await expect(boardColumn(page, "Shortlisted").getByRole("link", { name: "Cara Lima" })).toBeVisible();
    await expect(boardColumn(page, "Applied").getByRole("link", { name: "Cara Lima" })).toHaveCount(0);
    expect(await columnCounts(page)).toMatchObject({ Applied: "1", Viewed: "1", Shortlisted: "2", Interview: "1" });
    await expect.poll(() => statusOf(cara)).toBe("shortlisted");
    expect(eventCount(cara)).toBe(2);
    await page.reload();
    expect(await columnCounts(page)).toMatchObject({ Shortlisted: "2" });
  });

  test("FR-E4 AC11: a plan without the feature replaces Shortlist by Upgrade to shortlist applicants, links to the plan page for an owner only, takes no drop on the Shortlisted column and still moves an applicant on", async ({
    page,
    browser,
  }) => {
    const company = await newCompany();
    subscribe(company, NO_SHORTLISTING);
    const member = await addCompanyUser(company, "member");
    const ownerSecret = await enrollTotp(company.owner);
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Upgrade welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, jobId, company, "applied");
    const ben = seedListApplicant(company, jobId, { name: "Ben Okoro", appliedAt: "2026-09-03T10:00:00Z", completeness: 55 });
    const billing = `/en/org/${company.slug}/billing`;
    const board = applicantsUrl(company.slug, `?job=${jobId}&view=board`);
    const prompt = (on: Page) => on.getByRole("status").filter({ hasText: PROMPT });

    const owner = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.4.3.3" } });
    const ownerPage = await owner.newPage();
    await logIn(ownerPage, company.owner, board);
    await enterCode(ownerPage, ownerSecret);
    await waitForHydration(ownerPage.getByRole("region", { name: "Pipeline board" }));
    await expect(prompt(ownerPage)).toBeVisible();
    await expect(prompt(ownerPage).getByRole("link", { name: PROMPT })).toHaveAttribute("href", billing);
    await expect(prompt(ownerPage)).not.toContainText(CONTACT);
    await ownerPage.goto(applicantUrl(company.slug, applicationId));
    await waitForHydration(changeStageButton(ownerPage));
    await expect(prompt(ownerPage).getByRole("link", { name: PROMPT })).toHaveAttribute("href", billing);
    await owner.close();

    await logIn(page, member, applicantsUrl(company.slug, `?job=${jobId}`));
    await expect(prompt(page)).toBeVisible();
    await expect(prompt(page)).toContainText(CONTACT);
    await expect(prompt(page).getByRole("link")).toHaveCount(0);
    await expect(listRows(page)).toHaveCount(2);
    await expectAccessibleAtBothWidths(page);

    await page.goto(board);
    await waitForHydration(page.getByRole("region", { name: "Pipeline board" }));
    await expect(prompt(page)).toContainText(CONTACT);
    await expect(prompt(page).getByRole("link")).toHaveCount(0);
    await page.getByRole("button", { name: "Move Ben Okoro", exact: true }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Interview", "Not selected"]);
    await page.keyboard.press("Escape");

    const shortlistRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.postData()?.includes("shortlisted")) shortlistRequests.push(request.url());
    });
    const eventsBefore = eventCount(ben);
    await expect(boardColumn(page, "Shortlisted").getByRole("heading", { level: 2 })).toHaveText("Shortlisted0");
    await dragCard(page, "Ben Okoro", "Shortlisted");
    await expect(boardColumn(page, "Applied").getByRole("link", { name: "Ben Okoro" })).toBeVisible();
    await expect(boardColumn(page, "Shortlisted").getByRole("link", { name: "Ben Okoro" })).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(shortlistRequests).toEqual([]);
    expect(statusOf(ben)).toBe("applied");
    expect(eventCount(ben)).toBe(eventsBefore);

    await dragCard(page, "Ben Okoro", "Interview");
    await expect(boardColumn(page, "Interview").getByRole("link", { name: "Ben Okoro" })).toBeVisible();
    await expect.poll(() => statusOf(ben)).toBe("interview");

    await page.goto(applicantUrl(company.slug, applicationId));
    await waitForHydration(changeStageButton(page));
    await expect(prompt(page)).toContainText(CONTACT);
    await expect(prompt(page).getByRole("link")).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await changeStageButton(page).click();
    await expect(stageDialog(page).getByLabel("New stage").locator("option")).toHaveText(["Choose a stage", "Interview", "Not selected"]);
    await page.keyboard.press("Escape");

    await chooseStage(page, "Interview", "");
    await stageDialog(page).getByRole("button", { name: "Confirm" }).click();
    await expect(stageValue(page)).toHaveText("Interview");
    await expect(page.getByText(PROMPT)).toHaveCount(0);
    expect(statusOf(applicationId)).toBe("interview");
    expect(eventRows(applicationId).map(({ from_status, to_status }) => [from_status, to_status])).toEqual([
      [null, "applied"],
      ["applied", "viewed"],
      ["viewed", "interview"],
    ]);
  });

  test("FR-E4: if the plan loses the feature while the dialog is open, the database refuses the move and the page says the plan does not include shortlisting", async ({
    page,
  }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Changing plan welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, jobId, company, "applied");

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await waitForHydration(changeStageButton(page));
    await chooseStage(page, "Shortlisted", "");
    execute(`update billing.subscriptions set plan_code = '${NO_SHORTLISTING}' where organization_id = '${company.id}'`);
    await stageDialog(page).getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText("Your plan does not include shortlisting.", { exact: true })).toBeVisible();
    await expect(page.getByText(ALREADY_MOVED, { exact: true })).toHaveCount(0);
    expect(statusOf(applicationId)).toBe("viewed");
    expect(eventRows(applicationId).map(({ to_status }) => to_status)).toEqual(["applied", "viewed"]);
    expect(statusMessages(applicationId)).toEqual([]);
  });
});
