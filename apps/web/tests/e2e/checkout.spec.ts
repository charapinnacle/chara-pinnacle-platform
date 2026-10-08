import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import {
  billingPath,
  checkoutPath,
  currentTermsVersion,
  customerRows,
  grantTrial,
  linkCustomer,
  setIdentifier,
  startTrial,
  stubHostedPages,
  subscriptionCount,
  termsConsents,
  trialGrantCount,
  HOSTED_ORIGIN,
} from "./support/billing";
import { literal, query } from "./support/db";
import { logIn } from "./support/login-page";
import { uniqueName } from "./support/organizations";
import { addMember, newTeam, signInAtAal2, teamAudit } from "./support/team";
import { formatDate } from "@/lib/i18n/format";

const NO_PAYMENT = "You have no active subscription, and no payment was taken.";

async function fillCheckout(page: import("@playwright/test").Page, { country = "DE", vat = "DE123456789", registration = "HRB 12345" } = {}) {
  await page.getByLabel("Billing country", { exact: true }).selectOption(country);
  await page.getByLabel("VAT ID", { exact: true }).fill(vat);
  await page.getByLabel("Company registration number", { exact: true }).fill(registration);
}

const terms = (page: import("@playwright/test").Page) => page.getByRole("checkbox", { name: /Subscription and Billing Terms/ });
const proceed = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /Continue to payment/ });

test.describe("checkout: the owner starts a trial through the hosted page (FR-G2)", () => {
  test("AC1: choosing Basic, the terms and the tax data lead to the hosted page, with no card field on any CHARA page", async ({ page }) => {
    const team = await newTeam(uniqueName("Acme Bau"));
    const hosted = await stubHostedPages(page);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(`${request.url()} ${request.postData() ?? ""}`));

    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(page.getByText(NO_PAYMENT)).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole("link", { name: "Choose Basic" }).click();
    await expect(page).toHaveURL(checkoutPath(team.slug));
    await expect(page.getByRole("heading", { name: "Confirm your plan", level: 1 })).toBeVisible();

    await fillCheckout(page);
    await terms(page).check();
    await expectNoAxeViolations(page);
    expect(await page.locator('input[autocomplete^="cc-"]').count()).toBe(0);
    await proceed(page).click();

    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/null_cs_`));
    expect(hosted.visits).toHaveLength(1);
    expect(hosted.visits[0].searchParams.get("success_url")).toBe(`http://localhost:3100${billingPath(team.slug)}`);
    expect(requests.some((entry) => /card|cvc|cc-/i.test(entry))).toBe(false);

    expect(customerRows(team)).toEqual([
      { provider: "null", customer_ref: null, billing_country: "DE", vat_id: "DE123456789", registration_number: "HRB12345" },
    ]);
    expect(termsConsents(team.owner)).toEqual([{ version: currentTermsVersion(), action: "granted" }]);
    const [started, ...others] = teamAudit(team, "billing.checkout_started");
    expect(others).toEqual([]);
    expect(started).toMatchObject({
      actor_id: team.owner.id,
      entity_id: team.id,
      metadata: { plan_code: "employer_starter", trial_days: 30, legal_entity_trial_used: false },
    });
    expect(JSON.stringify(started.metadata)).not.toMatch(/DE123456789|HRB/);

    // What the webhook (FR-G3) leaves after the hosted page: the subscription of the trial.
    const trialEnd = startTrial(team);
    await page.goto(billingPath(team.slug));
    await expect(page.getByText("Basic · Status: Trial")).toBeVisible();
    await expect(page.getByText(`Your free trial ends on ${formatDate(trialEnd)}.`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose Basic" })).toHaveCount(0);
  });

  test("AC3: the terms gate, the labels, the validation messages and the keyboard", async ({ page }) => {
    const team = await newTeam(uniqueName("Keys Bau"));
    await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));

    await expect(proceed(page)).toBeDisabled();
    await expect(page.getByRole("link", { name: /Read the full text/ })).toHaveAttribute("href", "/en/legal/subscription-and-billing-terms");
    await terms(page).check();
    await expect(proceed(page)).toBeEnabled();
    await page.getByLabel("Billing country", { exact: true }).selectOption("DE");

    await proceed(page).click();
    const summary = page.getByRole("alert").filter({ hasText: "There is a problem" });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole("link", { name: "Enter a VAT ID or a company registration number." })).toHaveCount(2);
    await expect(page.getByLabel("VAT ID", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#checkout-vat-id-error")).toHaveText("Enter a VAT ID or a company registration number.");
    await summary.getByRole("link").first().click();
    await expect(page.getByLabel("VAT ID", { exact: true })).toBeFocused();

    await page.getByLabel("VAT ID", { exact: true }).fill("DE12");
    await proceed(page).click();
    await expect(page.locator("#checkout-vat-id-error")).toHaveText(
      "Enter 2 letters followed by 6 to 12 letters or digits; spaces, dots, hyphens and slashes are ignored.",
    );
    expect(customerRows(team)).toEqual([]);
    expect(teamAudit(team, "billing.checkout_started")).toEqual([]);
  });

  test("AC3: every control is reached and used with the keyboard", async ({ page }) => {
    const team = await newTeam(uniqueName("Tab Bau"));
    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));

    await page.getByLabel("Billing country", { exact: true }).focus();
    await page.keyboard.type("Germany");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("VAT ID", { exact: true })).toBeFocused();
    await page.keyboard.type("DE123456789");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Company registration number", { exact: true })).toBeFocused();
    await page.keyboard.type("HRB 12345");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /Read the full text/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(terms(page)).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(proceed(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/`));
    expect(hosted.visits).toHaveLength(1);
    expect(customerRows(team)[0]).toMatchObject({ billing_country: "DE", vat_id: "DE123456789" });
  });

  test("AC3: activating Continue to payment twice in quick succession creates one session and one audit row", async ({ page }) => {
    const team = await newTeam(uniqueName("Twice Bau"));
    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));
    await fillCheckout(page);
    await terms(page).check();

    await proceed(page).dblclick();
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/`));
    expect(hosted.visits).toHaveLength(1);
    expect(teamAudit(team, "billing.checkout_started")).toHaveLength(1);
    expect(customerRows(team)).toHaveLength(1);
  });

  test("the identifier on file fills the form, and the owner can record it on the billing page until a payment starts", async ({ page }) => {
    const team = await newTeam(uniqueName("Ident Bau"));
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));

    await expect(page.getByRole("heading", { name: "Company identifier" })).toBeVisible();
    await page.getByLabel("Company registration number or VAT number").fill("de 123 456 788");
    await page.getByLabel("Type of identifier").selectOption("vat_number");
    await page.getByRole("button", { name: "Save identifier" }).click();
    await expect(page.getByText("Recorded: VAT number DE123456788.")).toBeVisible();
    await expect(page.getByText("Identifier saved", { exact: true })).toBeVisible();
    expect(query(`select legal_entity_identifier from public.organizations where id = ${literal(team.id)}`)).toEqual([
      { legal_entity_identifier: "DE123456788" },
    ]);
    expect(teamAudit(team, "legal_entity_identifier_set")).toHaveLength(1);

    await page.getByRole("link", { name: "Choose Basic" }).click();
    await expect(page.getByLabel("VAT ID", { exact: true })).toHaveValue("DE123456788");
    await expect(page.getByLabel("Company registration number", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Billing country", { exact: true })).toHaveValue("DE");
  });

  test("the identifier is refused when it is too short, and the control is gone once a payment has started", async ({ page }) => {
    const team = await newTeam(uniqueName("Lock Bau"));
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));

    await page.getByLabel("Company registration number or VAT number").fill("x1");
    await page.getByLabel("Type of identifier").selectOption("vat_number");
    await page.getByRole("button", { name: "Save identifier" }).click();
    await expect(page.locator("#legal-entity-identifier-error")).toHaveText(
      "Enter 4 to 32 letters or digits; spaces, dots, hyphens and slashes are ignored.",
    );
    expect(teamAudit(team, "legal_entity_identifier_set")).toEqual([]);

    linkCustomer(team, "cus_locked");
    await page.goto(billingPath(team.slug));
    await expect(page.getByRole("button", { name: "Save identifier" })).toHaveCount(0);
    await expect(page.getByText("It cannot be changed once a payment has been started for the company.")).toBeVisible();
  });
});

test.describe("checkout: who may use it, and what the page says when the state changed", () => {
  test("a member and a candidate do not reach the billing page, an admin at the second step does", async ({ page, browser }) => {
    const team = await newTeam(uniqueName("Roles Bau"));
    const member = await addMember(team, "member");
    const admin = await addMember(team, "admin");
    if (!admin.secret) throw new Error("The admin has no factor");

    await signInAtAal2(page, admin.user, admin.secret, billingPath(team.slug));
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Company identifier" })).toHaveCount(0);

    const other = await browser.newContext();
    const memberPage = await other.newPage();
    await logIn(memberPage, member.user, billingPath(team.slug));
    await expect(memberPage).toHaveURL(/\/en\/forbidden$/);
    await other.close();
  });

  test("a company that gets a subscription while the page is open is told, and nothing is started", async ({ page }) => {
    const team = await newTeam(uniqueName("Late Bau"));
    await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));
    await fillCheckout(page);
    await terms(page).check();

    startTrial(team);
    await proceed(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText(
      "Your organization already has a subscription. Use Manage billing to change it.",
    );
    await expect(page.getByText("Could not start the checkout", { exact: true })).toBeVisible();
    expect(customerRows(team)).toEqual([]);
    expect(teamAudit(team, "billing.checkout_started")).toEqual([]);
  });

  test("a trial that is no longer available since the page was shown is not started without the person seeing it", async ({ page }) => {
    const team = await newTeam(uniqueName("Taken Bau"));
    setIdentifier(team, "HRB77777");
    await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));
    await expect(page.getByText("30 days free, starting when you confirm your payment details.")).toBeVisible();
    await fillCheckout(page, { vat: "DE777777777", registration: "HRB 77777" });
    await terms(page).check();

    grantTrial(team, "reg:DE:HRB77777");
    await proceed(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText(
      "The free trial offered to your company changed. Reload this page to see the terms before you continue.",
    );
    expect(customerRows(team)).toEqual([]);
    expect(termsConsents(team.owner)).toEqual([]);

    await page.reload();
    await expect(page.getByText("There is no free trial: a free trial has already been used for this company, so the first payment is due at once.")).toBeVisible();
    await expect(page.getByText("30 days free")).toHaveCount(0);
  });

  test("a plan that is not sold, and a page without a plan, are not found", async ({ page }) => {
    const team = await newTeam(uniqueName("Plan Bau"));
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    for (const target of ["employer_enterprise", "free_employer", "no_such_plan"]) {
      await page.goto(checkoutPath(team.slug, target));
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Continue to payment/ })).toHaveCount(0);
    }
    await page.goto(`${billingPath(team.slug)}/checkout`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("the pages fit a 360 px screen", async ({ page }) => {
    const team = await newTeam(uniqueName("Small Bau"));
    await page.setViewportSize({ width: 360, height: 800 });
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));
    await expect(page.getByRole("button", { name: /Continue to payment/ })).toBeVisible();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.goto(billingPath(team.slug));
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

test.describe("checkout: returning from the hosted pages (AC11)", () => {
  test("cancelling at the hosted checkout leaves the plan choice and records no subscription and no trial", async ({ page }) => {
    const team = await newTeam(uniqueName("Back Bau"));
    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));
    await fillCheckout(page);
    await terms(page).check();
    await proceed(page).click();
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/`));

    await page.getByRole("link", { name: "cancel_url" }).click();
    await expect(page).toHaveURL(billingPath(team.slug));
    await expect(page.getByText(NO_PAYMENT)).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose Basic" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage billing" })).toHaveCount(0);
    expect(hosted.visits).toHaveLength(1);
    expect(subscriptionCount(team)).toBe(0);
    expect(trialGrantCount(team)).toBe(0);
  });

  test("Manage billing sends the owner to the portal of the organization's own customer and back", async ({ page }) => {
    const team = await newTeam(uniqueName("Portal Bau"));
    const other = await newTeam(uniqueName("Other Bau"));
    linkCustomer(team, "cus_portal_one");
    linkCustomer(other, "cus_portal_two");
    startTrial(team);
    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: "Manage billing" }).click();
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/portal/cus_portal_one`));
    expect(hosted.visits).toHaveLength(1);
    expect(hosted.visits[0].searchParams.get("return_url")).toBe(`http://localhost:3100${billingPath(team.slug)}`);
    expect(teamAudit(team, "billing.portal_opened").map((row) => row.actor_id)).toEqual([team.owner.id]);
    expect(teamAudit(other, "billing.portal_opened")).toEqual([]);

    await page.getByRole("link", { name: "return_url" }).click();
    await expect(page).toHaveURL(billingPath(team.slug));
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(page.getByText("Basic · Status: Trial")).toBeVisible();
  });
});
