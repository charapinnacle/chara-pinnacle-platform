import { expectNoAxeViolations } from "./support/axe";
import { logOut } from "./support/app-shell";
import { expect, test } from "./support/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  ageSessions,
  authCookies,
  authSetCookies,
  createCommittedUser,
  decodeSession,
  expireAccessToken,
  refreshStatus,
  sessionClaims,
  sessionRows,
} from "./support/login";
import { signInBrowser } from "./support/session";
import type { TestUser } from "./support/test-user";
import { logIn } from "./support/login-page";

test.describe("session", () => {
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
    await logOut(page);
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
    await logOut(page);
    await expect(page.getByText("Could not log out", { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    await context.setOffline(false);
    expect(sessionRows(user.id)).toHaveLength(1);
    await context.close();
  });
});
