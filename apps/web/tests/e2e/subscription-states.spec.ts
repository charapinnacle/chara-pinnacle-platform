import type { Page } from "@playwright/test";
import { formatShortDate } from "@/lib/i18n/format";
import { expectNoAxeViolations } from "./support/axe";
import { applicantUrl, seedNamedApplication, stageValue } from "./support/applicants";
import { applicationUrl, eventRows, newApplicant } from "./support/applications";
import { billingPath, deliverBillingEvent, expectPlan, HOSTED_ORIGIN, linkCustomer, stubHostedPages, subscriptionRows } from "./support/billing";
import { ago, dashboardUrl, DAY, fromNow, memberPage } from "./support/dashboard";
import { literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { jobStatus, seedJob } from "./support/jobs";
import { uniqueName } from "./support/organizations";
import { signInBrowser } from "./support/session";
import { addMember, newTeam, newVisitor, signInAtAal2, teamAudit } from "./support/team";
import { expect, test } from "./support/test";

const REASON = /Your subscription has ended\. Your past applicants stay readable, and changes to them need an active plan\./;

test.describe("subscription states: what the organisation and its people see (FR-G4)", () => {
  test("FR-G4 AC11: the owner and the admin see the failed payment on the billing page and the dashboard with a button to the portal, the member sees none, and a paid invoice clears it", async ({ page, browser }) => {
    const team = await newTeam(uniqueName("Due Bau"));
    const admin = await addMember(team, "admin");
    if (!admin.secret) throw new Error("The admin has no factor");
    linkCustomer(team, "cus_due");
    const subscription = `sub_${team.id.slice(0, 8)}`;
    const failedAt = ago(2 * DAY);
    const graceEnd = new Date(new Date(failedAt).getTime() + 7 * DAY).toISOString();
    const subscribed = { orgId: team.id, providerCustomerRef: "cus_due", providerSubscriptionRef: subscription };
    await deliverBillingEvent(
      { ...subscribed, kind: "subscription.activated", planCode: "employer_starter", status: "active", currentPeriodEnd: fromNow(28 * DAY) },
      { createdAt: ago(3 * DAY) },
    );
    await deliverBillingEvent({ ...subscribed, kind: "payment.failed", providerPaymentRef: `in_${subscription}` }, { createdAt: failedAt });
    expect(subscriptionRows(team)[0]).toMatchObject({ status: "past_due", past_due_since: expect.stringContaining(failedAt.slice(0, 19)) });

    const warning = (target: Page) => target.getByRole("alert").filter({ hasText: "Payment failed" });
    const expected = `Payment failed on ${formatShortDate(failedAt)}. Update your payment method before ${formatShortDate(graceEnd)} to keep your plan.`;

    const hosted = await stubHostedPages(page);
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expect(warning(page)).toHaveText(expected + "Update payment method");
    await expectPlan(page, "Basic", "Past due");
    await expectNoAxeViolations(page);
    await page.goto(dashboardUrl(team.slug));
    await expect(warning(page)).toContainText(expected);
    await expect(page.getByRole("region", { name: "Plan" })).toContainText("Past due");
    await expectNoAxeViolations(page);

    const button = warning(page).getByRole("button", { name: "Update payment method" });
    await waitForHydration(button);
    await button.click();
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/portal/cus_due`));
    expect(hosted.visits).toHaveLength(1);
    expect(teamAudit(team, "billing.portal_opened").map((row) => row.actor_id)).toEqual([team.owner.id]);

    const { context: adminContext, page: adminPage } = await newVisitor(browser);
    await signInAtAal2(adminPage, admin.user, admin.secret, billingPath(team.slug));
    await expect(warning(adminPage)).toContainText(expected);
    await adminPage.goto(dashboardUrl(team.slug));
    await expect(warning(adminPage)).toContainText(expected);
    const adminHosted = await stubHostedPages(adminPage);
    const adminButton = warning(adminPage).getByRole("button", { name: "Update payment method" });
    await waitForHydration(adminButton);
    await adminButton.click();
    await expect(adminPage).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/portal/cus_due`));
    expect(adminHosted.visits).toHaveLength(1);
    expect(teamAudit(team, "billing.portal_opened").map((row) => row.actor_id)).toEqual([team.owner.id, admin.user.id]);
    await adminContext.close();

    const { context: memberContext, page: memberView } = await memberPage(browser, team);
    await memberView.goto(dashboardUrl(team.slug));
    await expect(memberView.getByRole("region", { name: "Plan" })).toContainText("Past due");
    await expect(warning(memberView)).toHaveCount(0);
    await expect(memberView.getByRole("button", { name: "Update payment method" })).toHaveCount(0);
    await memberContext.close();

    await deliverBillingEvent({
      ...subscribed,
      kind: "payment.succeeded",
      purpose: "subscription",
      subscriptionStatus: "active",
      amountMinor: 3900,
      taxMinor: 741,
      currency: "EUR",
      invoiceRef: `in_paid_${subscription}`,
      providerPaymentRef: `pi_paid_${subscription}`,
    });
    expect(subscriptionRows(team)[0]).toMatchObject({ status: "active", past_due_since: null });
    await page.goto(dashboardUrl(team.slug));
    await expect(page.getByRole("region", { name: "Plan" })).toContainText("Active");
    await expect(warning(page)).toHaveCount(0);
    await page.goto(billingPath(team.slug));
    await expectPlan(page, "Basic", "Active");
    await expect(warning(page)).toHaveCount(0);
  });

  test("FR-G4 AC11: after the cancellation the vacancies are paused, the pages say the subscription has ended, the controls that change applicants are off with the reason, and the candidate can still withdraw", async ({ page, browser }) => {
    const team = await newTeam(uniqueName("Lapse Bau"));
    const admin = await addMember(team, "admin");
    if (!admin.secret) throw new Error("The admin has no factor");
    const candidate = await newApplicant();
    const job = seedJob(team, { title: "Lapsing welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, job, team, "applied");
    const subscription = `sub_${team.id.slice(0, 8)}`;
    const subscribed = { orgId: team.id, providerCustomerRef: "cus_lapse", providerSubscriptionRef: subscription, planCode: "employer_starter" };
    await deliverBillingEvent({ ...subscribed, kind: "subscription.activated", status: "active", currentPeriodEnd: fromNow(20 * DAY) }, { createdAt: ago(10 * DAY) });
    expect(jobStatus(job)).toBe("open");
    await deliverBillingEvent({ ...subscribed, kind: "subscription.canceled", status: "canceled" });
    expect(subscriptionRows(team)[0]).toMatchObject({ status: "canceled" });
    expect(jobStatus(job)).toBe("paused");
    expect(query<{ n: number }>(`select count(*)::int as n from audit.log where action = 'job.status_changed' and entity_id = ${literal(job)} and metadata ->> 'actor_fn' = 'pause_jobs_on_lapse'`)).toEqual([{ n: 1 }]);

    await signInAtAal2(page, team.owner, team.ownerSecret, `/en/org/${team.slug}/applicants`);
    const notice = page.getByRole("status").filter({ hasText: "Your subscription has ended" });
    await expect(notice).toContainText(REASON);
    await expect(notice.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", billingPath(team.slug));
    await expect(page.getByRole("link", { name: "Ana Silva" })).toBeVisible();
    const bulk = page.getByRole("button", { name: "Change stage of selected applicants" });
    await expect(bulk).toBeDisabled();
    await bulk.focus();
    await expect(bulk).toBeFocused();
    await expect(bulk).toHaveAccessibleDescription(REASON);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expectNoAxeViolations(page);

    await page.getByRole("link", { name: "Ana Silva" }).click();
    await expect(page).toHaveURL(applicantUrl(team.slug, applicationId));
    await expect(stageValue(page)).toHaveText("Applied");
    await expect(page.getByRole("status").filter({ hasText: "Your subscription has ended" }).getByRole("link", { name: "Choose a plan" })).toBeVisible();
    const stage = page.getByRole("button", { name: "Change stage" });
    const note = page.getByRole("region", { name: "Internal notes" });
    for (const control of [stage, note.getByLabel("Add an internal note"), note.getByRole("button", { name: "Add note" })]) {
      await expect(control).toHaveAttribute("aria-disabled", "true");
      await control.focus();
      await expect(control).toBeFocused();
      await expect(control).toHaveAccessibleDescription(REASON);
    }
    await expect(page.getByRole("region", { name: "Profile as submitted" })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(eventRows(applicationId)).toHaveLength(1);

    await page.goto(`/en/org/${team.slug}/jobs`);
    await expect(page.getByRole("status").filter({ hasText: "Your subscription has ended" })).toContainText(REASON);
    await expect(page.getByRole("status").getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", billingPath(team.slug));
    await expect(page.getByRole("listitem").filter({ hasText: "Lapsing welder" })).toContainText("Paused");
    await expectNoAxeViolations(page);

    const { context: memberContext, page: memberView } = await memberPage(browser, team);
    await memberView.goto(`/en/org/${team.slug}/applicants`);
    await expect(memberView.getByRole("status").filter({ hasText: "Your subscription has ended" })).toContainText(REASON);
    await expect(memberView.getByRole("link", { name: "Choose a plan" })).toHaveCount(0);
    await memberContext.close();

    const { context: adminContext, page: adminPage } = await newVisitor(browser);
    await signInAtAal2(adminPage, admin.user, admin.secret, `/en/org/${team.slug}/applicants`);
    await expect(adminPage.getByRole("status").filter({ hasText: "Your subscription has ended" }).getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", billingPath(team.slug));
    await adminContext.close();

    const candidateContext = await browser.newContext();
    await signInBrowser(candidateContext, candidate);
    const candidatePage = await candidateContext.newPage();
    await candidatePage.goto(applicationUrl(applicationId));
    await expect(stageValue(candidatePage)).toHaveText("Applied");
    const withdraw = candidatePage.getByRole("button", { name: "Withdraw application" });
    await waitForHydration(withdraw);
    await withdraw.click();
    await candidatePage.getByRole("dialog", { name: "Withdraw this application?" }).getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(stageValue(candidatePage)).toHaveText("Withdrawn");
    await candidateContext.close();
    expect(eventRows(applicationId)).toHaveLength(2);
  });
});
