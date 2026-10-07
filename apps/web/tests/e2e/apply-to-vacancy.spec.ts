import { expectNoAxeViolations } from "./support/axe";
import {
  applicationRows,
  applicationUrl,
  APPLICATIONS_URL,
  applyUrl,
  auditCount,
  consentOf,
  displayName,
  eventRows,
  expectAccessibleAtBothWidths,
  newApplicant,
  NOT_ACCEPTING,
  pauseVacancies,
  queuedForApplication,
  seedApplication,
  shareOf,
} from "./support/applications";
import { seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { logIn, overflow } from "./support/login-page";
import { expect, test } from "./support/test";
import { publicUrl } from "./support/vacancy-page";

const CONSENT_LABEL = (employer: string) => `I agree to share the selected documents with ${employer} for this application`;

const today = () =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date());

test.describe("apply to a vacancy", () => {
  test("FR-D1 AC1: a candidate applies with a note, one document and the consent, and finds the application in the list", async ({
    page,
  }) => {
    const company = await newCompany();
    const employer = displayName(company.id);
    const jobId = seedJob(company, { title: "Welder", status: "open" });
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const cv = await seedDocument(candidate.id, { title: "CV.pdf" });
    const certificate = await seedDocument(candidate.id, { title: "Certificate.pdf", type: "certificate" });
    const note = "A".repeat(200);

    await logIn(page, candidate, publicUrl(jobId));
    await page.getByRole("link", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(applyUrl(jobId));
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    await page.getByLabel("Cover note (optional)").fill(note);
    await expect(page.getByText("200/2000")).toBeVisible();
    await page.getByLabel("CV.pdf").check();
    await page.getByLabel(CONSENT_LABEL(employer)).check();
    await page.getByRole("button", { name: "Submit application" }).click();

    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Welder", level: 1 })).toBeVisible();
    await expect(page.locator("dd").filter({ hasText: /^Applied$/ })).toBeVisible();
    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline.getByRole("listitem")).toHaveCount(1);
    await expect(timeline.getByRole("listitem")).toContainText(`Applied ${today()}`);
    await expect(page.getByText(note)).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    const [application] = applicationRows(candidate.id);
    expect(application).toMatchObject({ status: "applied", cover_note: note, job_id: jobId, organization_id: company.id });
    expect(page.url()).toContain(application.id);
    const [share] = shareOf(application.id);
    expect(share).toMatchObject({ organization_id: company.id, scope: [cv.id], expires_at: null, revoked_at: null });
    expect(share.scope).not.toContain(certificate.id);
    const [consent] = consentOf(share.consent_id);
    expect(consent).toMatchObject({ user_id: candidate.id, purpose: `share_passport:${company.id}`, action: "granted" });
    expect(eventRows(application.id)).toEqual([
      { from_status: null, to_status: "applied", actor_id: candidate.id, note: null, created_at: expect.any(String) },
    ]);
    expect(auditCount("application.submitted", application.id)).toBe(1);
    expect(queuedForApplication(application.id).map(({ user_id }) => user_id).sort()).toEqual([company.owner.id, member.id].sort());

    await page.goto("/en/dashboard/worker");
    await page.getByRole("link", { name: "My applications" }).click();
    await expect(page).toHaveURL(APPLICATIONS_URL);
    await expect(page.getByRole("heading", { name: "My applications", level: 1 })).toBeVisible();
    const row = page.locator("ul > li").filter({ hasText: "Welder" });
    await expect(row).toContainText("Applied");
    await expect(row).toContainText(employer);
    await expect(row.getByRole("link", { name: "Welder" })).toHaveAttribute("href", applicationUrl(application.id));
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-D1 AC1: the list pages by twenty, and a long title wraps at 360 px", async ({ page }) => {
    const company = await newCompany();
    const candidate = await newApplicant();
    const longTitle = `Senior ${"x".repeat(70)} welder`;
    for (let n = 0; n < 21; n += 1) {
      const jobId = seedJob(company, { title: n === 0 ? longTitle : `Listed welder ${n}`, status: "open" });
      seedApplication(candidate.id, jobId, company.id, { createdAt: `now() - interval '${n + 1} minutes'` });
    }

    await logIn(page, candidate, APPLICATIONS_URL);
    await expect(page.locator("ul > li")).toHaveCount(20);
    await expect(page.locator("ul > li").first()).toContainText(longTitle);
    await expectAccessibleAtBothWidths(page);
    await page.getByRole("link", { name: "Next page" }).click();
    await expect(page).toHaveURL(/\/en\/applications\?cursor=/);
    await expect(page.locator("ul > li")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Next page" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.getByRole("link", { name: "Back to the first page" }).click();
    await expect(page).toHaveURL(APPLICATIONS_URL);
    await expect(page.locator("ul > li")).toHaveCount(20);
  });

  test("FR-D1 AC7: a visitor who presses Apply logs in and lands on the apply form of that vacancy", async ({ page }) => {
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Login welder", status: "open" });
    const candidate = await newApplicant();

    await page.goto(publicUrl(jobId));
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(applyUrl(jobId))}`);
    await page.getByLabel("Email", { exact: true }).fill(candidate.email);
    await page.getByLabel("Password", { exact: true }).fill(candidate.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(applyUrl(jobId));
    await expect(page.getByRole("heading", { name: "Apply for Login welder", level: 1 })).toBeVisible();

    await page.context().clearCookies();
    await page.goto(applyUrl(jobId));
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(applyUrl(jobId))}`);
    for (const hostile of ["//evil.example", "https://evil.example"]) {
      await page.context().clearCookies();
      await logIn(page, candidate, hostile);
      await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    }
  });

  test("FR-D1 AC6: a company user gets the not-found page of the apply address and nothing is created", async ({ page }) => {
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Company view welder", status: "open" });
    const member = await addCompanyUser(company, "member");
    await logIn(page, member);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto(applyUrl(jobId));
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByLabel("Cover note (optional)")).toHaveCount(0);
  });

  test("FR-D1 AC11: the notice, the field order and the labels, with documents and without, by keyboard", async ({ page }) => {
    const company = await newCompany();
    const employer = displayName(company.id);
    const jobId = seedJob(company, { title: "Form welder", status: "open" });
    const withDocuments = await newApplicant();
    await seedDocument(withDocuments.id, { title: "CV.pdf" });
    await seedDocument(withDocuments.id, { title: "Certificate.pdf", type: "certificate" });
    const without = await newApplicant();
    const notice = "Cross-border hiring can be subject to legal requirements";

    await page.setViewportSize({ width: 1280, height: 900 });
    await logIn(page, withDocuments, applyUrl(jobId));
    await expect(page).toHaveURL(applyUrl(jobId));
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    await expect(page.getByText("0/2000")).toBeVisible();
    const submit = page.getByRole("button", { name: "Submit application" });
    await expect(page.getByText(notice)).toBeVisible();
    const noticeBox = (await page.getByText(notice).boundingBox())!;
    expect(noticeBox.y).toBeLessThan((await submit.boundingBox())!.y);
    await expectNoAxeViolations(page);

    await page.getByLabel("Cover note (optional)").focus();
    const order: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      order.push(
        await page.evaluate(() => {
          const element = document.activeElement as HTMLElement;
          return element.matches("textarea")
            ? "note"
            : element.matches("[type=checkbox]")
              ? `checkbox:${document.querySelector(`label[for="${element.id}"]`)?.textContent}`
              : `button:${element.textContent}`;
        }),
      );
      await page.keyboard.press("Tab");
    }
    expect(order.slice(0, 4)).toEqual(["note", expect.stringMatching(/^checkbox:(CV|Certificate)\.pdf$/), expect.stringMatching(/^checkbox:(CV|Certificate)\.pdf$/), `checkbox:${CONSENT_LABEL(employer)}`]);
    expect(order[4]).toBe("button:Submit application");
    expect(new Set(order.slice(1, 3))).toEqual(new Set(["checkbox:CV.pdf", "checkbox:Certificate.pdf"]));

    await page.setViewportSize({ width: 360, height: 800 });
    await page.reload();
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);

    await page.context().clearCookies();
    await logIn(page, without, applyUrl(jobId));
    await expect(page).toHaveURL(applyUrl(jobId));
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    await expect(page.getByText("You have no documents yet. You can still apply, or add documents first")).toBeVisible();
    await expect(page.getByRole("link", { name: "add documents first" })).toHaveAttribute("href", "/en/passport#documents");
    await expect(page.getByText(notice)).toBeVisible();
    await expect(submit).toBeEnabled();
    await expectNoAxeViolations(page);
  });

  test("FR-D1 AC12: the button says Submitting while the call runs, and an unticked consent is refused with the form kept", async ({
    page,
  }) => {
    const company = await newCompany();
    const employer = displayName(company.id);
    const jobId = seedJob(company, { title: "Pending welder", status: "open" });
    const candidate = await newApplicant();
    await seedDocument(candidate.id, { title: "CV.pdf" });

    await logIn(page, candidate, applyUrl(jobId));
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    const submit = page.getByRole("button", { name: "Submit application" });
    await page.getByLabel("Cover note (optional)").fill("My note");
    await page.getByLabel("CV.pdf").check();
    await submit.click();
    const summary = page.getByRole("alert").filter({ hasText: "There is a problem" });
    await expect(summary).toContainText("Confirm that you agree to share the selected documents");
    expect(applicationRows(candidate.id)).toEqual([]);
    await expect(page.getByLabel("Cover note (optional)")).toHaveValue("My note");
    await expect(page.getByLabel("CV.pdf")).toBeChecked();

    await page.route(`**${applyUrl(jobId)}`, async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.getByLabel(CONSENT_LABEL(employer)).check();
    await submit.click();
    const busy = page.getByRole("button", { name: "Submitting" });
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();
    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}$/);
  });

  test("FR-D1 AC12: a vacancy paused after the form was opened shows the message with a link to the search and creates nothing", async ({
    page,
  }) => {
    const company = await newCompany();
    const employer = displayName(company.id);
    const jobId = seedJob(company, { title: "Paused welder", status: "open" });
    const candidate = await newApplicant();

    await logIn(page, candidate, applyUrl(jobId));
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    pauseVacancies(company.id);
    await page.getByLabel(CONSENT_LABEL(employer)).check();
    await page.getByRole("button", { name: "Submit application" }).click();
    const alert = page.getByRole("alert").filter({ hasText: NOT_ACCEPTING });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("link", { name: "Find vacancies" })).toHaveAttribute("href", "/en/jobs");
    expect(applicationRows(candidate.id)).toEqual([]);
    await expectAccessibleAtBothWidths(page);

    await page.goto(applyUrl(jobId));
    await expect(page.getByRole("alert").filter({ hasText: NOT_ACCEPTING })).toBeVisible();
    await expect(page.getByLabel("Cover note (optional)")).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-C2 AC6, FR-C7: the apply address shows the same message for a draft, closed, hidden, suspended and unknown vacancy", async ({
    page,
  }) => {
    const company = await newCompany();
    const candidate = await newApplicant();
    const ids = [
      seedJob(company, { title: "Draft welder", status: "draft" }),
      seedJob(company, { title: "Closed welder", status: "closed" }),
      seedJob(company, { title: "Filled welder", status: "filled" }),
      seedJob(company, { title: "Hidden welder", status: "open", moderation: "hidden" }),
      seedJob(company, { title: "Suspended welder", status: "open", moderation: "org_suspended" }),
      "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11",
      "not-a-vacancy",
    ];
    await logIn(page, candidate);
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    for (const id of ids) {
      await page.goto(applyUrl(id));
      await expect(page.getByRole("alert").filter({ hasText: NOT_ACCEPTING }), id).toBeVisible();
      await expect(page.getByLabel("Cover note (optional)"), id).toHaveCount(0);
      await expect(page.getByText("welder", { exact: false }), id).toHaveCount(0);
    }
    expect(applicationRows(candidate.id)).toEqual([]);
  });

  test("FR-D1 AC12: an incomplete passport lists the missing field as a link to its section and cannot be submitted", async ({ page }) => {
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Incomplete welder", status: "open" });
    const candidate = await newApplicant({ occupation: false });

    await logIn(page, candidate, applyUrl(jobId));
    await expect(page.getByRole("heading", { name: "Apply for Incomplete welder", level: 1 })).toBeVisible();
    const alert = page.getByRole("alert").filter({ hasText: "Complete your passport before you apply" });
    await expect(alert.getByRole("link", { name: "Occupation" })).toHaveAttribute("href", "/en/passport#occupation");
    await expect(page.getByRole("button", { name: "Submit application" })).toHaveCount(0);
    await expect(page.getByLabel("Cover note (optional)")).toHaveCount(0);
    expect(applicationRows(candidate.id)).toEqual([]);
    await expectAccessibleAtBothWidths(page);

    await alert.getByRole("link", { name: "Occupation" }).click();
    await expect(page).toHaveURL("/en/passport#occupation");
  });

  test("FR-D1: the application page of another candidate, an unknown id and an address that is no id show the not-found page", async ({
    page,
  }) => {
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Private welder", status: "open" });
    const owner = await newApplicant();
    const stranger = await newApplicant();
    const id = seedApplication(owner.id, jobId, company.id);

    await logIn(page, stranger);
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    for (const path of [applicationUrl(id), applicationUrl("6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11"), applicationUrl("nope")]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Page not found" }), path).toBeVisible();
      await expect(page.getByText("Private welder"), path).toHaveCount(0);
    }
    await page.goto(APPLICATIONS_URL);
    await expect(page.getByRole("heading", { name: "You have not applied to any vacancy yet", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find vacancies" })).toHaveAttribute("href", "/en/jobs");
    await expect(page.getByText("Private welder")).toHaveCount(0);
  });

  test("FR-D1: the application list and page are for candidates: a visitor is sent to log in, a company user to the employer dashboard", async ({
    page,
  }) => {
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Guarded welder", status: "open" });
    const candidate = await newApplicant();
    const id = seedApplication(candidate.id, jobId, company.id);

    for (const path of [APPLICATIONS_URL, applicationUrl(id)]) {
      await page.goto(path);
      await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(path)}`);
    }
    const member = await addCompanyUser(company, "member");
    await logIn(page, member);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    for (const path of [APPLICATIONS_URL, applicationUrl(id)]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
      await expect(page.getByText("Guarded welder")).toHaveCount(0);
    }
  });
});
