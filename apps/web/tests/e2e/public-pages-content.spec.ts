import { expectNoAxeViolations } from "./support/axe";
import { execute } from "./support/db";
import { clearSettings, legalPaths, openVacancyId, setSettings, sitePaths } from "./support/public-pages";
import { expect, test } from "./support/test";

// These tests set the legal-entity details for the whole database while they run, so they follow one another and put
// the empty values back when they end.
test.describe.configure({ mode: "serial" });
test.afterAll(() => {
  clearSettings();
});

const DETAILS = {
  legal_entity_name: "Example GmbH",
  legal_entity_address: "1 Example Street\n20095 Hamburg",
  legal_entity_registration_number: "HRB 123456",
  legal_entity_vat_id: "DE123456789",
  legal_entity_email: "info@example.com",
  privacy_contact: "privacy@example.com",
  data_protection_contact: "dpo@example.com",
};

test.describe("the details of the legal entity", () => {
  test("FR-H1 AC7: the Imprint, the Contact page and the Privacy Policy show the settings, and a change shows at once", async ({
    page,
  }) => {
    setSettings(DETAILS);

    await page.goto("/en/imprint");
    const imprint = page.getByRole("main");
    for (const [label, value] of [
      ["Legal entity", "Example GmbH"],
      ["Address", "1 Example Street"],
      ["Registration number", "HRB 123456"],
      ["VAT ID", "DE123456789"],
      ["Email", "info@example.com"],
    ]) {
      await expect(imprint.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }), label).toContainText(value);
    }
    await expect(imprint.getByText("20095 Hamburg")).toBeVisible();
    await expect(imprint.getByRole("link", { name: "info@example.com" })).toHaveAttribute("href", "mailto:info@example.com");

    await page.goto("/en/contact");
    const contact = page.getByRole("main");
    await expect(contact.getByRole("link", { name: "info@example.com" })).toHaveAttribute("href", "mailto:info@example.com");
    await expect(contact.getByRole("link", { name: "privacy@example.com" })).toHaveAttribute("href", "mailto:privacy@example.com");
    await expect(contact.getByRole("link", { name: "dpo@example.com" })).toHaveAttribute("href", "mailto:dpo@example.com");
    await expect(contact.getByText("Example GmbH")).toHaveCount(0);

    await page.goto("/en/legal/privacy-policy");
    const policy = page.getByRole("main");
    await expect(policy.getByRole("link", { name: "privacy@example.com" })).toBeVisible();
    await expect(policy.getByRole("link", { name: "dpo@example.com" })).toBeVisible();
    const text = await policy.getByText("This text has not been approved by legal counsel").boundingBox();
    const contacts = await policy.getByRole("link", { name: "privacy@example.com" }).boundingBox();
    expect(contacts?.y).toBeGreaterThan((text?.y ?? Infinity) + (text?.height ?? 0));

    await page.goto("/en/legal/terms-of-service");
    await expect(page.getByRole("main").getByRole("link", { name: "privacy@example.com" })).toHaveCount(0);

    execute("update private.settings set value = to_jsonb('Example Ltd'::text) where key = 'legal_entity_name'");
    await page.goto("/en/imprint");
    await expect(imprint).toContainText("Example Ltd");
    await expect(imprint).not.toContainText("Example GmbH");
  });

  test("FR-H1 AC8: an empty setting leaves its row out of the page, and an address that is not an email is not a link", async ({
    page,
  }) => {
    setSettings({ ...DETAILS, legal_entity_vat_id: "   ", legal_entity_registration_number: "", data_protection_contact: "<b>Officer</b>" });

    await page.goto("/en/imprint");
    const imprint = page.getByRole("main");
    await expect(imprint.getByText("VAT ID", { exact: true })).toHaveCount(0);
    await expect(imprint.getByText("Registration number", { exact: true })).toHaveCount(0);
    await expect(imprint).not.toContainText(/null|undefined/);

    await page.goto("/en/contact");
    const contact = page.getByRole("main");
    await expect(contact.getByText("<b>Officer</b>", { exact: true })).toBeVisible();
    await expect(contact.locator("dd b")).toHaveCount(0);
    await expect(contact.getByRole("link", { name: "<b>Officer</b>" })).toHaveCount(0);

    clearSettings();
    await page.goto("/en/imprint");
    await expect(imprint.locator("dl")).toHaveCount(0);
    await expect(imprint.getByText("These details are being completed.")).toBeVisible();
  });
});

test.describe("the accessibility of the public pages", () => {
  test("FR-H1 AC4: axe finds no serious or critical violation on any of the 19 public pages", async ({ page }) => {
    test.setTimeout(180_000);
    setSettings(DETAILS);
    const jobId = await openVacancyId();
    const paths = [...sitePaths(jobId), ...legalPaths()];
    expect(paths).toHaveLength(19);
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }), path).toHaveCount(1);
      await expectNoAxeViolations(page);
    }
  });

  test("FR-H1 AC4: the pages are accessible at 360 px with the menu open", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/en");
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("link", { name: "Pricing" })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
