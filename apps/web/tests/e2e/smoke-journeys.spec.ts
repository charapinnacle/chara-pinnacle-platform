import type { Page } from "@playwright/test";
import { confirmFromLink, userByEmail } from "./support/accounts";
import { signInStaff } from "./support/admin";
import { applicantUrl, chooseStage, seedNamedApplication, stageValue, statusMessages } from "./support/applicants";
import { mainNavigation } from "./support/app-shell";
import { applicationRows, newApplicant, queuedForApplication } from "./support/applications";
import {
  billingPath,
  checkoutPath,
  expectPlan,
  fillCheckout,
  HOSTED_ORIGIN,
  NO_PAYMENT,
  proceed,
  startTrialThroughWebhook,
  stubHostedPages,
  terms,
  uniqueIdentifiers,
} from "./support/billing";
import { choose } from "./support/combobox";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, fillJob, jobRows, newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { extractLinks, waitForMessage } from "./support/mailpit";
import { beginSetup, enterCode } from "./support/mfa";
import { fillCompany, organizationRows, uniqueName, uniqueToken } from "./support/organizations";
import { fillSignup, newEmail, PASSWORD } from "./support/signup-page";
import { newTeam, newVisitor } from "./support/team";
import { expect, test } from "./support/test";

// NFR-O3: the five main journeys of Phase 1 from the first click to the stored result, in the normal browser run. Each one
// goes through the real pages; the database is read only to check what the journey left behind.

async function signUpAndConfirm(page: Page, kind: "worker" | "company", email: string): Promise<void> {
  await page.goto("/en/signup");
  await fillSignup(page, { kind, email, password: PASSWORD });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/en\/verify-email$/);
  const link = extractLinks(await waitForMessage(email, { timeoutMs: 60_000 })).find((url) => url.includes("/en/confirm-email?token_hash="));
  if (!link) throw new Error("The confirmation email has no link");
  const { pathname, search } = new URL(link);
  await confirmFromLink(page, `${pathname}${search}`);
  await expect(page).toHaveURL(/\/en\/onboarding$/);
}

test.describe("smoke: the five main journeys end to end", () => {
  test("a worker signs up, builds the passport, finds a vacancy and applies", async ({ page }) => {
    const company = await newCompany();
    const marker = `smoke${uniqueToken()}`;
    const title = `Welder ${marker}`;
    const jobId = seedJob(company, { title, status: "open" });
    const email = newEmail();

    await signUpAndConfirm(page, "worker", email);
    await page.getByLabel("First name", { exact: true }).fill("Amina");
    await page.getByLabel("Last name", { exact: true }).fill("Okafor");
    await choose(page, "Current country", "Nigeria");
    await page.getByRole("button", { name: "Create CHARA Passport" }).click();
    await expect(page).toHaveURL(/\/en\/onboarding\/welcome$/);

    await page.getByRole("link", { name: /^Complete your passport/ }).click();
    await expect(page).toHaveURL(/\/en\/passport$/);
    const occupation = page.getByRole("combobox", { name: "Occupation", exact: true });
    await waitForHydration(occupation);
    await occupation.fill("welders and flame");
    await page.getByRole("option", { name: /Welders and flame cutters/ }).click();
    await page.getByRole("button", { name: "Save occupation" }).click();
    await expect(page.getByText("Your occupation was saved", { exact: true })).toBeVisible();

    await mainNavigation(page).getByRole("link", { name: "Find jobs" }).click();
    await waitForHydration(page.getByLabel("Keyword", { exact: true }));
    await page.getByLabel("Keyword", { exact: true }).fill(marker);
    await page.getByRole("button", { name: "Search jobs" }).click();
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(`/en/jobs/${jobId}`);
    await page.getByRole("link", { name: /^Apply now/ }).click();
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    await page.getByLabel("Cover note (optional)").fill("Six years of MIG welding.");
    await page.getByLabel(/I agree to share the selected documents with/).check();
    await page.getByRole("button", { name: "Submit application" }).click();

    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    const [user] = userByEmail(email);
    const [application, ...others] = applicationRows(user.id);
    expect(others).toEqual([]);
    expect(application).toMatchObject({ job_id: jobId, status: "applied", cover_note: "Six years of MIG welding." });
    expect(queuedForApplication(application.id)).toEqual([{ kind: "application_received", user_id: company.owner.id }]);
  });

  test("an employer registers, sets up two-step verification and publishes a vacancy the public can open", async ({ page, browser }) => {
    const email = newEmail();
    const display = uniqueName("Smoke Bau");
    const title = `Crane operator ${uniqueToken()}`;

    await signUpAndConfirm(page, "company", email);
    await fillCompany(page, { legalName: `${display} GmbH`, displayName: display, country: "Germany", industry: "Construction" });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/en\/onboarding\/security$/);
    await enterCode(page, await beginSetup(page));
    await expect(page).toHaveURL(/\/en\/onboarding\/welcome$/);

    await page.getByRole("link", { name: /^Post your first job/ }).click();
    await waitForHydration(page.getByLabel("Title", { exact: true }));
    await fillJob(page, { title });
    await page.getByRole("button", { name: "Save vacancy" }).click();
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("The vacancy is published", { exact: true })).toBeVisible();

    const [user] = userByEmail(email);
    const [organization] = organizationRows(user.id);
    expect(organization).toMatchObject({ display_name: display, role: "owner", status: "active" });
    const [job] = jobRows(organization.id);
    expect(job).toMatchObject({ title, status: "open", created_by: user.id });
    const visitor = await newVisitor(browser);
    expect((await visitor.page.goto(`/en/jobs/${job.id}`))?.status()).toBe(200);
    await expect(visitor.page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await visitor.context.close();
  });

  test("a member moves an applicant to Interview and the candidate's email is queued", async ({ page }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Smoke stage welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, jobId, company, "shortlisted");

    await logIn(page, member);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await mainNavigation(page).getByRole("link", { name: "Applicants" }).click();
    await page.getByRole("link", { name: "Ana Silva" }).first().click();
    await expect(page).toHaveURL(applicantUrl(company.slug, applicationId));
    await chooseStage(page, "Interview", "Please come on Monday.");
    await page.getByRole("dialog", { name: "Change stage" }).getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText("Stage changed to Interview", { exact: true })).toBeVisible();
    await expect(stageValue(page)).toHaveText("Interview");
    expect(statusMessages(applicationId)).toEqual([{ user_id: candidate.id, status: "interview", note: null }]);
  });

  test("an owner opens the billing page with the two-step code, starts the trial through the hosted page and sees Basic on trial", async ({ page }) => {
    const team = await newTeam(uniqueName("Smoke Billing"));
    await stubHostedPages(page);

    await logIn(page, team.owner);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await mainNavigation(page).getByRole("link", { name: "Billing" }).click();
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent(billingPath(team.slug))}`);
    await enterCode(page, team.ownerSecret);
    await expect(page).toHaveURL(billingPath(team.slug));
    await expect(page.getByText(NO_PAYMENT)).toBeVisible();
    await page.getByRole("link", { name: "Start 30-day free trial of Basic" }).click();
    await expect(page).toHaveURL(checkoutPath(team.slug));
    await fillCheckout(page, uniqueIdentifiers());
    await terms(page).check();
    await proceed(page).click();
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/`));

    await startTrialThroughWebhook(team);
    await page.goto(billingPath(team.slug));
    await expectPlan(page, "Basic", "Trial");
  });

  test("a platform administrator opens the console and finds an organisation", async ({ page }) => {
    const display = uniqueName("Smoke Admin Org");
    const team = await newTeam(display);
    await signInStaff(page, "admin");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

    await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Organisations" }).click();
    const search = page.getByLabel("Search organisations", { exact: true });
    await waitForHydration(search);
    await search.fill(display);
    await search.press("Enter");
    await page.getByRole("link", { name: display }).click();
    await expect(page).toHaveURL(`/en/admin/organizations/${team.id}`);
    await expect(page.getByRole("heading", { name: display, level: 1 })).toBeVisible();
  });
});
