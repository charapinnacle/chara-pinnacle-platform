import { execute, literal, query } from "./support/db";
import { eventRows, newApplicant } from "./support/applications";
import { applicantUrl, changeStageButton, seedNamedApplication, stageValue, statusMessages } from "./support/applicants";
import { addCompanyUser, expectNotFound, newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

async function setup(status = "applied") {
  const company = await newCompany();
  const member = await addCompanyUser(company, "member");
  const candidate = await newApplicant();
  const jobId = seedJob(company, { title: "Viewed welder", status: "open" });
  const applicationId = seedNamedApplication(candidate, jobId, company, status);
  return { company, member, candidate, applicationId };
}

const viewedEvents = (applicationId: string) => eventRows(applicationId).filter((event) => event.to_status === "viewed");

test.describe("the first open of an application", () => {
  test("FR-D2 AC2: the first member to open it moves it to Viewed with no actor and no email, a second open changes nothing", async ({
    page,
    browser,
  }) => {
    const { company, member, applicationId } = await setup();
    const colleague = await addCompanyUser(company, "member");

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(page.getByRole("heading", { name: "Ana Silva", level: 1 })).toBeVisible();
    await expect(stageValue(page)).toHaveText("Viewed");
    expect(viewedEvents(applicationId)).toEqual([
      expect.objectContaining({ from_status: "applied", to_status: "viewed", actor_id: null, note: null }),
    ]);
    expect(statusMessages(applicationId)).toEqual([]);

    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.6.5.4" } });
    await signInBrowser(context, colleague);
    const second = await context.newPage();
    await second.goto(applicantUrl(company.slug, applicationId));
    await expect(stageValue(second)).toHaveText("Viewed");
    await page.reload();
    await expect(stageValue(page)).toHaveText("Viewed");
    expect(eventRows(applicationId)).toHaveLength(2);
    await context.close();
  });

  test("FR-D2 AC2: opening an application that is already shortlisted changes nothing", async ({ page }) => {
    const { company, member, applicationId } = await setup("shortlisted");
    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(stageValue(page)).toHaveText("Shortlisted");
    expect(eventRows(applicationId)).toHaveLength(1);
  });

  test("FR-D2 AC3: an outsider, the candidate, a visitor and an owner without two-step verification move nothing", async ({
    page,
    browser,
  }) => {
    const { company, candidate, applicationId } = await setup();
    const other = await newCompany();
    const outsider = await addCompanyUser(other, "member");

    const outsiderContext = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.5.4.1" } });
    await signInBrowser(outsiderContext, outsider);
    const outsiderVisit = await outsiderContext.newPage();
    await expectNotFound(outsiderVisit, applicantUrl(company.slug, applicationId));
    await expect(outsiderVisit.getByText("Ana Silva")).toHaveCount(0);
    await outsiderContext.close();
    const candidateContext = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.5.4.2" } });
    await signInBrowser(candidateContext, candidate);
    const candidateVisit = await candidateContext.newPage();
    await candidateVisit.goto(applicantUrl(company.slug, applicationId));
    await expect(candidateVisit).toHaveURL(/\/en\/dashboard\/worker$/);
    await expect(candidateVisit.getByText("Ana Silva")).toHaveCount(0);
    await candidateContext.close();
    const otherSlugContext = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.5.4.9" } });
    const memberOfBoth = await addCompanyUser(other, "member");
    execute(
      `insert into public.organization_members (organization_id, user_id, role, accepted_at)
       values (${literal(company.id)}, ${literal(memberOfBoth.id)}, 'member', now())`,
    );
    await signInBrowser(otherSlugContext, memberOfBoth);
    const wrongAddress = await otherSlugContext.newPage();
    await expectNotFound(wrongAddress, applicantUrl(other.slug, applicationId));
    await expect(wrongAddress.getByText("Ana Silva")).toHaveCount(0);
    await otherSlugContext.close();
    expect(eventRows(applicationId)).toHaveLength(1);

    await page.goto(applicantUrl(company.slug, applicationId));
    await expect(page).toHaveURL(/\/en\/login\?next=/);
    const owner = company.owner;
    await logIn(page, owner, applicantUrl(company.slug, applicationId));
    await expect(page).toHaveURL(/\/en\/mfa/);
    expect(eventRows(applicationId)).toHaveLength(1);
  });

  test("FR-D2 AC4: a lapsed organisation reads the applicant, the stage stays Applied and no stage can be chosen", async ({ page }) => {
    const { company, member, applicationId } = await setup();
    execute(
      `insert into billing.subscriptions (organization_id, plan_code, status, provider)
       values (${literal(company.id)}, 'employer_starter', 'canceled', 'null')`,
    );
    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(page.getByRole("heading", { name: "Ana Silva", level: 1 })).toBeVisible();
    await expect(stageValue(page)).toHaveText("Applied");
    await expect(page.getByRole("status").filter({ hasText: "Your subscription has ended. Your past applicants stay readable" })).toBeVisible();
    await expect(changeStageButton(page)).toBeDisabled();
    expect(eventRows(applicationId)).toHaveLength(1);
  });

  test("FR-D2 AC3, FR-D5 AC11: a suspended organisation is refused the applicant and nothing is opened", async ({ page }) => {
    const { company, member, applicationId } = await setup();
    execute(`update public.organizations set status = 'suspended' where id = ${literal(company.id)}`);
    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(page.getByRole("alert").filter({ hasText: "This organization is suspended, so its applicants are not available." })).toBeVisible();
    await expect(page.getByText("Ana Silva")).toHaveCount(0);
    await expect(changeStageButton(page)).toHaveCount(0);
    expect(query<{ n: number }>(`select count(*)::int as n from public.application_events where application_id = ${literal(applicationId)}`)[0].n).toBe(1);
  });
});
