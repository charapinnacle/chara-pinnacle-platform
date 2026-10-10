import { signInStaff } from "./support/admin";
import { accountButton, linkLabels, logOut, mainNavigation, openAccountMenu, PHONE, signedInPage } from "./support/app-shell";
import { expectNoAxeViolations } from "./support/axe";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser } from "./support/login";
import { overflow } from "./support/login-page";
import { registerOrganization, uniqueName } from "./support/organizations";
import { addMember, newTeam } from "./support/team";
import { expect, test } from "./support/test";

const WORKER_LINKS = ["Dashboard", "Find jobs", "Saved", "Applications", "Passport"];

const panelOf = (page: Parameters<typeof accountButton>[0]) =>
  accountButton(page)
    .getAttribute("aria-controls")
    .then((id) => page.locator(`[id="${id}"]`));

test.describe("the menus of the header (UX-01, UX-08)", () => {
  test("below 768 px the links are behind a Menu button that opens, follows a link and closes with Escape", async ({ browser }) => {
    const worker = await createCommittedUser("worker");
    const { context, page } = await signedInPage(browser, worker, PHONE);
    await page.goto("/en/dashboard/worker");
    const menu = page.getByRole("button", { name: "Menu" });
    await waitForHydration(menu);
    await expect(mainNavigation(page)).toBeHidden();

    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(await linkLabels(mainNavigation(page))).toEqual(WORKER_LINKS);
    await expect(page.getByText(worker.email).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Notification settings" }).filter({ visible: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    await expectNoAxeViolations(page);

    await mainNavigation(page).getByRole("link", { name: "Saved" }).click();
    await expect(page).toHaveURL("/en/saved");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(mainNavigation(page)).toBeHidden();

    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
    await context.close();
  });

  test("below 768 px an owner of two organisations sees the five links and both organisations in the menu and moves to the other one", async ({ browser }) => {
    const first = uniqueName("First Bau");
    const second = uniqueName("Second Bau");
    const team = await newTeam(first);
    await registerOrganization(team.owner, `${second} GmbH`, second);
    const { context, page } = await signedInPage(browser, team.owner, PHONE);
    await page.goto(`/en/dashboard/employer?org=${team.slug}`);
    const menu = page.getByRole("button", { name: "Menu" });
    await waitForHydration(menu);
    await menu.click();

    expect(await linkLabels(mainNavigation(page))).toEqual(["Organisation", "Vacancies", "Applicants", "Team", "Billing"]);
    await expect(page.getByText("Your organisations")).toBeVisible();
    const organisations = page.locator("div", { has: page.getByText("Your organisations") }).last();
    await expect(organisations.getByRole("link", { name: first, exact: true })).toHaveAttribute("aria-current", "true");
    await expect(page.getByText("Owner", { exact: true }).filter({ visible: true })).toBeVisible();
    await expectNoAxeViolations(page);

    await organisations.getByRole("link", { name: second, exact: true }).click();
    await expect(page).toHaveURL(/\/en\/dashboard\/employer\?org=.*second-bau/);
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(organisations.getByRole("link", { name: second, exact: true })).toHaveAttribute("aria-current", "true");
    await context.close();
  });

  test("below 768 px without JavaScript the links and the way out are on the page and there is no Menu button", async ({ browser }) => {
    const worker = await createCommittedUser("worker");
    const { context, page } = await signedInPage(browser, worker, { ...PHONE, javaScriptEnabled: false });
    await page.goto("/en/dashboard/worker");
    await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
    expect(await linkLabels(mainNavigation(page))).toEqual(WORKER_LINKS);
    await expect(mainNavigation(page).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    await mainNavigation(page).getByRole("link", { name: "Applications" }).click();
    await expect(page).toHaveURL("/en/applications");
    await context.close();
  });

  test("the account menu closes when Tab leaves its last item", async ({ browser }) => {
    const worker = await createCommittedUser("worker");
    const { context, page } = await signedInPage(browser, worker);
    await page.goto("/en/dashboard/worker");
    const button = accountButton(page);
    await waitForHydration(button);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = await panelOf(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Log out" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await context.close();
  });

  test("the account menu opens with the keyboard, is entered with Tab, closes with Escape and follows a link", async ({ browser }) => {
    const worker = await createCommittedUser("worker");
    const { context, page } = await signedInPage(browser, worker);
    await page.goto("/en/dashboard/worker");
    const button = accountButton(page);
    await waitForHydration(button);
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = await panelOf(page);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(worker.email);
    await expect(panel).toContainText("Worker");
    expect(await linkLabels(panel)).toEqual(["Settings", "Notification settings"]);
    await expect(panel.getByRole("button", { name: "Log out" })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.keyboard.press("Tab");
    await expect(panel.getByRole("link", { name: "Settings", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
    await expect(panel).toBeHidden();

    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("heading", { level: 1 }).click();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Shift+Tab");
    await button.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/en/settings");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await context.close();
  });

  test("the account menu opens with a tap", async ({ browser }) => {
    const worker = await createCommittedUser("worker");
    const { context, page } = await signedInPage(browser, worker, { hasTouch: true });
    await page.goto("/en/dashboard/worker");
    await waitForHydration(accountButton(page));
    await accountButton(page).tap();
    await expect(accountButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    await context.close();
  });

  test("an employer's account menu offers the notification settings but not the account deletion that only a candidate has", async ({ browser }) => {
    const team = await newTeam();
    const member = await addMember(team, "member");
    const { context, page } = await signedInPage(browser, member.user);
    await page.goto("/en/dashboard/employer");
    await openAccountMenu(page);
    const panel = await panelOf(page);
    expect(await linkLabels(panel)).toEqual(["Notification settings"]);
    await expect(panel).toContainText("Member");
    await expect(panel).toContainText(member.user.email);
    await logOut(page);
    await expect(page).toHaveURL(/\/en\/login$/);
    await context.close();
  });

  test("the header of a signed-in person on a public page has Go to my area and Log out instead of Log in and Sign up", async ({ browser, page }) => {
    await page.goto("/en/pricing");
    await expect(mainNavigation(page).getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(mainNavigation(page).getByRole("link", { name: "Sign up" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);

    const worker = await createCommittedUser("worker");
    const session = await signedInPage(browser, worker);
    await session.page.goto("/en/pricing");
    const navigation = mainNavigation(session.page);
    await expect(navigation.getByRole("link", { name: "Go to my area" })).toHaveAttribute("href", "/en/dashboard/worker");
    await expect(navigation.getByRole("button", { name: "Log out" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Log in" })).toHaveCount(0);
    await expect(navigation.getByRole("link", { name: "Sign up" })).toHaveCount(0);
    await expectNoAxeViolations(session.page);

    await navigation.getByRole("link", { name: "Go to my area" }).click();
    await expect(session.page).toHaveURL("/en/dashboard/worker");
    await session.page.goto("/en/about");
    await session.page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Log out" }).click();
    await expect(session.page).toHaveURL(/\/en\/login$/);
    await session.context.close();
  });

  test("every area has the legal links in the footer in three short groups, and a candidate's area has none about billing", async ({ browser }) => {
    const worker = await createCommittedUser("worker");
    const { context, page } = await signedInPage(browser, worker);
    for (const [path, count] of [
      ["/en/saved", 10],
      ["/en/pricing", 11],
    ] as const) {
      await page.goto(path);
      const legal = page.getByRole("navigation", { name: "Legal" });
      await expect(legal.getByText("Legal", { exact: true })).toBeVisible();
      await expect(legal.getByText("Rules and disputes", { exact: true })).toBeVisible();
      await expect(legal.getByText("Billing and roles", { exact: true })).toBeVisible();
      await expect(legal.getByRole("link")).toHaveCount(count);
      await expect(legal.getByRole("link", { name: "Imprint" })).toHaveAttribute("href", "/en/imprint");
      await expect(legal.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/en/legal/terms-of-service");
    }
    await context.close();

    const team = await newTeam();
    const employer = await signedInPage(browser, team.owner);
    await employer.page.goto("/en/dashboard/employer");
    await expect(employer.page.getByRole("navigation", { name: "Legal" }).getByRole("link")).toHaveCount(11);
    await employer.context.close();
  });

  test("the console keeps its own navigation, has the account menu in the header and wraps without overflow on a phone", async ({ page }) => {
    await signInStaff(page, "admin");
    const administration = page.getByRole("navigation", { name: "Administration" });
    await expect(administration.getByRole("link")).toHaveCount(7);
    await expect(page.getByRole("link", { name: "CHARA" })).toHaveAttribute("href", "/en/admin");
    await openAccountMenu(page);
    await expect(await panelOf(page)).toContainText("Platform Administrator");
    await expectNoAxeViolations(page);

    await page.setViewportSize(PHONE.viewport);
    await page.goto("/en/admin");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    for (const link of await administration.getByRole("link").all()) {
      const box = await link.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= PHONE.viewport.width, await link.innerText()).toBe(true);
    }
    await expect(accountButton(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});
