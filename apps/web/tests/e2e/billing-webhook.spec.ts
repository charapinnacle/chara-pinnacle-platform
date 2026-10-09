import { expectNoAxeViolations } from "./support/axe";
import {
  billingPath,
  checkoutPath,
  customerRows,
  deliverBillingEvent,
  fillCheckout,
  proceed,
  queuedMails,
  rejectedDeliveries,
  repeatedTrialAlerts,
  seedCustomer,
  startTrialThroughWebhook,
  storedEvents,
  stubHostedPages,
  subscriptionRows,
  terms,
  trialGrantCount,
  uniqueIdentifiers,
} from "./support/billing";
import { uniqueName } from "./support/organizations";
import { newTeam, signInAtAal2, teamAudit } from "./support/team";
import { expect, test } from "./support/test";
import { formatDate } from "@/lib/i18n/format";

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

test.describe("payment webhook: the provider's events keep the billing page correct (FR-G3)", () => {
  test("a checkout, its trial, the first payment, a failure, a recovery and the cancellation show on the billing page", async ({ page }) => {
    const team = await newTeam(uniqueName("Hook Bau"));
    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, checkoutPath(team.slug));
    const identifiers = uniqueIdentifiers();
    await fillCheckout(page, identifiers);
    await terms(page).check();
    await proceed(page).click();
    await expect(page).toHaveURL(/null-provider\.invalid\/checkout\//);
    expect(hosted.visits).toHaveLength(1);

    const customer = `cus_${team.id.slice(0, 8)}`;
    const subscription = `sub_${team.id.slice(0, 8)}`;
    const trialEnd = days(30);
    expect((await deliverBillingEvent({ kind: "checkout.completed", orgId: team.id, providerCustomerRef: customer, providerSubscriptionRef: subscription })).status).toBe(200);
    expect(customerRows(team)).toEqual([
      { provider: "null", customer_ref: customer, billing_country: "DE", vat_id: identifiers.vat, registration_number: identifiers.registrationStored },
    ]);
    expect(subscriptionRows(team)).toEqual([]);

    const subscribed = { orgId: team.id, providerCustomerRef: customer, providerSubscriptionRef: subscription, planCode: "employer_starter" };
    expect((await deliverBillingEvent({ ...subscribed, kind: "subscription.activated", status: "trialing", trialEndsAt: trialEnd, currentPeriodEnd: trialEnd })).status).toBe(200);
    expect(subscriptionRows(team)).toEqual([
      { plan_code: "employer_starter", status: "trialing", provider_customer_ref: customer, provider_subscription_ref: subscription, past_due_since: null },
    ]);
    expect(trialGrantCount(team)).toBe(2);

    await page.goto(billingPath(team.slug));
    await expect(page.getByText("Basic · Status: Trial")).toBeVisible();
    await expect(page.getByText(`Your free trial ends on ${formatDate(new Date(trialEnd).toISOString())}.`)).toBeVisible();
    await expect(page.getByRole("button", { name: /Manage billing/ })).toBeVisible();
    await expectNoAxeViolations(page);

    // Three days before the trial ends: one reminder, to the owner.
    await deliverBillingEvent({ kind: "subscription.trial_will_end", orgId: team.id, providerSubscriptionRef: subscription, trialEndsAt: trialEnd });
    expect(queuedMails(team.owner.id, "trial_ending")).toBe(1);

    // The first payment: the trial converts to the paid plan.
    const periodEnd = days(60);
    await deliverBillingEvent({
      kind: "payment.succeeded",
      orgId: team.id,
      purpose: "subscription",
      providerSubscriptionRef: subscription,
      subscriptionStatus: "active",
      amountMinor: 3900,
      taxMinor: 741,
      currency: "EUR",
      invoiceRef: `in_${subscription}`,
      providerPaymentRef: `pi_${subscription}`,
    });
    await deliverBillingEvent({ ...subscribed, kind: "subscription.updated", status: "active", trialEndsAt: trialEnd, currentPeriodEnd: periodEnd });
    await page.goto(billingPath(team.slug));
    await expect(page.getByText("Basic · Status: Active")).toBeVisible();
    await expect(page.getByText(`Your plan renews on ${formatDate(new Date(periodEnd).toISOString())}.`)).toBeVisible();

    // A failed payment: Past due, and one email however often it fails again.
    const failure = { kind: "payment.failed", orgId: team.id, providerSubscriptionRef: subscription, providerPaymentRef: `in_failed_${subscription}` };
    await deliverBillingEvent(failure);
    await deliverBillingEvent(failure);
    await page.goto(billingPath(team.slug));
    await expect(page.getByText("Basic · Status: Past due")).toBeVisible();
    expect(queuedMails(team.owner.id, "payment_failed")).toBe(1);
    expect(subscriptionRows(team)[0].past_due_since).not.toBeNull();

    // The retry succeeds: Active again, and the dunning period is over.
    await deliverBillingEvent({
      kind: "payment.succeeded",
      orgId: team.id,
      purpose: "subscription",
      providerSubscriptionRef: subscription,
      subscriptionStatus: "active",
      amountMinor: 3900,
      taxMinor: 741,
      currency: "EUR",
      invoiceRef: `in_retry_${subscription}`,
      providerPaymentRef: `pi_retry_${subscription}`,
    });
    await page.goto(billingPath(team.slug));
    await expect(page.getByText("Basic · Status: Active")).toBeVisible();
    expect(subscriptionRows(team)[0].past_due_since).toBeNull();

    // The subscription is deleted: Cancelled, and the organisation can choose a plan again.
    await deliverBillingEvent({ ...subscribed, kind: "subscription.canceled", status: "canceled" });
    await page.goto(billingPath(team.slug));
    await expect(page.getByText("Basic · Status: Cancelled")).toBeVisible();
    await expect(page.getByText("You have no active subscription, and no payment was taken.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose Basic" })).toBeVisible();

    expect(storedEvents(team).map((event) => `${event.kind}:${event.status}`)).toEqual([
      "checkout.completed:applied",
      "subscription.activated:applied",
      "subscription.trial_will_end:applied",
      "payment.succeeded:applied",
      "subscription.updated:applied",
      "payment.failed:applied",
      "payment.failed:applied",
      "payment.succeeded:applied",
      "subscription.canceled:applied",
    ]);
    expect(teamAudit(team, "billing.event_applied")).toHaveLength(9);
  });

  test("a delivery that arrives twice is applied once", async () => {
    const team = await newTeam(uniqueName("Twice Hook"));
    const subscription = `sub_${team.id.slice(0, 8)}`;
    const event = { kind: "subscription.activated", orgId: team.id, planCode: "employer_starter", status: "trialing", providerSubscriptionRef: subscription, trialEndsAt: days(30) };

    expect((await deliverBillingEvent(event, { id: "evt_twice_" + team.id })).status).toBe(200);
    const audited = teamAudit(team, "billing.event_applied").length;
    expect((await deliverBillingEvent({ ...event, planCode: "employer_professional", status: "active" }, { id: "evt_twice_" + team.id })).status).toBe(200);

    expect(storedEvents(team)).toHaveLength(1);
    expect(subscriptionRows(team)).toMatchObject([{ plan_code: "employer_starter", status: "trialing" }]);
    expect(teamAudit(team, "billing.event_applied")).toHaveLength(audited);
  });

  test("a forged delivery is refused with 401, stored nowhere and logged once without its content", async () => {
    const team = await newTeam(uniqueName("Forged Hook"));
    const forged = { kind: "subscription.activated", orgId: team.id, planCode: "employer_professional", status: "active", providerSubscriptionRef: "sub_forged" };
    const before = rejectedDeliveries();
    const response = await deliverBillingEvent(forged, { id: "evt_forged_" + team.id, secret: "not-the-secret" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });

    expect(subscriptionRows(team)).toEqual([]);
    expect(storedEvents(team)).toEqual([]);
    expect(rejectedDeliveries() - before).toBe(1);
  });

  test("an event that arrives after newer state changes nothing and is marked stale", async () => {
    const team = await newTeam(uniqueName("Late Hook"));
    const subscription = `sub_${team.id.slice(0, 8)}`;
    const current = { kind: "subscription.updated", orgId: team.id, planCode: "employer_starter", providerSubscriptionRef: subscription };
    await deliverBillingEvent({ ...current, status: "active" }, { id: "evt_new_" + team.id, createdAt: "2026-11-05T12:00:00.000Z" });
    const response = await deliverBillingEvent({ ...current, status: "past_due" }, { id: "evt_old_" + team.id, createdAt: "2026-11-05T11:59:00.000Z" });

    expect(response.status).toBe(200);
    expect(subscriptionRows(team)).toMatchObject([{ status: "active" }]);
    expect(storedEvents(team).map((event) => `${event.provider_event_id.split("_")[1]}:${event.status}`)).toEqual(["new:applied", "old:stale"]);
    expect(teamAudit(team, "billing.event_applied")).toHaveLength(1);
  });

  test("a plan the database does not know is stored in error and does not change the subscription", async () => {
    const team = await newTeam(uniqueName("Plan Hook"));
    const response = await deliverBillingEvent({ kind: "subscription.activated", orgId: team.id, planCode: "employer_gold", status: "trialing", providerSubscriptionRef: "sub_gold" });

    expect(response.status).toBe(200);
    expect(subscriptionRows(team)).toEqual([]);
    expect(storedEvents(team)).toMatchObject([{ kind: "subscription.activated", status: "error", error: "unknown_plan" }]);
    expect(teamAudit(team, "billing.event_applied")).toEqual([]);
  });

  test("the first trial of a company is recorded, and a second organisation with the same registration number raises an alert", async () => {
    const first = await newTeam(uniqueName("First Hook"));
    const second = await newTeam(uniqueName("Second Hook"));
    const registration = `HRB${first.id.slice(0, 6).toUpperCase()}`;
    seedCustomer(first, registration);
    seedCustomer(second, registration);

    await startTrialThroughWebhook(first);
    expect(trialGrantCount(first)).toBe(1);
    expect(repeatedTrialAlerts(first)).toBe(0);
    await startTrialThroughWebhook(second);

    expect(subscriptionRows(second)).toMatchObject([{ status: "trialing" }]);
    expect(trialGrantCount(first)).toBe(1);
    expect(trialGrantCount(second)).toBe(0);
    expect(repeatedTrialAlerts(second)).toBe(1);
  });
});
