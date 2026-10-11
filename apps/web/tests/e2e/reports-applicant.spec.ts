import { signInStaff } from "./support/admin";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { applicantUrl, setupApplicant } from "./support/applicants";
import { evidence } from "./support/evidence";
import { addCompanyUser, expectNotFound, newCompany } from "./support/jobs";
import { logIn } from "./support/login-page";
import { fillReport, referenceOf, reportsOfApplication, sendReport } from "./support/reports";
import { newVisitor } from "./support/team";
import { expect, test } from "./support/test";

test.describe("reporting an applicant", () => {
  test("FR-F4, FR-F3: a member of the organisation reports an applicant from the applicant page, and staff see the vacancy and the organisation but no name", async ({ page, browser }) => {
    const { company, member, candidate, applicationId } = await setupApplicant();

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(page.getByRole("heading", { name: "Ana Silva", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Report this profile" }).click();
    await expect(page).toHaveURL(`${applicantUrl(company.slug, applicationId)}/report`);
    await expect(page.getByRole("heading", { name: "Report this profile", level: 1 })).toBeVisible();
    await expect(page.getByText("Detail welder", { exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Ana");
    await expect(page.locator("main")).not.toContainText("Silva");
    await expect(page.getByLabel("Your email (optional)")).toHaveCount(0);
    await expect(page.getByLabel("Address of the vacancy")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Applicants");
    await evidence(page, "report-applicant-form");
    await expectAccessibleAtBothWidths(page);

    await page.setViewportSize({ width: 1280, height: 900 });
    await fillReport(page, { category: "harassment", details: "The profile contains abusive language towards our staff." });
    const reference = await sendReport(page);
    await expect(page.getByRole("link", { name: "See your reports" })).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    const [row] = reportsOfApplication(applicationId);
    expect(reference).toBe(referenceOf(row.id));
    expect(row).toMatchObject({
      target_type: "profile",
      job_id: null,
      organization_id: null,
      reporter_user_id: member.id,
      reporter_email: null,
      category: "harassment",
      status: "new",
    });
    expect(JSON.stringify(row)).not.toContain(candidate.id);
    expect(JSON.stringify(row)).not.toMatch(/Ana|Silva/);

    await page.goto("/en/reports");
    await expect(page.getByRole("listitem").filter({ hasText: reference })).toContainText("Candidate profile");

    const staff = await newVisitor(browser);
    await signInStaff(staff.page, "trust_safety", `/en/admin/reports/${row.id}`);
    const detail = staff.page.locator("main");
    await expect(detail).toContainText("Candidate profile");
    await expect(detail).toContainText("Detail welder");
    await expect(detail).toContainText("The name of the candidate and the documents are not shown to staff.");
    expect(await detail.innerText()).not.toMatch(/Ana|Silva/);
    await expect(staff.page.getByRole("link", { name: "Open the vacancy to hide or unhide it" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(staff.page);
    await evidence(staff.page, "report-detail-profile");
    await staff.context.close();
  });

  test("FR-F4: a member of another organisation and the candidate who applied cannot reach the report page", async ({ page, browser }) => {
    const { company, candidate, applicationId } = await setupApplicant();
    const other = await newCompany();
    const url = `${applicantUrl(company.slug, applicationId)}/report`;

    await logIn(page, other.owner, "/en/dashboard/employer");
    await expect(page).toHaveURL("/en/dashboard/employer");
    await expectNotFound(page, url);
    const colleague = await addCompanyUser(other, "member");
    const own = await newVisitor(browser);
    await logIn(own.page, colleague, "/en/dashboard/employer");
    await expect(own.page).toHaveURL("/en/dashboard/employer");
    await expectNotFound(own.page, `${applicantUrl(other.slug, applicationId)}/report`);
    await own.context.close();

    const worker = await newVisitor(browser);
    await logIn(worker.page, candidate, url);
    await expect(worker.page).toHaveURL(/\/en\/dashboard\/worker$/);
    await worker.context.close();
    expect(reportsOfApplication(applicationId)).toEqual([]);
  });
});
