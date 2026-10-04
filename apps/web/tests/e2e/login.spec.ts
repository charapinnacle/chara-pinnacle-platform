import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { createUnconfirmedUser } from "./support/accounts";
import { query } from "./support/db";
import {
  auditRows,
  authCookies,
  authSetCookies,
  banUser,
  createCommittedUser,
  LOGIN_FAILED,
  sessionClaims,
  sessionRows,
  suspendProfile,
} from "./support/login";
import { alertText, fillLogin, loginResponse, logIn, SUSPENDED } from "./support/login-page";
import { signInBrowser } from "./support/session";
import { captureActionRequests } from "./support/server-action";

test.describe("login", () => {
  test("FR-A3 AC1: a worker and an employer land on their dashboards with 7-day cookies and a 30-minute token", async ({
    browser,
  }) => {
    const cases = [
      { kind: "worker", landing: "/en/dashboard/worker" },
      { kind: "company", landing: "/en/dashboard/employer" },
    ] as const;
    for (const { kind, landing } of cases) {
      const user = await createCommittedUser(kind);
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("/en/login");
      await fillLogin(page, user.email, user.password);
      const response = loginResponse(page);
      await page.getByRole("button", { name: "Log in" }).click();

      await expect(page).toHaveURL(new RegExp(`${landing}$`));
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
      await expectNoAxeViolations(page);

      const setCookies = await authSetCookies(await response);
      expect(setCookies.length).toBeGreaterThan(0);
      for (const header of setCookies) {
        expect(header).toMatch(/Max-Age=604800(;|$)/);
        expect(header).toMatch(/Path=\/(;|$)/);
        expect(header).toMatch(/SameSite=Lax/i);
        expect(header).not.toMatch(/HttpOnly/i);
        expect(header).not.toMatch(/Secure/i);
      }
      const claims = await sessionClaims(context);
      expect(claims.sub).toBe(user.id);
      expect(claims.exp - claims.iat).toBe(1800);
      expect(authCookies(await context.cookies()).every((cookie) => !cookie.httpOnly)).toBe(true);
      await context.close();
    }
  });

  test("FR-A3 AC1: an employer cannot open the worker dashboard and is sent to its own", async ({
    browser,
  }) => {
    const user = await createCommittedUser("company");
    const context = await browser.newContext();
    await signInBrowser(context, user);
    const page = await context.newPage();
    await page.goto("/en/dashboard/worker");
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await context.close();
  });

  test("FR-A3 AC3: a suspended account cannot log in and one with a session is held on the suspended page", async ({
    browser,
  }) => {
    const banned = await createCommittedUser("worker");
    suspendProfile(banned.id);
    await banUser(banned.id);
    const context = await browser.newContext();
    const page = await context.newPage();
    await logIn(page, banned);
    await expect(alertText(page)).toContainText(SUSPENDED);
    await expectNoAxeViolations(page);
    await expect(page).toHaveURL(/\/en\/login$/);
    expect(authCookies(await context.cookies())).toEqual([]);
    expect(sessionRows(banned.id)).toEqual([]);

    // Auth checks the ban before the password, so a wrong password is told apart as well (a departure from AC3).
    await fillLogin(page, banned.email, "not the password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(alertText(page)).toContainText(SUSPENDED);
    await context.close();

    const holder = await createCommittedUser("worker");
    const second = await browser.newContext();
    await signInBrowser(second, holder);
    suspendProfile(holder.id);
    const protectedPage = await second.newPage();
    await protectedPage.goto("/en/dashboard/worker");
    await expect(protectedPage).toHaveURL(/\/en\/suspended$/);
    await expect(
      protectedPage.getByRole("heading", { name: "Your account is suspended" }),
    ).toBeVisible();
    await expect(protectedPage.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
    await expectNoAxeViolations(protectedPage);
    await second.close();
  });

  test("FR-A3 AC3: the suspended page is closed to a visitor and to an active user", async ({
    browser,
    page,
  }) => {
    await page.goto("/en/suspended");
    await expect(page).toHaveURL(/\/en\/login$/);
    await expect(page.getByRole("heading", { name: "Your account is suspended" })).toHaveCount(0);

    const active = await createCommittedUser("worker");
    const context = await browser.newContext();
    await signInBrowser(context, active);
    const activePage = await context.newPage();
    await activePage.goto("/en/suspended");
    await expect(activePage).toHaveURL(/\/en\/dashboard\/worker$/);
    await expect(activePage.getByRole("heading", { name: "Your account is suspended" })).toHaveCount(0);
    await context.close();
  });

  test("FR-A3 AC4: a wrong password answers alike for a registered and for an unknown address", async ({
    browser,
  }) => {
    const user = await createCommittedUser("worker");
    const outcomes = [];
    for (const email of [user.email, `nobody-${user.id}@example.test`]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const calls = captureActionRequests(page);
      await page.goto("/en/login");
      await fillLogin(page, email, "definitely wrong");
      const response = loginResponse(page);
      await page.getByRole("button", { name: "Log in" }).click();
      const status = (await response).status();
      await expect(alertText(page)).toBeVisible();
      await expectNoAxeViolations(page);
      outcomes.push({
        status,
        calls: calls.length,
        alert: await alertText(page).innerText(),
        url: new URL(page.url()).pathname,
        email: await page.getByLabel("Email", { exact: true }).inputValue(),
        password: await page.getByLabel("Password", { exact: true }).inputValue(),
        cookies: authCookies(await context.cookies()).length,
        sessions: sessionRows(user.id).length,
      });
      await context.close();
    }
    expect(outcomes[0].alert).toContain(LOGIN_FAILED);
    expect(outcomes[0].cookies).toBe(0);
    expect(outcomes[0].sessions).toBe(0);
    expect({ ...outcomes[1], email: outcomes[0].email }).toEqual(outcomes[0]);
  });

  test("FR-A3 AC11: five failed logins write one audit row; unknown addresses write none", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    await page.goto("/en/login");
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await fillLogin(page, user.email, `wrong password ${attempt}`);
      const response = loginResponse(page);
      await page.getByRole("button", { name: "Log in" }).click();
      await response;
      await expect(alertText(page)).toContainText(LOGIN_FAILED);
      if (attempt === 4) expect(auditRows(user.id, "login_failures_threshold")).toEqual([]);
    }
    expect(auditRows(user.id, "login_failures_threshold")).toEqual([
      {
        actor_id: user.id,
        entity_type: "user",
        entity_id: user.id,
        metadata: { failures: 5, window_minutes: 15 },
      },
    ]);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await fillLogin(page, `ghost-${user.id}@example.test`, "wrong password");
      const response = loginResponse(page);
      await page.getByRole("button", { name: "Log in" }).click();
      await response;
    }
    const [{ count }] = query<{ count: number }>(
      `select count(*)::int as count from audit.log
       where action = 'login_failures_threshold' and entity_id not in (select id::text from auth.users)`,
    );
    expect(count).toBe(0);
  });

  test("FR-A3: an unconfirmed address is asked to confirm and offered a new link", async ({ page }) => {
    const user = await createUnconfirmedUser("worker");
    await logIn(page, user);
    await expect(alertText(page)).toContainText("Confirm your email address before you log in.");
    await page.getByRole("link", { name: "Request a new confirmation link" }).click();
    await expect(page).toHaveURL(/\/en\/verify-email$/);
  });
});
