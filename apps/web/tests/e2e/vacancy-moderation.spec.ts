import type { Page } from "@playwright/test";
import { signInStaff, uniqueTag } from "./support/admin";
import { displayName, expectAccessibleAtBothWidths, newApplicant, seedApplication } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, jobUrl, jobsUrl, newCompany, seedJob } from "./support/jobs";
import { enrollTotp } from "./support/login";
import { logIn } from "./support/login-page";
import { enterCode, staffUser } from "./support/mfa";
import { signInAtAal1 } from "./support/team";
import { expect, test } from "./support/test";
import { bodyOf, publicUrl } from "./support/vacancy-page";

const REASON = "The vacancy asks for a fee before hiring.";
const BACK = "The employer removed the fee after our message.";
const APPEAL = "/en/legal/complaints-and-dispute-process";

function moderationRows(jobId: string) {
  return query<{ action: string; statement_of_reasons: string; actor_id: string }>(
    `select action, statement_of_reasons, actor_id from public.moderation_actions where target_id = ${literal(jobId)} order by id`,
  );
}

function auditRows(jobId: string) {
  return query<{ action: string; metadata: { reason: string; request_id: string } }>(
    `select action, metadata from audit.log where entity_id = ${literal(jobId)} and action like 'job.%hide' order by id`,
  );
}

function hiddenEmails(jobId: string): number {
  return query<{ n: number }>(
    `select count(*)::int as n from public.notifications where kind = 'vacancy_hidden' and payload ->> 'job_id' = ${literal(jobId)}`,
  )[0].n;
}

async function notFound(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
}

async function search(page: Page, term: string): Promise<void> {
  const field = page.getByLabel("Search vacancies");
  await field.fill(term);
  await field.press("Enter");
}

function rows(page: Page) {
  return page.getByRole("table", { name: "Vacancies" }).getByRole("row").filter({ has: page.getByRole("cell") });
}

async function pressEnterOn(page: Page, name: string): Promise<void> {
  const button = page.getByRole("button", { name, exact: true });
  await button.focus();
  await page.keyboard.press("Enter");
}

test.describe("moderating a vacancy from the console", () => {
  test("FR-C7 AC9: a Platform Administrator gets not found, a Trust & Safety Administrator at aal1 is sent to two-step verification and then reaches the page", async ({
    page,
  }) => {
    const company = await newCompany();
    const vacancy = seedJob(company, { title: "Guarded welder", status: "open" });

    await signInStaff(page, "admin");
    await notFound(page, "/en/admin/moderation");
    await notFound(page, `/en/admin/moderation/${vacancy}`);
    await page.context().clearCookies();

    const trust = await staffUser("trust_safety");
    const secret = await enrollTotp(trust);
    await signInAtAal1(page, trust, "/en/dashboard/employer");
    await page.goto("/en/admin/moderation");
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/admin/moderation")}`);
    await enterCode(page, secret);
    await expect(page).toHaveURL("/en/admin/moderation");
    await expect(page.getByRole("heading", { name: "Vacancy moderation", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Vacancy moderation" })).toBeVisible();
    expect((await page.goto("/en/admin/moderation/not-an-id"))?.status()).toBe(404);
  });

  test("FR-C7 AC9, AC1, AC5: the search finds vacancies by title, id and organisation without applicant data, the vacancy is hidden by keyboard, leaves the public and is unhidden again", async ({
    page,
  }) => {
    const tag = uniqueTag();
    const company = await newCompany();
    const title = `Welder ${tag}`;
    const open = seedJob(company, { title, status: "open" });
    const draft = seedJob(company, { title: `Welder draft ${tag}`, status: "draft" });
    const applicant = await newApplicant();
    seedApplication(applicant.id, open, company.id, { coverNote: "PRIVATE-COVER-NOTE" });

    const staff = await signInStaff(page, "trust_safety", "/en/admin/moderation");
    await waitForHydration(page.getByLabel("Search vacancies"));
    await search(page, "ab");
    await expect(page.getByText("Enter at least 3 characters")).toBeVisible();
    await expect(rows(page)).toHaveCount(0);

    await search(page, tag);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).filter({ hasText: title }).filter({ hasText: "Open" }).filter({ hasText: "Visible" })).toHaveCount(1);
    await expect(rows(page).filter({ hasText: `Welder draft ${tag}` }).filter({ hasText: "Draft" })).toHaveCount(1);
    await expect(rows(page).first()).toContainText(displayName(company.id));
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/PRIVATE-COVER-NOTE/);
    expect(text).not.toContain(applicant.email);
    await expectNoAxeViolations(page);

    await search(page, open);
    await expect(rows(page)).toHaveCount(1);
    await search(page, displayName(company.id));
    await expect(rows(page).filter({ hasText: title })).toHaveCount(1);
    await search(page, "zzzzqqzz");
    await expect(page.getByText("No vacancies found")).toBeVisible();

    await search(page, tag);
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(`/en/admin/moderation/${open}`);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByText("This vacancy was never hidden.")).toBeVisible();
    await expect(page.getByText("Line two of it", { exact: false })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("PRIVATE-COVER-NOTE");
    await expectAccessibleAtBothWidths(page);
    expect((await bodyOf(page, publicUrl(open))).status).toBe(200);

    const hide = page.getByRole("button", { name: "Hide this vacancy" });
    await waitForHydration(hide);
    await pressEnterOn(page, "Hide this vacancy");
    const dialog = page.getByRole("dialog", { name: "Hide a vacancy" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(title);
    await expect(dialog).toContainText(displayName(company.id));
    await expectNoAxeViolations(page);
    await pressEnterOn(page, "Hide vacancy");
    await expect(dialog.getByText("Give a reason of at least 10 characters").first()).toBeVisible();
    expect(moderationRows(open)).toEqual([]);

    await dialog.getByLabel("Statement of reasons").fill(REASON);
    await pressEnterOn(page, "Hide vacancy");
    await expect(page.getByText("The vacancy is hidden", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#vacancy").getByText("Hidden", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unhide this vacancy" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Moderation history, newest first" })).toContainText(REASON);

    expect(moderationRows(open)).toEqual([{ action: "job_hidden", statement_of_reasons: REASON, actor_id: staff.user.id }]);
    expect(auditRows(open)).toMatchObject([{ action: "job.hide", metadata: { reason: REASON } }]);
    expect(auditRows(open)[0].metadata.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(hiddenEmails(open)).toBe(1);
    expect((await bodyOf(page, publicUrl(open))).status).toBe(404);
    expect((await bodyOf(page, `/en/jobs?q=${tag}`)).html).not.toContain(title);

    await page.getByRole("button", { name: "Unhide this vacancy" }).click();
    const back = page.getByRole("dialog", { name: "Unhide a vacancy" });
    await back.getByLabel("Statement of reasons").fill(BACK);
    await back.getByRole("button", { name: "Unhide vacancy", exact: true }).click();
    await expect(page.getByText("The vacancy is unhidden", { exact: true })).toBeVisible();
    await expect(page.locator("#vacancy").getByText("Visible", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide this vacancy" })).toBeVisible();
    expect(moderationRows(open).map((row) => [row.action, row.statement_of_reasons])).toEqual([
      ["job_hidden", REASON],
      ["job_unhidden", BACK],
    ]);
    expect(hiddenEmails(open)).toBe(1);
    expect((await bodyOf(page, publicUrl(open))).status).toBe(200);
    expect(query<{ moderation_state: string }>(`select moderation_state::text from public.jobs where id = ${literal(draft)}`)).toEqual([
      { moderation_state: "visible" },
    ]);
  });

  test("FR-C7 AC9: of two simultaneous hides one wins and the other is told the vacancy is hidden", async ({ page }) => {
    const company = await newCompany();
    const vacancy = seedJob(company, { title: "Twice hidden welder", status: "open" });
    await signInStaff(page, "trust_safety", `/en/admin/moderation/${vacancy}`);
    const second = await page.context().newPage();
    await second.goto(`/en/admin/moderation/${vacancy}`);

    for (const tab of [page, second]) {
      await waitForHydration(tab.getByRole("button", { name: "Hide this vacancy" }));
      await tab.getByRole("button", { name: "Hide this vacancy" }).click();
      await tab.getByRole("dialog", { name: "Hide a vacancy" }).getByLabel("Statement of reasons").fill(REASON);
    }
    await Promise.all([
      page.getByRole("button", { name: "Hide vacancy", exact: true }).click(),
      second.getByRole("button", { name: "Hide vacancy", exact: true }).click(),
    ]);
    const results = await Promise.all(
      [page, second].map((tab) =>
        Promise.race([
          tab.getByText("The vacancy is hidden", { exact: true }).waitFor().then(() => "done"),
          tab.getByText("This vacancy is already hidden", { exact: true }).waitFor().then(() => "already"),
        ]),
      ),
    );
    expect(results.sort()).toEqual(["already", "done"]);
    expect(moderationRows(vacancy)).toHaveLength(1);
    expect(hiddenEmails(vacancy)).toBe(1);
  });

  test("FR-C7 AC10: the employer sees the badge and the appeal route on the list and on the page, keeps the status actions, and the vacancy stays out of the public", async ({
    page,
    browser,
  }) => {
    const company = await newCompany();
    const admin = await addCompanyUser(company, "admin");
    const member = await addCompanyUser(company, "member");
    const hidden = seedJob(company, { title: "Hidden by moderators", status: "open", moderation: "hidden" });
    const normal = seedJob(company, { title: "Normal welder", status: "open" });

    await logIn(page, admin, jobsUrl(company.slug));
    const item = page.getByRole("listitem").filter({ hasText: "Hidden by moderators" });
    await expect(item).toContainText("Hidden by moderation");
    await expect(item.getByRole("link", { name: /How to appeal/ })).toHaveAttribute("href", APPEAL);
    const other = page.getByRole("listitem").filter({ hasText: "Normal welder" });
    await expect(other).not.toContainText("Hidden by moderation");
    await expect(other.getByRole("link", { name: /How to appeal/ })).toHaveCount(0);
    await expectNoAxeViolations(page);

    await page.goto(jobUrl(company.slug, hidden));
    await expect(page.getByRole("status").filter({ hasText: "Hidden by moderation" })).toBeVisible();
    const notice = page.getByRole("status").filter({ hasText: "Our moderators hid this vacancy" });
    await expect(notice.getByRole("link", { name: /Complaints and Dispute Process/ })).toHaveAttribute("href", APPEAL);
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    expect((await bodyOf(page, publicUrl(hidden))).status).toBe(404);
    expect((await bodyOf(page, publicUrl(normal))).status).toBe(200);

    const context = await browser.newContext();
    const memberPage = await context.newPage();
    await logIn(memberPage, member, jobUrl(company.slug, hidden));
    await expect(memberPage.getByRole("status").filter({ hasText: "Our moderators hid this vacancy" })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Pause" })).toHaveCount(0);
    await context.close();

    await page.goto(jobUrl(company.slug, normal));
    await expect(page.getByText("Our moderators hid this vacancy")).toHaveCount(0);
  });

  test("FR-C7 AC10: the organisation page of the console links its vacancies to their moderation page", async ({ page }) => {
    const company = await newCompany();
    const vacancy = seedJob(company, { title: "Linked welder", status: "open", moderation: "hidden" });
    await signInStaff(page, "trust_safety", `/en/admin/organizations/${company.id}`);
    await page.getByRole("table", { name: "Vacancies" }).getByRole("link", { name: "Linked welder" }).click();
    await expect(page).toHaveURL(`/en/admin/moderation/${vacancy}`);
    await expect(page.locator("#vacancy").getByText("Hidden", { exact: true })).toBeVisible();
  });
});
