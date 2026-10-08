import { expectNoAxeViolations } from "./support/axe";
import { card, dashboardUrl, HOUR, memberPage, seedApplicationAgo } from "./support/dashboard";
import { expectNotFound, newCompany, seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { overflow } from "./support/login-page";
import { staffUser } from "./support/mfa";
import { signInBrowser } from "./support/session";
import { addMember, newTeam, signInAtAal1 } from "./support/team";
import { expect, test } from "./support/test";

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
    await expectNoAxeViolations(page);

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
