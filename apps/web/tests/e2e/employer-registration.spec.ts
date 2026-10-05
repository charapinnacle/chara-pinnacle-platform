import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { accountRows, confirmFromLink, currentDocuments, userByEmail } from "./support/accounts";
import { createCommittedUser } from "./support/login";
import { extractLinks, waitForMessage } from "./support/mailpit";
import {
  fillCompany,
  IDENTIFIER_LABEL,
  organizationAudit,
  organizationCountByName,
  organizationRows,
  registerOrganization,
  signInAsEmployer,
  SIMILAR_NAME_NOTICE,
  uniqueName,
  uniqueToken,
} from "./support/organizations";
import { captureActionRequests } from "./support/server-action";
import {
  ageBox,
  documentBox,
  EMPLOYER_LABEL,
  fillSignup,
  newEmail,
  PASSWORD,
  summary,
} from "./support/signup-page";

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
    await registerOrganization(first, legalName, "Twin Bau");
    const second = await createCommittedUser("company");
    await signInAsEmployer(page, second);
    await page.goto("/en/onboarding");
    await fillCompany(page, { legalName: legalName.toUpperCase().replace(" ", "   "), country: "Germany", industry: "Construction" });
    await page.getByRole("button", { name: "Create company" }).click();

    await expect(page.getByRole("status")).toHaveText(SIMILAR_NAME_NOTICE);
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
    await signInAsEmployer(page, user);
    await page.goto("/en/onboarding");
    const calls = captureActionRequests(page);

    for (const label of ["Legal company name", "Display name (optional)", "Website (optional)", IDENTIFIER_LABEL]) {
      await expect(page.getByRole("textbox", { name: label, exact: true })).toBeVisible();
    }
    for (const label of ["Country", "Industry"]) {
      await expect(page.getByRole("combobox", { name: label, exact: true })).toBeVisible();
    }

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
    await expect(page.getByRole("combobox", { name: "Country", exact: true })).toBeFocused();

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

  test("FR-A2 AC12: while the request is pending the button says so and a double click creates one organization", async ({
    page,
  }) => {
    const user = await createCommittedUser("company");
    const legalName = uniqueName("Pending Bau GmbH");
    await signInAsEmployer(page, user);
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

  test("FR-A2 AC12: a keyboard-only user completes the form at 360 and 1280 px, with arrow keys and Enter in the lists", async ({
    page,
  }) => {
    const legalName = uniqueName("Keys Bau GmbH");
    await registerOrganization(await createCommittedUser("company"), legalName);

    for (const width of [360, 1280]) {
      const user = await createCommittedUser("company");
      await page.setViewportSize({ width, height: 900 });
      await signInAsEmployer(page, user);
      await page.goto("/en/onboarding");
      await page.waitForLoadState("networkidle");
      const country = page.getByRole("combobox", { name: "Country", exact: true });
      const industry = page.getByRole("combobox", { name: "Industry", exact: true });

      const legal = page.getByLabel("Legal company name");
      for (let presses = 0; presses < 10 && !(await legal.evaluate((el) => el === document.activeElement)); presses += 1) {
        await page.keyboard.press("Tab");
      }
      await expect(legal).toBeFocused();
      await page.keyboard.type(legalName.toUpperCase().replace(" ", "   "));
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect(country).toBeFocused();
      await page.keyboard.type("ger");
      const countries = page.getByRole("listbox", { name: "Country" });
      await expect(countries.getByRole("option")).toHaveText(["Algeria", "Germany", "Niger", "Nigeria"]);
      await page.keyboard.press("ArrowDown");
      await expect(country).toHaveAttribute("aria-activedescendant", /.+/);
      await expect(countries.getByRole("option", { name: "Germany" })).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Enter");
      await expect(country).toHaveValue("Germany");
      await expect(countries).toBeHidden();

      await page.keyboard.press("Tab");
      await page.keyboard.type("constr");
      await page.keyboard.press("Enter");
      await expect(industry).toHaveValue("Construction");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.type("DE 123.456-789");
      await page.keyboard.press("Tab");
      await page.keyboard.type("VAT");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Create company" })).toBeFocused();
      await expectNoAxeViolations(page);
      await page.keyboard.press("Enter");

      await expect(page.getByRole("status")).toHaveText(SIMILAR_NAME_NOTICE);
      await expectNoAxeViolations(page);
      const [organization] = organizationRows(user.id);
      expect(organization).toMatchObject({
        based_in_country: "DE",
        industry_code: "F",
        legal_entity_identifier: "DE123456789",
        legal_entity_identifier_kind: "vat_number",
      });
      expect(organizationAudit(organization.id)[0].metadata).toMatchObject({ duplicate_legal_name: true });
    }
    expect(organizationCountByName(legalName)).toBe(1);
  });

  test("FR-A2 AC12: a country is chosen by typing and clicking, an unknown text offers no match and restores the choice", async ({
    page,
  }) => {
    await signInAsEmployer(page, await createCommittedUser("company"));
    await page.goto("/en/onboarding");
    const country = page.getByRole("combobox", { name: "Country", exact: true });
    await country.fill("Germany");
    await page.getByRole("option", { name: "Germany", exact: true }).click();
    await expect(country).toHaveValue("Germany");
    await country.fill("zzzz");
    await expect(page.getByRole("listbox", { name: "Country" }).getByRole("option")).toHaveText(["No match"]);
    await page.keyboard.press("Escape");
    await expect(country).toHaveValue("Germany");
    await country.fill("zzzz");
    await page.getByLabel("Legal company name").focus();
    await expect(country).toHaveValue("Germany");
    await country.fill("");
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(summary(page).getByRole("link", { name: "Choose the country of your company." })).toBeVisible();
  });

  test("FR-A2 AC12: when the organization cannot be created a toast appears and the typed values stay", async ({
    page,
  }) => {
    const user = await createCommittedUser("company");
    const legalName = uniqueName("Limit Bau GmbH");
    await signInAsEmployer(page, user);
    await page.goto("/en/onboarding");
    await fillCompany(page, {
      legalName,
      country: "Germany",
      industry: "Construction",
      identifierKind: "vat_number",
      identifier: "DE 123 456 789",
    });
    for (const name of ["First", "Second", "Third"]) await registerOrganization(user, uniqueName(`${name} Bau GmbH`));
    await page.getByRole("button", { name: "Create company" }).click();

    await expect(page.getByText("Could not create the company", { exact: true })).toBeVisible();
    await expect(summary(page)).toContainText("You have reached the number of organizations one account can own.");
    await expect(page.getByLabel("Legal company name")).toHaveValue(legalName);
    await expect(page.getByRole("combobox", { name: "Country", exact: true })).toHaveValue("Germany");
    await expect(page.getByLabel(IDENTIFIER_LABEL)).toHaveValue("DE 123 456 789");
    expect(organizationCountByName(legalName)).toBe(0);
  });

  test("FR-A2 AC12: a network failure shows an error toast and keeps what was typed", async ({ page, context }) => {
    const user = await createCommittedUser("company");
    const legalName = uniqueName("Offline Bau GmbH");
    await signInAsEmployer(page, user);
    await page.goto("/en/onboarding");
    await fillCompany(page, { legalName, country: "Germany", industry: "Construction" });
    await context.setOffline(true);
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(page.getByText("Could not create the company", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Legal company name")).toHaveValue(legalName);
    await context.setOffline(false);
    expect(organizationRows(user.id)).toEqual([]);
  });
});
