import { applicationUrl, newApplicant, expectAccessibleAtBothWidths } from "./support/applications";
import { applicantUrl, seedNamedApplication, stageValue } from "./support/applicants";
import { execute, literal } from "./support/db";
import { addCompanyUser, expectNotFound, newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { signInBrowser } from "./support/session";
import { databaseLogLines, runAs } from "./support/visibility";
import { expect, test } from "./support/test";

async function setup() {
  const companyA = await newCompany();
  const companyB = await newCompany();
  const memberA = await addCompanyUser(companyA, "member");
  const memberB = await addCompanyUser(companyB, "member");
  const candidateA = await newApplicant();
  const candidateB = await newApplicant();
  const applicationA = seedNamedApplication(candidateA, seedJob(companyA, { title: "Visibility welder A", status: "open" }), companyA, "applied");
  const applicationB = seedNamedApplication(candidateB, seedJob(companyB, { title: "Visibility welder B", status: "open" }), companyB, "applied");
  return { companyA, companyB, memberA, memberB, candidateA, candidateB, applicationA, applicationB };
}

const cross = (id: string) => databaseLogLines(`CHARA_CROSS_TENANT`).filter((line) => line.includes(id));

test.describe("who may open an application", () => {
  test("FR-D5 AC10: a member, an outsider and another candidate get the page of an unknown id", async ({ browser }) => {
    const { companyA, companyB, memberA, candidateB, applicationA, applicationB } = await setup();
    const context = await browser.newContext();
    await signInBrowser(context, memberA);
    const member = await context.newPage();

    await expectNotFound(member, applicantUrl(companyA.slug, applicationB));
    await expect(member.getByText("Ana Silva")).toHaveCount(0);
    await expectNotFound(member, applicantUrl(companyB.slug, applicationA));
    await expect(member.getByText("Ana Silva")).toHaveCount(0);
    await expectNotFound(member, `/en/org/${companyB.slug}/applicants`);
    await expect(member.getByText("Visibility welder B")).toHaveCount(0);
    await context.close();

    const candidateContext = await browser.newContext();
    await signInBrowser(candidateContext, candidateB);
    const candidate = await candidateContext.newPage();
    await expectNotFound(candidate, applicationUrl(applicationA));
    await expect(candidate.getByText("Visibility welder A")).toHaveCount(0);
    await candidateContext.close();

    expect(execute(`select status from public.job_applications where id in (${literal(applicationA)}, ${literal(applicationB)})`).trim()).toBe("applied\napplied");
  });

  test("FR-D5 AC8: an attempt on another organisation's application leaves one line in the database log, a guess at an id none", async ({
    browser,
  }) => {
    const { companyA, companyB, memberA, memberB, candidateB, applicationA, applicationB } = await setup();
    const memberB2 = await addCompanyUser(companyB, "member");
    const unknown = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
    const line = (caller: string, fn: string, application: string) =>
      new RegExp(`CHARA_CROSS_TENANT caller=${caller} function=${fn} application=${application}$`);

    const context = await browser.newContext();
    await signInBrowser(context, memberA);
    const page = await context.newPage();
    await expectNotFound(page, applicantUrl(companyA.slug, applicationB));
    await expectNotFound(page, applicantUrl(companyA.slug, unknown));
    await context.close();

    const attempts = (id: string) => [
      ["set_application_status", memberB.id, `select public.set_application_status(${literal(id)}, 'interview');`],
      ["mark_application_viewed", memberB.id, `select public.mark_application_viewed(${literal(id)});`],
      ["withdraw_application", candidateB.id, `select public.withdraw_application(${literal(id)});`],
      ["withdraw_application", memberB.id, `select public.withdraw_application(${literal(id)});`],
      ["list_applicant_events", memberB.id, `select * from public.list_applicant_events(${literal(id)});`],
      ["set_application_status", memberB2.id, `select * from public.bulk_set_application_status(array[${literal(id)}]::uuid[], 'interview', null);`],
    ] as const;
    for (const id of [applicationA, unknown]) {
      for (const [, caller, sql] of attempts(id)) runAs(caller, sql);
    }
    expect(runAs(memberA.id, `select * from public.list_applicant_events(${literal(applicationA)});`)).toBe("ok");

    await expect.poll(() => cross(applicationB).length).toBe(1);
    expect(cross(applicationB)[0]).toMatch(line(memberA.id, "get_applicant", applicationB));
    await expect.poll(() => cross(applicationA).length).toBe(attempts(applicationA).length);
    const logged = cross(applicationA);
    for (const [fn, caller] of attempts(applicationA)) {
      expect(logged.filter((entry) => line(caller, fn, applicationA).test(entry)), `${fn} by ${caller}`).toHaveLength(1);
    }
    expect(cross(unknown)).toEqual([]);
    expect(execute(`select status from public.job_applications where id = ${literal(applicationA)}`).trim()).toBe("applied");
  });

  test("FR-D5 AC11: the owner and the admin need two-step verification, a member does not, a suspended organisation is refused", async ({
    page,
    browser,
  }) => {
    const { companyA, memberA, candidateA, applicationA } = await setup();
    const admin = await addCompanyUser(companyA, "admin");
    const url = applicantUrl(companyA.slug, applicationA);

    await logIn(page, companyA.owner, url);
    await expect(page).toHaveURL(/\/en\/mfa/);
    const adminContext = await browser.newContext();
    await signInBrowser(adminContext, admin);
    const adminPage = await adminContext.newPage();
    await adminPage.goto(url);
    await expect(adminPage).toHaveURL(/\/en\/mfa/);
    await expect(adminPage.getByText("Ana Silva")).toHaveCount(0);
    await adminContext.close();

    const memberContext = await browser.newContext();
    await signInBrowser(memberContext, memberA);
    const member = await memberContext.newPage();
    await member.goto(url);
    await expect(member.getByRole("heading", { name: "Ana Silva", level: 1 })).toBeVisible();

    execute(`update public.organizations set status = 'suspended' where id = ${literal(companyA.id)}`);
    await member.goto(url);
    await expect(member.getByRole("alert").filter({ hasText: "This organization is suspended, so its applicants are not available." })).toBeVisible();
    await expect(member.getByText("Ana Silva")).toHaveCount(0);
    await expectAccessibleAtBothWidths(member);
    await memberContext.close();

    const candidateContext = await browser.newContext();
    await signInBrowser(candidateContext, candidateA);
    const candidate = await candidateContext.newPage();
    await candidate.goto(applicationUrl(applicationA));
    await expect(candidate.getByRole("heading", { name: "Visibility welder A", level: 1 })).toBeVisible();
    await expect(stageValue(candidate)).toHaveText("Viewed");
    await candidateContext.close();
  });
});
