import { expectNoAxeViolations } from "./support/axe";
import { billingPath, checkoutPath, expectPlan, linkCustomer, resetSubscriptions, summaryValue } from "./support/billing";
import { seedSubscription } from "./support/dashboard";
import { execute, literal } from "./support/db";
import { expectNotFound } from "./support/jobs";
import { logIn } from "./support/login-page";
import { staffUser } from "./support/mfa";
import { uniqueName } from "./support/organizations";
import { signInBrowser } from "./support/session";
import { addMember, newTeam, newVisitor, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

const PROVIDER_MARK = "_hidden_ref";

test.describe("billing page: who sees it (FR-G5 AC1, AC2)", () => {
  test("AC1: the owner and the admin at the second step see the plan and the status, and no provider reference reaches the browser", async ({ page, browser }) => {
    const team = await newTeam(uniqueName("See Bau"));
    const admin = await addMember(team, "admin");
    if (!admin.secret) throw new Error("The admin has no factor");
    seedSubscription(team, "employer_starter", "trialing", { trialEndsAt: "2026-11-04T12:00:00Z" });
    linkCustomer(team, `cus${PROVIDER_MARK}`);
    execute(
      `update billing.subscriptions set provider_customer_ref = ${literal(`cus${PROVIDER_MARK}`)}, provider_subscription_ref = ${literal(`sub${PROVIDER_MARK}`)}
       where organization_id = ${literal(team.id)}`,
    );

    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expectPlan(page, "Basic", "Trial");

    const { context, page: adminPage } = await newVisitor(browser);
    await signInAtAal2(adminPage, admin.user, admin.secret, billingPath(team.slug));
    await expect(adminPage.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expectPlan(adminPage, "Basic", "Trial");
    await expect(adminPage.getByRole("heading", { name: "Company identifier" })).toHaveCount(0);

    // The page as the HTML document and as the Flight data that a client navigation fetches, for both people.
    for (const target of [page, adminPage]) {
      for (const headers of [{} as Record<string, string>, { rsc: "1" }]) {
        const body = await (await target.request.get(billingPath(team.slug), { headers })).text();
        expect(body).toContain("Basic");
        expect(body).not.toMatch(/_hidden_ref|\b(cus|sub)_[A-Za-z0-9]{6,}/);
      }
      expect(await target.content()).not.toContain(PROVIDER_MARK);
    }
    await context.close();
  });

  test("AC2: a member, an owner at the first step, a visitor, an outsider and platform staff are kept out", async ({ page, browser }) => {
    const team = await newTeam(uniqueName("Out Bau"));
    const other = await newTeam(uniqueName("Zed Bau"));
    const member = await addMember(team, "member");
    seedSubscription(team, "employer_starter", "active", { currentPeriodEnd: "2026-12-04T12:00:00Z" });
    const path = billingPath(team.slug);

    await signInAtAal2(page, team.owner, team.ownerSecret, `/en/org/${team.slug}`);
    await expect(page.getByRole("link", { name: "Billing" })).toHaveAttribute("href", path);
    await page.getByRole("link", { name: "Billing" }).click();
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();

    const { context: memberContext, page: memberPage } = await newVisitor(browser);
    await logIn(memberPage, member.user, path);
    await expect(memberPage).toHaveURL(/\/en\/forbidden$/);
    await expect(memberPage.getByRole("heading", { name: "You do not have access to this page" })).toBeVisible();
    await expect(memberPage.getByText(/Basic|Next invoice|Manage billing/)).toHaveCount(0);
    await memberPage.goto(`/en/org/${team.slug}`);
    await expect(memberPage.getByRole("link", { name: "Team" })).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Billing" })).toHaveCount(0);
    await memberContext.close();

    const { context: firstStep, page: firstStepPage } = await newVisitor(browser);
    await signInBrowser(firstStep, team.owner);
    await firstStepPage.goto(path);
    await expect(firstStepPage).toHaveURL(`/en/mfa?next=${encodeURIComponent(path)}`);
    await expect(firstStepPage.getByText(/Basic|Next invoice|Manage billing/)).toHaveCount(0);
    await firstStep.close();

    const visitor = await browser.newContext();
    const visitorPage = await visitor.newPage();
    await visitorPage.goto(path);
    await expect(visitorPage).toHaveURL(`/en/login?next=${encodeURIComponent(path)}`);
    await visitor.close();

    const { context: outsiderContext, page: outsiderPage } = await newVisitor(browser);
    await logIn(outsiderPage, other.owner, path);
    await expect(outsiderPage).toHaveURL(path);
    await expect(outsiderPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(outsiderPage.getByText(team.slug)).toHaveCount(0);
    const unknown = await outsiderPage.goto(billingPath("no-such-organisation"));
    await expect(outsiderPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(unknown?.status()).toBe((await outsiderPage.goto(path))?.status());
    await expectNotFound(outsiderPage, path);
    await outsiderContext.close();

    const { context: staffContext, page: staffPage } = await newVisitor(browser);
    await logIn(staffPage, await staffUser("admin"), path);
    await expect(staffPage).toHaveURL(path);
    await expect(staffPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(staffPage.getByText(/Basic|Next invoice|Manage billing/)).toHaveCount(0);
    await staffContext.close();
  });
});

test.describe("billing page: plan, state and dates (FR-G5 AC4, AC5, AC9)", () => {
  test("AC4 and AC5: a trial, an active plan, a failed payment, an ending plan and a lapsed plan are each told in words and dates", async ({ page }) => {
    const team = await newTeam(uniqueName("Date Bau"));
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    const next = page.getByText(/Next invoice/);
    const show = async () => {
      await page.goto(billingPath(team.slug));
      await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    };

    seedSubscription(team, "employer_starter", "trialing", { trialEndsAt: "2026-11-04T12:00:00Z" });
    await show();
    await expectPlan(page, "Basic", "Trial");
    await expect(page.getByText("Trial ends 4 Nov 2026")).toBeVisible();
    await expect(page.getByText("First payment of EUR 39.00 excl. VAT on 4 Nov 2026")).toBeVisible();
    await expect(next).toHaveCount(0);
    await expectNoAxeViolations(page);

    resetSubscriptions(team);
    seedSubscription(team, "employer_professional", "active", { currentPeriodEnd: "2026-12-04T12:00:00Z" });
    await show();
    await expectPlan(page, "Professional", "Active");
    await expect(page.getByText("Next invoice 4 Dec 2026")).toBeVisible();
    await expect(page.getByText("EUR 79.00 per month excl. VAT")).toBeVisible();

    resetSubscriptions(team);
    seedSubscription(team, "employer_starter", "past_due", { currentPeriodEnd: "2026-12-04T12:00:00Z", pastDueSince: "2026-11-04T12:00:00Z" });
    await show();
    await expectPlan(page, "Basic", "Past due");
    await expect(page.getByText("Payment failed 4 Nov 2026", { exact: true })).toBeVisible();
    await expect(page.getByText("Grace period ends 11 Nov 2026")).toBeVisible();
    await expect(next).toHaveCount(0);
    await expectNoAxeViolations(page);

    resetSubscriptions(team);
    seedSubscription(team, "employer_starter", "active", { currentPeriodEnd: "2026-12-04T12:00:00Z", cancelAt: "2026-12-04T12:00:00Z" });
    await show();
    await expectPlan(page, "Basic", "Active");
    await expect(page.getByText("Ends 4 Dec 2026")).toBeVisible();
    await expect(next).toHaveCount(0);

    resetSubscriptions(team);
    seedSubscription(team, "employer_starter", "canceled");
    linkCustomer(team, "cus_lapsed");
    await show();
    await expect(summaryValue(page, "Plan")).toHaveText("No active plan");
    await expect(page.getByText("Free plan with read-only access to past applicants.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", "#plans");
    await expect(page.getByRole("button", { name: "View invoices" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Manage billing|Upgrade|Downgrade/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("a paused subscription shows that the free plan applies, no usage and no plan change, and no plan to choose", async ({ page }) => {
    const team = await newTeam(uniqueName("Pause Bau"));
    linkCustomer(team, "cus_paused");
    seedSubscription(team, "employer_starter", "paused", { currentPeriodEnd: "2026-12-04T12:00:00Z" });
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expectPlan(page, "Basic", "Paused");
    await expect(page.getByText("Paused: the free plan applies until the subscription is resumed")).toBeVisible();
    await expect(page.getByRole("region", { name: "Usage" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Upgrade|Downgrade/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Manage billing" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Choose a plan" })).toHaveCount(0);
  });

  test("AC9: an organisation that never subscribed and one that did are offered the plans that are sold, and neither Enterprise", async ({ page }) => {
    const team = await newTeam(uniqueName("Plans Bau"));
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expect(summaryValue(page, "Plan")).toHaveText("Free plan");
    await expect(summaryValue(page, "Status")).toHaveText("No subscription");
    const plans = page.getByRole("region", { name: "Choose a plan" });
    await expect(plans.getByRole("heading", { level: 3 })).toHaveText(["Basic", "Professional"]);
    await expect(plans.getByText("EUR 39.00 per month excl. VAT")).toBeVisible();
    await expect(plans.getByText("EUR 79.00 per month excl. VAT")).toBeVisible();
    await expect(page.getByText("Enterprise")).toHaveCount(0);
    await expect(plans.getByRole("link", { name: "Start 30-day free trial of Basic" })).toHaveText("Start 30-day free trial");
    await expect(plans.getByRole("link", { name: "Start 30-day free trial of Professional" })).toBeVisible();
    await expect(plans.getByRole("link", { name: /Subscribe/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Manage billing|View invoices|Change tax details/ })).toHaveCount(0);
    await expectNoAxeViolations(page);

    seedSubscription(team, "employer_starter", "canceled");
    await page.goto(billingPath(team.slug));
    await expect(summaryValue(page, "Plan")).toHaveText("No active plan");
    await expect(plans.getByRole("link", { name: /free trial/ })).toHaveCount(0);
    await expect(plans.getByRole("link", { name: "Subscribe to Professional" })).toHaveText("Subscribe");
    await expect(page.getByRole("button", { name: "View invoices" })).toHaveCount(0);
    await plans.getByRole("link", { name: "Subscribe to Basic" }).click();
    await expect(page).toHaveURL(checkoutPath(team.slug));
    await expect(page.getByRole("heading", { name: "Confirm your plan", level: 1 })).toBeVisible();
  });
});
