import { applicantsUrl, boardColumn, columnCounts, eventCount, listRows, statusOf } from "./support/applicant-list";
import { applicationUrl, eventRows, expectAccessibleAtBothWidths } from "./support/applications";
import {
  bulkDialog,
  bulkToolbar,
  chooseBulk,
  expectModal,
  messagesOf,
  openApplicants,
  reviewButton,
  selectBox,
  setupBulk,
} from "./support/bulk";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

const POSITION_FILLED = "Position filled";
const NOT_MATCHING = "Qualifications do not match the requirements of this role";

const SIX: [string, string][] = [
  ["Ana Silva", "applied"],
  ["Ben Okoro", "applied"],
  ["Chi Wei", "applied"],
  ["Dev Rao", "interview"],
  ["Eli Cohen", "hired"],
  ["Fay Lund", "withdrawn"],
];

test.describe("bulk actions on applicants", () => {
  test.describe.configure({ timeout: 90_000 });

  test("FR-E3 AC1 and AC2: the confirmation lists every selected applicant, applies nothing, and cancelling keeps the selection", async ({ browser }) => {
    const { company, member, jobId, people } = await setupBulk(SIX);
    const page = await openApplicants(browser, member, applicantsUrl(company.slug, `?job=${jobId}`), (p) => reviewButton(p));

    await expect(bulkToolbar(page).getByText("0 selected", { exact: true })).toBeVisible();
    await expect(reviewButton(page)).toBeDisabled();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const name of ["Ana Silva", "Ben Okoro", "Chi Wei"]) await selectBox(page, name).check();
    await expect(bulkToolbar(page).getByText("3 selected", { exact: true })).toBeVisible();
    await expect(reviewButton(page)).toBeEnabled();

    await chooseBulk(page, "Decline (Not selected)", POSITION_FILLED);
    await reviewButton(page).click();
    const dialog = bulkDialog(page);
    await expect(dialog).toBeVisible();
    const rows = dialog.getByRole("listitem");
    await expect(rows).toHaveText(["Chi WeiApplied", "Ben OkoroApplied", "Ana SilvaApplied"]);
    await expect(dialog.getByText("Not selected", { exact: true })).toBeVisible();
    await expect(dialog.locator("div:has(> dt:text-is('Visible to the candidate')) > dd")).toHaveText(POSITION_FILLED);
    await expect(dialog.getByText("A decision of Not selected is final. Each candidate is told by email, and this cannot be undone.")).toBeVisible();
    for (const name of ["Ana", "Ben", "Chi"]) {
      expect(statusOf(people[name].id)).toBe("applied");
      expect(eventCount(people[name].id)).toBe(1);
      expect(messagesOf(people[name].id)).toEqual([]);
    }
    await expectModal(dialog);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(reviewButton(page)).toBeFocused();
    await reviewButton(page).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(reviewButton(page)).toBeFocused();
    await reviewButton(page).click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(dialog).toBeHidden();
    await expect(reviewButton(page)).toBeFocused();

    await expect(bulkToolbar(page).getByText("3 selected", { exact: true })).toBeVisible();
    await expect(selectBox(page, "Ana Silva")).toBeChecked();
    for (const name of ["Ana", "Ben", "Chi"]) {
      expect(statusOf(people[name].id)).toBe("applied");
      expect(eventCount(people[name].id)).toBe(1);
      expect(messagesOf(people[name].id)).toEqual([]);
    }
  });

  test("FR-E3 AC3: a stage move with a note applies once for a double click, and the summary and the board counts follow", async ({ browser }) => {
    const { company, member, jobId, people } = await setupBulk(SIX.slice(0, 3));
    const page = await openApplicants(browser, member, applicantsUrl(company.slug, `?job=${jobId}`), (p) => reviewButton(p));
    let posts = 0;
    await page.route("**/applicants?*", async (route) => {
      if (route.request().method() === "POST") {
        posts += 1;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      await route.continue();
    });

    for (const name of ["Ana Silva", "Ben Okoro", "Chi Wei"]) await selectBox(page, name).check();
    await chooseBulk(page, "Move to Interview", undefined, "Interviews in week 41");
    await reviewButton(page).click();
    const dialog = bulkDialog(page);
    await expect(dialog.getByText("A decision of Not selected is final")).toHaveCount(0);
    await expect(dialog.getByText("Each candidate is told by email.", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm" }).dblclick();
    await expect(dialog).toBeHidden();

    await expect(bulkToolbar(page).getByText("3 updated, 0 refused", { exact: true })).toBeVisible();
    await expect(bulkToolbar(page).getByText("0 selected", { exact: true })).toBeVisible();
    await expect(listRows(page).filter({ hasText: "Interview" })).toHaveCount(3);
    expect(posts).toBe(1);
    for (const name of ["Ana", "Ben", "Chi"]) {
      const { id, user } = people[name];
      expect(statusOf(id)).toBe("interview");
      expect(eventRows(id).slice(1)).toMatchObject([{ from_status: "applied", to_status: "interview", actor_id: member.id, note: "Interviews in week 41" }]);
      expect(messagesOf(id)).toEqual([{ user_id: user.id, status: "interview", note: null }]);
    }

    await page.unroute("**/applicants?*");
    await page.goto(applicantsUrl(company.slug, `?job=${jobId}&view=board`));
    expect(await columnCounts(page)).toMatchObject({ Applied: "0", Interview: "3" });
  });

  test("FR-E3 AC4: a decline with a template is final, has no undo, and the candidate reads the reason without it being emailed", async ({ browser }) => {
    const { company, member, jobId, people } = await setupBulk([["Dev Rao", "interview"], ["Eli Cohen", "interview"]]);
    const page = await openApplicants(browser, member, applicantsUrl(company.slug, `?job=${jobId}`), (p) => reviewButton(p));

    for (const name of ["Dev Rao", "Eli Cohen"]) await selectBox(page, name).check();
    await chooseBulk(page, "Decline (Not selected)", NOT_MATCHING);
    await reviewButton(page).click();
    await bulkDialog(page).getByRole("button", { name: "Confirm" }).click();
    await expect(bulkToolbar(page).getByText("2 updated, 0 refused", { exact: true })).toBeVisible();
    await expect(listRows(page).filter({ hasText: "Not selected" })).toHaveCount(2);
    await expect(page.getByRole("button", { name: /undo/i })).toHaveCount(0);

    for (const name of ["Dev", "Eli"]) {
      const { id, user } = people[name];
      expect(statusOf(id)).toBe("rejected");
      expect(eventRows(id)[1]).toMatchObject({ to_status: "rejected", actor_id: member.id, note: NOT_MATCHING });
      expect(messagesOf(id)).toEqual([{ user_id: user.id, status: "rejected", note: null }]);
    }

    for (const name of ["Dev Rao", "Eli Cohen"]) await selectBox(page, name).check();
    await chooseBulk(page, "Move to Offer");
    await reviewButton(page).click();
    await bulkDialog(page).getByRole("button", { name: "Confirm" }).click();
    await expect(bulkToolbar(page).getByText("0 updated, 2 refused", { exact: true })).toBeVisible();
    await expect(bulkToolbar(page).getByText("Dev Rao: Not allowed from Not selected")).toBeVisible();
    expect(statusOf(people.Dev.id)).toBe("rejected");
    expect(messagesOf(people.Dev.id)).toHaveLength(1);

    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.8.7.5" } });
    await signInBrowser(context, people.Dev.user);
    const candidate = await context.newPage();
    await candidate.goto(applicationUrl(people.Dev.id));
    await expect(candidate.getByRole("listitem").filter({ hasText: "Message from the employer" })).toContainText(NOT_MATCHING);
    await context.close();
  });

  test("FR-E3 AC5: the summary reports a refused item, which stays selected, and the moved one is deselected", async ({ browser }) => {
    const { company, member, jobId, people } = await setupBulk([["Ana Silva", "applied"], ["Ben Okoro", "interview"]]);
    const page = await openApplicants(browser, member, applicantsUrl(company.slug, `?job=${jobId}`), (p) => reviewButton(p));

    for (const name of ["Ana Silva", "Ben Okoro"]) await selectBox(page, name).check();
    await chooseBulk(page, "Move to Offer");
    await reviewButton(page).click();
    await bulkDialog(page).getByRole("button", { name: "Confirm" }).click();

    const toolbar = bulkToolbar(page);
    await expect(toolbar.getByText("1 updated, 1 refused", { exact: true })).toBeVisible();
    await expect(toolbar.getByText("Ana Silva: Not allowed from Applied")).toBeVisible();
    await expect(listRows(page).filter({ hasText: "Ben Okoro" })).toContainText("Offer");
    await expect(listRows(page).filter({ hasText: "Ana Silva" })).toContainText("Applied");
    await expect(selectBox(page, "Ana Silva")).toBeChecked();
    await expect(selectBox(page, "Ben Okoro")).not.toBeChecked();
    await expect(toolbar.getByText("1 selected", { exact: true })).toBeVisible();
    expect(statusOf(people.Ana.id)).toBe("applied");
    expect(statusOf(people.Ben.id)).toBe("offer");
    expect(eventCount(people.Ana.id) + eventCount(people.Ben.id)).toBe(3);
    expect(messagesOf(people.Ana.id)).toHaveLength(0);
    expect(messagesOf(people.Ben.id)).toHaveLength(1);
    await expect(page.getByText("Something went wrong")).toHaveCount(0);

    await toolbar.getByRole("button", { name: "Dismiss" }).click();
    await expect(toolbar.getByText("1 updated, 1 refused")).toHaveCount(0);
  });

  test("FR-E3 AC1 and AC12: the selection works from the board cards, and the form refuses a decline without a reason", async ({ browser }) => {
    const { company, member, jobId, people } = await setupBulk(SIX.slice(0, 3));
    const page = await openApplicants(browser, member, applicantsUrl(company.slug, `?job=${jobId}&view=board`), (p) => reviewButton(p));

    await selectBox(page, "Ana Silva").check();
    await selectBox(page, "Chi Wei").check();
    await expect(bulkToolbar(page).getByText("2 selected", { exact: true })).toBeVisible();

    await chooseBulk(page, "Decline (Not selected)");
    await reviewButton(page).click();
    await expect(page.getByRole("link", { name: "Choose a reason" })).toBeVisible();
    await expect(bulkDialog(page)).toBeHidden();
    await bulkToolbar(page).getByLabel("Reason (visible to the candidate)", { exact: true }).selectOption({ label: "Other" });
    await reviewButton(page).click();
    await expect(page.getByRole("link", { name: "Enter a reason" })).toBeVisible();
    await bulkToolbar(page).getByLabel("Other reason (visible to the candidate)").fill("Moved abroad");
    await reviewButton(page).click();
    await expect(bulkDialog(page).getByRole("listitem")).toHaveText(["Chi WeiApplied", "Ana SilvaApplied"]);
    await bulkDialog(page).getByRole("button", { name: "Confirm" }).click();

    await expect(bulkToolbar(page).getByText("2 updated, 0 refused", { exact: true })).toBeVisible();
    await expect(boardColumn(page, "Not selected").getByRole("link", { name: "Ana Silva" })).toBeVisible();
    await expect(boardColumn(page, "Applied").getByRole("listitem")).toHaveCount(1);
    expect(eventRows(people.Ana.id)[1]).toMatchObject({ to_status: "rejected", note: "Moved abroad" });
    expect(statusOf(people.Ben.id)).toBe("applied");
  });
});
