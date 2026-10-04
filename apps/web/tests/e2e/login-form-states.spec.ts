import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { createCommittedUser, sessionRows } from "./support/login";
import { alertText, fillLogin, logIn, overflow } from "./support/login-page";
import { captureActionRequests } from "./support/server-action";

test.describe("login form", () => {
  test("FR-A3 AC12: the form is labelled, usable by keyboard and fits 360 px", async ({ page }) => {
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/en/login");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectNoAxeViolations(page);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(alertText(page)).toBeFocused();
      await expectNoAxeViolations(page);
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
    await page.waitForLoadState("networkidle");
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
});
