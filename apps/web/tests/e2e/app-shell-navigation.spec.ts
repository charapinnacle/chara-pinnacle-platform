import { accountButton, linkLabels, mainNavigation, signedInPage } from "./support/app-shell";
import { seedApplicationAgo, HOUR } from "./support/dashboard";
import { seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { fillCompany, registerOrganization, uniqueName } from "./support/organizations";
import { addMember, membersPath, newTeam, newVisitor, signInAtAal2 } from "./support/team";
import { createTestUser } from "./support/test-user";
import { pendingConsents } from "./support/accounts";
import { waitForHydration } from "./support/hydration";
import { expect, test } from "./support/test";

const WORKER_LINKS = ["Dashboard", "Find jobs", "Saved", "Applications", "Passport"];
const MANAGER_LINKS = ["Organisation", "Vacancies", "Applicants", "Team", "Billing"];

const current = (page: Parameters<typeof mainNavigation>[0]) => mainNavigation(page).locator('[aria-current="page"]');

test.describe("the header of the signed-in area (UX-01, UX-08)", () => {
  test("a candidate has five links in the header, the current page is marked and the logo leads to the dashboard", async ({ browser }) => {
    const worker = await createCommittedUser("worker");
    const { context, page } = await signedInPage(browser, worker);

    await page.goto("/en/applications");
    expect(await linkLabels(mainNavigation(page))).toEqual(WORKER_LINKS);
    await expect(current(page)).toHaveText("Applications");
    await expect(current(page)).toHaveCount(1);
    await expect(page.getByRole("link", { name: "CHARA" })).toHaveAttribute("href", "/en/dashboard/worker");

    await mainNavigation(page).getByRole("link", { name: "Passport" }).click();
    await expect(page).toHaveURL("/en/passport");
    await expect(current(page)).toHaveText("Passport");

    await mainNavigation(page).getByRole("link", { name: "Saved" }).click();
    await expect(page).toHaveURL("/en/saved");
    await expect(current(page)).toHaveText("Saved");

    await mainNavigation(page).getByRole("link", { name: "Find jobs" }).click();
    await expect(page).toHaveURL("/en/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Find jobs" })).toBeVisible();
    await expect(mainNavigation(page).getByRole("link", { name: "Go to my area" })).toHaveAttribute("href", "/en/dashboard/worker");
    await context.close();
  });

  test("an owner reaches Vacancies, Applicants, Team and Billing from the header, also after the first vacancy", async ({ browser }) => {
    const team = await newTeam(uniqueName("Shell Bau"));
    const jobId = seedJob(team, { title: "Shell welder", status: "open" });
    seedApplicationAgo(team, jobId, "applied", HOUR);
    const { context, page: ownerPage } = await newVisitor(browser);
    await signInAtAal2(ownerPage, team.owner, team.ownerSecret, membersPath(team.slug));
    expect(await linkLabels(mainNavigation(ownerPage))).toEqual(MANAGER_LINKS);
    await expect(current(ownerPage)).toHaveText("Team");
    await expect(ownerPage.getByRole("link", { name: "CHARA" })).toHaveAttribute("href", "/en/dashboard/employer");

    for (const [label, path] of [
      ["Vacancies", `/en/org/${team.slug}/jobs`],
      ["Billing", `/en/org/${team.slug}/billing`],
      ["Applicants", `/en/org/${team.slug}/applicants`],
      ["Team", membersPath(team.slug)],
    ] as const) {
      await mainNavigation(ownerPage).getByRole("link", { name: label }).click();
      await expect(ownerPage).toHaveURL(path);
      await expect(current(ownerPage)).toHaveText(label);
    }
    await mainNavigation(ownerPage).getByRole("link", { name: "Organisation" }).click();
    await expect(ownerPage).toHaveURL(`/en/dashboard/employer?org=${team.slug}`);
    await expect(current(ownerPage)).toHaveText("Organisation");

    await ownerPage.goto(`/en/org/${team.slug}`);
    await expect(ownerPage).toHaveURL(`/en/dashboard/employer?org=${team.slug}`);
    await context.close();
  });

  test("an administrator is offered Billing, a member is not, and the header names no page a role may not open", async ({ browser }) => {
    const team = await newTeam(uniqueName("Role Bau"));
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");

    const adminSession = await signedInPage(browser, admin.user);
    await adminSession.page.goto("/en/dashboard/employer");
    expect(await linkLabels(mainNavigation(adminSession.page))).toEqual(MANAGER_LINKS);
    await adminSession.context.close();

    const memberSession = await signedInPage(browser, member.user);
    await memberSession.page.goto("/en/dashboard/employer");
    expect(await linkLabels(mainNavigation(memberSession.page))).toEqual(["Organisation", "Vacancies", "Applicants", "Team"]);
    await expect(mainNavigation(memberSession.page).getByRole("link", { name: "Billing" })).toHaveCount(0);
    await memberSession.context.close();
  });

  test("the organisation switcher appears only for a person who belongs to more than one organisation", async ({ browser }) => {
    const first = uniqueName("First Bau");
    const second = uniqueName("Second Bau");
    const team = await newTeam(first);
    const { context, page } = await signedInPage(browser, team.owner);
    await page.goto(`/en/dashboard/employer?org=${team.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: first })).toHaveCount(0);

    await registerOrganization(team.owner, `${second} GmbH`, second);
    await page.reload();
    const switcher = page.getByRole("button", { name: first });
    await waitForHydration(switcher);
    await switcher.click();
    await expect(switcher).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: first, exact: true }).first()).toHaveAttribute("aria-current", "true");
    await page.getByRole("link", { name: second, exact: true }).first().click();

    await expect(page).toHaveURL(/\/en\/dashboard\/employer\?org=/);
    await expect(page.getByRole("button", { name: second })).toBeVisible();
    await expect(mainNavigation(page).getByRole("link", { name: "Vacancies" })).toHaveAttribute("href", new RegExp(`/en/org/.*second-bau.*/jobs`));
    await context.close();
  });

  test("a new employer has the links of the header as soon as the organisation exists, without reloading", async ({ page }) => {
    const user = await createTestUser("company", await pendingConsents("company"));
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(mainNavigation(page)).toHaveCount(0);
    await expect(accountButton(page)).toBeVisible();

    await fillCompany(page, { legalName: `${uniqueName("Fresh Bau")} GmbH`, country: "Germany", industry: "Construction" });
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(page).toHaveURL(/\/en\/mfa$/);
    expect(await linkLabels(mainNavigation(page))).toEqual(MANAGER_LINKS);
  });
});
