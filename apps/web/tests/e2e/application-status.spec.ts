import { execute, literal, query } from "./support/db";
import { applicationUrl, eventRows, expectAccessibleAtBothWidths, newApplicant, shareOf } from "./support/applications";
import {
  ALREADY_MOVED,
  applicantUrl,
  changeStageButton,
  chooseStage,
  seedNamedApplication,
  stageDialog,
  stageValue,
  statusMessages,
} from "./support/applicants";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

test.describe("moving an application to another stage", () => {
  test("FR-D2 AC12: a member opens the menu with the keyboard, declines with a note after a confirmation and the candidate sees the note", async ({
    page,
    browser,
  }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Stage welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, jobId, company, "viewed");

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(page.getByRole("heading", { name: "Ana Silva", level: 1 })).toBeVisible();
    await expect(stageValue(page)).toHaveText("Viewed");
    await waitForHydration(changeStageButton(page));

    await changeStageButton(page).focus();
    await page.keyboard.press("Enter");
    const dialog = stageDialog(page);
    await expect(dialog.getByLabel("New stage").locator("option")).toHaveText(["Choose a stage", "Shortlisted", "Interview", "Not selected"]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(changeStageButton(page)).toBeFocused();
    expect(eventRows(applicationId)).toHaveLength(1);

    await chooseStage(page, "Not selected", "  Position filled  ");
    await expect(dialog.getByText("Ana Silva", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Not selected", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Reason (visible to the candidate)", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Position filled", { exact: true })).toBeVisible();
    await expect(dialog.getByText("A decision of Not selected is final. The candidate is told by email.")).toBeVisible();
    expect(eventRows(applicationId)).toHaveLength(1);
    await page.mouse.click(4, 4);
    await expect(dialog.getByRole("button", { name: "Confirm" })).toBeVisible();

    await page.route(`**${applicantUrl(company.slug, applicationId)}`, async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await expect(page.getByText("Stage changed to Not selected", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(stageValue(page)).toHaveText("Not selected");
    await expect(changeStageButton(page)).toHaveCount(0);
    await expect(page.getByText("Not selected is a final stage. No further stage can be chosen.")).toBeVisible();
    const entry = page.getByRole("listitem").filter({ hasText: "Viewed to Not selected" });
    await expect(entry).toContainText("Visible to the candidate");
    await expect(entry).toContainText("Position filled");

    expect(query<{ status: string }>(`select status::text from public.job_applications where id = ${literal(applicationId)}`)).toEqual([
      { status: "rejected" },
    ]);
    const [, moved] = eventRows(applicationId);
    expect(moved).toMatchObject({ from_status: "viewed", to_status: "rejected", actor_id: member.id, note: "Position filled" });
    expect(statusMessages(applicationId)).toEqual([{ user_id: candidate.id, status: "rejected", note: null }]);
    const [share] = shareOf(applicationId);
    expect(share.revoked_at).toBeNull();
    expect(Date.parse(share.expires_at ?? "") - Date.now()).toBeGreaterThan(29 * 86_400_000);

    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.8.7.6" } });
    await signInBrowser(context, candidate);
    const candidatePage = await context.newPage();
    await candidatePage.goto(applicationUrl(applicationId));
    await expect(candidatePage.getByText("Not selected").first()).toBeVisible();
    const message = candidatePage.getByRole("listitem").filter({ hasText: "Message from the employer" });
    await expect(message).toContainText("Position filled");
    await context.close();
  });

  test("FR-D2 AC10: two members who decline at the same moment make one move and the other is told the applicant was already moved", async ({
    browser,
  }) => {
    const company = await newCompany();
    const [first, second] = [await addCompanyUser(company, "member"), await addCompanyUser(company, "member")];
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Race stage welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, jobId, company, "shortlisted");
    const pages = [];
    for (const [index, user] of [first, second].entries()) {
      const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.7.6.${index + 1}` } });
      await signInBrowser(context, user);
      const page = await context.newPage();
      await page.goto(applicantUrl(company.slug, applicationId));
      await waitForHydration(changeStageButton(page));
      await chooseStage(page, "Not selected", `Note of member ${index + 1}`);
      await expect(stageDialog(page).getByRole("button", { name: "Confirm" })).toBeVisible();
      pages.push(page);
    }

    await Promise.all(pages.map((page) => stageDialog(page).getByRole("button", { name: "Confirm" }).click()));
    for (const page of pages) await expect(stageValue(page)).toHaveText("Not selected");
    const refused = [];
    for (const page of pages) refused.push(await page.getByText(ALREADY_MOVED, { exact: true }).count());
    expect(refused.reduce((sum, count) => sum + count, 0)).toBe(1);

    const events = eventRows(applicationId);
    expect(events).toHaveLength(2);
    const winner = events[1];
    expect(winner).toMatchObject({ from_status: "shortlisted", to_status: "rejected" });
    expect([`Note of member 1`, `Note of member 2`]).toContain(winner.note);
    expect([first.id, second.id]).toContain(winner.actor_id);
    expect(winner.note).toBe(winner.actor_id === first.id ? "Note of member 1" : "Note of member 2");
    expect(statusMessages(applicationId)).toHaveLength(1);
    expect(
      query<{ status: string }>(`select status::text from public.job_applications where id = ${literal(applicationId)}`)[0].status,
    ).toBe("rejected");
    for (const page of pages) await page.context().close();
  });

  test("FR-D2: a move is refused with a toast when the application was already moved elsewhere, and nothing is changed twice", async ({
    page,
  }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Stale stage welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, jobId, company, "interview");

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await waitForHydration(changeStageButton(page));
    await chooseStage(page, "Offer", "");
    execute(
      `select set_config('chara.actor_fn', 'set_application_status', true);
       update public.job_applications set status = 'rejected' where id = ${literal(applicationId)}`,
    );
    await stageDialog(page).getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText(ALREADY_MOVED, { exact: true })).toBeVisible();
    await expect(stageDialog(page)).toBeHidden();
    await expect(stageValue(page)).toHaveText("Not selected");
    expect(eventRows(applicationId)).toHaveLength(1);
    expect(statusMessages(applicationId)).toEqual([]);
  });

  test("FR-D2 NFR-U1: the page, the form and the confirmation have no serious accessibility violation at 1280 and 360 px", async ({
    page,
  }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Accessible stage welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, jobId, company, "applied");

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(page.getByRole("heading", { name: "Ana Silva", level: 1 })).toBeVisible();
    await waitForHydration(changeStageButton(page));
    await expectAccessibleAtBothWidths(page);

    await changeStageButton(page).click();
    await expect(stageDialog(page)).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await stageDialog(page).getByRole("button", { name: "Review" }).click();
    await expect(stageDialog(page).getByText("Choose a stage").first()).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.keyboard.press("Escape");
    await expect(stageDialog(page)).toBeHidden();
    await chooseStage(page, "Interview", "Interviews in week 41");
    await expect(stageDialog(page).getByRole("button", { name: "Confirm" })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
  });
});
