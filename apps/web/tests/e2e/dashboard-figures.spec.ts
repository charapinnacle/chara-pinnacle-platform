import { formatDate } from "@/lib/i18n/format";
import { expectNoAxeViolations } from "./support/axe";
import { callAs } from "./support/accounts";
import {
  ago,
  card,
  dashboardUrl,
  DAY,
  fromNow,
  HOUR,
  openDashboardAtAal2,
  seedApplicationAgo,
  seedSubscription,
  softDeleteJob,
  stageRows,
} from "./support/dashboard";
import { addCompanyUser, expectNotFound, newCompany, seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { overflow } from "./support/login-page";
import { staffUser } from "./support/mfa";
import { signInBrowser } from "./support/session";
import { addMember, newTeam, signInAtAal1 } from "./support/team";
import { expect, test } from "./support/test";

const PIPELINE = ["Applied", "Viewed", "Shortlisted", "Interview", "Offer", "Hired", "Not selected", "Withdrawn"];

async function memberPage(browser: import("@playwright/test").Browser, company: Parameters<typeof addCompanyUser>[0]) {
  const member = await addCompanyUser(company, "member");
  const context = await browser.newContext();
  await signInBrowser(context, member);
  return { member, context, page: await context.newPage() };
}

test.describe("the employer dashboard: the figures", () => {
  test("FR-E5 AC1: the Open vacancies card counts the open vacancies that are not deleted and links to the list filtered to Open", async ({ browser }) => {
    const company = await newCompany();
    seedJob(company, { title: "Open one", status: "open" });
    seedJob(company, { title: "Open two", status: "open" });
    seedJob(company, { title: "Paused one", status: "paused" });
    seedJob(company, { title: "Draft one", status: "draft" });
    seedJob(company, { title: "Closed one", status: "closed" });
    seedJob(company, { title: "Filled one", status: "filled" });
    softDeleteJob(seedJob(company, { title: "Deleted open", status: "open" }));
    const { context, page } = await memberPage(browser, company);

    await page.goto(dashboardUrl(company.slug));
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    const open = card(page, "Open vacancies: 2");
    await expect(open).toHaveAttribute("href", `/en/org/${company.slug}/jobs?status=open`);

    await open.click();
    await expect(page).toHaveURL(`/en/org/${company.slug}/jobs?status=open`);
    const rows = page.getByRole("main").getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Open one" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Open two" })).toHaveCount(1);
    await expect(page.getByText("Paused one")).toHaveCount(0);
    await context.close();
  });

  test("FR-E5 AC2: the New applications card counts the last 7 x 24 hours at any stage, for this organization only", async ({ browser }) => {
    const company = await newCompany();
    const other = await newCompany();
    const job = seedJob(company, { title: "Window welder", status: "open" });
    seedApplicationAgo(company, job, "applied", HOUR);
    seedApplicationAgo(company, job, "withdrawn", 3 * DAY);
    seedApplicationAgo(company, job, "interview", 6 * DAY + 23 * HOUR);
    seedApplicationAgo(company, job, "applied", 7 * DAY + HOUR);
    seedApplicationAgo(company, job, "hired", 30 * DAY);
    const otherJob = seedJob(other, { title: "Other welder", status: "open" });
    for (let n = 0; n < 4; n++) seedApplicationAgo(other, otherJob, "applied", 1000);
    const { context, page } = await memberPage(browser, company);

    await page.goto(dashboardUrl(company.slug));
    const recent = card(page, "New applications in the last 7 days: 3");
    await expect(recent).toHaveAttribute("href", `/en/org/${company.slug}/applicants`);

    await recent.click();
    await expect(page).toHaveURL(`/en/org/${company.slug}/applicants`);
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(5);
    await context.close();
  });

  test("FR-E5 AC3: the stages show every number, Offer as 0, each linking to the list of that stage; a move shows after a reload, and nothing is cached", async ({ browser }) => {
    const company = await newCompany();
    const open = seedJob(company, { title: "Stage open", status: "open" });
    const paused = seedJob(company, { title: "Stage paused", status: "paused" });
    const closed = seedJob(company, { title: "Stage closed", status: "closed" });
    const stages: [string, string][] = [
      ["applied", open], ["applied", paused], ["applied", closed], ["viewed", open], ["viewed", paused], ["shortlisted", open],
      ["interview", paused], ["hired", closed], ["rejected", open], ["withdrawn", paused],
    ];
    const ids = stages.map(([status, job], index) => seedApplicationAgo(company, job, status, (index + 1) * HOUR, `Cand ${index + 1}`));
    const { member, context, page } = await memberPage(browser, company);

    const response = await page.goto(dashboardUrl(company.slug));
    expect(response?.headers()["cache-control"]).toContain("private");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    expect(await stageRows(page)).toEqual([
      ["Applied", "3"], ["Viewed", "2"], ["Shortlisted", "1"], ["Interview", "1"], ["Offer", "0"], ["Hired", "1"], ["Not selected", "1"], ["Withdrawn", "1"],
    ]);
    await expect(page.getByRole("table", { name: "Applicants by stage" }).locator("tfoot")).toHaveText("Total10");
    for (const [index, label] of PIPELINE.entries()) {
      const stage = ["applied", "viewed", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"][index];
      await expect(page.getByRole("table", { name: "Applicants by stage" }).getByRole("link", { name: label, exact: true })).toHaveAttribute(
        "href",
        `/en/org/${company.slug}/applicants?stage=${stage}`,
      );
    }

    await callAs(member, "set_application_status", { p_application_id: ids[0], p_status: "interview" });
    await page.reload();
    expect((await stageRows(page)).slice(0, 4)).toEqual([["Applied", "2"], ["Viewed", "2"], ["Shortlisted", "1"], ["Interview", "2"]]);

    await page.getByRole("link", { name: "Interview", exact: true }).click();
    await expect(page).toHaveURL(`/en/org/${company.slug}/applicants?stage=interview`);
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(2);
    await context.close();
  });
});

test.describe("the employer dashboard: plan and payment status", () => {
  test("FR-E5 AC5: the plan card shows the plan, Trial, the end date and the days left; the alert starts in the last 72 hours and its link is for the owner", async ({ browser, page }) => {
    const trialEnd = fromNow(10 * DAY + 5 * HOUR);
    const soonEnd = fromNow(48 * HOUR);
    const far = await newTeam();
    seedSubscription(far, "employer_starter", "trialing", { trialEndsAt: trialEnd });
    const soon = await newTeam();
    seedSubscription(soon, "employer_starter", "trialing", { trialEndsAt: soonEnd });
    const paid = await newTeam();
    seedSubscription(paid, "employer_professional", "active", { currentPeriodEnd: "2026-11-03T00:00:00Z" });
    const trialAlerts = (target: import("@playwright/test").Page) => target.getByRole("alert").filter({ hasText: "free trial" });

    await openDashboardAtAal2(page, far);
    const plan = page.getByRole("region", { name: "Plan" });
    await expect(plan).toContainText("Basic");
    await expect(plan).toContainText("Trial");
    await expect(plan).toContainText(formatDate(trialEnd));
    await expect(plan).toContainText("11 days left");
    await expect(trialAlerts(page)).toHaveCount(0);

    await openDashboardAtAal2(page, soon);
    await expect(trialAlerts(page)).toContainText(formatDate(soonEnd));
    await expect(trialAlerts(page)).toContainText("2 days left");
    await expect(trialAlerts(page).getByRole("link")).toHaveAttribute("href", `/en/org/${soon.slug}/billing`);

    const { user: member } = await addMember(soon, "member", { enrolled: false });
    const context = await browser.newContext();
    await signInBrowser(context, member);
    const memberView = await context.newPage();
    await memberView.goto(dashboardUrl(soon.slug));
    await expect(trialAlerts(memberView)).toContainText("2 days left");
    await expect(trialAlerts(memberView).getByRole("link")).toHaveCount(0);
    await expect(memberView.getByRole("main").locator('a[href$="/billing"]')).toHaveCount(0);
    await context.close();

    await openDashboardAtAal2(page, paid);
    const paidPlan = page.getByRole("region", { name: "Plan" });
    await expect(paidPlan).toContainText("Professional");
    await expect(paidPlan).toContainText("Active");
    await expect(paidPlan).toContainText("Next billing date");
    await expect(paidPlan).toContainText("November 3, 2026");
    await expect(trialAlerts(page)).toHaveCount(0);
    await expect(page.getByText(/stripe|provider|cus_|sub_/i)).toHaveCount(0);
  });

  test("FR-E5 AC7: a failed payment is a warning above the cards with the end of the grace period, linked for the owner only", async ({ browser, page }) => {
    const team = await newTeam();
    const since = ago(2 * DAY);
    seedSubscription(team, "employer_starter", "past_due", { pastDueSince: since });
    const graceEnd = new Date(new Date(since).getTime() + 7 * DAY).toISOString();
    const warning = (target: import("@playwright/test").Page) => target.getByRole("alert").filter({ hasText: "payment" });

    await openDashboardAtAal2(page, team);
    await expect(warning(page)).toContainText("failed");
    await expect(warning(page)).toContainText(formatDate(graceEnd));
    await expect(warning(page)).toContainText("5 days left");
    await expect(warning(page).getByRole("link")).toHaveAttribute("href", `/en/org/${team.slug}/billing`);
    const plan = page.getByRole("region", { name: "Plan" });
    await expect(plan).toContainText("Past due");
    await expect(plan).toContainText("Basic");
    expect(await warning(page).evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(
      await card(page, /^Open vacancies/).evaluate((element) => element.getBoundingClientRect().top),
    );

    const { user: member } = await addMember(team, "member", { enrolled: false });
    const context = await browser.newContext();
    await signInBrowser(context, member);
    const memberView = await context.newPage();
    await memberView.goto(dashboardUrl(team.slug));
    await expect(warning(memberView)).toContainText("5 days left");
    await expect(warning(memberView).getByRole("link")).toHaveCount(0);
    await expect(memberView.getByRole("region", { name: "Plan" })).toContainText("Past due");
    await context.close();
  });

  test("FR-E5 AC8: a lapsed organization shows the Free plan, a banner and its past applicants; a new one an empty state; the owner may choose a plan and a member is told to ask", async ({ browser, page }) => {
    const lapsed = await newTeam();
    seedSubscription(lapsed, "employer_starter", "canceled");
    const paused = seedJob(lapsed, { title: "Lapsed one", status: "paused" });
    seedJob(lapsed, { title: "Lapsed two", status: "paused" });
    for (let n = 0; n < 7; n++) seedApplicationAgo(lapsed, paused, n < 4 ? "applied" : "hired", (n + 1) * DAY, `Past ${n}`);
    const fresh = await newTeam();

    await openDashboardAtAal2(page, lapsed);
    const plan = page.getByRole("region", { name: "Plan" });
    await expect(plan).toContainText("Free plan");
    await expect(plan).not.toContainText("Trial ends");
    await expect(page.getByRole("status").filter({ hasText: "Your subscription has ended" })).toContainText("applicant changes are disabled");
    await expect(card(page, "Open vacancies: 0")).toBeVisible();
    expect((await stageRows(page))[0]).toEqual(["Applied", "4"]);
    await expect(page.getByRole("table", { name: "Applicants by stage" }).locator("tfoot")).toHaveText("Total7");
    await expect(plan.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", `/en/org/${lapsed.slug}/billing`);
    await expect(page.getByRole("heading", { name: "Nothing here yet" })).toHaveCount(0);

    await openDashboardAtAal2(page, fresh);
    await expect(page.getByRole("region", { name: "Plan" })).toContainText("Free plan");
    await expect(page.getByRole("status").filter({ hasText: "Your subscription has ended" })).toHaveCount(0);
    await expect(card(page, "Open vacancies: 0")).toBeVisible();
    expect((await stageRows(page)).map(([, count]) => count)).toEqual(["0", "0", "0", "0", "0", "0", "0", "0"]);
    await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create your first vacancy" })).toHaveAttribute("href", `/en/org/${fresh.slug}/jobs/new`);
    await expect(page.getByRole("region", { name: "Plan" }).getByRole("link", { name: "Choose a plan" })).toBeVisible();

    for (const team of [lapsed, fresh]) {
      const { user: member } = await addMember(team, "member", { enrolled: false });
      const context = await browser.newContext();
      await signInBrowser(context, member);
      const memberView = await context.newPage();
      await memberView.goto(dashboardUrl(team.slug));
      const memberPlan = memberView.getByRole("region", { name: "Plan" });
      await expect(memberPlan).toContainText("Contact an owner or admin");
      await expect(memberView.getByRole("main").locator('a[href$="/billing"]')).toHaveCount(0);
      await expect(memberView.getByRole("link", { name: "Choose a plan" })).toHaveCount(0);
      await context.close();
    }
  });
});

test.describe("the employer dashboard: who may open it", () => {
  test("FR-E5 AC9: a visitor goes to log in, a candidate to the candidate dashboard, outsiders get a page that does not exist, a member of the organization sees it", async ({ browser, page }) => {
    const company = await newCompany();
    const other = await newCompany();
    const path = dashboardUrl(company.slug);

    await page.goto(path);
    await expect(page).toHaveURL(/\/en\/login/);

    const candidate = await createCommittedUser("worker");
    const worker = await browser.newContext();
    await signInBrowser(worker, candidate);
    const workerPage = await worker.newPage();
    await workerPage.goto(path);
    await expect(workerPage).toHaveURL(/\/en\/dashboard\/worker$/);
    await worker.close();

    const outsider = await browser.newContext();
    await signInBrowser(outsider, other.owner);
    const outsiderPage = await outsider.newPage();
    await expectNotFound(outsiderPage, path);
    await expect(outsiderPage.getByRole("link", { name: /^Open vacancies/ })).toHaveCount(0);
    await outsider.close();

    const staff = await browser.newContext();
    await signInBrowser(staff, await staffUser("admin"));
    const staffPage = await staff.newPage();
    await expectNotFound(staffPage, path);
    await staff.close();

    const { context, page: memberView } = await memberPage(browser, company);
    await memberView.goto(path);
    await expect(card(memberView, /^Open vacancies/)).toBeVisible();
    await context.close();
  });

  test("FR-E5 AC9: an owner at aal1 sees no figure and is asked for the code (recorded departure from the redirect); at aal2 the figures show", async ({ page }) => {
    const team = await newTeam();
    seedJob(team, { title: "Guarded welder", status: "open" });

    await signInAtAal1(page, team.owner, dashboardUrl(team.slug));
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Open vacancies/ })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Applicants by stage" })).toHaveCount(0);
    await expect(page.getByText("Enter your two-step code to see the figures of your hiring.")).toBeVisible();

    await page.getByRole("link", { name: "Enter your code" }).click();
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent(dashboardUrl(team.slug))}`);
  });

  test("FR-E5 AC9: a plain member opens the dashboard of the organization without two-step verification", async ({ browser }) => {
    const team = await newTeam();
    const { user } = await addMember(team, "member", { enrolled: false });
    const context = await browser.newContext();
    await signInBrowser(context, user);
    const page = await context.newPage();
    await page.goto(dashboardUrl(team.slug));
    await expect(card(page, /^Open vacancies/)).toBeVisible();
    await expect(page).not.toHaveURL(/\/mfa/);
    await context.close();
  });
});

test.describe("the employer dashboard: keyboard, labels and a narrow screen", () => {
  test("FR-E5 AC11: the cards are links in reading order, the stages are a table, nothing overflows at 360 px and axe finds no serious violation", async ({ browser }) => {
    const company = await newCompany();
    const job = seedJob(company, { title: "Keyboard welder", status: "open" });
    seedApplicationAgo(company, job, "applied", HOUR);
    seedApplicationAgo(company, job, "viewed", 2 * HOUR);
    const { context, page } = await memberPage(browser, company);
    await page.setViewportSize({ width: 360, height: 800 });

    await page.goto(dashboardUrl(company.slug));
    await expect(card(page, "Open vacancies: 1")).toBeVisible();
    await expect(page.getByRole("table", { name: "Applicants by stage" }).getByRole("columnheader")).toHaveText(["Stage", "Applicants"]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const first = await card(page, "Open vacancies: 1").boundingBox();
    const second = await card(page, "New applications in the last 7 days: 2").boundingBox();
    expect(first?.x).toBe(second?.x);
    expect(second?.y).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0) - 1);

    const focusOrder: string[] = [];
    for (let step = 0; step < 40 && focusOrder.length < 12; step++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => {
        const element = document.activeElement;
        return element?.closest("main") ? (element.getAttribute("aria-label") ?? element.textContent ?? "").trim() : "";
      });
      if (name) focusOrder.push(name);
    }
    expect(focusOrder.slice(0, 4)).toEqual(["Open vacancies: 1", "New applications in the last 7 days: 2", "Applied", "Viewed"]);
    expect(focusOrder).toContain("Withdrawn");
    await expectNoAxeViolations(page);
    await context.close();
  });
});
