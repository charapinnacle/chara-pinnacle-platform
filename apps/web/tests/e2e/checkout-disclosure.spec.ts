import { expectNoAxeViolations } from "./support/axe";
import { checkoutPath, grantTrial, setIdentifier, setTrialDays, stubHostedPages } from "./support/billing";
import { uniqueName } from "./support/organizations";
import { newTeam, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

// The trial length of Basic is changed for the whole database while this file runs, so it has a project of its own that
// follows the others (playwright.config.ts) and runs in one worker.
test.describe.configure({ mode: "serial" });
test.afterAll(() => setTrialDays(30));

const PRICE = "EUR 39.00 per month, excluding VAT.";
const CONVERSION = "When the trial ends, your subscription converts to the paid Basic plan and your payment method is charged automatically.";

test.describe("checkout: what is disclosed before the redirect (FR-G2 AC2)", () => {
  test("an organisation eligible for a trial is told the five things, and the trial length is the plan record's", async ({ page }) => {
    const team = await newTeam(uniqueName("Disclose Bau"));
    setIdentifier(team, `DISC${Date.now()}`);
    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));

    const disclosures = page.getByRole("region", { name: "Before you continue" });
    await expect(disclosures.getByText("30 days free, starting when you confirm your payment details.")).toBeVisible();
    await expect(disclosures.getByText("Price after the trial")).toBeVisible();
    await expect(disclosures.getByText(PRICE)).toBeVisible();
    await expect(disclosures.getByText("Billed every month.")).toBeVisible();
    await expect(disclosures.getByText(CONVERSION)).toBeVisible();
    await expect(
      disclosures.getByText("Open Manage billing on the billing page and cancel before the trial ends, and you are not charged."),
    ).toBeVisible();
    await expect(page.getByText("never sees or stores your card details")).toBeVisible();
    await expectNoAxeViolations(page);

    setTrialDays(14);
    await page.reload();
    await expect(disclosures.getByText("14 days free, starting when you confirm your payment details.")).toBeVisible();
    await expect(disclosures.getByText("30 days free")).toHaveCount(0);

    expect(hosted.visits).toEqual([]);
    await expect(page).toHaveURL(checkoutPath(team.slug));
  });

  test("an organisation that already had its trial is told there is none and that the first payment is due at once", async ({ page }) => {
    const team = await newTeam(uniqueName("Repeat Bau"));
    const identifier = `REPT${Date.now()}`;
    setIdentifier(team, identifier);
    grantTrial(team, `reg:DE:${identifier}`);
    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));

    const disclosures = page.getByRole("region", { name: "Before you continue" });
    await expect(
      disclosures.getByText("There is no free trial: a free trial has already been used for this company, so the first payment is due at once."),
    ).toBeVisible();
    await expect(disclosures.getByText(PRICE)).toBeVisible();
    await expect(disclosures.getByText("Billed every month.")).toBeVisible();
    await expect(disclosures.getByText("Your subscription starts as the paid Basic plan and renews automatically every month.")).toBeVisible();
    await expect(disclosures.getByText("Open Manage billing on the billing page to cancel at any time.")).toBeVisible();
    await expect(disclosures.getByText(/days? free|trial ends/)).toHaveCount(0);
    expect(hosted.visits).toEqual([]);
    await expect(page).toHaveURL(checkoutPath(team.slug));
  });
});
