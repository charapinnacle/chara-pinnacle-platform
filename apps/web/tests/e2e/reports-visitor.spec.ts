import { expectAccessibleAtBothWidths, displayName } from "./support/applications";
import { literal, query } from "./support/db";
import { evidence } from "./support/evidence";
import { waitForHydration } from "./support/hydration";
import { newCompany, seedJob } from "./support/jobs";
import { alertText } from "./support/login-page";
import { DETAILS, fillReport, referenceOf, reportsOfJob, sendReport } from "./support/reports";
import { expect, test } from "./support/test";
import { uniqueTag } from "./support/admin";
import { publicUrl } from "./support/vacancy-page";

test.describe("reporting as a visitor", () => {
  test("FR-F4: a visitor reports a vacancy from its page and gets a reference number", async ({ page }) => {
    const company = await newCompany();
    const title = `Report welder ${uniqueTag()}`;
    const job = seedJob(company, { title, status: "open" });

    await page.goto(publicUrl(job));
    await page.getByRole("link", { name: "Report this vacancy" }).click();
    await expect(page).toHaveURL(`/en/report?type=job&job=${job}`);
    await expect(page.getByRole("heading", { name: "Report a vacancy", level: 1 })).toBeVisible();
    await expect(page.getByText(`${title}, ${displayName(company.id)}`)).toBeVisible();
    await expect(page.getByLabel("Address of the vacancy")).toHaveCount(0);
    await waitForHydration(page.getByLabel("What happened"));
    await expectAccessibleAtBothWidths(page);
    await evidence(page, "report-vacancy-form");

    await page.getByRole("button", { name: "Send report" }).click();
    const problem = alertText(page);
    await expect(problem).toBeVisible();
    await expect(problem.getByRole("link")).toHaveText(["Choose a category.", "Describe it in at least 20 characters.", "Confirm that you are reporting in good faith."]);
    await expectAccessibleAtBothWidths(page);

    await fillReport(page, { email: "Visitor.Reporter@Example.test" });
    await expect(page.getByText(`${DETAILS.length}/2000`)).toBeVisible();
    const reference = await sendReport(page);
    await evidence(page, "report-received-visitor");
    await expect(page.getByText("We do not email you about it")).toBeVisible();
    await expect(page.getByRole("link", { name: "See your reports" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    const [row] = reportsOfJob(job);
    expect(reference).toBe(referenceOf(row.id));
    expect(row).toMatchObject({
      target_type: "job",
      category: "fee_demanded_from_worker",
      details: DETAILS,
      reporter_user_id: null,
      reporter_email: "visitor.reporter@example.test",
      status: "new",
    });
    const [audit] = query<{ actor_id: string | null; metadata: Record<string, unknown> }>(
      `select actor_id, metadata from audit.log where action = 'report.submitted' and entity_id = ${literal(String(row.id))}`,
    );
    expect(audit.actor_id).toBeNull();
    expect(JSON.stringify(audit.metadata)).not.toContain("visitor.reporter");
    expect(JSON.stringify(audit.metadata)).not.toContain("fee before");
  });

  test("FR-F4: the same visitor reporting the same vacancy for the same reason again gets the first reference, and the company link reports the company", async ({ page }) => {
    const company = await newCompany();
    const job = seedJob(company, { title: `Twice ${uniqueTag()}`, status: "open" });

    await page.goto(`/en/report?type=job&job=${job}`);
    await fillReport(page, { email: "twice@example.test" });
    const first = await sendReport(page);

    await page.goto(`/en/report?type=job&job=${job}`);
    await fillReport(page, { email: "twice@example.test", details: "Another text, sent a minute later." });
    expect(await sendReport(page)).toBe(first);
    expect(reportsOfJob(job)).toHaveLength(1);

    await page.goto(publicUrl(job));
    await page.getByRole("link", { name: "Report this company" }).click();
    await expect(page.getByRole("heading", { name: "Report a company", level: 1 })).toBeVisible();
    await expect(page.getByText(displayName(company.id), { exact: true })).toBeVisible();
    await fillReport(page, { category: "illegal_content" });
    await sendReport(page);
    const rows = reportsOfJob(job);
    expect(rows.map((row) => [row.target_type, row.organization_id, row.category])).toEqual([
      ["job", null, "fee_demanded_from_worker"],
      ["company", company.id, "illegal_content"],
    ]);
  });

  test("FR-F4: the Trust & Safety page offers the four buttons, a pasted link names the vacancy and a vacancy that is not public is refused", async ({ page }) => {
    const company = await newCompany();
    const open = seedJob(company, { title: `Open ${uniqueTag()}`, status: "open" });
    const draft = seedJob(company, { title: `Draft ${uniqueTag()}`, status: "draft" });

    await page.goto("/en/trust-safety");
    await expect(page.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute("href", "/en/legal/terms-of-service");
    await expect(page.getByRole("link", { name: /^Report (job|company|profile|content)$/ })).toHaveText(["Report job", "Report company", "Report profile", "Report content"]);
    await evidence(page, "trust-safety-reporting");
    await expectAccessibleAtBothWidths(page);

    await page.getByRole("link", { name: "Report profile" }).click();
    await expect(page.getByRole("heading", { name: "Report a profile", level: 1 })).toBeVisible();
    await expect(page.getByText("Candidate profiles are private")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send report" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    await page.goto("/en/trust-safety");
    await page.getByRole("link", { name: "Report job" }).click();
    await expect(page).toHaveURL("/en/report?type=job");
    await expect(page.getByLabel("Address of the vacancy")).toBeVisible();
    await evidence(page, "report-job-by-link");
    await fillReport(page);
    await page.getByLabel("Address of the vacancy").fill("not a vacancy");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(alertText(page)).toContainText("Paste the address of a vacancy page on Chara Pinnacle.");

    await page.getByLabel("Address of the vacancy").fill(`http://localhost:3100/en/jobs/${draft}`);
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("This vacancy cannot be reported: it is not public.").first()).toBeVisible();
    expect(reportsOfJob(draft)).toHaveLength(0);

    await page.getByLabel("Address of the vacancy").fill(`http://localhost:3100/en/jobs/${open}?utm=mail`);
    await sendReport(page);
    expect(reportsOfJob(open).map((row) => row.target_type)).toEqual(["job"]);
  });

  test("FR-F4: a page of the site is reported by its address, with the keyboard", async ({ page }) => {
    await page.goto("/en/trust-safety");
    await page.getByRole("link", { name: "Report content" }).click();
    await expect(page.getByRole("heading", { name: "Report content", level: 1 })).toBeVisible();
    await fillReport(page, { category: "other", details: "The pricing page shows a text that is wrong." });
    await page.getByLabel("Address of the page").fill("https://chara.example/en/pricing?x=1");
    await page.getByLabel("Your email (optional)").fill("not an address");
    await page.getByLabel("Address of the page").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Enter a valid email address.").first()).toBeVisible();
    await page.getByLabel("Your email (optional)").fill("");
    const send = page.getByRole("button", { name: "Send report" });
    await send.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Your report was received" })).toBeVisible();
    const [row] = query<{ content_path: string; target_type: string }>(
      `select content_path, target_type::text from public.reports where details = 'The pricing page shows a text that is wrong.' order by id desc limit 1`,
    );
    expect(row).toEqual({ content_path: "/en/pricing", target_type: "content" });
  });

  test("FR-F4: the throttle of the visitor stops the eleventh report in an hour", async ({ page }) => {
    const company = await newCompany();
    const job = seedJob(company, { title: `Throttle ${uniqueTag()}`, status: "open" });
    for (let n = 1; n <= 10; n++) {
      await page.goto(`/en/report?type=job&job=${job}`);
      await fillReport(page, { details: `Report number ${n} of the same visitor, long enough.` });
      await sendReport(page);
    }
    await page.goto(`/en/report?type=job&job=${job}`);
    await fillReport(page, { details: "Report number 11 of the same visitor, too many." });
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(alertText(page)).toContainText("You have sent several reports in a short time. Try again in a while.");
    expect(reportsOfJob(job)).toHaveLength(10);
  });
});
