import { expectNoAxeViolations } from "./support/axe";
import {
  billingPath,
  checkoutPath,
  expectPlan,
  fillCheckout,
  HOSTED_ORIGIN,
  linkCustomer,
  NO_PAYMENT,
  proceed,
  startTrial,
  stubHostedPages,
  subscriptionCount,
  terms,
  trialGrantCount,
} from "./support/billing";
import { literal, query } from "./support/db";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { uniqueName } from "./support/organizations";
import { addMember, newTeam, signInAtAal2, teamAudit } from "./support/team";
import { expect, test } from "./support/test";

test.describe("billing page: the company identifier and who may use the page (FR-G2, FR-A2 AC7)", () => {
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

    await page.getByRole("link", { name: "Start 30-day free trial of Basic" }).click();
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

  test("a member is sent to the no-access page and a candidate finds no billing page, an admin at the second step does", async ({ page, browser }) => {
    const team = await newTeam(uniqueName("Roles Bau"));
    const member = await addMember(team, "member");
    const admin = await addMember(team, "admin");
    const candidate = await createCommittedUser("worker");
    if (!admin.secret) throw new Error("The admin has no factor");

    await signInAtAal2(page, admin.user, admin.secret, billingPath(team.slug));
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Company identifier" })).toHaveCount(0);

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await logIn(memberPage, member.user, billingPath(team.slug));
    await expect(memberPage).toHaveURL(/\/en\/forbidden$/);
    await memberPage.goto(checkoutPath(team.slug));
    await expect(memberPage).toHaveURL(/\/en\/forbidden$/);
    await memberContext.close();

    const outsider = await browser.newContext();
    const outsiderPage = await outsider.newPage();
    await logIn(outsiderPage, candidate, billingPath(team.slug));
    await expect(outsiderPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await outsiderPage.goto(checkoutPath(team.slug));
    await expect(outsiderPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await outsider.close();
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
    await expect(page.getByRole("link", { name: "Start 30-day free trial of Basic" })).toBeVisible();
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
    await expectPlan(page, "Basic", "Trial");
  });
});
