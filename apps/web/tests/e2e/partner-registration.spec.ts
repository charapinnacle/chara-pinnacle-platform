import type { Page } from "@playwright/test";
import { displayTitle } from "@/lib/validation/consents";
import { accountRows, confirmFromLink, userByEmail } from "./support/accounts";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { choose } from "./support/combobox";
import { literal, query } from "./support/db";
import { createGoogleUser, GOOGLE_ON_URL, issueAuthCode, startGoogleFlow } from "./support/google";
import { waitForHydration } from "./support/hydration";
import { checkEmailText } from "./support/login";
import { overflow } from "./support/login-page";
import { extractLinks, waitForMessage } from "./support/mailpit";
import { notificationsOf } from "./support/notify";
import { currentStep, onboardingSteps } from "./support/onboarding";
import { organizationAudit, organizationCountByName, organizationRows, uniqueToken } from "./support/organizations";
import {
  createCommittedPartner,
  DRAFT_NOTICE,
  openPartnerOnboarding,
  PARTNER_IDENTIFIER_LABEL,
  PARTNER_LABEL,
  partnerDocuments,
  setPartnerRelease,
  type PartnerType,
} from "./support/partners";
import { captureActionRequests } from "./support/server-action";
import { documentBox, EMPLOYER_LABEL, newEmail, PASSWORD, summary, WORKER_LABEL } from "./support/signup-page";
import { expect, test } from "./support/test";
import { createTestUser, deleteTestUser } from "./support/test-user";

const ACCOUNT_TYPE = "Account type";

function partnerProfile(userId: string) {
  return query<{ intended_organization_type: string | null; account_kind: string | null }>(
    `select intended_organization_type, account_kind from public.profiles where id = ${literal(userId)}`,
  )[0];
}

function partnerOrganization(userId: string) {
  return query<{ type: string; review_status: string | null; description: string | null }>(
    `select o.type, o.review_status, o.description from public.organizations o
     join public.organization_members m on m.organization_id = o.id where m.user_id = ${literal(userId)}`,
  );
}

async function fillPartnerSignup(page: Page, type: PartnerType, email: string): Promise<void> {
  await page.getByRole("radio", { name: PARTNER_LABEL[type] }).check();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  for (const { title } of await partnerDocuments(type)) await documentBox(page, title).check();
}

async function fillPartnerCompany(
  page: Page,
  details: { legalName: string; displayName?: string; identifier?: string; description?: string },
): Promise<void> {
  await page.getByLabel("Legal company name").fill(details.legalName);
  if (details.displayName) await page.getByLabel("Display name (optional)").fill(details.displayName);
  await choose(page, "Country where you are based", "Philippines");
  await choose(page, "Industry", "Administrative and support service activities");
  await page.getByLabel("Website (optional)").fill("https://manila-skills.example");
  if (details.identifier) {
    await page.getByLabel(PARTNER_IDENTIFIER_LABEL).fill(details.identifier);
    await page.getByLabel("Type of identifier", { exact: true }).selectOption({ value: "registration_number" });
  }
  if (details.description) await page.getByLabel("About your company (optional)").fill(details.description);
}

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// others (playwright.config.ts), and the tests run one after the other.
test.describe("partner registration (FR-J1)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("while release 2a is off, sign-up offers worker and employer only", async ({ page }) => {
    setPartnerRelease(false);
    try {
      await page.goto("/en/signup");
      const group = page.getByRole("radiogroup", { name: "I want to register as" });
      await expect(group.getByRole("radio")).toHaveCount(2);
      for (const label of Object.values(PARTNER_LABEL)) await expect(page.getByRole("radio", { name: label })).toHaveCount(0);
      await page.goto("/en/signup?kind=staffing_company");
      await expect(group.getByRole("radio", { checked: true })).toHaveCount(0);
    } finally {
      setPartnerRelease(true);
    }
  });

  test("AC2: four choices in order, moved through with the arrow keys, each with the documents of its type", async ({ page }) => {
    await page.goto("/en/signup");
    await waitForHydration(page.getByRole("button", { name: "Create account" }));
    const group = page.getByRole("radiogroup", { name: ACCOUNT_TYPE });
    await expect(group.getByRole("radio")).toHaveCount(4);
    const labels = [WORKER_LABEL, EMPLOYER_LABEL, PARTNER_LABEL.recruitment_company, PARTNER_LABEL.staffing_company];
    for (const [index, label] of labels.entries()) {
      await expect(group.locator('input[type="radio"]').nth(index)).toHaveAccessibleName(label);
    }
    await expect(group.getByRole("radio", { checked: true })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("radio", { name: WORKER_LABEL }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("radio", { name: WORKER_LABEL })).toBeChecked();
    await expect(page.getByText(DRAFT_NOTICE)).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: EMPLOYER_LABEL })).toBeChecked();
    await expect(page.getByText(DRAFT_NOTICE)).toHaveCount(0);

    const expected: Record<PartnerType, string[]> = {
      recruitment_company: ["Terms of Service", "Privacy Policy", "Partner Terms", "Recruitment Company Terms"],
      staffing_company: ["Terms of Service", "Privacy Policy", "Partner Terms", "Staffing Company Terms"],
    };
    for (const type of ["recruitment_company", "staffing_company"] as const) {
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("radio", { name: PARTNER_LABEL[type] })).toBeChecked();
      const documents = await partnerDocuments(type);
      expect(documents.map(({ title }) => displayTitle(title))).toEqual(expected[type]);
      await expect(page.getByRole("checkbox")).toHaveCount(4);
      for (const { slug, title } of documents) {
        await expect(documentBox(page, title)).not.toBeChecked();
        const link = page.locator(`a[href="/en/legal/${slug}"]`);
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", /noopener/);
      }
      await expect(page.getByRole("note").filter({ hasText: DRAFT_NOTICE })).toBeVisible();
      await expectNoAxeViolations(page);
    }
    await expect(page.locator('a[href="/en/legal/recruitment-company-terms"]')).toHaveCount(0);
  });

  test("AC1: a recruitment company signs up, confirms, enters the company and lands on Where you serve", async ({ page }) => {
    const email = newEmail();
    const token = uniqueToken();
    const display = `Manila Skills ${token}`;

    await page.goto("/en/signup");
    await fillPartnerSignup(page, "recruitment_company", email);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/en\/verify-email$/);

    const [user] = userByEmail(email);
    expect(partnerProfile(user.id)).toEqual({ intended_organization_type: "recruitment_company", account_kind: null });
    const message = await waitForMessage(email, { timeoutMs: 60_000 });
    const link = extractLinks(message).find((url) => url.includes("/en/confirm-email?token_hash="));
    if (!link) throw new Error("The confirmation email has no link");
    const { pathname, search } = new URL(link);
    await confirmFromLink(page, `${pathname}${search}`);

    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Tell us about your company", level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 1 of 5: Company");
    await expect(onboardingSteps(page)).toContainText("Where you serve");
    await expect(page.getByText("Company type: Recruitment company.")).toBeVisible();
    await fillPartnerCompany(page, {
      legalName: `Manila Skills Recruitment ${token} Inc.`,
      displayName: display,
      identifier: "CS 2019-04512",
      description: "We place nurses and caregivers.",
    });
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Next: Where you serve", level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 2 of 5: Where you serve");
    await expect(page.getByRole("status")).toContainText("This step is not open yet.");
    await expect(page.getByRole("link", { name: "Go to the home page" })).toBeVisible();
    await expect(page.getByText(/approved|verified/i)).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    expect(partnerProfile(user.id)).toEqual({ intended_organization_type: "recruitment_company", account_kind: "company" });
    const { consents } = accountRows(user.id);
    const documents = await partnerDocuments("recruitment_company");
    expect(consents.map((entry) => `${entry.purpose}:${entry.version}:${entry.action}`).sort()).toEqual(
      documents.map(({ slug, version }) => `${slug}:${version}:granted`).sort(),
    );
    const [organization] = organizationRows(user.id);
    expect(organization).toMatchObject({
      type: "recruitment_company",
      status: "active",
      slug: `manila-skills-${token}`,
      display_name: display,
      based_in_country: "PH",
      industry_code: "N",
      legal_entity_identifier: "CS201904512",
      legal_entity_identifier_kind: "registration_number",
      role: "owner",
    });
    expect(organization.accepted_at).not.toBeNull();
    expect(partnerOrganization(user.id)).toEqual([
      { type: "recruitment_company", review_status: "onboarding", description: "We place nurses and caregivers." },
    ]);
    expect(organizationAudit(organization.id).filter((row) => row.action === "organization_created")).toEqual([
      expect.objectContaining({ actor_id: user.id, metadata: expect.objectContaining({ type: "recruitment_company" }) }),
    ]);

    for (const path of ["/en/onboarding/security", "/en/onboarding/welcome", "/en/dashboard/employer"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/en\/onboarding$/);
    }
  });

  test("AC1 for the staffing type through Continue with Google, with the type chosen once on onboarding", async ({ page }) => {
    const user = await createGoogleUser();
    await page.goto(`${GOOGLE_ON_URL}/en/signup`);
    await expect(page.getByText("You choose your account type and accept the legal documents in the next step.")).toBeVisible();
    await page.goto(`${GOOGLE_ON_URL}/en/login`);
    const authorizeUrl = await startGoogleFlow(page);
    await page.goto(`${GOOGLE_ON_URL}/auth/callback?code=${issueAuthCode(user.id, authorizeUrl)}`);
    await expect(page).toHaveURL(/localhost:3100\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Choose your account type" })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(4);

    await page.getByRole("radio", { name: PARTNER_LABEL.staffing_company }).check();
    await expect(page.getByRole("note").filter({ hasText: DRAFT_NOTICE })).toBeVisible();
    const documents = await partnerDocuments("staffing_company");
    for (const { title } of documents) await documentBox(page, title).check();
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Create my account" }).click();

    await expect(page.getByRole("heading", { name: "Tell us about your company", level: 1 })).toBeVisible();
    await expect(page.getByText("Company type: Staffing company.")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    expect(partnerProfile(user.id)).toEqual({ intended_organization_type: "staffing_company", account_kind: "company" });
    expect(accountRows(user.id).consents.map((entry) => `${entry.purpose}:${entry.version}`).sort()).toEqual(
      documents.map(({ slug, version }) => `${slug}:${version}`).sort(),
    );

    const token = uniqueToken();
    await fillPartnerCompany(page, { legalName: `Google Staffing ${token} Inc.`, identifier: `GS${token}` });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Next: Where you serve", level: 1 })).toBeVisible();
    expect(partnerOrganization(user.id)).toEqual([{ type: "staffing_company", review_status: "onboarding", description: null }]);
  });

  test("AC6: a staffing sign-up with a registered address looks like one with a new address", async ({ page, context }) => {
    const existing = await createTestUser("worker");
    const fresh = newEmail();
    try {
      const calls = captureActionRequests(page);
      const answers: { text: string; milliseconds: number }[] = [];
      for (const email of [existing.email, fresh]) {
        await page.goto("/en/signup");
        await fillPartnerSignup(page, "staffing_company", email);
        const started = Date.now();
        await page.getByRole("button", { name: "Create account" }).click();
        await expect(page).toHaveURL(/\/en\/verify-email$/);
        await expect(page.getByText(/^We have sent an email to /)).toBeVisible();
        answers.push({ text: await checkEmailText(page), milliseconds: Date.now() - started });
      }
      expect(calls[1].status()).toBe(calls[0].status());
      expect(answers[0].text).toBe(answers[1].text);
      expect(Math.abs(answers[0].milliseconds - answers[1].milliseconds)).toBeLessThan(1_500);
      expect(notificationsOf(existing.id).map((row) => [row.kind, row.status])).toEqual([["account_exists", "queued"]]);
      expect(userByEmail(existing.email)).toHaveLength(1);
      expect(partnerProfile(existing.id)).toEqual({ intended_organization_type: null, account_kind: null });
      expect(partnerProfile(userByEmail(fresh)[0].id).intended_organization_type).toBe("staffing_company");
      expect((await context.cookies()).filter((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name))).toEqual([]);
    } finally {
      await deleteTestUser(existing.id);
    }
  });

  test("AC12: the identifier is required, the type cannot be changed, and the form passes axe at 360 and 1280 px", async ({ page }) => {
    const user = await createCommittedPartner("recruitment_company");
    await openPartnerOnboarding(page, user);
    await expect(page.getByRole("heading", { name: "Tell us about your company", level: 1 })).toBeVisible();
    const calls = captureActionRequests(page);

    for (const label of ["Legal company name", "Display name (optional)", "Website (optional)", PARTNER_IDENTIFIER_LABEL]) {
      await expect(page.getByRole("textbox", { name: label, exact: true })).toBeVisible();
    }
    for (const label of ["Country where you are based", "Industry"]) {
      await expect(page.getByRole("combobox", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: /type of (company|organisation|organization)/i })).toHaveCount(0);
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectNoAxeViolations(page);
    }

    const legalName = `Required Id ${uniqueToken()} Ltd`;
    await fillPartnerCompany(page, { legalName });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(summary(page)).toBeFocused();
    const message = "Enter the registration number, VAT number or other identifier of your company.";
    await expect(summary(page).getByRole("link", { name: message })).toBeVisible();
    await expectNoAxeViolations(page);
    await summary(page).getByRole("link", { name: message }).click();
    await expect(page.getByLabel(PARTNER_IDENTIFIER_LABEL)).toBeFocused();
    expect(calls).toHaveLength(0);

    // A Continue while the database refuses the partner type (release 2a switched off meanwhile): a toast, values kept.
    await page.getByLabel(PARTNER_IDENTIFIER_LABEL).fill("RQ 12345");
    await page.getByLabel("Type of identifier", { exact: true }).selectOption({ value: "registration_number" });
    setPartnerRelease(false);
    try {
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Could not create the company", { exact: true })).toBeVisible();
      await expect(summary(page)).toContainText("Registration for recruitment and staffing companies is not open at the moment.");
    } finally {
      setPartnerRelease(true);
    }
    await expect(page.getByLabel("Legal company name")).toHaveValue(legalName);
    await expect(page.getByLabel(PARTNER_IDENTIFIER_LABEL)).toHaveValue("RQ 12345");
    expect(organizationCountByName(legalName)).toBe(0);

    // A double click on Continue while the request is pending creates one organisation.
    await page.route("**/en/onboarding", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.getByRole("button", { name: "Continue" }).dblclick();
    await expect(page.getByRole("button", { name: "Creating company..." })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Next: Where you serve", level: 1 })).toBeVisible();
    expect(organizationCountByName(legalName)).toBe(1);
    expect(partnerOrganization(user.id)).toEqual([{ type: "recruitment_company", review_status: "onboarding", description: null }]);
  });
});
