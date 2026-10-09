import { expectNoAxeViolations } from "./support/axe";
import {
  billingPath,
  checkoutPath,
  currentTermsVersion,
  customerRows,
  fillCheckout,
  grantTrial,
  HOSTED_ORIGIN,
  NO_PAYMENT,
  proceed,
  setIdentifier,
  startTrial,
  startTrialThroughWebhook,
  stubHostedPages,
  terms,
  termsConsents,
  uniqueIdentifiers,
} from "./support/billing";
import { captureActionRequests } from "./support/server-action";
import { uniqueName } from "./support/organizations";
import { newTeam, signInAtAal2, teamAudit } from "./support/team";
import { expect, test } from "./support/test";
import { formatDate } from "@/lib/i18n/format";

const TRIAL_TEXT = "30 days free, starting when you confirm your payment details.";
const NO_TRIAL_TEXT = "There is no free trial: a free trial has already been used for this company, so the first payment is due at once.";
const CHANGED = "The free trial that applies to your company changed. Read the updated terms above, accept them again and continue.";

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

    // The trial is recorded for good through the webhook below, so this test has identifiers of its own.
    const identifiers = uniqueIdentifiers();
    await fillCheckout(page, identifiers);
    await terms(page).check();
    await expectNoAxeViolations(page);
    expect(await page.locator('input[autocomplete^="cc-"]').count()).toBe(0);
    await proceed(page).click();

    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/null_cs_`));
    expect(hosted.visits).toHaveLength(1);
    expect(hosted.visits[0].searchParams.get("success_url")).toBe(`http://localhost:3100${billingPath(team.slug)}`);
    expect(requests.some((entry) => /card|cvc|cc-/i.test(entry))).toBe(false);

    expect(customerRows(team)).toEqual([
      { provider: "null", customer_ref: null, billing_country: "DE", vat_id: identifiers.vat, registration_number: identifiers.registrationStored },
    ]);
    expect(termsConsents(team.owner)).toEqual([{ version: currentTermsVersion(), action: "granted" }]);
    const [started, ...others] = teamAudit(team, "billing.checkout_started");
    expect(others).toEqual([]);
    expect(started).toMatchObject({
      actor_id: team.owner.id,
      entity_id: team.id,
      metadata: { plan_code: "employer_starter", trial_days: 30, legal_entity_trial_used: false },
    });
    expect(JSON.stringify(started.metadata)).not.toContain(identifiers.vat);
    expect(JSON.stringify(started.metadata)).not.toContain(identifiers.registrationStored);

    // The provider's deliveries after the hosted page (FR-G3): the customer is linked and the trial starts.
    const trialEnd = await startTrialThroughWebhook(team);
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
    const actions = captureActionRequests(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));
    await fillCheckout(page);
    await terms(page).check();

    await proceed(page).dblclick();
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/`));
    // Every call of the function that reaches the provider writes one audit row, so the rows count its sessions.
    expect(actions.filter((call) => call.body.includes('"planCode"'))).toHaveLength(1);
    expect(hosted.visits).toHaveLength(1);
    expect(teamAudit(team, "billing.checkout_started")).toHaveLength(1);
    expect(customerRows(team)).toHaveLength(1);
  });
});

test.describe("checkout: when the state changed since the page was shown", () => {
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
    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));
    await expect(page.getByText(TRIAL_TEXT)).toBeVisible();
    await fillCheckout(page, { vat: "DE777777777", registration: "HRB 77777" });
    await terms(page).check();

    grantTrial(team, "reg:DE:HRB77777");
    await proceed(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText(CHANGED);
    await expect(page.getByText(NO_TRIAL_TEXT)).toBeVisible();
    await expect(page.getByText("30 days free")).toHaveCount(0);
    await expect(terms(page)).not.toBeChecked();
    expect(hosted.visits).toEqual([]);
    expect(termsConsents(team.owner)).toEqual([]);
    expect(teamAudit(team, "billing.checkout_started")).toEqual([]);

    await terms(page).check();
    await proceed(page).click();
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/`));
  });

  test("a company typed into the form that already had its trial is shown the no-trial terms without a stored identifier, and then goes through", async ({ page }) => {
    const team = await newTeam(uniqueName("Repeat Bau"));
    const other = await newTeam(uniqueName("First Bau"));
    grantTrial(other, "vat:DE888888888");
    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));
    await expect(page.getByText(TRIAL_TEXT)).toBeVisible();
    await fillCheckout(page, { vat: "DE 888 888 888", registration: "" });
    await terms(page).check();

    await proceed(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText(CHANGED);
    await expect(page.getByText(NO_TRIAL_TEXT)).toBeVisible();
    await expect(page.getByText("30 days free")).toHaveCount(0);
    await expect(terms(page)).not.toBeChecked();
    await expect(page.getByLabel("VAT ID", { exact: true })).toHaveValue("DE 888 888 888");
    expect(customerRows(team)).toEqual([
      { provider: "null", customer_ref: null, billing_country: "DE", vat_id: "DE888888888", registration_number: null },
    ]);
    expect(teamAudit(team, "billing.checkout_started")).toEqual([]);
    expect(termsConsents(team.owner)).toEqual([]);
    expect(hosted.visits).toEqual([]);

    await terms(page).check();
    await proceed(page).click();
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/`));
    expect(hosted.visits).toHaveLength(1);
    const [started] = teamAudit(team, "billing.checkout_started");
    expect(started.metadata).toMatchObject({ trial_days: 0, legal_entity_trial_used: true });
    expect(termsConsents(team.owner)).toEqual([{ version: currentTermsVersion(), action: "granted" }]);
  });
});
