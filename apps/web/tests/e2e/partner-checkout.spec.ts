import { expectAccessibleAtBothWidths } from "./support/applications";
import {
  billingPath,
  checkoutPath,
  expectPlan,
  grantTrial,
  HOSTED_ORIGIN,
  NO_PAYMENT,
  proceed,
  startTrialThroughWebhook,
  stubHostedPages,
  terms,
  uniqueIdentifiers,
} from "./support/billing";
import { execute, literal, query } from "./support/db";
import { enrollTotp } from "./support/login";
import { createCommittedPartner, partnerWithCompany, setPartnerRelease } from "./support/partners";
import { logIn } from "./support/login-page";
import { uniqueName } from "./support/organizations";
import { newTeam, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

const NO_TRIAL_TEXT = "There is no free trial: a free trial has already been used for this company, so the first payment is due at once.";
const CHANGED = "The free trial that applies to your company changed. Read the updated terms above, accept them again and continue.";

function checkoutAudit(organizationId: string) {
  return query<{ plan_code: string; trial_days: number }>(
    `select metadata ->> 'plan_code' as plan_code, (metadata ->> 'trial_days')::int as trial_days from audit.log
     where action = 'billing.checkout_started' and entity_id = ${literal(organizationId)} order by id`,
  );
}

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// other partner specs (playwright.config.ts), and the tests run one after the other.
test.describe("Partner plans on the pricing page and the partner checkout (FR-R1)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("AC3: a visitor reads the plans of each company type in tabs chosen with the arrow keys", async ({ page }) => {
    await page.goto("/en/pricing");
    const tabs = page.getByRole("tablist", { name: "Plans by type of company" }).getByRole("tab");
    await expect(tabs).toHaveText(["Employers", "Recruitment companies", "Staffing companies"]);
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("list", { name: "Employer plans" })).toBeVisible();

    await tabs.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "false");
    const recruitment = page.getByRole("tabpanel", { name: "Recruitment companies" });
    await expect(recruitment).toBeVisible();
    await expect(page.getByRole("list", { name: "Employer plans" })).toBeHidden();
    await expect(recruitment.getByRole("heading", { level: 3 })).toHaveText(["Basic", "Professional", "Enterprise"]);
    const basic = recruitment.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Basic" }) });
    await expect(basic).toContainText("EUR 49.00");
    await expect(basic).toContainText("per month excl. VAT");
    await expect(basic).toContainText("30 days free trial");
    await expect(basic).toContainText("One free trial is granted for each legal entity.");
    await expect(basic).toContainText("3 countries served");
    await expect(basic, "the limit the recruitment dashboard counts").toContainText("10 workforce listings");
    await expect(basic).toContainText("10 job order responses per month");
    await expect(basic).toContainText("25 candidate submissions per month");
    await expect(basic.getByRole("link", { name: "Sign up for Basic" })).toHaveAttribute("href", "/en/signup?kind=recruitment_company");
    await expect(recruitment.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Professional" }) })).toContainText(
      "EUR 99.00",
    );
    const enterprise = recruitment.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Enterprise" }) });
    await expect(enterprise).toContainText("From EUR 199.00");
    await expect(enterprise).toContainText("Unlimited occupations");
    await expect(enterprise).not.toContainText("free trial");
    await expect(enterprise.getByRole("link", { name: "Contact sales about Enterprise" })).toHaveAttribute("href", "/en/contact");
    await expect(page.getByRole("main").getByText("Free", { exact: true })).toHaveCount(0);

    await page.keyboard.press("ArrowRight");
    const staffing = page.getByRole("tabpanel", { name: "Staffing companies" });
    await expect(tabs.nth(2)).toBeFocused();
    await expect(staffing.getByRole("heading", { level: 3 })).toHaveText(["Basic", "Professional", "Enterprise"]);
    await expect(staffing).toContainText("EUR 59.00");
    await expect(staffing).toContainText("EUR 129.00");
    await expect(staffing).toContainText("From EUR 249.00");
    await expect(staffing).toContainText("10 workforce listings");
    const staffingBasic = staffing.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Basic" }) });
    await expect(staffingBasic).toContainText("10 responses to workforce requests per month");
    await expect(staffingBasic).not.toContainText("candidate submissions");
    await expect(page.getByText("A paid plan does not make a recruitment or staffing company verified")).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tabs.nth(0)).toBeFocused();
  });

  test("AC6: the staffing owner chooses Basic of the own type, reads the disclosure and reaches the hosted page", async ({ page }) => {
    test.setTimeout(120_000);
    const { user, id, slug } = await partnerWithCompany("staffing_company");
    const secret = await enrollTotp(user);
    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, user, secret, billingPath(slug));
    await page.goto("/en/pricing");
    const ownTab = page.getByRole("tab", { name: "Staffing companies" });
    await expect(ownTab, "the pricing page opens on the company's own type").toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Staffing companies" }).getByRole("link", { name: "Choose Basic" })).toHaveAttribute(
      "href",
      billingPath(slug),
    );
    await page.goto(billingPath(slug));

    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(page.getByText(NO_PAYMENT)).toBeVisible();
    const plans = page.getByRole("region", { name: "Choose a plan" });
    await expect(plans.getByRole("heading", { level: 3 })).toHaveText(["Basic", "Professional"]);
    await expect(plans).toContainText("EUR 59.00 per month excl. VAT");
    await expect(plans).not.toContainText(/EUR 39|EUR 49|Enterprise/);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("link", { name: "Start 30-day free trial of Basic" }).click();
    await expect(page).toHaveURL(checkoutPath(slug, "staffing_partner"));
    const disclosures = page.getByRole("region", { name: "Before you continue" });
    await expect(disclosures.getByText("30 days free, starting when you confirm your payment details.")).toBeVisible();
    await expect(disclosures.getByText("EUR 59.00 per month, excluding VAT.")).toBeVisible();
    await expect(disclosures.getByText("Billed every month.")).toBeVisible();
    await expect(
      disclosures.getByText("When the trial ends, your subscription converts to the paid Basic plan and your payment method is charged automatically."),
    ).toBeVisible();
    await expect(
      disclosures.getByText("Open Manage billing on the billing page and cancel before the trial ends, and you are not charged."),
    ).toBeVisible();
    await expect(
      disclosures.getByText("A card is needed to start. There is no long-term commitment: the subscription runs from month to month until you cancel."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Read the full text/ })).toHaveAttribute("href", "/en/legal/subscription-and-billing-terms");
    await expect(proceed(page)).toBeDisabled();
    expect(await page.locator('input[autocomplete^="cc-"]').count()).toBe(0);

    const identifiers = uniqueIdentifiers();
    await page.getByLabel("Billing country", { exact: true }).selectOption("DE");
    await page.getByLabel("Company registration number", { exact: true }).fill(identifiers.registration);
    await terms(page).check();
    await expect(proceed(page)).toBeEnabled();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await proceed(page).click();

    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/null_cs_`));
    expect(hosted.visits).toHaveLength(1);
    expect(hosted.visits[0].searchParams.get("success_url")).toBe(`http://localhost:3100${billingPath(slug)}`);
    expect(checkoutAudit(id)).toEqual([{ plan_code: "staffing_partner", trial_days: 30 }]);

    // The provider's deliveries: the trial starts, and the billing page shows the plan and the usage of the partner limits.
    await startTrialThroughWebhook({ id }, undefined, "staffing_partner");
    await page.goto(billingPath(slug));
    await expectPlan(page, "Basic", "Trial");
    const usage = page.getByRole("region", { name: "Usage" });
    await expect(usage.getByText("Countries served")).toBeVisible();
    await expect(usage.getByText("Workforce listings")).toBeVisible();
    await expect(usage.getByText("Open vacancies")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /free trial of Basic/ })).toHaveCount(0);
  });

  test("AC5: a recruitment company with the identifier of an employer that had its trial is told the first payment is due at once", async ({ page }) => {
    test.setTimeout(120_000);
    // Employer A's registration number in Germany already had its free trial.
    const registration = uniqueIdentifiers().registrationStored;
    grantTrial(await newTeam(uniqueName("Trial Bau")), `reg:DE:${registration}`);
    const { user, id, slug } = await partnerWithCompany("recruitment_company");
    const secret = await enrollTotp(user);
    await stubHostedPages(page);
    await signInAtAal2(page, user, secret, checkoutPath(slug, "recruitment_partner"));

    const disclosures = page.getByRole("region", { name: "Before you continue" });
    await expect(disclosures.getByText("30 days free, starting when you confirm your payment details.")).toBeVisible();
    await page.getByLabel("Billing country", { exact: true }).selectOption("DE");
    await page.getByLabel("Company registration number", { exact: true }).fill(registration.toLowerCase().replace(/^hrb/, "hrb-"));
    await terms(page).check();
    await proceed(page).click();

    await expect(page.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText(CHANGED);
    await expect(disclosures.getByText(NO_TRIAL_TEXT)).toBeVisible();
    await expect(disclosures.getByText("EUR 49.00 per month, excluding VAT.")).toBeVisible();
    expect(checkoutAudit(id)).toEqual([]);
    await terms(page).check();
    await proceed(page).click();
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/null_cs_`));
    expect(checkoutAudit(id)).toEqual([{ plan_code: "recruitment_partner", trial_days: 0 }]);
  });

  test("a plan of another type is not offered, a member is turned away and the page is closed while release 2a is off", async ({ page }) => {
    test.setTimeout(120_000);
    const { user, id, slug } = await partnerWithCompany("recruitment_company");
    const secret = await enrollTotp(user);
    await signInAtAal2(page, user, secret, checkoutPath(slug, "staffing_partner"));
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.goto(checkoutPath(slug, "employer_starter"));
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

    setPartnerRelease(false);
    try {
      await page.goto(billingPath(slug));
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Billing" })).toHaveCount(0);
    } finally {
      setPartnerRelease(true);
    }

    const member = await createCommittedPartner("recruitment_company");
    execute(
      `insert into public.organization_members (organization_id, user_id, role, accepted_at)
       values (${literal(id)}, ${literal(member.id)}, 'member', now())`,
    );
    await page.context().clearCookies();
    await logIn(page, member, billingPath(slug));
    await expect(page).toHaveURL("/en/forbidden");
  });
});
