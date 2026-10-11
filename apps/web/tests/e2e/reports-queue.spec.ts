import type { Page } from "@playwright/test";
import { signInStaff, uniqueTag } from "./support/admin";
import { displayName, expectAccessibleAtBothWidths, newApplicant } from "./support/applications";
import { literal, query } from "./support/db";
import { evidence } from "./support/evidence";
import { waitForHydration } from "./support/hydration";
import { newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { DETAILS, fillReport, referenceOf, reportsOfUser, sendReport } from "./support/reports";
import { signInBrowser } from "./support/session";
import { newVisitor } from "./support/team";
import { expect, test } from "./support/test";
import { publicUrl } from "./support/vacancy-page";

const NOTE = "The vacancy was hidden and the employer was told.";
const REVIEW_REASON = "Reading the report and the vacancy it names.";
const DISMISS_NOTE = "Nothing in it breaks the platform rules.";

function auditOf(reportId: number) {
  return query<{ action: string; actor_id: string; metadata: { reason?: string; from: string; to: string; request_id?: string } }>(
    `select action, actor_id, metadata from audit.log where entity_id = ${literal(String(reportId))} and action like 'report.%' order by id`,
  );
}

async function notFound(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
}

const table = (page: Page) => page.getByRole("table", { name: "Reports" });
const reportRow = (page: Page, reference: string) => table(page).getByRole("row").filter({ hasText: reference });

test.describe("working the reports queue", () => {
  test("FR-F1, FR-F4: Trust & Safety put a report in review and close it with a note, and the signed-in reporter is told on the dashboard and in the list", async ({ page, browser }) => {
    const company = await newCompany();
    const title = `Queue welder ${uniqueTag()}`;
    const job = seedJob(company, { title, status: "open" });
    const reporter = await newApplicant();

    await logIn(page, reporter, "/en/dashboard/worker");
    await expect(page).toHaveURL("/en/dashboard/worker");
    await page.goto(publicUrl(job));
    await page.getByRole("link", { name: "Report this vacancy" }).click();
    await fillReport(page);
    await expect(page.getByLabel("Your email (optional)")).toHaveCount(0);
    const reference = await sendReport(page);
    await evidence(page, "report-received-signed-in");
    await expect(page.getByRole("link", { name: "See your reports" })).toHaveAttribute("href", "/en/reports");
    const [mine] = reportsOfUser(reporter.id);
    expect(reference).toBe(referenceOf(mine.id));
    await page.getByRole("link", { name: "See your reports" }).click();
    await expect(page.getByRole("heading", { name: "My reports", level: 1 })).toBeVisible();
    const item = page.getByRole("listitem").filter({ hasText: reference });
    await expect(item).toContainText(title);
    await expect(item).toContainText("New");
    await expect(item).not.toContainText("Note from Trust");

    const staff = await newVisitor(browser);
    const { user: trust } = await signInStaff(staff.page, "trust_safety", `/en/admin/reports?status=open&after=${mine.id - 1}`);
    await expect(staff.page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    await expect(staff.page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Reports" })).toBeVisible();
    const row = reportRow(staff.page, reference);
    await expect(row).toContainText(`Vacancy: ${title}`);
    await expect(row).toContainText("A fee is demanded from the worker");
    await expect(row).toContainText("New");
    expect(await staff.page.locator("main").innerText()).not.toContain(DETAILS);
    await evidence(staff.page, "reports-queue");
    await expectAccessibleAtBothWidths(staff.page);

    await staff.page.setViewportSize({ width: 1280, height: 900 });
    await staff.page.getByLabel("Status").selectOption("dismissed");
    await staff.page.getByRole("button", { name: "Apply filters" }).click();
    await expect(staff.page).toHaveURL(/status=dismissed/);
    await expect(reportRow(staff.page, reference)).toHaveCount(0);
    await staff.page.goto(`/en/admin/reports?status=new&type=job&after=${mine.id - 1}`);
    await expect(reportRow(staff.page, reference)).toBeVisible();
    await staff.page.goto(`/en/admin/reports?status=new&type=content&after=${mine.id - 1}`);
    await expect(reportRow(staff.page, reference)).toHaveCount(0);

    await staff.page.goto(`/en/admin/reports?status=open&after=${mine.id - 1}`);
    await reportRow(staff.page, reference).getByRole("link", { name: reference }).click();
    await expect(staff.page).toHaveURL(`/en/admin/reports/${mine.id}`);
    await expect(staff.page.getByRole("heading", { name: `Report ${reference}`, level: 1 })).toBeVisible();
    const report = staff.page.locator("#report");
    await expect(report).toContainText("A signed-in account");
    await expect(report).toContainText(DETAILS);
    const target = staff.page.locator("#target");
    await expect(target).toContainText(title);
    await expect(target).toContainText(displayName(company.id));
    await expect(target.getByRole("link", { name: "Open the vacancy to hide or unhide it" })).toHaveAttribute("href", `/en/admin/moderation/${job}`);
    await expect(target.getByRole("link", { name: "Open the organisation to suspend or reinstate it" })).toHaveAttribute("href", `/en/admin/organizations/${company.id}`);
    await evidence(staff.page, "report-detail");
    await expectAccessibleAtBothWidths(staff.page);

    await staff.page.setViewportSize({ width: 1280, height: 900 });
    const review = staff.page.getByRole("button", { name: "Mark in review" });
    await waitForHydration(review);
    await review.click();
    const reviewDialog = staff.page.getByRole("dialog", { name: "Put the report in review" });
    await reviewDialog.getByRole("button", { name: "Mark in review" }).click();
    await expect(reviewDialog.getByText("Give a reason of at least 10 characters").first()).toBeVisible();
    await reviewDialog.getByLabel("Reason").fill(REVIEW_REASON);
    await reviewDialog.getByRole("button", { name: "Mark in review" }).click();
    await expect(staff.page.getByText("The report is in review", { exact: true })).toBeVisible();
    await expect(staff.page.locator("#report").getByText("In review", { exact: true })).toBeVisible();
    await expect(review).toHaveCount(0);

    const close = staff.page.getByRole("button", { name: "Mark actioned" });
    await close.focus();
    await staff.page.keyboard.press("Enter");
    const dialog = staff.page.getByRole("dialog", { name: "Mark the report actioned" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Mark actioned" }).click();
    await expect(dialog.getByText("Give a reason of at least 10 characters").first()).toBeVisible();
    await dialog.getByLabel("Note").fill(NOTE);
    await dialog.getByRole("button", { name: "Mark actioned" }).click();
    await expect(staff.page.getByText("The report is marked actioned", { exact: true })).toBeVisible();
    const decision = staff.page.locator("#decision");
    await expect(decision).toContainText("Outcome");
    await expect(decision).toContainText("Actioned");
    await expect(decision).toContainText(NOTE);
    await expect(decision.getByRole("button")).toHaveCount(0);
    await evidence(staff.page, "report-closed");

    const [closed] = reportsOfUser(reporter.id);
    expect(closed).toMatchObject({ status: "actioned", resolution_note: NOTE });
    const audit = auditOf(mine.id);
    expect(audit.map(({ action }) => action)).toEqual(["report.submitted", "report.in_review", "report.actioned"]);
    expect(audit[0].actor_id).toBe(reporter.id);
    expect(audit[1].metadata).toMatchObject({ from: "new", to: "in_review", reason: REVIEW_REASON });
    expect(audit[2].actor_id).toBe(trust.id);
    expect(audit[2].metadata).toMatchObject({ from: "in_review", to: "actioned", reason: NOTE });
    expect(audit[2].metadata.request_id).toMatch(/^[0-9a-f-]{36}$/);

    await staff.page.goto(`/en/admin/reports?status=open&after=${mine.id - 1}`);
    await expect(reportRow(staff.page, reference)).toHaveCount(0);
    await staff.page.goto(`/en/admin/reports?status=actioned&after=${mine.id + 1}`);
    await expect(reportRow(staff.page, reference)).toContainText("Actioned");
    await staff.context.close();

    await page.goto("/en/dashboard/worker");
    const notice = page.getByRole("status", { name: "Your closed reports" });
    await expect(notice).toContainText(`Your report ${reference} was closed as actioned`);
    await expect(notice).toContainText(NOTE);
    await evidence(page, "reporter-notified");
    await expectAccessibleAtBothWidths(page);
    await notice.getByRole("link", { name: "See your reports" }).click();
    const done = page.getByRole("listitem").filter({ hasText: reference });
    await expect(done).toContainText("Actioned");
    await expect(done).toContainText(NOTE);
    await evidence(page, "my-reports-closed");
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-F4: a report is dismissed with a note, and a reporter who is not signed in has nothing to be told", async ({ page }) => {
    const company = await newCompany();
    const job = seedJob(company, { title: `Dismissed ${uniqueTag()}`, status: "open" });
    await page.goto(`/en/report?type=company&job=${job}`);
    await fillReport(page, { category: "harassment", email: "anon@example.test" });
    const reference = await sendReport(page);
    const id = Number(reference.slice(2));

    await signInStaff(page, "trust_safety", `/en/admin/reports/${id}`);
    await expect(page.locator("#report")).toContainText("A visitor, anon@example.test");
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
    await waitForHydration(dismiss);
    await dismiss.click();
    const dialog = page.getByRole("dialog", { name: "Dismiss the report" });
    await expect(dialog).toContainText("The reporter is not an account");
    await dialog.getByLabel("Note").fill(DISMISS_NOTE);
    await dialog.getByRole("button", { name: "Dismiss report" }).click();
    await expect(page.getByText("The report is dismissed", { exact: true })).toBeVisible();
    await expect(page.locator("#decision")).toContainText(DISMISS_NOTE);
    expect(query<{ status: string; resolution_note: string }>(`select status::text, resolution_note from public.reports where id = ${id}`)).toEqual([
      { status: "dismissed", resolution_note: DISMISS_NOTE },
    ]);
  });

  test("FR-F1: a Platform Administrator reads the queue and a report but cannot decide, and nobody else reaches the pages", async ({ page, browser }) => {
    const company = await newCompany();
    const job = seedJob(company, { title: `Read only ${uniqueTag()}`, status: "open" });
    await page.goto(`/en/report?type=job&job=${job}`);
    await fillReport(page);
    const reference = await sendReport(page);
    const id = Number(reference.slice(2));
    await page.context().clearCookies();

    const admin = await newVisitor(browser);
    await signInStaff(admin.page, "admin", `/en/admin/reports?status=open&after=${id - 1}`);
    await expect(admin.page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Reports" })).toBeVisible();
    await expect(reportRow(admin.page, reference)).toBeVisible();
    await admin.page.goto(`/en/admin/reports/${id}`);
    await expect(admin.page.locator("#decision").getByRole("status")).toContainText("Read only");
    await expect(admin.page.getByRole("button", { name: /Mark in review|Dismiss|Mark actioned/ })).toHaveCount(0);
    await expect(admin.page.getByRole("link", { name: "Open the vacancy to hide or unhide it" })).toHaveCount(0);
    await expect(admin.page.getByRole("link", { name: "Open the organisation to suspend or reinstate it" })).toBeVisible();
    await expectAccessibleAtBothWidths(admin.page);
    await evidence(admin.page, "report-read-only");
    await admin.context.close();

    const review = await newVisitor(browser);
    await signInStaff(review.page, "verification_reviewer", "/en/admin/reports");
    await notFound(review.page, "/en/admin/reports");
    await notFound(review.page, `/en/admin/reports/${id}`);
    await review.context.close();

    const member = await newVisitor(browser);
    await signInBrowser(member.context, company.owner);
    await notFound(member.page, `/en/admin/reports/${id}`);
    await member.context.close();

    await page.goto(`/en/admin/reports/${id}`);
    await expect(page).toHaveURL(/\/en\/login/);
  });
});
