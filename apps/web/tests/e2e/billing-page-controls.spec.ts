import type { Locator, Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import {
  billingPath,
  deliverBillingEvent,
  HOSTED_ORIGIN,
  linkCustomer,
  portalOpenedCount,
  resetSubscriptions,
  stubHostedPages,
  summaryValue,
} from "./support/billing";
import { DAY, fromNow, seedSubscription, softDeleteJob } from "./support/dashboard";
import { seedJob } from "./support/jobs";
import { waitForHydration } from "./support/hydration";
import { overflow } from "./support/login-page";
import { uniqueName } from "./support/organizations";
import { addMember, newTeam, seedInvitation, signInAtAal2, type Team } from "./support/team";
import { expect, test } from "./support/test";

const usageRow = (page: Page, name: string): Locator =>
  page.getByRole("region", { name: "Usage" }).getByRole("listitem").filter({ hasText: name });

async function seedJobs(team: Team, status: "open" | "paused" | "closed", count: number): Promise<string[]> {
  return Array.from({ length: count }, (_, index) => seedJob(team, { title: `Usage ${status} ${index + 1}`, status }));
}

test.describe("billing page: usage against limits (FR-G5 AC7)", () => {
  test("a Professional organisation counts open vacancies and the members and pending invitations that fill its seats", async ({ page }) => {
    const team = await newTeam(uniqueName("Pro Bau"));
    await addMember(team, "admin");
    await addMember(team, "member");
    seedInvitation(team, "pending@example.test");
    seedInvitation(team, "expired@example.test", "member", { expired: true });
    seedSubscription(team, "employer_professional", "active", { currentPeriodEnd: fromNow(20 * DAY) });
    await seedJobs(team, "open", 7);
    await seedJobs(team, "paused", 2);
    await seedJobs(team, "closed", 1);
    softDeleteJob(seedJob(team, { title: "Usage deleted 1", status: "open" }));

    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    const vacancies = page.getByRole("progressbar", { name: "Open vacancies" });
    await expect(vacancies).toHaveAttribute("aria-valuenow", "7");
    await expect(vacancies).toHaveAttribute("aria-valuemax", "15");
    await expect(usageRow(page, "Open vacancies")).toContainText("7 of 15");
    await expect(page.getByRole("progressbar", { name: "Team members" })).toHaveAttribute("aria-valuenow", "4");
    await expect(usageRow(page, "Team members")).toContainText("4 of 5");
    await expect(page.getByText("Limit reached")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Upgrade", exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("a Basic organisation at its limit is told so and offered the upgrade", async ({ page }) => {
    const team = await newTeam(uniqueName("Basic Bau"));
    linkCustomer(team, "cus_basic_limit");
    seedSubscription(team, "employer_starter", "active", { currentPeriodEnd: fromNow(20 * DAY) });
    await seedJobs(team, "open", 3);

    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expect(usageRow(page, "Open vacancies")).toContainText("3 of 3");
    await expect(usageRow(page, "Open vacancies")).toContainText("Limit reached");
    await expect(usageRow(page, "Team members")).toContainText("1 of 1");
    await expect(usageRow(page, "Open vacancies").getByRole("link", { name: "Upgrade" })).toHaveAttribute("href", "#plan-actions");
    await expect(page.locator("#plan-actions")).toBeVisible();
    await expect(usageRow(page, "Open vacancies")).not.toContainText("Over the limit");
    await expectNoAxeViolations(page);
  });

  test("a Basic organisation at its limit with no payment customer is not offered an Upgrade link that leads nowhere", async ({ page }) => {
    const team = await newTeam(uniqueName("Nolink Bau"));
    seedSubscription(team, "employer_starter", "active", { currentPeriodEnd: fromNow(20 * DAY) });
    await seedJobs(team, "open", 3);

    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expect(usageRow(page, "Open vacancies")).toContainText("Limit reached");
    await expect(page.getByRole("link", { name: /Upgrade/ })).toHaveCount(0);
    await expect(page.locator("#plan-actions")).toHaveCount(0);
  });

  test("an organisation downgraded to Basic keeps its vacancies and is told that no more can be opened", async ({ page }) => {
    const team = await newTeam(uniqueName("Down Bau"));
    seedSubscription(team, "employer_starter", "active", { currentPeriodEnd: fromNow(20 * DAY) });
    await seedJobs(team, "open", 5);

    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    const row = usageRow(page, "Open vacancies");
    await expect(row).toContainText("5 of 3");
    await expect(row).toContainText("Over the limit");
    await expect(row).toContainText("Existing vacancies stay open. No more can be opened until usage is below the limit.");
    await expect(page.getByRole("progressbar", { name: "Open vacancies" })).toHaveAttribute("aria-valuenow", "3");
    await expectNoAxeViolations(page);
  });

  test("an Enterprise organisation is shown its plan and offered no plan change", async ({ page }) => {
    const team = await newTeam(uniqueName("Free Bau"));
    seedSubscription(team, "employer_enterprise", "active", { currentPeriodEnd: fromNow(20 * DAY) });
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(summaryValue(page, "Plan")).toHaveText("Enterprise");
    await expect(page.getByRole("button", { name: /Upgrade|Downgrade/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Manage billing" })).toHaveCount(0);
  });
});

test.describe("billing page: plan-change and portal controls (FR-G5 AC8, AC10)", () => {
  async function openPortalWith(page: Page, name: string): Promise<URL> {
    const hosted = page.waitForRequest((request) => request.url().startsWith(`${HOSTED_ORIGIN}/portal/`));
    const control = page.getByRole("button", { name, exact: true });
    await waitForHydration(control);
    await control.click();
    return new URL((await hosted).url());
  }

  test("AC8: each control opens the portal of the organisation's own customer and returns to the billing page, and writes one audit row", async ({ page }) => {
    const team = await newTeam(uniqueName("Portal Bau"));
    const other = await newTeam(uniqueName("Other Bau"));
    linkCustomer(team, "cus_portal_own");
    linkCustomer(other, "cus_portal_other");
    seedSubscription(team, "employer_starter", "active", { currentPeriodEnd: fromNow(20 * DAY) });
    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));

    await expect(page.getByRole("button", { name: "Upgrade to Professional" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Downgrade|Enterprise/ })).toHaveCount(0);
    for (const [index, name] of ["Upgrade to Professional", "Manage billing", "Change tax details", "View invoices"].entries()) {
      const before = portalOpenedCount(team);
      const url = await openPortalWith(page, name);
      expect(url.pathname, name).toBe("/portal/cus_portal_own");
      expect(url.searchParams.get("return_url"), name).toBe(`http://localhost:3100${billingPath(team.slug)}`);
      await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/portal/`));
      expect(portalOpenedCount(team), name).toBe(before + 1);
      expect(hosted.visits).toHaveLength(index + 1);
      await page.getByRole("link", { name: "return_url" }).click();
      await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    }
    expect(portalOpenedCount(other)).toBe(0);

    resetSubscriptions(team);
    seedSubscription(team, "employer_professional", "active", { currentPeriodEnd: fromNow(20 * DAY) });
    await page.goto(billingPath(team.slug));
    await expect(page.getByRole("button", { name: "Downgrade to Basic" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Upgrade|Enterprise/ })).toHaveCount(0);
    const before = portalOpenedCount(team);
    expect((await openPortalWith(page, "Downgrade to Basic")).pathname).toBe("/portal/cus_portal_own");
    expect(portalOpenedCount(team)).toBe(before + 1);
  });

  test("AC10: a plan change in the portal shows on the page once the provider's event is applied, and not before", async ({ page }) => {
    const team = await newTeam(uniqueName("Change Bau"));
    linkCustomer(team, "cus_change");
    const subscribed = { orgId: team.id, providerCustomerRef: "cus_change", providerSubscriptionRef: `sub_${team.id.slice(0, 8)}` };
    await deliverBillingEvent({ ...subscribed, kind: "subscription.activated", planCode: "employer_starter", status: "active", currentPeriodEnd: fromNow(20 * DAY) });
    await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expect(summaryValue(page, "Plan")).toHaveText("Basic");
    await expect(usageRow(page, "Open vacancies")).toContainText("0 of 3");
    await expect(usageRow(page, "Team members")).toContainText("1 of 1");

    await openPortalWith(page, "Manage billing");
    await page.getByRole("link", { name: "return_url" }).click();
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(summaryValue(page, "Plan")).toHaveText("Basic");
    await expect(page.getByRole("heading", { name: "Billing details could not be loaded" })).toHaveCount(0);

    await deliverBillingEvent({ ...subscribed, kind: "subscription.updated", planCode: "employer_professional", status: "active", currentPeriodEnd: fromNow(20 * DAY) });
    await expect(async () => {
      await page.reload();
      await expect(summaryValue(page, "Plan")).toHaveText("Professional", { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await expect(usageRow(page, "Open vacancies")).toContainText("0 of 15");
    await expect(usageRow(page, "Team members")).toContainText("1 of 5");
    await expect(page.getByRole("button", { name: "Downgrade to Basic" })).toBeVisible();
  });
});

test.describe("billing page: keyboard, names and small screens (FR-G5 AC12)", () => {
  async function tabStops(page: Page, until: string): Promise<{ name: string; ring: boolean }[]> {
    const stops: { name: string; ring: boolean }[] = [];
    await page.locator("body").click({ position: { x: 0, y: 0 } });
    for (let step = 0; step < 40; step++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const style = getComputedStyle(element);
        return {
          name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
          ring: style.boxShadow !== "none" || (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0),
        };
      });
      stops.push(stop);
      if (stop.name === until) break;
    }
    return stops;
  }

  test("every action is reached with Tab in reading order with a visible focus ring, and Enter opens the portal", async ({ page }) => {
    const team = await newTeam(uniqueName("Key Bau"));
    linkCustomer(team, "cus_key");
    seedSubscription(team, "employer_starter", "active", { currentPeriodEnd: fromNow(20 * DAY) });
    await seedJobs(team, "open", 3);
    await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expect(page.getByRole("button", { name: "View invoices" })).toBeVisible();
    await waitForHydration(page.getByRole("button", { name: "Manage billing" }));

    const stops = await tabStops(page, "View invoices");
    const billing = stops.filter(({ name }) => /Upgrade|Manage billing|Change tax details|View invoices/.test(name));
    expect(billing.map(({ name }) => name)).toEqual([
      "Upgrade (Open vacancies)",
      "Upgrade (Team members)",
      "Upgrade to Professional",
      "Manage billing",
      "Change tax details",
      "View invoices",
    ]);
    expect(billing.filter(({ ring }) => !ring)).toEqual([]);

    await page.getByRole("button", { name: "Manage billing" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/portal/cus_key`));
  });

  test("the trial, past-due and no-subscription pages fit a 360 px screen and say the state in words", async ({ page }) => {
    const team = await newTeam(uniqueName("Small Bau"));
    await page.setViewportSize({ width: 360, height: 800 });
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expect(summaryValue(page, "Status")).toHaveText("No subscription");
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    linkCustomer(team, "cus_small");
    seedSubscription(team, "employer_starter", "trialing", { trialEndsAt: fromNow(20 * DAY) });
    await page.goto(billingPath(team.slug));
    await expect(summaryValue(page, "Status")).toHaveText("Trial");
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    resetSubscriptions(team);
    seedSubscription(team, "employer_starter", "past_due", { currentPeriodEnd: fromNow(20 * DAY), pastDueSince: fromNow(-2 * DAY) });
    await page.goto(billingPath(team.slug));
    await expect(summaryValue(page, "Status")).toHaveText("Past due");
    await expect(page.getByRole("alert").filter({ hasText: "Payment failed" })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
  });
});
