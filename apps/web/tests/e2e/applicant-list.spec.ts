import { expectAccessibleAtBothWidths } from "./support/applications";
import {
  applicantsUrl,
  cellTexts,
  expectNoDocumentNames,
  listRows,
  seedListApplicant,
  seedMany,
  subscribe,
} from "./support/applicant-list";
import { execute, literal, query } from "./support/db";
import { addCompanyUser, expectNotFound, newCompany, seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

const STAGES = "(array['applied','viewed','shortlisted','interview','offer','hired','rejected','withdrawn'])[1 + ids.n % 8]";
const PIPELINE = ["Applied", "Viewed", "Shortlisted", "Interview", "Offer", "Hired", "Not selected", "Withdrawn"];

async function memberSession(browser: import("@playwright/test").Browser, company: Parameters<typeof addCompanyUser>[0]) {
  const member = await addCompanyUser(company, "member");
  const context = await browser.newContext();
  await signInBrowser(context, member);
  return { member, context, page: await context.newPage() };
}

test.describe("the applicant list", () => {
  test("FR-E1 AC1: the list shows candidate, stage, date, completeness and document count, newest first, with New on the applied one only", async ({
    browser,
  }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const job = seedJob(company, { title: "Listed welder", status: "open" });
    seedListApplicant(company, job, { name: "Ana Silva", status: "applied", appliedAt: "2026-09-04T10:00:00Z", completeness: 80, documents: 2 });
    seedListApplicant(company, job, { name: "Ben Okoro", status: "shortlisted", appliedAt: "2026-09-03T10:00:00Z", completeness: 55, documents: 0 });
    seedListApplicant(company, job, { name: "Chi Wei", status: "withdrawn", appliedAt: "2026-09-02T10:00:00Z", completeness: 70, documents: 2, revoked: true });
    seedListApplicant(company, job, { name: "Dev Rao", status: "hired", appliedAt: "2026-09-01T10:00:00Z", completeness: 90, documents: 1 });
    const { context, page } = await memberSession(browser, company);

    await page.goto(applicantsUrl(company.slug, `?job=${job}`));
    await expect(page.getByRole("heading", { name: "Applicants", level: 1 })).toBeVisible();
    await expect(page.getByRole("columnheader")).toHaveText(["Candidate", "Stage", "Applied", "Completeness (%)", "Documents"]);
    expect(await cellTexts(page)).toEqual([
      ["Ana Silva New", "Applied", "4 Sep 2026", "80 %", "2"],
      ["Ben Okoro", "Shortlisted", "3 Sep 2026", "55 %", "0"],
      ["Chi Wei", "Withdrawn", "2 Sep 2026", "70 %", "0"],
      ["Dev Rao", "Hired", "1 Sep 2026", "90 %", "1"],
    ]);
    await expect(page.getByText("New", { exact: true })).toHaveCount(1);
    await expect(listRows(page).filter({ hasText: "Ana Silva" }).getByText("New", { exact: true })).toBeVisible();

    await expectNoDocumentNames(page);
    const html = await page.content();
    for (const id of query<{ id: string }>(`select jsonb_array_elements_text(scope) as id from public.passport_shares where organization_id = ${literal(company.id)}`)) {
      expect(html).not.toContain(id.id);
    }
    await expectAccessibleAtBothWidths(page);
    await context.close();
  });

  test("FR-E1 AC2: headers sort in both directions, the stage filter, pages of 50, invalid values and the list of all vacancies", async ({
    browser,
  }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const jobJ = seedJob(company, { title: "Welder J", status: "open" });
    const jobK = seedJob(company, { title: "Fitter K", status: "open" });
    seedMany(company, jobJ, 51, STAGES);
    seedMany(company, jobK, 2);
    const { context, page } = await memberSession(browser, company);
    const url = applicantsUrl(company.slug, `?job=${jobJ}`);
    const column = async (index: number) => (await cellTexts(page)).map((row) => row[index]);
    const header = (text: string) => page.getByRole("columnheader").filter({ hasText: text });

    await page.goto(url);
    await expect(listRows(page)).toHaveCount(50);
    expect((await column(0))[0]).toBe("Cand 51");
    await expect(header("Applied")).toHaveAttribute("aria-sort", "descending");

    await page.getByRole("link", { name: "Sort by Applied date" }).click();
    await expect(header("Applied")).toHaveAttribute("aria-sort", "ascending");
    expect((await column(0))[0]).toBe("Cand 1");
    await page.getByRole("link", { name: "Sort by Applied date" }).click();
    await expect(header("Applied")).toHaveAttribute("aria-sort", "descending");
    expect((await column(0))[0]).toBe("Cand 51");

    await page.getByRole("link", { name: "Sort by Stage" }).click();
    await expect(header("Stage")).toHaveAttribute("aria-sort", "ascending");
    await expect(header("Applied")).not.toHaveAttribute("aria-sort", /.+/);
    let stages = (await column(1)).map((label) => PIPELINE.indexOf(label));
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
    expect(stages[0]).toBe(0);
    await page.getByRole("link", { name: "Sort by Stage" }).click();
    await expect(header("Stage")).toHaveAttribute("aria-sort", "descending");
    stages = (await column(1)).map((label) => PIPELINE.indexOf(label));
    expect(stages).toEqual([...stages].sort((a, b) => b - a));
    expect(stages[0]).toBe(7);

    await page.getByRole("link", { name: "Sort by Completeness" }).click();
    await expect(header("Completeness (%)")).toHaveAttribute("aria-sort", "ascending");
    let numbers = (await column(3)).map((text) => Number.parseInt(text, 10));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    await page.getByRole("link", { name: "Sort by Completeness" }).click();
    await expect(header("Completeness (%)")).toHaveAttribute("aria-sort", "descending");
    numbers = (await column(3)).map((text) => Number.parseInt(text, 10));
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(numbers[0]).toBeGreaterThan(numbers[numbers.length - 1]);

    await page.getByRole("link", { name: "Sort by Documents" }).click();
    await expect(header("Documents")).toHaveAttribute("aria-sort", "ascending");
    numbers = (await column(4)).map(Number);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(numbers[0]).toBe(0);
    await page.getByRole("link", { name: "Sort by Documents" }).click();
    await expect(header("Documents")).toHaveAttribute("aria-sort", "descending");
    numbers = (await column(4)).map(Number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(numbers[0]).toBe(3);

    await page.goto(url);
    await page.getByLabel("Filter by stage").selectOption({ label: "Shortlisted" });
    await expect(page).toHaveURL(/stage=shortlisted/);
    await expect(listRows(page)).toHaveCount(7);
    expect(new Set(await column(1))).toEqual(new Set(["Shortlisted"]));
    await page.reload();
    await expect(page.getByLabel("Filter by stage")).toHaveValue("shortlisted");
    await expect(listRows(page)).toHaveCount(7);

    await page.goto(url);
    await expect(listRows(page)).toHaveCount(50);
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await page.getByRole("link", { name: "Next page" }).click();
    await expect(listRows(page)).toHaveCount(1);
    await expect(page.getByText("Page 2 of 2")).toBeVisible();

    for (const search of [`?job=${jobJ}&page=0&sort=password&stage=hacked`, `?job=${jobJ}&page=-1&dir=sideways&view=grid`]) {
      const response = await page.goto(applicantsUrl(company.slug, search));
      expect(response?.status()).toBe(200);
      await expect(listRows(page)).toHaveCount(50);
      expect((await column(0))[0]).toBe("Cand 51");
      await expect(page.getByLabel("Filter by stage")).toHaveValue("");
      await expect(page.getByText("Page 1 of 2")).toBeVisible();
    }
    await page.goto(applicantsUrl(company.slug, `?job=${jobJ}&page=9`));
    await expect(listRows(page)).toHaveCount(1);
    await expect(page.getByText("Page 2 of 2")).toBeVisible();

    await page.goto(applicantsUrl(company.slug));
    await expect(listRows(page)).toHaveCount(50);
    await expect(page.getByRole("columnheader")).toHaveText(["Candidate", "Vacancy", "Stage", "Applied", "Completeness (%)", "Documents"]);
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await expect(page.getByRole("link", { name: "Board" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
    await page.getByRole("link", { name: "Next page" }).click();
    await expect(listRows(page)).toHaveCount(3);
    expect(new Set((await column(1)).slice(0, 3))).toEqual(new Set(["Welder J", "Fitter K"]));
    await page.goto(applicantsUrl(company.slug, "?stage=shortlisted&sort=applied"));
    await expect(listRows(page)).toHaveCount(7);
    await expect(page.getByLabel("Filter by stage")).toHaveValue("shortlisted");
    await context.close();
  });

  test("FR-E1 step 1: a member opens the applicants of a vacancy from the vacancy page and all applicants from the organization page", async ({ browser }) => {
    const company = await newCompany();
    const job = seedJob(company, { title: "Linked welder", status: "open" });
    seedListApplicant(company, job, { name: "Ana Silva", appliedAt: "2026-09-04T10:00:00Z", completeness: 80 });
    const { context, page } = await memberSession(browser, company);

    await page.goto(`/en/org/${company.slug}/jobs/${job}`);
    await page.getByRole("link", { name: "Applicants" }).click();
    await expect(page).toHaveURL(new RegExp(`/applicants\\?job=${job}$`));
    await expect(page.getByRole("link", { name: "Linked welder" })).toBeVisible();
    await expect(listRows(page)).toHaveCount(1);

    await page.goto(`/en/org/${company.slug}`);
    await page.getByRole("link", { name: "Applicants" }).click();
    await expect(page).toHaveURL(new RegExp(`/applicants$`));
    await expect(page.getByRole("columnheader")).toHaveText(["Candidate", "Vacancy", "Stage", "Applied", "Completeness (%)", "Documents"]);
    await context.close();
  });

  test("FR-E1 AC7: no application, no match for a filter, and the way back", async ({ browser }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const empty = seedJob(company, { title: "Empty vacancy", status: "open" });
    const busy = seedJob(company, { title: "Busy vacancy", status: "open" });
    seedListApplicant(company, busy, { name: "Ana Silva", status: "applied", appliedAt: "2026-09-04T10:00:00Z", completeness: 80 });
    const { context, page } = await memberSession(browser, company);

    await page.goto(applicantsUrl(company.slug, `?job=${empty}`));
    await expect(page.getByRole("heading", { name: "No applications yet", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the vacancy" })).toHaveAttribute("href", `/en/org/${company.slug}/jobs/${empty}`);
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
    await expect(page.getByLabel("Filter by stage")).toHaveCount(0);
    await page.goto(applicantsUrl(company.slug, `?job=${empty}&view=board`));
    await expect(page.getByRole("heading", { name: "No applications yet", level: 2 })).toBeVisible();

    await page.goto(applicantsUrl(company.slug, `?job=${busy}&stage=offer`));
    await expect(page.getByRole("heading", { name: "No applicants match this filter", level: 2 })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filter" }).click();
    await expect(page).toHaveURL(new RegExp(`/applicants\\?job=${busy}$`));
    await expect(listRows(page)).toHaveCount(1);
    await context.close();
  });
});

test.describe("who may open the applicant list", () => {
  test("FR-E1 AC11: sign-in, account kind, organisation and two-step verification decide who sees it", async ({ page, browser }) => {
    const company = await newCompany();
    const other = await newCompany();
    subscribe(company, "employer_starter");
    const job = seedJob(company, { title: "Guarded welder", status: "open" });
    seedListApplicant(company, job, { name: "Ana Silva", appliedAt: "2026-09-04T10:00:00Z", completeness: 80 });
    const url = applicantsUrl(company.slug);
    const memberOfOther = await addCompanyUser(other, "member");
    const candidate = await createCommittedUser("worker");
    const administrator = await createCommittedUser("company");
    execute(`insert into public.platform_staff (user_id, role) values (${literal(administrator.id)}, 'admin')`);
    const member = await addCompanyUser(company, "member");

    await page.goto(url);
    await expect(page).toHaveURL(new RegExp(`/en/login\\?next=${encodeURIComponent(url).replaceAll(".", "\\.")}$`));
    await expect(page.getByText("Ana Silva")).toHaveCount(0);

    for (const [user, label] of [[memberOfOther, "member of another organisation"], [administrator, "platform administrator"]] as const) {
      const context = await browser.newContext();
      await signInBrowser(context, user);
      const visitor = await context.newPage();
      await expectNotFound(visitor, url);
      await expect(visitor.getByText("Ana Silva"), label).toHaveCount(0);
      await context.close();
    }

    const candidateContext = await browser.newContext();
    await signInBrowser(candidateContext, candidate);
    const candidatePage = await candidateContext.newPage();
    await candidatePage.goto(url);
    await expect(candidatePage).toHaveURL(/\/en\/dashboard\/worker$/);
    await expect(candidatePage.getByText("Ana Silva")).toHaveCount(0);
    await candidateContext.close();

    await logIn(page, company.owner, url);
    await expect(page).toHaveURL(/\/en\/mfa/);
    await expect(page.getByText("Ana Silva")).toHaveCount(0);

    const memberContext = await browser.newContext();
    await signInBrowser(memberContext, member);
    const memberPage = await memberContext.newPage();
    await memberPage.goto(url);
    await expect(memberPage.getByRole("link", { name: "Ana Silva" })).toBeVisible();
    await memberContext.close();
  });
});
