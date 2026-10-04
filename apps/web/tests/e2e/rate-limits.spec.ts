import type { Browser, Page } from "@playwright/test";
import { createUnconfirmedUser, userByEmail } from "./support/accounts";
import { expectNoAxeViolations } from "./support/axe";
import {
  authCookies,
  createCommittedUser,
  enrollTotp,
  generateRecoveryPath,
  LOGIN_FAILED,
  RESET_SENT,
  sessionRows,
} from "./support/login";
import { alertText, fillLogin, loginResponse } from "./support/login-page";
import { messageCount } from "./support/mailpit";
import { fillSignup, newEmail, PASSWORD, summary } from "./support/signup-page";
import { expect, test, visitorAddress } from "./support/test";

const TOO_MANY = "Too many attempts. Try again in a few minutes.";

async function visitor(browser: Browser, address: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": address } });
  return { context, page: await context.newPage() };
}

async function loginAttempt(page: Page, email: string, password: string): Promise<void> {
  await fillLogin(page, email, password);
  const response = loginResponse(page);
  await page.getByRole("button", { name: "Log in" }).click();
  await response;
}

test.describe("per-visitor rate limits (D20)", () => {
  test("FR-A3 AC5: the 31st login attempt from one address is refused even with correct credentials, another address still logs in, and a forged first address changes nothing", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const user = await createCommittedUser("worker");
    const address = visitorAddress();
    const { context, page } = await visitor(browser, address);
    await page.goto("/en/login");

    for (let attempt = 1; attempt <= 30; attempt += 1) {
      await loginAttempt(page, user.email, `wrong password ${attempt}`);
      await expect(alertText(page)).toContainText(LOGIN_FAILED);
    }

    await loginAttempt(page, user.email, user.password);
    await expect(alertText(page)).toContainText(TOO_MANY);
    await expect(alertText(page)).not.toContainText(user.email);
    await expect(page).toHaveURL(/\/en\/login$/);
    expect(sessionRows(user.id)).toEqual([]);
    expect(authCookies(await context.cookies())).toEqual([]);

    const forged = await visitor(browser, `${visitorAddress()}, ${address}`);
    await forged.page.goto("/en/login");
    await loginAttempt(forged.page, user.email, user.password);
    await expect(alertText(forged.page)).toContainText(TOO_MANY);
    expect(sessionRows(user.id)).toEqual([]);

    let other = visitorAddress();
    while (other === address) other = visitorAddress();
    const second = await visitor(browser, other);
    await second.page.goto("/en/login");
    await fillLogin(second.page, user.email, user.password);
    await second.page.getByRole("button", { name: "Log in" }).click();
    await expect(second.page).toHaveURL(/\/en\/dashboard\/worker$/);
    expect(sessionRows(user.id)).toHaveLength(1);

    await context.close();
    await forged.context.close();
    await second.context.close();
  });

  test("FR-A1 AC11: the 31st sign-up from one address is refused and creates no account and no email, while another address can still sign up", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await visitor(browser, visitorAddress());

    for (let attempt = 1; attempt <= 30; attempt += 1) {
      await page.goto("/en/signup");
      await fillSignup(page, { kind: "worker", email: newEmail(), password: PASSWORD });
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL(/\/en\/verify-email$/);
    }

    const refused = newEmail();
    await page.goto("/en/signup");
    await fillSignup(page, { kind: "worker", email: refused, password: PASSWORD });
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(summary(page)).toContainText(TOO_MANY);
    await expect(page).toHaveURL(/\/en\/signup$/);
    expect(userByEmail(refused)).toEqual([]);
    expect(await messageCount(refused)).toBe(0);

    const other = await visitor(browser, visitorAddress());
    const accepted = newEmail();
    await other.page.goto("/en/signup");
    await fillSignup(other.page, { kind: "worker", email: accepted, password: PASSWORD });
    await other.page.getByRole("button", { name: "Create account" }).click();
    await expect(other.page).toHaveURL(/\/en\/verify-email$/);
    expect(userByEmail(accepted)).toHaveLength(1);

    await context.close();
    await other.context.close();
  });

  test("FR-A1 AC10: the 11th resend request from one address is refused with the rate-limit message and the first 10 answer alike", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const waiting = await createUnconfirmedUser();
    const { context, page } = await visitor(browser, visitorAddress());
    const sent = "If an account with this email is waiting for confirmation, a new link has been sent.";

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await page.goto("/en/verify-email?error=invalid_link");
      await page.getByLabel("Email address").fill(waiting.email);
      await page.getByRole("button", { name: "Send a new link" }).click();
      await expect(page.getByRole("status")).toHaveText(sent);
    }
    await page.goto("/en/verify-email?error=invalid_link");
    await page.getByLabel("Email address").fill(newEmail());
    await page.getByRole("button", { name: "Send a new link" }).click();
    await expect(page.getByRole("alert").filter({ hasText: TOO_MANY })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    await expectNoAxeViolations(page);
    await context.close();
  });

  test("FR-A3 AC7: the 11th reset request from one address is refused, sends no email, and the first 10 answer alike", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const user = await createCommittedUser("worker");
    const { context, page } = await visitor(browser, visitorAddress());

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await page.goto("/en/forgot-password");
      await page.getByLabel("Email", { exact: true }).fill(attempt === 1 ? user.email : newEmail());
      await page.getByRole("button", { name: "Send reset link" }).click();
      await expect(page.getByRole("status")).toHaveText(RESET_SENT);
    }
    const stranger = newEmail();
    await page.goto("/en/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(stranger);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("alert").filter({ hasText: TOO_MANY })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(await messageCount(stranger)).toBe(0);
    await context.close();
  });

  test("FR-A3: the 11th password-change attempt from one address is refused before Auth is asked", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const user = await createCommittedUser("worker");
    await enrollTotp(user);
    const { context, page } = await visitor(browser, visitorAddress());
    await page.goto(await generateRecoveryPath(user.email));
    await page.getByLabel("New password", { exact: true }).fill("Brand-New-Pw-14");
    await page.getByRole("button", { name: "Change password" }).click();
    const code = page.getByLabel("Authenticator code");
    await expect(code).toBeFocused();

    for (let attempt = 2; attempt <= 10; attempt += 1) {
      await code.fill("000000");
      await page.getByRole("button", { name: "Change password" }).click();
      await expect(summary(page)).toContainText("The code is incorrect or has expired.");
    }
    await code.fill("000000");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(summary(page)).toContainText(TOO_MANY);
    await context.close();
  });
});
