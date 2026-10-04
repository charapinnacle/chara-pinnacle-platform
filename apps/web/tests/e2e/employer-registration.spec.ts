import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { accountRows, callAs, confirmFromLink, currentDocuments } from "./support/accounts";
import { createCommittedUser, enrollTotp, sessionClaims } from "./support/login";
import { logIn } from "./support/login-page";
import { extractLinks, waitForMessage } from "./support/mailpit";
import {
  fillCompany,
  organizationAudit,
  organizationCountByName,
  organizationRows,
} from "./support/organizations";
import { captureActionRequests } from "./support/server-action";
import type { TestUser } from "./support/test-user";
import {
  ageBox,
  documentBox,
  EMPLOYER_LABEL,
  fillSignup,
  newEmail,
  PASSWORD,
  summary,
} from "./support/signup-page";
import { userByEmail } from "./support/accounts";

function uniqueToken(): string {
  return randomBytes(4).toString("hex");
}

function uniqueName(prefix: string): string {
  return `${prefix} ${uniqueToken()}`;
}

async function signIn(page: Page, user: TestUser): Promise<void> {
  await logIn(page, user);
  await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
}

test.describe("employer registration", () => {
  test("FR-A2 AC1: an employer signs up, confirms, enters the company details and lands on two-step setup", async ({
    page,
  }) => {
    const email = newEmail();
    const token = uniqueToken();
    const display = `Acme Bau ${token}`;

    await page.goto("/en/signup");
    await page.getByRole("radio", { name: EMPLOYER_LABEL }).check();
    await expect(ageBox(page)).toHaveCount(0);
    for (const { slug, title } of await currentDocuments("company")) {
      await expect(documentBox(page, title), slug).toBeVisible();
    }
    await fillSignup(page, { kind: "company", email, password: PASSWORD });
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/en\/verify-email$/);

    const message = await waitForMessage(email, { timeoutMs: 60_000 });
    const link = extractLinks(message).find((url) => url.includes("/en/confirm-email?token_hash="));
    if (!link) throw new Error("The confirmation email has no link");
    const { pathname, search } = new URL(link);
    await confirmFromLink(page, `${pathname}${search}`);

    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Your account type is Employer" })).toBeVisible();
    await expect(page.getByLabel("Legal company name")).toBeVisible();
    await fillCompany(page, {
      legalName: `${display} GmbH`,
      displayName: display,
      country: "Germany",
      industry: "Construction",
      website: "https://acme-bau.example",
      identifierKind: "vat_number",
      identifier: "DE 123.456-789",
    });
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(page).toHaveURL(/\/en\/mfa$/);

    const [user] = userByEmail(email);
    const { account, consents } = accountRows(user.id);
    expect(account.account_kind).toBe("company");
    expect(consents.map((entry) => `${entry.purpose}:${entry.action}`).sort()).toEqual([
      "employer-terms:granted",
      "privacy-policy:granted",
      "terms-of-service:granted",
    ]);
    const organizations = organizationRows(user.id);
    expect(organizations).toHaveLength(1);
    expect(organizations[0]).toMatchObject({
      type: "employer",
      slug: `acme-bau-${token}`,
      status: "active",
      legal_name: `${display} GmbH`,
      display_name: display,
      based_in_country: "DE",
      industry_code: "F",
      website: "https://acme-bau.example",
      legal_entity_identifier: "DE123456789",
      legal_entity_identifier_kind: "vat_number",
      role: "owner",
      invited_by: null,
    });
    expect(organizations[0].accepted_at).not.toBeNull();
    const audit = organizationAudit(organizations[0].id);
    expect(audit.filter((row) => row.action === "organization_created")).toEqual([
      {
        actor_id: user.id,
        action: "organization_created",
        entity_type: "organization",
        metadata: {
          slug: `acme-bau-${token}`,
          type: "employer",
          duplicate_legal_name: false,
          legal_entity_trial_used: false,
        },
      },
    ]);
  });

  test("FR-A2 AC5: a legal name already in use is warned about and the organization is still created", async ({
    page,
  }) => {
    const legalName = uniqueName("Twin Bau GmbH");
    const first = await createCommittedUser("company");
    await callAs(first, "create_organization", {
      p_type: "employer",
      p_legal_name: legalName,
      p_display_name: "Twin Bau",
      p_based_in_country: "DE",
      p_industry_code: "F",
    });
    const second = await createCommittedUser("company");
    await signIn(page, second);
    await page.goto("/en/onboarding");
    await fillCompany(page, { legalName: legalName.toUpperCase().replace(" ", "   "), country: "Germany", industry: "Construction" });
    await page.getByRole("button", { name: "Create company" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Another company on CHARA uses the same legal name" })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(organizationCountByName(legalName)).toBe(1);
    const [organization] = organizationRows(second.id);
    expect(organization.role).toBe("owner");
    expect(organizationAudit(organization.id)[0].metadata).toMatchObject({ duplicate_legal_name: true });
    await page.getByRole("link", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/en\/mfa$/);
  });

  test("FR-A2 AC3: the form names each invalid field, moves focus to the summary and sends nothing until it is valid", async ({
    page,
  }) => {
    const user = await createCommittedUser("company");
    await signIn(page, user);
    await page.goto("/en/onboarding");
    const calls = captureActionRequests(page);

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await expectNoAxeViolations(page);
    }

    await page.getByRole("button", { name: "Create company" }).click();
    await expect(summary(page)).toBeFocused();
    for (const message of [
      "Legal name must be at least 2 characters.",
      "Choose the country of your company.",
      "Choose the industry of your company.",
    ]) {
      await expect(summary(page).getByRole("link", { name: message })).toBeVisible();
    }
    await expectNoAxeViolations(page);
    await summary(page).getByRole("link", { name: "Choose the country of your company." }).click();
    await expect(page.getByLabel("Country", { exact: true })).toBeFocused();

    await fillCompany(page, {
      legalName: "Valid Name GmbH",
      country: "Germany",
      industry: "Construction",
      website: "ftp://x.example",
      identifier: "x1",
    });
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(summary(page)).toBeFocused();
    for (const message of [
      "Enter a web address that starts with http:// or https://.",
      "Choose the type of identifier.",
      "Enter 4 to 32 letters or digits; spaces, dots, hyphens and slashes are ignored.",
    ]) {
      await expect(summary(page).getByRole("link", { name: message })).toBeVisible();
    }
    expect(calls).toHaveLength(0);
    expect(organizationRows(user.id)).toEqual([]);
  });

  test("FR-A2 AC1: while the request is pending the button says so and a double click creates one organization", async ({
    page,
  }) => {
    const user = await createCommittedUser("company");
    const legalName = uniqueName("Pending Bau GmbH");
    await signIn(page, user);
    await page.goto("/en/onboarding");
    const calls = captureActionRequests(page);
    await page.route("**/en/onboarding", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await fillCompany(page, { legalName, country: "Germany", industry: "Construction" });
    await page.getByRole("button", { name: "Create company" }).dblclick();
    await expect(page.getByRole("button", { name: "Creating company..." })).toBeDisabled();
    await expect(page).toHaveURL(/\/en\/mfa$/);
    expect(calls).toHaveLength(1);
    expect(organizationCountByName(legalName)).toBe(1);
  });

  test("FR-A2 AC1: a network failure shows an error toast and keeps what was typed", async ({ page, context }) => {
    const user = await createCommittedUser("company");
    const legalName = uniqueName("Offline Bau GmbH");
    await signIn(page, user);
    await page.goto("/en/onboarding");
    await fillCompany(page, { legalName, country: "Germany", industry: "Construction" });
    await context.setOffline(true);
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(page.getByText("Could not create the company", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Legal company name")).toHaveValue(legalName);
    await context.setOffline(false);
    expect(organizationRows(user.id)).toEqual([]);
  });

  test("FR-A2 AC11: an employer without an organization is sent to set it up, and one with an organization is sent to the dashboard", async ({
    page,
  }) => {
    const user = await createCommittedUser("company");
    await signIn(page, user);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await page.getByRole("link", { name: "Set up your company" }).click();
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByLabel("Legal company name")).toBeVisible();

    await callAs(user, "create_organization", {
      p_type: "employer",
      p_legal_name: uniqueName("Redirect Bau GmbH"),
      p_display_name: "Redirect Bau",
      p_based_in_country: "DE",
      p_industry_code: "F",
    });
    await signIn(page, user);
    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
  });

  test("FR-A2 AC11: the owner reaches the dashboard at aal1, sees the guided steps, and the first one is done after two-step setup", async ({
    page,
  }) => {
    const user = await createCommittedUser("company");
    await callAs(user, "create_organization", {
      p_type: "employer",
      p_legal_name: uniqueName("Steps Bau GmbH"),
      p_display_name: "Steps Bau",
      p_based_in_country: "DE",
      p_industry_code: "F",
    });
    await signIn(page, user);
    expect((await sessionClaims(page.context())).aal).toBe("aal1");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Steps Bau", { exact: true })).toBeVisible();
    const steps = page.getByRole("main").getByRole("listitem");
    await expect(steps).toHaveText([
      "Set up two-step verification",
      "Start the free trial",
      "Post the first vacancy",
      "Invite a team member",
    ]);
    await expect(page.getByRole("link", { name: "Set up two-step verification" })).toHaveAttribute("href", "/en/mfa");
    await expectNoAxeViolations(page);

    await enrollTotp(user);
    await signIn(page, user);
    await expect(steps.first()).toHaveText("Set up two-step verification (done)");
    await expect(page.getByRole("link", { name: "Set up two-step verification" })).toHaveCount(0);
  });

  test("FR-A2 AC10: another company's owner cannot read the organization through the API", async () => {
    const owner = await createCommittedUser("company");
    const other = await createCommittedUser("company");
    await callAs(owner, "create_organization", {
      p_type: "employer",
      p_legal_name: uniqueName("Private Bau GmbH"),
      p_display_name: "Private Bau",
      p_based_in_country: "DE",
      p_industry_code: "F",
    });
    const [organization] = organizationRows(owner.id);
    expect(organizationRows(other.id)).toEqual([]);
    await expect(
      callAs(other, "set_legal_entity_identifier", {
        p_org: organization.id,
        p_identifier: "DE123456789",
        p_kind: "vat_number",
      }),
    ).rejects.toThrow("answered 400");
    expect(organizationRows(owner.id)[0].legal_entity_identifier).toBeNull();
  });
});
