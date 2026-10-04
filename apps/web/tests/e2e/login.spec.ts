import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createUnconfirmedUser } from "./support/accounts";
import { query } from "./support/db";
import {
  ageSessions,
  auditRows,
  authCookies,
  authSetCookies,
  banUser,
  createCommittedUser,
  decodeSession,
  expireAccessToken,
  LOGIN_FAILED,
  refreshStatus,
  sessionClaims,
  sessionRows,
  suspendProfile,
} from "./support/login";
import { signInBrowser } from "./support/session";
import { captureActionRequests } from "./support/server-action";
import type { TestUser } from "./support/test-user";

const SUSPENDED = "This account is suspended. See the email we sent you for the reasons.";

async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
}

function loginResponse(page: Page) {
  return page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/en/login",
  );
}

async function logIn(page: Page, user: TestUser, next?: string): Promise<void> {
  await page.goto(next ? `/en/login?next=${encodeURIComponent(next)}` : "/en/login");
  await fillLogin(page, user.email, user.password);
  await page.getByRole("button", { name: "Log in" }).click();
}

function alertText(page: Page) {
  return page.getByRole("alert").filter({ hasText: "There is a problem" });
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

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

  test("FR-A3 AC2: the proxy refreshes sessions younger than 7 days without interruption and refuses an older one", async ({
    browser,
  }) => {
    const cases = [
      { age: "1 minute", refreshed: true },
      { age: "6 days 23 hours", refreshed: true },
      { age: "7 days 1 minute", refreshed: false },
    ];
    for (const { age, refreshed } of cases) {
      const user = await createCommittedUser("worker");
      const context = await browser.newContext();
      await signInBrowser(context, user);
      ageSessions(user.id, age);
      await expireAccessToken(context);

      const page = await context.newPage();
      const response = await page.goto("/en/dashboard/worker");
      const setCookies = await authSetCookies(response!);
      expect(setCookies.length, age).toBeGreaterThan(0);
      if (refreshed) {
        await expect(page, age).toHaveURL(/\/en\/dashboard\/worker$/);
        await expect(page.getByRole("heading", { name: "Dashboard" }), age).toBeVisible();
        expect(setCookies.some((value) => /Max-Age=604800(;|$)/.test(value)), age).toBe(true);
        expect(setCookies.every((value) => /Max-Age=(604800|0)(;|$)/.test(value)), age).toBe(true);
        expect(decodeSession(await context.cookies()).expires_at, age).toBeGreaterThan(
          Date.now() / 1000,
        );
      } else {
        await expect(page, age).toHaveURL(
          `/en/login?next=${encodeURIComponent("/en/dashboard/worker")}`,
        );
        expect(setCookies.every((value) => /Max-Age=0/.test(value)), age).toBe(true);
        expect(authCookies(await context.cookies()), age).toEqual([]);
      }
      await context.close();
    }
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
    await second.close();
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

  test("FR-A3 AC12: the form is labelled, usable by keyboard and fits 360 px", async ({ page }) => {
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/en/login");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    }
    await page.goto("/en/login");
    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("autocomplete", "username");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "autocomplete",
      "current-password",
    );

    await page.getByLabel("Email", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(alertText(page)).toBeFocused();
    await expect(alertText(page)).toContainText("Enter a valid email address.");
    await expect(alertText(page)).toContainText("Enter your password.");
    await alertText(page).getByRole("link", { name: "Enter a valid email address." }).click();
    await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  });

  test("FR-A3 AC12: a keyboard-only user logs in and a relative next path is honoured", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    await page.goto(`/en/login?next=${encodeURIComponent("/en/onboarding")}`);
    await page.getByLabel("Email", { exact: true }).focus();
    await page.keyboard.type(user.email);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await page.keyboard.type(user.password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Your account type is Worker" })).toBeVisible();
  });

  test("FR-A3 AC12: an external next value is ignored and the user lands on their own dashboard", async ({
    browser,
  }) => {
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      const user = await createCommittedUser("worker");
      const context = await browser.newContext();
      const page = await context.newPage();
      await logIn(page, user, next);
      await expect(page).toHaveURL(/^http:\/\/localhost:3100\/en\/dashboard\/worker$/);
      await context.close();
    }
  });

  test("FR-A3 AC12: a protected page remembers where the visitor was going", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent("/en/onboarding")}`);
    await fillLogin(page, user.email, user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/en\/onboarding$/);
  });

  test("FR-A3 AC12: the button shows a pending state and a double click sends one request", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    const calls = captureActionRequests(page);
    await page.route("**/en/login", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.goto("/en/login");
    await fillLogin(page, user.email, user.password);
    await page.getByRole("button", { name: "Log in" }).dblclick();
    const pending = page.getByRole("button", { name: "Logging in..." });
    await expect(pending).toBeVisible();
    await expect(pending).toBeDisabled();
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    expect(calls).toHaveLength(1);
    expect(sessionRows(user.id)).toHaveLength(1);
  });

  test("FR-A3 AC12: a network failure shows an error toast and keeps the email", async ({
    page,
    context,
  }) => {
    const user = await createCommittedUser("worker");
    await page.goto("/en/login");
    await fillLogin(page, user.email, user.password);
    await context.setOffline(true);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Could not log in", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(user.email);
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    await context.setOffline(false);
    expect(sessionRows(user.id)).toEqual([]);
  });

  test("FR-A3: an unconfirmed address is asked to confirm and offered a new link", async ({ page }) => {
    const user = await createUnconfirmedUser("worker");
    await logIn(page, user);
    await expect(alertText(page)).toContainText("Confirm your email address before you log in.");
    await page.getByRole("link", { name: "Request a new confirmation link" }).click();
    await expect(page).toHaveURL(/\/en\/verify-email$/);
  });
});

test.describe("logout", () => {
  async function loggedIn(browser: Browser, user: TestUser) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    return { context, page };
  }

  async function revokedAfterLogout(context: BrowserContext, page: Page) {
    const refreshToken = decodeSession(await context.cookies()).refresh_token;
    const { session_id: sessionId } = await sessionClaims(context);
    const response = page.waitForResponse((r) => r.request().method() === "POST");
    await page.getByRole("button", { name: "Log out" }).click();
    return { refreshToken, sessionId, response: await response };
  }

  test("FR-A3 AC6: logging out revokes this session on the server and leaves the other browser signed in", async ({
    browser,
  }) => {
    const user = await createCommittedUser("worker");
    const a = await loggedIn(browser, user);
    const b = await loggedIn(browser, user);
    expect(sessionRows(user.id)).toHaveLength(2);

    const { refreshToken, sessionId, response } = await revokedAfterLogout(a.context, a.page);
    await expect(a.page).toHaveURL(/\/en\/login$/);

    const cleared = await authSetCookies(response);
    expect(cleared.length).toBeGreaterThan(0);
    expect(cleared.every((header) => /Max-Age=0/.test(header))).toBe(true);
    expect(authCookies(await a.context.cookies())).toEqual([]);
    expect(sessionRows(user.id).map((row) => row.id)).not.toContain(sessionId);
    expect(sessionRows(user.id)).toHaveLength(1);
    expect(await refreshStatus(refreshToken)).toBe(400);

    await a.page.goto("/en/dashboard/worker");
    await expect(a.page).toHaveURL(/\/en\/login/);
    await a.page.goBack();
    await expect(a.page).toHaveURL(/\/en\/login/);
    await expect(a.page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);

    await b.page.goto("/en/dashboard/worker");
    await expect(b.page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await a.context.close();
    await b.context.close();
  });

  test("FR-A3 AC6: private pages are served with no-store so a cached copy never shows private content", async ({
    browser,
  }) => {
    const user = await createCommittedUser("worker");
    const { context } = await loggedIn(browser, user);
    const response = await context.request.get("/en/dashboard/worker");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    await context.close();
  });

  test("FR-A3: a failed logout reports an error and keeps the page", async ({ browser }) => {
    const user = await createCommittedUser("worker");
    const { context, page } = await loggedIn(browser, user);
    await context.setOffline(true);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByText("Could not log out", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    await context.setOffline(false);
    expect(sessionRows(user.id)).toHaveLength(1);
    await context.close();
  });
});
