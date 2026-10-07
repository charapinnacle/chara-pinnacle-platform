import { readFileSync } from "node:fs";
import { applicantsUrl, listRows, seedListApplicant, seedMany, subscribe } from "./support/applicant-list";
import { execute, literal, query } from "./support/db";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { waitForHydration } from "./support/hydration";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

const header = "Candidate,Stage,Applied,Completeness (%),Documents";

function rename(jobId: string, number: number, first: string, last: string): void {
  execute(
    `update public.job_applications set profile_snapshot = profile_snapshot || jsonb_build_object('first_name', ${literal(first)}, 'last_name', ${literal(last)})
     where job_id = ${literal(jobId)} and profile_snapshot ->> 'last_name' = ${literal(String(number))}`,
  );
}

const exports = (jobId: string) =>
  query<{ actor_id: string; entity_type: string; metadata: Record<string, unknown> }>(
    `select actor_id, entity_type, metadata from audit.log where action = 'applicants_exported' and entity_id = ${literal(jobId)} order by id`,
  );

test.describe("the CSV export", () => {
  test("FR-E1 AC8: the filtered list downloads as a safe CSV of every row of the filter, without documents, and is audited", async ({ browser }) => {
    const company = await newCompany();
    subscribe(company, "employer_professional");
    const job = seedJob(company, { title: "Export welder", status: "open" });
    seedMany(company, job, 60, "case when ids.n % 5 = 0 then 'shortlisted' else 'applied' end");
    rename(job, 5, "=HYPERLINK('http://x')", "");
    rename(job, 10, "Smith,", "Jo");
    rename(job, 15, 'Jo "JJ"', "Smith");
    rename(job, 20, "Zoë", "Müller");
    const member = await addCompanyUser(company, "member");
    const context = await browser.newContext();
    await signInBrowser(context, member);
    const page = await context.newPage();

    await page.goto(applicantsUrl(company.slug, `?job=${job}&stage=shortlisted`));
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(12);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^applicants-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = readFileSync((await download.path()) as string, "utf8");
    const lines = text.split("\r\n");
    expect(lines.shift()).toBe(header);
    expect(lines.pop()).toBe("");
    expect(lines).toHaveLength(12);
    expect(lines[0]).toMatch(/^Cand 60,Shortlisted,2026-09-01,\d+,[0-3]$/);
    expect(lines.every((line) => line.includes(",Shortlisted,2026-09-01,"))).toBe(true);
    expect(text).toContain("\r\n'=HYPERLINK('http://x'),Shortlisted,");
    expect(text).toContain('\r\n"Smith, Jo",Shortlisted,');
    expect(text).toContain('\r\n"Jo ""JJ"" Smith",Shortlisted,');
    expect(text).toContain("\r\nZoë Müller,Shortlisted,");
    expect(text).not.toMatch(/,Applied,\d{4}-/);
    for (const row of query<{ id: string }>(`select jsonb_array_elements_text(scope) as id from public.passport_shares where organization_id = ${literal(company.id)}`)) {
      expect(text).not.toContain(row.id);
    }
    expect(text).not.toMatch(/\.pdf|storage|http:\/\/localhost/i);

    const [entry, ...others] = exports(job);
    expect(others).toEqual([]);
    expect(entry).toMatchObject({ actor_id: member.id, entity_type: "job", metadata: { organization_id: company.id, stage: "shortlisted", rows: 12 } });
    expect(JSON.stringify(entry.metadata)).not.toMatch(/Cand|Smith|Zoë|HYPERLINK/);

    await page.goto(applicantsUrl(company.slug, `?job=${job}`));
    const [all] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    expect(readFileSync((await all.path()) as string, "utf8").trim().split("\r\n")).toHaveLength(61);
    expect(exports(job).map((row) => row.metadata.rows)).toEqual([12, 60]);
    await context.close();
  });

  test("FR-E1 AC8, AC12: a forced export is refused for a lapsed organisation and for a vacancy of another organisation, and leaves no audit row", async ({ browser }) => {
    const lapsed = await newCompany();
    subscribe(lapsed, "employer_starter", "canceled");
    const other = await newCompany();
    const job = seedJob(lapsed, { title: "Lapsed export welder", status: "paused" });
    const foreign = seedJob(other, { title: "Foreign welder", status: "open" });
    const member = await addCompanyUser(lapsed, "member");
    const context = await browser.newContext();
    await signInBrowser(context, member);
    const url = `/en/org/${lapsed.slug}/applicants/export`;

    const refused = await context.request.post(url, { form: { job, stage: "" } });
    expect(refused.status()).toBe(403);
    expect(await refused.text()).not.toContain("Candidate,Stage");
    expect((await context.request.post(url, { form: { job: foreign, stage: "" } })).status()).toBe(404);
    expect((await context.request.post(url, { form: { job, stage: "hacked" } })).status()).toBe(404);
    expect((await context.request.post(url, { form: { job: "nope", stage: "" } })).status()).toBe(404);
    expect(exports(job)).toEqual([]);
    expect(exports(foreign)).toEqual([]);

    const page = await context.newPage();
    await page.goto(applicantsUrl(lapsed.slug, `?job=${job}`));
    await expect(page.getByRole("heading", { name: "No applications yet", level: 2 })).toBeVisible();
    await context.close();
  });
  test("FR-E1 AC8, AC12: a refusal after the page was loaded is a toast, the list stays on the screen and no file or audit row is made", async ({ browser }) => {
    const company = await newCompany();
    subscribe(company, "employer_professional");
    const job = seedJob(company, { title: "Toast export welder", status: "open" });
    seedListApplicant(company, job, { name: "Ana Silva", appliedAt: "2026-09-04T10:00:00Z", completeness: 80 });
    const member = await addCompanyUser(company, "member");
    const context = await browser.newContext();
    await signInBrowser(context, member);
    const page = await context.newPage();
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));

    await page.goto(applicantsUrl(company.slug, `?job=${job}`));
    const exportButton = page.getByRole("button", { name: "Export CSV" });
    await waitForHydration(exportButton);
    await expect(exportButton).toBeEnabled();
    execute(`update billing.subscriptions set status = 'canceled' where organization_id = ${literal(company.id)}`);
    await exportButton.click();

    await expect(page.getByText("The export failed", { exact: true })).toBeVisible();
    await expect(page.getByText("Your plan does not include the CSV export.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/applicants\\?job=${job}$`));
    await expect(listRows(page)).toHaveCount(1);
    await expect(exportButton).toBeEnabled();
    expect(downloads).toEqual([]);
    expect(exports(job)).toEqual([]);
    await context.close();
  });

  test("FR-E1 AC10: a visitor, a member of another organisation and an owner who has not done the two-step check are sent away and nothing is exported", async ({ browser }) => {
    const company = await newCompany();
    subscribe(company, "employer_professional");
    const job = seedJob(company, { title: "Guarded export welder", status: "open" });
    seedListApplicant(company, job, { name: "Ana Silva", appliedAt: "2026-09-04T10:00:00Z", completeness: 80 });
    const other = await newCompany();
    const outsider = await addCompanyUser(other, "member");
    const member = await addCompanyUser(company, "member");
    const path = `/en/org/${company.slug}/applicants/export`;
    const post = (context: Awaited<ReturnType<typeof browser.newContext>>) =>
      context.request.post(path, { form: { job, stage: "" }, maxRedirects: 0 });

    const visitor = await browser.newContext();
    const asVisitor = await post(visitor);
    expect(asVisitor.status()).toBe(303);
    expect(asVisitor.headers().location).toBe(`/en/login?next=${encodeURIComponent(path)}`);
    await visitor.close();

    const outsiderContext = await browser.newContext();
    await signInBrowser(outsiderContext, outsider);
    const asOutsider = await post(outsiderContext);
    expect(asOutsider.status()).toBe(404);
    expect(await asOutsider.text()).not.toContain("Candidate,Stage");
    await outsiderContext.close();

    const ownerContext = await browser.newContext();
    await signInBrowser(ownerContext, company.owner);
    const asOwner = await post(ownerContext);
    expect(asOwner.status()).toBe(303);
    expect(asOwner.headers().location).toBe(`/en/mfa?next=${encodeURIComponent(path)}`);
    await ownerContext.close();
    expect(exports(job)).toEqual([]);

    const memberContext = await browser.newContext();
    await signInBrowser(memberContext, member);
    const resumed = await memberContext.newPage();
    await resumed.goto(path);
    await expect(resumed).toHaveURL(new RegExp(`/en/org/${company.slug}/applicants$`));
    await expect(resumed.getByRole("heading", { name: "Applicants", level: 1 })).toBeVisible();
    await memberContext.close();
    expect(exports(job)).toEqual([]);
  });
});
